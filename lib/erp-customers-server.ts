import {z} from 'zod';
import {CRMError,accessGuard,customerDetailMutationGuard,type context} from './crm-server';
import {regionScope} from './regions';
import type {Member} from './crm';
import {readWorkbookSheets,ErpWorkbookError} from './erp-sales';
import {erpCustomerRows,matchErpCustomers,heldOutsideRegions,ErpCustomersError,ERP_CUSTOMERS_MAX_ROWS} from './erp-customers';
import {customerCodeCandidates} from './customer-identity';

type Context=Awaited<ReturnType<typeof context>>;
const maxFileBytes=1024*1024;
const choiceSchema=z.object({row:z.number().int().min(1).max(1048576),customerId:z.string().max(200)}).strict();
const inputSchema=z.object({action:z.enum(['preview','apply']),fileName:z.string().trim().min(1).max(255),base64:z.string().min(1).max(Math.ceil(maxFileBytes/3)*4),choices:z.array(choiceSchema).max(ERP_CUSTOMERS_MAX_ROWS).default([]),snapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),requestId:z.string().uuid().optional()}).strict();
type Input=z.infer<typeof inputSchema>;
const stale='اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة';
/** The administrator (every customer in their regions, all of them for a global scope) and the sales manager (their regions' customers). */
export function requireErpCustomersRole(me:Member){if(!['admin','manager'].includes(me.role))throw new CRMError('استيراد عملاء ERP متاح لمدير النظام ومدير المبيعات فقط.',403);}
async function hash(value:string|Uint8Array<ArrayBuffer>){const bytes=await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value);return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
function parseInput(body:unknown){const input=inputSchema.parse(body);if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw new CRMError('ترميز ملف العملاء غير صحيح');const raw=atob(input.base64);if(raw.length>maxFileBytes)throw new CRMError('أقصى حجم لملف عملاء ERP 1 ميجابايت',413);return {input,bytes:Uint8Array.from(raw,c=>c.charCodeAt(0)) as Uint8Array<ArrayBuffer>};}
function choiceMap(input:Input){const choices=new Map<number,string>();for(const choice of input.choices){if(choices.has(choice.row))throw new CRMError('تكرار في اختيارات العملاء؛ اعمل معاينة جديدة');choices.set(choice.row,choice.customerId);}return choices;}
const expected=<T>(run:()=>T)=>{try{return run();}catch(error){if(error instanceof ErpWorkbookError||error instanceof ErpCustomersError)throw new CRMError(error.message);throw error;}};
/** Read the file and match it against the CRM's customers now. The file is parsed in memory only: never stored, never logged. */
async function prepare(c:Context,bytes:Uint8Array<ArrayBuffer>){
 const parsed=expected(()=>erpCustomerRows(readWorkbookSheets(bytes,{maxRows:ERP_CUSTOMERS_MAX_ROWS}))),options={me:c.me,mappings:c.customerIdentityState.mappings};
 const base=expected(()=>matchErpCustomers(parsed.rows,c.all,options));
 // What the preview showed depends on the codes and mappings (the identity revision) and on every candidate's record (its version);
 // the apply recomputes this before it reads the choices and refuses when it differs. Unrelated customers' edits do not invalidate a preview.
 const snapshot=await hash(JSON.stringify({revision:c.customerIdentityState.revision,me:[c.me.id,c.me.role,regionScope(c.me)],file:await hash(bytes),involved:base.involved}));
 return {sheet:parsed.sheet,snapshot,match:(choices:Map<number,string>)=>choices.size?expected(()=>matchErpCustomers(parsed.rows,c.all,{...options,choices})):base};
}

/** POST /api/erp-customers. `preview` writes nothing; `apply` re-reads the same file with the user's choices and writes, in one
 * transaction, the ERP code of every customer that changes, an explicit code mapping where the number is also held by another customer,
 * and one audit entry per changed customer. A repeated `requestId` returns the saved answer. */
export async function importErpCustomers(c:Context,body:unknown){
 requireErpCustomersRole(c.me);
 const {input,bytes}=parseInput(body);
 if(input.action==='preview'){
  const prepared=await prepare(c,bytes),matched=prepared.match(choiceMap(input));
  return {fileName:input.fileName,sheet:prepared.sheet,snapshot:prepared.snapshot,summary:matched.summary,rows:matched.rows};
 }
 if(!input.requestId||!input.snapshot)throw new CRMError('اعرض الملف أولًا قبل تحديث الأكواد');
 const fingerprint=await hash(JSON.stringify({file:await hash(bytes),choices:[...choiceMap(input)].sort(([a],[b])=>a-b)})),receipt='erp-customers:'+c.me.id+':'+input.requestId;
 const replay=async()=>{const row=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receipt).first<{detail:string}>();if(!row)return null;const saved=JSON.parse(row.detail) as {fingerprint:string;result:Record<string,unknown>};if(saved.fingerprint!==fingerprint)throw new CRMError('الطلب محفوظ ببيانات مختلفة. اعمل معاينة جديدة.',409);return {...saved.result,alreadySaved:true};};
 const prior=await replay();if(prior)return prior;
 const book=await prepare(c,bytes);
 if(book.snapshot!==input.snapshot)throw new CRMError(stale,409);
 const prepared={...book.match(choiceMap(input)),snapshot:book.snapshot};
 if(prepared.summary.conflicts)throw new CRMError('اخترت نفس العميل لأكثر من سطر؛ العميل له كود ERP واحد. راجع الاختيارات.');
 if(!prepared.plan.length)throw new CRMError('لا توجد أكواد تتغير في هذا الملف.');
 // The same checks as a customer edit, for every customer that changes; their SQL (member and record version) is the gate below. A member
 // limited to regions never moves a number's invoices away from a customer outside them (the preview already leaves those rows out).
 const customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row])),holders=customerCodeCandidates(c.all),mappings=new Map(c.customerIdentityState.mappings.map(mapping=>[mapping.codeKey,mapping]));
 for(const step of prepared.plan){
  const customer=customers.get(step.customerId)!;customerDetailMutationGuard({me:c.me,members:c.members,all:[customer]},customer);
  if(heldOutsideRegions(c.me,holders.get(step.codeKey)||[],mappings.get(step.codeKey),customers))throw new CRMError(`الرقم ${step.to} عند عميل خارج مناطقك؛ ربطه لمدير النظام.`,403);
 }
 const now=new Date().toISOString(),attempt='erp-customers-import:'+crypto.randomUUID();
 const result={ok:true,updated:prepared.summary.codeChanges,mappings:prepared.summary.mappings,changed:prepared.plan.length,unchanged:prepared.rows.filter(row=>row.customerId&&!row.change).length,skipped:prepared.rows.filter(row=>!row.customerId&&['auto','same','choose'].includes(row.status)).length,missing:prepared.summary.missing,outOfRegion:prepared.summary.outOfRegion,heldOutside:prepared.summary.heldOutside,invalid:prepared.summary.invalid,changes:prepared.plan.map(step=>({row:step.row,customerId:step.customerId,from:step.from,to:step.to,mapping:step.mapping}))};
 // The receipt is the transaction's gate: the member's role and regions, the identity revision (every code and mapping change moves it)
 // and every involved customer's version, in one JSON parameter. Every later write requires this attempt's own receipt.
 const guard=accessGuard(c);
 const gate=guard.sql+" AND EXISTS(SELECT 1 FROM crm_customer_identity_state WHERE id='company' AND revision=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) AS expected LEFT JOIN crm_records AS actual ON actual.id=json_extract(expected.value,'$[0]') WHERE actual.id IS NULL OR actual.kind IS NOT 'customer' OR actual.version IS NOT json_extract(expected.value,'$[1]'))";
 const claimed='EXISTS(SELECT 1 FROM crm_audit WHERE id=? AND record_id=?)',claimArgs=[receipt,attempt];
 const batch:D1PreparedStatement[]=[c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+gate).bind(receipt,attempt,c.me.name,'erp-customers-receipt',JSON.stringify({fingerprint,result}),now,...guard.args,c.customerIdentityState.revision,JSON.stringify(prepared.involved))];
 // Only the code changes; the identity trigger keeps the old code as an alias, so earlier invoices still find the customer.
 for(const step of prepared.plan)if(step.codeChange)batch.push(c.db.prepare("UPDATE crm_records SET data=json_set(data,'$.code',?),updated_at=?,version=version+1,mutation_id=? WHERE id=? AND kind='customer' AND version=? AND "+claimed).bind(step.to,now,attempt,step.customerId,step.version,...claimArgs));
 for(const step of prepared.plan)if(step.mapping)batch.push(step.mappingVersion?c.db.prepare('UPDATE crm_customer_code_mappings SET customer_id=?,version=version+1,updated_by=?,updated_at=? WHERE code_key=? AND version=? AND '+claimed).bind(step.customerId,c.me.id,now,step.codeKey,step.mappingVersion,...claimArgs):c.db.prepare('INSERT INTO crm_customer_code_mappings(code_key,customer_id,version,updated_by,updated_at) SELECT ?,?,1,?,? WHERE '+claimed).bind(step.codeKey,step.customerId,c.me.id,now,...claimArgs));
 for(const step of prepared.plan)batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(crypto.randomUUID(),step.customerId,c.me.name,'erp-customer-code',JSON.stringify({label:'تحديث كود ERP من ملف ERP',from:step.from,to:step.to,row:step.row,...(step.mapping?{mapping:true}:{})}),now,...claimArgs));
 let committed;try{committed=await c.db.batch(batch);}catch(error){const saved=await replay();if(saved)return saved;throw error;}
 if(committed[0].meta.changes!==1){const saved=await replay();if(saved)return saved;throw new CRMError(stale,409);}
 return result;
}

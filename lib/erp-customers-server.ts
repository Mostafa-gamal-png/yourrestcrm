import {z} from 'zod';
import {CRMError,accessGuard,customerDetailMutationGuard,type context} from './crm-server';
import {regionScope,memberCanAccessRegion} from './regions';
import {schemas,type Member,type Row} from './crm';
import {prepareCustomerLocation} from './customer-fields';
import {readWorkbookSheets,ErpWorkbookError} from './erp-sales';
import {erpCustomerRows,matchErpCustomers,heldOutsideRegions,erpNewCustomerRegions,erpNewCustomerRegionValues,ErpCustomersError,ERP_CUSTOMERS_MAX_ROWS,ERP_CUSTOMERS_MAX_ADDS,type ErpCustomerAdd,type ErpCustomerClearView} from './erp-customers';
import {customerCodeCandidates} from './customer-identity';
import {erpCustomerExtras,erpExtraData,erpExtraUpdates} from './erp-customer-extras';
import {erpDatesView,erpExtraStatements} from './erp-customer-extras-server';

type Context=Awaited<ReturnType<typeof context>>;
const maxFileBytes=1024*1024;
const choiceSchema=z.object({row:z.number().int().min(1).max(1048576),customerId:z.string().max(200)}).strict();
const regionSchema=z.object({row:z.number().int().min(1).max(1048576),region:z.string().max(40)}).strict();
const inputSchema=z.object({action:z.enum(['preview','apply']),fileName:z.string().trim().min(1).max(255),base64:z.string().min(1).max(Math.ceil(maxFileBytes/3)*4),choices:z.array(choiceSchema).max(ERP_CUSTOMERS_MAX_ROWS).default([]),region:z.string().max(40).optional(),regions:z.array(regionSchema).max(ERP_CUSTOMERS_MAX_ROWS).default([]),adds:z.number().int().min(0).max(ERP_CUSTOMERS_MAX_ROWS).optional(),snapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),clearCodes:z.boolean().optional(),clearSnapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),requestId:z.string().uuid().optional()}).strict();
type Input=z.infer<typeof inputSchema>;
/** The audit label of a code an import cleared (the customer is not in the ERP file), as «تحديث كود ERP من ملف ERP» for a code it changed. */
export const ERP_CLEAR_AUDIT_LABEL='مسح كود ERP: العميل غير موجود في ملف ERP';
const stale='تغيّرت بيانات العملاء منذ المعاينة؛ أجرِ معاينة جديدة';
/** An apply with no `adds`: an import screen loaded before additions existed (it said rows without a match are left alone, never sends
 *  `adds`, and cannot read this release's answer, which has no `missing`). Every apply from it is refused, code-only ones too, before
 *  anything is written. That screen cannot translate a new message, so the English sentence travels with it. */
export const ERP_SCREEN_OUTDATED='فُتحت شاشة الاستيراد هذه قبل تحديث النظام؛ حدّث الصفحة وأجرِ معاينة جديدة. لم يُحفظ أي شيء. / This import screen was opened before the system update. Reload the page and run a new preview. Nothing was saved.';
/** An apply whose `adds` differs from the number of new customers the file adds now. Nobody is added; the page must be reloaded. */
export const ERP_ADDS_UNCONFIRMED='لم تعرض هذه الشاشة العملاء الجدد الذين سيُضافون؛ حدّث الصفحة وأجرِ معاينة جديدة';
/** The label a customer added by an import carries in its «إضافة» history entry, after its name (the form's entry is the name alone). */
export const ERP_ADD_AUDIT_LABEL='إضافة عميل من ملف ERP';
/** The administrator (every customer in their regions, all of them for a global scope) and the sales manager (their regions' customers). */
export function requireErpCustomersRole(me:Member){if(!['admin','manager'].includes(me.role))throw new CRMError('استيراد عملاء ERP متاح لمدير النظام ومدير المبيعات فقط.',403);}
async function hash(value:string|Uint8Array<ArrayBuffer>){const bytes=await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value);return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
function parseInput(body:unknown){const input=inputSchema.parse(body);if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw new CRMError('ترميز ملف العملاء غير صحيح');const raw=atob(input.base64);if(raw.length>maxFileBytes)throw new CRMError('أقصى حجم لملف عملاء ERP 1 ميجابايت',413);return {input,bytes:Uint8Array.from(raw,c=>c.charCodeAt(0)) as Uint8Array<ArrayBuffer>};}
function choiceMap(input:Input){const choices=new Map<number,string>();for(const choice of input.choices){if(choices.has(choice.row))throw new CRMError('تكرار في اختيارات العملاء؛ أجرِ معاينة جديدة');choices.set(choice.row,choice.customerId);}return choices;}
function regionMap(input:Input){const regions=new Map<number,string>();for(const entry of input.regions){if(regions.has(entry.row))throw new CRMError('تكرار في مناطق العملاء الجدد؛ أجرِ معاينة جديدة');regions.set(entry.row,entry.region);}return regions;}
const expected=<T>(run:()=>T)=>{try{return run();}catch(error){if(error instanceof ErpWorkbookError||error instanceof ErpCustomersError)throw new CRMError(error.message);throw error;}};
/** The same region rules as a customer created from the form, for a customer the importing member adds and is responsible for: one of the
 * form's values, and a region the member may use (memberCanAccessRegion, which is also the responsible member's region rule here). */
function checkRegion(me:Member,region:string){
 if(!erpNewCustomerRegionValues.includes(region))throw new CRMError('اختر منطقة صحيحة للعملاء الجدد.');
 if(!memberCanAccessRegion(me,region))throw new CRMError('لا يمكنك إنشاء أو نقل عميل خارج منطقتك المسموح بها',403);
}
/** A new customer's record data, as the customer form builds it (schemas.customer, the location fields, `_createdBy`): the row's name,
 * code, phones, email (only a valid one) and address, the importing member as the responsible and their branch. Nothing else from the file. */
function newCustomerData(me:Member,add:ErpCustomerAdd,region:string):Record<string,unknown>{
 const email=z.string().email().safeParse(add.email).success?add.email:'';
 const parsed=schemas.customer.safeParse({name:add.name,code:add.code,phone:add.phone,phone2:add.phone2,email,address:add.address,region,branch:me.branch,assignedTo:me.id});
 if(!parsed.success)throw new CRMError(`السطر ${add.row}: ${parsed.error.issues.map(issue=>issue.message).join(' • ')}`);
 const data:typeof parsed.data&Record<string,unknown>={...parsed.data};
 const locationError=prepareCustomerLocation(data);if(locationError)throw new CRMError(locationError);
 for(const key of ['sourceFile','sourceRow','sourceKey','sourceHash','_visitPlan','_stageVisitId'])delete data[key];
 data._createdBy=me.id;
 return data;
}
/** Whether `me` may change this customer's details (customerDetailMutationGuard, the check every code change passes), without throwing. */
function mayChange(c:Context,customer:Row){try{customerDetailMutationGuard({me:c.me,members:c.members,all:[customer]},customer);return true;}catch{return false;}}
/** Read the file and match it against the CRM's customers now. The file is parsed in memory only: never stored, never logged. */
async function prepare(c:Context,bytes:Uint8Array<ArrayBuffer>){
 const sheets=expected(()=>readWorkbookSheets(bytes,{maxRows:ERP_CUSTOMERS_MAX_ROWS})),parsed=expected(()=>erpCustomerRows(sheets)),options={me:c.me,mappings:c.customerIdentityState.mappings};
 const base=expected(()=>matchErpCustomers(parsed.rows,c.all,options));
 // The customers the file does not name whose code «امسح كود ERP للعملاء غير الموجودين في الشيت» clears: only those `me` may change, like a
 // code change. They do not depend on the choices; what the preview listed (each with its version) is `clearSnapshot`, which an apply
 // that clears must send back: a customer edited, moved to another region or matched by the file since then refuses it (409).
 const customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row]));
 const clears=base.clears.filter(clear=>mayChange(c,customers.get(clear.customerId)!));
 // What the preview showed depends on the codes and mappings (the identity revision; adding or deleting a customer moves it too), on
 // every candidate's and holder's record (its version) and on what each row became (its status and candidates: a similar name depends on
 // how many customers carry a word). The apply recomputes this before it reads the choices and refuses when it differs, so a row shown as
 // left alone is never added. Unrelated customers' edits do not invalidate a preview.
 const shape=await hash(JSON.stringify(base.rows.map(row=>[row.row,row.status,row.customerId,row.candidates.map(candidate=>candidate.id)])));
 const snapshot=await hash(JSON.stringify({revision:c.customerIdentityState.revision,me:[c.me.id,c.me.role,regionScope(c.me)],file:await hash(bytes),involved:base.involved,shape}));
 const clearSnapshot=await hash(JSON.stringify({snapshot,clears:clears.map(clear=>[clear.customerId,clear.version,clear.code])}));
 // «التاريخ» and the representative (lib/erp-customer-extras.ts): written on the customers the rows end on and on the ones they add.
 const extras=erpCustomerExtras(sheets,parsed.sheet),extraUpdates=(rows:typeof base.rows)=>erpExtraUpdates(rows,extras,customers,customer=>mayChange(c,customer));
 return {sheet:parsed.sheet,snapshot,clears,clearSnapshot,extras,extraUpdates,match:(choices:Map<number,string>)=>choices.size?expected(()=>matchErpCustomers(parsed.rows,c.all,{...options,choices})):base};
}
type Addition={row:number;customerId:string;code:string;name:string;region:string;internalCode?:string};
/** The Yourrest numbers the identity trigger gave the added customers, read after the commit (and again for a repeated request). */
async function withNumbers<T extends {additions?:Addition[]}>(c:Context,result:T):Promise<T>{
 if(!result.additions?.length)return result;
 const numbers=new Map((await c.db.prepare("SELECT customer_id AS id,printf('YR-C-%06d',number) AS internalCode FROM crm_customer_numbers WHERE customer_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(result.additions.map(addition=>addition.customerId))).all<{id:string;internalCode:string}>()).results.map(row=>[row.id,row.internalCode]));
 return {...result,additions:result.additions.map(addition=>({...addition,internalCode:numbers.get(addition.customerId)||''}))};
}

/** POST /api/erp-customers. `preview` writes nothing; `apply` re-reads the same file with the user's choices and writes, in one
 * transaction, the ERP code of every customer that changes, an explicit code mapping where the number is also held by another customer,
 * one audit entry per changed customer, and every new customer (the importing member responsible, the chosen region, an «إضافة» entry
 * each). Additions are opt-in: the apply carries `adds`, the number of new customers the preview showed. One without it (a screen loaded
 * before the deploy) is refused (409 ERP_SCREEN_OUTDATED), and one with another number (409 ERP_ADDS_UNCONFIRMED), before anything is
 * written. A repeated `requestId` returns the saved answer and adds nobody twice (the new customers' ids come from it).
 * The preview also lists `clears`, the customers of the importer's regions that the file does not name and that still carry an ERP code;
 * an apply with `clearCodes: true` (and the preview's `clearSnapshot`) sets their code to '' in the same transaction, each with an
 * 'erp-customer-code' audit entry {from, to: '', cleared: true}, and answers `cleared`. Without it (the box unchecked, or a screen loaded
 * before 2026-11-09) nobody's code is cleared. A cleared customer has no ERP code and is matched to no ERP document any more (its old code
 * is history, never a match: 2026-11-12). */
export async function importErpCustomers(c:Context,body:unknown){
 requireErpCustomersRole(c.me);
 const {input,bytes}=parseInput(body);
 if(input.action==='preview'){
  const prepared=await prepare(c,bytes),matched=prepared.match(choiceMap(input)),regions=erpNewCustomerRegions(c.me);
  const erpDates=erpDatesView(prepared.extras,prepared.extraUpdates(matched.rows));
  return {fileName:input.fileName,sheet:prepared.sheet,snapshot:prepared.snapshot,summary:matched.summary,rows:matched.rows,newRegions:regions.regions,newRegion:regions.default,
   clears:prepared.clears.map(({version,...clear}):ErpCustomerClearView=>{void version;return clear;}),clearSnapshot:prepared.clearSnapshot,erpDates};
 }
 if(!input.requestId||!input.snapshot)throw new CRMError('اعرض الملف أولًا قبل تحديث الأكواد');
 const choices=choiceMap(input),rowRegions=regionMap(input);
 const clearing=input.clearCodes===true,fingerprint=await hash(JSON.stringify({file:await hash(bytes),choices:[...choices].sort(([a],[b])=>a-b),region:input.region??null,regions:[...rowRegions].sort(([a],[b])=>a-b),...(clearing?{clear:true}:{})})),receipt='erp-customers:'+c.me.id+':'+input.requestId;
 const replay=async()=>{const row=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receipt).first<{detail:string}>();if(!row)return null;const saved=JSON.parse(row.detail) as {fingerprint:string;result:{additions?:Addition[]}&Record<string,unknown>};if(saved.fingerprint!==fingerprint)throw new CRMError('الطلب محفوظ ببيانات مختلفة. أجرِ معاينة جديدة.',409);return {...await withNumbers(c,saved.result),alreadySaved:true};};
 const prior=await replay();if(prior)return prior;
 if(input.adds===undefined)throw new CRMError(ERP_SCREEN_OUTDATED,409);
 const book=await prepare(c,bytes);
 if(book.snapshot!==input.snapshot)throw new CRMError(stale,409);
 if(clearing&&book.clearSnapshot!==input.clearSnapshot)throw new CRMError(stale,409);
 const clears=clearing?book.clears:[];
 const prepared={...book.match(choices),snapshot:book.snapshot};
 if(prepared.summary.conflicts)throw new CRMError('اخترت نفس العميل لأكثر من سطر؛ العميل له كود ERP واحد. راجع الاختيارات.');
 if(input.adds!==prepared.adds.length)throw new CRMError(ERP_ADDS_UNCONFIRMED,409);
 if(prepared.adds.length>ERP_CUSTOMERS_MAX_ADDS)throw new CRMError(`الحد الأقصى للعملاء الجدد في المرة الواحدة ${ERP_CUSTOMERS_MAX_ADDS}؛ اترك الباقي وأضفهم في مرة أخرى.`);
 const extraUpdates=book.extraUpdates(prepared.rows);
 if(!prepared.plan.length&&!prepared.adds.length&&!clears.length&&!extraUpdates.length)throw new CRMError('لا توجد أكواد تتغير ولا عملاء جدد في هذا الملف.');
 // The same checks as a customer edit, for every customer that changes; their SQL (member and record version) is the gate below. A member
 // limited to regions never moves a number's invoices away from a customer outside them (the preview already leaves those rows out).
 const customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row])),holders=customerCodeCandidates(c.all),mappings=new Map(c.customerIdentityState.mappings.map(mapping=>[mapping.codeKey,mapping]));
 for(const step of prepared.plan){
  const customer=customers.get(step.customerId)!;customerDetailMutationGuard({me:c.me,members:c.members,all:[customer]},customer);
  if(heldOutsideRegions(c.me,holders.get(step.codeKey)||[],mappings.get(step.codeKey),customers))throw new CRMError(`الرقم ${step.to} عند عميل خارج مناطقك؛ ربطه لمدير النظام.`,403);
 }
 // A cleared code: the same check as a code change (prepare listed only these). A cleared customer is not an ERP customer (the owner,
 // 2026-11-12: «متديلهمش كود erp يعنى يبقى فاضى لان العميل ده مش موجود فى erp اصلا»): its code is '' and it matches nothing from then on
 // (lib/customer-identity.ts reads current codes only), so the number's invoices, quotations and last purchase belong to the customer that
 // carries it now, or to nobody. The identity trigger still keeps the old code in crm_customer_code_aliases, as history only, and a stored
 // mapping of it stays in its table, ignored while the customer does not carry the code.
 for(const clear of clears){const customer=customers.get(clear.customerId)!;customerDetailMutationGuard({me:c.me,members:c.members,all:[customer]},customer);}
 // New customers: the region chosen for them (or for one row), checked like the form's; their data as the form builds it.
 const addRows=new Set(prepared.adds.map(add=>add.row)),fallback=erpNewCustomerRegions(c.me).default;
 for(const [row] of rowRegions)if(!addRows.has(row))throw new CRMError(`السطر ${row} ليس عميلًا جديدًا؛ أجرِ معاينة جديدة`);
 for(const region of [...(input.region===undefined?[]:[input.region]),...rowRegions.values()])checkRegion(c.me,region);
 const additions=prepared.adds.map(add=>{
  const region=rowRegions.get(add.row)??input.region??fallback;
  if(region===null)throw new CRMError('لا يمكنك إنشاء أو نقل عميل خارج منطقتك المسموح بها',403);
  checkRegion(c.me,region);
  return {add,id:'crm-'+c.me.id+'-erp-'+input.requestId+'-'+add.row,region,data:{...newCustomerData(c.me,add,region),...erpExtraData(book.extras.rows.get(add.row))}};
 });
 const now=new Date().toISOString(),attempt='erp-customers-import:'+crypto.randomUUID();
 const result={ok:true,updated:prepared.summary.codeChanges,mappings:prepared.summary.mappings,changed:prepared.plan.length,added:additions.length,unchanged:prepared.rows.filter(row=>row.customerId&&!row.change).length,skipped:prepared.rows.filter(row=>!row.customerId&&!row.add&&['auto','same','choose','similar','new'].includes(row.status)).length,cleared:clears.length,erpDatesUpdated:extraUpdates.length,outOfRegion:prepared.summary.outOfRegion,heldOutside:prepared.summary.heldOutside,invalid:prepared.summary.invalid,changes:prepared.plan.map(step=>({row:step.row,customerId:step.customerId,from:step.from,to:step.to,mapping:step.mapping})),additions:additions.map(({add,id,region,data}):Addition=>({row:add.row,customerId:id,code:add.code,name:String(data.name),region}))};
 // The receipt is the transaction's gate: the member's role and regions, the identity revision (every code and mapping change moves it,
 // and so does adding or deleting a customer), every involved customer's version, in one JSON parameter; and for the new customers,
 // that no record has their ids and that no customer carries their codes now (a code another customer only had before, or a mapping to a
 // customer that no longer carries it, is nobody's). Every later write requires this attempt's own receipt.
 const guard=accessGuard(c);
 let gate=guard.sql+" AND EXISTS(SELECT 1 FROM crm_customer_identity_state WHERE id='company' AND revision=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) AS expected LEFT JOIN crm_records AS actual ON actual.id=json_extract(expected.value,'$[0]') WHERE actual.id IS NULL OR actual.kind IS NOT 'customer' OR actual.version IS NOT json_extract(expected.value,'$[1]'))";
 const gateArgs:(string|number)[]=[...guard.args,c.customerIdentityState.revision,JSON.stringify([...prepared.involved,...clears.map(clear=>[clear.customerId,clear.version])])];
 if(additions.length){
  const ids=JSON.stringify(additions.map(addition=>addition.id)),codes=JSON.stringify(additions.map(addition=>addition.add.codeKey));
  gate+=" AND NOT EXISTS(SELECT 1 FROM crm_records WHERE id IN (SELECT value FROM json_each(?))) AND NOT EXISTS(SELECT 1 FROM crm_records WHERE kind='customer' AND upper(trim(CAST(json_extract(data,'$.code') AS TEXT))) IN (SELECT value FROM json_each(?)))";
  gateArgs.push(ids,codes);
 }
 const claimed='EXISTS(SELECT 1 FROM crm_audit WHERE id=? AND record_id=?)',claimArgs=[receipt,attempt];
 const batch:D1PreparedStatement[]=[c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+gate).bind(receipt,attempt,c.me.name,'erp-customers-receipt',JSON.stringify({fingerprint,result}),now,...gateArgs)];
 // Only the code changes; from now on the customer is matched by its new code only (the identity trigger keeps the old one as history).
 for(const step of prepared.plan)if(step.codeChange)batch.push(c.db.prepare("UPDATE crm_records SET data=json_set(data,'$.code',?),updated_at=?,version=version+1,mutation_id=? WHERE id=? AND kind='customer' AND version=? AND "+claimed).bind(step.to,now,attempt,step.customerId,step.version,...claimArgs));
 for(const step of prepared.plan)if(step.mapping)batch.push(step.mappingVersion?c.db.prepare('UPDATE crm_customer_code_mappings SET customer_id=?,version=version+1,updated_by=?,updated_at=? WHERE code_key=? AND version=? AND '+claimed).bind(step.customerId,c.me.id,now,step.codeKey,step.mappingVersion,...claimArgs):c.db.prepare('INSERT INTO crm_customer_code_mappings(code_key,customer_id,version,updated_by,updated_at) SELECT ?,?,1,?,? WHERE '+claimed).bind(step.codeKey,step.customerId,c.me.id,now,...claimArgs));
 // A cleared code: '' (the customer's code field empty, as the form saves it), its version moved; it matches nothing any more.
 for(const clear of clears)batch.push(c.db.prepare("UPDATE crm_records SET data=json_set(data,'$.code',''),updated_at=?,version=version+1,mutation_id=? WHERE id=? AND kind='customer' AND version=? AND "+claimed).bind(now,attempt,clear.customerId,clear.version,...claimArgs));
 // A new customer as the form inserts one; the identity trigger gives it its Yourrest number and keeps its code.
 for(const {id,data} of additions)batch.push(c.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'customer',NULL,?,?,?,?,?,1,? WHERE "+claimed).bind(id,c.me.id,c.me.branch,JSON.stringify(data),now,now,attempt,...claimArgs));
 for(const step of prepared.plan)batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(crypto.randomUUID(),step.customerId,c.me.name,'erp-customer-code',JSON.stringify({label:'تحديث كود ERP من ملف ERP',from:step.from,to:step.to,row:step.row,...(step.mapping?{mapping:true}:{})}),now,...claimArgs));
 for(const clear of clears)batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(crypto.randomUUID(),clear.customerId,c.me.name,'erp-customer-code',JSON.stringify({label:ERP_CLEAR_AUDIT_LABEL,from:clear.code,to:'',cleared:true}),now,...claimArgs));
 batch.push(...erpExtraStatements(c.db,extraUpdates,c.me.name,now,attempt,claimed,claimArgs));
 for(const {id,data} of additions)batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(crypto.randomUUID(),id,c.me.name,'إضافة',String(data.name)+' • '+ERP_ADD_AUDIT_LABEL,now,...claimArgs));
 let committed;try{committed=await c.db.batch(batch);}catch(error){const saved=await replay();if(saved)return saved;throw error;}
 if(committed[0].meta.changes!==1){const saved=await replay();if(saved)return saved;throw new CRMError(stale,409);}
 return withNumbers(c,result);
}

// «استيراد عروض الأسعار من ERP» (POST /api/erp-quotes, app/erp-quotes-import.tsx ErpQuotesImport): the preview, then the import in one transaction.
// Where and who (the owner, 2026-11-11: the uploads together on the targets page): the button sits beside «استيراد مبيعات ERP» in
// app/sales-workspace.tsx; whoever may import ERP sales AND add a quotation (the administrator, a sales manager or a supervisor, with
// «استيراد» on «المبيعات» and «إضافة» on «عروض الأسعار»), within their team and regions: the representatives they may assign (as the ERP sales import), the
// customers of their regions, and the imported quotes they may edit.
// What: each ERP quotation is ONE CRM quote record (kind 'quote') directly under its customer (found by its ERP code, never created),
// assigned to the representative its ERP employee is mapped to, in the customer's branch, its number the ERP's (Code), status «مرسل»,
// marked `_erp` (the ERP's identity of it, who imported it and when, the ERP's figures). The ERP number is the key: the same file again
// changes nothing; a newer export updates the same record (one «تعديل» history line on it, its before and after in the import's line);
// a quote edited by hand in the CRM since the import is left as it is; nothing is deleted. One audit line for each import with its counts.
// The employee mapping is the ERP sales import's (crm_erp_employee_mappings, by the ERP employee code): a saved mapping is used as it is
// (changed only from the sales import), an unmapped employee is matched by a unique full name or chosen here, and the choice is saved
// with the import (the shared revision moves, as the sales import moves it).
// «مبيعات مكتب» (the employee's name, lib/erp-sales.ts isOfficeEmployee, as the ERP sales import): another company's quotations, excluded
// before anything else (status 'excluded', counted under «مستبعدة»): never written, never needing a customer or a mapping, never listed
// among the employees to map. Neither they nor a refused quotation keep the others from being imported.
// A customer code that two or more CRM customers carry as their CURRENT code (lib/customer-identity.ts customerCodeCandidates; a code a
// customer only had before, or one an ERP customers import cleared, makes no customer a candidate since 2026-11-12) is refused until a «ربط كود
// عميل ERP» decides it (crm_customer_code_mappings, the same mapping the KPI invoices and the last purchase read). The preview lists those
// codes (`sharedCodes`): to the administrator who may map identities (lib/customer-identity-server.ts isIdentityAdmin) with exactly the
// customers that carry the code and the saved choice, which the dialog saves through POST /api/customer-identities (saveCustomerIdentity:
// its checks, versions, audit and request id unchanged) and then previews again; to anyone else only the code and its count, never the
// customers. The mapping is saved on its own, never with the import: it is global, and a saved one moves the import state's revision, so a
// preview made before it cannot be committed (409).
// «مبيعات مكتب (مستبعد)» for a person (lib/erp-office-employees.ts, 2026-11-12): an employee code marked so (from either import) has its
// quotations excluded the same way (counted under «مستبعدة», never written); the employee is listed with the choice selected and, as a
// saved representative mapping, changed from the sales import only. An unmapped employee may be marked here (or suggested by a name mark
// of the collection statement): the mark is saved with the import, under the same claim, its row unchanged since the preview.
// The preview is stateless and signed (15 minutes); the import recomputes it and refuses (409) when anything it showed has changed; a
// request id makes a retried import return its first answer without writing twice.
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {context,CRMError,accessGuard,requireSalesWorkspace,requirePages,requireCell} from './crm-server';
import {salesMemberIds} from './sales';
import {regionScope,memberCanAccessRegion} from './regions';
import {type Member} from './crm';
import {uniqueCustomerCodes,customerCodeCandidates,customerCodeKey} from './customer-identity';
import {isIdentityAdmin} from './customer-identity-server';
import {isOfficeEmployee} from './erp-sales';
import {readErpQuotesTable,parseErpQuotes,planErpQuotes,employeeKey,sha256,ErpQuotesError,ERP_QUOTES_MAX_BYTES,ERP_QUOTE_REASONS,type ErpQuotePlanEntry,type ErpQuotesFile} from './erp-quotes';
import {ERP_OFFICE_CHOICE,ERP_OFFICE_SETTING,ERP_OFFICE_AUDIT_ACTION,officeById,officeNameOnly,applyOfficeChanges,readOfficeRow,officeUnchanged,writeOfficeList} from './erp-office-employees';

type Context=Awaited<ReturnType<typeof context>>;
const namespace='yourrest-industries';
const normalize=(value:string)=>value.normalize('NFKC').replace(/[​-‏‪-‮⁦-⁩﻿]/g,'').replace(/\s+/g,' ').trim();
const nameKey=(value:string)=>normalize(value).toLowerCase();
const mappingSchema=z.object({employeeId:z.string().trim().min(1).max(100),repId:z.string().trim().min(1).max(200)}).strict();
const inputSchema=z.object({action:z.enum(['preview','commit']),fileName:z.string().trim().min(1).max(255),base64:z.string().min(1).max(Math.ceil(ERP_QUOTES_MAX_BYTES/3)*4),employeeMappings:z.array(mappingSchema).max(500).default([]),previewToken:z.string().max(1024).optional(),requestId:z.string().uuid().optional()}).strict();
type Input=z.infer<typeof inputSchema>;
/** The audit line of an import (one per import, its record the import's id: never shown with a record's history). */
export const ERP_QUOTES_AUDIT_ACTION='استيراد عروض أسعار ERP';
const ADD_LABEL='إضافة عرض سعر من ملف ERP',UPDATE_LABEL='تحديث من ملف ERP';

/** Whoever may import ERP sales (the targets page, beside «استيراد مبيعات ERP»: the role, «المبيعات» not hidden, «استيراد» on) AND may
 *  add a quotation («عروض الأسعار» not hidden, «إضافة» on): the role first (403), a hidden screen 404, a cell switched off 403. */
export function requireErpQuotesImport(me:Member){requireSalesWorkspace(me);requirePages(me,'sales');requirePages(me,'quote');requireCell(me,'sales','import');requireCell(me,'quote','add');}
function eligible(c:Context){const ids=salesMemberIds(c.members,c.me);return c.regionalMembers.filter(m=>m.role==='rep'&&m.active&&ids.has(m.id));}
const snapshot=(m:Member)=>[m.id,m.role,m.branch,m.supervisorId||'',regionScope(m),m.active,m.authVersion||0];
async function state(c:Context){
 const revision=await c.db.prepare('SELECT revision FROM crm_erp_import_state WHERE id=?').bind(namespace).first<{revision:number}>();
 if(!revision)throw new CRMError('تحديث قاعدة بيانات استيراد ERP غير مكتمل.',503);
 const employees=(await c.db.prepare('SELECT employee_id AS employeeId,rep_id AS repId FROM crm_erp_employee_mappings ORDER BY employee_id').all<{employeeId:string;repId:string}>()).results;
 return {revision:revision.revision,employees,office:await readOfficeRow(c.db)};
}
export async function erpQuotesConfiguration(c:Context){
 requireErpQuotesImport(c.me);const members=eligible(c),ids=new Set(members.map(m=>m.id)),saved=await state(c);
 const office=[...officeById(saved.office.list).values()].map(e=>({employeeId:employeeKey(e.employeeId),repId:ERP_OFFICE_CHOICE}));
 return {members:members.map(m=>({id:m.id,name:m.name,branch:m.branch})),employeeMappings:[...saved.employees.filter(m=>ids.has(m.repId)),...office]};
}
async function signature(value:string){
 if(!/^[a-f0-9]{64,}$/i.test(env.YR_AUTH_SECRET||''))throw new CRMError('خدمة الاستيراد غير مهيأة. تواصل مع مدير النظام.',503);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.YR_AUTH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('yourrest-erp-quotes-preview:'+value))),b=>b.toString(16).padStart(2,'0')).join('');
}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let difference=0;for(let n=0;n<a.length;n++)difference|=a.charCodeAt(n)^b.charCodeAt(n);return difference===0;}
function parseInput(body:unknown){
 const input=inputSchema.parse(body);
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw new CRMError('ترميز ملف عروض الأسعار غير صحيح');
 const raw=atob(input.base64);if(raw.length>ERP_QUOTES_MAX_BYTES)throw new CRMError('أقصى حجم لملف عروض الأسعار 5 ميجابايت',413);
 if(!/\.(xls|xlsx|html?)$/i.test(input.fileName))throw new CRMError('اختر تقرير عروض الأسعار من ERP بصيغة .xls أو .xlsx');
 return {input,bytes:Uint8Array.from(raw,ch=>ch.charCodeAt(0))};
}
const canonicalInput=(input:Input)=>JSON.stringify({fileName:input.fileName,base64:input.base64,employeeMappings:[...input.employeeMappings].map(m=>[employeeKey(m.employeeId),m.repId]).sort((a,b)=>a[0].localeCompare(b[0],'en'))});

type MappingSource='saved'|'selected'|'name'|'unmapped';
const SAVED_ELSEWHERE='ربط هذا الموظف محفوظ من استيراد مبيعات ERP؛ يُعدَّل من شاشة استيراد المبيعات';
async function prepare(c:Context,input:Input,bytes:Uint8Array){
 let file:ErpQuotesFile;
 try{file=parseErpQuotes(readErpQuotesTable(bytes));}catch(error){if(error instanceof ErpQuotesError)throw new CRMError(error.message);throw error;}
 const saved=await state(c),members=eligible(c),allowed=new Map(members.map(m=>[m.id,m]));
 const employeeReps=new Map<string,string>(),sources=new Map<string,MappingSource>();
 for(const m of saved.employees){employeeReps.set(employeeKey(m.employeeId),m.repId);sources.set(employeeKey(m.employeeId),'saved');}
 // «مبيعات مكتب (مستبعد)»: a saved mark wins over a representative mapping (the sales import removes that mapping when it marks).
 const savedOffice=officeById(saved.office.list),officeNames=officeNameOnly(saved.office.list),office=new Map<string,MappingSource>();
 for(const key of savedOffice.keys()){office.set(key,'saved');employeeReps.delete(key);sources.delete(key);}
 const fileEmployees=new Map<string,Set<string>>();
 for(const q of file.quotations){if(isOfficeEmployee(q.employeeName))continue;const id=employeeKey(q.employeeCode);if(!id)continue;const names=fileEmployees.get(id)||new Set<string>();names.add(nameKey(q.employeeName));fileEmployees.set(id,names);}
 const seen=new Set<string>();
 for(const choice of input.employeeMappings){
  const id=employeeKey(choice.employeeId);
  if(seen.has(id))throw new CRMError('تكرار في اختيارات الربط؛ حدّث المعاينة');seen.add(id);
  if(!fileEmployees.has(id))continue;
  const prior=employeeReps.get(id);
  if(prior&&sources.get(id)==='saved'){if(prior!==choice.repId)throw new CRMError(SAVED_ELSEWHERE,409);continue;}
  if(office.get(id)==='saved'){if(choice.repId!==ERP_OFFICE_CHOICE)throw new CRMError(SAVED_ELSEWHERE,409);continue;}
  if(choice.repId===ERP_OFFICE_CHOICE){office.set(id,'selected');continue;}
  if(!allowed.has(choice.repId))throw new CRMError('ربط الموظف خارج نطاق فريقك أو منطقتك',403);
  employeeReps.set(id,choice.repId);sources.set(id,'selected');
 }
 // A unique full name among every representative (hidden or inactive ones included, so a namesake keeps it ambiguous), as the sales import.
 const roster=c.members.filter(m=>m.role==='rep'),byName=new Map<string,Member[]>();
 for(const m of roster){const k=nameKey(m.name);if(k)byName.set(k,[...(byName.get(k)||[]),m]);}
 let nameRoster:unknown[]|null=null;
 for(const [id,names] of fileEmployees){
  if(employeeReps.has(id)||office.has(id)||names.size!==1)continue;
  const name=[...names][0];if(!name)continue;
  if(officeNames.has(name)){office.set(id,'name');continue;}
  nameRoster=roster.map(snapshot).sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'en'));
  const matches=byName.get(name)||[];
  if(matches.length===1&&allowed.has(matches[0].id)){employeeReps.set(id,matches[0].id);sources.set(id,'name');}
 }
 const editable=new Set(c.visible.filter(r=>!r.data?._teamReadOnly).map(r=>r.id));
 const now=new Date().toISOString(),importId='erp-quotes-import-'+(input.requestId||'preview');
 const plan=await planErpQuotes({file,records:c.all,visibleIds:editable,codes:uniqueCustomerCodes(c.all,c.customerIdentityState?.mappings),employeeReps,eligible:allowed,officeEmployees:new Set(office.keys()),customerInRegion:customer=>memberCanAccessRegion(c.me,customer.data?.region),importer:{id:c.me.id,name:c.me.name},now,importId,fileName:input.fileName});
 // A mapping chosen or matched by name is saved only for an employee whose quotations the import takes (or found already there).
 const used=new Set(plan.filter(p=>!['refused','excluded'].includes(p.status)).map(p=>employeeKey(p.employeeCode)));
 const employees=[...fileEmployees.keys()].sort((a,b)=>a.localeCompare(b,'en')).map(id=>{
  const repId=employeeReps.get(id)||'',quotations=file.quotations.filter(q=>!isOfficeEmployee(q.employeeName)&&employeeKey(q.employeeCode)===id);
  const officeSource=office.get(id);
  if(officeSource)return {employeeId:id,employeeName:quotations[0]?.employeeName||'',quotations:quotations.length,repId:ERP_OFFICE_CHOICE,savedOutside:false,mappingSource:officeSource,office:true};
  return {employeeId:id,employeeName:quotations[0]?.employeeName||'',quotations:quotations.length,repId:allowed.has(repId)?repId:'',savedOutside:!!repId&&!allowed.has(repId),mappingSource:(allowed.has(repId)?sources.get(id)||'unmapped':'unmapped') as MappingSource};
 });
 const missing=new Map<string,{customerCode:string;customerName:string;quotations:number}>();
 for(const p of plan)if(p.status==='refused'&&p.reason===ERP_QUOTE_REASONS.noCustomer){const k=p.customerCode;const item=missing.get(k)||{customerCode:p.customerCode,customerName:p.customerName,quotations:0};item.quotations++;missing.set(k,item);}
 const count=(status:string)=>plan.filter(p=>p.status===status).length;
 // The marks this import saves: chosen here or suggested by name, for an employee of the file.
 const newOffice=[...office].filter(([id,source])=>source!=='saved'&&fileEmployees.has(id)).map(([id])=>({employeeId:id,employeeName:file.quotations.find(q=>employeeKey(q.employeeCode)===id)?.employeeName||''}));
 const summary={...(newOffice.length?{officeMarks:newOffice.length}:{}),quotations:plan.length,lines:file.quotations.reduce((s,q)=>s+q.lines.length,0),newCount:count('new'),updateCount:count('update'),unchangedCount:count('unchanged'),editedCount:count('edited'),excludedCount:count('excluded'),refusedCount:count('refused')+file.problems.length,rowProblems:file.problems.length,deletedRows:file.deletedRows,totalsDiffer:plan.filter(p=>p.status!=='refused'&&p.totalsDiffer).length};
 const reps=new Map<string,Member>();for(const p of plan)if(['new','update'].includes(p.status)){const rep=allowed.get(p.repId);if(rep)reps.set(rep.id,rep);}
 const newMappings=[...employeeReps].filter(([id])=>['selected','name'].includes(sources.get(id)||'')&&used.has(id)&&allowed.has(employeeReps.get(id)!)).map(([employeeId,repId])=>({employeeId,repId}));
 const snapshotHash=await sha256(JSON.stringify({me:snapshot(c.me),members:members.map(snapshot).sort(),nameRoster,plan:plan.map(p=>[p.key,p.status,p.recordId,p.version,p.customerId,p.repId,p.branch]),newMappings,newOffice,office:saved.office.raw}));
 return {file,plan,summary,employees,missing:[...missing.values()],sharedCodes:sharedCodes(c,file,plan),snapshotHash,saved,reps,newMappings,newOffice,nameRoster};
}
/** The customer codes of the file that two or more CRM customers carry, with how many of its quotations name each (excluded quotations and
 *  those the reader could not read left out): 'ambiguous' (refused until mapped) or 'mapped' (a saved mapping chose one of them). To the
 *  administrator who may map identities: every such code, its candidates (exactly the customers that carry it) and the saved choice and
 *  version; to anyone else only the codes still ambiguous, never a customer. */
function sharedCodes(c:Context,file:ErpQuotesFile,plan:ErpQuotePlanEntry[]){
 const candidates=customerCodeCandidates(c.all),admin=isIdentityAdmin(c),state=c.customerIdentityState,mappings=new Map(state.mappings.map(m=>[m.codeKey,m]));
 const codes=new Map<string,{customerCode:string;quotations:number}>();
 file.quotations.forEach((q,index)=>{
  if(plan[index]?.status==='excluded'||q.problem)return;
  const codeKey=customerCodeKey(q.customerCode);if((candidates.get(codeKey)||[]).length<2)return;
  const item=codes.get(codeKey)||{customerCode:q.customerCode,quotations:0};item.quotations++;codes.set(codeKey,item);
 });
 const out=[...codes].sort(([a],[b])=>a.localeCompare(b,'en')).map(([codeKey,item])=>{
  const rows=candidates.get(codeKey)!,mapping=mappings.get(codeKey),chosen=mapping&&rows.some(r=>r.id===mapping.customerId)?mapping.customerId:'';
  const status:'mapped'|'ambiguous'=chosen?'mapped':'ambiguous';
  if(!admin)return {codeKey,customerCode:item.customerCode,quotations:item.quotations,status};
  return {codeKey,customerCode:item.customerCode,quotations:item.quotations,status,mappedCustomerId:chosen,mappingVersion:mapping?.version||0,
   candidates:rows.map(r=>({id:r.id,name:String(r.data?.name||''),internalCode:String(r.data?.internalCode||''),region:String(r.data?.region||''),branch:String(r.branch||''),version:r.version}))
    .sort((a,b)=>a.name.localeCompare(b.name,'ar')||a.internalCode.localeCompare(b.internalCode,'en')||a.id.localeCompare(b.id,'en'))};
 });
 return {canMap:admin,revision:admin?state.revision:0,codes:admin?out:out.filter(code=>code.status==='ambiguous')};
}
function previewEntry(p:ErpQuotePlanEntry){return {key:p.key,code:p.code,rows:p.rows,date:p.date,customerCode:p.customerCode,customerCodeKey:customerCodeKey(p.customerCode),customerName:p.customerLabel||p.customerName,lineCount:p.lineCount,totalCents:p.totalCents,status:p.status,reason:p.reason,employeeCode:p.employeeCode,employeeName:p.employeeName,repName:p.repName,totalsDiffer:p.totalsDiffer,recordId:['new','refused','excluded'].includes(p.status)?'':p.recordId};}
const money=(value:unknown)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0);
const changeLine=(p:ErpQuotePlanEntry)=>{const before=p.before||{},after=p.data||{},items=(v:unknown)=>Array.isArray(v)?v.length:0;return `${p.code} • ${UPDATE_LABEL}: الإجمالي ${money(before.total)} ← ${money(after.total)} ر.س، البنود ${items(before.items)} ← ${items(after.items)}`;};

/** Preview (nothing written) and import (one transaction). */
export async function importErpQuotes(c:Context,body:unknown){
 requireErpQuotesImport(c.me);
 const {input,bytes}=parseInput(body),fingerprint=await sha256(c.me.id+':'+canonicalInput(input));
 const id='erp-quotes-import-'+(input.requestId||'');
 const replay=async()=>{
  if(input.action!=='commit'||!input.requestId)return null;
  const row=await c.db.prepare('SELECT actor_id,fingerprint,result FROM crm_erp_imports WHERE id=?').bind(id).first<{actor_id:string;fingerprint:string;result:string}>();
  if(!row)return null;if(row.actor_id!==c.me.id)throw new CRMError('طلب الاستيراد غير متاح',404);
  if(row.fingerprint!==fingerprint)throw new CRMError('حُفظ الطلب ببيانات مختلفة؛ ارفع الملف للمعاينة من جديد',409);
  return {...JSON.parse(row.result),alreadySaved:true};
 };
 const prior=await replay();if(prior)return prior;
 const prepared=await prepare(c,input,bytes);
 if(input.action==='preview'){
  const payload=['1',String(Date.now()+15*60_000),fingerprint,prepared.snapshotHash].join('.');
  return {previewToken:payload+'.'+await signature(payload),quotations:prepared.plan.map(previewEntry),rowProblems:prepared.file.problems,employees:prepared.employees,missingCustomers:prepared.missing,sharedCodes:prepared.sharedCodes,summary:prepared.summary};
 }
 if(!input.requestId||!input.previewToken)throw new CRMError('اعرض الملف أولًا قبل تأكيد الاستيراد');
 const pieces=input.previewToken.split('.');
 if(pieces.length!==5||pieces[0]!=='1'||!/^\d{13}$/.test(pieces[1])||!pieces.slice(2).every(v=>/^[a-f0-9]{64}$/.test(v)))throw new CRMError('معاينة الملف غير صحيحة؛ اعرضه مرة أخرى',409);
 if(!safeEqual(await signature(pieces.slice(0,4).join('.')),pieces[4])||pieces[2]!==fingerprint)throw new CRMError('تغيّر الملف أو اختيارات الربط؛ اعرضه مرة أخرى',409);
 if(Number(pieces[1])<Date.now()||Number(pieces[1])>Date.now()+16*60_000||pieces[3]!==prepared.snapshotHash)throw new CRMError('انتهت المعاينة أو تغيّرت البيانات أو الصلاحيات منذ عرضها؛ اعرض الملف مرة أخرى',409);
 const fresh=prepared.plan.filter(p=>p.status==='new'),updates=prepared.plan.filter(p=>p.status==='update');
 const now=new Date().toISOString(),s=prepared.summary;
 const result={ok:true,importId:id,addedCount:fresh.length,updatedCount:updates.length,unchangedCount:s.unchangedCount,editedCount:s.editedCount,excludedCount:s.excludedCount,refusedCount:s.refusedCount,mappingsSaved:prepared.newMappings.length,...(prepared.newOffice.length?{officeMarked:prepared.newOffice.length}:{})};
 // The claim is the transaction's gate: every later statement requires it. The member and their permissions, the ERP mapping state, the
 // representatives assigned, the quotes updated (their versions) and the ids added (still absent) are as the plan read them.
 const guard=accessGuard(c);
 const officeGate=officeUnchanged(prepared.saved.office.raw);
 let gate=guard.sql+' AND EXISTS(SELECT 1 FROM crm_erp_import_state WHERE id=? AND revision=?) AND '+officeGate.sql;
 const args:(string|number|null)[]=[...guard.args,namespace,prepared.saved.revision,...officeGate.args];
 gate+=` AND NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN crm_members actual ON actual.id=json_extract(expected.value,'$[0]') WHERE actual.id IS NULL OR actual.role IS NOT json_extract(expected.value,'$[1]') OR actual.branch IS NOT json_extract(expected.value,'$[2]') OR COALESCE(actual.supervisor_id,'') IS NOT json_extract(expected.value,'$[3]') OR actual.region_scope IS NOT json_extract(expected.value,'$[4]') OR actual.active IS NOT json_extract(expected.value,'$[5]') OR actual.auth_version IS NOT json_extract(expected.value,'$[6]'))`;
 args.push(JSON.stringify([...prepared.reps.values()].map(snapshot)));
 if(prepared.nameRoster){gate+=" AND (SELECT COUNT(*) FROM crm_members WHERE role='rep')=?";args.push(prepared.nameRoster.length);}
 gate+=` AND NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN crm_records actual ON actual.id=json_extract(expected.value,'$[0]') WHERE actual.id IS NULL OR actual.version IS NOT json_extract(expected.value,'$[1]'))`;
 args.push(JSON.stringify(updates.map(p=>[p.recordId,p.version])));
 gate+=' AND NOT EXISTS(SELECT 1 FROM crm_records WHERE id IN (SELECT value FROM json_each(?)))';
 args.push(JSON.stringify(fresh.map(p=>p.recordId)));
 gate+=` AND NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN crm_records actual ON actual.id=json_extract(expected.value,'$[0]') AND actual.kind='customer' WHERE actual.id IS NULL OR actual.branch IS NOT json_extract(expected.value,'$[1]'))`;
 args.push(JSON.stringify([...new Map([...fresh,...updates].map(p=>[p.customerId,[p.customerId,p.branch]])).values()]));
 const detail={fileName:input.fileName,...result,quotations:s.quotations,lines:s.lines,changes:updates.map(p=>({recordId:p.recordId,number:p.code,before:p.before,after:Object.fromEntries(Object.keys(p.before||{}).map(k=>[k,k==='repId'?p.repId:p.data![k]]))}))};
 const batch:D1PreparedStatement[]=[c.db.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) SELECT ?,?,?,?,?,? WHERE '+gate).bind(id,c.me.id,fingerprint,input.fileName,JSON.stringify(result),now,...args)];
 const claimed='EXISTS(SELECT 1 FROM crm_erp_imports WHERE id=? AND actor_id=? AND fingerprint=?)',claimArgs=[id,c.me.id,fingerprint];
 for(const p of fresh){
  batch.push(c.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,?,?,?,?,?,?,?,1,? WHERE '+claimed).bind(p.recordId,'quote',p.customerId,p.repId,p.branch,JSON.stringify(p.data),now,now,id,...claimArgs));
  batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(crypto.randomUUID(),p.recordId,c.me.name,'إضافة',p.code+' • '+ADD_LABEL,now,...claimArgs));
 }
 for(const p of updates){
  batch.push(c.db.prepare('UPDATE crm_records SET data=?,assigned_to=?,branch=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND parent_id=? AND '+claimed).bind(JSON.stringify(p.data),p.repId,p.branch,now,id,p.recordId,p.version,p.customerId,...claimArgs));
  batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(crypto.randomUUID(),p.recordId,c.me.name,'تعديل',changeLine(p),now,...claimArgs));
 }
 for(const m of prepared.newMappings)batch.push(c.db.prepare('INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) SELECT ?,?,?,? WHERE '+claimed+' ON CONFLICT(employee_id) DO NOTHING').bind(m.employeeId,m.repId,c.me.id,now,...claimArgs));
 if(prepared.newMappings.length)batch.push(c.db.prepare('UPDATE crm_erp_import_state SET revision=revision+1 WHERE id=? AND '+claimed).bind(namespace,...claimArgs));
 if(prepared.newOffice.length){
  batch.push(writeOfficeList(c.db,applyOfficeChanges(prepared.saved.office.list,{markIds:prepared.newOffice},c.me.id,now),claimed,claimArgs));
  batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(id+':office',ERP_OFFICE_SETTING,c.me.name,ERP_OFFICE_AUDIT_ACTION,JSON.stringify({source:'erp-quotes-import',importId:id,fileName:input.fileName,marked:prepared.newOffice,unmarked:[]}),now,...claimArgs));
 }
 batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(id,id,c.me.name,ERP_QUOTES_AUDIT_ACTION,JSON.stringify(detail),now,...claimArgs));
 let committed;
 try{committed=await c.db.batch(batch);}catch(error){const saved=await replay();if(saved)return saved;throw error;}
 if(committed[0].meta.changes!==1){const saved=await replay();if(saved)return saved;throw new CRMError('تغيّرت البيانات أو الصلاحيات أثناء الحفظ؛ اعرض الملف مرة أخرى',409);}
 return result;
}

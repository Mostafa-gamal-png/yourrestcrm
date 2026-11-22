// «استيراد المستهدفات والمتابعات من قوالب Excel» (the owner, 2026-11-16, item 8 of the GSCO comparison list; the rules of each kind in
// lib/record-import.ts). GET /api/record-import gives the template, filled with what the reader may import (their people and the month's
import {LOSS_MESSAGES,lossDetailProblem} from './loss-reason-other';
// targets in force; their customers whose follow-up is open); POST reads the uploaded file on the server (lib/erp-sales.ts readWorkbookSheets)
// and either previews it (writes nothing) or imports it.
// - Rights: the targets as editing them on the targets page (the administrator or a sales manager, «تحرير» on «المستهدفات وتقييم الأداء»,
//   their team and regions, a finished month for the administrator only: lib/targets-server.ts saveTargetSet); the follow-ups as recording one
//   («إضافة» on «المتابعات», a sales member, a customer they see, an open follow-up line: app/api/customer-followups/route.ts). Nothing is ever
//   written for a member or a customer outside the importer's own scope.
// - A row with a problem is left out and named by its Excel row with the reason; the rows that pass are written together in ONE transaction,
//   all or nothing: the import's audit line is written first under every condition the preview read (each target set's version and source,
//   each customer's and follow-up line's version, each member as they were, the importer's own rights), and every write is gated on it.
// - Repeats: the same request (its requestId) returns its first answer and writes nothing again; the same file again finds every target as
//   the file says («بلا تغيير») and every follow-up already imported (each one's record id is made from what the row says), so a second run
//   writes nothing. A follow-up changed in the file is a new follow-up (the import adds, it never edits a saved one).
// - Audit: the import's own line («استيراد المستهدفات من Excel» / «استيراد المتابعات من Excel», the file's name and SHA-256, the counts and
//   each row's status), each target set's line of «سجل التعديلات» (before and after), and each follow-up's «تسجيل متابعة».
import {z} from 'zod';
import {context,CRMError,accessGuard,requirePages,requireCell,requireSalesRole} from './crm-server';
import {today,scopeRecords,type Member,type Row} from './crm';
import {regionScope} from './regions';
import {isFieldRole} from './roles';
import {salesReadMemberIds} from './sales';
import {salesScopeMemberIds,recordAuthorId} from './access';
import {activeServiceCase} from './customer-service';
import {targetProducts,activityFields,quantityTargetsSchema,activityTargetsSchema,targetMonthClosed,CLOSED_MONTH_MESSAGE,riyadhMonth,roleOutOfEvaluation,SALES_MANAGER_ACTIVITY_MESSAGE,SALES_MANAGER_ACTIVITY_ENGLISH,type QuantityTargets,type ActivityTargets} from './targets';
import {customerFollowupSchema,customerHasQuotation,latestCustomerContact,followupClosed,canExecuteCustomerFollowup} from './customer-followups';
import {customerPlanSource,customerPlanSources,visitRequest} from './customer-visits';
import {readRecontact,RECONTACT_MESSAGES} from './followup-recontact';
import {memberSnapshot,memberSnapshotsGate} from './kpi-evidence-server';
import {readWorkbookSheets,ErpWorkbookError} from './erp-sales';
import {xlsxWorkbook} from './xlsx-write';
import {RECORD_IMPORT_MAX_BYTES,RECORD_IMPORT_MAX_ROWS,TARGET_COLUMNS,FOLLOWUP_COLUMNS,RecordImportFileError,importDay,importFollowupType,importLossReason,importMonth,importNumber,importStage,importText,latinDigits,productColumnKey,readImportRows,recordImportColumns,recordImportSheet,type ImportRow,type RecordImportKind} from './record-import';

type Context=Awaited<ReturnType<typeof context>>;
export const RECORD_IMPORT_ACTIONS:Record<RecordImportKind,string>={targets:'استيراد المستهدفات من Excel',followups:'استيراد المتابعات من Excel'};
export type RecordImportStatus='new'|'changed'|'unchanged'|'duplicate'|'empty'|'refused';
export type RecordImportRowView={row:number;status:RecordImportStatus;message:string;
 /** What the row is about, for the preview: the member or the customer, and the month or the day. */
 subject:string;detail:string};
export type RecordImportAnswer={ok:true;kind:RecordImportKind;action:'preview'|'commit';fileName:string;sheet:string;planDigest:string;
 counts:{rows:number;write:number;unchanged:number;duplicate:number;empty:number;refused:number};rows:RecordImportRowView[];ignoredColumns:string[];
 /** The rows saved (a commit). */
 written?:number;alreadySaved?:boolean;closedMonths?:string[]};

const SALES_ROLES=['admin','manager','supervisor','rep','marketing'];
const sha256=async(value:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value))),b=>b.toString(16).padStart(2,'0')).join('');
/** A UUID made from text (the same text always gives the same id). */
const uuidOf=async(text:string)=>{const h=await sha256(text);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-'+((parseInt(h[16],16)&3)|8).toString(16)+h.slice(17,20)+'-'+h.slice(20,32);};
type Say=(ar:string,en:string)=>string;
const PRODUCT_NAMES_EN:Record<string,string>=Object.fromEntries(TARGET_COLUMNS.filter(col=>col.key.startsWith('p:')).map(col=>[col.key.slice(2),col.en.replace(/ \([^)]*\)$/,'')]));
/** The English of the shared rules' messages a row may meet (the page also translates them through its dictionary). */
const SCHEMA_EN:Record<string,string>={'تاريخ المتابعة المنفذة لا يمكن أن يكون في المستقبل':'The completed follow-up date cannot be in the future','اكتب نتيجة المتابعة في 3 أحرف على الأقل':'Enter a follow-up outcome of at least 3 characters','حدد الإجراء القادم وموعد المتابعة القادمة':'Set the next action and next follow-up date','موعد المتابعة القادمة لا يسبق تاريخ المتابعة المنفذة':'The next follow-up date cannot precede the completed follow-up date','حدد سبب الفقد، واكتب التفاصيل عند اختيار أخرى':'Select a loss reason and provide details when choosing Other','أدخل تاريخًا صحيحًا':'Enter a valid date'};
const RECONTACT_EN:Record<string,string>={[RECONTACT_MESSAGES.lostOnly]:'A re-contact date is for a lost follow-up only (stage «Lost»).',[RECONTACT_MESSAGES.bothOrNeither]:'Write the re-contact action and its date together, or leave both empty.',[RECONTACT_MESSAGES.date]:'Enter the re-contact date as a valid date.',[RECONTACT_MESSAGES.beforeFollowup]:'The re-contact date cannot precede the completed follow-up date.',[RECONTACT_MESSAGES.past]:'The re-contact date cannot be in the past.'};
class RowError extends Error{}
const refuse=(message:string):never=>{throw new RowError(message);};
const kindSchema=z.enum(['targets','followups']);
const inputSchema=z.object({kind:kindSchema,action:z.enum(['preview','commit']),fileName:z.string().trim().min(1).max(255),base64:z.string().min(1).max(Math.ceil(RECORD_IMPORT_MAX_BYTES/3)*4),requestId:z.string().uuid().optional(),planDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),language:z.enum(['ar','en']).default('ar')}).strict();

/** Who may import (and download the template of) each kind; the session first, then the role, the page, the cell. */
export function requireRecordImport(c:Context,kind:RecordImportKind){
 if(kind==='targets'){
  requirePages(c.me,'targets');
  if(!['admin','manager'].includes(c.me.role))throw new CRMError('تعديل المستهدفات متاح للإدارة فقط',403);
  requireCell(c.me,'targets','edit');
 }else{
  requireSalesRole(c.me);requirePages(c.me,'followup');requireCell(c.me,'followup','add');
 }
}
export const recordImportKind=(value:unknown)=>{const parsed=kindSchema.safeParse(value);if(!parsed.success)throw new CRMError('نوع الاستيراد غير صحيح',400);return parsed.data;};

// ---------- Targets ----------
type TargetRow={kind:'sales'|'activity';scope_id:string;month:string;data:string;version:number};
/** The members whose targets this account may write (lib/targets-server.ts saveTargetSet): their team (never read through «عرض بيانات الفريق
 *  بالكامل»), in their regions, active, of a sales role. */
function targetMembers(c:Context){
 const team=salesReadMemberIds(c.members,c.me),global=regionScope(c.me)==='all';
 return c.members.filter(m=>team.has(m.id)&&(global||c.regionalMembers.some(r=>r.id===m.id))&&!!m.active&&SALES_ROLES.includes(m.role));
}
async function targetSetsOf(c:Context,ids:string[],month:string){
 if(!ids.length)return [] as TargetRow[];
 return (await c.db.prepare("SELECT kind,scope_id,month,data,version FROM crm_target_sets WHERE kind IN ('sales','activity') AND scope_id IN (SELECT value FROM json_each(?)) AND month<=? ORDER BY month DESC").bind(JSON.stringify(ids),month).all<TargetRow>()).results;
}
const effective=(rows:TargetRow[],kind:'sales'|'activity',scope:string,month:string)=>rows.find(r=>r.kind===kind&&r.scope_id===scope&&r.month<=month);
/** The same values (a product's quantity, or the three activity counts), whatever order the stored products are in. */
function sameTargets(kind:'sales'|'activity',stored:unknown,next:QuantityTargets|ActivityTargets){
 if(kind==='activity'){const a=activityTargetsSchema.safeParse(stored);return a.success&&activityFields.every(([key])=>a.data[key]===(next as ActivityTargets)[key]);}
 const a=quantityTargetsSchema.safeParse(stored);return a.success&&targetProducts.every(p=>(a.data.products.find(r=>r.product===p.id)?.quantity??null)===((next as QuantityTargets).products.find(r=>r.product===p.id)?.quantity??null));
}
type TargetWrite={kind:'sales'|'activity';member:Member;month:string;data:QuantityTargets|ActivityTargets;version:number;inherited:{month:string;version:number}|null;before:{month:string|null;data:unknown}};
type Planned<W>={rows:RecordImportRowView[];writes:W[];digest:unknown;closedMonths?:string[]};

async function planTargets(c:Context,rows:ImportRow[],present:Set<string>,L:Say):Promise<Planned<TargetWrite>>{
 const members=targetMembers(c),byEmail=new Map(c.members.map(m=>[m.email.trim().toLowerCase(),m]));
 const months=new Set<string>(),parsed:{row:ImportRow;month:string|null;member?:Member;error?:string}[]=[];
 for(const row of rows){
  const month=importMonth(row.cells.month||'');const email=importText(row.cells.email).toLowerCase();
  if(typeof month==='string'&&month)months.add(month);
  parsed.push({row,month:typeof month==='string'&&month?month:null,member:byEmail.get(email),error:!month?(month===''?L('الشهر مطلوب.','The month is required.'):L('الشهر غير صحيح؛ اكتبه مثل 2026-12.','The month is not valid; write it like 2026-12.')):!email?L('البريد الإلكتروني للعضو مطلوب.','The member\'s email is required.'):undefined});
 }
 const latest=[...months].sort().at(-1)||riyadhMonth(),sets=await targetSetsOf(c,members.map(m=>m.id),latest);
 const out:RecordImportRowView[]=[],writes:TargetWrite[]=[],seen=new Map<string,number>(),closedMonths=new Set<string>();
 for(const item of parsed){
  const {row}=item,subject=importText(row.cells.email),view=(status:RecordImportStatus,message='',detail=item.month||'')=>out.push({row:row.row,status,message,subject:item.member?.name||subject,detail});
  try{
   if(item.error)refuse(item.error);
   const month=item.month!,member=item.member;
   if(!member)refuse(L('لا يوجد عضو بهذا البريد في الفريق: ','No team member has this email: ')+subject);
   if(!members.some(m=>m.id===member!.id))refuse(member!.active?L('العضو خارج نطاق فريقك أو منطقتك.','The member is outside your team or region.'):L('حساب العضو معطل.','The member\'s account is disabled.'));
   // A second row of the same member and month is refused once the first one passed (a refused row does not hold the place).
   const key=member!.id+'|'+month;if(seen.has(key))refuse(L('مكرر: العضو نفسه والشهر نفسه في الصف ','Repeated: the same member and month in row ')+seen.get(key)+'.');
   const closed=targetMonthClosed(month);if(closed&&c.me.role!=='admin')refuse(L(CLOSED_MONTH_MESSAGE,'This month has ended; only the system administrator can change its targets'));
   // Products: each column the file has; a blank cell is «غير محدد», as in the targets form.
   const typed=new Map<string,number|null>();let anyProduct=false;
   for(const product of targetProducts){
    const key=productColumnKey(product.id);if(!present.has(key))continue;
    const value=importNumber(row.cells[key]||'');
    if(value===undefined||typeof value==='number'&&(value<0||value>1000000000||Math.abs(value*1000000-Math.round(value*1000000))>=0.0001))refuse(L('كمية غير صحيحة في «'+product.name+'»: ','Not a valid quantity in «'+PRODUCT_NAMES_EN[product.id]+'»: ')+row.cells[key]);
    typed.set(product.id,value as number|null);if(value!==null)anyProduct=true;
   }
   const activityValues=activityFields.map(([key])=>importNumber(row.cells[key]||'')),anyActivity=activityValues.some(v=>v!==null);
   if(anyActivity&&activityValues.some(v=>v===null))refuse(L('اكتب العملاء الجدد والعملاء المستردين والزيارات الفعلية معًا، أو اتركها فارغة.','Write new customers, reactivated customers and actual visits together, or leave them empty.'));
   if(anyActivity&&activityValues.some(v=>v===undefined||!Number.isInteger(v)||(v as number)<1||(v as number)>1000000))refuse(L('مستهدفات العملاء والزيارات أعداد صحيحة من 1 إلى 1000000.','Customer and visit targets are whole numbers from 1 to 1000000.'));
   if(anyProduct&&['manager','supervisor'].includes(member!.role))refuse(L('مستهدف المبيعات للمدير والمشرف يُحسب تلقائيًا من إجمالي مستهدفات الفريق.','Managers’ and supervisors’ sales targets are calculated automatically from their teams’ total targets.'));
   // The sales manager is out of the evaluation and of the customer and visit targets (lib/targets.ts roleOutOfEvaluation, 2026-11-16).
   if(anyActivity&&roleOutOfEvaluation(member!.role))refuse(L(SALES_MANAGER_ACTIVITY_MESSAGE,SALES_MANAGER_ACTIVITY_ENGLISH));
   seen.set(key,row.row);
   if(!anyProduct&&!anyActivity){view('empty',L('لا قيم في الصف؛ لم يتغير شيء.','No values in the row; nothing changes.'));continue;}
   const rowWrites:TargetWrite[]=[];let unchanged=0;
   const plan=(kind:'sales'|'activity',data:QuantityTargets|ActivityTargets)=>{
    const current=effective(sets,kind,member!.id,month),own=current?.month===month?current:undefined;
    if(current&&sameTargets(kind,JSON.parse(current.data),data)){unchanged++;return;}
    rowWrites.push({kind,member:member!,month,data,version:own?.version||0,inherited:!own&&current?{month:current.month,version:current.version}:null,before:current?{month:current.month,data:JSON.parse(current.data)}:{month:null,data:null}});
   };
   if(anyProduct){
    const current=effective(sets,'sales',member!.id,month),old=current?quantityTargetsSchema.parse(JSON.parse(current.data)).products:[];
    plan('sales',quantityTargetsSchema.parse({products:targetProducts.map(p=>({product:p.id,quantity:typed.has(p.id)?typed.get(p.id)!:old.find(r=>r.product===p.id)?.quantity??null}))}));
   }
   if(anyActivity){const [newCustomers,recoveredCustomers,visits]=activityValues as number[];plan('activity',activityTargetsSchema.parse({newCustomers,recoveredCustomers,visits}));}
   if(!rowWrites.length){view('unchanged',L('القيم نفسها محفوظة؛ لن تتغير.','The same values are saved; nothing changes.'));continue;}
   if(closed)closedMonths.add(month);
   writes.push(...rowWrites);
   const changing=rowWrites.some(w=>w.version>0||w.inherited),both=rowWrites.length===2,sales=rowWrites[0].kind==='sales';
   const what=both?L('الأصناف والعملاء والزيارات','products, customers and visits'):sales?L('الأصناف','products'):L('العملاء والزيارات','customers and visits');
   view(changing?'changed':'new',(changing?L('سيُحدَّث مستهدف ','The target of '+what+' will be updated'):L('سيُضاف مستهدف ','The target of '+what+' will be added'))+L(what,'')+(unchanged?L('؛ والباقي بلا تغيير.','; the rest is unchanged.'):'.'));
  }catch(error){if(!(error instanceof RowError))throw error;view('refused',error.message);}
 }
 return {rows:out,writes,closedMonths:[...closedMonths].sort(),digest:writes.map(w=>[w.kind,w.member.id,w.month,w.version,w.inherited,w.data])};
}
async function commitTargets(c:Context,writes:TargetWrite[],claimId:string,claimDetail:string,now:string){
 const guard=accessGuard(c),expected=JSON.stringify(writes.map(w=>[w.kind,w.member.id,w.month,w.version,w.inherited?w.inherited.month+':'+w.inherited.version:''])),members=[...new Map(writes.map(w=>[w.member.id,w.member])).values()];
 // Each set as the preview read it: this month's own row at its version, or none, and the set it inherits from unchanged.
 const setsGate=`NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE (json_extract(e.value,'$[3]')>0 AND NOT EXISTS(SELECT 1 FROM crm_target_sets t WHERE t.kind=json_extract(e.value,'$[0]') AND t.scope_id=json_extract(e.value,'$[1]') AND t.month=json_extract(e.value,'$[2]') AND t.version=json_extract(e.value,'$[3]'))) OR (json_extract(e.value,'$[3]')=0 AND (EXISTS(SELECT 1 FROM crm_target_sets t WHERE t.kind=json_extract(e.value,'$[0]') AND t.scope_id=json_extract(e.value,'$[1]') AND t.month=json_extract(e.value,'$[2]')) OR COALESCE((SELECT t.month||':'||t.version FROM crm_target_sets t WHERE t.kind=json_extract(e.value,'$[0]') AND t.scope_id=json_extract(e.value,'$[1]') AND t.month<json_extract(e.value,'$[2]') ORDER BY t.month DESC LIMIT 1),'') IS NOT json_extract(e.value,'$[4]'))))`;
 const claim='EXISTS(SELECT 1 FROM crm_audit WHERE id=?)';
 const statements:D1PreparedStatement[]=[c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+guard.sql+' AND '+memberSnapshotsGate+' AND '+setsGate).bind(claimId,'record-import-targets',c.me.name,RECORD_IMPORT_ACTIONS.targets,claimDetail,now,...guard.args,JSON.stringify(members.map(memberSnapshot)),expected)];
 for(const [index,w] of writes.entries()){
  const mutation='target-set:'+c.me.id+':'+await uuidOf(claimId+'|'+index),json=JSON.stringify(w.data),closed=targetMonthClosed(w.month);
  statements.push(w.version
   ?c.db.prepare('UPDATE crm_target_sets SET data=?,version=version+1,mutation_id=?,updated_by=?,updated_at=? WHERE kind=? AND scope_id=? AND month=? AND version=? AND '+claim).bind(json,mutation,c.me.id,now,w.kind,w.member.id,w.month,w.version,claimId)
   :c.db.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) SELECT ?,?,?,?,1,?,?,? WHERE '+claim+' ON CONFLICT(kind,scope_id,month) DO NOTHING').bind(w.kind,w.member.id,w.month,json,mutation,c.me.id,now,claimId));
  // «سجل التعديلات» of the person: the same row a save from the targets page writes (lib/targets-history.ts reads it), with the import named.
  statements.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claim).bind(mutation,'target-'+w.member.id,c.me.name,w.kind==='activity'?'تعديل مستهدفات العملاء والزيارات':'تعديل مستهدفات الأصناف',JSON.stringify({kind:w.kind,scopeId:w.member.id,month:w.month,version:w.version,inheritedFrom:w.inherited,data:w.data,before:w.before,source:'excel-import',importId:claimId,...(closed?{closedMonth:true}:{})}),now,claimId));
 }
 return statements;
}

// ---------- Follow-ups ----------
type FollowupWrite={row:number;id:string;customer:Row;source:Row;performer:Member;data:Record<string,unknown>};
const customerCodeKey=(value:string)=>latinDigits(importText(value)).replace(/\s/g,'').toUpperCase();
async function planFollowups(c:Context,rows:ImportRow[],L:Say):Promise<Planned<FollowupWrite>>{
 const day=today(),me=c.me,customers=c.visible.filter(r=>r.kind==='customer');
 const byInternal=new Map(customers.map(r=>[customerCodeKey(String(r.data.internalCode||'')),r])),byErp=new Map<string,Row[]>();
 for(const r of customers){const key=customerCodeKey(String(r.data.code||''));if(key)byErp.set(key,[...(byErp.get(key)||[]),r]);}
 const writable=salesScopeMemberIds(c.members,me,{activeOnly:true}),byEmail=new Map(c.members.map(m=>[m.email.trim().toLowerCase(),m]));
 const visibleOf=new Map<string,Row[]>([[me.id,c.visible]]),seenCustomers=new Map<string,number>(),out:RecordImportRowView[]=[],writes:FollowupWrite[]=[];
 const existing=new Set(c.all.map(r=>r.id));
 for(const row of rows){
  const cells=row.cells,subject=importText(cells.customerName)||importText(cells.customerCode);
  const view=(status:RecordImportStatus,message='',detail='',name=subject)=>out.push({row:row.row,status,message,subject:name,detail});
  try{
   const code=customerCodeKey(cells.customerCode||'');if(!code)refuse(L('كود العميل مطلوب.','The customer code is required.'));
   let customer=byInternal.get(code);
   if(!customer){const matches=byErp.get(code)||[];if(matches.length>1)refuse(L('كود ERP هذا لأكثر من عميل؛ اكتب كود يورست (YR-C-…).','This ERP code belongs to more than one customer; write the Yourrest code (YR-C-…).'));customer=matches[0];}
   if(!customer)refuse(L('لا يوجد عميل بهذا الكود ضمن عملائك: ','None of your customers has this code: ')+importText(cells.customerCode));
   const name=String(customer!.data.name||subject);
   const first=seenCustomers.get(customer!.id);if(first!==undefined)refuse(L('للعميل نفسه متابعة أخرى في الملف (الصف '+first+')؛ استورد المتابعة التالية بعد حفظ هذا الملف.','The same customer has another follow-up in the file (row '+first+'); import the next one after this file is saved.'));
   const email=importText(cells.email).toLowerCase();let performer=me;
   if(email&&email!==me.email.trim().toLowerCase()){
    const member=byEmail.get(email);if(!member)refuse(L('لا يوجد عضو بهذا البريد في الفريق: ','No team member has this email: ')+importText(cells.email));
    if(isFieldRole(me.role))refuse(L('لا يمكنك تسجيل متابعة باسم عضو آخر.','You cannot record a follow-up for another member.'));
    if(!writable.has(member!.id)||!SALES_ROLES.includes(member!.role))refuse(L('العضو خارج نطاق فريقك أو حسابه معطل.','The member is outside your team or their account is disabled.'));
    performer=member!;
   }
   if(!visibleOf.has(performer.id))visibleOf.set(performer.id,scopeRecords(c.all,c.members,performer));
   const records=visibleOf.get(performer.id)!;
   if(!records.some(r=>r.id===customer!.id))refuse(L('العميل ليس ضمن عملاء ','The customer is not one of the customers of ')+performer.name+'.');
   // The row as the follow-up form sends it; the shared schema decides as for a follow-up typed on the page.
   const date=importDay(cells.date||'');if(!date)refuse(date===''?L('تاريخ المتابعة مطلوب.','The follow-up date is required.'):L('تاريخ المتابعة غير صحيح؛ اكتبه مثل 2026-11-16.','The follow-up date is not valid; write it like 2026-11-16.'));
   const type=importFollowupType(cells.type||'');if(!type)refuse(type===''?L('نوع المتابعة مطلوب.','The follow-up type is required.'):L('نوع المتابعة غير معروف: ','Unknown follow-up type: ')+cells.type);
   if(type==='visit')refuse(L('المتابعة بزيارة تُسجَّل من التطبيق لأنها تحتاج موقع الجهاز؛ اختر نوعًا آخر.','A follow-up visit is recorded in the app because it needs the device location; choose another type.'));
   const stage=importStage(cells.stage||'');if(stage===null)refuse(L('مرحلة البيع غير معروفة: ','Unknown sales stage: ')+cells.stage);
   const nextDate=importDay(cells.nextDate||'');if(nextDate===null)refuse(L('موعد المتابعة القادمة غير صحيح؛ اكتبه مثل 2026-11-20.','The next follow-up date is not valid; write it like 2026-11-20.'));
   const lossReason=importLossReason(cells.lossReason||'');if(lossReason===null)refuse(L('سبب الفقد ليس من القائمة: ','The loss reason is not on the list: ')+cells.lossReason);
   const closed=followupClosed(stage||'');
   const service=activeServiceCase(customer!.id,c),previous=latestCustomerContact(customer!.id,records),current=service?.status==='assigned'&&previous&&previous.createdAt<service.createdAt?undefined:previous;
   const hasQuotation=customerHasQuotation(customer!.id,records,service?.status==='assigned'?service:undefined)||type==='quote'||stage==='quoted';
   const parsed=customerFollowupSchema.safeParse({type,date,result:cells.result||'',salesStage:stage||'',invoiceOutcome:hasQuotation?(stage==='won'?'invoiced':stage==='lost'?'lost':'pending'):'pending',nextAction:closed?'':cells.nextAction||'',nextDate:closed?'':nextDate||'',lossReason:stage==='lost'?lossReason||'':'',lossDetails:stage==='lost'?cells.lossDetails||'':'',recontactDate:'',recontactAction:''});
   if(!parsed.success)refuse(parsed.error.issues.map(issue=>L(issue.message,SCHEMA_EN[issue.message]||'A value is missing or not valid.')).join(' • '));
   const input=parsed.data!;
   // «أخرى»: its details name the reason in 3 to 200 characters (2026-11-22, lib/loss-reason-other.ts), as the follow-up form asks.
   const lossProblem=input.salesStage==='lost'?lossDetailProblem(input.lossReason,input.lossDetails):'';
   if(lossProblem)refuse(L(lossProblem,lossProblem===LOSS_MESSAGES.required?'Write the loss reason when choosing “Other”.':'Write the loss reason in 3 to 200 characters.'));
   const recontact=readRecontact({date:importDay(cells.recontactDate||'')??cells.recontactDate,action:cells.recontactAction},input.salesStage,input.date,day);
   if(recontact&&'error' in recontact)refuse(L(recontact.error,RECONTACT_EN[recontact.error]||'The re-contact date is not valid.'));
   if(!current||!canExecuteCustomerFollowup(current))refuse(L('لا توجد متابعة مفتوحة لهذا العميل؛ تحتاج زيارة سابقة فيها إجراء قادم وموعد متابعة.','This customer has no open follow-up; it needs a previous contact with a next action and date.'));
   const source=c.all.find(r=>r.id===current!.id)!;
   const recontactPlan=recontact&&!('error' in recontact)?recontact:null;
   const {recontactDate:_d,recontactAction:_a,competitorObservation:_o,...fields}=input;void _d;void _a;void _o;
   const request=visitRequest(source,c.visible)||(source.kind==='opportunity'?source:undefined);
   const data:Record<string,unknown>={...fields,visitWorkflow:'followup-v1',summary:'متابعة العميل',outcome:'pending',notes:'',nextAction:closed?recontactPlan?.action||'':input.nextAction,nextDate:closed?recontactPlan?.date||'':input.nextDate,...(recontactPlan?{recontact:true}:{}),
    hasQuotation,sourceId:source.id,requestId:request?.id||'',responsibleId:performer.id,performedBy:performer.id,recordedByEmail:performer.email.toLowerCase(),recordedByName:performer.name,importedBy:me.id,...(service?.status==='assigned'?{serviceCaseId:service.id}:{})};
   // The record id comes from what the row says: the same row again is the same follow-up, never a second one.
   const id='customer-followup-'+await uuidOf(JSON.stringify(['record-import-followup',customer!.id,performer.id,input.date,input.type,input.result,input.salesStage,data.nextAction,data.nextDate,input.lossReason,input.lossDetails]));
   // The place of a customer is held by a row that passed (a refused one does not hold it).
   seenCustomers.set(customer!.id,row.row);
   if(existing.has(id)){view('duplicate',L('سبق استيراد هذه المتابعة؛ لن تُكرَّر.','This follow-up was already imported; it is not repeated.'),input.date,name);continue;}
   const now=new Date().toISOString(),candidate:Row={id,kind:'activity',parentId:customer!.id,assignedTo:customer!.assignedTo,branch:customer!.branch,data,createdAt:now,updatedAt:now,version:1};
   if(customerPlanSource(customer!.id,[candidate,...c.all])?.id!==id)refuse(L('تاريخ المتابعة يسبق آخر تواصل مسجل للعميل (','The follow-up date is before the customer\'s last recorded contact (')+String(source.data.date||'').slice(0,10)+L(')؛ اكتب تاريخًا بعده.','); write a later date.'));
   writes.push({row:row.row,id,customer:customer!,source,performer,data});
   view('new',L('ستُسجَّل باسم ','Recorded as ')+performer.name+(closed?recontactPlan?L('، مفقودة بموعد إعادة تواصل ',', lost with a re-contact on ')+recontactPlan.date:L('، وتُغلق المتابعة',', and the follow-up closes'):L('، والمتابعة القادمة ',', next follow-up ')+input.nextDate)+'.',input.date,name);
  }catch(error){if(!(error instanceof RowError))throw error;view('refused',error.message);}
 }
 // A follow-up already imported but outside what this account loaded is still the same follow-up: read the store for the planned ids.
 if(writes.length){
  const stored=new Set((await c.db.prepare('SELECT id FROM crm_records WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(writes.map(w=>w.id))).all<{id:string}>()).results.map(r=>r.id));
  for(const w of writes.filter(w=>stored.has(w.id))){const view=out.find(r=>r.row===w.row);if(view){view.status='duplicate';view.message=L('سبق استيراد هذه المتابعة؛ لن تُكرَّر.','This follow-up was already imported; it is not repeated.');}}
  writes.splice(0,writes.length,...writes.filter(w=>!stored.has(w.id)));
 }
 return {rows:out,writes,digest:writes.map(w=>[w.id,w.customer.id,w.customer.version,w.source.id,w.source.version,w.performer.id])};
}
function commitFollowups(c:Context,writes:FollowupWrite[],claimId:string,claimDetail:string,now:string){
 const guard=accessGuard(c),performers=[...new Map(writes.map(w=>[w.performer.id,w.performer])).values()];
 const records=JSON.stringify(writes.flatMap(w=>[[w.customer.id,w.customer.version],[w.source.id,w.source.version]]));
 const recordsGate=`NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN crm_records actual ON actual.id=json_extract(expected.value,'$[0]') WHERE actual.id IS NULL OR actual.version IS NOT json_extract(expected.value,'$[1]'))`;
 const absentGate='NOT EXISTS(SELECT 1 FROM crm_records WHERE id IN (SELECT value FROM json_each(?)))';
 const claim='EXISTS(SELECT 1 FROM crm_audit WHERE id=?)';
 const statements:D1PreparedStatement[]=[c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+guard.sql+' AND '+memberSnapshotsGate+' AND '+recordsGate+' AND '+absentGate).bind(claimId,'record-import-followups',c.me.name,RECORD_IMPORT_ACTIONS.followups,claimDetail,now,...guard.args,JSON.stringify(performers.map(memberSnapshot)),records,JSON.stringify(writes.map(w=>w.id)))];
 for(const w of writes){
  statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'activity',?,?,?,?,?,?,1,? WHERE ${claim}`).bind(w.id,w.customer.id,w.customer.assignedTo,w.customer.branch,JSON.stringify(w.data),now,now,claimId,claimId));
  statements.push(c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$._visitPlan',json(?)),updated_at=?,version=version+1 WHERE id=? AND ${claim}`).bind(JSON.stringify({visitId:w.id,date:w.data.date,nextDate:w.data.nextDate,nextAction:w.data.nextAction}),now,w.customer.id,claimId));
  statements.push(c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${claim}`).bind(crypto.randomUUID(),w.id,c.me.name,'تسجيل متابعة',String(w.data.result||'').slice(0,250),now,claimId));
 }
 return statements;
}

// ---------- Preview and import ----------
const counts=(rows:RecordImportRowView[])=>({rows:rows.length,write:rows.filter(r=>r.status==='new'||r.status==='changed').length,unchanged:rows.filter(r=>r.status==='unchanged').length,duplicate:rows.filter(r=>r.status==='duplicate').length,empty:rows.filter(r=>r.status==='empty').length,refused:rows.filter(r=>r.status==='refused').length});
/** POST /api/record-import {kind, action:'preview'|'commit', fileName, base64, requestId?, planDigest?}. */
export async function importRecords(c:Context,body:unknown):Promise<RecordImportAnswer>{
 // The kind first, then its rights, then the rest of the request: a role without the right is refused before anything else is read.
 requireRecordImport(c,recordImportKind((body as {kind?:unknown}|null)?.kind));const input=inputSchema.parse(body);
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw new CRMError('ترميز ملف Excel غير صحيح');
 const raw=atob(input.base64);if(raw.length>RECORD_IMPORT_MAX_BYTES)throw new CRMError('أقصى حجم لملف الاستيراد 2 ميجابايت',413);
 const bytes=Uint8Array.from(raw,ch=>ch.charCodeAt(0)),fileHash=await sha256(bytes);
 const claimId=input.requestId?'record-import:'+input.kind+':'+c.me.id+':'+input.requestId:'',fingerprint=await sha256(JSON.stringify([c.me.id,input.kind,input.fileName,fileHash]));
 const replay=async()=>{if(input.action!=='commit'||!claimId)return null;const row=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(claimId).first<{detail:string}>();if(!row)return null;const detail=JSON.parse(row.detail) as {fingerprint:string;answer:RecordImportAnswer};if(detail.fingerprint!==fingerprint)throw new CRMError('تم حفظ هذا الاستيراد بملف مختلف؛ ارفع الملف للمعاينة من جديد',409);return {...detail.answer,alreadySaved:true};};
 const prior=await replay();if(prior)return prior;
 // The preview's own words come in the page's language (the reader's messages of the shared rules stay Arabic and the page translates them).
 const L:Say=(ar,en)=>input.language==='en'?en:ar;
 let file:ReturnType<typeof readImportRows>;
 try{file=readImportRows(input.kind,readWorkbookSheets(bytes,{maxRows:RECORD_IMPORT_MAX_ROWS+100,maxColumns:60}),input.language);}
 catch(error){if(error instanceof RecordImportFileError)throw new CRMError(error.message);if(error instanceof ErpWorkbookError)throw new CRMError(L(error.message,'The Excel file could not be read ('+'it is damaged, protected, has formulas or macros, or is not an .xlsx file). Save it again as .xlsx and retry.'));throw error;}
 const present=new Set(Object.keys(file.rows[0]?.cells||{}));
 const plan=input.kind==='targets'?await planTargets(c,file.rows,present,L):await planFollowups(c,file.rows,L);
 const planDigest=await sha256(JSON.stringify([input.kind,plan.rows.map(r=>[r.row,r.status]),plan.digest]));
 const answer:RecordImportAnswer={ok:true,kind:input.kind,action:input.action,fileName:input.fileName,sheet:file.sheet,planDigest,counts:counts(plan.rows),rows:plan.rows,ignoredColumns:file.ignoredColumns,...(plan.closedMonths?.length?{closedMonths:plan.closedMonths}:{})};
 if(input.action==='preview')return answer;
 if(!claimId||!input.planDigest)throw new CRMError('اعرض الملف أولًا قبل الاستيراد');
 if(input.planDigest!==planDigest)throw new CRMError('تغيّرت البيانات بعد المعاينة؛ اعرض الملف مرة أخرى',409);
 const result:RecordImportAnswer={...answer,written:answer.counts.write};
 // Nothing to write (every row unchanged, already imported, empty or refused): no transaction and no audit line.
 if(!plan.writes.length)return result;
 const now=new Date().toISOString();
 const detail=JSON.stringify({fingerprint,fileName:input.fileName,fileSha256:fileHash,sheet:file.sheet,counts:result.counts,rows:plan.rows.map(r=>({row:r.row,status:r.status})),answer:{...result,rows:result.rows.slice(0,RECORD_IMPORT_MAX_ROWS)}});
 const statements=input.kind==='targets'?await commitTargets(c,plan.writes as TargetWrite[],claimId,detail,now):commitFollowups(c,plan.writes as FollowupWrite[],claimId,detail,now);
 let done;try{done=await c.db.batch(statements);}catch(error){const saved=await replay();if(saved)return saved;throw error;}
 if(done[0].meta.changes!==1){const saved=await replay();if(saved)return saved;throw new CRMError('تغيّرت البيانات أو الصلاحيات أثناء الاستيراد؛ لم يُحفظ شيء. اعرض الملف مرة أخرى.',409);}
 return result;
}

// ---------- Templates ----------
/** GET /api/record-import?kind=&month=&lang=: the template as .xlsx, the header row, the note row, then what the reader may import. */
export async function recordImportTemplate(c:Context,kind:RecordImportKind,options:{month?:string;language:'ar'|'en'}):Promise<{fileName:string;bytes:Uint8Array<ArrayBuffer>}>{
 requireRecordImport(c,kind);
 const en=options.language==='en',columns=recordImportColumns(kind),header=columns.map(col=>en?col.en:col.ar),notes=columns.map(col=>en?col.note.en:col.note.ar);
 let rows:string[][]=[];
 if(kind==='targets'){
  const month=options.month&&/^\d{4}-(0[1-9]|1[0-2])$/.test(options.month)?options.month:riyadhMonth();
  const members=targetMembers(c).filter(m=>isFieldRole(m.role)||m.role==='supervisor').sort((a,b)=>a.name.localeCompare(b.name,'ar')),sets=await targetSetsOf(c,members.map(m=>m.id),month);
  rows=members.map(m=>{
   const sales=effective(sets,'sales',m.id,month),activity=effective(sets,'activity',m.id,month);
   const products=isFieldRole(m.role)&&sales?quantityTargetsSchema.parse(JSON.parse(sales.data)).products:[],values=activity?activityTargetsSchema.parse(JSON.parse(activity.data)):null;
   return columns.map(col=>col.key==='month'?month:col.key==='email'?m.email:col.key==='name'?m.name:col.key.startsWith('p:')?String(products.find(p=>p.product===col.key.slice(2))?.quantity??''):values&&(col.key in values)?String(values[col.key as keyof ActivityTargets]):'');
  });
  return {fileName:'Yourrest-targets-template-'+month+'.xlsx',bytes:xlsxWorkbook({name:recordImportSheet(kind,options.language),rows:[header,notes,...rows],widths:columns.map(col=>col.width),rightToLeft:!en,headerRow:0,noteRow:1})};
 }
 // Follow-ups: the reader's customers whose follow-up line is open (the next due first), with its responsible's email when the reader may
 // record for them; the columns the person fills are left empty.
 const plans=customerPlanSources(c.visible),writable=salesScopeMemberIds(c.members,c.me,{activeOnly:true});
 const open=c.visible.filter(r=>r.kind==='customer').flatMap(customer=>{const source=plans.get(customer.id);return source&&canExecuteCustomerFollowup(source)?[{customer,source}]:[];}).sort((a,b)=>String(a.source.data.nextDate).localeCompare(String(b.source.data.nextDate))||String(a.customer.data.name).localeCompare(String(b.customer.data.name),'ar')).slice(0,RECORD_IMPORT_MAX_ROWS);
 rows=open.map(({customer,source})=>{const author=recordAuthorId(source,c.members),owner=author&&author!==c.me.id&&writable.has(author)&&!isFieldRole(c.me.role)?c.members.find(m=>m.id===author):undefined;return columns.map(col=>col.key==='customerCode'?String(customer.data.internalCode||customer.data.code||''):col.key==='customerName'?String(customer.data.name||''):col.key==='email'?owner?.email||'':'');});
 return {fileName:'Yourrest-followups-template-'+today()+'.xlsx',bytes:xlsxWorkbook({name:recordImportSheet(kind,options.language),rows:[header,notes,...rows],widths:columns.map(col=>col.width),rightToLeft:!en,headerRow:0,noteRow:1})};
}
export {TARGET_COLUMNS,FOLLOWUP_COLUMNS};

// «المحذوفات» on the server (lib/trash.ts says what it is). Three parts:
// - deleteCapture: what a deletion adds to its «حذف» history entry so the record can be put back as it was (app/api/crm/route.ts): the
//   journey stops its contact was linked to, the records whose visit-plan pointers it removed (with the pointer), and a customer's Yourrest
//   number and ERP code aliases (cascaded away with the row). Read inside the deletion's own statement, so nothing changes in between.
// - listTrash: the deletions not restored yet, newest first, 40 at a time; the administrator sees all of them, the sales manager and (since
//   2026-11-10) a supervisor or a representative with a «حذف» cell on those they deleted themselves (lib/permissions.ts trashScopeOf), each
//   reader within their regions.
// - restoreFromTrash: puts one back with its id, kind, parent, assignee, branch, data and creation time at the next version, and what its
//   deletion took with it, in one gated batch with the receipt restore:<deletion id> (a deletion is restored once). A supervisor or a
//   representative (restoreRights) restores only while the record's own «حذف» cell is on for them and within what they may delete now.
import {z} from 'zod';
import {accessGuard,CRMError,recordDeleteGuard,type context} from './crm-server';
import {followupTitle,type Kind,type Member,type Row} from './crm';
import {trashScope} from './access';
import {PAGE_HIDDEN_TEXT,trashRestoreCellOff,trashScopeOf} from './permissions';
import {memberCanAccessRegion,regionScope} from './regions';
import {customerCodeKey,customerCodeCandidates,effectiveCodeMapping} from './customer-identity';
import {TRASH_DELETE_ACTION,TRASH_NEW_NUMBER_NOTE,TRASH_PAGE_SIZE,TRASH_RESTORE_ACTION,TRASH_TEXT,TRASH_TYPES,trashCellOff,trashCodeSkipped,trashNewNumber,trashNumberTaken,trashParentFirst,trashRestoreId,trashType,yourrestCode,type TrashAnswer,type TrashItem,type TrashRestoreAnswer,type TrashType} from './trash';

type Context=Awaited<ReturnType<typeof context>>;
type Pointer={id:string;field:'_visitPlan'|'_stageVisitId';value:unknown};
/** A «حذف» entry's detail. Before this release it held kind, deletedBy, record (the row as the context decoded it: a customer's data
 *  carries internalCode and _erpCodeAliases) and codeMappings; capture:1 marks the fuller ones. */
export type TrashSnapshot={kind:Kind;deletedBy:string;record:Row;codeMappings:string[];capture:boolean;journeyLinks:string[];pointers:Pointer[];customerNumber:number|null;erpCodeAliases:string[]|null;customer:{id:string;name:string;region:string}|null};
const KINDS=['customer','factory','opportunity','activity','quote'];
/** Fields the context adds when it reads a record (lib/crm-context-records.ts) or a page adds when it shows one: never stored. */
const COMPUTED_FIELDS=['internalCode','_erpCodeAliases','_lastPurchase','_masterReadOnly','_masterRoutingReadOnly','_readOnly','_serviceIntake','_serviceWorkflow'];
const text=(value:unknown)=>typeof value==='string'?value:typeof value==='number'?String(value):'';
const strings=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&item.length>0):[];

/** The customer at the root of a record's lineage, as the deletion saw it. */
export function rootCustomer(all:Row[],record:Row){const indexed=new Map(all.map(r=>[r.id,r]));let current:Row|undefined=record;for(let i=0;current&&current.kind!=='customer'&&i<6;i++)current=current.parentId?indexed.get(current.parentId):undefined;return current?.kind==='customer'?current:undefined;}

/**
 * The deletion's detail with what a restoration needs, as an SQL expression over the JSON text bound first (args follow it): read in the
 * same INSERT that records the deletion, before the rows go. json() keeps the arrays and objects as JSON (a value read through a
 * sub-select loses its JSON type).
 */
export function deleteCapture(old:Row){
 if(old.kind==='customer')return{sql:`json_set(?,'$.capture',1,'$.customerNumber',(SELECT number FROM crm_customer_numbers WHERE customer_id=?),'$.erpCodeAliases',json((SELECT json_group_array(source_code) FROM (SELECT source_code FROM crm_customer_code_aliases WHERE customer_id=? ORDER BY source_code))),'$.journeyLinks',json('[]'),'$.pointers',json('[]'))`,args:[old.id,old.id]};
 return{sql:`json_set(?,'$.capture',1,'$.journeyLinks',json((SELECT json_group_array(stop_id) FROM (SELECT stop_id FROM crm_journey_links WHERE activity_id=? ORDER BY stop_id))),'$.pointers',json((SELECT json_group_array(json(pointer)) FROM (
  SELECT json_object('id',id,'field','_visitPlan','value',json(json_extract(data,'$._visitPlan'))) AS pointer FROM crm_records WHERE json_extract(data,'$._visitPlan.visitId')=?
  UNION ALL SELECT json_object('id',id,'field','_stageVisitId','value',json_extract(data,'$._stageVisitId')) FROM crm_records WHERE json_extract(data,'$._stageVisitId')=?))))`,args:[old.id,old.id,old.id]};
}

export function parseSnapshot(detail:string,recordId:string):TrashSnapshot|null{
 let raw:Record<string,unknown>;try{const parsed=JSON.parse(detail);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;raw=parsed;}catch{return null;}
 const record=raw.record as Row|undefined;
 if(!record||typeof record!=='object'||record.id!==recordId||!KINDS.includes(record.kind)||!record.data||typeof record.data!=='object'||Array.isArray(record.data))return null;
 const capture=raw.capture===1;
 const pointers=capture&&Array.isArray(raw.pointers)?raw.pointers.filter((p):p is Pointer=>!!p&&typeof p==='object'&&typeof (p as Pointer).id==='string'&&['_visitPlan','_stageVisitId'].includes((p as Pointer).field)):[];
 const customer=raw.customer&&typeof raw.customer==='object'?raw.customer as Record<string,unknown>:null;
 const number=typeof raw.customerNumber==='number'&&Number.isSafeInteger(raw.customerNumber)&&raw.customerNumber>0?raw.customerNumber:null;
 return{kind:record.kind,deletedBy:text(raw.deletedBy),record:{...record,parentId:typeof record.parentId==='string'&&record.parentId?record.parentId:null,version:Number.isSafeInteger(record.version)&&record.version>0?record.version:1},codeMappings:strings(raw.codeMappings),capture,
  journeyLinks:capture?strings(raw.journeyLinks):[],pointers,customerNumber:number,erpCodeAliases:capture?strings(raw.erpCodeAliases):null,
  customer:customer&&typeof customer.id==='string'?{id:customer.id,name:text(customer.name),region:text(customer.region)}:null};
}

/** The Yourrest number a deleted customer had: captured since this release; before it, read back from the code the context put in the
 *  record (internalCode, YR-C-000123). None for a customer deleted before customers were numbered (migration 0014). */
export function snapshotNumber(snap:TrashSnapshot){if(snap.customerNumber)return snap.customerNumber;const match=/^YR-C-(\d{1,15})$/.exec(text(snap.record.data.internalCode));const value=match?Number(match[1]):0;return Number.isSafeInteger(value)&&value>0?value:null;}
/** Its ERP code aliases (since this release, as the table held them; before, as the context read them). */
const snapshotAliases=(snap:TrashSnapshot)=>snap.erpCodeAliases??strings(snap.record.data._erpCodeAliases);
/** The journey stops its contact was linked to: captured since this release; before it, the stop its data names (a contact linked to a
 *  stop always carries journeyStopId: lib/journeys-server.ts). */
const snapshotLinks=(snap:TrashSnapshot)=>snap.capture?snap.journeyLinks:snap.kind==='activity'&&text(snap.record.data.journeyStopId)?[text(snap.record.data.journeyStopId)]:[];
/** The records a restored one points to and needs first (its parent, the request a visit answers, the contact a follow-up continues). */
const references=(record:Row)=>[...new Set([record.parentId,text(record.data.requestId),text(record.data.sourceId)].filter((id):id is string=>!!id))];

/** How the list and the refusals name a record. */
export function trashTitle(record:{kind:string;data:Record<string,unknown>}){
 const data=record.data;
 if(record.kind==='opportunity')return text(followupTitle(record as Row));
 if(record.kind==='quote')return text(data.number);
 if(record.kind==='activity')return text(data.summary)||text(data.result);
 return text(data.name);
}
export function trashLabel(record:{kind:string;data:Record<string,unknown>}){
 const type=trashType(record),title=trashTitle(record),number=text(record.data.visitNumber);
 if(!type)return TRASH_TEXT.linked;
 if(type==='visit'&&number)return 'الزيارة رقم '+number;
 const names:Record<TrashType,string>={customer:'العميل',machine:'الماكينة',opportunity:'الفرصة',quote:'عرض السعر',visit:'الزيارة',followup:'المتابعة'};
 return title?names[type]+' «'+title+'»':TRASH_TEXT.linked;
}

type LiveRow={id:string;kind:string;parentId:string|null;data:Record<string,unknown>};
async function liveRows(db:D1Database,ids:string[]){
 const map=new Map<string,LiveRow>();
 for(let i=0;i<ids.length;i+=200){
  const chunk=ids.slice(i,i+200);if(!chunk.length)continue;
  const rows=(await db.prepare("SELECT id,kind,parent_id AS parentId,CASE WHEN kind IN ('customer','factory') THEN data ELSE json_object('summary',json_extract(data,'$.summary'),'number',json_extract(data,'$.number'),'visitNumber',json_extract(data,'$.visitNumber'),'followupTitle',json_extract(data,'$.followupTitle'),'moldType',json_extract(data,'$.moldType'),'visitWorkflow',json_extract(data,'$.visitWorkflow')) END AS data FROM crm_records WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(chunk)).all<{id:string;kind:string;parentId:string|null;data:string}>()).results;
  for(const row of rows){let data:Record<string,unknown>={};try{data=JSON.parse(row.data)||{};}catch{/* a broken row reads as empty */}map.set(row.id,{...row,data});}
 }
 return map;
}
/** The latest deletion of each id, for records that are gone (to name them and to find a deleted child's customer). */
async function deletedSnapshots(db:D1Database,ids:string[]){
 const map=new Map<string,TrashSnapshot>();
 for(let i=0;i<ids.length;i+=200){
  const chunk=ids.slice(i,i+200);if(!chunk.length)continue;
  const rows=(await db.prepare('SELECT record_id AS recordId,detail FROM crm_audit WHERE action=? AND record_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC,id DESC').bind(TRASH_DELETE_ACTION,JSON.stringify(chunk)).all<{recordId:string;detail:string}>()).results;
  for(const row of rows){if(map.has(row.recordId))continue;const snap=parseSnapshot(row.detail,row.recordId);if(snap)map.set(row.recordId,snap);}
 }
 return map;
}

/** The lineage of the given ids, live first, then as deleted, up to the customer: one read per level. */
async function lineage(db:D1Database,ids:string[]){
 const live=new Map<string,LiveRow>(),gone=new Map<string,TrashSnapshot>(),seen=new Set<string>();
 let pending=[...new Set(ids)];
 for(let level=0;pending.length&&level<6;level++){
  for(const id of pending)seen.add(id);
  for(const [id,row] of await liveRows(db,pending))live.set(id,row);
  const missing=pending.filter(id=>!live.has(id));
  for(const [id,snap] of await deletedSnapshots(db,missing))gone.set(id,snap);
  const parents=pending.map(id=>live.get(id)?.parentId??gone.get(id)?.record.parentId).filter((id):id is string=>!!id&&!seen.has(id));
  pending=[...new Set(parents)];
 }
 const node=(id:string)=>live.get(id)??(gone.has(id)?{...gone.get(id)!.record}:undefined);
 const customerOf=(id:string|null|undefined)=>{let current=id?node(id):undefined;for(let i=0;current&&current.kind!=='customer'&&i<6;i++)current=current.parentId?node(current.parentId):undefined;return current?.kind==='customer'?current:undefined;};
 return{live,gone,node,customerOf};
}

/** Whose «المحذوفات» comes from «حذف» (a supervisor or a representative: lib/permissions.ts trashScopeOf), so each restoration of theirs is
 *  asked rule 2 of the owner's 2026-11-10 request; the administrator and the sales manager restore as before. */
const restoreRights=(me:Member)=>!trashScope(me.role);
/** Rule 2, its first part: the record's own «حذف» cell (the one its deletion needed) still on for the member; the refusal's words, or null. */
function cellRefusal(me:Member,record:Row){const off=trashRestoreCellOff(me,record);return off?trashCellOff(off[0],off[1]):null;}
/** Rule 2, its second part: the record within what the member may delete now, the deletion's own scope (lib/crm-server.ts recordDeleteGuard,
 *  for a record not there yet): a representative their own visit or follow-up of a customer in their regions, or a customer assigned to
 *  them; a supervisor their team's. The commit's conditions, or a 403 in the words of a restoration out of scope. */
function restoreScope(c:{me:Member;members:Member[];all:Row[]},record:Row){
 try{return recordDeleteGuard(c,record,{restoring:true});}
 catch(error){if(error instanceof CRMError&&error.status===403)throw new CRMError(TRASH_TEXT.outOfScope,403);throw error;}
}

/** The deletions this reader may see, newest first; a page of 40 and the cursor of the next. A member without the page: 404, as a hidden screen. */
export async function listTrash(c:Context,url:URL):Promise<TrashAnswer>{
 const scope=trashScopeOf(c.me);if(!scope)throw new CRMError(PAGE_HIDDEN_TEXT,404);
 const type=url.searchParams.get('type')||'all';if(type!=='all'&&!TRASH_TYPES.includes(type as TrashType))throw new CRMError('نوع السجل غير صحيح');
 const cursor=url.searchParams.get('before')||'',split=cursor.indexOf('|'),before=split>0?{at:cursor.slice(0,split),id:cursor.slice(split+1)}:null;
 if(cursor&&(!before||cursor.length>400))throw new CRMError('طلب غير صحيح');
 const json=(path:string)=>`CASE WHEN json_valid(a.detail) THEN json_extract(a.detail,'${path}') END`;
 const kinds:Record<TrashType,string>={customer:`${json('$.record.kind')}='customer'`,machine:`${json('$.record.kind')}='factory'`,opportunity:`${json('$.record.kind')}='opportunity'`,quote:`${json('$.record.kind')}='quote'`,
  visit:`${json('$.record.kind')}='activity' AND COALESCE(${json('$.record.data.visitWorkflow')},'')<>'followup-v1'`,followup:`${json('$.record.kind')}='activity' AND ${json('$.record.data.visitWorkflow')}='followup-v1'`};
 let where="a.action=? AND NOT EXISTS (SELECT 1 FROM crm_audit r WHERE r.id='restore:'||a.id)";const args:string[]=[TRASH_DELETE_ACTION];
 if(scope==='own'){where+=` AND ${json('$.deletedBy')}=?`;args.push(c.me.id);}
 if(type!=='all')where+=' AND '+kinds[type as TrashType];
 const regional=regionScope(c.me)!=='all',picked:{audit:{id:string;recordId:string;actor:string;detail:string;createdAt:string};snap:TrashSnapshot|null}[]=[];
 let after=before,exhausted=false;
 // A regional reader's entries outside their regions are skipped after reading, so a page may take more than one read.
 while(picked.length<=TRASH_PAGE_SIZE&&!exhausted){
  const page=(await c.db.prepare(`SELECT a.id,a.record_id AS recordId,a.actor,a.detail,a.created_at AS createdAt FROM crm_audit a WHERE ${where}${after?' AND (a.created_at<? OR (a.created_at=? AND a.id<?))':''} ORDER BY a.created_at DESC,a.id DESC LIMIT 100`).bind(...args,...(after?[after.at,after.at,after.id]:[])).all<{id:string;recordId:string;actor:string;detail:string;createdAt:string}>()).results;
  exhausted=page.length<100;if(page.length)after={at:page[page.length-1].createdAt,id:page[page.length-1].id};
  let rows=page.map(audit=>({audit,snap:parseSnapshot(audit.detail,audit.recordId)}));
  if(regional){
   const graph=await lineage(c.db,rows.flatMap(({snap})=>snap?[snap.record.id,...references(snap.record)]:[]));
   rows=rows.filter(({snap})=>{if(!snap)return false;const region=snap.kind==='customer'?snap.record.data.region:graph.customerOf(snap.record.parentId)?.data.region??snap.customer?.region;return region!==undefined&&memberCanAccessRegion(c.me,region);});
  }
  picked.push(...rows);
 }
 const shown=picked.slice(0,TRASH_PAGE_SIZE),more=picked.length>TRASH_PAGE_SIZE;
 const graph=await lineage(c.db,shown.flatMap(({snap})=>snap?[snap.record.id,...references(snap.record)]:[]));
 // For a supervisor or a representative, each entry also says when rule 2 refuses it, in the restoration's words: the scope is decided over
 // the live lineage as the list read it (ids, kinds, parents and a customer's region: what recordDeleteGuard reads of the ancestors).
 const rights=restoreRights(c.me),ancestors=rights?[...graph.live.values()].map(row=>({...row,assignedTo:'',branch:'',createdAt:'',updatedAt:'',version:0}) as unknown as Row):[];
 const outOfScope=(record:Row)=>{try{restoreScope({me:c.me,members:c.members,all:ancestors},record);return null;}catch(error){if(error instanceof CRMError)return error.message;throw error;}};
 const items:TrashItem[]=shown.map(({audit,snap})=>{
  if(!snap)return{id:audit.id,recordId:audit.recordId,type:'customer',title:audit.recordId,number:'',customerName:'',deletedBy:audit.actor,deletedAt:audit.createdAt,blocked:TRASH_TEXT.broken,note:null};
  const record=snap.record,type=trashType(record)!,customer=record.kind==='customer'?undefined:graph.customerOf(record.parentId);
  const number=record.kind==='customer'?(snapshotNumber(snap)?yourrestCode(snapshotNumber(snap)!):''):record.kind==='activity'?text(record.data.visitNumber):'';
  const missing=references(record).find(id=>!graph.live.has(id));
  const structural=graph.live.has(record.id)?TRASH_TEXT.exists:missing?trashParentFirst(graph.gone.has(missing)?trashLabel(graph.gone.get(missing)!.record):TRASH_TEXT.linked):null;
  // The same order as restoreFromTrash: the cell, the record already there, the parent first, the scope.
  const blocked=rights?cellRefusal(c.me,record)??structural??outOfScope(record):structural;
  return{id:audit.id,recordId:record.id,type,title:trashTitle(record),number,customerName:text(customer?.data.name)||snap.customer?.name||'',deletedBy:audit.actor,deletedAt:audit.createdAt,blocked,note:record.kind==='customer'&&!snapshotNumber(snap)?TRASH_NEW_NUMBER_NOTE:null};
 });
 return{items,next:more?shown[shown.length-1].audit.createdAt+'|'+shown[shown.length-1].audit.id:null,scope};
}

const restoreInput=z.object({auditId:z.string().min(1).max(200),requestId:z.string().uuid()}).strict();

export async function restoreFromTrash(c:Context,body:unknown):Promise<TrashRestoreAnswer>{
 const scope=trashScopeOf(c.me);if(!scope)throw new CRMError(PAGE_HIDDEN_TEXT,404);
 const input=restoreInput.parse(body);
 const audit=await c.db.prepare('SELECT id,record_id AS recordId,detail FROM crm_audit WHERE id=? AND action=?').bind(input.auditId,TRASH_DELETE_ACTION).first<{id:string;recordId:string;detail:string}>();
 if(!audit)throw new CRMError(TRASH_TEXT.notFound,404);
 const snap=parseSnapshot(audit.detail,audit.recordId);
 // A sales manager, a supervisor or a representative restores what they deleted themselves (GSCO: without the whole-company view, only
 // one's own deletions).
 if(scope==='own'&&snap?.deletedBy!==c.me.id)throw new CRMError(TRASH_TEXT.notYours,403);
 const receiptId=trashRestoreId(audit.id);
 const replay=async()=>{const row=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receiptId).first<{detail:string}>();if(!row)return null;let detail:Record<string,unknown>={};try{detail=JSON.parse(row.detail);}catch{/* an unreadable receipt is still a restoration */}if(detail.requestId===input.requestId&&detail.restoredBy===c.me.id)return{ok:true as const,id:audit.recordId,type:(detail.type as TrashType)||'customer',notes:strings(detail.notes),alreadySaved:true};throw new CRMError(TRASH_TEXT.already,409);};
 const replayed=await replay();if(replayed)return replayed;
 if(!snap)throw new CRMError(TRASH_TEXT.broken,409);
 // Rule 2 (the owner, 2026-11-10), after a replay has answered (a retry of what was restored before the cell went off gets its receipt):
 // a supervisor or a representative restores only while the record's own «حذف» cell is on for them.
 const rights=restoreRights(c.me),cellOff=rights?cellRefusal(c.me,snap.record):null;
 if(cellOff)throw new CRMError(cellOff,403);
 const record=snap.record,type=trashType(record)!,refs=references(record);
 const pointerTargets=snap.pointers.map(p=>p.id),planTargets=record.kind==='customer'?[text((record.data._visitPlan as Record<string,unknown>|undefined)?.visitId),text(record.data._stageVisitId)].filter(Boolean):[];
 const graph=await lineage(c.db,[record.id,...refs,...pointerTargets,...planTargets]);
 if(graph.live.has(record.id))throw new CRMError(TRASH_TEXT.exists,409);
 const missing=refs.find(id=>!graph.live.has(id));
 if(missing)throw new CRMError(trashParentFirst(graph.gone.has(missing)?trashLabel(graph.gone.get(missing)!.record):TRASH_TEXT.linked),409);
 // The restored record is checked as a new one would be: the customer within the restorer's regions, a child under a parent they may change.
 let permission:{sql:string;args:(string|number)[]};
 if(record.kind==='customer'){if(!memberCanAccessRegion(c.me,record.data.region))throw new CRMError(TRASH_TEXT.outOfScope,403);permission=accessGuard(c);}
 else{const parent=c.all.find(row=>row.id===record.parentId);if(!parent)throw new CRMError(TRASH_TEXT.outOfScope,403);permission=accessGuard(c,parent);}
 // And within what they may delete now (the deletion's scope); the commit re-checks it with the member, the permissions' version (a cell
 // switched off meanwhile fails it safe) and the reporting line.
 if(rights){const scoped=restoreScope(c,record);permission={sql:permission.sql+' AND '+scoped.sql,args:[...permission.args,...scoped.args]};}
 const data:Record<string,unknown>={...record.data};for(const key of COMPUTED_FIELDS)delete data[key];
 if(record.kind==='customer'){
  // A visit-plan pointer to a contact that is gone points nowhere; scopeRecords drops it for readers, it is not stored back.
  const plan=data._visitPlan as Record<string,unknown>|undefined;if(plan&&!graph.live.has(text(plan.visitId)))delete data._visitPlan;
  if(data._stageVisitId&&!graph.live.has(text(data._stageVisitId)))delete data._stageVisitId;
 }
 const notes:string[]=[],now=new Date().toISOString(),mutation=crypto.randomUUID(),version=record.version+1;
 let number:number|null=null,aliases:string[]=[],mappings:string[]=[];
 if(record.kind==='customer'){
  number=snapshotNumber(snap);
  if(number){const taken=await c.db.prepare('SELECT customer_id FROM crm_customer_numbers WHERE number=?').bind(number).first();if(taken)throw new CRMError(trashNumberTaken(yourrestCode(number)),409);}
  // An ERP code that now belongs to another customer (its current code, or an explicit mapping to a customer that holds it now) stays
  // with that customer: the restored one does not get it back, so no code is held by two customers. The result says which. A code another
  // customer only had before (a kept alias, the code an import cleared) is nobody's: matching reads current codes only (2026-11-12), so
  // the restored customer takes it back.
  const holders=new Map<string,string>(),current=customerCodeCandidates(c.all.filter(row=>row.id!==record.id));
  for(const [key,rows] of current)holders.set(key,text(rows[0].data.name));
  for(const mapping of c.customerIdentityState.mappings){const mapped=effectiveCodeMapping(mapping,current.get(mapping.codeKey));if(mapped)holders.set(mapping.codeKey,text(c.all.find(row=>row.id===mapped.customerId)?.data.name));}
  const skipped=new Set<string>(),skip=(code:string)=>{const key=customerCodeKey(code);if(!key||!holders.has(key))return false;if(!skipped.has(key)){skipped.add(key);notes.push(trashCodeSkipped(code,holders.get(key)||TRASH_TEXT.linked));}return true;};
  if(text(data.code)&&skip(text(data.code)))data.code='';
  aliases=[...new Set(snapshotAliases(snap))].filter(code=>customerCodeKey(code)&&!skip(code));
  mappings=snap.codeMappings.filter(key=>!skip(key));
 }
 const gate='EXISTS (SELECT 1 FROM crm_records WHERE id=? AND mutation_id=?)',ga=[record.id,mutation];
 let insertGate=`NOT EXISTS (SELECT 1 FROM crm_records WHERE id=?) AND NOT EXISTS (SELECT 1 FROM crm_audit WHERE id=?) AND EXISTS (SELECT 1 FROM crm_audit WHERE id=? AND action=?)`;const insertArgs:(string|number)[]=[record.id,receiptId,audit.id,TRASH_DELETE_ACTION];
 for(const id of refs){insertGate+=' AND EXISTS (SELECT 1 FROM crm_records WHERE id=?)';insertArgs.push(id);}
 if(number){insertGate+=' AND NOT EXISTS (SELECT 1 FROM crm_customer_numbers WHERE number=?)';insertArgs.push(number);}
 const statements=[c.db.prepare(`INSERT INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${insertGate} AND ${permission.sql}`).bind(record.id,record.kind,record.parentId,record.assignedTo||'',record.branch||'',JSON.stringify(data),record.createdAt||now,now,version,mutation,...insertArgs,...permission.args)];
 if(record.kind==='customer'){
  // The insert trigger (drizzle/0014) gave it the next number; it takes back its own, which production's customer list knows it by.
  if(number)statements.push(c.db.prepare(`UPDATE crm_customer_numbers SET number=? WHERE customer_id=? AND ${gate}`).bind(number,record.id,...ga));
  for(const alias of aliases)statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_customer_code_aliases(customer_id,source_code) SELECT ?,? WHERE ${gate}`).bind(record.id,alias,...ga));
  // The kept codes come back as history (crm_customer_code_aliases): they decide no ERP document since 2026-11-12. The import state's
  // revision still moves, as the deletion of one does (drizzle/0014), so a preview made before the restore is made again.
  if(aliases.length)statements.push(c.db.prepare(`UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries' AND ${gate}`).bind(...ga));
  for(const key of mappings)statements.push(c.db.prepare(`INSERT INTO crm_customer_code_mappings(code_key,customer_id,version,updated_by,updated_at) SELECT ?,?,1,?,? WHERE ${gate} AND NOT EXISTS (SELECT 1 FROM crm_customer_code_mappings WHERE code_key=?)`).bind(key,record.id,c.me.id,now,...ga,key));
 }
 if(record.kind==='activity'){
  // Its number survived the deletion (crm_visit_numbers keeps the row); a contact saved without it gets it as a save would.
  statements.push(c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$.visitNumber',(SELECT number FROM crm_visit_numbers WHERE record_id=?)) WHERE id=? AND json_extract(data,'$.visitNumber') IS NULL AND EXISTS (SELECT 1 FROM crm_visit_numbers WHERE record_id=?) AND ${gate}`).bind(record.id,record.id,record.id,...ga));
  for(const stop of snapshotLinks(snap))statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_journey_links(stop_id,activity_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM crm_journey_stops WHERE id=?) AND ${gate}`).bind(stop,record.id,stop,...ga));
 }
 // The pointers the deletion removed go back where the record still exists and still points nowhere.
 for(const pointer of snap.pointers){
  const path=pointer.field==='_visitPlan'?'$._visitPlan':'$._stageVisitId',target=pointer.field==='_visitPlan'?"json_extract(crm_records.data,'$._visitPlan.visitId')":"json_extract(crm_records.data,'$._stageVisitId')";
  const value=pointer.field==='_visitPlan'?'json(?)':'?',bound=pointer.field==='_visitPlan'?JSON.stringify(pointer.value):text(pointer.value);
  if(pointer.field==='_visitPlan'&&(!pointer.value||typeof pointer.value!=='object')||pointer.field==='_stageVisitId'&&!bound)continue;
  statements.push(c.db.prepare(`UPDATE crm_records SET data=json_set(data,'${path}',${value}),version=version+1,updated_at=? WHERE id=? AND (${target} IS NULL OR NOT EXISTS (SELECT 1 FROM crm_records pointed WHERE pointed.id=${target})) AND ${gate}`).bind(bound,now,pointer.id,...ga));
 }
 // A customer-service contact moves its customer's version, as its deletion did (app/api/crm/route.ts).
 if(text(data.serviceCaseId))statements.push(c.db.prepare(`UPDATE crm_records SET version=version+1,updated_at=? WHERE id=(SELECT customer_id FROM crm_service_cases WHERE id=?) AND ${gate}`).bind(now,text(data.serviceCaseId),...ga));
 const receipt={deleteAuditId:audit.id,kind:record.kind,type,restoredBy:c.me.id,requestId:input.requestId,version,number:number?yourrestCode(number):'',notes};
 statements.push(c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,record.id,c.me.name,TRASH_RESTORE_ACTION,JSON.stringify(receipt),now,...ga));
 const result=await c.db.batch(statements);
 if(result[0].meta.changes!==1){
  const again=await replay();if(again)return again;
  if(await c.db.prepare('SELECT 1 FROM crm_records WHERE id=?').bind(record.id).first())throw new CRMError(TRASH_TEXT.exists,409);
  if(number&&await c.db.prepare('SELECT 1 FROM crm_customer_numbers WHERE number=?').bind(number).first())throw new CRMError(trashNumberTaken(yourrestCode(number)),409);
  throw new CRMError(TRASH_TEXT.changed,409);
 }
 if(record.kind==='customer'&&!number){const fresh=await c.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(record.id).first<{number:number}>();if(fresh)notes.push(trashNewNumber(yourrestCode(fresh.number)));}
 return{ok:true,id:record.id,type,notes};
}

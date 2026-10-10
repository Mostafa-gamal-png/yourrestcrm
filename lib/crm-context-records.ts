import type {Kind,Member,Row} from './crm';
import type {ServiceCase} from './customer-service';
import {memberCanAccessRegion,regionScope,regionRecords} from './regions';
import {salesRecordAccess} from './access';

export type ContextLoad = {load?:'full'|'identity'|'customers'|'directory'} | {load:'mobile';stopIds?:string[];dayId?:string} | {load:'customer-graph';customerId?:string;recordIds?:string[]};
const recordColumns=`id,kind,parent_id AS parentId,assigned_to AS assignedTo,branch,data,created_at AS createdAt,updated_at AS updatedAt,version,
 CASE WHEN kind='customer' THEN (SELECT printf('YR-C-%06d',number) FROM crm_customer_numbers WHERE customer_id=crm_records.id) END AS internalCode,
 CASE WHEN kind='customer' THEN (SELECT json_group_array(source_code) FROM crm_customer_code_aliases WHERE customer_id=crm_records.id) END AS erpCodeAliases`;
const serviceColumns='id,customer_id AS customerId,status,creator_id AS creatorId,service_manager_id AS serviceManagerId,sales_manager_id AS salesManagerId,assigned_to AS assignedTo,supervisor_id AS supervisorId,data,created_at AS createdAt,updated_at AS updatedAt,version';
type RecordRow=Omit<Row,'data'>&{data:string;internalCode?:string|null;erpCodeAliases?:string|null};
type ServiceRow=Omit<ServiceCase,'data'>&{data:string};
const decode=<T extends {data:string;kind?:string;internalCode?:string|null;erpCodeAliases?:string|null}>(rows:T[])=>rows.map(row=>{
 const {internalCode,erpCodeAliases,...record}=row;
 return {...record,data:{...JSON.parse(row.data),...(row.kind==='customer'?{internalCode:internalCode||'',_erpCodeAliases:JSON.parse(erpCodeAliases||'[]')}:{})}};
});

/** Request-local reads only: authorization is never cached between requests. */
export async function loadContextRecords(db:D1Database,me:Member,options:ContextLoad,members:Member[]=[]):Promise<{all:Row[];serviceCases:ServiceCase[]}>{
 let all:Row[]=[],serviceCases:ServiceCase[]=[];
 if(options.load==='identity')return{all,serviceCases};
 if(options.load==='directory')return me.role==='admin'?loadContextRecords(db,me,{load:'full'},members):loadDirectoryRecords(db,me,members);
 if(options.load==='customer-graph'){
  // Include the persisted record's lineage as well as the selected customer.
  // This preserves hidden-record retry checks and cross-customer edit errors.
  // The normal region/author scopers and commit guards remain authoritative.
  const ids=[options.customerId,...(options.recordIds||[]).slice(0,5)].filter((id):id is string=>typeof id==='string'&&id.length>0&&id.length<=200);
  const rows=await db.prepare(`WITH RECURSIVE lineage(id,kind,parent_id) AS (
   SELECT id,kind,parent_id FROM crm_records WHERE id IN (SELECT value FROM json_each(?))
   UNION SELECT parent.id,parent.kind,parent.parent_id FROM crm_records parent JOIN lineage child ON parent.id=child.parent_id WHERE child.kind<>'customer'
  ), family(id) AS (
   SELECT id FROM lineage WHERE kind='customer'
   UNION SELECT child.id FROM crm_records child JOIN family parent ON child.parent_id=parent.id WHERE child.kind<>'customer'
  ) SELECT ${recordColumns} FROM crm_records WHERE id IN (SELECT id FROM family UNION SELECT id FROM lineage) ORDER BY created_at DESC`).bind(JSON.stringify(ids)).all<RecordRow>();
  all=decode(rows.results) as Row[];
  const roots=JSON.stringify(all.filter(row=>row.kind==='customer').map(row=>row.id));
  serviceCases=decode((await db.prepare(`SELECT ${serviceColumns} FROM crm_service_cases WHERE customer_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC,id DESC`).bind(roots).all<ServiceRow>()).results) as ServiceCase[];
  return{all,serviceCases};
 }
 if(options.load==='mobile'){
  // Every branch binds the authenticated member. Include only the open stop,
  // explicitly replayed stops and the requested day's stops (max 200/day).
  // Keep the root even after a region change so existing guards reject it.
  const stopIds=(options.stopIds||[]).slice(0,50).filter(id=>typeof id==='string'&&id.length<=200);
  const dayId=typeof options.dayId==='string'&&options.dayId.length<=200?options.dayId:'';
  // CROSS JOIN fixes the tiny roots set as the outer loop, so SQLite looks up
  // each primary key instead of walking every customer through its kind index.
  const rows=await db.prepare(`SELECT ${recordColumns} FROM (
   SELECT customer_id FROM crm_journey_stops WHERE member_id=? AND closed_at IS NULL
   UNION SELECT customer_id FROM crm_journey_stops WHERE member_id=? AND id IN (SELECT value FROM json_each(?))
   UNION SELECT customer_id FROM crm_journey_stops WHERE member_id=? AND date=(SELECT date FROM crm_mobile_route_days WHERE id=? AND member_id=?)
  ) permissionRoots CROSS JOIN crm_records ON crm_records.id=permissionRoots.customer_id WHERE crm_records.kind='customer' ORDER BY created_at DESC`).bind(me.id,me.id,JSON.stringify(stopIds),me.id,dayId,me.id).all<RecordRow>();
  return{all:decode(rows.results) as Row[],serviceCases};
 }
 if(options.load==='customers'||regionScope(me)!=='all'){
  // Keep all customer masters for global duplicate-code/branch validation.
  // Historic author/team visibility is still decided by the existing scopers.
  all=decode((await db.prepare(`SELECT ${recordColumns} FROM crm_records WHERE kind='customer' ORDER BY created_at DESC`).all<RecordRow>()).results) as Row[];
  if(options.load==='customers')return{all,serviceCases};
  const roots=JSON.stringify(all.filter(row=>memberCanAccessRegion(me,row.data.region)).map(row=>row.id));
  const descendants=await db.prepare(`WITH RECURSIVE regional(id) AS (
   SELECT value FROM json_each(?)
   UNION SELECT child.id FROM crm_records child JOIN regional parent ON child.parent_id=parent.id WHERE child.kind<>'customer'
  ) SELECT ${recordColumns} FROM crm_records WHERE kind<>'customer' AND id IN (SELECT id FROM regional) ORDER BY created_at DESC`).bind(roots).all<RecordRow>();
  all=[...all,...decode(descendants.results) as Row[]].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  serviceCases=decode((await db.prepare(`SELECT ${serviceColumns} FROM crm_service_cases WHERE customer_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC,id DESC`).bind(roots).all<ServiceRow>()).results) as ServiceCase[];
 }else{
  all=decode((await db.prepare(`SELECT ${recordColumns} FROM crm_records ORDER BY created_at DESC`).all<RecordRow>()).results) as Row[];
  serviceCases=decode((await db.prepare(`SELECT ${serviceColumns} FROM crm_service_cases ORDER BY created_at DESC,id DESC`).all<ServiceRow>()).results) as ServiceCase[];
 }
 return{all,serviceCases};
}

/** Read-only directory projection: do not hydrate private activity bodies just
 * to discard them. Author precedence remains JavaScript, not a SQL facsimile. */
async function loadDirectoryRecords(db:D1Database,me:Member,members:Member[]){
 const masters=decode((await db.prepare(`SELECT ${recordColumns} FROM crm_records WHERE kind IN ('customer','factory') ORDER BY created_at DESC`).all<RecordRow>()).results) as Row[];
 const roots=JSON.stringify(masters.filter(row=>row.kind==='customer'&&memberCanAccessRegion(me,row.data.region)).map(row=>row.id));
 const global=regionScope(me)==='all';
 const prefix=global?'':`WITH RECURSIVE regional(id) AS (SELECT value FROM json_each(?) UNION SELECT child.id FROM crm_records child JOIN regional parent ON child.parent_id=parent.id WHERE child.kind<>'customer') `;
 // Multiple-path json_extract emits a JSON array, retaining boolean/object/null
 // types as well as strings. This preserves recordAuthorId's legacy coercions.
 // One compact tuple array avoids creating thousands of native SQLite result
 // objects. Only id/kind/parent/author evidence is needed before hydration.
 const metaSql=prefix+`SELECT json_group_array(json_array(id,kind,parent_id,json(json_extract(data,'$.performedBy','$.recordedByEmail','$.responsibleId','$.serviceCaseId')))) AS items FROM crm_records WHERE kind NOT IN ('customer','factory')${global?'':' AND id IN (SELECT id FROM regional)'}`;
 const prepared=db.prepare(metaSql),rawMetadata=await (global?prepared:prepared.bind(roots)).first<{items:string}>();
 const metadata=(JSON.parse(rawMetadata?.items||'[]') as [string,Kind,string|null,unknown[]][]).map(([id,kind,parentId,[performedBy,recordedByEmail,responsibleId,serviceCaseId]])=>({id,kind,parentId,data:{performedBy,recordedByEmail,responsibleId,serviceCaseId}} as Row));
 const serviceSql=`SELECT ${serviceColumns} FROM crm_service_cases${global?'':' WHERE customer_id IN (SELECT value FROM json_each(?))'} ORDER BY created_at DESC,id DESC`,serviceQuery=db.prepare(serviceSql);
 const serviceCases=decode((await (global?serviceQuery:serviceQuery.bind(roots)).all<ServiceRow>()).results) as ServiceCase[];
 const source=[...masters,...metadata],regional=regionRecords(source,me),regionalIds=new Set(regional.map(row=>row.id)),indexed=new Map(source.map(row=>[row.id,row])),access=salesRecordAccess(members,me),caseIds=new Set(serviceCases.map(item=>item.id)),selected=new Set<string>();
 for(const row of source){
  // All service contacts are required for status/locking even when their author
  // is invisible to this reader. The unchanged final projection hides them.
  if(!regionalIds.has(row.id)||!access.canRead(row)&&!(row.kind==='activity'&&caseIds.has(row.data.serviceCaseId)))continue;
  let current:Row|undefined=row;const seen=new Set<string>();
  while(current&&!seen.has(current.id)){seen.add(current.id);selected.add(current.id);if(current.kind==='customer')break;current=current.parentId?indexed.get(current.parentId):undefined;}
 }
 const ids=JSON.stringify(metadata.filter(row=>selected.has(row.id)).map(row=>row.id));
 const hydrated=decode((await db.prepare(`SELECT ${recordColumns} FROM crm_records WHERE id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC`).bind(ids).all<RecordRow>()).results) as Row[];
 return{all:[...masters,...hydrated].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),serviceCases};
}

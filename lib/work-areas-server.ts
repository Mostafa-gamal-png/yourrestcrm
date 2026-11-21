import {z} from 'zod';
import {CRMError,accessGuard} from './crm-server';
import {salesScopeMemberIds} from './access';
import {memberCanAccessRegion,regionScope,regionScopesOverlap} from './regions';
import {customerCoordinates} from './customer-location';
import {mapActivity} from './customer-map-activity';
import {FIELD_ROLES_SQL,isFieldRole} from './roles';
import {isServiceRole} from './customer-service';
import type {Member} from './crm';
import {bboxContains,checkWorkAreaPolygon,FALLBACK_BUFFER_METRES,pinClusters,ringToGeoJson,SAUDI_BOUNDS,type LatLng} from './work-area-geometry';
import {mayDrawWorkAreas,type WorkAreaInfo,type WorkAreaRep,type WorkAreaView} from './work-areas';

/** The server side of the representatives' work areas on «خريطة المصانع» (the owner, 2026-11-19: the port of GSCO 2.13.81; lib/work-areas.ts
 * says what the page shows). Migration 0023 (crm_work_areas). The purple streets with no customer (GSCO 2.13.82) were removed on 2026-11-21
 * («جزء الشوارع البنفسجية متعملوش هنا ملوش لازمة»): their route is gone, and nothing reads or writes the two street tables of migrations
 * 0023 and 0024 any more; they stay in the schema (db/schema.ts), unused, because the migrations are applied on the live database.
 * GET  /api/work-areas?list=1          the representatives the reader may look at: a field member (a representative or a marketing officer,
 *                                      lib/roles.ts) himself; a supervisor, a sales manager or the administrator the active field members of
 *                                      their team (lib/access.ts salesScopeMemberIds, wider for reading with «عرض بيانات الفريق بالكامل») whose
 *                                      regions meet theirs (lib/regions.ts), with or without customers. Customer service: none (403).
 * GET  /api/work-areas?member=<id>     that representative's area: the one drawn, or else 500 m around each pin of the customers he is
 *                                      responsible for that are not «خامل», among the customers of the reader's regions.
 * POST /api/work-areas                 save or delete a drawn area: «رسم مناطق عمل المناديب» (the administrator, the sales manager), only for a
 *                                      field member of their team as the role defines it (never through «عرض بيانات الفريق بالكامل»). */
type Ctx={db:D1Database;me:Member;members:Member[]};
export const WORK_AREA_MESSAGES={
 chooseRep:'اختر المندوب.',ownOnly:'يمكنك عرض منطقة عملك فقط.',notTeam:'هذا المندوب ليس ضمن فريقك.',
 noRight:'ليس لديك صلاحية رسم مناطق عمل المناديب.',invalid:'بيانات منطقة العمل غير صحيحة.',
 conflict:'تغيّرت منطقة العمل منذ فتح الخريطة. حدّث الخريطة وحاول مجددًا.',changed:'تغيّرت منطقة العمل أو صلاحياتك. حدّث الخريطة وحاول مجددًا.',
 noArea:'لا توجد منطقة عمل مرسومة لهذا المندوب.',
} as const;
/** The audit rows of a save and a delete (crm_audit: kept out of GET /api/crm's recent changes; the down migration removes them). The id of a
 *  delete's row is its request's receipt. */
export const WORK_AREA_AUDIT_PREFIX='work-area:';
export const workAreaReceipt=(requestId:string)=>WORK_AREA_AUDIT_PREFIX+requestId;
/** Ids come from a select list; invisible marks pasted around one are dropped, anything else must match exactly. */
export const cleanRepId=(value:unknown)=>String(value??'').replace(/[­؜​-‏‪-‮⁠-⁩﻿]/g,'').trim();

/** The representatives the reader may look at (write: may draw for, the team as the role defines it). Active field members only. */
export function workAreaTeam(c:Pick<Ctx,'me'|'members'>,{write=false}:{write?:boolean}={}):Member[]{
 if(isServiceRole(c.me.role))return [];
 if(isFieldRole(c.me.role))return !write&&c.me.active?[c.me]:[];
 const scope=salesScopeMemberIds(c.members,c.me,{read:!write});
 return c.members.filter(m=>m.id!==c.me.id&&isFieldRole(m.role)&&!!m.active&&scope.has(m.id)&&regionScopesOverlap(regionScope(c.me),regionScope(m)));
}
function targetRep(c:Ctx,raw:unknown,write=false):Member{
 const id=cleanRepId(raw)||(isFieldRole(c.me.role)&&!write?c.me.id:'');
 if(!id||id.length>200)throw new CRMError(WORK_AREA_MESSAGES.chooseRep,400);
 if(isFieldRole(c.me.role)&&id!==c.me.id)throw new CRMError(WORK_AREA_MESSAGES.ownOnly,403);
 const rep=workAreaTeam(c,{write}).find(m=>m.id===id);
 if(!rep)throw new CRMError(WORK_AREA_MESSAGES.notTeam,403);
 return rep;
}
/** At commit: the representative is still an active field member with the same regions (a supervisor's own representative is the supervisor's
 *  write team, but a supervisor never draws). */
const repGate=(rep:Member)=>({sql:`EXISTS (SELECT 1 FROM crm_members WHERE id=? AND active=1 AND role IN ${FIELD_ROLES_SQL} AND region_scope=?)`,args:[rep.id,regionScope(rep)]});

const json=(text:string)=>{try{const value=JSON.parse(text);return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}catch{return null;}};
const roundPin=(p:LatLng):LatLng=>[Math.round(p[0]*1e6)/1e6,Math.round(p[1]*1e6)/1e6];
/** The fallback's pins: the customers the representative is responsible for (crm_records.assigned_to) with a point on the map inside the
 *  Kingdom, «خامل» ones left out (lib/customer-map-activity.ts), among the customers of the reader's regions (the reader sees them all on the
 *  map already). Each place once. */
export async function repPins(c:Pick<Ctx,'db'|'me'>,repId:string):Promise<LatLng[]>{
 const rows=(await c.db.prepare("SELECT data FROM crm_records WHERE kind='customer' AND assigned_to=?").bind(repId).all<{data:string}>()).results;
 const pins=new Map<string,LatLng>();
 for(const row of rows){
  const data=json(row.data);if(!data||mapActivity({data}).key==='inactive'||!memberCanAccessRegion(c.me,data.region))continue;
  const point=customerCoordinates(data as {latitude?:number|null;longitude?:number|null;location?:string});
  if(!point)continue;
  const pin=roundPin([point.latitude,point.longitude]);if(!bboxContains(SAUDI_BOUNDS,pin))continue;
  pins.set(pin.join(','),pin);
 }
 return [...pins.values()];
}
type AreaRow={polygon:string;version:number;updated_at:string;updated_by_name:string|null};
const km2=(m2:number)=>Math.round(m2/10_000)/100;
export async function repArea(c:Pick<Ctx,'db'|'me'>,repId:string):Promise<WorkAreaInfo>{
 const row=await c.db.prepare('SELECT a.polygon,a.version,a.updated_at,u.name AS updated_by_name FROM crm_work_areas a LEFT JOIN crm_members u ON u.id=a.updated_by WHERE a.member_id=?').bind(repId).first<AreaRow>();
 if(row){
  let check:ReturnType<typeof checkWorkAreaPolygon>={ok:false,error:''};try{check=checkWorkAreaPolygon(JSON.parse(row.polygon));}catch{/* a damaged row falls back below */}
  if(check.ok)return {source:'drawn',rings:[check.ring],centers:[],radius:0,clusters:1,area_km2:km2(check.areaM2),version:Number(row.version),updated_at:row.updated_at,updated_by_name:row.updated_by_name,pins:0};
 }
 const centers=await repPins(c,repId);
 return {source:centers.length?'fallback':'none',rings:[],centers,radius:FALLBACK_BUFFER_METRES,clusters:pinClusters(centers).length,area_km2:null,version:row?Number(row.version):null,updated_at:null,updated_by_name:null,pins:centers.length};
}

export async function workAreasGet(c:Ctx,url:URL):Promise<WorkAreaView|{reps:WorkAreaRep[]}>{
 if(url.searchParams.get('list')==='1'){
  const team=workAreaTeam(c);
  const drawn=new Set(team.length?(await c.db.prepare('SELECT member_id FROM crm_work_areas WHERE member_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(team.map(m=>m.id))).all<{member_id:string}>()).results.map(row=>row.member_id):[]);
  return {reps:team.map(m=>({id:m.id,name:m.name,drawn:drawn.has(m.id)})).sort((a,b)=>a.name.localeCompare(b.name,'ar')||a.id.localeCompare(b.id)).slice(0,1000)};
 }
 const rep=targetRep(c,url.searchParams.get('member'));
 return {rep_id:rep.id,rep_name:rep.name,area:await repArea(c,rep.id),can_edit:mayDrawWorkAreas(c.me)&&workAreaTeam(c,{write:true}).some(m=>m.id===rep.id)};
}

const requestId=z.string().uuid();
const postBody=z.discriminatedUnion('action',[
 z.object({action:z.literal('save'),rep_id:z.string().min(1).max(260),polygon:z.unknown(),version:z.number().int().positive().nullable(),request_id:requestId}).strict(),
 z.object({action:z.literal('delete'),rep_id:z.string().min(1).max(260),version:z.number().int().positive(),request_id:requestId}).strict(),
]);
type StoredRow={member_id:string;polygon:string;vertices:number;area_m2:number;version:number;mutation_id:string};

/** The highest version a representative's area ever had, read from the audit rows of its deletions (a deleted area's row is gone, its
 *  version is in the row of the delete). A new area continues after it, so a page that still holds the deleted area's version can never
 *  save over, or delete, the area drawn since (review 2026-11-19: the versions began again at 1 after a delete). */
const lastDeletedVersion=`COALESCE((SELECT MAX(CAST(json_extract(detail,'$.before.version') AS INTEGER)) FROM crm_audit WHERE record_id=? AND action='${WORK_AREA_AUDIT_PREFIX}delete' AND json_valid(detail)),0)`;
/** Saving is versioned (null for the first area) and audited once; resending the same request after a lost answer saves nothing twice. The
 *  commit re-checks the writer (accessGuard: role, branch, regions, supervisor, permissions' version) and the representative. */
export async function workAreasPost(c:Ctx,body:unknown){
 // The right first (a supervisor or a field member is refused whatever they send), then the request's shape.
 if(!mayDrawWorkAreas(c.me))throw new CRMError(WORK_AREA_MESSAGES.noRight,403);
 const parsed=postBody.safeParse(body);if(!parsed.success)throw new CRMError(WORK_AREA_MESSAGES.invalid,400);
 const p=parsed.data;
 const rep=targetRep(c,p.rep_id,true);
 // A request that went through already (its answer was lost) is done, whatever happened to the area since: its audit row is its receipt,
 // written in the same transaction. Sent again it writes nothing, never a second save or a delete of another area drawn meanwhile.
 const receipt=await c.db.prepare('SELECT action,record_id,detail FROM crm_audit WHERE id=?').bind(workAreaReceipt(p.request_id)).first<{action:string;record_id:string;detail:string}>();
 if(receipt){
  if(receipt.action!==WORK_AREA_AUDIT_PREFIX+p.action||receipt.record_id!==WORK_AREA_AUDIT_PREFIX+rep.id)throw new CRMError(WORK_AREA_MESSAGES.conflict,409,{code:'WORK_AREA_CONFLICT'});
  const after=(json(receipt.detail)?.after??null) as {version?:unknown}|null,version=p.action==='save'&&Number.isInteger(after?.version)?Number(after!.version):null;
  return {ok:true,rep_id:rep.id,version,repeated:true};
 }
 const existing=await c.db.prepare('SELECT member_id,polygon,vertices,area_m2,version,mutation_id FROM crm_work_areas WHERE member_id=?').bind(rep.id).first<StoredRow>();
 const before=existing?{vertices:Number(existing.vertices),area_km2:km2(Number(existing.area_m2)),version:Number(existing.version)}:null;
 const guard=accessGuard({me:c.me,members:c.members,all:[]}),target=repGate(rep),gate=guard.sql+' AND '+target.sql,gateArgs=[...guard.args,...target.args],stamp=new Date().toISOString();
 const audit=(action:'save'|'delete',detail:Record<string,unknown>,when:{sql:string;args:(string|number)[]})=>c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${when.sql}`)
  .bind(workAreaReceipt(p.request_id),WORK_AREA_AUDIT_PREFIX+rep.id,c.me.name,WORK_AREA_AUDIT_PREFIX+action,JSON.stringify({rep_id:rep.id,request_id:p.request_id,...detail}),stamp,...when.args);
 if(p.action==='save'){
  if(existing?.mutation_id===p.request_id)return {ok:true,rep_id:rep.id,version:Number(existing.version),repeated:true};
  const check=checkWorkAreaPolygon(p.polygon);
  if(!check.ok)throw new CRMError(check.error,400);
  if((existing?Number(existing.version):null)!==p.version)throw new CRMError(WORK_AREA_MESSAGES.conflict,409,{code:'WORK_AREA_CONFLICT'});
  const polygon=JSON.stringify(ringToGeoJson(check.ring));
  const deleted=existing?0:Number((await c.db.prepare(`SELECT ${lastDeletedVersion} AS v`).bind(WORK_AREA_AUDIT_PREFIX+rep.id).first<{v:number}>())?.v??0);
  const version=(existing?Number(existing.version):deleted)+1;
  // A new area takes the version after the last deleted one; a delete committed meanwhile (a newer deleted version) refuses it (409).
  const write=existing
   ?c.db.prepare(`UPDATE crm_work_areas SET polygon=?,vertices=?,area_m2=?,updated_by=?,updated_at=?,version=version+1,mutation_id=? WHERE member_id=? AND version=? AND ${gate}`)
     .bind(polygon,check.ring.length,check.areaM2,c.me.id,stamp,p.request_id,rep.id,Number(existing.version),...gateArgs)
   :c.db.prepare(`INSERT INTO crm_work_areas(member_id,polygon,vertices,area_m2,updated_by,updated_at,version,mutation_id) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM crm_work_areas WHERE member_id=?) AND ${lastDeletedVersion}<? AND ${gate}`)
     .bind(rep.id,polygon,check.ring.length,check.areaM2,c.me.id,stamp,version,p.request_id,rep.id,WORK_AREA_AUDIT_PREFIX+rep.id,version,...gateArgs);
  const results=await c.db.batch([write,audit('save',{before,after:{vertices:check.ring.length,area_km2:km2(check.areaM2),version}},{sql:'EXISTS (SELECT 1 FROM crm_work_areas WHERE member_id=? AND mutation_id=? AND version=?)',args:[rep.id,p.request_id,version]})]);
  if(!results[0].meta.changes)throw new CRMError(WORK_AREA_MESSAGES.changed,409,{code:'WORK_AREA_CONFLICT'});
  return {ok:true,rep_id:rep.id,version};
 }
 // (A delete that already went through, its answer lost, was answered above by its receipt.)
 if(!existing)throw new CRMError(WORK_AREA_MESSAGES.noArea,404);
 if(Number(existing.version)!==p.version)throw new CRMError(WORK_AREA_MESSAGES.conflict,409,{code:'WORK_AREA_CONFLICT'});
 const results=await c.db.batch([
  c.db.prepare(`DELETE FROM crm_work_areas WHERE member_id=? AND version=? AND ${gate}`).bind(rep.id,Number(existing.version),...gateArgs),
  audit('delete',{before,after:null},{sql:'changes()=1',args:[]}),
 ]);
 if(!results[0].meta.changes)throw new CRMError(WORK_AREA_MESSAGES.changed,409,{code:'WORK_AREA_CONFLICT'});
 return {ok:true,rep_id:rep.id,version:null};
}

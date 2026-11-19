import {z} from 'zod';
import {CRMError,accessGuard} from './crm-server';
import {salesScopeMemberIds} from './access';
import {memberCanAccessRegion,regionScope,regionScopesOverlap} from './regions';
import {customerCoordinates} from './customer-location';
import {mapActivity} from './customer-map-activity';
import {FIELD_ROLES_SQL,isFieldRole} from './roles';
import {isServiceRole} from './customer-service';
import type {Member} from './crm';
import {areaWithinLimits,bboxContains,bboxGrow,bboxOf,bboxSidesKm,checkWorkAreaPolygon,FALLBACK_BUFFER_METRES,NEAR_PROJECT_METRES,pinClusters,pinDisks,ringToGeoJson,SAUDI_BOUNDS,WORK_AREA_LIMITS,type Area,type BBox,type LatLng} from './work-area-geometry';
import {boxCells,decodeStreets,emptyStreetSegments,encodeStreets,overpassQuery,parseOverpassStreets,STREET_LIMITS,streetBox,type EmptySegment,type StreetWay} from './work-area-streets';
import {mayDrawWorkAreas,type StreetStatus,type WorkAreaInfo,type WorkAreaRep,type WorkAreaStreets,type WorkAreaView} from './work-areas';

/** The server side of the representatives' work areas and the streets with no customer on «خريطة المصانع» (the owner, 2026-11-19: the port of
 * GSCO 2.13.81 and 2.13.82; lib/work-areas.ts says what the page shows). Migrations 0023 (crm_work_areas, crm_osm_street_cache) and 0024
 * (crm_osm_street_local).
 * GET  /api/work-areas?list=1          the representatives the reader may look at: a field member (a representative or a marketing officer,
 *                                      lib/roles.ts) himself; a supervisor, a sales manager or the administrator the active field members of
 *                                      their team (lib/access.ts salesScopeMemberIds, wider for reading with «عرض بيانات الفريق بالكامل») whose
 *                                      regions meet theirs (lib/regions.ts), with or without customers. Customer service: none (403).
 * GET  /api/work-areas?member=<id>     that representative's area: the one drawn, or else 500 m around each pin of the customers he is
 *                                      responsible for that are not «خامل», among the customers of the reader's regions.
 * POST /api/work-areas                 save or delete a drawn area: «رسم مناطق عمل المناديب» (the administrator, the sales manager), only for a
 *                                      field member of their team as the role defines it (never through «عرض بيانات الفريق بالكامل»).
 * GET  /api/work-area-streets?member=<id> the pieces of that area's streets with no customer of the whole company within 50 m: lines and street
 *                                      names only, never a customer. From the local data first (crm_osm_street_local, imported by
 *                                      portable/import-street-data.mjs), else OpenStreetMap's Overpass API on the server only, one request at a
 *                                      time, cached 30 days per box. */
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
export const STREET_CACHE_DAYS=30;
/** At most this many groups of the fallback per answer (the biggest), and at most this many new OpenStreetMap lookups per answer; the rest
 * come from the cache or on a later visit. */
export const MAX_CLUSTERS=12,MAX_NEW_LOOKUPS=3;
const dayMs=24*3600_000;

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
/** Every customer of the company with a point on the map, whatever the reader may see and whatever its state (a «خامل» factory is still a
 *  factory on that street): only the points, for the 50 m rule; nothing of them leaves the server. */
export async function companyPins(db:D1Database):Promise<LatLng[]>{
 const rows=(await db.prepare("SELECT json_extract(data,'$.latitude') AS latitude,json_extract(data,'$.longitude') AS longitude,json_extract(data,'$.location') AS location FROM crm_records WHERE kind='customer'").all<{latitude:unknown;longitude:unknown;location:unknown}>()).results;
 const out:LatLng[]=[];
 for(const row of rows){
  const point=customerCoordinates({latitude:typeof row.latitude==='number'?row.latitude:null,longitude:typeof row.longitude==='number'?row.longitude:null,location:typeof row.location==='string'?row.location:''});
  if(point)out.push([point.latitude,point.longitude]);
 }
 return out;
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

/** Saving is versioned (null for the first area) and audited once; resending the same request after a lost answer saves nothing twice. The
 *  commit re-checks the writer (accessGuard: role, branch, regions, supervisor, permissions' version) and the representative. */
export async function workAreasPost(c:Ctx,body:unknown){
 // The right first (a supervisor or a field member is refused whatever they send), then the request's shape.
 if(!mayDrawWorkAreas(c.me))throw new CRMError(WORK_AREA_MESSAGES.noRight,403);
 const parsed=postBody.safeParse(body);if(!parsed.success)throw new CRMError(WORK_AREA_MESSAGES.invalid,400);
 const p=parsed.data;
 const rep=targetRep(c,p.rep_id,true);
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
  const polygon=JSON.stringify(ringToGeoJson(check.ring)),version=(existing?Number(existing.version):0)+1;
  const write=existing
   ?c.db.prepare(`UPDATE crm_work_areas SET polygon=?,vertices=?,area_m2=?,updated_by=?,updated_at=?,version=version+1,mutation_id=? WHERE member_id=? AND version=? AND ${gate}`)
     .bind(polygon,check.ring.length,check.areaM2,c.me.id,stamp,p.request_id,rep.id,Number(existing.version),...gateArgs)
   :c.db.prepare(`INSERT INTO crm_work_areas(member_id,polygon,vertices,area_m2,updated_by,updated_at,version,mutation_id) SELECT ?,?,?,?,?,?,1,? WHERE NOT EXISTS (SELECT 1 FROM crm_work_areas WHERE member_id=?) AND ${gate}`)
     .bind(rep.id,polygon,check.ring.length,check.areaM2,c.me.id,stamp,p.request_id,rep.id,...gateArgs);
  const results=await c.db.batch([write,audit('save',{before,after:{vertices:check.ring.length,area_km2:km2(check.areaM2),version}},{sql:'EXISTS (SELECT 1 FROM crm_work_areas WHERE member_id=? AND mutation_id=? AND version=?)',args:[rep.id,p.request_id,version]})]);
  if(!results[0].meta.changes)throw new CRMError(WORK_AREA_MESSAGES.changed,409,{code:'WORK_AREA_CONFLICT'});
  return {ok:true,rep_id:rep.id,version};
 }
 if(!existing){
  // A delete that already went through (its answer was lost) is done, not an error.
  const done=await c.db.prepare('SELECT 1 AS done FROM crm_audit WHERE id=? AND action=? AND record_id=?').bind(workAreaReceipt(p.request_id),WORK_AREA_AUDIT_PREFIX+'delete',WORK_AREA_AUDIT_PREFIX+rep.id).first<{done:number}>();
  if(done)return {ok:true,rep_id:rep.id,version:null,repeated:true};
  throw new CRMError(WORK_AREA_MESSAGES.noArea,404);
 }
 if(Number(existing.version)!==p.version)throw new CRMError(WORK_AREA_MESSAGES.conflict,409,{code:'WORK_AREA_CONFLICT'});
 const results=await c.db.batch([
  c.db.prepare(`DELETE FROM crm_work_areas WHERE member_id=? AND version=? AND ${gate}`).bind(rep.id,Number(existing.version),...gateArgs),
  audit('delete',{before,after:null},{sql:'changes()=1',args:[]}),
 ]);
 if(!results[0].meta.changes)throw new CRMError(WORK_AREA_MESSAGES.changed,409,{code:'WORK_AREA_CONFLICT'});
 return {ok:true,rep_id:rep.id,version:null};
}

// ---- OpenStreetMap through Overpass: server only, one request at a time, a 30-day cache per box, and a pause after «too many requests».
// GSCO 2.13.82 (2026-11-19: overpass-api.de answered 502 «at capacity» and the mirrors timed out): the streets are kept locally where they were
// imported (crm_osm_street_local, portable/import-street-data.mjs) and Overpass is asked only for a box with no local data. Several services may
// be named (tried in order); a service that answers 429, 502, 503 or 504, or does not answer at all, is paused for two minutes.
export const OVERPASS_DEFAULT_URLS=['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter'] as const;
export const OVERPASS_USER_AGENT='Yourrest-CRM (+https://crm.yourrest.org; work-area streets, cached 30 days)';
const MAX_ANSWER_BYTES=24*1024*1024,MAX_CACHE_BYTES=8*1024*1024,QUEUE_LIMIT=3,MAX_OVERPASS_URLS=4;
export const OVERPASS_PAUSE_MS=120_000;
/** One street answer waits at most this long for Overpass in all; boxes left after it come on a later visit («partial»). */
export const OVERPASS_ANSWER_BUDGET_MS=45_000;
/** At most this many cells per looked-up box are read from the local data (a box of 15 km is about 16 × 16 cells). */
const MAX_LOCAL_CELLS=400;
type OverpassSettings={urls:string[];fetcher:typeof fetch;timeoutMs:number;userAgent:string};
let overpass:OverpassSettings={urls:[...OVERPASS_DEFAULT_URLS],fetcher:(...args)=>fetch(...args),timeoutMs:30_000,userAgent:OVERPASS_USER_AGENT};
/** HTTPS only; plain HTTP only to this machine (the tests' stand-in). A bad setting keeps the default. */
export function validOverpassUrl(value:string){
 try{const u=new URL(value);return !u.username&&!u.password&&!u.hash&&(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)));}catch{return false;}
}
/** The services to ask, in order: YR_OVERPASS_URL (settings.cjs, optional) may name one or several separated by commas; invalid ones are
 * dropped, and none left (or none set) means the defaults. */
export function overpassUrls(value:string|null|undefined):string[]{
 const list=[...new Set(String(value??'').split(',').map(v=>v.trim()).filter(v=>v&&validOverpassUrl(v)))].slice(0,MAX_OVERPASS_URLS);
 return list.length?list:[...OVERPASS_DEFAULT_URLS];
}
export function configureOverpass(next:Partial<Omit<OverpassSettings,'urls'>>&{url?:string|null}){
 const {url,...rest}=next;
 overpass={...overpass,...rest,urls:url===undefined?overpass.urls:overpassUrls(url)};
}
type Fetched={ok:true;ways:StreetWay[]}|{ok:false;reason:string};
let tail:Promise<unknown>=Promise.resolve(),waiting=0,calls=0;
const inflight=new Map<string,Promise<Fetched>>(),pausedUntil=new Map<string,number>();
const paused=(url:string,now=Date.now())=>(pausedUntil.get(url)??0)>now;
/** `coolUntil` is when the first service may be asked again while every service is paused (0 while one may be asked). */
export function overpassState(){
 const now=Date.now(),until=overpass.urls.map(u=>pausedUntil.get(u)??0);
 return {waiting,coolUntil:until.every(t=>t>now)?Math.min(...until):0,calls,inflight:inflight.size,urls:[...overpass.urls],paused:overpass.urls.filter(u=>paused(u,now))};
}
export function resetOverpassState(){tail=Promise.resolve();waiting=0;calls=0;inflight.clear();pausedUntil.clear();}

async function readCapped(response:Response){
 const declared=Number(response.headers.get('content-length')||0);if(declared>MAX_ANSWER_BYTES)return null;
 const reader=response.body?.getReader();if(!reader){const t=await response.text();return t.length>MAX_ANSWER_BYTES?null:t;}
 const decoder=new TextDecoder(),parts:string[]=[];let bytes=0;
 for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_ANSWER_BYTES){try{await reader.cancel();}catch{/* dropped */}return null;}parts.push(decoder.decode(value,{stream:true}));}
 parts.push(decoder.decode());return parts.join('');
}
/** «Busy» answers (502 «at capacity» too) and no answer at all (a network failure or the 30-second limit) pause that service. */
export const OVERPASS_BUSY_STATUSES:ReadonlySet<number>=new Set([429,502,503,504]);
async function callOverpass(url:string,box:BBox):Promise<Fetched>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),overpass.timeoutMs);
 calls++;
 try{
  const response=await overpass.fetcher(url,{method:'POST',headers:{'User-Agent':overpass.userAgent,Accept:'application/json','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},body:'data='+encodeURIComponent(overpassQuery(box)),redirect:'error',cache:'no-store',signal:controller.signal});
  if(OVERPASS_BUSY_STATUSES.has(response.status)){pausedUntil.set(url,Date.now()+OVERPASS_PAUSE_MS);try{await response.body?.cancel();}catch{/* dropped */}return {ok:false,reason:'busy_'+response.status};}
  if(!response.ok){try{await response.body?.cancel();}catch{/* dropped */}return {ok:false,reason:'http_'+response.status};}
  const raw=await readCapped(response);if(raw===null)return {ok:false,reason:'too_large'};
  let data:unknown;try{data=JSON.parse(raw);}catch{return {ok:false,reason:'json'};}
  return parseOverpassStreets(data);
 }catch{pausedUntil.set(url,Date.now()+OVERPASS_PAUSE_MS);return {ok:false,reason:'network'};}
 finally{clearTimeout(timer);}
}
/** The services in order, skipping paused ones, until one gives a complete answer (or the answer's time is up). */
async function askInTurn(box:BBox,deadline:number):Promise<Fetched>{
 let last:Fetched={ok:false,reason:'cooling'};
 for(const url of overpass.urls){
  if(paused(url))continue;
  if(Date.now()>=deadline)return {ok:false,reason:'later'};
  last=await callOverpass(url,box);
  if(last.ok)return last;
 }
 return last;
}
/** One Overpass request at a time for the whole server; the same box asked twice at once shares one request; a short queue only. */
export function fetchStreets(key:string,box:BBox,deadline:number):Promise<Fetched>{
 const same=inflight.get(key);if(same)return same;
 if(overpass.urls.every(u=>paused(u)))return Promise.resolve({ok:false,reason:'cooling'});
 if(waiting>=QUEUE_LIMIT)return Promise.resolve({ok:false,reason:'queue'});
 waiting++;
 const run=tail.then(()=>askInTurn(box,deadline)).finally(()=>{waiting--;inflight.delete(key);});
 tail=run.catch(()=>undefined);inflight.set(key,run);
 return run;
}

type LocalRow={ways:string;imported_at:string};
/** The box's streets from the local data, if any of its cells was imported. `complete` when every cell of the box was (a cell with no street
 * is stored empty, so the sea and the desert count). Local rows never expire and the cache cleanup never touches them. */
export async function localStreets(db:D1Database,box:BBox):Promise<{ways:StreetWay[];imported_at:string;complete:boolean}|null>{
 const c=boxCells(box);if(!c.count||c.count>MAX_LOCAL_CELLS)return null;
 const rows=(await db.prepare('SELECT ways,imported_at FROM crm_osm_street_local WHERE cell_lat BETWEEN ? AND ? AND cell_lng BETWEEN ? AND ?').bind(c.south,c.north,c.west,c.east).all<LocalRow>()).results;
 const ways:StreetWay[]=[];let good=0,oldest='';
 for(const row of rows){
  const decoded=decodeStreets(row.ways);if(!decoded)continue;
  good++;for(const way of decoded)ways.push(way);
  if(!oldest||row.imported_at<oldest)oldest=row.imported_at;
 }
 return good?{ways,imported_at:oldest,complete:good===c.count}:null;
}

type CacheRow={ways:string;fetched_at:string};
async function cachedStreets(db:D1Database,key:string){
 const row=await db.prepare('SELECT ways,fetched_at FROM crm_osm_street_cache WHERE bbox_key=?').bind(key).first<CacheRow>();
 const ways=row?decodeStreets(row.ways):null;
 return row&&ways?{ways,fetched_at:row.fetched_at}:null;
}
async function storeStreets(db:D1Database,key:string,box:BBox,ways:StreetWay[],stamp:string){
 const encoded=encodeStreets(ways);if(encoded.length>MAX_CACHE_BYTES)return;
 await db.batch([
  db.prepare('INSERT INTO crm_osm_street_cache(bbox_key,south,west,north,east,ways,way_count,fetched_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(bbox_key) DO UPDATE SET south=excluded.south,west=excluded.west,north=excluded.north,east=excluded.east,ways=excluded.ways,way_count=excluded.way_count,fetched_at=excluded.fetched_at')
   .bind(key,box.south,box.west,box.north,box.east,encoded,ways.length,stamp),
  // Boxes nobody asked for in three lifetimes go.
  db.prepare('DELETE FROM crm_osm_street_cache WHERE fetched_at<?').bind(new Date(Date.parse(stamp)-3*STREET_CACHE_DAYS*dayMs).toISOString()),
 ]);
}

type Part={area:Area;exclude?:Area};
/** The areas to look up: the drawn polygon as one, or the fallback's groups of disks (biggest first, at most MAX_CLUSTERS). Where two groups
 * were cut from one wide group their disks may overlap; a later group leaves out what an earlier one already covers, so no street counts twice. */
function lookupParts(area:WorkAreaInfo):{parts:Part[];total:number}{
 if(area.source==='drawn')return {parts:[{area:{rings:area.rings}}],total:1};
 const groups=pinClusters(area.centers,area.radius),parts:Part[]=[];
 for(const group of groups.slice(0,MAX_CLUSTERS)){
  const disks=pinDisks(group,area.radius),box=bboxGrow(bboxOf(disks)!,area.radius);
  const earlier=parts.flatMap(p=>p.area.rings.filter(r=>r.some(q=>bboxContains(box,q))));
  parts.push({area:disks,...(earlier.length?{exclude:{rings:earlier}}:{})});
 }
 return {parts,total:groups.length};
}
const withinLookupLimits=(part:Part)=>{const box=bboxOf(part.area);if(!box)return false;const sides=bboxSidesKm(box);return sides.height<=WORK_AREA_LIMITS.maxSideKm&&sides.width<=WORK_AREA_LIMITS.maxSideKm;};

export async function workAreaStreetsGet(c:Ctx,url:URL):Promise<WorkAreaStreets>{
 const rep=targetRep(c,url.searchParams.get('member')),area=await repArea(c,rep.id);
 const {parts,total}=area.source==='none'?{parts:[],total:0}:lookupParts(area);
 const segments:EmptySegment[]=[];let pieces=0,empty=0,pending=0,stale=false,incomplete=false,loaded=0,oldest:string|null=null,newLookups=0;
 const answer=(status:StreetStatus):WorkAreaStreets=>({rep_id:rep.id,area,status,fetched_at:oldest,segments,counts:{pieces,empty,returned:segments.length},clusters:{total,shown:parts.length,pending},truncated:empty>segments.length});
 if(!parts.length)return answer('no_area');
 if(area.source==='drawn'&&!areaWithinLimits(parts[0].area))return answer('too_large');
 const now=Date.now(),deadline=now+OVERPASS_ANSWER_BUDGET_MS,company=await companyPins(c.db);
 for(const part of parts){
  if(!withinLookupLimits(part)){pending++;continue;}
  const sb=streetBox(part.area)!,local=await localStreets(c.db,sb.box);
  let ways:StreetWay[]|null=null,fetched_at='';
  // A box inside the imported regions never asks Overpass; its date is the import's.
  if(local?.complete){ways=local.ways;fetched_at=local.imported_at;}
  else{
   const cached=await cachedStreets(c.db,sb.key);
   if(cached&&now-Date.parse(cached.fetched_at)<STREET_CACHE_DAYS*dayMs){ways=cached.ways;fetched_at=cached.fetched_at;}
   else{
    const got=newLookups<MAX_NEW_LOOKUPS&&Date.now()<deadline?(newLookups++,await fetchStreets(sb.key,sb.box,deadline)):{ok:false as const,reason:'later'};
    if(got.ok){fetched_at=new Date().toISOString();ways=got.ways;await storeStreets(c.db,sb.key,sb.box,ways,fetched_at);}
    else if(cached){ways=cached.ways;fetched_at=cached.fetched_at;stale=true;}
   }
   // A box on the edge of an imported region, with no Overpass answer and no saved copy: the local part only, marked partial.
   if(!ways&&local){ways=local.ways;fetched_at=local.imported_at;incomplete=true;}
  }
  if(!ways){pending++;continue;}
  loaded++;if(!oldest||fetched_at<oldest)oldest=fetched_at;
  const reach=bboxGrow(bboxOf(part.area)!,NEAR_PROJECT_METRES+20);
  const result=emptyStreetSegments(part.area,ways,company.filter(p=>bboxContains(reach,p)),{exclude:part.exclude,limit:Math.max(0,STREET_LIMITS.maxSegments-segments.length)});
  pieces+=result.pieces;empty+=result.empty;segments.push(...result.segments);
 }
 return answer(!loaded?'unavailable':pending||incomplete?'partial':stale?'stale':'ready');
}

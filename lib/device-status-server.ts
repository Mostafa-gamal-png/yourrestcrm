import type {Member} from './crm';
import {salesScopeMemberIds} from './access';
import {regionScope,regionScopesOverlap} from './regions';
import {cleanStatusText,deviceReportSchema,type DeviceReport,type DeviceStatusPublic} from './device-status';
import type {TrackingOverview} from './tracking-coverage';
import {isFieldRole} from './roles';
import {problemSince,stuckPhones,type StuckPhone} from './stuck-phones';

/** Two reports from one phone closer than this are the client misbehaving, not news. */
export const DEVICE_REPORT_MIN_GAP_MS=30_000;
type Db=D1Database;
type ScopeContext={me:Member;members:Member[]};
export type {TrackingOverview};

/** The server never trusts text or clocks from a phone. */
export function normalizeDeviceReport(report:DeviceReport,nowMs:number):DeviceReport{
 const fix=Date.parse(report.lastFixAt);
 return {...report,error:cleanStatusText(report.error),syncError:cleanStatusText(report.syncError),lastFixAt:Number.isFinite(fix)&&fix<=nowMs+5*60_000?new Date(fix).toISOString():''};
}

/** One atomic statement: the row is replaced only when the previous report is old enough, and only if it is still the row read here (its
 * version), so the problem's start (lib/stuck-phones.ts) is always counted from the report it follows. */
export async function saveDeviceReport(db:Db,memberId:string,report:DeviceReport,now:string):Promise<'saved'|'throttled'>{
 const cutoff=new Date(Date.parse(now)-DEVICE_REPORT_MIN_GAP_MS).toISOString();
 const before=await db.prepare('SELECT data,version FROM crm_member_devices WHERE member_id=? AND platform=?').bind(memberId,report.platform).first<{data:string;version:number}>();
 let previous:{report:DeviceReport;since:string}|null=null;
 if(before){try{const {problemSince:since,...rest}=JSON.parse(before.data) as Record<string,unknown>;const parsed=deviceReportSchema.safeParse(rest);if(parsed.success)previous={report:parsed.data,since:typeof since==='string'?since:''};}catch{previous=null;}}
 const since=problemSince(previous,report,now),data=JSON.stringify(since?{...report,problemSince:since}:report);
 const result=await db.prepare('INSERT INTO crm_member_devices(member_id,platform,app_version,reported_at,data,version) VALUES(?,?,?,?,?,1) ON CONFLICT(member_id,platform) DO UPDATE SET app_version=excluded.app_version,reported_at=excluded.reported_at,data=excluded.data,version=crm_member_devices.version+1 WHERE crm_member_devices.reported_at<=? AND crm_member_devices.version=?')
  .bind(memberId,report.platform,report.appVersion||null,now,data,cutoff,before?.version??0).run();
 return Number(result.meta?.changes??0)>0?'saved':'throttled';
}

/** Active representatives the caller may see: the same people, region and hierarchy rules as the daily report. */
export function trackingMembers(c:ScopeContext):Member[]{
 const scope=salesScopeMemberIds(c.members,c.me,{read:true});
 return c.members.filter(m=>isFieldRole(m.role)&&!!m.active&&scope.has(m.id)&&(m.id===c.me.id||regionScopesOverlap(regionScope(m),regionScope(c.me))));
}

type DeviceRow={memberId:string;reportedAt:string;data:string};
type AtRow={memberId:string;at:string|null};
const latest=(a:string|null|undefined,b:string|null|undefined)=>{
 const x=Date.parse(a||''),y=Date.parse(b||'');
 if(!Number.isFinite(x)&&!Number.isFinite(y))return null;
 return new Date(Number.isFinite(x)&&(!Number.isFinite(y)||x>=y)?x:y).toISOString();
};

export async function readDeviceStatuses(db:Db,memberIds:string[]):Promise<Map<string,DeviceStatusPublic[]>>{
 const rows=(await db.prepare('SELECT member_id AS memberId,reported_at AS reportedAt,data FROM crm_member_devices WHERE member_id IN (SELECT value FROM json_each(?)) ORDER BY reported_at DESC,platform').bind(JSON.stringify(memberIds)).all<DeviceRow>()).results;
 const byMember=new Map<string,DeviceStatusPublic[]>();
 for(const row of rows){
  let parsed:Record<string,unknown>;try{parsed=JSON.parse(row.data);}catch{continue;}
  if(!parsed||typeof parsed!=='object')continue;
  const {problemSince:since,...rest}=parsed,report=deviceReportSchema.safeParse(rest);
  if(!report.success)continue;
  byMember.set(row.memberId,[...(byMember.get(row.memberId)||[]),{...report.data,reportedAt:row.reportedAt,...(typeof since==='string'&&Number.isFinite(Date.parse(since))?{problemSince:since}:{})}]);
 }
 return byMember;
}

/** What reached the server for these representatives: the newest point ever, what arrived on one day, and what the phone last reported. */
export async function trackingOverview(c:ScopeContext&{db:Db},date:string):Promise<TrackingOverview[]>{
 const members=trackingMembers(c);if(!members.length)return [];
 const ids=JSON.stringify(members.map(m=>m.id));
 const [devices,mobileEver,webEver,mobileDay,webDay]=await Promise.all([
  readDeviceStatuses(c.db,members.map(m=>m.id)),
  c.db.prepare('SELECT member_id AS memberId,MAX(last_point_at) AS at FROM crm_mobile_route_days WHERE member_id IN (SELECT value FROM json_each(?)) AND last_point_at IS NOT NULL GROUP BY member_id').bind(ids).all<AtRow>(),
  c.db.prepare("SELECT member_id AS memberId,MAX(json_extract(data,'$.lastPoint.capturedAt')) AS at FROM crm_journey_stops WHERE member_id IN (SELECT value FROM json_each(?)) GROUP BY member_id").bind(ids).all<AtRow>(),
  c.db.prepare('SELECT d.member_id AS memberId,COUNT(p.point_id) AS points,MIN(d.started_at) AS startedAt FROM crm_mobile_route_days d LEFT JOIN crm_mobile_route_points p ON p.day_id=d.id WHERE d.date=? AND d.member_id IN (SELECT value FROM json_each(?)) GROUP BY d.member_id').bind(date,ids).all<{memberId:string;points:number;startedAt:string|null}>(),
  c.db.prepare('SELECT s.member_id AS memberId,COUNT(DISTINCT s.id) AS trips,COUNT(p.point_id) AS points FROM crm_journey_stops s LEFT JOIN crm_journey_points p ON p.stop_id=s.id WHERE s.date=? AND s.member_id IN (SELECT value FROM json_each(?)) GROUP BY s.member_id').bind(date,ids).all<{memberId:string;trips:number;points:number}>()
 ]);
 const mobileAt=new Map(mobileEver.results.map(r=>[r.memberId,r.at])),webAt=new Map(webEver.results.map(r=>[r.memberId,r.at])),days=new Map(mobileDay.results.map(r=>[r.memberId,r])),trips=new Map(webDay.results.map(r=>[r.memberId,r]));
 return members.map(member=>({
  memberId:member.id,memberName:member.name,devices:devices.get(member.id)||[],
  lastPointAt:latest(mobileAt.get(member.id),webAt.get(member.id)),
  dayStartedAt:days.get(member.id)?.startedAt??null,
  pointsOnDate:Number(days.get(member.id)?.points||0)+Number(trips.get(member.id)?.points||0),
  tripsOnDate:Number(trips.get(member.id)?.trips||0)
 })).sort((a,b)=>a.memberName.localeCompare(b.memberName,'ar'));
}

/** «هواتف متوقفة» (lib/stuck-phones.ts): the representatives the caller already sees in the daily report whose phone has been stopped or
 * blocked for half an hour or more, now, inside the working window. */
export async function stuckPhoneAlerts(c:ScopeContext&{db:Db},now:string):Promise<StuckPhone[]>{
 const members=trackingMembers(c);if(!members.length)return [];
 const devices=await readDeviceStatuses(c.db,members.map(m=>m.id));
 return stuckPhones(members.map(member=>({memberId:member.id,memberName:member.name,devices:devices.get(member.id)||[]})),now);
}

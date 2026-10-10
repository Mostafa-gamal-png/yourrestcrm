import {accessGuard,CRMError,context} from './crm-server';
import {canUseSalesWorkspace,salesScopeMemberIds,recordAuthorId} from './access';
import {memberCanAccessRegion} from './regions';
import {journeyDate,journeyVisitTiming,projectJourneyWindow,type JourneyStop} from './journeys';
import type {Row} from './crm';
export type JourneyContext=Awaited<ReturnType<typeof context>>;
export const journeyColumns='id,member_id AS memberId,date,customer_id AS customerId,region_scope AS regionScope,snapshot,selected_at AS selectedAt,closed_at AS closedAt,state,data,version';
export function decodeJourney(row:any):JourneyStop{return{...row,snapshot:JSON.parse(row.snapshot),data:JSON.parse(row.data)};}
export function canReadJourney(stop:JourneyStop,c:JourneyContext){const customer=c.all.find(r=>r.id===stop.customerId&&r.kind==='customer');return !!customer&&memberCanAccessRegion(c.me,customer.data.region)&&memberCanAccessRegion(c.me,stop.regionScope)&&salesScopeMemberIds(c.members,c.me).has(stop.memberId);}
export async function ownJourney(c:JourneyContext,id:string){const raw=await c.db.prepare('SELECT '+journeyColumns+' FROM crm_journey_stops WHERE id=? AND member_id=?').bind(id,c.me.id).first<any>();if(!raw)throw new CRMError('خط السير غير متاح',404);const stop=decodeJourney(raw);if(!canReadJourney(stop,c))throw new CRMError('العميل خارج نطاق منطقتك الحالية',403);return stop;}
export function journeyGuard(c:JourneyContext,stop:JourneyStop){const customer=c.all.find(r=>r.id===stop.customerId&&r.kind==='customer');if(!customer||stop.memberId!==c.me.id||!canReadJourney(stop,c))throw new CRMError('خط السير غير متاح',403);return accessGuard(c,customer);}
export async function activeJourney(c:JourneyContext,at=new Date().toISOString()){const raw=await c.db.prepare('SELECT '+journeyColumns+' FROM crm_journey_stops WHERE member_id=? AND closed_at IS NULL AND date=?').bind(c.me.id,journeyDate(at)).first<any>();if(!raw)return null;const stop=decodeJourney(raw);return canReadJourney(stop,c)?projectJourneyWindow(stop,at):null;}
/** Used by visit writers: include sql/args in their first guarded write and statements after it. */
export async function prepareJourneyVisitLink(c:JourneyContext,customerId:string,activityId:string,data:any,old:Row|undefined,gate:string,gateArgs:(string|number)[],at=new Date().toISOString(),hintedStopId?:unknown){
 const empty=(value:any)=>({data:value,sql:'1=1',args:[] as (string|number)[],statements:[] as D1PreparedStatement[]});
 if(old?.data.journeyStopId&&(old.data.type==='visit')!==(data.type==='visit'))throw new CRMError('لا يمكن تغيير نوع زيارة مرتبطة بتوقيت الوصول والمغادرة',400);
 let stop:JourneyStop|null=null;
 const hint=old?.data.journeyStopId||hintedStopId;
 if(hint!==undefined&&hint!==null&&hint!==''){
  if(typeof hint!=='string'||hint.length>200||!/^[a-zA-Z0-9_-]+$/.test(hint))throw new CRMError('رقم خط السير غير صحيح');
  const author=old?recordAuthorId(old,c.members):c.me.id;
  const raw=await c.db.prepare('SELECT '+journeyColumns+' FROM crm_journey_stops WHERE id=? AND customer_id=? AND member_id=?').bind(hint,customerId,author||'').first<any>();
  if(!raw)throw new CRMError('خط السير لا يتبع العميل أو مسجل الزيارة',403);stop=decodeJourney(raw);
  if(!old?.data.journeyStopId&&(stop.date!==journeyDate(at)||data.date!==stop.date))throw new CRMError('خط السير لا يتبع تاريخ الزيارة',400);
 }
 // A successfully selected stop is sent explicitly by the form. An unrelated
 // tracker attempt, or an older stop for this customer, must never overwrite a
 // standalone contact's own timer merely because it happens to remain open.
 if(!stop)return empty({...data,...(data.type==='visit'?{timingSource:'form'}:{})});
 if(!canReadJourney(stop,c))throw new CRMError('خط السير خارج نطاق صلاحيتك',403);
 if(old&&recordAuthorId(old,c.members)!==stop.memberId)throw new CRMError('خط السير لا يتبع مسجل الزيارة',403);
 const linkedData=data.type==='visit'?{...data,...journeyVisitTiming(projectJourneyWindow(stop,at))}:{...data,journeyStopId:stop.id};
 return{data:linkedData,sql:'EXISTS (SELECT 1 FROM crm_journey_stops WHERE id=? AND version=?)',args:[stop.id,stop.version] as (string|number)[],statements:[c.db.prepare(`INSERT OR IGNORE INTO crm_journey_links(stop_id,activity_id) SELECT ?,? WHERE ${gate}`).bind(stop.id,activityId,...gateArgs)]};
}
/** Only physical visits linked to this exact recorder/customer receive later geographic evidence. */
export function journeyLinkedTimingStatement(c:JourneyContext,stop:JourneyStop,gate:string,args:(string|number)[],at:string){const t=journeyVisitTiming(stop);return c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$.startedAt',?,'$.endedAt',?,'$.durationSeconds',?,'$.durationReview',json(?),'$.journeyDurationUncertain',json(?)),updated_at=?,version=version+1 WHERE kind='activity' AND json_extract(data,'$.type')='visit' AND json_extract(data,'$.journeyStopId')=? AND json_extract(data,'$.performedBy')=? AND id IN (SELECT activity_id FROM crm_journey_links WHERE stop_id=?) AND (COALESCE(json_extract(data,'$.startedAt'),'')<>? OR COALESCE(json_extract(data,'$.endedAt'),'')<>? OR json_extract(data,'$.durationSeconds') IS NOT ? OR COALESCE(json_extract(data,'$.durationReview'),0)<>? OR COALESCE(json_extract(data,'$.journeyDurationUncertain'),0)<>?) AND ${gate}`).bind(t.startedAt,t.endedAt,t.durationSeconds,JSON.stringify(t.durationReview),JSON.stringify(t.journeyDurationUncertain),at,stop.id,stop.memberId,stop.id,t.startedAt,t.endedAt,t.durationSeconds,Number(t.durationReview),Number(t.journeyDurationUncertain),...args);}
export function requireJourneyReport(c:JourneyContext){if(!canUseSalesWorkspace(c.me.role))throw new CRMError('تقرير خط السير متاح للمشرف ومدير المبيعات فقط',403);}

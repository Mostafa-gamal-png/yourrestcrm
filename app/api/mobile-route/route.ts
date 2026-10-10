import {z} from 'zod';
import {context,checkOrigin,replyError,readJsonBody,CRMError,accessGuard,requireSalesRole} from '@/lib/crm-server';
import {regionScope} from '@/lib/regions';
import {journeyDate,applyJourneyPoint,journeyGap,closeJourney,closeJourneyAtWindowEnd,type JourneyStop} from '@/lib/journeys';
import {activeJourney,ownJourney,canReadJourney,journeyGuard,journeyLinkedTimingStatement,journeyColumns,decodeJourney} from '@/lib/journeys-server';
import {mobileDayExpiry,mobileDayStart,mobileReplayableStop,replayMobileInterruptedStop,mobilePublicDay,mobileApplyPoint,mobileGap,type MobileRoutePoint,type MobileRouteStoredDay} from '@/lib/mobile-route';
import {mobileContext,mobileColumns,decodeMobileDay,mobileData,ownMobileDay,mobileGuard} from '@/lib/mobile-route-server';
import {trackingWindowOpen,trackingWindowEnd,trackingWindowStatus,trackingWorkingDay} from '@/lib/tracking-window';
export const dynamic='force-dynamic';
const identifier=z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/),iso=z.string().datetime({offset:true});
const pointSchema=z.object({id:identifier,capturedAt:iso,latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),accuracy:z.number().finite().min(0).max(10000),stopId:identifier.nullable()}).strict().refine(p=>p.latitude!==0||p.longitude!==0,'إحداثيات غير صالحة');
async function response(c:Awaited<ReturnType<typeof context>>,day:MobileRouteStoredDay|null,now:string,extra:Record<string,unknown>={}){const active=await activeJourney(c,now);return Response.json({memberId:c.me.id,memberRole:c.me.role,regionScope:regionScope(c.me),day:day?mobilePublicDay(day,now):null,activeStop:active&&!active.closedAt?active:null,serverTime:now,trackingWindow:trackingWindowStatus(now),...extra},{headers:{'Cache-Control':'no-store'}});}
export async function GET(){try{const c=await mobileContext();requireSalesRole(c.me);const now=new Date().toISOString(),row=await c.db.prepare('SELECT '+mobileColumns+' FROM crm_mobile_route_days WHERE member_id=? AND date=? AND region_scope=? ORDER BY started_at DESC,id DESC LIMIT 1').bind(c.me.id,journeyDate(now),regionScope(c.me)).first<any>();return response(c,row?decodeMobileDay(row):null,now);}catch(e){return replyError(e);}}
export async function POST(req:Request){try{
 checkOrigin(req);const body=await readJsonBody(req);if(JSON.stringify(body).length>40000)throw new CRMError('حجم بيانات الموقع كبير');const c=await mobileContext(body);requireSalesRole(c.me);const now=new Date().toISOString(),date=journeyDate(now),deviceId=z.string().uuid().parse(body.deviceId),action=z.enum(['begin','samples','end','gap']).parse(body.action),mutation=crypto.randomUUID();
 if(action==='begin'){
  if(body.continuous===true&&c.me.role!=='rep')throw new CRMError('التسجيل المستمر مخصص للمندوبين.',403);
  const requestedDate=body.date===undefined?date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v).parse(body.date),historical=requestedDate<date;
  const capturedStart=body.startedAt===undefined?(body.date===undefined?now:mobileDayStart(requestedDate)):new Date(iso.parse(body.startedAt)).toISOString(),expiry=mobileDayExpiry(requestedDate);
  // Legacy continuous collectors anchor at midnight; retain their eligible daytime
  // queue without creating a collection interval before company hours.
  let start=capturedStart<mobileDayStart(requestedDate)?mobileDayStart(requestedDate):capturedStart;
  if(requestedDate>date||journeyDate(capturedStart)!==requestedDate||Date.parse(capturedStart)>Date.parse(now)+5000&&body.startedAt!==undefined)throw new CRMError('وقت بدء التتبع خارج يوم التتبع',400);
  // Offline data retains its captured permission scope, rather than being relabeled
  // after an account's territory changes. Legacy current-day clients need no new field.
  if((historical||body.regionScope!==undefined)&&body.regionScope!==regionScope(c.me))throw new CRMError('تغيرت منطقة الحساب. لا يمكن نقل المسار المحفوظ إلى منطقة أخرى.',403);
  const key=z.string().uuid().parse(body.createKey),id='mobile-'+c.me.id+'-'+key,elapsed=now>=expiry;
  // Apply the schedule to the captured day, not the upload day: a Thursday
  // offline queue remains valid on Friday, while explicit Friday begins pause.
  if(!trackingWorkingDay(requestedDate)||start>=expiry||start>now||(!historical&&!trackingWindowOpen(now)&&body.date===undefined))return response(c,null,now);
  const prior=await c.db.prepare('SELECT '+mobileColumns+' FROM crm_mobile_route_days WHERE id=?').bind(id).first<any>();
  if(prior){const saved=await ownMobileDay(c,id,deviceId);if(body.date!==undefined&&saved.date!==requestedDate)throw new CRMError('عملية بدء التتبع محفوظة ليوم مختلف',409);return response(c,saved,now);}
  // Upload delay does not expire captured evidence. A new historical collector
  // can only start during this account's lifetime, never before enrollment.
  // Existing idempotent keys above retain the already-authorized saved interval.
  const account=await c.db.prepare('SELECT created_at AS createdAt FROM crm_members WHERE id=?').bind(c.me.id).first<{createdAt:string}>();
  if(!account||!Number.isFinite(Date.parse(account.createdAt)))throw new CRMError('تعذر التحقق من تاريخ إنشاء الحساب',403);
  const accountCreatedAt=new Date(account.createdAt).toISOString();
  if(requestedDate<journeyDate(accountCreatedAt))throw new CRMError('يوم التتبع سابق لإنشاء الحساب',400);
  if(start<accountCreatedAt)start=accountCreatedAt;
  if(start>=expiry||start>now)return response(c,null,now);
  const currentRaw=await c.db.prepare('SELECT '+mobileColumns+' FROM crm_mobile_route_days WHERE member_id=? AND ended_at IS NULL').bind(c.me.id).first<any>(),current=currentRaw?decodeMobileDay(currentRaw):null;
  if(current&&current.date===requestedDate&&current.regionScope===regionScope(c.me)){if(current.deviceId!==deviceId)throw new CRMError('التتبع يعمل على جهاز آخر. تواصل مع الإدارة لتغيير الجهاز.',409);return response(c,current,now);}
  // A late offline day must not close or replace today's already-running collector.
  const sameDate=(await c.db.prepare('SELECT '+mobileColumns+' FROM crm_mobile_route_days WHERE member_id=? AND date=? AND region_scope=? ORDER BY started_at,id').bind(c.me.id,requestedDate,regionScope(c.me)).all<any>()).results.map(decodeMobileDay);
  const covering=sameDate.find(day=>day.deviceId===deviceId&&day.startedAt<=start&&(!day.endedAt||day.endedAt>start));
  if(covering)return response(c,covering,now);
  if(sameDate.some(day=>!day.endedAt||day.endedAt>start))throw new CRMError('توجد فترة تتبع محفوظة لهذا اليوم أو لجهاز آخر.',409);
  const day:MobileRouteStoredDay={id,memberId:c.me.id,deviceId,date:requestedDate,regionScope:regionScope(c.me),startedAt:start,endedAt:elapsed?expiry:null,expiresAt:expiry,lastPointAt:null,version:1,gaps:[],trackingWindow:'06-18'},permission=accessGuard(c),statements=[];
  permission.sql+=' AND EXISTS (SELECT 1 FROM crm_members WHERE id=? AND created_at=?)';permission.args.push(c.me.id,account.createdAt);
  permission.sql+=' AND (SELECT COUNT(*) FROM crm_mobile_route_days WHERE member_id=? AND date=?)<20 AND NOT EXISTS (SELECT 1 FROM crm_mobile_route_days WHERE member_id=? AND date=? AND region_scope=? AND (ended_at IS NULL OR ended_at>?) AND id<>?)';permission.args.push(c.me.id,requestedDate,c.me.id,requestedDate,day.regionScope,start,current&&!historical?current.id:'');
  let rolloverStop:JourneyStop|null=null;
  if(current&&!historical&&current.date<requestedDate){const raw=await c.db.prepare('SELECT '+journeyColumns+' FROM crm_journey_stops WHERE member_id=? AND date=? AND closed_at IS NULL').bind(c.me.id,current.date).first<any>();if(raw){const stop=decodeJourney(raw);if(canReadJourney(stop,c)){rolloverStop=stop;const guard=journeyGuard(c,stop);permission.sql+=' AND '+guard.sql+' AND EXISTS (SELECT 1 FROM crm_journey_stops WHERE id=? AND version=?)';permission.args.push(...guard.args,stop.id,stop.version);}}}
  if(current&&!historical)statements.push(c.db.prepare(`UPDATE crm_mobile_route_days SET ended_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND ended_at IS NULL AND ${permission.sql}`).bind(current.date<requestedDate?trackingWindowEnd(current.date):now,mutation,current.id,current.version,...permission.args));
  // Dependency snapshots and an overlap predicate guard the entire new interval.
  if(current&&!historical){permission.sql+=' AND EXISTS (SELECT 1 FROM crm_mobile_route_days WHERE id=? AND mutation_id=?)';permission.args.push(current.id,mutation);}
  statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,last_point_at,data,version,mutation_id) SELECT ?,?,?,?,?,?,?,NULL,?,1,? WHERE (?=1 OR NOT EXISTS (SELECT 1 FROM crm_mobile_route_days WHERE member_id=? AND ended_at IS NULL)) AND NOT EXISTS (SELECT 1 FROM crm_mobile_route_days WHERE member_id=? AND date=? AND region_scope=? AND (ended_at IS NULL OR ended_at>?)) AND (SELECT COUNT(*) FROM crm_mobile_route_days WHERE member_id=? AND date=?)<20 AND ${permission.sql}`).bind(id,c.me.id,deviceId,requestedDate,day.regionScope,start,day.endedAt,mobileData(day),mutation,Number(historical),c.me.id,c.me.id,requestedDate,day.regionScope,start,c.me.id,requestedDate,...permission.args));
  const insertIndex=statements.length-1;
  if(rolloverStop){const closed=closeJourneyAtWindowEnd(rolloverStop),gate='EXISTS (SELECT 1 FROM crm_mobile_route_days WHERE id=? AND mutation_id=?)',args=[id,mutation];statements.push(c.db.prepare(`UPDATE crm_journey_stops SET state=?,closed_at=?,data=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND ${gate}`).bind(closed.state,closed.closedAt,JSON.stringify(closed.data),mutation,rolloverStop.id,rolloverStop.version,...args),journeyLinkedTimingStatement(c,closed,gate,args,now));}
  const saved=await c.db.batch(statements);if(saved[insertIndex]?.meta.changes!==1)throw new CRMError('تغير يوم التتبع أو صلاحياتك، أو وصلت للحد اليومي. أعد المحاولة.',409);return response(c,day,now);
 }
 const day=await ownMobileDay(c,identifier.parse(body.dayId),deviceId),permission=mobileGuard(c,day);
 if(action==='end'&&c.me.role==='rep')throw new CRMError('تسجيل خط السير يعمل تلقائيًا للمندوب ولا يمكن إيقافه يدويًا.',403);
 if(action==='samples'){
  const incoming=z.array(pointSchema).min(1).max(50).parse(body.points);if(new Set(incoming.map(p=>p.id)).size!==incoming.length)throw new CRMError('تكرار رقم عينة الموقع');const times=incoming.map(p=>new Date(p.capturedAt).toISOString());if(new Set(times).size!==times.length)throw new CRMError('تكرار وقت عينة الموقع');
  const ignoredIds:string[]=[],placeholders=incoming.map(()=>'?').join(','),existing=(await c.db.prepare(`SELECT point_id AS id,captured_at AS capturedAt,latitude,longitude,accuracy,stop_id AS stopId FROM crm_mobile_route_points WHERE day_id=? AND (point_id IN (${placeholders}) OR captured_at IN (${placeholders}))`).bind(day.id,...incoming.map(p=>p.id),...times).all<MobileRoutePoint>()).results,points:MobileRoutePoint[]=[];
  for(const input of incoming){const point={...input,capturedAt:new Date(input.capturedAt).toISOString(),receivedAt:now},prior=existing.find(p=>p.id===point.id||p.capturedAt===point.capturedAt);if(prior){if(prior.id!==point.id||prior.capturedAt!==point.capturedAt||prior.latitude!==point.latitude||prior.longitude!==point.longitude||prior.accuracy!==point.accuracy||prior.stopId!==point.stopId)throw new CRMError('عينة الموقع محفوظة ببيانات مختلفة',409);continue;}
   const at=Date.parse(point.capturedAt);if(at>Date.parse(now)+5000||journeyDate(point.capturedAt)!==day.date)throw new CRMError('وقت عينة الموقع خارج يوم التتبع',400);
   if(!trackingWindowOpen(point.capturedAt)){if(point.stopId)await ownJourney(c,point.stopId);ignoredIds.push(point.id);continue;}points.push(point);
  }
  if(!points.length)return response(c,day,now,{acknowledgedIds:incoming.map(p=>p.id),ignoredIds});
  let next:MobileRouteStoredDay={...day,trackingWindow:'06-18',expiresAt:mobileDayExpiry(day.date)};const originals=new Map<string,JourneyStop>(),updated=new Map<string,JourneyStop>(),stopPoints=new Map<string,MobileRoutePoint[]>();
  for(const point of points){const at=Date.parse(point.capturedAt);if(at>Date.parse(now)+5000||at<Date.parse(day.startedAt)||at>=Date.parse(day.expiresAt)||day.endedAt&&at>Date.parse(day.endedAt)||journeyDate(point.capturedAt)!==day.date)throw new CRMError('وقت عينة الموقع خارج يوم التتبع',400);if(next.lastPointAt&&at<=Date.parse(next.lastPointAt))throw new CRMError('عينات الموقع غير مرتبة. أعد إرسال العينات بالترتيب.',409);
   if(point.stopId){let stop=updated.get(point.stopId);if(!stop){stop=await ownJourney(c,point.stopId);if(stop.date!==day.date||at<Date.parse(stop.selectedAt))throw new CRMError('عينة الموقع لا تتبع وقت اختيار العميل',400);originals.set(stop.id,stop);updated.set(stop.id,stop);}if(!stop.closedAt||mobileReplayableStop(stop)&&point.capturedAt<=stop.closedAt){if(stop.data.lastPoint&&at<=Date.parse(stop.data.lastPoint.capturedAt))throw new CRMError('توجد عينات أحدث لهذا العميل. أوقف جامع الموقع المكرر.',409);if(!stop.closedAt)stop=applyJourneyPoint(stop,point);updated.set(stop.id,stop);const list=stopPoints.get(stop.id)||[];list.push(point);stopPoints.set(stop.id,list);}}
   next=mobileApplyPoint(next,point);
  }
  for(const [stopId,accepted] of stopPoints){const original=originals.get(stopId)!;if(mobileReplayableStop(original)){const previous=(await c.db.prepare('SELECT point_id AS id,captured_at AS capturedAt,received_at AS receivedAt,latitude,longitude,accuracy FROM crm_journey_points WHERE stop_id=? ORDER BY captured_at,point_id').bind(stopId).all<MobileRoutePoint>()).results;const replayed=replayMobileInterruptedStop(original,[...previous,...accepted]);updated.set(stopId,replayed);stopPoints.set(stopId,accepted.filter(point=>!replayed.data.lastPoint||point.capturedAt<=replayed.data.lastPoint.capturedAt));}}
  for(const [stopId,accepted] of stopPoints){const slots=accepted.map(()=>'?').join(',');const clash=await c.db.prepare(`SELECT point_id FROM crm_journey_points WHERE stop_id=? AND (point_id IN (${slots}) OR captured_at IN (${slots})) LIMIT 1`).bind(stopId,...accepted.map(p=>p.id),...accepted.map(p=>p.capturedAt)).first();if(clash)throw new CRMError('توجد عينة متعارضة محفوظة لهذا العميل',409);}
  for(const stop of originals.values()){const g=journeyGuard(c,stop);permission.sql+=' AND '+g.sql+' AND EXISTS (SELECT 1 FROM crm_journey_stops WHERE id=? AND version=?)';permission.args.push(...g.args,stop.id,stop.version);}
  const gate='EXISTS (SELECT 1 FROM crm_mobile_route_days WHERE id=? AND version=? AND mutation_id=?)',args=[day.id,day.version+1,mutation],statements=[c.db.prepare(`UPDATE crm_mobile_route_days SET last_point_at=?,data=?,version=version+1,mutation_id=? WHERE id=? AND member_id=? AND device_id=? AND version=? AND (SELECT COUNT(*) FROM crm_mobile_route_points p JOIN crm_mobile_route_days d ON d.id=p.day_id WHERE d.member_id=? AND d.date=?)+?<=20000 AND ${permission.sql}`).bind(next.lastPointAt,mobileData(next),mutation,day.id,c.me.id,deviceId,day.version,c.me.id,day.date,points.length,...permission.args),...points.map(p=>c.db.prepare(`INSERT INTO crm_mobile_route_points(day_id,point_id,captured_at,received_at,latitude,longitude,accuracy,stop_id) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`).bind(day.id,p.id,p.capturedAt,now,p.latitude,p.longitude,p.accuracy,p.stopId,...args))];
  for(const [id,accepted] of stopPoints){const original=originals.get(id)!,stop=updated.get(id)!;statements.push(c.db.prepare(`UPDATE crm_journey_stops SET state=?,closed_at=?,data=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND ${gate}`).bind(stop.state,stop.closedAt,JSON.stringify(stop.data),mutation,id,original.version,...args),...accepted.map(p=>c.db.prepare(`INSERT INTO crm_journey_points(stop_id,point_id,captured_at,received_at,latitude,longitude,accuracy) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(id,p.id,p.capturedAt,now,p.latitude,p.longitude,p.accuracy,...args)),journeyLinkedTimingStatement(c,stop,gate,args,now));}
  const saved=await c.db.batch(statements);if(saved[0].meta.changes!==1)throw new CRMError('تغير خط السير أو صلاحياتك، أو وصلت لسعة اليوم. أعد المحاولة.',409);return response(c,{...next,version:day.version+1},now,{acknowledgedIds:incoming.map(p=>p.id),ignoredIds});
 }
 const reason=action==='gap'?z.enum(['permission_denied','gps_unavailable','tracking_paused','buffer_expired','buffer_full','service_stopped']).parse(body.reason):'day_end',at=new Date(iso.parse((action==='end'?body.endedAt:body.at)||now)).toISOString();
 // Updated collectors preserve the destination at capture time. Null explicitly
 // means an unbound route gap; only older callers omit the binding field.
 const capturedStopId=action==='gap'&&body.stopId!==undefined?identifier.nullable().parse(body.stopId):undefined;
 const capturedStop=typeof capturedStopId==='string'?await ownJourney(c,capturedStopId):null;
 if(capturedStop&&(capturedStop.date!==day.date||at<capturedStop.selectedAt))throw new CRMError('انقطاع التتبع لا يتبع وقت اختيار العميل',400);
 if(action==='gap'&&!trackingWindowOpen(at)){if(Date.parse(at)>Date.parse(now)+5000||journeyDate(at)!==day.date)throw new CRMError('وقت إغلاق أو انقطاع التتبع غير صحيح');return response(c,day,now);}
 if(Date.parse(at)>Date.parse(now)+5000||at<day.startedAt||at>day.expiresAt||action==='end'&&day.lastPointAt&&at<day.lastPointAt||action==='gap'&&capturedStopId===undefined&&day.lastPointAt&&at<day.lastPointAt)throw new CRMError('وقت إغلاق أو انقطاع التتبع غير صحيح');
 if(action==='end'&&day.endedAt){if(body.endedAt&&day.endedAt!==at)throw new CRMError('يوم التتبع أُغلق بوقت مختلف',409);return response(c,day,now);}
 if(day.endedAt&&(action!=='gap'||at>day.endedAt))throw new CRMError('انتهى يوم التتبع',409);
 let gapSource=day;
 if(action==='gap'&&day.lastPointAt&&at<day.lastPointAt){
  const prior=await c.db.prepare('SELECT captured_at AS capturedAt FROM crm_mobile_route_points WHERE day_id=? AND captured_at<=? ORDER BY captured_at DESC LIMIT 1').bind(day.id,at).first<{capturedAt:string}>();
  gapSource={...day,lastPointAt:prior?.capturedAt||null};
 }
 const next=action==='gap'?{...mobileGap(gapSource,at,reason),lastPointAt:day.lastPointAt}:{...day,endedAt:at};
 if(action==='gap'&&mobileData(next)===mobileData(day))return response(c,day,now);
 const gate='EXISTS (SELECT 1 FROM crm_mobile_route_days WHERE id=? AND version=? AND mutation_id=?)',args=[day.id,day.version+1,mutation],statements=[];
 let active:JourneyStop|null=capturedStop;
 if(capturedStopId===undefined){const activeRaw=await c.db.prepare('SELECT '+journeyColumns+' FROM crm_journey_stops WHERE member_id=? AND date=? AND (closed_at IS NULL OR closed_at=?) ORDER BY selected_at DESC LIMIT 1').bind(c.me.id,day.date,day.expiresAt).first<any>();active=activeRaw?decodeJourney(activeRaw):null;}
 if(active){
  const g=journeyGuard(c,active);permission.sql+=' AND '+g.sql+' AND EXISTS (SELECT 1 FROM crm_journey_stops WHERE id=? AND version=?)';permission.args.push(...g.args,active.id,active.version);
  const replayable=action==='gap'&&mobileReplayableStop(active)&&at<=active.closedAt!;
  if((!active.closedAt||replayable)&&at>=active.selectedAt&&(!active.data.lastPoint||at>=active.data.lastPoint.capturedAt||replayable)){
   let stopped:JourneyStop;
   if(replayable){
    const prior=(await c.db.prepare('SELECT point_id AS id,captured_at AS capturedAt,received_at AS receivedAt,latitude,longitude,accuracy FROM crm_journey_points WHERE stop_id=? ORDER BY captured_at,point_id').bind(active.id).all<MobileRoutePoint>()).results;
    // Place the captured interruption among existing evidence, never on the new
    // selected destination or at the time this network request arrived.
    const preceding=prior.filter(point=>point.capturedAt<=at).at(-1);
    const withGap={...active,data:{...active.data,gaps:[...active.data.gaps,{from:preceding?.capturedAt||active.selectedAt,to:at,reason}]}};
    stopped=replayMobileInterruptedStop(withGap,prior);
   }else stopped=action==='end'?closeJourney(active,at,'day_end'):journeyGap(active,at,reason);
   statements.push(c.db.prepare(`UPDATE crm_journey_stops SET state=?,closed_at=?,data=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND ${gate}`).bind(stopped.state,stopped.closedAt,JSON.stringify(stopped.data),mutation,active.id,active.version,...args),journeyLinkedTimingStatement(c,stopped,gate,args,now));
  }
 }
 statements.unshift(c.db.prepare(`UPDATE crm_mobile_route_days SET ended_at=?,data=?,version=version+1,mutation_id=? WHERE id=? AND member_id=? AND device_id=? AND version=? AND ${permission.sql}`).bind(next.endedAt,mobileData(next),mutation,day.id,c.me.id,deviceId,day.version,...permission.args));const saved=await c.db.batch(statements);if(saved[0].meta.changes!==1)throw new CRMError('تغيّر يوم التتبع أو صلاحياتك. أعد المحاولة.',409);return response(c,{...next,version:day.version+1},now);
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:'بيانات تتبع الموبايل غير صحيحة'},{status:400});return replyError(e);}}

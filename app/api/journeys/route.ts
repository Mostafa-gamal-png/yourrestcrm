import {mobileReportDays} from '@/lib/mobile-route-server';
import {buildDailyReport} from '@/lib/daily-report';
import {trackingOverview} from '@/lib/device-status-server';
import {buildTrackingCoverage} from '@/lib/tracking-coverage';
import {dailyPendingFollowups} from '@/lib/daily-followups';
import type {JourneyReportData} from '@/lib/journeys';
import {z} from 'zod';
import {context,checkOrigin,replyError,readJsonBody,CRMError,accessGuard,requireSalesRole} from '@/lib/crm-server';
import {customerCoordinates} from '@/lib/customer-location';
import {customerRegionScope} from '@/lib/regions';
import {visitCustomer} from '@/lib/customer-visits';
import {salesScopeMemberIds,recordAuthorId} from '@/lib/access';
import {journeyDate,initialJourneyData,applyJourneyPoint,closeJourney,journeyGap,journeySegments,projectJourneyWindow,journeyRecordingBoundary,closeJourneyAtWindowEnd,JOURNEY_REPLAY_MS,JOURNEY_GAP_MS,type JourneyPoint,type JourneyStop} from '@/lib/journeys';
import {journeyColumns,decodeJourney,canReadJourney,ownJourney,activeJourney,journeyGuard,journeyLinkedTimingStatement,requireJourneyReport,type JourneyRow} from '@/lib/journeys-server';
import {trackingWindowOpen,trackingWindowStatus} from '@/lib/tracking-window';
export const dynamic='force-dynamic';
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
const identifier=z.string().min(1).max(150).regex(/^[a-zA-Z0-9_-]+$/);
const pointSchema=z.object({id:identifier,capturedAt:z.string().datetime({offset:true}),latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),accuracy:z.number().finite().min(0).max(10000)}).strict().refine(p=>p.latitude!==0||p.longitude!==0,'إحداثيات غير صالحة');
function publicStop(stop:JourneyStop|null,now:string){if(!stop)return null;stop=projectJourneyWindow(stop,now);if(stop.closedAt)return stop;const last=stop.data.lastPoint?.capturedAt||stop.selectedAt;return !stop.closedAt&&trackingWindowOpen(now)&&Date.parse(now)-Date.parse(last)>JOURNEY_GAP_MS?journeyGap(stop,now,'no_recent_location'):stop;}
function response(stop:JourneyStop|null,now:string,extra:Record<string,unknown>={}){const projected=publicStop(stop,now);return Response.json({stop:projected,active:projected&&!projected.closedAt?projected:null,serverTime:now,trackingWindow:trackingWindowStatus(now),...extra},{headers:{'Cache-Control':'no-store'}});}
export async function GET(req:Request){try{
 const c=await context(),now=new Date().toISOString(),url=new URL(req.url);requireSalesRole(c.me);
 if(url.searchParams.has('stopId')){if(url.searchParams.has('date'))throw new CRMError('اختر رقم المحطة أو تاريخ التقرير');return response(await ownJourney(c,identifier.parse(url.searchParams.get('stopId'))),now);}
 if(!url.searchParams.has('date'))return response(await activeJourney(c,now),now);
 requireJourneyReport(c);const date=dateSchema.parse(url.searchParams.get('date')),scope=salesScopeMemberIds(c.members,c.me),memberId=url.searchParams.get('memberId')||c.me.id;
 if(memberId!=='all'&&!scope.has(memberId))throw new CRMError('الموظف خارج نطاق فريقك',403);
 const raw=(await c.db.prepare('SELECT '+journeyColumns+' FROM crm_journey_stops WHERE date=? ORDER BY selected_at,id').bind(date).all<JourneyRow>()).results;
 const availableStops=raw.map(decodeJourney).filter(stop=>canReadJourney(stop,c)),stops=availableStops.filter(stop=>memberId==='all'||stop.memberId===memberId);
 const visibleRecords=new Map(c.visible.map(row=>[row.id,row]));
 const projected=[],linkedIds=new Set<string>();
 const resultFields=(row:typeof c.all[number])=>({id:row.id,date:row.data.date||journeyDate(row.createdAt),createdAt:row.createdAt,recordedAt:typeof row.data.offlineRecordedAt==='string'&&Number.isFinite(Date.parse(row.data.offlineRecordedAt))?row.data.offlineRecordedAt:row.createdAt,type:row.data.type||'',summary:row.data.summary||'',result:row.data.result||'',nextAction:row.data.nextAction||'',nextDate:row.data.nextDate||'',requestedProducts:Array.isArray(row.data.requestedProducts)?row.data.requestedProducts.filter((value:unknown)=>typeof value==='string'&&value.trim()):[],customerNeeds:row.data.customerNeeds||'',salesStage:row.data.salesStage||'',strength:row.data.strength||'',hasCompetitor:row.data.hasCompetitor===true,...(row.data.hasCompetitor===true?{competitorName:row.data.competitorName||'',competitorNotes:row.data.competitorNotes||'',competitorFileId:row.data.competitorFileId||'',competitorFileName:row.data.competitorFileName||''}:{})});
 for(const stored of stops){
  const points=(await c.db.prepare('SELECT point_id AS id,captured_at AS capturedAt,received_at AS receivedAt,latitude,longitude,accuracy FROM crm_journey_points WHERE stop_id=? ORDER BY captured_at,point_id').bind(stored.id).all<JourneyPoint>()).results;
  const links=(await c.db.prepare('SELECT activity_id AS activityId FROM crm_journey_links WHERE stop_id=?').bind(stored.id).all<{activityId:string}>()).results;
  for(const link of links)linkedIds.add(link.activityId);
  const stop=publicStop(stored,now)!;
  projected.push({...stop,memberName:c.members.find(m=>m.id===stop.memberId)?.name||'',points,segments:journeySegments(points,stop.data.gaps),results:links.flatMap(link=>{const row=visibleRecords.get(link.activityId);return row?[resultFields(row)]:[];})});
 }
 // Labels only: no employee targets, unrelated territory/customer data, or paths through hidden stops.
 const communications=c.visible.filter(row=>row.kind==='activity'&&(row.data.date||journeyDate(row.createdAt))===date&&!linkedIds.has(row.id)).flatMap(row=>{const author=recordAuthorId(row,c.members),customer=visitCustomer(row,c.visible);return author&&scope.has(author)&&customer?[{...resultFields(row),memberId:author,memberName:c.members.find(m=>m.id===author)?.name||'',customerId:customer.id,customerName:customer.data.name||''}]:[];});
 const mobileDays=await mobileReportDays(c,date,memberId,now);
 const pendingFollowups=dailyPendingFollowups(c.visible,c.members,scope,date,memberId);
 const eligible=new Set([...availableStops.map(stop=>stop.memberId),...communications.map(row=>row.memberId),...mobileDays.map(day=>day.memberId),...pendingFollowups.map(plan=>plan.memberId)]);for(const member of c.members)if(scope.has(member.id)&&member.active&&(c.me.regionScope==='all'||member.id===c.me.id||member.regionScope===c.me.regionScope||member.regionScope==='all'))eligible.add(member.id);
 const report:JourneyReportData={date,memberId,members:c.members.filter(m=>eligible.has(m.id)&&scope.has(m.id)).map(m=>({id:m.id,name:m.name,role:m.role,active:m.active})),stops:projected,mobileDays,communications:communications.filter(row=>memberId==='all'||row.memberId===memberId).sort((a,b)=>(a.recordedAt||a.createdAt).localeCompare(b.recordedAt||b.createdAt)),serverTime:now};
 report.daily=buildDailyReport(report,c.visible.filter(row=>row.kind==='customer'),report.communications,pendingFollowups);
 // Why a day has no GPS: what reached the server for the representatives in view, and what their phones last reported.
 const overview=await trackingOverview(c,date);
 report.tracking=buildTrackingCoverage(memberId==='all'?overview:overview.filter(entry=>entry.memberId===memberId),date,now);
 return Response.json(report,{headers:{'Cache-Control':'no-store'}});
 }catch(error){if(error instanceof z.ZodError)return Response.json({error:'بيانات تقرير خط السير غير صحيحة'},{status:400});return replyError(error);}}
export async function POST(req:Request){try{
 checkOrigin(req);const body=await readJsonBody(req);if(JSON.stringify(body).length>30000)throw new CRMError('حجم بيانات الموقع كبير');const c=await context();requireSalesRole(c.me);const now=new Date().toISOString(),date=journeyDate(now),mutation=crypto.randomUUID();
 const action=z.enum(['select','samples','end','gap']).parse(body.action);
 if(action==='select'){
  const key=z.string().uuid().parse(body.createKey),customerId=identifier.parse(body.customerId),customer=c.visible.find(row=>row.id===customerId&&row.kind==='customer');if(!customer)throw new CRMError('العميل خارج نطاق منطقتك',403);
  if(!trackingWindowOpen(now))return response(null,now);
  const id='journey-'+c.me.id+'-'+key,prior=await c.db.prepare('SELECT '+journeyColumns+' FROM crm_journey_stops WHERE id=? AND member_id=?').bind(id,c.me.id).first<JourneyRow>();
  if(prior){const stop=decodeJourney(prior);if(stop.customerId!==customer.id)throw new CRMError('عملية الاختيار محفوظة لعميل آخر',409);if(!canReadJourney(stop,c))throw new CRMError('خط السير غير متاح',403);return response(stop,now);}
  const currentRaw=await c.db.prepare('SELECT '+journeyColumns+' FROM crm_journey_stops WHERE member_id=? AND closed_at IS NULL').bind(c.me.id).first<JourneyRow>(),current=currentRaw?decodeJourney(currentRaw):null;
  if(current&&current.customerId===customer.id&&current.date===date&&canReadJourney(current,c))return response(current,now);
  const count=await c.db.prepare('SELECT COUNT(*) AS count FROM crm_journey_stops WHERE member_id=? AND date=?').bind(c.me.id,date).first<{count:number}>();if((count?.count||0)>=200)throw new CRMError('وصلت للحد اليومي لتغييرات العميل',429);
  const coords=customerCoordinates(customer.data),stop:JourneyStop={id,memberId:c.me.id,date,customerId:customer.id,regionScope:customerRegionScope(customer.data.region),snapshot:{customerName:customer.data.name,region:customer.data.region||'',latitude:coords?.latitude??null,longitude:coords?.longitude??null},selectedAt:now,closedAt:null,state:'en_route',data:{...initialJourneyData(now),trackingWindow:'06-18'},version:1};
  const permission=accessGuard(c,customer),statements=[];
  if(current){const closed=current.date===date?closeJourney(current,now,'customer_changed'):closeJourneyAtWindowEnd(current);statements.push(c.db.prepare(`UPDATE crm_journey_stops SET state=?,closed_at=?,data=?,version=version+1,mutation_id=? WHERE id=? AND member_id=? AND version=? AND closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM crm_journey_stops WHERE id=?) AND ${permission.sql}`).bind(closed.state,closed.closedAt,JSON.stringify(closed.data),mutation,current.id,c.me.id,current.version,id,...permission.args));const oldGate='EXISTS (SELECT 1 FROM crm_journey_stops WHERE id=? AND mutation_id=?)';if(canReadJourney(current,c)){const oldPermission=journeyGuard(c,current);statements.push(journeyLinkedTimingStatement(c,closed,oldGate+' AND '+oldPermission.sql,[current.id,mutation,...oldPermission.args],now));}}
  statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data,version,mutation_id) SELECT ?,?,?,?,?,?,?,NULL,?,?,1,? WHERE NOT EXISTS (SELECT 1 FROM crm_journey_stops WHERE member_id=? AND closed_at IS NULL) AND ${permission.sql}`).bind(id,c.me.id,date,customer.id,stop.regionScope,JSON.stringify(stop.snapshot),now,stop.state,JSON.stringify(stop.data),mutation,c.me.id,...permission.args));
  const result=await c.db.batch(statements);if(result.at(-1)?.meta.changes!==1)throw new CRMError('تغيّر اختيار العميل أو صلاحياتك. أعد المحاولة.',409);return response(stop,now);
 }
 const stop=await ownJourney(c,identifier.parse(body.stopId)),permission=journeyGuard(c,stop);
 if(action==='samples'){
  const incoming=z.array(pointSchema).min(1).max(50).parse(body.points),unique=new Set(incoming.map(point=>point.id));if(unique.size!==incoming.length)throw new CRMError('تكرار رقم عينة الموقع');
  const ignoredIds:string[]=[],placeholders=incoming.map(()=>'?').join(','),existing=(await c.db.prepare(`SELECT point_id AS id,captured_at AS capturedAt,latitude,longitude,accuracy FROM crm_journey_points WHERE stop_id=? AND (point_id IN (${placeholders}) OR captured_at IN (${placeholders}))`).bind(stop.id,...incoming.map(p=>p.id),...incoming.map(p=>new Date(p.capturedAt).toISOString())).all<JourneyPoint>()).results;
  const points:JourneyPoint[]=[];
  for(const input of incoming){const point={...input,capturedAt:new Date(input.capturedAt).toISOString(),receivedAt:now},prior=existing.find(p=>p.id===point.id||p.capturedAt===point.capturedAt);if(prior){if(prior.id!==point.id||prior.capturedAt!==point.capturedAt||prior.latitude!==point.latitude||prior.longitude!==point.longitude||prior.accuracy!==point.accuracy)throw new CRMError('عينة الموقع محفوظة ببيانات مختلفة',409);continue;}
   const at=Date.parse(point.capturedAt);if(at>Date.parse(now)+5000||at<Date.parse(now)-JOURNEY_REPLAY_MS||journeyDate(point.capturedAt)!==stop.date)throw new CRMError('وقت عينة الموقع قديم أو غير صحيح',400);
   if(!trackingWindowOpen(point.capturedAt)){ignoredIds.push(point.id);continue;}points.push(point);
  }
  if(!points.length)return response(stop,now,{acknowledgedIds:incoming.map(point=>point.id),ignoredIds});
  if(stop.state==='completed'&&stop.closedAt&&points.every(point=>Date.parse(point.capturedAt)>=Date.parse(stop.closedAt!)))return response(stop,now);
  if(stop.closedAt||stop.date!==date)throw new CRMError('انتهى خط السير لهذا العميل. اختر العميل لبدء تسجيل جديد.',409);
  const count=await c.db.prepare('SELECT COUNT(*) AS count FROM crm_journey_points p JOIN crm_journey_stops s ON s.id=p.stop_id WHERE s.member_id=? AND s.date=?').bind(c.me.id,date).first<{count:number}>();if((count?.count||0)+points.length>20000)throw new CRMError('وصلت للحد اليومي لعينات الموقع',429);
  let next:JourneyStop={...stop,data:{...stop.data,trackingWindow:'06-18'}};const accepted:JourneyPoint[]=[];
  for(const point of points){if(next.closedAt)break;const at=Date.parse(point.capturedAt);if(at>Date.parse(now)+5000||at<Date.parse(now)-JOURNEY_REPLAY_MS||at<Date.parse(stop.selectedAt)||journeyDate(point.capturedAt)!==stop.date)throw new CRMError('وقت عينة الموقع قديم أو غير صحيح',400);if(next.data.lastPoint&&at<=Date.parse(next.data.lastPoint.capturedAt))throw new CRMError('عينات الموقع غير مرتبة. حدّث التتبع.',409);next=applyJourneyPoint(next,point);accepted.push(point);}
  const gate='EXISTS (SELECT 1 FROM crm_journey_stops WHERE id=? AND version=? AND mutation_id=?)',args=[stop.id,stop.version+1,mutation];
  const statements=[c.db.prepare(`UPDATE crm_journey_stops SET state=?,closed_at=?,data=?,version=version+1,mutation_id=? WHERE id=? AND member_id=? AND version=? AND closed_at IS NULL AND ${permission.sql}`).bind(next.state,next.closedAt,JSON.stringify(next.data),mutation,stop.id,c.me.id,stop.version,...permission.args),...accepted.map(point=>c.db.prepare(`INSERT INTO crm_journey_points(stop_id,point_id,captured_at,received_at,latitude,longitude,accuracy) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(stop.id,point.id,point.capturedAt,now,point.latitude,point.longitude,point.accuracy,...args)),journeyLinkedTimingStatement(c,next,gate,args,now)];
  const saved=await c.db.batch(statements);if(saved[0].meta.changes!==1)throw new CRMError('تغيّر خط السير أو صلاحياتك. أعد تحميل البيانات.',409);return response({...next,version:stop.version+1},now,{acknowledgedIds:incoming.map(point=>point.id),ignoredIds});
 }
 if(action==='gap'&&stop.data.events.length>=2000)throw new CRMError('انتهت سعة أحداث خط السير. اختر العميل من جديد.',429);
 const reason=action==='end'?z.enum(['manual_end','day_end','contact_type_changed','date_changed']).default('manual_end').parse(body.reason):z.enum(['permission_denied','gps_unavailable','app_hidden','hidden','offline','tracking_paused','buffer_expired']).parse(body.reason);
 if(action==='end'&&c.me.role==='rep'&&['manual_end','day_end'].includes(reason))throw new CRMError('تسجيل خط السير يعمل تلقائيًا للمندوب ولا يمكن إيقافه يدويًا.',403);
 if(stop.closedAt)return response(stop,now);
 if(action==='gap'&&!trackingWindowOpen(now))return response(stop,now);
 const bounded=projectJourneyWindow(stop,now),next=bounded.closedAt?bounded:stop.date<date?closeJourney(stop,journeyRecordingBoundary(stop),'day_ended'):action==='end'?closeJourney(stop,now,reason):journeyGap(stop,now,reason),gate='EXISTS (SELECT 1 FROM crm_journey_stops WHERE id=? AND version=? AND mutation_id=?)',args=[stop.id,stop.version+1,mutation];
 const saved=await c.db.batch([c.db.prepare(`UPDATE crm_journey_stops SET state=?,closed_at=?,data=?,version=version+1,mutation_id=? WHERE id=? AND member_id=? AND version=? AND closed_at IS NULL AND ${permission.sql}`).bind(next.state,next.closedAt,JSON.stringify(next.data),mutation,stop.id,c.me.id,stop.version,...permission.args),journeyLinkedTimingStatement(c,next,gate,args,now)]);if(saved[0].meta.changes!==1)throw new CRMError('تغيّرت بيانات خط السير. أعد المحاولة.',409);return response({...next,version:stop.version+1},now);
 }catch(error){if(error instanceof z.ZodError)return Response.json({error:'بيانات خط السير غير صحيحة'},{status:400});return replyError(error);}}

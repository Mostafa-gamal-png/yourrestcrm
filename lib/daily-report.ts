import type {Row} from './crm';
import {customerCoordinates} from './customer-location';
import {detectMobileRouteStops,MOBILE_STOP_RADIUS_METERS,type MobileRouteObservedStop} from './mobile-route-stops';
import {distanceMeters,implausibleJourneyJump,journeyDate,JOURNEY_ENTER_METERS,JOURNEY_GAP_MS,JOURNEY_MAX_ACCURACY,type JourneyCommunication,type JourneyGap,type JourneyPoint,type JourneyReportData,type JourneyReportStop,type JourneyResult} from './journeys';

export type DailyFollowup={id:string;customerId:string;customerName:string;memberId:string;memberName:string;nextDate:string;nextAction:string};
export type AutoStation=MobileRouteObservedStop & {dayId:string;memberId:string;memberName:string;customerId:string|null;customerName:string;matchStatus:'matched'|'ambiguous'|'unmatched';linkedStopId?:string;results:JourneyResult[]};
export type DailySummary={firstMovementAt:string|null;lastActivityAt:string|null;recordedVisits:number;recordedCommunications:number;confirmedVisitSeconds:number;observedMovementSeconds:number;matchedCustomers:number;missingResults:number;gapCount:number};
export type DailyReportEnhancement={summary:DailySummary;automaticStations:AutoStation[];pendingFollowups:DailyFollowup[]};
type Interval={memberId:string;from:number;to:number};
type Observation=MobileRouteObservedStop & {dayId:string;memberId:string;memberName:string};
const time=(at:string|null|undefined)=>Date.parse(at||'');
const recordedAt=(result:JourneyResult)=>{const at=(result as JourneyResult & {recordedAt?:string}).recordedAt;return at&&Number.isFinite(time(at))?at:result.createdAt;};
const intersects=(a:number,b:number,c:number,d:number)=>a<d&&c<b;
const iso=(at:number)=>Number.isFinite(at)?new Date(at).toISOString():null;
const pointValid=(p:JourneyPoint)=>Number.isFinite(time(p.capturedAt))&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180&&(p.latitude!==0||p.longitude!==0)&&Number.isFinite(p.accuracy)&&p.accuracy>=0&&p.accuracy<=JOURNEY_MAX_ACCURACY;
const gapBetween=(gaps:JourneyGap[],from:number,to:number)=>gaps.some(g=>time(g.to)>from&&(time(g.from)<to||time(g.from)===time(g.to)&&time(g.to)===to));
function unionSeconds(intervals:Interval[]){
 let milliseconds=0;
 for(const memberId of new Set(intervals.map(i=>i.memberId))){
  let end=-Infinity;
  for(const part of intervals.filter(i=>i.memberId===memberId&&Number.isFinite(i.from)&&Number.isFinite(i.to)&&i.to>i.from).sort((a,b)=>a.from-b.from||a.to-b.to)){milliseconds+=Math.max(0,part.to-Math.max(end,part.from));end=Math.max(end,part.to);}
 }
 return Math.floor(milliseconds/1000);
}
function onsite(stop:JourneyReportStop){
 const from=time(stop.data.arrivalAt),to=time(stop.data.departureAt||stop.data.lastPoint?.capturedAt);
 return Number.isFinite(from)&&Number.isFinite(to)&&to>=from?{from,to}:null;
}
function observationOrder(a:Observation,b:Observation){return a.memberId.localeCompare(b.memberId)||time(a.startedAt)-time(b.startedAt)||time(b.lastObservedAt)-time(a.lastObservedAt)||a.id.localeCompare(b.id);}
/** Collapse duplicate recording sessions only where time and stationary location agree. */
function mergeObservations(observations:Observation[]){
 const merged:Observation[]=[];
 for(const observation of observations.sort(observationOrder)){
  const prior=merged.find(p=>p.memberId===observation.memberId&&p.date===observation.date&&intersects(time(p.startedAt),time(p.lastObservedAt),time(observation.startedAt),time(observation.lastObservedAt))&&distanceMeters(p,observation)+Math.max(p.accuracy,observation.accuracy)<=MOBILE_STOP_RADIUS_METERS);
  if(!prior){merged.push({...observation});continue;}
  if(time(observation.lastObservedAt)>time(prior.lastObservedAt)){
   prior.lastObservedAt=observation.lastObservedAt;prior.status=observation.status;prior.departureDetectedAt=observation.departureDetectedAt;prior.endReason=observation.endReason;
  }
  prior.accuracy=Math.max(prior.accuracy,observation.accuracy);
  prior.observedDurationSeconds=Math.floor((time(prior.lastObservedAt)-time(prior.startedAt))/1000);
  // The merged count is a conservative lower bound, not a sum of duplicate samples.
  prior.sampleCount=Math.max(prior.sampleCount,observation.sampleCount);
 }
 return merged;
}

/** Read-only evidence projection. Proximity never creates a visit or fills missing GPS. */
export function buildDailyReport(report:JourneyReportData,customers:Row[],contacts:JourneyCommunication[],pendingFollowups:DailyFollowup[]):DailyReportEnhancement{
 const inMember=(id:string)=>report.memberId==='all'||id===report.memberId;
 const now=time(report.serverTime),onDate=(at:string)=>Number.isFinite(time(at))&&time(at)<=now&&journeyDate(at)===report.date;
 const customerMap=new Map(customers.filter(c=>c.kind==='customer').map(c=>[c.id,c]));
 const stops=report.stops.filter(s=>s.date===report.date&&inMember(s.memberId));
 const days=(report.mobileDays||[]).filter(d=>d.date===report.date&&inMember(d.memberId));
 const observations=mergeObservations(days.flatMap(day=>(day.automaticStops??detectMobileRouteStops(day,report.serverTime)).filter(s=>s.date===report.date&&onDate(s.startedAt)&&onDate(s.lastObservedAt)&&time(s.lastObservedAt)>=time(s.startedAt)&&pointValid({...s,id:s.id,capturedAt:s.startedAt})).map(s=>({...s,dayId:day.id,memberId:day.memberId,memberName:day.memberName}))));
 const automaticStations:AutoStation[]=observations.map(observation=>{
  const station:AutoStation={...observation,customerId:null,customerName:'',matchStatus:'unmatched',results:[]};
  // Selected historical snapshots retain identity even if the current card moved.
  const represented=stops.filter(stop=>{
   const window=onsite(stop),target=stop.snapshot;
   return customerMap.has(stop.customerId)&&stop.memberId===station.memberId&&window&&intersects(window.from,window.to,time(station.startedAt),time(station.lastObservedAt))&&target.latitude!==null&&target.longitude!==null&&distanceMeters(station,{latitude:target.latitude,longitude:target.longitude})+station.accuracy<=JOURNEY_ENTER_METERS;
  });
  const identities=new Set(represented.map(stop=>stop.customerId));
  if(identities.size===1){
   const linked=[...represented].sort((a,b)=>time(a.selectedAt)-time(b.selectedAt)||a.id.localeCompare(b.id))[0];
   station.linkedStopId=linked.id;station.customerId=linked.customerId;station.customerName=linked.snapshot.customerName;station.matchStatus='matched';return station;
  }
  if(identities.size>1){station.matchStatus='ambiguous';return station;}
  const possible=[...customerMap.values()].flatMap(customer=>{
   const coordinates=customerCoordinates(customer.data);if(!coordinates)return [];
   const distance=distanceMeters(station,coordinates);
   return distance-station.accuracy<=JOURNEY_ENTER_METERS?[{customer,distance}]:[];
  });
  if(possible.length>1){station.matchStatus='ambiguous';return station;}
  const match=possible[0];
  // Without coordinate history a later card edit cannot prove its earlier location.
  if(match&&match.distance+station.accuracy<=JOURNEY_ENTER_METERS&&(!Number.isFinite(time(match.customer.updatedAt))||time(match.customer.updatedAt)<=time(station.startedAt))){station.customerId=match.customer.id;station.customerName=match.customer.data.name||'';station.matchStatus='matched';}
  return station;
 });
 const results=new Map<string,JourneyResult>();
 for(const stop of stops)for(const result of stop.results)if(result.date===report.date)results.set(result.id,result);
 const linkedIds=new Set(results.keys());
 const standalone=new Map<string,JourneyCommunication>();
 for(const contact of [...report.communications,...contacts])if(contact.date===report.date&&inMember(contact.memberId)&&customerMap.has(contact.customerId)&&!linkedIds.has(contact.id))standalone.set(contact.id,contact);
 for(const contact of standalone.values())results.set(contact.id,contact);
 // A recorded activity belongs to one observed interval only; uncertain collisions stay unassigned.
 for(const contact of standalone.values()){
  const at=recordedAt(contact);if(contact.type!=='visit'||!onDate(at))continue;
  const candidates=automaticStations.filter(s=>!s.linkedStopId&&s.matchStatus==='matched'&&s.memberId===contact.memberId&&s.customerId===contact.customerId&&time(at)>=time(s.startedAt)&&time(at)<=time(s.lastObservedAt));
  if(candidates.length===1)candidates[0].results.push({...contact});
 }
 const movement:Interval[]=[],visitIntervals:Interval[]=[],gaps:Interval[]=[],activityTimes:number[]=[];
 let firstMovement=Infinity;
 const collect=(memberId:string,points:JourneyPoint[],reportedGaps:JourneyGap[],start:string,end:string|null)=>{
  const from=time(start),to=Math.min(time(end)||now,now),ordered=[...points].sort((a,b)=>time(a.capturedAt)-time(b.capturedAt)||a.id.localeCompare(b.id));
  const conflicting=new Set<number>();
  for(let index=1;index<ordered.length;index++){const a=ordered[index-1],b=ordered[index];if(time(a.capturedAt)===time(b.capturedAt)&&(a.latitude!==b.latitude||a.longitude!==b.longitude||a.accuracy!==b.accuracy))conflicting.add(time(a.capturedAt));}
  let previous:JourneyPoint|null=null,uncertainFrom:number|null=null,lastTimedAt:number|null=null;
  for(const point of ordered){
   const at=time(point.capturedAt);
   if(!onDate(point.capturedAt)||at<from||at>to){previous=null;continue;}
   if(!pointValid(point)||conflicting.has(at)){
    uncertainFrom=uncertainFrom??(previous?time(previous.capturedAt):lastTimedAt??from);
    if(Number.isFinite(uncertainFrom)&&at>=uncertainFrom)gaps.push({memberId,from:uncertainFrom,to:at});
    previous=null;lastTimedAt=at;continue;
   }
   if(uncertainFrom!==null){if(at>=uncertainFrom)gaps.push({memberId,from:uncertainFrom,to:at});uncertainFrom=null;previous=null;}
   activityTimes.push(at);
   if(previous){const preceding=time(previous.capturedAt),elapsed=at-preceding;
    const jump=elapsed>0&&implausibleJourneyJump(previous,point);
    if(elapsed>JOURNEY_GAP_MS||jump)gaps.push({memberId,from:preceding,to:at});
    if(elapsed>0&&elapsed<=JOURNEY_GAP_MS&&!gapBetween(reportedGaps,preceding,at)&&!jump&&distanceMeters(previous,point)>previous.accuracy+point.accuracy){movement.push({memberId,from:preceding,to:at});firstMovement=Math.min(firstMovement,at);}
    if(elapsed===0&&(point.latitude!==previous.latitude||point.longitude!==previous.longitude||point.accuracy!==previous.accuracy)){previous=null;continue;}
   }
   previous=point;lastTimedAt=at;
  }
  for(const gap of reportedGaps){const a=Math.max(time(gap.from),from),b=Math.min(time(gap.to),to);if(Number.isFinite(a)&&Number.isFinite(b)&&b>=a)gaps.push({memberId,from:a,to:b});}
 };
 for(const day of days)collect(day.memberId,day.points,day.gaps,day.startedAt,day.endedAt);
 for(const stop of stops){
  collect(stop.memberId,stop.points,stop.data.gaps,stop.selectedAt,stop.closedAt);
  const window=onsite(stop);
  if(window&&stop.data.departureAt&&onDate(stop.data.arrivalAt!)&&onDate(stop.data.departureAt)&&!stop.data.durationUncertain&&Number.isFinite(stop.data.durationSeconds)&&stop.data.durationSeconds!==null&&stop.data.durationSeconds>=0&&!gapBetween(stop.data.gaps,window.from,window.to)&&stop.results.some(r=>r.type==='visit'&&r.date===report.date))visitIntervals.push({memberId:stop.memberId,...window});
 }
 for(const result of results.values())if(onDate(recordedAt(result)))activityTimes.push(time(recordedAt(result)));
 const hasVisitResult=(result:JourneyResult)=>result.type==='visit'&&result.date===report.date&&typeof result.result==='string'&&!!result.result.trim();
 const missing:Interval[]=[];
 for(const stop of stops){const window=onsite(stop);if(window&&!stop.results.some(hasVisitResult))missing.push({memberId:stop.memberId+'\0'+stop.customerId,...window});}
 for(const station of automaticStations)if(!station.linkedStopId&&station.matchStatus==='matched'&&!station.results.some(hasVisitResult))missing.push({memberId:station.memberId+'\0'+station.customerId,from:time(station.startedAt),to:time(station.lastObservedAt)});
 const intervalCount=(intervals:Interval[])=>{let count=0;const unique=[...new Map(intervals.map(i=>[JSON.stringify([i.memberId,i.from,i.to]),i])).values()];for(const id of new Set(unique.map(i=>i.memberId))){let end=-Infinity;for(const i of unique.filter(i=>i.memberId===id).sort((a,b)=>a.from-b.from||a.to-b.to)){if(i.from>end)count++;end=Math.max(end,i.to);}}return count;};
 const matchedCustomers=new Set([...stops.filter(s=>!!s.data.arrivalAt).map(s=>s.customerId),...automaticStations.filter(s=>s.matchStatus==='matched').map(s=>s.customerId!)]);
 const summary:DailySummary={firstMovementAt:iso(firstMovement),lastActivityAt:iso(activityTimes.reduce((latest,at)=>Math.max(latest,at),-Infinity)),recordedVisits:[...results.values()].filter(r=>r.type==='visit').length,recordedCommunications:[...results.values()].filter(r=>r.type!=='visit').length,confirmedVisitSeconds:unionSeconds(visitIntervals),observedMovementSeconds:unionSeconds(movement),matchedCustomers:matchedCustomers.size,missingResults:intervalCount(missing),gapCount:intervalCount(gaps)};
 const followups=new Map(pendingFollowups.filter(f=>customerMap.has(f.customerId)&&inMember(f.memberId)&&/^\d{4}-\d{2}-\d{2}$/.test(f.nextDate)&&Number.isFinite(time(f.nextDate))&&new Date(f.nextDate).toISOString().slice(0,10)===f.nextDate&&f.nextDate<=report.date).map(f=>[f.id,{...f}]));
 return {summary,automaticStations,pendingFollowups:[...followups.values()].sort((a,b)=>a.nextDate.localeCompare(b.nextDate)||a.memberId.localeCompare(b.memberId)||a.id.localeCompare(b.id))};
}

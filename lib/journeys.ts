import type {Coordinates} from './customer-location';
import type {MobileRouteReportDay} from './mobile-route';
import type {DailyReportEnhancement} from './daily-report';
import type {TrackingCoverage} from './tracking-coverage';
import {trackingWindowEnd} from './tracking-window';
export const JOURNEY_ENTER_METERS=150,JOURNEY_EXIT_METERS=225,JOURNEY_MAX_ACCURACY=75,JOURNEY_CONFIRM_MS=15000,JOURNEY_GAP_MS=120000,JOURNEY_REPLAY_MS=15*60000;
export type JourneyPoint={id:string;capturedAt:string;receivedAt?:string;latitude:number;longitude:number;accuracy:number};
export type JourneyGap={from:string;to:string;reason:string};
export type JourneyEvent={type:'selected'|'arrival'|'departure'|'gap'|'interrupted';at:string;reason?:string};
export type JourneyData={arrivalAt:string|null;departureAt:string|null;durationSeconds:number|null;durationUncertain:boolean;observedSeconds:number;gaps:JourneyGap[];events:JourneyEvent[];lastPoint?:JourneyPoint;candidate?:{type:'inside'|'outside';at:string};trackingWindow?:'06-18'};
export type JourneyStop={id:string;memberId:string;date:string;customerId:string;regionScope:string;snapshot:{customerName:string;region:string;latitude:number|null;longitude:number|null};selectedAt:string;closedAt:string|null;state:'en_route'|'onsite'|'completed'|'interrupted';data:JourneyData;version:number};
export type JourneyResult={id:string;date:string;createdAt:string;recordedAt?:string;type:string;summary:string;result:string;nextAction:string;nextDate:string;requestedProducts?:string[];hasCompetitor?:boolean;competitorName?:string;competitorNotes?:string;competitorFileId?:string;competitorFileName?:string;customerNeeds?:string;salesStage?:string;strength?:string};
export type JourneyCommunication=JourneyResult & {memberId:string;memberName:string;customerId:string;customerName:string};
export type JourneyReportStop=JourneyStop & {memberName:string;points:JourneyPoint[];segments:JourneyPoint[][];results:JourneyResult[]};
export type JourneyReportData={date:string;memberId:string;members:{id:string;name:string;role:string;active:number}[];stops:JourneyReportStop[];communications:JourneyCommunication[];mobileDays?:MobileRouteReportDay[];daily?:DailyReportEnhancement;tracking?:TrackingCoverage[];serverTime:string};
const journeyDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
export function journeyDate(at:string|number=Date.now()){return journeyDay.format(new Date(at));}
export function initialJourneyData(at:string):JourneyData{return{arrivalAt:null,departureAt:null,durationSeconds:null,durationUncertain:false,observedSeconds:0,gaps:[],events:[{type:'selected',at}]};}
export function distanceMeters(a:Coordinates,b:Coordinates){const rad=Math.PI/180,dlat=(b.latitude-a.latitude)*rad,dlon=(b.longitude-a.longitude)*rad,h=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
export function implausibleJourneyJump(a:JourneyPoint,b:JourneyPoint){const seconds=(Date.parse(b.capturedAt)-Date.parse(a.capturedAt))/1000;return seconds>0&&distanceMeters(a,b)-a.accuracy-b.accuracy>seconds*100;}
export function journeyGap(stop:JourneyStop,at:string,reason:string):JourneyStop{
 const next=structuredClone(stop),data=next.data;delete data.candidate;
 const from=data.lastPoint?.capturedAt||next.selectedAt;
 if(data.arrivalAt&&!data.departureAt)data.durationUncertain=true;
 const last=data.gaps.at(-1),lastEvent=data.events.at(-1);
 if(last?.reason===reason&&Date.parse(last.to)>=Date.parse(from)&&lastEvent?.type==='gap'&&lastEvent.reason===reason){last.to=at;lastEvent.at=at;}
 else if(!last||last.to!==at||last.reason!==reason){data.gaps.push({from,to:at,reason});data.events.push({type:'gap',at,reason});}
 // Keep noisy GPS failures bounded while retaining a conservative explicit unobserved interval.
 if(data.gaps.length>256){const removed=data.gaps.splice(0,128),combined={from:removed[0].from,to:removed.at(-1)!.to,reason:'multiple_tracking_gaps'};data.gaps.unshift(combined);data.events=data.events.filter(event=>event.type!=='gap'||Date.parse(event.at)>Date.parse(combined.to));data.events.push({type:'gap',at:combined.to,reason:combined.reason});data.events.sort((a,b)=>a.at.localeCompare(b.at));}
 return next;
}
/** Deterministic geofence evidence. It never infers movement across unobserved periods. */
export function applyJourneyPoint(stop:JourneyStop,point:JourneyPoint):JourneyStop{
 if(!Number.isFinite(Date.parse(point.capturedAt))||!Number.isFinite(point.latitude)||Math.abs(point.latitude)>90||!Number.isFinite(point.longitude)||Math.abs(point.longitude)>180||!Number.isFinite(point.accuracy)||point.accuracy<0||point.accuracy>10000||point.latitude===0&&point.longitude===0)throw new Error('INVALID_POINT');
 if(Date.parse(point.capturedAt)<Date.parse(stop.selectedAt))throw new Error('POINT_BEFORE_SELECTION');
 let next=structuredClone(stop);if(next.closedAt)throw new Error('JOURNEY_CLOSED');
 const previous=next.data.lastPoint;
 if(!previous&&Date.parse(point.capturedAt)-Date.parse(next.selectedAt)>JOURNEY_GAP_MS)next=journeyGap(next,point.capturedAt,'tracking_not_started');
 if(previous&&Date.parse(point.capturedAt)<=Date.parse(previous.capturedAt))throw new Error('POINT_OUT_OF_ORDER');
 if(previous&&implausibleJourneyJump(previous,point)){next=journeyGap(next,point.capturedAt,'implausible_location_jump');next.data.lastPoint=point;return next;}
 if(previous&&Date.parse(point.capturedAt)-Date.parse(previous.capturedAt)>JOURNEY_GAP_MS)next=journeyGap(next,point.capturedAt,'tracking_gap');
 const data=next.data,target=next.snapshot;
 if(previous&&data.gaps.some(g=>Date.parse(g.to)>Date.parse(previous.capturedAt)&&Date.parse(g.to)<=Date.parse(point.capturedAt)))delete data.candidate;
 if(target.latitude===null||target.longitude===null||point.accuracy>JOURNEY_MAX_ACCURACY){
  if(data.arrivalAt&&!data.departureAt)next=journeyGap(next,point.capturedAt,target.latitude===null?'customer_location_missing':'low_accuracy');
  delete next.data.candidate;next.data.lastPoint=point;return next;
 }
 const distance=distanceMeters(point,{latitude:target.latitude,longitude:target.longitude}),inside=distance+point.accuracy<=JOURNEY_ENTER_METERS,outside=distance-point.accuracy>=JOURNEY_EXIT_METERS;
 const candidateType=!data.arrivalAt&&inside?'inside':data.arrivalAt&&outside?'outside':null;
 if(data.arrivalAt&&previous&&inside&&previous.accuracy<=JOURNEY_MAX_ACCURACY&&distanceMeters(previous,{latitude:target.latitude,longitude:target.longitude})+previous.accuracy<=JOURNEY_ENTER_METERS&&Date.parse(point.capturedAt)-Date.parse(previous.capturedAt)<=JOURNEY_GAP_MS)data.observedSeconds+=Math.floor((Date.parse(point.capturedAt)-Date.parse(previous.capturedAt))/1000);
 if(!candidateType)delete data.candidate;
 else if(data.candidate?.type!==candidateType)data.candidate={type:candidateType,at:point.capturedAt};
 else if(Date.parse(point.capturedAt)-Date.parse(data.candidate.at)>=JOURNEY_CONFIRM_MS){
  const at=data.candidate.at;delete data.candidate;
  if(candidateType==='inside'){data.arrivalAt=at;next.state='onsite';data.observedSeconds=Math.floor((Date.parse(point.capturedAt)-Date.parse(at))/1000);data.events.push({type:'arrival',at});}
  else{data.departureAt=at;next.closedAt=at;next.state='completed';data.durationSeconds=data.durationUncertain?null:Math.max(0,Math.floor((Date.parse(at)-Date.parse(data.arrivalAt!))/1000));data.events.push({type:'departure',at});}
 }
 data.lastPoint=point;return next;
}
export function closeJourney(stop:JourneyStop,at:string,reason='manual_end'):JourneyStop{if(stop.closedAt)return stop;const next=journeyGap(stop,at,reason);next.closedAt=at;next.state='interrupted';next.data.durationSeconds=null;next.data.durationUncertain=!!next.data.arrivalAt;next.data.events.push({type:'interrupted',at,reason});return next;}
/** Historical unmarked stops retain their original day boundary. A current legacy
 * collector is paused at company hours as well, without inventing GPS evidence. */
export function journeyRecordingBoundary(stop:JourneyStop){return stop.data.trackingWindow==='06-18'?trackingWindowEnd(stop.date):stop.date+'T21:00:00.000Z';}
export function closeJourneyAtWindowEnd(stop:JourneyStop){
 const cutoff=trackingWindowEnd(stop.date),at=[cutoff,stop.selectedAt,stop.data.lastPoint?.capturedAt||cutoff].sort().at(-1)!;
 return closeJourney(stop,at,'tracking_window_ended');
}
export function projectJourneyWindow(stop:JourneyStop,now:string){
 if(stop.closedAt)return stop;
 const cutoff=stop.data.trackingWindow==='06-18'||stop.date===journeyDate(now)?trackingWindowEnd(stop.date):journeyRecordingBoundary(stop);
 return now>=cutoff?(cutoff===trackingWindowEnd(stop.date)?closeJourneyAtWindowEnd(stop):closeJourney(stop,cutoff,'day_ended')):stop;
}
/** Segments only join consecutive accurate samples within the observation window. */
export function journeySegments(points:JourneyPoint[],gaps:JourneyGap[]=[]){const segments:JourneyPoint[][]=[];let current:JourneyPoint[]=[];for(const point of points){const prior=current.at(-1),broken=point.accuracy>JOURNEY_MAX_ACCURACY||prior&&(Date.parse(point.capturedAt)-Date.parse(prior.capturedAt)>JOURNEY_GAP_MS||implausibleJourneyJump(prior,point)||gaps.some(g=>Date.parse(g.to)>Date.parse(prior.capturedAt)&&Date.parse(g.from)<Date.parse(point.capturedAt)));if(broken){if(current.length)segments.push(current);current=[];}if(point.accuracy<=JOURNEY_MAX_ACCURACY)current.push(point);}if(current.length)segments.push(current);return segments;}
export function journeyVisitTiming(stop:JourneyStop){return{journeyStopId:stop.id,timingSource:'journey',startedAt:stop.data.arrivalAt||'',endedAt:stop.data.departureAt||'',durationSeconds:stop.data.durationSeconds,durationReview:stop.data.durationUncertain||!stop.data.departureAt,journeyDurationUncertain:stop.data.durationUncertain};}

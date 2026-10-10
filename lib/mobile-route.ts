import {detectMobileRouteStops,type MobileRouteObservedStop} from './mobile-route-stops';
import {trackingWindowStart,trackingWindowEnd,trackingWindowOpen} from './tracking-window';
import {journeyDate,journeySegments,implausibleJourneyJump,JOURNEY_GAP_MS,JOURNEY_MAX_ACCURACY,initialJourneyData,applyJourneyPoint,journeyGap,closeJourney,type JourneyStop,type JourneyPoint,type JourneyGap} from './journeys';
export type MobileRoutePoint=JourneyPoint & {stopId:string|null};
export type MobileRouteDay={id:string;memberId:string;deviceId:string;date:string;regionScope:string;startedAt:string;endedAt:string|null;expiresAt:string;lastPointAt:string|null;version:number;gaps:JourneyGap[];trackingWindow?:'06-18'};
export type MobileRouteStoredDay=MobileRouteDay & {lastPoint?:MobileRoutePoint};
export type MobileRouteReportDay=Omit<MobileRouteDay,'deviceId'> & {memberName:string;points:MobileRoutePoint[];segments:JourneyPoint[][];automaticStops?:MobileRouteObservedStop[]};
export const mobileDayExpiry=trackingWindowEnd;
export const mobileDayStart=trackingWindowStart;
export const mobileLegacyDayExpiry=(date:string)=>date+'T21:00:00.000Z';
export function mobilePublicDay(day:MobileRouteStoredDay,now:string):MobileRouteDay{const {lastPoint,...publicDay}=day;const expiry=day.trackingWindow==='06-18'||day.date===journeyDate(now)?mobileDayExpiry(day.date):day.expiresAt;return {...publicDay,expiresAt:expiry,endedAt:day.endedAt||(now>=expiry?expiry:null)};}
export function mobileGap(day:MobileRouteStoredDay,at:string,reason:string){const next=structuredClone(day),from=day.lastPointAt||day.startedAt,last=next.gaps.at(-1);if(last&&last.reason===reason&&last.from===from){if(at>last.to)last.to=at;}else if(!next.gaps.some(g=>g.from===from&&g.to===at&&g.reason===reason))next.gaps.push({from,to:at,reason});if(next.gaps.length>256){const old=next.gaps.splice(0,128);next.gaps.unshift({from:old[0].from,to:old.at(-1)!.to,reason:'multiple_tracking_gaps'});}return next;}
export function mobileApplyPoint(day:MobileRouteStoredDay,point:MobileRoutePoint){let next=structuredClone(day);const prior=next.lastPoint;if(Date.parse(point.capturedAt)-Date.parse(prior?.capturedAt||next.startedAt)>JOURNEY_GAP_MS)next=mobileGap(next,point.capturedAt,prior?'tracking_gap':'tracking_not_started');if(point.accuracy>JOURNEY_MAX_ACCURACY)next=mobileGap(next,point.capturedAt,'low_accuracy');if(prior&&implausibleJourneyJump(prior,point))next=mobileGap(next,point.capturedAt,'implausible_location_jump');next.lastPoint=point;next.lastPointAt=point.capturedAt;return next;}
export function mobileReportDay(day:MobileRouteStoredDay,points:MobileRoutePoint[],memberName:string,now:string):MobileRouteReportDay{let publicDay=mobilePublicDay(day,now);const end=publicDay.endedAt||now;const missingExpected=(!day.trackingWindow&&day.date<journeyDate(now))||(!publicDay.endedAt&&trackingWindowOpen(now))||!!day.endedAt&&day.endedAt<mobileDayExpiry(day.date);if(missingExpected&&Date.parse(end)-Date.parse(day.lastPointAt||day.startedAt)>JOURNEY_GAP_MS)publicDay=mobilePublicDay(mobileGap(day,end,'no_recent_location'),now);const {deviceId,...safe}=publicDay;return {...safe,memberName,points,segments:journeySegments(points,safe.gaps),automaticStops:detectMobileRouteStops({...safe,points},now)};}

/** Only an automatic midnight interruption can be refined by late verified evidence. */
export function mobileRolloverStop(stop:JourneyStop){return stop.state==='interrupted'&&[mobileDayExpiry(stop.date),mobileLegacyDayExpiry(stop.date)].includes(stop.closedAt||'')&&stop.data.events.some(event=>event.type==='interrupted'&&event.at===stop.closedAt&&['day_ended','tracking_window_ended'].includes(event.reason||''));}
/** A customer switch closes an interval, but does not discard its queued GPS.
 * Manual/cancelled/completed stops remain immutable. */
export function mobileReplayableStop(stop:JourneyStop){return mobileRolloverStop(stop)||stop.state==='interrupted'&&!!stop.closedAt&&stop.data.events.some(event=>event.type==='interrupted'&&event.at===stop.closedAt&&event.reason==='customer_changed');}
export function replayMobileInterruptedStop(stop:JourneyStop,points:JourneyPoint[]){
 let next:JourneyStop={...stop,closedAt:null,state:'en_route',data:{...initialJourneyData(stop.selectedAt),...(stop.data.trackingWindow?{trackingWindow:stop.data.trackingWindow}:{})}};
 // The closing boundary is not location evidence. Only verified observations
 // captured inside the original interval may refine arrival or departure.
 const gaps=stop.data.gaps.filter(gap=>!['day_ended','tracking_window_ended','customer_changed'].includes(gap.reason)&&gap.to>=stop.selectedAt&&gap.to<=stop.closedAt!).sort((a,b)=>a.to.localeCompare(b.to));let index=0;
 for(const point of points.filter(point=>point.capturedAt>=stop.selectedAt&&point.capturedAt<=stop.closedAt!).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt))){
  if(next.closedAt)break;
  while(index<gaps.length&&gaps[index].to<=point.capturedAt){next=journeyGap(next,gaps[index].to,gaps[index].reason);index++;}
  next=applyJourneyPoint(next,point);
 }
 if(!next.closedAt){while(index<gaps.length){next=journeyGap(next,gaps[index].to,gaps[index].reason);index++;}const reason=stop.data.events.find(event=>event.type==='interrupted'&&event.at===stop.closedAt)?.reason||'day_ended';next=closeJourney(next,stop.closedAt!,reason);}
 return next;
}
export const replayMobileRolloverStop=replayMobileInterruptedStop;

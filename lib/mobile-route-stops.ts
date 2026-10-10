import {distanceMeters,implausibleJourneyJump,journeyDate,JOURNEY_GAP_MS,JOURNEY_MAX_ACCURACY,type JourneyGap,type JourneyPoint} from './journeys';

/** A GPS dwell observation is not evidence of a customer visit or of the person's activity. */
export const MOBILE_STOP_MIN_DWELL_MS=5*60*1000;
export const MOBILE_STOP_RADIUS_METERS=100;
export type MobileStopEndReason='movement'|'recorded_gap'|'sample_gap'|'low_accuracy'|'implausible_jump'|'invalid_sample'|'boundary_uncertain'|'recording_ended'|'day_boundary'|'no_recent_location'|'ongoing';
export type MobileRouteObservedStop={
 id:string;date:string;latitude:number;longitude:number;accuracy:number;
 startedAt:string;lastObservedAt:string;observedDurationSeconds:number;sampleCount:number;
 status:'departed'|'ongoing'|'interrupted';departureDetectedAt:string|null;endReason:MobileStopEndReason;
};
type StopSource={id:string;date:string;points:JourneyPoint[];gaps:JourneyGap[];endedAt:string|null};
const timestamp=(value:string)=>Date.parse(value);
const validPoint=(point:JourneyPoint)=>Number.isFinite(timestamp(point.capturedAt))&&Number.isFinite(point.latitude)&&Math.abs(point.latitude)<=90&&Number.isFinite(point.longitude)&&Math.abs(point.longitude)<=180&&(point.latitude!==0||point.longitude!==0)&&Number.isFinite(point.accuracy)&&point.accuracy>=0;
function hasGap(gaps:JourneyGap[],from:number,to:number){return gaps.some(gap=>timestamp(gap.to)>from&&(timestamp(gap.from)<to||timestamp(gap.from)===timestamp(gap.to)&&timestamp(gap.to)===to));}

/**
 * Derive within-day, within-session dwell observations from already-authorized samples.
 * Fixed anchor prevents a moving centroid from turning slow travel into a long stop.
 * The observation covers only the first through last qualifying samples. Neither
 * recording start/end, day boundaries nor the first outside fix invent an arrival,
 * departure time or missing duration. An outside fix is separate departure evidence.
 */
export function detectMobileRouteStops(day:StopSource,now:string):MobileRouteObservedStop[]{
 const observations:MobileRouteObservedStop[]=[];
 let cluster:{first:JourneyPoint;last:JourneyPoint;count:number;accuracy:number}|null=null;
 let previous:JourneyPoint|null=null;
 const finish=(endReason:MobileStopEndReason,departureDetectedAt:string|null=null)=>{
  if(cluster&&timestamp(cluster.last.capturedAt)-timestamp(cluster.first.capturedAt)>=MOBILE_STOP_MIN_DWELL_MS){
   observations.push({id:day.id+':'+cluster.first.id,date:day.date,latitude:cluster.first.latitude,longitude:cluster.first.longitude,accuracy:cluster.accuracy,startedAt:cluster.first.capturedAt,lastObservedAt:cluster.last.capturedAt,observedDurationSeconds:Math.floor((timestamp(cluster.last.capturedAt)-timestamp(cluster.first.capturedAt))/1000),sampleCount:cluster.count,status:endReason==='movement'?'departed':endReason==='ongoing'?'ongoing':'interrupted',departureDetectedAt,endReason});
  }
  cluster=null;
 };
 const begin=(point:JourneyPoint)=>({first:point,last:point,count:1,accuracy:point.accuracy});
 const sorted=[...day.points].sort((a,b)=>timestamp(a.capturedAt)-timestamp(b.capturedAt));
 for(const point of sorted){
  if(!validPoint(point)||timestamp(point.capturedAt)>timestamp(now)||(day.endedAt!==null&&timestamp(point.capturedAt)>timestamp(day.endedAt))){finish('invalid_sample');previous=null;continue;}
  if(journeyDate(point.capturedAt)!==day.date){finish('day_boundary');previous=null;continue;}
  if(previous&&timestamp(point.capturedAt)===timestamp(previous.capturedAt)){
   if(point.latitude===previous.latitude&&point.longitude===previous.longitude&&point.accuracy===previous.accuracy)continue;
   finish('invalid_sample');previous=null;continue;
  }
  if(point.accuracy>JOURNEY_MAX_ACCURACY){finish('low_accuracy');previous=null;continue;}
  if(previous&&implausibleJourneyJump(previous,point)){finish('implausible_jump');previous=point;continue;}
  if(previous&&timestamp(point.capturedAt)-timestamp(previous.capturedAt)>JOURNEY_GAP_MS)finish('sample_gap');
  if(previous&&hasGap(day.gaps,timestamp(previous.capturedAt),timestamp(point.capturedAt)))finish('recorded_gap');
  if(!cluster)cluster=begin(point);
  else{
   const distance=distanceMeters(cluster.first,point);
   if(distance+point.accuracy<=MOBILE_STOP_RADIUS_METERS){cluster.last=point;cluster.count++;cluster.accuracy=Math.max(cluster.accuracy,point.accuracy);}
   else{
    const outside=distance-point.accuracy>MOBILE_STOP_RADIUS_METERS;
    finish(outside?'movement':'boundary_uncertain',outside?point.capturedAt:null);
    cluster=begin(point);
   }
  }
  previous=point;
 }
 if(cluster){
  const last=timestamp(cluster.last.capturedAt),nowAt=timestamp(now),ended=day.endedAt?timestamp(day.endedAt):null;
  if(journeyDate(now)>day.date)finish('day_boundary');
  else if(ended!==null)finish('recording_ended');
  else if(hasGap(day.gaps,last,nowAt))finish('recorded_gap');
  else if(!Number.isFinite(nowAt)||nowAt-last>JOURNEY_GAP_MS)finish('no_recent_location');
  else finish('ongoing');
 }
 return observations;
}

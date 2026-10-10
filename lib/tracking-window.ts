/** Company route collection hours. Capture time is authoritative; queued
 * in-window observations may be uploaded after the collector has paused. */
export const TRACKING_TIME_ZONE='Asia/Riyadh';
export const TRACKING_START_HOUR=6,TRACKING_END_HOUR=18;
/** JavaScript weekdays: Sunday=0; Friday=5 is the company's weekly day off. */
export const TRACKING_WORKING_DAYS=[0,1,2,3,4,6] as const;
type TrackingTime=string|number|Date;
const clock=new Intl.DateTimeFormat('en-CA',{timeZone:TRACKING_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function parts(at:TrackingTime){
 const date=new Date(at),ms=date.getTime();if(!Number.isFinite(ms))return null;
 const fields=Object.fromEntries(clock.formatToParts(date).map(part=>[part.type,part.value]));
 const localDate=`${fields.year}-${fields.month}-${fields.day}`;
 return {date:localDate,hour:Number(fields.hour),ms,weekday:new Date(localDate+'T00:00:00.000Z').getUTCDay()};
}
export function trackingWorkingDay(date:string){return /^\d{4}-\d{2}-\d{2}$/.test(date)&&TRACKING_WORKING_DAYS.some(day=>day===new Date(date+'T00:00:00.000Z').getUTCDay());}
export function trackingWindowOpen(at:TrackingTime=Date.now()){const value=parts(at);return !!value&&value.weekday!==5&&value.hour>=TRACKING_START_HOUR&&value.hour<TRACKING_END_HOUR;}
/** Saudi Arabia uses UTC+03:00 throughout the year. */
export const trackingWindowStart=(date:string)=>date+'T03:00:00.000Z';
export const trackingWindowEnd=(date:string)=>date+'T15:00:00.000Z';
export type TrackingWindowStatus={timeZone:typeof TRACKING_TIME_ZONE;startHour:number;endHour:number;workingDays:typeof TRACKING_WORKING_DAYS;date:string;open:boolean;startsAt:string;endsAt:string;nextStartsAt:string;nextBoundaryAt:string};
export function trackingWindowStatus(at:TrackingTime=Date.now()):TrackingWindowStatus{
 const value=parts(at);if(!value)throw new RangeError('Invalid tracking time');
 const {date,hour,ms}=value,startsAt=trackingWindowStart(date),endsAt=trackingWindowEnd(date),open=trackingWorkingDay(date)&&hour>=TRACKING_START_HOUR&&hour<TRACKING_END_HOUR;
 let nextDate=date;
 while(!trackingWorkingDay(nextDate)||Date.parse(trackingWindowStart(nextDate))<=ms)nextDate=new Date(Date.parse(nextDate+'T00:00:00.000Z')+86400000).toISOString().slice(0,10);
 const nextStartsAt=trackingWindowStart(nextDate);
 return {timeZone:TRACKING_TIME_ZONE,startHour:TRACKING_START_HOUR,endHour:TRACKING_END_HOUR,workingDays:TRACKING_WORKING_DAYS,date,open,startsAt,endsAt,nextStartsAt,nextBoundaryAt:open?endsAt:nextStartsAt};
}

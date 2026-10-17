/** Working hours used for customer-service response targets: Saturday to Thursday, 08:00 to 18:00 Asia/Riyadh.
 * Saudi Arabia keeps UTC+03:00 all year, so local time is a fixed shift of the epoch and no calendar library is needed. */
export const WORKING_TIME_ZONE='Asia/Riyadh';
export const WORKING_DAY_START_HOUR=8,WORKING_DAY_END_HOUR=18;
/** JavaScript weekdays: Sunday=0; Friday=5 is the weekly day off. */
export const WORKING_WEEKDAYS:readonly number[]=[0,1,2,3,4,6];
const OFFSET_MS=3*3600000,DAY_MS=86400000,HOUR_MS=3600000;
const WORKING_BY_WEEKDAY=[0,1,2,3,4,5,6].map(weekday=>WORKING_WEEKDAYS.includes(weekday));
/** The weekday (Sunday=0) of a local day that starts on a multiple of DAY_MS from the epoch, which fell on a Thursday. Plain arithmetic: a Date per day made long spans slow. */
const weekdayOf=(day:number)=>((day/DAY_MS+4)%7+7)%7;
/** Working hours elapsed between two instants, as a decimal number of hours; 0 when the order is reversed or a value is invalid. */
export function workingHoursBetween(from:string|number,to:string|number):number{
 const start=typeof from==='number'?from:Date.parse(from),end=typeof to==='number'?to:Date.parse(to);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 0;
 const localStart=start+OFFSET_MS,localEnd=end+OFFSET_MS;
 let day=Math.floor(localStart/DAY_MS)*DAY_MS,total=0;
 for(let guard=0;day<localEnd&&guard<40000;guard++,day+=DAY_MS){
  if(!WORKING_BY_WEEKDAY[weekdayOf(day)])continue;
  const open=day+WORKING_DAY_START_HOUR*HOUR_MS,close=day+WORKING_DAY_END_HOUR*HOUR_MS,a=Math.max(open,localStart),b=Math.min(close,localEnd);
  if(b>a)total+=(b-a)/HOUR_MS;
 }
 return Math.round(total*100)/100;
}

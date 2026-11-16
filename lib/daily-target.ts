// «مبيعات اليوم قصاد مستهدف اليوم» (the owner, 2026-11-16, item 8 of the GSCO comparison list). As GSCO 2.13.68 (lib/crm/shared.ts
// reportRows, «صافي مبيعات اليوم» beside «مستهدف اليوم» for each product): the day's target is the month's target divided by the month's
// working days. Yourrest's working week is Saturday to Thursday (Friday is the weekly day off: lib/working-hours.ts, lib/tracking-window.ts),
// which is GSCO's «weekend» setting; a Friday's own share is therefore zero and the page says the day is the weekly day off. The day's sales
// are the confirmed sales documents of that day (CRM and ERP, returns deducted), quantity by product, of the same people whose sales the
// month's achievement counts (lib/targets.ts quantityAttainment: a person, or the team of a computed supervisor's or manager's target).
// Days are Asia/Riyadh calendar days. Pure: shared by the server («أهدافي», lib/own-targets-server.ts) and the page.
import {WORKING_WEEKDAYS} from './working-hours';

const DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
const round=(value:number)=>Math.round(value*1_000_000)/1_000_000;
/** A real calendar day written YYYY-MM-DD (Arabic-Indic and Persian digits read), else ''. */
export function calendarDay(value:unknown):string{
 if(typeof value!=='string')return '';
 const text=value.trim().replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c>='۰'?0x6f0:0x660)));
 const match=text.match(DATE);if(!match)return '';
 const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
 return date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()===Number(match[2])-1&&date.getUTCDate()===Number(match[3])?text:'';
}
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
/** The Riyadh calendar day of a moment (the server's and the device's own clocks never decide which day it is). */
export const riyadhDay=(at:Date|string|number=new Date())=>riyadh.format(new Date(at));
/** Every day of a month (YYYY-MM), in order. */
export function monthDays(month:string):string[]{
 const match=month.match(/^(\d{4})-(\d{2})$/);if(!match)return [];
 const year=Number(match[1]),index=Number(match[2])-1;if(index<0||index>11)return [];
 const count=new Date(Date.UTC(year,index+1,0)).getUTCDate();
 return Array.from({length:count},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));
}
/** A working day of the company: not a Friday. */
export const isWorkingDay=(date:string)=>!!calendarDay(date)&&WORKING_WEEKDAYS.includes(new Date(date+'T00:00:00Z').getUTCDay());
/** How many working days the month has (Saturday to Thursday). */
export const workingDaysOf=(month:string)=>monthDays(month).filter(isWorkingDay).length;
/** The share of the month's target that falls on one day: the month's target over the month's working days, zero on the weekly day off,
 *  unknown (null) while the month's target is unknown. */
export function dailyTargetShare(monthTarget:number|null|undefined,date:string):number|null{
 if(typeof monthTarget!=='number'||!Number.isFinite(monthTarget)||!calendarDay(date))return null;
 if(!isWorkingDay(date))return 0;
 const days=workingDaysOf(date.slice(0,7));
 return days?round(monthTarget/days):null;
}
/** The day the card opens on for a month: today in Riyadh while the month is the current one, its last day for a month that has ended,
 *  its first day for a month that has not begun. */
export function defaultReportDay(month:string,today:string=riyadhDay()):string{
 const days=monthDays(month);if(!days.length)return today;
 if(today.slice(0,7)===month)return today;
 return month<today.slice(0,7)?days[days.length-1]:days[0];
}
/** A day the person may pick for a month: inside the month and not after today. */
export const reportDayAllowed=(month:string,date:string,today:string=riyadhDay())=>!!calendarDay(date)&&date.slice(0,7)===month&&date<=today;

type SaleLike={repId:string;status:string;date:string;items:{product:string;quantity:number}[]};
/** The quantities sold on one day by these people, by product (returns deducted), and whether any document of theirs is dated that day. */
export function daySold(sales:readonly SaleLike[],people:ReadonlySet<string>,date:string){
 const quantities=new Map<string,number>();let documents=0;
 for(const sale of sales){
  if(sale.status!=='confirmed'||sale.date!==date||!people.has(sale.repId))continue;documents++;
  for(const item of sale.items||[])if(Number.isFinite(item.quantity))quantities.set(item.product,round((quantities.get(item.product)||0)+item.quantity));
 }
 return {quantities,documents};
}
export type DayRow={product:string;unit:string;sold:number;monthTarget:number|null;dayTarget:number|null;
 /** The day's sales over the day's target, in percent (two decimals); null without a positive day target. */
 achievement:number|null};
/** One row for each product: the day's sales against the day's share of the month's target. */
export function dayRows(products:readonly {id:string;unit:string}[],targets:ReadonlyMap<string,number|null>,sold:ReadonlyMap<string,number>,date:string):DayRow[]{
 return products.map(product=>{
  const monthTarget=targets.get(product.id)??null,dayTarget=dailyTargetShare(monthTarget,date),quantity=sold.get(product.id)||0;
  return {product:product.id,unit:product.unit,sold:quantity,monthTarget,dayTarget,achievement:dayTarget&&dayTarget>0?Math.round(quantity/dayTarget*10000)/100:null};
 });
}
/** Several people's monthly targets added up, product by product: a product none of them has a number for stays unknown. */
export function addTargets(lists:readonly (readonly {product:string;quantity:number|null}[]|undefined)[],products:readonly string[]):Map<string,number|null>{
 return new Map(products.map(product=>{
  const values=lists.map(list=>list?.find(row=>row.product===product)?.quantity).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
  return [product,values.length?round(values.reduce((n,v)=>n+v,0)):null];
 }));
}

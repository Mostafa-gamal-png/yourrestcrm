/** Shared shape of a stage's timing in a monthly report: how many items had the stage, their median and average in working
 * hours, the stage's target and how many went over it. Pure arithmetic; the callers decide what a stage is. */
export type ReportTiming={n:number;median:number|null;average:number|null;target:number|null;overTarget:number};
export const REPORT_MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const round=(value:number)=>Math.round(value*100)/100;
/** A share in percent with one decimal, or null when there is nothing to divide by. */
export const reportRate=(part:number,whole:number)=>whole?Math.round(part/whole*1000)/10:null;
export function reportTiming(values:number[],target:number|null):ReportTiming{
 const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
 return {n:sorted.length,median:sorted.length?round(sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2):null,average:sorted.length?round(sorted.reduce((sum,value)=>sum+value,0)/sorted.length):null,target,overTarget:target===null?0:sorted.filter(value=>value>target).length};
}

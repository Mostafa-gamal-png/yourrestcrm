import {complaintCategories,complaintCategoriesEn,type ComplaintAwaiting,type ComplaintEntry} from './complaints';

/** «شكوى تنتظرك» on the phone (the owner, 2026-11-16, item 3 of the GSCO list, after GSCO 2.13.77 / Android 1.4.9: «بيوصل للي عليه الدور
 * في الشكوى: المراجعة، أو التكليف، أو التفويض، أو التواصل والحل، أو الإغلاق. الشكاوى عالية الأهمية تظهر الأول.»). What the Android app asks
 * (GET /api/complaints/alerts): the complaints that wait for the signed-in member themself, exactly as the complaints page decides it
 * (complaintAwaiting: the review by the customer-service manager, the correction and the closure by the registrar, the assignment by the
 * sales manager, the delegation by the supervisor, the first contact and the resolution by the holder), at most 20, high importance first
 * and otherwise in the page's own order (late first, then the oldest). Each carries only what a notification needs: the id, the customer's
 * name, the category in both languages, the importance, the step, whether the holder has opened it since it was handed over, and when the
 * step began. No description, demand, note, phone, city or number leaves the server. A new `since` makes the same complaint a new alert (a
 * reassignment, a return from customer service, a reopening). Pure; the route loads the queue. */
export const COMPLAINT_ALERT_LIMIT=20;
export const COMPLAINT_ALERT_NAME_MAX=200;
export const COMPLAINT_ALERT_CATEGORY_MAX=80;
export type ComplaintAlertStep=Exclude<ComplaintAwaiting,null>;
export const COMPLAINT_ALERT_STEPS:readonly ComplaintAlertStep[]=['review','fix','assign','delegate','contact','resolve','close'];
export type ComplaintAlert={id:string;customerName:string;category:string;categoryAr:string;categoryEn:string;severity:'normal'|'high';awaiting:ComplaintAlertStep;seen:boolean;since:string};
export type ComplaintAlerts={schemaVersion:1;memberId:string;generatedAt:string;count:number;alerts:ComplaintAlert[]};
const clip=(value:string,max:number)=>{const text=value.replace(/\s+/g,' ').trim();return text.length>max?text.slice(0,max-1).trimEnd()+'…':text;};
/** The steps the holder of the complaint owes: opening it on the page records that they saw it (the `seen` action). */
const HOLDER_STEPS:readonly ComplaintAlertStep[]=['delegate','contact','resolve'];

/** `entries` are the reader's own complaint queue (complaintQueue: already scoped by the complaint rules and sorted, waiting first). */
export function complaintAlerts(entries:readonly ComplaintEntry[],memberId:string,now:string):ComplaintAlerts{
 const waiting=entries.filter(entry=>entry.status!=='closed'&&entry.status!=='cancelled'&&!!entry.awaiting);
 // High importance first; otherwise the queue's own order.
 const ordered=waiting.map((entry,index)=>({entry,index})).sort((a,b)=>Number(b.entry.severity==='high')-Number(a.entry.severity==='high')||a.index-b.index).map(item=>item.entry);
 return {schemaVersion:1,memberId,generatedAt:now,count:waiting.length,alerts:ordered.slice(0,COMPLAINT_ALERT_LIMIT).map(entry=>{
  const awaiting=entry.awaiting as ComplaintAlertStep,category=complaintCategories[entry.category]?entry.category:'other';
  return {
   id:entry.id,customerName:clip(entry.customerName||'',COMPLAINT_ALERT_NAME_MAX),category,
   categoryAr:clip(complaintCategories[category],COMPLAINT_ALERT_CATEGORY_MAX),categoryEn:clip(complaintCategoriesEn[category],COMPLAINT_ALERT_CATEGORY_MAX),
   severity:entry.severity==='high'?'high':'normal',awaiting,
   // The holder has opened it since it was handed over (the page records that); the other steps have no opening, so they stay unseen until done.
   seen:HOLDER_STEPS.includes(awaiting)&&!entry.permissions.seen,
   since:entry.stageSince||entry.updatedAt||entry.createdAt
  };
 })};
}

import {serviceQueue,serviceQueueBadge,type QueueAwaiting} from './service-queue';

/** What the Android app asks every ten minutes: the customer-service requests that wait for this person to act, just
 * enough to word a phone notification. It is the same queue the page shows, restricted to cases that wait for the
 * reader themself; the registration text, attachments, notes, phone numbers and locations are never part of it. */
export type ServiceAlert={
 id:string;customerName:string;need:string;
 awaiting:Exclude<QueueAwaiting,null>;
 /** The holder has already opened the request: nothing left to announce. */
 seen:boolean;
 /** When the request started waiting for this person. A new value makes the same request a new alert. */
 since:string;
};
export type ServiceAlerts={memberId:string;generatedAt:string;count:number;alerts:ServiceAlert[]};
export const MAX_ALERTS=20,NEED_LENGTH=80;
const shorten=(text:string)=>{const clean=text.replace(/\s+/g,' ').trim();return clean.length>NEED_LENGTH?clean.slice(0,NEED_LENGTH-1).trimEnd()+'…':clean;};

export function serviceAlerts(c:Parameters<typeof serviceQueue>[0],now:string=new Date().toISOString()):ServiceAlerts{
 const entries=serviceQueue(c,now);
 const waiting=entries.filter(entry=>entry.awaiting&&entry.ownerId===c.me.id&&entry.stage!=='closed');
 return {
  memberId:c.me.id,generatedAt:now,count:serviceQueueBadge(entries),
  alerts:waiting.slice(0,MAX_ALERTS).map(entry=>({id:entry.id,customerName:entry.customerName,need:shorten(entry.needs),awaiting:entry.awaiting as Exclude<QueueAwaiting,null>,seen:!!entry.seenAt,since:entry.stageSince}))
 };
}

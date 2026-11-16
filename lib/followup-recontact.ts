// «ميعاد إعادة تواصل مع الفرصة الخسرانة» (the owner, 2026-11-16, item 8 of the GSCO comparison list; GSCO 2.13.43, docs/LOST-RECONTACT-DATE-AR.md
// there: optional, for a lost opportunity only, and it comes back in the follow-ups). In Yourrest a customer's follow-up line is its latest plan
// (lib/customer-visits.ts customerPlanSource): a follow-up recorded «تم الفقد» closed it for good, its next step cleared. Now that follow-up may
// keep a re-contact date and what to do then: the line stays tracked, «قادمة» until the day, then due («اليوم والمتأخرة», the dashboard's
// «يستحق المتابعة», the day report's pending follow-ups), and the follow-up recorded on that day executes it like any other.
// - Only a follow-up whose stage is «تم الفقد» (salesStage 'lost') carries it, marked `recontact: true` with the date in nextDate and the action
//   in nextAction: a «تم الفوز» follow-up and every stage that is not lost take none (refused). Every lost follow-up or visit saved before keeps
//   no mark and stays closed (a visit always carries a next step: its lost stage was never a re-contact and is not one now).
// - Both or neither: a date needs its action and an action its date (Yourrest's rule, the owner 2026-11-15: a follow-up's step carries an
//   action and a date); the date is not before the follow-up's own day, nor before today (Riyadh) when saved online (an entry queued on the
//   device: not before the day it was recorded); Arabic-Indic and Persian digits are read.
// Pure: shared by the server (app/api/customer-followups, lib/record-import-server.ts) and the pages.
import {calendarDay} from './daily-target';

export const RECONTACT_MESSAGES={
 lostOnly:'موعد إعادة التواصل للمتابعة المفقودة فقط (مرحلة «تم الفقد»).',
 bothOrNeither:'اكتب الإجراء عند إعادة التواصل وموعده معًا، أو اتركهما فارغين.',
 date:'أدخل موعد إعادة التواصل تاريخًا صحيحًا.',
 beforeFollowup:'موعد إعادة التواصل لا يسبق تاريخ المتابعة المنفذة.',
 past:'موعد إعادة التواصل لا يكون في الماضي.',
} as const;
type Data={salesStage?:unknown;stage?:unknown;recontact?:unknown;nextDate?:unknown;nextAction?:unknown}|null|undefined;
/** A lost follow-up that keeps a re-contact date (and its action). */
export function recontactPlanned(data:Data):boolean{
 return !!data&&data.salesStage==='lost'&&data.recontact===true&&!!calendarDay(data.nextDate)&&typeof data.nextAction==='string'&&!!data.nextAction.trim();
}
/** Whether a plan source is still followed: an open stage (not won or lost, not a closed thread), or a lost one with a re-contact date. */
export function planTracked(data:Data&{followupStatus?:unknown}):boolean{
 const stage=String(data?.salesStage||data?.stage||'new');
 return !['won','lost'].includes(stage)&&data?.followupStatus!=='closed'||recontactPlanned(data);
}
/** The re-contact a save asks for: nothing (both empty), or the date (YYYY-MM-DD) and the action; else the message that refuses it.
 *  `stage` the follow-up's stage after it, `date` its own day, `today` the day it may not precede (Riyadh, or the device's day offline). */
export function readRecontact(input:{date?:unknown;action?:unknown},stage:string,followupDate:string,today:string):{date:string;action:string}|null|{error:string}{
 const rawDate=typeof input.date==='string'?input.date.trim():'',action=typeof input.action==='string'?input.action.trim():'';
 if(!rawDate&&!action)return null;
 if(stage!=='lost')return {error:RECONTACT_MESSAGES.lostOnly};
 if(!rawDate||!action)return {error:RECONTACT_MESSAGES.bothOrNeither};
 const date=calendarDay(rawDate);if(!date)return {error:RECONTACT_MESSAGES.date};
 if(date<followupDate)return {error:RECONTACT_MESSAGES.beforeFollowup};
 if(date<today)return {error:RECONTACT_MESSAGES.past};
 if(action.length>1000)return {error:'الإجراء عند إعادة التواصل طويل جدًا (1000 حرف على الأكثر).'};
 return {date,action};
}

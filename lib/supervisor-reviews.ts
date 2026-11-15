/** The supervisor's notes on a member's work (the owner, 2026-11-09: «نفذ الاربعة» of GSCO's list, its #5 «كارت ملاحظات المشرف على
 * شغلك يظهر للمندوب حتى يضغط قرأت، والمشرف يرى وقت القراءة»; GSCO 2.13.46/2.13.49/2.13.63, lib/crm/daily-*-review*.ts and
 * review-inbox*.ts there). On «تقرير يوم المندوب» the administrator, a sales manager or a supervisor writes «النتيجة» and «الإجراء
 * المطلوب» on one visit or contact of a member of their team, and on that member's whole day (migration 0019). The member sees every
 * note they have not read at the top of every page until they press «قرأت»; the writer sees beside the note that it was read, and
 * when. An edited note is a new version and waits again. Shared by the server and the pages; no server import here. */

export const REVIEW_TEXT_MIN=2,REVIEW_TEXT_MAX=2000;
/** crm_audit actions: the writes (each save, with its before/after, is also the request's receipt) and the member's reads. All three
 * are kept out of the recent-changes list of GET /api/crm. */
export const ENTRY_REVIEW_ACTION='مراجعة المشرف لزيارة أو متابعة';
export const DAY_REVIEW_ACTION='مراجعة المشرف لتقرير اليوم';
export const REVIEW_READ_ACTION='قراءة مراجعة المشرف';
export const REVIEW_AUDIT_ACTIONS=[ENTRY_REVIEW_ACTION,DAY_REVIEW_ACTION,REVIEW_READ_ACTION] as const;
/** A read is written once, found by its key: the review and the version the member read. */
export const entryReadId=(activityId:string,version:number)=>`review-read:entry:${activityId}:${version}`;
export const dayReadId=(memberId:string,date:string,version:number)=>`review-read:day:${memberId}:${date}:${version}`;
/** The same keys in SQL, for a reviews query aliased r. */
export const entryReadIdSql="'review-read:entry:'||r.activity_id||':'||r.version";
export const dayReadIdSql="'review-read:day:'||r.member_id||':'||r.date||':'||r.version";
/** How far back unread notes are shown (counted from when the note was written or last edited), and how many at most. */
export const REVIEW_INBOX_DAYS=30,REVIEW_INBOX_LIMIT=50;
/** The card asks again every 5 minutes, and when the page comes back to the front at most once a minute. */
export const REVIEW_INBOX_INTERVAL_MS=5*60_000,REVIEW_INBOX_FOCUS_MS=60_000;

/** The words of an activity's type, Arabic and English, as the notes name the visit or contact they are on. */
export const ACTIVITY_TYPE_TEXT:Record<string,[string,string]>={visit:['زيارة','Visit'],call:['اتصال','Call'],email:['بريد إلكتروني','Email'],whatsapp:['واتساب','WhatsApp'],website:['عن طريق الويبسايت','Website'],social:['مواقع التواصل الاجتماعي','Social media'],quote:['عرض سعر','Quotation'],meeting:['اجتماع','Meeting'],followup:['متابعة','Follow-up']};
export const activityTypeText=(type:string,language:string)=>{const pair=ACTIVITY_TYPE_TEXT[type];return pair?pair[language==='en'?1:0]:language==='en'?'Visit or contact':'زيارة أو تواصل';};

/** The roles that write notes: those that open «تقرير يوم المندوب» (lib/access.ts canUseSalesWorkspace). */
export const reviewerRoles=['admin','manager','supervisor'] as const;
export const canWriteReviews=(member:{role:string;active?:number|boolean})=>(reviewerRoles as readonly string[]).includes(member.role)&&member.active!==0&&member.active!==false;

/** Trimmed text of 2..2000 characters without control characters other than tab and new lines; null when it is not acceptable. */
export function reviewTextProblem(value:unknown):'short'|'long'|null{
 if(typeof value!=='string')return 'short';
 const text=value.trim();
 if(text.length<REVIEW_TEXT_MIN||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))return 'short';
 return text.length>REVIEW_TEXT_MAX?'long':null;
}

/** The evaluation of a visit or contact (the owner approved it on 2026-11-15 from GSCO 2.13.71: «عايز المشرف على كل فرصة او متابعة يعملها
 * المندوب يختار فعالة - سلبية ده بالاضافة للنتيجة والاجراء ... وايجابية لو تم البيع ودى النظام بيعملها لواحده»): beside the result and the
 * action the reviewer chooses «فعالة» or «سلبية»; the visit or contact that records the sale is «إيجابية» by itself and takes no choice.
 * No new column: the choice is kept in the note's own audit row (crm_daily_entry_reviews.mutation_id -> crm_audit.detail.after.rating),
 * and «إيجابية» is read from the activity as it is now. '' = a note saved before the evaluation existed. A whole-day note has none. Since
 * 2026-11-15 («موافق تمام») it is what «نسبة الزيارات الفعالة» counts (lib/kpis.ts visitEvaluations, through entryRatingOf and saleEntry
 * below and supervisor-reviews-server.ts chosenEntryRatings): «فعالة» or «إيجابية» effective, «سلبية» not, none yet waiting. */
export const CHOSEN_RATINGS=['effective','negative'] as const;
export type ChosenRating=typeof CHOSEN_RATINGS[number];
export type EntryRating=''|'positive'|ChosenRating;
export const RATING_TEXT:Record<Exclude<EntryRating,''>,[string,string]>={positive:['إيجابية','Positive'],effective:['فعالة','Effective'],negative:['سلبية','Negative']};
/** The visit or contact that records the sale, as GSCO marks it (closed won, or its quotation turned into an invoice, never lost): the
 *  stage the representative chose on it («تم الفوز») or «نعم، تحوّل إلى فاتورة» of a follow-up. */
export const saleEntry=(data:{salesStage?:unknown;invoiceOutcome?:unknown}|null|undefined)=>!!data&&data.salesStage!=='lost'&&(data.salesStage==='won'||data.invoiceOutcome==='invoiced');
/** The same in SQL over crm_records aliased a. */
export const saleEntrySql=(alias:string)=>`(COALESCE(json_extract(${alias}.data,'$.salesStage'),'')<>'lost' AND (json_extract(${alias}.data,'$.salesStage')='won' OR json_extract(${alias}.data,'$.invoiceOutcome')='invoiced'))`;
export const entryRatingOf=(sale:boolean,chosen:unknown):EntryRating=>sale?'positive':(CHOSEN_RATINGS as readonly unknown[]).includes(chosen)?chosen as ChosenRating:'';
const ratingValid=(value:unknown)=>value===undefined||value===''||value==='positive'||(CHOSEN_RATINGS as readonly unknown[]).includes(value);

/** readAt: when the member pressed «قرأت» on this version, or null. rating: the evaluation ('' before it existed). */
export type EntryReview={activityId:string;memberId:string;date:string;result:string;action:string;reviewedBy:string;reviewedByName:string;createdAt:string;updatedAt:string;version:number;readAt:string|null;rating?:EntryRating};
export type DayReview={memberId:string;date:string;result:string;action:string;reviewedBy:string;reviewedByName:string;createdAt:string;updatedAt:string;version:number;readAt:string|null};
/** GET /api/reviews: the notes of one report (date, member) as the reader may see them, and what the reader may write on it. sales: the
 *  activities of the report that record a sale (their evaluation is «إيجابية» by itself). */
export type ReportReviews={ok:true;date:string;memberId:string;entries:EntryReview[];reviewable:string[];day:DayReview|null;dayReviewable:boolean;sales?:string[]};
/** ref: the activity of an entry note, the date of a day note. rating: an entry's evaluation ('' before it existed; absent on a day note). */
export type ReviewInboxItem={kind:'entry'|'day';ref:string;version:number;date:string;result:string;action:string;reviewedByName:string;updatedAt:string;customerName:string;activityType:string;rating?:EntryRating};
export type ReviewInbox={ok:true;items:ReviewInboxItem[];more:boolean};

/** GET /api/reviews/customer?customerId=: the reviewers' earlier notes on one customer's visits and contacts, read-only, newest visit first
 *  (the owner approved it on 2026-11-15 from GSCO 2.13.71: «عايز تعليقات المشرف للمندوب تظهرله فى المتابعات لما يجى يتابع تكون ظاهراله
 *  المشرف كان كاتبله ايه»). A representative sees the notes on their own work only; a reviewer also those of their team, as the day report
 *  shows them. Reading them here is not the «قرأت» of the card. */
export const CUSTOMER_NOTES_LIMIT=20;
export type CustomerNote={activityId:string;date:string;activityType:string;followup:boolean;memberId:string;memberName:string;result:string;action:string;rating:EntryRating;reviewedByName:string;updatedAt:string};
export type CustomerNotes={ok:true;customerId:string;notes:CustomerNote[];more:boolean};

/** GET /api/reviews/made?date=&reviewerId=: what one reviewer wrote on one day (Riyadh), from the audit trail: each note under the day it was
 *  saved, with the words saved that day (the last save of that day for each visit or day), only on work the reader may see. The reviewer is
 *  the reader by default; the administrator may choose any reviewer and a sales manager a supervisor of their scope (lib/access.ts
 *  salesScopeMemberIds); a supervisor sees only their own. memberResult: what the representative recorded on the visit. */
export type ReviewMadeEntry={activityId:string;memberId:string;memberName:string;customerName:string;activityType:string;followup:boolean;activityDate:string;memberResult:string;result:string;action:string;rating:EntryRating;version:number;createdAt:string;savedAt:string;readAt:string|null};
export type ReviewMadeDay={memberId:string;memberName:string;date:string;result:string;action:string;version:number;createdAt:string;savedAt:string;readAt:string|null};
export type ReviewsMadeCounts={notes:number;entries:number;days:number;members:number;positive:number;effective:number;negative:number;unrated:number;read:number;unread:number};
export type ReviewsMade={ok:true;date:string;reviewerId:string;reviewers:{id:string;name:string}[];entries:ReviewMadeEntry[];days:ReviewMadeDay[];counts:ReviewsMadeCounts};
export function reviewsMadeCounts(entries:readonly Pick<ReviewMadeEntry,'memberId'|'rating'|'readAt'>[],days:readonly Pick<ReviewMadeDay,'memberId'|'readAt'>[]):ReviewsMadeCounts{
 const notes=[...entries,...days],read=notes.filter(note=>note.readAt).length;
 const rated=(rating:EntryRating)=>entries.filter(entry=>entry.rating===rating).length;
 return{notes:notes.length,entries:entries.length,days:days.length,members:new Set(notes.map(note=>note.memberId)).size,positive:rated('positive'),effective:rated('effective'),negative:rated('negative'),unrated:rated(''),read,unread:notes.length-read};
}

const text=(value:unknown)=>typeof value==='string';
const positive=(value:unknown)=>Number.isInteger(value)&&(value as number)>0;
const readAt=(value:unknown)=>value===null||text(value);
export const validEntryReview=(value:unknown):value is EntryReview=>!!value&&typeof value==='object'&&['activityId','memberId','date','result','action','reviewedBy','reviewedByName','createdAt','updatedAt'].every(key=>text((value as Record<string,unknown>)[key]))&&positive((value as EntryReview).version)&&readAt((value as EntryReview).readAt)&&ratingValid((value as EntryReview).rating);
export const validDayReview=(value:unknown):value is DayReview=>!!value&&typeof value==='object'&&['memberId','date','result','action','reviewedBy','reviewedByName','createdAt','updatedAt'].every(key=>text((value as Record<string,unknown>)[key]))&&positive((value as DayReview).version)&&readAt((value as DayReview).readAt);
export const validReportReviews=(value:unknown):value is ReportReviews=>!!value&&typeof value==='object'&&(value as ReportReviews).ok===true&&text((value as ReportReviews).date)&&text((value as ReportReviews).memberId)&&Array.isArray((value as ReportReviews).entries)&&(value as ReportReviews).entries.every(validEntryReview)&&Array.isArray((value as ReportReviews).reviewable)&&(value as ReportReviews).reviewable.every(text)&&((value as ReportReviews).day===null||validDayReview((value as ReportReviews).day))&&typeof (value as ReportReviews).dayReviewable==='boolean'&&((value as ReportReviews).sales===undefined||Array.isArray((value as ReportReviews).sales)&&(value as ReportReviews).sales!.every(text));
export const validReviewInbox=(value:unknown):value is ReviewInbox=>!!value&&typeof value==='object'&&Array.isArray((value as ReviewInbox).items)&&typeof (value as ReviewInbox).more==='boolean'&&(value as ReviewInbox).items.every(item=>!!item&&(item.kind==='entry'||item.kind==='day')&&['ref','date','result','action','reviewedByName','updatedAt','customerName','activityType'].every(key=>text((item as Record<string,unknown>)[key]))&&positive(item.version)&&ratingValid(item.rating));
export const validCustomerNotes=(value:unknown):value is CustomerNotes=>!!value&&typeof value==='object'&&(value as CustomerNotes).ok===true&&text((value as CustomerNotes).customerId)&&typeof (value as CustomerNotes).more==='boolean'&&Array.isArray((value as CustomerNotes).notes)&&(value as CustomerNotes).notes.every(note=>!!note&&typeof note==='object'&&['activityId','date','activityType','memberId','memberName','result','action','reviewedByName','updatedAt'].every(key=>text((note as Record<string,unknown>)[key]))&&typeof note.followup==='boolean'&&ratingValid(note.rating));
const madeEntry=(value:unknown)=>!!value&&typeof value==='object'&&['activityId','memberId','memberName','customerName','activityType','activityDate','memberResult','result','action','createdAt','savedAt'].every(key=>text((value as Record<string,unknown>)[key]))&&typeof (value as ReviewMadeEntry).followup==='boolean'&&positive((value as ReviewMadeEntry).version)&&readAt((value as ReviewMadeEntry).readAt)&&ratingValid((value as ReviewMadeEntry).rating);
const madeDay=(value:unknown)=>!!value&&typeof value==='object'&&['memberId','memberName','date','result','action','createdAt','savedAt'].every(key=>text((value as Record<string,unknown>)[key]))&&positive((value as ReviewMadeDay).version)&&readAt((value as ReviewMadeDay).readAt);
export const validReviewsMade=(value:unknown):value is ReviewsMade=>!!value&&typeof value==='object'&&(value as ReviewsMade).ok===true&&text((value as ReviewsMade).date)&&text((value as ReviewsMade).reviewerId)&&Array.isArray((value as ReviewsMade).reviewers)&&(value as ReviewsMade).reviewers.every(reviewer=>!!reviewer&&text(reviewer.id)&&text(reviewer.name))&&Array.isArray((value as ReviewsMade).entries)&&(value as ReviewsMade).entries.every(madeEntry)&&Array.isArray((value as ReviewsMade).days)&&(value as ReviewsMade).days.every(madeDay)&&!!(value as ReviewsMade).counts&&typeof (value as ReviewsMade).counts==='object';

/** The notice of a new note (the owner approved it on 2026-11-15 from GSCO 2.13.66: a phone notification for the supervisor's notes). The
 * installed Android app (1.0.12) has no feed of notes and cannot be told by the server (lib/app-update-release.json; mobile/android
 * ServiceAlerts reads customer-service requests only), so the page does what a page can: when the card's check finds a note this browser
 * has not shown yet, it says so on any open page (a short message with «عرض») and, where the browser allows it, with the device's own
 * notification. What this browser has already shown is kept per member (at most 200 keys of kind, note and version), so a note is announced
 * once even across reloads and tabs; the first check in a browser that remembers nothing announces nothing (the card shows the notes). */
export const REVIEW_NOTICE_REMEMBER=200;
export const reviewNoteKey=(item:Pick<ReviewInboxItem,'kind'|'ref'|'version'>)=>item.kind+':'+item.ref+':'+item.version;
export const reviewNoticeStorageKey=(memberId:string)=>'yourrest.review-notes.seen:'+memberId;
export const reviewAskedStorageKey=(memberId:string)=>'yourrest.review-notes.asked:'+memberId;
/** What the browser remembers: null when nothing (or something unreadable) is stored. */
export function rememberedNotes(raw:string|null|undefined):string[]|null{
 if(typeof raw!=='string')return null;
 try{const value:unknown=JSON.parse(raw);return Array.isArray(value)?value.filter((key):key is string=>typeof key==='string'&&key.length<=420).slice(0,REVIEW_NOTICE_REMEMBER):null;}catch{return null;}
}
/** Which of the unread notes to announce now, and what to remember: the current notes first, then what was remembered, 200 at most. */
export function reviewNoticeStep<T extends Pick<ReviewInboxItem,'kind'|'ref'|'version'>>(items:readonly T[],remembered:readonly string[]|null):{announce:T[];remember:string[]}{
 const keys=items.map(reviewNoteKey);
 if(remembered===null)return{announce:[],remember:[...new Set(keys)].slice(0,REVIEW_NOTICE_REMEMBER)};
 const known=new Set(remembered);
 return{announce:items.filter(item=>!known.has(reviewNoteKey(item))),remember:[...new Set([...keys,...remembered])].slice(0,REVIEW_NOTICE_REMEMBER)};
}
/** The words of the notice: one note names who wrote it and on what; several give their count. Never the note's own text (a device's
 *  notification may show on a locked screen). */
export function reviewNoticeText(items:readonly ReviewInboxItem[],language:string):{title:string;body:string}{
 const en=language==='en',first=items[0];
 if(items.length!==1)return{title:en?`New notes from your supervisor (${items.length})`:`ملاحظات جديدة من المشرف (${items.length})`,body:en?'Read each note and press Read under it.':'اقرأ كل ملاحظة واضغط «قرأت» تحتها.'};
 const about=first.kind==='day'?(en?'Day review ':'تقييم اليوم ')+first.date:[activityTypeText(first.activityType,language),first.customerName].filter(Boolean).join(' · ');
 return{title:en?'New note from your supervisor':'ملاحظة جديدة من المشرف',body:[first.reviewedByName||(en?'Supervisor':'المشرف'),about].join(' · ')};
}
/** A page in the background asks too, but only when the device may show the notification, and only when no page of this browser asked
 *  in the last interval (less half a minute), so several open tabs ask once. */
export function hiddenPageMayAsk(now:number,askedAt:number|null,granted:boolean){
 return granted&&(askedAt===null||!Number.isFinite(askedAt)||askedAt>now||now-askedAt>=REVIEW_INBOX_INTERVAL_MS-30_000);
}

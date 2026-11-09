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

/** readAt: when the member pressed «قرأت» on this version, or null. */
export type EntryReview={activityId:string;memberId:string;date:string;result:string;action:string;reviewedBy:string;reviewedByName:string;createdAt:string;updatedAt:string;version:number;readAt:string|null};
export type DayReview={memberId:string;date:string;result:string;action:string;reviewedBy:string;reviewedByName:string;createdAt:string;updatedAt:string;version:number;readAt:string|null};
/** GET /api/reviews: the notes of one report (date, member) as the reader may see them, and what the reader may write on it. */
export type ReportReviews={ok:true;date:string;memberId:string;entries:EntryReview[];reviewable:string[];day:DayReview|null;dayReviewable:boolean};
/** ref: the activity of an entry note, the date of a day note. */
export type ReviewInboxItem={kind:'entry'|'day';ref:string;version:number;date:string;result:string;action:string;reviewedByName:string;updatedAt:string;customerName:string;activityType:string};
export type ReviewInbox={ok:true;items:ReviewInboxItem[];more:boolean};

const text=(value:unknown)=>typeof value==='string';
const positive=(value:unknown)=>Number.isInteger(value)&&(value as number)>0;
const readAt=(value:unknown)=>value===null||text(value);
export const validEntryReview=(value:unknown):value is EntryReview=>!!value&&typeof value==='object'&&['activityId','memberId','date','result','action','reviewedBy','reviewedByName','createdAt','updatedAt'].every(key=>text((value as Record<string,unknown>)[key]))&&positive((value as EntryReview).version)&&readAt((value as EntryReview).readAt);
export const validDayReview=(value:unknown):value is DayReview=>!!value&&typeof value==='object'&&['memberId','date','result','action','reviewedBy','reviewedByName','createdAt','updatedAt'].every(key=>text((value as Record<string,unknown>)[key]))&&positive((value as DayReview).version)&&readAt((value as DayReview).readAt);
export const validReportReviews=(value:unknown):value is ReportReviews=>!!value&&typeof value==='object'&&(value as ReportReviews).ok===true&&text((value as ReportReviews).date)&&text((value as ReportReviews).memberId)&&Array.isArray((value as ReportReviews).entries)&&(value as ReportReviews).entries.every(validEntryReview)&&Array.isArray((value as ReportReviews).reviewable)&&(value as ReportReviews).reviewable.every(text)&&((value as ReportReviews).day===null||validDayReview((value as ReportReviews).day))&&typeof (value as ReportReviews).dayReviewable==='boolean';
export const validReviewInbox=(value:unknown):value is ReviewInbox=>!!value&&typeof value==='object'&&Array.isArray((value as ReviewInbox).items)&&typeof (value as ReviewInbox).more==='boolean'&&(value as ReviewInbox).items.every(item=>!!item&&(item.kind==='entry'||item.kind==='day')&&['ref','date','result','action','reviewedByName','updatedAt','customerName','activityType'].every(key=>text((item as Record<string,unknown>)[key]))&&positive(item.version));

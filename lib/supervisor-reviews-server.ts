import {z} from 'zod';
import {cellRefused,pageAllowed} from './permissions';
import {CRMError,accessGuard} from './crm-server';
import {salesScopeMemberIds,recordAuthorId} from './access';
import {memberCanAccessRegion} from './regions';
import {customerVisits,visitCustomer} from './customer-visits';
import {journeyDate} from './journeys';
import {today,type Member,type Row} from './crm';
import type {JourneyContext} from './journeys-server';
import {CHOSEN_RATINGS,CUSTOMER_NOTES_LIMIT,DAY_REVIEW_ACTION,ENTRY_REVIEW_ACTION,REVIEW_INBOX_DAYS,REVIEW_INBOX_LIMIT,REVIEW_PENDING_DAYS,REVIEW_READ_ACTION,REVIEW_TEXT_MAX,canWriteReviews,reviewPendingDates,reviewPendingRole,sortReviewPending,type ReviewPending,dayReadId,dayReadIdSql,entryRatingOf,entryReadId,entryReadIdSql,reviewTextProblem,reviewerRoles,reviewsMadeCounts,saleEntry,saleEntrySql,type ChosenRating,type CustomerNote,type CustomerNotes,type DayReview,type EntryRating,type EntryReview,type ReportReviews,type ReviewInbox,type ReviewInboxItem,type ReviewMadeDay,type ReviewMadeEntry,type ReviewsMade} from './supervisor-reviews';

/** Server side of the supervisor's notes (lib/supervisor-reviews.ts). Who writes, and on what, follows «تقرير يوم المندوب» exactly
 * (GET /api/journeys): the administrator, a sales manager or a supervisor (active), on a visit or contact the report lists for them (an
 * activity they may read, recorded by a member of their sales scope, with its customer), never on their own work (GSCO: «المراجعة
 * تُسجَّل على زيارات ومتابعات فريقك، لا على زياراتك»), and on the day of a member of the report's list other than themself, up to today.
 * Every write is versioned (a stale version is 409), re-checked at commit (the writer's role, region and supervisor, the member's place
 * in their team, the activity still there) and audited; the audit row is the request's receipt, so a retry answers with the saved
 * note. The member reads only their own notes; a read names the version it read. */

export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
const requestId=z.string().uuid(),version=z.number().int().positive().nullable(),identifier=z.string().min(1).max(200);
const words=z.unknown();
export const reviewSaveSchema=z.discriminatedUnion('kind',[
 // rating: «فعالة» or «سلبية», required unless the visit or contact records the sale («إيجابية» by itself); a day note has none.
 z.object({kind:z.literal('entry'),requestId,activityId:identifier,result:words,action:words,rating:z.enum(CHOSEN_RATINGS).nullable().optional(),version}).strict(),
 z.object({kind:z.literal('day'),requestId,memberId:identifier,date:dateSchema,result:words,action:words,version}).strict()
]);
/** «قرأت» names one note (the owner approved it on 2026-11-15 from GSCO 2.13.67: no «قرأت الكل», the member confirms each note on its own);
 *  the shape still takes up to 50 so that a page loaded before is told why instead of «طلب القراءة غير صحيح». */
export const reviewReadSchema=z.object({items:z.array(z.discriminatedUnion('kind',[
 z.object({kind:z.literal('entry'),ref:identifier,version:z.number().int().positive()}).strict(),
 z.object({kind:z.literal('day'),ref:dateSchema,version:z.number().int().positive()}).strict()
])).min(1).max(REVIEW_INBOX_LIMIT)}).strict();

export const REVIEW_MESSAGES={
 required:'اكتب النتيجة والإجراء المطلوب؛ الخانتان إلزاميتان (حرفان على الأقل).',
 long:`النتيجة والإجراء المطلوب حتى ${REVIEW_TEXT_MAX} حرف لكل منهما.`,
 invalid:'بيانات المراجعة غير صحيحة.',
 role:'كتابة النتيجة والإجراء المطلوب متاحة لمدير النظام ومدير المبيعات والمشرف فقط.',
 missing:'الزيارة أو التواصل غير موجود في تقرير اليوم.',
 own:'النتيجة والإجراء المطلوب تُكتبان على عمل فريقك، لا على عملك.',
 scope:'الموظف خارج نطاق فريقك.',
 future:'لا يمكن مراجعة يوم لم يأتِ بعد.',
 entryConflict:'تغيّرت مراجعة هذه الزيارة. حدّث التقرير قبل الحفظ.',
 dayConflict:'تغيّرت مراجعة هذا اليوم. حدّث التقرير قبل الحفظ.',
 readInvalid:'طلب القراءة غير صحيح.',
 rating:'اختر تقييم الزيارة أو التواصل: فعالة أو سلبية.',
 readOne:'اضغط «قرأت» على كل ملاحظة وحدها.',
 reviewer:'لا يمكنك عرض مراجعات هذا الموظف.',
 customer:'العميل خارج نطاق صلاحيتك',
 pendingRole:'بطاقة الزيارات والمتابعات بلا نتيجة أو إجراء متاحة للمشرف ومدير المبيعات فقط.'
} as const;

/** The activities of the reports of these days (member or 'all') the reader's report lists, with their recorder and day. Same filters as
 *  GET /api/journeys. One pass for several days (the red card's 7, GET /api/reviews/pending); reportActivities is one day of it. */
export function reportActivitiesOn(c:JourneyContext,dates:ReadonlySet<string>,memberId:string){
 const scope=salesScopeMemberIds(c.members,c.me),out:{row:Row;author:string;date:string}[]=[];
 for(const row of c.visible){
  if(row.kind!=='activity')continue;
  const date=row.data.date||journeyDate(row.createdAt);
  if(!dates.has(date))continue;
  const author=recordAuthorId(row,c.members);
  if(!author||!scope.has(author)||memberId!=='all'&&author!==memberId||!visitCustomer(row,c.visible))continue;
  out.push({row,author,date});
 }
 return out;
}
export const reportActivities=(c:JourneyContext,date:string,memberId:string)=>reportActivitiesOn(c,new Set([date]),memberId);
/** Whether the reader writes notes on the day report now: a reviewer role, active, and «إضافة» on «تقرير يوم المندوب» not switched off
 *  («الصلاحيات», lib/permissions.ts): with it off the notes are shown and none may be written. */
const writesReviews=(c:Pick<JourneyContext,'me'>)=>canWriteReviews(c.me)&&!cellRefused(c.me,'journeys','add');
/** Of the listed activities, those the reader may note («إضافة نتيجة وإجراء»): none unless they write notes, never their own work. The one
 *  rule of GET /api/reviews `reviewable` and of the red card's count (reviewPending), so the two never disagree. */
export function reviewableOf<T extends {author:string}>(c:Pick<JourneyContext,'me'>,activities:readonly T[]):T[]{
 return writesReviews(c)?activities.filter(activity=>activity.author!==c.me.id):[];
}
/** A member whose day the reader may note: in the reader's report list for that date (lib: GET /api/journeys `eligible`), not the reader. */
function dayReviewableMember(c:JourneyContext,memberId:string,date:string){
 const member=c.members.find(m=>m.id===memberId);
 if(!member||member.id===c.me.id||!salesScopeMemberIds(c.members,c.me).has(member.id))return false;
 return !!member.active&&(c.me.regionScope==='all'||member.regionScope===c.me.regionScope||member.regionScope==='all')||reportActivities(c,date,member.id).length>0;
}
/** At commit: the member is still in the writer's team (the same reporting-line rule as accessGuard's author check). */
function memberGate(me:Member,memberId:string):{sql:string;args:(string|number)[]}{
 if(me.role==='admin')return{sql:'EXISTS (SELECT 1 FROM crm_members WHERE id=? AND id<>?)',args:[memberId,me.id]};
 if(me.role==='supervisor')return{sql:"EXISTS (SELECT 1 FROM crm_members WHERE id=? AND id<>? AND role='rep' AND supervisor_id=?)",args:[memberId,me.id,me.id]};
 return{sql:"EXISTS (SELECT 1 FROM crm_members WHERE id=? AND id<>? AND role IN ('supervisor','rep'))",args:[memberId,me.id]};
}

/** The evaluation chosen on the note's last save, from its audit row (the review row's mutation_id is that row's id). */
const chosenRatingSql="(SELECT CASE WHEN json_valid(rs.detail) THEN json_extract(rs.detail,'$.after.rating') END FROM crm_audit rs WHERE rs.id=r.mutation_id)";
const entryColumns=`r.activity_id AS activityId,r.member_id AS memberId,r.date,r.result,r.action,r.reviewed_by AS reviewedBy,COALESCE(reviewer.name,'') AS reviewedByName,r.created_at AS createdAt,r.updated_at AS updatedAt,r.version,(SELECT ra.created_at FROM crm_audit ra WHERE ra.id=${entryReadIdSql}) AS readAt,CASE WHEN ea.id IS NOT NULL AND ${saleEntrySql('ea')} THEN 1 ELSE 0 END AS sale,${chosenRatingSql} AS chosen`;
const dayColumns=`r.member_id AS memberId,r.date,r.result,r.action,r.reviewed_by AS reviewedBy,COALESCE(reviewer.name,'') AS reviewedByName,r.created_at AS createdAt,r.updated_at AS updatedAt,r.version,(SELECT ra.created_at FROM crm_audit ra WHERE ra.id=${dayReadIdSql}) AS readAt`;
const numbered=<T extends {version:number;readAt:string|null}>(row:T):T=>({...row,version:Number(row.version),readAt:row.readAt??null});
export async function entryReviews(db:D1Database,activityIds:readonly string[]):Promise<EntryReview[]>{
 if(!activityIds.length)return [];
 return (await db.prepare(`SELECT ${entryColumns} FROM crm_daily_entry_reviews r LEFT JOIN crm_members reviewer ON reviewer.id=r.reviewed_by LEFT JOIN crm_records ea ON ea.id=r.activity_id AND ea.kind='activity' WHERE r.activity_id IN (SELECT value FROM json_each(?)) ORDER BY r.activity_id`).bind(JSON.stringify([...activityIds])).all<EntryReview&{sale:number;chosen:unknown}>()).results.map(({sale,chosen,...row})=>({...numbered(row),rating:entryRatingOf(Number(sale)===1,chosen)}));
}
/** The evaluation chosen on the notes of these activities, as the notes read it (chosenRatingSql: the note's last save): activity id ->
 *  the stored choice (null on a note saved before the evaluation existed); an activity with no note is absent. For «نسبة الزيارات الفعالة»
 *  (lib/kpis.ts visitEvaluations turns it into the visit's evaluation with entryRatingOf and saleEntry, as entryReviews does). */
export async function chosenEntryRatings(db:D1Database,activityIds:readonly string[]):Promise<Map<string,unknown>>{
 if(!activityIds.length)return new Map();
 const rows=(await db.prepare(`SELECT r.activity_id AS activityId,${chosenRatingSql} AS chosen FROM crm_daily_entry_reviews r WHERE r.activity_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify([...new Set(activityIds)])).all<{activityId:string;chosen:unknown}>()).results;
 return new Map(rows.map(row=>[row.activityId,row.chosen]));
}
export async function dayReview(db:D1Database,memberId:string,date:string):Promise<DayReview|null>{
 const row=await db.prepare(`SELECT ${dayColumns} FROM crm_daily_report_reviews r LEFT JOIN crm_members reviewer ON reviewer.id=r.reviewed_by WHERE r.member_id=? AND r.date=?`).bind(memberId,date).first<DayReview>();
 return row?numbered(row):null;
}

/** GET /api/reviews?date=&memberId=: the notes on the report the reader opened, with the read time, and what they may write on it. */
export async function reportReviews(c:JourneyContext,date:string,memberId:string):Promise<ReportReviews>{
 // «الصلاحيات» (lib/permissions.ts): «إضافة» on «تقرير يوم المندوب» switched off: the notes are shown, none may be written.
 const activities=reportActivities(c,date,memberId);
 const entries=await entryReviews(c.db,activities.map(a=>a.row.id));
 const day=memberId==='all'?null:await dayReview(c.db,memberId,date);
 return{ok:true,date,memberId,entries,reviewable:reviewableOf(c,activities).map(a=>a.row.id),day,dayReviewable:writesReviews(c)&&memberId!=='all'&&date<=today()&&dayReviewableMember(c,memberId,date),sales:activities.filter(a=>saleEntry(a.row.data)).map(a=>a.row.id)};
}

/** GET /api/reviews/pending (lib/supervisor-reviews.ts ReviewPending, the red card): for a supervisor or a sales manager, the visits, calls and
 * follow-ups of the representatives of their team on each of the last 7 Riyadh days that their own day report offers «إضافة نتيجة وإجراء»
 * on (reportActivitiesOn and reviewableOf, the rules of GET /api/reviews) and that have no note yet (no row in crm_daily_entry_reviews: a
 * saved note takes its visit off at once). One line per representative and day, with the count; names, days and counts only. The
 * administrator does not get it (403), nor whoever GET /api/reviews refuses (the route's own checks). */
export async function reviewPending(c:JourneyContext,now=new Date().toISOString()):Promise<ReviewPending>{
 if(!reviewPendingRole(c.me.role))throw new CRMError(REVIEW_MESSAGES.pendingRole,403);
 const representatives=new Set(c.members.filter(member=>member.role==='rep').map(member=>member.id));
 const waiting=reviewableOf(c,reportActivitiesOn(c,new Set(reviewPendingDates(journeyDate(now))),'all')).filter(activity=>representatives.has(activity.author));
 const reviewed=new Set(waiting.length?(await c.db.prepare('SELECT activity_id AS activityId FROM crm_daily_entry_reviews WHERE activity_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(waiting.map(activity=>activity.row.id))).all<{activityId:string}>()).results.map(row=>row.activityId):[]);
 const lines=new Map<string,{memberId:string;date:string;pending:number}>();
 for(const activity of waiting){
  if(reviewed.has(activity.row.id))continue;
  const key=activity.author+'|'+activity.date,line=lines.get(key)||{memberId:activity.author,date:activity.date,pending:0};
  line.pending++;lines.set(key,line);
 }
 const items=sortReviewPending([...lines.values()].map(line=>({...line,name:c.members.find(member=>member.id===line.memberId)?.name||''})));
 return{ok:true,days:REVIEW_PENDING_DAYS,total:items.reduce((sum,item)=>sum+item.pending,0),items};
}

function texts(input:{result?:unknown;action?:unknown}){
 const problems=[reviewTextProblem(input.result),reviewTextProblem(input.action)];
 if(problems.includes('short'))throw new CRMError(REVIEW_MESSAGES.required,400);
 if(problems.includes('long'))throw new CRMError(REVIEW_MESSAGES.long,400);
 return{result:(input.result as string).trim(),action:(input.action as string).trim()};
}

/** POST /api/reviews: saves «النتيجة» and «الإجراء المطلوب» on one activity (kind entry) or on a member's day (kind day). */
export async function saveReview(c:JourneyContext,body:unknown){
 // The role first, so a member who may not write notes is told so whatever they sent (GSCO validates first).
 if(!canWriteReviews(c.me))throw new CRMError(REVIEW_MESSAGES.role,403);
 const parsed=reviewSaveSchema.safeParse(body);if(!parsed.success)throw new CRMError(REVIEW_MESSAGES.invalid,400);
 const p=parsed.data,{result,action}=texts(p);
 const at=new Date().toISOString(),permission=accessGuard(c);
 let memberId:string,date:string,mutation:string,conflict:string,recordId:string,auditAction:string,rating:EntryRating='';
 if(p.kind==='entry'){
  const row=c.all.find(r=>r.id===p.activityId&&r.kind==='activity');
  if(!row)throw new CRMError(REVIEW_MESSAGES.missing,404);
  const author=recordAuthorId(row,c.members);
  if(author===c.me.id)throw new CRMError(REVIEW_MESSAGES.own,400);
  date=row.data.date||journeyDate(row.createdAt);
  const listed=reportActivities(c,date,'all').find(a=>a.row.id===row.id);
  if(!listed)throw new CRMError(REVIEW_MESSAGES.scope,403);
  // The evaluation: «فعالة» or «سلبية» chosen, or «إيجابية» by itself on the visit or contact that records the sale.
  const sale=saleEntry(row.data);
  if(!sale&&!p.rating)throw new CRMError(REVIEW_MESSAGES.rating,400);
  rating=sale?'positive':p.rating as ChosenRating;
  memberId=listed.author;mutation='review-entry:'+c.me.id+':'+p.requestId;conflict=REVIEW_MESSAGES.entryConflict;recordId=row.id;auditAction=ENTRY_REVIEW_ACTION;
 }else{
  if(p.date>today())throw new CRMError(REVIEW_MESSAGES.future,400);
  if(p.memberId===c.me.id)throw new CRMError(REVIEW_MESSAGES.own,400);
  if(!dayReviewableMember(c,p.memberId,p.date))throw new CRMError(REVIEW_MESSAGES.scope,403);
  memberId=p.memberId;date=p.date;mutation='review-day:'+c.me.id+':'+p.requestId;conflict=REVIEW_MESSAGES.dayConflict;recordId='review-day:'+p.memberId+':'+p.date;auditAction=DAY_REVIEW_ACTION;
 }
 const after=p.kind==='entry'?{activityId:p.activityId,memberId,date,result,action,rating,reviewedBy:c.me.id,version:(p.version??0)+1}:{memberId,date,result,action,reviewedBy:c.me.id,version:(p.version??0)+1};
 const saved=async()=>({ok:true as const,kind:p.kind,review:p.kind==='entry'?(await entryReviews(c.db,[p.activityId]))[0]||null:await dayReview(c.db,memberId,date)});
 const receipt=async()=>{
  const row=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(mutation).first<{detail:string}>();if(!row)return null;
  let stored:unknown;try{stored=JSON.parse(row.detail)?.after;}catch{stored=null;}
  if(JSON.stringify(stored)!==JSON.stringify(after))throw new CRMError(conflict,409);
  return saved();
 };
 const replay=await receipt();if(replay)return replay;
 const before=p.kind==='entry'
  ?await c.db.prepare('SELECT activity_id AS activityId,member_id AS memberId,date,result,action,reviewed_by AS reviewedBy,version FROM crm_daily_entry_reviews WHERE activity_id=?').bind(p.activityId).first<Record<string,unknown>&{version:number}>()
  :await c.db.prepare('SELECT member_id AS memberId,date,result,action,reviewed_by AS reviewedBy,version FROM crm_daily_report_reviews WHERE member_id=? AND date=?').bind(memberId,date).first<Record<string,unknown>&{version:number}>();
 if((before?Number(before.version):null)!==p.version)throw new CRMError(conflict,409);
 const member=memberGate(c.me,memberId);
 const guard=[permission.sql,member.sql,...p.kind==='entry'?["EXISTS (SELECT 1 FROM crm_records WHERE id=? AND kind='activity')"]:[]].join(' AND ');
 const guardArgs=[...permission.args,...member.args,...p.kind==='entry'?[p.activityId]:[]];
 const claim=p.kind==='entry'
  ?before
   ?c.db.prepare(`UPDATE crm_daily_entry_reviews SET member_id=?,date=?,result=?,action=?,reviewed_by=?,version=version+1,mutation_id=?,updated_at=? WHERE activity_id=? AND version=? AND ${guard}`).bind(memberId,date,result,action,c.me.id,mutation,at,p.activityId,p.version,...guardArgs)
   :c.db.prepare(`INSERT INTO crm_daily_entry_reviews(activity_id,member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) SELECT ?,?,?,?,?,?,1,?,?,? WHERE ${guard} ON CONFLICT(activity_id) DO NOTHING`).bind(p.activityId,memberId,date,result,action,c.me.id,mutation,at,at,...guardArgs)
  :before
   ?c.db.prepare(`UPDATE crm_daily_report_reviews SET result=?,action=?,reviewed_by=?,version=version+1,mutation_id=?,updated_at=? WHERE member_id=? AND date=? AND version=? AND ${guard}`).bind(result,action,c.me.id,mutation,at,memberId,date,p.version,...guardArgs)
   :c.db.prepare(`INSERT INTO crm_daily_report_reviews(member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) SELECT ?,?,?,?,?,1,?,?,? WHERE ${guard} ON CONFLICT(member_id,date) DO NOTHING`).bind(memberId,date,result,action,c.me.id,mutation,at,at,...guardArgs);
 const audit=c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1').bind(mutation,recordId,c.me.name,auditAction,JSON.stringify({before:before?{...before,version:Number(before.version)}:null,after}),at);
 let results:D1Result[];
 try{results=await c.db.batch([claim,audit]);}catch(error){const again=await receipt();if(again)return again;throw error;}
 if(results[0].meta.changes!==1){const again=await receipt();if(again)return again;throw new CRMError(conflict,409);}
 return saved();
}

/** GET /api/review-inbox: the signed-in member's own notes written or edited in the last 30 days that they have not read, newest first
 * (50 at most; more says there are others). An entry names its activity's type and customer (the customer only while the reader may
 * see its region). Read-only. */
export async function reviewInbox(c:Pick<JourneyContext,'db'|'me'>):Promise<ReviewInbox>{
 const since=new Date(Date.now()-REVIEW_INBOX_DAYS*86_400_000).toISOString();
 type Raw=Omit<ReviewInboxItem,'customerName'>&{sale?:number;chosen?:unknown};
 // Two plain reads (a batch would take the write lock for nothing).
 const entries=await c.db.prepare(`SELECT 'entry' AS kind,r.activity_id AS ref,r.version,r.date,r.result,r.action,COALESCE(reviewer.name,'') AS reviewedByName,r.updated_at AS updatedAt,COALESCE(json_extract(a.data,'$.type'),'') AS activityType,CASE WHEN a.id IS NOT NULL AND ${saleEntrySql('a')} THEN 1 ELSE 0 END AS sale,${chosenRatingSql} AS chosen
   FROM crm_daily_entry_reviews r LEFT JOIN crm_members reviewer ON reviewer.id=r.reviewed_by LEFT JOIN crm_records a ON a.id=r.activity_id AND a.kind='activity'
   WHERE r.member_id=? AND r.updated_at>=? AND NOT EXISTS (SELECT 1 FROM crm_audit ra WHERE ra.id=${entryReadIdSql}) ORDER BY r.updated_at DESC LIMIT ?`).bind(c.me.id,since,REVIEW_INBOX_LIMIT+1).all<Raw>();
 const days=await c.db.prepare(`SELECT 'day' AS kind,r.date AS ref,r.version,r.date,r.result,r.action,COALESCE(reviewer.name,'') AS reviewedByName,r.updated_at AS updatedAt,'' AS activityType
   FROM crm_daily_report_reviews r LEFT JOIN crm_members reviewer ON reviewer.id=r.reviewed_by
   WHERE r.member_id=? AND r.updated_at>=? AND NOT EXISTS (SELECT 1 FROM crm_audit ra WHERE ra.id=${dayReadIdSql}) ORDER BY r.updated_at DESC LIMIT ?`).bind(c.me.id,since,REVIEW_INBOX_LIMIT+1).all<Raw>();
 const ids=entries.results.map(row=>row.ref),customers=new Map<string,string>();
 if(ids.length){
  // The activity's customer: up its parents (a visit under a request under a customer), at most five steps, as visitCustomer does.
  const rows=(await c.db.prepare(`WITH RECURSIVE chain(start,id,kind,parent_id,data,depth) AS (
   SELECT id,id,kind,parent_id,data,0 FROM crm_records WHERE id IN (SELECT value FROM json_each(?))
   UNION ALL SELECT chain.start,parent.id,parent.kind,parent.parent_id,parent.data,chain.depth+1 FROM crm_records parent JOIN chain ON parent.id=chain.parent_id WHERE chain.kind<>'customer' AND chain.depth<4
  ) SELECT start,json_extract(data,'$.name') AS name,json_extract(data,'$.region') AS region FROM chain WHERE kind='customer'`).bind(JSON.stringify(ids)).all<{start:string;name:string|null;region:string|null}>()).results;
  for(const row of rows)if(!customers.has(row.start)&&memberCanAccessRegion(c.me,row.region))customers.set(row.start,String(row.name||''));
 }
 const all:ReviewInboxItem[]=[...entries.results.map(({sale,chosen,...row})=>({...row,customerName:customers.get(row.ref)||'',rating:entryRatingOf(Number(sale)===1,chosen)})),...days.results.map(row=>({...row,customerName:''}))]
  .map(row=>({...row,version:Number(row.version),activityType:String(row.activityType||'')})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.kind.localeCompare(b.kind)||a.ref.localeCompare(b.ref));
 return{ok:true,items:all.slice(0,REVIEW_INBOX_LIMIT),more:all.length>REVIEW_INBOX_LIMIT};
}

/** POST /api/review-inbox {items:[{kind,ref,version}]}: «قرأت» on ONE note (since 2026-11-15 there is no «قرأت الكل»: a request naming
 * more is refused with REVIEW_MESSAGES.readOne, writing nothing). The read is written once (INSERT OR IGNORE on its key), only for a note on
 * the reader's own work at the version they saw, while the reader is still who they were; a note edited meanwhile stays unread, and
 * another member's «قرأت» writes nothing. Reads written before (one or many at a time) keep their rows. Answers with what is still unread. */
export async function markReviewsRead(c:JourneyContext,body:unknown):Promise<ReviewInbox>{
 const parsed=reviewReadSchema.safeParse(body);if(!parsed.success)throw new CRMError(REVIEW_MESSAGES.readInvalid,400);
 if(parsed.data.items.length!==1)throw new CRMError(REVIEW_MESSAGES.readOne,400);
 const at=new Date().toISOString(),permission=accessGuard(c);
 const writes=parsed.data.items.map(item=>{
  const entry=item.kind==='entry',id=entry?entryReadId(item.ref,item.version):dayReadId(c.me.id,item.ref,item.version);
  const owns=entry?'EXISTS (SELECT 1 FROM crm_daily_entry_reviews r WHERE r.activity_id=? AND r.member_id=? AND r.version=?)':'EXISTS (SELECT 1 FROM crm_daily_report_reviews r WHERE r.date=? AND r.member_id=? AND r.version=?)';
  return c.db.prepare(`INSERT OR IGNORE INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${owns} AND ${permission.sql}`)
   .bind(id,entry?item.ref:'review-day:'+c.me.id+':'+item.ref,c.me.name,REVIEW_READ_ACTION,JSON.stringify({kind:item.kind,ref:item.ref,version:item.version,memberId:c.me.id}),at,item.ref,c.me.id,item.version,...permission.args);
 });
 await c.db.batch(writes);
 return reviewInbox(c);
}

/** GET /api/reviews/customer?customerId=: the reviewers' notes on the earlier visits and contacts of one customer the reader may open,
 * newest visit first (20 at most), read-only (lib/supervisor-reviews.ts CustomerNotes). Whose work: the reader's own always (the notes a
 * representative already receives on the card); a reviewer's team only while «تقرير يوم المندوب» is theirs (the same notes GET
 * /api/reviews gives them: the team as the role defines it, which «عرض بيانات الفريق بالكامل» does not widen there either), within the
 * reader's regions (c.visible). Customer service reads no visit, so it gets none. */
export async function customerNotes(c:JourneyContext,customerId:string):Promise<CustomerNotes>{
 const customer=c.visible.find(row=>row.id===customerId&&row.kind==='customer');
 if(!customer)throw new CRMError(REVIEW_MESSAGES.customer,404);
 const team=canWriteReviews(c.me)&&pageAllowed(c.me,'journeys')?salesScopeMemberIds(c.members,c.me):new Set([c.me.id]);
 const activities=customerVisits(customer.id,c.visible).flatMap(row=>{const author=recordAuthorId(row,c.members);return author&&team.has(author)?[{row,author}]:[];});
 const reviews=new Map((await entryReviews(c.db,activities.map(item=>item.row.id))).map(review=>[review.activityId,review]));
 const notes:CustomerNote[]=[];
 for(const {row,author} of activities){
  const review=reviews.get(row.id);
  if(!review||review.memberId!==author)continue;
  notes.push({activityId:row.id,date:String(row.data.date||journeyDate(row.createdAt)),activityType:String(row.data.type||''),followup:row.data.visitWorkflow==='followup-v1',memberId:review.memberId,memberName:c.members.find(member=>member.id===review.memberId)?.name||'',result:review.result,action:review.action,rating:review.rating||'',reviewedByName:review.reviewedByName,updatedAt:review.updatedAt});
 }
 return{ok:true,customerId:customer.id,notes:notes.slice(0,CUSTOMER_NOTES_LIMIT),more:notes.length>CUSTOMER_NOTES_LIMIT};
}

/** Whose «تقرير مراجعاتي» the reader may open (lib/supervisor-reviews.ts ReviewsMade): a supervisor their own only; a sales manager their own
 * and the supervisors of their scope; the administrator every reviewer. Nobody else (the route asks for the day report first). */
export function reviewerChoices(c:Pick<JourneyContext,'me'|'members'>){
 const {me,members}=c,others=(keep:(member:typeof me)=>boolean)=>members.filter(member=>member.id!==me.id&&keep(member)).sort((a,b)=>Number(!!b.active)-Number(!!a.active)||a.name.localeCompare(b.name,'ar'));
 if(me.role==='supervisor')return [me];
 if(me.role==='manager'){const scope=salesScopeMemberIds(members,me);return [me,...others(member=>member.role==='supervisor'&&scope.has(member.id))];}
 if(me.role==='admin')return [me,...others(member=>(reviewerRoles as readonly string[]).includes(member.role))];
 return [];
}

/** GET /api/reviews/made?date=&reviewerId=: what one reviewer wrote on one Riyadh day, read from the audit rows of their saves (each row's
 * id starts with review-entry:<reviewer>: or review-day:<reviewer>:, so the primary key finds them), the last save of that day for each
 * visit or day (in the order they were first saved that day), with the evaluation it was saved with («إيجابية» read from the visit as it is now) and whether the member read that
 * version. Only notes the reader's own day report would show: a visit or contact of c.visible whose author is in the reader's team (as
 * reportActivities, never widened by «عرض بيانات الفريق بالكامل»; a deleted one is left out), a day of a member of that team. */
export async function reviewsMade(c:JourneyContext,date:string,reviewerId:string):Promise<ReviewsMade>{
 const choices=reviewerChoices(c);
 if(!choices.some(member=>member.id===reviewerId))throw new CRMError(REVIEW_MESSAGES.reviewer,403);
 const from=new Date(date+'T00:00:00+03:00').toISOString(),until=new Date(Date.parse(from)+86_400_000).toISOString();
 // ':' is followed by ';' in code order: [prefix, prefix with its last ':' turned to ';') holds exactly the ids that start with prefix.
 const range=(prefix:string)=>[prefix,prefix.slice(0,-1)+';'];
 const rows=(await c.db.prepare('SELECT id,action,detail,created_at AS createdAt FROM crm_audit WHERE ((id>=? AND id<?) OR (id>=? AND id<?)) AND created_at>=? AND created_at<? AND action IN (?,?) ORDER BY created_at,rowid')
  .bind(...range('review-entry:'+reviewerId+':'),...range('review-day:'+reviewerId+':'),from,until,ENTRY_REVIEW_ACTION,DAY_REVIEW_ACTION).all<{id:string;action:string;detail:string;createdAt:string}>()).results;
 const scope=salesScopeMemberIds(c.members,c.me),visible=new Map(c.visible.map(row=>[row.id,row])),nameOf=(id:string)=>c.members.find(member=>member.id===id)?.name||'';
 const entries=new Map<string,ReviewMadeEntry>(),days=new Map<string,ReviewMadeDay>();
 for(const row of rows){
  let after:Record<string,unknown>|null=null;try{after=JSON.parse(row.detail)?.after??null;}catch{after=null;}
  if(!after||after.reviewedBy!==reviewerId||typeof after.result!=='string'||typeof after.action!=='string'||!Number.isInteger(after.version)||typeof after.memberId!=='string')continue;
  const version=after.version as number,memberId=after.memberId;
  if(row.action===ENTRY_REVIEW_ACTION){
   const activityId=String(after.activityId||''),activity=visible.get(activityId);
   if(!activity||activity.kind!=='activity'||recordAuthorId(activity,c.members)!==memberId||!scope.has(memberId))continue;
   const first=entries.get(activityId);
   entries.set(activityId,{activityId,memberId,memberName:nameOf(memberId),customerName:String(visitCustomer(activity,c.visible)?.data.name||''),activityType:String(activity.data.type||''),followup:activity.data.visitWorkflow==='followup-v1',activityDate:String(activity.data.date||journeyDate(activity.createdAt)),memberResult:String(activity.data.result||''),result:after.result,action:after.action,rating:entryRatingOf(saleEntry(activity.data),after.rating),version,createdAt:first?.createdAt||row.createdAt,savedAt:row.createdAt,readAt:null});
  }else{
   const day=typeof after.date==='string'?after.date:'';
   if(!day||!scope.has(memberId))continue;
   const key=memberId+'|'+day,first=days.get(key);
   days.set(key,{memberId,memberName:nameOf(memberId),date:day,result:after.result,action:after.action,version,createdAt:first?.createdAt||row.createdAt,savedAt:row.createdAt,readAt:null});
  }
 }
 const readIds=[...[...entries.values()].map(entry=>entryReadId(entry.activityId,entry.version)),...[...days.values()].map(note=>dayReadId(note.memberId,note.date,note.version))];
 const reads=new Map(readIds.length?(await c.db.prepare('SELECT id,created_at AS createdAt FROM crm_audit WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(readIds)).all<{id:string;createdAt:string}>()).results.map(row=>[row.id,row.createdAt]):[]);
 const entryList=[...entries.values()].map(entry=>({...entry,readAt:reads.get(entryReadId(entry.activityId,entry.version))||null})).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 const dayList=[...days.values()].map(note=>({...note,readAt:reads.get(dayReadId(note.memberId,note.date,note.version))||null})).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 return{ok:true,date,reviewerId,reviewers:choices.map(member=>({id:member.id,name:member.name})),entries:entryList,days:dayList,counts:reviewsMadeCounts(entryList,dayList)};
}

import {z} from 'zod';
import {CRMError,accessGuard} from './crm-server';
import {salesScopeMemberIds,recordAuthorId} from './access';
import {memberCanAccessRegion} from './regions';
import {visitCustomer} from './customer-visits';
import {journeyDate} from './journeys';
import {today,type Member,type Row} from './crm';
import type {JourneyContext} from './journeys-server';
import {DAY_REVIEW_ACTION,ENTRY_REVIEW_ACTION,REVIEW_INBOX_DAYS,REVIEW_INBOX_LIMIT,REVIEW_READ_ACTION,REVIEW_TEXT_MAX,canWriteReviews,dayReadId,dayReadIdSql,entryReadId,entryReadIdSql,reviewTextProblem,type DayReview,type EntryReview,type ReportReviews,type ReviewInbox,type ReviewInboxItem} from './supervisor-reviews';

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
 z.object({kind:z.literal('entry'),requestId,activityId:identifier,result:words,action:words,version}).strict(),
 z.object({kind:z.literal('day'),requestId,memberId:identifier,date:dateSchema,result:words,action:words,version}).strict()
]);
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
 own:'النتيجة والإجراء المطلوب تُكتب على شغل فريقك، لا على شغلك.',
 scope:'الموظف خارج نطاق فريقك.',
 future:'لا يمكن مراجعة يوم لم يأتِ بعد.',
 entryConflict:'تغيّرت مراجعة هذه الزيارة. حدّث التقرير قبل الحفظ.',
 dayConflict:'تغيّرت مراجعة هذا اليوم. حدّث التقرير قبل الحفظ.',
 readInvalid:'طلب القراءة غير صحيح.'
} as const;

/** The activities of one report (date, member or 'all') the reader's report lists, with their recorder. Same filters as GET /api/journeys. */
export function reportActivities(c:JourneyContext,date:string,memberId:string){
 const scope=salesScopeMemberIds(c.members,c.me),out:{row:Row;author:string}[]=[];
 for(const row of c.visible){
  if(row.kind!=='activity'||(row.data.date||journeyDate(row.createdAt))!==date)continue;
  const author=recordAuthorId(row,c.members);
  if(!author||!scope.has(author)||memberId!=='all'&&author!==memberId||!visitCustomer(row,c.visible))continue;
  out.push({row,author});
 }
 return out;
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

const entryColumns=`r.activity_id AS activityId,r.member_id AS memberId,r.date,r.result,r.action,r.reviewed_by AS reviewedBy,COALESCE(reviewer.name,'') AS reviewedByName,r.created_at AS createdAt,r.updated_at AS updatedAt,r.version,(SELECT ra.created_at FROM crm_audit ra WHERE ra.id=${entryReadIdSql}) AS readAt`;
const dayColumns=`r.member_id AS memberId,r.date,r.result,r.action,r.reviewed_by AS reviewedBy,COALESCE(reviewer.name,'') AS reviewedByName,r.created_at AS createdAt,r.updated_at AS updatedAt,r.version,(SELECT ra.created_at FROM crm_audit ra WHERE ra.id=${dayReadIdSql}) AS readAt`;
const numbered=<T extends {version:number;readAt:string|null}>(row:T):T=>({...row,version:Number(row.version),readAt:row.readAt??null});
export async function entryReviews(db:D1Database,activityIds:readonly string[]):Promise<EntryReview[]>{
 if(!activityIds.length)return [];
 return (await db.prepare(`SELECT ${entryColumns} FROM crm_daily_entry_reviews r LEFT JOIN crm_members reviewer ON reviewer.id=r.reviewed_by WHERE r.activity_id IN (SELECT value FROM json_each(?)) ORDER BY r.activity_id`).bind(JSON.stringify([...activityIds])).all<EntryReview>()).results.map(numbered);
}
export async function dayReview(db:D1Database,memberId:string,date:string):Promise<DayReview|null>{
 const row=await db.prepare(`SELECT ${dayColumns} FROM crm_daily_report_reviews r LEFT JOIN crm_members reviewer ON reviewer.id=r.reviewed_by WHERE r.member_id=? AND r.date=?`).bind(memberId,date).first<DayReview>();
 return row?numbered(row):null;
}

/** GET /api/reviews?date=&memberId=: the notes on the report the reader opened, with the read time, and what they may write on it. */
export async function reportReviews(c:JourneyContext,date:string,memberId:string):Promise<ReportReviews>{
 const activities=reportActivities(c,date,memberId),writer=canWriteReviews(c.me);
 const entries=await entryReviews(c.db,activities.map(a=>a.row.id));
 const day=memberId==='all'?null:await dayReview(c.db,memberId,date);
 return{ok:true,date,memberId,entries,reviewable:writer?activities.filter(a=>a.author!==c.me.id).map(a=>a.row.id):[],day,dayReviewable:writer&&memberId!=='all'&&date<=today()&&dayReviewableMember(c,memberId,date)};
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
 let memberId:string,date:string,mutation:string,conflict:string,recordId:string,auditAction:string;
 if(p.kind==='entry'){
  const row=c.all.find(r=>r.id===p.activityId&&r.kind==='activity');
  if(!row)throw new CRMError(REVIEW_MESSAGES.missing,404);
  const author=recordAuthorId(row,c.members);
  if(author===c.me.id)throw new CRMError(REVIEW_MESSAGES.own,400);
  date=row.data.date||journeyDate(row.createdAt);
  const listed=reportActivities(c,date,'all').find(a=>a.row.id===row.id);
  if(!listed)throw new CRMError(REVIEW_MESSAGES.scope,403);
  memberId=listed.author;mutation='review-entry:'+c.me.id+':'+p.requestId;conflict=REVIEW_MESSAGES.entryConflict;recordId=row.id;auditAction=ENTRY_REVIEW_ACTION;
 }else{
  if(p.date>today())throw new CRMError(REVIEW_MESSAGES.future,400);
  if(p.memberId===c.me.id)throw new CRMError(REVIEW_MESSAGES.own,400);
  if(!dayReviewableMember(c,p.memberId,p.date))throw new CRMError(REVIEW_MESSAGES.scope,403);
  memberId=p.memberId;date=p.date;mutation='review-day:'+c.me.id+':'+p.requestId;conflict=REVIEW_MESSAGES.dayConflict;recordId='review-day:'+p.memberId+':'+p.date;auditAction=DAY_REVIEW_ACTION;
 }
 const after=p.kind==='entry'?{activityId:p.activityId,memberId,date,result,action,reviewedBy:c.me.id,version:(p.version??0)+1}:{memberId,date,result,action,reviewedBy:c.me.id,version:(p.version??0)+1};
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
 type Raw=Omit<ReviewInboxItem,'customerName'>;
 // Two plain reads (a batch would take the write lock for nothing).
 const entries=await c.db.prepare(`SELECT 'entry' AS kind,r.activity_id AS ref,r.version,r.date,r.result,r.action,COALESCE(reviewer.name,'') AS reviewedByName,r.updated_at AS updatedAt,COALESCE(json_extract(a.data,'$.type'),'') AS activityType
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
 const all:ReviewInboxItem[]=[...entries.results.map(row=>({...row,customerName:customers.get(row.ref)||''})),...days.results.map(row=>({...row,customerName:''}))]
  .map(row=>({...row,version:Number(row.version),activityType:String(row.activityType||'')})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.kind.localeCompare(b.kind)||a.ref.localeCompare(b.ref));
 return{ok:true,items:all.slice(0,REVIEW_INBOX_LIMIT),more:all.length>REVIEW_INBOX_LIMIT};
}

/** POST /api/review-inbox {items:[{kind,ref,version}]}: «قرأت». Each read is written once (INSERT OR IGNORE on its key), only for a note on
 * the reader's own work at the version they saw, while the reader is still who they were; a note edited meanwhile stays unread, and
 * another member's «قرأت» writes nothing. Answers with what is still unread. */
export async function markReviewsRead(c:JourneyContext,body:unknown):Promise<ReviewInbox>{
 const parsed=reviewReadSchema.safeParse(body);if(!parsed.success)throw new CRMError(REVIEW_MESSAGES.readInvalid,400);
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

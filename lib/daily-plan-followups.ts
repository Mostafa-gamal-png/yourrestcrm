/** «خطة الغد»: the follow-ups of the plan and the day's targets (the owner, 2026-11-22: the port of GSCO 2.13.85, owner's words of
 * 2026-11-21: «خلى يقدر يضيف متابعات اليوم مع امكانية تغيير معاد وترحيل المتابعات / المتابعات المتاخرة يختار منها لان فى ناس عندها فوق
 * 100 متابعة متاخرة / جزء اضافة عميل … للزيارة فى الخطة شيله وخليه عدد هو عايز يحققه بكره»; migration 0025).
 * - A follow-up is what Yourrest's follow-ups page lists (lib/customer-followups.ts customerFollowupPlans): a customer's latest plan that is
 *   still followed (open, or lost with a re-contact date), with its next action and a real date, counted for the customer's representative
 *   (customer.assignedTo). GSCO's «الفرصة» is that plan's record here (a visit, a contact or a request: its `id` and `version`), its
 *   «المشروع» the customer (as the 2.13.84 port mapped them, lib/followup-day-picker.ts). One follow-up per customer, so one stop per customer.
 * - Those due on the plan's day are added with one tap; the late ones (before the plan's day and not after today) are chosen from a searchable
 *   list, oldest first, a page at a time; «إضافة إلى خطة الغد» and «ترحيل إلى تاريخ…» move their date through POST
 *   /api/crm/opportunity-next-dates (lib/followup-next-dates-server.ts) in parts of at most PLAN_BULK_MAX.
 * - The targets: two whole numbers 0..50. GSCO's «مشاريع جديدة سأسجلها» has no Yourrest counterpart (its «مشروع» is the customer here, which
 *   the second target already counts), so the first target is the new sales opportunities («فرص بيع جديدة سأسجلها»: requests of a mold the
 *   member records, kind 'opportunity'), the second the new customers he adds by hand («عملاء جدد سأضيفهم»); the achieved numbers are counted
 *   on the plan's day by lib/daily-plans-server.ts planActuals. Pure; the clock is an argument. */
import type {Row} from './crm';
import {canExecuteCustomerFollowup,customerFollowupPlans} from './customer-followups';
import {calendarDay} from './daily-target';

/** One request moves at most this many follow-ups (the server refuses more); the page sends a larger selection in parts. */
export const PLAN_BULK_MAX=200;
/** The late follow-ups list shows this many rows, then «عرض المزيد». */
export const PLAN_PICKER_PAGE=30;
/** «المستهدف»: whole numbers from 0 to this. */
export const PLAN_TARGET_MAX=50;
/** The bulk «ترحيل» reaches at most this many days after today (Riyadh; the owner of GSCO, 2026-11-21). */
export const PLAN_BULK_DAYS_AHEAD=30;
/** node:sqlite answers synchronously: the bulk route gives the process back to other requests this often. */
export const BULK_YIELD_EVERY=25;

const DAY_MS=86_400_000;
const addDay=(day:string,days:number)=>new Date(Date.parse(day+'T12:00:00Z')+days*DAY_MS).toISOString().slice(0,10);
/** Whole days between two calendar days (b − a). */
export const dayDistance=(a:string,b:string)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/DAY_MS);
/** The last day a bulk move may reach. */
export const bulkLastDay=(today:string)=>addDay(today,PLAN_BULK_DAYS_AHEAD);

/** A follow-up as the plan lists it. `daysLate`: whole days from its date to today (0: due today or later). */
export type PlanFollowup={id:string;version:number;customerId:string;customerName:string;customerCode:string;erpCode:string;nextAction:string;nextDate:string;area:string;daysLate:number};
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
/** The member's own open follow-ups (their customers' plans with a next action and a real date), each once, oldest first. A plan or a
 *  customer still kept on the device (not on the server yet) is left out: it has no version the server knows. */
export function memberFollowups(records:Row[],memberId:string,today:string):PlanFollowup[]{
 if(!memberId)return [];
 return customerFollowupPlans(records).flatMap(plan=>{
  const date=calendarDay(plan.nextDate);
  if(plan.closed||plan.responsibleId!==memberId||!date||!plan.nextAction.trim()||!canExecuteCustomerFollowup(plan.source)||plan.customer.data?._offlineState||plan.customer.data?._offlineAcknowledged)return [];
  const data=plan.customer.data||{};
  return [{id:plan.source.id,version:Number(plan.source.version)||1,customerId:plan.customer.id,customerName:text(data.name),customerCode:text(data.internalCode),erpCode:text(data.code),
   nextAction:plan.nextAction.trim(),nextDate:date,area:text(data.city)||text(data.region).replace(/^المنطقة\s+/,''),daysLate:Math.max(0,dayDistance(date,today))}];
 }).sort(oldestFirst);
}
/** Oldest first; the same day by the customer's name, then its code. */
export const oldestFirst=(a:PlanFollowup,b:PlanFollowup)=>a.nextDate.localeCompare(b.nextDate)||a.customerName.localeCompare(b.customerName,'ar')||a.customerCode.localeCompare(b.customerCode)||a.id.localeCompare(b.id);
/** «إضافة متابعات الغد»: the follow-ups due ON the plan's day. */
export const followupsDueOn=(list:readonly PlanFollowup[],date:string)=>list.filter(item=>item.nextDate===date);
/** «المتابعات المتأخرة»: dated before the plan's day and not after today (today's count too: by the plan's day they are late); a plan made for
 *  today lists those before today. Oldest first. */
export function overdueFollowups(list:readonly PlanFollowup[],planDate:string,today:string){
 const last=planDate<=today?addDay(planDate,-1):today;
 return list.filter(item=>item.nextDate<=last);
}
const normalize=(value:string)=>value.normalize('NFKD').replace(/[ً-ٰٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).toLowerCase().trim();
/** The search box: the customer's name, its codes or its city, every word, Arabic letters read as the other searches read them. */
export function searchFollowups(list:readonly PlanFollowup[],query:string){
 const terms=normalize(query).split(/\s+/).filter(Boolean);
 if(!terms.length)return [...list];
 return list.filter(item=>{const hay=normalize([item.customerName,item.customerCode,item.erpCode,item.area,item.nextAction].join(' '));return terms.every(term=>hay.includes(term));});
}
/** The rows shown: the first `pages` pages. */
export const visibleFollowups=<T,>(list:readonly T[],pages:number)=>list.slice(0,Math.max(1,pages)*PLAN_PICKER_PAGE);
/** Select or clear every row of the current search (not only the rows on screen). */
export function toggleAll(selected:ReadonlySet<string>,shown:readonly {id:string}[]){
 const all=shown.length>0&&shown.every(item=>selected.has(item.id)),next=new Set(selected);
 for(const item of shown)if(all)next.delete(item.id);else next.add(item.id);
 return next;
}
export function toggleOne(selected:ReadonlySet<string>,id:string){const next=new Set(selected);if(next.has(id))next.delete(id);else next.add(id);return next;}
/** The parts sent to the server, PLAN_BULK_MAX at most each. */
export function bulkParts<T>(items:readonly T[],size=PLAN_BULK_MAX):T[][]{const out:T[][]=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out;}
/** One stop per customer: the chosen follow-ups whose customer is not in the plan yet, while the plan has room. */
export function stopsToAdd(chosen:readonly PlanFollowup[],inPlan:ReadonlySet<string>,room:number){
 const seen=new Set(inPlan),out:PlanFollowup[]=[];
 for(const item of chosen){if(out.length>=room)break;if(seen.has(item.customerId))continue;seen.add(item.customerId);out.push(item);}
 return out;
}
/** How many stops a choice needs (one per customer not in the plan yet). */
export const stopsNeeded=(chosen:readonly PlanFollowup[],inPlan:ReadonlySet<string>)=>new Set(chosen.map(item=>item.customerId).filter(id=>!inPlan.has(id))).size;

// ---- the server's answer to a date change (POST /api/crm/opportunity-next-dates)
/** GSCO's statuses; 'forbidden' (customer service keeps the opportunity) has no case here: customer service never reaches the route (403)
 *  and a sales follow-up is never kept by it. */
export const NEXT_DATE_STATUSES=['moved','unchanged','conflict','not_found','unassigned','closed','service','no_action'] as const;
export type NextDateStatus=typeof NEXT_DATE_STATUSES[number];
export type NextDateResult={id:string;status:NextDateStatus;version?:number;replayed?:boolean;message?:string};
export const nextDateDone=(status:NextDateStatus)=>status==='moved'||status==='unchanged';
/** Each refusal (lib/locales/en.json has their English). */
export const NEXT_DATE_STATUS_TEXT:Record<Exclude<NextDateStatus,'moved'|'unchanged'>,string>={
 conflict:'تغيّرت المتابعة بعد آخر تحديث لديك؛ حدّث البيانات ثم أعد المحاولة.',
 not_found:'المتابعة غير متاحة لك أو ليست من متابعاتك.',
 unassigned:'المندوب المسؤول عن العميل غير مفعّل؛ حدّد مسؤولًا مفعّلًا أولًا.',
 closed:'المتابعة مغلقة (تم الفوز أو الفقد)؛ لا موعد متابعة لها.',
 service:'لدى العميل طلب خدمة عملاء أحدث من هذه المتابعة؛ سجّل المتابعة من صفحة المتابعات.',
 no_action:'لا يوجد إجراء قادم لهذه المتابعة؛ سجّل متابعة تحدّد الإجراء أولًا.',
};
export const BULK_MESSAGES={
 offline:'الإجراءات الجماعية تحتاج اتصالًا بالشبكة؛ لم يتغيّر أي موعد.',
 past:'لا يمكن ترحيل المتابعات إلى تاريخ مضى.',
 far:'يمكن ترحيل المتابعات حتى 30 يومًا من اليوم فقط.',
 reused:'أُرسل هذا الطلب من قبل ببيانات مختلفة؛ حدّث الصفحة ثم أعد المحاولة.',
 room:'لا تتسع الخطة لكل المتابعات المحددة؛ قلّل التحديد أو استخدم «ترحيل إلى تاريخ…».',
 duplicate:'تكررت إحدى المتابعات في الطلب.',
 invalid:'بيانات ترحيل المتابعات غير صحيحة.',
 count:`اختر من متابعة واحدة إلى ${PLAN_BULK_MAX} متابعة في الطلب الواحد.`,
} as const;
/** The audit action of a moved follow-up (crm_audit; kept out of GET /api/crm's changes list, so «آخر التحديثات» is not flooded). */
export const BULK_AUDIT_ACTION='ترحيل موعد المتابعة';
export const BULK_AUDIT_PREFIX='followup-next-date:';
export function bulkSummary(results:readonly NextDateResult[]){
 const done=results.filter(result=>nextDateDone(result.status)),failed=results.filter(result=>!nextDateDone(result.status));
 return {done:done.length,failed:failed.length,doneIds:done.map(result=>result.id),failures:failed.map(result=>({id:result.id,status:result.status,text:result.message||NEXT_DATE_STATUS_TEXT[result.status as Exclude<NextDateStatus,'moved'|'unchanged'>]||''}))};
}
export const validNextDateAnswer=(value:unknown):value is {ok:true;next_date:string;results:NextDateResult[];moved:number;unchanged:number;failed:number}=>
 !!value&&typeof value==='object'&&(value as {ok?:unknown}).ok===true&&Array.isArray((value as {results?:unknown}).results)
 &&(value as {results:unknown[]}).results.every(item=>!!item&&typeof item==='object'&&typeof (item as NextDateResult).id==='string'&&(NEXT_DATE_STATUSES as readonly unknown[]).includes((item as NextDateResult).status));

// ---- the targets
export type PlanTargets={opportunities:number|null;customers:number|null};
export const NO_TARGETS:PlanTargets={opportunities:null,customers:null};
export const TARGET_KEYS=['opportunities','customers'] as const;
/** The labels: the member's field, and the short name read beside a number. */
export const TARGET_TEXT={
 opportunities:{field:['فرص بيع جديدة سأسجلها','New sales opportunities I will record'],short:['فرص بيع جديدة','New sales opportunities']},
 customers:{field:['عملاء جدد سأضيفهم','New customers I will add'],short:['عملاء جدد','New customers']},
} as const;
export const planTargetValid=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=PLAN_TARGET_MAX;
/** A typed value: Arabic-Indic or Persian digits are read too, and spaces and direction marks dropped; empty is «not set» (null); anything
 *  else is NaN (refused). */
export function readTarget(value:unknown):number|null{
 if(typeof value==='number')return Number.isFinite(value)?value:NaN;
 const v=String(value??'').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[\s‎‏؜]/g,'');
 if(!v)return null;
 return /^\d{1,3}$/.test(v)?Number(v):NaN;
}
export const TARGET_MESSAGES={
 range:'المستهدف عدد صحيح من 0 إلى 50.',
 required:'حدّد المستهدف (فرص البيع الجديدة والعملاء الجدد) قبل الإرسال؛ يمكن أن يكون صفرًا.',
 empty:'أضف متابعة واحدة على الأقل أو حدّد مستهدفًا أكبر من صفر قبل الإرسال.',
 fixed:'عدّل المشرف المستهدف؛ لا يمكن تغييره.',
} as const;
/** A plan with no follow-up may be sent when a target is above zero. */
export const hasTarget=(targets:PlanTargets)=>(targets.opportunities||0)>0||(targets.customers||0)>0;
/** What stops these targets ('' = nothing): a value out of range; a target not set when sending. */
export function targetsProblem(targets:PlanTargets,sending:boolean){
 for(const value of [targets.opportunities,targets.customers]){if(value===null){if(sending)return TARGET_MESSAGES.required;continue;}if(!planTargetValid(value))return TARGET_MESSAGES.range;}
 return '';
}
export const sameTargets=(a:PlanTargets,b:PlanTargets)=>a.opportunities===b.opportunities&&a.customers===b.customers;
/** A request's targets: {opportunities, customers}, each a whole number 0..50 (Arabic digits read), or null/'' (not set). null for anything else. */
export function parseTargets(value:unknown):PlanTargets|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const raw=value as Record<string,unknown>;
 if(Object.keys(raw).some(key=>!(TARGET_KEYS as readonly string[]).includes(key)))return null;
 const one=(input:unknown)=>{if(input===null||input===undefined||input==='')return null;const v=readTarget(input);return v===null||planTargetValid(v)?v:NaN;};
 const out={opportunities:one(raw.opportunities),customers:one(raw.customers)};
 return Number.isNaN(out.opportunities)||Number.isNaN(out.customers)?null:out as PlanTargets;
}
/** «المستهدف 3 · المحقق 2» / "Target 3 · Achieved 2". */
export function targetLine(target:number|null,actual:number|null|undefined,language:'ar'|'en'='ar'){
 const en=language==='en';
 return (en?'Target ':'المستهدف ')+(target===null?(en?'not set':'لم يُحدَّد'):target)+(actual===null||actual===undefined?'':(en?' · Achieved ':' · المحقق ')+actual);
}
/** «2/3»: achieved / target (the target alone before the day). */
export const targetFigure=(target:number|null,actual:number|null|undefined)=>(actual===null||actual===undefined?'':actual+'/')+(target===null?'–':target);
/** «متأخرة 12 يومًا» / "12 days late" (whole days since the follow-up's date). */
export function lateLabel(n:number,language:'ar'|'en'){
 if(language==='en')return n===1?'1 day late':`${n} days late`;
 if(n===1)return 'متأخرة يومًا واحدًا';
 if(n===2)return 'متأخرة يومين';
 const tail=n%100;
 return tail>=3&&tail<=10?`متأخرة ${n} أيام`:tail>=11?`متأخرة ${n} يومًا`:`متأخرة ${n} يوم`;
}
/** «ترحيل جماعي: N متابعة» / "Bulk move: N follow-ups". */
export function bulkMovesTitle(n:number,language:'ar'|'en'){
 if(language==='en')return 'Bulk move: '+n+(n===1?' follow-up':' follow-ups');
 return 'ترحيل جماعي: '+(n===1?'متابعة واحدة':n===2?'متابعتان':n%100>=3&&n%100<=10?n+' متابعات':n+' متابعة');
}
/** One follow-up moved by the route (its audit line): from its old date to the new one. */
export type PlanBulkMove={recordId:string;customerId:string;customerName:string;from:string|null;to:string;at:string;purpose:'plan'|'reschedule'};
/** «إضافة متابعات الغد» names the plan's day: today, tomorrow, or the plan's day after a day off. */
export const dueButtonText=(date:string,today:string):readonly [string,string]=>date===today?['إضافة متابعات اليوم','Add today\'s follow-ups']:date===addDay(today,1)?['إضافة متابعات الغد','Add tomorrow\'s follow-ups']:['إضافة متابعات يوم الخطة','Add the plan day\'s follow-ups'];
export const addToPlanText=(date:string,today:string):readonly [string,string]=>date===addDay(today,1)?['إضافة إلى خطة الغد','Add to tomorrow\'s plan']:date===today?['إضافة إلى خطة اليوم','Add to today\'s plan']:['إضافة إلى الخطة','Add to the plan'];

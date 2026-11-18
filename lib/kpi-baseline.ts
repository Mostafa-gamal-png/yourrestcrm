import type {Row} from './crm';
import {addMonths,monthList} from './sales-coverage';
import {handAddedDay} from './new-customers';
import {isFieldRole} from './roles';

/** Leave and absence in the evaluation (the owner, 2026-11-15: «الإجازات تتحسب في التقييم (GSCO 2.13.50): الأيام اللي المندوب كان فيها في
 *  إجازة ما تتحسبش ضده»), as the company's other CRM (GSCO 2.13.50 and 2.13.51) does it: nobody records a leave, it is read from the data.
 *
 *  - A month is WORKED by a person when they have, in it, an activity (a visit, a call, a follow-up or any other contact), a customer they
 *    added by hand in the app, or a confirmed sales document (a sale or a return, from the CRM or the ERP). The journey alone is no work.
 *  - «بلا نشاط في هذا الشهر – خارج التقييم» (since 2026-11-14): a representative with no work in a closed month whose sales are known
 *    complete is out of the evaluation (outOfEvaluation). Never a supervisor's or a sales manager's roll-up, never the month in progress.
 *  - «الحفاظ على العملاء الحاليين» and «العملاء المستردون» compare the month with the last THREE WORKED months before it (customerBaseline),
 *    looking back twelve months at most: a month the complete sales cover in which the person had no work (a leave, an absence) is skipped,
 *    and named («أشهر بلا نشاط لم تُحتسب»); a month the complete sales do not cover still stops the comparison (missing data). A covered
 *    month BEFORE the person's first worked month (before they joined) is an ordinary month without purchases (2.13.51), so a new
 *    representative is compared from their second month, and «العملاء المستردون» needs a worked month (or a purchase) before the three,
 *    so it starts four months after the first worked month.
 *  - A short leave inside a month changes nothing (GSCO's option «أ»): no target is reduced; the team target is unchanged.
 *  Pure: lib/kpis.ts and lib/own-targets-server.ts read the same rules. */
export const CUSTOMER_LOOKBACK_MONTHS=12;

const latin=(value:unknown)=>String(value??'').replace(/[٠-٩۰-۹]/g,digit=>String(digit.charCodeAt(0)-(digit>='۰'?0x6f0:0x660))).trim();
const DAY=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** A day as a record keeps it (YYYY-MM-DD; Arabic-Indic or Persian digits read as Latin ones), or '' when it is not one. */
export function recordDay(value:unknown){const day=latin(value);return DAY.test(day)?day:'';}

/** The months (YYYY-MM) each member worked in the CRM, up to the day `until`: an activity of theirs (its author performedBy, else
 *  responsibleId, as every indicator reads it: lib/sales.ts salesReportingRecords), by its day; a customer they added by hand
 *  (lib/new-customers.ts handAddedDay: the Riyadh day of its record; never one a file or the ERP customers import made). */
export function workMonthsByMember(records:readonly Row[],until:string){
 const out=new Map<string,Set<string>>();
 const add=(member:unknown,day:string)=>{const id=String(member||'');if(!id||!day||day>until)return;let months=out.get(id);if(!months)out.set(id,months=new Set());months.add(day.slice(0,7));};
 for(const record of records){
  if(record.kind==='activity')add(record.data?.performedBy||record.data?.responsibleId,recordDay(record.data?.date));
  else if(record.kind==='customer'&&record.data?._createdBy)add(record.data._createdBy,handAddedDay(record));
 }
 return out;
}
/** The months the people of ids worked up to `until`: their CRM work, and the days of their confirmed sales documents. */
export function workedMonths(work:ReadonlyMap<string,ReadonlySet<string>>,ids:Iterable<string>,documentDays:Iterable<string>,until:string){
 const months=new Set<string>();
 for(const id of ids)for(const month of work.get(id)||[])months.add(month);
 for(const value of documentDays){const day=recordDay(value);if(day&&day<=until)months.add(day.slice(0,7));}
 return months;
}
/** «بلا نشاط في هذا الشهر – خارج التقييم»: a representative only, a closed month only (its cutoff before today), its sales known complete
 *  (the ERP imports cover it, or «بيانات المؤشرات» confirmed it), and no work in it. */
export const outOfEvaluation=(role:string,month:string,cutoff:string,today:string,salesComplete:boolean,worked:ReadonlySet<string>)=>isFieldRole(role)&&cutoff<today&&salesComplete&&!worked.has(month);

/** What the customers' comparison of a month stands on.
 *  status: ready (three months to compare with), missing (months whose complete sales are needed: `missing`), none (fewer than three
 *  worked months within the twelve before: nothing to compare with).
 *  months: the compared months; skipped: the covered months without work left out; both oldest first.
 *  history (only when ready): ready (a whole complete month before the three, and a worked month or a sales document before them),
 *  missing (no whole complete month before the three: `missing` of recovered names the month), new (the person has no work and no
 *  document before the three: a new representative, nobody to recover yet). */
export type CustomerBaseline={status:'ready'|'missing'|'none';months:string[];skipped:string[];missing:string[];earliest:string|null;history:'ready'|'missing'|'new'};
export type BaselineInput={
 month:string;
 /** A month whose complete sales cover every day, for every member of the scope. */
 covered:(month:string)=>boolean;
 /** The months the scope worked (workedMonths), up to the evaluation month. */
 worked:ReadonlySet<string>;
 /** The months with a sales document of the scope (a part of worked). */
 documents:ReadonlySet<string>;
 /** A whole complete month before `earliest` for every member of the scope. */
 olderCovered:(earliest:string)=>boolean;
 /** A month of which complete sales cover at least one day for every member of the scope. */
 touched:(month:string)=>boolean;
};
export function customerBaseline({month,covered,worked,documents,olderCovered,touched}:BaselineInput):CustomerBaseline{
 // 2.13.51: only a gap AFTER the first worked month is a leave or an absence; with no work at all yet, every month is an ordinary one.
 const first=[...worked].filter(value=>value<month).sort()[0];
 const months:string[]=[],skipped:string[]=[],missing:string[]=[];
 for(let n=1;n<=CUSTOMER_LOOKBACK_MONTHS&&months.length+missing.length<3;n++){
  const candidate=addMonths(month,-n);
  if(!covered(candidate)){missing.push(candidate);continue;}
  if(first===undefined||candidate<first||worked.has(candidate))months.push(candidate);else skipped.push(candidate);
 }
 const oldestFirst=(values:string[])=>[...values].sort();
 const result:CustomerBaseline={status:missing.length?'missing':months.length===3?'ready':'none',months:oldestFirst(months),skipped:oldestFirst(skipped),missing:oldestFirst(missing),earliest:null,history:'missing'};
 if(result.status!=='ready')return result;
 const earliest=result.months[0];result.earliest=earliest;
 // «العملاء المستردون»: an older whole complete month, and older work: a sales document, or a worked month the complete sales touch (a file
 // from before the person joined proves nothing about their customers).
 if(!olderCovered(earliest))result.history='missing';
 else result.history=[...worked].some(value=>value<earliest&&(documents.has(value)||touched(value)))?'ready':'new';
 return result;
}
/** The sentence the customers' indicators add when months were skipped, in the reader's language. */
export function baselineSentence(baseline:{months:string[];skipped:string[]},language:'ar'|'en'='ar'){
 return language==='en'
  ?'Compared with the last three months worked: '+monthList(baseline.months,'en')+'. Months without activity not counted: '+monthList(baseline.skipped,'en')+'.'
  :'قورن بآخر ثلاثة أشهر عمل فيها: '+monthList(baseline.months)+'. أشهر بلا نشاط لم تُحتسب: '+monthList(baseline.skipped)+'.';
}
export const NO_BASELINE_REASON='لا توجد ثلاثة أشهر عمل فيها المندوب خلال الأشهر الاثني عشر السابقة، فلا توجد فترة مقارنة للعملاء. الأشهر التي تغطيها مبيعات ERP الكاملة بلا زيارات ولا متابعات ولا مبيعات (إجازة أو انقطاع) لا تُحتسب.';
export const NEW_HISTORY_REASON='لا يوجد قبل أشهر المقارنة شهر عمل فيه المندوب ولا شراء سابق لعملائه، فلا يمكن إثبات عميل مسترد. يبدأ احتساب المؤشر بعد أربعة أشهر من أول شهر عمل فيه.';

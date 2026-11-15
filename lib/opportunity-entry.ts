import {isServiceRole} from './customer-service';
import {visitResult} from './visits';

/** A new opportunity needs its result and its next step (the owner, 2026-11-15, from GSCO: «هل يمكن تسجيل فرصة بدون نتيجة» then «خليها
 * إجبارية والاجراء القادم»). In Yourrest an opportunity is registered as a new visit or contact on a customer: «زيارة جديدة» of a sales
 * member (the screens call it adding an opportunity: crm-app start('opportunity'), customer-machines onAddOpportunity; POST /api/visits,
 * which may write the customer's mold request, kind 'opportunity', beside it) and «فرصة جديدة» or a further contact of customer service
 * (POST /api/customer-service create/contact with a registration). Each needs:
 * - «نتيجة الزيارة» (or «نتيجة التواصل» for a call or another contact, and for customer service whose words are the contact's), at least
 *   3 letters once trimmed: the same rule as a follow-up's result (lib/customer-followups.ts customerFollowupSchema);
 * - the next action and the follow-up date (already required by both routes; these are the words shown beside the fields).
 * Checked in the form and on the server, so an entry saved on the device without a network meets the same rule when it uploads and comes
 * back «تحتاج مراجعة» with this message (app/offline-status.tsx lets the member add what is missing). Editing a saved visit or contact asks
 * nothing new. Nothing imported is an opportunity here (the ERP imports write customers, machines, quotations, sales and collections), and
 * a restoration from «المحذوفات» puts back what was there; neither passes through these routes. Shared by the server and the pages. */
export const OPPORTUNITY_RESULT_MIN=3;
export const OPPORTUNITY_MESSAGES={
 visitResult:'اكتب نتيجة الزيارة قبل حفظ الفرصة (3 أحرف على الأقل).',
 contactResult:'اكتب نتيجة التواصل قبل حفظ الفرصة (3 أحرف على الأقل).',
 nextAction:'اكتب الإجراء القادم قبل حفظ الفرصة.',
 nextDate:'حدد موعد المتابعة قبل حفظ الفرصة.'
} as const;
export type OpportunityField='result'|'nextAction'|'nextDate';
export type OpportunityEntry={type?:unknown;result?:unknown;outcome?:unknown;nextAction?:unknown;nextDate?:unknown};
/** The result as the visit shows it (lib/visits.ts visitResult): what was written, else the outcome a page of before sent («فعالة»، «متابعة العميل»،
 *  «لم يتم التواصل»), as the earlier rule of a finished visit reads it. */
const resultOf=(entry:OpportunityEntry)=>visitResult({result:typeof entry.result==='string'?entry.result:'',outcome:typeof entry.outcome==='string'?entry.outcome:''});
const filled=(value:unknown,min=1)=>typeof value==='string'&&value.trim().length>=min;
/** The result's message: «نتيجة الزيارة» for a visit of a sales member, «نتيجة التواصل» for any other contact and for customer service. */
export const opportunityResultMessage=(type:unknown,role?:string|null)=>type==='visit'&&!(role&&isServiceRole(role))?OPPORTUNITY_MESSAGES.visitResult:OPPORTUNITY_MESSAGES.contactResult;
/** What a new opportunity lacks, field by field (empty when nothing). The date's shape and day are the routes' own checks. */
export function opportunityProblems(entry:OpportunityEntry,role?:string|null):Partial<Record<OpportunityField,string>>{
 const problems:Partial<Record<OpportunityField,string>>={};
 if(!filled(resultOf(entry),OPPORTUNITY_RESULT_MIN))problems.result=opportunityResultMessage(entry.type,role);
 if(!filled(entry.nextAction))problems.nextAction=OPPORTUNITY_MESSAGES.nextAction;
 if(!filled(entry.nextDate))problems.nextDate=OPPORTUNITY_MESSAGES.nextDate;
 return problems;
}
/** The first of them, in the order of the form (the result, then the next action, then its date), or ''. */
export function opportunityProblem(entry:OpportunityEntry,role?:string|null){
 const problems=opportunityProblems(entry,role);
 return problems.result||problems.nextAction||problems.nextDate||'';
}
/** A message these rules wrote: an entry it came back with may be completed on the device (app/offline-status.tsx). */
export const isOpportunityMessage=(message:unknown)=>typeof message==='string'&&(Object.values(OPPORTUNITY_MESSAGES) as string[]).includes(message.trim());

import type {Member,Row} from './crm';
import {canReadService,isServiceRole,serviceState,type ServiceCase} from './customer-service';
import {canReadSupport,isOpenSupport,supportReader,type SupportOpportunity,type SupportRow} from './support';
import {salesScopeMemberIds} from './access';

/** «طلب مساندة» from inside an opportunity (the owner, 2026-11-16, item 3 of the GSCO list, after GSCO 2.13.77 commit 2ba1beb: «طلب مساندة جوه
 * الفرصة يفتح طلب في «التواصل مع العملاء» بمدده وتصعيده. الزرار يظهر للمندوب على كل فرصه المفتوحة. لو العميل مش مربوط بالدليل، تظهر رسالة
 * توضح ده. لو للعميل طلب مفتوح، يظهر زرار «فتح الطلب المفتوح». طلبات المساندة القديمة تفضل مقروءة، والمفتوح منها يقدر يكمل، بس ما يتعملش
 * منها طلبات جديدة.»). In Yourrest an opportunity is a customer-service request (a `crm_service_cases` row, «فرصة» for customer service) as
 * the sales team holds it, opened in the sheet «الاعتماد والتكليف» (app/customer-service.tsx); the support chain is Yourrest's customer-service
 * assistance (lib/support.ts, the panel «التواصل مع العملاء»), with its own stage targets and the manager's escalation. The old support of an
 * opportunity is the case's internal «طلب مساعدة داخلية» (action `assist`): it takes no new requests; an open one is still answered with
 * «الرد وإغلاق طلب المساعدة», and every earlier one stays in the case's history. Pure: the routes (GET /api/support/opportunity and POST
 * /api/support {action:'request',opportunityId}) load the records; the page reads the same answer. */
export const SUPPORT_UNLINKED_MESSAGE='عميل هذه الفرصة غير مربوط بقائمة العملاء، وطلب المساندة يحتاج عميلًا محفوظًا في القائمة. راجع مدير النظام ليربط الفرصة بعميلها، ثم أعد طلب المساندة.';
export const SUPPORT_OPEN_MESSAGE='يوجد طلب مساندة مفتوح لهذا العميل تتابعه خدمة العملاء في «التواصل مع العملاء»، ولا يُفتح له طلب ثانٍ حتى ينتهي.';
export const SUPPORT_CLOSED_OPPORTUNITY_MESSAGE='طلب المساندة متاح للفرص المفتوحة فقط.';
export const SUPPORT_OPPORTUNITY_GONE='الفرصة غير متاحة.';
export const SUPPORT_OPPORTUNITY_ROLES='طلب المساندة متاح للمندوب والمشرف ومدير المبيعات ومدير النظام فقط.';
export const SUPPORT_ASSIST_RETIRED_MESSAGE='لم يعد «طلب مساعدة داخلية» متاحًا: طلب المساندة الجديد يُفتح من زر «طلب مساندة» في الفرصة، وتتابعه خدمة العملاء في «التواصل مع العملاء». تبقى الطلبات السابقة مقروءة، ويُكمل المفتوح منها بالرد.';

export type OpportunitySupportContext={me:Member;members:Member[];all:Row[];serviceCases:ServiceCase[];support:SupportRow[]};
export type OpportunitySupportCheck={
 opportunity:SupportOpportunity&{open:boolean};
 /** The opportunity's customer in the customer list, or null when it is not there (then no request can be made). */
 customer:{id:string;name:string;version:number}|null;
 /** The customer's open support request (one at a time), and whether this reader may open it. */
 openRequest:{id:string;readable:boolean}|null;
 /** Every condition holds: the form may be offered. */
 canAsk:boolean;
};
export type OpportunitySupportRefusal={status:403|404;error:string};
/** Who may ask from an opportunity: an administrator or a sales member (customer service is the one asked, never the one asking). */
export const mayAskFromOpportunity=(role:string)=>role==='admin'||role==='manager'||role==='supervisor'||role==='rep';
/** The opportunity as a support request keeps it: the case, its request number and what the customer asked for. */
export function supportOpportunityOf(item:ServiceCase):SupportOpportunity{
 const number=item.data.registration?.visitNumber;
 return {id:item.id,number:typeof number==='number'&&Number.isSafeInteger(number)?number:null,products:(item.data.products||[]).filter(product=>typeof product==='string').slice(0,8)};
}
/** What «طلب مساندة» on this opportunity may do for this reader, or why it is refused (403 for a role that does not ask, 404 for an
 *  opportunity the reader may not read, as the sheet that shows it). */
export function opportunitySupport(c:OpportunitySupportContext,caseId:string):OpportunitySupportCheck|OpportunitySupportRefusal{
 if(!mayAskFromOpportunity(c.me.role)||isServiceRole(c.me.role))return {status:403,error:SUPPORT_OPPORTUNITY_ROLES};
 const item=c.serviceCases.find(row=>row.id===caseId);
 if(!item)return {status:404,error:SUPPORT_OPPORTUNITY_GONE};
 const customer=c.all.find(row=>row.kind==='customer'&&row.id===item.customerId);
 if(!customer){
  // Not in the customer list (Yourrest keeps a customer while it has a case, so only damaged data gets here): the holder's chain is told
  // why, anyone else meets the same 404 as for an opportunity they may not read.
  const team=salesScopeMemberIds(c.members,c.me),held=c.me.role==='admin'||!!item.assignedTo&&team.has(item.assignedTo)||c.me.role==='manager'&&item.salesManagerId===c.me.id;
  if(!held)return {status:404,error:SUPPORT_OPPORTUNITY_GONE};
  return {opportunity:{...supportOpportunityOf(item),open:!['won','lost'].includes(serviceState(item,c.all,c.members))},customer:null,openRequest:null,canAsk:false};
 }
 if(!canReadService(item,c))return {status:404,error:SUPPORT_OPPORTUNITY_GONE};
 const open=!['won','lost'].includes(serviceState(item,c.all,c.members)),reader=supportReader(c);
 const pending=c.support.filter(row=>row.data.customerId===customer.id&&isOpenSupport(row.data)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
 return {
  opportunity:{...supportOpportunityOf(item),open},
  customer:{id:customer.id,name:String(customer.data.name||''),version:customer.version},
  openRequest:pending?{id:pending.id,readable:canReadSupport(pending,customer,reader)}:null,
  canAsk:open&&!pending
 };
}
export const isOpportunitySupportRefusal=(value:OpportunitySupportCheck|OpportunitySupportRefusal):value is OpportunitySupportRefusal=>'status' in value;
export type OpportunitySupportProblem='closed'|'unlinked'|'open-request';
/** Why a check cannot ask, first reason first: a closed opportunity, a customer not in the list, an open request; null when it can. */
export function opportunitySupportProblemKey(check:OpportunitySupportCheck):OpportunitySupportProblem|null{
 if(!check.opportunity.open)return 'closed';
 if(!check.customer)return 'unlinked';
 if(check.openRequest)return 'open-request';
 return null;
}
/** The words of each reason, Arabic (what the server answers) and English (the page in English). */
export const OPPORTUNITY_SUPPORT_PROBLEMS:Record<OpportunitySupportProblem,readonly [string,string]>={
 closed:[SUPPORT_CLOSED_OPPORTUNITY_MESSAGE,'Support can be requested for open opportunities only.'],
 unlinked:[SUPPORT_UNLINKED_MESSAGE,'This opportunity\'s customer is not linked to the customer list, and a support request needs a customer saved in the list. Ask the administrator to link the opportunity to its customer, then request support again.'],
 'open-request':[SUPPORT_OPEN_MESSAGE,'This customer already has an open support request that customer service follows in «Customer contact»; a second one cannot be opened until it finishes.']
};
/** The Arabic words of the reason a check cannot ask (the server's refusal), or '' when it can. */
export function opportunitySupportProblem(check:OpportunitySupportCheck){const key=opportunitySupportProblemKey(check);return key?OPPORTUNITY_SUPPORT_PROBLEMS[key][0]:'';}

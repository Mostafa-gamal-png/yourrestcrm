import {z} from 'zod';
import {workingHoursBetween} from './working-hours';
import {quotationRefKey} from './quotation-refs';

/** Customer service in the sales process (the owner, 2026-11-16, item 5 of the GSCO list, after GSCO 2.13.78). Pure rules shared by the
 * server, the pages and the tests. In Yourrest the opportunity customer service registers is a customer-service request (a
 * crm_service_cases row, «فرصة» on customer service's screens), and a quotation is an ERP quotation imported onto the customer
 * (lib/erp-quotes.ts) that an ERP sales invoice names in its «الوصف» (lib/quotation-refs.ts).
 * A. «مصدر الفرصة»: what customer service brought in from outside the CRM, or what the system pointed at (a lost opportunity, a customer
 *    who has not bought for 90 days, a support request of «التواصل مع العملاء», a missed visit, a complaint), filled in and locked.
 * B. «اعتماد وإحالة»: the customer-service manager passes the opportunity to the sales manager (as before) or keeps it with customer
 *    service, only for a customer with no ERP code, one who has not bought for 90 days (or never), or a lead customer service brought in.
 * C. Sales attribution, each invoice once, highest first: «مبيعات بالكامل» (the invoice names a quotation of the customer issued while
 *    customer service kept the opportunity), «مبيعات بالمشاركة» (the same while an opportunity customer service registered was with sales),
 *    «مبيعات بالمساندة» (the customer was reached through «التواصل مع العملاء» with interest and bought within the set days).
 * D. «تسجيل دور خدمة العملاء» when an opportunity customer service took part in is won or lost.
 * E. «أداء خدمة العملاء», for follow-up only: no target (the owner's decision). */

// ---- The four questions the owner has not answered yet (GSCO 2.13.78's provisional choices, each set here and nowhere else):
/** 1. The target of «نسبة الفرص المتحولة إلى مبيعات» is CONVERSION_TARGET in lib/service-kpi.ts (50%). */
/** 2. The default of the support-sales window, in days; the administrator changes it in «تقييم خدمة العملاء» › الإعدادات (supportSalesDays). */
export const SUPPORT_SALES_DAYS=60;
/** 3. Whether the sales manager reads every customer-service team in «أداء خدمة العملاء» (GSCO: yes, reading only). */
export const SALES_MANAGER_SEES_ALL_SERVICE_TEAMS=true;
/** 4. Whether «عملاء منقطعون عن الشراء 90 يومًا» lists customers who never bought (GSCO: no: a customer with no purchase is not listed). */
export const DORMANT_LIST_INCLUDES_NEVER_BOUGHT=false;

export const DORMANT_DAYS=90;
export const LEAD_OTHER='أخرى';
export const LEAD_UNSPECIFIED='غير محدد';
export const LEAD_NOTE_MAX=200;
export const leadGroups={service:'من جهد خدمة العملاء',system:'من بيانات النظام'} as const;
export const leadGroupsEn={service:'Brought in by customer service',system:'From the system data'} as const;
export type LeadGroup=keyof typeof leadGroups;
/** What customer service brought in from outside the CRM; «أخرى» needs a short text. */
export const serviceLeadSources=['اتصال وارد','واتساب','الموقع الإلكتروني','مواقع التواصل الاجتماعي','توصية من عميل','اتصال تسويقي','معرض أو فعالية',LEAD_OTHER] as const;
export const serviceLeadSourcesEn:Record<string,string>={'اتصال وارد':'Incoming call','واتساب':'WhatsApp','الموقع الإلكتروني':'Website','مواقع التواصل الاجتماعي':'Social media','توصية من عميل':'Customer referral','اتصال تسويقي':'Marketing call','معرض أو فعالية':'Exhibition or event',[LEAD_OTHER]:'Other'};
export const leadRefKinds=['opportunity','customer','support','missed_visit','complaint'] as const;
export type LeadRefKind=typeof leadRefKinds[number];
export const isLeadRefKind=(value:unknown):value is LeadRefKind=>typeof value==='string'&&(leadRefKinds as readonly string[]).includes(value);
/** What the system fills in and locks, by the kind of record the opportunity was started from. */
export const systemLeadSources:Record<LeadRefKind,string>={opportunity:'فرصة مفقودة سابقة',customer:'عميل منقطع عن الشراء 90 يومًا',missed_visit:'زيارة مفقودة',support:'طلب تواصل مع العملاء',complaint:'شكوى'};
export const systemLeadSourcesEn:Record<LeadRefKind,string>={opportunity:'A previously lost opportunity',customer:'Customer who has not bought for 90 days',missed_visit:'Missed visit',support:'Customer contact request',complaint:'Complaint'};
/** The start button on each kind of record. */
export const leadStartLabels:Record<LeadRefKind,string>={opportunity:'بدء فرصة جديدة من هذه الفرصة',customer:'بدء فرصة جديدة لهذا العميل',support:'فرصة جديدة من هذا الطلب',missed_visit:'فرصة جديدة من هذا الطلب',complaint:'فرصة جديدة من هذه الشكوى'};
export const leadStartLabelsEn:Record<LeadRefKind,string>={opportunity:'Start a new opportunity from this one',customer:'Start a new opportunity for this customer',support:'New opportunity from this request',missed_visit:'New opportunity from this request',complaint:'New opportunity from this complaint'};

/** What the form sends with a new opportunity. The server decides the group and the source of a reference itself; a sent source must match. */
export const leadInputSchema=z.object({
 group:z.enum(['service','system']),
 source:z.string().trim().max(80).default(''),
 note:z.string().trim().max(LEAD_NOTE_MAX).default(''),
 refKind:z.enum(leadRefKinds).nullable().optional(),
 refId:z.string().trim().max(200).nullable().optional()
}).strict();
export type LeadInput=z.infer<typeof leadInputSchema>;
export type Lead={group:LeadGroup;source:string;note:string;refKind:LeadRefKind|null;refId:string|null};
export const LEAD_MESSAGES={
 missing:'اختر مصدر الفرصة.',
 systemOnly:'مصدر «من بيانات النظام» يُملأ عند بدء الفرصة من سجلها فقط.',
 serviceWithRef:'اختر مصدرًا من جهد خدمة العملاء أو ابدأ الفرصة من سجلها.',
 notListed:'اختر مصدر الفرصة من القائمة.',
 otherShort:'اكتب مصدر الفرصة باختصار (3 أحرف على الأقل).'
} as const;
/** The problem with a lead, or '' when it is complete. A reference is not checked here: the server reads it. */
export function serviceLeadProblem(lead:Partial<Pick<LeadInput,'group'|'source'|'note'|'refKind'|'refId'>>|null|undefined):string{
 if(!lead||!lead.group)return LEAD_MESSAGES.missing;
 if(lead.group==='system')return lead.refKind&&lead.refId?'':LEAD_MESSAGES.systemOnly;
 if(lead.refKind||lead.refId)return LEAD_MESSAGES.serviceWithRef;
 if(!(serviceLeadSources as readonly string[]).includes(lead.source||''))return LEAD_MESSAGES.notListed;
 if(lead.source===LEAD_OTHER&&String(lead.note||'').trim().length<3)return LEAD_MESSAGES.otherShort;
 return '';
}
/** How a stored lead reads: «من جهد خدمة العملاء · واتساب»; a case registered before this release has none: «غير محدد». */
export function leadLabel(group:string|null|undefined,source:string|null|undefined,note?:string|null){
 if(!group||!source)return LEAD_UNSPECIFIED;
 return (leadGroups[group as LeadGroup]||group)+' · '+source+(source===LEAD_OTHER&&note?' ('+note+')':'');
}
const systemSourceEn=(source:string)=>{const kind=leadRefKinds.find(key=>systemLeadSources[key]===source);return kind?systemLeadSourcesEn[kind]:'';};
export function leadLabelEn(group:string|null|undefined,source:string|null|undefined,note?:string|null){
 if(!group||!source)return 'Unspecified';
 return (leadGroupsEn[group as LeadGroup]||group)+' · '+(serviceLeadSourcesEn[source]||systemSourceEn(source)||source)+(source===LEAD_OTHER&&note?' ('+note+')':'');
}

// ---- B. routing at approval
export const routeLabels={sales:'تمرير لمدير المبيعات',service:'تتولاها خدمة العملاء'} as const;
export const routeLabelsEn={sales:'Pass to the sales manager',service:'Customer service takes it'} as const;
export type Route=keyof typeof routeLabels;
export type RoutingFacts={unlinked:boolean;dormant:boolean;serviceEffort:boolean};
export const routingReasonLabels:Record<keyof RoutingFacts,string>={unlinked:'العميل غير مسجّل في ERP (بلا كود ERP)',dormant:'العميل لم يشترِ خلال 90 يومًا أو لم يشترِ من قبل',serviceEffort:'مصدر الفرصة من جهد خدمة العملاء'};
export const routingReasonLabelsEn:Record<keyof RoutingFacts,string>={unlinked:'The customer is not registered in the ERP (no ERP code)',dormant:'The customer has not bought in 90 days, or never',serviceEffort:'The lead was brought in by customer service'};
export const ROUTING_NOT_ELIGIBLE='تتولى خدمة العملاء الفرصة فقط إذا كان العميل غير مسجّل في ERP، أو لم يشترِ خلال 90 يومًا، أو كان مصدر الفرصة من جهد خدمة العملاء. مرّر الفرصة لمدير المبيعات.';
export const OPEN_SALES_WARNING='تنبيه: للعميل فرصة مفتوحة لدى المبيعات';
export const routingEligible=(f:RoutingFacts)=>f.unlinked||f.dormant||f.serviceEffort;
export const routingReasons=(f:RoutingFacts)=>(Object.keys(routingReasonLabels) as (keyof RoutingFacts)[]).filter(key=>f[key]);
const DAY_MS=86400000;
const addDays=(day:string,days:number)=>{const t=Date.parse(day+'T00:00:00Z');return Number.isFinite(t)?new Date(t+days*DAY_MS).toISOString().slice(0,10):day;};
/** The first day that still counts as buying: a purchase on or after it is recent (`today` minus 90 days; 90 days ago is still recent). */
export const dormantSince=(today:string,days=DORMANT_DAYS)=>addDays(today,-days);
/** A customer is dormant with no purchase since `dormantSince`, or none at all. */
export const dormantCustomer=(lastPurchase:string|null|undefined,today:string,days=DORMANT_DAYS)=>!lastPurchase||lastPurchase<dormantSince(today,days);
/** Whether «عملاء منقطعون عن الشراء 90 يومًا» lists this customer (question 4 decides about a customer who never bought). */
export const dormantListed=(lastPurchase:string|null|undefined,today:string,days=DORMANT_DAYS)=>lastPurchase?lastPurchase<dormantSince(today,days):DORMANT_LIST_INCLUDES_NEVER_BOUGHT;
/** The words on a case customer service keeps. */
export const SERVICE_OWNED_LABEL='لدى خدمة العملاء';
export const SERVICE_OWNED_REFUSED='هذه الفرصة لدى خدمة العملاء ويتابعها ممثل خدمة العملاء المسؤول عنها.';

// ---- D. the customer-service role at closing
export const serviceRoleOptions=['جلب العميل','التواصل والمتابعة','عرض السعر والتفاوض','استرداد عميل منقطع','حل شكوى','أخرى'] as const;
export const serviceRoleOptionsEn:Record<string,string>={'جلب العميل':'Bringing the customer','التواصل والمتابعة':'Contact and follow-up','عرض السعر والتفاوض':'Quotation and negotiation','استرداد عميل منقطع':'Winning back a dormant customer','حل شكوى':'Resolving a complaint','أخرى':'Other'};
export const ROLE_TASK_HOURS=24;
export const ROLE_NOTE_MIN=10;
export const ROLE_TASK_TITLE='تسجيل دور خدمة العملاء';
export const roleBasisLabels={owner:'مسؤول الفرصة',registrar:'سجّل الفرصة',support:'تواصل مع العميل في طلب مساندة'} as const;
export const roleBasisLabelsEn={owner:'Owns the opportunity',registrar:'Registered the opportunity',support:'Contacted the customer in a support request'} as const;
export type RoleBasis=keyof typeof roleBasisLabels;
export const roleTaskHours=(closedAt:string,now:string)=>workingHoursBetween(closedAt,now);
export const roleTaskLate=(closedAt:string,now:string)=>roleTaskHours(closedAt,now)>ROLE_TASK_HOURS;
export const roleTaskSchema=z.object({roles:z.array(z.enum(serviceRoleOptions,{errorMap:()=>({message:'اختر دور خدمة العملاء'})})).min(1,'اختر دور خدمة العملاء').max(serviceRoleOptions.length),note:z.string().trim().min(ROLE_NOTE_MIN,'اكتب ملاحظة من 10 أحرف على الأقل').max(1000)}).strict();

// ---- C. attribution
export type SalesCategory='full'|'shared'|'support';
export const salesCategories:SalesCategory[]=['full','shared','support'];
export const salesCategoryLabels:Record<SalesCategory,string>={full:'مبيعات بالكامل',shared:'مبيعات بالمشاركة',support:'مبيعات بالمساندة'};
export const salesCategoryLabelsEn:Record<SalesCategory,string>={full:'Full customer-service sales',shared:'Shared sales',support:'Support-assisted sales'};
export const FULL_SALES_LINE='منها مبيعات خدمة العملاء بالكامل';
export const FULL_SALES_NOTE='(ضمن إجمالي ERP أعلاه وخارج تحقيق المستهدفات والتقييم)';
/** An opportunity customer service registered, as the attribution reads it. `held`: customer service keeps it (route 'service'). */
export type CaseFact={id:string;number:number|null;customerId:string;customerName:string;registrarId:string;ownerId:string;held:boolean;route:Route|null;approved:boolean;
 createdAt:string;state:string;closedAt:string;leadGroup:string|null;leadSource:string|null;leadNote:string};
/** A quotation of a customer (an ERP quotation imported onto it): `ref` «Qut-349», its day and its total. */
export type QuoteFact={id:string;ref:string;customerId:string;date:string;total:number};
/** One sales document: an ERP invoice or return (crm_erp_sales), or a confirmed manual invoice (crm_sales, never a quotation link).
 *  `value` before tax, a return negative; `refs` the quotations its «الوصف» names; `customerId` the customer it resolves to ('' when none). */
export type InvoiceFact={id:string;source:'erp'|'crm';number:string;date:string;type:'sale'|'return';customerId:string;repId:string;value:number;refs:string[]};
/** A contact customer service made through «التواصل مع العملاء» that found the customer interested or asking for a visit. */
export type SupportContactFact={requestId:string;customerId:string;handlerId:string;at:string};
export const SUPPORT_SALES_OUTCOMES=['reached_interested','wants_visit'] as const;
export type AttributedInvoice={id:string;source:'erp'|'crm';number:string;date:string;type:'sale'|'return';category:SalesCategory;memberId:string;caseId:string|null;value:number;customerId:string;repId:string};
const cents=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
/** The Riyadh day of a stored moment (a plain day is kept). */
export const riyadhDayOf=(iso:string)=>{if(/^\d{4}-\d{2}-\d{2}$/.test(iso))return iso;const t=Date.parse(iso);return Number.isFinite(t)?new Date(t+3*3600000).toISOString().slice(0,10):'';};
/** The opportunity a quotation belongs to: the latest one customer service registered on that customer, open on the quotation's day (from the
 *  day it was registered to the day it was won or lost). Yourrest keeps one open opportunity per customer, so at most one is open on a day. */
export function caseOfQuote(quote:Pick<QuoteFact,'customerId'|'date'>,cases:readonly CaseFact[]):CaseFact|undefined{
 let found:CaseFact|undefined;
 for(const item of cases){
  if(item.customerId!==quote.customerId)continue;
  const from=riyadhDayOf(item.createdAt),to=item.closedAt?riyadhDayOf(item.closedAt):'';
  if(!from||quote.date<from||to&&quote.date>to)continue;
  if(!found||item.createdAt>found.createdAt||item.createdAt===found.createdAt&&item.id>found.id)found=item;
 }
 return found;
}
/** Every invoice customer service earns, once, in the highest category it reaches. A quotation an invoice names decides «بالكامل» (its
 * opportunity is kept by customer service) and «بالمشاركة» (it is with sales), whatever the ERP salesperson; a support contact decides
 * «بالمساندة» for a sale of that customer no later than `supportDays` after the contact's day. A return goes to the category of its quotation
 * with a negative value and is not counted as an invoice. */
export function attributeSales(input:{cases:readonly CaseFact[];quotes:readonly QuoteFact[];invoices:readonly InvoiceFact[];contacts:readonly SupportContactFact[];supportDays:number}):AttributedInvoice[]{
 const quoteCase=new Map<string,CaseFact>();
 for(const q of input.quotes){const key=quotationRefKey(q.ref);if(!key)continue;const item=caseOfQuote(q,input.cases);if(item)quoteCase.set(key,item);}
 const out=new Map<string,AttributedInvoice>();
 for(const invoice of input.invoices){
  const found=invoice.refs.map(ref=>quoteCase.get(ref)).filter((item):item is CaseFact=>!!item);
  if(!found.length)continue;
  const ordered=[...new Set(found)].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const held=ordered.find(item=>item.held),item=held||ordered[0];
  out.set(invoice.id,{id:invoice.id,source:invoice.source,number:invoice.number,date:invoice.date,type:invoice.type,category:held?'full':'shared',memberId:held?held.ownerId:item.registrarId,caseId:item.id,
   value:cents(invoice.type==='return'?-Math.abs(invoice.value):invoice.value),customerId:invoice.customerId,repId:invoice.repId});
 }
 const byCustomer=new Map<string,SupportContactFact[]>();
 for(const c of input.contacts){if(!c.customerId)continue;const list=byCustomer.get(c.customerId);if(list)list.push(c);else byCustomer.set(c.customerId,[c]);}
 for(const invoice of input.invoices){
  if(invoice.type!=='sale'||out.has(invoice.id)||!invoice.customerId)continue;
  const contacts=byCustomer.get(invoice.customerId);if(!contacts)continue;
  const match=contacts.map(c=>({c,day:riyadhDayOf(c.at)})).filter(x=>x.day&&x.day<=invoice.date&&invoice.date<=addDays(x.day,input.supportDays)).sort((a,b)=>b.c.at.localeCompare(a.c.at))[0];
  if(match)out.set(invoice.id,{id:invoice.id,source:invoice.source,number:invoice.number,date:invoice.date,type:'sale',category:'support',memberId:match.c.handlerId,caseId:null,value:cents(invoice.value),customerId:invoice.customerId,repId:invoice.repId});
 }
 return [...out.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
/** The documents that leave every target achievement, the company counter and the evaluation: the full customer-service sales. */
export const fullSalesIds=(attributed:readonly AttributedInvoice[])=>new Set(attributed.filter(a=>a.category==='full').map(a=>a.id));
/** A list of sales without the full customer-service ones (what the achievement reads). */
export function withoutFullSales<T extends {id:string}>(sales:readonly T[],excluded:ReadonlySet<string>|null|undefined):T[]{return excluded&&excluded.size?sales.filter(s=>!excluded.has(s.id)):[...sales];}

// ---- D. role tasks
export type RoleTaskTarget={memberId:string;basis:RoleBasis};
/** Who records customer service's role when the opportunity closes: the member who keeps it, else the customer-service member who
 *  registered it, else the one who handled a support request asked from it; null when customer service took no part (or nobody active). */
export function roleTaskTarget(item:Pick<CaseFact,'held'|'ownerId'|'registrarId'>,activeService:ReadonlySet<string>,supportHandlerId?:string|null):RoleTaskTarget|null{
 if(item.held&&item.ownerId&&activeService.has(item.ownerId))return {memberId:item.ownerId,basis:'owner'};
 if(item.registrarId&&activeService.has(item.registrarId))return {memberId:item.registrarId,basis:'registrar'};
 if(supportHandlerId&&activeService.has(supportHandlerId))return {memberId:supportHandlerId,basis:'support'};
 return null;
}
export type RoleTaskFact={caseId:string;number:number|null;customerName:string;outcome:'won'|'lost';memberId:string;basis:RoleBasis;closedAt:string;roles:string[];note:string;doneBy:string;doneAt:string};

// ---- E. the dashboard «أداء خدمة العملاء»
export type PerformanceMember={id:string;name:string;role:string;supervisorId:string};
export type PerformanceRow={
 memberId:string;memberName:string;
 opportunities:number;byGroup:Record<string,number>;bySource:{group:string;source:string;count:number}[];
 passed:number;kept:number;pending:number;
 quoted:number;quotedValue:number;invoiced:number;invoicedValue:number;
 sales:Record<SalesCategory,{value:number;invoices:number}>;
 recovered:number;averageDays:number|null;daysCases:number;
 rolesDone:number;rolesWaiting:number;rolesLate:number;
};
export type PerformanceContext={members:PerformanceMember[];cases:CaseFact[];quotes:QuoteFact[];attributed:AttributedInvoice[];invoices:InvoiceFact[];contacts:SupportContactFact[];tasks:RoleTaskFact[]};
export const monthOfDay=(day:string)=>String(day||'').slice(0,7);
const emptyRow=(member:{id:string;name:string}):PerformanceRow=>({memberId:member.id,memberName:member.name,opportunities:0,byGroup:{},bySource:[],passed:0,kept:0,pending:0,quoted:0,quotedValue:0,invoiced:0,invoicedValue:0,
 sales:{full:{value:0,invoices:0},shared:{value:0,invoices:0},support:{value:0,invoices:0}},recovered:0,averageDays:null,daysCases:0,rolesDone:0,rolesWaiting:0,rolesLate:0});
/** The member an opportunity counts for: the one who keeps it when customer service does, otherwise whoever registered it. */
export const creditedMember=(o:Pick<CaseFact,'held'|'ownerId'|'registrarId'>)=>o.held&&o.ownerId?o.ownerId:o.registrarId;
/** Customers that came back: buyers before, with no purchase in the 90 days before customer service touched them (an opportunity, a
 *  support contact), who bought on or after that day. Credited once a customer, in the month of that first purchase, to whoever touched
 *  them last before it. A first purchase ever is a new customer, not one won back. */
export function recoveredCustomers(c:Pick<PerformanceContext,'cases'|'contacts'|'invoices'>){
 const sales=new Map<string,string[]>();
 for(const i of c.invoices){if(i.type!=='sale'||!i.customerId||i.value<=0)continue;const list=sales.get(i.customerId);if(list)list.push(i.date);else sales.set(i.customerId,[i.date]);}
 for(const list of sales.values())list.sort();
 const touches:{customerId:string;day:string;memberId:string}[]=[];
 for(const o of c.cases)touches.push({customerId:o.customerId,day:riyadhDayOf(o.createdAt),memberId:creditedMember(o)});
 for(const t of c.contacts)touches.push({customerId:t.customerId,day:riyadhDayOf(t.at),memberId:t.handlerId});
 const out=new Map<string,{customerId:string;memberId:string;day:string;touchedOn:string}>();
 for(const t of touches.sort((a,b)=>a.day.localeCompare(b.day))){
  if(!t.customerId||!t.day)continue;const days=sales.get(t.customerId)||[];
  const before=days.filter(d=>d<t.day).at(-1),after=days.find(d=>d>=t.day);
  if(!after||!before||before>=dormantSince(t.day))continue;
  const known=out.get(t.customerId);
  if(!known||known.day>after||known.day===after&&known.touchedOn<=t.day)out.set(t.customerId,{customerId:t.customerId,memberId:t.memberId,day:after,touchedOn:t.day});
 }
 return [...out.values()];
}
/** One month of the dashboard, a row per member the reader may see. Opportunities count in the month they were registered (their quotation
 *  and invoice follow them); sales, customers won back and recorded roles count in the month they happened. */
export function servicePerformance(c:PerformanceContext,month:string,now:string):PerformanceRow[]{
 const rows=new Map(c.members.map(m=>[m.id,emptyRow(m)]));
 const quotesOf=new Map<string,QuoteFact[]>();for(const q of c.quotes){const item=caseOfQuote(q,c.cases);if(!item)continue;const list=quotesOf.get(item.id);if(list)list.push(q);else quotesOf.set(item.id,[q]);}
 const invoicesOf=new Map<string,AttributedInvoice[]>();for(const a of c.attributed){if(!a.caseId)continue;const list=invoicesOf.get(a.caseId);if(list)list.push(a);else invoicesOf.set(a.caseId,[a]);}
 for(const o of c.cases){
  if(monthOfDay(riyadhDayOf(o.createdAt))!==month)continue;
  const row=rows.get(o.registrarId);if(!row)continue;
  row.opportunities++;
  const groupKey=o.leadGroup&&o.leadSource?o.leadGroup:LEAD_UNSPECIFIED;row.byGroup[groupKey]=(row.byGroup[groupKey]||0)+1;
  const source=o.leadGroup&&o.leadSource?o.leadSource:LEAD_UNSPECIFIED,found=row.bySource.find(s=>s.group===groupKey&&s.source===source);if(found)found.count++;else row.bySource.push({group:groupKey,source,count:1});
  if(o.held)row.kept++;else if(o.route==='sales'||o.approved)row.passed++;else row.pending++;
  const quotes=quotesOf.get(o.id)||[];if(quotes.length){row.quoted++;row.quotedValue=cents(row.quotedValue+quotes.reduce((n,q)=>n+q.total,0));}
  const invoices=invoicesOf.get(o.id)||[];if(invoices.some(a=>a.type==='sale')){row.invoiced++;row.invoicedValue=cents(row.invoicedValue+invoices.reduce((n,a)=>n+a.value,0));}
 }
 for(const row of rows.values())row.bySource.sort((a,b)=>b.count-a.count||a.source.localeCompare(b.source));
 const firstInvoice=new Map<string,string>();
 for(const a of c.attributed){
  if(a.caseId&&a.type==='sale'){const known=firstInvoice.get(a.caseId);if(!known||a.date<known)firstInvoice.set(a.caseId,a.date);}
  if(monthOfDay(a.date)!==month)continue;
  const row=rows.get(a.memberId);if(!row)continue;
  const cell=row.sales[a.category];cell.value=cents(cell.value+a.value);if(a.type==='sale')cell.invoices++;
 }
 const days=new Map<string,number[]>();
 for(const o of c.cases){
  const first=firstInvoice.get(o.id);if(!first||monthOfDay(first)!==month)continue;
  const member=creditedMember(o),created=riyadhDayOf(o.createdAt);if(!rows.has(member)||!created)continue;
  const span=Math.max(0,Math.round((Date.parse(first+'T00:00:00Z')-Date.parse(created+'T00:00:00Z'))/DAY_MS));
  const list=days.get(member);if(list)list.push(span);else days.set(member,[span]);
 }
 for(const [member,list] of days){const row=rows.get(member)!;row.daysCases=list.length;row.averageDays=Math.round(list.reduce((a,b)=>a+b,0)/list.length*10)/10;}
 for(const r of recoveredCustomers(c)){if(monthOfDay(r.day)!==month)continue;const row=rows.get(r.memberId);if(row)row.recovered++;}
 for(const t of c.tasks){
  const row=rows.get(t.memberId);if(!row)continue;
  if(t.doneAt){if(monthOfDay(riyadhDayOf(t.doneAt))===month)row.rolesDone++;continue;}
  row.rolesWaiting++;if(roleTaskLate(t.closedAt,now))row.rolesLate++;
 }
 return [...rows.values()];
}
/** The team line: the members' figures added up (the average days weighted by their cases). */
export function performanceTotal(rows:readonly PerformanceRow[],name:string):PerformanceRow{
 const total=emptyRow({id:'',name});
 let dayWeight=0;
 for(const r of rows){
  total.opportunities+=r.opportunities;total.passed+=r.passed;total.kept+=r.kept;total.pending+=r.pending;total.quoted+=r.quoted;total.quotedValue=cents(total.quotedValue+r.quotedValue);total.invoiced+=r.invoiced;total.invoicedValue=cents(total.invoicedValue+r.invoicedValue);
  for(const [g,n] of Object.entries(r.byGroup))total.byGroup[g]=(total.byGroup[g]||0)+n;
  for(const s of r.bySource){const found=total.bySource.find(x=>x.group===s.group&&x.source===s.source);if(found)found.count+=s.count;else total.bySource.push({...s});}
  for(const k of salesCategories){total.sales[k].value=cents(total.sales[k].value+r.sales[k].value);total.sales[k].invoices+=r.sales[k].invoices;}
  total.recovered+=r.recovered;total.rolesDone+=r.rolesDone;total.rolesWaiting+=r.rolesWaiting;total.rolesLate+=r.rolesLate;
  if(r.averageDays!==null){dayWeight+=r.averageDays*r.daysCases;total.daysCases+=r.daysCases;}
 }
 total.bySource.sort((a,b)=>b.count-a.count||a.source.localeCompare(b.source));
 total.averageDays=total.daysCases?Math.round(dayWeight/total.daysCases*10)/10:null;
 return total;
}
/** Who reads «أداء خدمة العملاء»: the administrator, the sales manager, the customer-service manager, and a customer-service member for themselves. */
export const performanceAllowed=(role:string)=>role==='admin'||role==='manager'||role==='customer_service_manager'||role==='customer_service';
export const performanceTitle='أداء خدمة العملاء';
export const performanceNote='للمتابعة فقط: لا مستهدف لخدمة العملاء ولا نسبة إنجاز حتى تُجرَّب طريقة العمل. مبيعات خدمة العملاء بالكامل لا تدخل في تحقيق مستهدفات الشركة والفروع والموظفين ولا في التقييم.';
export const performanceNoteEn='For follow-up only: no customer-service target or achievement percentage until the way of working is tested. Full customer-service sales are left out of the company, branch and employee target achievement and of the evaluation.';
/** The columns of the dashboard and its Excel sheet «الملخص», in order. */
export const performanceColumns:readonly {key:string;ar:string;en:string;value:(r:PerformanceRow)=>number|string}[]=[
 {key:'opportunities',ar:'الفرص المسجلة',en:'Opportunities registered',value:r=>r.opportunities},
 {key:'passed',ar:'مُررت للمبيعات',en:'Passed to sales',value:r=>r.passed},
 {key:'kept',ar:'تولتها خدمة العملاء',en:'Kept by customer service',value:r=>r.kept},
 {key:'pending',ar:'بانتظار القرار',en:'Awaiting decision',value:r=>r.pending},
 {key:'quoted',ar:'تحولت إلى عرض سعر',en:'Turned into a quotation',value:r=>r.quoted},
 {key:'quotedValue',ar:'قيمة العروض',en:'Quotation value',value:r=>r.quotedValue},
 {key:'invoiced',ar:'تحولت إلى فاتورة',en:'Turned into an invoice',value:r=>r.invoiced},
 {key:'invoicedValue',ar:'قيمة الفواتير',en:'Invoice value',value:r=>r.invoicedValue},
 {key:'full',ar:'مبيعات بالكامل',en:'Full customer-service sales',value:r=>r.sales.full.value},
 {key:'fullInvoices',ar:'مبيعات بالكامل (فواتير)',en:'Full customer-service sales (invoices)',value:r=>r.sales.full.invoices},
 {key:'shared',ar:'مبيعات بالمشاركة',en:'Shared sales',value:r=>r.sales.shared.value},
 {key:'sharedInvoices',ar:'مبيعات بالمشاركة (فواتير)',en:'Shared sales (invoices)',value:r=>r.sales.shared.invoices},
 {key:'support',ar:'مبيعات بالمساندة',en:'Support-assisted sales',value:r=>r.sales.support.value},
 {key:'supportInvoices',ar:'مبيعات بالمساندة (فواتير)',en:'Support-assisted sales (invoices)',value:r=>r.sales.support.invoices},
 {key:'recovered',ar:'عملاء عادوا للشراء',en:'Customers who came back to buy',value:r=>r.recovered},
 {key:'averageDays',ar:'متوسط الأيام من الفرصة إلى الفاتورة',en:'Average days from opportunity to invoice',value:r=>r.averageDays===null?'—':r.averageDays},
 {key:'rolesDone',ar:'أدوار مسجلة',en:'Roles recorded',value:r=>r.rolesDone},
 {key:'rolesWaiting',ar:'أدوار بانتظار التسجيل',en:'Roles awaiting',value:r=>r.rolesWaiting},
 {key:'rolesLate',ar:'أدوار متأخرة',en:'Roles late',value:r=>r.rolesLate}
];

// ---- «مصادر الفرص»
export const LEAD_LIST_LIMIT=300;
export const leadListLabels={lost:'فرص مفقودة للاسترداد',dormant:'عملاء منقطعون عن الشراء 90 يومًا'} as const;
export const leadListLabelsEn={lost:'Lost opportunities to win back',dormant:'Customers who have not bought for 90 days'} as const;
export type LeadList=keyof typeof leadListLabels;
export const LEAD_SECTION_TITLE='مصادر الفرص';
/** Who reads «مصادر الفرص» (customer service and the administrator) and who starts an opportunity from it (customer service). */
export const leadReader=(role:string)=>role==='admin'||role==='customer_service'||role==='customer_service_manager';
export const leadStarter=(role:string)=>role==='customer_service'||role==='customer_service_manager';

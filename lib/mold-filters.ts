// The filters of «طلبات القوالب» (the owner, 2026-11-17, with a picture of the products application's orders list: «ضيف الفلاتر دى فى
// طلبات القوالب ماعدا المصدر لان المصدر عندك واحد»): «الحالة»، «واقف عند»، «المندوب»، «من تاريخ» / «إلى تاريخ» and a wide «بحث», over
// the list the page already holds (nothing more is asked of the server), with AND between them and with «أعادتها المالية». Pure: the page
// (app/mold-requests.tsx) and its tests share it, and the card's own words come from here too, so a filter's option reads as the card does.
// - «الحالة»: what a card says of the request, each a choice of its own: not in production yet, why it waits in the CRM (its small line:
//   a file, the customer's signature, waiting to be sent, refused, the link off), returned by finance, production's status (received,
//   approvals complete, in production, produced, delivered), cancelled in production, cancelled; and «المفتوحة (لم تُسلَّم)» as the products
//   application has it. A request may answer to more than one (a request production holds may still have a change waiting to be sent).
// - «واقف عند»: where production says it waits (waitingStep: the sales manager, production, finance, manufacturing, delivery), the
//   manufacturing stage it has reached (the first of the seven not done, as the request's sheet marks it), and «بانتظار اعتمادك» for a
//   sales manager who may approve it. Delivered and cancelled are states, not steps: «الحالة» has them.
// - «المندوب»: whoever asked for it (memberId), offered only when the reader's list holds more than one.
// - «من تاريخ» / «إلى تاريخ»: the day it was asked for (requestedAt) in Riyadh, both days included; a range typed the wrong way round is
//   turned round.
// - «بحث»: every word in one of the customer's name, its ERP code and Yourrest code, the requester, the description, the mold number, the
//   serial and the production order number, compared as the customers' search compares (normalizeMapSearch: letter forms, marks, Arabic
//   and Persian digits).
// The choices offered are those the list holds (in a fixed order), and the one chosen even when a refresh left none of it.
// Since 2026-11-19 the list also holds the requests that exist only in the products application (MoldOrderView: entered there, or from the
// old workbook), read-only, so every filter counts them, and «المصدر» is offered (the owner had left it out only because the CRM was the
// one source): «الـCRM»، «تطبيق المنتجات»، «الشيت القديم», when the list holds more than one. «المندوب» names such a request by the CRM
// member production names as its salesman, else by production's salesman name (moldMemberKey).
import {MOLD_RETURNED_TEXT,MOLD_STAGES,MOLD_STAGE_NAMES,moldHeldTexts,moldSendingNames,moldStatusNames,moldWaitingNames,type MoldOrderSource,type MoldOrderView,type MoldRemote,type MoldRequestView,type MoldSendingHeld,type MoldSendingState,type MoldStatusName,type MoldWaitingStep} from './mold-requests';
import {normalizeMapSearch} from './customer-map-search';
import {riyadhDate} from './visits';
import {calendarDay} from './daily-target';

type Pair=[string,string];
/** What the reader chose ('' for all); returned: «أعادتها المالية» pressed. from and to as typed (YYYY-MM-DD). source (2026-11-19): crm,
 *  manual or legacy. */
export type MoldFilters={status:string;step:string;member:string;from:string;to:string;query:string;returned:boolean;source:string};
export const MOLD_NO_FILTERS:MoldFilters={status:'',step:'',member:'',from:'',to:'',query:'',returned:false,source:''};
/** One entry of «كل الطلبات» as the filters read it: a CRM request (MoldRequestView, no source) or one that exists only in the products
 *  application (MoldOrderView, its source). */
export type MoldListEntry=Pick<MoldRequestView,'memberId'|'memberName'|'customerName'|'customerErpCode'|'crmNumber'|'requestedAt'|'specs'|'returned'>&{
 cancelled:boolean;remote:MoldRemote|null;sending:Pick<MoldRequestView['sending'],'state'|'held'>;can:Pick<MoldRequestView['can'],'approve'>;source?:MoldOrderSource};
/** Where an entry comes from: the CRM, or (2026-11-19) the products application (manual) or the old workbook (legacy). */
export type MoldSourceKey='crm'|MoldOrderSource;
export const MOLD_SOURCE_KEYS:MoldSourceKey[]=['crm','manual','legacy'];
export const moldSourceKey=(entry:Pick<MoldListEntry,'source'>):MoldSourceKey=>entry.source==='manual'||entry.source==='legacy'?entry.source:'crm';
/** «المصدر»'s choices, in the words of the cards' source marks. */
export const MOLD_SOURCE_NAMES:Record<MoldSourceKey,Pair>={crm:['الـCRM','The CRM'],manual:['تطبيق المنتجات','The products application'],legacy:['الشيت القديم','The old workbook']};
/** Whom «المندوب» names an entry by: its requester (a CRM request always has one), else (a request of the products application whose
 *  salesman the CRM does not know) production's salesman by name; '' for none. */
export const moldMemberKey=(entry:Pick<MoldListEntry,'memberId'|'memberName'>)=>entry.memberId||(entry.memberName.trim()?'name:'+entry.memberName.trim():'');
/** «كل الطلبات»: the CRM's requests in their order, with the products application's (newest asked for first, as production lists them)
 *  placed among them by the day they were asked for; neither list's own order changes. An entry whose time cannot be read goes last. */
export function moldMergeOrders<A extends MoldListEntry,B extends MoldListEntry>(requests:readonly A[],orders:readonly B[]):(A|B)[]{
 const time=(entry:MoldListEntry)=>{const value=Date.parse(entry.requestedAt);return Number.isFinite(value)?value:-Infinity;};
 const out:(A|B)[]=[];let i=0,j=0;
 while(i<requests.length||j<orders.length){
  if(j>=orders.length||i<requests.length&&time(requests[i])>=time(orders[j]))out.push(requests[i++]);else out.push(orders[j++]);
 }
 return out;
}
/** Whether an entry is a request that exists only in the products application. */
export const isMoldOrder=(entry:MoldRequestView|MoldOrderView):entry is MoldOrderView=>'source' in entry&&(entry.source==='manual'||entry.source==='legacy');

/** The panel's words. */
export const MOLD_FILTER_TEXT={
 panel:['تصفية طلبات القوالب','Filter mold requests'] as Pair,
 status:['الحالة','Status'] as Pair,allStatuses:['كل الحالات','All statuses'] as Pair,open:['المفتوحة (لم تُسلَّم)','Open (not delivered)'] as Pair,
 step:['واقف عند','Waiting at'] as Pair,allSteps:['كل المراحل','All stages'] as Pair,
 member:['المندوب','Sales rep'] as Pair,allMembers:['كل المندوبين','All sales reps'] as Pair,
 source:['المصدر','Source'] as Pair,allSources:['كل المصادر','All sources'] as Pair,
 from:['من تاريخ','From date'] as Pair,to:['إلى تاريخ','To date'] as Pair,
 search:['بحث','Search'] as Pair,placeholder:['عميل، مندوب، وصف، سريال، رقم أمر...','Customer, rep, description, serial, order number...'] as Pair,
 clear:['مسح الفلاتر','Clear filters'] as Pair};
/** «يظهر 3 من 10»: how many of the list the filters leave. */
export const moldFilterCount=(shown:number,total:number,say:(ar:string,en:string)=>string)=>say('يظهر '+shown+' من '+total,'Showing '+shown+' of '+total);

/** A card's words beyond production's own names (its chip). */
export const MOLD_CARD_STATUS_TEXT={approve:['بانتظار اعتمادك','Waiting for your approval'] as Pair,cancelled:['ملغى','Cancelled'] as Pair,
 productionCancelled:['أُلغي في تطبيق الإنتاج','Cancelled in production'] as Pair,local:['لم يصل للإنتاج بعد','Not in production yet'] as Pair};
/** A card's chip: where the request is (since the approval chain, the step it waits at), else production's status; the sales manager
 *  reads «waiting for you» on what they may approve. Cancelled in the CRM reads «cancelled» at once, even while the cancellation still
 *  waits to reach production (its sending line says so). */
export function moldCardStatus(view:Pick<MoldListEntry,'can'|'cancelled'|'remote'>):Pair{
 const remote=view.remote;
 return view.can.approve?MOLD_CARD_STATUS_TEXT.approve:view.cancelled?MOLD_CARD_STATUS_TEXT.cancelled:remote?.status==='cancelled'?MOLD_CARD_STATUS_TEXT.productionCancelled
  :remote?.waitingStep?moldWaitingNames[remote.waitingStep]:remote?moldStatusNames[remote.status]:MOLD_CARD_STATUS_TEXT.local;
}

/** What a card's small line says while the request's own data waits in the CRM (sending.state other than sent): why it is kept (a file,
 *  the customer's signature, a customer production cannot take yet), else its state, which reads «the link is off» while it is; null once
 *  sent. */
export type MoldSendingKey=MoldSendingHeld|Exclude<MoldSendingState,'sent'>;
export function moldSendingKey(sending:Pick<MoldRequestView['sending'],'state'|'held'>,linkReady:boolean):MoldSendingKey|null{
 if(sending.state==='sent')return null;
 if(sending.held&&Object.hasOwn(moldHeldTexts,sending.held))return sending.held;
 return linkReady?sending.state:'off';
}
export const moldSendingLabel=(key:MoldSendingKey):Pair=>Object.hasOwn(moldHeldTexts,key)?moldHeldTexts[key as MoldSendingHeld].name:moldSendingNames[key as MoldSendingState];

const HELD_ORDER:MoldSendingHeld[]=['quote_file','design_file','customer_signature','free_customer'];
const SENDING_ORDER:Exclude<MoldSendingState,'sent'>[]=['waiting','rejected','held','off'];
const PRODUCTION_ORDER:Exclude<MoldStatusName,'cancelled'>[]=['received','confirmed','in_production','produced','delivered'];
/** Every choice of «الحالة», in the order offered. */
export const MOLD_STATUS_FILTERS:string[]=['open','local',...HELD_ORDER.map(key=>'sending:'+key),...SENDING_ORDER.map(key=>'sending:'+key),'returned',...PRODUCTION_ORDER.map(key=>'status:'+key),'production_cancelled','cancelled'];
/** The steps of «واقف عند» (the products application's pipeline): delivered and cancelled are states. */
export const MOLD_FILTER_STEPS:MoldWaitingStep[]=['sales','production','admin','manufacturing','delivery'];
/** Every choice of «واقف عند», in the order offered: the stages under manufacturing. */
export const MOLD_STEP_FILTERS:string[]=['approve',...MOLD_FILTER_STEPS.flatMap(step=>step==='manufacturing'?['step:'+step,...MOLD_STAGES.map(stage=>'stage:'+stage)]:['step:'+step])];

const delivered=(remote:MoldRemote|null)=>!!remote&&(remote.delivered||remote.status==='delivered'||remote.waitingStep==='done');
/** The choices of «الحالة» a request answers to. */
export function moldStatusKeys(view:Pick<MoldListEntry,'cancelled'|'remote'|'returned'|'sending'>,linkReady:boolean):string[]{
 const remote=view.remote,keys:string[]=[];
 if(!view.cancelled&&remote?.status!=='cancelled'&&!delivered(remote))keys.push('open');
 keys.push(view.cancelled?'cancelled':remote?.status==='cancelled'?'production_cancelled':remote?'status:'+remote.status:'local');
 const sending=moldSendingKey(view.sending,linkReady);
 if(sending)keys.push('sending:'+sending);
 if(view.returned)keys.push('returned');
 return keys;
}
/** The manufacturing stage a request has reached: the first of the seven not done (the request's sheet marks it so); none once all are. */
export const moldCurrentStage=(remote:Pick<MoldRemote,'stages'>):string|null=>MOLD_STAGES.find(key=>!remote.stages?.[key]?.done)||null;
/** The choices of «واقف عند» a request answers to: none once cancelled, delivered or not yet held by production. */
export function moldStepKeys(view:Pick<MoldListEntry,'can'|'cancelled'|'remote'>):string[]{
 const remote=view.remote,keys:string[]=view.can.approve?['approve']:[];
 if(view.cancelled||!remote||remote.status==='cancelled')return keys;
 const step=remote.waitingStep;
 if(!step||!MOLD_FILTER_STEPS.includes(step))return keys;
 keys.push('step:'+step);
 const stage=step==='manufacturing'?moldCurrentStage(remote):null;
 if(stage)keys.push('stage:'+stage);
 return keys;
}
/** A choice of «الحالة» in the card's words; null for one this page does not know. */
export function moldStatusLabel(key:string):Pair|null{
 if(key==='open')return MOLD_FILTER_TEXT.open;
 if(key==='local')return MOLD_CARD_STATUS_TEXT.local;
 if(key==='returned')return MOLD_RETURNED_TEXT.badge;
 if(key==='cancelled')return MOLD_CARD_STATUS_TEXT.cancelled;
 if(key==='production_cancelled')return MOLD_CARD_STATUS_TEXT.productionCancelled;
 const [kind,value]=key.split(':');
 if(kind==='sending'&&([...HELD_ORDER,...SENDING_ORDER] as string[]).includes(value))return moldSendingLabel(value as MoldSendingKey);
 if(kind==='status'&&(PRODUCTION_ORDER as string[]).includes(value))return moldStatusNames[value as MoldStatusName];
 return null;
}
/** A choice of «واقف عند» in the card's words (a stage as «في التصنيع · <stage>»); null for one this page does not know. */
export function moldStepLabel(key:string):Pair|null{
 if(key==='approve')return MOLD_CARD_STATUS_TEXT.approve;
 const [kind,value]=key.split(':');
 if(kind==='step'&&(MOLD_FILTER_STEPS as string[]).includes(value))return moldWaitingNames[value as MoldWaitingStep];
 if(kind==='stage'&&(MOLD_STAGES as string[]).includes(value)){
  const name=MOLD_STAGE_NAMES[value as keyof typeof MOLD_STAGE_NAMES],manufacturing=moldWaitingNames.manufacturing;
  return [manufacturing[0]+' · '+name,manufacturing[1]+' · '+name];
 }
 return null;
}

/** The Riyadh day a request was asked for ('' for a time that cannot be read). */
export const moldRequestDay=(view:Pick<MoldRequestView,'requestedAt'>)=>Number.isFinite(Date.parse(view.requestedAt))?riyadhDate(view.requestedAt):'';
/** The days as typed, each a real day or '' (Arabic and Persian digits read), the earlier first. */
export function moldDateRange(from:string,to:string):{from:string;to:string}{
 const first=calendarDay(from),last=calendarDay(to);
 return first&&last&&first>last?{from:last,to:first}:{from:first,to:last};
}
/** The words a request is found by, each normalized as the customers' search normalizes. */
export function moldSearchFields(view:Pick<MoldListEntry,'customerName'|'customerErpCode'|'crmNumber'|'memberName'|'specs'|'remote'>):string[]{
 const yourrest=typeof view.crmNumber==='number'?'YR-C-'+String(view.crmNumber).padStart(6,'0'):'';
 return [view.customerName,view.customerErpCode,yourrest,view.memberName,view.specs?.description,view.specs?.moldNo,view.remote?.moldSerial,typeof view.remote?.orderNo==='number'?String(view.remote.orderNo):'']
  .map(text=>normalizeMapSearch(typeof text==='string'?text:'')).filter(Boolean);
}
/** Whether every word typed is in one of the request's words (nothing typed: every request). */
export function moldSearchMatches(view:Parameters<typeof moldSearchFields>[0],query:string){
 const terms=normalizeMapSearch(query||'').split(' ').filter(Boolean);
 if(!terms.length)return true;
 const fields=moldSearchFields(view);
 return terms.every(term=>fields.some(field=>field.includes(term)));
}

/** The requests the filters leave, in the list's order. Give it the filters moldFilterChoices answers (a choice the page no longer offers
 *  left out). */
export function filterMoldRequests<T extends MoldListEntry>(views:readonly T[],filters:MoldFilters,linkReady:boolean):T[]{
 const {from,to}=moldDateRange(filters.from,filters.to);
 return views.filter(view=>{
  if(filters.returned&&!view.returned)return false;
  if(filters.source&&moldSourceKey(view)!==filters.source)return false;
  if(filters.status&&!moldStatusKeys(view,linkReady).includes(filters.status))return false;
  if(filters.step&&!moldStepKeys(view).includes(filters.step))return false;
  if(filters.member&&moldMemberKey(view)!==filters.member)return false;
  if(from||to){const day=moldRequestDay(view);if(!day||from&&day<from||to&&day>to)return false;}
  return moldSearchMatches(view,filters.query);
 });
}

export type MoldFilterOption={key:string;label:Pair};
/** What the panel offers for this list, and the filters in force: a status or step this page does not know, a requester no longer in the
 *  list (or one alone in it: the select is not shown), a source the list does not hold (or one alone in it, 2026-11-19) and «أعادتها
 *  المالية» with nothing returned are left out; the days are read and put in order. active: how many filters are set («مسح الفلاتر» shows
 *  from one). */
export function moldFilterChoices(views:readonly MoldListEntry[],linkReady:boolean,filters:MoldFilters):{statuses:MoldFilterOption[];steps:MoldFilterOption[];members:{id:string;name:string}[];sources:MoldFilterOption[];filters:MoldFilters;active:number}{
 const statusKeys=new Set(views.flatMap(view=>moldStatusKeys(view,linkReady))),stepKeys=new Set(views.flatMap(view=>moldStepKeys(view)));
 const offered=(order:string[],present:Set<string>,chosen:string,label:(key:string)=>Pair|null)=>order.filter(key=>present.has(key)||key===chosen).flatMap(key=>{const text=label(key);return text?[{key,label:text}]:[];});
 const statuses=offered(MOLD_STATUS_FILTERS,statusKeys,filters.status,moldStatusLabel),steps=offered(MOLD_STEP_FILTERS,stepKeys,filters.step,moldStepLabel);
 const byId=new Map<string,string>();
 for(const view of views){const key=moldMemberKey(view);if(key&&!byId.has(key))byId.set(key,view.memberName||view.memberId);}
 const members=[...byId].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'ar')||a.id.localeCompare(b.id));
 const sourceKeys=new Set(views.map(view=>moldSourceKey(view))),sources=MOLD_SOURCE_KEYS.filter(key=>sourceKeys.has(key)).map(key=>({key,label:MOLD_SOURCE_NAMES[key]}));
 const {from,to}=moldDateRange(filters.from,filters.to);
 const effective:MoldFilters={
  status:statuses.some(option=>option.key===filters.status)?filters.status:'',
  step:steps.some(option=>option.key===filters.step)?filters.step:'',
  member:members.length>1&&byId.has(filters.member)?filters.member:'',
  from,to,query:filters.query||'',returned:!!filters.returned&&views.some(view=>!!view.returned),
  source:sources.length>1&&sources.some(option=>option.key===filters.source)?filters.source:''};
 const active=[effective.status,effective.step,effective.member,effective.from,effective.to,effective.query.trim(),effective.source].filter(Boolean).length+(effective.returned?1:0);
 return {statuses,steps,members,sources,filters:effective,active};
}

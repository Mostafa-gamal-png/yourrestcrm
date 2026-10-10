import type {Member,Row} from './crm';
import {recordAuthorId} from './access';
import {visitOrder} from './customer-visits';
import {riyadhDate} from './visits';
import {customerRegionScope,regionLabel} from './regions';

export type CompetitorObservation={
 id:string;activity:Row;customer:Row;authorId:string;authorName:string;
 order:string;date:string;products:string[];stage:string;
};
export type CompetitorEntry={
 key:string;name:string;contacts:CompetitorObservation[];customerCount:number;
 contactCount:number;quoteCount:number;lastDate:string;lastOrder:string;
};
export type CompetitorScope={region?:string;from?:string;through?:string};
export type CompetitorCustomerSummary={customer:Row;contacts:CompetitorObservation[];contactCount:number;quoteCount:number;lastDate:string;lastOrder:string;latestNote:CompetitorObservation|null};
export type CompetitorQuoteSummary={fileId:string;fileName:string;contacts:CompetitorObservation[];customers:Row[];lastDate:string;lastOrder:string};
export type CompetitorRegionSummary={key:string;region:string;customerCount:number;contactCount:number;percentage:number};
export type CompetitorProductSummary={product:string;customerCount:number;contactCount:number};
export type CompetitorProfile={entry:CompetitorEntry;customers:CompetitorCustomerSummary[];quotes:CompetitorQuoteSummary[];notes:CompetitorObservation[];regions:CompetitorRegionSummary[];products:CompetitorProductSummary[];aliases:string[];coverage:{customerCount:number;observedCustomerCount:number;percentage:number|null}};

/** Spelling normalization only: suffixes, punctuation and words stay distinct. */
export function normalizeCompetitorName(value:string){
 return value.normalize('NFKD').replace(/\p{M}/gu,'').replace(/\u0640/g,'')
  .replace(/[أإآ]/g,'ا').toLowerCase().replace(/\s+/gu,' ').trim();
}
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
// Attachment identifiers are opaque; never normalize an endpoint lookup key.
const opaqueFileId=(value:unknown)=>typeof value==='string'&&value.trim()?value:'';
const percentage=(part:number,total:number)=>Math.round(part/total*10000)/100;
const latestFirst=(a:CompetitorObservation,b:CompetitorObservation)=>b.order.localeCompare(a.order)||a.id.localeCompare(b.id);
function summarizeCompetitor(key:string,contacts:CompetitorObservation[]):CompetitorEntry{
 const ordered=[...new Map(contacts.map(contact=>[contact.id,contact])).values()].sort(latestFirst),latest=ordered[0];
 return{key,name:text(latest.activity.data.competitorName),contacts:ordered,customerCount:new Set(ordered.map(contact=>contact.customer.id)).size,contactCount:ordered.length,quoteCount:new Set(ordered.map(contact=>opaqueFileId(contact.activity.data.competitorFileId)).filter(Boolean)).size,lastDate:latest.date,lastOrder:latest.order};
}

/** Project only the server-authorized CRM records passed by the caller.
 * This is not an authorization boundary and must never be passed c.all.
 * Files remain opaque IDs; their existing endpoint rechecks access on download.
 */
export function buildCompetitors(records:Row[],members:Member[]):CompetitorEntry[]{
 const indexed=new Map<string,Row>(),names=new Map(members.map(member=>[member.id,member.name]));
 for(const record of records)if(!indexed.has(record.id))indexed.set(record.id,record);
 const customerOf=(record:Row)=>{
  let current:Row|undefined=record;const seen=new Set<string>();
  while(current&&!seen.has(current.id)){
   seen.add(current.id);
   if(current.kind==='customer')return current.data?._readOnly?undefined:current;
   current=current.parentId?indexed.get(current.parentId):undefined;
  }
  return undefined;
 };
 const grouped=new Map<string,CompetitorObservation[]>();
 for(const activity of indexed.values()){
  if(activity.kind!=='activity'||activity.data?._readOnly||activity.data?.hasCompetitor!==true)continue;
  const name=text(activity.data.competitorName),key=normalizeCompetitorName(name);
  if(!key)continue;
  const customer=customerOf(activity);if(!customer)continue;
  const authorId=recordAuthorId(activity,members)||'';
  // Historic imported dates may be missing; never let them break the workspace.
  const createdAt=Number.isFinite(Date.parse(activity.createdAt))?activity.createdAt:'0001-01-01T00:00:00.000Z';
  const order=visitOrder({...activity,createdAt});
  const time=order.split('|')[0],date=time.startsWith('0001-')||time.startsWith('0000-')?'':riyadhDate(time);
  const contact:CompetitorObservation={id:activity.id,activity,customer,authorId,authorName:names.get(authorId)||'',order,date,
   products:Array.isArray(activity.data.requestedProducts)?activity.data.requestedProducts.filter((value:unknown):value is string=>typeof value==='string'&&!!value.trim()):[],
   stage:text(activity.data.salesStage)};
  const contacts=grouped.get(key)||[];contacts.push(contact);grouped.set(key,contacts);
 }
 return [...grouped].map(([key,contacts])=>summarizeCompetitor(key,contacts)).sort((a,b)=>b.lastOrder.localeCompare(a.lastOrder)||a.key.localeCompare(b.key));
}

/** A matching customer/contact opens the full authorized competitor history. */
export function filterCompetitors(entries:CompetitorEntry[],query:string){
 const terms=normalizeCompetitorName(query).split(' ').filter(Boolean);if(!terms.length)return entries;
 return entries.filter(entry=>{
  const values=[entry.name,...entry.contacts.flatMap(contact=>[contact.activity.data.competitorName,contact.customer.data.name,
   contact.customer.data.code,contact.customer.data.city,contact.customer.data.region,contact.authorName,contact.activity.data.competitorNotes,contact.activity.data.competitorFileName,...contact.products])];
  const haystack=normalizeCompetitorName(values.filter(value=>typeof value==='string').join(' '));
  return terms.every(term=>haystack.includes(term));
 });
}

/** Region/date filtering applies to observations before counts or coverage are derived.
 * Text search intentionally remains separate so it cannot change the coverage denominator.
 */
export function scopeCompetitors(entries:CompetitorEntry[],scope:CompetitorScope={}){
 const region=text(scope.region),from=text(scope.from),through=text(scope.through);
 return entries.flatMap(entry=>{
  const contacts=entry.contacts.filter(contact=>(!region||region==='all'||customerRegionScope(contact.customer.data.region)===region)&&
   (!(from||through)||!!contact.date)&&(!from||contact.date>=from)&&(!through||contact.date<=through));
  return contacts.length?[summarizeCompetitor(entry.key,contacts)]:[];
 }).sort((a,b)=>b.lastOrder.localeCompare(a.lastOrder)||a.key.localeCompare(b.key));
}
export function competitorRegions(entries:CompetitorEntry[]){
 return [...new Set(entries.flatMap(entry=>entry.contacts.map(contact=>customerRegionScope(contact.customer.data.region))))]
  .map(key=>({key,region:regionLabel(key)})).sort((a,b)=>a.key==='unassigned'?1:b.key==='unassigned'?-1:a.region.localeCompare(b.region,'ar'));
}

/** Consolidated evidence from authorized observations only. Coverage is observed
 * customer presence within the supplied region/date scope, never market share.
 * Pass the full scoped entries as universe, BEFORE applying free-text search.
 */
export function buildCompetitorProfile(entry:CompetitorEntry,universe:CompetitorEntry[]):CompetitorProfile{
 const contacts=[...new Map(entry.contacts.map(contact=>[contact.id,contact])).values()].sort(latestFirst),byCustomer=new Map<string,CompetitorObservation[]>(),byFile=new Map<string,CompetitorObservation[]>(),byProduct=new Map<string,CompetitorObservation[]>();
 for(const contact of contacts){
  const customerContacts=byCustomer.get(contact.customer.id)||[];customerContacts.push(contact);byCustomer.set(contact.customer.id,customerContacts);
  const fileId=opaqueFileId(contact.activity.data.competitorFileId);if(fileId){const fileContacts=byFile.get(fileId)||[];fileContacts.push(contact);byFile.set(fileId,fileContacts);}
  for(const product of new Set(contact.products.map(text).filter(Boolean))){const productContacts=byProduct.get(product)||[];productContacts.push(contact);byProduct.set(product,productContacts);}
 }
 const customers:CompetitorCustomerSummary[]=[...byCustomer.values()].map(list=>({customer:list[0].customer,contacts:list,contactCount:list.length,quoteCount:new Set(list.map(contact=>opaqueFileId(contact.activity.data.competitorFileId)).filter(Boolean)).size,lastDate:list[0].date,lastOrder:list[0].order,latestNote:list.find(contact=>!!text(contact.activity.data.competitorNotes))||null}));
 const quotes:CompetitorQuoteSummary[]=[...byFile].map(([fileId,list])=>({fileId,fileName:list.map(contact=>text(contact.activity.data.competitorFileName)).find(Boolean)||'',contacts:list,customers:[...new Map(list.map(contact=>[contact.customer.id,contact.customer])).values()],lastDate:list[0].date,lastOrder:list[0].order}));
 const regionGroups=new Map<string,{customerCount:number;contactCount:number}>();
 for(const customer of customers){const key=customerRegionScope(customer.customer.data.region),group=regionGroups.get(key)||{customerCount:0,contactCount:0};group.customerCount++;group.contactCount+=customer.contactCount;regionGroups.set(key,group);}
 const regions:CompetitorRegionSummary[]=[...regionGroups].map(([key,group])=>({key,region:regionLabel(key),...group,percentage:percentage(group.customerCount,customers.length)})).sort((a,b)=>b.customerCount-a.customerCount||a.region.localeCompare(b.region,'ar'));
 const products:CompetitorProductSummary[]=[...byProduct].map(([product,list])=>({product,customerCount:new Set(list.map(contact=>contact.customer.id)).size,contactCount:list.length})).sort((a,b)=>b.customerCount-a.customerCount||b.contactCount-a.contactCount||a.product.localeCompare(b.product,'ar'));
 const observedCustomerIds=new Set(universe.flatMap(competitor=>competitor.contacts.map(contact=>contact.customer.id)));
 // A mismatched scope cannot produce a misleading percentage above 100%.
 const inSameScope=customers.every(customer=>observedCustomerIds.has(customer.customer.id));
 return{entry,customers,quotes,notes:contacts.filter(contact=>!!text(contact.activity.data.competitorNotes)),regions,products,aliases:[...new Set(contacts.map(contact=>text(contact.activity.data.competitorName)).filter(Boolean))],coverage:{customerCount:customers.length,observedCustomerCount:observedCustomerIds.size,percentage:observedCustomerIds.size&&inSameScope?percentage(customers.length,observedCustomerIds.size):null}};
}

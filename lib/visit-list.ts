import {type Row} from './crm';
import {visitOrder} from './customer-visits';
import {matchesServiceFilter} from './customer-service';
/** Shared by the visit table and CSV so search, status and order stay identical. */
const customerIndex=(records:Row[])=>{const indexed=new Map<string,Row>();for(const row of records)if(!indexed.has(row.id))indexed.set(row.id,row);return indexed;};
const customerFinder=(indexed:Map<string,Row>)=>(row:Row|undefined)=>{for(let i=0;row&&i<5;i++){if(row.kind==='customer')return row;row=row.parentId!==null&&row.parentId!==undefined?indexed.get(row.parentId):undefined;}return undefined;};
const isVisit=(r:Row)=>r.kind==='activity'&&r.data.visitWorkflow!=='followup-v1'&&r.data.visitWorkflow!=='service-intake-v1';
/**
 * The quotations that were lost afterwards (the owner, 2026-11-07: the «عرض سعر» filter shows the same visits plus the
 * quotations lost later, marked «مفقودة»). Per customer, in contact order: a visit at «عرض سعر» is lost when the first
 * closing contact after it (a visit or a follow-up at «تم الفوز» or «تم الفقد») is «تم الفقد»; a visit at «تم الفقد» is a
 * lost quotation when a quotation (a visit or follow-up at «عرض سعر», a quotation contact, or a quotation record) came
 * after the customer's previous closing contact.
 */
export function lostQuoteVisitIds(records:Row[]){
 const customerOf=customerFinder(customerIndex(records)),byCustomer=new Map<string,{row:Row;order:string}[]>();
 for(const row of records){if(!(row.kind==='quote'||row.kind==='activity'&&row.data.visitWorkflow!=='service-intake-v1'))continue;const customer=customerOf(row);if(!customer)continue;const list=byCustomer.get(customer.id)||[];list.push({row,order:visitOrder(row)});byCustomer.set(customer.id,list);}
 const lost=new Set<string>();
 for(const list of byCustomer.values()){
  list.sort((a,b)=>a.order.localeCompare(b.order));
  let quoted:string[]=[],hadQuote=false;
  for(const {row} of list){
   const stage=row.kind==='activity'?String(row.data.salesStage||''):'';
   if(stage==='lost'){if(hadQuote){for(const id of quoted)lost.add(id);if(isVisit(row))lost.add(row.id);}quoted=[];hadQuote=false;continue;}
   if(stage==='won'){quoted=[];hadQuote=false;continue;}
   if(row.kind==='quote'||row.data.type==='quote'||stage==='quoted'){hadQuote=true;if(stage==='quoted'&&isVisit(row))quoted.push(row.id);}
  }
 }
 return lost;
}
export function filterVisitRows(records:Row[],{query='',staff='all',stage='all',workflow='all',lostQuotes:known}:{query?:string;staff?:string;stage?:string;workflow?:string;lostQuotes?:Set<string>}){
 const term=query.trim().toLowerCase();
 // The customer of each visit, found through one index instead of a scan of every record per visit.
 const customerOf=customerFinder(term?customerIndex(records):new Map());
 // «عرض سعر» also brings the quotations lost afterwards.
 const lostQuotes=stage==='quoted'?known||lostQuoteVisitIds(records):undefined;
 const rows=records.filter(r=>r.kind==='activity'&&r.data.visitWorkflow!=='followup-v1'&&matchesServiceFilter(r,workflow)&&(staff==='all'||(r.data.performedBy||r.data.responsibleId)===staff)&&(stage==='all'||r.data.salesStage===stage||!!lostQuotes?.has(r.id))&&(!term||[customerOf(r)?.data.name,r.data.summary,r.data.result,r.data.customerNeeds,r.data.competitorName,r.data.visitNumber,...(r.data.requestedProducts||[])].join(' ').toLowerCase().includes(term)));
 // Each visit's order key once, not twice per comparison; the stable sort keeps the same order.
 const keyed=rows.map(row=>({row,order:visitOrder(row)}));
 return keyed.sort((a,b)=>b.order.localeCompare(a.order)).map(item=>item.row);
}

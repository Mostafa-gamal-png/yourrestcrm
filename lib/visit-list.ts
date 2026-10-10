import {type Row} from './crm';
import {visitCustomer,visitOrder} from './customer-visits';
import {matchesServiceFilter} from './customer-service';
/** Shared by the visit table and CSV so search, status and order stay identical. */
export function filterVisitRows(records:Row[],{query='',staff='all',stage='all',workflow='all'}:{query?:string;staff?:string;stage?:string;workflow?:string}){
 const term=query.trim().toLowerCase();
 return records.filter(r=>r.kind==='activity'&&r.data.visitWorkflow!=='followup-v1'&&matchesServiceFilter(r,workflow)&&(staff==='all'||(r.data.performedBy||r.data.responsibleId)===staff)&&(stage==='all'||r.data.salesStage===stage)&&(!term||[visitCustomer(r,records)?.data.name,r.data.summary,r.data.result,r.data.customerNeeds,r.data.competitorName,r.data.visitNumber,...(r.data.requestedProducts||[])].join(' ').toLowerCase().includes(term))).sort((a,b)=>visitOrder(b).localeCompare(visitOrder(a)));
}

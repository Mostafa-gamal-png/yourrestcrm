import {type Row} from './crm';
import {visitOrder} from './customer-visits';
import {matchesServiceFilter} from './customer-service';
/** Shared by the visit table and CSV so search, status and order stay identical. */
export function filterVisitRows(records:Row[],{query='',staff='all',stage='all',workflow='all'}:{query?:string;staff?:string;stage?:string;workflow?:string}){
 const term=query.trim().toLowerCase();
 // The customer of each visit, found through one index instead of a scan of every record per visit.
 const indexed=new Map<string,Row>();if(term)for(const row of records)if(!indexed.has(row.id))indexed.set(row.id,row);
 const customerOf=(row:Row|undefined)=>{for(let i=0;row&&i<5;i++){if(row.kind==='customer')return row;row=row.parentId!==null&&row.parentId!==undefined?indexed.get(row.parentId):undefined;}return undefined;};
 const rows=records.filter(r=>r.kind==='activity'&&r.data.visitWorkflow!=='followup-v1'&&matchesServiceFilter(r,workflow)&&(staff==='all'||(r.data.performedBy||r.data.responsibleId)===staff)&&(stage==='all'||r.data.salesStage===stage)&&(!term||[customerOf(r)?.data.name,r.data.summary,r.data.result,r.data.customerNeeds,r.data.competitorName,r.data.visitNumber,...(r.data.requestedProducts||[])].join(' ').toLowerCase().includes(term)));
 // Each visit's order key once, not twice per comparison; the stable sort keeps the same order.
 const keyed=rows.map(row=>({row,order:visitOrder(row)}));
 return keyed.sort((a,b)=>b.order.localeCompare(a.order)).map(item=>item.row);
}

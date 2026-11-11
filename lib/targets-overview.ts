// «تحقيق المستهدف — الشركة والفروع» (the owner's picture of 2026-11-11): one gauge for the company and one for each branch, for the
// month only (the representative picked below it changes nothing here). Pure, from the snapshot the page already has (/api/sales).
// - A branch's target, product by product, is the sum of its people's own targets in the month (the people of the distribution table:
//   app/targets-workspace.tsx allBranchMembers), unless a target of the branch itself is saved («الفرع بالكامل»), which then wins.
//   A product nobody of the branch has a target for stays «غير محدد».
// - The company's target is the sum of the branches.
// - Achieved is the confirmed sales of the same people in the month (CRM and ERP; ERP «مبيعات مكتب» is never imported), returns deducted.
// - The gauge is the weighted achievement of the targets (lib/targets.ts quantityAttainment: each product capped at 100%, weighted by
//   the company weights, a product of target zero left out), so a branch reads like a person.
import {effectiveSet,quantityAttainment,type QuantityTargets,type TargetSet,type TargetState} from './targets';
import {type Member} from './crm';
import {type Sale} from './sales';

export type OverviewScope={id:string;name:string;kind:'company'|'branch';source:'people'|'saved'|'branches';peopleIds:string[];attainment:ReturnType<typeof quantityAttainment>};
type Person=Pick<Member,'id'|'role'|'branch'|'active'>&{readOnly?:boolean};
const round=(n:number)=>Math.round(n*1_000_000)/1_000_000;
/** The people whose own targets make a branch's target (and whose sales its achievement): the distribution table's people. */
export function branchPeople(state:TargetState,members:Person[],branch:string,hidden:string[]=[]):Person[]{
 const hiddenIds=new Set(hidden),retained=new Set(state.sets.filter(s=>s.kind==='sales'&&s.computed).flatMap(s=>s.teamMemberIds||[]));
 return members.filter(m=>{const source=effectiveSet(state,'sales',m.id);return !m.readOnly&&!hiddenIds.has(m.id)&&m.branch===branch&&!source?.computed&&(!!m.active||source?.month===state.month||retained.has(m.id));});
}
const sumProducts=(lists:(QuantityTargets['products']|undefined)[],products:string[])=>products.map(product=>{
 const values=lists.map(list=>list?.find(row=>row.product===product)?.quantity).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
 return {product,quantity:values.length?round(values.reduce((n,v)=>n+v,0)):null};
});
function scoped(state:TargetState,id:string,products:QuantityTargets['products'],peopleIds:string[],sales:Sale[]){
 const weights=state.sets.filter(s=>s.kind==='weights'&&s.scopeId==='company');
 const own:TargetSet<QuantityTargets>={kind:'sales',scopeId:id,month:state.month,data:{products},version:0,updatedAt:'',computed:true,teamMemberIds:peopleIds};
 // Sales recorded or imported for the month are the whole record of it: a product nobody sold is a real zero, never unknown.
 return quantityAttainment(id,{...state,sets:[...weights,own]},sales,true);
}
export function targetsOverview(state:TargetState,members:Person[],sales:Sale[],hidden:string[]=[],products:string[]):{company:OverviewScope;branches:OverviewScope[]}{
 const confirmed=sales.filter(s=>s.status==='confirmed'&&String(s.date).startsWith(state.month));
 const branches=state.branches.map(branch=>{
  const people=branchPeople(state,members,branch,hidden),ids=people.map(m=>m.id),saved=effectiveSet<QuantityTargets>(state,'sales','branch:'+branch);
  const own=saved&&!saved.computed?saved.data.products:sumProducts(people.map(m=>effectiveSet<QuantityTargets>(state,'sales',m.id)?.data.products),products);
  return {branch,ids,source:(saved&&!saved.computed?'saved':'people') as OverviewScope['source'],products:products.map(product=>own.find(row=>row.product===product)||{product,quantity:null})};
 }).filter(b=>b.ids.length||b.source==='saved');
 const branchScopes:OverviewScope[]=branches.map(b=>({id:'branch:'+b.branch,name:b.branch,kind:'branch',source:b.source,peopleIds:b.ids,attainment:scoped(state,'branch:'+b.branch,b.products,b.ids,confirmed)}));
 const allIds=[...new Set(branches.flatMap(b=>b.ids))],companyProducts=sumProducts(branches.map(b=>b.products),products);
 return {company:{id:'company',name:'',kind:'company',source:'branches',peopleIds:allIds,attainment:scoped(state,'company',companyProducts,allIds,confirmed)},branches:branchScopes};
}

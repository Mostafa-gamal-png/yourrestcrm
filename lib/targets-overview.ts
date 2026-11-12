// «تحقيق المستهدف» (the owner's picture of 2026-11-11): one gauge for the company and, when the company has two branches or more, one for
// each branch, for the month only (the representative picked below it changes nothing here). Pure, from the snapshot the page already has
// (/api/sales).
// - The people of a branch are the people of the distribution table (app/targets-workspace.tsx allBranchMembers): its representatives
//   (and an administrator the month does not leave out); a manager's or a supervisor's computed team roll-up is never one of them.
// - Achieved is the confirmed sales of those people in the month (CRM and ERP; ERP «مبيعات مكتب» is never imported), returns deducted.
// - The gauge is the weighted achievement of the targets (lib/targets.ts quantityAttainment: each product capped at 100%, weighted by
//   the company weights, a product of target zero left out), so the company reads like a person.
// Two branches or more (as before 2026-11-12): a branch's target, product by product, is the sum of its people's own targets in the month,
//   unless a target of the branch itself is saved («الفرع بالكامل»), which then wins; a product nobody of the branch has a target for stays
//   «غير محدد». The company's target is the sum of the branches.
// One branch (the owner, 2026-11-12: «مفيش فروع للشركة», every member is in «الرئيسي»): ONE gauge, the company's. Its target is the sum of
//   the people's own targets (the rules of the representative cards: each person's effective target, carried forward like theirs). A target
//   saved for the branch itself counts only when it is complete (a number for every product of a non-zero weight): an incomplete one left in
//   «المستهدفات والأوزان» blanked the gauge («لم يكتمل المستهدف») and is now ignored and named. The gauge is blank only for what is really
//   missing, and says what: the people who sell (active, or with a confirmed sale this month) without a target, and the weighted products a
//   targeted person has no number for (the person's own card is blank for the same reason); «تفاصيل الفئات» says for how many people each
//   product is set.
import {effectiveSet,productWeightsSchema,quantityAttainment,type QuantityTargets,type TargetSet,type TargetState} from './targets';
import {type Member} from './crm';
import {type Sale} from './sales';

/** What keeps a gauge blank, for its one line: people who sell without a target this month, products without a number (in the order of
 *  the products), and no people at all. Empty when nothing is missing. */
export type OverviewMissing={people:number;products:string[];noPeople:boolean};
export type OverviewScope={id:string;name:string;kind:'company'|'branch';source:'people'|'saved'|'branches';peopleIds:string[];attainment:ReturnType<typeof quantityAttainment>;
 missing:OverviewMissing;
 /** The month the saved «الفرع بالكامل» target used here is effective from (source 'saved'). */
 savedMonth?:string|null;
 /** A saved «الفرع بالكامل» target left out because it misses products (one branch only): the month it is effective from. */
 ignoredSaved?:string|null;
 /** One branch, from the people: for each product, how many of the counted people have a number for it. */
 coverage?:Record<string,{set:number;of:number}>};
export type TargetsOverview={company:OverviewScope;branches:OverviewScope[];single:boolean};
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
const quantityOf=(list:QuantityTargets['products']|undefined,product:string)=>{const value=list?.find(row=>row.product===product)?.quantity;return typeof value==='number'&&Number.isFinite(value)?value:null;};
function scoped(state:TargetState,id:string,products:QuantityTargets['products'],peopleIds:string[],sales:Sale[]){
 const weights=state.sets.filter(s=>s.kind==='weights'&&s.scopeId==='company');
 const own:TargetSet<QuantityTargets>={kind:'sales',scopeId:id,month:state.month,data:{products},version:0,updatedAt:'',computed:true,teamMemberIds:peopleIds};
 // Sales recorded or imported for the month are the whole record of it: a product nobody sold is a real zero, never unknown.
 return quantityAttainment(id,{...state,sets:[...weights,own]},sales,true);
}
/** The products a gauge needs a number for: those of a non-zero company weight (every product while the weights are not set). */
function weightedProducts(state:TargetState,products:string[]){
 const weights=effectiveSet(state,'weights','company'),valid=weights?productWeightsSchema.safeParse(weights.data):null;
 return valid?.success?products.filter(product=>valid.data.products.find(row=>row.product===product)?.weight!==0):products;
}
/** The weighted products a gauge has no target for (its rows), for the line under a blank gauge. */
const unsetProducts=(attainment:OverviewScope['attainment'])=>attainment.rows.filter(row=>row.weight!==0&&row.target===null).map(row=>row.id);
const nothingMissing=(attainment:OverviewScope['attainment']):OverviewMissing=>({people:0,products:attainment.status==='missing_inputs'?unsetProducts(attainment):[],noPeople:false});

/** The company with one branch (or none): see the head of the file. */
function singleBranch(state:TargetState,branch:string|undefined,people:Person[],confirmed:Sale[],products:string[]):OverviewScope{
 const ids=people.map(m=>m.id),weighted=weightedProducts(state,products);
 const saved=branch===undefined?undefined:effectiveSet<QuantityTargets>(state,'sales','branch:'+branch),own=saved&&!saved.computed?saved:undefined;
 if(own&&weighted.every(product=>quantityOf(own.data.products,product)!==null)){
  const attainment=scoped(state,'company',products.map(product=>({product,quantity:quantityOf(own.data.products,product)})),ids,confirmed);
  return {id:'company',name:'',kind:'company',source:'saved',savedMonth:own.month,peopleIds:ids,attainment,missing:nothingMissing(attainment)};
 }
 const sold=new Set(confirmed.map(s=>s.repId));// achieved reads the people's sales only (scoped: teamMemberIds)
 const targets=new Map(people.map(m=>[m.id,effectiveSet<QuantityTargets>(state,'sales',m.id)?.data.products]));
 const targeted=people.filter(m=>targets.get(m.id)?.some(row=>typeof row.quantity==='number'&&Number.isFinite(row.quantity)));
 // A person without any number this month is missing when they sell: active, or with a confirmed sale this month (their sales count).
 const without=people.filter(m=>!targeted.includes(m)&&(!!m.active||sold.has(m.id)));
 const gaps=weighted.filter(product=>targeted.some(m=>quantityOf(targets.get(m.id),product)===null));
 const of=targeted.length+without.length,coverage=Object.fromEntries(products.map(product=>[product,{set:targeted.filter(m=>quantityOf(targets.get(m.id),product)!==null).length,of}]));
 const computed=scoped(state,'company',sumProducts(targeted.map(m=>targets.get(m.id)),products),ids,confirmed);
 const incomplete=!!without.length||!!gaps.length||!people.length;
 // A product set for only some of the people: its own percentage would compare part of the target with everybody's sales.
 const attainment=incomplete?{...computed,score:null,status:computed.status==='weights_missing'?computed.status:'missing_inputs' as const,rows:computed.rows.map(row=>coverage[row.id].set<coverage[row.id].of?{...row,achievement:null,contribution:null}:row)}:computed;
 return {id:'company',name:'',kind:'company',source:'people',ignoredSaved:own?own.month:null,peopleIds:ids,attainment,coverage,missing:{people:without.length,products:incomplete?gaps:[],noPeople:!people.length}};
}

export function targetsOverview(state:TargetState,members:Person[],sales:Sale[],hidden:string[]=[],products:string[]):TargetsOverview{
 const confirmed=sales.filter(s=>s.status==='confirmed'&&String(s.date).startsWith(state.month));
 const staffed=state.branches.map(branch=>({branch,people:branchPeople(state,members,branch,hidden)})).filter(b=>b.people.length);
 if(staffed.length<=1){
  const only=staffed[0];
  return {company:singleBranch(state,only?.branch,only?.people||[],confirmed,products),branches:[],single:true};
 }
 const branches=state.branches.map(branch=>{
  const people=branchPeople(state,members,branch,hidden),ids=people.map(m=>m.id),saved=effectiveSet<QuantityTargets>(state,'sales','branch:'+branch);
  const own=saved&&!saved.computed?saved.data.products:sumProducts(people.map(m=>effectiveSet<QuantityTargets>(state,'sales',m.id)?.data.products),products);
  return {branch,ids,source:(saved&&!saved.computed?'saved':'people') as OverviewScope['source'],savedMonth:saved&&!saved.computed?saved.month:null,products:products.map(product=>own.find(row=>row.product===product)||{product,quantity:null})};
 }).filter(b=>b.ids.length||b.source==='saved');
 const branchScopes:OverviewScope[]=branches.map(b=>{const attainment=scoped(state,'branch:'+b.branch,b.products,b.ids,confirmed);return {id:'branch:'+b.branch,name:b.branch,kind:'branch',source:b.source,savedMonth:b.savedMonth,peopleIds:b.ids,attainment,missing:nothingMissing(attainment)};});
 const allIds=[...new Set(branches.flatMap(b=>b.ids))],companyProducts=sumProducts(branches.map(b=>b.products),products);
 const company=scoped(state,'company',companyProducts,allIds,confirmed);
 return {company:{id:'company',name:'',kind:'company',source:'branches',peopleIds:allIds,attainment:company,missing:nothingMissing(company)},branches:branchScopes,single:false};
}

/** Arabic counted noun (MSA agreement): 1 «مندوب واحد», 2 «مندوبان», 3–10 «3 مناديب», 11+ «11 مندوبًا». */
export const repsCount=(n:number)=>n===1?'مندوب واحد':n===2?'مندوبان':n<=10?n+' مناديب':n+' مندوبًا';
const productsCount=(n:number)=>n<=10?n+' أصناف':n+' صنفًا';

/** The one line under a blank gauge: exactly what is missing (people without a target, products without one), else the status. */
export function missingLine(missing:OverviewMissing,status:string,language:'ar'|'en',productName:(id:string)=>string):string{
 const say=(ar:string,en:string)=>language==='en'?en:ar;
 if(status==='weights_missing')return say('لم تُحدد أوزان الأصناف','No product weights set');
 if(status==='not_applicable')return say('لا ينطبق','Not applicable');
 if(missing.noPeople)return say('لا يوجد مندوبون في هذا الشهر','No representatives this month');
 const parts:string[]=[];
 if(missing.people)parts.push(say(repsCount(missing.people)+' بلا مستهدف لهذا الشهر',missing.people+(missing.people===1?' representative':' representatives')+' without a target this month'));
 const names=missing.products.map(productName),n=names.length;
 if(n===1)parts.push(say('لم يُحدَّد مستهدف لصنف: '+names[0],'No target set for: '+names[0]));
 else if(n===2)parts.push(say('لم يُحدَّد مستهدف لصنفين: '+names.join('، '),'No target set for: '+names.join(', ')));
 else if(n>2)parts.push(say('لم يُحدَّد مستهدف لـ '+productsCount(n)+' (انظر «تفاصيل الفئات»)','No target set for '+n+' products (see Category details)'));
 return parts.length?parts.join(say('؛ ','; ')):say('لم يكتمل المستهدف','Target incomplete');
}

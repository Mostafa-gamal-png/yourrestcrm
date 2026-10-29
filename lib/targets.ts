import {z} from 'zod';
import {salesProducts,monthSchema,type Sale} from './sales';
import {type Member} from './crm';
export const targetProducts=salesProducts.map(name=>({id:name,name,unit:name==='خدمات صيانة'?'خدمة':name.startsWith('قوالب')?'قالب':name.startsWith('قطع')?'قطعة':'ماكينة'}));
const quantityFormat=new Intl.NumberFormat('en-US',{maximumFractionDigits:6});
export const quantityNumber=(v:number)=>quantityFormat.format(v);
export const activityFields=[['newCustomers','العملاء الجدد'],['recoveredCustomers','العملاء المستردون'],['visits','الزيارات الفعلية']] as const;
export type ActivityTargets={newCustomers:number;recoveredCustomers:number;visits:number};
export const defaultActivityTargets:ActivityTargets={newCustomers:10,recoveredCustomers:5,visits:320};
const count=z.number().int().min(1).max(1000000);
const product=z.string().refine(p=>salesProducts.includes(p),'اختر صنفًا صحيحًا');
const catalog=(rows:{product:string}[])=>rows.length===salesProducts.length&&new Set(rows.map(r=>r.product)).size===salesProducts.length;
export const quantityTargetsSchema=z.object({products:z.array(z.object({product,quantity:z.number().finite().min(0).max(1000000000).refine(n=>Math.abs(n*1000000-Math.round(n*1000000))<0.0001,'الكمية تقبل حتى 6 منازل عشرية').nullable()})).refine(catalog,'حدد مستهدف كل صنف مرة واحدة')});
export const productWeightsSchema=z.object({products:z.array(z.object({product,weight:z.number().finite().min(0).max(100).refine(n=>Math.abs(n*100-Math.round(n*100))<1e-7)})).refine(catalog,'حدد وزن كل صنف مرة واحدة')}).refine(d=>d.products.reduce((n,p)=>n+Math.round(p.weight*100),0)===10000,'مجموع أوزان الأصناف يجب أن يساوي 100%');
export const activityTargetsSchema=z.object({newCustomers:count,recoveredCustomers:count,visits:count});
export type QuantityTargets=z.infer<typeof quantityTargetsSchema>;
export type ProductWeights=z.infer<typeof productWeightsSchema>;
export type TargetKind='sales'|'activity'|'weights';
export type TargetSet<T=any>={kind:TargetKind;scopeId:string;month:string;data:T;version:number;updatedAt:string;computed?:boolean;incomplete?:boolean;teamMemberIds?:string[]};
export type TargetState={month:string;sets:TargetSet[];branches:string[]};
export const targetSaveSchema=z.object({kind:z.enum(['sales','activity','weights']),scopeId:z.string().min(1).max(300),month:monthSchema,version:z.number().int().min(0),inheritedFrom:z.object({month:monthSchema,version:z.number().int().positive()}).nullable(),requestId:z.string().uuid(),data:z.unknown()}).superRefine((d,c)=>{if(d.inheritedFrom&&(d.version!==0||d.inheritedFrom.month>=d.month))c.addIssue({code:'custom',message:'مصدر المستهدف غير صحيح'});});
export function effectiveSet<T=any>(state:TargetState,kind:TargetKind,scopeId:string):TargetSet<T>|undefined{return state.sets.filter(s=>s.kind===kind&&s.scopeId===scopeId&&s.month<=state.month).sort((a,b)=>b.month.localeCompare(a.month))[0];}
export function targetSaveBase(state:TargetState,kind:TargetKind,scopeId:string){const source=effectiveSet(state,kind,scopeId);return{kind,scopeId,month:state.month,version:source?.month===state.month?source.version:0,inheritedFrom:source&&source.month<state.month?{month:source.month,version:source.version}:null};}
/** Follow explicit reporting links; a manager's visibility does not define their team. */
export function managerTeam(manager:Member,members:Member[],includeInactive:Set<string>=new Set()){
 if(!['manager','supervisor'].includes(manager.role))return[];
 const visited=new Set([manager.id]),queue=[manager.id],team:Member[]=[];
 while(queue.length){const parent=queue.shift()!;for(const child of members){if(child.supervisorId!==parent||visited.has(child.id)||!['manager','supervisor','rep'].includes(child.role)||manager.role==='supervisor'&&(parent!==manager.id||child.role!=='rep'))continue;visited.add(child.id);if(['manager','supervisor'].includes(child.role))queue.push(child.id);if((child.active||includeInactive.has(child.id))&&child.role!=='manager')team.push(child);}}
 return team;
}
export function withManagerTargets(state:TargetState,members:Member[],recordedMemberIds:string[]=[],eligibleIds?:Set<string>):TargetState{
 const includeInactive=new Set([...recordedMemberIds,...state.sets.filter(s=>s.month===state.month&&s.kind!=='weights').map(s=>s.scopeId)]);
 const leaders=members.filter(m=>['manager','supervisor'].includes(m.role));
 const sets=state.sets.filter(s=>!leaders.some(m=>m.id===s.scopeId&&(s.kind==='sales'||m.role==='manager'&&s.kind==='activity')));
 for(const leader of leaders){
  const activityTeam=managerTeam(leader,members,includeInactive).filter(m=>!eligibleIds||eligibleIds.has(m.id)||recordedMemberIds.includes(m.id)),salesTeam=activityTeam.filter(m=>m.role==='rep'),teamMemberIds=salesTeam.map(m=>m.id);
  const products=targetProducts.map(p=>{const quantities=salesTeam.map(m=>effectiveSet<QuantityTargets>(state,'sales',m.id)?.data.products.find(r=>r.product===p.id)?.quantity??null);return{product:p.id,quantity:!quantities.length||quantities.some(q=>q===null)?null:Math.round(quantities.reduce<number>((n,q)=>n+q!,0)*1000000)/1000000};});
  const base={scopeId:leader.id,month:state.month,version:0,updatedAt:'',computed:true,teamMemberIds};
  sets.push({...base,kind:'sales',data:{products}});
  if(leader.role==='manager'){
   const activity=activityTeam.reduce((n,m)=>{const d=effectiveSet<ActivityTargets>(state,'activity',m.id)?.data||defaultActivityTargets;return{newCustomers:n.newCustomers+d.newCustomers,recoveredCustomers:n.recoveredCustomers+d.recoveredCustomers,visits:n.visits+d.visits};},{newCustomers:0,recoveredCustomers:0,visits:0});
   const incomplete=!!eligibleIds&&activityTeam.some(m=>!eligibleIds.has(m.id));sets.push({...base,teamMemberIds:activityTeam.map(m=>m.id),kind:'activity',data:incomplete?{newCustomers:0,recoveredCustomers:0,visits:0}:activity,incomplete});
  }
 }
 return{...state,sets};
}
export function quantityAttainment(memberId:string,state:TargetState,sales:Sale[],confirmedSales=false){
 const quantities=effectiveSet<QuantityTargets>(state,'sales',memberId),weights=effectiveSet<ProductWeights>(state,'weights','company');
 const valid=weights?productWeightsSchema.safeParse(weights.data):null;
 const sourceIds=new Set(quantities?.computed?quantities.teamMemberIds||[]:[memberId]);
 const invoices=sales.filter(s=>sourceIds.has(s.repId)&&s.status==='confirmed'&&s.date.startsWith(state.month));
 const rows=targetProducts.map(p=>{const items=invoices.flatMap(s=>s.items.filter(i=>i.product===p.id)),actual=items.length?Math.round(items.reduce((n,i)=>n+i.quantity,0)*1000000)/1000000:confirmedSales?0:null,target=quantities?.data.products.find(r=>r.product===p.id)?.quantity??null,weight=valid?.success?valid.data.products.find(r=>r.product===p.id)!.weight:null;return{...p,actual,target,weight,achievement:target&&target>0&&actual!==null?actual/target*100:null,contribution:weight===0||target===0?0:weight!==null&&target&&target>0&&actual!==null?Math.min(1,Math.max(0,actual/target))*weight:null};});
 const applicableWeight=valid?.success?rows.reduce((n,r)=>n+(r.target===0?0:r.weight||0),0):null;
 const ready=!!valid?.success&&rows.every(r=>r.contribution!==null),score=ready&&applicableWeight!==null&&applicableWeight>0?Math.round(rows.reduce((n,r)=>n+(r.contribution||0),0)/applicableWeight*10000)/100:null;
 return{rows,score,status:!valid?.success?'weights_missing':ready&&applicableWeight===0?'not_applicable':ready?'ready':'missing_inputs',weightsMonth:weights?.month||null,applicableWeight};
}

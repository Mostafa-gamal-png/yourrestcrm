import type {Member,Row} from './crm';
/** Sales territories in the supplied customer sheet, not administrative provinces. */
export const regionOptions=[['central','الوسطى'],['eastern','الشرقية'],['western','الغربية'],['northern','الشمالية'],['southern','الجنوبية'],['unassigned','المنطقة غير محددة']] as const;
export const regionScopes=['all',...regionOptions.map(([id])=>id)] as const;
export const regionScope=(member:Member)=>member.regionScope||'all';
export const regionLabel=(scope:string)=>scope==='all'?'كل المناطق':regionOptions.find(([id])=>id===scope)?.[1]||'المنطقة غير محددة';
export function customerRegionScope(value:unknown){const label=String(value||'').trim().replace(/^المنطقة\s+/,'');return regionOptions.find(([id,name])=>id===label||name===label)?.[0]||'unassigned';}
export const regionValue=(member:Member)=>regionScope(member)==='all'||regionScope(member)==='unassigned'?'':regionLabel(regionScope(member));
export const memberCanAccessRegion=(member:Member,value:unknown)=>regionScope(member)==='all'||regionScope(member)===customerRegionScope(value);
export const regionMembers=(members:Member[],me:Member)=>members.filter(m=>regionScope(me)==='all'||m.id===me.id||regionScope(m)===regionScope(me));
export function regionRecords(all:Row[],me:Member){
 if(regionScope(me)==='all')return all;
 const visible=new Set(all.filter(r=>r.kind==='customer'&&memberCanAccessRegion(me,r.data.region)).map(r=>r.id)),children=new Map<string,string[]>();
 for(const r of all)if(r.kind!=='customer'&&r.parentId){const list=children.get(r.parentId)||[];list.push(r.id);children.set(r.parentId,list);}
 const queue=[...visible];for(let n=0;n<queue.length;n++)for(const id of children.get(queue[n])||[])if(!visible.has(id)){visible.add(id);queue.push(id);}
 return all.filter(r=>visible.has(r.id));
}

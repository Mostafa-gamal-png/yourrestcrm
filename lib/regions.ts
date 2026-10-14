import type {Member,Row} from './crm';
/** Sales territories in the supplied customer sheet, not administrative provinces. */
export const regionOptions=[['central','الوسطى'],['eastern','الشرقية'],['western','الغربية'],['northern','الشمالية'],['southern','الجنوبية'],['unassigned','المنطقة غير محددة']] as const;
export const regionIds=regionOptions.map(([id])=>id) as unknown as readonly string[];
export const regionScopes=['all',...regionOptions.map(([id])=>id)] as const;
/** A member's stored scope: `all`, one region id, or several region ids joined by commas in the catalogue's order
 * (`central,eastern`). The stored text is what every commit guard compares, so it is always canonical. */
export const regionScope=(member:Member)=>member.regionScope||'all';
/** The region ids a scope grants; `all` and an unknown scope grant nothing by name (an unknown scope grants nothing at all). */
export function scopeRegions(scope:string):string[]{
 if(scope==='all')return [];
 return scope.split(',').map(part=>part.trim()).filter(part=>(regionIds as readonly string[]).includes(part));
}
/** The canonical scope for a choice: `all`, or the known region ids in the catalogue's order without repeats; empty when nothing known was chosen. */
export function canonicalRegionScope(value:unknown):string{
 if(value==='all')return 'all';
 const chosen=new Set((Array.isArray(value)?value:String(value||'').split(',')).map(item=>String(item).trim()));
 if(chosen.has('all'))return 'all';
 return regionIds.filter(id=>chosen.has(id)).join(',');
}
export const isRegionScope=(value:unknown)=>typeof value==='string'&&value.length>0&&canonicalRegionScope(value)===value;
export const regionLabel=(scope:string)=>scope==='all'?'كل المناطق':scopeRegions(scope).map(id=>regionOptions.find(([option])=>option===id)![1]).join('، ')||'المنطقة غير محددة';
/** The labels one by one, for a form or a cell that lists them. */
export const regionLabels=(scope:string)=>scope==='all'?['كل المناطق']:scopeRegions(scope).map(id=>regionOptions.find(([option])=>option===id)![1]);
export function customerRegionScope(value:unknown){const label=String(value||'').trim().replace(/^المنطقة\s+/,'');return regionOptions.find(([id,name])=>id===label||name===label)?.[0]||'unassigned';}
/** The region a new customer of this member is filled with: the member's only region, or nothing when they choose among several or see all. */
export const regionValue=(member:Member)=>{const regions=scopeRegions(regionScope(member));return regions.length===1&&regions[0]!=='unassigned'?regionLabel(regions[0]):'';};
export const memberCanAccessRegion=(member:Member,value:unknown)=>regionScope(member)==='all'||scopeRegions(regionScope(member)).includes(customerRegionScope(value));
/** Whether two scopes share a region, `all` sharing with every scope. */
export const regionScopesOverlap=(a:string,b:string)=>a==='all'||b==='all'||scopeRegions(a).some(id=>scopeRegions(b).includes(id));
export const regionMembers=(members:Member[],me:Member)=>members.filter(m=>regionScope(me)==='all'||m.id===me.id||regionScopesOverlap(regionScope(m),regionScope(me)));
/** SQL that admits a row whose `region_scope` column shares a region with the reader's scope; `all` on either side admits it. */
export function regionScopeSql(column:string,me:Member):{sql:string;args:string[]}{
 const regions=scopeRegions(regionScope(me));
 if(regionScope(me)==='all')return {sql:'1=1',args:[]};
 return {sql:'('+[column+"='all'",...regions.map(()=>"(','||"+column+"||',') LIKE ?")].join(' OR ')+')',args:regions.map(id=>'%,'+id+',%')};
}
export function regionRecords(all:Row[],me:Member){
 if(regionScope(me)==='all')return all;
 const visible=new Set(all.filter(r=>r.kind==='customer'&&memberCanAccessRegion(me,r.data.region)).map(r=>r.id)),children=new Map<string,string[]>();
 for(const r of all)if(r.kind!=='customer'&&r.parentId){const list=children.get(r.parentId)||[];list.push(r.id);children.set(r.parentId,list);}
 const queue=[...visible];for(let n=0;n<queue.length;n++)for(const id of children.get(queue[n])||[])if(!visible.has(id)){visible.add(id);queue.push(id);}
 return all.filter(r=>visible.has(r.id));
}

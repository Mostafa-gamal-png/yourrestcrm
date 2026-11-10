import {activityFields,defaultActivityTargets,targetProducts,type TargetKind} from './targets';

/** «سجل التعديلات» of a target (the owner, 2026-11-10): who changed it, when, for which month, and what changed, read from the rows
 *  crm_audit already holds for every save (id «target-set:<actor>:<request>», record «target-<scope>»). A save made from 2026-11-10 on
 *  also keeps what it replaced («before»); a row written before keeps only what was saved, so its earlier values are «تفاصيل غير متاحة». */
export const TARGET_HISTORY_PAGE=20;
export const TARGET_HISTORY_MAX_OFFSET=2000;
export type TargetHistoryChange={field:string;label:string;unit:string;before:number|null;after:number|null};
export type TargetHistoryEntry={id:string;at:string;actor:string;kind:TargetKind;month:string;closedMonth:boolean;
 /** false: a row saved before the earlier values were kept (show «تفاصيل غير متاحة» for them). */
 detailsAvailable:boolean;
 /** Where the replaced values came from: this month's own set, a set carried from an earlier month, or nothing (defaults / «غير محدد»). */
 beforeFrom:'saved'|'carried'|'none'|null;beforeMonth:string|null;changes:TargetHistoryChange[]};
export type TargetHistory={scopeId:string;entries:TargetHistoryEntry[];offset:number;more:boolean};
export type TargetAuditDetail={kind:TargetKind;scopeId:string;month:string;data:unknown;before?:{month:string|null;data:unknown}|null;closedMonth?:boolean};

const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
const productValue=(data:unknown,product:string,key:'quantity'|'weight')=>{const rows=(data as {products?:unknown})?.products;if(!Array.isArray(rows))return null;const row=rows.find(r=>(r as {product?:unknown})?.product===product) as Record<string,unknown>|undefined;return row?finite(row[key]):null;};

/** Every field a set of this kind has, in the page's order, with the value it holds (null: «غير محدد»). A missing activity set is the
 *  default targets the page shows (10 / 5 / 320). */
export function targetFields(kind:TargetKind,data:unknown|null):TargetHistoryChange[]{
 if(kind==='activity'){const values=(data??defaultActivityTargets) as Record<string,unknown>;return activityFields.map(([key,label])=>({field:key,label,unit:'',before:null,after:finite(values[key])}));}
 const key=kind==='sales'?'quantity':'weight';
 return targetProducts.map(p=>({field:p.id,label:p.name,unit:kind==='weights'?'%':p.unit,before:null,after:data==null?null:productValue(data,p.id,key)}));
}

/** One audit row as the history shows it. Only the fields that changed when the earlier values are known; every saved value otherwise. */
export function targetHistoryEntry(row:{id:string;actor:string;detail:string;created_at:string}):TargetHistoryEntry|null{
 let detail:TargetAuditDetail;
 try{detail=JSON.parse(row.detail) as TargetAuditDetail;}catch{return null;}
 if(!detail||!['sales','activity','weights'].includes(detail.kind)||typeof detail.month!=='string')return null;
 const after=targetFields(detail.kind,detail.data);
 const base={id:row.id,at:row.created_at,actor:row.actor,kind:detail.kind,month:detail.month,closedMonth:detail.closedMonth===true};
 if(detail.before===undefined)return{...base,detailsAvailable:false,beforeFrom:null,beforeMonth:null,changes:after};
 const beforeMonth=detail.before?.month??null,earlier=targetFields(detail.kind,detail.before?.data??null);
 const changes=after.map((field,i)=>({...field,before:earlier[i].after})).filter(field=>field.before!==field.after);
 return{...base,detailsAvailable:true,beforeFrom:!beforeMonth?'none':beforeMonth===detail.month?'saved':'carried',beforeMonth,changes};
}

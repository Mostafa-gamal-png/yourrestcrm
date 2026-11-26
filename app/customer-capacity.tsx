'use client';
// «الطاقة الإنتاجية والاحتياج» of a customer (lib/customer-capacity.ts, the owner, 2026-11-21): the compact block of five items on the
// customer's card, its desktop row and its sheet (each item only when it has a value), and the section of the customer's form where the
// three entered items are written. Who may save them, and when it is saved directly, is the server's decision (POST /api/crm).
import {t,useLanguage} from '@/lib/i18n';
import {useState,type ReactNode} from 'react';
import VoiceField from './voice-field';
import {CAPACITY_SECTION_TEXT,CAPACITY_TEXT,CAPACITY_TEXT_MAX,FROM_SHEET_TEXT,capacityItems,customerCapacity,shownMachines,type CapacityItemKey,type CustomerCapacity as Capacity} from '@/lib/customer-capacity';
import './customer-capacity.css';

type Data=Record<string,unknown>;
type MachineRow={kind:string;parentId:string|null;data:Data|null|undefined};
type Say=(ar:string,en:string)=>string;

function Value({item,capacity,say}:{item:CapacityItemKey;capacity:Capacity;say:Say}){
 const sheet=<small className="capacity-source">{' · '}{say(...FROM_SHEET_TEXT)}</small>;
 if(item==='machineCount')return <><bdi>{capacity.machines!.count.toLocaleString('en-US')}</bdi>{capacity.machines!.fromSheet&&sheet}</>;
 if(item==='machineTypes'){const types=capacity.types!;if('entered' in types)return <>{types.text}</>;if(types.fromSheet)return <>{t(types.text)}{sheet}</>;
  return <>{types.groups.map((group,index)=><span className="capacity-type" key={group.key} data-machine-type={group.key}>{index>0&&' · '}{group.kind==='brand'?<bdi>{group.label}</bdi>:t(group.label)}{' '}<bdi>×{group.count}</bdi></span>)}</>;}
 if(item==='moldsInUse')return <bdi>{capacity.moldsInUse!.toLocaleString('en-US')}</bdi>;
 return <>{item==='productionCapacity'?capacity.productionCapacity:capacity.annualDemand}</>;
}

/** The block: the items that have a value, or nothing at all. variant: 'card' (the phone's card), 'row' (the desktop table), 'sheet' (the
 *  customer's sheet, with its heading), 'form' (the computed machines, read only, in the form). sheetBeside: the place already shows the
 *  sheet's count and types (lib/customer-capacity.ts capacityItems). */
export function CustomerCapacity({customerId,data,machines,variant='card',sheetBeside=false,only}:{customerId:string;data:Data;machines:Iterable<MachineRow>;variant?:'card'|'row'|'sheet'|'form';sheetBeside?:boolean;only?:readonly CapacityItemKey[]}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const capacity=customerCapacity(customerId,machines,data),items=capacityItems(capacity,{sheetBeside,only});
 if(!items.length)return null;
 const list=<dl className={'customer-capacity customer-capacity-'+variant} data-customer-capacity={variant}>{items.map(item=><div key={item} data-capacity-item={item}><dt>{say(...CAPACITY_TEXT[item])}</dt><dd><Value item={item} capacity={capacity} say={say}/></dd></div>)}</dl>;
 return variant==='sheet'?<section className="customer-capacity-sheet" data-capacity-summary><h3>{say(...CAPACITY_SECTION_TEXT)}</h3>{list}</section>:list;
}

/** The fields of «الطاقة والاحتياج» in the customer's form (its section 5, app/crm-app.tsx): «عدد الماكينات» and «أنواع الماكينات» (since
 *  2026-11-26, for every customer: they start from what the card shows; untouched, the save sends what is stored, so nothing changes;
 *  touched, both are saved as typed and become what the card shows: lib/customer-capacity.ts markEnteredMachines), the three entered fields,
 *  each optional, then `children` (the form's own «مورد القوالب والقطع»). stored: the customer as saved (none for a new one). directNote: said
 *  when the reader's change of this section alone is saved directly (their own customer, as a representative or a marketing officer whose
 *  other corrections wait for approval). */
export function CustomerCapacityFields({customerId,data,stored,machines,disabled=false,contextKey,directNote=false,onChange,children}:{customerId?:string;data:Data;stored?:Data;machines:Iterable<MachineRow>;disabled?:boolean;contextKey:string;directNote?:boolean;onChange:(key:string,value:string|number|null)=>void;children?:ReactNode}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const text=(key:string)=>data[key]===null||data[key]===undefined?'':String(data[key]);
 const shown=shownMachines(customerCapacity(customerId||'',machines,stored||{}));
 const [touched,setTouched]=useState(false);
 const count=touched?text('machineCount'):shown.count===null?'':String(shown.count),types=touched?text('machineTypes'):shown.types;
 // The first change of either field writes both: the other keeps what the card showed instead of the stored sheet's value.
 const touch=(key:'machineCount'|'machineTypes',value:string)=>{
  if(!touched){setTouched(true);if(key!=='machineCount')onChange('machineCount',shown.count);if(key!=='machineTypes')onChange('machineTypes',shown.types);}
  // The count as a number when it is one (Arabic digits read as such); anything else is sent as typed and refused by the server's schema.
  const digits=value.replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-0x6F0)).trim();
  onChange(key,key==='machineCount'?(digits===''?null:/^\d+$/.test(digits)?Number(digits):value):value);
 };
 return <div className="capacity-fields full" data-capacity-editor>
  <div className="form-grid">
   <label className="field"><span>{say(...CAPACITY_TEXT.machineCount)}</span><input type="text" inputMode="numeric" dir="ltr" autoComplete="off" maxLength={6} disabled={disabled} value={count} placeholder="0" onChange={event=>touch('machineCount',event.target.value)} data-capacity-field="machineCount"/></label>
   <VoiceField label={say(...CAPACITY_TEXT.machineTypes)} value={types} onChange={value=>touch('machineTypes',value)} disabled={disabled} contextKey={contextKey+':machineTypes'} inputProps={{maxLength:CAPACITY_TEXT_MAX,placeholder:say('مثال: ثابتة ×2 · Besser ×1','e.g. stationary ×2 · Besser ×1')}}/>
   <label className="field"><span>{say(...CAPACITY_TEXT.moldsInUse)}</span><input type="text" inputMode="numeric" dir="ltr" autoComplete="off" maxLength={12} disabled={disabled} value={text('moldsInUse')} placeholder="0" onChange={event=>onChange('moldsInUse',event.target.value)} data-capacity-field="moldsInUse"/></label>
   <VoiceField label={say(...CAPACITY_TEXT.productionCapacity)} value={text('productionCapacity')} onChange={value=>onChange('productionCapacity',value)} disabled={disabled} contextKey={contextKey+':productionCapacity'} inputProps={{maxLength:CAPACITY_TEXT_MAX,placeholder:say('مثال: 5000 بلكة يوميًا','e.g. 5,000 blocks a day')}}/>
   <VoiceField label={say(...CAPACITY_TEXT.annualDemand)} value={text('annualDemand')} onChange={value=>onChange('annualDemand',value)} disabled={disabled} contextKey={contextKey+':annualDemand'} inputProps={{maxLength:CAPACITY_TEXT_MAX,placeholder:say('مثال: 40 قالبًا في السنة','e.g. 40 molds a year')}}/>
   {children}
  </div>
  <p className="form-note">{say('عدد الماكينات وأنواعها كما تكتبهما هنا يظهران على كارت العميل. إن لم تغيّرهما بقيا محسوبين من الماكينات المسجلة للعميل أو من الشيت، وإن مسحتهما عادا إلى ذلك.','The machine count and types as you write them here show on the customer’s card. Left unchanged, they stay computed from the customer’s registered machines or the sheet; cleared, they go back to that.')}</p>
  {directNote&&<p className="form-note capacity-direct-note" data-capacity-direct-note>{say('يُحفظ تحديث هذا القسم وحده مباشرةً لأنك مسؤول هذا العميل، دون انتظار الموافقة. وإذا عدّلت معه بيانات أخرى أُرسل التعديل كله للموافقة.','Updating this section alone is saved directly, without waiting for approval, because you are responsible for this customer. If you change other details with it, the whole edit is sent for approval.')}</p>}
 </div>;
}

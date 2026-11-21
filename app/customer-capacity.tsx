'use client';
// «الطاقة الإنتاجية والاحتياج» of a customer (lib/customer-capacity.ts, the owner, 2026-11-21): the compact block of five items on the
// customer's card, its desktop row and its sheet (each item only when it has a value), and the section of the customer's form where the
// three entered items are written. Who may save them, and when it is saved directly, is the server's decision (POST /api/crm).
import {t,useLanguage} from '@/lib/i18n';
import VoiceField from './voice-field';
import {CAPACITY_SECTION_TEXT,CAPACITY_TEXT,CAPACITY_TEXT_MAX,FROM_SHEET_TEXT,capacityItems,customerCapacity,type CapacityItemKey,type CustomerCapacity as Capacity} from '@/lib/customer-capacity';
import './customer-capacity.css';

type Data=Record<string,unknown>;
type MachineRow={kind:string;parentId:string|null;data:Data|null|undefined};
type Say=(ar:string,en:string)=>string;

function Value({item,capacity,say}:{item:CapacityItemKey;capacity:Capacity;say:Say}){
 const sheet=<small className="capacity-source">{' · '}{say(...FROM_SHEET_TEXT)}</small>;
 if(item==='machineCount')return <><bdi>{capacity.machines!.count.toLocaleString('en-US')}</bdi>{capacity.machines!.fromSheet&&sheet}</>;
 if(item==='machineTypes'){const types=capacity.types!;if(types.fromSheet)return <>{t(types.text)}{sheet}</>;
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

/** The section of the customer's form: the computed machines (read only, for a saved customer) and the three entered fields, each optional.
 *  directNote: said when the reader's change of these three alone is saved directly (their own customer, as a representative or a marketing
 *  officer whose other corrections wait for approval). */
export function CustomerCapacityFields({customerId,data,machines,disabled=false,contextKey,directNote=false,onChange}:{customerId?:string;data:Data;machines:Iterable<MachineRow>;disabled?:boolean;contextKey:string;directNote?:boolean;onChange:(key:string,value:string)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const text=(key:string)=>data[key]===null||data[key]===undefined?'':String(data[key]);
 return <section className="capacity-section full" data-capacity-editor><h3>{say(...CAPACITY_SECTION_TEXT)}</h3>
  {customerId&&<CustomerCapacity customerId={customerId} data={data} machines={machines} variant="form" only={['machineCount','machineTypes']}/>}
  <div className="form-grid">
   <label className="field"><span>{say(...CAPACITY_TEXT.moldsInUse)}</span><input type="text" inputMode="numeric" dir="ltr" autoComplete="off" maxLength={12} disabled={disabled} value={text('moldsInUse')} placeholder="0" onChange={event=>onChange('moldsInUse',event.target.value)} data-capacity-field="moldsInUse"/></label>
   <VoiceField label={say(...CAPACITY_TEXT.productionCapacity)} value={text('productionCapacity')} onChange={value=>onChange('productionCapacity',value)} disabled={disabled} contextKey={contextKey+':productionCapacity'} inputProps={{maxLength:CAPACITY_TEXT_MAX,placeholder:say('مثال: 5000 بلكة يوميًا','e.g. 5,000 blocks a day')}}/>
   <VoiceField label={say(...CAPACITY_TEXT.annualDemand)} value={text('annualDemand')} onChange={value=>onChange('annualDemand',value)} disabled={disabled} contextKey={contextKey+':annualDemand'} inputProps={{maxLength:CAPACITY_TEXT_MAX,placeholder:say('مثال: 40 قالبًا في السنة','e.g. 40 molds a year')}}/>
  </div>
  <p className="form-note">{say('كل ما في هذا القسم اختياري. يُحسب عدد الماكينات وأنواعها من الماكينات المسجلة للعميل.','Everything in this section is optional. The machine count and types are computed from the customer’s registered machines.')}</p>
  {directNote&&<p className="form-note capacity-direct-note" data-capacity-direct-note>{say('يُحفظ تحديث هذا القسم وحده مباشرةً لأنك مسؤول هذا العميل، دون انتظار الموافقة. وإذا عدّلت معه بيانات أخرى أُرسل التعديل كله للموافقة.','Updating this section alone is saved directly, without waiting for approval, because you are responsible for this customer. If you change other details with it, the whole edit is sent for approval.')}</p>}
 </section>;
}

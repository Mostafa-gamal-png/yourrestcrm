'use client';
// «اختيار موعد المتابعة» (GSCO 2.13.84, the owner through the GSCO session, 2026-11-19): the 14 days from tomorrow with the follow-ups the
// customer's representative already has each day, the weekly day off, full and scattered days, the follow-ups near this customer, the
// suggestion «الأنسب» and what the chosen day means; «تاريخ آخر» opens the date field as it was (its checks unchanged). Everything is
// worked out on the device from the records it already holds (lib/followup-day-picker.ts), so it works without a network.
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {t,useLanguage} from '@/lib/i18n';
import {type Member,type Row,today} from '@/lib/crm';
import {pickerView,pickerWords,viewDay,dayVerdict,weekdayShort,dayMonth,type PickerDay} from '@/lib/followup-day-picker';
import {FollowupDateField} from './visit-fields';
import './followup-date-picker.css';

type Props={
 value:string;onChange:(value:string)=>void;
 /** As FollowupDateField: the field's own checks, kept as they were. */
 min?:string;required?:boolean;problem?:string;id?:string;
 /** The heading («موعد المتابعة القادمة» unless the form calls it otherwise, already in the reader's language or translated by t). */
 label?:string;
 /** The records on the device (the page's own), the customer being visited, and who reads. */
 records:Row[];customerId?:string;me:Member;members?:Member[];
 /** false: the date field alone, as before (customer service, which does not see the representatives' follow-ups; a visit read only). */
 grid?:boolean;
};

export function FollowupDatePicker({value,onChange,min,required=true,problem='',id,label,records,customerId,me,members=[],grid=true}:Props){
 const {language}=useLanguage(),lang=language==='en'?'en':'ar',say=(ar:string,en:string)=>lang==='en'?en:ar;
 const own=useId(),fieldId=id||'followup-date-'+own.replace(/[^a-zA-Z0-9_-]/g,''),labelId=fieldId+'-picker-label';
 const day=today();
 const customer=customerId?records.find(row=>row.id===customerId&&row.kind==='customer'):undefined;
 // The customer's representative (the follow-ups page's «المندوب المسؤول»); before a customer is chosen, whoever records.
 const ownerId=customer?.assignedTo||me.id,ownerName=ownerId===me.id?'':members.find(member=>member.id===ownerId)?.name||say('المندوب المسؤول','the responsible representative');
 const view=useMemo(()=>grid?pickerView(records,{ownerId,customer,today:day}):null,[grid,records,ownerId,customer,day]);
 const [manualOpen,setManualOpen]=useState(false);
 const input=useRef<HTMLInputElement>(null),cells=useRef<HTMLDivElement>(null),focusOther=useRef(false);
 // «تاريخ آخر» opens the date field and puts the cursor in it.
 useEffect(()=>{if(manualOpen&&focusOther.current){focusOther.current=false;input.current?.focus();}},[manualOpen]);
 const field=(extra:{label?:string;marked?:boolean;shortcuts?:boolean}={})=><FollowupDateField id={fieldId} value={value} onChange={onChange} min={min} required={required} problem={problem} inputRef={input} {...(label&&extra.label===undefined?{label}:{})} {...extra}/>;
 if(!view)return field();
 const words=pickerWords(lang,ownerName,day),best=view.best,hasPin=!!view.here;
 const inGrid=view.days.some(item=>item.date===value),open=manualOpen||!inGrid||!!problem;
 const usable=(item:PickerDay)=>!min||item.date>=min;
 const tabbable=(inGrid?view.days.find(item=>item.date===value&&usable(item)):undefined)||view.days.find(usable);
 const chosen=viewDay(view,value),verdict=chosen?words.verdict(dayVerdict(chosen)):'';
 function choose(date:string){onChange(date);setManualOpen(false);}
 // A radio group: the arrows move to the next or the previous day and choose it (the reading direction decides which arrow is next),
 // Home and End the first and the last.
 function onKey(event:React.KeyboardEvent<HTMLDivElement>){
  const target=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-date]');if(!target)return;
  const list=view!.days.filter(usable),at=list.findIndex(item=>item.date===target.dataset.date);if(at<0)return;
  const rtl=getComputedStyle(event.currentTarget).direction==='rtl',key=event.key;
  const next=key==='ArrowDown'||key===(rtl?'ArrowLeft':'ArrowRight'),previous=key==='ArrowUp'||key===(rtl?'ArrowRight':'ArrowLeft');
  const index=key==='Home'?0:key==='End'?list.length-1:next?Math.min(list.length-1,at+1):previous?Math.max(0,at-1):-1;
  if(index<0)return;event.preventDefault();
  const date=list[index].date;choose(date);
  cells.current?.querySelector<HTMLButtonElement>('[data-date="'+date+'"]')?.focus();
 }
 const tag=(item:PickerDay)=>item.offDay?words.offTag:item.full?words.fullTag:item.scattered?words.scatteredTag:'';
 return <div className={'field full followup-date-picker'+(problem?' has-problem':'')} role="group" aria-labelledby={labelId} data-followup-picker>
  <span className="followup-picker-label" id={labelId}>{label?t(label):say('موعد المتابعة القادمة','Next follow-up date')}{required&&<> <b aria-hidden="true">*</b></>}</span>
  {best&&<div className="followup-picker-best" data-best-day={best.date}><p>{words.best(best)}</p><button type="button" className="btn subtle small" aria-pressed={value===best.date} onClick={()=>choose(best.date)}>{words.choose}</button></div>}
  <div className="followup-picker-cells"><div className="followup-picker-grid" role="radiogroup" aria-label={words.gridLabel} ref={cells} onKeyDown={onKey}>
   {view.days.map(item=>{const checked=value===item.date,label=tag(item);return <button key={item.date} type="button" role="radio" aria-checked={checked} tabIndex={tabbable?.date===item.date?0:-1} disabled={!usable(item)}
    className="followup-picker-day" data-date={item.date} data-off={item.offDay||undefined} data-full={item.full||undefined} data-scattered={item.scattered||undefined} data-near={item.near||undefined} data-best={best?.date===item.date||undefined}
    aria-label={words.dayLabel(item,best?.date===item.date)} onClick={()=>choose(item.date)}>
    <span className="followup-picker-weekday" aria-hidden="true">{weekdayShort(item.date,lang)}</span>
    <bdi className="followup-picker-date" dir="ltr" aria-hidden="true">{dayMonth(item.date)}</bdi>
    <span className="followup-picker-count" aria-hidden="true" data-count={item.count}>{item.count}</span>
    {label&&<span className="followup-picker-tag" aria-hidden="true">{label}</span>}
    {item.near>0&&<span className="followup-picker-near" aria-hidden="true">{words.nearTag(item.near)}</span>}
   </button>;})}
  </div></div>
  <p className="followup-picker-legend">{words.legend(hasPin)}</p>
  <div className="followup-picker-status" role="status" data-followup-status>
   <p className="followup-picker-chosen">{words.chosen(chosen?chosen.date:'')}</p>
   {chosen?.full&&<p className="followup-picker-warning" data-picker-full>{words.full(chosen.count)}</p>}
   {chosen?.offDay&&<p className="followup-picker-warning" data-picker-off>{words.off(chosen.date)}</p>}
   {verdict&&<p className="followup-picker-verdict" data-verdict={dayVerdict(chosen!).kind}>{verdict}</p>}
  </div>
  {open?field({label:words.otherDate,marked:false,shortcuts:false}):<button type="button" className="text-button followup-picker-other" aria-expanded="false" onClick={()=>{focusOther.current=true;setManualOpen(true);}}>{words.otherDate}</button>}
 </div>;
}

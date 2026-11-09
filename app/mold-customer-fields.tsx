'use client';
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {CheckCircle2} from 'lucide-react';
import type {Row} from '@/lib/crm';
import {customerCodeKey,customerErpCodes} from '@/lib/customer-identity';
import {yourrestNumber} from '@/lib/mold-requests';
import VoiceField from './voice-field';

type Say=(ar:string,en:string)=>string;
type Field='name'|'code';
/** What is typed in the two fields; a customer is chosen from the suggestions only (production needs its Yourrest number). */
export type MoldCustomerText={name:string;code:string};
const SHOWN=8;

/** A name as the app's customer searches compare it (the visits' picker, the complaints): no diacritics or tatweel, أ/إ/آ as ا, ى as ي,
 *  Arabic-Indic and Persian digits as plain ones, case and spacing ignored. */
const nameKey=(value:unknown)=>String(value??'').normalize('NFKD').replace(/[ً-ٰٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[·،,|]/g,' ')
 .replace(/[٠-٩]/g,digit=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g,digit=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).toLowerCase().replace(/\s+/g,' ').trim();
/** A code as the identity tables compare it (customerCodeKey: Arabic-Indic digits as plain ones, upper case), without spaces. */
const codeKey=(value:unknown)=>customerCodeKey(value).replace(/\s+/g,'');
/** The Yourrest number a code field holds, if it reads as one: «27», «000027», «YR-C-27», «YRC000027», «C-27». */
const numberOf=(key:string)=>{const match=/^(?:YR)?-?(?:C)?-?0*(\d{1,10})$/.exec(key);return match?match[1]||'0':'';};

type Entry={row:Row;name:string;yourrest:string;number:string;erp:string[];usable:boolean};
/** The suggestions for what is typed in one field: by name in «اسم العميل»; by Yourrest code (or its number alone) or ERP code (the
 *  customer's own and those it had before, when the page has them) in «الكود». Exact first, then starting with it, then containing it;
 *  customers without a Yourrest number after the others (shown, but not chosen). */
function suggest(index:Entry[],field:Field,typed:string){
 const ranked:{entry:Entry;rank:number}[]=[];
 if(field==='name'){
  const query=nameKey(typed),terms=query.split(' ').filter(Boolean);
  if(!terms.length)return [];
  for(const entry of index)if(terms.every(term=>entry.name.includes(term)))ranked.push({entry,rank:entry.name===query?0:entry.name.startsWith(query)?1:2});
 }else{
  const query=codeKey(typed),number=numberOf(query);
  if(!query)return [];
  for(const entry of index){
   const codes=[entry.yourrest,...entry.erp];
   const rank=codes.includes(query)||!!number&&entry.number===number?0:codes.some(code=>code.startsWith(query))||!!number&&entry.number.startsWith(number)?1:codes.some(code=>code.includes(query))||!!number&&entry.number.includes(number)?2:-1;
   if(rank>=0)ranked.push({entry,rank});
  }
 }
 return ranked.sort((a,b)=>Number(b.entry.usable)-Number(a.entry.usable)||a.rank-b.rank).map(item=>item.entry);
}

/** The mold request form's customer (the owner, 2026-11-09: «خانتين بترشيحات»): «اسم العميل» and «الكود» side by side (stacked on a
 *  narrow phone). Typing in either suggests the customers the reader may ask for, under that field (up to 8: name · Yourrest code · city ·
 *  ERP code), by keyboard (↑ ↓ Enter Esc) or touch; one without a Yourrest number is shown but cannot be chosen. Choosing fills both fields
 *  with the customer's name and Yourrest code and sets the customer (onChoose); typing in either afterwards lets it go (onChoose(null))
 *  and keeps the text, so a stale choice is never sent. fixed: the edit of a request, whose customer stays as it is (filled, read-only).
 *  onOpenChange: whether suggestions are showing (the dialog leaves Esc to them then). */
export default function MoldCustomerFields({customers,customerId,text,onText,onChoose,onOpenChange,error,fixed,say}:{customers:Row[];customerId:string;text:MoldCustomerText;onText:(text:MoldCustomerText)=>void;onChoose:(row:Row|null)=>void;onOpenChange?:(open:boolean)=>void;error?:string;fixed?:MoldCustomerText;say:Say}){
 const id=useId(),nameInput=useRef<HTMLInputElement|HTMLTextAreaElement>(null);
 const [open,setOpen]=useState<Field|null>(null),[active,setActive]=useState(-1);
 const chosen=customers.find(row=>row.id===customerId)||null;
 const index=useMemo<Entry[]>(()=>customers.map(row=>{const yourrest=String(row.data.internalCode||''),number=yourrestNumber(yourrest);return {row,name:nameKey(row.data.name),yourrest:codeKey(yourrest),number:number?String(number):'',erp:customerErpCodes(row).map(codeKey),usable:!!number};}),[customers]);
 const all=useMemo(()=>open&&!chosen?suggest(index,open,text[open]):[],[index,open,text,chosen]);
 const shown=all.slice(0,SHOWN),expanded=!!open&&!chosen&&!!text[open].trim();
 // The first that can be chosen is highlighted, as the visits' picker does; ↑ ↓ move among those only.
 const usable=shown.map((entry,at)=>entry.usable?at:-1).filter(at=>at>=0),current=usable.includes(active)?active:usable[0]??-1;
 useEffect(()=>{onOpenChange?.(expanded);},[expanded,onOpenChange]);
 useEffect(()=>()=>onOpenChange?.(false),[onOpenChange]);
 useEffect(()=>{if(expanded&&current>=0)document.getElementById(id+'-'+current)?.scrollIntoView({block:'nearest'});},[expanded,current,id]);
 const choose=(row:Row)=>{if(!yourrestNumber(row.data.internalCode))return;onText({name:String(row.data.name||''),code:String(row.data.internalCode||'')});onChoose(row);setOpen(null);setActive(-1);};
 const type=(field:Field,value:string)=>{onText({...text,[field]:value});if(chosen)onChoose(null);setOpen(field);setActive(-1);};
 const keyDown=(field:Field)=>(event:React.KeyboardEvent<HTMLInputElement|HTMLTextAreaElement>)=>{
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   event.preventDefault();
   if(!expanded||open!==field){if(text[field].trim()&&!chosen)setOpen(field);return;}
   if(!usable.length)return;
   const at=usable.indexOf(current),next=event.key==='ArrowDown'?usable[Math.min(at+1,usable.length-1)]:usable[Math.max(at-1,0)];
   setActive(next);
  }else if(event.key==='Enter'&&expanded&&open===field){
   // Enter chooses the highlighted customer; with none to choose it does nothing (the form is not sent from a half-typed customer).
   event.preventDefault();
   if(current>=0)choose(shown[current].row);
  }else if(event.key==='Escape'&&expanded){event.preventDefault();setOpen(null);setActive(-1);}
 };
 const listId=id+'-list',described=error?id+'-error':undefined;
 const combobox=(field:Field)=>({role:'combobox','aria-autocomplete':'list' as const,'aria-expanded':expanded&&open===field,'aria-controls':expanded&&open===field?listId:undefined,
  'aria-activedescendant':expanded&&open===field&&current>=0?id+'-'+current:undefined,'aria-invalid':!!error||undefined,'aria-describedby':described,autoComplete:'off',
  onKeyDown:keyDown(field),onFocus:()=>{if(!chosen&&text[field].trim()){setOpen(field);setActive(-1);}}});
 const meta=(row:Row)=>[String(row.data.internalCode||'')||say('لم يأخذ كود يورست بعد','No Yourrest code yet'),String(row.data.city||''),row.data.code?'ERP '+String(row.data.code):''].filter(Boolean);
 const suggestions=(field:Field)=>expanded&&open===field&&<div className="mold-customer-suggestions">
  <ul id={listId} role="listbox" aria-label={say('العملاء المطابقون','Matching customers')}>{shown.map((entry,at)=>{const row=entry.row;
   return <li key={row.id} id={id+'-'+at} role="option" aria-selected={at===current} aria-disabled={!entry.usable||undefined} title={entry.usable?undefined:say('لا يُطلب له قالب قبل أن يأخذ كود يورست','A mold cannot be requested before the customer has a Yourrest code')}
    onMouseDown={event=>event.preventDefault()} onClick={()=>choose(row)} onMouseMove={()=>{if(entry.usable&&at!==current)setActive(at);}}>
    <strong dir="auto">{String(row.data.name||'')}</strong><small>{meta(row).map((part,n)=><React.Fragment key={n}>{n>0&&<span aria-hidden="true"> · </span>}<bdi>{part}</bdi></React.Fragment>)}</small></li>;})}</ul>
  {!shown.length&&<p role="status">{say('لا عملاء مطابقون','No matching customers')}</p>}
  {all.length>SHOWN&&<p>{say('اكتب أكثر لتضييق النتائج','Type more to narrow the results')}</p>}
 </div>;
 if(fixed)return <div className="mold-customer-fields" data-fixed="true">
  <div className="mold-customer-inputs">
   <label className="field"><span>{say('اسم العميل','Customer name')}</span><div><input type="text" dir="auto" readOnly aria-readonly="true" value={fixed.name}/></div></label>
   <label className="field mold-customer-code"><span>{say('الكود','Code')}</span><div><input type="text" dir="ltr" readOnly aria-readonly="true" value={fixed.code}/></div></label>
  </div></div>;
 return <div className="mold-customer-fields" aria-invalid={!!error} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){setOpen(null);setActive(-1);}}}>
  <div className="mold-customer-inputs">
   <div className="mold-customer-field" data-field="name">
    <VoiceField label={say('اسم العميل','Customer name')} value={text.name} onChange={value=>type('name',value)} contextKey="mold-customer" inputRef={nameInput}
     inputProps={{...combobox('name'),dir:'auto',maxLength:250,enterKeyHint:'search',placeholder:say('اكتب اسم العميل','Type the customer name')}}/>
    {suggestions('name')}
   </div>
   <div className="mold-customer-field" data-field="code">
    <label className="field mold-customer-code"><span>{say('الكود','Code')}</span><div><input type="text" dir="ltr" maxLength={60} inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="search"
     placeholder={say('YR-C-… أو كود ERP','YR-C-… or ERP code')} value={text.code} onChange={event=>type('code',event.target.value)} {...combobox('code')}/></div></label>
    {suggestions('code')}
   </div>
  </div>
  {chosen&&<div className="mold-customer-chosen" role="status"><span><CheckCircle2 size={16} aria-hidden="true"/>{say('تم اختيار العميل','Customer chosen')}{(chosen.data.city||chosen.data.code)&&<small>{[String(chosen.data.city||''),chosen.data.code?'ERP '+String(chosen.data.code):''].filter(Boolean).map((part,n)=><React.Fragment key={n}>{n>0&&' · '}<bdi>{part}</bdi></React.Fragment>)}</small>}</span>
   <button type="button" className="btn small subtle" onClick={()=>{onText({name:'',code:''});onChoose(null);setOpen(null);nameInput.current?.focus();}}>{say('تغيير','Change')}</button></div>}
  {error&&<small className="field-error" id={id+'-error'}>{error}</small>}
 </div>;
}

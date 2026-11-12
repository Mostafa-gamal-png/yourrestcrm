'use client';
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {CheckCircle2,Info} from 'lucide-react';
import type {Row} from '@/lib/crm';
import {customerCodeKey,customerErpCodes} from '@/lib/customer-identity';
import {MOLD_CUSTOMER_TEXT,yourrestNumber} from '@/lib/mold-requests';
import VoiceField from './voice-field';

type Say=(ar:string,en:string)=>string;
type Field='name'|'code';
/** What is typed in the two fields: the customer's name and ERP code (the owner, 2026-11-09: «اسم العميل بيتكتب نص»، «المندوب يكتب الكود
 *  والكود المطلوب كود erp»). */
export type MoldCustomerText={name:string;code:string};
const SHOWN=8;

/** A name as the app's customer searches compare it (the visits' picker, the complaints): no diacritics or tatweel, أ/إ/آ as ا, ى as ي,
 *  Arabic-Indic and Persian digits as plain ones, case and spacing ignored. */
const nameKey=(value:unknown)=>String(value??'').normalize('NFKD').replace(/[ً-ٰٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[·،,|]/g,' ')
 .replace(/[٠-٩]/g,digit=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g,digit=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).toLowerCase().replace(/\s+/g,' ').trim();
/** A code as the identity tables compare it (customerCodeKey: Arabic-Indic digits as plain ones, upper case), without spaces. */
const codeKey=(value:unknown)=>customerCodeKey(value).replace(/\s+/g,'');
/** The Yourrest number a code field holds, if it reads as one: «27», «000027», «YR-C-27», «YRC000027», «C-27». */
const numberOf=(key:string)=>{const match=/^(?:YR)?-?(?:C)?-?0*(\d{1,10})$/.exec(key);return match?match[1]||'0':'';};
/** The ERP code as the ERP writes it (2026-11-09: «والأرقام فيه أرقام إنجليزية»): Arabic-Indic and Persian digits typed become plain ones. */
const englishDigits=(value:string)=>value.replace(/[٠-٩]/g,digit=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g,digit=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
/** The ERP code a customer's request is filled with when it is chosen: its own ('' for none). */
export const moldCustomerErpCode=(row:Row)=>String(row.data.code??'').trim();

type Entry={row:Row;name:string;yourrest:string;number:string;erp:string[];usable:boolean};
const entriesOf=(customers:Row[]):Entry[]=>customers.map(row=>{const yourrest=String(row.data.internalCode||''),number=yourrestNumber(yourrest);return {row,name:nameKey(row.data.name),yourrest:codeKey(yourrest),number:number?String(number):'',erp:customerErpCodes(row).map(codeKey),usable:!!number};});
/** The one customer the typed ERP code names (its current code: one it only had before names nobody), when exactly one of the reader's customers has it and
 *  it has a Yourrest number: the request is then linked to it as if it were chosen (the server decides the same way, over every customer
 *  and the CRM's code mappings). null otherwise: a customer not in the CRM. */
export function moldCustomerByErpCode(customers:Row[],code:string):Row|null{
 const key=codeKey(code);
 if(!key)return null;
 const found=entriesOf(customers).filter(entry=>entry.erp.includes(key));
 return found.length===1&&found[0].usable?found[0].row:null;
}
/** The suggestions for what is typed in one field: by name in «اسم العميل»; by ERP code (the customer's current one)
 *  or, as a help, by Yourrest code (or its number alone) in «كود ERP». Exact first, then starting with it, then
 *  containing it; customers without a Yourrest number after the others (shown, but not chosen). */
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

/** The mold request form's customer (the owner, 2026-11-09): «اسم العميل» (free text, dictated, required) and «كود ERP» side by side
 *  (stacked on a narrow phone). Typing in either suggests the customers the reader may ask for, under that field (up to 8: name · Yourrest
 *  code · city · ERP code), by keyboard (↑ ↓ Enter Esc) or touch; one without a Yourrest number is shown but cannot be chosen. Choosing one
 *  fills the name and its ERP code and links the request to it (onChoose); typing in either afterwards lets the choice go (onChoose(null)),
 *  keeping the text. `linked` is the customer the request is linked to (chosen, or named by the ERP code alone: moldCustomerByErpCode),
 *  said as «مرتبط بالعميل <name> · YR-C-…»; with none, anything typed is a customer not in the CRM, said so under the fields (the request
 *  goes to production with the name and ERP code). The ERP code is required for such a customer only (its hint says so). Typing freely is
 *  never blocked. onOpenChange: whether suggestions are showing (the dialog leaves Esc to them then). */
export default function MoldCustomerFields({customers,chosenId,linked,text,onText,onChoose,onOpenChange,errors={},say}:{customers:Row[];chosenId:string;linked:Row|null;text:MoldCustomerText;onText:(text:MoldCustomerText)=>void;onChoose:(row:Row|null)=>void;onOpenChange?:(open:boolean)=>void;errors?:{name?:string;code?:string;customer?:string};say:Say}){
 const id=useId(),nameInput=useRef<HTMLInputElement|HTMLTextAreaElement>(null);
 const [open,setOpen]=useState<Field|null>(null),[active,setActive]=useState(-1);
 const chosen=!!chosenId&&linked?.id===chosenId;
 const index=useMemo(()=>entriesOf(customers),[customers]);
 const all=useMemo(()=>open&&!chosen?suggest(index,open,text[open]):[],[index,open,text,chosen]);
 const shown=all.slice(0,SHOWN),expanded=!!open&&!chosen&&!!text[open].trim()&&!!shown.length;
 // The first that can be chosen is highlighted, as the visits' picker does; ↑ ↓ move among those only.
 const usable=shown.map((entry,at)=>entry.usable?at:-1).filter(at=>at>=0),current=usable.includes(active)?active:usable[0]??-1;
 useEffect(()=>{onOpenChange?.(expanded);},[expanded,onOpenChange]);
 useEffect(()=>()=>onOpenChange?.(false),[onOpenChange]);
 useEffect(()=>{if(expanded&&current>=0)document.getElementById(id+'-'+current)?.scrollIntoView({block:'nearest'});},[expanded,current,id]);
 const choose=(row:Row)=>{if(!yourrestNumber(row.data.internalCode))return;onText({name:String(row.data.name||''),code:moldCustomerErpCode(row)});onChoose(row);setOpen(null);setActive(-1);};
 const type=(field:Field,value:string)=>{onText({...text,[field]:value});if(chosenId)onChoose(null);setOpen(field);setActive(-1);};
 const keyDown=(field:Field)=>(event:React.KeyboardEvent<HTMLInputElement|HTMLTextAreaElement>)=>{
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   if(!expanded||open!==field){if(text[field].trim()&&!chosen){event.preventDefault();setOpen(field);}return;}
   event.preventDefault();
   if(!usable.length)return;
   const at=usable.indexOf(current),next=event.key==='ArrowDown'?usable[Math.min(at+1,usable.length-1)]:usable[Math.max(at-1,0)];
   setActive(next);
  }else if(event.key==='Enter'&&expanded&&open===field){
   // Enter chooses the highlighted customer; with none to choose it only closes the list (the text typed stays: a customer not in the CRM).
   event.preventDefault();
   if(current>=0)choose(shown[current].row);else{setOpen(null);setActive(-1);}
  }else if(event.key==='Escape'&&expanded){event.preventDefault();setOpen(null);setActive(-1);}
 };
 const listId=id+'-list',describedBy=(field:Field)=>[errors[field]?id+'-'+field+'-error':'',errors.customer?id+'-error':'',field==='code'?id+'-hint':''].filter(Boolean).join(' ')||undefined;
 const combobox=(field:Field)=>({role:'combobox','aria-autocomplete':'list' as const,'aria-expanded':expanded&&open===field,'aria-controls':expanded&&open===field?listId:undefined,
  'aria-activedescendant':expanded&&open===field&&current>=0?id+'-'+current:undefined,'aria-invalid':!!errors[field]||!!errors.customer||undefined,'aria-describedby':describedBy(field),autoComplete:'off',
  onKeyDown:keyDown(field),onFocus:()=>{if(!chosen&&text[field].trim()){setOpen(field);setActive(-1);}}});
 const meta=(row:Row)=>[String(row.data.internalCode||'')||say('لم يأخذ كود يورست بعد','No Yourrest code yet'),String(row.data.city||''),row.data.code?'ERP '+String(row.data.code):''].filter(Boolean);
 const suggestions=(field:Field)=>expanded&&open===field&&<div className="mold-customer-suggestions">
  <ul id={listId} role="listbox" aria-label={say('العملاء المطابقون','Matching customers')}>{shown.map((entry,at)=>{const row=entry.row;
   return <li key={row.id} id={id+'-'+at} role="option" aria-selected={at===current} aria-disabled={!entry.usable||undefined} title={entry.usable?undefined:say('لا يُربط الطلب به قبل أن يأخذ كود يورست','The request cannot be linked to it before it has a Yourrest code')}
    onMouseDown={event=>event.preventDefault()} onClick={()=>choose(row)} onMouseMove={()=>{if(entry.usable&&at!==current)setActive(at);}}>
    <strong dir="auto">{String(row.data.name||'')}</strong><small>{meta(row).map((part,n)=><React.Fragment key={n}>{n>0&&<span aria-hidden="true"> · </span>}<bdi>{part}</bdi></React.Fragment>)}</small></li>;})}</ul>
  {all.length>SHOWN&&<p>{say('اكتب أكثر لتضييق النتائج','Type more to narrow the results')}</p>}
 </div>;
 const typed=!!(text.name.trim()||text.code.trim());
 return <div className="mold-customer-fields" aria-invalid={!!(errors.name||errors.code||errors.customer)} data-linked={linked?'true':typed?'false':undefined} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){setOpen(null);setActive(-1);}}}>
  <div className="mold-customer-inputs">
   <div className="mold-customer-field" data-field="name" aria-invalid={!!(errors.name||errors.customer)||undefined}>
    <VoiceField label={say('اسم العميل','Customer name')} value={text.name} onChange={value=>type('name',value)} contextKey="mold-customer" inputRef={nameInput}
     inputProps={{...combobox('name'),dir:'auto',maxLength:250,enterKeyHint:'next',placeholder:say('اكتب اسم العميل','Type the customer name')}}/>
    {errors.name&&<small className="field-error" id={id+'-name-error'}>{errors.name}</small>}
    {suggestions('name')}
   </div>
   <div className="mold-customer-field" data-field="code" aria-invalid={!!(errors.code||errors.customer)||undefined}>
    <label className="field mold-customer-code"><span>{say('كود ERP','ERP code')}</span><div><input type="text" dir="ltr" maxLength={60} inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="next"
     placeholder={say('مثال: 146','e.g. 146')} value={text.code} onChange={event=>type('code',englishDigits(event.target.value))} {...combobox('code')}/></div></label>
    <small className="mold-customer-hint" id={id+'-hint'}>{say(...MOLD_CUSTOMER_TEXT.erpHint)}</small>
    {errors.code&&<small className="field-error" id={id+'-code-error'}>{errors.code}</small>}
    {suggestions('code')}
   </div>
  </div>
  {/* Linked to one of the CRM's customers (chosen, or named by its ERP code alone): production identifies it by its Yourrest number. */}
  {linked&&<p className="mold-customer-chosen" role="status"><span><CheckCircle2 size={16} aria-hidden="true"/>{say(...MOLD_CUSTOMER_TEXT.linked)} <bdi dir="auto">{String(linked.data.name||'')}</bdi><small><bdi dir="ltr">{String(linked.data.internalCode||'')}</bdi>{linked.data.city?<> · <bdi>{String(linked.data.city)}</bdi></>:null}</small></span></p>}
  {/* Anything else typed is a customer not in the CRM: the request goes to production with the name and ERP code (never blocked). */}
  {!linked&&typed&&<p className="mold-customer-free" role="status"><Info size={16} aria-hidden="true"/><span>{say(...MOLD_CUSTOMER_TEXT.free)}</span></p>}
  {errors.customer&&<small className="field-error" id={id+'-error'}>{errors.customer}</small>}
 </div>;
}

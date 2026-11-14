'use client';
import React,{useId,useRef} from 'react';
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

/** A code as the identity tables compare it (customerCodeKey: Arabic-Indic digits as plain ones, upper case), without spaces. */
const codeKey=(value:unknown)=>customerCodeKey(value).replace(/\s+/g,'');
/** The ERP code as the ERP writes it (2026-11-09: «والأرقام فيه أرقام إنجليزية»): Arabic-Indic and Persian digits typed become plain ones. */
const englishDigits=(value:string)=>value.replace(/[٠-٩]/g,digit=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g,digit=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
/** The ERP code a customer's request is filled with when it is chosen: its own ('' for none). */
export const moldCustomerErpCode=(row:Row)=>String(row.data.code??'').trim();

type Entry={row:Row;erp:string[];usable:boolean};
const entriesOf=(customers:Row[]):Entry[]=>customers.map(row=>({row,erp:customerErpCodes(row).map(codeKey),usable:!!yourrestNumber(String(row.data.internalCode||''))}));
/** The one customer the typed ERP code names (its current code: one it only had before names nobody), when exactly one of the reader's customers has it and
 *  it has a Yourrest number: the request is then linked to it as if it were chosen (the server decides the same way, over every customer
 *  and the CRM's code mappings). null otherwise: a customer not in the CRM. */
export function moldCustomerByErpCode(customers:Row[],code:string):Row|null{
 const key=codeKey(code);
 if(!key)return null;
 const found=entriesOf(customers).filter(entry=>entry.erp.includes(key));
 return found.length===1&&found[0].usable?found[0].row:null;
}
/** The mold request form's customer: «اسم العميل» (free text, dictated, required) and «كود ERP» side by side (stacked on a narrow phone),
 *  both typed, with no suggestions (the owner, 2026-11-14: «خلى ادخال اسم ورقم العميل كتابة من غير اقتراحات»; suggestions from the CRM's
 *  customers came 2026-11-09). `linked` is the customer the request is linked to: the request's own when editing, else the one customer
 *  of the reader's whose current ERP code is the one typed (moldCustomerByErpCode), said as «مرتبط بالعميل <name> · YR-C-…»; with none,
 *  what is typed is a customer not in the CRM, said so under the fields (the request goes to production with the name and ERP code). The
 *  ERP code is required for such a customer only (its hint says so). Typing in either field lets an earlier link go (onChoose(null)),
 *  keeping the text. Typing freely is never blocked. */
export default function MoldCustomerFields({chosenId,linked,text,onText,onChoose,errors={},say}:{chosenId:string;linked:Row|null;text:MoldCustomerText;onText:(text:MoldCustomerText)=>void;onChoose:(row:Row|null)=>void;errors?:{name?:string;code?:string;customer?:string};say:Say}){
 const id=useId(),nameInput=useRef<HTMLInputElement|HTMLTextAreaElement>(null);
 const type=(field:Field,value:string)=>{onText({...text,[field]:value});if(chosenId)onChoose(null);};
 const describedBy=(field:Field)=>[errors[field]?id+'-'+field+'-error':'',errors.customer?id+'-error':'',field==='code'?id+'-hint':''].filter(Boolean).join(' ')||undefined;
 const fieldProps=(field:Field)=>({'aria-invalid':!!errors[field]||!!errors.customer||undefined,'aria-describedby':describedBy(field),autoComplete:'off'});
 const typed=!!(text.name.trim()||text.code.trim());
 return <div className="mold-customer-fields" aria-invalid={!!(errors.name||errors.code||errors.customer)} data-linked={linked?'true':typed?'false':undefined}>
  <div className="mold-customer-inputs">
   <div className="mold-customer-field" data-field="name" aria-invalid={!!(errors.name||errors.customer)||undefined}>
    <VoiceField label={say('اسم العميل','Customer name')} value={text.name} onChange={value=>type('name',value)} contextKey="mold-customer" inputRef={nameInput}
     inputProps={{...fieldProps('name'),dir:'auto',maxLength:250,enterKeyHint:'next',placeholder:say('اكتب اسم العميل','Type the customer name')}}/>
    {errors.name&&<small className="field-error" id={id+'-name-error'}>{errors.name}</small>}
   </div>
   <div className="mold-customer-field" data-field="code" aria-invalid={!!(errors.code||errors.customer)||undefined}>
    <label className="field mold-customer-code"><span>{say('كود ERP','ERP code')}</span><div><input type="text" dir="ltr" maxLength={60} inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="next"
     placeholder={say('مثال: 146','e.g. 146')} value={text.code} onChange={event=>type('code',englishDigits(event.target.value))} {...fieldProps('code')}/></div></label>
    <small className="mold-customer-hint" id={id+'-hint'}>{say(...MOLD_CUSTOMER_TEXT.erpHint)}</small>
    {errors.code&&<small className="field-error" id={id+'-code-error'}>{errors.code}</small>}
   </div>
  </div>
  {/* Linked to one of the CRM's customers (chosen, or named by its ERP code alone): production identifies it by its Yourrest number. */}
  {linked&&<p className="mold-customer-chosen" role="status"><span><CheckCircle2 size={16} aria-hidden="true"/>{say(...MOLD_CUSTOMER_TEXT.linked)} <bdi dir="auto">{String(linked.data.name||'')}</bdi><small><bdi dir="ltr">{String(linked.data.internalCode||'')}</bdi>{linked.data.city?<> · <bdi>{String(linked.data.city)}</bdi></>:null}</small></span></p>}
  {/* Anything else typed is a customer not in the CRM: the request goes to production with the name and ERP code (never blocked). */}
  {!linked&&typed&&<p className="mold-customer-free" role="status"><Info size={16} aria-hidden="true"/><span>{say(...MOLD_CUSTOMER_TEXT.free)}</span></p>}
  {errors.customer&&<small className="field-error" id={id+'-error'}>{errors.customer}</small>}
 </div>;
}

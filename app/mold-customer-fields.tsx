'use client';
import React,{useId,useRef} from 'react';
import {CheckCircle2,Info} from 'lucide-react';
import {MOLD_CUSTOMER_TEXT} from '@/lib/mold-requests';
import VoiceField from './voice-field';

type Say=(ar:string,en:string)=>string;
type Field='name'|'code';
/** What is typed in the two fields: the customer's name and ERP code (the owner, 2026-11-09: «اسم العميل بيتكتب نص»، «المندوب يكتب الكود
 *  والكود المطلوب كود erp»). */
export type MoldCustomerText={name:string;code:string};
/** The CRM customer a request being edited was stored with (its name and ERP code as stored), while the two fields still say exactly
 *  that; null for every other case. */
export type MoldKeptCustomer={name:string;code:string};

/** The ERP code as the ERP writes it (2026-11-09: «والأرقام فيه أرقام إنجليزية»): Arabic-Indic and Persian digits typed become plain ones. */
const englishDigits=(value:string)=>value.replace(/[٠-٩]/g,digit=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g,digit=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
/** The mold request form's customer: «اسم العميل» (free text, dictated, required) and «كود العميل» (its ERP code) side by side (stacked on a
 *  narrow phone), both typed, with no suggestions (the owner, 2026-11-14: «خلى ادخال اسم ورقم العميل كتابة من غير اقتراحات»), and since
 *  2026-11-21 typed only (the owner, after a request reached production under another factory: «انا قلتلك الخانة دى للكتابة فقط وايا يكن
 *  يتكتب فيها صح او خطأ يروح انت مالك تصحح ليه»). What is typed goes to production exactly as typed (trimmed, Arabic-Indic digits of the
 *  code as plain ones): the CRM no longer looks the code up among its customers, so nothing typed links the request to a CRM customer,
 *  fills its address or city, or gives it a Yourrest number (until that day the one customer whose current ERP code was the one typed
 *  was linked, by the form and by the server, and production received that customer's name and number instead of the name typed). The
 *  server decides the same way (app/api/mold-requests/route.ts askedCustomer). `kept` is the one exception: the edit of a request stored
 *  linked to a CRM customer before 2026-11-21 keeps that link while both fields still say what was stored, said as «مرتبط بالعميل <name> ·
 *  كود العميل: …»; typing anything else in either field lets it go, and the request then goes with what is typed (back to the stored text,
 *  the link is kept again). The ERP code, labelled «كود العميل» (the owner, 2026-11-14: «سميه كود العميل بس»), is required for every new
 *  request since that day (its hint says so; the form and the server refuse one without it). Typing freely is never blocked. */
export default function MoldCustomerFields({kept,text,onText,errors={},say}:{kept:MoldKeptCustomer|null;text:MoldCustomerText;onText:(text:MoldCustomerText)=>void;errors?:{name?:string;code?:string;customer?:string};say:Say}){
 const id=useId(),nameInput=useRef<HTMLInputElement|HTMLTextAreaElement>(null);
 const type=(field:Field,value:string)=>onText({...text,[field]:value});
 const describedBy=(field:Field)=>[errors[field]?id+'-'+field+'-error':'',errors.customer?id+'-error':'',field==='code'?id+'-hint':''].filter(Boolean).join(' ')||undefined;
 const fieldProps=(field:Field)=>({'aria-invalid':!!errors[field]||!!errors.customer||undefined,'aria-describedby':describedBy(field),autoComplete:'off'});
 const typed=!!(text.name.trim()||text.code.trim());
 return <div className="mold-customer-fields" aria-invalid={!!(errors.name||errors.code||errors.customer)} data-linked={kept?'true':typed?'false':undefined}>
  <div className="mold-customer-inputs">
   <div className="mold-customer-field" data-field="name" aria-invalid={!!(errors.name||errors.customer)||undefined}>
    <VoiceField label={say('اسم العميل','Customer name')} value={text.name} onChange={value=>type('name',value)} contextKey="mold-customer" inputRef={nameInput}
     inputProps={{...fieldProps('name'),dir:'auto',maxLength:250,enterKeyHint:'next',placeholder:say('اكتب اسم العميل','Type the customer name')}}/>
    {errors.name&&<small className="field-error" id={id+'-name-error'}>{errors.name}</small>}
   </div>
   <div className="mold-customer-field" data-field="code" aria-invalid={!!(errors.code||errors.customer)||undefined}>
    <label className="field mold-customer-code"><span>{say(...MOLD_CUSTOMER_TEXT.code)}</span><div><input type="text" dir="ltr" maxLength={60} inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="next"
     placeholder={say('مثال: 146','e.g. 146')} value={text.code} onChange={event=>type('code',englishDigits(event.target.value))} {...fieldProps('code')}/></div></label>
    <small className="mold-customer-hint" id={id+'-hint'}>{say(...MOLD_CUSTOMER_TEXT.erpHint)}</small>
    {errors.code&&<small className="field-error" id={id+'-code-error'}>{errors.code}</small>}
   </div>
  </div>
  {/* The edit of a request stored linked to a CRM customer (before 2026-11-21), its two fields unchanged: the link it keeps, by the name
      and ERP code it was stored with (never its Yourrest code, 2026-11-14). */}
  {kept&&<p className="mold-customer-chosen" role="status"><span><CheckCircle2 size={16} aria-hidden="true"/>{say(...MOLD_CUSTOMER_TEXT.linked)} <bdi dir="auto">{kept.name}</bdi><small>{kept.code?<>{say(...MOLD_CUSTOMER_TEXT.code)}: <bdi dir="ltr">{kept.code}</bdi></>:null}</small></span></p>}
  {/* Anything typed goes to production exactly as typed (2026-11-21), never linked by its code (never blocked). */}
  {!kept&&typed&&<p className="mold-customer-free" role="status"><Info size={16} aria-hidden="true"/><span>{say(...MOLD_CUSTOMER_TEXT.free)}</span></p>}
  {errors.customer&&<small className="field-error" id={id+'-error'}>{errors.customer}</small>}
 </div>;
}

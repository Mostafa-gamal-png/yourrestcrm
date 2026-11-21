'use client';
// The customer form as the owner approved it on 2026-11-21 (the mockup «عميل جديد»): six numbered sections — 1 «المصنع», 2 «المسؤولون»,
// 3 «الموقع», 4 «التصنيف والمسؤولية», 5 «الطاقة والاحتياج», 6 «ملاحظات» — two columns on a computer and one on a phone, every field of the
// earlier form kept («الداتا اللى فى الفورم القديمة كلها مهمة»), nothing under «بيانات إضافية». The sections and the contacts' editor are
// here; app/crm-app.tsx composes them with its own fields, so the permissions, validations and read-only rules stay those of the page.
import {useState,type ReactNode} from 'react';
import {Plus,Star,Trash2,UserRound} from 'lucide-react';
import {useLanguage,direction} from '@/lib/i18n';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import VoiceField from './voice-field';
import {CONTACT_TITLES,MAX_CONTACTS,contactsData,customerContacts,type CustomerContact} from '@/lib/customer-contacts';
import './customer-form.css';

type Say=(ar:string,en:string)=>string;
const useSay=()=>{const {language}=useLanguage();return ((ar:string,en:string)=>language==='en'?en:ar) as Say;};

/** One numbered section: its heading (with «اختياري» and a note where the mockup has them) and its fields in the form's grid. wide: across
 *  both columns on a computer (sections 5 and 6). */
export function CustomerFormSection({step,title,note,wide=false,children}:{step:number;title:readonly [string,string];note?:readonly [string,string];wide?:boolean;children:ReactNode}){
 const say=useSay();
 return <section className={'customer-form-section'+(wide?' wide':'')} data-customer-section={step} aria-labelledby={'customer-section-'+step}>
  <h3 id={'customer-section-'+step}><span className="customer-form-step" aria-hidden="true">{step}</span><span>{say(...title)}</span>{note&&<small>{say(...note)}</small>}</h3>
  <div className="form-grid">{children}</div>
 </section>;
}
/** The six titles, in order. */
export const CUSTOMER_FORM_SECTIONS:readonly (readonly [string,string])[]=[['المصنع','Factory'],['المسؤولون','Contacts'],['الموقع','Location'],['التصنيف والمسؤولية','Classification and responsibility'],['الطاقة والاحتياج','Capacity and demand'],['ملاحظات','Notes']];

const NO_TITLE='__none';
/** «المسؤولون»: several contacts, the first the primary (lib/customer-contacts.ts: the customer's own contact, phone and email; the second its
 *  «المسؤول الثاني»; the rest data.contacts). Each a name (dictated), a role, a mobile and an email; «إضافة مسؤول آخر» up to ten, «حذف» and
 *  «اجعله الأساسي» on the others. Every change writes the whole list back into the form's data (onChange). */
export function CustomerContactsEditor({data,onChange,disabled=false,contextKey}:{data:Record<string,unknown>;onChange:(patch:Record<string,unknown>)=>void;disabled?:boolean;contextKey:string}){
 const say=useSay(),{language}=useLanguage();
 const [list,setList]=useState<CustomerContact[]>(()=>customerContacts(data));
 const write=(next:CustomerContact[])=>{if(disabled)return;setList(next);onChange(contactsData(next));};
 const set=(index:number,key:keyof CustomerContact,value:string)=>write(list.map((contact,at)=>at===index?{...contact,[key]:value}:contact));
 return <div className="customer-contacts full" data-customer-contacts={list.length}>
  {list.map((contact,index)=>{const n=index+1,primary=index===0;return <fieldset className={'customer-contact'+(primary?' primary':'')} key={index} data-contact-index={index} disabled={disabled}>
   <legend className="sr-only">{say('المسؤول ','Contact ')+n}</legend>
   <div className="customer-contact-top"><strong><UserRound size={16} aria-hidden="true"/>{say('المسؤول ','Contact ')}<bdi>{n}</bdi></strong>
    {primary?<span className="customer-contact-primary" data-contact-primary><Star size={13} aria-hidden="true"/>{say('الأساسي','Primary')}</span>
     :<span className="customer-contact-actions"><button type="button" className="text-button" onClick={()=>write([contact,...list.filter((_,at)=>at!==index)])} aria-label={say('اجعل المسؤول '+n+' الأساسي','Make contact '+n+' the primary')}><Star size={14} aria-hidden="true"/>{say('اجعله الأساسي','Make primary')}</button>
      <button type="button" className="text-button danger" onClick={()=>write(list.filter((_,at)=>at!==index))} aria-label={say('حذف المسؤول '+n,'Delete contact '+n)}><Trash2 size={14} aria-hidden="true"/>{say('حذف','Delete')}</button></span>}
   </div>
   <VoiceField full label={say('الاسم','Name')} value={contact.name} onChange={value=>set(index,'name',value)} disabled={disabled} contextKey={contextKey+':contact:'+index} inputProps={{'aria-label':say('اسم المسؤول '+n,'Contact '+n+' name'),maxLength:250}}/>
   <label className="field"><span>{say('الصفة','Role')}</span><Select dir={direction()} value={contact.title||NO_TITLE} onValueChange={value=>set(index,'title',value===NO_TITLE?'':value)} disabled={disabled}><SelectTrigger className="pick" aria-label={say('صفة المسؤول '+n,'Contact '+n+' role')}><SelectValue/></SelectTrigger><SelectContent>
    <SelectItem value={NO_TITLE}>{say('غير محددة','Not specified')}</SelectItem>
    {CONTACT_TITLES.map(item=><SelectItem key={item.value} value={item.value}>{language==='en'?item.en:item.ar}</SelectItem>)}
   </SelectContent></Select></label>
   <label className="field"><span>{say('الجوال','Mobile')}</span><input type="tel" dir="ltr" inputMode="tel" autoComplete="off" maxLength={250} value={contact.phone} disabled={disabled} aria-label={say('جوال المسؤول '+n,'Contact '+n+' mobile')} onChange={event=>set(index,'phone',event.target.value)}/></label>
   <label className="field full"><span>{say('البريد الإلكتروني','Email')}</span><input type="email" dir="ltr" autoCapitalize="none" spellCheck={false} autoComplete="off" maxLength={250} value={contact.email} disabled={disabled} placeholder={say('اختياري','Optional')} aria-label={say('بريد المسؤول '+n,'Contact '+n+' email')} onChange={event=>set(index,'email',event.target.value)}/></label>
  </fieldset>;})}
  <button type="button" className="customer-contact-add" disabled={disabled||list.length>=MAX_CONTACTS} onClick={()=>write([...list,{name:'',title:'',phone:'',email:''}])}><Plus size={17} aria-hidden="true"/>{say('إضافة مسؤول آخر','Add another contact')}</button>
  <small className="customer-form-hint">{list.length>=MAX_CONTACTS?say('عشرة مسؤولين على الأكثر للعميل الواحد.','Ten contacts at most for one customer.'):say('الأساسي يظهر على كارت العميل وفي زرّي الاتصال وواتساب، والباقون يظهرون في بيانات العميل ويُبحث بأسمائهم وأرقامهم.','The primary shows on the customer’s card and its call and WhatsApp buttons; the others show in the customer’s details and are found by their names and numbers.')}</small>
 </div>;
}

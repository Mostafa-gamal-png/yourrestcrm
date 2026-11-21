'use client';
// «المسؤولون» in the customer's sheet («البيانات», app/crm-app.tsx): every contact of the customer (lib/customer-contacts.ts), the primary
// first and marked, each with its role, its mobile with «اتصال» and «واتساب» (lib/support.ts contactLinks: a number WhatsApp cannot open has
// no WhatsApp button) and its email. Nothing when the customer has no contact at all.
import {Mail,MessageCircle,PhoneCall,Star} from 'lucide-react';
import {useLanguage} from '@/lib/i18n';
import {contactLinks} from '@/lib/support';
import {contactTitleLabel,customerContacts} from '@/lib/customer-contacts';
import './customer-form.css';

export function CustomerContactsList({data}:{data:Record<string,unknown>}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const contacts=customerContacts(data).map((contact,index)=>({...contact,index})).filter(contact=>contact.name||contact.phone||contact.email);
 if(!contacts.length)return null;
 return <section className="customer-contacts-sheet" data-customer-contacts-list={contacts.length}><h3>{say('المسؤولون','Contacts')}</h3><ul>
  {contacts.map(contact=>{const links=contactLinks(contact.phone),title=contactTitleLabel(contact.title,language==='en'?'en':'ar');return <li key={contact.index} data-contact-index={contact.index}>
   <div className="customer-contacts-sheet-name"><strong>{contact.name||say('بلا اسم','No name')}</strong>{title&&<small>{title}</small>}{contact.index===0&&<span className="customer-contact-primary"><Star size={12} aria-hidden="true"/>{say('الأساسي','Primary')}</span>}</div>
   {contact.phone&&<div className="customer-contacts-sheet-phone"><bdi dir="ltr">{contact.phone}</bdi>{links.tel&&<a className="btn subtle small" href={links.tel} aria-label={say('اتصال بـ ','Call ')+(contact.name||contact.phone)}><PhoneCall size={14} aria-hidden="true"/>{say('اتصال','Call')}</a>}{links.whatsapp&&<a className="btn subtle small" href={links.whatsapp} target="_blank" rel="noopener noreferrer" aria-label={say('واتساب ','WhatsApp ')+(contact.name||contact.phone)}><MessageCircle size={14} aria-hidden="true"/>{say('واتساب','WhatsApp')}</a>}</div>}
   {contact.email&&<a className="customer-contacts-sheet-email" href={'mailto:'+contact.email}><Mail size={14} aria-hidden="true"/><bdi dir="ltr">{contact.email}</bdi></a>}
  </li>;})}
 </ul></section>;
}

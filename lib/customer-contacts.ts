import {z} from 'zod';
// «المسؤولون» of a customer (the owner, 2026-11-21, with the redesigned customer form: several contacts, each a name, a role, a mobile and an
// email; «الداتا اللى فى الفورم القديمة كلها مهمة»). How they are kept, so that every reader of the customer keeps working unchanged:
// - the PRIMARY contact (the first, «الأساسي») is the customer's own contact, phone and email (data.contact, data.phone, data.email), with
//   its role in data.contactTitle: the card, the call and WhatsApp buttons, the search, the exports, the ERP import, mold requests and the
//   products application's customer list read them as before;
// - the SECOND is the customer's «المسؤول الثاني» (data.contact2, data.phone2, data.email2, which the card, the search, the exports, the ERP
//   import and the edit requests already read), with its role in data.contactTitle2;
// - the third onward are data.contacts, a list of {name,title,phone,email}.
// At most ten in all. A contact with nothing in it is dropped; a role is one of CONTACT_TITLES (a key; the words are shown). A save that
// does not carry contacts or a role (a page or a device queue of the release before) keeps what is stored (keepAbsentContacts). Kept in the
// customer's data (crm_records.data, JSON): no migration. Pure: the page, the server and the tests share it.

export const CONTACT_TITLES=[
 {value:'factory_manager',ar:'مدير المصنع',en:'Factory manager'},
 {value:'owner',ar:'المالك',en:'Owner'},
 {value:'purchasing',ar:'المشتريات',en:'Purchasing'},
 {value:'production',ar:'مسؤول الإنتاج',en:'Production lead'},
 {value:'accountant',ar:'المحاسب',en:'Accountant'},
 {value:'other',ar:'أخرى',en:'Other'},
] as const;
export type ContactTitle=typeof CONTACT_TITLES[number]['value'];
export const CONTACT_TITLE_VALUES:readonly string[]=CONTACT_TITLES.map(item=>item.value);
export const contactTitleLabel=(value:unknown,language:'ar'|'en'='ar')=>{const item=CONTACT_TITLES.find(entry=>entry.value===value);return item?(language==='en'?item.en:item.ar):'';};
export type CustomerContact={name:string;title:string;phone:string;email:string};
export const MAX_CONTACTS=10;
/** data.contacts holds the third onward. */
export const MAX_OTHER_CONTACTS=MAX_CONTACTS-2;
export const CONTACT_FIELDS=['contact','phone','email','contactTitle','contact2','phone2','email2','contactTitle2','contacts'] as const;
export const CONTACT_TITLE_REFUSED='اختر صفة المسؤول من القائمة: مدير المصنع، المالك، المشتريات، مسؤول الإنتاج، المحاسب، أخرى.';
export const CONTACTS_TOO_MANY='عشرة مسؤولين على الأكثر للعميل الواحد.';
export const CONTACT_EMAIL_REFUSED='اكتب البريد الإلكتروني لكل مسؤول بصيغة صحيحة، أو اتركه فارغًا.';
export const CONTACT_TOO_LONG='اسم المسؤول وجواله وبريده 250 حرفًا على الأكثر.';

const text=(value:unknown)=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):'';
const EMAIL=z.string().email();
const empty=(contact:CustomerContact)=>!contact.name&&!contact.phone&&!contact.email;
/** One contact as stored: trimmed text, its fields in a fixed order (the edit requests compare them as JSON). */
export const contactOf=(value:Partial<Record<keyof CustomerContact,unknown>>|null|undefined):CustomerContact=>({name:text(value?.name),title:text(value?.title),phone:text(value?.phone),email:text(value?.email)});

/** A role: absent stays absent (the route keeps what is stored), null and '' empty, a key of CONTACT_TITLES, anything else refused. */
const titleField=z.unknown().transform((value,context)=>{
 if(value===undefined)return undefined;
 const title=text(value);
 if(title&&!CONTACT_TITLE_VALUES.includes(title)){context.addIssue({code:z.ZodIssueCode.custom,message:CONTACT_TITLE_REFUSED});return z.NEVER;}
 return title;
});
/** data.contacts: absent stays absent; null empty; a list of at most eight, each checked (a contact with nothing in it is dropped). */
const contactsField=z.unknown().transform((value,context)=>{
 if(value===undefined)return undefined;
 if(value===null)return [] as CustomerContact[];
 if(!Array.isArray(value)){context.addIssue({code:z.ZodIssueCode.custom,message:CONTACTS_TOO_MANY});return z.NEVER;}
 const list:CustomerContact[]=[];
 for(const entry of value){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)){context.addIssue({code:z.ZodIssueCode.custom,message:CONTACT_TOO_LONG});return z.NEVER;}
  const contact=contactOf(entry as Record<string,unknown>);
  if([contact.name,contact.phone,contact.email].some(part=>part.length>250)){context.addIssue({code:z.ZodIssueCode.custom,message:CONTACT_TOO_LONG});return z.NEVER;}
  if(contact.email&&!EMAIL.safeParse(contact.email).success){context.addIssue({code:z.ZodIssueCode.custom,message:CONTACT_EMAIL_REFUSED});return z.NEVER;}
  if(contact.title&&!CONTACT_TITLE_VALUES.includes(contact.title)){context.addIssue({code:z.ZodIssueCode.custom,message:CONTACT_TITLE_REFUSED});return z.NEVER;}
  if(!empty(contact))list.push(contact);
 }
 if(list.length>MAX_OTHER_CONTACTS){context.addIssue({code:z.ZodIssueCode.custom,message:CONTACTS_TOO_MANY});return z.NEVER;}
 return list;
});
/** The fields of lib/crm.ts schemas.customer beside contact, phone, email, contact2, phone2 and email2 (which keep their own rules). */
export const contactSchemaFields={contactTitle:titleField,contactTitle2:titleField,contacts:contactsField};

/** Every contact of a customer, the primary first: the primary always (even empty), the second when it holds anything, then the others.
 *  A stored customer never has an empty second before others (keepAbsentContacts). */
export function customerContacts(data:Record<string,unknown>|null|undefined):CustomerContact[]{
 const primary=contactOf({name:data?.contact,title:data?.contactTitle,phone:data?.phone,email:data?.email});
 const second=contactOf({name:data?.contact2,title:data?.contactTitle2,phone:data?.phone2,email:data?.email2});
 const others=Array.isArray(data?.contacts)?(data!.contacts as unknown[]).filter(entry=>!!entry&&typeof entry==='object').map(entry=>contactOf(entry as Record<string,unknown>)).filter(contact=>!empty(contact)):[];
 return [primary,...(empty(second)?[]:[second]),...others];
}
/** The contacts that are not the primary (the sheet, the search, the export). */
export const otherContacts=(data:Record<string,unknown>|null|undefined)=>customerContacts(data).slice(1);
/** A list as the customer's fields: the first the primary, the second «المسؤول الثاني», the rest data.contacts (as the form holds them,
 *  empty ones included: the server drops those). */
export function contactsData(list:readonly CustomerContact[]){
 const [primary,second,...others]=list.map(contactOf);
 const one=primary||contactOf(null),two=second||contactOf(null);
 return {contact:one.name,contactTitle:one.title,phone:one.phone,email:one.email,contact2:two.name,contactTitle2:two.title,phone2:two.phone,email2:two.email,contacts:others};
}
/** After the schema read a save: a save that does not carry contacts or a role keeps what is stored; an empty role is removed; and a second
 *  left empty with others after it takes the first of them (so «المسؤول الثاني» is always the second when there is one). */
export function keepAbsentContacts(data:Record<string,unknown>,sent:Record<string,unknown>|undefined,stored:Record<string,unknown>|undefined){
 for(const field of ['contactTitle','contactTitle2','contacts'] as const){
  if(stored&&(!sent||sent[field]===undefined)){if(stored[field]===undefined)delete data[field];else data[field]=stored[field];continue;}
  if(field==='contacts'){if(!Array.isArray(data.contacts)||!data.contacts.length)delete data.contacts;continue;}
  if(!text(data[field]))delete data[field];else data[field]=text(data[field]);
 }
 const others=Array.isArray(data.contacts)?(data.contacts as unknown[]).filter(entry=>!!entry&&typeof entry==='object').map(entry=>contactOf(entry as Record<string,unknown>)).filter(contact=>!empty(contact)):[];
 const second=contactOf({name:data.contact2,phone:data.phone2,email:data.email2});
 if(empty(second)&&others.length){
  const [next,...rest]=others;
  Object.assign(data,{contact2:next.name,phone2:next.phone,email2:next.email});
  if(next.title)data.contactTitle2=next.title;else delete data.contactTitle2;
  if(rest.length)data.contacts=rest;else delete data.contacts;
 }else if(empty(second))delete data.contactTitle2;
 return data;
}
/** One line for a list of contacts: «الاسم (الصفة) الجوال البريد؛ …» (the export's column, the edit requests' values). */
export function contactsText(list:readonly CustomerContact[],language:'ar'|'en'='ar'){
 return list.map(contact=>{const title=contactTitleLabel(contact.title,language);return [contact.name+(title?' ('+title+')':''),contact.phone,contact.email].map(part=>part.trim()).filter(Boolean).join(' ');}).filter(Boolean).join(language==='en'?'; ':'؛ ');
}
/** What the searches read of the contacts beyond the two the customer's own fields hold: names and phones. */
/** The third contact onward alone (data.contacts, valid and not empty). */
export const extraContacts=(data:Record<string,unknown>|null|undefined)=>customerContacts({contacts:data?.contacts}).slice(1);
export const otherContactsSearch=(data:Record<string,unknown>|null|undefined)=>extraContacts(data).flatMap(contact=>[contact.name,contact.phone]).filter(Boolean);

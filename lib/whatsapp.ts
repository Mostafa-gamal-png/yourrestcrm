import {contactLinks} from './support';

/** The company's name as the customer reads it in the message. */
export const COMPANY_NAME='شركة يورست للصناعات';
const WA='https://wa.me/';
const asciiDigits=(value:string)=>value.replace(/[٠-٩]/g,digit=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

/** Whether a number may be kept as a customer's contact number: seven to fifteen digits, Arabic digits included. */
export function validContactNumber(value:unknown):boolean{
 const digits=asciiDigits(String(value??'')).replace(/\D/g,'');
 return digits.length>=7&&digits.length<=15;
}
/** The number a WhatsApp chat can be opened on, in international form without the plus; empty for a number WhatsApp cannot open (a landline,
 * a number without its country code). Saudi numbers are taken as they are written: 05..., 5..., 9665..., +966 5..., 00966 5... */
export function whatsappNumber(value:unknown):string{
 const link=contactLinks(value).whatsapp;
 return link.startsWith(WA)?link.slice(WA.length):'';
}
/** The link that opens the chat, with the message ready to be reviewed and sent; empty when the number cannot be opened. */
export function whatsappUrl(value:unknown,text:string=''):string{
 const number=whatsappNumber(value);
 return number?WA+number+(text?'?text='+encodeURIComponent(text):''):'';
}
/** A date as the customer reads it: day, month, year, in Riyadh. */
export const messageDate=(iso:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(iso));

/** What the customer is told when a complaint is registered. Always Arabic and fixed here, so that every employee sends the same words; the
 * number is left out for a complaint registered before numbering began. */
export function complaintMessage(input:{number?:number|null;createdAt:string;category:string}):string{
 const number=input.number?` رقم ${input.number}`:'',topic=input.category?` بخصوص «${input.category}»`:'';
 return `السلام عليكم. ${COMPANY_NAME}: تم تسجيل شكواكم${number} بتاريخ ${messageDate(input.createdAt)}${topic}، وسيتواصل معكم فريقنا للمتابعة حتى الحل. نشكر لكم ثقتكم.`;
}

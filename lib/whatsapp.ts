import {contactLinks} from './support';

/** The company's name as the customer reads it in the message, in each language. */
export const COMPANY_NAME='شركة يورست للصناعات';
export const COMPANY_NAME_EN='Yourrest Industries';
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

/** What the customer is told when a complaint is registered: the Arabic words and the same words in English. Fixed here, so that every employee
 * sends the same message whatever language the employee's screen is in; the number is left out for a complaint registered before numbering
 * began, and the topic when the complaint has none. */
export function complaintMessageParts(input:{number?:number|null;createdAt:string;category:string;categoryEn?:string}):{ar:string;en:string}{
 const date=messageDate(input.createdAt),number=input.number?` برقم ${input.number}`:'',topic=input.category?` بخصوص «${input.category}»`:'';
 const numberEn=input.number?` under number ${input.number}`:'',topicEn=input.category&&input.categoryEn?` regarding “${input.categoryEn}”`:'';
 return {
  ar:`${COMPANY_NAME} ترحب بكم : تم تسجيل شكوى${number} بتاريخ ${date}${topic}، وسيتم التواصل معكم للمتابعة حتى الحل. نشكر لكم ثقتكم.`,
  en:`${COMPANY_NAME_EN} welcomes you: a complaint has been registered${numberEn} on ${date}${topicEn}, and we will contact you to follow up until it is resolved. We thank you for your trust.`
 };
}
/** The whole message as it is sent in one WhatsApp message: the Arabic paragraph, then the English one. */
export function complaintMessage(input:Parameters<typeof complaintMessageParts>[0]):string{
 const {ar,en}=complaintMessageParts(input);
 return ar+'\n\n'+en;
}

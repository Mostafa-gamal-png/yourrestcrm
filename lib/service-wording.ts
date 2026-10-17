import {isServiceRole} from './customer-service';

/** What customer service records is an opportunity handed to sales, not a visit, so for its members the word of the record is «فرصة» and the words
 * for what was done in it speak of the contact: «الهدف من التواصل»، «نتيجة التواصل»، «تاريخ التواصل». Sales members and administrators keep «زيارة». */
const contactFields:[string,string][]=[
 ['الهدف الآخر من الزيارة','الهدف الآخر من التواصل'],['الهدف من الزيارة','الهدف من التواصل'],['نتيجة الزيارة','نتيجة التواصل'],['تاريخ الزيارة','تاريخ التواصل'],
 ['لوكيشن الزيارة','لوكيشن التواصل'],['بداية الزيارة','بداية التواصل'],['نهاية الزيارة','نهاية التواصل'],['مدة الزيارة','مدة التواصل'],['توقيت الزيارة','توقيت التواصل']
];

/** Whether the words of customer service apply to this role. */
export const serviceWording=(role:string|null|undefined)=>!!role&&isServiceRole(role);

/** The Arabic of the record's name for customer service: visits become opportunities, a visit an opportunity. */
const arabic=(text:string)=>{
 let out=text;
 for(const [from,to] of contactFields)out=out.split(from).join(to);
 return out.replace(/زيارات/g,'فرص').replace(/زيارة/g,'فرصة');
};
/** The English of it, with the article that follows the noun. */
const english=(text:string)=>text
 .replace(/\b(Visit|visit) (purpose|outcome|result|date|location|start|end|duration|timing)\b/g,(match,first,field)=>(first[0]==='V'?'Contact ':'contact ')+field)
 .replace(/\b(a|A) visit\b/g,(match,article)=>(article==='A'?'An':'an')+' opportunity')
 .replace(/\bVisits\b/g,'Opportunities').replace(/\bvisits\b/g,'opportunities').replace(/\bVisit\b/g,'Opportunity').replace(/\bvisit\b/g,'opportunity');
/** A phrase as a member of this role reads it: unchanged for everyone but customer service, whose words for a visit are the opportunity's. */
export function serviceText(role:string|null|undefined,text:string):string{
 if(!serviceWording(role))return text;
 if(/[؀-ۿ]/.test(text))return /زيار/.test(text)?arabic(text):text;
 return /\bvisits?\b/i.test(text)?english(text):text;
}
/** The same function for one role, to hand to a component that does not know the role. */
export const serviceWords=(role:string|null|undefined)=>(text:string)=>serviceText(role,text);

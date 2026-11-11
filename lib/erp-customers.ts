import type {Member,Row} from './crm';
import {customerCodeKey,customerCodeCandidates,type CustomerCodeMapping} from './customer-identity';
import {memberCanAccessRegion,regionOptions,regionScope} from './regions';
import {ERP_ADD_CUSTOMER,ERP_CUSTOMERS_MAX_ADDS} from './erp-customers-shared';
export {ERP_ADD_CUSTOMER,ERP_CUSTOMERS_MAX_ADDS};

/** The ERP customer export (sheet "Customer": a title row, this header row, then one customer per row). For a customer the CRM has, only
 * the number is written, as the customer's ERP code; the names and phones only find the customer. A row the CRM does not have is added as
 * a new customer with its name, code, phones, email and address (see ErpCustomerAdd); the ID number and the date are never read. */
export const erpCustomerColumns={code:'رقم العميل',idNumber:'رقم الهوية',name:'الاسم بالعربي',nameEn:'الاسم بالانجليزي',mobile:'رقم الجوال',phone:'رقم الهاتف',email:'البريد الالكتروني',address:'العنوان',date:'التاريخ'} as const;
export const ERP_CUSTOMERS_MAX_ROWS=20000;
/** A row whose phone cells list more numbers than this (or a cell longer than ERP_CUSTOMER_MAX_PHONE_CELL characters) is not read, and a
 * row that matches more customers than ERP_CUSTOMER_MAX_CANDIDATES is not offered: no real customer looks like that, and the preview stays small. */
export const ERP_CUSTOMER_MAX_PHONES=5,ERP_CUSTOMER_MAX_PHONE_CELL=200,ERP_CUSTOMER_MAX_CANDIDATES=20;
/** Candidates offered in one preview, all rows together (two per row of a full file): beyond it the file is refused, never sent. */
export const ERP_CUSTOMERS_MAX_OFFERED=40000;
/** Similar names (similarNameTokens, nameSimilarity): at most ERP_SIMILAR_MAX suggestions per row; the words two names share are evidence
 * only when at most ERP_SIMILAR_COMMON CRM customers carry all of them (unless the names have exactly the same words); a name is read as at
 * most ERP_SIMILAR_MAX_WORDS words. */
export const ERP_SIMILAR_MAX=5,ERP_SIMILAR_COMMON=20,ERP_SIMILAR_MAX_WORDS=12;
/** Expected file or choice problem, safe to show as an HTTP 400 message. */
export class ErpCustomersError extends Error{constructor(message:string){super(message);this.name='ErpCustomersError';}}
const fail=(message:string):never=>{throw new ErpCustomersError(message);};

const asciiDigits=(value:string)=>value.replace(/[٠-٩۰-۹]/g,digit=>String(digit.charCodeAt(0)-(digit>='۰'?0x6f0:0x660)));
/** A sheet cell as text: invisible direction marks and repeated spaces never distinguish two values. */
export const cleanCell=(value:unknown)=>String(value??'').normalize('NFC').replace(/[­​-‏‪-‮⁦-⁩﻿]/g,'').replace(/\s+/g,' ').trim();
const headerKey=(value:unknown)=>cleanCell(value).normalize('NFKC').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase();
/** A number typed when the real one is unknown (0500000000, 0555555555, 0111111111, 0123456789, 0512345678) is nobody's number. */
const placeholderPhone=(key:string)=>/^[15](\d)\1{7}$/.test(key)||key==='123456789'||key==='512345678';
/** Saudi national digits of each number in a cell: 5XXXXXXXX (mobile) or 1XXXXXXXX (landline), after Arabic/Persian digits become
 * plain ones, everything but digits is dropped and a leading 00966 / 966 and then 0 is stripped. Anything else, and a placeholder, is no
 * number. Numbers a cell lists with / , ; ، or on separate lines are read one by one; spaces, dashes and brackets inside one number are not separators. */
export function phoneKeys(value:unknown):string[]{
 const keys=new Set<string>();
 for(const part of asciiDigits(String(value??'')).split(/[/,;،؛|\n]+/)){let n=part.replace(/\D/g,'');n=n.startsWith('00966')?n.slice(5):n.startsWith('966')?n.slice(3):n;if(n.startsWith('0'))n=n.slice(1);if(/^[15]\d{8}$/.test(n)&&!placeholderPhone(n))keys.add(n);}
 return [...keys];
}
/** A loose Arabic spelling of a full name: harakat and tatweel dropped, أإآٱ→ا ى→ي ة→ه ؤ→و ئ→ي, Latin in lower case, punctuation as
 * spaces. Two names match only when they are equal after this; no word is dropped and nothing partial or similar counts. */
export function nameKey(value:unknown):string{
 return asciiDigits(String(value??'').normalize('NFC')).replace(/\p{Cf}/gu,'').replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/ؤ/g,'و').replace(/ئ/g,'ي').toLowerCase().replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/g,' ').trim();
}
const tail=(key:string)=>key.slice(-4);

// ---- similar names
/** The words of a name for comparing: nameKey, then «عبد» and «ابو» joined to the next word (عبد الله = عبدالله), a «و» before «ال»/«لل»
 * dropped, then «ال» or «لل» at the start when three letters or more remain (الصفا = صفا, للبلوك = بلوك), and a final «ء» (صفاء = صفا). */
function nameWords(value:unknown):string[]{
 const words=nameKey(value).split(' ').filter(Boolean),joined:string[]=[];
 for(let i=0;i<words.length;i++)joined.push((words[i]==='عبد'||words[i]==='ابو')&&i+1<words.length?words[i]+words[++i]:words[i]);
 return joined.map(word=>word.replace(/^و(?=(?:ال|لل).{3})/,'').replace(/^(?:ال|لل)(?=.{3})/,'').replace(/(?<=..)ء$/,''));
}
/** Words that say what kind of business a name is, not which one; compared as nameWords, so «للتجارة», «التجارة» and «تجارة» are one word. */
export const ERP_GENERIC_NAME_WORDS=['شركة','مؤسسة','مصنع','مصانع','للتجارة','التجارية','تجاري','للصناعة','الصناعية','للصناعات','والتسويق','للمقاولات','المحدودة','ذات','مسؤولية','مجموعة','فرع','و','co','ltd','est','company','factory','factories','trading','trade','llc','group','industries','industrial','corporation','corp','inc','establishment','the','and','for'];
const genericWords=new Set(ERP_GENERIC_NAME_WORDS.flatMap(nameWords));
/** The distinctive words of a name: nameWords without the generic words and without one-letter words, each once, at most ERP_SIMILAR_MAX_WORDS. */
export function similarNameTokens(value:unknown):string[]{return [...new Set(nameWords(value).filter(word=>word.length>=2&&!genericWords.has(word)))].slice(0,ERP_SIMILAR_MAX_WORDS);}
/** Whether two names (their distinctive words, similarNameTokens) are similar, as a score: 0 when not, else the words they share over the
 * words either has (1 = the same words, the names differ only in generic words). Always on the whole word lists: similar means they share a
 * word of three letters or more, and at most one word differs on each side — one word added, one dropped, or one replaced. `carriers` (the
 * matcher's) counts the CRM customers that carry every shared word: unless the two names have exactly the same words, the shared words must
 * be carried by at most ERP_SIMILAR_COMMON customers, since words that many customers carry (one word, or all the shared words together)
 * say nothing about which customer it is. So a single short word never makes two names similar, and a common word never makes two names
 * look closer than their whole lists are. */
export function nameSimilarity(a:string[],b:string[],carriers?:(shared:string[])=>number):number{
 if(!a.length||!b.length)return 0;
 const other=new Set(b),shared=a.filter(word=>other.has(word));
 if(!shared.some(word=>word.length>=3)||a.length-shared.length>1||b.length-shared.length>1)return 0;
 if(carriers&&(a.length>shared.length||b.length>shared.length)&&carriers(shared)>ERP_SIMILAR_COMMON)return 0;
 return shared.length/(a.length+b.length-shared.length);
}

export type SheetLike={name:string;rows:{rowNumber:number;cells:string[]}[]};
/** `contact` is what a new customer is given from the row (the phone cells as text, a cell's lines joined by « / » so each number can be
 * read again; the email and address cleaned); it is used only when the row is added and never leaves the server. */
export type ErpCustomerRow={row:number;code:string;codeKey:string;name:string;nameEn:string;phones:string[];issue:''|'no-code'|'long-code'|'duplicate-code'|'too-many-phones';contact:{mobile:string;phone:string;email:string;address:string}};
type Columns={code:number;name:number;nameEn:number;mobile:number;phone:number;email:number;address:number};
function headerColumns(cells:string[]):Columns|null{
 const keys=cells.map(headerKey),index=(label:string)=>{const key=headerKey(label),at=keys.indexOf(key);if(at>=0&&keys.lastIndexOf(key)!==at)fail(`عمود مكرر في الملف: ${label}`);return at;};
 const code=index(erpCustomerColumns.code);if(code<0)return null;
 const columns={code,name:index(erpCustomerColumns.name),nameEn:index(erpCustomerColumns.nameEn),mobile:index(erpCustomerColumns.mobile),phone:index(erpCustomerColumns.phone),email:index(erpCustomerColumns.email),address:index(erpCustomerColumns.address)};
 return columns.name<0&&columns.nameEn<0&&columns.mobile<0&&columns.phone<0?null:columns;
}
const phoneText=(value:unknown)=>String(value??'').split(/\r\n|\r|\n/).map(cleanCell).filter(Boolean).join(' / ').slice(0,250).trim();
/** The first sheet whose header (within its first 25 rows) has «رقم العميل» and a name or phone column; its rows below the header. */
export function erpCustomerRows(sheets:SheetLike[]):{sheet:string;rows:ErpCustomerRow[]}{
 for(const sheet of sheets){
  const at=sheet.rows.slice(0,25).findIndex(row=>headerColumns(row.cells));if(at<0)continue;
  const columns=headerColumns(sheet.rows[at].cells)!,codeHeader=headerKey(erpCustomerColumns.code),rows:ErpCustomerRow[]=[];
  for(const source of sheet.rows.slice(at+1)){
   const cell=(index:number)=>index<0?'':cleanCell(source.cells[index]);
   if(source.cells.every(value=>!cleanCell(value))||headerKey(source.cells[columns.code])===codeHeader)continue;
   // The phone cells are read as they are (a new line separates two numbers), and only when short: a cell is never split into hundreds.
   const code=cell(columns.code),phoneCells=[columns.mobile,columns.phone].map(index=>index<0?'':String(source.cells[index]??'')),long=phoneCells.some(value=>value.length>ERP_CUSTOMER_MAX_PHONE_CELL);
   const phones=long?[]:[...new Set(phoneCells.flatMap(phoneKeys))],crowded=long||phones.length>ERP_CUSTOMER_MAX_PHONES,email=cell(columns.email);
   rows.push({row:source.rowNumber,code,codeKey:customerCodeKey(code),name:cell(columns.name).slice(0,300),nameEn:cell(columns.nameEn).slice(0,300),phones:crowded?[]:phones,issue:!code?'no-code':code.length>100?'long-code':crowded?'too-many-phones':'',
    contact:{mobile:crowded?'':phoneText(phoneCells[0]),phone:crowded?'':phoneText(phoneCells[1]),email:email.length<=250?email:'',address:cell(columns.address).slice(0,250).trim()}});
   if(rows.length>ERP_CUSTOMERS_MAX_ROWS)fail(`الحد الأقصى للملف ${ERP_CUSTOMERS_MAX_ROWS} عميل`);
  }
  const numbered=(row:ErpCustomerRow)=>!row.issue||row.issue==='too-many-phones',counts=new Map<string,number>();
  for(const row of rows)if(numbered(row))counts.set(row.codeKey,(counts.get(row.codeKey)||0)+1);
  for(const row of rows)if(numbered(row)&&(counts.get(row.codeKey)||0)>1)row.issue='duplicate-code';
  if(!rows.length)fail('ملف عملاء ERP لا يحتوي صفوف عملاء بعد العناوين');
  return {sheet:sheet.name,rows};
 }
 return fail(`هذا ليس ملف عملاء ERP: يجب أن يحتوي على عمود «${erpCustomerColumns.code}» ومعه عمود الاسم أو الجوال. صدّر ملف العملاء من ERP كما هو.`);
}

/** Why a customer is offered for a row: its phone, its full name, both, the row's ERP code (its current code, a kept old code or a stored
 * mapping), or a similar name. */
export type MatchedBy='phone'|'name'|'both'|'code'|'similar';
export type ErpCustomerCandidate={id:string;name:string;internalCode:string;code:string;region:string;phones:string[];matchedBy:MatchedBy};
export type ErpCustomerStatus='auto'|'same'|'choose'|'similar'|'new'|'out-of-region'|'held-outside'|'invalid';
/** One ERP row. `customerId` is the customer it ends on ('' when none); `add` says the row is added as a new customer; `from` → `to` its ERP
 * code before and after; `sharedWith` how many other customers hold that number (current code or kept alias), in which case `mapping` says
 * an explicit mapping is written. `codeRow` is the other row of the file that carries the single candidate's current code (0 when none):
 * then the row is a choice, not automatic. */
export type ErpCustomerOutcome={row:number;code:string;name:string;phones:string[];status:ErpCustomerStatus;issue:ErpCustomerRow['issue']|'too-many-matches'|'no-name';matchedBy:MatchedBy|'';candidates:ErpCustomerCandidate[];customerId:string;add:boolean;chosen:boolean;conflict:boolean;codeRow:number;from:string;to:string;change:boolean;mapping:boolean;sharedWith:number};
export type ErpCustomerPlan={row:number;customerId:string;version:number;codeKey:string;from:string;to:string;codeChange:boolean;mapping:boolean;mappingVersion:number};
/** A row to add: its code and name (Arabic, else English, cut to the form's 250 characters) and the row's contact cells. Server only. */
export type ErpCustomerAdd={row:number;code:string;codeKey:string;name:string;phone:string;phone2:string;email:string;address:string};
/** A CRM customer the file does not name (ErpCustomersMatch.clears): `code` is its current ERP code, cleared by an apply with `clearCodes`.
 * `version` is for the server only (the preview sends ErpCustomerClearView). */
export type ErpCustomerClear={customerId:string;version:number;name:string;internalCode:string;code:string;region:string};
export type ErpCustomerClearView=Omit<ErpCustomerClear,'version'>;
export type ErpCustomersSummary={rows:number;auto:number;same:number;choose:number;similar:number;new:number;outOfRegion:number;heldOutside:number;invalid:number;conflicts:number;pending:number;changes:number;codeChanges:number;mappings:number;adds:number};

/** The values a new customer's region may take (the customer form's): '' («المنطقة غير محددة») and the five regions by their names. */
export const erpNewCustomerRegionValues:readonly string[]=['',...regionOptions.filter(([id])=>id!=='unassigned').map(([,label])=>label)];
/** The regions this member may give the customers an import adds (memberCanAccessRegion), and the default: «المنطقة غير محددة» when
 * allowed, else their first region; null when they may use none. */
export function erpNewCustomerRegions(me:Member){const regions=erpNewCustomerRegionValues.filter(value=>memberCanAccessRegion(me,value));return {regions,default:regions.length?regions[0]:null};}

const push=(map:Map<string,Row[]>,key:string,row:Row)=>{const list=map.get(key)||[];if(!list.includes(row))list.push(row);map.set(key,list);};
/** Whether giving this number to one of `me`'s customers would decide the ERP invoices of a customer outside `me`'s regions: a stored
 * mapping gives the number to such a customer, or, with no mapping to a customer inside, such a customer holds it (current code or kept
 * alias) — the number's invoices are theirs now, or nobody's while it is shared. Only the system administrator (all regions) decides
 * those. A mapping to a holder inside the regions already keeps every outside holder out of the number, so it may move between `me`'s customers. */
export function heldOutsideRegions(me:Member,holders:Row[],mapping:CustomerCodeMapping|undefined,customers:Map<string,Row>){
 if(regionScope(me)==='all')return false;
 const inside=(customer?:Row)=>!!customer&&memberCanAccessRegion(me,customer.data.region);
 if(mapping&&!inside(customers.get(mapping.customerId)))return true;
 return !(mapping&&holders.some(holder=>holder.id===mapping.customerId))&&holders.some(holder=>!inside(holder));
}
/** Matches every ERP row to CRM customers, applies the user's choices (row → customer id, '' to leave the row, ERP_ADD_CUSTOMER to add
 * it), and plans the code changes and the new customers. Pure: `customers` are the CRM customers (all of them, for holders and hidden
 * candidates), `me` limits which customers may be shown or changed, `mappings` are the stored explicit code mappings.
 * 1. By phone or exact loose full name. Candidates outside `me`'s regions are never returned; a row whose candidates are all outside reads
 *    `out-of-region`, and a row whose number a customer outside them holds reads `held-outside` (heldOutsideRegions), both with no details.
 *    A row matching more than ERP_CUSTOMER_MAX_CANDIDATES customers is `invalid` (`too-many-matches`). A single candidate whose current
 *    code is another row of the file is a choice; among several candidates, the one that already has exactly this number is preselected as `same`.
 * 2. Else by the row's code, when customers hold it (current code, kept alias, stored mapping): held outside the regions → `held-outside`;
 *    the mapped customer or the only holder → `same`, matched by `code`, nothing changed unless the user picks it; several → `choose`. As in
 *    1, a holder whose current code is another row of the file is not preselected: a choice with `codeRow` (else that row and this one
 *    would both end on it, a conflict on every later import of the same file).
 * 3. Else a row with no name is `invalid` (`no-name`). Else the customers with a similar name (similarNameTokens, nameSimilarity on the
 *    whole word lists; shared words more than ERP_SIMILAR_COMMON customers carry together are no evidence), looked for among all
 *    customers: the ERP_SIMILAR_MAX best inside the regions → `similar`: nothing preselected; a pick takes the code like a `choose` pick,
 *    ERP_ADD_CUSTOMER adds the row, no choice leaves it. Similar names only outside the regions → `out-of-region` (matched by `similar`, no
 *    details, never added: the customer may be one the member cannot see).
 * 4. Else `new`: added unless the user leaves it ('').
 * Rows of steps 1 and 2 are never added. Two rows ending on one customer are both a choice and `conflict`, and `summary.conflicts` must be
 * 0 before the plan is applied. `involved` (every candidate and holder, visible or not, with its version) is part of the preview's
 * snapshot; it and `adds` are for the server only.
 * `clears` (the owner, 2026-11-09: «عايزه العملاء اللى مش موجودين فى الشييت يبقى كود erp فاضى»): the customers inside `me`'s regions with
 * a non-empty current ERP code that no row of the file names, by any evidence the matcher reads: a phone or the exact loose name of any
 * row (rows too wide to offer and rows with an issue included), the row's number held as a current code, a kept old code or a stored
 * mapping, a candidate offered for a row (similar names included) or the customer a row ends on. They do not depend on the choices (a
 * choice only picks among candidates), so the preview's list is the apply's. Sorted like the candidates (Yourrest code, then id). */
export function matchErpCustomers(rows:ErpCustomerRow[],customers:Row[],options:{me:Member;mappings?:CustomerCodeMapping[];choices?:Map<number,string>}){
 const all=customers.filter(row=>row.kind==='customer'),byPhone=new Map<string,Row[]>(),byName=new Map<string,Row[]>(),holders=customerCodeCandidates(all);
 for(const customer of all){for(const key of new Set([...phoneKeys(customer.data.phone),...phoneKeys(customer.data.phone2)]))push(byPhone,key,customer);const key=nameKey(customer.data.name);if(key)push(byName,key,customer);}
 const mappings=new Map((options.mappings||[]).map(mapping=>[mapping.codeKey,mapping])),choices=options.choices||new Map<number,string>(),byId=new Map(all.map(row=>[row.id,row]));
 if(byId.has(ERP_ADD_CUSTOMER))fail('سجل عميل بمعرّف محجوز؛ راجع مدير النظام');
 const inScope=(customer:Row)=>memberCanAccessRegion(options.me,customer.data.region),involved=new Map<string,number>(),limited=regionScope(options.me)!=='all';
 const view=(customer:Row,matchedBy:MatchedBy):ErpCustomerCandidate=>({id:customer.id,name:String(customer.data.name||''),internalCode:String(customer.data.internalCode||''),code:String(customer.data.code||''),region:String(customer.data.region||''),phones:[...new Set([...phoneKeys(customer.data.phone),...phoneKeys(customer.data.phone2)])].map(tail),matchedBy});
 // The similar-name index is built once, on first need, over every customer (every region): each customer's distinctive words, the
 // customers under each word and under each whole set of words, and (memoized) the customers carrying all of a few words.
 let index:{wordsOf:Map<Row,string[]>;bySet:Map<string,Row[]>;carrying:(words:string[])=>Row[]|null}|null=null;
 const setKey=(words:string[])=>[...words].sort().join(' ');
 const similarIndex=()=>{
  if(index)return index;
  const wordsOf=new Map<Row,string[]>(),setsOf=new Map<Row,Set<string>>(),byWord=new Map<string,Row[]>(),bySet=new Map<string,Row[]>(),memo=new Map<string,Row[]|null>();
  const add=(map:Map<string,Row[]>,key:string,customer:Row)=>{const list=map.get(key);if(list)list.push(customer);else map.set(key,[customer]);};
  for(const customer of all){const words=similarNameTokens(customer.data.name);wordsOf.set(customer,words);setsOf.set(customer,new Set(words));for(const word of words)add(byWord,word,customer);if(words.length)add(bySet,setKey(words),customer);}
  // The customers carrying every one of `words`, or null when more than ERP_SIMILAR_COMMON do (then the words say nothing about which
  // customer it is). Walked along the shortest word's list and stopped past the limit, so bounded by that list.
  const carrying=(words:string[])=>{
   const key=setKey(words);if(memo.has(key))return memo.get(key)!;
   const shortest=words.map(word=>byWord.get(word)||[]).sort((x,y)=>x.length-y.length)[0];
   let found:Row[]|null=[];
   if(words.length===1)found=shortest.length<=ERP_SIMILAR_COMMON?shortest:null;
   else for(const customer of shortest)if(words.every(word=>setsOf.get(customer)!.has(word))&&found.push(customer)>ERP_SIMILAR_COMMON){found=null;break;}
   memo.set(key,found);return found;
  };
  return index={wordsOf,bySet,carrying};
 };
 const order=(a:Row,b:Row)=>{const x=String(a.data.internalCode||'')+'\u0000'+a.id,y=String(b.data.internalCode||'')+'\u0000'+b.id;return x<y?-1:x>y?1:0;};
 /** Every customer similar to the row's Arabic or English name, best first, from every region. A similar customer has the row's words
  * with at most one missing, so it is among the customers with exactly the row's words or carrying all of the row's words but one (when
  * few enough do; when more do, those shared words are no evidence anyway). */
 const similarTo=(row:ErpCustomerRow)=>{
  const {wordsOf,bySet,carrying}=similarIndex(),scores=new Map<Row,number>(),carriers=(shared:string[])=>carrying(shared)?.length??Infinity;
  for(const own of new Set([row.name,row.nameEn].filter(Boolean).map(name=>similarNameTokens(name).join(' ')))){
   if(!own)continue;
   const words=own.split(' '),found=new Set(bySet.get(setKey(words))||[]);
   for(const some of words.length>1?[words,...words.map((_,skip)=>words.filter((__,at)=>at!==skip))]:[words])for(const customer of carrying(some)||[])found.add(customer);
   for(const customer of found){const score=nameSimilarity(words,wordsOf.get(customer)!,carriers);if(score>(scores.get(customer)||0))scores.set(customer,score);}
  }
  return [...scores].sort(([a,x],[b,y])=>y-x||order(a,b)).map(([customer])=>customer);
 };
 let offered=0;
 const offer=(count:number)=>{if((offered+=count)>ERP_CUSTOMERS_MAX_OFFERED)fail('سطور الملف تطابق العملاء أنفسهم أكثر من اللازم؛ صدّر ملف العملاء من ERP كما هو.');};
 const known=new Set(rows.map(row=>row.row)),fileCodes=new Map(rows.filter(row=>!row.issue).map(row=>[row.codeKey,row.row]));
 for(const [row] of choices)if(!known.has(row))fail(`اختيار لسطر غير موجود في الملف (${row})؛ أجرِ معاينة جديدة`);
 const outcomes:ErpCustomerOutcome[]=rows.map(row=>{
  const base:ErpCustomerOutcome={row:row.row,code:row.code,name:row.name||row.nameEn,phones:row.phones.map(tail),status:'invalid',issue:row.issue,matchedBy:'',candidates:[],customerId:'',add:false,chosen:false,conflict:false,codeRow:0,from:'',to:row.code,change:false,mapping:false,sharedWith:0};
  const refuseChoice=()=>{if(choices.has(row.row))fail(`السطر ${row.row} لا يقبل اختيار عميل`);return base;};
  if(row.issue)return refuseChoice();
  // Every list is bounded before it is merged: a phone or name that many customers share makes the row too wide to offer.
  const hits=(keys:string[],map:Map<string,Row[]>)=>keys.map(key=>map.get(key)||[]),phoneLists=hits(row.phones,byPhone),nameLists=hits([...new Set([nameKey(row.name),nameKey(row.nameEn)])].filter(Boolean),byName);
  const wide=()=>{base.issue='too-many-matches';return refuseChoice();};
  if([...phoneLists,...nameLists].some(list=>list.length>ERP_CUSTOMER_MAX_CANDIDATES))return wide();
  const byPhoneHits=new Set(phoneLists.flat()),byNameHits=new Set(nameLists.flat()),found=[...new Set([...byPhoneHits,...byNameHits])];
  if(found.length>ERP_CUSTOMER_MAX_CANDIDATES)return wide();
  for(const customer of found)involved.set(customer.id,customer.version);
  const held=[...(holders.get(row.codeKey)||[])],mapping=mappings.get(row.codeKey),mapped=mapping&&byId.get(mapping.customerId);
  const preselect=(customer:Row,status:ErpCustomerStatus)=>{base.status=status;base.customerId=customer.id;base.matchedBy=base.candidates.find(candidate=>candidate.id===customer.id)!.matchedBy;};
  let several=false;
  if(found.length){
   // 1. By phone or name.
   const visible=found.filter(inScope);
   if(!visible.length){base.status='out-of-region';return refuseChoice();}
   // A member limited to regions: the number's holders and its mapping are part of what the preview showed (a region change moves a version).
   if(limited){for(const holder of held)involved.set(holder.id,holder.version);if(mapped)involved.set(mapped.id,mapped.version);}
   if(heldOutsideRegions(options.me,held,mapping,byId)){base.status='held-outside';return refuseChoice();}
   const matched=(customer:Row):MatchedBy=>byPhoneHits.has(customer)&&byNameHits.has(customer)?'both':byPhoneHits.has(customer)?'phone':'name';
   offer(visible.length);
   base.candidates=visible.map(customer=>view(customer,matched(customer)));
   several=found.length>1;
   if(found.length===1){
    const current=customerCodeKey(found[0].data.code),other=current!==row.codeKey&&fileCodes.get(current)||0;
    // The customer's current code is another customer of this file: the shared phone or name may be someone else's. The user confirms.
    if(other){base.status='choose';base.codeRow=other;}else preselect(found[0],current===row.codeKey?'same':'auto');
   }else{
    const holding=visible.filter(customer=>customerCodeKey(customer.data.code)===row.codeKey);
    if(holding.length===1)preselect(holding[0],'same');else base.status='choose';
   }
  }else if(held.length||mapped){
   // 2. By the code: the CRM already knows this number. Never added.
   if(mapped&&!held.includes(mapped))held.push(mapped);
   for(const holder of held)involved.set(holder.id,holder.version);
   if(heldOutsideRegions(options.me,held,mapping,byId)){base.status='held-outside';return refuseChoice();}
   const visible=held.filter(inScope);
   offer(visible.length);
   base.candidates=visible.map(customer=>view(customer,'code'));
   several=visible.length>1;
   const owner=mapped||(visible.length===1?visible[0]:undefined),current=owner?customerCodeKey(owner.data.code):'';
   // The holder's current code is another row of this file (it keeps this number only as an old code or a mapping): the user confirms.
   const other=owner&&current!==row.codeKey&&fileCodes.get(current)||0;
   if(owner&&!other)preselect(owner,'same');else{base.status='choose';base.codeRow=other;}
  }else{
   // 3. and 4. Not in the CRM: a similar name to choose from, or a new customer.
   if(!row.name&&!row.nameEn){base.issue='no-name';return refuseChoice();}
   const similar=similarTo(row),visible=similar.filter(inScope).slice(0,ERP_SIMILAR_MAX);
   // Similar names only outside the member's regions: maybe a customer they cannot see, so never added (as a phone or name match there).
   if(!visible.length&&similar.length){for(const customer of similar.slice(0,ERP_SIMILAR_MAX))involved.set(customer.id,customer.version);base.status='out-of-region';base.matchedBy='similar';return refuseChoice();}
   for(const customer of visible)involved.set(customer.id,customer.version);
   offer(visible.length);
   base.candidates=visible.map(customer=>view(customer,'similar'));
   if(visible.length)base.status='similar';else{base.status='new';base.add=true;}
  }
  if(choices.has(row.row)){
   const chosen=choices.get(row.row)!;
   if(chosen===ERP_ADD_CUSTOMER){
    if(base.status!=='new'&&base.status!=='similar')fail(`السطر ${row.row} ليس عميلًا جديدًا؛ أجرِ معاينة جديدة`);
    Object.assign(base,{add:true,chosen:true,customerId:'',matchedBy:''});
   }else{
    if(chosen&&!base.candidates.some(customer=>customer.id===chosen))fail(base.candidates.length?`العميل المختار للسطر ${row.row} ليس من المرشحين؛ أجرِ معاينة جديدة`:`السطر ${row.row} لا يقبل اختيار عميل`);
    Object.assign(base,{add:false,chosen:true,customerId:chosen,matchedBy:chosen?base.candidates.find(customer=>customer.id===chosen)!.matchedBy:''});
    if((several||base.codeRow)&&base.status!=='similar')base.status='choose';
   }
  }
  return base;
 });
 // A customer has one code: every row ending on the same customer becomes a choice, and the apply is refused until one remains.
 const targets=new Map<string,number>();for(const outcome of outcomes)if(outcome.customerId)targets.set(outcome.customerId,(targets.get(outcome.customerId)||0)+1);
 const plan:ErpCustomerPlan[]=[],adds:ErpCustomerAdd[]=[];
 outcomes.forEach((outcome,index)=>{
  const row=rows[index];
  if(outcome.add){adds.push({row:row.row,code:row.code,codeKey:row.codeKey,name:(row.name||row.nameEn).slice(0,250).trim(),phone:row.contact.mobile,phone2:row.contact.phone,email:row.contact.email,address:row.contact.address});return;}
  if(!outcome.customerId)return;
  if((targets.get(outcome.customerId)||0)>1){outcome.conflict=true;if(outcome.status!=='similar')outcome.status='choose';}
  const customer=byId.get(outcome.customerId)!,mapping=mappings.get(row.codeKey);
  const sharedWith=(holders.get(row.codeKey)||[]).filter(holder=>holder.id!==customer.id).length,codeChange=customerCodeKey(customer.data.code)!==row.codeKey;
  // Found by its code and not picked: the customer already holds the number (maybe as a kept old code); nothing is written.
  if(outcome.matchedBy==='code'&&!outcome.chosen){Object.assign(outcome,{from:String(customer.data.code||''),sharedWith});return;}
  Object.assign(outcome,{from:String(customer.data.code||''),sharedWith,mapping:sharedWith>0&&mapping?.customerId!==customer.id});
  outcome.change=codeChange||outcome.mapping;
  if(outcome.change&&!outcome.conflict)plan.push({row:outcome.row,customerId:customer.id,version:customer.version,codeKey:row.codeKey,from:outcome.from,to:row.code,codeChange,mapping:outcome.mapping,mappingVersion:outcome.mapping?mapping?.version||0:0});
 });
 // Every customer the file names in any way; the rest of `me`'s customers that still carry an ERP code are the ones the ERP does not have.
 const named=new Set<string>(),mark=(list?:Row[])=>{for(const customer of list||[])named.add(customer.id);};
 for(const row of rows){
  for(const key of row.phones)mark(byPhone.get(key));
  for(const key of [nameKey(row.name),nameKey(row.nameEn)])if(key)mark(byName.get(key));
  if(row.codeKey){mark(holders.get(row.codeKey));const mapping=mappings.get(row.codeKey);if(mapping)named.add(mapping.customerId);}
 }
 for(const outcome of outcomes){for(const candidate of outcome.candidates)named.add(candidate.id);if(outcome.customerId)named.add(outcome.customerId);}
 const clears:ErpCustomerClear[]=all.filter(customer=>!named.has(customer.id)&&inScope(customer)&&customerCodeKey(customer.data.code)).sort(order)
  .map(customer=>({customerId:customer.id,version:customer.version,name:String(customer.data.name||''),internalCode:String(customer.data.internalCode||''),code:String(customer.data.code),region:String(customer.data.region||'')}));
 const count=(test:(outcome:ErpCustomerOutcome)=>boolean)=>outcomes.filter(test).length;
 const summary:ErpCustomersSummary={rows:outcomes.length,auto:count(o=>o.status==='auto'),same:count(o=>o.status==='same'),choose:count(o=>o.status==='choose'),similar:count(o=>o.status==='similar'),new:count(o=>o.status==='new'),outOfRegion:count(o=>o.status==='out-of-region'),heldOutside:count(o=>o.status==='held-outside'),invalid:count(o=>o.status==='invalid'),conflicts:count(o=>o.conflict),pending:count(o=>(o.status==='choose'||o.status==='similar')&&!o.customerId&&!o.chosen),changes:plan.length,codeChanges:plan.filter(p=>p.codeChange).length,mappings:plan.filter(p=>p.mapping).length,adds:adds.length};
 return {rows:outcomes,summary,plan,adds,clears,involved:[...involved].sort(([a],[b])=>a<b?-1:a>b?1:0)};
}

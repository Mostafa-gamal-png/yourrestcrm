import type {Member,Row} from './crm';
import {customerCodeKey,customerCodeCandidates,type CustomerCodeMapping} from './customer-identity';
import {memberCanAccessRegion,regionScope} from './regions';

/** The ERP customer export (sheet "Customer": a title row, this header row, then one customer per row). Only the number is written
 * to the CRM, as the customer's ERP code; the names and phones only find the customer, and nothing else in the CRM changes. */
export const erpCustomerColumns={code:'رقم العميل',idNumber:'رقم الهوية',name:'الاسم بالعربي',nameEn:'الاسم بالانجليزي',mobile:'رقم الجوال',phone:'رقم الهاتف',email:'البريد الالكتروني',address:'العنوان',date:'التاريخ'} as const;
export const ERP_CUSTOMERS_MAX_ROWS=20000;
/** A row whose phone cells list more numbers than this (or a cell longer than ERP_CUSTOMER_MAX_PHONE_CELL characters) is not read, and a
 * row that matches more customers than ERP_CUSTOMER_MAX_CANDIDATES is not offered: no real customer looks like that, and the preview stays small. */
export const ERP_CUSTOMER_MAX_PHONES=5,ERP_CUSTOMER_MAX_PHONE_CELL=200,ERP_CUSTOMER_MAX_CANDIDATES=20;
/** Candidates offered in one preview, all rows together (two per row of a full file): beyond it the file is refused, never sent. */
export const ERP_CUSTOMERS_MAX_OFFERED=40000;
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

export type SheetLike={name:string;rows:{rowNumber:number;cells:string[]}[]};
export type ErpCustomerRow={row:number;code:string;codeKey:string;name:string;nameEn:string;phones:string[];issue:''|'no-code'|'long-code'|'duplicate-code'|'too-many-phones'};
type Columns={code:number;name:number;nameEn:number;mobile:number;phone:number};
function headerColumns(cells:string[]):Columns|null{
 const keys=cells.map(headerKey),index=(label:string)=>{const key=headerKey(label),at=keys.indexOf(key);if(at>=0&&keys.lastIndexOf(key)!==at)fail(`عمود مكرر في الملف: ${label}`);return at;};
 const code=index(erpCustomerColumns.code);if(code<0)return null;
 const columns={code,name:index(erpCustomerColumns.name),nameEn:index(erpCustomerColumns.nameEn),mobile:index(erpCustomerColumns.mobile),phone:index(erpCustomerColumns.phone)};
 return columns.name<0&&columns.nameEn<0&&columns.mobile<0&&columns.phone<0?null:columns;
}
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
   const phones=long?[]:[...new Set(phoneCells.flatMap(phoneKeys))],crowded=long||phones.length>ERP_CUSTOMER_MAX_PHONES;
   rows.push({row:source.rowNumber,code,codeKey:customerCodeKey(code),name:cell(columns.name).slice(0,300),nameEn:cell(columns.nameEn).slice(0,300),phones:crowded?[]:phones,issue:!code?'no-code':code.length>100?'long-code':crowded?'too-many-phones':''});
   if(rows.length>ERP_CUSTOMERS_MAX_ROWS)fail(`الحد الأقصى للملف ${ERP_CUSTOMERS_MAX_ROWS} عميل`);
  }
  const numbered=(row:ErpCustomerRow)=>!row.issue||row.issue==='too-many-phones',counts=new Map<string,number>();
  for(const row of rows)if(numbered(row))counts.set(row.codeKey,(counts.get(row.codeKey)||0)+1);
  for(const row of rows)if(numbered(row)&&(counts.get(row.codeKey)||0)>1)row.issue='duplicate-code';
  if(!rows.length)fail('ملف عملاء ERP لا يحتوي صفوف عملاء بعد العناوين');
  return {sheet:sheet.name,rows};
 }
 return fail(`ده مش ملف عملاء ERP: لازم يكون فيه عمود «${erpCustomerColumns.code}» ومعاه عمود الاسم أو الجوال. صدّر ملف العملاء من ERP زي ما هو.`);
}

export type MatchedBy='phone'|'name'|'both';
export type ErpCustomerCandidate={id:string;name:string;internalCode:string;code:string;region:string;phones:string[];matchedBy:MatchedBy};
export type ErpCustomerStatus='auto'|'same'|'choose'|'missing'|'out-of-region'|'held-outside'|'invalid';
/** One ERP row. `customerId` is the customer it ends on ('' when none); `from` → `to` its ERP code before and after; `sharedWith` how many
 * other customers hold that number (current code or kept alias), in which case `mapping` says an explicit mapping is written. `codeRow`
 * is the other row of the file that carries the single candidate's current code (0 when none): then the row is a choice, not automatic. */
export type ErpCustomerOutcome={row:number;code:string;name:string;phones:string[];status:ErpCustomerStatus;issue:ErpCustomerRow['issue']|'too-many-matches';matchedBy:MatchedBy|'';candidates:ErpCustomerCandidate[];customerId:string;chosen:boolean;conflict:boolean;codeRow:number;from:string;to:string;change:boolean;mapping:boolean;sharedWith:number};
export type ErpCustomerPlan={row:number;customerId:string;version:number;codeKey:string;from:string;to:string;codeChange:boolean;mapping:boolean;mappingVersion:number};
export type ErpCustomersSummary={rows:number;auto:number;same:number;choose:number;missing:number;outOfRegion:number;heldOutside:number;invalid:number;conflicts:number;pending:number;changes:number;codeChanges:number;mappings:number};

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
/** Matches every ERP row to CRM customers by phone or full name, applies the user's choices (row → customer id, '' to leave the row),
 * and plans the code changes. Pure: `customers` are the CRM customers (all of them, for holders and hidden candidates), `me` limits
 * which customers may be shown or changed, `mappings` are the stored explicit code mappings. Candidates outside `me`'s regions are never
 * returned; a row whose candidates are all outside reads `out-of-region`, and a row whose number a customer outside them holds reads
 * `held-outside` (heldOutsideRegions), both with no details. A row matching more than ERP_CUSTOMER_MAX_CANDIDATES customers is `invalid`
 * (`too-many-matches`). A single candidate whose current code is another row of the file is a choice; among several candidates, the one
 * that already has exactly this number is preselected as `same`. Two rows ending on one customer are both `choose` and
 * `conflict`, and `summary.conflicts` must be 0 before the plan is applied. `involved` (every candidate, visible or not, with its version)
 * is what the preview's snapshot covers; it is for the server only. */
export function matchErpCustomers(rows:ErpCustomerRow[],customers:Row[],options:{me:Member;mappings?:CustomerCodeMapping[];choices?:Map<number,string>}){
 const all=customers.filter(row=>row.kind==='customer'),byPhone=new Map<string,Row[]>(),byName=new Map<string,Row[]>(),holders=customerCodeCandidates(all);
 for(const customer of all){for(const key of new Set([...phoneKeys(customer.data.phone),...phoneKeys(customer.data.phone2)]))push(byPhone,key,customer);const key=nameKey(customer.data.name);if(key)push(byName,key,customer);}
 const mappings=new Map((options.mappings||[]).map(mapping=>[mapping.codeKey,mapping])),choices=options.choices||new Map<number,string>(),byId=new Map(all.map(row=>[row.id,row]));
 const inScope=(customer:Row)=>memberCanAccessRegion(options.me,customer.data.region),involved=new Map<string,number>(),limited=regionScope(options.me)!=='all';
 const view=(customer:Row,matchedBy:MatchedBy):ErpCustomerCandidate=>({id:customer.id,name:String(customer.data.name||''),internalCode:String(customer.data.internalCode||''),code:String(customer.data.code||''),region:String(customer.data.region||''),phones:[...new Set([...phoneKeys(customer.data.phone),...phoneKeys(customer.data.phone2)])].map(tail),matchedBy});
 let offered=0;
 const known=new Set(rows.map(row=>row.row)),fileCodes=new Map(rows.filter(row=>!row.issue).map(row=>[row.codeKey,row.row]));
 for(const [row] of choices)if(!known.has(row))fail(`اختيار لسطر غير موجود في الملف (${row})؛ اعمل معاينة جديدة`);
 const outcomes:ErpCustomerOutcome[]=rows.map(row=>{
  const base:ErpCustomerOutcome={row:row.row,code:row.code,name:row.name||row.nameEn,phones:row.phones.map(tail),status:'invalid',issue:row.issue,matchedBy:'',candidates:[],customerId:'',chosen:false,conflict:false,codeRow:0,from:'',to:row.code,change:false,mapping:false,sharedWith:0};
  const refuseChoice=()=>{if(choices.has(row.row))fail(`السطر ${row.row} لا يقبل اختيار عميل`);return base;};
  if(row.issue)return refuseChoice();
  // Every list is bounded before it is merged: a phone or name that many customers share makes the row too wide to offer.
  const hits=(keys:string[],map:Map<string,Row[]>)=>keys.map(key=>map.get(key)||[]),phoneLists=hits(row.phones,byPhone),nameLists=hits([...new Set([nameKey(row.name),nameKey(row.nameEn)])].filter(Boolean),byName);
  const wide=()=>{base.issue='too-many-matches';return refuseChoice();};
  if([...phoneLists,...nameLists].some(list=>list.length>ERP_CUSTOMER_MAX_CANDIDATES))return wide();
  const byPhoneHits=new Set(phoneLists.flat()),byNameHits=new Set(nameLists.flat()),found=[...new Set([...byPhoneHits,...byNameHits])];
  if(found.length>ERP_CUSTOMER_MAX_CANDIDATES)return wide();
  const visible=found.filter(inScope);
  for(const customer of found)involved.set(customer.id,customer.version);
  if(!found.length){base.status='missing';return refuseChoice();}
  if(!visible.length){base.status='out-of-region';return refuseChoice();}
  // A member limited to regions: the number's holders and its mapping are part of what the preview showed (a region change moves a version).
  const held=holders.get(row.codeKey)||[],mapping=mappings.get(row.codeKey);
  if(limited){for(const holder of held)involved.set(holder.id,holder.version);const mapped=mapping&&byId.get(mapping.customerId);if(mapped)involved.set(mapped.id,mapped.version);}
  if(heldOutsideRegions(options.me,held,mapping,byId)){base.status='held-outside';return refuseChoice();}
  const matched=(customer:Row):MatchedBy=>byPhoneHits.has(customer)&&byNameHits.has(customer)?'both':byPhoneHits.has(customer)?'phone':'name';
  if((offered+=visible.length)>ERP_CUSTOMERS_MAX_OFFERED)fail('سطور الملف بتطابق نفس العملاء أكتر من اللازم؛ صدّر ملف العملاء من ERP زي ما هو.');
  base.candidates=visible.map(customer=>view(customer,matched(customer)));
  const preselect=(customer:Row,status:ErpCustomerStatus)=>{base.status=status;base.customerId=customer.id;base.matchedBy=matched(customer);};
  if(found.length===1){
   const current=customerCodeKey(found[0].data.code),other=current!==row.codeKey&&fileCodes.get(current)||0;
   // The customer's current code is another customer of this file: the shared phone or name may be someone else's. The user confirms.
   if(other){base.status='choose';base.codeRow=other;}else preselect(found[0],current===row.codeKey?'same':'auto');
  }else{
   const holding=visible.filter(customer=>customerCodeKey(customer.data.code)===row.codeKey);
   if(holding.length===1)preselect(holding[0],'same');else base.status='choose';
  }
  if(choices.has(row.row)){
   const chosen=choices.get(row.row)!;if(chosen&&!visible.some(customer=>customer.id===chosen))fail(`العميل المختار للسطر ${row.row} مش من المرشحين؛ اعمل معاينة جديدة`);
   base.customerId=chosen;base.chosen=true;base.matchedBy=chosen?matched(byId.get(chosen)!):'';
   if(found.length>1||base.codeRow)base.status='choose';
  }
  return base;
 });
 // A customer has one code: every row ending on the same customer becomes a choice, and the apply is refused until one remains.
 const targets=new Map<string,number>();for(const outcome of outcomes)if(outcome.customerId)targets.set(outcome.customerId,(targets.get(outcome.customerId)||0)+1);
 const plan:ErpCustomerPlan[]=[];
 outcomes.forEach((outcome,index)=>{
  if(!outcome.customerId)return;
  if((targets.get(outcome.customerId)||0)>1){outcome.conflict=true;outcome.status='choose';}
  const customer=byId.get(outcome.customerId)!,row=rows[index],mapping=mappings.get(row.codeKey);
  const sharedWith=(holders.get(row.codeKey)||[]).filter(holder=>holder.id!==customer.id).length,codeChange=customerCodeKey(customer.data.code)!==row.codeKey;
  Object.assign(outcome,{from:String(customer.data.code||''),sharedWith,mapping:sharedWith>0&&mapping?.customerId!==customer.id});
  outcome.change=codeChange||outcome.mapping;
  if(outcome.change&&!outcome.conflict)plan.push({row:outcome.row,customerId:customer.id,version:customer.version,codeKey:row.codeKey,from:outcome.from,to:row.code,codeChange,mapping:outcome.mapping,mappingVersion:outcome.mapping?mapping?.version||0:0});
 });
 const count=(test:(outcome:ErpCustomerOutcome)=>boolean)=>outcomes.filter(test).length;
 const summary:ErpCustomersSummary={rows:outcomes.length,auto:count(o=>o.status==='auto'),same:count(o=>o.status==='same'),choose:count(o=>o.status==='choose'),missing:count(o=>o.status==='missing'),outOfRegion:count(o=>o.status==='out-of-region'),heldOutside:count(o=>o.status==='held-outside'),invalid:count(o=>o.status==='invalid'),conflicts:count(o=>o.conflict),pending:count(o=>o.status==='choose'&&!o.customerId&&!o.chosen),changes:plan.length,codeChanges:plan.filter(p=>p.codeChange).length,mappings:plan.filter(p=>p.mapping).length};
 return {rows:outcomes,summary,plan,involved:[...involved].sort(([a],[b])=>a<b?-1:a>b?1:0)};
}

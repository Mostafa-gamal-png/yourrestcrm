// «كشف حساب» of the ERP (the owner's «Account_Balance_Sheet_F_T.xls», 2026-11-11), read for the monthly collection of each representative.
// The ERP saves it as an HTML table in UTF-16LE with an .xls name (an .xlsx of the same columns is read too, with the sales report's
// reader). One title row «كشف حساب لـ <from> _ <to>» (a range of account numbers, no dates), one header row of ten columns, then one row
// for each customer account. Pure: no database, no member; the server (lib/erp-collections-server.ts) maps names to members and writes.
//
// Meaning (stated on the preview; the owner can change it): for the chosen month, an account's
//   collected = «حركة الفترة دائن»
//   due       = max(0, «الرصيد السابق مدين» − «الرصيد السابق دائن») + «حركة الفترة مدين»
// and an account belongs to «المندوب» (to «المحصل» when «المندوب» is empty). «مبيعات مكتب» is the office: left out, as in the sales import.
// A row adds up when current = previous + period, each as debit − credit.
import {isOfficeEmployee,normalizeErpText,readWorkbookSheets,ErpWorkbookError} from './erp-sales';

export const COLLECTION_FILE_MAX_BYTES=2*1024*1024;
const MAX_ROWS=5000,MAX_CELLS=60,MAX_CELL=1000,MAX_CENTS=1_000_000_000_000;
export const COLLECTION_COLUMNS={
 accountNo:'رقم الحساب',accountName:'اسم الحساب',rep:'المندوب',collector:'المحصل',
 previousDebit:'الرصيد السابق مدين',previousCredit:'الرصيد السابق دائن',periodDebit:'حركة الفترة مدين',periodCredit:'حركة الفترة دائن',
 currentDebit:'الرصيد الحالي مدين',currentCredit:'الرصيد الحالي دائن',
} as const;
type Column=keyof typeof COLLECTION_COLUMNS;
const columnNames=Object.keys(COLLECTION_COLUMNS) as Column[];
const amountColumns=['previousDebit','previousCredit','periodDebit','periodCredit','currentDebit','currentCredit'] as const;
type AmountColumn=typeof amountColumns[number];

export type CollectionRow={rowNumber:number;accountNo:string;accountName:string;rep:string;collector:string}&Record<AmountColumn,number>;
export type CollectionStatement={title:string;rows:CollectionRow[]};

export class CollectionStatementError extends Error{constructor(message:string){super(message);this.name='CollectionStatementError';}}
function fail(message:string):never{throw new CollectionStatementError(message);}
const headerKey=(value:unknown)=>normalizeErpText(value).replace(/[أإآ]/g,'ا').replace(/ـ/g,'').toLowerCase();
/** Full names only, as the sales import matches them: no guessing from partial names or spelling similarity. */
export const collectionNameKey=(value:unknown)=>normalizeErpText(value).toLowerCase();
const digits=(value:string)=>value.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0));

/** A balance in whole halalas. Empty is zero (the ERP leaves an empty balance blank); Arabic digits, «٫», «٬» and thousands commas are read;
 *  a negative amount or anything that is not a number refuses the file with its row. */
export function collectionCents(value:string,label:string,row:number):number{
 let input=digits(normalizeErpText(value)).replace(/٬/g,',').replace(/٫/g,'.').replace(/\s/g,'');
 if(!input||input==='-')return 0;
 if(/^-|^\(.*\)$/.test(input))fail(`السطر ${row}: ${label} قيمة سالبة غير متوقعة في كشف الحساب`);
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(input))fail(`السطر ${row}: ${label} ليس رقمًا صالحًا`);
 input=input.replace(/,/g,'');
 const [whole,fraction='']=input.split('.'),cents=Number(whole)*100+Number((fraction+'00').slice(0,2))+(Number(fraction[2]||'0')>=5?1:0);
 if(whole.length>13||!Number.isSafeInteger(cents)||cents>MAX_CENTS)fail(`السطر ${row}: ${label} يتجاوز الحد المسموح`);
 return cents;
}

function decode(bytes:Uint8Array):string{
 const utf16=(littleEndian:boolean,offset:number)=>{try{return new TextDecoder(littleEndian?'utf-16le':'utf-16be',{fatal:true}).decode(bytes.subarray(offset));}catch{fail('ترميز ملف كشف الحساب غير صالح؛ صدّره من ERP مرة أخرى');}};
 if(bytes[0]===0xff&&bytes[1]===0xfe)return utf16(true,2);
 if(bytes[0]===0xfe&&bytes[1]===0xff)return utf16(false,2);
 // Without a byte-order mark: UTF-16LE when the text starts with «<» and a zero byte, as the ERP writes it; else UTF-8.
 if(bytes.length>3&&bytes[0]===0x3c&&bytes[1]===0)return utf16(true,0);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?bytes.subarray(3):bytes);}catch{fail('ترميز ملف كشف الحساب غير صالح؛ صدّره من ERP مرة أخرى');}
}
const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function cellText(html:string):string{
 // Markup inside a cell (<center>, <b>, <font> …) is dropped; only XML's entities, &nbsp; and numeric references are decoded, once.
 const text=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi,(match,entity:string)=>{
  if(entity[0]!=='#')return entities[entity.toLowerCase()]??match;
  const point=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
  return Number.isInteger(point)&&point>0&&point<=0x10ffff&&(point<0xd800||point>0xdfff)?String.fromCodePoint(point):'';
 });
 if(text.length>MAX_CELL)fail('قيمة خلية في كشف الحساب أطول من المسموح');
 return text;
}
/** The rows of the first table of an HTML export, each as its cells' text. A closing tag the ERP leaves out (</td>, </tr>) is tolerated. */
function htmlRows(text:string):{rowNumber:number;cells:string[]}[]{
 if(!/<table\b/i.test(text))fail('هذا الملف ليس كشف حساب ERP: لا يحتوي جدولًا');
 if(/<script\b/i.test(text))fail('ملف كشف الحساب يحتوي محتوى غير مسموح');
 const table=text.slice(text.search(/<table\b/i)),end=table.search(/<\/table\s*>/i),body=end<0?table:table.slice(0,end);
 const chunks=body.split(/<tr\b[^>]*>/i).slice(1);
 if(chunks.length>MAX_ROWS+10)fail('الحد الأقصى لكشف الحساب 5000 حساب');
 return chunks.map((chunk,index)=>{
  const row=chunk.split(/<\/tr\s*>/i)[0],parts=row.split(/<t[dh]\b[^>]*>/i).slice(1);
  if(parts.length>MAX_CELLS)fail('عدد أعمدة كشف الحساب يتجاوز الحد المسموح');
  return {rowNumber:index+1,cells:parts.map(part=>cellText(part.split(/<\/t[dh]\s*>/i)[0]).trim())};
 });
}
function headerColumns(cells:string[]):Record<Column,number>|null{
 const keys=cells.map(headerKey);
 if(!keys.includes(headerKey(COLLECTION_COLUMNS.accountNo))||!keys.includes(headerKey(COLLECTION_COLUMNS.accountName)))return null;
 const columns={} as Record<Column,number>,missing:string[]=[];
 for(const column of columnNames){
  const key=headerKey(COLLECTION_COLUMNS[column]),index=keys.indexOf(key);
  if(index<0){missing.push(COLLECTION_COLUMNS[column]);continue;}
  if(keys.lastIndexOf(key)!==index)fail(`عمود مكرر في كشف الحساب: ${COLLECTION_COLUMNS[column]}`);
  columns[column]=index;
 }
 if(missing.length)fail(`كشف الحساب ينقصه عمود مطلوب: ${missing.join('، ')}`);
 return columns;
}

/** The statement's rows. Refuses a file whose header is not the ERP's ten columns, a duplicated account and an unreadable amount. */
export function parseCollectionStatement(bytes:Uint8Array):CollectionStatement{
 if(!(bytes instanceof Uint8Array)||!bytes.length)fail('ملف كشف الحساب فارغ');
 if(bytes.length>COLLECTION_FILE_MAX_BYTES)fail('أقصى حجم لملف كشف الحساب 2 ميجابايت');
 let source:{rowNumber:number;cells:string[]}[];
 if(bytes[0]===0x50&&bytes[1]===0x4b){
  // The same report saved as .xlsx: the sales report's strict reader (formulas, macros and external links refused there).
  try{const sheets=readWorkbookSheets(bytes,{maxRows:MAX_ROWS+10});if(sheets.length!==1)fail('ارفع كشف الحساب في ورقة Excel واحدة');source=sheets[0].rows;}
  catch(error){if(error instanceof ErpWorkbookError)fail(error.message);throw error;}
 } else source=htmlRows(decode(bytes));
 let columns:Record<Column,number>|null=null,headerIndex=-1;
 for(let i=0;i<Math.min(20,source.length)&&!columns;i++){columns=headerColumns(source[i].cells);if(columns)headerIndex=i;}
 if(!columns)fail('هذا الملف ليس كشف حساب ERP المتوقع: لم تُعثر على عناوين الأعمدة (رقم الحساب، اسم الحساب، المندوب، المحصل، الأرصدة والحركة)');
 const title=source.slice(0,headerIndex).flatMap(row=>row.cells).map(cell=>normalizeErpText(cell)).find(cell=>cell.startsWith('كشف حساب'))||'';
 const rows:CollectionRow[]=[],accounts=new Map<string,number>();
 for(const row of source.slice(headerIndex+1)){
  const cell=(column:Column)=>normalizeErpText(row.cells[columns![column]]??'');
  if(row.cells.every(value=>!normalizeErpText(value)))continue;
  if(headerColumns(row.cells))continue;// a header repeated on a printed page
  const accountNo=digits(cell('accountNo')),accountName=cell('accountName');
  if(!accountNo){
   if(/^(?:الاجمالي|الإجمالي|المجموع|اجمالي|إجمالي|total|grand total)/i.test(accountName)||!accountName)continue;// a totals row
   fail(`السطر ${row.rowNumber}: رقم الحساب مطلوب`);
  }
  if(accountNo.length>100||accountName.length>300||cell('rep').length>200||cell('collector').length>200)fail(`السطر ${row.rowNumber}: قيمة أطول من المسموح`);
  if(accounts.has(accountNo))fail(`السطر ${row.rowNumber}: رقم الحساب مكرر في الكشف (السطر ${accounts.get(accountNo)})`);
  accounts.set(accountNo,row.rowNumber);
  const amounts=Object.fromEntries(amountColumns.map(column=>[column,collectionCents(cell(column),COLLECTION_COLUMNS[column],row.rowNumber)])) as Record<AmountColumn,number>;
  rows.push({rowNumber:row.rowNumber,accountNo,accountName,rep:cell('rep'),collector:cell('collector'),...amounts});
  if(rows.length>MAX_ROWS)fail('الحد الأقصى لكشف الحساب 5000 حساب');
 }
 if(!rows.length)fail('كشف الحساب لا يحتوي حسابات قابلة للقراءة');
 return {title,rows};
}

/** current = previous + period, each as debit − credit, to the halala. */
export const rowAddsUp=(row:CollectionRow)=>row.currentDebit-row.currentCredit===row.previousDebit-row.previousCredit+row.periodDebit-row.periodCredit;
export const accountDueCents=(row:CollectionRow)=>Math.max(0,row.previousDebit-row.previousCredit)+row.periodDebit;
export const accountCollectedCents=(row:CollectionRow)=>row.periodCredit;
export type CollectionGroup={key:string;name:string;accounts:number;dueCents:number;collectedCents:number;mismatches:number;fromCollector:number};
export type CollectionSummary={groups:CollectionGroup[];rows:number;officeRows:number;officeDueCents:number;officeCollectedCents:number;noRepRows:number;noRepDueCents:number;noRepCollectedCents:number;mismatchRows:number};
/** The statement grouped by the name each account belongs to. The office and accounts with no name are counted apart, never in a group. */
export function summarizeCollections(rows:CollectionRow[]):CollectionSummary{
 const groups=new Map<string,CollectionGroup>(),summary:Omit<CollectionSummary,'groups'>={rows:rows.length,officeRows:0,officeDueCents:0,officeCollectedCents:0,noRepRows:0,noRepDueCents:0,noRepCollectedCents:0,mismatchRows:0};
 for(const row of rows){
  const owner=row.rep||row.collector,due=accountDueCents(row),collected=accountCollectedCents(row),balanced=rowAddsUp(row);
  if(!balanced)summary.mismatchRows++;
  if(!owner){summary.noRepRows++;summary.noRepDueCents+=due;summary.noRepCollectedCents+=collected;continue;}
  if(isOfficeEmployee(owner)){summary.officeRows++;summary.officeDueCents+=due;summary.officeCollectedCents+=collected;continue;}
  const key=collectionNameKey(owner),group=groups.get(key)||{key,name:normalizeErpText(owner),accounts:0,dueCents:0,collectedCents:0,mismatches:0,fromCollector:0};
  group.accounts++;group.dueCents+=due;group.collectedCents+=collected;if(!balanced)group.mismatches++;if(!row.rep)group.fromCollector++;
  groups.set(key,group);
 }
 return {...summary,groups:[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'))};
}
/** Collected as a share of due, two decimals; none when nothing is due. */
export const collectionPercent=(dueCents:number,collectedCents:number)=>dueCents>0?Math.round(collectedCents/dueCents*10000)/100:null;

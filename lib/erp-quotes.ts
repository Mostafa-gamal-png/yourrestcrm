// «استيراد عروض الأسعار من ERP» (the owner, 2026-11-11): the ERP's quotations report («عروض الأسعار», Reports_Invoices_*.xls), read and
// planned as pure functions; lib/erp-quotes-server.ts reads the CRM, checks the member and writes.
//
// The file. The ERP saves the report as an HTML table with a .xls name (UTF-16LE with a byte-order mark: <TABLE><TR><TD>…), one row per
// quotation LINE, 197 columns; the same columns saved as .xlsx are read too (lib/erp-sales.ts readWorkbookSheets). The HTML is never
// rendered: only the text of an allow-list of table and layout elements is read (a <script>, <iframe>, <object>, <img>, <a> … refuses the
// file), attributes are ignored, and the rows, columns, cell lengths and elements are bounded. A file whose rows are not quotations
// (Trans_Type_Code other than «Qut») is refused as a whole, naming the row.
//
// The columns, as the owner's file was checked (sums per quotation, 38 of 38 agreeing, 2026-11-11):
//   Code         the quotation's number («Qut-…»): the key of the import, the CRM quote's number; the lines of one quotation share it.
//   Date1 / Expiration_Date      the issue date / valid until (yyyy/mm/dd); a missing or earlier validity is the issue date.
//   CustomerCode the customer's ERP code (matched to the CRM customer by lib/customer-identity.ts uniqueCustomerCodes).
//   Emp_Code / Emp_name          the ERP's sales employee (mapped to a CRM representative as the ERP sales import maps it).
//   Item_Name, Description, Item_Code (or Barcode), Cat_Name, UnitName: the line.
//   Qty, Price   the quantity and unit price (before VAT).
//   Discount_Amount  the line's discount (an amount; Disc_rate is its rate).
//   Total        the line's net: Qty × Price − Discount_Amount.   VAT the rate (%), VAT_Amount the line's VAT, NewTotal the line with VAT.
//   Discount_Amount_M   the document's discount (Discount_Rate_M its rate).
//   Subtotal     the document's net: Σ Total − Discount_Amount_M (NOT the gross; the owner's notes called it «Subtotal»).
//   VAT_AmountM  the document's VAT: Subtotal × VAT, to the halala.
//   NewSubtotal  the document's total with VAT: Subtotal + VAT_AmountM (NewTotal is per line, not the document's total).
//   Payment_Terms_Name, Delivery_Term, Document_Note: the quote's terms.
//
// A CRM quote (lib/crm.ts schemas.quote) has one discount and one VAT rate: the line discounts and the document's discount become its
// discount, so the CRM's own sums (quoteTotals) give the same net; the stored subtotal/tax/total are the ERP's figures (subtotal being the
// gross before discounts, as the CRM prints it), and when the CRM's computation differs from them by more than a halala the quote is
// marked (`_erp.totalsDiffer`) and still shows the ERP's figures.
import {readWorkbookSheets,ErpWorkbookError,isOfficeEmployee} from './erp-sales';
import {schemas,quoteTotals,type Member,type Row} from './crm';
import {customerCodeKey} from './customer-identity';
import {lineCents} from './decimal-money';

export class ErpQuotesError extends Error{constructor(message:string){super(message);this.name='ErpQuotesError';}}
const fail=(message:string):never=>{throw new ErpQuotesError(message);};

export const ERP_QUOTES_MAX_BYTES=5*1024*1024;
export const ERP_QUOTES_MAX_ROWS=5000;
/** schemas.quote: at most 50 items. */
export const ERP_QUOTES_MAX_LINES=50;
const MAX_COLUMNS=300,MAX_CELL=5000,MAX_ELEMENTS=2_000_000;
export const ERP_QUOTES_NAMESPACE='yourrest-industries:erp-quotes';

export type QuoteSheet={rows:{rowNumber:number;cells:string[]}[]};
export type ErpQuoteLine={row:number;itemCode:string;itemName:string;description:string;category:string;unit:string;quantity:number;price:number;discountCents:number;totalCents:number;vatRate:number};
export type ErpQuotation={
 key:string;code:string;rows:number[];transactionId:string;no:string;date:string;validUntil:string;dueDate:string;
 customerCode:string;customerName:string;employeeCode:string;employeeName:string;paymentTerms:string;deliveryTerm:string;note:string;
 vatRate:number;netCents:number;taxCents:number;totalCents:number;documentDiscountCents:number;lines:ErpQuoteLine[];problem:string;
};
export type ErpRowProblem={row:number;reason:string};
export type ErpQuotesFile={quotations:ErpQuotation[];problems:ErpRowProblem[];rowCount:number;deletedRows:number;columns:string[]};

export function normalizeErpQuoteText(value:unknown){return String(value??'').normalize('NFKC').replace(/[​-‏‪-‮⁦-⁩﻿]/g,'').replace(/\s+/g,' ').trim();}
/** The key of a quotation number: what makes «Qut-12», «qut-12 » and «Qut-١٢» the same quotation. */
export const erpQuoteKey=(value:unknown)=>customerCodeKey(normalizeErpQuoteText(value));
const latinDigits=(value:string)=>value.replace(/[٠-٩۰-۹]/g,d=>String(d.charCodeAt(0)-(d>='۰'?0x6f0:0x660)));

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------------------------------------------------------------

/** The text of the ERP's HTML export: a byte-order mark says UTF-16 (LE or BE) or UTF-8; without one, UTF-16LE is recognised by its zero
 *  bytes after «<», anything else must be valid UTF-8. */
function decodeHtml(bytes:Uint8Array):string{
 const decode=(label:string,from:number)=>{try{return new TextDecoder(label,{fatal:true}).decode(bytes.subarray(from));}catch{return fail('ترميز ملف عروض الأسعار غير صالح؛ صدّر التقرير من ERP مرة أخرى.');}};
 if(bytes[0]===0xff&&bytes[1]===0xfe)return decode('utf-16le',2);
 if(bytes[0]===0xfe&&bytes[1]===0xff)return decode('utf-16be',2);
 if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)return decode('utf-8',3);
 if(bytes.length>=4&&bytes[0]!==0&&bytes[1]===0&&bytes[3]===0)return decode('utf-16le',0);
 return decode('utf-8',0);
}
const ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function entities(text:string){
 return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi,(match,entity:string)=>{
  if(entity[0]!=='#')return ENTITIES[entity.toLowerCase()]??match;
  const point=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
  return Number.isInteger(point)&&point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):'';
 });
}
/** Elements read for their text (the table) or passed over (layout, the head). Anything else refuses the file. */
const TABLE_TAGS=new Set(['table','thead','tbody','tfoot','tr','td','th','caption','col','colgroup']);
const LAYOUT_TAGS=new Set(['html','head','body','meta','br','font','b','i','u','span','div','p','strong','em','center','small','sub','sup','nobr']);
const SKIPPED_TAGS=new Set(['style','title','xml']);
/** The rows of the single table of an ERP HTML export (each cell's text, normalised). */
export function readErpHtmlTable(bytes:Uint8Array):QuoteSheet{
 const text=decodeHtml(bytes);
 if(text.length>ERP_QUOTES_MAX_BYTES*2)fail('حجم ملف عروض الأسعار أكبر من المسموح.');
 if(text.includes('\0'))fail('ملف عروض الأسعار يحتوي رموزًا غير صالحة.');
 const rows:QuoteSheet['rows']=[];let row:string[]|null=null,cell:string|null=null,tables=0,depth=0,elements=0,at=0;
 const closeCell=()=>{if(cell!==null&&row){const value=normalizeErpQuoteText(entities(cell));if(value.length>MAX_CELL)fail(`السطر ${rows.length+1}: قيمة خلية طويلة جدًا`);row.push(value);if(row.length>MAX_COLUMNS)fail('عدد أعمدة ملف عروض الأسعار يتجاوز الحد المسموح');}cell=null;};
 const closeRow=()=>{closeCell();if(row){if(row.some(Boolean))rows.push({rowNumber:rows.length+1,cells:row});if(rows.length>ERP_QUOTES_MAX_ROWS+1)fail(`الحد الأقصى ${ERP_QUOTES_MAX_ROWS} بند في الملف`);}row=null;};
 while(at<text.length){
  const open=text.indexOf('<',at);
  const chunk=open<0?text.slice(at):text.slice(at,open);
  if(cell!==null)cell+=chunk;
  else if(chunk.trim()&&depth>0&&row)fail('تركيب جدول عروض الأسعار غير صالح (نص خارج الخلايا).');
  if(open<0)break;
  if(text.startsWith('<!--',open)){const end=text.indexOf('-->',open+4);if(end<0)fail('ملف عروض الأسعار غير مكتمل.');at=end+3;continue;}
  if(/^<[!?]/.test(text.slice(open,open+2))){const end=text.indexOf('>',open);if(end<0)fail('ملف عروض الأسعار غير مكتمل.');at=end+1;continue;}
  // The tag runs to the first «>» outside quotes (an attribute may hold «>»; attributes are never read).
  let end=open+1,quote='';
  for(;end<text.length;end++){const c=text[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
  if(end>=text.length)fail('ملف عروض الأسعار غير مكتمل.');
  if(++elements>MAX_ELEMENTS)fail('عدد عناصر ملف عروض الأسعار يتجاوز الحد المسموح');
  const match=/^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(text.slice(open,end));
  if(!match)fail('ملف عروض الأسعار يحتوي وسومًا غير صالحة.');
  const closing=!!match![1],name=match![2].toLowerCase().replace(/^[a-z]+:/,'');
  at=end+1;
  if(SKIPPED_TAGS.has(name)){if(!closing&&text[end-1]!=='/'){const close=text.toLowerCase().indexOf('</'+name,at);if(close<0)fail('ملف عروض الأسعار غير مكتمل.');at=text.indexOf('>',close)+1;if(at<=0)fail('ملف عروض الأسعار غير مكتمل.');}continue;}
  if(!TABLE_TAGS.has(name)&&!LAYOUT_TAGS.has(name))fail(`ملف عروض الأسعار يحتوي عنصرًا غير مسموح: <${name}>`);
  if(name==='br'){if(cell!==null)cell+=' ';continue;}
  if(!TABLE_TAGS.has(name))continue;
  // The ERP ends its table with a second «<TABLE>» instead of «</TABLE>»: at the very end of the file (nothing but closing tags or spaces
  // after it) it closes the table; anywhere else a table inside the table refuses the file.
  if(name==='table'&&!closing&&depth>0&&/^(?:\s|<\/\s*(?:table|body|html)\s*>)*$/i.test(text.slice(at))){closeRow();depth--;at=text.length;continue;}
  if(name==='table'){if(closing){closeRow();depth--;}else{if(depth>0)fail('ملف عروض الأسعار يحتوي جدولًا داخل جدول.');if(++tables>1)fail('ملف عروض الأسعار يجب أن يحتوي جدولًا واحدًا.');depth++;}continue;}
  if(depth<=0)fail('تركيب جدول عروض الأسعار غير صالح.');
  if(name==='tr'){closeRow();if(!closing)row=[];continue;}
  if(name==='td'||name==='th'){closeCell();if(!closing){if(!row)row=[];cell='';}continue;}
 }
 closeRow();
 if(!tables)fail('الملف لا يحتوي جدول عروض أسعار؛ صدّر تقرير عروض الأسعار من ERP.');
 return {rows};
}

const isZip=(bytes:Uint8Array)=>bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===0x03&&bytes[3]===0x04;
/** The report's rows, from the ERP's HTML «.xls» or from an .xlsx with the same columns (the first sheet that has them). */
export function readErpQuotesTable(bytes:Uint8Array):QuoteSheet{
 if(!(bytes instanceof Uint8Array)||!bytes.length)return fail('الملف فارغ.');
 if(bytes.length>ERP_QUOTES_MAX_BYTES)fail('أقصى حجم لملف عروض الأسعار 5 ميجابايت');
 if(!isZip(bytes))return readErpHtmlTable(bytes);
 let sheets;
 try{sheets=readWorkbookSheets(bytes,{maxRows:ERP_QUOTES_MAX_ROWS,maxColumns:MAX_COLUMNS});}catch(error){if(error instanceof ErpWorkbookError)fail(error.message);throw error;}
 const sheet=sheets!.find(s=>s.rows.slice(0,25).some(r=>headerIndex(r.cells)))||sheets![0];
 return {rows:sheet?.rows||[]};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The columns and the quotations
// ---------------------------------------------------------------------------------------------------------------------------------
const REQUIRED=['Code','Trans_Type_Code','Date1','CustomerCode','Emp_Code','Item_Name','Qty','Price','Total','VAT','Subtotal','VAT_AmountM','NewSubtotal'] as const;
const OPTIONAL=['Expiration_Date','Due_Date','Transaction_ID','No','CustomerName','Emp_name','Item_Code','Barcode','Description','Cat_Name','UnitName','Discount_Amount','Discount_Amount_M','Payment_Terms_Name','Delivery_Term','Document_Note','IsDeleted','CurrencyCode','Exchange_Rate'] as const;
type Column=typeof REQUIRED[number]|typeof OPTIONAL[number];
const key=(value:string)=>normalizeErpQuoteText(value).toLowerCase();
function headerIndex(cells:string[]){const keys=cells.map(key);return keys.includes('code')&&keys.includes('trans_type_code');}
/** Header-level fields every line of one quotation must repeat. */
const HEADER_FIELDS=['Date1','Expiration_Date','CustomerCode','Emp_Code','Subtotal','VAT_AmountM','NewSubtotal','Discount_Amount_M','Payment_Terms_Name','Delivery_Term','Document_Note','Transaction_ID','VAT','CurrencyCode'] as const;

function decimalText(value:string,label:string,row:number){
 let input=latinDigits(normalizeErpQuoteText(value)).replace(/٬/g,',').replace(/٫/g,'.').replace(/\s/g,'');
 if(!input)return '0';
 if(/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(input)&&input.length<=32&&Number.isFinite(Number(input))&&Math.abs(Number(input))<=1e9)input=Number(input).toFixed(6).replace(/\.?0+$/,'');
 if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,12})?$/.test(input))fail(`السطر ${row}: ${label} ليس رقمًا صالحًا`);
 input=input.replace(/,/g,'');
 if(!Number.isFinite(Number(input))||Math.abs(Number(input))>1e9)fail(`السطر ${row}: ${label} يتجاوز الحد المسموح`);
 return input;
}
const numberOf=(value:string,label:string,row:number)=>Number(decimalText(value,label,row));
/** Halalas, rounded half up at the third decimal (exact on the decimal text, never on a binary fraction). */
function centsOf(value:string,label:string,row:number){
 const input=decimalText(value,label,row),negative=input.startsWith('-');
 const [whole,fraction='']=input.replace(/^[+-]/,'').split('.');
 const cents=Number(whole)*100+Number((fraction+'00').slice(0,2))+(Number(fraction[2]||'0')>=5?1:0);
 return negative&&cents?-cents:cents;
}
function dateOf(value:string,label:string,row:number,optional=false):string{
 const text=latinDigits(normalizeErpQuoteText(value));
 if(!text){if(optional)return '';fail(`السطر ${row}: ${label} مطلوب`);}
 let y:number,m:number,d:number;
 const ymd=/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s?[AP]M)?Z?)?$/i.exec(text);
 const dmy=/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s?[AP]M)?)?$/i.exec(text);
 if(ymd)[y,m,d]=[Number(ymd[1]),Number(ymd[2]),Number(ymd[3])];
 else if(dmy)[d,m,y]=[Number(dmy[1]),Number(dmy[2]),Number(dmy[3])];
 else if(/^\d{5}(?:\.\d+)?$/.test(text)){const serial=Math.floor(Number(text));if(serial<61||serial>110000)fail(`السطر ${row}: ${label} غير صالح`);return new Date(Date.UTC(1899,11,30)+serial*86400000).toISOString().slice(0,10);}
 else return fail(`السطر ${row}: ${label} غير صالح`);
 const instant=new Date(Date.UTC(y,m-1,d));
 if(y<2000||y>2200||instant.getUTCMonth()!==m-1||instant.getUTCDate()!==d)fail(`السطر ${row}: ${label} غير صالح`);
 return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
const truthy=(value:string)=>['true','1','yes','نعم'].includes(key(value));

/** The quotations of the report, grouped by their number (Code). A row-level fault (a row the reader cannot use) refuses the row's
 *  quotation, named by the row; a file that is not quotations, or lacks a required column, is refused as a whole. */
export function parseErpQuotes(sheet:QuoteSheet):ErpQuotesFile{
 const headerAt=sheet.rows.slice(0,25).findIndex(r=>headerIndex(r.cells));
 if(headerAt<0)fail('لم يُعثر على عناوين تقرير عروض الأسعار من ERP (العمودان Code و Trans_Type_Code)؛ استخدم تقرير عروض الأسعار الأصلي.');
 const header=sheet.rows[headerAt].cells.map(key),columns={} as Record<Column,number>;
 for(const name of [...REQUIRED,...OPTIONAL]){
  const index=header.indexOf(key(name));
  if(index>=0&&header.lastIndexOf(key(name))!==index)fail(`عمود مكرر في ملف عروض الأسعار: ${name}`);
  if(index<0&&(REQUIRED as readonly string[]).includes(name))fail(`عمود مطلوب غير موجود في ملف عروض الأسعار: ${name}`);
  columns[name]=index;
 }
 const groups=new Map<string,{code:string;rows:{row:number;get:(c:Column)=>string}[]}>(),problems:ErpRowProblem[]=[];
 let rowCount=0,deletedRows=0;
 for(const source of sheet.rows.slice(headerAt+1)){
  if(source.cells.every(c=>!normalizeErpQuoteText(c)))continue;
  if(headerIndex(source.cells))continue;
  const get=(c:Column)=>columns[c]>=0?normalizeErpQuoteText(source.cells[columns[c]]??''):'';
  const row=source.rowNumber;rowCount++;
  if(rowCount>ERP_QUOTES_MAX_ROWS)fail(`الحد الأقصى ${ERP_QUOTES_MAX_ROWS} بند في الملف`);
  const type=get('Trans_Type_Code');
  if(key(type)!=='qut')fail(`هذا الملف ليس تقرير عروض أسعار من ERP: نوع الحركة في السطر ${row} هو «${type.slice(0,30)||'—'}» وليس «Qut». صدّر تقرير عروض الأسعار.`);
  if(truthy(get('IsDeleted'))){deletedRows++;continue;}
  const code=get('Code');
  if(!code){problems.push({row,reason:'سطر بلا رقم عرض (Code)'});continue;}
  const k=erpQuoteKey(code),group=groups.get(k)||{code,rows:[]};group.rows.push({row,get});groups.set(k,group);
 }
 const quotations:ErpQuotation[]=[];
 for(const [k,group] of groups){
  const first=group.rows[0],rows=group.rows.map(r=>r.row);
  const q:ErpQuotation={key:k,code:group.code.slice(0,100),rows,transactionId:first.get('Transaction_ID').slice(0,100),no:first.get('No').slice(0,100),date:'',validUntil:'',dueDate:'',
   customerCode:first.get('CustomerCode').slice(0,100),customerName:first.get('CustomerName').slice(0,250),employeeCode:first.get('Emp_Code').slice(0,100),employeeName:first.get('Emp_name').slice(0,200),
   paymentTerms:first.get('Payment_Terms_Name'),deliveryTerm:first.get('Delivery_Term'),note:first.get('Document_Note'),vatRate:0,netCents:0,taxCents:0,totalCents:0,documentDiscountCents:0,lines:[],problem:''};
  try{
   const mixed=HEADER_FIELDS.filter(field=>columns[field]>=0&&group.rows.some(r=>key(r.get(field))!==key(first.get(field))));
   if(mixed.length)fail(`بنود هذا العرض تختلف في بيانات الرأس (${mixed.join('، ')})`);
   q.date=dateOf(first.get('Date1'),'تاريخ العرض (Date1)',first.row);
   q.validUntil=dateOf(first.get('Expiration_Date'),'تاريخ الصلاحية (Expiration_Date)',first.row,true);
   q.dueDate=dateOf(first.get('Due_Date'),'تاريخ الاستحقاق (Due_Date)',first.row,true);
   if(!q.customerCode)fail('كود العميل (CustomerCode) فارغ');
   const currency=key(first.get('CurrencyCode'));if(currency&&currency!=='sar')fail('عملة العرض ليست الريال السعودي (SAR)');
   const exchange=first.get('Exchange_Rate');if(exchange&&numberOf(exchange,'Exchange_Rate',first.row)!==1)fail('سعر التعادل ليس 1');
   if(group.rows.length>ERP_QUOTES_MAX_LINES)fail(`العرض يحتوي ${group.rows.length} بندًا والحد ${ERP_QUOTES_MAX_LINES} بندًا للعرض الواحد`);
   q.vatRate=numberOf(first.get('VAT'),'VAT',first.row);
   if(q.vatRate<0||q.vatRate>100)fail('نسبة الضريبة (VAT) خارج المدى 0–100');
   q.netCents=centsOf(first.get('Subtotal'),'Subtotal',first.row);q.taxCents=centsOf(first.get('VAT_AmountM'),'VAT_AmountM',first.row);q.totalCents=centsOf(first.get('NewSubtotal'),'NewSubtotal',first.row);
   q.documentDiscountCents=centsOf(first.get('Discount_Amount_M'),'Discount_Amount_M',first.row);
   for(const {row,get} of group.rows){
    const name=get('Item_Name')||get('Description');if(!name)fail(`السطر ${row}: اسم الصنف (Item_Name) فارغ`);
    const quantity=numberOf(get('Qty'),'الكمية (Qty)',row),price=numberOf(get('Price'),'السعر (Price)',row);
    const discountCents=centsOf(get('Discount_Amount'),'خصم البند (Discount_Amount)',row),totalCents=centsOf(get('Total'),'Total',row);
    if(!(quantity>0))fail(`السطر ${row}: الكمية يجب أن تكون أكبر من صفر`);
    if(price<0||discountCents<0||totalCents<0)fail(`السطر ${row}: قيمة سالبة في السعر أو الخصم أو الإجمالي`);
    q.lines.push({row,itemCode:(get('Item_Code')||get('Barcode')).slice(0,100),itemName:get('Item_Name'),description:get('Item_Name')?get('Description'):'',category:get('Cat_Name').slice(0,200),unit:get('UnitName').slice(0,100),quantity,price,discountCents,totalCents,vatRate:q.vatRate});
   }
   if([q.netCents,q.taxCents,q.totalCents,q.documentDiscountCents].some(n=>n<0))fail('قيمة سالبة في إجماليات العرض');
   // The document must add up, as the owner's file does: the lines' net less the document's discount is Subtotal, its VAT is VAT_AmountM
   // and with it NewSubtotal (one halala per line of rounding allowed). A file that does not is read wrong, and nothing of it is guessed.
   const linesNet=q.lines.reduce((s,l)=>s+l.totalCents,0),tolerance=q.lines.length;
   for(const line of q.lines){const gross=lineCents(line.quantity,line.price);if(Math.abs(gross-line.discountCents-line.totalCents)>1)fail(`السطر ${line.row}: إجمالي البند لا يساوي الكمية × السعر − الخصم`);}
   if(Math.abs(linesNet-q.documentDiscountCents-q.netCents)>tolerance)fail('صافي العرض (Subtotal) لا يساوي مجموع البنود ناقص خصم المستند');
   if(Math.abs(Math.round(q.netCents*q.vatRate/100)-q.taxCents)>1)fail('ضريبة العرض (VAT_AmountM) لا تساوي الصافي × نسبة الضريبة');
   if(Math.abs(q.netCents+q.taxCents-q.totalCents)>1)fail('إجمالي العرض (NewSubtotal) لا يساوي الصافي + الضريبة');
  }catch(error){if(!(error instanceof ErpQuotesError))throw error;q.problem=error.message;}
  quotations.push(q);
 }
 if(!quotations.length&&!problems.length)fail('الملف لا يحتوي بنود عروض أسعار قابلة للقراءة.');
 return {quotations,problems,rowCount,deletedRows,columns:sheet.rows[headerAt].cells};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The CRM quote made of a quotation
// ---------------------------------------------------------------------------------------------------------------------------------
export type QuoteFields={number:string;date:string;validUntil:string;status:'draft'|'sent'|'accepted'|'rejected';items:{description:string;quantity:number;price:number;code?:string;category?:string;unit?:string}[];discount:number;taxRate:number;terms:string;subtotal:number;tax:number;total:number};
const QUOTE_FIELDS=['number','date','validUntil','status','items','discount','taxRate','terms','subtotal','tax','total'] as const;
const cut=(text:string,max:number)=>text.length>max?text.slice(0,max-1).trimEnd()+'…':text;
/** The terms of the quote: the ERP's payment terms, delivery term and note, one a line (stored text, Modern Standard Arabic labels). */
export function erpQuoteTerms(q:Pick<ErpQuotation,'paymentTerms'|'deliveryTerm'|'note'>){return cut([q.paymentTerms&&'شروط الدفع: '+q.paymentTerms,q.deliveryTerm&&'مدة التوريد: '+q.deliveryTerm,q.note&&'ملاحظات: '+q.note].filter(Boolean).join('\n'),6000);}
/** The quote's fields from a quotation: its number, dates, items, discount, VAT rate, terms and the ERP's figures; with the CRM's own sums
 *  (quoteTotals) and whether they differ from the ERP's by more than a halala. */
export function erpQuoteFields(q:ErpQuotation){
 const items=q.lines.map(line=>{
  const description=cut([line.itemName||line.description,line.itemName&&line.description].filter(Boolean).join(' — '),250);
  return {description,quantity:line.quantity,price:line.price,...(line.itemCode?{code:line.itemCode}:{}),...(line.category?{category:line.category}:{}),...(line.unit?{unit:line.unit}:{})};
 });
 const lineDiscountCents=q.lines.reduce((s,l)=>s+l.discountCents,0),discountCents=lineDiscountCents+q.documentDiscountCents;
 const grossCents=q.netCents+discountCents;
 const validUntil=q.validUntil&&q.validUntil>=q.date?q.validUntil:q.date;
 const fields:QuoteFields={number:q.code,date:q.date,validUntil,status:'sent',items,discount:discountCents/100,taxRate:q.vatRate,terms:erpQuoteTerms(q),subtotal:grossCents/100,tax:q.taxCents/100,total:q.totalCents/100};
 const crm=quoteTotals(items,fields.discount,fields.taxRate);
 const differ=Math.abs(Math.round(crm.subtotal*100)-grossCents)>1||Math.abs(Math.round(crm.tax*100)-q.taxCents)>1||Math.abs(Math.round(crm.total*100)-q.totalCents)>1;
 return {fields,crm,differ,lineDiscountCents,validUntilAdjusted:validUntil!==q.validUntil};
}
/** What the import compares: the quote's own fields in one canonical text (the items' extra fields included, empty ones left out). */
export function canonicalQuoteFields(data:Record<string,unknown>|QuoteFields){
 const source=data as Record<string,unknown>,items=Array.isArray(source.items)?source.items as Record<string,unknown>[]:[];
 return JSON.stringify(QUOTE_FIELDS.map(field=>field==='items'?items.map(item=>[String(item.description??''),Number(item.quantity),Number(item.price),String(item.code??''),String(item.category??''),String(item.unit??'')]):field==='number'||field==='date'||field==='validUntil'||field==='status'||field==='terms'?String(source[field]??''):Number(source[field])));
}
export async function sha256(text:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
/** The ERP's own content of a quotation (what a newer export can change), whatever the CRM maps it to. */
export const erpQuoteSourceHash=(q:ErpQuotation)=>sha256(JSON.stringify([q.code,q.transactionId,q.no,q.date,q.validUntil,q.dueDate,q.customerCode,q.customerName,q.employeeCode,q.employeeName,q.paymentTerms,q.deliveryTerm,q.note,q.vatRate,q.netCents,q.taxCents,q.totalCents,q.documentDiscountCents,q.lines.map(l=>[l.itemCode,l.itemName,l.description,l.category,l.unit,l.quantity,l.price,l.discountCents,l.totalCents])]));
/** The CRM record's id of a quotation: one per quotation number, whoever imports it (two imports racing write one record). */
export const erpQuoteRecordId=async(key:string)=>'erp-quote-'+(await sha256(ERP_QUOTES_NAMESPACE+':'+key)).slice(0,32);

// ---------------------------------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------------------------------
export type ErpQuoteStatus='new'|'update'|'unchanged'|'edited'|'refused'|'excluded';
/** The words of the outcomes the screen and the report share (stored nowhere). */
export const ERP_QUOTE_REASONS={
 edited:'عُدِّل في الـCRM، تُرك كما هو',
 unchanged:'مطابق للمحفوظ؛ لا تغيير',
 update:'تغيّر في ERP؛ سيُحدَّث العرض المحفوظ',
 new:'عرض جديد؛ سيُضاف إلى عروض أسعار العميل',
 noCustomer:'العميل غير موجود في الـCRM بكود ERP هذا؛ أضفه أو حدّث كوده من «استيراد من ERP» في العملاء',
 ambiguousCustomer:'كود العميل مسجل لأكثر من عميل في الـCRM؛ اربطه بعميل واحد أولًا',
 customerOutside:'العميل خارج منطقتك',
 unmapped:'اربط موظف ERP بمندوب',
 repOutside:'المندوب المرتبط خارج نطاق فريقك أو منطقتك',
 numberTaken:'رقم العرض مستخدم لعرض سعر أُنشئ في الـCRM؛ لن يُستبدل',
 recordOutside:'العرض محفوظ لمندوب خارج نطاق فريقك؛ لن يُعدَّل',
 customerChanged:'تغيّر عميل العرض في ERP؛ لن يُنقل العرض المحفوظ إلى عميل آخر تلقائيًا',
 /** «مبيعات مكتب» (the ERP sales import's words, lib/erp-sales-server.ts): another company's quotations, never written nor mapped. */
 office:'مبيعات مكتب: عروض شركة أخرى مستبعدة تلقائيًا',
 /** An employee marked «مبيعات مكتب (مستبعد)» (lib/erp-office-employees.ts): excluded the same way; a quotation imported earlier stays. */
 officeMarked:'مبيعات مكتب (تحديد الموظف): مستبعدة ولا تُحتسب لأي مندوب',
 officeMarkedSaved:'مبيعات مكتب (تحديد الموظف): مستبعدة؛ العرض المحفوظ سابقًا يبقى كما هو',
} as const;
export type ErpQuoteMarker={source:'erp';key:string;code:string;transactionId:string;no:string;customerCode:string;customerName:string;employeeCode:string;employeeName:string;dueDate:string;lineDiscount:number;documentDiscount:number;net:number;crmTotals:{subtotal:number;tax:number;total:number};totalsDiffer:boolean;validUntilAdjusted:boolean;sourceHash:string;appliedHash:string;importedAt:string;importedBy:string;importedByName:string;updatedAt:string;updatedBy:string;updatedByName:string;importId:string;fileName:string};
export type ErpQuotePlanEntry={
 key:string;code:string;rows:number[];date:string;customerCode:string;customerName:string;employeeCode:string;employeeName:string;lineCount:number;totalCents:number;
 status:ErpQuoteStatus;reason:string;recordId:string;version:number;customerId:string;customerLabel:string;repId:string;repName:string;branch:string;totalsDiffer:boolean;
 data?:Record<string,unknown>;before?:Record<string,unknown>;
};
export type PlanInput={
 file:ErpQuotesFile;records:Row[];visibleIds:Set<string>;codes:Map<string,Row[]>;
 /** The ERP employee code (normalised) to its CRM representative; and the representatives the importer may assign. */
 employeeReps:Map<string,string>;eligible:Map<string,Member>;
 /** The employee codes (employeeKey) marked «مبيعات مكتب (مستبعد)», saved or chosen in this preview. */
 officeEmployees?:Set<string>;
 customerInRegion:(customer:Row)=>boolean;
 importer:{id:string;name:string};now:string;importId:string;fileName:string;
};
/** The key of an ERP employee code (the ERP sales import's mapping key: spaces and marks removed; Arabic-Indic digits read as digits). */
export const employeeKey=(value:unknown)=>latinDigits(normalizeErpQuoteText(value));
const fieldsOf=(data:Record<string,unknown>)=>Object.fromEntries(QUOTE_FIELDS.map(field=>[field,data[field]]));
/** Each quotation of the file: new, update, unchanged, edited in the CRM (left alone), excluded («مبيعات مكتب», as the ERP sales import
 *  excludes them by the employee's name: before anything else, so it never needs a customer or a mapping) or refused with its reason; with
 *  the record it makes. */
export async function planErpQuotes(input:PlanInput):Promise<ErpQuotePlanEntry[]>{
 const byKey=new Map<string,Row>(),byNumber=new Map<string,Row>();
 for(const row of input.records){if(row.kind!=='quote')continue;const marker=row.data?._erp;if(marker&&typeof marker.key==='string')byKey.set(marker.key,row);else if(row.data?.number)byNumber.set(erpQuoteKey(row.data.number),row);}
 const out:ErpQuotePlanEntry[]=[];
 for(const q of input.file.quotations){
  const recordId=await erpQuoteRecordId(q.key),existing=byKey.get(q.key)||input.records.find(r=>r.id===recordId);
  const entry:ErpQuotePlanEntry={key:q.key,code:q.code,rows:q.rows,date:q.date,customerCode:q.customerCode,customerName:q.customerName,employeeCode:q.employeeCode,employeeName:q.employeeName,lineCount:q.lines.length||q.rows.length,totalCents:q.totalCents,status:'refused',reason:'',recordId:existing?.id||recordId,version:existing?.version||0,customerId:'',customerLabel:'',repId:'',repName:'',branch:'',totalsDiffer:false};
  out.push(entry);
  const refuse=(reason:string)=>{entry.status='refused';entry.reason=reason;};
  if(isOfficeEmployee(q.employeeName)){entry.status='excluded';entry.reason=ERP_QUOTE_REASONS.office;continue;}
  if(input.officeEmployees?.has(employeeKey(q.employeeCode))){entry.status='excluded';entry.reason=existing?ERP_QUOTE_REASONS.officeMarkedSaved:ERP_QUOTE_REASONS.officeMarked;continue;}
  if(q.problem){refuse(q.problem);continue;}
  const matches=input.codes.get(customerCodeKey(q.customerCode))||[];
  if(!matches.length){refuse(ERP_QUOTE_REASONS.noCustomer);continue;}
  if(matches.length>1){refuse(ERP_QUOTE_REASONS.ambiguousCustomer);continue;}
  const customer=matches[0];entry.customerId=customer.id;entry.customerLabel=String(customer.data?.name||'');entry.branch=customer.branch;
  if(!input.visibleIds.has(customer.id)||!input.customerInRegion(customer)){refuse(ERP_QUOTE_REASONS.customerOutside);continue;}
  const repId=input.employeeReps.get(employeeKey(q.employeeCode))||'',rep=input.eligible.get(repId);
  entry.repId=repId;entry.repName=rep?.name||'';
  if(!repId){refuse(ERP_QUOTE_REASONS.unmapped);continue;}
  if(!rep){refuse(ERP_QUOTE_REASONS.repOutside);continue;}
  if(!existing&&byNumber.has(q.key)){refuse(ERP_QUOTE_REASONS.numberTaken);continue;}
  const {fields,crm,differ,lineDiscountCents,validUntilAdjusted}=erpQuoteFields(q);entry.totalsDiffer=differ;
  const checked=schemas.quote.safeParse(fields);
  if(!checked.success){refuse(checked.error.issues.map(issue=>issue.message).join(' • '));continue;}
  const sourceHash=await erpQuoteSourceHash(q),appliedHash=await sha256(canonicalQuoteFields(fields));
  const marker=(prior?:ErpQuoteMarker):ErpQuoteMarker=>({source:'erp',key:q.key,code:q.code,transactionId:q.transactionId,no:q.no,customerCode:q.customerCode,customerName:q.customerName,employeeCode:q.employeeCode,employeeName:q.employeeName,dueDate:q.dueDate,lineDiscount:lineDiscountCents/100,documentDiscount:q.documentDiscountCents/100,net:q.netCents/100,crmTotals:crm,totalsDiffer:differ,validUntilAdjusted,sourceHash,appliedHash,importedAt:prior?.importedAt||input.now,importedBy:prior?.importedBy||input.importer.id,importedByName:prior?.importedByName||input.importer.name,updatedAt:input.now,updatedBy:input.importer.id,updatedByName:input.importer.name,importId:input.importId,fileName:input.fileName.slice(0,255)});
  const data:Record<string,unknown>={...fields,performedBy:rep.id,recordedByEmail:'',_erp:marker()};
  if(!existing){entry.status='new';entry.reason=ERP_QUOTE_REASONS.new;entry.data=data;continue;}
  if(existing.kind!=='quote'||!existing.data?._erp){refuse(ERP_QUOTE_REASONS.numberTaken);continue;}
  if(!input.visibleIds.has(existing.id)||existing.data._teamReadOnly){refuse(ERP_QUOTE_REASONS.recordOutside);continue;}
  const prior=existing.data._erp as ErpQuoteMarker;
  // Edited by hand after the import (its quote fields are no longer what the import wrote): left as it is, whatever the file says.
  if(await sha256(canonicalQuoteFields(existing.data))!==prior.appliedHash){entry.status='edited';entry.reason=ERP_QUOTE_REASONS.edited;continue;}
  if(existing.parentId!==customer.id){refuse(ERP_QUOTE_REASONS.customerChanged);continue;}
  if(prior.sourceHash===sourceHash&&prior.appliedHash===appliedHash&&existing.assignedTo===rep.id&&existing.data.performedBy===rep.id&&existing.branch===customer.branch){entry.status='unchanged';entry.reason=ERP_QUOTE_REASONS.unchanged;continue;}
  entry.status='update';entry.reason=ERP_QUOTE_REASONS.update;entry.before={...fieldsOf(existing.data),repId:existing.assignedTo};
  entry.data={...existing.data,...data,_erp:marker(prior)};
 }
 return out;
}

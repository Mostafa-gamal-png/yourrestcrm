// «استيراد المستهدفات والمتابعات من قوالب Excel» (the owner, 2026-11-16, item 8 of the GSCO comparison list; GSCO 2.13.66 lib/crm/record-import*.ts:
// one sheet per kind, columns found by their names so their order does not matter, an explanation row under the header, a row with a problem
// left out and named by its Excel row, the others saved). What the two templates hold and how a cell is read; pure, shared by the server
// (lib/record-import-server.ts reads the file, checks every row and saves) and the page (app/record-import.tsx shows the preview).
// - The headers are Arabic in the Arabic template and English in the English one; either is read, whatever the page's language.
// - Arabic-Indic and Persian digits, the Arabic decimal and thousands separators, invisible direction marks and runs of spaces are read in
//   every cell; a day written 2026-11-16 or 2026/11/16 or kept by Excel as a day number; a month 2026-11 or 2026/11 or any day of it.
// - At most RECORD_IMPORT_MAX_ROWS rows of data; empty rows are skipped; formulas, macros and error cells are refused by the reader
//   (lib/erp-sales.ts readWorkbookSheets).
import {targetProducts,activityFields} from './targets';
import {followupTypes,followupLossReasons} from './customer-followups';
import {stageLabels} from './crm';

export type RecordImportKind='targets'|'followups';
export const RECORD_IMPORT_KINDS:readonly RecordImportKind[]=['targets','followups'];
export const RECORD_IMPORT_MAX_ROWS=1000,RECORD_IMPORT_MAX_BYTES=2*1024*1024;
export type ImportColumn={key:string;ar:string;en:string;required?:boolean;note:{ar:string;en:string};width:number};
const PRODUCT_EN:Record<string,string>={'قوالب البلوك المتحركة':'Molds for mobile block machines','قوالب البلوك الثابتة':'Molds for stationary block machines','لمامة البلوك':'Block stacker','ماكينة إنتاج البلوكة المتحركة':'Mobile block-making machine','قطع غيار المكائن المتحركة':'Mobile machine spare parts','خلاطات البلوك':'Block mixers','خلاطات الخرسانة الجاهزة':'Ready-mix concrete mixers','خدمات صيانة':'Maintenance services'};
const UNIT_EN:Record<string,string>={'قالب':'Mold','قطعة':'Piece','ماكينة':'Machine','خدمة':'Service'};
const ACTIVITY_EN:Record<string,string>={newCustomers:'New customers',recoveredCustomers:'Reactivated customers',visits:'Actual visits'};
const req=(ar:string,en:string)=>({ar:'إلزامي. '+ar,en:'Required. '+en}),opt=(ar:string,en:string)=>({ar:'اختياري. '+ar,en:'Optional. '+en});
export const productColumnKey=(product:string)=>'p:'+product;
export const TARGET_COLUMNS:readonly ImportColumn[]=[
 {key:'month',ar:'الشهر',en:'Month',required:true,note:req('مثل 2026-12.','For example 2026-12.'),width:12},
 {key:'email',ar:'البريد الإلكتروني للعضو',en:'Member email',required:true,note:req('بريد دخول المندوب أو المشرف كما في «الفريق والصلاحيات».','The member\'s sign-in email, as in «Team and permissions».'),width:30},
 {key:'name',ar:'اسم العضو',en:'Member name',note:opt('للقراءة فقط؛ لا يُستورد.','For reading only; not imported.'),width:22},
 ...targetProducts.map(product=>({key:productColumnKey(product.id),ar:product.name+' ('+product.unit+')',en:PRODUCT_EN[product.id]+' ('+UNIT_EN[product.unit]+')',note:opt('الكمية المستهدفة للشهر. فارغ = غير محدد، و0 = صنف غير مكلف به.','The month\'s target quantity. Empty = not set; 0 = not assigned.'),width:20})),
 ...activityFields.map(([key,label])=>({key,ar:label,en:ACTIVITY_EN[key],note:opt('عدد صحيح من 1. اكتب الثلاثة معًا أو اتركها فارغة.','A whole number from 1. Write all three or leave them empty.'),width:16})),
];
export const FOLLOWUP_COLUMNS:readonly ImportColumn[]=[
 {key:'customerCode',ar:'كود العميل',en:'Customer code',required:true,note:req('كود يورست (YR-C-000001) أو كود ERP للعميل.','The Yourrest code (YR-C-000001) or the customer\'s ERP code.'),width:16},
 {key:'customerName',ar:'اسم العميل',en:'Customer name',note:opt('للقراءة فقط؛ لا يُستورد.','For reading only; not imported.'),width:26},
 {key:'email',ar:'البريد الإلكتروني للمندوب',en:'Representative email',note:opt('من نفّذ المتابعة. فارغ = أنت.','Who did the follow-up. Empty = you.'),width:28},
 {key:'date',ar:'تاريخ المتابعة المنفذة',en:'Follow-up date',required:true,note:req('مثل 2026-11-16، ولا يكون في المستقبل.','For example 2026-11-16; not in the future.'),width:16},
 {key:'type',ar:'نوع المتابعة',en:'Follow-up type',required:true,note:req('اتصال أو واتساب أو عرض سعر أو اجتماع أو متابعة (الزيارة تُسجَّل من التطبيق).','Call, WhatsApp, Quote, Meeting or Follow-up (a visit is recorded in the app).'),width:14},
 {key:'result',ar:'نتيجة المتابعة',en:'Follow-up outcome',required:true,note:req('3 أحرف على الأقل.','At least 3 letters.'),width:36},
 {key:'stage',ar:'مرحلة البيع بعد المتابعة',en:'Sales stage after follow-up',note:opt('من مراحل البيع، مثل «تفاوض» أو «تم الفقد».','A sales stage, such as «Negotiation» or «Lost».'),width:20},
 {key:'nextAction',ar:'الإجراء القادم',en:'Next action',note:req('إلا عند «تم الفوز» أو «تم الفقد».','Unless the stage is «Won» or «Lost».'),width:28},
 {key:'nextDate',ar:'موعد المتابعة القادمة',en:'Next follow-up date',note:req('إلا عند «تم الفوز» أو «تم الفقد»؛ لا يسبق تاريخ المتابعة.','Unless «Won» or «Lost»; not before the follow-up date.'),width:16},
 {key:'lossReason',ar:'سبب الفقد',en:'Loss reason',note:opt('مطلوب عند «تم الفقد»، من قائمة أسباب الفقد.','Required when «Lost», from the loss reasons list.'),width:22},
 {key:'lossDetails',ar:'تفاصيل سبب الفقد',en:'Loss reason details',note:opt('مطلوب عند سبب «أخرى».','Required when the reason is «Other».'),width:26},
 {key:'recontactAction',ar:'الإجراء عند إعادة التواصل',en:'Re-contact action',note:opt('للمتابعة المفقودة فقط، مع موعده.','For a lost follow-up only, with its date.'),width:26},
 {key:'recontactDate',ar:'موعد إعادة التواصل',en:'Re-contact date',note:opt('للمتابعة المفقودة فقط؛ لا يكون في الماضي.','For a lost follow-up only; not in the past.'),width:16},
];
export const recordImportColumns=(kind:RecordImportKind)=>kind==='targets'?TARGET_COLUMNS:FOLLOWUP_COLUMNS;
export const recordImportSheet=(kind:RecordImportKind,language:'ar'|'en')=>kind==='targets'?(language==='en'?'Targets':'المستهدفات'):(language==='en'?'Follow-ups':'المتابعات');

const MARKS=/[­؜​-‏‪-‮⁦-⁩﻿]/g;
/** A cell as text: NFC, no invisible direction marks, one space between words. */
export const importText=(value:unknown)=>String(value??'').normalize('NFC').replace(MARKS,'').replace(/\s+/g,' ').trim();
/** Arabic-Indic and Persian digits as Latin ones, the Arabic decimal separator as a point, thousands separators dropped. */
export const latinDigits=(value:string)=>value.replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c>='۰'?0x6f0:0x660))).replace(/٫/g,'.').replace(/[٬,]/g,'');
const headerKey=(value:string)=>importText(value).replace(/\*/g,'').replace(/\s+/g,' ').trim().toLowerCase();
/** A header cell's column, by the Arabic or the English header (a product's also without its unit). */
export function columnOf(kind:RecordImportKind,header:string):string|null{
 const key=headerKey(header);if(!key)return null;
 for(const column of recordImportColumns(kind)){
  const names=[column.ar,column.en];if(column.key.startsWith('p:')){const id=column.key.slice(2);names.push(id,PRODUCT_EN[id]||'');}
  if(names.some(name=>name&&headerKey(name)===key))return column.key;
 }
 return null;
}
/** A number written in a cell (digits read as above), or null when the cell is empty, or undefined when it is not a number. */
export function importNumber(value:string):number|null|undefined{
 const text=latinDigits(importText(value)).replace(/\s/g,'');if(!text)return null;
 return /^-?\d+(\.\d+)?$/.test(text)?Number(text):undefined;
}
const realDay=(y:number,m:number,d:number)=>{const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d&&y>=2000&&y<=2100?date.toISOString().slice(0,10):'';};
/** A day: 2026-11-16, 2026/11/16, or the day number Excel keeps for a date (1900 system); '' when the cell is empty, null when not a day. */
export function importDay(value:string):string|null{
 const text=latinDigits(importText(value)).replace(/\s/g,'');if(!text)return '';
 const match=text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);if(match)return realDay(Number(match[1]),Number(match[2]),Number(match[3]))||null;
 if(/^\d{5}(\.\d+)?$/.test(text)){const date=new Date(Date.UTC(1899,11,30)+Math.floor(Number(text))*86400000);return realDay(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate())||null;}
 return null;
}
/** A month: 2026-11, 2026/11, 11/2026, or any day of it (as above); '' when empty, null when not a month. */
export function importMonth(value:string):string|null{
 const text=latinDigits(importText(value)).replace(/\s/g,'');if(!text)return '';
 let match=text.match(/^(\d{4})[-/.](\d{1,2})$/);if(match&&Number(match[2])>=1&&Number(match[2])<=12&&Number(match[1])>=2000&&Number(match[1])<=2100)return match[1]+'-'+match[2].padStart(2,'0');
 match=text.match(/^(\d{1,2})[-/.](\d{4})$/);if(match&&Number(match[1])>=1&&Number(match[1])<=12&&Number(match[2])>=2000&&Number(match[2])<=2100)return match[2]+'-'+match[1].padStart(2,'0');
 const day=importDay(text);return day?day.slice(0,7):null;
}
const choice=(value:string,options:Record<string,string>,english:Record<string,string>)=>{const key=importText(value).toLowerCase();if(!key)return '';for(const [id,label] of Object.entries(options))if([id,label,english[id]||''].some(name=>name&&importText(name).toLowerCase()===key))return id;return null;};
const TYPE_EN:Record<string,string>={visit:'Visit',call:'Call',whatsapp:'WhatsApp',quote:'Quote',meeting:'Meeting',followup:'Follow-up'};
const STAGE_EN:Record<string,string>={new:'Identify requirements',specs:'Gathering specifications',technical:'Technical review',quoted:'Quote',negotiation:'Negotiation',won:'Won',lost:'Lost'};
const LOSS_EN:Record<string,string>={'السعر أعلى من المنافس':'Price higher than competitor','المواصفات الفنية':'Technical specifications','عدم توفر الصنف':'Product unavailable','مدة التوريد':'Delivery lead time','شروط الدفع':'Payment terms','المنافس':'Competitor','علاقة العميل بالمورد الحالي':'Customer’s relationship with current supplier','تأخر المتابعة':'Delayed follow-up','عدم الوصول لصاحب القرار':'Unable to reach the decision-maker','توقف المصنع':'Factory shutdown','أُلغي الطلب':'Order canceled','المنتج غير مناسب':'Product unsuitable','أخرى':'Other'};
/** A follow-up type by its Arabic or English name or its key; '' empty, null unknown. */
export const importFollowupType=(value:string)=>choice(value,followupTypes,TYPE_EN);
/** A sales stage by its Arabic or English name or its key; '' empty, null unknown. */
export const importStage=(value:string)=>choice(value,stageLabels,STAGE_EN);
/** A loss reason of the list, by its Arabic or English words; '' empty, null not on the list. */
export const importLossReason=(value:string)=>choice(value,Object.fromEntries(followupLossReasons.map(reason=>[reason,reason])),LOSS_EN);

export type ImportRow={row:number;cells:Record<string,string>};
export type ReadSheet={name:string;rows:{rowNumber:number;cells:string[]}[]};
export class RecordImportFileError extends Error{constructor(message:string){super(message);this.name='RecordImportFileError';}}
/** The rows of a template's sheet: the sheet named as the template (either language), else the first sheet with the template's columns; the
 *  header is the first row (of the first twenty) naming the template's required columns; a note row under it («إلزامي.»، «اختياري.» or their
 *  English) and empty rows are skipped. Throws RecordImportFileError with the words a person reads. */
export function readImportRows(kind:RecordImportKind,sheets:readonly ReadSheet[],language:'ar'|'en'='ar'):{rows:ImportRow[];empty:number;ignoredColumns:string[];sheet:string}{
 const say=(ar:string,en:string)=>language==='en'?en:ar;
 const named=sheets.filter(sheet=>[recordImportSheet(kind,'ar'),recordImportSheet(kind,'en')].map(importText).includes(importText(sheet.name)));
 const columns=recordImportColumns(kind),required=columns.filter(column=>column.required);
 let bestMissing:string[]|null=null;
 for(const sheet of [...named,...sheets.filter(sheet=>!named.includes(sheet))]){
  for(const [index,row] of sheet.rows.slice(0,20).entries()){
   const found=new Map<number,string>(),seen=new Set<string>(),ignored:string[]=[];
   row.cells.forEach((cell,column)=>{const key=columnOf(kind,cell);if(key){if(seen.has(key))throw new RecordImportFileError(say('العمود «'+importText(cell)+'» مكرر في الملف.','The column «'+importText(cell)+'» appears twice in the file.'));seen.add(key);found.set(column,key);}else if(importText(cell))ignored.push(importText(cell));});
   if(found.size<2)continue;
   const missing=required.filter(column=>!seen.has(column.key)).map(column=>say(column.ar,column.en));
   if(missing.length){if(!bestMissing||missing.length<bestMissing.length)bestMissing=missing;continue;}
   const rows:ImportRow[]=[];let empty=0;
   for(const data of sheet.rows.slice(index+1)){
    const cells:Record<string,string>={};let any=false;
    for(const [column,key] of found){const value=importText(data.cells[column]??'');cells[key]=value;if(value)any=true;}
    if(!any){empty++;continue;}
    if(rows.length===0&&Object.values(cells).some(value=>/^(إلزامي|اختياري|required|optional)\./i.test(value)))continue;
    rows.push({row:data.rowNumber,cells});
    if(rows.length>RECORD_IMPORT_MAX_ROWS)throw new RecordImportFileError(say('الحد الأقصى '+RECORD_IMPORT_MAX_ROWS+' صف في الملف الواحد.','At most '+RECORD_IMPORT_MAX_ROWS+' rows in one file.'));
   }
   if(!rows.length)throw new RecordImportFileError(say('الملف لا يحتوي على صفوف بيانات تحت العناوين.','The file has no data rows under the headers.'));
   return {rows,empty,ignoredColumns:ignored,sheet:sheet.name};
  }
 }
 if(bestMissing)throw new RecordImportFileError(say('أعمدة ناقصة في الملف: '+bestMissing.join('، ')+'.','Missing columns in the file: '+bestMissing.join(', ')+'.'));
 throw new RecordImportFileError(say('لم أجد أعمدة قالب «'+recordImportSheet(kind,'ar')+'» في الملف. نزّل القالب واملأه ثم ارفعه.','The columns of the «'+recordImportSheet(kind,'en')+'» template were not found in the file. Download the template, fill it in and upload it.'));
}

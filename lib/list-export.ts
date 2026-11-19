// «تصدير Excel» from every page that shows a list (the owner, 2026-11-19, through the GSCO session: «تصدير Excel من كل صفحة فيها قائمة»,
// the port of GSCO 2.13.80 commit 89d2bfd: «زر «تصدير Excel» في كل صفحة تعرض بيانات … الملف يحمل التصفية الحالية للصفحة وكل الصفوف المطابقة،
// بلغة الصفحة»). Pure: the page (app/export-excel-button.tsx), the server (app/api/list-export) and the tests read the same rules here.
// - Which lists export, from which screen, and the cell that decides it (LIST_EXPORTS). Yourrest's permission table has one row per screen,
//   so a screen has one «تصدير» cell (GSCO: one switch per page): every list shown on «الزيارات» (the visits or requests, «التواصل مع
//   العملاء», «تتبع الطلبات والشكاوى», «مصادر الفرص», and the complaints a sales member meets there) follows «الزيارات · تصدير»; the
//   customers' list «العملاء · تصدير» (the map shows no list of its own and exports nothing, as GSCO's map); the tabs of «المستهدفات وتقييم الأداء» follow «المستهدفات وتقييم الأداء · تصدير»
//   (its sales tab «المبيعات · تصدير»), each tab also closed while the administrator hides it.
// - Who (mayExportList): the screen shows for the member (pageAllowed: the role has it and it is not hidden), the tab is not hidden, and the
//   cell is on (lib/permissions.ts can). A representative and a marketing officer never export (no «تصدير» cell exists for a field role,
//   as before this release). The server answers its exports by the same rule (app/api/list-export).
// - What: what the page holds after its current filters and search, every matching row, never only the page of 25 on the screen; the
//   rows the page already read within the reader's scope (GET /api/crm and each page's own request), so the file never carries more than
//   the screen could show. The two lists the server cuts at 300 (the complaints, «التواصل مع العملاء») are built by the server with the
//   page's own scope instead (lib/list-export-service.ts).
// - How: one .xlsx (lib/xlsx-write.ts xlsxBook), its sheets right to left in Arabic, the header bold and frozen, the page's language
//   (Arabic or English), numbers as number cells, days and moments as date cells in Riyadh time, everything else inline text (never read
//   as a formula: «=1+1» stays the text it is), at most EXPORT_ROW_CAP rows a sheet, named Yourrest-<page>-<day>.xlsx.
import {xlsxBook,type BookCell,type BookSheet} from './xlsx-write';
import {can,hubTabHidden,pageAllowed,type MemberAccess,type PermissionScreen} from './permissions';
import {canViewPage} from './access';
import {isFieldRole} from './roles';
import type {HubTab} from './targets-hub';

export type ExportLanguage='ar'|'en';
export type Say=(ar:string,en:string)=>string;
export const sayIn=(language:ExportLanguage):Say=>(ar,en)=>language==='en'?en:ar;
type Who={role:string;access?:MemberAccess|null};

/** A list that exports: its name (the button's tooltip and the file's first sheet), the file's name, the screen it is shown on, the screen
 *  whose «تصدير» cell decides it, the tab of «المستهدفات وتقييم الأداء» it sits on, and whether the server builds it. */
export type ListExport={ar:string;en:string;file:string;screen:PermissionScreen;cell:PermissionScreen;tab?:HubTab;via:'client'|'server'};
export const LIST_EXPORTS={
 customers:{ar:'العملاء',en:'Customers',file:'customers',screen:'customer',cell:'customer',via:'client'},
 visits:{ar:'الزيارات',en:'Visits',file:'visits',screen:'activity',cell:'activity',via:'client'},
 support:{ar:'التواصل مع العملاء',en:'Customer contact',file:'customer-contact',screen:'activity',cell:'activity',via:'server'},
 'service-board':{ar:'تتبع الطلبات والشكاوى',en:'Request and complaint tracking',file:'service-tracking',screen:'activity',cell:'activity',via:'client'},
 'service-leads':{ar:'مصادر الفرص',en:'Opportunity sources',file:'opportunity-sources',screen:'activity',cell:'activity',via:'server'},
 complaints:{ar:'الشكاوى',en:'Complaints',file:'complaints',screen:'complaints',cell:'complaints',via:'server'},
 'service-kpi':{ar:'تقييم خدمة العملاء',en:'Customer-service evaluation',file:'service-evaluation',screen:'service-kpi',cell:'service-kpi',via:'client'},
 followups:{ar:'المتابعات',en:'Follow-ups',file:'followups',screen:'followup',cell:'followup',via:'client'},
 'mold-requests':{ar:'طلبات تصنيع القوالب',en:'Mold requests',file:'mold-requests',screen:'mold-requests',cell:'mold-requests',via:'client'},
 journeys:{ar:'تقرير يوم المندوب',en:'Daily route',file:'day-report',screen:'journeys',cell:'journeys',via:'client'},
 // «خطط المناديب» (lib/daily-plans.ts): the plans of a period the page asks of GET /api/daily-plans?from=&to= and writes (app/daily-plans.tsx).
 plans:{ar:'خطط المناديب',en:'Representatives\' plans',file:'daily-plans',screen:'plans',cell:'plans',via:'client'},
 sales:{ar:'المبيعات',en:'Sales',file:'sales',screen:'sales',cell:'sales',via:'client'},
 kpis:{ar:'نتائج الأداء والتقييم',en:'Performance results',file:'performance-results',screen:'targets',cell:'targets',tab:'results',via:'client'},
 collection:{ar:'التحصيل',en:'Collection',file:'collection',screen:'targets',cell:'targets',tab:'collection',via:'client'},
 quotations:{ar:'عروض الأسعار',en:'Quotations',file:'quotations',screen:'targets',cell:'targets',tab:'quotes',via:'client'},
 targets:{ar:'المستهدفات والأوزان',en:'Targets and weights',file:'targets',screen:'targets',cell:'targets',tab:'targets',via:'client'},
 competitors:{ar:'المنافسون',en:'Competitors',file:'competitors',screen:'competitors',cell:'competitors',via:'client'},
 team:{ar:'الفريق والصلاحيات',en:'Team and permissions',file:'team',screen:'team',cell:'team',via:'client'},
} as const satisfies Record<string,ListExport>;
export type ListExportPage=keyof typeof LIST_EXPORTS;
export const LIST_EXPORT_PAGES=Object.keys(LIST_EXPORTS) as ListExportPage[];
export const isListExportPage=(value:unknown):value is ListExportPage=>typeof value==='string'&&Object.prototype.hasOwnProperty.call(LIST_EXPORTS,value);
/** The lists the server builds (GET /api/list-export?page=). */
export const SERVER_LIST_EXPORTS=LIST_EXPORT_PAGES.filter(page=>LIST_EXPORTS[page].via==='server');

/** Where the list is shown for this role and whose cell decides it. The complaints are on «الشكاوى» for the roles that have that page
 *  (the administrator and customer service) and on «الزيارات» for the sales members, who meet them there (as the complaints report). */
export function listExportPlace(role:string,page:ListExportPage):{screen:PermissionScreen;cell:PermissionScreen}{
 const entry:ListExport=LIST_EXPORTS[page];
 if(page==='complaints'&&!canViewPage(role,'complaints'))return {screen:'activity',cell:'activity'};
 return {screen:entry.screen,cell:entry.cell};
}
/** Whether the member may export this list now: never a field role; the screen shows for them (and its tab, on the targets hub); the
 *  screen's «تصدير» cell is on. The button shows only then, and the server answers by the same rule. */
export function mayExportList(me:Who|null|undefined,page:ListExportPage):boolean{
 if(!me||isFieldRole(me.role)||!isListExportPage(page))return false;
 const entry:ListExport=LIST_EXPORTS[page],{screen,cell}=listExportPlace(me.role,page);
 if(!pageAllowed(me,screen))return false;
 if(entry.tab&&hubTabHidden(me,entry.tab))return false;
 return can(me,cell,'export');
}

/** The most rows one sheet carries; a longer list is cut, and the file's last line and the message say so. */
export const EXPORT_ROW_CAP=20000;
/** The file's name: Yourrest-<page>-<day>.xlsx (the day in Riyadh, as the page's today(); a monthly list names its month, YYYY-MM). */
export function listExportFileName(page:ListExportPage,day:string){return 'Yourrest-'+LIST_EXPORTS[page].file+'-'+(/^\d{4}-\d{2}(?:-\d{2})?$/.test(day)?day:'export')+'.xlsx';}

// ---- cells
const stampFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
/** A moment (an ISO instant) as a date cell on Riyadh's wall clock; empty for none, the text as it is when it is not a moment. */
export function momentCell(iso:string|null|undefined):BookCell{
 if(!iso)return '';
 const at=Date.parse(iso);
 if(!Number.isFinite(at))return iso;
 const parts=Object.fromEntries(stampFormat.formatToParts(new Date(at)).map(part=>[part.type,part.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day} ${parts.hour==='24'?'00':parts.hour}:${parts.minute}`};
}
/** A day ('YYYY-MM-DD') as a date cell; empty for none, the text as it is when it is not a day (a month 'YYYY-MM' stays text). */
export function dayCell(day:string|null|undefined):BookCell{
 const text=typeof day==='string'?day.trim():'';
 return /^\d{4}-\d{2}-\d{2}$/.test(text)?{date:text}:text;
}
/** A number when it is one (a stored number, or a number written as text with Latin digits), else empty. */
export function numberCell(value:unknown):BookCell{
 if(typeof value==='number')return Number.isFinite(value)?value:'';
 if(typeof value==='string'&&/^-?\d+(\.\d+)?$/.test(value.trim()))return Number(value.trim());
 return '';
}
/** Cents as an amount of riyals with two decimals (a number cell). */
export const centsCell=(cents:unknown):BookCell=>typeof cents==='number'&&Number.isFinite(cents)?Math.round(cents)/100:'';
export const yesNo=(value:boolean,say:Say)=>value?say('نعم','Yes'):say('لا','No');
/** Text as it is (an inline string, never a formula); undefined and null are empty. */
export const textCell=(value:unknown):BookCell=>value===null||value===undefined?'':typeof value==='string'?value:typeof value==='number'?(Number.isFinite(value)?String(value):''):String(value);

// ---- sheets
/** One column of a list: its header in both languages, and its cell for a row. */
export type ExportColumn<T>=readonly [ar:string,en:string,value:(row:T)=>BookCell];
export type ExportTable={name:readonly [string,string];header:string[];rows:BookCell[][];total:number;capped:boolean};
/** The table of a list: the header in the page's language and one row per item (at most EXPORT_ROW_CAP). */
export function exportTable<T>(name:readonly [string,string],columns:readonly ExportColumn<T>[],items:readonly T[],language:ExportLanguage):ExportTable{
 const kept=items.slice(0,EXPORT_ROW_CAP);
 return {name,header:columns.map(([ar,en])=>language==='en'?en:ar),rows:kept.map(item=>columns.map(([,,value])=>value(item))),total:items.length,capped:items.length>kept.length};
}
/** What a column of a list the page already words holds, for its cell: a day, a moment, a number; anything else is text. */
export type CellKind='day'|'moment'|'number';
/** One column of a list whose header the page has already put in its language: the header, the value, and what the value is. */
export type ListColumn<T>=readonly [header:string,value:(row:T)=>unknown,kind?:CellKind];
/** A value as its cell: a day or a moment as a date cell, a number as a number cell (text that is not one stays text), else text. */
export function typedCell(value:unknown,kind?:CellKind):BookCell{
 if(kind==='day')return dayCell(typeof value==='string'?value:'');
 if(kind==='moment')return typeof value==='string'?momentCell(value):'';
 if(kind==='number'){const number=numberCell(value);return number===''?textCell(value):number;}
 return textCell(value);
}
/** The table of a list from columns already worded (the visits, the customers and the team of app/crm-app.tsx, whose CSV has the same). */
export function columnsTable<T>(name:readonly [string,string],columns:readonly ListColumn<T>[],items:readonly T[]):ExportTable{
 const kept=items.slice(0,EXPORT_ROW_CAP);
 return {name,header:columns.map(([header])=>header),rows:kept.map(item=>columns.map(([,value,kind])=>typedCell(value(item),kind))),total:items.length,capped:items.length>kept.length};
}
/** The table of rows a page already builds for its CSV (the targets and the evaluation of lib/targets-export.ts): a number stays a number,
 *  a column of kind 'day' or 'moment' becomes a date, the rest is text. */
export function rowsTable(name:readonly [string,string],header:readonly string[],rows:readonly (readonly unknown[])[],kinds:readonly (CellKind|undefined)[]=[]):ExportTable{
 const kept=rows.slice(0,EXPORT_ROW_CAP);
 return {name,header:[...header],rows:kept.map(row=>row.map((value,column)=>typedCell(value,kinds[column]??(typeof value==='number'?'number':undefined)))),total:rows.length,capped:rows.length>kept.length};
}
const cellWidth=(cell:BookCell)=>cell===null||cell===undefined?0:typeof cell==='object'?(cell.date.length>10?16:11):[...String(cell)].length;
/** A table as a sheet of the workbook: right to left in Arabic, the header bold and frozen, the widths from the longest cell (6 to 60),
 *  and under a cut list a grey line that says how many rows were left out. */
export function tableSheet(table:ExportTable,language:ExportLanguage):BookSheet{
 const say=sayIn(language),rows:BookCell[][]=[table.header,...table.rows];
 const widths=table.header.map((_,column)=>Math.max(8,Math.min(60,Math.max(...rows.slice(0,500).map(row=>cellWidth(row[column])))+2)));
 const noteRows:number[]=[];
 if(table.capped){noteRows.push(rows.length);rows.push([say('القائمة أطول من الحد الأعلى للتصدير ('+EXPORT_ROW_CAP+' صف)، والملف يضم أول '+EXPORT_ROW_CAP+' صف من '+table.total+'. ضيّق التصفية لتصدير الباقي.','The list is longer than the export limit ('+EXPORT_ROW_CAP+' rows); the file holds the first '+EXPORT_ROW_CAP+' of '+table.total+'. Narrow the filters to export the rest.')]);}
 return {name:say(table.name[0],table.name[1]),rows,widths,rightToLeft:language!=='en',headerRows:[0],noteRows};
}
export type ExportResult={bytes:Uint8Array<ArrayBuffer>;rows:number;total:number;capped:boolean};
/** The workbook of one or more tables (an empty list still gives its header), with the counts the page's message reports. */
export function listWorkbook(tables:readonly ExportTable[],language:ExportLanguage):ExportResult{
 return {bytes:xlsxBook(tables.map(table=>tableSheet(table,language))),rows:tables.reduce((n,table)=>n+table.rows.length,0),total:tables.reduce((n,table)=>n+table.total,0),capped:tables.some(table=>table.capped)};
}
/** «تصدير Excel» / "Export Excel", and the words of its messages. */
export const EXPORT_TEXT={button:['تصدير Excel','Export to Excel'],busy:['جارٍ التصدير…','Exporting…'],done:['تم تصدير الملف','The file was exported'],
 capped:['القائمة أطول من الحد الأعلى للتصدير؛ الملف يضم أول الصفوف فقط. ضيّق التصفية لتصدير الباقي.','The list is longer than the export limit; the file holds the first rows only. Narrow the filters to export the rest.'],
 failed:['تعذّر التصدير. حاول مرة أخرى.','The export failed. Please try again.']} as const satisfies Record<string,readonly [string,string]>;

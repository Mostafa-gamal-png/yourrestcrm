import type {Row} from './crm';
import {erpCustomerColumns,cleanCell,type SheetLike} from './erp-customers';

/** What the ERP customer export says beside the code and the contact cells (the owner, 2026-11-12: «فيه فى داتة العملاء اللى برفعها
 * التاريخ واسم المندوب هاتهم من هنا»): «التاريخ», the day the customer was created in the ERP, kept on the customer as
 * `data.erpCreatedAt` (YYYY-MM-DD), and, when the file has one, the representative's column, kept as `data.erpRep` {employeeId?, name?}
 * (never a reassignment: the customer keeps its CRM responsible). Both feed «العملاء الجدد» (lib/new-customers.ts, which also maps the representative to a member). An empty or unreadable
 * cell never erases what a customer has. Pure; lib/erp-customers-server.ts writes them with the rest of the import. */
export const erpCustomerRepColumns={name:['المندوب','اسم المندوب'],employeeId:['رقم الموظف','كود المندوب']} as const;
export type ErpCustomerRep={employeeId?:string;name?:string};
export type ErpCustomerExtra={erpCreatedAt?:string;erpRep?:ErpCustomerRep;invalidDate?:boolean};
export type ErpCustomerExtras={rows:Map<number,ErpCustomerExtra>;dateColumn:boolean;repColumn:boolean;dates:number;invalidDates:number;reps:number};

const latin=(value:string)=>value.replace(/[٠-٩۰-۹]/g,digit=>String(digit.charCodeAt(0)-(digit>='۰'?0x6f0:0x660)));
const headerKey=(value:unknown)=>cleanCell(value).normalize('NFKC').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase();
const day=(y:number,m:number,d:number)=>{const instant=new Date(Date.UTC(y,m-1,d));return y>=1990&&y<=2200&&instant.getUTCFullYear()===y&&instant.getUTCMonth()===m-1&&instant.getUTCDate()===d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;};
const time=String.raw`(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AaPp][Mm]|ص|م)?Z?)?`;
const ymd=new RegExp(String.raw`^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})${time}$`),dmy=new RegExp(String.raw`^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})${time}$`);
/** «التاريخ» of the ERP customer export as YYYY-MM-DD: 2026/11/03 or 2026-11-03 (year first), 03/11/2026 (day first, as the ERP writes
 * it), with or without a time, an Excel serial day (46329, the 1900 system), Arabic or Persian digits. '' for an empty cell, null for
 * anything else (an impossible day, a year before 1990, text). */
export function erpCustomerDate(value:unknown):string|null{
 const text=latin(cleanCell(value));
 if(!text)return '';
 let match=ymd.exec(text);if(match)return day(Number(match[1]),Number(match[2]),Number(match[3]));
 match=dmy.exec(text);if(match)return day(Number(match[3]),Number(match[2]),Number(match[1]));
 if(/^\d{5}(?:\.\d+)?$/.test(text)){const serial=Math.floor(Number(text));if(serial<61||serial>110000)return null;const instant=new Date(Date.UTC(1899,11,30)+serial*86400000);return day(instant.getUTCFullYear(),instant.getUTCMonth()+1,instant.getUTCDate());}
 return null;
}

/** The date and representative of every row of the sheet erpCustomerRows read (`sheet`), by the row's number: its header is the first row
 * (of the first 25) with «رقم العميل» and a name or phone column, as there. A file without «التاريخ» or a representative column reads none. */
export function erpCustomerExtras(sheets:SheetLike[],sheet:string):ErpCustomerExtras{
 const result:ErpCustomerExtras={rows:new Map(),dateColumn:false,repColumn:false,dates:0,invalidDates:0,reps:0};
 const source=sheets.find(candidate=>candidate.name===sheet);if(!source)return result;
 const keyOf=(labels:readonly string[])=>labels.map(headerKey),identity=keyOf([erpCustomerColumns.name,erpCustomerColumns.nameEn,erpCustomerColumns.mobile,erpCustomerColumns.phone]);
 const at=source.rows.slice(0,25).findIndex(row=>{const keys=row.cells.map(headerKey);return keys.includes(headerKey(erpCustomerColumns.code))&&identity.some(key=>keys.includes(key));});
 if(at<0)return result;
 const keys=source.rows[at].cells.map(headerKey),column=(labels:readonly string[])=>keyOf(labels).map(key=>keys.indexOf(key)).filter(index=>index>=0);
 const dateColumn=keys.indexOf(headerKey(erpCustomerColumns.date)),nameColumns=column(erpCustomerRepColumns.name),idColumns=column(erpCustomerRepColumns.employeeId),codeColumn=keys.indexOf(headerKey(erpCustomerColumns.code));
 result.dateColumn=dateColumn>=0;result.repColumn=nameColumns.length+idColumns.length>0;
 const first=(row:{cells:string[]},columns:number[],max:number)=>{for(const index of columns){const value=cleanCell(row.cells[index]);if(value)return value.slice(0,max);}return '';};
 for(const row of source.rows.slice(at+1)){
  if(row.cells.every(value=>!cleanCell(value))||headerKey(row.cells[codeColumn])===headerKey(erpCustomerColumns.code))continue;
  const extra:ErpCustomerExtra={};
  if(dateColumn>=0){const date=erpCustomerDate(row.cells[dateColumn]);if(date){extra.erpCreatedAt=date;result.dates++;}else if(date===null){extra.invalidDate=true;result.invalidDates++;}}
  const employeeId=first(row,idColumns,100),name=first(row,nameColumns,200);
  if(employeeId||name){extra.erpRep={...(employeeId?{employeeId}:{}),...(name?{name}:{})};result.reps++;}
  if(extra.erpCreatedAt||extra.erpRep||extra.invalidDate)result.rows.set(row.rowNumber,extra);
 }
 return result;
}

/** The fields a row gives a customer it is added as: the date and representative it has, nothing for an empty cell. */
export function erpExtraData(extra:ErpCustomerExtra|undefined):Record<string,unknown>{
 return {...(extra?.erpCreatedAt?{erpCreatedAt:extra.erpCreatedAt}:{}),...(extra?.erpRep?{erpRep:extra.erpRep}:{})};
}
export const storedRep=(value:unknown):ErpCustomerRep|undefined=>{
 if(!value||typeof value!=='object')return undefined;const rep=value as Record<string,unknown>,out:ErpCustomerRep={};
 if(typeof rep.employeeId==='string'&&rep.employeeId)out.employeeId=rep.employeeId;if(typeof rep.name==='string'&&rep.name)out.name=rep.name;
 return out.employeeId||out.name?out:undefined;
};
/** What a row changes on a customer it ends on: `set` the new values, `from` the old ones (absent when there were none); null when the row
 * changes nothing. A cell the file leaves empty keeps the stored value; a representative the file names differently replaces the stored one
 * (its other field is dropped when the file does not give it, so a new name never keeps the old employee number). */
export function erpExtraChange(data:Record<string,unknown>,extra:ErpCustomerExtra|undefined){
 if(!extra)return null;
 const set:{erpCreatedAt?:string;erpRep?:ErpCustomerRep}={},from:{erpCreatedAt?:string;erpRep?:ErpCustomerRep}={};
 const oldDate=typeof data.erpCreatedAt==='string'?data.erpCreatedAt:'';
 if(extra.erpCreatedAt&&extra.erpCreatedAt!==oldDate){set.erpCreatedAt=extra.erpCreatedAt;if(oldDate)from.erpCreatedAt=oldDate;}
 const old=storedRep(data.erpRep);
 if(extra.erpRep){
  const next:ErpCustomerRep={...old};
  for(const field of ['employeeId','name'] as const){const value=extra.erpRep[field],other=field==='name'?'employeeId':'name';if(value&&value!==old?.[field]){next[field]=value;if(!extra.erpRep[other])delete next[other];}}
  const canonical=(rep?:ErpCustomerRep)=>JSON.stringify([rep?.employeeId||'',rep?.name||'']);
  if(canonical(next)!==canonical(old)){set.erpRep={...(next.employeeId?{employeeId:next.employeeId}:{}),...(next.name?{name:next.name}:{})};if(old)from.erpRep=old;}
 }
 return Object.keys(set).length?{set,from}:null;
}
export type ErpExtraUpdate={row:number;customerId:string;version:number;set:{erpCreatedAt?:string;erpRep?:ErpCustomerRep};from:{erpCreatedAt?:string;erpRep?:ErpCustomerRep}};
/** The customers the import's rows end on (not added, not in conflict) whose ERP date or representative the file changes, each once (the
 * first row naming it), for those `mayChange` allows. */
export function erpExtraUpdates(outcomes:{row:number;customerId:string;add:boolean;conflict:boolean}[],extras:ErpCustomerExtras,customers:Map<string,Row>,mayChange:(customer:Row)=>boolean):ErpExtraUpdate[]{
 const updates:ErpExtraUpdate[]=[],seen=new Set<string>();
 for(const outcome of outcomes){
  if(outcome.add||!outcome.customerId||outcome.conflict||seen.has(outcome.customerId))continue;
  const customer=customers.get(outcome.customerId);if(!customer)continue;
  const change=erpExtraChange(customer.data,extras.rows.get(outcome.row));if(!change||!mayChange(customer))continue;
  seen.add(customer.id);updates.push({row:outcome.row,customerId:customer.id,version:customer.version,...change});
 }
 return updates;
}

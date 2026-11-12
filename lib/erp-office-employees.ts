// «مبيعات مكتب (مستبعد)» for a person (the owner, 2026-11-12, of an ERP employee shown in «ربط الموظفين بالمناديب»: «ده مبيعات مكتب مش
// تبع المبيعات»). The ERP's own «مبيعات مكتب» / «مبيعات المكتب» is excluded by its name (lib/erp-sales.ts isOfficeEmployee, unchanged);
// a real employee who works in office sales is not caught by that, so the employee mappings of the ERP sales import, the ERP quotations
// import and the names of the collection statement offer «مبيعات مكتب (مستبعد)» beside the representatives. Choosing it marks the person
// as office: their documents are excluded exactly as «مبيعات مكتب» (status excluded, counted for no representative, never blocking).
//
// Where: one row of crm_settings (id ERP_OFFICE_SETTING, the JSON in owner_id, like the other import states: no migration), the list of
// {employeeId, employeeName, by, at}. A mark from the sales or the quotations import is keyed by the ERP employee number (its name kept as
// the file wrote it); one made in the collection statement, which has names only, has employeeId ''. A number mark is read by the
// sales and quotations imports by its number, and by the collection statement by its name; a name mark is read by the collection
// statement, and by the two other imports only to suggest it for an unmapped number of exactly that full name (as they suggest a
// representative of that name), saved as a number mark with the import. The row is its own concurrency token: every import that reads it
// refuses its commit (409) when it changed since the preview, and writes it only inside the import's own transaction.
// Pure apart from the two statements at the end; no import of lib/erp-sales.ts (the server tests replace that module by a stub).

/** The value of «مبيعات مكتب (مستبعد)» in a select and in the imports' mapping choices (no member id has a colon). */
export const ERP_OFFICE_CHOICE='office:excluded';
/** The crm_settings row. */
export const ERP_OFFICE_SETTING='erp-office-employees';
/** The record of the audit line written whenever an import changes the list. */
export const ERP_OFFICE_AUDIT_ACTION='تحديد موظفي مبيعات المكتب';
export type OfficeEmployee={employeeId:string;employeeName:string;by:string;at:string};
export type OfficeEmployeeList={employees:OfficeEmployee[]};

const marks=/[​-‏‪-‮⁦-⁩﻿]/g;
const text=(value:unknown)=>String(value??'').normalize('NFKC').replace(marks,'').replace(/\s+/g,' ').trim();
const latinDigits=(value:string)=>value.replace(/[٠-٩۰-۹]/g,d=>String(d.charCodeAt(0)-(d>='۰'?0x6f0:0x660)));
/** The key of an ERP employee number: the sales import's (marks and repeated spaces removed) with Arabic-Indic digits read as digits
 *  (the quotations import's), so both imports find the same mark. */
export const officeIdKey=(value:unknown)=>latinDigits(text(value));
/** The key of a name: the full name as the imports compare names (lib/erp-collections.ts collectionNameKey). */
export const officeNameKey=(value:unknown)=>text(value).toLowerCase();

/** The stored list, each entry once (a broken or missing row is an empty list: nothing is office but by its name). */
export function parseOfficeList(raw:string|null|undefined):OfficeEmployeeList{
 if(!raw)return {employees:[]};
 let value:unknown;try{value=JSON.parse(raw);}catch{return {employees:[]};}
 const list=value&&typeof value==='object'&&Array.isArray((value as OfficeEmployeeList).employees)?(value as OfficeEmployeeList).employees:[];
 const seen=new Set<string>(),employees:OfficeEmployee[]=[];
 for(const item of list){
  if(!item||typeof item!=='object')continue;
  const employeeId=text(item.employeeId).slice(0,100),employeeName=text(item.employeeName).slice(0,200);
  if(!employeeId&&!employeeName)continue;
  const key=employeeId?'id:'+officeIdKey(employeeId):'name:'+officeNameKey(employeeName);
  if(seen.has(key))continue;seen.add(key);
  employees.push({employeeId,employeeName,by:text(item.by).slice(0,200),at:text(item.at).slice(0,40)});
 }
 return {employees};
}
export const serializeOfficeList=(list:OfficeEmployeeList)=>JSON.stringify({employees:list.employees});

/** The marks by employee number. */
export function officeById(list:OfficeEmployeeList){const map=new Map<string,OfficeEmployee>();for(const e of list.employees)if(e.employeeId)map.set(officeIdKey(e.employeeId),e);return map;}
/** The marks made by name only (the collection statement's). */
export function officeNameOnly(list:OfficeEmployeeList){const map=new Map<string,OfficeEmployee>();for(const e of list.employees)if(!e.employeeId&&e.employeeName)map.set(officeNameKey(e.employeeName),e);return map;}
/** Every mark by name, for the collection statement (names only): a number mark by the name the ERP file showed with it. 'id' when any
 *  mark of that name is a number mark (changed from the sales import only), else 'name'. */
export function officeByName(list:OfficeEmployeeList){
 const map=new Map<string,'id'|'name'>();
 for(const e of list.employees){const key=officeNameKey(e.employeeName);if(!key)continue;if(e.employeeId)map.set(key,'id');else if(!map.has(key))map.set(key,'name');}
 return map;
}

export type OfficeChanges={
 /** Numbers to mark (with the name the file shows). */
 markIds?:{employeeId:string;employeeName:string}[];
 /** Numbers to unmark (keys or numbers). */
 unmarkIds?:string[];
 /** Names to mark (the collection statement). */
 markNames?:string[];
 /** Names to unmark: name marks only. */
 unmarkNames?:string[];
};
/** The list after the changes, in a stable order (numbers, then names). */
export function applyOfficeChanges(list:OfficeEmployeeList,changes:OfficeChanges,by:string,at:string):OfficeEmployeeList{
 const ids=new Map<string,OfficeEmployee>(),names=new Map<string,OfficeEmployee>();
 for(const e of list.employees){if(e.employeeId)ids.set(officeIdKey(e.employeeId),e);else names.set(officeNameKey(e.employeeName),e);}
 for(const id of changes.unmarkIds||[])ids.delete(officeIdKey(id));
 for(const name of changes.unmarkNames||[])names.delete(officeNameKey(name));
 for(const m of changes.markIds||[]){const key=officeIdKey(m.employeeId);if(key&&!ids.has(key))ids.set(key,{employeeId:text(m.employeeId).slice(0,100),employeeName:text(m.employeeName).slice(0,200),by,at});}
 for(const name of changes.markNames||[]){const key=officeNameKey(name);if(key&&!names.has(key))names.set(key,{employeeId:'',employeeName:text(name).slice(0,200),by,at});}
 const byKey=<T,>(map:Map<string,T>)=>[...map].sort(([a],[b])=>a.localeCompare(b,'en')).map(([,v])=>v);
 return {employees:[...byKey(ids),...byKey(names)]};
}

/** The row as read (its text is the concurrency token: null when there is none). */
export async function readOfficeRow(db:D1Database):Promise<{raw:string|null;list:OfficeEmployeeList}>{
 const row=await db.prepare('SELECT owner_id AS raw FROM crm_settings WHERE id=?').bind(ERP_OFFICE_SETTING).first<{raw:string}>();
 const raw=row?.raw??null;return {raw,list:parseOfficeList(raw)};
}
/** A condition (and its arguments) that holds while the row is exactly as read. */
export function officeUnchanged(raw:string|null){return {sql:'(SELECT owner_id FROM crm_settings WHERE id=?) IS ?',args:[ERP_OFFICE_SETTING,raw] as (string|null)[]};}
/** Writes the list when `condition` holds (the import's claim). */
export function writeOfficeList(db:D1Database,list:OfficeEmployeeList,condition:string,args:unknown[]){
 return db.prepare('INSERT INTO crm_settings(id,owner_id) SELECT ?,? WHERE '+condition+' ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id').bind(ERP_OFFICE_SETTING,serializeOfficeList(list),...args);
}

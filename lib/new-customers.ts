import type {Member,Row} from './crm';

// ---- The representative of the ERP customers file (`data.erpRep`, lib/erp-customer-extras.ts) as a CRM member. Kept here, without the
// ERP upload parser (lib/erp-sales.ts), because the KPI reads load this and never the parser.
const normalize=(value:string)=>value.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').replace(/\s+/g,' ').trim();
const nameKey=(value:string)=>normalize(value).toLowerCase();
/** «مبيعات مكتب»: the same names, normalized the same way, as isOfficeEmployee of lib/erp-sales.ts (tests/new-customers-erp.mjs checks both agree). */
export const isOfficeRepName=(value:unknown)=>['مبيعات مكتب','مبيعات المكتب'].includes(normalize(String(value??'')));
export type ErpRepResolver={byEmployee:Map<string,string>;byName:Map<string,string[]>};
/** From the ERP employee mappings (crm_erp_employee_mappings: the ERP employee number → a CRM member, saved by the ERP sales and quotations
 * imports) and the representatives by their full name, as the ERP sales import matches them (normalized, never partial or similar). */
export function erpRepResolver(mappings:{employeeId:string;repId:string}[],members:Pick<Member,'id'|'name'|'role'>[]):ErpRepResolver{
 const byName=new Map<string,string[]>();
 for(const member of members){if(member.role!=='rep')continue;const key=nameKey(String(member.name||''));if(key)byName.set(key,[...(byName.get(key)||[]),member.id]);}
 return {byEmployee:new Map(mappings.map(mapping=>[normalize(mapping.employeeId),mapping.repId])),byName};
}
/** Whom a stored `erpRep` names: 'office' («مبيعات مكتب», never counted), a member (by the employee number's mapping, else by a full name
 * exactly one representative carries), or null (nobody the CRM knows, or nothing stored). */
export function resolveErpRep(value:unknown,resolver:ErpRepResolver|undefined):'office'|{memberId:string}|null{
 if(!value||typeof value!=='object')return null;
 const rep=value as {employeeId?:unknown;name?:unknown},name=typeof rep.name==='string'?rep.name:'',employeeId=typeof rep.employeeId==='string'?rep.employeeId:'';
 if(!name&&!employeeId)return null;
 if(name&&isOfficeRepName(name))return 'office';
 const byId=employeeId&&resolver?.byEmployee.get(normalize(employeeId));if(byId)return {memberId:byId};
 const byName=name?resolver?.byName.get(nameKey(name))||[]:[];
 return byName.length===1?{memberId:byName[0]}:null;
}

/** Whom the ERP representative of a customer (`data.erpRep`) names, worked out on the server (resolveErpRep with the ERP employee
 * mappings): 'office' for «مبيعات مكتب», a member id, or null when the file names nobody the CRM knows (or no representative at all). */
export type ErpRepAttribution=(erpRep:unknown)=>'office'|{memberId:string}|null;
/** The id the ERP customers import gives a customer it adds ('crm-<member>-erp-<request uuid>-<row>'): that customer was imported, not
 * added by hand, even though `_createdBy` names the member who imported it. */
const ERP_IMPORTED_ID=/-erp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+$/i;
export const erpImportedCustomer=(row:Pick<Row,'id'>)=>ERP_IMPORTED_ID.test(row.id);
const riyadhDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
const isDay=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);

/** «العملاء الجدد» of a month (the owner, 2026-11-12: the ERP customers file has the date and the representative: «هاتهم من هنا»). Each
 * customer is credited to at most one member for the month, so it is never counted twice:
 *  (a) added by hand in the app during the month (its record made in the month, Riyadh days, not by a file import nor by the ERP
 *      customers import) → the member who added it (`_createdBy`), as before;
 *  (b) otherwise, its creation day in the ERP (`data.erpCreatedAt`, from «التاريخ» of the ERP customers file) in the month → the
 *      representative the file names when it maps to a CRM member; when the file names nobody (the current file has no representative
 *      column) or names someone the CRM cannot match, the customer's current responsible in the CRM (`assignedTo`). A customer the file
 *      gives to «مبيعات مكتب» is never counted.
 * `unknown`: a customer made in the month with no record of who made it and no ERP date: it cannot be credited without a guess, so the
 * metric stays unknown, as before. A customer with an ERP date is never unknown: its date decides. */
export function newCustomerCredits(customers:Row[],period:{first:string;cutoff:string},attribute?:ErpRepAttribution){
 const credits=new Map<string,string>(),inPeriod=(day:string)=>day>=period.first&&day<=period.cutoff;let unknown=false,erp=0,office=0;
 for(const customer of customers){
  if(customer.kind!=='customer')continue;
  const data=customer.data||{},erpDay=isDay(data.erpCreatedAt)?data.erpCreatedAt:'';
  const madeHere=!data.sourceFile&&!!customer.createdAt&&!erpImportedCustomer(customer)&&inPeriod(riyadhDay.format(new Date(customer.createdAt)));
  if(madeHere){
   if(data._createdBy){credits.set(customer.id,String(data._createdBy));continue;}
   if(!erpDay){unknown=true;continue;}
  }
  if(!erpDay||!inPeriod(erpDay))continue;
  const named=data.erpRep?attribute?.(data.erpRep)??null:null;
  if(named==='office'){office++;continue;}
  const memberId=named?named.memberId:String(customer.assignedTo||data.assignedTo||'');
  if(memberId){credits.set(customer.id,memberId);erp++;}
 }
 return {credits,unknown,erp,office};
}
/** The customers credited to any of `ids` (a person, or a team's members), each once. */
export const newCustomersOf=(credits:Map<string,string>,ids:Set<string>)=>[...credits.values()].filter(id=>ids.has(id)).length;

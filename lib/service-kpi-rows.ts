import type {Member} from './crm';
import type {ServiceCase} from './customer-service';
import {decodeComplaints} from './complaint-rows';
import {loadAllSupport} from './support-rows';
import {SERVICE_AUDIT_KIND,SERVICE_KPI_MONTH_KIND,SERVICE_KPI_SETTINGS_ID,SERVICE_KPI_SETTINGS_KIND,normalizeSettings,type KpiInput,type ServiceAuditRow,type ServiceKpiMonthRow} from './service-kpi';

/** Reading what the customer-service evaluation needs out of the database. Complaints and service requests are read through a
 * projection of only the fields the figures use, so no description, note or contact travels into the evaluation. A row whose data
 * is damaged or is not of the expected kind is left out, never shown. */
type Raw={id:string;branch:string;assignedTo:string;data:string;createdAt:string;updatedAt:string;version:number};
const columns='id,branch,assigned_to AS assignedTo,data,created_at AS createdAt,updated_at AS updatedAt,version';
const complaintProjection=`id,branch,assigned_to AS assignedTo,json_object('kind',json_extract(data,'$.kind'),'customerId',json_extract(data,'$.customerId'),'registrarId',json_extract(data,'$.registrarId'),'serviceManagerId',json_extract(data,'$.serviceManagerId'),'severity',json_extract(data,'$.severity'),'resolvedAt',json_extract(data,'$.resolvedAt'),'events',json(json_extract(data,'$.events'))) AS data,created_at AS createdAt,updated_at AS updatedAt,version`;
const caseProjection=`id,customer_id AS customerId,status,creator_id AS creatorId,service_manager_id AS serviceManagerId,sales_manager_id AS salesManagerId,assigned_to AS assignedTo,supervisor_id AS supervisorId,json_object('approvedAt',json_extract(data,'$.approvedAt'),'approvedBy',json_extract(data,'$.approvedBy'),'resubmittedAt',json_extract(data,'$.resubmittedAt')) AS data,created_at AS createdAt,updated_at AS updatedAt,version`;
function decodeKind<T extends {data:{kind?:string}}>(rows:Raw[],kind:string):T[]{
 const found:T[]=[];
 for(const row of rows){try{const data=JSON.parse(row.data);if(data&&data.kind===kind)found.push({...row,data} as unknown as T);}catch{/* a damaged row is left out, never shown */}}
 return found;
}
export async function loadAuditRows(db:D1Database){return decodeKind<ServiceAuditRow>((await db.prepare(`SELECT ${columns} FROM crm_records WHERE kind='${SERVICE_AUDIT_KIND}' ORDER BY created_at,id`).all<Raw>()).results,SERVICE_AUDIT_KIND);}
export async function loadAuditRow(db:D1Database,id:string){return decodeKind<ServiceAuditRow>((await db.prepare(`SELECT ${columns} FROM crm_records WHERE kind='${SERVICE_AUDIT_KIND}' AND id=?`).bind(id).all<Raw>()).results,SERVICE_AUDIT_KIND)[0];}
export async function loadMonthRows(db:D1Database){return decodeKind<ServiceKpiMonthRow>((await db.prepare(`SELECT ${columns} FROM crm_records WHERE kind='${SERVICE_KPI_MONTH_KIND}' ORDER BY created_at,id`).all<Raw>()).results,SERVICE_KPI_MONTH_KIND);}
/** The stored settings, filled in from the defaults, and the version of the row they came from (0 when nothing was ever saved). */
export async function loadSettings(db:D1Database){
 const row=await db.prepare(`SELECT data,version FROM crm_records WHERE id=? AND kind='${SERVICE_KPI_SETTINGS_KIND}'`).bind(SERVICE_KPI_SETTINGS_ID).first<{data:string;version:number}>();
 if(!row)return {settings:normalizeSettings(undefined),version:0};
 try{return {settings:normalizeSettings(JSON.parse(row.data)),version:row.version};}catch{return {settings:normalizeSettings(undefined),version:row.version};}
}
export async function loadComplaintsForKpi(db:D1Database){return decodeComplaints((await db.prepare(`SELECT ${complaintProjection} FROM crm_records WHERE kind='complaint' ORDER BY created_at,id`).all<Raw>()).results);}
export async function loadServiceCasesForKpi(db:D1Database){
 const found:ServiceCase[]=[];
 for(const row of (await db.prepare(`SELECT ${caseProjection} FROM crm_service_cases ORDER BY created_at,id`).all<Raw & {customerId:string;status:string;creatorId:string}>()).results){
  try{found.push({...row,data:JSON.parse(row.data)} as unknown as ServiceCase);}catch{/* a damaged row is left out */}
 }
 return found;
}
/** Everything the evaluation of any month is computed from. */
export async function loadServiceKpiInput(db:D1Database,members:Member[]):Promise<{input:KpiInput;settingsVersion:number}>{
 const [complaints,support,serviceCases,audits,closed,saved]=await Promise.all([loadComplaintsForKpi(db),loadAllSupport(db),loadServiceCasesForKpi(db),loadAuditRows(db),loadMonthRows(db),loadSettings(db)]);
 return {input:{members,complaints,support,serviceCases,audits,closed,settings:saved.settings},settingsVersion:saved.version};
}

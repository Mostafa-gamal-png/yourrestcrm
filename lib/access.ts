import type {Member,Row} from './crm';

/** Commercial reporting and pricing are management workspaces. */
export const canUseSalesWorkspace=(role:string)=>['admin','manager','supervisor'].includes(role);
export function canViewPage(role:string,view:string){
 if(role==='rep')return ['customer','map','activity','followup','targets'].includes(view);
 // Customer complaints have a page of their own for customer service and administrators; sales members meet them on the Visits page.
 // The customer-service evaluation has one for the manager and the administrator; a representative meets theirs on the Complaints page.
 if(['customer_service','customer_service_manager'].includes(role))return view==='activity'||view==='complaints'||view==='service-kpi'&&role==='customer_service_manager';
 if(!canUseSalesWorkspace(role))return false;
 if(view==='team'||view==='complaints'||view==='service-kpi')return role==='admin';
 return ['dashboard','customer','map','activity','followup','competitors','journeys','quote','sales','targets'].includes(view);
}

/** Preserve old bookmarks without granting access to a management workspace. */
export function resolveCRMPage(role:string,view:string){
 const page=view==='factory'?'customer':['opportunity','service'].includes(view)?'activity':view==='reports'&&canUseSalesWorkspace(role)?'targets':view;
 return canViewPage(role,page)?page:'activity';
}

/** Reporting history includes inactive members; assignment selectors can request activeOnly. */
export function salesScopeMemberIds(members:Member[],me:Member,options:{activeOnly?:boolean}={}){
 const scoped=members.filter(member=>member.id===me.id||me.role==='admin'||me.role==='manager'&&['supervisor','rep'].includes(member.role)||me.role==='supervisor'&&member.role==='rep'&&member.supervisorId===me.id);
 return new Set(scoped.filter(member=>!options.activeOnly||!!member.active).map(member=>member.id));
}

/** Only stored recorder evidence grants entry visibility; customer routing is not authorship. */
export function recordAuthorId(row:Row,members:Member[]):string|undefined{
 return resolveRecordAuthor(row,email=>members.find(member=>member.email.toLowerCase()===email)?.id);
}
function resolveRecordAuthor(row:Row,resolveEmail:(email:string)=>string|undefined):string|undefined{
 const data=row.data||{},performed=String(data.performedBy||'').trim();
 if(performed)return performed;
 const email=String(data.recordedByEmail||'').trim().toLowerCase();
 if(email)return resolveEmail(email);
 const responsible=String(data.responsibleId||'').trim();
 return responsible||undefined;
}

/** One synchronous projection gets one fresh index; never reuse across requests. */
export function salesRecordAccess(members:Member[],me:Member){
 const team=salesScopeMemberIds(members,me),emails=new Map<string,string>();
 for(const member of members){const email=member.email.toLowerCase();if(!emails.has(email))emails.set(email,member.id);}
 const author=(row:Row)=>resolveRecordAuthor(row,email=>emails.get(email));
 return{
  canRead(row:Row){
   if(row.kind==='customer'||row.kind==='factory')return !['customer_service','customer_service_manager'].includes(me.role);
   if(me.role==='admin')return true;
   if(row.kind==='quote'&&!canUseSalesWorkspace(me.role)||!['manager','supervisor','rep'].includes(me.role))return false;
   const id=author(row);return !!id&&team.has(id);
  },
  canManageMaster(row:Row){return me.role==='rep'&&row.kind==='customer'||canUseSalesWorkspace(me.role)&&(me.role==='admin'||team.has(row.assignedTo));},
  canEditCustomerDetails(row:Row){return row.kind==='customer'&&(['rep','manager','admin'].includes(me.role)||me.role==='supervisor'&&team.has(row.assignedTo));},
  canEditMachine(row:Row){return row.kind==='factory'&&(me.role==='rep'?row.assignedTo===me.id:canUseSalesWorkspace(me.role)&&(me.role==='admin'||team.has(row.assignedTo)));},
 };
}

/** Source-author check only; callers apply the customer's region boundary separately. */
export function canReadSalesRecord(row:Row,members:Member[],me:Member){
 if(['customer','factory'].includes(row.kind))return !['customer_service','customer_service_manager'].includes(me.role);
 if(me.role==='admin')return true;
 if(row.kind==='quote'&&!canUseSalesWorkspace(me.role))return false;
 if(!['manager','supervisor','rep'].includes(me.role))return false;
 const author=recordAuthorId(row,members);
 return !!author&&salesScopeMemberIds(members,me).has(author);
}

/** A machine belongs to its customer's responsible member: a representative adds and corrects the machines of their own customers (never deletes them), the sales roles those of their team. */
export function canEditMachineRecord(row:Row,members:Member[],me:Member){return row.kind==='factory'&&(me.role==='rep'?row.assignedTo===me.id:canUseSalesWorkspace(me.role)&&(me.role==='admin'||salesScopeMemberIds(members,me).has(row.assignedTo)));}

/** Regional reps may edit customer details; assignment and deletion remain restricted by the route. */
export function canManageMasterRecord(row:Row,members:Member[],me:Member){return me.role==='rep'&&row.kind==='customer'||canUseSalesWorkspace(me.role)&&(me.role==='admin'||salesScopeMemberIds(members,me).has(row.assignedTo));}

/** The regional address book is shared; correcting it does not grant routing or history rights. */
export function canEditCustomerDetails(row:Row,members:Member[],me:Member){return row.kind==='customer'&&(['rep','manager','admin'].includes(me.role)||me.role==='supervisor'&&salesScopeMemberIds(members,me).has(row.assignedTo));}

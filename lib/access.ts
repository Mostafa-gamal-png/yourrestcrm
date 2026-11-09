import type {Member,Row} from './crm';
/** «عرض بيانات الفريق بالكامل» (lib/permissions.ts): a supervisor or a sales manager the administrator switched it on for. */
export const viewsWholeTeam=(me:Member)=>(me.role==='supervisor'||me.role==='manager')&&me.access?.viewAll===true;

/** Commercial reporting and pricing are management workspaces. */
export const canUseSalesWorkspace=(role:string)=>['admin','manager','supervisor'].includes(role);
export function canViewPage(role:string,view:string){
 if(role==='rep')return ['customer','map','activity','followup','targets','mold-requests'].includes(view);
 // Customer complaints have a page of their own for customer service and administrators; sales members meet them on the Visits page.
 // The customer-service evaluation has one for the manager and the administrator; a representative meets theirs on the Complaints page.
 // Mold requests are for every role (the owner, 2026-11-01), customer service included.
 if(['customer_service','customer_service_manager'].includes(role))return view==='activity'||view==='complaints'||view==='mold-requests'||view==='service-kpi'&&role==='customer_service_manager';
 if(!canUseSalesWorkspace(role))return false;
 if(view==='trash')return trashScope(role)!==null;
 if(view==='team'||view==='complaints'||view==='service-kpi')return role==='admin';
 return ['dashboard','customer','map','activity','followup','competitors','journeys','quote','sales','targets','mold-requests'].includes(view);
}

/** «المحذوفات» (2026-11-09): the administrator sees and restores every deletion, the sales manager only those they made themselves (the
 *  roles that delete customers; only the administrator deletes visits and follow-ups); nobody else has the page. One place, so the
 *  permissions matrix can make it a switch later. */
export function trashScope(role:string):'all'|'own'|null{return role==='admin'?'all':role==='manager'?'own':null;}

/** Preserve old bookmarks without granting access to a management workspace. A screen the administrator hid from the member (hidden,
 *  lib/permissions.ts) is not opened either: the first screen the member has, «الزيارات» when it is not hidden. */
export function resolveCRMPage(role:string,view:string,hidden:readonly string[]=[]){
 const page=view==='factory'?'customer':['opportunity','service'].includes(view)?'activity':view==='reports'&&canUseSalesWorkspace(role)?'targets':view;
 const shown=(screen:string)=>canViewPage(role,screen)&&(role==='admin'||!hidden.includes(screen));
 if(shown(page))return page;
 return ['activity','dashboard','customer','map','followup','mold-requests','complaints','targets','journeys','quote','sales','competitors','service-kpi','trash','team'].find(shown)||'activity';
}

/** Reporting history includes inactive members; assignment selectors can request activeOnly. read: a place that only READS may widen to
 *  every sales member when the administrator switched «عرض بيانات الفريق بالكامل» on for this supervisor or sales manager (me.access.viewAll,
 *  lib/permissions.ts); every write, assignment and commit check keeps the team as the role defines it (read omitted). */
export function salesScopeMemberIds(members:Member[],me:Member,options:{activeOnly?:boolean;read?:boolean}={}){
 const wide=!!options.read&&viewsWholeTeam(me);
 const scoped=members.filter(member=>member.id===me.id||me.role==='admin'||wide&&['admin','manager','supervisor','rep'].includes(member.role)||me.role==='manager'&&['supervisor','rep'].includes(member.role)||me.role==='supervisor'&&member.role==='rep'&&member.supervisorId===me.id);
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
/** canRead follows the reader's scope (wider with «عرض بيانات الفريق بالكامل»); readOnly(row) says a row is read only through that widening
 *  (the page shows it without edit or delete; the routes refuse writes on it by the team's own scope). The edit checks keep the team. */
export function salesRecordAccess(members:Member[],me:Member){
 const team=salesScopeMemberIds(members,me),readable=viewsWholeTeam(me)?salesScopeMemberIds(members,me,{read:true}):team,emails=new Map<string,string>();
 for(const member of members){const email=member.email.toLowerCase();if(!emails.has(email))emails.set(email,member.id);}
 const author=(row:Row)=>resolveRecordAuthor(row,email=>emails.get(email));
 return{
  canRead(row:Row){
   if(row.kind==='customer'||row.kind==='factory')return !['customer_service','customer_service_manager'].includes(me.role);
   if(me.role==='admin')return true;
   if(row.kind==='quote'&&!canUseSalesWorkspace(me.role)||!['manager','supervisor','rep'].includes(me.role))return false;
   const id=author(row);return !!id&&readable.has(id);
  },
  readOnly(row:Row){if(readable===team||['customer','factory'].includes(row.kind))return false;const id=author(row);return !!id&&!team.has(id);},
  canManageMaster(row:Row){return me.role==='rep'&&row.kind==='customer'||canUseSalesWorkspace(me.role)&&(me.role==='admin'||team.has(row.assignedTo));},
  canEditCustomerDetails(row:Row){return row.kind==='customer'&&(['rep','manager','admin'].includes(me.role)||me.role==='supervisor'&&team.has(row.assignedTo)||['customer_service','customer_service_manager'].includes(me.role)&&row.branch===me.branch);},
  canEditMachine(row:Row){return row.kind==='factory'&&(me.role==='rep'?row.assignedTo===me.id:canUseSalesWorkspace(me.role)&&(me.role==='admin'||team.has(row.assignedTo)));},
 };
}

/** Source-author check only; callers apply the customer's region boundary separately. */
export function canReadSalesRecord(row:Row,members:Member[],me:Member,options:{read?:boolean}={}){
 if(['customer','factory'].includes(row.kind))return !['customer_service','customer_service_manager'].includes(me.role);
 if(me.role==='admin')return true;
 if(row.kind==='quote'&&!canUseSalesWorkspace(me.role))return false;
 if(!['manager','supervisor','rep'].includes(me.role))return false;
 const author=recordAuthorId(row,members);
 return !!author&&salesScopeMemberIds(members,me,options).has(author);
}

/** A machine belongs to its customer's responsible member: a representative adds and corrects the machines of their own customers (never deletes them), the sales roles those of their team. */
export function canEditMachineRecord(row:Row,members:Member[],me:Member){return row.kind==='factory'&&(me.role==='rep'?row.assignedTo===me.id:canUseSalesWorkspace(me.role)&&(me.role==='admin'||salesScopeMemberIds(members,me).has(row.assignedTo)));}

/** Regional reps may edit customer details; assignment and deletion remain restricted by the route. */
export function canManageMasterRecord(row:Row,members:Member[],me:Member){return me.role==='rep'&&row.kind==='customer'||canUseSalesWorkspace(me.role)&&(me.role==='admin'||salesScopeMemberIds(members,me).has(row.assignedTo));}

/** The regional address book is shared; correcting it does not grant routing or history rights. */
/** Customer service (since 2026-11-07) corrects the customers of its branch, like a representative; callers apply the region boundary. */
export function canEditCustomerDetails(row:Row,members:Member[],me:Member){return row.kind==='customer'&&(['rep','manager','admin'].includes(me.role)||me.role==='supervisor'&&salesScopeMemberIds(members,me).has(row.assignedTo)||['customer_service','customer_service_manager'].includes(me.role)&&row.branch===me.branch);}

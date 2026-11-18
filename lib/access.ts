import type {Member,Row} from './crm';
import {HUB_TAB_KEYS} from './targets-hub';
import {isFieldRole,isMarketingRole} from './roles';
/** «عرض بيانات الفريق بالكامل» (lib/permissions.ts): a supervisor or a sales manager the administrator switched it on for. */
export const viewsWholeTeam=(me:Member)=>(me.role==='supervisor'||me.role==='manager')&&me.access?.viewAll===true;

/** Commercial reporting and pricing are management workspaces. */
export const canUseSalesWorkspace=(role:string)=>['admin','manager','supervisor'].includes(role);
export function canViewPage(role:string,view:string){
 // «المحذوفات» here is the role's ceiling (the matrix offers its «استعراض» and «تحرير»); who has it now is lib/permissions.ts trashScopeOf.
 // A marketing officer (lib/roles.ts) has a representative's pages.
 if(isFieldRole(role))return ['customer','map','activity','followup','targets','mold-requests','trash'].includes(view);
 // Customer complaints have a page of their own for customer service and administrators; sales members meet them on the Visits page.
 // The customer-service evaluation has one for the manager and the administrator; a representative meets theirs on the Complaints page.
 // Mold requests are for every role (the owner, 2026-11-01), customer service included.
 if(['customer_service','customer_service_manager'].includes(role))return view==='activity'||view==='complaints'||view==='mold-requests'||view==='service-kpi'&&role==='customer_service_manager';
 if(!canUseSalesWorkspace(role))return false;
 if(view==='trash')return true;
 if(view==='team'||view==='complaints'||view==='service-kpi')return role==='admin';
 return ['dashboard','customer','map','activity','followup','competitors','journeys','quote','sales','targets','mold-requests'].includes(view);
}

/** «المحذوفات» (2026-11-09, widened 2026-11-10): by role, the administrator sees and restores every deletion and the sales manager those they
 *  made themselves, whatever their cells. A supervisor or a representative has the page only while one of their «حذف» cells is on (the
 *  owner, 2026-11-10: «اللي اديته صلاحية الحذف … يشوف في المحذوفات اللي هو حذفه ويقدر يرجّعه بنفسه»), for their own deletions: that part
 *  needs the member's cells and is lib/permissions.ts trashScopeOf, the one function that decides it for a member. Customer service never has
 *  it (no «حذف» cell). */
export function trashScope(role:string):'all'|'own'|null{return role==='admin'?'all':role==='manager'?'own':null;}

/** Screens no longer offered to anyone (the owner, 2026-11-14: «شاشة عروض السعر ملهاش لازمة الغيها»): not in the menus, and an old link or
 *  saved place opens the first screen the member has. Only the screen goes: the quotations stay in the data, the ERP quotations import of
 *  «المستهدفات وتقييم الأداء» and the conversion indicator keep working, and the «عروض الأسعار» cells of «الفريق والصلاحيات» still decide who
 *  may import them. */
export const RETIRED_PAGES:ReadonlySet<string>=new Set(['quote']);
export const pageRetired=(view:string)=>RETIRED_PAGES.has(view);

/** «المستهدفات وتقييم الأداء» left with no tab (the owner, 2026-11-16, as GSCO's «A page with no part left goes»): the administrator hid
 *  every tab of its hub from this member (lib/targets-hub.ts HUB_TAB_KEYS among the hidden) and «رفع المبيعات» does not show either (the
 *  role has no «المبيعات» or it is hidden). The screen is then hidden as if its «استعراض» were off (lib/permissions.ts pageHidden): not in
 *  the menus, an old link opens the first screen, its requests answer 404. Never for the administrator, nor for a role whose targets screen
 *  is not the hub (a representative's «أهدافي» has no tabs). */
export function hubTabsAllHidden(role:string,hidden:readonly string[]){
 return role!=='admin'&&canUseSalesWorkspace(role)&&canViewPage(role,'targets')&&HUB_TAB_KEYS.every(key=>hidden.includes(key))&&(!canViewPage(role,'sales')||hidden.includes('sales'));
}

/** Preserve old bookmarks without granting access to a management workspace. A screen the administrator hid from the member (hidden,
 *  lib/permissions.ts) is not opened either: the first screen the member has, «الزيارات» when it is not hidden. trashOpen: whether the
 *  member has «المحذوفات» now (lib/permissions.ts pageAllowed(me,'trash')); without it, the role's own (the administrator, the sales manager). */
export function resolveCRMPage(role:string,view:string,hidden:readonly string[]=[],trashOpen=trashScope(role)!==null){
 const page=view==='factory'?'customer':['opportunity','service'].includes(view)?'activity':view==='reports'&&canUseSalesWorkspace(role)?'targets':view;
 const shown=(screen:string)=>!pageRetired(screen)&&canViewPage(role,screen)&&(screen!=='trash'||trashOpen)&&(role==='admin'||!hidden.includes(screen)&&(screen!=='targets'||!hubTabsAllHidden(role,hidden)));
 if(shown(page))return page;
 return ['activity','dashboard','customer','map','followup','mold-requests','complaints','targets','journeys','quote','sales','competitors','service-kpi','trash','team'].find(shown)||'activity';
}

/** Reporting history includes inactive members; assignment selectors can request activeOnly. read: a place that only READS may widen to
 *  every sales member when the administrator switched «عرض بيانات الفريق بالكامل» on for this supervisor or sales manager (me.access.viewAll,
 *  lib/permissions.ts); every write, assignment and commit check keeps the team as the role defines it (read omitted). */
export function salesScopeMemberIds(members:Member[],me:Member,options:{activeOnly?:boolean;read?:boolean}={}){
 const wide=!!options.read&&viewsWholeTeam(me);
 // A marketing officer is in a team as a representative is (lib/roles.ts): under their supervisor, and in the sales manager's.
 const scoped=members.filter(member=>member.id===me.id||me.role==='admin'||wide&&(['admin','manager','supervisor'].includes(member.role)||isFieldRole(member.role))||me.role==='manager'&&(member.role==='supervisor'||isFieldRole(member.role))||me.role==='supervisor'&&isFieldRole(member.role)&&member.supervisorId===me.id);
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
   if(row.kind==='quote'&&!canUseSalesWorkspace(me.role)||!['manager','supervisor'].includes(me.role)&&!isFieldRole(me.role))return false;
   const id=author(row);return !!id&&readable.has(id);
  },
  readOnly(row:Row){if(readable===team||['customer','factory'].includes(row.kind))return false;const id=author(row);return !!id&&!team.has(id);},
  canManageMaster(row:Row){return isFieldRole(me.role)&&row.kind==='customer'||canUseSalesWorkspace(me.role)&&(me.role==='admin'||team.has(row.assignedTo));},
  canEditCustomerDetails(row:Row){return customerDetailsEditable(row,me,team);},
  canEditMachine(row:Row){return row.kind==='factory'&&(isFieldRole(me.role)?row.assignedTo===me.id:canUseSalesWorkspace(me.role)&&(me.role==='admin'||team.has(row.assignedTo)));},
  canClassify(row:Row){return customerClassifiable(row,me,team);},
 };
}

/** Source-author check only; callers apply the customer's region boundary separately. */
export function canReadSalesRecord(row:Row,members:Member[],me:Member,options:{read?:boolean}={}){
 if(['customer','factory'].includes(row.kind))return !['customer_service','customer_service_manager'].includes(me.role);
 if(me.role==='admin')return true;
 if(row.kind==='quote'&&!canUseSalesWorkspace(me.role))return false;
 if(!['manager','supervisor'].includes(me.role)&&!isFieldRole(me.role))return false;
 const author=recordAuthorId(row,members);
 return !!author&&salesScopeMemberIds(members,me,options).has(author);
}

/** A machine belongs to its customer's responsible member: a representative adds and corrects the machines of their own customers (never deletes them), the sales roles those of their team. */
export function canEditMachineRecord(row:Row,members:Member[],me:Member){return row.kind==='factory'&&(isFieldRole(me.role)?row.assignedTo===me.id:canUseSalesWorkspace(me.role)&&(me.role==='admin'||salesScopeMemberIds(members,me).has(row.assignedTo)));}

/** Regional reps may edit customer details; assignment and deletion remain restricted by the route. */
export function canManageMasterRecord(row:Row,members:Member[],me:Member){return isFieldRole(me.role)&&row.kind==='customer'||canUseSalesWorkspace(me.role)&&(me.role==='admin'||salesScopeMemberIds(members,me).has(row.assignedTo));}

/** The regional address book is shared; correcting it does not grant routing or history rights. */
/** Customer service (since 2026-11-07) corrects the customers of its branch, like a representative; callers apply the region boundary. */
/** A marketing officer (the owner, 2026-11-18) corrects every customer of their branch, directly (lib/roles.ts); callers apply the region
 *  boundary. A representative corrects any customer of their regions through a request (lib/customer-edit-requests.ts). */
function customerDetailsEditable(row:Row,me:Member,team:ReadonlySet<string>){
 return row.kind==='customer'&&(me.role==='rep'||['manager','admin'].includes(me.role)||me.role==='supervisor'&&team.has(row.assignedTo)||isMarketingRole(me.role)&&row.branch===me.branch||['customer_service','customer_service_manager'].includes(me.role)&&row.branch===me.branch);
}
export function canEditCustomerDetails(row:Row,members:Member[],me:Member){return customerDetailsEditable(row,me,salesScopeMemberIds(members,me));}
/** «تصنيف الفرصة» and the other classifications of a customer (lib/customer-classification.ts, the owner, 2026-11-18): set by the marketing
 *  officer (every customer of their branch), the supervisor (their team's customers, as their corrections: through the sales manager's
 *  approval), the sales manager and the administrator; callers apply the region boundary. A representative and customer service read them. */
function customerClassifiable(row:Pick<Row,'kind'|'assignedTo'|'branch'>,me:Member,team:ReadonlySet<string>){
 return row.kind==='customer'&&(['manager','admin'].includes(me.role)||me.role==='supervisor'&&team.has(row.assignedTo)||isMarketingRole(me.role)&&row.branch===me.branch);
}
export function canClassifyCustomer(row:Pick<Row,'kind'|'assignedTo'|'branch'>,members:Member[],me:Member){return customerClassifiable(row,me,salesScopeMemberIds(members,me));}

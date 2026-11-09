// «الصلاحيات» per member (the owner, 2026-11-09, «نفذ الاربعة», GSCO's #7: «جدول صلاحيات بشكل ERP: صف لكل شاشة، وأعمدة استعراض/إضافة/
// تحرير/حذف/تصدير/استيراد، وعمود «الكل». «انسخ الصلاحيات من» مستخدم آخر، وإخفاء أي شاشة عن أي حساب … مع مفتاح «عرض بيانات الفريق بالكامل».»).
// Copied from GSCO 2.13.61 (lib/crm/permission-matrix.ts, components/crm/permission-matrix.tsx, section-access.ts), adapted to Yourrest:
// - RESTRICT-ONLY: a cell exists for a role only when the role can do that action today (its «سقف»); a switch can only take it away.
//   GSCO lets the owner grant anything; Yourrest cannot grant beyond the role (scope and safety logic stay intact), with two exceptions:
//   1. «عرض بيانات الفريق بالكامل», which widens what a supervisor or a sales manager READS (never what they write);
//   2. «حذف» (the owner, 2026-11-09: «امكانية اعطاء الصلاحية دى تمام اقدر اديها لاى مستخدم بس العادى ان محدش يقدر يحذف حاجة»): the
//      GRANTABLE delete cells (customer, visit, follow-up, quotation, void sale) are OFF by default for every role but the administrator
//      (on by default, and the administrator may switch it off for another administrator's account) and can be granted to ANY member whose
//      role has the screen, except customer service on «الزيارات» («—»: their service requests are never deleted, so the cell would do nothing). Granting never widens the record scope: a member deletes only a record they may write under their role's own
//      write scope (lib/crm-server.ts recordDeleteGuard, app/api/sales/route.ts), never through «عرض بيانات الفريق بالكامل». «إلغاء طلب» on
//      mold requests is not one of them: a workflow step of one's own request, on by default and restrict-only as before.
// - A member without a saved row (crm_member_permissions, migration 0020) has today's behaviour; a cell never saved is on, except a
//   grantable «حذف» cell, which is off for every role but the administrator.
// - «استعراض» shows or hides the screen (hidden: its own requests answer 404, never 401/403, which lock the offline session).
// - The administrator is never locked out: nothing is hidden from an administrator and their «الفريق والصلاحيات» cells are always on.
// Shared by the server (lib/crm-server.ts context(), the routes) and the page (nav, buttons, the matrix in the member form).
import {canViewPage} from './access';

export const PERMISSION_ACTIONS=['add','edit','delete','export','import'] as const;
export type PermissionAction=typeof PERMISSION_ACTIONS[number];
export type MatrixColumn='browse'|PermissionAction;
export const MATRIX_COLUMNS:readonly {key:MatrixColumn;ar:string;en:string}[]=[
 {key:'browse',ar:'استعراض',en:'View'},{key:'add',ar:'إضافة',en:'Add'},{key:'edit',ar:'تحرير',en:'Edit'},
 {key:'delete',ar:'حذف',en:'Delete'},{key:'export',ar:'تصدير',en:'Export'},{key:'import',ar:'استيراد',en:'Import'},
];
/** The words of a refusal: «مش مسموح لك ب<الإجراء> في <الشاشة>». */
const actionNouns:Record<PermissionAction,readonly [string,string]>={add:['الإضافة','add'],edit:['التعديل','edit'],delete:['الحذف','delete'],export:['التصدير','export'],import:['الاستيراد','import']};

export type PermissionScreen='dashboard'|'customer'|'map'|'activity'|'complaints'|'service-kpi'|'followup'|'mold-requests'|'journeys'|'quote'|'sales'|'competitors'|'targets'|'team'|'trash';
type Text={ar:string;en:string};
/** One action of one screen: what it gates (shown on the cell), the roles that can do it today (its ceiling), and a note. A grantable cell
 *  (grantable:true, the «حذف» cells) exists for every role that has the screen; its roles are those it is ON for by default (the
 *  administrator), without the roles that have the screen but nothing it could delete (customer service on «الزيارات»: their service requests are
 *  never deleted, so no cell that does nothing), and roleNote says, for a role, what granting it does for that role. */
export type MatrixCell=Text&{roles:readonly string[];grantable?:true;without?:readonly string[];note?:Text;roleNote?:Partial<Record<string,Text>>};
export type MatrixRow=Text&{screen:PermissionScreen;cells:Partial<Record<PermissionAction,MatrixCell>>};
const ALL=['admin','manager','supervisor','rep','customer_service','customer_service_manager'] as const;
const SALES=['admin','manager','supervisor','rep'] as const,MANAGEMENT=['admin','manager','supervisor'] as const,SERVICE=['admin','customer_service','customer_service_manager'] as const;
/** «حذف»: off by default except for the administrator; whoever it is granted to deletes only what they may edit (their own scope). */
const DEFAULT_ON=['admin'] as const;
const deleteScope:Text={ar:'مقفولة في الأول لكل الأدوار ما عدا مدير النظام، وتقدر تفتحها لأي مستخدم. بيحذف السجلات اللي يقدر يعدّلها بس (فريقه ومناطقه)، وعرض بيانات الفريق بالكامل مبيوسّعش الحذف.',en:'Off by default for every role but the administrator; it can be granted to any member. They delete only the records they may edit (their team and regions); «View the whole team\'s data» never widens deleting.'};
const repOwnContacts:Text={ar:'للمندوب: زياراته ومتابعاته هو بس (اللي سجّلها)، لعملاء مناطقه.',en:'For a representative: only their own visits and follow-ups (recorded by them), of customers in their regions.'};

/** The rows: Yourrest's screens in the order of the navigation (app/crm-app.tsx nav), each action mapped to the capability it gates. */
export const PERMISSION_MATRIX:readonly MatrixRow[]=[
 {screen:'dashboard',ar:'لوحة المتابعة',en:'Dashboard',cells:{}},
 {screen:'customer',ar:'العملاء',en:'Customers',cells:{
  add:{ar:'إضافة عميل جديد (من صفحة العملاء والخريطة ونموذج الزيارة)',en:'Add a new customer (customers page, map, visit form)',roles:SALES},
  edit:{ar:'تعديل بيانات العميل، وإضافة وتعديل وحذف ماكيناته',en:'Edit a customer\'s details, and add, edit or delete its machines',roles:ALL},
  delete:{ar:'حذف عميل',en:'Delete a customer',roles:DEFAULT_ON,grantable:true,note:deleteScope,roleNote:{rep:{ar:'للمندوب: عملاء مناطقه (زي تعديل بيانات العميل)، ومفيش حذف لعميل له زيارات أو ماكينات أو مبيعات أو خط سير.',en:'For a representative: customers of their regions (as editing a customer\'s details), never one with visits, machines, sales or a route.'}}},
  export:{ar:'تصدير العملاء (CSV) من صفحة العملاء والخريطة',en:'Export customers (CSV) from the customers page and the map',roles:MANAGEMENT},
  import:{ar:'«استيراد من ERP» واستيراد العملاء والماكينات',en:'«Import from ERP» and the customers and machines imports',roles:['admin','manager']},
 }},
 {screen:'map',ar:'خريطة المصانع',en:'Factory map',cells:{}},
 {screen:'activity',ar:'الزيارات',en:'Visits',cells:{
  add:{ar:'تسجيل زيارة جديدة (ولخدمة العملاء: تسجيل طلب/فرصة جديدة)',en:'Record a new visit (customer service: register a new request)',roles:ALL},
  edit:{ar:'تعديل زيارة محفوظة (ولخدمة العملاء: تعديل الطلب قبل اعتماده)',en:'Edit a saved visit (customer service: edit a request before approval)',roles:['admin','manager','supervisor','customer_service','customer_service_manager']},
  delete:{ar:'حذف زيارة',en:'Delete a visit',roles:DEFAULT_ON,grantable:true,note:deleteScope,roleNote:{rep:repOwnContacts},without:['customer_service','customer_service_manager']},
  export:{ar:'تصدير الزيارات (CSV)',en:'Export visits (CSV)',roles:['admin','manager','supervisor','customer_service','customer_service_manager']},
 }},
 {screen:'complaints',ar:'الشكاوى',en:'Complaints',cells:{
  add:{ar:'تسجيل شكوى',en:'Register a complaint',roles:SERVICE},
  edit:{ar:'تعديل الشكوى (لمن سجّلها قبل حلها)',en:'Edit a complaint (its registrar, before it is resolved)',roles:SERVICE},
 }},
 {screen:'service-kpi',ar:'تقييم خدمة العملاء',en:'Customer-service evaluation',cells:{
  edit:{ar:'حفظ مراجعة شهرية وإعدادات التقييم',en:'Save a monthly review and the evaluation settings',roles:['admin','customer_service_manager']},
 }},
 {screen:'followup',ar:'المتابعات',en:'Follow-ups',cells:{
  add:{ar:'تسجيل متابعة',en:'Record a follow-up',roles:SALES},
  edit:{ar:'تعديل متابعة محفوظة',en:'Edit a saved follow-up',roles:MANAGEMENT},
  delete:{ar:'حذف متابعة',en:'Delete a follow-up',roles:DEFAULT_ON,grantable:true,note:deleteScope,roleNote:{rep:repOwnContacts}},
 }},
 {screen:'mold-requests',ar:'طلبات تصنيع القوالب',en:'Mold requests',cells:{
  add:{ar:'طلب تصنيع قالب جديد',en:'Request a new mold',roles:ALL},
  edit:{ar:'تعديل طلب لم يُرسل للإنتاج',en:'Edit a request not yet sent to production',roles:ALL},
  delete:{ar:'إلغاء طلب',en:'Cancel a request',roles:ALL},
 }},
 {screen:'journeys',ar:'تقرير يوم المندوب',en:'Daily route',cells:{
  add:{ar:'كتابة «النتيجة» و«الإجراء المطلوب» على شغل الفريق',en:'Write «Result» and «Action required» on the team\'s work',roles:MANAGEMENT},
 }},
 {screen:'quote',ar:'عروض الأسعار',en:'Quotations',cells:{
  add:{ar:'إضافة عرض سعر ومواصفات قالب',en:'Add a quotation and mold specifications',roles:MANAGEMENT},
  edit:{ar:'تعديل عرض سعر ومواصفات قالب',en:'Edit a quotation and mold specifications',roles:MANAGEMENT},
  delete:{ar:'حذف عرض سعر ومواصفات قالب',en:'Delete a quotation and mold specifications',roles:DEFAULT_ON,grantable:true,note:deleteScope},
  export:{ar:'تصدير عروض الأسعار (CSV)',en:'Export quotations (CSV)',roles:MANAGEMENT},
 }},
 {screen:'sales',ar:'المبيعات',en:'Sales',cells:{
  add:{ar:'تسجيل بيع',en:'Record a sale',roles:MANAGEMENT},
  edit:{ar:'تعديل بيع مسجل',en:'Edit a recorded sale',roles:MANAGEMENT},
  delete:{ar:'إلغاء بيع',en:'Void a sale',roles:DEFAULT_ON,grantable:true,note:deleteScope},
  export:{ar:'تصدير المبيعات (CSV)',en:'Export sales (CSV)',roles:MANAGEMENT},
  import:{ar:'استيراد مبيعات ERP',en:'Import ERP sales',roles:MANAGEMENT},
 }},
 {screen:'competitors',ar:'المنافسين',en:'Competitors',cells:{}},
 {screen:'targets',ar:'المستهدفات وتقييم الأداء',en:'Targets & performance',cells:{
  edit:{ar:'تعديل المستهدفات والأوزان وتقييم الأداء وبيانات المؤشرات',en:'Edit targets, weights, the evaluation and the indicators\' data',roles:['admin','manager']},
  export:{ar:'تصدير المستهدفات والتقييم (CSV)',en:'Export targets and the evaluation (CSV)',roles:MANAGEMENT},
 }},
 {screen:'team',ar:'الفريق والصلاحيات',en:'Team and permissions',cells:{
  add:{ar:'إضافة مستخدم',en:'Add a member',roles:['admin']},
  edit:{ar:'تعديل مستخدم وصلاحياته',en:'Edit a member and their permissions',roles:['admin']},
 }},
 {screen:'trash',ar:'المحذوفات',en:'Deleted records',cells:{
  edit:{ar:'استرجاع سجل محذوف',en:'Restore a deleted record',roles:['admin','manager']},
 }},
];
export const PERMISSION_SCREENS:readonly PermissionScreen[]=PERMISSION_MATRIX.map(row=>row.screen);
export const permissionRow=(screen:string)=>PERMISSION_MATRIX.find(row=>row.screen===screen);
export const cellKey=(screen:PermissionScreen,action:PermissionAction)=>`${screen}:${action}`;
/** Every cell of the table, as stored keys. */
export const PERMISSION_CELLS:readonly string[]=PERMISSION_MATRIX.flatMap(row=>PERMISSION_ACTIONS.filter(action=>row.cells[action]).map(action=>cellKey(row.screen,action)));

/** The screen and action of a /api/crm save or delete: a customer's own on «العملاء» (its machines are editing it), a contact on
 *  «الزيارات» or, for a follow-up, «المتابعات»; mold specifications and quotations on «عروض الأسعار»; an old follow-up thread
 *  (an opportunity without a request) on «المتابعات». */
export function recordCell(kind:string,action:'add'|'edit'|'delete',record:{kind?:string;data?:Record<string,unknown>|null}):[PermissionScreen,PermissionAction]|null{
 const data=record.data||{};
 switch(kind){
  case 'customer':return['customer',action];
  case 'factory':return['customer','edit'];
  case 'activity':return[data.visitWorkflow==='followup-v1'?'followup':'activity',action];
  case 'opportunity':return[data.hasRequest===false?'followup':'quote',action];
  case 'quote':return['quote',action];
  default:return null;
 }
}

/** «صلاحيات عامة» under the table: rights of no single screen. */
export const GENERAL_PERMISSIONS={viewAll:{ar:'عرض بيانات الفريق بالكامل',en:'View the whole team\'s data',
 note:{ar:'للمشرف ومدير المبيعات: يشوف زيارات ومتابعات وعروض أسعار وتقارير يوم ومبيعات ومستهدفات كل فريق المبيعات (مدير النظام ومديري المبيعات والمشرفين والمناديب) للقراءة بس؛ التعديل والحذف فاضلين على فريقه هو بس. مقفولة في الأول.',
  en:'For a supervisor or a sales manager: reads the visits, follow-ups, quotations, day reports, sales and targets of the whole sales team (administrator, sales managers, supervisors, representatives), read only; editing and deleting stay limited to their own team. Off by default.'}}} as const;
export const viewAllAvailable=(role:string)=>role==='supervisor'||role==='manager';

/** Whether the role has the screen at all (lib/access.ts canViewPage); «استعراض» exists only then. */
export const pageCeiling=(role:string,screen:PermissionScreen)=>canViewPage(role,screen);
/** A grantable cell («حذف»: customer, visit, follow-up, quotation, void sale): grantable to any role that has the screen, off by default
 *  except for the administrator. */
export const cellGrantable=(screen:PermissionScreen,action:PermissionAction)=>!!permissionRow(screen)?.cells[action]?.grantable;
export const GRANTABLE_CELLS:readonly string[]=PERMISSION_CELLS.filter(key=>{const [screen,action]=key.split(':') as [PermissionScreen,PermissionAction];return cellGrantable(screen,action);});
/** What the role can do today, or for a grantable cell may be granted: the ceiling of a cell (the switch exists only within it). */
export function cellCeiling(role:string,screen:PermissionScreen,action:PermissionAction){const cell=permissionRow(screen)?.cells[action];return !!cell&&(cell.grantable?pageCeiling(role,screen)&&!cell.without?.includes(role):cell.roles.includes(role));}
/** The value of a cell never saved (within the ceiling): on, except a grantable cell for a role it is not on for by default. */
export function cellDefault(role:string,screen:PermissionScreen,action:PermissionAction){const cell=permissionRow(screen)?.cells[action];return !cell?.grantable||cell.roles.includes(role);}
/** The administrator manages accounts whatever is saved: these cells are always on for an administrator. */
const ADMIN_FIXED=new Set(['team:add','team:edit']);
export const cellFixed=(role:string,key:string)=>role==='admin'&&ADMIN_FIXED.has(key);

/** What is saved for a member, normalised to the member's role: every cell of the role's ceiling with its value (a cell never saved takes
 *  cellDefault; a grantable cell off by default is on only when saved true, any other cell is on unless saved false), the screens hidden
 *  among those the role has (none for an administrator) and «عرض بيانات الفريق بالكامل» where it exists. */
export type StoredPermissions={cells:Record<string,boolean>;hidden:PermissionScreen[];viewAll:boolean};
export function normalizePermissions(role:string,input:{cells?:unknown;hidden?:unknown;viewAll?:unknown}|null|undefined):StoredPermissions{
 const raw=input&&typeof input.cells==='object'&&input.cells!==null&&!Array.isArray(input.cells)?input.cells as Record<string,unknown>:{};
 const cells:Record<string,boolean>={};
 for(const row of PERMISSION_MATRIX)for(const action of PERMISSION_ACTIONS){
  if(!cellCeiling(role,row.screen,action))continue;
  const key=cellKey(row.screen,action);cells[key]=cellFixed(role,key)||(cellDefault(role,row.screen,action)?raw[key]!==false:raw[key]===true);
 }
 const wanted=new Set(Array.isArray(input?.hidden)?input.hidden.filter((value):value is string=>typeof value==='string'):[]);
 const hidden=role==='admin'?[]:PERMISSION_SCREENS.filter(screen=>wanted.has(screen)&&pageCeiling(role,screen));
 return{cells,hidden,viewAll:viewAllAvailable(role)&&input?.viewAll===true};
}
/** The saved row as the database holds it: the cells, with viewAll among them, in `permissions`; the hidden screens in `hidden`. */
export function encodePermissions(stored:StoredPermissions){return{permissions:JSON.stringify({...stored.cells,...(stored.viewAll?{viewAll:true}:{})}),hidden:JSON.stringify(stored.hidden)};}
export function decodePermissions(row:{permissions?:string|null;hidden?:string|null}|null|undefined):{cells:Record<string,unknown>;hidden:unknown;viewAll:unknown}{
 const parse=(text:string|null|undefined,fallback:unknown)=>{try{return text?JSON.parse(text):fallback;}catch{return fallback;}};
 const cells=parse(row?.permissions,{}),safe=cells&&typeof cells==='object'&&!Array.isArray(cells)?cells as Record<string,unknown>:{};
 return{cells:safe,hidden:parse(row?.hidden,[]),viewAll:safe.viewAll};
}

/** What applies to a member, sent with the member to the page (me.access) and held by the server for the request (c.me.access):
 *  version (0 without a saved row), the cells switched off (within the ceiling; without a saved row the grantable cells off by default),
 *  the hidden screens, and viewAll. */
export type MemberAccess={version:number;off:string[];hidden:PermissionScreen[];viewAll:boolean};
export function memberAccess(role:string,row:{permissions?:string|null;hidden?:string|null;version?:number|null}|null|undefined):MemberAccess{
 const stored=normalizePermissions(role,row?decodePermissions(row):null);
 return{version:row?Number(row.version)||0:0,off:Object.entries(stored.cells).filter(([,on])=>!on).map(([key])=>key),hidden:stored.hidden,viewAll:stored.viewAll};
}
/** The stored values of a member from what applies (no access: the role's defaults). */
export function storedFromAccess(role:string,access:MemberAccess|undefined):StoredPermissions{
 if(!access)return normalizePermissions(role,null);
 const off=new Set(access.off),cells:Record<string,boolean>={};
 for(const row of PERMISSION_MATRIX)for(const action of PERMISSION_ACTIONS)if(cellCeiling(role,row.screen,action)){const key=cellKey(row.screen,action);cells[key]=!off.has(key);}
 return normalizePermissions(role,{cells,hidden:access.hidden,viewAll:access.viewAll});
}

type Who={role:string;access?:MemberAccess|null};
/** Whether the member was refused this action by a switch: the role can do it today and the administrator switched it off. Roles without
 *  the ceiling are refused by the routes' own role checks, with their own words, as before. A grantable cell is the decision itself: refused
 *  unless it is on for the member (switched on, or on by default for the role when no access was read), whatever the role. */
export function cellRefused(me:Who,screen:PermissionScreen,action:PermissionAction){
 const key=cellKey(screen,action);
 if(cellFixed(me.role,key))return false;
 if(cellGrantable(screen,action))return !cellCeiling(me.role,screen,action)||(me.access?me.access.off.includes(key):!cellDefault(me.role,screen,action));
 return cellCeiling(me.role,screen,action)&&!!me.access?.off.includes(key);
}
/** Whether the member may do this action now: within the role's ceiling and not switched off. */
export const can=(me:Who|null|undefined,screen:PermissionScreen,action:PermissionAction)=>!!me&&cellCeiling(me.role,screen,action)&&!cellRefused(me,screen,action);
/** Whether the administrator hid this screen from the member (never from an administrator). */
export const pageHidden=(me:Who|null|undefined,screen:string)=>!!me&&me.role!=='admin'&&!!me.access?.hidden.includes(screen as PermissionScreen);
/** Whether the screen shows for the member: the role has it and it is not hidden. */
export const pageAllowed=(me:Who|null|undefined,screen:string)=>!!me&&canViewPage(me.role,screen)&&!pageHidden(me,screen);
/** A request that belongs to these screens is closed only when one of them was hidden and every one of them is hidden or not the role's,
 *  so hiding one screen never breaks another that shares the request (GSCO sectionBlocksRequest). */
export function pagesBlocked(me:Who,screens:readonly PermissionScreen[]){return screens.some(screen=>pageHidden(me,screen))&&screens.every(screen=>pageHidden(me,screen)||!canViewPage(me.role,screen));}

export const PAGE_HIDDEN_TEXT='هذا الجزء غير متاح لحسابك. راجع مدير النظام.';
export function cellRefusalText(screen:PermissionScreen,action:PermissionAction,language:'ar'|'en'='ar'){
 const row=permissionRow(screen)!;
 return language==='en'?`You are not allowed to ${actionNouns[action][1]} in ${row.en}. Ask the administrator.`:`مش مسموح لك ب${actionNouns[action][0]} في ${row.ar}. راجع مدير النظام.`;
}

/** «انسخ الصلاحيات من»: the target takes the source's value of every cell of the target's ceiling (off where the source's role does not
 *  have it; a «حذف» cell is copied whenever the target's role has the screen), the source's hidden screens the target's role has, and viewAll
 *  where the target's role has it. What the source has that the
 *  target's role cannot hold is skipped and listed (cell keys, 'browse:<screen>' for a hidden screen, 'viewAll'). */
export function copyPermissions(source:{role:string;stored:StoredPermissions},targetRole:string):{stored:StoredPermissions;skipped:string[]}{
 const cells:Record<string,boolean>={},skipped:string[]=[];
 for(const row of PERMISSION_MATRIX)for(const action of PERMISSION_ACTIONS){
  const key=cellKey(row.screen,action),value=source.stored.cells[key]===true;
  if(cellCeiling(targetRole,row.screen,action))cells[key]=cellFixed(targetRole,key)||value;
  else if(value)skipped.push(key);
 }
 const hidden=source.stored.hidden.filter(screen=>{const kept=targetRole!=='admin'&&pageCeiling(targetRole,screen);if(!kept)skipped.push('browse:'+screen);return kept;});
 const viewAll=source.stored.viewAll&&viewAllAvailable(targetRole);if(source.stored.viewAll&&!viewAll)skipped.push('viewAll');
 return{stored:normalizePermissions(targetRole,{cells,hidden,viewAll}),skipped};
}
/** The words of a skipped key, for the note under «انسخ الصلاحيات من». */
export function permissionKeyText(key:string,language:'ar'|'en'='ar'){
 if(key==='viewAll')return GENERAL_PERMISSIONS.viewAll[language];
 const [screen,action]=key.split(':') as [string,string],row=permissionRow(key.startsWith('browse:')?action:screen);
 if(!row)return key;
 const column=MATRIX_COLUMNS.find(item=>item.key===(key.startsWith('browse:')?'browse':action));
 return row[language]+' · '+(column?column[language]:action);
}

/** The audit action of a save (kept out of GET /api/crm's recent changes, like the other private entries). */
export const PERMISSIONS_AUDIT_ACTION='صلاحيات';

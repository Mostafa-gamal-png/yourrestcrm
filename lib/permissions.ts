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
// - «المحذوفات» (the owner, 2026-11-10): besides the administrator (all) and the sales manager (their own), whoever has a «حذف» cell on
//   (TRASH_DELETE_CELLS) sees their own deletions there and restores one while the record's own cell is still on (trashScopeOf,
//   trashRestoreCellOff; the scope is the deletion's: lib/trash-server.ts). Nothing new is granted: the page follows the «حذف» grant.
// - The tabs of «المستهدفات وتقييم الأداء» (the owner, 2026-11-16, item 6 of the GSCO list: «إخفاء تبويبات صفحة المستهدفات لكل حساب
//   لوحده (النتائج، التحصيل، العروض)، زي مفاتيح إخفاء الأقسام في GSCO»; GSCO 2.13.58 performance.*): «نتائج الأداء»، «التحصيل»، «عروض
//   الأسعار» and «المستهدفات والأوزان» each have a «استعراض» of their own under the screen's row, for every role whose targets screen is
//   the hub (a sales manager, a supervisor; never the administrator; a representative's «أهدافي» has no tabs). Restrict-only and off
//   nowhere by default; stored among the hidden screens as 'targets.<tab>' (HUB_TAB_KEYS, lib/targets-hub.ts), no migration. A hidden
//   tab is not drawn, the address and the browser's memory cannot open it, and the requests that serve only it answer 404 like a hidden
//   screen's (hubTabsBlocked; lib/crm-server.ts requireHubTabs). «رفع المبيعات» follows «المبيعات». Every tab hidden and «المبيعات»
//   not shown: the screen goes too (lib/access.ts hubTabsAllHidden).
// - «تقارير خدمة العملاء» (the owner, 2026-11-16, item 3 of the GSCO list, GSCO 2.13.77 export_service_reports: «صلاحية جديدة «تصدير تقارير
//   خدمة العملاء»، شغالة تلقائيًا للمالك والإدارة ومدير المبيعات ومدير خدمة العملاء، ويقدر المالك يقفلها لأي حساب»): a row with «تصدير»
//   only, the «تصدير Excel» of the two monthly reports. Its ceiling is the roles the reports open for (the administrator, the sales manager,
//   the customer-service manager: lib/service-report.ts serviceReportAllowed), on by default for each, restrict-only like every other cell,
//   so the administrator may switch it off for any account, another administrator's included; no migration (a cell never saved is on).
//   The reports have no screen of their own (they sit on «الزيارات» and «الشكاوى»), so the row has no «استعراض» (`part` says why).
// - «تصدير Excel» from every page that shows a list (the owner, 2026-11-19, through the GSCO session, GSCO 2.13.80 «زر «تصدير Excel» في
//   كل صفحة تعرض بيانات … ولكل صفحة مفتاح «تصدير» خاص بها»): a «تصدير» cell on every screen with a list that had none («المتابعات»،
//   «الشكاوى»، «تقييم خدمة العملاء»، «طلبات تصنيع القوالب»، «تقرير يوم المندوب»، «المنافسين»، «الفريق والصلاحيات»), restrict-only like every
//   cell: its ceiling the roles that open the screen except the representative and the marketing officer (who never export, as before),
//   on by default. «لوحة المتابعة»، «المحذوفات» and the map export nothing (as GSCO's overview, bin and map; the map draws no list, and
//   the customers' CSV it was written for was never on its screen). What each cell exports is lib/list-export.ts. No migration (a cell
//   never saved is on).
// - «خطط المناديب» (the owner, 2026-11-19, the port of GSCO 2.13.83 «خطة الغد / خطط المناديب», lib/daily-plans.ts, migration 0022): a
//   screen of its own («خطة الغد» for a representative or a marketing officer) with the owner's three permissions: «إعداد خطة اليوم»
//   («إضافة»: the representative and the marketing officer prepare and send their own plan), «مراجعة خطط المناديب» («تحرير»: the
//   supervisor, the sales manager and the administrator approve, approve with edits, return and note) and «تصدير خطط المناديب إلى Excel»
//   («تصدير»: the same three). Restrict-only like every cell, on by default, no migration for the cells (a cell never saved is on). The
//   administrator holds no «إعداد خطة اليوم» (they prepare no plan of their own), the one cell of the table that is not theirs.
// - «رسم مناطق عمل المناديب» (the owner, 2026-11-19, the port of GSCO 2.13.81 manage_work_areas, lib/work-areas.ts, migration 0023): the
//   «تحرير» of «خريطة المصانع», drawing, editing and deleting a representative's work area. Its ceiling is the administrator and the sales
//   manager, on by default for both, restrict-only like every cell (GSCO also lets its owner open it for a supervisor; here a cell cannot
//   reach beyond its ceiling, so a supervisor reads his representatives' areas and draws none); never a representative, a marketing officer
//   or customer service. No migration for the cell (a cell never saved is on).
// Shared by the server (lib/crm-server.ts context(), the routes) and the page (nav, buttons, the matrix in the member form).
import {canUseSalesWorkspace,canViewPage,hubTabsAllHidden,trashScope} from './access';
import {HIDEABLE_HUB_TABS,HUB_TAB_KEYS,HUB_TAB_NAMES,HUB_TABS,hubTabKey,isHubTabKey,type HideableHubTab,type HubTab,type HubTabKey} from './targets-hub';

export const PERMISSION_ACTIONS=['add','edit','delete','export','import'] as const;
export type PermissionAction=typeof PERMISSION_ACTIONS[number];
export type MatrixColumn='browse'|PermissionAction;
export const MATRIX_COLUMNS:readonly {key:MatrixColumn;ar:string;en:string}[]=[
 {key:'browse',ar:'استعراض',en:'View'},{key:'add',ar:'إضافة',en:'Add'},{key:'edit',ar:'تحرير',en:'Edit'},
 {key:'delete',ar:'حذف',en:'Delete'},{key:'export',ar:'تصدير',en:'Export'},{key:'import',ar:'استيراد',en:'Import'},
];
/** The words of a refusal: «غير مسموح لك ب<الإجراء> في <الشاشة>». */
const actionNouns:Record<PermissionAction,readonly [string,string]>={add:['الإضافة','add'],edit:['التعديل','edit'],delete:['الحذف','delete'],export:['التصدير','export'],import:['الاستيراد','import']};

export type PermissionScreen='dashboard'|'customer'|'map'|'activity'|'complaints'|'service-kpi'|'service-reports'|'followup'|'mold-requests'|'journeys'|'plans'|'quote'|'sales'|'competitors'|'targets'|'team'|'trash';
type Text={ar:string;en:string};
/** One action of one screen: what it gates (shown on the cell), the roles that can do it today (its ceiling), and a note. A grantable cell
 *  (grantable:true, the «حذف» cells) exists for every role that has the screen; its roles are those it is ON for by default (the
 *  administrator), without the roles that have the screen but nothing it could delete (customer service on «الزيارات»: their service requests are
 *  never deleted, so no cell that does nothing), and roleNote says, for a role, what granting it does for that role. */
export type MatrixCell=Text&{roles:readonly string[];grantable?:true;without?:readonly string[];note?:Text;roleNote?:Partial<Record<string,Text>>};
export type MatrixRow=Text&{screen:PermissionScreen;cells:Partial<Record<PermissionAction,MatrixCell>>;roleNote?:Partial<Record<string,Text>>;
 /** A row that is part of other screens, not a screen of its own: it has no «استعراض», and this says where it shows. */
 part?:Text};
// «مسؤول تسويق» (lib/roles.ts) has a representative's cells, «حذف عميل» excepted (it never deletes a customer).
const ALL=['admin','manager','supervisor','rep','marketing','customer_service','customer_service_manager'] as const;
const SALES=['admin','manager','supervisor','rep','marketing'] as const,MANAGEMENT=['admin','manager','supervisor'] as const,SERVICE=['admin','customer_service','customer_service_manager'] as const;
/** «حذف»: off by default except for the administrator; whoever it is granted to deletes only what they may edit (their own scope). */
const DEFAULT_ON=['admin'] as const;
const deleteScope:Text={ar:'مغلقة افتراضيًا لكل الأدوار عدا مدير النظام، ويمكنك فتحها لأي مستخدم. يحذف السجلات التي يمكنه تعديلها فقط (فريقه ومناطقه)، ولا يوسّع «عرض بيانات الفريق بالكامل» الحذف.',en:'Off by default for every role but the administrator; it can be granted to any member. They delete only the records they may edit (their team and regions); «View the whole team\'s data» never widens deleting.'};
const repOwnContacts:Text={ar:'للمندوب: زياراته ومتابعاته هو فقط (التي سجّلها)، لعملاء مناطقه.',en:'For a representative: only their own visits and follow-ups (recorded by them), of customers in their regions.'};
const marketingOwnContacts:Text={ar:'لمسؤول التسويق: زياراته ومتابعاته هو فقط (التي سجّلها)، لعملاء مناطقه.',en:'For a marketing officer: only their own visits and follow-ups (recorded by them), of customers in their regions.'};
/** «العملاء · تحرير» of a marketing officer: what differs from a representative. */
const marketingCustomerEdit:Text={ar:'لمسؤول التسويق: يعدّل بيانات كل عملاء فرعه في مناطقه مباشرةً دون انتظار موافقة، ويحدد «اهتمام العميل» (أما «حجم المصنع» فيُحسب من ماكيناته، و«تصنيف الفرصة» هو «قوة الفرصة» في كل زيارة)؛ وتعديل عميل فرع آخر أو تغيير منطقة العميل طلبٌ ينتظر الموافقة كتعديل المندوب. لا يغيّر المندوب المسؤول ولا الفرع. ماكينات العميل لعملائه هو فقط كالمندوب. وتحديث «الطاقة الإنتاجية والاحتياج» وحده لعملائه هو يُحفظ مباشرةً في كل الأحوال.',en:'For a marketing officer: edits the details of every customer of their branch in their regions directly, without waiting for approval, and sets their «customer interest» (the factory size is computed from its machines, and the opportunity grade is each visit\'s «opportunity strength»); editing another branch\'s customer, or changing a customer\'s region, is a request that waits for approval as a representative\'s. Never changes the responsible member or the branch. A customer\'s machines only for their own customers, as a representative. Updating «Capacity and demand» alone on their own customers is always saved directly.'};
/** «العملاء · تحرير» of a representative: a request that waits, but «الطاقة الإنتاجية والاحتياج» alone on their own customers is saved directly
 *  (lib/customer-capacity.ts capacityEditIsDirect, 2026-11-21). */
const repCustomerEdit:Text={ar:'للمندوب: تعديل بيانات العميل طلبٌ ينتظر موافقة مشرفه ثم مدير المبيعات، عدا «الطاقة الإنتاجية والاحتياج» (عدد القوالب المستخدمة، والطاقة الإنتاجية، وحجم الطلب السنوي) لعملائه هو، فيُحفظ تحديثها مباشرةً إذا عُدّلت وحدها. ماكينات العميل لعملائه هو فقط.',en:'For a representative: editing a customer\'s details is a request that waits for their supervisor\'s and then the sales manager\'s approval, except «Capacity and demand» (molds in use, production capacity and annual demand) of their own customers, saved directly when changed alone. A customer\'s machines only for their own customers.'};
/** «المحذوفات» of a supervisor or a representative: it comes with «حذف» (trashScopeOf). */
const trashOwn:Text={ar:'لمن لديه «حذف»: ما حذفه هو فقط',en:'For whoever has «Delete»: only what they deleted themselves'};
const trashOwnRestore:Text={ar:'لمن لديه «حذف»: ما حذفه هو فقط، ما دام «حذف» في شاشة السجل مفتوحًا له، وفي حدود ما يمكنه حذفه.',en:'For whoever has «Delete»: only what they deleted themselves, while «Delete» of the record\'s screen is on for them, and within what they may delete.'};

/** «خطط المناديب» of a representative or a marketing officer: their own plan only («خطة الغد»). */
const planOwnNote:Text={ar:'خطته هو فقط («خطة الغد»)، ويرى قرار المشرف وملاحظته.',en:'Their own plan only («Tomorrow\'s plan»), with the supervisor\'s decision and note.'};
/** Under «المستهدفات وتقييم الأداء» for a role whose targets screen is the hub: what its tab rows do. */
const hubTabsNote:Text={ar:'لكل تبويب من تبويبات الصفحة «استعراض» خاص به في الصفوف التالية. «رفع المبيعات» يتبع «استعراض» في «المبيعات». إذا أُخفيت كل التبويبات ولم يظهر «رفع المبيعات» أُخفيت الصفحة كلها.',en:'Each tab of the page has its own «View» in the rows below. «Sales upload» follows «View» of «Sales». With every tab hidden and «Sales upload» not shown, the whole page is hidden.'};

/** The rows: Yourrest's screens in the order of the navigation (app/crm-app.tsx nav), each action mapped to the capability it gates. */
export const PERMISSION_MATRIX:readonly MatrixRow[]=[
 {screen:'dashboard',ar:'لوحة المتابعة',en:'Dashboard',cells:{}},
 {screen:'customer',ar:'العملاء',en:'Customers',cells:{
  add:{ar:'إضافة عميل جديد (من صفحة العملاء والخريطة ونموذج الزيارة)',en:'Add a new customer (customers page, map, visit form)',roles:SALES},
  edit:{ar:'تعديل بيانات العميل، وإضافة وتعديل وحذف ماكيناته',en:'Edit a customer\'s details, and add, edit or delete its machines',roles:ALL,roleNote:{rep:repCustomerEdit,marketing:marketingCustomerEdit}},
  delete:{ar:'حذف عميل',en:'Delete a customer',roles:DEFAULT_ON,grantable:true,note:deleteScope,roleNote:{rep:{ar:'للمندوب: عملاؤه هو فقط (المسؤول عنهم)، ولا يُحذف عميل له زيارات أو ماكينات أو مبيعات أو خط سير.',en:'For a representative: only the customers assigned to them, never one with visits, machines, sales or a route.'}},without:['marketing']},
  export:{ar:'تصدير العملاء (Excel وCSV) من صفحة العملاء',en:'Export customers (Excel and CSV) from the customers page',roles:MANAGEMENT},
  import:{ar:'«استيراد من ERP» واستيراد العملاء والماكينات',en:'«Import from ERP» and the customers and machines imports',roles:['admin','manager']},
 }},
 {screen:'map',ar:'خريطة المصانع',en:'Factory map',cells:{
  edit:{ar:'رسم مناطق عمل المناديب',en:'Draw representatives\' work areas',roles:['admin','manager'],note:{ar:'رسم منطقة عمل المندوب على الخريطة وتعديلها وحذفها، لمناديب فريقه في مناطقه. بلا منطقة مرسومة تكون المنطقة 500 م حول عملاء المندوب.',en:'Draw, edit and delete a representative\'s work area on the map, for the representatives of their team in their regions. Without a drawn area the area is 500 m around the representative\'s customers.'}},
 }},
 {screen:'activity',ar:'الزيارات',en:'Visits',cells:{
  add:{ar:'تسجيل زيارة جديدة (ولخدمة العملاء: تسجيل طلب/فرصة جديدة)',en:'Record a new visit (customer service: register a new request)',roles:ALL},
  edit:{ar:'تعديل زيارة محفوظة (ولخدمة العملاء: تعديل الطلب قبل اعتماده)',en:'Edit a saved visit (customer service: edit a request before approval)',roles:['admin','manager','supervisor','customer_service','customer_service_manager']},
  delete:{ar:'حذف زيارة',en:'Delete a visit',roles:DEFAULT_ON,grantable:true,note:deleteScope,roleNote:{rep:repOwnContacts,marketing:marketingOwnContacts},without:['customer_service','customer_service_manager']},
  export:{ar:'تصدير قوائم صفحة الزيارات: الزيارات (Excel وCSV)، و«التواصل مع العملاء» و«تتبع الطلبات والشكاوى» و«مصادر الفرص» والشكاوى المعروضة فيها (Excel)',en:'Export the lists of the visits page: the visits (Excel and CSV), and «Customer contact», «Request and complaint tracking», «Opportunity sources» and the complaints shown there (Excel)',roles:['admin','manager','supervisor','customer_service','customer_service_manager']},
 }},
 {screen:'complaints',ar:'الشكاوى',en:'Complaints',cells:{
  add:{ar:'تسجيل شكوى',en:'Register a complaint',roles:SERVICE},
  edit:{ar:'تعديل الشكوى (لمن سجّلها قبل حلها)',en:'Edit a complaint (its registrar, before it is resolved)',roles:SERVICE},
  export:{ar:'تصدير الشكاوى (Excel)',en:'Export the complaints (Excel)',roles:SERVICE},
 }},
 {screen:'service-kpi',ar:'تقييم خدمة العملاء',en:'Customer-service evaluation',cells:{
  edit:{ar:'حفظ مراجعة شهرية وإعدادات التقييم',en:'Save a monthly review and the evaluation settings',roles:['admin','customer_service_manager']},
  export:{ar:'تصدير تقييم خدمة العملاء (Excel)',en:'Export the customer-service evaluation (Excel)',roles:['admin','customer_service_manager']},
 }},
 {screen:'service-reports',ar:'تقارير خدمة العملاء',en:'Customer-service reports',part:{ar:'التقرير الشهري لطلبات خدمة العملاء في «الزيارات»، والتقرير الشهري للشكاوى في «الشكاوى» (ولمدير المبيعات في «الزيارات»)؛ لا شاشة مستقلة لهما، ويُخفيان بإخفاء الشاشة التي تعرضهما.',en:'The monthly customer-service report is on «Visits» and the monthly complaints report on «Complaints» (for a sales manager, on «Visits»); they have no screen of their own and are hidden with the screen that shows them.'},cells:{
  export:{ar:'«تصدير Excel» للتقرير الشهري لطلبات خدمة العملاء وللتقرير الشهري للشكاوى (الملخص وزمن المراحل والتفاصيل)',en:'«Export to Excel» of the monthly customer-service and complaints reports (summary, stage times and details)',roles:['admin','manager','customer_service_manager']},
 }},
 {screen:'followup',ar:'المتابعات',en:'Follow-ups',cells:{
  add:{ar:'تسجيل متابعة',en:'Record a follow-up',roles:SALES},
  edit:{ar:'تعديل متابعة محفوظة',en:'Edit a saved follow-up',roles:MANAGEMENT},
  delete:{ar:'حذف متابعة',en:'Delete a follow-up',roles:DEFAULT_ON,grantable:true,note:deleteScope,roleNote:{rep:repOwnContacts,marketing:marketingOwnContacts}},
  export:{ar:'تصدير المتابعات (Excel)',en:'Export the follow-ups (Excel)',roles:MANAGEMENT},
 }},
 {screen:'mold-requests',ar:'طلبات تصنيع القوالب',en:'Mold requests',cells:{
  add:{ar:'طلب تصنيع قالب جديد',en:'Request a new mold',roles:ALL},
  edit:{ar:'تعديل طلب لم يُرسل للإنتاج',en:'Edit a request not yet sent to production',roles:ALL},
  delete:{ar:'إلغاء طلب',en:'Cancel a request',roles:ALL},
  export:{ar:'تصدير طلبات تصنيع القوالب (Excel)',en:'Export the mold requests (Excel)',roles:['admin','manager','supervisor','customer_service','customer_service_manager']},
 }},
 {screen:'journeys',ar:'تقرير يوم المندوب',en:'Daily route',cells:{
  add:{ar:'كتابة «النتيجة» و«الإجراء المطلوب» على عمل الفريق',en:'Write «Result» and «Action required» on the team\'s work',roles:MANAGEMENT},
  export:{ar:'تصدير تقرير يوم المندوب (Excel)',en:'Export the daily route report (Excel)',roles:MANAGEMENT},
 }},
 {screen:'plans',ar:'خطط المناديب',en:'Representatives\' plans',roleNote:{rep:planOwnNote,marketing:planOwnNote},cells:{
  add:{ar:'إعداد خطة اليوم',en:'Prepare the day\'s plan',roles:['rep','marketing'],note:{ar:'خطة اليوم التالي وإرسالها للمشرف قبل الساعة 12:00 منتصف الليل الذي يبدأ به يوم الخطة (ما يُرسل بعد الموعد يُقبل ويُعلَّم «متأخرة»)، و«خطتي» لتنفيذ خطة اليوم. لا تمنع الخطة تسجيل أي زيارة أو تواصل.',en:'The next day\'s plan, sent to the supervisor before 12:00 midnight, when the plan\'s day begins (one sent later is accepted and marked late), and «My plan» to carry out today\'s. The plan never stops a visit or contact from being recorded.'}},
  edit:{ar:'مراجعة خطط المناديب',en:'Review the representatives\' plans',roles:MANAGEMENT,note:{ar:'اعتماد، واعتماد مع تعديل، وإعادة للمندوب مع السبب، وملاحظة واحدة لكل مراجع على يوم المندوب؛ على خطط فريقه فقط. المشرف حتى منتصف الليل الذي يبدأ به يوم الخطة (بعده «غير معتمدة»)، ومدير المبيعات حتى نهاية يومها وتعديلاته له.',en:'Approve, approve with edits, return with a reason, and one note per reviewer on the representative\'s day; their own team\'s plans only. The supervisor until the midnight that begins the plan\'s day (then «Not approved»), the sales manager until its day ends, their edits theirs.'}},
  export:{ar:'تصدير خطط المناديب إلى Excel',en:'Export the representatives\' plans to Excel',roles:MANAGEMENT},
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
  export:{ar:'تصدير المبيعات (Excel وCSV)',en:'Export sales (Excel and CSV)',roles:MANAGEMENT},
  import:{ar:'استيراد مبيعات ERP',en:'Import ERP sales',roles:MANAGEMENT},
 }},
 {screen:'competitors',ar:'المنافسين',en:'Competitors',cells:{
  export:{ar:'تصدير المنافسين وسجل التواصل معهم (Excel)',en:'Export the competitors and their contact log (Excel)',roles:MANAGEMENT},
 }},
 {screen:'targets',ar:'المستهدفات وتقييم الأداء',en:'Targets & performance',roleNote:{manager:hubTabsNote,supervisor:hubTabsNote},cells:{
  edit:{ar:'تعديل المستهدفات والأوزان وتقييم الأداء وبيانات المؤشرات',en:'Edit targets, weights, the evaluation and the indicators\' data',roles:['admin','manager']},
  export:{ar:'تصدير المستهدفات والتقييم (Excel وCSV)، والتحصيل وعروض الأسعار (Excel)',en:'Export targets and the evaluation (Excel and CSV), and the collection and quotations (Excel)',roles:MANAGEMENT},
 }},
 {screen:'team',ar:'الفريق والصلاحيات',en:'Team and permissions',cells:{
  add:{ar:'إضافة مستخدم',en:'Add a member',roles:['admin']},
  edit:{ar:'تعديل مستخدم وصلاحياته',en:'Edit a member and their permissions',roles:['admin']},
  export:{ar:'تصدير قائمة الفريق (Excel)',en:'Export the team list (Excel)',roles:['admin']},
 }},
 {screen:'trash',ar:'المحذوفات',en:'Deleted records',roleNote:{supervisor:trashOwn,rep:trashOwn,marketing:trashOwn},cells:{
  edit:{ar:'استرجاع سجل محذوف',en:'Restore a deleted record',roles:['admin','manager','supervisor','rep','marketing'],roleNote:{manager:{ar:'لمدير المبيعات: ما حذفه هو فقط.',en:'For a sales manager: only what they deleted themselves.'},supervisor:trashOwnRestore,rep:trashOwnRestore,marketing:trashOwnRestore}},
 }},
];
export const PERMISSION_SCREENS:readonly PermissionScreen[]=PERMISSION_MATRIX.map(row=>row.screen);
/** What may be hidden from a member: a screen, or a tab of the targets hub ('targets.<tab>'). */
export type HiddenKey=PermissionScreen|HubTabKey;
/** The tab rows under «المستهدفات وتقييم الأداء» in the matrix: «استعراض» only. */
export const HUB_TAB_ROWS:readonly ({tab:HideableHubTab;key:HubTabKey}&Text)[]=HIDEABLE_HUB_TABS.map(tab=>({tab,key:hubTabKey(tab),...HUB_TAB_NAMES[tab]}));
/** Whether the role's targets screen is the hub of tabs (the administrator, a sales manager, a supervisor): the ceiling of a tab's switch,
 *  which exists for a member of such a role but the administrator (nothing is hidden from an administrator). */
export const hubTabCeiling=(role:string)=>canUseSalesWorkspace(role)&&canViewPage(role,'targets');
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
 note:{ar:'للمشرف ومدير المبيعات: يطّلع على زيارات ومتابعات وعروض أسعار وتقارير يوم ومبيعات ومستهدفات فريق المبيعات كله (مدير النظام ومديري المبيعات والمشرفين والمناديب) للقراءة فقط؛ ويبقى التعديل والحذف على فريقه هو فقط. مغلقة افتراضيًا.',
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
export type StoredPermissions={cells:Record<string,boolean>;hidden:HiddenKey[];viewAll:boolean};
export function normalizePermissions(role:string,input:{cells?:unknown;hidden?:unknown;viewAll?:unknown}|null|undefined):StoredPermissions{
 const raw=input&&typeof input.cells==='object'&&input.cells!==null&&!Array.isArray(input.cells)?input.cells as Record<string,unknown>:{};
 const cells:Record<string,boolean>={};
 for(const row of PERMISSION_MATRIX)for(const action of PERMISSION_ACTIONS){
  if(!cellCeiling(role,row.screen,action))continue;
  const key=cellKey(row.screen,action);cells[key]=cellFixed(role,key)||(cellDefault(role,row.screen,action)?raw[key]!==false:raw[key]===true);
 }
 const wanted=new Set(Array.isArray(input?.hidden)?input.hidden.filter((value):value is string=>typeof value==='string'):[]);
 // The screens first, then the hub's tabs (in their order), each once; a tab only for a role whose targets screen is the hub.
 const hidden:HiddenKey[]=role==='admin'?[]:[...PERMISSION_SCREENS.filter(screen=>wanted.has(screen)&&pageCeiling(role,screen)),...hubTabCeiling(role)?HUB_TAB_KEYS.filter(key=>wanted.has(key)):[]];
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
export type MemberAccess={version:number;off:string[];hidden:HiddenKey[];viewAll:boolean};
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
/** Whether the administrator hid this screen from the member (never from an administrator); «المستهدفات وتقييم الأداء» also when every tab
 *  of its hub is hidden and «رفع المبيعات» does not show (lib/access.ts hubTabsAllHidden). */
export const pageHidden=(me:Who|null|undefined,screen:string)=>!!me&&me.role!=='admin'&&(!!me.access?.hidden.includes(screen as PermissionScreen)||screen==='targets'&&hubTabsAllHidden(me.role,me.access?.hidden||[]));
/** Whether the screen shows for the member: the role has it, it is not hidden, and «المحذوفات» only for whom trashScopeOf gives it. «خطتي»
 *  (2026-11-22): a field member's own plan of today, with «خطط المناديب» shown and «إعداد خطة اليوم» on. */
export const pageAllowed=(me:Who|null|undefined,screen:string):boolean=>screen==='my-plan'?!!me&&canViewPage(me.role,'my-plan')&&pageAllowed(me,'plans')&&can(me,'plans','add'):!!me&&canViewPage(me.role,screen)&&!pageHidden(me,screen)&&(screen!=='trash'||trashScopeOf(me)!==null);

/** «المحذوفات» (the owner, 2026-11-10): the «حذف» cells whose deletions reach it (a deletion of /api/crm writes the «حذف» entry the page reads,
 *  lib/trash.ts). «إلغاء بيع» is not one: a voided sale stays in «المبيعات» with its reason (app/api/sales: status void, an «إلغاء بيع» entry). */
export const TRASH_DELETE_CELLS:readonly string[]=GRANTABLE_CELLS.filter(key=>key!=='sales:delete');
/** Who has «المحذوفات» and what it lists: the administrator every deletion and the sales manager their own, whatever their cells (lib/access.ts
 *  trashScope); a supervisor or a representative their own while at least one of TRASH_DELETE_CELLS is on for them; nobody else (customer
 *  service holds no «حذف» cell). A member whose cells are all off again has no page; their deletions stay for the administrator. «استعراض»
 *  can still hide it (pageAllowed, the routes' 404), never from an administrator. */
export function trashScopeOf(me:Who|null|undefined):'all'|'own'|null{
 if(!me||!canViewPage(me.role,'trash'))return null;
 const byRole=trashScope(me.role);if(byRole)return byRole;
 return TRASH_DELETE_CELLS.some(key=>{const [screen,action]=key.split(':') as [PermissionScreen,PermissionAction];return can(me,screen,action);})?'own':null;
}
/** A restoration by a member whose «المحذوفات» comes from «حذف» (a supervisor or a representative): the record's own cell, the one its
 *  deletion needed (recordCell: a customer «العملاء · حذف», a visit «الزيارات · حذف», a follow-up «المتابعات · حذف», a quotation or mold
 *  specifications «عروض الأسعار · حذف», an old follow-up thread «المتابعات · حذف», a machine «العملاء · تحرير»), must still be on: the cell
 *  when it is not, else null. The administrator and the sales manager restore as before (never refused here). */
export function trashRestoreCellOff(me:Who,record:{kind?:string;data?:Record<string,unknown>|null}):[PermissionScreen,PermissionAction]|null{
 if(trashScope(me.role))return null;
 // recordCell names a cell for every kind a deletion records (lib/trash-server.ts parseSnapshot); anything else is refused as a customer's.
 const cell=recordCell(String(record.kind||''),'delete',record)||['customer','delete'] as [PermissionScreen,PermissionAction];
 return can(me,cell[0],cell[1])?null:cell;
}
/** Whether a tab of the targets hub is closed to the member: «رفع المبيعات» unless «المبيعات» shows; any other tab when the screen is
 *  hidden or the administrator hid the tab (never from an administrator). A role without the hub has none of its tabs. */
export function hubTabHidden(me:Who|null|undefined,tab:HubTab){
 if(!me||!hubTabCeiling(me.role))return true;
 if(tab==='sales')return !pageAllowed(me,'sales');
 return me.role!=='admin'&&(pageHidden(me,'targets')||!!me.access?.hidden.includes(hubTabKey(tab)));
}
/** The tabs the member sees on «المستهدفات وتقييم الأداء», in the owner's order (none without the hub, or with the screen hidden). */
export const hubTabsOf=(me:Who|null|undefined):HubTab[]=>!me||!pageAllowed(me,'targets')?[]:HUB_TABS.filter(tab=>!hubTabHidden(me,tab));
/** A request that serves only these tabs (each the data of its own tab, or shared by them) is closed when every one of them is closed to the
 *  member and one of them by a switch: the same 404 as a hidden screen's, so hiding one tab never breaks another that shares the request.
 *  A role without the hub is answered by the routes' own role checks, as before. */
export function hubTabsBlocked(me:Who,tabs:readonly HubTab[]){
 if(me.role==='admin'||!hubTabCeiling(me.role))return false;
 return tabs.every(tab=>hubTabHidden(me,tab))&&(pageHidden(me,'targets')||tabs.some(tab=>tab==='sales'?pageHidden(me,'sales'):!!me.access?.hidden.includes(hubTabKey(tab))));
}

/** A request that belongs to these screens is closed only when one of them was hidden and every one of them is hidden or not the role's,
 *  so hiding one screen never breaks another that shares the request (GSCO sectionBlocksRequest). */
export function pagesBlocked(me:Who,screens:readonly PermissionScreen[]){return screens.some(screen=>pageHidden(me,screen))&&screens.every(screen=>pageHidden(me,screen)||!canViewPage(me.role,screen));}

export const PAGE_HIDDEN_TEXT='هذا الجزء غير متاح لحسابك. راجع مدير النظام.';
export function cellRefusalText(screen:PermissionScreen,action:PermissionAction,language:'ar'|'en'='ar'){
 const row=permissionRow(screen)!;
 return language==='en'?`You are not allowed to ${actionNouns[action][1]} in ${row.en}. Ask the administrator.`:`غير مسموح لك ب${actionNouns[action][0]} في ${row.ar}. راجع مدير النظام.`;
}

/** «انسخ الصلاحيات من»: the target takes the source's value of every cell of the target's ceiling (off where the source's role does not
 *  have it; a «حذف» cell is copied whenever the target's role has the screen), the source's hidden screens the target's role has, the
 *  source's hidden tabs of the targets hub when the target's targets screen is the hub too (2026-11-16), and viewAll where the target's
 *  role has it. What the source has that the target's role cannot hold is skipped and listed (cell keys, 'browse:<screen>' for a hidden
 *  screen, 'browse:targets.<tab>' for a hidden tab, 'viewAll'). */
export function copyPermissions(source:{role:string;stored:StoredPermissions},targetRole:string):{stored:StoredPermissions;skipped:string[]}{
 const cells:Record<string,boolean>={},skipped:string[]=[];
 for(const row of PERMISSION_MATRIX)for(const action of PERMISSION_ACTIONS){
  const key=cellKey(row.screen,action),value=source.stored.cells[key]===true;
  if(cellCeiling(targetRole,row.screen,action))cells[key]=cellFixed(targetRole,key)||value;
  else if(value)skipped.push(key);
 }
 const hidden=source.stored.hidden.filter(key=>{const kept=targetRole!=='admin'&&(isHubTabKey(key)?hubTabCeiling(targetRole):pageCeiling(targetRole,key));if(!kept)skipped.push('browse:'+key);return kept;});
 const viewAll=source.stored.viewAll&&viewAllAvailable(targetRole);if(source.stored.viewAll&&!viewAll)skipped.push('viewAll');
 return{stored:normalizePermissions(targetRole,{cells,hidden,viewAll}),skipped};
}
/** The words of a skipped key, for the note under «انسخ الصلاحيات من». */
export function permissionKeyText(key:string,language:'ar'|'en'='ar'){
 if(key==='viewAll')return GENERAL_PERMISSIONS.viewAll[language];
 const tab=key.startsWith('browse:')?HUB_TAB_ROWS.find(row=>'browse:'+row.key===key):undefined;
 if(tab)return permissionRow('targets')![language]+' · '+tab[language]+' · '+MATRIX_COLUMNS[0][language];
 const [screen,action]=key.split(':') as [string,string],row=permissionRow(key.startsWith('browse:')?action:screen);
 if(!row)return key;
 const column=MATRIX_COLUMNS.find(item=>item.key===(key.startsWith('browse:')?'browse':action));
 return row[language]+' · '+(column?column[language]:action);
}

/** The audit action of a save (kept out of GET /api/crm's recent changes, like the other private entries). */
export const PERMISSIONS_AUDIT_ACTION='صلاحيات';

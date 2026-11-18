// «مسؤول تسويق» (the owner, 2026-11-18: «فيه وظيفة جديدة مسؤول تسويق، الموظف مهمته الاساسية تحديث بيانات العملاء، بيضيف التصنيفات دى ...
// بالاضافة بيشتغل زى المندوب»; approved as proposed: «تمام دوس»). A marketing officer is a representative in everything (the pages, the
// visits and follow-ups, the map, the day's route and its tracking, the Android app, their own targets and evaluation, mold requests, a
// supervisor over them, the regional directory), with one difference: they correct the details of every customer of their branch in their
// regions directly, without the approval chain a representative's correction waits in (lib/customer-edit-requests.ts), and they set the
// customer classifications (lib/customer-classification.ts). They never route, reassign or delete a customer.
// Pure and without imports: the page, the server, the tests and the SQL of the commit guards read the same lists from here.

/** The role key stored in crm_members.role (no CHECK constraint on the column: no migration). */
export const MARKETING_ROLE='marketing';
/** The roles that work in the field like a representative: wherever a rule names the representative, it names these. */
export const FIELD_ROLES:readonly string[]=Object.freeze(['rep',MARKETING_ROLE]);
/** A representative or a marketing officer. */
export const isFieldRole=(role:unknown):boolean=>role==='rep'||role===MARKETING_ROLE;
/** A marketing officer only (the one difference: direct customer corrections and the classifications). */
export const isMarketingRole=(role:unknown):boolean=>role===MARKETING_ROLE;
/** The field roles as an SQL list for `role IN (...)` (constants only, never a value someone typed). */
export const FIELD_ROLES_SQL="('rep','"+MARKETING_ROLE+"')";
/** The role the Android app (1.0.14 and older, mobile/android: ContinuousRouteTracker, NearbyRules, OfflineRouteAuthorization) and the
 *  page's tracker compare: they know a field member as 'rep'. A marketing officer is sent as 'rep' to them, so the installed app tracks
 *  their day and offers nearby customers without a new build; every other role as it is. */
export const trackingRole=(role:string):string=>isFieldRole(role)?'rep':role;

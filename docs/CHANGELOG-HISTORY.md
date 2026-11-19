# Yourrest CRM: release history

Cumulative per-release notes carried over verbatim from the previous `README.md`. Exact duplicate paragraphs (the
competitor-workspace and competitor-intelligence notes appeared three times) were removed; nothing else was changed.
Arabic operating notes for individual updates live in `docs/UPDATE-*-AR.txt`; verification evidence in `docs/*VERIFICATION*.json`.

## «صور القالب»: photos of the customer's mold in the customer's data (2026-11-19, no migration, no Android change)

- **Asked.** The owner: «عايز فى بيانات العميل ان ارفع صورة للقالب», then «اكتر من صورة».
- **The section.** «صور القالب» in the customer's sheet (the «البيانات» tab, under the classifications, `app/customer-mold-photos.tsx`):
  squares with the count out of 20, a tap opens one large with the previous, the next, who added it and when; «إضافة صور» is an input of
  images (`accept="image/*"`, several at once, no `capture`), so a phone's browser offers the camera and the gallery. The Android app
  1.0.14 opens Android's document picker for it (the gallery and files, no camera): taking the camera there needs a new build.
- **Space.** Each photo is shrunk on the device first (`lib/image-shrink.ts`: longest side 1600 pixels, JPEG 0.8, lowered to 0.7 and 0.6
  and then smaller sizes down to 800 pixels until it is 400 KB or less; drawing it again drops the camera's metadata, its place among it).
  The server takes a JPEG, PNG or WEBP by its bytes only, 2 MB at most, 20 a customer (the 21st refused, the count checked at the commit
  too), two uploads at a time (429, the page retries).
- **Storage, no migration.** Rows of `crm_visit_files` with ids `mold-photo-<sha256>` and object keys `mold-photo/…` in `env.FILES`, so
  the backups copy and restore them as every visit file; the stored name is the server's (`mold-photo-<day>.jpg`), never the browser's.
  `/api/visit-files` and the visit forms never take a mold photo as a competitor's offer (`canAccessVisitFile`, the customer-service
  route). `portable/backup-core.mjs` leaves out a photo deleted while a backup runs (as a deleted design file); a photo whose row names
  missing bytes still fails the backup.
- **Who.** Adds: exactly who adds and corrects that customer's machines (`moldPhotoAddRefusal`, the `customer:edit` cell): a
  representative and a marketing officer their own customers (a marketing officer of their branch), a supervisor and a sales manager their
  team's, the administrator all, never customer service; «عرض بيانات الفريق بالكامل» does not widen it; the commit re-checks the member,
  their permissions' version and the customer's version (`masterMutationGuard`). Sees: whoever sees the customer (what `GET /api/crm`
  gives them, customer service its branch's), 404 otherwise; the uploader's name only to whoever reads that member's name. Deletes:
  whoever added it and the administrator, after a confirmation; final (the bytes go; «المحذوفات» holds records, not files).
- **Routes.** `GET /api/mold-photos?customerId=` (the list, `no-store`), `GET /api/mold-photos?id=` (the image, inline, `nosniff`,
  `private, max-age=86400`), `POST /api/mold-photos?customerId=&key=<uuid>` (multipart `file`, 2 MB + 64 KB body, two minutes; the same
  key again answers the saved photo, after a delete `deleted:true`, with other bytes 409), `POST /api/mold-photos/delete {id}`.
- **History.** «إضافة صورة للقالب · عدد صور القالب: n» and «حذف صورة من صور القالب · عدد صور القالب: n» on the customer in «سجل
  التغييرات» (English in `lib/locales/en.json`); their ids are the add's and the delete's receipts.
- **Tests.** `tests/mold-photos.mjs` (default gate, 144), `tests/mold-photos-http.mjs` (release build, 71),
  `tests/mold-photos-browser.mjs` (browser, 56; Arabic and English at 320, 360, a tablet both ways and a computer),
  `tests/mold-photos-rollback.mjs` (default gate, 27: the previous release on this release's photos, its backup and restore),
  `tests/production-backup.mjs` (a photo deleted during a backup, 87), `tests/server-authorization.mjs` (the routes).
- **Rollback.** To update-orders-20261119: code only, nothing is changed or deleted. The previous release keeps the rows and the bytes,
  backs them up and restores them, shows none of them (it lists no visit file by customer), and serves one only to whoever knows its id
  through its `/api/visit-files?id=` (a download, by the competitors' offers' rule); `/api/mold-photos` answers 404; the history lines stay
  (in Arabic on its English screen). Coming forward again shows the photos as they were.

## «كل الطلبات» shows the mold requests that exist only in the products application (2026-11-19, no migration, no Android change)

- **Asked.** The filters of «طلبات القوالب» still left out the requests that exist only in the products application: entered there
  directly, or from the old workbook and never linked to a CRM request. The CRM saw them only in «طلبات بانتظار اعتمادي» while they
  waited for the sales manager, and they vanished after the approval. The products application added a read route of its own, `orders`
  (2026-11-19, its schema unchanged).
- **The route.** `POST ?route=orders`, signed like the others, body `{}` or `{"cursor": …}`, answer `{"requests": [...], "next": …}`:
  every request with `crmRequestId` null (`source` "manual" or "legacy"; waiting, cancelled and delivered), newest asked for first, up to
  500 a page; each item the pending item's fields with the status object's. Read by `moldOrderItem` (`portable/mold-rules.mjs`).
- **The server.** `pullProductionOrders` reads every page (ten at most, 15 s for the whole pull), leaves out and counts an item that
  cannot be read (a CRM request that slipped in is left out uncounted, one listed twice is shown once), keeps the result a minute like the
  waiting list (one pull at a time), keeps the last copy with the reason on a failure, and treats a 404 (or a 400 naming only "route") as
  the route missing: nothing shown, remembered ten minutes. Only a page of this release asks (`GET /api/mold-requests?refs=1&orders=1`);
  a page loaded before, and `?id=`, get nothing of them, and nothing is stored in the database.
- **Who sees which.** `canReadMoldOrder`: the CRM's one rule (`canReadMoldRequest`) on the salesman production names
  (`salesman.crmMemberId`) and the customer as the CRM finds it (`moldOrderCustomers`: its Yourrest number, else its ERP code when exactly
  one CRM customer carries it now, else none). The administrator all; a representative only those production names him on (never
  another's); a supervisor his representatives'; a customer-service manager his team's; a sales manager his own, his team's in his regions
  and every one he would approve; an order whose customer is not found, a manager of every region only.
- **The page.** The orders among the CRM's requests by the day asked for; their cards marked «مسجّل في تطبيق المنتجات · للعرض فقط» or
  «من الشيت القديم · للعرض فقط»; a read-only sheet (no edit, cancel, attach, delete, resend or approve; the sales manager approves from
  «طلبات بانتظار اعتمادي» as before) opened without asking the server; every filter counts them, «المندوب» names an unknown salesman by
  production's name, and «المصدر» («الـCRM»، «تطبيق المنتجات»، «الشيت القديم») is offered once the list holds more than one source.
  Quiet notes when production's list could not be had; for the administrator, how many items could not be read and a list cut short.
- **Files.** `/api/mold-requests/design-file?ref=…&file=…` serves an order's file to whoever may read the order; anything else as before.
- **Tests.** `tests/mold-orders.mjs` (default gate, 96), `tests/mold-orders-http.mjs` (release build, 48), `tests/mold-orders-browser.mjs`
  (browser, 101), `tests/mold-filters.mjs` updated for «المصدر» (172). The stand-in production API gained the route (`orders`,
  `setOrders`, `setOrdersPageSize`, `registerLegacy`, `addRawOrder`; 404 unknown_route while off).
- **Rollback.** To update-mold-list-20261119: code only, no data changes; «كل الطلبات» is again the CRM's requests alone.

## The sales manager's mold list holds every request they approve (2026-11-19, no migration, no Android change)

- **Asked.** The sales manager filtered «طلبات القوالب» for the current month and found fewer than expected. A read-only count of the
  live data (`scripts/diagnose/mold-month.cjs`, counts only) found 8 CRM requests in November, 7 in his list: the eighth was made from
  the administrator's account; he approved it from «طلبات بانتظار اعتمادي», but since 2026-11-03 his list held his team's requests only.
  The owner: «تمام عدّلها وارفع لما الفحص يخلص».
- **The rule.** `canReadMoldRequest` for a sales manager: their own, their team's within their regions, and every request
  `moldApprovesRequest` gives them (customer service's, the administrator's, a representative's in no sales manager's team, a team whose
  manager cannot approve it now), so the filters of «كل الطلبات» count them. Never another active manager's team's within that manager's
  regions. Seeing is not changing: editing, cancelling and the files stay with whoever asked (`moldPermissions`, the design-file routes).
- **Not covered.** Requests entered directly in the products application never reach the CRM's list (the products application gives the
  CRM only those waiting at the sales step); showing them needs a read route there.
- **Tests.** `tests/mold-requests.mjs` (the sales manager's list is exactly what he approves; not another manager's team; not outside his
  regions), `tests/diagnose-mold-month.mjs`.

## The owner's correction of the classifications: the opportunity's grade A to D, a computed factory size (2026-11-18, released as update-classification-20261118, no migration, no Android change)

- **Asked.** The owner, after update-marketing-20261118: «تصنيف الفرصة ده موجود بالفعل بس هيزيد / تصنيف حجم المصنع ده بيتحسب من عدد
  ماكينات المتسجلة داخل المصنع / وهو هيدخل التصنيف العميل بناء على اهتماماته».
- **«تصنيف الفرصة» is the opportunity's «قوة الفرصة»** (`strength` of a visit and of a customer-service opportunity,
  `lib/opportunity-strength.ts`), grown to the owner's four levels. The stored values keep their meaning, so nothing is rewritten: `strong`
  «A · مرتفعة», `medium` «B · متوسطة», `weak` «C · ضعيفة», and a new `excluded` «D · مستبعدة», each with the owner's description (shown
  under the field of the visit form once chosen). The visit schema (`lib/crm.ts`) and the service-opportunity schema
  (`lib/customer-service.ts`) take D; the lists, the visits CSV, the service opportunity's details and its queue chip write A to D in both
  languages; the customer-service queue orders A, B, C, an opportunity with no grade, then D (`STRENGTH_ORDER`); the visits list has a new
  «قوة الفرصة» filter beside «مرحلة البيع» (`filterVisitRows`, shared by the table and its CSV). No KPI or report reads `strength`.
- **The customer-level grade and notes are retired** (`opportunityGrade`, `gradeNotes`): gone from the form, the sheet, the marks, the
  filters and the export. Nothing stored is erased: every save of a customer carries them, and a stored `factorySize`, exactly as stored,
  whatever it sends (`carryRetiredClassification`; never a refusal, so a page or a device queue of the previous release is not refused for
  them); a new customer (the form, the device queue, the customers import) gets none; an edit request of the previous release that
  carries one applies its other fields only.
- **«حجم المصنع» is computed, never chosen** (`computedFactorySize`): D «متوقف» when the customer's status is «خامل» (read as the map
  reads it: `mapActivity`, spacing and the English «Inactive» of an import), whatever its machines; else from the machines by the
  no-double-count rule (registered one by one, else the sheet's group, else the sheet count): 5 or more A, 3–4 B, 1–2 C, none «غير محدد».
  A stored `factorySize` is never read; «اعتماد المقترح» and the manual choice are gone. Nothing else marks a stopped factory here: «لم
  يشترِ منذ 60 يومًا» is about our sales to an active customer, a lost or excluded opportunity about one deal. Shown on the row, the card,
  the sheet and (read only, with its reason) the form, filtered as «حجم المصنع (محسوب من الماكينات)» and written in the export; shown to
  every reader of the customer, being computed from what they all read (its machines and status).
- **«اهتمام العميل»** stays entered by hand by the same roles; its refusal now names it («اهتمام العميل يحدده مسؤول التسويق لعملاء فرعه،
  والمشرف لعملاء فريقه، ومدير المبيعات، ومدير النظام.»), and it is still hidden from a representative for another's customer and from a
  marketing officer for another branch's.
- **Going back** to update-marketing-20261118 (`tests/marketing-rollback.mjs`, guide 9-أب): nothing of the customer's classifications is
  lost (this release never wrote the retired three, and kept what was stored); a D stays on its visits and opportunities, which the
  previous release shows without words («غير مسجلة», the code `excluded` on the queue chip), ranks as ungraded, and refuses to save while
  it keeps D (400 «Invalid input»); the guide gives a read-only `sqlite3` listing of them.
- **Tests.** `customer-classification` (default gate, 149 checks), `marketing-role` (default gate, 239), `marketing-rollback` (default
  gate, 45: the previous release 0d35aa6 from git and this one on one SQLite; the guide's two commands through bash to a stand-in sqlite3,
  their queries run with node:sqlite), `offline-forms-ui` (default gate, 174: D in the visit form and its description), `marketing-role-http`
  (release-build, 151: D on a visit and on a service opportunity, the queue's order) and `marketing-role-browser` (browser, 174: the visits
  filter and a visit graded D in its form at 360 and on a desktop, in Arabic and English). `lib/opportunity-strength.ts` joins the shared
  list of `tests/test-areas.json`, and `lib/customer-map-activity.ts` the classifications' area.

## The role «مسؤول تسويق» and three customer classifications (2026-11-18, not released yet, no migration, no Android change)

- **Asked.** The owner: «فيه وظيفة جديدة مسؤول تسويق، الموظف مهمته الاساسية تحديث بيانات العملاء، بيضيف التصنيفات دى ... بالاضافة بيشتغل
  زى المندوب»; the proposal approved with «تمام دوس».
- **The role** (`marketing`, «مسؤول تسويق» / "Marketing officer", `lib/roles.ts`). A representative everywhere a representative is named:
  the pages, a supervisor over them and the sales manager's team, mandatory tracking and the Android app (the installed 1.0.14 is told
  `memberRole: "rep"` by `/api/mobile-route` and `/api/nearby-customers`, `trackingRole`), their own targets and evaluation, the ERP sales,
  quotations and collections mapping, mold requests with the customer's signature and the products application's salesmen list, support
  requests, complaints, customer-service requests and the visit place. Every rule reads `isFieldRole`/`FIELD_ROLES_SQL`; a guard in
  `tests/marketing-role.mjs` lists each literal `'rep'` left in `lib/` and `app/` with its reason. The one difference: they correct every
  customer of their branch in their regions **directly** (no approval request; the customer's history records who, when and every changed
  field before and after, as «تعديل مسؤول التسويق لبيانات العميل», `customer-edit:direct`). Another branch's customer of their regions, and
  any change of a customer's region, go through an edit request exactly as a representative's (their supervisor first, then the sales
  manager; the whole edit in one request; `marketingCorrectionWaits`). Never another region's customer, the responsible member or branch,
  nor a deletion («حذف عميل» has no cell for the role; the server refuses it too). Machines: their own customers', as a representative.
- **Classifications** (`lib/customer-classification.ts`, in the customer's JSON data; «تصنيف العميل» untouched): «تصنيف الفرصة»
  `opportunityGrade` A مرتفعة / B متوسطة / C ضعيفة / D مستبعدة with the owner's descriptions, «ملاحظات التصنيف» `gradeNotes` (up to 1000),
  «حجم المصنع» `factorySize` A كبير / B متوسط / C صغير / D متوقف, «اهتمام العميل» `customerInterest` technical فني / price سعري / service
  خدمي / trust الثقة. The size is suggested from the machine count, which never adds the sheet's machines to those registered one by one
  (the machines registered one by one when there are any, else the sheet's imported group, else the customer's own sheet count): 5 or
  more A (the owner's table said «أكثر من 5»; asked to confirm), 3–4 B, 1–2 C, none nothing; a stored value always wins; D by hand only;
  «اعتماد المقترح» stores the suggestion. Set by the marketing officer (their branch), the supervisor (their team; it waits in their request
  for the sales manager, as their corrections do), the sales manager and the administrator; anyone else's change is refused naming who
  sets them, an unknown value is refused, `null` is empty, and a save that does not carry them keeps them. A representative reads them on
  their own customers only, a marketing officer on their branch's only, customer service reads them: for any other customer GET /api/crm
  sends none of the four and marks it `_classificationHidden`, so the page draws no mark, no suggested size and no summary for it and
  leaves it out of every classification filter that is set («غير محدد» included). On «العملاء»: the form's fields, the sheet, marks on rows and cards, a
  filter for each (the size as shown: stored else suggested) and four columns in the customers' CSV export. The ERP customers import is
  unchanged (its file has no such columns).
- **Mended with it.** The filter bar wraps instead of pushing a tablet on its side sideways when the three selects are in it.
- **Review of 2026-11-18** (an independent review; each defect proved by a probe, each now held by a test that failed before the fix):
  going back to the previous release erases the four on any save of the customer there (the guide said they stay unread: corrected, with
  what is lost, a read-only `sqlite3` export of the four, and the steps before going back: decide the waiting requests that carry a
  classification and change every marketing officer's role, since the previous release refuses to save such a member, 400);
  a representative saw a size suggested from another's machines and matched «غير محدد» and the size filter for customers whose
  classifications are not theirs (now hidden with a marker); a marketing officer was refused another branch's customer (now a request) and
  changed a region directly (now a request); `gradeNotes: null` was refused as «too long» (now empty); the direct correction was recorded
  only as «تعديل» (now with its fields before and after); the size suggestion added the sheet's group to the machines registered one by
  one (now one or the other); a marketing officer read the four of another branch's customers (now hidden); the refusal said «يمكنك
  الاطلاع عليها فقط» to people who cannot (now it names who sets them). A marketing officer's customer saved on the device with its
  classifications, whose role then changes, stays on the device with the reason (tried; it already did).
- **Tests.** New: `marketing-role` (default gate, 241 checks), `customer-classification` (default gate, 179), `marketing-rollback`
  (default gate, 48: the previous release d753f7f from git and this one on one SQLite; the guide's export command through bash to a
  stand-in sqlite3 and its query run with node:sqlite), `marketing-role-http` (release-build, 133) and `marketing-role-browser` (browser,
  146: 320, 360, tablet both ways and desktop, Arabic and English); `offline-outbox-browser` gained the marketing officer whose role
  changes with a classified customer on the device (64). Harnesses
  with stand-in requires given the real `lib/roles.ts` (nine tests), the independent projection of `context-performance` and marketing cases
  in `tracking-gate`, `tracking-companion`, `native-tracking-ui`, `my-targets-ui` and `role-ui`. Guide: section 9-أأ.

## The representative searches visits and follow-ups (2026-11-18, update-rep-search-20261118 after update-android-1014-20261117)

- **Asked.** The owner: «عايز المناديب يقدروا يعملوا بحث على العملاء فى الزيارات والمتابعات».
- **Done.** The record search box («بحث في السجلات») now shows for a representative on «الزيارات» and «المتابعات» as well as «العملاء» (`canSearch` in `app/crm-app.tsx`). It filters the representative's own records the server already sends: visits by customer name, code, contact result and needs (`filterVisitRows`), follow-ups by customer name, code, phone and next action. The map and the targets page still show no search for a representative. Nothing changed on the server.
- **Tests.** `tests/rep-mobile-shell.mjs` (the search shows on the three pages and reaches both lists, Arabic and English, phone and desktop: 726 checks) and `tests/app-browser-workflows.mjs` (a representative in Chromium finds a visit by customer name and none for a name that is not theirs, and the follow-ups page offers the search, at 360 px with nothing running off the screen).

## The filters of «طلبات تصنيع القوالب»: «الحالة», «واقف عند», «المندوب», the days and a wide «بحث» (2026-11-17, not released yet, no migration, no server change, no Android change)

- **Asked.** The owner sent a picture of the filter bar of the products application's orders list: «ضيف الفلاتر دى فى طلبات القوالب
  ماعدا المصدر لان المصدر عندك واحد». So every filter of the picture but «المصدر» (the CRM is the only source).
- **Before.** The list had one search box (customer, description, mold number, order number, requester; a plain lower-case match) and the
  «أعادتها المالية» toggle (2026-11-10).
- **Now** (`lib/mold-filters.ts`, pure; `MoldFilterPanel` in `app/mold-requests.tsx`), over the list already loaded, AND between them and with
  «أعادتها المالية»: «الحالة» (what a card says: not in production yet, each reason it waits in the CRM, the link off, returned by finance,
  production's statuses, cancelled in production, cancelled, and «المفتوحة (لم تُسلَّم)» as the products application has it); «واقف عند»
  (production's `waitingStep`: the sales manager, production, finance, manufacturing, delivery; the manufacturing stage reached; «بانتظار
  اعتمادك» for the sales manager); «المندوب» (the requester, only when the list holds more than one); «من تاريخ» / «إلى تاريخ» (the Riyadh
  day of `requestedAt`, both included, a reversed range turned round); «بحث» (customer name, ERP and Yourrest codes, requester, description,
  mold number, serial, production order number, every word, through `normalizeMapSearch`). Only the choices the list holds are offered.
  «يظهر n من m» and «مسح الفلاتر» once one is set. The card's chip and its line now read their words from the same file, so a choice reads
  as the card. «طلبات بانتظار اعتمادي» is unchanged.
- **Mended with it.** A card's customer name was squeezed to a letter a line beside a long chip at 320 px (the chip wraps under it now); the
  page's own title stayed Arabic in English (`lib/locales/en.json` gains «طلبات تصنيع القوالب» = "Mold requests", a key only).
- **Tests.** New: `mold-filters` (default gate, 169 checks) and `mold-filters-browser` (browser gate, 163 checks: the computer in Arabic and
  English, then 320, 360, a tablet both ways and the computer in each language, and a representative at 360; the squeezed-name check failed
  before the mending). Re-run unchanged and passing: `mold-requests`, `mold-nov10`, `mold-design-files-ui`, `dictation-coverage`,
  `msa-wording`, `test-areas`, and the browser tests `mold-requests-browser`, `mold-nov10-browser`, `mold-design-files-browser`,
  `mold-sign-link-browser`, `mold-pdf-view-browser`, `pwa-browser`. Guide: section 9-غ.

## The owner's four decisions for customer service in the sales process (2026-11-17, not released yet: update-cs-decisions-20261117 after update-cs-sales-20261116, no migration, no Android change)

- **Asked.** The owner decided the four open questions of item 5 of the GSCO list, as in GSCO and Trade, and they ship as a follow-up of
  update-cs-sales-20261116 (deployed with the provisional values), matching GSCO 2.13.79 (source e729ff4, tests e1073bf): «نسبة الفرص المتحولة
  إلى مبيعات» against 100%; a support sale within 30 days of the contact; the sales manager sees only the customer-service teams that report
  to him; «عملاء منقطعون عن الشراء 90 يومًا» includes the customers who never bought.
- **1 and 2.** `CONVERSION_TARGET` = 100 (full marks only when every counted opportunity converted, linear below; weight 15 and 3 cases
  stay) and `SUPPORT_SALES_DAYS` = 30. *Saved settings:* the server stamps `revision: 2` (`SERVICE_KPI_SETTINGS_REVISION`) on every save
  (`app/api/service-kpi/route.ts`, the field accepted from the page); `normalizeSettings` reads live settings without it that hold exactly a
  placeholder of update-cs-sales (`PLACEHOLDER_CONVERSION_TARGET` 50, `PLACEHOLDER_SUPPORT_SALES_DAYS` 60) as the owner's figure; a value set
  by hand stays, anything saved from now on stays (50 and 60 included), and a closed month keeps its certificate.
- **3.** `SALES_MANAGER_SEES_ALL_SERVICE_TEAMS` = false and `performanceReach` (`all`, `reporting`, `team`, `self`): a sales manager's
  «أداء خدمة العملاء», Excel file and API carry only the customer-service managers whose «مدير المبيعات المستلم» he is and their members;
  with none, an empty answer and «لا يتبعك فريق خدمة عملاء» / "No customer-service team reports to you" (no export button), not an error;
  with some, «تظهر هنا فرق خدمة العملاء التي يتبعك مديروها فقط.». The administrator reads every team. `performanceTeams` was the one place
  that read every team (the role tasks are not the sales manager's; «اعتماد وإحالة» is unchanged).
- **4.** `DORMANT_LIST_INCLUDES_NEVER_BOUGHT` = true: the list adds the customers who never bought after the lapsed ones, by name, marked «لم يشترِ
  من قبل» / "Never bought", with the counts «انقطعوا عن الشراء» and «لم يشتروا من قبل», the same branch scope and search, 300 a page
  (`?page=`, «السابق» and «التالي»). The source a system lead from such a customer fills in stays «عميل منقطع عن الشراء 90 يومًا» (stored).
- **Rollback.** No migration (22). Going back to update-cs-sales with the code alone works: it reads the saved settings as they are.
- **Tests.** New: `service-sales-decisions-http` (48 checks; on f907fcf 17 of them fail): update-cs-sales's database state (the placeholders
  read 100% and 30 days on the evaluation and the dashboard, values set by hand stay, a month closed under it keeps 50%, the administrator's
  save from now on stays and is stamped, a page of update-cs-sales saves too), two sales managers and their teams in the API and the Excel
  file with nothing of the other's, one with no team, the administrator; the dormant list with 301 customers who never bought, a page at a
  time, searched, outside the branch. Updated: `service-sales` (77), `service-kpi` (216), `service-kpi-ui` (140), `service-sales-http`
  (114), `service-sales-review-http` (49: two sales managers' teams; a contact 30 days old makes a support sale, 31 not),
  `service-sales-browser` (382, 110 screenshots: the never-bought mark and counts, the sales manager's own team and its note, a sales manager
  with no team). Guide: section 9-ظ.
- **Run** against a build of 4c58e58, one by one: the release-build and browser tests of the customer-service and targets-sales areas,
  with `service-kpi-http` and `service-kpi-browser` (50 files, all passed; `erp-sales-browser` not run: it needs the owner's ERP file) and
  `service-sales-browser` by hand (382); the default gate 212/212 (TypeScript 0 errors; ESLint 0 errors, 165 warnings as before).


## Customer service in the sales process: the lead source, «اعتماد وإحالة», «تسجيل دور خدمة العملاء», «أداء خدمة العملاء», full customer-service sales out of every achievement (2026-11-16, not released yet, migration 0021, no Android change)

- **Asked.** Item 5 of the GSCO comparison list (GSCO 2.13.78), approved by the owner: «تمام موافق ابدأ» (publishing waits for «ارفع»). The item:
  «- «مصدر الفرصة»: ممثل خدمة العملاء يختار مصدر الفرصة الجديدة. النظام يملا المصدر لوحده لو الفرصة بدأت من سجل: «بدء فرصة جديدة من هذه
  الفرصة» (فرصة مفقودة)، أو «فرصة جديدة من هذا الطلب»، أو «فرصة جديدة من هذه الشكوى». شاشة «مصادر الفرص» فيها «فرص مفقودة للاسترداد»
  و«عملاء منقطعون عن الشراء 90 يومًا».» «- «اعتماد وإحالة»: مدير خدمة العملاء يختار «تمرير لمدير المبيعات» أو «تتولاها خدمة العملاء». ده لما
  يكون العميل مش مسجل، أو منقطع عن الشراء 90 يوم، أو المصدر من بره النظام. يظهر تنبيه لو للعميل فرصة مفتوحة عند المبيعات. الفرصة اللي خدمة
  العملاء بتتولاها يشتغل عليها ممثل خدمة العملاء، وأعضاء المبيعات ما يعدّلوهاش.» «- «تسجيل دور خدمة العملاء»: لما الفرصة اللي شاركت فيها خدمة
  العملاء تتكسب أو تتخسر، ترجع مهمة لممثل خدمة العملاء عشان يكتب دوره.» «- شاشة «أداء خدمة العملاء» فيها «تصدير Excel»، ومن غير مستهدف
  دلوقتي (قرار المالك). بتعرض: الفرص. المبيعات اللي خدمة العملاء عملتها بالكامل. المبيعات اللي شاركت فيها. المبيعات اللي ساندتها خلال 60 يوم
  (إعداد يتغيّر من الإدارة). العملاء اللي رجعوا يشتروا.» «- مبيعات خدمة العملاء بالكامل (الفواتير اللي عرض سعرها مربوط بفرصة بتتولاها خدمة
  العملاء) منفصلة تمامًا: ما تدخلش في تحقيق المستهدف، لا للموظف ولا للفريق ولا للفرع ولا للشركة، ولا في التقييم. تقارير المبيعات تفضل بإجمالي
  ERP، وتحتها سطر «منها مبيعات خدمة العملاء بالكامل».» «- تقييم خدمة العملاء: مؤشر جديد «نسبة الفرص المتحولة إلى مبيعات» بوزن 15، ومحتاج
  3 حالات على الأقل.» «- 4 أسئلة لسه مستنية رد المالك في GSCO. خد نفس الرد منه.»
- **What Yourrest had before.** The opportunity customer service registers is a `crm_service_cases` row (`lib/customer-service.ts`,
  `app/api/customer-service/route.ts`): registered with a contact type and products, approved by the customer-service manager and passed to the
  sales manager only (`approve`), assigned, then closed by the sales contacts' stage. No lead source, no keeping it with customer service, no
  role at closing, no dashboard of customer service's sales; the evaluation had eight representative figures (`lib/service-kpi.ts`); every
  ERP sale counted in the achievement (`lib/erp-sales-server.ts` `readErpSales`, `/api/sales`, `lib/kpis-server.ts`, `lib/own-targets-server.ts`).
- **The lead source** (`lib/service-sales.ts`, `lib/service-sales-server.ts` `intakeLead`, `resolveLeadReference`, `leadList`; `GET /api/service-leads`):
  «من جهد خدمة العملاء» picked from GSCO's list (or «أخرى» with 3 letters), or «من بيانات النظام» filled in and locked from a lost opportunity,
  a dormant customer, a support request, a missed visit or a complaint. Old cases and old queued saves: «غير محدد».
- **«اعتماد وإحالة»** (`GET /api/service-routing`; `approve` with `route:'service'` and `ownerId`): allowed for a customer with no ERP code (the
  Yourrest equivalent of «مش مسجل»: customer service cannot add customers), dormant 90 days or never bought, or customer service's own lead;
  the warning of an open sales visit or mold request; status `'service'` «لدى خدمة العملاء», worked by its owner only (`action:'stage'`, its
  contacts); sales never read it nor attach a visit to it.
- **«تسجيل دور خدمة العملاء»** (`GET/POST /api/service-role-tasks`): one task at each closing after the migration, for the owner, else the
  registrar, else a support handler; 24 working hours; recorded once (`crm_service_role_tasks`).
- **Attribution and the exclusion.** Full, shared, support (by the quotation an ERP invoice names, the customer's quotation dated while the
  opportunity was open; support within `supportSalesDays`, 60 by default). The full customer-service sales leave every achievement and the
  evaluation (`serviceSalesExclusion`: `readErpSales`, `readOwnErpSales`, the KPI's quotation invoices, «بيانات المؤشرات», the purchase
  history); `/api/sales` sends them apart as `serviceFullSales`, and «رفع المبيعات» keeps the ERP total with the line «منها مبيعات خدمة
  العملاء بالكامل».
- **«أداء خدمة العملاء»** (`GET /api/service-performance`, `/export`): per member and team, no target; Excel «الملخص»، «الفواتير»، «الفرص».
- **Evaluation:** «نسبة الفرص المتحولة إلى مبيعات», weight 15, 3 cases, target 50; other weights 13,13,13,13,9,8,8,8; saved weights scaled to
  85, closed months unchanged; the setting «مدة احتساب مبيعات المساندة (أيام)».
- **Provisional answers (GSCO's):** target 50% (`CONVERSION_TARGET`), 60 days (`SUPPORT_SALES_DAYS` and the setting), the sales manager reads
  every customer-service team (`SALES_MANAGER_SEES_ALL_SERVICE_TEAMS`), the dormant list leaves out never-bought customers
  (`DORMANT_LIST_INCLUDES_NEVER_BOUGHT`). The owner decided them on 2026-11-17: the follow-up release in the entry above.
- **Migration** `drizzle/0021_service_sales_process.sql`: eight nullable columns on `crm_service_cases` (lead_group, lead_source,
  lead_ref_kind, lead_ref_id, lead_note default '', route, routed_by, routed_at; CHECKs), two indexes, and `crm_service_role_tasks`. Schema
  21 -> 22. A code-only rollback after it does not start (the previous release refuses a newer migration history); the way back is the
  previous release with `schema-backups/before-0021_service_sales_process-*.sqlite`. Package with `--schema-baseline 21 --new-migration
  0021_service_sales_process.sql`.
- **Tests.** New: `service-sales` (57), `service-sales-migration` (32), `service-sales-http` (113), `service-sales-browser` (267, 80
  screenshots at 320, 360, tablet both ways and desktop, Arabic and English). Updated for the change: `service-kpi`, `service-kpi-ui`,
  `service-kpi-http` (115) and `service-kpi-browser` (83) (nine figures; the hand-worked scores keep the old weights, saved by the
  administrator, with the new indicator at weight 0), `server-authorization`, `context-performance`, `visit-mobile-ux`, `offline-forms-ui`,
  and the «no new migration» counts of `permissions`, `kpi-effective-visits`, `kpi-leave-months`, `kpi-sales-manager-gaps`, `review-pending`,
  `supervisor-reviews-complete`, `opportunity-entry`, `followup-recontact`, `record-import`. Guide: section 9-ض.
- **The release gates** (`node scripts/gates.mjs --full`): the first run, 109 passed, 5 failed, 1 not stable, 4 skipped (the owner's ERP
  files). The five came from this change and were mended: `customer-service-item3-browser` and `service-queue-browser` (the two new panels
  carried the monthly report's class `service-report`, which those tests select by: they have `service-sales-panel` with the same look now),
  `opportunity-entry-browser` (the browser's own «required» on «مصدر الفرصة» stopped the form before «نتيجة التواصل» was shown beside its
  field: the source is now checked by the form after the other fields, its message under it), `service-kpi-http` and `service-kpi-browser`
  (the nine figures and the new default weights). Each then passed alone against a new build (115, 243, 26, 83, 162 checks; `service-sales-browser`
  267). Not stable: `erp-sales-replace-http` (a 409 on «applied with the agreement» in the pool, passed when run again alone, as on
  2026-11-15 before this change). The default gate after the mending: 212/212 (TypeScript 0 errors; ESLint 0 errors, 165 warnings: the 160 of
  the baseline and 5 of the new code's kind already in the files, `react-hooks/set-state-in-effect` and refs read in render).
- **The independent review** (2026-11-16, every defect proved over HTTP on a build of 26d5963 with made-up data; each mending has a check
  that failed before it: `tests/service-sales-review-http.mjs`, 19 of its 44 checks failed on 26d5963, and 5 new checks of
  `tests/service-sales.mjs` with its 3 new helpers missing there):
  1. *A later decision reclassified past sales.* «بالكامل» now needs a quotation dated on or after the day of «تتولاها خدمة العملاء»
     (`routed_at`, `CaseFact.routedAt`), an invoice dated on or after it, and an invoice the system received after the decision
     (`created_at` of the ERP row, `InvoiceFact.importedAt`; `keptSale` in `lib/service-sales.ts`). A quotation or invoice from before
     it is «بالمشاركة» and stays in the achievement; a finished month and the whole `/api/sales` answer are the same across the decision.
  2. *The return of a full sale was charged to the representative.* An ERP return naming no quotation, of a customer whose code names
     it, dated on or after one of its full sales, follows them, whole, while they cover it (`fullReturns`); beyond that it stays.
  3. *Reach.* «أداء خدمة العملاء», its Excel and the role tasks name an opportunity's customer, owner and source words only to a reader
     who may read the opportunity (`canReadService`: the regions, the branch for all but an administrator, no sales member on a kept
     one); the figures are the same for every reader (question 3). A role task is listed and recorded only on an opportunity the reader
     may read, or as the member's own task on a customer of their branch and regions.
  4. *Matching.* An invoice sells a quotation only when dated on or after it and, when its code names one customer, of that customer
     (`invoiceOfQuote`, as `quoteConversions`). The exclusion and the dashboard read the same documents (a check compares them).
  5. *The monthly report lost the loss reason of a kept opportunity:* `serviceLossReason` (`lib/customer-service.ts`) for the report,
     its Excel and «فرص مفقودة للاسترداد».
  6. *A dormant customer could never be started again:* blocked only while an opportunity of the customer is open; offered again on
     «عملاء منقطعون عن الشراء 90 يومًا» once it closed.
  7. *«فرص مفقودة للاسترداد» named the people on another member's opportunity:* the holder and the registrar only for an opportunity
     the reader may read (and not searchable otherwise); the customer and the loss reason stay.
  Suspected and checked: «مستهدفي» counted a full customer-service sale as the representative's work in a closed month (real: mended in
  `lib/own-targets-server.ts`, checked); a decision changing sales without the sales revision (no longer: after 1 the decision changes
  no document already held, checked); the cost of the exclusion once one opportunity is kept, with 10 000 made-up customers and 30 000
  activities (`/api/sales` +141 ms, with «تقييم الأداء» +156 ms, «مستهدفي» 9 to 172 ms before; +70, +72 and 7 to 62 ms after: every
  customer's code is read as one column, `json_extract`, not every customer record parsed).
  Run after the mending, against a new build: `service-sales-review-http` 44, `service-sales-http` 113 (its ERP fixture now dates each
  document's arrival at its insertion, after the decision), and the release-build and browser tests of the customer-service and
  targets-sales areas one by one (33 files, all passed: among them `service-kpi-http` 115, `support-http` 230, `targets-tabs-http` 134,
  `erp-sales-replace-http` 31, `service-sales-browser` 267, `customer-service-item3-browser` 243, `service-queue-browser` 162); the
  default gate 212/212 (`service-sales` 66 checks; TypeScript 0 errors; ESLint 0 errors, 165 warnings as before). No screen changed
  (`npm run build` regenerated nothing in `public/`).

## Customer-service reports by contact type and to Excel, «شكوى تنتظرك» on the phone, «طلب مساندة» from an opportunity (2026-11-16, not released yet, no migration, Android 1.0.14 (15))

- **Asked.** Item 3 of the GSCO comparison list, approved by the owner: «تمام موافق ابدأ» (publishing waits for «ارفع»). The item:
  «أ. تقرير طلبات الخدمة يتوزّع «حسب نوع التواصل» في الفرصة، بدل «حسب مصدر الطلب» اللي كان بيطلع سطر واحد. الطلبات القديمة تتحسب كمان.»
  «ب. زرار «تصدير Excel» في كل تبويب من «تقارير خدمة العملاء»: الملف فيه 3 أوراق: «الملخص»، و«زمن المراحل»، و«التفاصيل» (سطر لكل طلب أو
  شكوى). كل مستخدم يصدّر اللي مسموحله يقراه بس. صلاحية جديدة «تصدير تقارير خدمة العملاء»، شغالة تلقائيًا للمالك والإدارة ومدير المبيعات ومدير
  خدمة العملاء، ويقدر المالك يقفلها لأي حساب.» «ج. تنبيه «شكوى تنتظرك» على الموبايل: بيوصل للي عليه الدور في الشكوى: المراجعة، أو التكليف،
  أو التفويض، أو التواصل والحل، أو الإغلاق. الشكاوى عالية الأهمية تظهر الأول. فيه فحص في الخلفية كل 15 دقيقة، من 06:00 لـ 18:00 بتوقيت
  السعودية، ما عدا الجمعة، حتى لو تسجيل خط السير مقفول. الميزة دي محتاجة تحديث أندرويد، والتحديث إجباري: أقل نسخة مسموحة = النسخة الجديدة.»
  «د. «طلب مساندة» جوه الفرصة يفتح طلب في «التواصل مع العملاء» بمدده وتصعيده: الزرار يظهر للمندوب على كل فرصه المفتوحة. لو العميل مش مربوط
  بالدليل، تظهر رسالة توضح ده. لو للعميل طلب مفتوح، يظهر زرار «فتح الطلب المفتوح». طلبات المساندة القديمة تفضل مقروءة، والمفتوح منها يقدر
  يكمل، بس ما يتعملش منها طلبات جديدة.»
- **أ. By contact type.** `lib/service-report.ts` `serviceContactType`: the opportunity's `data.source`, else `registration.type` (the
  older cases), else «غير محدد»; the report's `bySource` is now `byContactType` (`{type,total,won,lost,open,winRate}`), headed «بحسب نوع
  التواصل» on the screen.
- **ب. Excel.** `GET /api/service-report/export?kind=requests|complaints&month=YYYY-MM&lang=ar|en` (`lib/service-report-export.ts`, the
  multi-sheet writer `xlsxBook` of `lib/xlsx-write.ts`): «الملخص», «زمن المراحل», «التفاصيل» (one row for each request or complaint the reader
  may read: `canReadService`, `canReadComplaint`), right to left in Arabic, English sheets in English. Without a session 401, a hidden screen
  404, a role the report refuses 403 (its own words), the cell closed 403, a bad month 400; `private, no-store`. The new permission row
  «تقارير خدمة العملاء» › «تصدير» (`service-reports`/`export`) is on for the administrator, the management and the sales manager by their role
  («admin», «manager») and for the customer-service manager; the owner closes it for any account in «الصلاحيات». The screens' definitions moved
  to `lib/service-report-view.ts` so the page does not load the writer.
- **ج. «شكوى تنتظرك».** `GET /api/complaints/alerts` (`lib/complaint-alerts.ts`): the complaints waiting for the reader by the existing queue
  rules (review, correction, assignment, delegation, contact, resolution, closure), high importance first, at most 20, only the customer's
  name, the category, the importance, the step, whether opened and since when; 401 without a session, 404 with the screen hidden, `no-store`.
  The page opens a complaint from `#complaint=<id>` or the app's `yourrest:open-complaint`. Android 1.0.14 (15): `ComplaintAlerts` (channel
  «شكاوى العملاء», grouped, ordered by importance, the page's language, a tap opens the complaint, a notice leaves once opened or no longer
  waiting), and `AlertCheckJob` (JobScheduler, every 15 minutes with a network, runs only 06:00–18:00 Riyadh and not on Friday
  (`ContinuousPolicy.inWindow`), with route tracking off too; also polls the service alerts). No new permission. The minimum version is the
  release's business (`deploy/android-request.json`), not this commit.
- **د. «طلب مساندة» from an opportunity.** `lib/support-opportunity.ts`, `GET /api/support/opportunity?caseId=` (a preflight) and
  `POST /api/support` with `opportunityId`: the administrator and the sales team ask from an open opportunity they may read; customer service
  403; an opportunity the reader cannot read 404; a customer not in the list, a closed opportunity or a customer with an open request 409 with
  its reason, and «فتح الطلب المفتوح» when the reader may read it. The request keeps the opportunity (number, products) and shows it in
  «التواصل مع العملاء». The internal help of the service case (`action:'assist'`) is retired with 409 and a message that names «طلب
  مساندة»; old ones stay readable and an open one can still be answered (`reply`).
- **Tests.** New: `service-report-export` (78), `complaint-alerts` (23), `support-opportunity` (25), `complaint-alerts-android` (27, with the
  Java checks `ComplaintAlertRulesCheck` 63 and `ComplaintAlertsCheck` 56), `service-report-export-http` (51), `complaint-alerts-http` (37),
  `support-opportunity-http` (35), `customer-service-item3-browser` (243, 46 screenshots at 320, 360, tablet both ways and desktop, Arabic and
  English). Updated for the change: `service-report`, `service-report-http`, `service-queue-ui`, `permissions`, `permissions-ui`,
  `crm-regression`, `service-queue-http`, `server-authorization`, `nearby-customers-android`, `ServiceAlertCheck`.

## No customer data in the repository: the initial data snapshot and the source uploads removed; a first installation is empty with its owner (2026-11-16, not released yet, no migration)

- **Asked.** The repository was public until today and carried real customer data since its first import. The owner approved removing it:
  «تمام موافق ابدأ».
- **Removed from the branch** (`git rm`) and kept out by `.gitignore`: `migration/initial.json` (the initial data snapshot of the first
  installation: customers, factories, members and audit rows of the previous application), `migration/initial.sha256`, and
  `Yourrest-CRM-Revised-Source-20261010.zip` (the original source upload, which held the same snapshot). `.gitignore` also keeps out
  `/migration/`, `*-Revised-Source-*.zip`, `*-Full-Source-*.zip` (the earlier upload `Yourrest-CRM-Full-Source-20261008.zip`, deleted from
  the tree on 2026-10-10, held it too), the Namecheap package and its stage, `*.sqlite` with its journals, and `yourrest-crm-data/`.
- **A first installation** (`portable/setup.cjs`, `portable/initialize.mjs`). Without initial data the database is created empty with its owner
  only: `node setup.cjs --owner-email=name@yourrest.org [--owner-name=...]` (member `owner`, admin of every region, the address lower-cased and
  held to `@yourrest.org` like the protected-owner check; the name defaults to «مدير النظام»; the company row names it). Without an owner and
  without a file, setup refuses before it writes a settings file, a folder or a database. An initial data file the administrator places by hand
  in `migration/initial.json` with its SHA-256 in `migration/initial.sha256` still loads as before, its checksum checked first; a missing file
  or checksum, a mismatch, or a file together with `--owner-email` is refused and nothing is created. On an existing database setup changes
  nothing and refuses `--owner-email`. The summary says `initialData: "none"` or `"file"` for a new database.
- **The Namecheap package** (`scripts/package-namecheap.py`) no longer copies `migration/` into the package or its `source/`, and refuses to
  write a package that holds `initial.json`, `initial.sha256`, a `migration/` folder or a source upload; it takes an optional archive path.
- **Tests.** `tests/fixtures/made-up-seed.js` builds a MADE-UP seed on the schema of the migrations it is given (fictional people and
  customers, phones 0500000001.., e-mails at example.com; nothing derived from real data). `tests/startup-upgrade.mjs` seeds from it (it read
  the real snapshot before); `tests/portable-installer.mjs` adds the empty installation with its owner, the refusals, and a hand-placed
  made-up seed with its checksum checked; `tests/package-install.mjs` checks that the package holds no initial data, then installs it empty
  and from a hand-placed made-up seed. `tests/test-areas.json` drops the two removed paths. The update-package Python tests keep their
  one-line stand-in `migration/initial.json` of an existing installation (no record in it).
- **Live site.** Unaffected: its data is in `yourrest-crm-data`, and the snapshot is read only by a first installation.
- **Not done here.** The files are still in the git history of every branch: removing them from history is a separate step (a history
  rewrite), with the published release archives under `deploy/packages/` left as they are (none holds the snapshot).

## The sales manager out of the evaluation, and what completes it (2026-11-16, not released yet, no migration)

- **Asked.** Item 2 of the GSCO comparison list (GSCO 2.13.76, commit d623c9a), approved by the owner: «تمام موافق ابدأ». The item:
  «مدير المبيعات يخرج من «مقارنة أداء المندوبين» ومن التقييم ومن مستهدفات النشاط، حتى لو له كود موظف أو تقييمات قديمة. التقييمات القديمة
  تفضل محفوظة.» «جنب «بيانات ناقصة» تظهر أسماء المؤشرات الناقصة وأوزانها.» «فوق الجدول مربع «المطلوب لاكتمال التقييم».» «في صفحة الموظف
  قايمة بكل مؤشر ناقص، والمطلوب عشان يتحسب.» «طريقة حساب الدرجة ما تتغيرش.»
- **What Yourrest had before** (read in the code first): the sales manager (role `manager`) was a person of the evaluation like a
  supervisor: `app/api/sales/route.ts` kept every `manager` among the people (`['rep','manager','supervisor']`), `lib/kpis-server.ts`
  `kpiData` scored his team roll-up and `saveKpi` accepted his assessment, so he had a row in «مقارنة أداء المناديب»
  (`app/kpi-performance.tsx`), a card in «ملخص المناديب» (`app/targets-performance-summary.tsx`), lines in «تصدير التقييم»
  (`lib/targets-export.ts`), a place in the hub's «المندوب» picker (`app/sales-workspace.tsx`) and in «بيانات المؤشرات»
  (`lib/kpi-evidence-server.ts`), and a customer-and-visit target computed from his team (`lib/targets.ts` `withManagerTargets`) shown in
  «مستهدفات العملاء والزيارات» and on his card (`app/targets-workspace.tsx`) and exported. Saving one for him was already refused
  (400, «مستهدف المبيعات للمدير والمشرف يُحسب تلقائيًا…»). «بيانات ناقصة» (2026-11-14) named the missing indicators without their weights,
  on the cards and the person's page only; the comparison showed a «غير مكتمل» badge; nothing said what would complete an indicator.
- **1. The sales manager out** (`roleOutOfEvaluation` in `lib/targets.ts`: the role alone decides, whatever ERP employee code is mapped to
  him, whatever ERP sales or old assessment he has). `GET /api/sales?kpis=1` no longer scores him for any reader (the administrator, the
  sales manager himself, a supervisor): not in the comparison, the summary cards, «التحصيل», «عروض الأسعار», «تصدير التقييم»; the hub's
  picker on those three tabs leaves him out and a chosen manager falls back to the team; the cards of a month not begun leave him out too.
  `POST /api/kpis` for him answers 404 «حدد عضوًا متاحًا ضمن صلاحيتك للتقييم», as for any member out of the evaluation; `GET
  /api/kpi-evidence` for him 404 «عضو الفريق غير متاح ضمن صلاحيتك.». The customer and visit targets («مستهدفات النشاط»): no row in
  «مستهدفات العملاء والزيارات», no block on his card (it says «مدير المبيعات خارج التقييم ومستهدفات العملاء والزيارات.»), none in
  «تصدير كل المستهدفات»; a save for him (the page, `POST /api/targets`, and the Excel import) is refused with «مدير المبيعات خارج التقييم،
  فلا تُحدَّد له مستهدفات العملاء والزيارات.» (400, as it was refused before with another sentence). His products target, computed from
  his team, stays on «المستهدفات والأوزان». **His old rows are kept**: nothing is deleted or rewritten (`crm_kpi_assessments` and every other
  table), they are only not read; the previous release reads them again.
- **2. What completes the evaluation** (`lib/kpi-gaps.ts`, pure, read from what the server already sends, so the score, the weight with data
  and the missing set are unchanged). A missing indicator is one `kpiSummary` leaves out of the weight with data; «لا ينطبق» is never
  listed (since 2026-11-14 its weight leaves the applicable weight in Yourrest). The five conduct indicators are one line, «تقييم السلوك من
  الإدارة» (10%), when all five are missing.
  - **Beside «بيانات ناقصة»** the names with their weights: under each incomplete score of the comparison (new), on the summary cards, and in
    «تصدير التقييم» («بيانات ناقصة: تحقيق المستهدف البيعي (25%)، التحصيل (20%)…», English «Missing data: Sales target achievement (25%), …»).
  - **«المطلوب لاكتمال التقييم» above the comparison:** one line per action with the weight of the indicators it completes, and under it
    whom it concerns («كل المناديب (N)» when everyone listed, else four names and «+N»), the most weight first; a person out of the month («بلا نشاط
    في هذا الشهر») is left out; nothing is drawn when nothing is missing.
  - **The person's page:** the yellow note's names become a checklist «المؤشر (الوزن): المطلوب» under «المطلوب لاكتمال التقييم:».
  - **The actions, who and where:** the product weights (the administrator or the sales manager, «أوزان التقييم» on «المستهدفات
    والأوزان»); a weighted product's target («تعديل الأصناف»; for a supervisor, his representatives' targets); the month's complete ERP sales
    («استيراد مبيعات ERP» on «رفع المبيعات», ticking «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها») or the confirmation in «بيانات
    المؤشرات», and for growth, retention and recovered customers the months to upload by name (the coverage's own sentence); the
    collection statement («استيراد كشف التحصيل من ERP» on «التحصيل», or «بيانات المؤشرات»); the ERP customers file with «التاريخ» for the
    month's customers without a creator; the supervisor's rating of each visit («فعالة» or «سلبية», «إضافة نتيجة وإجراء» in «تقرير يوم
    المندوب») with the visits waiting; the conduct scores («تقييم الإدارة وتدقيق البيانات»); linking the team in «الفريق والصلاحيات» for
    a supervisor without one. A case not listed keeps the indicator's own reason. Every text has its English; Modern Standard Arabic only.
- **The score did not change.** `kpiSummary` and `calculateKpis` are untouched. `tests/kpi-sales-manager-gaps.mjs` compiles the real routes
  on SQLite and compares every representative's and supervisor's metrics, summary, attainment, growth rows and quotations, and the rest of
  the answer of `/api/sales` (sales, targets, performance, members), for the administrator's, the sales manager's and the supervisor's
  views, with the release before (commit f9fe2bf): identical, compared live with `--baseline f9fe2bf` (which compiles that commit's routes
  from git) and kept as digests for the gates.
- **Also mended on the same screens:** two lists of team names were joined with the Arabic comma in English mode (the computed team under
  «فريق المبيعات المحتسب» on a person's page, and «الفريق المحتسب» on «المستهدفات والأوزان»).
- **Differences from GSCO, and why.** GSCO's sales manager role is `sales_manager`; Yourrest's is `manager`. GSCO also lists «لا ينطبق
  هذا الشهر» indicators on a dimmed line, because there they are part of the missing weight; in Yourrest they leave the applicable weight
  (2026-11-14) and are not missing, so they are not listed. GSCO's actions are written for its sections; Yourrest's name its own tabs,
  buttons and pages, and for coverage reuse the months the coverage already names. GSCO's representative keeps a short warning on their
  own screen; Yourrest's representative has no evaluation screen («أهدافي» shows targets only). Yourrest keeps the manager's products
  target (computed from his team) on «المستهدفات والأوزان»; only the customer and visit targets serve the evaluation. The refusals keep
  Yourrest's existing statuses (404 for the assessment and the evidence, as GSCO; 400 for the activity target, already refused before).
- **Not changed.** No migration (21 tables, `0020_member_permissions.sql` the last). No new permission. The administrator's rule
  (`hiddenAdminIds`) is unchanged. The supervisor's evaluation is unchanged.
- **Tested.** New: `tests/kpi-sales-manager-gaps.mjs` (default gate, 171 checks; 173 with `--baseline f9fe2bf`, which compiles that commit's
  routes from git and compares the scores live: the real routes on SQLite, the score unchanged, `lib/kpi-gaps.ts`, the screens with the real
  components and the two exports in Arabic and English), `tests/kpi-sales-manager-gaps-http.mjs` (built release, 60: the four routes and
  the Excel import, 401 without a session, 403 for the roles without the right, 404/400 for the sales manager, his old row unchanged),
  `tests/kpi-sales-manager-gaps-browser.mjs` (Chromium at 320 and 360 px, a tablet upright and on its side and a desktop, Arabic and
  English, 199, screenshots). Mutations: taking the rule out of `kpiData`, out of `saveKpi`, out of the activity table, or the conduct
  line out of `kpiMissing`, each fails the new test. Updated, because they read what changed: `tests/kpi-leave-months.mjs` (123),
  `tests/kpi-leave-months-http.mjs` (48), `tests/kpi-effective-visits.mjs` (89), `tests/kpi-effective-visits-http.mjs` (58),
  `tests/kpi-complete-integration.mjs` (115), `tests/new-customers-erp-http.mjs` (26) and `tests/targets-audit-browser.mjs` (122) (the
  sales manager's row, card, roll-up or assessment); `tests/kpi-performance-evidence-ui.mjs` (119), `tests/targets-performance-summary-ui.mjs`
  (106), `tests/kpi-effective-visits-browser.mjs` (20) and `tests/targets-export.mjs` (44) (the names with their weights, the checklist,
  no customer and visit targets of his in the export); `tests/record-import.mjs` (123: the new reason). The release gates (`node
  scripts/gates.mjs --full`): the first run (20261116-104349) stopped on `targets-audit-browser` (its English check allows Arabic only as
  people's names, and a summary line held the English action and the names; the names now go on a line of their own under each action) and
  `kpi-effective-visits-browser` (its expected words changed; it was updated during that run, so its rerun passed with the new file: a
  real change, not an unstable test), with `service-queue-browser` not stable; the final run (20261116-111716): 106 passed, 3 not stable
  (each failed in the pool and passed alone, none touches the evaluation: `complaints-browser`, «the complaint registered three days ago is
  listed» 8 s in; `mold-requests-browser`, the strict-mode locator of three headings, as before; `service-queue-browser`, as before), 4
  skipped (the owner's ERP files), 0 failed; the default gate 206/206 with TypeScript (0 errors) and ESLint (0 errors, the 160 warnings of
  the baseline); `tests/msa-wording.mjs` passed.

## Today's sales against today's target, a re-contact date for a lost follow-up, and targets and follow-ups imported from Excel templates (2026-11-16, not released yet, no migration)

- **Asked.** Item 8 of the GSCO comparison list, approved by the owner: «تمام كمل كل البنود وارفع لما الفحص يخلص». The item: «صغيرة: مبيعات اليوم قصاد
  مستهدف اليوم، وميعاد إعادة تواصل مع الفرصة الخسرانة، واستيراد المستهدفات والمتابعات من قوالب Excel.» GSCO 2.13.74: `lib/crm/shared.ts` reportRows
  («صافي مبيعات اليوم» beside «مستهدف اليوم»), `docs/LOST-RECONTACT-DATE-AR.md` (2.13.43), `lib/crm/record-import*.ts` (2.13.66).
- **What Yourrest had before** (read in the code first): none of the three. The targets were monthly quantities by product (`lib/targets.ts`) with the
  month's achievement only (`app/targets-performance-summary.tsx`, «أهدافي» `app/my-targets.tsx`); a follow-up recorded «تم الفقد» cleared its next
  step and closed the customer's follow-up line for good (`app/api/customer-followups/route.ts`, `lib/customer-followups.ts`); the only Excel imports
  were the ERP's (sales, customers, quotations, collection statement), no template and nothing for targets or follow-ups.
- **1. «مبيعات اليوم قصاد مستهدف اليوم»** (`lib/daily-target.ts`, `app/today-sales.tsx`). As GSCO divides it: the day's target is the month's target
  over the month's working days; Yourrest's working week is Saturday to Thursday (the Friday day off of `lib/working-hours.ts`), so a Friday's share is
  zero and the card says it is the weekly day off. The day's sales are the confirmed sales documents of that Riyadh day (CRM and ERP, returns
  deducted) of the people whose sales the month's achievement counts. Each product: «مبيعات اليوم», «مستهدف اليوم», the percentage of it, and the
  month's target. A day picker inside the month, never after today (an ended month opens on its last day). Where: «نتائج الأداء» of the targets
  page, under the filters, for the whole team of the branch chosen or the person picked (the administrator, a sales manager and a supervisor,
  from the data `GET /api/sales` already gives them: their own scope, regions and rights; a computed supervisor's or manager's target counts their
  team's sales); and «أهدافي» for a representative, their own only (`GET /api/targets` gains `sales.soldByDay`: their quantities of each day of the
  month, numbers only; `readOwnErpSales` now returns each document's day).
- **2. «موعد إعادة التواصل» of a lost follow-up** (`lib/followup-recontact.ts`). In the follow-up form, under «سبب الفقد», «إعادة التواصل
  (اختياري)»: «الإجراء عند إعادة التواصل» and «موعد إعادة التواصل», both or neither, for «تم الفقد» only (another stage is refused), not before the
  follow-up's day nor in the past (Riyadh; the device's day for an entry queued offline); Arabic and Persian digits read. The follow-up is saved
  lost, with `recontact: true` and the date and action as its next step: the customer's line stays open, «قادمة» until the day, then in «اليوم
  والمتأخرة», the dashboard's «يستحق المتابعة» and the day report's pending follow-ups, with «تم الفقد» and «إعادة تواصل» on it; it is executed on
  its day like any open follow-up (the next follow-up starts at no stage). Without the fields (and every lost follow-up or visit saved before) it is
  closed exactly as before. A fault found by the browser test and mended: after a quotation, «هل تحوّل عرض السعر إلى فاتورة؟» → «لا، فُقد عرض السعر»
  (or «نعم») was undone at once, because Radix's hidden form select reported an empty value for the stage it had not listed yet; the form's selects
  now ignore an empty value (none of their options is empty).
- **3. «استيراد المستهدفات من Excel» and «استيراد المتابعات من Excel»** (`lib/record-import.ts`, `lib/record-import-server.ts`, `lib/xlsx-write.ts`,
  `app/record-import.tsx`, `GET`/`POST /api/record-import`). A template to download (Arabic or English headers, a note row, prefilled with what the
  reader may import: their team's members with the month's targets in force; their customers whose follow-up is open), the file uploaded, a
  preview that writes nothing (each row's status, a refused row with its Excel row and the reason), then «استيراد» once: the rows that pass are
  written in ONE transaction, all or nothing (the import's audit line is written first under every condition the preview read, and every write is
  gated on it). Headers in either language and in any order; Arabic-Indic and Persian digits; days as 2026-11-16, 2026/11/16 or Excel's day
  number; months as 2026-11 or 11/2026; at most 1000 rows and 2 MB; formulas, macros and error cells refused by the ERP's own reader.
  - Targets: the rights of editing them (the administrator or a sales manager, «تحرير» on «المستهدفات وتقييم الأداء», their team and regions; a
    finished month for the administrator only). A row is a member (by sign-in email) and a month: the product quantities (a blank cell «غير محدد»
    and 0 a product not assigned, as in the targets form) and/or the three customer and visit targets together. A supervisor's or a manager's
    computed targets are refused, as on the page. Each set written keeps its line in «سجل التعديلات» (before and after, `source: excel-import`).
  - Follow-ups: the rights of recording one («إضافة» on «المتابعات», a sales member). A row is a customer (Yourrest code or ERP code) with an open
    follow-up line, a day not in the future and not before the customer's last contact, a type (a visit is recorded in the app, which needs the
    device's place), the outcome, the stage and next step, the loss reason, a re-contact; recorded as the representative named (a representative
    only themselves; a supervisor or manager a member of their team, with `importedBy`), checked by the follow-up's own rule. One row per customer
    per file.
  - A second run: every target «بلا تغيير» and every follow-up «سبق استيراده» (its record id is made from what the row says), so nothing is written
    twice; the same request again returns its first answer.
- **Rights, no session.** `GET /api/record-import?kind=targets|followups` and `POST /api/record-import`: 401 without a session; 403 from another
  site, and for a role without the right (targets: anyone but the administrator and the sales managers; follow-ups: customer service); 404 when the
  page is hidden from the member; 400 for an unknown kind. `GET /api/targets` and `POST /api/customer-followups` keep their answers (401 / 403).
- **Not changed.** No migration (21 tables, `0020_member_permissions.sql` the last). No new permission cell. A visit's own stage «تم الفقد» stays
  closed as before (a visit always requires a next step; the re-contact belongs to the follow-up that records the loss). The KPIs count a lost
  follow-up as lost whether or not it keeps a re-contact.
- **Differences from GSCO.** The day's target follows Yourrest's Friday day off (zero on Friday); GSCO shows the per-working-day share on every day.
  The re-contact needs its action with its date (Yourrest's rule of 2026-11-15: a follow-up's step carries both; GSCO lets either be empty). The
  imports write the rows that pass in one transaction (GSCO saves each row on its own); a blank product cell is «غير محدد» (GSCO: 0 when the person
  had a target); the targets template has no weights sheet (weights were not asked); one follow-up per customer per file; Yourrest gives the
  templates to download (GSCO's were the owner's own file).
- **A gate setting changed.** The default gate's TypeScript check runs with 1024 MiB of heap (768 before): the release before this one already
  needed between 700 and 768 MiB, and these modules (about 2,800 more types) need between 768 and 800, so tsc was killed out of memory
  (`scripts/check.mjs`, and the rerun in `scripts/gates.mjs`).
- **Tested.** New: `tests/daily-target.mjs` (default gate, 52 checks), `tests/followup-recontact.mjs` (default gate, 52),
  `tests/record-import.mjs` (default gate, 123), `tests/record-import-http.mjs` (built release, 60), `tests/followup-recontact-http.mjs`
  (built release, 28: the re-contact route and «أهدافي»'s days), `tests/today-sales-recontact-import-browser.mjs` (Chromium at 320 and 360 px,
  a tablet upright and on its side and a desktop, Arabic and English, 158, screenshots). Updated, because they read what changed:
  `tests/own-targets.mjs` (151: `sales.soldByDay`, the days add up to the month), `tests/erp-sales-server.mjs` (the day of each own ERP
  document; its later part needs the owner's ERP file and is skipped by the gates), `tests/my-targets-ui.mjs` (76: the day panel),
  `tests/circular-target-gauges-ui.mjs` (69), `tests/persistent-targets-ui.mjs` (45) and `tests/targets-performance-ui.mjs` (190: the new
  components' imports), `tests/opportunity-entry.mjs` (159: the follow-ups import is a writer of follow-ups, by the follow-up's rule, never of a
  visit), `tests/server-authorization.mjs` (786: the new route in the role matrix). The release gates (`node scripts/gates.mjs --full`, twice):
  the first run stopped on the default gate (the TypeScript heap above, the two harnesses above, and `tests/followup-recontact.mjs` once in the
  pool: two follow-ups of one customer at the same fixed instant were ordered by their random ids; mended, then three runs alone and two in
  parallel passed) with `tests/visit-file-concurrency.mjs` not stable (failed in the pool, passed alone; nothing of it changed); the second: 102
  passed, 1 not stable (`mold-requests-browser`: a strict-mode locator of three headings 12.8 s in, in the pool; passed alone; nothing of the
  mold requests changed), 4 skipped (the owner's ERP files); the default gate 202/202 (TypeScript and ESLint: 0 errors; ESLint 160 warnings, the
  baseline's); `tests/msa-wording.mjs` passed.

## «تنبيه المصانع القريبة»: one grouped notice on the representative's phone within 1 km of their factories with no visit for 60 days (2026-11-16, not released yet, no migration, Android 1.0.13 (14))

- **Asked.** Item 7 of the GSCO comparison list: «تنبيه بالمصانع القريبة اللي محتاجة زيارة، على طريقة تنبيه المشاريع القريبة المجمّع في GSCO
  (أندرويد 1.4.8).» The approved proposal («تمام كمل كل البنود وارفع لما الفحص يخلص»): for the **representative only**, in the **Android
  app**, **one grouped notification** when the phone is within **1 km** of customers **they are responsible for** that **have not been visited
  for 60 days or more** and **have a saved location on the map**; **the same factory is not notified more than once a day**.
- **What Yourrest already had** (verified in the code before the change): customers with a saved location read by «خريطة المصانع»
  (`customerCoordinates`, `lib/customer-location.ts`) and their responsible member (`assigned_to`); visits as «الزيارات» records of type
  «زيارة» dated by their day (`lib/kpis.ts`, `lib/team-today-server.ts`); the representative's continuous route tracking in the app
  (`ContinuousRouteTracker`, 06:00–18:00 Riyadh, not Friday, precise and background location and notifications already granted); a
  background poller for customer-service requests (`ServiceAlerts`, 1.0.11) with the WebView's session cookie. **No 60-day rule on visits**:
  «عملاء واقفين» (2026-11-10) is «لم يشترِ منذ 60 يومًا» (`lib/customer-last-purchase.ts`: purchases, status «نشط», and 60 days still
  counting as recent), so it could not be reused; this rule is new, with the owner's approved wording (60 days or more: 60 in, 59 out).
- **The server** (`lib/nearby-customers.ts`, `lib/nearby-customers-server.ts`, `GET /api/nearby-customers`): the signed-in representative
  only (401 without a session; 403 «تنبيه المصانع القريبة متاح لحساب المندوب فقط.» for every other role; 404 «هذا الجزء غير متاح لحسابك.
  راجع مدير النظام.» when «العملاء» is hidden from them; GET only; `no-store`; read-only). One SQLite statement reads the account (GSCO's actor
  sentinel: active, a representative, the same sign-in version and regions, else 403 «تغيّرت صلاحيات حسابك. سجّل الدخول من جديد.») and the
  customers assigned to it with the day of each one's latest visit: any member's visit counts (the customer is what needs the visit), also a
  visit under its request or machine (up to four levels, as `lib/customer-visits.ts` walks them), dated by its own day, else the Riyadh day it
  was stored; a call, a WhatsApp or an e-mail is not a visit; deleted customers and visits are in «المحذوفات» and never read; Yourrest has no
  customer merge. Listed: in the representative's regions, a location the map reads, a name, and the latest visit 60 days before today in
  Riyadh or earlier, or none. Each row: `{id, name, latitude, longitude, daysSinceVisit}` (`null`: never visited) — no phone, e-mail, contact,
  code, address or note. The answer: `{schemaVersion: 1, memberId, memberRole: 'rep', regionScope, serverTime, expiresAt (+10 min),
  refreshAfterSeconds: 300, customers}`, by id; more than 2000 is refused whole (503 «تعذّر تحديث قائمة المصانع القريبة كاملة. حاول
  لاحقًا.»), never cut.
- **The app 1.0.13 (14)** (`NearbyRules`, `NearbyCustomers`, `NearbyApi`; `ContinuousRouteTracker` hands over each fix it has just stored;
  `MainActivity` opens the tap and reads the page's language): fixes of the tracking hours, precise to 75 m, under a minute old, not mock; a
  customer is near when the fix itself is within 1000 m (haversine; 999 m in, 1001 m out) at two fixes 15 s apart; every customer confirmed
  at the same fix in one notification, nearest first; 30 s between notifications; once a customer per Riyadh day, saved per member (ids and
  days only) before the notice shows. The list is asked at the first fix, every 5 minutes, and again just before a notice unless it came in
  the last minute (a customer visited or reassigned meanwhile is not told); a list of another account or region, expired, over 2000 or with
  a row it cannot read is not used; a failure is retried after a minute; 401/403/404 drop it, take the shown notices away and wait 5 minutes;
  logout and an account or region change clear it; the 18:00 pause suspends it. Channel «المصانع القريبة»; «مصنع قريب منك بحاجة إلى زيارة» /
  «مصنعان قريبان منك…» / «3 مصانع قريبة منك…» / «11 مصنعًا قريبًا منك…», each line «<name> — على بعد 420 م · آخر زيارة قبل 75 يومًا» or «لم
  تُسجَّل له زيارة»; the lock screen «يورست: مصانع قريبة بحاجة إلى زيارة» only; English when the person chose English in the CRM page; gone
  after 10 minutes or at 18:00. A tap opens «خريطة المصانع» on the nearest customer (`#nearby=<id>` on a cold start, the event
  `yourrest:open-nearby-customer` on a running page, never replacing a screen with unsaved work: «اقتربت من مصنع بحاجة إلى زيارة. أنهِ ما بين
  يديك ثم افتحه من «خريطة المصانع».»); a member whose map is hidden gets the customer's card. **No permission added**: existing installs
  grant nothing new. Release notes (Arabic and English) in `scripts/publish-android-release.mjs`.
- **Differences from GSCO, and why.** GSCO 1.4.8 enters at 500 m and re-arms after a certain exit (800 m), with no daily limit; Yourrest
  uses the owner's 1 km and once a customer per Riyadh day (GSCO's own rule before 1.4.4), so there is no exit radius. GSCO adds the fix's
  accuracy to the distance; Yourrest takes the fix's own distance (the owner's number, 999 m in and 1001 m out) and ignores fixes less
  precise than 75 m. GSCO's catalog is the representative's open projects; Yourrest's is their customers with no visit for 60 days and a
  location. GSCO always re-checks the list before a notice; Yourrest re-checks unless the list arrived in the last minute. GSCO's group
  opens the project map; Yourrest opens the factory map on the nearest customer (one customer: the same). GSCO's notice is Arabic only;
  Yourrest's follows the language the person chose in the page.
- **Tests.** `tests/nearby-customers.mjs` (new, default gate, 83 checks), `tests/nearby-customers-android.mjs` (new, default gate, JDK 17+:
  `NearbyRulesCheck` 287 checks, the real `NearbyCustomers` on Android stand-ins 72 checks, 21 checks of its own),
  `tests/nearby-customers-http.mjs` (new, built release, 30), `tests/nearby-customers-browser.mjs` (new, Chromium at 320 and 360 px, a
  tablet upright and on its side and a desktop, Arabic and English, 102, screenshots), `tests/server-authorization.mjs` (the route among the
  anonymous 401s and in the role matrix); `tests/msa-wording.mjs` now reads the Android app's Java strings too. Mutations: 8 of the server
  rule (61 days, no region, no assignee, the UTC day, a cut list, own visits only, direct children only, no sentinel) and 12 of the app (1001 m,
  accuracy added, no daily rule, no debounce, no cooldown, no re-check, no cancel on a refusal, showing before saving, no identity check, a
  muted channel ignored, English ignored, no restore after a restart) each fail a test. The whole main source also compiles with `javac
  --release 17` against the pinned Android 35 framework jar the build uses (no new warning). The release gates (`node scripts/gates.mjs --full`, `app/crm-app.tsx` being shared): 102 passed, 2 not stable (each failed in the pool and passed when rerun alone by the gates: `mold-requests-browser`, a Playwright strict-mode locator that met three `h3` headings of the signing sheet 11 s in; `service-queue-browser`, a supervisor's delegation that did not reach the database within its wait under the pool's load; neither touches the nearby notice), 4 skipped (the owner's ERP files); the default gate 202/202 with TypeScript (0 errors) and ESLint (0 errors, the 160 warnings of the baseline); `tests/msa-wording.mjs` passed.
- **Not run here:** the APK build and signing (GitHub, `.github/workflows/android.yml`), a real phone (GPS, the notification shade, Doze,
  battery savers), the route against the live site.

## The targets page's tabs hidden per member: «نتائج الأداء»، «التحصيل»، «عروض الأسعار»، «المستهدفات والأوزان» (2026-11-16, not released yet, no migration)

- **Asked.** Item 6 of the GSCO comparison list, approved by the owner: «تمام كمل البند السادس وارفع لما الفحص يخلص». The item: «إخفاء تبويبات
  صفحة المستهدفات لكل حساب لوحده (النتائج، التحصيل، العروض)، زي مفاتيح إخفاء الأقسام في GSCO.» GSCO 2.13.58 (`lib/crm/section-access.ts`
  of GSCO 2.13.74: the parts `performance.results`, `performance.collection`, `performance.quotations` and `performance.targets`, a hidden
  part answered 404 `SECTION_HIDDEN_STATUS`, «a part goes with its page; a page with no part left goes», the sales tab following the
  sales section).
- **What Yourrest already had** (verified in the code before the change): «الصلاحيات» per member (2026-11-09/10, `lib/permissions.ts`,
  migration 0020): a «استعراض» per screen (hidden: not in the menus, its requests 404 «هذا الجزء غير متاح لحسابك. راجع مدير النظام.»,
  never 401/403), restrict-only, the administrator never hidden from, «انسخ الصلاحيات من», a «صلاحيات» history entry with before and
  after; its row «المستهدفات وتقييم الأداء» hid the whole page only. The hub (2026-11-11, `lib/targets-hub.ts`, `app/sales-workspace.tsx`):
  five tabs; «رفع المبيعات» followed «استعراض» of «المبيعات»; the other four were shown to every role whose targets page is the hub (the
  administrator, a sales manager, a supervisor); `?tab=` and the browser remembered the tab, a tab not shown fell back to «نتائج الأداء».
- **What it does now.**
  - **The switches** (`app/member-permissions.tsx`): under the row «المستهدفات وتقييم الأداء» of the matrix, a row for each of «تبويب
    «نتائج الأداء»»، «تبويب «التحصيل»»، «تبويب «عروض الأسعار»» and «تبويب «المستهدفات والأوزان»», «استعراض» only («—» in the other
    columns). The screen's «الكل» covers them; while the screen's own «استعراض» is off they are disabled with «الشاشة مخفية، فتُخفى
    تبويباتها معها» (their values kept); the screen's row says «لكل تبويب من تبويبات الصفحة «استعراض» خاص به في الصفوف التالية. «رفع
    المبيعات» يتبع «استعراض» في «المبيعات». إذا أُخفيت كل التبويبات ولم يظهر «رفع المبيعات» أُخفيت الصفحة كلها.» Saved with «حفظ
    الصلاحيات» like every other switch.
  - **Which tabs, for whom.** The four GSCO has a switch for: the three the owner named, and «المستهدفات والأوزان» (GSCO's
    `performance.targets`). «رفع المبيعات» gets none: as in GSCO it follows «استعراض» of «المبيعات», which already hides it. A switch
    exists for a sales manager and a supervisor (the roles whose targets page is the hub); the administrator has «—» (never hidden from); a
    representative («أهدافي» has no tabs) and customer service (no targets page) have no tab row.
  - **Restrict-only, nothing hidden by default.** A switch only hides what the role sees today; nobody is changed until the administrator
    saves. **Storage**: no migration (21, `0020_member_permissions.sql` the last): the hidden tabs are kept in the member's existing row,
    among the hidden screens, as `targets.results`, `targets.collection`, `targets.quotes` and `targets.targets` (`HUB_TAB_KEYS`,
    `lib/targets-hub.ts`), normalised to the role on every read and save (`normalizePermissions`), so a forged value grants nothing and is
    dropped for a role without the hub. A row saved before reads as it was. The release before this one ignores the four keys (tried with
    its own `lib/permissions.ts`: every tab shows, and a save from it drops them).
  - **The page** (`app/sales-workspace.tsx`, `hubTabsOf`, `hubTabToShow`): a hidden tab is not drawn nor mounted; a `?tab=` or a tab the
    browser remembers that the member does not have opens the first tab shown, the address then names it (`correctHubTabAddress`) and the
    browser's memory is kept for when the tab is shown again; the evaluation (`/api/sales?kpis=1`) is not asked for while «نتائج الأداء»،
    «التحصيل» and «عروض الأسعار» are all hidden; in a month not begun «تفاصيل» stays on «نتائج الأداء» when «المستهدفات والأوزان» is hidden.
  - **The server** (`requireHubTabs` in `lib/crm-server.ts`, `hubTabsBlocked` in `lib/permissions.ts`): the requests that serve only a
    hidden tab answer 404 «هذا الجزء غير متاح لحسابك. راجع مدير النظام.» (as a hidden screen, never 401/403): `POST /api/kpis` («نتائج
    الأداء»), `GET`/`POST /api/kpi-evidence/import` («التحصيل»), `GET`/`POST /api/erp-quotes` («عروض الأسعار»: its button is on that tab
    only), `POST /api/targets` and `GET /api/targets/history` («المستهدفات والأوزان»). Shared requests stay open while one of their tabs
    shows: `GET`/`POST /api/kpi-evidence` («بيانات المؤشرات», opened from the three evaluation tabs) closes only when the three are hidden;
    `GET /api/sales` (every tab and the «المبيعات» page) keeps answering 200 and leaves the evaluation out (`kpis: null`) when the three
    evaluation tabs are hidden. `GET /api/targets` («أهدافي» of a representative) is unchanged. A tab's request is also closed when the page
    itself is hidden (a part goes with its page), which newly closes `/api/erp-quotes` for a member whose «المستهدفات وتقييم الأداء» is
    hidden (no screen of theirs offered it).
  - **Every tab hidden.** While «رفع المبيعات» shows (the role has «المبيعات» and it is not hidden) the page stays with that one tab.
    Otherwise, as GSCO's «a page with no part left goes», the page is hidden as if its «استعراض» were off (`hubTabsAllHidden` in
    `lib/access.ts`, read by `pageHidden` and `resolveCRMPage`): not in the sidebar nor the phone's menus, an old link opens the first screen
    the member has, its requests answer 404 (`/api/sales` too, both its screens being gone). If such a page were still open it says «لا توجد
    تبويبات متاحة لحسابك في هذه الصفحة. راجع مدير النظام.»
  - **Copy, audit, export.** «انسخ الصلاحيات من» copies the hidden tabs to a sales manager or a supervisor; to a role without the hub they
    are listed as not copied («المستهدفات وتقييم الأداء · عروض الأسعار · استعراض»). Every save is the same «صلاحيات» history entry with
    before and after (the tabs in `hidden`). The permissions have no export.
- **Differences from GSCO, and why.** GSCO keeps hidden parts in a table of their own (`user_hidden_sections`); Yourrest keeps them in the
  existing permissions row, so no migration and one save, version and audit as for every switch. GSCO's matrix has per-part action cells
  (`manage_kpis` on its results, imports on collection and quotations, `manage_targets` on its targets); Yourrest keeps «تحرير» and «تصدير»
  of «المستهدفات وتقييم الأداء» for the whole page as before (adding cells per tab was not asked). GSCO lets the quotations save through its
  sales section because its sales tab feeds invoices there; Yourrest's ERP quotations import is only on «عروض الأسعار», so hiding that tab
  closes it. GSCO hides the tab bar when one part is left; Yourrest keeps the one tab drawn. Reading the targets stays open in both (the
  results use them): Yourrest's `/api/sales` still carries the targets and the sales to a member whose «نتائج الأداء» or «المستهدفات
  والأوزان» is hidden while another tab needs them.
- **Tested.** `tests/targets-tabs.mjs` (new, default gate, 207 checks: the switches per role, restrict-only and a forged access,
  nothing hidden by default, an old row, the order, the copy, the tab drawn in place of a hidden one from the address and the browser,
  every tab hidden, the shared requests; then the routes on SQLite, each tab, the shared ones, every tab, the screen hidden, a supervisor,
  the audit), `tests/targets-tabs-http.mjs` (new, built release, 134: 401 with no session on every route and on the save, the role
  refusals as before, the administrator only saves, each tab's routes 404 and the others as before, another manager untouched,
  `/api/sales?kpis=1` 200 without the evaluation, 404 once «المبيعات» goes too, 409 stale, the history entries),
  `tests/targets-tabs-browser.mjs` (new, Chromium, 119: the matrix rows and their switches, the save, the supervisor's hub, `?tab=` and the
  remembered tab, every tab hidden and the page gone from the sidebar and the phone's «More», phone 320 and 360, tablet upright and on its
  side, desktop, Arabic and English with no Arabic left but names, nothing scrolling sideways; screenshots); updated because the matrix
  and the hub legitimately changed: `tests/permissions-ui.mjs` (102: the supervisor's and the administrator's rows now include the four
  tab rows, and the new rows' checks) and `tests/targets-performance-ui.mjs` (213: the hub with tabs hidden). A mutation check: taking the
  check out of `POST /api/kpis`, or the page-with-no-tab rule out of `pageHidden`, fails `tests/targets-tabs.mjs`. The release gates
  (`node scripts/gates.mjs --full`, permissions being shared): 101 passed, 1 not stable (`mold-salesmen-http`: «23 hours after the last
  full and nothing changed: nothing sent», 7 sends for 6, a timing check of the products application's salesmen list, nothing of the
  targets page; passed when rerun alone by the gates and once more alone after), 4 skipped (the owner's ERP files); the default gate
  200/200 with TypeScript and ESLint (0 errors; the run counted one warning more than the 160 of the baseline, an unused import of the
  new unit test, removed after: 160 warnings, the unit test passing again); `tests/msa-wording.mjs` passed.

## Leave months do not count against a representative: the customers' comparison over the last three worked months (2026-11-15, not released yet, no migration)

- **Asked.** Item 5 of the GSCO comparison list, approved by the owner: «تمام كمل البند الخامس وارفع لما الفحص يخلص». The item: «الإجازات
  تتحسب في التقييم (GSCO 2.13.50): الأيام اللي المندوب كان فيها في إجازة ما تتحسبش ضده». GSCO 2.13.50 and 2.13.51 (`docs/INACTIVE-MONTHS-AR.md`
  of GSCO 2.13.74): leave and absence are read from the data, nobody types a leave in; GSCO's owner chose «أ», a short leave inside a month counts
  normally with no reduction of the target.
- **What Yourrest already had** (verified in the code before the change): a complete ERP sales file speaks for every representative of its
  uploader's scope over its days (`lib/sales-coverage.ts`, 2026-11-12), so a representative absent from it sold nothing there; a covered month
  with visits and no sale is a real zero, not «غير متاح» (`zeroFill` in `lib/kpis.ts`); «بلا نشاط في هذا الشهر – خارج التقييم» (2026-11-14:
  a representative only, a closed month only, sales known complete, no activity and no confirmed sales document; no score, last in the
  comparison, no points in the export, never a supervisor's or a sales manager's roll-up, nothing averages scores); no target is ever reduced.
- **What it lacked, added now** (`lib/kpi-baseline.ts`, new, pure):
  - **The customers' comparison over the months worked.** «الحفاظ على العملاء الحاليين» and «العملاء المستردون» compared the month with the
    three CALENDAR months before it, a leave month included. They now compare with the last THREE WORKED months (`customerBaseline`),
    looking back twelve months at most: a month the complete sales cover in which the person had no work (a leave, an absence) is skipped; a
    month the complete sales do not cover still stops the comparison (missing data, the month named). 2.13.51: a covered month before the
    person's first worked month (before they joined) is an ordinary month without purchases, so a new representative is compared from their
    second month; «العملاء المستردون» needs, before the three months, a whole complete month and a worked month the complete sales touch or a
    sales document, so for a new representative it starts four months after their first worked month («لا ينطبق» with its reason until then).
    Fewer than three worked months in the twelve: both «لا ينطبق» («لا توجد ثلاثة أشهر عمل فيها المندوب خلال الأشهر الاثني عشر السابقة…»).
    A recovered customer is one who bought before the oldest compared month, bought in none of the compared months and bought this month.
  - **A month worked** (one definition, `workMonthsByMember`, `workedMonths`): an activity of the person (a visit, a call, a follow-up or any
    other contact; its author as every indicator reads it), a customer they added by hand in the app (its record's Riyadh day; never one a
    file or the ERP customers import made: `handAddedDay` of `lib/new-customers.ts`, which «العملاء الجدد» now reads too), or a confirmed sales
    document (a sale or a return, CRM or ERP, from the month's sales and the purchase history). The mark of 2026-11-14 reads the same
    definition (`outOfEvaluation`), so a customer added by hand (GSCO's «أضاف مشروعًا») and a sales document of the purchase history keep a
    month in the evaluation too; nothing else of the mark changed. A team's roll-up worked a month when any of its people did, so a supervisor's
    and a sales manager's comparison skips a month only when the whole team had nothing.
  - **The coverage it needs** (`lib/sales-coverage.ts` `SalesCoverageStatus.lookback`): the 16 months before the month that every
    representative of the scope has wholly covered and those each has at least one covered day of, and the month from which each has a whole
    covered month. The manual confirmation of «بيانات المؤشرات» still covers the month and the three before it; a leave reaching past them
    needs an upload, and that sentence no longer offers the manual confirmation (`CoverageMissing.uploadOnly`). A coverage of the older shape
    (no lookback) keeps its three calendar months.
  - **«أشهر بلا نشاط لم تُحتسب».** When months were skipped, the two indicators carry `baseline: {months, skipped}` and their reason ends with
    «قورن بآخر ثلاثة أشهر عمل فيها: يوليو 2025، سبتمبر 2025 وأكتوبر 2025. أشهر بلا نشاط لم تُحتسب: أغسطس 2025.» (the English built in
    `kpiMetricReason`, so «تصدير التقييم» in English names the months too); the person's page writes under «العملاء والسوق» «أشهر المقارنة: …» and
    «أشهر بلا نشاط لم تُحتسب: …» (`app/kpi-performance.tsx`, `.kpi-baseline-note`).
  - **The representative sees the mark.** «أهدافي» (`GET /api/targets`) now carries `inactive`, decided as the evaluation decides it
    (`ownOutOfEvaluation` in `lib/own-targets-server.ts`: a closed month, no work of theirs, their sales known complete by a complete import
    or by a current «بيانات المؤشرات» confirmation with their customers' codes known); the page writes «بلا نشاط في هذا الشهر – خارج التقييم»
    and «لا توجد في هذا الشهر المغلق زيارات ولا متابعات ولا عملاء أضفتهم ولا مبيعات مؤكدة، ومبيعاته مكتملة (إجازة أو انقطاع). لا يُحتسب الشهر
    عليك في التقييم، ولا يدخل ضمن أشهر المقارنة لمؤشري الحفاظ على العملاء والعملاء المستردين.» Only that yes or no leaves the server; the month
    in progress reads nothing more (it is never marked). The manager's sentence on the person's page and under the comparison now names the
    customers added by hand and says the month is not compared; its title has a line of its own (a phone of 360 px gave it a column one word
    wide).
- **Each indicator and a whole month of leave.** As the evaluated month: out of the evaluation (no score, no points), as since 2026-11-14.
  Inside the period an indicator looks back over: «الحفاظ على العملاء الحاليين» and «العملاء المستردون» skip it (above); «نمو مبيعات الأصناف»
  compares with the previous calendar month as GSCO does, and after a leave month no product has a positive baseline, so it is «لا ينطبق» and
  its 5% leaves the score (unchanged, tested); every other indicator reads the evaluated month only. A leave of part of a month: nothing
  changes (option «أ»).
- **Not changed.** The team target: a supervisor's target still adds up the targets of a representative on leave all month (GSCO deferred
  this to its owner; so does Yourrest). No leave register. No migration (21 tables, `0020_member_permissions.sql` the last).
- **Differences from GSCO.** Fewer than three worked months within twelve, and a new representative's recovered customers, are «لا ينطبق»
  with a reason in Yourrest (GSCO: «بيانات مطلوبة»), because no upload can fill them and Yourrest's earlier decision keeps «لا ينطبق» for
  what has nothing to count; with no work at all yet every month is ordinary (GSCO's code would skip them all; its document says the months
  before the first worked month are ordinary). The months worked come from Yourrest's records (activities and customers added by hand; GSCO
  also counts its projects' stages, which Yourrest has not). The roll-ups of supervisors and sales managers compare their team's customers
  (GSCO compares a supervisor's own), so their months worked are the team's.
- **Tested.** `tests/kpi-leave-months.mjs` (new, default gate, 123 checks: the pure rule, `calculateKpis` with the real coverage, the real
  routes on SQLite, one definition), `tests/kpi-leave-months-http.mjs` (new, built release, 48), `tests/kpi-leave-months-browser.mjs` (new,
  Chromium at 320 and 360 px, a tablet upright and on its side and a desktop, Arabic and English, 98, screenshots); updated, because a
  covered month with neither a contact nor a sales document is now a leave month: `tests/kpi-complete-domain.mjs` (100: a visit in each
  fixture month, an older purchase in the «new customers are not recovered» case, no purchases in the «nothing done» fixture),
  `tests/sales-coverage.mjs` (67: a visit in each fixture month), `tests/kpi-complete-integration.mjs` (114: a visit in February and March);
  `tests/own-targets.mjs` (142) and `tests/namecheap-http.mjs` (384: the own page's keys include `inactive`), `tests/my-targets-ui.mjs`
  (73) and `tests/kpi-performance-evidence-ui.mjs` (119: the new lines); and four release tests the first full gate run stopped, each
  because its fixture had a covered month without any work, which the rule now reads as a leave: `tests/sales-coverage-http.mjs` (68) and
  `tests/sales-coverage-browser.mjs` (86: rep1 visits in M-3; rep2, whose only work is in M, is a new representative, so its recovered target
  is read from its activity targets), `tests/targets-audit-browser.mjs` (122: rep1 sold four months ago and visited in the two months after,
  so the hand count of 64.26 holds), `tests/kpi-evidence-browser.mjs` (87: visits in February and March 2025 after the customer added by
  hand in January 2024). The release gates (`node scripts/gates.mjs`, a full selection because `tests/check-manifest.json` and
  `tests/test-areas.json` changed): the first run stopped on those four and `tests/namecheap-http.mjs` (each failed twice, mended as above);
  the second: 99 passed, 1 not stable (`erp-sales-replace-http`: a 409 on «applied with the agreement» in the pool, passed alone; it passed in
  the first run and nothing of the ERP import changed), 4 skipped (the owner's ERP files); the default gate 199/199 (TypeScript and ESLint
  included: 0 errors, the 160 warnings of the baseline); `tests/msa-wording.mjs` passed.

## Customer detail edits wait for approval: the representative's supervisor, then the sales manager (2026-11-15, not released yet, no migration)

- **Asked.** Item 4 of the GSCO comparison list, approved by the owner: «تمام كمل البند الرابع وارفع لما الفحص يخلص». The item: «تعديل بيانات
  العميل يستنى موافقة (GSCO 2.13.55 + 2.13.73، على المشاريع): المندوب يبعت طلب تعديل، يروح لمشرفه الأول (المشرف من جدول الربط وفعّال)، يوافق أو
  يرفض بسبب، وبعد موافقته يروح لمدير المبيعات. مدير المبيعات ما يبتش والطلب عند المشرف. طلب المشرف وخدمة العملاء والمندوب اللي مالوش مشرف فعّال
  يروحوا لمدير المبيعات على طول. لو المشرف اتوقف والطلب مستنيه، يعدّي لمدير المبيعات. المندوب يلغي في أي مرحلة. الصور الجديدة بتستنى مع الطلب.
  عندك دلوقتي canEditCustomerDetails في lib/access.ts بيسمح بالتعديل المباشر. الحقول اللي اتقفلت بقرار المالك زي كود ERP تفضل مقفولة.» GSCO did
  it on its projects (`lib/crm/project-edit-requests-server.ts`, 2.13.55 and 2.13.73); Yourrest does it on its customers.
- **Before.** `canEditCustomerDetails` (`lib/access.ts`) let a representative (any customer of their regions), a supervisor (their team's
  customers), customer service and its manager (their branch's) save a customer's details directly through `POST /api/crm`.
- **Who edits directly, who sends a request.** The administrator and the sales manager still edit directly (as GSCO's management: its
  sales manager and the owner with «view_all»), and they are the ones who decide. A representative, a supervisor, customer service and
  the customer service manager send a request: their save passes every check a direct edit of the same customer passes as that member
  (the record and its version, the «تعديل» cell of «العملاء», their scope and region, the routing rules, the ERP code, the place inside the
  Kingdom, the schema), and only the write waits. Who may send is unchanged (`canEditCustomerDetails` is untouched); a supervisor with «عرض
  بيانات الفريق بالكامل» still sends a request (that switch widens reading only, unlike GSCO's «view_all»).
- **Routing** (`lib/customer-edit-requests.ts`, read live). A representative whose account names a supervisor (`crm_members.supervisor_id`)
  who is an active member with the supervisor role → that supervisor, who approves (it moves on) or rejects with a reason (it ends); then the
  sales manager or the administrator, within their regions and with «تعديل» on «العملاء», approves (it applies) or rejects with a reason.
  A representative linked to a sales manager, to the administrator, to nobody, or to an inactive supervisor; a supervisor; customer
  service and its manager → straight to the sales manager. While a request is with the supervisor, the sales manager and the administrator
  are refused (403 «الطلب عند مشرف المندوب. يصل إلى مدير المبيعات بعد موافقة المشرف.») and do not see it in their list (the customer's details
  show it to them, waiting for the supervisor). Where it stands is evaluated live, at each read and in each commit's own condition, so no job
  runs: a supervisor deactivated, unlinked from the representative, or a representative who is no longer a representative while it waits →
  it is with the sales manager at once (and back with the supervisor if they are reactivated before the sales manager decides); linked to
  another active supervisor → that supervisor.
- **What a request holds** (`customerEditProposal`). Only the fields the sender changed, beside what each held then: name, region,
  classification, type, status, category, mobile, contact, city, location (with its point and how it was captured), short national
  address, address, the two contacts' names, mobiles and mails, the sheet's machine count and types, supplier, notes. Never the ERP code
  (owner's rule of 2026-11-12: a different, emptied or typed code is 403 «كود ERP لا يُكتب ولا يُعدَّل يدويًا…» before any request exists),
  the responsible member or branch (403 «لا يمكنك تغيير مسؤول العميل أو فرعه»), the import markers or any forged field (the server builds
  the request from its own list; approval applies only that list). Nothing changed → 400 «لم يتغير شيء في بيانات العميل.».
- **Approve, reject, cancel** (`POST /api/crm {action:'customer-edit', decision, id, note?}`). The final approval runs the ordinary
  customer save of `/api/crm` as the approver, with the request's fields over the customer as it is now and the routing left as stored, in
  one transaction with the request's end: every rule of a direct edit applies again, and if either fails neither happens. A rejection
  needs a reason (2 visible characters at least, invisible direction marks do not count, at most 1000; Arabic digits kept as written) that
  the sender reads with who rejected. The sender cancels at either step («إلغاء الطلب»); nobody else does. A decided request answers 409
  «تم البت في هذا الطلب بالفعل.».
- **Conflicts.** One request waits per customer: another edit of the sender → 409 «لديك طلب تعديل بانتظار الموافقة على هذا العميل. ألغِه من
  بيانات العميل ثم أرسل التعديل الجديد.», of someone else → 409 «يوجد طلب تعديل آخر على هذا العميل بانتظار الموافقة.» (GSCO's rule: what the
  sales manager reads is what they approve). A field of the request changed by someone after it was sent marks it stale and its approval is
  refused at either step (409 «تغيرت البيانات نفسها بعد إرسال الطلب. ارفض الطلب ليعيد صاحبه إرساله على البيانات الحالية.»), never a silent
  overwrite; another field changed meanwhile (or the customer's version moved by a visit) keeps both changes. The sales manager and the
  administrator may still edit the customer directly while a request waits.
- **Repeated sends and offline.** The form makes a key when it opens (`editKey`); the same send again after a lost answer is the same
  request (`alreadySaved`), and so is the same edit without its key (a page loaded before the release) while it waits. A customer edit was
  never saved on the device and still is not: `lib/offline-submit.ts` queues only new customers and new visits/contacts, and the server
  refuses an edit carrying a device capture (400 «هذا الإجراء يتطلب اتصالًا مباشرًا.»), so no edit can arrive later as a direct write.
- **Photos.** A Yourrest customer has no photos (the form and `crm_records` customer data hold none; the only uploads are a visit's
  competitor quotations, `crm_visit_files`), so there is nothing to hold with a request.
- **Where it shows.** On the first screen of every member (`app/team-home.tsx`, right under the red card, or alone), the card «طلبات تعديل بيانات العملاء»
  (`app/customer-edit-requests.tsx`): what they may decide now (with the count) and their own requests, waiting or answered in the last 14
  days; in the customer's details («البيانات»), «طلبات تعديل بيانات العميل»: every request of that customer for the sales manager and the
  administrator, the reader's own and, for a supervisor, their representatives' waiting for them. Each shows the sender and the moment,
  where it waits («بانتظار موافقة المشرف» / «بانتظار موافقة مدير المبيعات»), who approved it as supervisor, every field «الحالي» → «المطلوب»,
  the stale notice, the reason of a rejection, «موافقة», «رفض» (with «سبب الرفض», dictation included), «إلغاء الطلب». Asked when shown,
  every 5 minutes on the first screen, on coming back (at most once a minute) and after a send or a decision; never offline. The form tells
  a sender «لا يظهر تعديلك على العميل قبل الموافقة عليه…» and its button reads «إرسال التعديل للموافقة»; the toast says where it went
  («تم إرسال التعديل إلى مشرفك للموافقة» / «…إلى مدير المبيعات للموافقة»). English pairs throughout (new server messages in
  `lib/locales/en.json`, keys only added).
- **Storage, no migration (21).** `crm_audit`, append-only, as «المحذوفات» keeps its deletions: the request row (id
  `customer-edit:<sender>:<key>`, action `customer-edit:request`, record the customer, detail the held fields), the supervisor's approval
  (`customer-edit-supervisor:<id>`) and the end (`customer-edit-decision:<id>`, one by its primary key: approved, rejected with the reason,
  cancelled). These rows are the audit log of request, supervisor approval, approval (beside the save's own «تعديل» entry by the approver),
  rejection and cancellation; «سجل التغييرات» of the customer shows them as words with the customer's name, never the fields or the reason.
  The list reads only the customers its requests name. Going back to the previous release leaves the rows unread (its history tab would
  show them raw), and a request waiting then applies nothing.
- **Not changed.** Creating a customer (a representative's, offline included), the ERP customers import, the automatic place from a first
  visit (`lib/visit-place-server.ts`, only when the customer has none), the visit plan pointers, customer service's assignment, machines.
- **Deviations from GSCO.** A supervisor with «عرض بيانات الفريق بالكامل» is not management here (Yourrest's switch widens reading only);
  a request of a sender who is no longer a representative goes to the sales manager (GSCO checks only the link); a reassignment of the
  customer does not end a waiting request (GSCO ends it because there the right to edit follows the owner; a Yourrest representative edits
  any customer of their regions); no photos (none on a Yourrest customer); a request is held in crm_audit, not a table of its own (no
  migration); the supervisor's step is decided by the supervisor the representative's account names now (GSCO: any supervisor linked to
  them in its mapping table). As GSCO: the supervisor sees their representative's request whatever the customer's region.
- **Tests.** `tests/customer-edit-requests.mjs` (new, default gate, 337 checks: every role, both steps, cancel at each step, the sales manager
  and the administrator refused at the supervisor's step, the reason (empty, spaces, invisible marks, one letter, over 1000, Arabic digits),
  locked and forged fields, a repeated send, two sends at once, stale and not stale, the approval and its end in one transaction, a
  concurrent change, regions and the «تعديل» cell, an offline edit, a deleted customer, the history), `tests/customer-edit-requests-http.mjs`
  (new, built release, 138), `tests/customer-edit-requests-browser.mjs` (new, Chromium: 320 and 360 phones with the Android app emulated, a
  tablet upright and on its side, a computer, Arabic and English with no Arabic left but the data, 53 checks, screenshots);
  `tests/server-authorization.mjs` (the new route and the decisions in the role matrix, 737). Updated because a direct edit by these roles is
  now a request (each now sends, has it approved, then checks the customer as before): `customer-detail-edit-access` (309), `crm-regression`
  (376), `customer-identities` (91), `rep-customer-create` (290), `rep-no-edit` (76), `role-scope` (179), `security-customer-code` (86),
  `customer-last-purchase-http` (18), `namecheap-http` (383), `permissions-http` (143), `customer-edit-browser` (91), `ui-refresh-browser`
  (115). The release gates (`node scripts/gates.mjs`, a full selection: shared files changed): 96 passed, 2 not stable (`customer-edit-browser`
  failed once in the pool at an unchanged step of customer service opening «فرصة جديدة», then passed alone and in two more runs alone;
  `service-queue-browser`, not stable in earlier runs too), 4 skipped (the owner's ERP files); the default gate 198/198 (TypeScript and
  ESLint: 0 errors, the 160 warnings of the baseline); `tests/msa-wording.mjs` passed.
- **Release.** No migration (21), no APK change. `lib/locales/en.json` only gains keys.

## The Android app update is mandatory: the oldest app allowed is always the newest release (2026-11-15, not released yet, no migration)

- **Found by the full gate run.** `trash-own-browser` failed twice: with the «المزيد» sheet open, the whole page behind it was blank. Radix marks
  every sibling of an open dialog `aria-hidden="true"`, and the held workspace was hidden by the rule `.gate-workspace[aria-hidden=true]`, so any
  dialog of an up-to-date app blanked the page. The workspace is now hidden by its own mark (`data-holding="yes"`); `tests/tracking-gate-browser.mjs`
  checks that an open sheet leaves the page behind it visible, and `tracking-gate-ui` the held workspace's mark.
- **Asked.** The owner, on item 3 of the GSCO comparison list: «كمل البند التالت». The item: «تحديث التطبيق يبقى إجباري (قاعدة المالك في GSCO
  من 2026-10-31): أقل نسخة مسموحة = النسخة الجديدة دايمًا، ومفيش «يمكنك متابعة عملك».» GSCO's rule (web 2.13.40, 2026-10-31): «مفيش حاجة اسمها
  تحديث اختياري»: every published Android release is required of every user, whatever the role, with no «لاحقًا».
- **Before.** Since 2026-10-14 the gate held an app older than the release bundled with the page, but only for the roles whose route tracker
  reads the phone (representative, supervisor, manager, administrator): customer service and its manager were never held. It held offline
  too, where nothing can be downloaded. The update panel said «يمكنك متابعة عملك» (offline) and «يمكنك استخدام التطبيق أثناء التنزيل»,
  `lib/app-update-release.json` named no minimum, and the workspace was unmounted under the screen.
- **The rule** (`lib/app-update.ts`). The manifest carries `minimumVersionCode`, equal to `versionCode` (13): the publisher writes it so
  (`scripts/publish-android-release.mjs`), `parseAppRelease` reads it as `versionCode` whatever a manifest says (so no release can lower
  it), and `tests/app-update-release.mjs` checks the served file. Every check of the update controller, whatever the app's update protocol,
  now reads the served release (`GET /api/app-update`) and asks for its APK with a `HEAD` (no redirect followed, as the app's downloader);
  it runs when the app opens, returns to the front, reconnects, when the bridge announces itself, and every 15 minutes (GSCO's interval).
  `enforcedRequirement` is that release only while the device is online, the release was read and its APK answers (a 405 or 501 to `HEAD`
  is not taken for a missing file); `appUpdateRequired` holds the app when its exact installed code (the update bridge, apps 1.0.10 and
  later) or, without one, its version name (the old `status`, or the tracking service's `appVersion`) is older. Unknown or malformed versions
  are never judged; the same or a newer app is never held.
- **The screen** (`app/tracking-gate.tsx` `UpdateRequiredScreen`, before any tracking check, every role): «حدّث تطبيق يورست للمتابعة» /
  "Update the Yourrest app to continue"; «الإصدار المثبت على هاتفك X أقدم من الإصدار المطلوب Y. كل إصدار جديد من التطبيق إلزامي لجميع
  المستخدمين، ولا يمكن استخدام النظام قبل التحديث. ثبّت التحديث فوق التطبيق الحالي دون حذفه؛ يبقى حسابك والإدخالات المحفوظة على الهاتف.»;
  the update panel (`app/app-update.tsx`, `inGate`: «تحديث التطبيق», the download progress, «تثبيت التحديث», «إعادة المحاولة», «ثبّت عن
  طريق المتصفح» with its steps, or the served file for apps without the update protocol); the entries waiting on the phone with «رفع الآن»;
  «ما الجديد في هذا الإصدار» with the required release's notes; both versions; the account and «تسجيل الخروج». No continue, later, skip or
  close; Escape does nothing. In the panel, the title is «تحديث التطبيق مطلوب» / "App update required" and no phase says the person may keep
  working. The panel names the required version (and its browser APK) even when the app's own downloader has not learned the release.
- **What a representative sees.** Online with an older app: the screen, at once and for every role. The download fails (the network drops
  mid-file, the phone is full, the file is corrupt): still the screen, with «لم يكتمل التحديث. تأكد من الاتصال بالإنترنت ومن وجود مساحة
  كافية في الهاتف، ثم أعد المحاولة؛ بياناتك المحفوظة باقية.», «إعادة المحاولة» and «ثبّت عن طريق المتصفح» (as GSCO: retry and the manual
  file). No network: not held (the update cannot proceed); the workspace with the panel «هذا التحديث إلزامي، ويمكن تنزيله عند عودة الاتصال
  بالإنترنت. بعد عودة الاتصال لا يمكن استخدام النظام قبل التحديث.»; back online, held again. The APK not answering on the site (404, a
  server error, a redirect) or the release not readable: not held; «هذا التحديث إلزامي، لكن ملف التحديث غير متاح على الموقع الآن. سيُعاد
  التحقق تلقائيًا.»; held again once the file answers. On the sign-in page the panel shows the same wording (as GSCO, the hold starts after
  signing in). An ordinary browser on a computer or a phone, and an app at the published version or newer, see nothing.
- **Data.** Under the screen the workspace stays mounted and hidden (`display:none`, `aria-hidden`; never remounted, so open forms and their
  text survive), and the workspace's own sending of the phone's queue (`app/crm-app.tsx`: on loading, every 30 seconds, on reconnecting and
  on returning to the app) keeps running; the screen counts the waiting entries and those that need review («تبقى محفوظة على الهاتف لتراجعها
  بعد التحديث»), and «رفع الآن» asks for the sending sooner. The native route queue is the Android service's and is untouched. If a dialog of
  the workspace is open (a visit, a customer, the save status, the phone's menus) when the requirement is found, the screen waits until it is
  saved or closed, so no form is taken from under the person and Radix's focus trap never holds the screen's buttons; once the screen holds
  the app, a dialog opened under it afterwards (a notification's request) does not lift it, and the screen stays tappable over Radix's modal
  layer (`pointer-events:auto`). A representative whose
  app cannot track at all (too old for the work-hours schedule) still has no workspace, as before.
- **Server.** Nothing is enforced on the server: no request from the app carries its version (the user agent's `YourrestCRM-Android/1` is a
  fixed protocol mark; the route service's requests carry none), and refusing an older app's calls would stop its route points and the
  queued entries from reaching the server. GSCO enforces nothing on its server either.
- **Deviations from GSCO.** The minimum is read as the published version whatever the manifest writes (GSCO publishes `--minimum-version-code
  N` and could publish a lower one); the requirement also needs the APK to answer a `HEAD` on the site (GSCO's server withholds its manifest
  until the APK is verified; Yourrest serves the manifest unconditionally, so the phone checks the file); the screen waits for an open dialog
  instead of covering it (GSCO overlays with an interaction shield); an app that reports only a version name is judged by it (GSCO judges
  only apps that report an exact code); the sign-in page shows the panel and does not hold (as GSCO).
- **Tests.** `tests/app-update-ui.mjs` (default gate, 233 checks: the minimum, the requirement with older, same, newer, unknown, offline,
  unread and unreachable cases for both protocols, the 15-minute check, no «keep working» or «later» in any phase in both languages, the
  panel in the screen), `tests/tracking-gate.mjs` (86) and `tests/tracking-gate-ui.mjs` (106: every role held, the workspace kept hidden,
  the cases that hold nobody, English); `tests/app-update-release.mjs` (built release, 21: `minimumVersionCode` equals `versionCode`, `HEAD` of
  the APK 200 and of a missing one 404); `tests/app-update-browser.mjs` (Chromium, 68: the panel's wording, an unreachable APK) and
  `tests/tracking-gate-browser.mjs` (built release in Chromium with the Android app emulated and its update protocol, 170: the administrator
  in Arabic and English at 360 px, a failed download and its retry, the install, offline and an unreachable APK holding nobody, an open
  dialog waited for and a later one not lifting the screen, a queued customer sent while held, customer service and a representative held,
  the same and a newer version, a computer and a phone browser untouched). The release gates (`node scripts/gates.mjs`, selective:
  app-update-android, tracking, deploy-packaging): 20 passed, 1 not stable (`tracking-gate-browser` failed once in the pool at the existing
  check «the app asked the phone for its state» of its part 5, then passed alone, and again in three parallel runs), 3 skipped (the owner's
  ERP files); the default gate 197/197 (TypeScript and ESLint: 0 errors, the 160 warnings of the baseline; the touched files have none);
  `tests/msa-wording.mjs` passed.
- **Release.** No APK change (the installed 1.0.12 web view runs it), no migration (21). `public/app-update.json` mirrors the manifest.

## «نسبة الزيارات الفعالة» from the supervisor's evaluation (2026-11-15, not released yet, no migration)

- **Asked.** The owner approved it in the GSCO conversation on 2026-11-15: «موافق تمام». The effective-visits indicator is now computed
  from the supervisor's evaluation of each visit, not from the opportunity's state. It replaces the rule shipped on 2026-11-14 («البيع
  يتحسب فعالة»: a visit was effective unless its customer's current stage was «تم الفقد», a won customer's visit counting as effective).
- **The rule** (`lib/kpis.ts`: `visitEvaluations`, `positiveReason`, `positiveUnratedReason`, `kpiVisits`). The visits are the same set
  as before: activities of type «زيارة» (a visit, or a follow-up recorded as one) of the month up to its cutoff, by the person (performed
  by, else responsible) or by the team of a roll-up; `kpiVisits` now holds that filter for «الزيارات الفعلية» and this indicator alike.
  Only how each visit counts changed. Each is read exactly as the notes read it, with no second definition: `entryRatingOf(saleEntry(visit),
  chosen)` of `lib/supervisor-reviews.ts`, where `chosen` is the `after.rating` of the audit row of the note's last save
  (`chosenEntryRatings` in `lib/supervisor-reviews-server.ts`, the notes' own `chosenRatingSql` through `crm_daily_entry_reviews.mutation_id`).
  «فعالة» or «إيجابية» is effective. «إيجابية» is derived, never stored: the visit whose own activity records the sale (stage «تم الفوز», or
  the follow-up says «نعم، تحوّل إلى فاتورة», never a lost one), effective even with no note. «سلبية» is not effective. A visit with no note,
  or a note saved before the evaluation existed (no `rating` in its audit row), or a stored «إيجابية» on a visit that is no longer a sale,
  is left out of the ratio and counted as waiting. Score = effective ÷ evaluated, the reason: «الزيارات التي قيّمها المشرف «فعالة» أو
  «إيجابية» (تم البيع) ÷ الزيارات التي قيّمها. زيارات بانتظار تقييم المشرف: N.» With visits and none evaluated, the indicator is missing
  (no score and no figures, «بيانات مطلوبة», named under «بيانات ناقصة», its 2% left out of the score from the data there is, as missing
  data has been since 2026-11-14, never a zero): «لم يقيّم المشرف زيارات هذا الشهر بعد. زيارات بانتظار تقييم المشرف: N.» With no visit
  at all it stays «لا ينطبق». The metric carries `waiting` (the visits not evaluated yet). An evaluation changed later counts as it is now
  (the last save). Who wrote the note does not matter (a supervisor, a sales manager or the administrator), and a visit keeps its
  evaluation when its representative moves to another team; who may write one is unchanged (a supervisor of another team is refused, 403).
- **Readers checked.** The indicator's card and its «طريقة الحساب» / «البيانات المطلوبة / طريقة الحساب» (`app/kpi-performance.tsx`, no code
  change: the source, the score, the figures and the reason come from the server), the comparison table, the overview cards, the summary
  card of the targets hub and the yellow notice (through `kpiSummary`: a missing indicator is named and leaves its weight out), «تصدير
  التقييم» (`lib/targets-export.ts`, no code change: an empty score and points while missing, the reason line with the waiting count, in
  English too). English: two patterns in `lib/locales/en.json` («... Visits awaiting the supervisor's rating: {0}.»); the old reason's key
  is kept, unused, so the dictionary only gains keys. `lib/supervisor-reviews.ts` no longer says the evaluation feeds no KPI, and the guard
  of `tests/supervisor-reviews-complete.mjs` now checks the KPI reads it through `lib/supervisor-reviews*.ts` only.
- **Finished months.** Nothing freezes KPI results in Yourrest: only a finished month's targets are locked (`lib/targets.ts`
  `targetMonthClosed`, administrator only); every month's indicators are recomputed live from the current data on each read
  (`GET /api/sales?kpis=1`, no stored result). So the new rule applies to earlier months as soon as it is released: their visits carry no
  evaluation (it exists since this morning's release), so their «نسبة الزيارات الفعالة» shows «بيانات مطلوبة» with all their visits
  waiting, and their overall score is computed without that 2% («غير مكتمل»), until a reviewer evaluates them (a note on an earlier day's
  visit counts for that month). Nothing is lost: going back to the previous code brings the old figures back.
- **Deviations.** None from the four GSCO cases. GSCO 2.13.74 (the copy here) predates the change, so the code follows the owner's text and
  GSCO's cases, not GSCO's source. Zero visits stays «لا ينطبق» (not missing), as every count indicator does.
- **Tested.** `tests/kpi-effective-visits.mjs` (new, default gate, 89 checks: GSCO's four cases, an evaluation changed later, an old note
  without one, a supervisor of another team, a member moved to another team, calls and other months, the export and English, the real
  routes on a migrated SQLite, a closed month recomputed live, one definition), `tests/kpi-effective-visits-http.mjs` (new, built release,
  58), `tests/kpi-effective-visits-browser.mjs` (new, Chromium at 360 px Arabic and English and a desktop, 20, screenshots); updated
  `tests/kpi-complete-domain.mjs` (100: yesterday's rule replaced) and `tests/supervisor-reviews-complete.mjs` (173: the guard). The
  release gates (`node scripts/gates.mjs`, a full selection because `tests/check-manifest.json` and `tests/test-areas.json` changed): 91
  passed, 1 flaky (`service-queue-browser`, passed alone; flaky in earlier runs too), 4 skipped (the owner's ERP files); the default gate
  195/195 (TypeScript and ESLint included: 0 errors, the 160 warnings of the baseline; the touched files have none); `tests/msa-wording.mjs`
  passed.
## The supervisor's red card, and the result required on a new opportunity (2026-11-15, not released yet, no migration)

- **Asked.** Two changes the owner asked for in the GSCO conversation, relayed for Yourrest: «عايز يبان للمشرف كارد لونه احمر بزيارات ومتابعات بلا
  نتيجة او اجراء فى عدد اللى لسه مخدش اجراء ولما يضغط عليه يروح ليهم», and «هل يمكن تسجيل فرصة بدون نتيجة» then «خليها إجبارية والاجراء القادم».
- **1. The red card «زيارات ومتابعات بلا نتيجة أو إجراء»** (`app/review-pending.tsx`, `GET /api/reviews/pending`, `lib/supervisor-reviews*.ts`
  `ReviewPending`, `reviewPending`). At the very top of the first screen (`app/team-home.tsx`, before «عملاء واقفين» and «فريقي اليوم») of a
  supervisor or a sales manager while «تقرير يوم المندوب» is theirs; never the administrator, a representative or customer service. The title
  with the total of the last 7 Riyadh days (today and the six before, each day from 00:00), then one line per representative and day (the
  name, «اليوم», «أمس» or the weekday and date, the count), 8 at most and «وأيام أخرى: N» for the other lines; nothing while nothing waits.
  A line opens the day report on that representative and that day (a one-shot handoff `{memberId, date}` in `app/crm-app.tsx`, read by
  `app/journey-report.tsx` as its first day); a press anywhere else on the card opens the newest line. Asked when the screen opens, every 5
  minutes in front and on coming back (at most once a minute), never offline.
- **The count is the day report's own.** Yourrest's day report had no «بلا مراجعة» number, so the card counts exactly what the reader's
  own day report offers «إضافة نتيجة وإجراء» on and has no note: the same activities (`reportActivitiesOn`, one pass over the 7 days, of
  which `reportActivities` is now one day) and the same rule (`reviewableOf`, now also behind `GET /api/reviews` `reviewable`: a reviewer
  role with «إضافة» on «تقرير يوم المندوب» not switched off, never the reader's own work, the team as the role defines it, never widened by
  «عرض بيانات الفريق بالكامل»), restricted to representatives (GSCO counted representatives only; a sales manager's day report also lets
  them note a supervisor's own visits, which the card leaves out). A note saved by anyone takes its visit off at once; a deleted visit
  leaves; a representative moved to another supervisor moves with their work.
- **The route** answers 401 without a session, 403 to customer service, a representative and the administrator («بطاقة الزيارات والمتابعات
  بلا نتيجة أو إجراء متاحة للمشرف ومدير المبيعات فقط.»), 404 with «تقرير يوم المندوب» hidden; names, days and counts only; no-store.
- **Colours:** the theme's own `--destructive` (light #b52d44, dark #ffa5b9) mixed with the card, as `.erp-import-problems`; dark text on
  the pink of the dark theme (`app/review-pending.css`).
- **2. A new opportunity needs its result and next step** (`lib/opportunity-entry.ts`). In Yourrest an opportunity is registered as a new
  visit or contact on a customer: the screens' «add opportunity» opens «زيارة جديدة» (`start('opportunity')`, `onAddOpportunity`), saved by
  `POST /api/visits` (which may write the customer's mold request, kind `opportunity`, beside it), and customer service's «فرصة جديدة» (or a
  further contact on its open request), `POST /api/customer-service`. Both now need «نتيجة الزيارة» (or «نتيجة التواصل» for a call or another
  contact, and always for customer service, whose words are the contact's), at least 3 letters once trimmed (a follow-up's own rule), the
  next action and the follow-up date: «اكتب نتيجة الزيارة قبل حفظ الفرصة (3 أحرف على الأقل).», «اكتب نتيجة التواصل قبل حفظ الفرصة (3 أحرف على
  الأقل).», «اكتب الإجراء القادم قبل حفظ الفرصة.», «حدد موعد المتابعة قبل حفظ الفرصة.» (English pairs in `lib/locales/en.json`).
- **In the form** (`app/customer-visits.tsx`, `app/visit-fields.tsx`, `app/voice-field.tsx` `problem`): the words stand under each field in
  the theme's red, the first is focused, nothing is sent, each leaves as its field is filled. The result list and the two next-step fields
  of a new visit no longer rely on the browser's own check (a hidden native select showed it nowhere useful). Before, the form already asked
  for them through that check and `/api/visits` asked for the next step but not the result.
- **On the server, so the device's queue meets it too:** an entry saved without a network by an earlier page and lacking its result comes
  back «تحتاج مراجعة» with the message; «حالة الحفظ» (`app/offline-status.tsx` `CompleteOfflineEntry`, `lib/offline-submit.ts`
  `completeOfflineEntry`) asks only the missing fields with the form's own choices, and the same entry (its key, the moment it was recorded
  on the device, its place and timing) is sent again and saved once.
- **Not asked:** editing a saved visit or registration (an ended visit emptied of its result keeps its earlier «سجّل نتيجة الزيارة قبل
  إنهائها»), executing a follow-up (its own rule), and every import: none of them creates a visit or an opportunity (the ERP and Excel
  imports write customers, machines, quotations, sales and collections), and a restoration from «المحذوفات» puts back what was deleted. The
  older generic routes (`/api/crm` visits of the earlier kind, `/api/followups`) are not used by any screen and are unchanged. Unlike GSCO,
  no imported row needs a fixed note, since nothing imported is an opportunity here.
- **Tested.** `tests/review-pending.mjs` and `tests/opportunity-entry.mjs` (default gate, in-memory SQLite, the clock fixed),
  `tests/review-pending-http.mjs` and `tests/opportunity-entry-http.mjs` (built release), `tests/review-pending-browser.mjs` and
  `tests/opportunity-entry-browser.mjs` (Chromium at 360 px and a computer, Arabic, English, dark, the Android app emulator); updated:
  `tests/server-authorization.mjs` (the route in the role matrix and with the screen hidden).

## The supervisor's review completed: the evaluation, the earlier notes, «تقرير مراجعاتي», the notice of a new note, «قرأت» on each note (2026-11-15, not released yet, no migration)

- **Asked.** The owner approved five additions relayed from the GSCO conversation («كمل البند التاني»), as GSCO did them in 2.13.66,
  2.13.67 and 2.13.71 (`lib/crm/daily-entry-review*.ts`, `review-inbox*.ts`, `opportunity-reviews.ts`, `components/crm/supervisor-notes.tsx`
  there), adapted to Yourrest's records, scope and audit table.
- **1. The evaluation** (`lib/supervisor-reviews.ts`: `CHOSEN_RATINGS`, `RATING_TEXT`, `saleEntry`, `saleEntrySql`, `entryRatingOf`). Beside
  «النتيجة» and «الإجراء المطلوب», every note on a visit or contact carries «فعالة» or «سلبية», required (`POST /api/reviews` `rating`,
  400 «اختر تقييم الزيارة أو التواصل: فعالة أو سلبية.» without it; «إيجابية» cannot be chosen). The visit or contact that records the sale is
  «إيجابية» by itself and asks nothing: its stage is «تم الفوز» or the follow-up says «نعم، تحوّل إلى فاتورة», and it is not lost (GSCO's
  `saleActivitySql`). No new column: the choice is the `after.rating` of the note's own audit row (`crm_daily_entry_reviews.mutation_id` ->
  `crm_audit.id`), and «إيجابية» is read from the activity as it is now, so a note written before has no evaluation unless its visit is the
  sale (as in GSCO). A whole-day note has none. `GET /api/reviews` adds `sales` (the report's sale activities) and `rating` on each note; the
  card's items carry `rating`. The form shows two 44 px choices, or «إيجابية · تلقائي: تم البيع»; the saved note, the card, the earlier
  notes and the report show a coloured pill (green, blue, red). **KPIs unchanged:** GSCO's evaluation does not feed its KPI (its «نسبة
  الزيارات الفعالة» counts visits by the opportunity's stage), and `lib/kpis.ts` reads nothing of it (a test guards that).
- **2. «ملاحظات المشرف السابقة»** (`GET /api/reviews/customer?customerId=`, `customerNotes`; `CustomerReviewNotes`): read-only, newest visit
  first, 20 at most (`more`), three shown and «عرض كل الملاحظات». On «تنفيذ المتابعة» (`app/customer-followups.tsx`, a new follow-up) and on
  the customer's details, tab «سجل الزيارات» (`app/crm-app.tsx`). Who sees what: a representative the notes on their own visits and
  contacts only (another representative of the same region sees none of them); a reviewer also those of their team as the role defines it
  (never widened by «عرض بيانات الفريق بالكامل», as in the day report), within their regions, and only while «تقرير يوم المندوب» is theirs
  (the same notes `GET /api/reviews` gives them); customer service, another region and an unknown customer 404. Reading them is not «قرأت». Not offline, nothing shown on a failure.
- **3. «تقرير مراجعاتي»** (`GET /api/reviews/made?date=&reviewerId=`, `reviewsMade`, `reviewerChoices`; `ReviewsMadeReport` in a second tab
  of «تقرير يوم المندوب», `app/journey-report.tsx`). What a reviewer wrote on one Riyadh day (today by default, a date picker), read from the
  audit rows of their saves (found by the primary key's prefix `review-entry:<reviewer>:` / `review-day:<reviewer>:`), the last save of that
  day for each visit or day, in the order first saved: the member, the customer, the type, what the representative recorded, the
  evaluation, the result, the required action and whether that version was read; then the whole-day notes. Counts at the top (notes, team
  members, «إيجابية», «فعالة», «سلبية», without evaluation when any, read, not read, day reviews). Who: a supervisor their own only (even
  with «عرض بيانات الفريق بالكامل»); a sales manager their own or a supervisor of their scope; the administrator any reviewer; a
  representative and customer service 403, the screen hidden 404. Every note is limited to what the reader's own day report would show (a visit of
  their team still there, the team never widened by «عرض بيانات الفريق بالكامل»; a deleted one is left out). Nothing new is opened: the same notes were readable day by day through `GET /api/reviews`.
- **4. The notice of a new note** (`reviewNoticeStep`, `reviewNoticeText`, `hiddenPageMayAsk`; `ReviewInboxCard`). The installed Android app
  (1.0.12) has no feed of notes: its background poller (`ServiceAlerts`) reads `/api/service-queue/alerts` only and names every notice from
  a fixed list of customer-service titles, so it cannot carry a supervisor's note honestly. Without a new APK the page does what a page can:
  when the card's check (on opening, every 5 minutes, on returning to the page) finds a note this browser has not shown, it shows the
  message «ملاحظة جديدة من المشرف» (or «ملاحظات جديدة من المشرف (n)») with the writer and what it is on and «عرض», marks the note «جديدة»
  in the card, and, where the browser allows (never inside the app's web view), shows the device's own notification through the service
  worker or the page (`public/sw.js` brings the CRM to the front on a tap). Never the note's words in either (a locked screen may show
  them). What was shown is remembered per member in `localStorage` (200 keys), so a note is announced once across reloads and tabs; a
  browser that remembers nothing announces nothing on its first check (the card is there). The card offers «تنبيهي بالملاحظات الجديدة على
  هذا الجهاز» while the browser has not been asked; a page in the background asks only when that notification is allowed, once an interval
  for all tabs. **What it cannot do:** tell a representative whose app is closed or in the background (Android pauses the web view): that
  needs a new APK (1.0.13, versionCode 14) with a poller like GSCO's 1.4.7 (`/api/crm/review-alerts` there), built and signed with the
  company's key and published through `scripts/publish-android-release.mjs` and `lib/app-update-release.json`, which cannot be done here.
- **5. «قرأت» on each note** (GSCO 2.13.67). «قرأت الكل» is gone; `POST /api/review-inbox` takes one note and answers 400 «اضغط «قرأت» على
  كل ملاحظة وحدها.» to a request naming more (a page loaded before), writing nothing. Reads already saved keep their rows and their «تمت
  القراءة».
- **Also.** The moment of a note shows in the Arabic order (`<time dir="auto">`; a forced left-to-right put the day after the time). The tab
  row, the choices and the report work at 360 px with no sideways scroll.
- **Deviations from GSCO.** The evaluation is chosen on Yourrest's visits and contacts (GSCO: opportunities' activities); the earlier notes
  are per customer (Yourrest has no opportunity screen for a representative) and limited to the reader's own work or team, where GSCO
  shows all of an opportunity's notes to whoever opens it; the reviews report is a tab of its own with a date and, for the administrator and
  a sales manager, a reviewer, where GSCO shows the reviewer's notes inside their own day report; no Android feed (above).
- **Old pages** loaded before the update send no evaluation and are told to choose one; their «قرأت الكل» is refused with its reason;
  everything else answers as before (the day report's shape is unchanged).
- **Tested.** `tests/supervisor-reviews-complete.mjs` (173 checks), `tests/supervisor-reviews-complete-http.mjs` (84, built release),
  `tests/supervisor-reviews-complete-browser.mjs` (76, Chromium at 360 px and a desktop, Arabic and English, the Android app
  emulator); updated: `tests/supervisor-reviews.mjs`, `-http.mjs`, `-browser.mjs`, `tests/team-today-http.mjs`, `tests/permissions-http.mjs`
  (notes carry an evaluation) and `tests/server-authorization.mjs` (the two routes in the role matrix and with the screen hidden). The
  release gates (`node scripts/gates.mjs`, a full selection because shared files changed): 89 passed, 1 flaky (`service-queue-browser`,
  «the case is delegated to the representative (timed out)», passed alone; flaky in earlier runs too), 4 skipped (the owner's ERP files);
  the default gate 194/194, ESLint 0 errors and 160 warnings (the touched files keep their earlier counts).

## ERP sales: a corrected report replaces what is saved for its period (2026-11-14, not released yet, no migration)

- **Asked.** The owner, 2026-11-14: a sales report the ERP corrected (an invoice billed wrong, moved to another representative or
  cancelled) must win when it is uploaded again, instead of being refused as «رقم المستند محفوظ بمحتوى أو ربط مختلف؛ لن يتم استبداله». The
  rule: the ERP invoices file always holds every representative for its period, «دايمًا كامل». The reference is GSCO CRM 2.13.45 and
  2.13.74 (its page sends `whole_company:true`; a representative with sales stored in the file's period and no invoice in it gets zero).
- **Who it applies to** (`lib/erp-sales-server.ts`, `ERP_REPLACE`): the page sends `wholeCompany:true` with every preview and commit
  (`app/erp-sales-import.tsx`); the server applies it only for an importer who reaches every active representative and is not a supervisor
  (the sales manager, the administrator). A supervisor, a regional manager short of a representative, and any caller without the flag
  import exactly as before: a changed invoice is a conflict and nothing is removed. The flag is part of the signed request (a commit must
  carry its preview's flag); without it the request text is unchanged.
- **The period** is the file's first and last invoice date (`lib/sales-coverage.ts` `filePeriod`), as GSCO takes it: the file says
  nothing about the days before its first invoice or after its last.
- **What happens to a saved ERP invoice** (`crm_erp_sales` only; manual sales are never touched): one whose content or category mapping
  changed takes the file's content in place (status `replaced`, same id `erp-sale-<key>`, written by this import); one whose
  representative changed moves to the file's representative with the file's content (`moved`; both representatives within the importer's
  reach); one dated in the period that the file does not hold in any state (cancelled or corrected in the ERP) is removed (`removed`),
  and so is a saved one all of whose categories are now excluded. A representative with saved ERP sales in the period and none after ends
  the period at zero: the preview lists each with the saved net and count (`replacement.zeroReps`), and gives the period's saved net
  before and after. Quotation links of «الوصف» are exactly the file's for every invoice it holds (a number changed or gone is dropped; a
  report without the column keeps the saved ones); invoices outside the period are untouched.
- **Left as they were:** the manual-sales, mixed-document and future-date conflicts still block; a saved invoice whose employee is now
  marked «مبيعات مكتب (مستبعد)», or named «مبيعات مكتب» by the ERP, or given without employee details, keeps its saved copy for its
  representative (the file still holds it, so it is neither replaced nor removed) and the notes say so; a saved invoice of an inactive
  representative or one outside the importer's region is not touched and is counted.
- **The commit** needs the importer's explicit agreement when anything saved is replaced, moved or removed (`replaceExisting`, «أوافق على
  استبدال الفواتير المحفوظة ونقلها وحذفها كما في المعاينة», as GSCO's `replace_existing`), stays one atomic batch behind the claim, and is
  refused, writing nothing, when the preview is stale (another import moved the revision), when a saved row it changes is not as the
  preview read it, or when the active representatives changed meanwhile. The same request replays its receipt.
- **Traced:** the import's row (`crm_erp_imports.result.replacement`: the period, the counts, the zero rows) and its audit line («استيراد
  مبيعات ERP», `replacementChanges`: each invoice, from which representative and net to which), and beside it one audit line «استبدال
  مبيعات ERP» (`<import id>:replaced`) with the saved rows as they were.
- **The screen:** a section «استبدال المحفوظ لفترة الملف» with the period, the replaced, moved and removed counts, the saved net before and
  after, the representatives who end at zero, a warning never to upload a report filtered by representative, and the agreement; the
  documents carry their own amber mark (never the red problem mark). The size and line-limit messages now say to split a larger report
  by months, each file covering every representative.
- **Not automatic:** the coverage entry «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها» stays the importer's own tick (GSCO, too,
  asks the importer to confirm completeness).
- **Tested.** `tests/erp-sales-replace.mjs` (route on migrated SQLite), `tests/erp-sales-replace-ui.mjs` (the component),
  `tests/erp-sales-replace-http.mjs` (built release, real XLSX, the KPI and own targets reading the result) and
  `tests/erp-sales-replace-browser.mjs` (Chromium at 360 px and a computer, Arabic and English).

## Mold requests: the city, the mold number and the customer code required; erpCode sent with a CRM customer (2026-11-14, no migration)

- **Asked.** The owner on 2026-11-14: «خلي المدينة ورقم القالب إجباري والطلب يتبعت بكود erp», then «سميه كود العميل بس». A request
  had reached production with no Yourrest code (a customer not linked in the CRM), no city and no mold number.
- **The city** (`app/mold-requests.tsx` MoldRequestDialog): a «المدينة» list under the address, its choices exactly the production
  sheet's cities (`MOLD_SHEET_CITIES`), shown by their Arabic (or English) part, the sheet's text sent as `customer.city`; filled in from
  the linked customer's city when it maps to one (`sheetCity`), with the address's rules. Required of a new request and of the edit of one
  never sent, in the form and on the server (`moldCity`, `askedCity` in `app/api/mold-requests/route.ts`): «اختر المدينة». Shown in the
  signing summaries (the device and the link's page) and on the request's sheet.
- **The mold number** (`specs.moldNo`, «رقم القالب») is required the same way (`validateMoldSpecs(input, {moldNoRequired})`):
  «اكتب رقم القالب».
- **The customer code** («كود العميل», the ERP code; the label renamed from «كود ERP» on the mold screens) is required of every new
  request and of the edit of one never sent: «اكتب كود العميل».
- **erpCode with crmNumber.** The products team confirmed on their live code (schema 20) that `customer.erpCode` beside a numeric
  `crmNumber` is accepted, and that adding it to a request already sent is refused (409 production_only) except in a correction after
  finance's return. So the CRM decides it when a request is stored, edited before its first send or corrected (`data.erpWithCrm`,
  `moldSendsErpWithCrm`, one switch `MOLD_SEND_ERP_WITH_CRM_CUSTOMER`, on); a request stored without the mark is sent byte for byte as
  before on every retry and resend.
- **Old requests** are not checked again and keep their bodies; a sent request's sheet shows no city or mold number when it has none; the
  correction of a returned request does not ask for the new fields.
- Docs: `docs/MOLD-REQUESTS-CONTRACT-AR.md` «المدينة ورقم القالب وكود العميل إجباري».

## The evaluation scored like GSCO: the score from the data there is, automatic data quality, inactive representatives out, won visits effective (2026-11-14, no migration)

- **Asked.** The owner approved four changes to «المستهدفات وتقييم الأداء» so that it scores as the company's other CRM (GSCO) does,
  on 2026-11-14, through the multiple-choice answers: «الدرجة من الموجود»، «دقة البيانات تلقائي»، «مندوب بلا نشاط يطلع برّه»، «البيع
  يتحسب فعالة».
- **1. The score from the data there is.** `lib/kpis.ts` `kpiSummary`: missing data is not a zero. The overall score is the points earned ÷
  the weight that has data (the weight of «لا ينطبق» left out) × 100 whenever that weight is above zero; before, it was empty («غير مكتمل»)
  until every indicator had data. The summary keeps `complete` and adds `scoredWeight`, `dataShare` (the weight with data as a percent of
  the applicable weight) and `missing` (the indicators without data); with no weight with data there is still no score (no division by
  zero). The screens (`app/kpi-performance.tsx`: the comparison table and a person's page; `app/targets-performance-summary.tsx`: the
  cards) write the score with a small «غير مكتمل» badge and a yellow note «الدرجة محسوبة من البيانات الموجودة فقط: X% من الوزن» and
  «بيانات ناقصة: » followed by the names of the indicators without data (the note replaces the card's old list of incomplete indicators).
  «تصدير التقييم» (`lib/targets-export.ts`) writes the same score, the badge's word, the share and the missing names in the overall line.
  Nothing averages or ranks the scores elsewhere (checked: the rollups of supervisors and managers are computed from their teams' data).
- **2. «دقة واكتمال البيانات» automatically.** The representative's customers (customer records whose responsible is among the person's
  `sourceMemberIds`; a deleted customer is in «المحذوفات», not in the records): the filled fields ÷ (customers × 7), counting the name, the
  region, the city, the phone, the contact person («اسم المسؤول»), the customer type («نوع العميل») and a place (the location, the short
  address, the address, or device coordinates). No customers: «لا ينطبق». Source «محسوب تلقائيًا». The two numbers of the management
  assessment («عدد السجلات التي تمت مراجعتها»، «عدد السجلات الصحيحة والمكتملة») and its data-review note are gone from the form; the stored
  schema is unchanged (`kpiInputSchema` still reads `reviewed`, `correct` and `review_note`), so a saved assessment still parses and is
  saved back as it was, and those numbers no longer count. The five conduct indicators stay manual.
- **3. «بلا نشاط في هذا الشهر – خارج التقييم».** A representative (role `rep` only, never a supervisor's or a manager's rollup) with no
  visit, follow-up or other contact of their own (activity records), and no confirmed sales document, in a closed month (its last day before
  today) whose sales are known complete (the ERP imports cover the month, `coverage.current` of `lib/sales-coverage.ts`, or «بيانات
  المؤشرات» confirmed the history) is out of the evaluation: `KpiPerson.inactive` and `summary.inactive`, no total. The screens write the
  sentence in place of a score, with no points or weight in the comparison, put such people after everyone evaluated, and the export writes
  the sentence with no score or points.
- **4. «نسبة الزيارات الفعالة».** A visit is effective unless its customer's current stage is «تم الفقد»: a won customer's visit now counts
  (before, only open stages did). The reason no longer cites gscoinvest.
- **Tested.** Unit tests: `tests/kpi-complete-domain.mjs` (99 checks), `tests/kpi-complete-integration.mjs` (114),
  `tests/kpi-performance-evidence-ui.mjs` (111), `tests/targets-performance-summary-ui.mjs` (106), `tests/targets-export.mjs` (43),
  `tests/crm-regression.mjs` (368: the customer-service flow now changes only the quality indicator of the representatives whose customers
  it created); the default gate 191/191. Against the built release, the targets area of `npm run gates`: 21 passed, 4 skipped (the owner's
  ERP files), among them `tests/targets-audit-browser.mjs` (121, rep1's overall score by hand now 64.26 with quality 15/21) and
  `tests/app-browser-workflows.mjs` (206, the assessment form without the reviewed/correct counts).

## The mold request's customer typed, with no suggestions (2026-11-14, package update-mold-customer-typed-20261114, no migration)

- **Asked.** The owner, 2026-11-14: «خلى ادخال اسم ورقم العميل كتابة من غير اقتراحات».
- **What it does.** `app/mold-customer-fields.tsx`: «اسم العميل» and «كود ERP» are plain fields (no list, no combobox role, no keyboard
  choosing; the suggestions of 2026-11-09 are gone with their styles). The current ERP code of exactly one of the reader's customers still
  links the request (`moldCustomerByErpCode`, the server deciding the same), shown as «مرتبط بالعميل …» with «كود ERP: …» and the city,
  not the Yourrest code (the owner: «خلي كود ERP يظهر بدل كود يورست»; production still gets the Yourrest number). `app/mold-requests.tsx`: the
  linked customer's registered address fills an empty address, or replaces one filled the same way for another customer (a code
  corrected); an address typed for the request is kept; the address's message goes when it fills.
- **Tested.** `tests/mold-requests-browser.mjs` (255 checks), and the other mold browser tests type the ERP code in place of choosing.

## The «عروض الأسعار» screen retired (2026-11-14, package update-quotes-retired-20261114 with the red marks below, no migration)

- **Asked.** The owner, 2026-11-14: «شاشة عروض السعر ملهاش لازمة الغيها وارفع».
- **What it does.** `lib/access.ts` `RETIRED_PAGES` (`quote`): the screen is in no menu (`app/crm-app.tsx` nav, `app/mobile-navigation.tsx`),
  for every role, the administrator included, and `resolveCRMPage` sends an old link or saved place to the first screen the member has. Only
  the screen goes: the quotations stay in the data, the ERP quotations import of the targets page and the quote-to-sale indicator are
  unchanged, and the «عروض الأسعار» cells of the permissions matrix still decide who may import them (`can(me,'quote','add')`).
- **Tested.** `tests/permissions.mjs` (an old link opens the first screen for the administrator, the manager and the supervisor),
  `tests/mobile-navigation-ui.mjs` (no role's phone menu has it).

## Problems of the ERP sales import marked in red (2026-11-12, package update-sales-problems-20261112, no migration)

- **Asked.** The owner, 2026-11-12, with a picture of the preview (one category «خدمات تجارة وتوريد الحديد» left on «اختر صنف
  المستهدف», one document skipped): «اعرف ازاى ان مفيش مشاكل فى المبيعات», then «علم على المشاكل بالاحمر».
- **What it does** (`app/erp-sales-import.tsx`, `app/erp-sales-import.css`): above the preview's counts a red box «مشاكل يجب حلها قبل
  الاستيراد (معلَّمة بالأحمر)» lists what remains (categories without a target product and employees without a rep, from the current
  choices; documents that need review and documents without a rep, from the preview), and asks for «تحديث المعاينة» once a choice changed;
  with none and the preview current a green line says «لا توجد مشاكل…». In red: each category or employee row with no choice, the count
  «تحتاج مراجعة» above zero, the box of documents without a rep, the choice «استيراد الفواتير الجاهزة فقط», the completeness blocker,
  and each document (row or card) that will not be imported, its badge too. Display only: nothing the server checks changed.
- **Tested.** `tests/erp-office-employees-browser.mjs` (the unmapped employee marked, the banner naming it, gone after the choice and
  the refresh, the green line then), against the built release.

## The ERP code read-only for everyone; the ERP customers import resolves duplicate holders (2026-11-12, to ship with the next package of the day, no migration)

- **Asked.** The owner, 2026-11-12: «ده اخر تحديث للعملاء ومفيش حد ادى لعميلين نفس الكود والغى امكانية تعديل كود erp لاى حد حتى مدير
  النظام». The owner's latest ERP customers export (194 rows, read locally for counts only) has every «رقم العميل» once (103 and 104
  once each), so the «مسجل لأكثر من عميل» of the ERP quotations import came from two CRM customers each carrying one code now (hand edits
  or old data).
- **Read-only code.** POST /api/crm (app/api/crm/route.ts) refuses, for every role (the administrator with every region included), a
  customer save that types, changes or empties `data.code`: 403 `ERP_CODE_LOCKED` (lib/customer-identity.ts; English in
  lib/locales/en.json). An edit keeps the stored code exactly (a page that sends none keeps it; the same key in another spelling, Arabic
  digits or spaces, is the same code), and a customer added by hand (form, visit picker, rep, offline queue) has none. An edit racing an
  import of the same customer fails on the record version. The commit-time duplicate guard (`erpCodeTaken`, `NOT EXISTS`) stays as a
  write guard. Unchanged on purpose: the trash's restore (puts the code back as history unless another customer carries it now), the
  one-time legacy import app/api/customers/import (no screen; inserts new customers only), and the mold request's typed ERP code (the
  request's own data, never written to the customer). Screens: app/erp-code-readonly.tsx («كود ERP: 103» / «لا يوجد كود ERP», «يُحدَّث
  من ملف عملاء ERP فقط») in the customer form (app/crm-app.tsx) and the visit's new-customer form (app/visit-customer-picker.tsx), which
  lost its code input.
- **Duplicate holders.** lib/erp-customers.ts `matchErpCustomers` returns `duplicates`: for each row that ends on a customer (by phone,
  name, code, a stored mapping or the importer's choice), every OTHER customer carrying the row's number as its current code (a holder
  another row ends on is left out: its code changes anyway). lib/erp-customers-server.ts clears them in the same transaction whatever
  `clearCodes` says (`'erp-customer-code'` audit `{label: 'مسح كود ERP: الكود يخص عميلًا آخر في ملف ERP', from, to: '', cleared: true,
  reason: 'duplicate', row, keptBy}`, versions in the gate), answers `duplicatesCleared`, and writes no code mapping any more (`mapping`
  is always false; the row's customer is the only holder). A row two holders carry with nothing deciding stays a choice and clears nobody;
  among several holders matched by name, a stored mapping to one of them is the choice. A stored mapping to a customer that loses the
  number is left and decides nothing (`effectiveCodeMapping`). `heldOutsideRegions(me, holders)` is now "a holder outside a limited
  member's regions", so such a row is held outside and only the administrator with every region clears it (the apply re-checks each
  duplicate: «الرقم X عند عميل خارج مناطقك؛ ربطه لمدير النظام.»). The preview lists them in «عملاء يحملون كودًا يخص عميلًا آخر في ملف
  ERP — سيُمسح منهم الكود» (app/erp-customers-import.tsx: name, Yourrest code, region, code, the customer keeping it and its row), the
  summary, the apply button («… وامسح N كود») and the result count them; on a phone the apply button's words wrap.
- **Effect.** After such an import «أكواد مشتركة» of the ERP quotations import no longer lists the code, and its quotations go to the
  customer that keeps it (tests/erp-customers-duplicates-http.mjs, from four shared codes to none).
- **Tests.** Default gate 188/188 (tsc 0 errors; ESLint 0 errors, the 5 earlier warnings). tests/erp-customers.mjs (251),
  tests/security-customer-code.mjs (80, rewritten: the code read-only for admin, manager and rep), tests/rep-customer-create.mjs (284),
  tests/customer-identities.mjs (89), tests/trash.mjs (214), tests/rep-mobile-shell.mjs (718), tests/dictation-coverage.mjs (30); built
  release: tests/erp-customers-duplicates-http.mjs (new, 28), tests/erp-customers-http.mjs (146), tests/erp-customers-clear-http.mjs
  (53), tests/erp-quotes-http.mjs (108), tests/mold-customers-http.mjs (42), tests/server-authorization.mjs (658),
  tests/trash-http.mjs (61), tests/visit-files-http.mjs (41), tests/sales-date-boundaries.mjs (36), tests/targets-attainment-http.mjs
  (26), tests/namecheap-http.mjs (381); Chromium: tests/erp-customers-browser.mjs (115), tests/customer-edit-browser.mjs (73). The full
  gates run (`node scripts/gates.mjs --full`): every release-build and browser test passes (4 skipped: they need the owner's ERP files);
  four browser tests that failed once under the parallel load passed alone (complaints, mold-requests, permissions, service-queue).
  Expectations changed on purpose: a code typed or changed through /api/crm is now 403 (fixtures that gave codes through the form now set
  them as the import does); a number another customer holds is no longer mapped but cleared from that customer (`mapping` false,
  `mappings` 0, `duplicates`); a sales manager no longer moves a number past a holder outside their regions even with a mapping to a
  holder inside, and is no longer stopped by a stale mapping to an outside customer that carries nothing.
- Arabic guide: docs/UPDATE-2026-11-12-TARGETS-FIXES-AR.txt.
## «العملاء الجدد» from the ERP customers file (2026-11-12, released in update-targets-fixes-20261112, no migration)

- **Asked.** The owner: «فيه فى داتة العملاء اللى برفعها التاريخ واسم المندوب هاتهم من هنا». Before, «العملاء الجدد» counted only the
  customers a representative added by hand in the app during the month (`data._createdBy`), divided by the new-customers target.
- **The import reads «التاريخ».** lib/erp-customer-extras.ts (pure) reads the ERP customers export's «التاريخ» (2026/11/03, 03/11/2026,
  an Excel serial day, Arabic digits, with or without a time) into `data.erpCreatedAt` (YYYY-MM-DD) of every customer a row ends on and of
  every customer the import adds, and, when the file has one («المندوب», «اسم المندوب», «رقم الموظف», «كود المندوب»), the representative
  into `data.erpRep` {employeeId?, name?}; the customer is never reassigned. An empty or unreadable cell erases nothing (the preview counts
  the unreadable ones). lib/erp-customers-server.ts writes them in the import's one transaction (the version moves once with a code change),
  one 'erp-customer-fields' audit entry each with before and after (lib/erp-customer-extras-server.ts); a file whose only change is dates or
  representatives can be applied; the preview and the result say how many (app/erp-customers-import.tsx). A form edit keeps both fields
  (app/api/crm/route.ts).
- **The KPI.** lib/new-customers.ts, used by lib/kpis.ts: each customer is credited once in a month, (a) to whom added it by hand in the
  app that month, else (b) when its ERP date is in the month, to the file's representative when it maps to a CRM member (the ERP employee
  mappings `crm_erp_employee_mappings`, else exactly one representative's full name), else to the customer's current responsible
  (`assignedTo`), since the current file has no representative column. «مبيعات مكتب» never counts. A customer the ERP customers import added
  (its id) is no longer the importer's hand-made customer. A customer made in the month with neither a maker nor an ERP date still makes the
  metric unknown; one with an ERP date does not. Region and team scoping are unchanged; finished months are recomputed when read. The KPI
  reads never load the ERP upload parser (lib/kpis-server.ts builds the mapping).
- **Tests.** tests/new-customers-erp.mjs (pure, 80 checks), tests/new-customers-erp-http.mjs (built release, 26 checks: the import then
  the KPI); tests/erp-customers-http.mjs leaves «التاريخ» empty in its fixture (what it writes is the new test's).
## «تحقيق المستهدف — الشركة» for a company of one branch (2026-11-12, to ship in release update-office-employees-20261112, no migration)

- **Asked.** The owner's screenshot of the live site (administrator): «الشركة» and «فرع الرئيسي» both «—», «لم يكتمل المستهدف»
  («مجموع الفروع», «مستهدف خاص بالفرع»), and «مفيش فروع للشركة»: every member's branch is «الرئيسي».
- **The cause.** A «الفرع بالكامل» target was saved for «الرئيسي» with products of a non-zero weight left empty. The rule of
  lib/targets-overview.ts let a saved branch target win over the sum of its people even when incomplete, and the company was the sum of
  the branches; with one branch the company's target was that incomplete target, so both gauges were blank (`missing_inputs`) whatever
  the representatives' own targets, and stayed so in the following months (effectiveSet carries a target forward).
- **One branch** (all the people of the distribution table in one branch; a branch with nobody, only a saved target or customers, does
  not count): `targetsOverview` returns `single: true` and no branch scope; the card is «تحقيق المستهدف — الشركة» with ONE gauge and the
  note without the branch sentence. The company's target is the sum of the people's own effective targets (the representative cards'
  rules); a saved branch target is used only when complete (a number for every product of a non-zero weight; `savedMonth` shown) and
  otherwise ignored and named (`ignoredSaved`: «لم يُعتمد مستهدف «الفرع بالكامل» لأنه ناقص»). The gauge is blank only for what is really
  missing, and says it in one line (`missing`, `missingLine`): people who sell (active, or with a confirmed sale this month) without a
  target («3 مناديب بلا مستهدف لهذا الشهر», MSA agreement by `repsCount`), and weighted products a targeted person left empty
  («لم يُحدَّد مستهدف لصنف: …»). «تفاصيل الفئات» writes «محدَّد لـ 2 من 3» under a product set for part of the people (`coverage`), and no
  percentage for it. A target of zero is a target. The percentage is the same weighted formula (quantityAttainment).
- **Two branches or more:** unchanged numbers and layout; a blank gauge now names the product it lacks instead of «لم يكتمل المستهدف».
  The overview table's cells take their own padding (the global `table td` padding left product names a letter wide on a phone).
- **Who sees it:** unchanged (the administrator and a sales manager over every region; not a future month).
- **Tests:** tests/targets-company-gauge.mjs (new, 45 checks); tests/targets-performance-ui.mjs (+3: a one-branch payload has no branch
  gauge); tests/targets-hub-browser.mjs (+ a one-branch company in Chromium: the missing representative's line, the ignored branch
  target, «تفاصيل الفئات», then the filled percentage; desktop and phone 360, Arabic and English). The two-branch expectations of both
  files are unchanged.
## «مبيعات مكتب (مستبعد)» for an ERP employee (2026-11-12, release update-office-employees-20261112, no migration)

- **Asked.** The owner, of employee «نوفل بكر · رقم الموظف: 6007» in «ربط الموظفين بالمناديب» of an ERP import: «ده مبيعات مكتب مش
  تبع المبيعات». Office sales were excluded only when the ERP's employee NAME is «مبيعات مكتب» / «مبيعات المكتب» (`isOfficeEmployee`,
  lib/erp-sales.ts, unchanged); a real person who works in office sales asked to be mapped to a representative.
- **The list** (lib/erp-office-employees.ts). One `crm_settings` row `erp-office-employees` (the JSON in `owner_id`, like the other
  import states: no migration; `crm_erp_employee_mappings.rep_id` references a member, so no sentinel there), `{employees:[{employeeId,
  employeeName, by, at}]}`. A mark from the sales or quotations import is keyed by the ERP employee number (marks of direction and repeated
  spaces removed, Arabic-Indic digits read as digits, so both imports find it) with the name the file showed; one from the collection
  statement, which has names only, has `employeeId` ''. The row is its own concurrency token: each import's commit gate requires it to be
  exactly as read (`officeUnchanged`), and it is written only inside the import's own transaction (`writeOfficeList`).
- **The choice.** Each employee's select in the ERP sales import and the ERP quotations import, and each name's select of the collection
  statement, ends with «مبيعات مكتب (مستبعد)» (value `office:excluded`). Chosen, the documents are excluded exactly as «مبيعات مكتب»:
  status `excluded`, counted in `officeExcludedCount`, for no representative, never blocking, and no category asked for them (sales); a
  quotation is `excluded` before a customer or a mapping is needed (`ERP_QUOTE_REASONS.officeMarked`); the statement's accounts are counted
  with the office and the name listed with «مبيعات مكتب — مستبعد». The reasons: «مبيعات مكتب (تحديد الموظف): مستبعدة ولا تُحتسب لأي
  مندوب». The name rule stays as it was.
- **Saved** with the import, as the employee mapping is: the sales import (every commit), the quotations import (also when it is the only
  change, so the commit button is enabled for it), the collection statement (with the evidence, or alone with the import's audit line as
  its claim). One audit line `تحديد موظفي مبيعات المكتب` (record `erp-office-employees`) for each import that changes the list: source,
  import id, file, who was marked (with the former representative) and who was lifted (with the new one). Marking in the sales import
  removes that employee's representative mapping row; a mark is lifted only with the representative mapping that replaces it.
- **Who.** Marking is a change of the employee's mapping: whoever may import, the former representative within their reach (a supervisor
  cannot mark an employee mapped to another team's representative, 403). Lifting a saved mark (back to a representative) is for the sales
  manager and the administrator: a supervisor sees it selected and locked («تعديله لمدير المبيعات أو مدير النظام», 403 from the server).
  In the quotations import a saved mark is fixed like a saved mapping (changed from the sales import, 409); in the collection statement a
  number mark is fixed (409) and a name mark may be mapped back to a representative there; marking a name mapped to a representative
  outside the reader's team or regions is refused (403).
- **Across the imports.** A number mark applies by number in the sales and quotations imports and by its name in the collection
  statement; a name mark applies in the statement and, in the two other imports, only suggests itself for an unmapped number of exactly
  that full name (as they suggest a representative of that name), saved as a number mark with the import. No KPI or target computation
  filters office sales at read time: office documents are never imported, so the exclusion is complete at the imports.
- **Documents saved before the mark.** Never deleted or rewritten, as with any changed mapping: an invoice saved for a representative
  under an earlier mapping is shown `excluded` with «… النسخة المحفوظة سابقًا للمندوب تبقى كما هي», counted (`officeSavedCount`) and said
  in the report notes; it stays counted for that representative. Lifted back to the same representative, it is a duplicate again. An
  imported quotation of a marked employee likewise stays («العرض المحفوظ سابقًا يبقى كما هو»).
- **Tests.** tests/erp-office-employees.mjs (default gate, 76), tests/erp-office-employees-http.mjs (release-build, 54),
  tests/erp-office-employees-browser.mjs (browser, 80: desktop and phone 360, Arabic and English), and additions to
  tests/erp-quotes-http.mjs and tests/erp-collections-http.mjs; registered in the manifest, the areas and tests/CHECKS.md. The activator's
  same-day backups now accept update-salesmen-activation-20261112.

## ERP customer codes matched by the current code only (2026-11-12, release update-erp-current-code-20261112, no migration)

- **Asked.** The owner's rule, said before and again on 2026-11-12: «لما ارفع بيانات العملاء تاخد كود erp وتحدث بيانات العملاء باللى
  موجودين فى erp والباقى متحدثهمش ومتديلهمش كود erp يعنى يبقى فاضى لان العميل ده مش موجود فى erp اصلا». A customer not in the ERP has
  no ERP code and is never matched to ERP data.
- **The fault.** The ERP quotations import showed many «كود العميل مسجل لأكثر من عميل في الـCRM». Matching read a customer's current
  `data.code` together with every code it had carried (`crm_customer_code_aliases`, kept by the trigger `crm_customer_identity_update` of
  drizzle/0014 whenever a code changes or is cleared, read into `data._erpCodeAliases` by lib/crm-context-records.ts). So «امسح كود ERP
  للعملاء غير الموجودين في الشيت» left a cleared customer matching its old code: code 103 matched the real ERP customer and an unrelated
  cleared one.
- **Current code only.** lib/customer-identity.ts: `customerErpCodes` is the current code alone; `customerCodeCandidates` and
  `uniqueCustomerCodes` (a stored mapping picks one of the code's current holders; a mapping to a customer that no longer carries the code
  is ignored, never deleted: `effectiveCodeMapping`) therefore decide, through their callers, the ERP quotations import and its «أكواد
  مشتركة» (lib/erp-quotes-server.ts), the KPI invoices, purchase history and quote conversions (lib/kpi-evidence-server.ts,
  lib/kpi-history-server.ts), «آخر شراء» (lib/customer-last-purchase.ts), the mold requests' typed ERP code (app/api/mold-requests,
  app/mold-customer-fields.tsx) and the reconciliation list (`customerIdentityOptions`: 'mapped' only while the mapping's customer
  carries the code; a saved mapping of a code nobody carries is listed too, so it can be removed). The ERP customers import (lib/erp-customers.ts) finds a row by code only through a current holder, `heldOutsideRegions`
  ignores a mapping that decides nothing (except that a sales manager still never rewrites a stale mapping to a customer outside their
  regions while somebody carries the number), a customer named only by an old code or a stale mapping is now among the customers to clear, a
  plan step rewrites the stored mapping by its version, and a new customer's gate no longer refuses a code another customer only had
  before (lib/erp-customers-server.ts). The trash's restore gives a customer its code back unless another customer carries it now (or a
  mapping that decides gives it to one); kept codes still come back as history. The alias table, its trigger and its data stay, for
  history, the audit and the trash.
- **No new duplicates.** POST /api/crm refuses a customer save that sets or changes the ERP code to one another customer carries now:
  «كود ERP «103» مسجّل لعميل آخر في الـCRM؛ لكل عميل كود ERP خاص به لا يتكرر. صحّح الكود، أو اتركه فارغًا إذا لم يكن العميل في ERP.»
  (`erpCodeTaken`; the code only, never the other customer; English in lib/locales/en.json), and the commit re-checks it (`NOT EXISTS`
  on the plain spelling), so two concurrent saves cannot both take one code. A save that keeps its code is never refused, so an older
  duplicate can still be edited and resolved by the administrator's mapping. The one-time legacy customers import
  (app/api/customers/import, source factories that may share an ERP reference) is unchanged.
- **Effects.** A cleared customer's KPI invoices and «آخر شراء» stop counting its old code's invoices (they belong to the current holder,
  or to nobody); «أكواد مشتركة» shrinks to real current duplicates; a current holder's targets and KPIs include invoices that were
  ambiguous before. Quotations already imported under a cleared customer stay there (a re-import reports «تغيّر عميل العرض في ERP…»).
  The ERP customers import's hint under the clear option says a cleared customer is no ERP customer any more.
- **Tests.** tests/customer-code-key.mjs (37), tests/erp-customers.mjs (245), tests/customer-identities.mjs (89),
  tests/customer-last-purchase.mjs (25), tests/security-customer-code.mjs (29), tests/rep-customer-create.mjs (273), tests/trash.mjs (215);
  built release: tests/erp-quotes-http.mjs (108), tests/erp-customers-clear-http.mjs (50), tests/erp-customers-http.mjs (143),
  tests/mold-requests-http.mjs (413); Chromium: tests/mold-requests-browser.mjs (270: the old code suggests and links nothing).
  Expectations changed on purpose: an alias no longer matches (kept-alias holders, the «re-imported» rows that found a customer by its old
  code, the last purchase of an alias, a renamed code's earlier invoices), and two customers can no longer be given one code through the
  form (the concurrency tests now expect the second save refused).
- **Activator.** portable/activate-ui-refresh-update.cjs accepts update-quote-codes-activation-20261111 as a previous backup.
## The salesmen list for the products application (2026-11-12, release update-salesmen-20261112, no migration)

- **Asked.** The products team's new `salesmen` route (agreed contract; their PR yourrest-products#54, not merged when this was built):
  a request registered in the products application names its representative from the CRM's members, as it names its customer from the
  `customers` list.
- **Who is sent** (`lib/mold-salesmen.ts`, pure). Every active member who may file a new mold request exactly as the create path of
  `POST /api/mold-requests` decides it: a role of `MOLD_ROLES` (`canCreateMoldRequest`), «طلبات تصنيع القوالب» not hidden from them
  (`pagesBlocked`) and its «إضافة» cell not switched off (`cellRefused`). «المركز الرئيسي» and «مبيعات مكتب» are not members and never
  sent. The entry (`portable/mold-salesmen.mjs`): `crmMemberId` (`crm_members.id`, `^[A-Za-z0-9_-]{1,64}$`, else skipped), `name` as the
  users screen shows it with direction marks and invisible characters removed, runs of spaces as one, at most 160 code points, `email`
  lower-case and left out when it is not an address or is over 160 characters, `active`.
- **When** (`lib/mold-salesmen-server.ts`, started by the same nudge as the customers list, `lib/mold-customers-hook.ts`). `full` at the
  first check after the server starts (the release going live), at least once a day, and when a member sent before was deleted;
  `upsert` of what changed about 5 seconds after a write through `POST /api/crm` (member added or edited, deactivated, permissions
  changed): changed entries, and active:false for a member sent before who may no longer ask; a check every 10 minutes. Over 1000
  salesmen or 256 KB a full is never cut (it would deactivate whoever was cut): upsert batches, nobody deactivated that time, a warning.
- **Before the products release** the route answers 400 invalid_payload with fields `["route"]`: read as «not available yet», no
  error recorded, one info line a day at most, asked again an hour later.
- **Kept and logged.** State in one `crm_settings` row `mold-salesmen` (last full, a short fingerprint per salesman sent, the route's
  absence, the last error's code and fields): no migration. Each send that went through is one `crm_audit` line `mold-salesmen:sync` with
  counts and `deactivatedIds` (ids only). Failures are a warning an hour at most, with the code, HTTP status and field names. The secret is
  never logged.
- **Client and stand-in.** `portable/mold-client.mjs` knows the route (256 KB limit, the answer's five counts and `deactivatedIds`);
  `scripts/lib/products-mock.mjs` has it behind `{salesmen: true}` / `setSalesmen(true)`, validating the contract field for field;
  without the option it answers like production today.
- **Tests.** `tests/mold-salesmen.mjs` (default gate) and `tests/mold-salesmen-http.mjs` (release-build), registered in the manifest,
  the areas and `tests/CHECKS.md`.

## Sales-history completeness from the ERP sales import, and the default activity targets (2026-11-12, shipped in release update-quote-codes-20261111, no migration)

- **Asked.** The owner's decision «اعمل الاتنين»: «نمو مبيعات الأصناف», «العملاء المستردون» and «الحفاظ على العملاء الحاليين» waited for a
  manager to confirm, month by month in «بيانات المؤشرات», that the month's and the three previous months' sales history was complete. Now
  the history is confirmed once per ERP sales import, as the reference CRM (GSCO) does with its `complete_snapshot`; and the default
  customers-and-visits targets are visible.
- **The import.** «استيراد مبيعات ERP» has «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها» (unticked by default, sent with the commit
  only: ticking it needs no new preview; `completeSnapshot`, `coverageFrom`, `coverageTo` of `lib/erp-sales-server.ts`). The period is the
  file's first to last invoice date; the uploader may widen it to the first day of the file's first month and the last day of its last
  month, never beyond today (a month whose last days had no sale). Refused with documents needing a mapping (`unmappedCount`). Ticked, the
  import's own row of `crm_erp_imports` keeps `result.coverage` {from, to, months, partialMonths, repIds, allReps, importer, at, importId},
  also in its audit line: no migration. repIds are the representatives the uploader may import for, less any of a document skipped as out
  of scope; allReps when that was every active representative and nothing was skipped (a representative added later is covered too; the
  commit's gate rechecks the active representatives). Entries are never changed or deleted: coverage only grows. The preview (`coverage`)
  says what a complete file would cover; the receipt says what was recorded. A retry of the same request with another choice is another
  request (409); without the tick the fingerprints are exactly those of before.
- **Coverage** (`lib/sales-coverage.ts`, pure). A day is covered for a representative when an entry for them includes it; a month when
  every day is (the month in progress: from its first day, the indicators reading what was imported through the last covered day). A month
  only partly in a file is covered only when another complete import covers the rest: the file says nothing about the days outside it. Per
  KPI, after GSCO's checks: growth needs the month and the comparison days of the month before; retention the month and the three months
  before; recovered also one whole complete month before those three. A team needs every representative covered.
- **The KPIs** (`lib/kpis.ts`, `lib/kpis-server.ts`). The manual confirmation still completes all three, as before (fallback). Otherwise
  each KPI is automatic when covered; within covered months a product or a representative with no sale is a zero (the growth rescaling of
  zero baselines is unchanged). Not covered: null, `source: 'required'`, the reason naming the months («يلزم رفع مبيعات ERP كاملة لشهر
  أغسطس 2026.») and `missing` for the English page and export (`kpiMetricReason`, `coverageReason`). Unknown customer codes keep retention
  and recovered waiting with the identity reason. «بيانات المؤشرات» (`coverage` of `getKpiEvidenceOptions`) says the manual confirmation is
  no longer needed, or names the missing months.
- **Default activity targets.** They already applied (10 new customers, 5 recovered, 320 visits: `defaultActivityTargets`, documented in
  `lib/targets.ts`, the only place they live); now the targets editor writes «افتراضي» beside a value that comes from them (table, phone
  cards, the edit dialog's note) and the evaluation beside «مستهدفات النشاط» (`activityTargetsDefault` of `/api/sales`). A saved target
  of the month, or carried from an earlier one, wins; there is no recovery target in «بيانات المؤشرات» (the recovered target is the
  activity field). Finished months stay locked to the administrator.
- **Tests.** `tests/sales-coverage.mjs` (default gate, 67 checks), `tests/sales-coverage-http.mjs` (built release, 68),
  `tests/sales-coverage-browser.mjs` (Chromium, desktop and phone 360, Arabic and English, 86). `tests/targets-export.mjs` now expects the
  export to receive the page's language.
- **Going back.** Code only: the coverage entries stay inside the imports' results and the previous release ignores them, so the three KPIs
  wait for the manual confirmation again.

## The ERP quotations import: shared customer codes and «مبيعات مكتب» (2026-11-11, release update-quote-codes-20261111, no migration)

- **Asked.** The owner imported his ERP quotations on the live site and many were refused: «كود العميل مسجل لأكثر من عميل في الـCRM؛
  اربطه بعميل واحد أولًا» (an ERP code that two or more CRM customers carry, with no screen anywhere to decide it) and «اربط موظف ERP
  بمندوب» for the «مبيعات مكتب» quotations, which the ERP sales import excludes by the employee's name.
- **«مبيعات مكتب».** `planErpQuotes` (`lib/erp-quotes.ts`) excludes a quotation whose ERP employee is «مبيعات مكتب» or «مبيعات المكتب»
  (`isOfficeEmployee` of `lib/erp-sales.ts`) before anything else: status `excluded`, reason «مبيعات مكتب: عروض شركة أخرى مستبعدة
  تلقائيًا», counted under «مستبعدة» (a sixth count, `summary.excludedCount`, and `excludedCount` in the receipt and the import's audit
  line); never written, never needing a customer or a mapping, its employee never offered in «ربط موظفي ERP بالمناديب» nor matched by name.
  A refused or an excluded quotation never keeps the others from being imported (only «new» and «update» are written, as before).
- **Shared codes.** The preview carries `sharedCodes` (`lib/erp-quotes-server.ts`): every customer code of the file (excluded and unreadable
  quotations left out) that two or more CRM customers carry (`customerCodeCandidates`: `data.code` plus `_erpCodeAliases`), with its
  quotations count and whether a «ربط كود عميل ERP» already chose one. To the administrator with every region (`isIdentityAdmin`, the
  predicate behind `requireIdentityAdmin`): its candidates (exactly the customers that carry it: name, «YR-C-…», region, branch, version),
  the saved choice and the mapping's version, and the identity revision; to anyone else only the codes still undecided, never a customer.
  The dialog lists them under «أكواد مشتركة بين أكثر من عميل» (`app/erp-code-choice.tsx`, reusable by the sales import): the administrator
  chooses «العميل الصحيح لهذا الكود» and presses «حفظ الربط», which posts to the existing `/api/customer-identities` (`saveCustomerIdentity`
  unchanged: 403 to anyone else, a customer that does not carry the code refused, revision and versions checked, the audit «ربط كود عميل
  ERP», the request id replayed on a retry), then the file is previewed again and those quotations become «ستُضاف» / «ستُحدَّث». A line
  under the choice says that the mapping is global (KPI invoice matching and the last purchase follow it). A saved mapping is shown as the
  current choice and can be changed from the same place; quotations already imported stay under their customer (refused with «تغيّر عميل
  العرض…», never moved). Each quotation refused for a shared code has «اختيار العميل الصحيح لهذا الكود», which takes the administrator to
  the code; anyone else reads «يحتاج مدير النظام إلى اختيار العميل الصحيح لهذا الكود.».
- **Why the mapping is saved on its own and not with the import.** It is global and outlives the file; saved through the one existing path
  it keeps every check and audit of that path, and a saved mapping moves `crm_erp_import_state.revision` (trigger of migration 0014), so a
  preview made before it cannot be committed (409) and the screen previews again at once.
- **Tests.** `tests/erp-quotes.mjs` (73 checks: a shared code refused, mapped to one of its customers → new under it, a mapping to a
  customer that does not carry it decides nothing, re-import unchanged, the mapping changed later does not move the quote, «مبيعات مكتب»
  excluded even when its customer is missing or the quotation unreadable); `tests/erp-quotes-http.mjs` (96 checks, on the built release:
  the shared code with its candidates to the administrator and without them to the sales manager, 403 to the sales manager and the
  supervisor, a non-candidate refused, the same request once, an old revision 409, the older preview 409, the import under the chosen
  customer with the refused and excluded ones left, unchanged again, the mapping changed later); `tests/erp-quotes-browser.mjs` (58 checks,
  Chromium: the jump, exactly the two customers, «حفظ الربط», the preview made again; the supervisor's words; a 360 px phone and English).
  The default gate (185 of 185), `tests/server-authorization.mjs` (658), `tests/targets-performance-ui.mjs` (187),
  `tests/targets-hub-browser.mjs` (197) and `tests/kpi-evidence-browser.mjs` (87) pass unchanged.
- **Activator.** The previous release's activation (`update-targets-hub-activation-20261111`) is accepted as today's backup, in
  `portable/activate-ui-refresh-update.cjs` and the shipped list of `tests/baseline-update-activation.mjs`.
## «معدل تحويل عرض السعر إلى مبيعات» computed automatically (2026-11-11, shipped in release update-quote-codes-20261111, no migration)

- **Asked.** The owner: «الفواتير مربوطة بعروض السعر فى عمود الوصف» — in the ERP sales export, the «الوصف» of an invoice line names the
  quotation it came from (ERP numbers «Qut-349»). Until now the KPI `orders` was «بيانات مطلوبة» until a manager linked quotes to invoices by
  hand and confirmed the list in «بيانات المؤشرات».
- **The references** (`lib/quotation-refs.ts`, pure, shared by the import and the KPI): «Qut-349», «Qut 349», «QUT-349», «qut349»,
  «Qut-٣٤٩», any dash, «_ . / # :», hidden direction marks, several in one cell, each once, at most 50, written «Qut-<n>» (leading zeros
  dropped); not after a Latin letter or a digit. `quotationRefKey(number)` gives the reference a quote number stands for (null for a number
  that is not an ERP quotation number).
- **The import** (`lib/erp-sales.ts`, `lib/erp-sales-server.ts`). An optional description column under «الوصف», «البيان» or «Description»
  (matched by `headerKey` like the other fields; several are read together) is kept per line (`ErpRow.description`, at most 2000
  characters; `ErpWorkbook.hasDescription`). The document's references (union of its lines) are stored in `crm_erp_sales.data.quotationRefs`
  — no migration. The content and mapped hashes are computed exactly as before (the description stays out), so an invoice saved before the
  column was read stays a duplicate, never a conflict or a change. An identical document whose stored references differ from the file's is
  backfilled (`UPDATE … SET data=json_set(data,'$.quotationRefs',…)` guarded by the document key, both hashes, the stored references read
  at the preview and the import's claim), counted as `quotationRefsBackfillCount` in the answer and in the import's single audit line
  (no audit line of its own). A report without the column answers and stores exactly as before (no new keys) and never erases references.
  The import screen shows «فواتير بيع يذكر عمود «الوصف» فيها رقم عرض سعر» and the backfill count when the column is there.
- **The KPI** (`lib/kpis.ts quoteConversions`, `lib/kpis-server.ts`). Quotations = the quote records (kind `quote`) the reader sees, of a
  customer of the reader's regions, issued (status sent, accepted or rejected — a rejected quotation is an issued one that did not convert;
  drafts are not issued), dated in the month up to its cutoff, attributed to their author (`recordAuthorId`: the representative an ERP
  quotation is mapped to) or to whom «بيانات المؤشرات» assigned them explicitly. Converted = named by `quotationRefs` of a confirmed ERP sales
  invoice (document type sale, positive total) of the same representative, dated on or after the quote, any later day (a finished month's
  quotation still converts when invoiced in a following month), within the reader's region scope and sales team; or linked by hand to a
  sale (`isValidKpiConversion`, unchanged). A manual link adds a conversion and never removes one; a manual row without an invoice changes
  nothing. Score = converted ÷ quotations; 0 quotations: not applicable; no sales team: missing. `quotationsComplete` is no longer needed
  (kept in the stored evidence; `KpiEvidenceContext.quotationsComplete` became `quotationsKnown`). Team roll-ups add their representatives'
  quotations. `KpiPerson.quotations` carries each quotation with its number, customer, invoices and `via` (description / manual).
- **The screens.** The hub's «عروض الأسعار» (`app/kpi-evidence-panel.tsx`): per person the month's quotations, the converted ones, the rate
  and the points, and under a representative's row each converted quotation with its invoice number(s) («ربط يدوي» for a manual-only link);
  on a phone (≤ 760 px) each person is a card. «بيانات المؤشرات» (`app/kpi-evidence-editor.tsx`): the quotations section is «روابط إضافية بين
  العروض والفواتير (اختياري)» with a line on the automatic rule, and the list confirmation is gone. The metric's «طريقة الحساب» is rewritten.
- **Rights and scope unchanged.** Only the sales workspace reads the KPI (a representative gets 403); the import keeps its roles.
- **Tests.** `tests/quote-conversion.mjs` (default gate: 122 checks), `tests/quote-conversion-http.mjs` (release-build: 31),
  `tests/quote-conversion-browser.mjs` (browser: 37); updated `kpi-complete-domain`, `kpi-complete-integration`, `kpi-evidence-ui`,
  `kpi-evidence-browser` and `erp-sales-parser` (the row now has `description`).

## «استيراد عروض الأسعار من ERP» (2026-11-11, shipped in release update-targets-hub-20261111, no migration)

- **Asked.** The owner uploaded the ERP's quotations report («Reports_Invoices_10.xls») and asked for it to be imported into «عروض الأسعار»;
  then asked for the sales, quotations and collections uploads to sit together on the targets page.
- **Where and who.** A button «استيراد عروض الأسعار من ERP» on the targets page beside «استيراد مبيعات ERP» (`app/sales-workspace.tsx`,
  component `ErpQuotesImport` of `app/erp-quotes-import.tsx`, props `{onClose, onImported}` as `ErpSalesImport`); nothing new on
  «عروض الأسعار». Whoever may import ERP sales AND add a quotation (the sales workspace roles, «المبيعات» and «عروض الأسعار» not hidden,
  «استيراد» on «المبيعات» and «إضافة» on «عروض الأسعار» on): `GET/POST /api/erp-quotes` (`lib/erp-quotes-server.ts`), 401 / 403 / 404 as
  the other routes, body bounded like the sales import's (a 5 MB file as base64, 7.5 MB request).
- **The file** (`lib/erp-quotes.ts`, pure). The ERP's «.xls» is an HTML table in UTF-16LE (closed by a second `<TABLE>`), 197 columns, one
  row per quotation LINE; read by an allow-list reader (table and layout elements only, attributes ignored, rows/columns/cells/elements
  bounded; `<script>`, `<img>`, `<a>`… refuse the file); the same columns as .xlsx are read through `readWorkbookSheets` (which gained a
  `maxColumns` option, 100 by default as before). A row whose `Trans_Type_Code` is not «Qut» refuses the whole file, naming the row. The
  meanings were checked on the owner's file: `Total` is the line's net (Qty × Price − Discount_Amount), `Subtotal` the document's net
  (Σ Total − Discount_Amount_M), `VAT_AmountM` its VAT, `NewSubtotal` its total with VAT (`NewTotal` is per line); 38 of 38 add up.
- **The record.** Each quotation (grouped by `Code`) is ONE `quote` record directly under its customer (by its ERP code,
  `uniqueCustomerCodes`; no customer is ever created), assigned to the representative its ERP employee (`Emp_Code`) is mapped to (the ERP
  sales import's mapping table, by a unique full name otherwise, or chosen; a choice is saved with the import, a saved mapping is changed
  only from the sales import), in the customer's branch, number = `Code`, date = `Date1`, valid until = `Expiration_Date` (the date when
  missing or earlier), status «مرسل», items with the ERP description, code, category and unit, the line and document discounts as the
  quote's discount, `taxRate` = `VAT`, terms from payment terms, delivery and note, and the ERP's own subtotal (gross), tax and total; when
  the CRM's `quoteTotals` differs by more than a halala the ERP's figures stay and `_erp.totalsDiffer` says so (0 of 38 on the owner's
  file). More than 50 lines, mixed header fields, another currency or figures that do not add up: refused with the reason.
- **Idempotent.** The record id is derived from the quotation number; the same file again is «بلا تغيير»; a newer export updates the same
  record (one «تعديل» history line, before and after in the import's audit line); a quote edited by hand since the import (its fields no
  longer what the import wrote) is «عُدِّل في الـCRM، تُرك كما هو»; nothing is deleted. A signed, 15-minute preview; the import recomputes
  it, gates every write on one claim (member, permissions, mapping revision, representatives, versions) and a request id makes a retry
  return its first answer. One audit line per import.
- **Everywhere quotes are.** `/api/crm` lets an imported quote be edited (it keeps its customer, representative, marker and number;
  schemas.quote keeps an item's optional code/category/unit); the quote sheet shows its ERP source and item codes; printing adds the code
  and unit columns (and drops the machine line when there is none); the customer's sheet lists its quotations; CSV export and the KPI
  evidence see them as any issued quote.
- **Tests.** `tests/erp-quotes.mjs` (default gate), `tests/erp-quotes-http.mjs` (release build), `tests/erp-quotes-browser.mjs` (Chromium:
  computer and 360 px phone, Arabic and English), `tests/erp-quotes-workbook.mjs` (gate `erp-quotes-workbook`, the owner's file via
  `ERP_QUOTES_WORKBOOK`, counts only); `/api/erp-quotes` in `tests/server-authorization.mjs`.
- **Rollback.** Code only: the imported quotes stay as quote records under their customers (the older release lists and prints them; its
  edit form asks for an approved mold request and refuses to save them).
## The targets page as one hub, and the ERP collection statement (2026-11-11, update-targets-hub, no migration)

- **Asked.** The owner, with a picture of the page: «عايز المبيعات وعروض السعر والتحصيل فى صفحة المستهدف زى كده».
- **One hub** (`app/sales-workspace.tsx`, `lib/targets-hub.ts`, `app/targets-hub.css`): «المستهدفات والنتائج في مكان واحد», five tabs in the
  owner's order — «نتائج الأداء» (the company and branch gauges, the summary cards and the evaluation), «رفع المبيعات» (the sales list, the
  sale registration and «استيراد مبيعات ERP», exactly as the sales page), «التحصيل» (each person's collection evidence and the new import),
  «عروض الأسعار» (each person's quotations evidence; `quotesImportSlot` is where the ERP quotations import mounts after its merge),
  «المستهدفات والأوزان» (the targets and weights editor) — and one month picker «شهر المستهدفات والأداء» for all of them. A tab is shown only
  to whoever may use it today («رفع المبيعات» follows the «المبيعات» screen); the address (`?tab=`) and the browser remember the tab, so a
  reload stays on it. The sales page («المبيعات») is unchanged. Permissions unchanged.
- **«تحقيق المستهدف — الشركة والفروع»** (`lib/targets-overview.ts`, `app/targets-overview.tsx`): a gauge for the company and each branch with
  «تفاصيل الفئات» (product by product). A branch's target is the sum of its people's own targets in the month (the people of the
  distribution table), unless the branch has a saved target of its own; the company's is the sum of the branches; achieved is the same
  people's confirmed sales (CRM and ERP, returns deducted); the gauge is the weighted achievement (`quantityAttainment`: capped at 100% per
  product, company weights). For the month only, for the administrator and sales managers over every region (who read branch targets).
- **«استيراد كشف التحصيل من ERP»** (`lib/erp-collections.ts`, `lib/erp-collections-server.ts`, `app/api/kpi-evidence/import`,
  `app/erp-collections-import.tsx`): the ERP's «كشف حساب» (UTF-16LE HTML saved as .xls; UTF-8 HTML and .xlsx too) with its ten columns. Per
  account: collected = «حركة الفترة دائن», due = max(0, «الرصيد السابق مدين» − «الرصيد السابق دائن») + «حركة الفترة مدين»; it belongs to
  «المندوب», else «المحصل»; «مبيعات مكتب» is left out; a row whose current balance is not previous + period is counted and reported. The file
  has no dates, so the importer chooses the month (the hub's by default). Names are mapped by the full name, then by the ERP sales already
  imported under that name, then by an earlier import's choice, or chosen in the preview. «اعتماد» writes each mapped representative's
  `collection {dueCents, collectedCents, reference «كشف حساب ERP · <file> · <day>»}` of `crm_kpi_evidence` and nothing else, in one
  transaction gated on the evidence revision; a value already there is marked «سيستبدل القيمة الحالية (… / …)» and replaced only when
  confirmed; the same file twice writes nothing; a repeat of the same request (`requestId`) is answered from the first. Rights: those of
  saving the evidence by hand (the page's «تحرير», the administrator or a sales manager, their team and regions); a finished month only by the
  administrator (recorded). One audit line for the import (counts, each representative's before → after, the name mappings) and one on each
  representative's evidence record.
- **Tests.** `tests/erp-collections.mjs` (default gate: parser, formula, office, unmapped, Arabic digits, encodings, refusals, the gauges'
  arithmetic, the remembered tab), `tests/erp-collections-http.mjs` (release-build), `tests/targets-hub-browser.mjs` (browser),
  `tests/targets-performance-ui.mjs` rewritten for the tabs; the browser tests that open the targets page click the tab they need
  (`targets-audit-browser`, `targets-decisions-browser`, `kpi-evidence-browser`, `app-browser-workflows`); `/api/kpi-evidence/import` in
  `tests/server-authorization.mjs`.
- **Rollback.** Code only; the collection the import wrote stays as KPI evidence the previous build reads and edits by hand.

## Word order on the signature page, and Modern Standard Arabic throughout (2026-11-11, same release, no migration)

- **Asked.** The owner: «الكلام فى التطبيق بالفصحى مش مصرى عامى»; and the signature page drawn as a picture showed mixed lines in a confusing
  order («كود ERP: ERP-east1», «رسم القالب.pdf» with the dot of «.pdf» on the far side, «عرض سعر Q-77.pdf — صفحات 1–2»).
- **Word order, as cells** (`lib/sign-page-canvas.ts`): a fact is a label cell at the start side and a value cell with its own direction
  (its first strong character, as `dir="auto"`); a document is a row of kind | file name (its own direction: an Arabic name in the
  platform's standard order) | pages («صفحات 1–2», never wrapped, the numbers in LRI…PDI). On the canvas each cell's line is ONE
  `fillText` with the canvas's direction set to the cell's, a long value wrapping inside its cell only (`drawSignaturePage` for the
  signature page, `labelValueRow` for the signature block); the screen's signature page is the same grid of cells, and the captions
  under each page are two pieces («عرض السعر» · the name with `dir="auto"`). A first attempt that cut mixed lines into hand-placed runs was
  replaced before release (it split «كود» from «ERP» and put a range on a line of its own).
- **Modern Standard Arabic.** Every Arabic text the application shows (screens, buttons, hints, the server's messages, the signing pages and
  link, the signature page and block, ERP import, permissions, targets, the team's day, trash, install and update notes) was rewritten from
  Egyptian colloquial («اللينك ده مش شغال», «هيتبعت», «اختار») into MSA («هذا الرابط لم يعد صالحًا», «سيُرسل», «اختر»); `lib/locales/en.json`
  keys follow (English unchanged). Stored values, enum values, production's file names (« - موقّع.pdf») and the ERP column names are unchanged.
- **Tests.** `tests/msa-wording.mjs` (default gate: every Arabic string literal and JSX text of `app/`, `lib/`, `portable/`, `components/`,
  the dictionary's keys and the update notes, against a list of colloquial words and verb forms; a line holding Arabic the scanner did not
  read fails it), `tests/sign-page-canvas.mjs` (default gate: the cells on a recording canvas), `tests/sign-page-bidi-browser.mjs` (Chromium: the
  app's drawing on a real canvas, the cells' places and what the pixels show), and the cell layout of the screen at 360 and 320 px in
  `tests/mold-pdf-view-browser.mjs`. Every test that asserted the old wording asserts the new one.
- **Rollback.** Code only (the previous build's wording and drawing come back).

## The customer signs ONE document, as on paper (2026-11-11, no migration)

- **Asked.** The owner, after seeing the release of 2026-11-10: «لا انا قلتلك التوقيع يكون داخل pdf يعنى pdf يتفتح ويكون عبارة عن عرض السعر او po وبعدين التصميم وفى اخره خانة للتوقيع بحيث الموقع يكون عارف هو بيوقع على ايه كأنه بيوقع على ورق حقيقى»; asked what is kept and sent, he chose ONE signed file «طلب القالب - موقّع.pdf» with every page and the signature page at its end, sent with the originals as they are, and no per-file copies for new signatures.
- **One document on screen** (`app/mold-document-viewer.tsx`): on the device step and the link page the quotation's pages, then the PO's, the design PDFs' and each picture as a page, in the signing's order, white A4-like sheets one under another, ONE counter («صفحة n من N», N with the signature page), a discreet caption under each page, «تكبير», lazy drawing and the memory caps as before (pdf.js to canvas). What is in it is decided as the server builds it (`lib/mold-signed-document.ts`): the browser counts each PDF's pages with pdf-lib (the server's library and version, a lazy chunk of `lib/pdf-viewer-loader.ts` `loadPdfLib`), keeps each page's shape from it (nothing moves under the pad), and names on the signature page a PDF it cannot open, a GIF or WEBP picture, a PNG over 20 million pixels and every other file.
- **The signature page** (`app/mold-signature-page.tsx`) is the last sheet: «إقرار وتوقيع العميل», the request's summary (as text now: the PNG prints it), «المستندات في هذا الملف» with each document's page range, «ملفات مرفقة مش معروضة هنا», the consent sentence, the signer's name and the pad inside its box, the moment in Riyadh. On signing the browser composes it as an A4 PNG of 1240 × 1754 (`signaturePagePng`), sent with the documents it lists (`signature.document: {page, parts}`, beside the block of 2026-11-10, now only the fallback's).
- **One signed file** (`lib/mold-signed-pdf.ts` `buildSignedDocument`, `lib/mold-sign-server.ts` `makeSignedDocument`): every page of the listed PDFs copied as it is (rotation and crop kept), each picture an A4 page (`imagePageLayout`), the signature page last; «طلب القالب - موقّع.pdf», id `mdc-<signature>-doc` (`moldSignedDocumentId`: takes no originals' place, not deletable), the first document's category (the page sends it too, so a quotation it named only still makes it a quotation's file: `moldSignedDocumentCategory`), sent like any file, audited `mold-design:signed-document`. The server builds from exactly what was shown: each part is found by SHA-256 and category, and a count of pages that differs is refused — from the link before the signature is saved (409 «الطلب اتعدّل، افتح اللينك تاني», as for a changed request), on the device (whose files upload after the save, the file being made when the last one arrives) by making the per-file copies instead. Over 25 MiB (`MOLD_DESIGN_MAX_BYTES`): the per-file copies instead. Production keeps no «signed copy» mark (an extra key is ignored), so there the signed file takes one place of its category (quote 10, PO 10, design 20): the CRM counts its files and production's before making it, and with no place left makes the per-file copies instead where their categories have room; production refusing it once sent (413, or too_many_files) does the same (`signedDocumentRefused`, called from `sendMoldDesignFile`). A retry sends the same crmFileId and the stored, byte-identical file. It is made at signing (link, sheet) or with the last upload (a new request), so with the request and before any approval. Said on the sheet (`MoldSigningView.document`).
- **Checks.** `moldSignaturePageCheck` (a whole PNG, A4 within 1%, 1000–1800 px wide, 1 MiB), `moldSignedDocumentParts` (20 documents, 2000 pages); body limits 2 330 000 (`/api/mold-requests`) and 2 300 000 (`/api/mold-sign`) bytes; the receipt keeps the page as its hash.
- **Production's signed flag (schema 19, yourrest-products#52, not live yet).** `moldDesignFileBody` takes `signed`; `sendMoldDesignFile` sends `"signed": true` with a signed copy or the signed document only once `mold-signed-flag` is known (`noteMoldSignedFlag`: learned from any file object of production's carrying the boolean, in a status object, a pending item or design-files' answer; `moldSignedFlagAnswered`); an older application never receives the key. `moldDesignFileEntry` reads `signed` (a boolean only) and the sheet marks such a file «نسخة موقّعة». A signed file still takes a place of its category. The stand-in's `signedFlag` option (and `setSignedFlag`) carries `signed` on its file objects and refuses a non-boolean (400 fields ["signed"]); without it the key is ignored, as today.
- **Old data and old pages.** Requests signed before keep their per-file copies. A page of the previous release signing the old way (no signature page) is still accepted on the device and from the link, with the per-file copies.
- **Products contract.** Production's name rule (`yr_mreq_file_name`: 1–200 characters, none of `\ / < > : " | ? *`, no direction marks, not ending with a dot or a space, an allowed extension; no comparison with an original's name), a PDF of 25 MiB at most in any category with its own crmFileId: «طلب القالب - موقّع.pdf» passes in the real application and in `scripts/lib/products-mock.mjs`; nothing for the products team. The stand-in was brought closer to the real one: it refuses the direction marks in a name, takes a design-files body of 25 MiB + 8 KiB (was + 64 KiB), and gained `answerNextFile` (a one-shot answer for one crmFileId) for the tests.
- **Tests.** `tests/mold-signed-document.mjs` (default gate), `tests/mold-sign-document-http.mjs` (built release), `tests/mold-pdf-view-browser.mjs` rewritten (Chromium: phone 360 in the Android stand-in, tablet, desktop, Arabic and English; the 7-page document and file, the 30-page PDF); `tests/mold-document-view.mjs`, `tests/request-body.mjs`, `tests/mold-requests-http.mjs` updated. Guide: `docs/UPDATE-2026-11-11-SIGN-DOCUMENT-AR.txt`.
- **Rollback.** Code only. The previous release shows a signed file as an ordinary file of the request, makes the per-file copies of a signature whose file was not made yet, and refuses a stale page's link signature carrying the document (its schema is strict: the customer opens the link again).

## «تصنيف العميل» (renamed, «خدمات» no longer offered) and the new «نوع العميل» (2026-11-11, no migration)

- **Asked.** The owner (2026-11-10): «فى بيانات المصنع خلى نوع العميل تصنيف العميل وشيل خدمات من الاختيارات، ضيف نوع العميل (مصنع-مؤسسة / شركة-محل تجارى)»; his answers: four types (مصنع، مؤسسة، شركة، محل تجاري), and a customer already classified «خدمات» keeps it, shown, while nobody is offered it any more.
- **«تصنيف العميل»** is `data.customerType` relabelled (values unchanged in storage; English «Customer classification»): the customer form (`app/customer-entry-fields.tsx` `CustomerClassificationFields`, used by the customers page, the map and the visit form's new customer), the customer sheet and the visit form's customer card (`app/crm-app.tsx`, `app/customer-visits.tsx`) and the CSV export header. `lib/customer-options.ts` `customerTypes` no longer lists «خدمات» (`retiredCustomerTypes`); `choicesWithCurrent` keeps a customer's own stored value that is no longer offered shown and chosen in its form only, so an unrelated edit never wipes it, and choosing another value replaces it. The server never checked the classification against a list (free text, `short`), so dropping «خدمات» is UI-only and a stored one is never refused.
- **«نوع العميل»** is the new optional `data.customerKind` (`customerKinds`; English «Customer type»): next to «تصنيف العميل» in the form, on the sheet, on the visit form's customer card and as a CSV column after it. Checked on the server (`lib/crm.ts` `customerKindField`: one of the four or empty, trimmed; anything else, a number included, 400 «اختار نوع العميل من القائمة: مصنع، مؤسسة، شركة، محل تجاري») in `schemas.customer` (POST /api/crm, the ERP and one-time imports) and `serviceCustomerSchema` (the administrator's new customer with a customer-service request). Optional in `schemas.customer`: a save that leaves it out (a page or an offline save from before this update) keeps the stored value (`app/api/crm/route.ts`), an empty value clears it. Audit and version as any edit. The customers list has no filter by classification, so none was added for the type; the products application's customer list (`lib/mold-customers*.ts`) is unchanged.
- **Tests.** `tests/customer-kind.mjs` (options, the retired value kept, validation in both schemas, labels, export, English, the products contract), `tests/customer-kind-http.mjs` (built release: with and without the field, 400 and nothing written, an old page keeps the stored type, «خدمات» unchanged on an unrelated edit, customer service), `tests/customer-kind-browser.mjs` (Chromium, phone 360, Arabic and English: the two groups, the legacy value on its own customer only, saving), `tests/customer-entry-fields-ui.mjs` (15 choices).
- **Rollback.** Code only. The previous release labels the field «نوع العميل» again, offers «خدمات» again, shows no type and drops `customerKind` from a customer it edits (its schema does not know it).

## Targets: the four decisions of the audit (2026-11-10, no migration)

- **Asked.** The owner, on the audit's «محتاج قرار منك» list: «نفذ 1 و2 و3 و4».
- **1. Finished months.** A month before the current one (Riyadh) keeps its targets: products, customers and visits, weights and the branch target are refused to everyone but the administrator (403, «الشهر ده خلص؛ تعديل مستهدفاته لمدير النظام بس», nothing written; a save already recorded is still answered); the page shows it read only with that note. The administrator still edits it and the audit marks the change `closedMonth`. KPI evidence and the evaluation entry are not locked (`lib/targets.ts` `targetMonthClosed`, `canEditTargetMonth`; `lib/targets-server.ts` `saveTargetSet`).
- **2. «سجل التعديلات».** A button under each person, the branch target and the weights opens who / when / month / before → after, newest first, twenty a page (`GET /api/targets/history`, `targetHistory`, `lib/targets-history.ts`), with the same read scope as the targets. No new table: the rows crm_audit already holds; a save now also keeps what it replaced (`before`); older rows show the saved values with «تفاصيل غير متاحة».
- **3. Phone.** At 480 px and under, «توزيع المستهدفات» and the customer and visit table become one card per person (target / achieved / % per product, activity targets, edit buttons where allowed, history); tablet and desktop keep the table.
- **4. The administrator.** Left out of the targets tables, cards, KPIs, exports and picker of a month with no target effective and no confirmed sale of theirs (`hiddenAdminIds`, `hiddenFromTargets` in `/api/sales`). Totals unchanged: team roll-ups never included the administrator and the distribution counts targets only.
- **Tests.** `tests/targets-decisions.mjs` (default gate), `tests/targets-decisions-http.mjs` (built release), `tests/targets-decisions-browser.mjs` (Chromium); `tests/targets-audit-browser.mjs` and `tests/targets-export.mjs` updated. Guide: `docs/UPDATE-2026-11-10-CUSTOMERS-TARGETS-AR.txt`.

## «المستهدفات وتقييم الأداء» audited whole: what did not work is mended (2026-11-11, no migration)

- **Asked.** The owner (2026-11-10): «كمل المستهدفات صلح اللى مش شغال فيها», then «افحص الصفحة كلها».
- **Tried** on the built release with synthetic data, by the administrator, the sales manager, the supervisor, a representative (on the Android app emulator) and customer service, Arabic and English, a 360 px phone and a desktop: every number against a hand calculation (per product and weighted attainment, the supervisor's and the sales manager's roll-ups, the overall score once the evidence and the assessment are in), CRM sales with a voided one, ERP sales with a return, the first day of the month and the last of the previous one, customers created either side of midnight in Riyadh, the refusals by role, a replayed save, a stale version, a cleared quantity, the branch distribution, a future month, the weights dialog, both exports. The formulas, the rights and the scope were right and are unchanged.
- **Mended.** The product gauge of a summary card wrote six decimals (54.545455% beside 54.55%): two now (`shownAchievement`, `lib/targets-performance-summary.ts`). «تصدير كل المستهدفات» wrote `branch:<name>` and `company` for the branch target and the weights, and left out what the tables show for a person with nothing saved (the default customer and visit targets, «غير محدد» products): now named as the page names them and complete (`targetsCsvRows`, `lib/targets-export.ts`). «تصدير التقييم» had the indicators and no overall line: each person now ends with «درجة التقييم الكلية» (score or empty while incomplete, points, evaluated / applicable weight; `performanceCsvRows`). `app/sales-workspace.tsx` exports through both.
- **Left for the owner** (`docs/UPDATE-2026-11-10-CUSTOMERS-TARGETS-AR.txt`): 0% in «مستهدفي» against «غير مكتمل» for management; a teammate's sale making a rep's unknown product known for the supervisor; no zero activity target; editing past months; the target history saved but not shown; the distribution table on a phone; the administrator listed as a seller.
- **Tests.** `tests/targets-export.mjs` (default gate), `tests/targets-audit-browser.mjs` (built release, Chromium, every role; screenshots).
## Mold requests: the customer reads the PDFs on the signing screen and signs in a box at their end (2026-11-10, release `update-pdf-sign-20261110`, no migration)

- **Asked.** The owner, after seeing `update-team-20261110`: «لا انا قلتلك يوقع داخل pdf», then «ملف pdf يظهر على الشاشة فيه عرض السعر او po + التصميم وخانة فى الاخر العميل بيوقع داخلها».
- **The viewer** (`app/mold-document-viewer.tsx`, `app/mold-document-viewer.css`, rules in `lib/mold-document-view.ts`): on both signing screens the request's own files themselves, the quotation's first, then the PO's, then the design's, each in the order attached (`orderViewerFiles`), under a heading «عرض السعر: <name>» / «PO: <name>» / «التصميم: <name>» with its page count; every page of a PDF drawn by pdf.js on a canvas the width of the screen with «صفحة n من m» and a thin line between pages (the Android app's WebView shows no PDF in a frame); a picture as it is; any other file a row «ملف <name> (مش PDF) — هيتبعت للإنتاج زي ما هو» (with its download where the screen already offers one: the device, for an uploaded file). «تكبير» draws one page twice as wide inside its own frame (scrolled sideways there; the page never scrolls sideways). Loading per file and per page; a file that cannot be shown (damaged, protected, not downloaded) says «ما قدرناش نعرض الملف ده» and «التوقيع ممكن برضه؛ الملف هيتبعت للإنتاج زي ما هو.» in its place; signing is never blocked.
- **Memory and speed.** A page is drawn within 900 px of the screen and its canvas given back beyond 2,400 px, two pages at a time, at the screen's width × its density (at most 2), never over 6 million pixels nor 4,096 a side (`viewerRenderSize`). The files are read one after the other (the CRM's file routes hold a few downloads at a time; a busy 429 is tried again). On the device the form's files are read from the device itself (the File objects, before their upload), an edit's or the sheet's uploaded ones through `/api/mold-requests/design-file`; on the link page through the token's file route (unchanged: inline, the file's type, its length; the viewer takes the whole file, so no range is needed). Measured: a PDF of 30 pages and 20 MB on a tablet with the processor slowed four times: its first page in about 1.2 s, at most 6 pages drawn at once, every page drawn when reached.
- **pdf.js** (`pdfjs-dist` 4.10.38, Apache-2.0; `lib/pdf-viewer-loader.ts`): the legacy build (older WebViews), loaded by the signing screens only, as a chunk of its own; its worker an asset of the build served from the CRM's origin (`?url`, `application/javascript`; the CSP the app sets restricts framing, objects and the base only, so a same-origin worker is allowed) and one worker per screen; were a worker refused, pdf.js runs the same file on the page by itself (its fake worker). The standard fonts (`lib/pdf-viewer-fonts.ts`) are assets fetched only when a PDF names a font it does not carry (`useSystemFonts` off: a phone's substitute drew such text with the wrong spacing). No script of a PDF is run (`isEvalSupported` off, no XFA). The canvas is left to right (`dir="ltr"`): inside the right-to-left screen pdf.js's glyphs were each drawn their own width too far. The offline shell does not carry pdf.js (`scripts/build-offline-shell.mjs` replaces the loader with `lib/pdf-viewer-loader.offline.ts`), so its cache is unchanged; the service worker caches nothing new.
- **The signature box** after the last document: «توقيع العميل» as the document's last block, with what is signed for (the summary that was at the top), the signer's name, the pad, «امسح», the confirmation (the consent too on the link page) and, on the device, «رجوع للطلب». The device's choice «العميل يوقّع دلوقتي» / «ابعت للعميل لينك يوقّع منه» comes before the documents; the link needs no viewer (`app/mold-signature.tsx`, `app/mold-requests.tsx`, `app/mold-sign-link.tsx`, `app/mold-sign-page.tsx`).
- **Server**: the link page also names the request's other files (`signLinkOtherFiles`, `SignLinkPage.others`: name and category only; never served through the link and not part of the page's key). Stamping, the signed copies, the limits, the hold and the sending are unchanged.
- **Tests.** `tests/mold-document-view.mjs` (the rules, the loading, the offline shell), `tests/mold-signed-pdf.mjs` (the link's files and other files), `tests/dependencies-runtime-baseline.mjs` (pdfjs-dist), `tests/mold-pdf-view-browser.mjs` (built release, Chromium: the device step in the form on a phone in the Android stand-in, the sheet's device step on a computer in English, the link page on a phone and a computer in Arabic and English, a tablet upright and on its side with a 30-page 20 MB PDF and a damaged one, a request with only a drawing); `tests/mold-sign-link-browser.mjs` updated to the page's documents; `scripts/lib/signature-pad.mjs` waits for the documents above the pad before drawing.
- **Not done.** Pinch zoom (the «تكبير» button instead); CMaps of pdf.js (only CJK PDFs without embedded fonts need them); text selection or search in the pages.
## «المحذوفات» for whoever has «حذف»: their own deletions, restored while the record's own cell is on (2026-11-10, release `update-team-20261110`, no migration)

- **Asked.** The owner (2026-11-10): «اللي اديته صلاحية الحذف من غير مدير المبيعات (مندوب أو مشرف) يشوف في «المحذوفات» اللي هو حذفه ويقدر يرجّعه بنفسه، بدل ما يرجع لمدير النظام».
- **Who has the page** (`lib/permissions.ts` `trashScopeOf`, the one function for a member; `TRASH_DELETE_CELLS`): the administrator every deletion and the sales manager their own, by role and whatever their cells (`lib/access.ts` `trashScope`, unchanged); a supervisor or a representative their own deletions while at least one of `customer:delete`, `activity:delete`, `followup:delete`, `quote:delete` is on for them (`sales:delete` is not one: a voided sale is an «إلغاء بيع» entry and stays in «المبيعات», never in the trash); customer service never (no «حذف» cell, a forged access included). Cells all off again: no page, their deletions stay for the administrator. `canViewPage(role,'trash')` is now the role's ceiling (administrator, manager, supervisor, representative) so the matrix offers «استعراض» and «تحرير» of «المحذوفات» to the supervisor and the representative; `pageAllowed` adds `trashScopeOf`, and `resolveCRMPage` takes `trashOpen` (default: the role's own), so a bookmark of `#trash` opens only for whom it is open.
- **Restoring** (rule 2, `lib/trash-server.ts`): a supervisor or a representative (`restoreRights`) restores only their own deletion (`notYours` as before), only while the record's own cell, the one its deletion needed, is on (`trashRestoreCellOff` over `recordCell`: a visit «الزيارات · حذف», a follow-up or an old thread «المتابعات · حذف», a customer «العملاء · حذف», a quotation or mold specifications «عروض الأسعار · حذف», a machine «العملاء · تحرير»; refused 403 `trashCellOff`, «استرجاع السجل ده محتاج صلاحية «حذف» في الزيارات، وهي مش مفتوحة لك دلوقتي. راجع مدير النظام.»), and within what they may delete now: `recordDeleteGuard` (and `masterMutationGuard`, `recordEditGuard`, `accessGuard`) take `{restoring:true}`, which keeps every check of the deletion's scope (a representative's own visit or follow-up of a customer in their regions, a customer assigned to them; a supervisor's team) and drops only the conditions on the record's own row, which the restoration's insert gates on instead; a refusal is 403 «السجل خارج نطاق صلاحيتك». Its SQL is ANDed to the existing gate, so the commit re-checks the member, the permissions' version (a cell switched off meanwhile fails it: 409 «تغيّرت البيانات أثناء الاسترجاع…») and the reporting line. The cell is checked after the replay, so a lost answer's retry still gets its receipt. The list says the same refusals on each card (`blocked`, in the restoration's order: the cell, the record already there, the parent first, the scope), the scope decided over the lineage the list already reads. The sales manager and the administrator restore exactly as before; the existing refusals (parent first, number taken, already restored, broken entry) are unchanged.
- **Matrix**: `trash:edit` (restore) now has the supervisor and the representative in its ceiling (restrict-only, on by default; switched off, they list without restoring), with notes; the row carries `roleNote` drawn under its name for those two roles: «لمن عنده «حذف»: اللي حذفه هو بس» (`app/member-permissions.tsx`, `.permission-row-note`). Copying from a sales manager to a supervisor now copies «المحذوفات» too (no longer skipped).
- **Page**: the sidebar and «المزيد» show «المحذوفات» through `pageAllowed`; the intro adds, for a supervisor or a representative, ««استرجاع» متاح طول ما «حذف» شاشة السجل مفتوح لك.»; a refused card shows why with «استرجاع» disabled. The delete confirmation keeps «يمكن استرجاعه لاحقًا من «المحذوفات».» only for whoever has the page, otherwise «مدير النظام يقدر يسترجعه لاحقًا من «المحذوفات».» (`app/crm-app.tsx`, `trashOpen`).
- **Server**: `GET`/`POST /api/trash` answer 404 «هذا الجزء غير متاح لحسابك. راجع مدير النظام.» to a member without the page or with it hidden (`requireTrashPage`; before, 403 for the supervisor, the representative and customer service: 404 never locks the offline session); `TRASH_TEXT.forbidden` is gone.
- **Tests.** `tests/trash.mjs` (who has the page by role and cells; own-only lists of a representative and a supervisor; restore allowed, refused when the cell is off after deleting, at commit, for another member's deletion, out of their regions, out of the supervisor's team; the receipt after the cell went off; a child waiting for its customer; «استعراض» and «تحرير» switches; the manager and the administrator as before), `tests/trash-http.mjs` and `tests/server-authorization.mjs` (built release: 404 without «حذف», the granted representative's list and restoration, refusals), `tests/permissions.mjs`, `tests/permissions-ui.mjs` (the row and its note, ceilings, copy), `tests/mobile-navigation-ui.mjs` («المزيد» with and without the cell, hidden), new `tests/trash-own-browser.mjs` (Chromium: the administrator grants on the desktop in Arabic; the representative deletes and restores on a 360 px phone in Arabic and on the desktop in English; another representative has no item and 404; the other confirmation words; the English matrix on the phone). Guide: `docs/UPDATE-2026-11-10-TEAM-AR.txt`, section «المحذوفات لمن عنده حذف».
## «عملاء واقفين» and «فريقي النهارده» (2026-11-10, no migration)

- **Asked.** The owner (2026-11-10, items 3 and 4): «فلتر «لم يشترِ منذ 60 يومًا» يتحول لتنبيه يوصل لكل مندوب بعملائه اللي وقفوا، ومشرفه يشوف العدد.» and «ملخص يومي للمشرف: شاشة فيها مين من فريقه زار النهارده وكام زيارة، ومين ما بدأش يومه، ومين ما قراش ملاحظاته.»
- **«عملاء واقفين»** (`lib/inactive-customers.ts`, `app/inactive-customers.tsx`): the rule is the customers page's filter «لم يشترِ منذ 60 يومًا» unchanged (`inactiveCustomer`: status «نشط» and no purchase in 60 days, from `data._lastPurchase` of GET /api/crm), worked out on the page from the rows it already holds and refreshed with its normal load; no route. A representative: a card on their first screen («الزيارات»: they have no dashboard) «عملاؤك اللي ما اشتروش من 60 يوم: N» with «اعرضهم» (the customers page with the filter and a new «عملائي بس» chip on: the customers assigned to them only; a state of its own, `ownOnly`, never the staff filter, which must never narrow a representative's lists: `tests/role-ui.mjs`), and an amber badge with its own words on «العملاء» (sidebar and the phone's bottom bar). The administrator, a sales manager or a supervisor: a card on the dashboard «عملاء واقفين في فريقك: N» with one button per member of their team (`salesScopeMemberIds` with `read`, so «عرض بيانات الفريق بالكامل» widens it read only; the reader included when customers are assigned to them; an inactive member marked), most first, eight then «عرض الكل»; a name opens the customers page filtered to that member with the filter on. No badge for them. Customer service, or a member whose «العملاء» is hidden: nothing. Zero: no card, no badge. No phone notification (it would need a new APK).
- **«فريقي النهارده»** (`lib/team-today.ts`, `lib/team-today-server.ts`, `GET /api/team-today`, `app/team-today.tsx`, `app/team-home.tsx`): on the dashboard of whoever reads «تقرير يوم المندوب» (the administrator, a sales manager, a supervisor), hidden with that screen. One row per active representative of the reader's day report (`trackingMembers`: the read scope, the hierarchy and the regions), and another sales member only on a day they did something (a supervisor who visits); never the reader. «زيارات النهارده» and «تواصل آخر» are the day report's «زيارات مسجلة» and «تواصل آخر مسجل» (activities dated today in Riyadh, by type). «بدأ يومه؟» is the earlier of the day report's «أول حركة مرصودة» (`buildDailyReport` itself, run on that member's tracking days and route stops of today) and the first visit or contact recorded today, else «لسه ما بدأش»; the phone's tracking day (`dayStartedAt`) was not used: the Android app opens it at 06:00 whenever the phone is on. «ملاحظات مش مقروءة» counts the notes on that member's work (visit and day notes) not marked «قرأت», over the 30-day inbox window, the member's own card's rule. «تقرير اليوم» opens the day report on that member (`JourneyReport` `initialMemberId`), and the day report links back («ملخص فريقي النهارده»). Not started first, then the fewest visits; header «بدأوا N من M · زيارات X · ملاحظات مش مقروءة Y»; a note on the Friday off and before 6 AM. Asked on opening, every 5 minutes while the page is in front, on coming back to the front at most once a minute, never offline. The route: signed in (401), a sales role (customer service 403), the day report's roles (a representative 403), the screen not hidden (404, which does not lock the offline session), GET only, `no-store`; names, counts and times only.
- **Shared files touched (small):** `app/crm-app.tsx` (the nav badge prop, `ownOnly` and `journeyMember` reset by `go`, one line for the cards on the first screen, the «عملائي بس» chip, the link and the member of the day report), `app/mobile-navigation.tsx` (the badge), `app/journey-report.tsx` (`initialMemberId`).
- **Tests:** `tests/inactive-customers.mjs`, `tests/team-today.mjs` (the route compiled on an in-memory SQLite, a fixed clock around Riyadh midnight, and the same numbers as `GET /api/journeys`), `tests/team-home-ui.mjs`, `tests/team-today-http.mjs` (built release), `tests/server-authorization.mjs` (extended), `tests/team-home-browser.mjs` (Chromium, phone 360 and computer, Arabic and English). Guide: `docs/UPDATE-2026-11-10-TEAM-AR.txt`.
## Mold requests: finance returns a request to sales, and the CRM corrects it (2026-11-10, no migration)

- **Asked.** The products application's update of 2026-11-10 (schema 17; the message `docs/MOLD-PRODUCTS-MESSAGE-2026-11-10-AR.md`, their reply in the contract's section «رد فريق المنتجات»): finance sends a request waiting for it back to the sales manager with a reason; the CRM corrects it through the same `requests` route.
- **Read** (`portable/mold-rules.mjs` `moldReturned`, in the status object and the pending item only when the answer carries the key): `returned` `{by: 'finance', name, reason, at, correctedAt}` or null; a request is returned while production says so and nobody cancelled it (`moldReturnedNow`). Audited «رجّعته المالية» (`mold-request:returned`) once for each return, when first seen.
- **Shown**: the card «رجّعتها المالية: <السبب>», the list's filter «رجّعتها المالية» with its count, the sheet and «طلبات بانتظار اعتمادي» «رجّعته المالية (<name>): <reason> · <time>» with what comes next for the reader, and «اتبعت التعديل للإنتاج» once corrected.
- **Corrected** by its requester only (`can.correct`, «تعديل وإعادة الإرسال»): the same form and checks; a change of what the customer signed needs a new signature, on the device or from the customer's link (the correction is held until the customer signs; `customer_signature` no longer needs a never-sent request, in TS and SQL); new signed copies; sent with the original `requestedAt` and the terms; saved only while the stored status still says returned and not cancelled; audited «تعديل طلب القالب بعد إرجاع المالية وإعادة إرساله». Production answers `corrected: true`, the same body again `corrected: false`; a request not returned, or returned and cancelled, is refused as before (409).
- **Stand-in** (`scripts/lib/products-mock.mjs`): `nov10` / `setNov10` (the application of today, or after its update exactly as the reply says), `financeReturn`, and each call's answer kept (`call.answer`).
- **Tests.** `tests/mold-nov10.mjs`, `tests/mold-nov10-http.mjs`, `tests/mold-nov10-browser.mjs`.

## Mold requests: a deferred payment's agreed terms, and the sales manager's acknowledgement (2026-11-10, no migration)

- **Asked.** The owner: a deferred request names the agreed terms (three: an advance, the rest before shipping / after shipping / on a credit limit), and the sales manager's approval comes with «تمت الموافقة على التصنيع بشروط الدفع المذكورة وقت الإستلام».
- **Terms**: `paymentTerms` in the create and update bodies, required with deferred (none at all: a page loaded before, «حدّث الصفحة واختار طريقة الدفع المتفق عليها»), refused with cash, stored in `data.paymentTerms`; part of what the customer signs (the signing summary, the link's page); on the card, the sheet and the waiting list.
- **Sent** right after `payment` only once the CRM has seen `paymentTerms` and `returned` in a status object or a pending item (`crm_settings` `mold-nov10`, learned once); before that, kept in the CRM and the audit. Whether a request's sends carry them is decided at the first send that may reach production and kept (`data.termsSent`), so every resend is the same bytes; a request refused at production's door before takes them on its next send.
- **Acknowledgement**: a box before «اعتماد» on the sheet and the list (the button waits for it); the server requires `termsAccepted: true` (none: 409, refresh; false: 400 by its field); audited with its words; sent to production with the approval once the update is known; `approvals.sales.termsAccepted` read back («وافق على شروط الدفع»).
- **Files**: production's limits are 20/10/10 now; the CRM keeps 10/5/5 for the originals, and a signed copy fits within production's limits (20/10/10 once known); a copy production refuses for its count stops nothing («ما اتبعتتش: الإنتاج رفض عدد الملفات»).
- **Tests.** `tests/mold-nov10.mjs`, `tests/mold-nov10-http.mjs`, `tests/mold-nov10-browser.mjs`; the existing mold tests send the acknowledgement and the terms as this release's pages do (`withSignature`, the browser tests tick the box).

## Mold requests: the customer's signature inside the PDFs, and a link the customer signs from (2026-11-10, no migration)

- **Asked.** The owner: «عايز توقيع العميل فى طلبات القوالب داخل pdf التصميم او عرض السعر او po» and «امكانية ارسال لينك بالpdf طلب القالب للتوقيع عليه»; chose every PDF (design, quotation, PO), the last page at the bottom with the signer's name and the date, a signed copy NEXT TO the original, and a request sent by link waiting in the CRM «بانتظار توقيع العميل» until the customer signs, then sent by itself.
- **Signed copies** (`lib/mold-signed-pdf.ts`, `pdf-lib` 1.17.1, MIT): the block (a PNG the signing browser composes: the drawing, «توقيع العميل: <name>», the moment in Riyadh; the canvas shapes the Arabic) stamped on the last page as displayed (rotation and crop box), bottom-left, 37% of the displayed width (capped at 30% of its height), the page's own content wrapped in `q … Q` first. `lib/mold-sign-server.ts makeSignedCopies`: each PDF of the request's design, quotation and PO files the customer saw (on the device: the SHA-256 of the files chosen in the form, `seen`, each copied as it is uploaded; on an edit, from the sheet or from the link: every PDF attached then) gets «… - موقّع.pdf», the same category, a fixed `crmFileId` (`mdc-` + original + signature: `moldSignedCopyId`), sent after its original; a protected or damaged PDF, a full category or a copy over 25 MiB gets none (a row of the copy not made keeps why: the sheet says «ما اتحطش التوقيع جوه <file>: …»), never blocking the request. Not deletable while the signature names them; an edit's new signature drops the old unsent ones. Production's side: no change (one more file of the category).
- **The link**: a third way at the signing step for the sales roles («ابعت للعميل لينك يوقّع منه»); the request is saved with `data.awaitsSignature` and held (`moldHeldFor` / `MOLD_HELD_FOR_SQL` `customer_signature`, after the files' reasons; `sending.held`; resend refused). A token of 32 random bytes (base64url), only its SHA-256 stored in `data.signatureLink` (14 days, one a request; a new link, the signature or the cancellation ends it); shown once with «نسخ اللينك» and «إرسال واتساب»; `action: signature-link` (`op: new|cancel`) and `action: sign` (the device instead) for whoever may edit the request.
- **Public page** `app/sign/m/[token]/page.tsx` (no session, `noindex`, no CRM navigation, Arabic and English): the request's summary, its PDFs and images through the token only (`app/sign/m/[token]/file/[fileId]/route.ts`), the signer's name, the pad, the consent, «توقيع»; `POST /api/mold-sign` (same origin, counted by address in `auth_limits`, 880 000 bytes): the page's key (the request's version and files) must still match («الطلب اتعدّل، افتح اللينك تاني.»), the signature stored as the device stores it (`via: link`, audited by the customer's name), copies made, the request and its files sent at once. Every refusal is one neutral page «اللينك ده مش شغال. اطلب من المندوب لينك جديد.»
- **Limits**: `/api/mold-requests` 910 000 bytes (the block), `/api/mold-sign` 880 000.
- **Tests.** `tests/mold-signed-pdf.mjs` (stamping: last page, size, every rotation, an unusual size, protected/damaged/non-PDF, pixels with `pdftoppm`; names, ids, block checks, holds, the signing view, tokens, the page's key); `tests/mold-sign-link-http.mjs` (the device path's copies, refusals and audit; the link path end to end, every neutral refusal, rights); `tests/mold-sign-link-browser.mjs` (360 px Arabic and English, the customer in a fresh browser, the signed copy rendered); the held-for TS/SQL comparison extended (`tests/mold-design-files-server.mjs`); `tests/server-authorization.mjs` (the public routes without a token).

## «الصلاحيات» per member, ERP-style: a screen × action table, «انسخ الصلاحيات من», hidden screens and «عرض بيانات الفريق بالكامل» (2026-11-10, release `update-permissions`, migration 0020)

- **Asked.** The owner (2026-11-09, «نفذ الاربعة», GSCO's #7): «جدول صلاحيات بشكل ERP: صف لكل شاشة، وأعمدة استعراض/إضافة/تحرير/حذف/تصدير/استيراد، وعمود «الكل». «انسخ الصلاحيات من» مستخدم آخر، وإخفاء أي شاشة عن أي حساب … مع مفتاح «عرض بيانات الفريق بالكامل».» Copied from GSCO 2.13.61 (`lib/crm/permission-matrix.ts`, `components/crm/permission-matrix.tsx`, `section-access.ts`, «انسخ الصلاحيات من» of `components/crm/forms.tsx`), adapted.
- **Model** (`lib/permissions.ts`, shared by the page and the server): `PERMISSION_MATRIX` (Yourrest's screens in the navigation's order; each action a cell with the roles that can do it today, its ceiling), `normalizePermissions`, `memberAccess` (`{version, off, hidden, viewAll}` sent as `me.access`), `can`, `cellRefused`, `pageAllowed`, `pagesBlocked`, `copyPermissions`, `recordCell`. **Restrict-only** (deviation from GSCO, which grants anything): a switch removes what the role does today, never more, with two exceptions: «عرض بيانات الفريق بالكامل» and «حذف» (below). A member without a saved row has the role's behaviour; a cell never saved is on, except a grantable «حذف» cell, off for everyone but the administrator. The administrator is never locked out: nothing hidden, the team cells fixed on.
- **Storage**: migration `0020_member_permissions` (`crm_member_permissions(member_id PK → crm_members ON DELETE CASCADE, permissions JSON object, hidden JSON array, version ≥ 1, updated_by, updated_at)`), not columns of `crm_members`, so the session-revoke trigger of 0009 never fires on a save. Schema 20 → 21.
- **Server** (`lib/crm-server.ts`): `context()` reads the member's row once (`me.access`); `accessGuard` re-checks `COALESCE(permissions version,0)` at commit, so a save meanwhile fails the write safe (409); `requirePages` (hidden → 404 «هذا الجزء غير متاح لحسابك. راجع مدير النظام.», never 401/403 which lock the offline session; a request closes only when every screen sharing it is hidden or not the role's) and `requireCell` (403 «مش مسموح لك ب<الإجراء> في <الشاشة>. راجع مدير النظام.», only within the role's ceiling, so other roles keep the routes' own messages). One line at each route, after a receipt replay where the route has one: `/api/crm` (`recordCell`: customer, its machines, visits, follow-ups, mold specs and quotations; members), `/api/visits`, `/api/followups`, `/api/customer-followups`, `/api/customer-service` (create/edit, new customer), `/api/complaints` (register/edit), `/api/service-kpi`, `/api/complaint-report`, `/api/mold-requests/**`, `/api/journeys` (by date), `/api/reviews`, `/api/device-status`, `/api/sales`, `/api/sales/import`, `/api/erp-customers`, `/api/customers/import`, `/api/machines/import`, `/api/targets`, `/api/kpis`, `/api/kpi-evidence`, `/api/trash`. Server-made flags follow the switches (`canCreate` and `can.edit/cancel` of mold requests, the evaluation's `canManage`/`canEdit`, `reviewable`, complaint `edit`, the customer-service evaluation's `canAudit/canSettings/canClose/canDelete`).
- **Save** (`lib/permissions-server.ts`, `POST /api/crm {action:'permissions', memberId, version, cells, hidden, viewAll, requestId}`): the administrator (all regions) only; normalised to the member's role whatever is sent; whole-row replace with its version (stale 409 `PERMISSIONS_CONFLICT`; a retry with the same request id answers as it did); the member's role and the writer re-checked at commit; a «صلاحيات» audit row with before and after, kept out of `GET /api/crm`'s recent changes. `GET /api/crm` sends the administrator every member's saved permissions (`members[].permissions`, for the matrix and the copy) and every member their own `me.access` (kept in the offline snapshot; the offline owner stamp is unchanged, so nothing queued is blocked by the release).
- **«عرض بيانات الفريق بالكامل»** (supervisor and sales manager; off by default; not for representatives or customer service, decided: a representative's writes rely on reading only their own): `salesScopeMemberIds(…, {read:true})` widens to every sales member (administrator, managers, supervisors, representatives) at the read sites only (`salesRecordAccess.canRead` → records projected with `_teamReadOnly`, the day report, device status, mobile days, sales/targets/KPI reads); every write, assignment and commit check keeps the team (`assertRecordMutation`, `masterMutationGuard`, the reviews' writer scope, target and KPI saves).
- **Page**: nav (desktop sidebar, phone tabs and «المزيد») and `resolveCRMPage` skip hidden screens; buttons follow the cells (customer add/edit/delete/export/import, visit add/edit/delete/export, follow-up add/delete, machines, mold specs, quotations export, sales add/edit/void/export/import, targets export and editing, trash restore, the customer picker's «عميل جديد»). Exports are client-side: their switch hides the button only (UI-only, said in the guide). The matrix (`app/member-permissions.tsx`, `.css`) in the member form of «الفريق والصلاحيات»: «الكل» per row, «—», «*» notes, «صلاحيات عامة», «انسخ الصلاحيات من» (skipped cells listed), its own «حفظ الصلاحيات»; Arabic and English; the table scrolls inside its box on a phone.
- **«حذف» off by default, grantable to any member** (the owner, 2026-11-09, after being told who deletes today: «امكانية اعطاء الصلاحية دى تمام اقدر اديها لاى مستخدم بس العادى ان محدش يقدر يحذف حاجة»; migration 0020 not deployed yet, so its stored format simply changed meaning). `lib/permissions.ts`: the five delete cells (`customer:delete`, `activity:delete`, `followup:delete`, `quote:delete`, `sales:delete`; `GRANTABLE_CELLS`, `cellGrantable`, `cellDefault`) exist for every role that has the screen (`pageCeiling`) except customer service on «الزيارات» (`without`: «—», never stored, copied or granted, since their service requests are never deleted), are off by default for every role but the administrator (on, and switchable off for another administrator), are on for others only when saved `true`, are copied by «انسخ الصلاحيات من» whenever the target's role has the screen and set by «الكل»; `memberAccess` lists them in `off` even without a saved row, and `cellRefused` refuses them unless on (so a role without the screen or an access never read is refused too). Mold «إلغاء طلب» (`mold-requests:delete`) is unchanged: on by default, restrict-only. Scope (`lib/crm-server.ts` `recordDeleteGuard`, never wider than editing; «عرض بيانات الفريق بالكامل» never widens it): customers and machines `masterMutationGuard` (administrator all; manager and supervisor their team's customers; a representative only the customers assigned to them, the owner's choice, re-checked at commit); contacts, quotations, mold specs `recordEditGuard` (manager: own, supervisors', representatives'; supervisor: own and their representatives'); a representative only a visit or follow-up they recorded (`recordAuthorId`), of a customer in their regions, never a machine, quotation or old opportunity thread; customer service nothing (no cell). `/api/crm`: the hard role checks went («حذف العملاء متاح للإدارة فقط», `requireRecordEdit` on a delete; a representative may now send a customer delete), so the decision is the cell plus the scope; every existing refusal (children, journey stops, code mappings, sales, service history, the service-history lock) stays; the commit's `accessGuard` re-checks the permissions' version, so a cell switched off meanwhile fails it safe (409). `/api/sales` void: `requireCell(sales,delete)` on the team as before. Page: the delete buttons (quick actions, the record sheet, the visits table and page, a customer's visits, follow-ups list, the visit dialog) follow `can(me,…,'delete')` and `canDeleteRecord` (the same scope, best effort); the void button also needs the sale's representative in the team. The «زرار الحذف في الصفحة لمدير النظام بس» note is gone; the matrix explains the exception. «المحذوفات» unchanged (administrator all, manager own); others granted «حذف» have the administrator restore. Tests: `tests/permissions.mjs` (defaults per role, grantable ceilings, old rows, copy, mold cancel; section 4 on SQLite: every role's scope, viewAll, customer service, void, the commit race, the refusals), `tests/permissions-ui.mjs`, `tests/permissions-http.mjs` (section 5 on the built release), `tests/permissions-browser.mjs` (the administrator ticks «حذف» on visits for a representative, who then deletes their own visit; Arabic and English), `tests/server-authorization.mjs`; `tests/trash.mjs`, `tests/trash-http.mjs` now grant the manager «حذف» first.
- **Tests.** `tests/permissions.mjs` (migration 21 fresh and upgraded from 20 with backup; defaults = today for every role and screen; pinned ceilings; normalising; copy; admin never locked; hidden → 404 mapping; routes on SQLite: save/409/audit/retry, refusals, other members unaffected, the commit race, view-all read only), `tests/permissions-ui.mjs`, `tests/permissions-http.mjs` (built release, every mapped route), `tests/permissions-browser.mjs` (Chromium desktop and phone, Arabic and English), `tests/server-authorization.mjs` extended, `tests/supervisor-reviews.mjs` no longer pins the newest migration. Guide: `docs/UPDATE-2026-11-09-PERMISSIONS-AR.txt` (rollback: the old release and the schema backup; after it everyone is back to the role defaults).

## «استيراد من ERP»: the ERP code of the customers the file does not name is cleared (2026-11-09, release `update-erp-clear-codes`, second package of the day, no migration)

- **Asked.** The owner: «فيه عملاء مش فى erp ولما برفع الداتا من erp النظام بيدى للعملاء اللى مش موجودين رقم من عنده», then «عايزه العملاء اللى مش موجودين فى الشييت يبقى كود erp فاضى»: after an ERP customers import, every CRM customer (within the importer's scope) that no row of the sheet matches ends with an empty ERP code (`data.code = ''`).
- **Who is "not in the sheet"** (`lib/erp-customers.ts` `matchErpCustomers` → `clears`, `ErpCustomerClear`): a customer inside the importer's regions with a non-empty current ERP code (`customerCodeKey`) that no row names by any evidence the matcher reads: a phone or exact loose name of any row (rows with an issue and rows too wide to offer included), the row's number held as its current code, a kept old code (alias) or a stored mapping, a candidate offered for a row (similar names included) or the customer a row ends on. Being conservative is deliberate: a row that names a customer weakly (a similar name left unanswered, a phone on a row matching too many) keeps that customer's code. The list does not depend on the choices (a choice only picks among candidates), so the preview's list is the apply's. Sorted by Yourrest code.
- **The server** (`lib/erp-customers-server.ts`): `prepare` keeps of `clears` only the customers `customerDetailMutationGuard` lets the member change (as every code change) and hashes them with their versions and codes into `clearSnapshot` (apart from `snapshot`, so the box unchecked keeps today's staleness rules). The preview answers `clears` (name, Yourrest code, ERP code, region; no version) and `clearSnapshot`. An apply with `clearCodes: true` must send the preview's `clearSnapshot` (else 409 «اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة»: a listed customer edited, moved to another region or now named by the file); in the same transaction it runs `UPDATE crm_records SET data=json_set(data,'$.code',''),updated_at,version+1,mutation_id … AND version=?` for each, behind the same receipt gate (their versions join the involved list; the identity revision; the member check), with one `erp-customer-code` audit entry each `{label: 'مسح كود ERP: العميل مش في ملف ERP', from, to: '', cleared: true}`, and answers `cleared: N`. `clearCodes` is part of the request fingerprint (the same `requestId` with the box changed is 409). Only codes to clear and the box unchecked: «لا توجد أكواد تتغير ولا عملاء جدد في هذا الملف.» as before. Without `clearCodes` (unchecked, or a screen of before) nothing changes from yesterday.
- **The old code stays an alias** (no change needed): the identity trigger of `drizzle/0014` (`crm_customer_identity_update`) already inserts the OLD code into `crm_customer_code_aliases` on any change of `data.code`, the new '' is not inserted, and the revision moves. So invoices under the old code still resolve to the customer (`uniqueCustomerCodes`: KPIs, the last purchase, a mold request's typed ERP code).
- **Mappings** of a cleared code (`crm_customer_code_mappings`) are left as they are: removing one would make the number's invoices nobody's when another customer also holds it as an old code, or move them by default to that other holder; kept, they stay with the customer they were decided for, which also still holds the number as an alias.
- **Products application**: unchanged code path. `moldCustomerEntry` sends `erpCode: ''` for a customer whose code is empty, and the contract (`docs/MOLD-REQUESTS-CONTRACT-AR.md`, customers route) says an empty `erpCode` clears the code production holds while a missing one keeps it; so the cleared code is sent as `""`, not left out (leaving it out would keep the stale code there). The apply nudges the list as before.
- **The screen** (`app/erp-customers-import.tsx`, `.css`): a section «عملاء مش موجودين في الشيت: هيتمسح كود ERP بتاعهم (N)» / «Customers not in the sheet: their ERP code will be cleared (N)» with the checkbox «امسح كود ERP للعملاء اللي مش في الشيت» / «Clear the ERP code of the customers not in the sheet» (checked by default, reset on every new file; a 44 px target), a hint, and the list (name, Yourrest code, current ERP code; 20 a page). The summary line, the ready line and the button count the codes cleared (`حدّث X كود وضيف Y عميل وامسح Z كود`); the apply sends `clearCodes` and `clearSnapshot` only while checked; the result says «اتمسح كود ERP لـ N عميل مش في الشيت» and lists them under «اللي اتمسح كوده». A preview without `clears` (a server of before) shows nothing new.
- **The reported symptom** («النظام بيدى … رقم من عنده»): no code path writes a generated or system number into `data.code`. The number the system gives every customer is the Yourrest code (`crm_customer_numbers`, shown as `YR-C-…`, computed on read, never stored in `data`). `data.code` is written only by the customer form (typed, a new customer starts with `''`), by «استيراد من ERP» (the sheet's own number), and by the one-time customers import of 2026-09-29 (`app/api/customers/import`, the source sheet's code column as it was). The customer-service «عميل جديد», the visits, the mold requests and the ERP sales import never write it. So codes the ERP does not have came from typing or from that first import (or were removed from the ERP later); this release clears them at the next import. Nothing needed fixing in code.
- **Same-day package**: `portable/activate-ui-refresh-update.cjs` lists `update-mold-address-activation-20261109` (this morning's package) in `BACKUP_TRANSACTION`; `tests/baseline-update-activation.mjs` shipped list. Guide: `docs/UPDATE-2026-11-09-ERP-CLEAR-CODES-AR.txt` (stage `yourrest-crm-update-erp-clear-codes-20261109`, helper `yourrest-activate-update-erp-clear-codes.cjs`).
- **Tests.** `tests/erp-customers.mjs` (who is listed: not by phone, name, number, kept code, mapping, similar name, an invalid row's phone or a too-wide row's name; no code or a blank one never; independent of the choices; the manager's regions); `tests/erp-customers-ui.mjs` (the section, the box, the payload with and without it, the result, only codes to clear, Arabic and English); `tests/erp-customers-clear-http.mjs` (new, against the built release: the preview's list for the administrator and the manager, nothing written; 409 without, with another or the manager's clearSnapshot, after an edit or a region move of a listed customer; unchecked = before; nothing to apply; the manager's apply clears exactly their two customers, versions, mutation id and updated_at moved once, nothing else changed, aliases kept, the mapping kept, the revision moved, the audit entries, a repeated request saved; the administrator then clears the eastern one; the customers list: empty code, old one kept, the invoice under it still the last purchase); `tests/mold-customers-http.mjs` (a cleared code goes to production as `erpCode: ""`); `tests/erp-customers-browser.mjs` (real Chromium: no section when every customer is named; the section, box, counts, unchecked = nothing to apply, the phone layout, the apply and its result, the database; English section and box; unchecked before a later apply).

## Mold requests: a delivery address on each request (2026-11-09, release `update-mold-address`, first package of the day, no migration)

- **Asked.** The owner: «عنوان لكل طلب قالب — العنوان اللي القالب هيتسلّم فيه ممكن يكون غير العنوان المتسجل بيه العميل»: a field «العنوان» under the customer card, filled in from the customer's registered address, changed for this request only (the customer's own address never changes), required, up to 300 characters; shown in «توقيع العميل» under the customer; sent to production as `customer.address` (the field the contract always had: the products side needs no change).
- **The rule** (`portable/mold-rules.mjs` `moldAddress`, `MOLD_ADDRESS_REQUIRED`, `MOLD_ADDRESS_LONG`): a control character (a new line) becomes a space, then `moldText`; required, up to 300 characters counted as production counts them (code points). The form and the server share it; the refusals «اكتب عنوان التسليم» / «Enter the delivery address» and «العنوان حتى 300 حرف» / «The address is up to 300 characters» (`lib/mold-requests.ts` `MOLD_ADDRESS_TEXT`, `lib/locales/en.json`).
- **The server** (`app/api/mold-requests/route.ts` `askedAddress`): `address` on `create` and `update`; when sent it is checked (400 `fields.address`) and stored as `data.customer.address`; when absent (a page loaded before this release) a new request takes the customer's registered address as before and an edit keeps the stored one. The customer record is never written. An edit whose address reads the same once normalized keeps the stored text exactly (the request resends byte for byte); a changed address is a change of what the customer signed, so a sales role signs again (the same «nothing changed» check as the specifications and the payment), and the audit of the edit names the new address.
- **The form** (`app/mold-requests.tsx` `MoldRequestDialog`): «العنوان» / «Address» (a two-line text area with dictation, `VoiceField`) right under the chosen customer, for a new request and the edit of a never-sent one, every role; filled in when a customer is chosen or changed (the edit for the previous customer replaced), from the request's own on edit; refused on the device beside the field before the signing step; the signing summary's second row; `editChanges` counts it. The request's sheet shows «عنوان التسليم» / «Delivery address» (`customerAddress`, a new field of the view; approving from «طلبات بانتظار اعتمادي», the address production lists now, like the customer's name and the specifications); production's refusal of `customer.address` is named «عنوان التسليم».
- **The customer as two typed fields with suggestions (same release).** The owner: «اسم العميل والكود بيتكتبو + ترشيحات من العملاء», then «خانتين بترشيحات». The single search box and its list of buttons are replaced (`app/mold-customer-fields.tsx` `MoldCustomerFields`) by «اسم العميل» / «Customer name» (with dictation, `VoiceField`) and «الكود» / «Code» (placeholder «YR-C-… أو كود ERP»), side by side, stacked under 400 px. Typing in either suggests, under that field, up to 8 of the customers the reader already receives (name · Yourrest code · city · ERP code; «اكتب أكثر لتضييق النتائج» beyond): by name with the app's search normalization (أ/إ/آ as ا, ى as ي, no diacritics, Arabic-Indic digits), or by Yourrest code, its number alone («4», «٠٠٠٠٠٤», «YR-C-4»), or ERP code (`data.code` and `_erpCodeAliases`, `customerCodeKey`); exact matches first. ↑ ↓ Enter Esc (Esc closes the suggestions, not the dialog: `onEscapeKeyDown`) and touch; a customer without a Yourrest number is shown dimmed with «لم يأخذ كود يورست بعد» / «No Yourrest code yet» and cannot be chosen (before, its button was only disabled). Choosing fills both fields with the name and Yourrest code, sets the customer, clears its error, closes the suggestions and fills in the address; a compact «تم اختيار العميل» line (city, ERP code) with «تغيير» replaces the card. Typing in either field afterwards lets the customer go (the text kept, the address field with it), so a stale choice is never sent; choosing again fills the address in again. Refused on the device without a chosen customer: «اختر العميل» with nothing typed, «اختار العميل من الترشيحات» / «Choose the customer from the suggestions» after typing. The edit of a never-sent request shows both fields filled and read-only (the customer fixed, as before). No server change: `create` still takes `customerId` and checks it as before; pages opened before the release keep their search box.
- **A customer not in the CRM never blocks the request (same release).** The owner, after seeing the two fields: «لا اسم العميل بيتكتب نص وبيجى ترشيحات من النظام يعنى لو فيه عميل مش موجود فى النظام طلب القالب ميقفش», then «المندوب يكتب الكود والكود المطلوب كود erp», then «يتبعت بكود ERP بس» (the customer is not added to the CRM). This replaces the «must choose from the suggestions» rule above:
  - **The form** (`app/mold-customer-fields.tsx`, `app/mold-requests.tsx`): «اسم العميل» (free text, dictated, required, up to 200 characters) and «كود ERP» / «ERP code» (free text, Arabic-Indic and Persian digits turned into English ones as typed, up to 50; hint «مطلوب لعميل مش موجود في الـCRM؛ اختياري للعميل المرتبط»). The suggestions stay (by name; by ERP code and former codes; by Yourrest code or number as a help). Choosing one fills the name, its ERP code and the address and links the request («مرتبط بالعميل <name> · YR-C-…»); an ERP code that exactly one of the reader's customers has links it the same way (`moldCustomerByErpCode`); editing the code to another unlinks it. Anything else is a customer not in the CRM, said under the fields («عميل مش موجود في الـCRM: الطلب هيتبعت للإنتاج بالاسم وكود ERP» / «A customer not in the CRM: the request goes to production with the name and ERP code»); its name, ERP code and address are required, each refused beside its field («اكتب اسم العميل», «اكتب كود ERP للعميل», «كود ERP حتى 50 حرف», «اسم العميل حتى 200 حرف», English pairs in `lib/locales/en.json`). «العنوان» is shown always. The signing summary: the customer, «كود ERP» (when there is one), «كود يورست: غير مسجل في الـCRM» for an unlinked one, the address. The sheet and the card show the ERP code and «غير مسجل في الـCRM» / «Not in the CRM». The edit of a never-sent request changes the name, code and address the same way (a changed customer is a change of what the customer signed: a sales role signs again).
  - **The server** (`app/api/mold-requests/route.ts` `askedCustomer`): `create` and `update` take `customerId` (as before; a page loaded before sends only this) or `customer: {name, erpCode}`. With `customerId`: `askable`, the Yourrest number and registered name as before, the ERP code typed (or the customer's own) kept in `data.customer.erpCode` for display only. Without it, an ERP code that `uniqueCustomerCodes` (every customer, former codes, the CRM's mappings) maps to exactly one customer the reader may ask for, with a Yourrest number, links it — the server decides; any other is stored unlinked: `customer_id` `''` (no migration), `data.customer = {crmNumber: null, name, address, city: '', erpCode}`; 400 `fields` `customer.name` / `customer.erpCode` / `address` / `customer`. An update without either keeps the request's customer; the request's own customer is kept even when the editor may no longer ask for it; a linked customer's ERP code alone is not a change.
  - **Production** (`portable/mold-rules.mjs` `moldRequestBody`, `moldErpCode`, `moldErpCodeText`, `moldCustomerName`): a linked request's body is byte for byte as before (no `erpCode`, whatever the data holds); an unlinked one sends `customer: {crmNumber: null, name, address, city?, erpCode}` (`erpCode` required then). Today's products application reads `customer.crmNumber` as optional (the addendum; the stand-in mirrors it) and ignores keys it does not know, so it would store such a request without its ERP code, silently. The CRM therefore sends an unlinked request only once it has learned that production takes it (`moldFreeCustomersSupported`, `crm_settings` row `mold-free-customers`, learned from any status object or pending item whose `customer` carries `erpCode`, `moldFreeCustomersAnswered`). Until then (and if production refuses it with 400 naming `customer.crmNumber`) it waits in the CRM: error `free_customer`, never final, `sending.held` `free_customer` «بانتظار تحديث تطبيق الإنتاج (عميل من غير كود يورست)» / «Waiting for the production application update (a customer without a Yourrest code)», tried again every 6 hours and on its requester's resend (which first asks production what it runs: one status, else its waiting list); the moment the update is learned every waiting one is due at once. Old stored requests resend byte for byte; the customers route is unchanged. The message to the products team: `docs/MOLD-PRODUCTS-MESSAGE-2026-11-09-AR.md`; the contract: «طلب لعميل مش موجود في الـCRM (2026-11-09)».
  - **Who sees it** (`lib/mold-requests.ts` `moldRequestInRegion`, the one place the region decision is made): an unlinked request has no customer region, so its requester's region scope stands for it (shared regions; a requester of every region shares them all; all-regions readers always). The list (`canReadMoldRequest`), the approval and «طلبات بانتظار اعتمادي» (`moldApprovesRequest`) and the single approver (`moldApprovingManagerId`) all ask it. Status, pending, approvals (by `crmRequestId` or `requestRef`) and design-file downloads go by the request, never a customer record.
  - **The stand-in** (`scripts/lib/products-mock.mjs`): `freeCustomers` (default false, today's application: `crmNumber` optional, `erpCode` ignored, no `customer` in the status) and `setFreeCustomers(true)` (takes `customer.erpCode`, up to 50, required without a Yourrest number, part of the original a retry is compared with; echoes `customer: {crmNumber, name, erpCode}` in every status object and `erpCode` in every pending item's customer).
- **Unchanged**: `moldRequestBody` for a CRM customer (it always took `customer.address` from the request's data), the customers route (the registered addresses).
- **Same-day package**: `portable/activate-ui-refresh-update.cjs` lists `update-mold-design-required-activation-20261108` (yesterday's package; `tests/baseline-update-activation.mjs` shipped list).
- **Tests.** `tests/mold-requests.mjs` (the rule: trimming, new lines, required, 300 code points; the texts and their English pairs; the view; the body with the request's address and an older request's bytes), `tests/mold-requests-http.mjs` against the built release (a typed address stored and received by production, the customer's record and the customers list untouched; no address from an old page: the registered one; empty, blank, non-text and over 300: 400 `fields.address`, nothing saved or sent; an address-only edit of a never-sent request: kept when it reads the same or none is sent, a new signature asked of a representative, saved and sent once signed, customer service without one), `tests/mold-requests-browser.mjs` in Chromium at 360 px, Arabic and English (the field under the customer card filled in and filled in again, edited, the required and over-300 refusals, the signing summary's row, the sheet's «عنوان التسليم», production's body). The customer fields: `tests/mold-requests-browser.mjs` §8 (360 px Arabic, 320 px English: suggestions by name, Yourrest code, number alone, Arabic-Indic digits, ERP code and a former one; eight at most; one without a number not chosen; choosing fills both and the address; editing after it lets go; both refusals, nothing sent; ↑ ↓ Esc Enter; desktop side by side; the edit fixed), every test that chose a customer moved to the fields (`tests/mold-design-files-browser.mjs`), `tests/dictation-coverage.mjs` (the code field stays typed). A customer not in the CRM: `tests/mold-requests.mjs` (the name and ERP code rules, the customers route's ERP normalization unchanged, the body linked byte for byte and unlinked, the hold and its view, the words, the visibility of an unlinked request by its requester's regions, the stand-in in both modes), `tests/mold-requests-http.mjs` (built release vs the stand-in: linked by choice, an old page, auto-linked by a unique ERP code and a former one, not linked for a shared code or another region's customer, each refusal by its field, unlinked and held while production is today's application, resend, a second one released when the update is learned, sent with `crmNumber` null and the ERP code, its files after it, the managers' lists and approvals by `requestRef` and `crmRequestId`, the design-file download, production's 400 `customer.crmNumber` held not rejected, the edit of the customer as signed data and linked by its code, the customers list unchanged), `tests/mold-requests-browser.mjs` §8 (360 px Arabic, 320 px English: typing a new customer, the note, the required name, code and address, the signing summary, the sheet and card «غير مسجل في الـCRM», choosing links, editing the code unlinks, an ERP code links).

## Customers: «لم يشترِ منذ 60 يومًا» (2026-11-09, no migration; shipped in release `update-mold-address`, with the mold delivery address)

## «المحذوفات» with restore (2026-11-09, no migration; release name provisional `update-trash`)

- **Asked.** The owner, 2026-11-09, «نفذ الاربعة» of the GSCO feature list: GSCO's «المحذوفات مع استرجاع» (`lib/crm/record-actions-server.ts` `trashGet`/`recordAction`, `components/crm/record-actions.tsx` `Trash()`), adapted: Yourrest still deletes for real (the same refusals), and the bin is read from the «حذف» history entries every deletion already writes (no `record_trash` table, no migration: 19).
- **What a deletion records now** (`app/api/crm/route.ts`, `lib/trash-server.ts` `deleteCapture`): the «حذف» detail keeps `kind`, `deletedBy`, `record` (the row as the context read it) and `codeMappings` as before, plus `capture: 1`, `customer` (the record's customer: id, name, region, for the list), and, read by `json_set` inside the same INSERT that records the deletion (so nothing changes in between): a contact's `journeyLinks` (the `crm_journey_links` stops, cascaded away with the row), the `pointers` it removes (`{id, field: '_visitPlan'|'_stageVisitId', value}`), a customer's `customerNumber` (`crm_customer_numbers`) and `erpCodeAliases` (`crm_customer_code_aliases`), both cascaded away. GET `/api/crm` no longer sends «حذف» or «استرجاع سجل» entries (a restored record's history would otherwise show them).
- **Who** (`lib/access.ts` `trashScope`, one function for the later permissions matrix; `canViewPage(role, 'trash')`): the administrator sees and restores every deletion (an administrator of some regions: the deletions whose customer is in them); the sales manager (`manager`) only those they deleted themselves (GSCO: without `view_all`, own deletions only); 403 for everyone else.
- **The list** (GET `/api/trash?type=&before=`, `listTrash`): newest first, 40 per page, `next` cursor (`created_at|id`, so a restoration in between skips nothing) for «تحميل المزيد»; `type` = `customer` «عميل», `visit` «زيارة», `followup` «متابعة» (a `followup-v1` contact), `opportunity` «فرصة», `quote` «عرض سعر», `machine` «ماكينة» or all («كل الأقسام»). Each entry: type, name or summary, the YR-C code of a customer or the number of a visit, its customer (live, else through the deleted parents' entries), who deleted it and when, and `blocked` (the same words the restoration would refuse with) or a `note`.
- **The restoration** (POST `/api/trash` `{auditId, requestId}`, `restoreFromTrash`, one gated batch): the row goes back with its id, kind, parent, assignee, branch, data (minus `internalCode`, `_erpCodeAliases` and other fields the context or a page adds) and creation time at version = deleted version + 1 with a fresh `mutation_id`; then a customer's own Yourrest number (the insert trigger gives it the next one; it takes back its own, which production's customer list knows it by), its aliases and code mappings, except a code that now belongs to another customer (in its data, aliases or a mapping): that one is left with the other customer (the restored `code` is emptied if it is that code) and the answer says so («لم يُسترجع كود ERP «…»: أصبح للعميل «…».»); a contact's journey links (when the stop exists) and its number (`crm_visit_numbers` keeps it; files in `crm_visit_files` never left); the plan pointers on records that still exist and still point nowhere (a newer contact's pointer is left alone); a customer-service contact moves its customer's version as its deletion did. The receipt is the history entry `restore:<deletion id>` «استرجاع سجل» (`TRASH_RESTORE_ACTION`): a second restoration is 409 «السجل اتسترجع قبل كده.», the same `requestId` again answers `alreadySaved`. Refusals: the parent / `requestId` / `sourceId` record missing: 409 «استرجع السجل الأصلي أولًا: <الفرصة «…»>.» (named from its own deletion entry); a record with the same id: 409 «السجل موجود بالفعل.»; the number now another customer's: 409 «رقم يورست YR-C-… أصبح لعميل آخر؛ …»; a manager and someone else's deletion: 403 «استرجاع ما حذفه غيرك متاح لمدير النظام فقط.»; a customer outside the restorer's regions or a parent they may not change: 403. A restored customer is in production's customer list again: the list's fingerprint changes and the next check (nudged soon after the restoration) sends it `active` under its number (`lib/mold-customers-server.ts`; no marker needed). Body limit 2 000 bytes (`lib/request-body.ts`).
- **Deletions recorded before this release** are listed and restorable from what they hold: a customer's number from `record.data.internalCode` and aliases from `_erpCodeAliases` (the context put both in the snapshot); a contact's journey link from its `journeyStopId` (a linked contact always carries it); plan pointers were not recorded and are not restored (no page reads `_visitPlan`: plans are computed from the records, and the next contact writes it again). A customer deleted before customers were numbered (no `internalCode`: before migration 0014) never had a number, so production's list (numbers only, since 0016) never had it: it is restored with a new number, said in the list («حُذف قبل ترقيم العملاء: يُسترجع برقم يورست جديد.») and the answer. None is «غير قابل للاسترجاع»; an entry whose detail cannot be read is listed as «غير قابل للاسترجاع: بيانات الحذف ناقصة.».
- **The page** (`app/trash-page.tsx`, `.css`): «المحذوفات» / «Deleted records» in the desktop sidebar and in «المزيد» on the phone (never a bottom tab); «نوع السجل» select, cards (one column on a phone), «استرجاع» behind a confirmation («سيعود السجل إلى القوائم مع تاريخه ومرفقاته.»), disabled with the reason while blocked; after a restoration the CRM data reloads and the answer's notes show. No permanent deletion (Yourrest already deletes for real). The delete confirmation now reads «يمكن استرجاعه لاحقًا من «المحذوفات». لن يُحذف سجل له سجلات مرتبطة.». Pages loaded before this release have no item until reloaded.
- **Tests.** `tests/trash.mjs` (real handlers over every migration: capture, each kind, the code left with another customer, number taken, same id, parent first, follow-up pointer not over a newer one, a manager's scope, a regional administrator, old-format entries with and without a number, 45 entries in two pages, GET `/api/crm` without either entry, every message in English; 132 checks), `tests/trash-http.mjs` (built release), `tests/trash-browser.mjs` (Chromium, 360 px Arabic and English: delete from the sheet, find, filter, restore, back with the same YR-C code; desktop: the quotation waits for its opportunity; manager and supervisor), `tests/server-authorization.mjs` and `tests/mobile-navigation-ui.mjs` updated. Guide: `docs/UPDATE-2026-11-09-TRASH-AR.txt`.

## Customers: «لم يشترِ منذ 60 يومًا» (2026-11-09, no migration; release name decided at packaging)

- **Asked.** The owner, 2026-11-09, «نفذ الاربعة» of the GSCO feature list; this is #3: a customers filter for those who have not bought for 60 days, after GSCO's `lib/crm/customer-last-sale.ts` (same constant and boundary).
- **The last purchase** (`lib/customer-last-purchase.ts` `lastPurchaseDates`, `lib/customer-last-purchase-server.ts` `LAST_PURCHASE_SQL`, `readLastPurchases`, `withLastPurchase`): GET `/api/crm` attaches `data._lastPurchase` (YYYY-MM-DD as stored, Riyadh) to every customer row it sends that has bought: the later of its ERP sale documents (`crm_erp_sales`, `document_type='sale'`, `total_cents>0`; returns never) whose customer code maps to exactly this customer (`uniqueCustomerCodes` over every customer with the explicit mappings: the code and retained aliases, a code two customers share counting for neither, as the KPI invoices join it) and of its confirmed manual invoices (`crm_sales`, `status='confirmed'`). One statement (`MAX(date) … GROUP BY customer_code` UNION ALL `… GROUP BY customer_id`) plus the identity mappings, never per customer. It is the customer's purchase whoever sold; only rows the reader already receives carry it. No index: 200,000 synthetic ERP documents take ~55 ms (a scan), 30,000 ~9 ms (a covering index would make them ~16/4 ms; not needed now).
- **Computed, never stored**: the customer schema (zod, strip) drops `_lastPurchase` from any save, so it is never written, audited («تعديل» detail is the name) or sent to the products application (its list is read from the stored rows); a stray stored value would not be sent as computed (`withLastPurchase`).
- **The filter** (`app/crm-app.tsx`, the customers page only): a toggle «لم يشترِ منذ 60 يومًا» / «No purchase in 60 days» among the page filters (inside «فلترة» on the phone), `INACTIVE_CUSTOMER_DAYS = 60`. On, it keeps the customers whose status is «نشط» (`mapActivity(...).key === 'active'`, as the map reads it; no status is «غير محدد», not active) and whose `_lastPurchase` is missing or before today (Riyadh) minus 60 days: 59 and 60 days ago are recent, 61 is not. It counts in the filters badge, works with the search, region and representative filters, «مسح الفلاتر» and a page change clear it; the customers export follows the list shown. Each listed customer reads «آخر شراء: <date>» / «Last purchase: <date>» or «لم يشترِ بعد» / «No purchase yet» (`app/customer-machines.tsx` `LastPurchase`, phone card and desktop row) while the filter is on. The map keeps its own filters.
- **Pages loaded before this release** ignore the new field and have no toggle until reloaded. After a rollback, a page opened on this release would list every active customer as never having bought once its data reloads from the old server: reload (the guide says so).
- **Tests.** `tests/customer-last-purchase.mjs` (the window 59/60/61, leap and year boundaries, the status, the statement over every migration in SQLite: returns including a positive one, zero totals, a shared code, a mapped one, an alias, Arabic-Indic digits, a void manual invoice, no sales at all; the rows sent), `tests/customer-last-purchase-http.mjs` (built release: each reader's customers with their dates, a representative's own, another region never; a save sending the field back stores and audits nothing of it, the next GET still computes it), `tests/customer-last-purchase-browser.mjs` (Chromium, 360 px phone, Arabic and English: the toggle in «فلترة», the list, the lines, the badge, region and search together, «مسح الفلاتر», no sideways scroll; the desktop row; a representative on the Android app emulator). Guide: `docs/UPDATE-2026-11-09-INACTIVE-CUSTOMERS-AR.txt`.

## The supervisor's notes on a member's work: «النتيجة» and «الإجراء المطلوب» on the day report, the card «ملاحظات المشرف على شغلك» until «قرأت» (2026-11-09, release `update-supervisor-reviews` (provisional), migration 0019, schema 19 -> 20)

- **Asked.** The owner, 2026-11-09, «نفذ الاربعة» of GSCO's list, its #5: «كارت ملاحظات المشرف على شغلك يظهر للمندوب حتى يضغط قرأت، والمشرف يرى وقت القراءة». Copied from GSCO 2.13.46/2.13.49/2.13.63 (`lib/crm/daily-report-review*.ts`, `daily-entry-review*.ts`, `review-inbox*.ts`, `components/crm/daily-entry-review.tsx`, `daily-report-review.tsx`, `review-inbox.tsx`, migrations 0042/0043), adapted to Yourrest's routes, scope and audit table.
- **Migration** `drizzle/0019_supervisor_reviews.sql`: `crm_daily_entry_reviews` (one row per activity: `activity_id` a `crm_records` activity, `member_id` its recorder, `date` its day, `result`, `action`, `reviewed_by`, `version`, `mutation_id`, `created_at`, `updated_at`; indexes member+date, member+updated) and `crm_daily_report_reviews` (PK member+date, same fields). No foreign keys (Yourrest deletes records for good; a note outlives its visit). No other table changes.
- **Reads** are `crm_audit` rows, no table: id `review-read:entry:<activityId>:<version>` / `review-read:day:<memberId>:<date>:<version>`, action `قراءة مراجعة المشرف`, written with INSERT OR IGNORE only for a note on the reader's own work at that version. An edit raises the version, so the note is unread again. Writes are audited `مراجعة المشرف لزيارة أو متابعة` / `مراجعة المشرف لتقرير اليوم` (before/after; the row is the request's receipt). All three actions are excluded from the recent changes of `GET /api/crm`.
- **Who writes, on what** (`lib/supervisor-reviews-server.ts`): the roles that open «تقرير يوم المندوب» (admin, manager, supervisor; active), on an activity that report lists for them (`reportActivities`: readable, recorder in `salesScopeMemberIds`, with its customer, on that date) and on the day of a member of the report's list (in scope, and active in a compatible region or with an activity that day), never on their own work (400, as GSCO), never a day to come (400). Another team's member: 403; an unknown activity: 404; a representative or customer service: 403 (checked before the body, unlike GSCO, so the role matrix reads 403). Both fields trimmed, 2..2000 characters, no control characters. Version: `null` creates, the current version edits; anything else 409. At commit: `accessGuard` (the writer's role, region, supervisor, auth version), the member still in the writer's team (supervisor: `role='rep' AND supervisor_id`; manager: supervisor/rep), the activity still there; else 409 and nothing written.
- **Routes.** `GET /api/reviews?date=&memberId=` (sales roles with the report; memberId as `/api/journeys`): the notes of that report with `readAt`, the activity ids the reader may note, the day note and whether they may write it. `POST /api/reviews` `{kind:'entry',activityId|kind:'day',memberId,date, result, action, version, requestId}`. `GET /api/review-inbox`: the caller's own unread notes of the last 30 days (by `updated_at`), 50 at most (`more`), newest first, an entry with its activity type and customer (named only within the reader's regions). `POST /api/review-inbox` `{items:[{kind,ref,version}]}` (1..50): «قرأت»; answers with what is still unread. All with `checkOrigin`/`requireSession`/`context`, 401 without a session, `Cache-Control: no-store`; body limits 14 000 and 16 000 bytes (`lib/request-body.ts`).
- **The day report** (`app/journey-report.tsx`, `app/supervisor-reviews.tsx`): `ReportReviewsProvider` loads the notes after the report (a failure says so with Retry and leaves the report); under each route stop's results, each matched observed stop and each communication «إضافة نتيجة وإجراء» → «النتيجة» / «الإجراء المطلوب» (VoiceField dictation, Save / Cancel; a retry reuses its request id), then the note with its writer, time, «لم تُقرأ بعد» / «تمت القراءة <time>» and «تعديل»; «تقييم اليوم · <member>» above the report. The server-rendered report without the provider is unchanged (`tests/journey-ui.mjs`, `tests/mobile-route-stops.mjs`).
- **The card** (`ReviewInboxCard` in `.workspace-notices`, every page, every role; hidden when empty): count, each note's activity type and customer or «تقييم اليوم <date>», «النتيجة», «الإجراء المطلوب», writer and time, «قرأت», «قرأت الكل» when more than one. (Since 2026-11-15 there is no «قرأت الكل»: see the entry «The supervisor's review completed» above.) Asked on load, every 5 minutes and on focus/visibility at most once a minute (as GSCO), never while offline; a failed «قرأت» shows the reason and keeps the note. No outbox for reads. Phone: 44 px buttons (the dictation buttons of the form too), no horizontal scroll. English pairs in place and in `lib/locales/en.json` (server messages).
- **Deviations from GSCO.** Roles: Yourrest's admin/manager/supervisor (GSCO: owner/admin/sales manager/manager with `view_reports`); the card for every role (GSCO: admin, sales manager, manager, rep, and not with «تقرير يوم المندوب» hidden — Yourrest has no hidden sections); the role check before validation; no «مطلوبة من المشرف» pending marker and no «مراجعات المشرف لزيارات الفريق» list in the reviewer's own day (not asked); notes read through their own route `/api/reviews` instead of being added to `GET /api/journeys` (the report's answer keeps its shape for pages loaded before); the inbox reads with two plain queries rather than a batch (no write lock).
- **Old pages** ignore the new routes; the day report answers exactly as before.
- **Release.** Package with `--schema-baseline 19 --new-migration 0019_supervisor_reviews.sql` and `--verify-route /api/review-inbox=401`; guide `docs/UPDATE-2026-11-09-SUPERVISOR-REVIEWS-AR.txt` (rollback a: old release while the database is still 19; b: old release + `schema-backups/before-0019_supervisor_reviews-*.sqlite`). `BACKUP_TRANSACTION` and the shipped list are left to the release that packages it.
- **Tests.** `tests/supervisor-reviews.mjs` (rules, migration count 20, fresh database and upgrade from 19 with its backup, the routes on in-memory SQLite: roles, scope, limits, receipts, 409, a team change at commit, read per version, 30 days, regions, `GET /api/crm`), `tests/supervisor-reviews-http.mjs` (built release), `tests/supervisor-reviews-browser.mjs` (Chromium: supervisor desktop Arabic and 360 px English, the representative in the Android emulator, «قرأت» failing then succeeding, «قرأت الكل» in English, «تمت القراءة» with the time, an edit unread again), `tests/server-authorization.mjs` (both routes: 401, role matrix, foreign origin).

## Mold requests: a design file is required of every new request (2026-11-08, release `update-mold-design-required`, first package of the day, no migration)

- **Asked.** The owner: «ليه فى فورمة طلب القالب ملف التصميم اختيارى», then chose «إجباري على الكل»: every role that creates a mold request (the sales roles, customer service, the administrator) attaches at least one design file; the customer's signature image (the design file `data.signature.fileId` names) does not count. The products side needs no change (design files go with `design-files` since 2026-11-02).
- **The marker** (`app/api/mold-requests/route.ts` create): every new request is saved with `data.designRequired: true`, whatever the CRM knows of production; never part of the requests body (`tests/mold-requests.mjs`: the body is byte for byte the same with and without it). Requests saved before carry none and behave exactly as before.
- **The hold, generalized** (`lib/mold-requests.ts` `moldHeldFor`, replacing `moldAwaitsQuoteFile`; `lib/mold-requests-server.ts` `MOLD_HELD_FOR_SQL`, `MOLD_AWAITS_FILE_SQL`): a request whose own data waits to be sent and has certainly never reached production is kept while (`fileRequired` and no live quotation/PO file) → `quote_file`, else (`designRequired` and no live design file other than the signature: not deleted, not refused for good) → `design_file`; the quotation's file is said first. The SQL says the same (`tests/mold-design-files-server.mjs` compares both on 400 generated cases). The send's check and claim, the timetable (a kept request is never due), the resend permission and its refusal (409 «الطلب بانتظار ملف التصميم؛ أرفق ملف تصميم ويتبعت الطلب لوحده.», English pair in `lib/locales/en.json`), the view and `design-files`' release (`releases`: held before, nothing missing with the file just saved) all use it; the release sends the request, then its files in order (the signature first), as on 2026-11-05.
- **`sending.held: 'design_file'`**: a new value of the 2026-11-05 field; `sending.state` keeps its old values (`waiting`/`off`), so pages of 2026-11-05..07 read «بانتظار الإرسال» for it. This release's page (`app/mold-requests.tsx` `moldHeldTexts`) says «بانتظار ملف التصميم» / «Waiting for the design file», the requester's explanation («… إلا لما ترفق ملف تصميم واحد على الأقل (توقيع العميل مش بيتحسب)؛ …») and «بانتظار ما صاحب الطلب يرفق ملف التصميم» to others; the sheet's design group stays attachable for the requester. The view gains `designRequired` (a new field).
- **The form**: the design picker reads «ملفات التصميم (ملف واحد على الأقل)» / «Design files (at least one)» for a new request (every role) and for the edit of a never-sent request with the marker and no design file of its own; «حفظ وإرسال…» is refused with «أرفق ملف تصميم واحد على الأقل» / «Attach at least one design file» beside the picker, before the signing step (a file refused on the device does not count). An older request keeps «(اختياري)».
- **Diagnose** (`scripts/diagnose/mold-products.cjs`): `heldForDesignFile` beside `heldForQuoteFile`, counts only. The stand-in (`scripts/lib/products-mock.mjs`) is unchanged.
- **Same-day package**: `portable/activate-ui-refresh-update.cjs` lists `update-quote-lost-filter-activation-20261107` (yesterday's second package; `tests/baseline-update-activation.mjs` shipped list).
- **Tests.** `tests/mold-requests.mjs` (each hold reason, the signature, deleted, refused and stopped files, old requests, the view and permissions, the texts, the body), `tests/mold-design-files-server.mjs` (kept, sent by nothing, resend refused, released in order, kept again after its only design file is deleted, customer service; SQL against TypeScript), `tests/mold-requests-http.mjs` and `tests/mold-design-files-http.mjs` against the built release (the first request kept then released by its design file; a request with its quotation file but no design file kept, refused a resend, released by the design file; customer service and the administrator alike; an old request unchanged), `tests/mold-requests-browser.mjs` and `tests/mold-design-files-browser.mjs` in Chromium (the refusal before the signing step at 360 px, Arabic and English; a kept request's card, sheet and edit). Sections about a request's own flow take it as the release before saved it (`scripts/lib/mold-before.mjs`). `tests/diagnose-mold-products.mjs` counts a request kept for its design file.

## The «عرض سعر» visit filter also brings the quotations lost afterwards, marked «مفقودة» (2026-11-07, release `update-quote-lost-filter`, second package of the day, no migration)

- **Asked.** The owner: «فى فلتر مراحل البيع فى الزيارات خلى مرحلة عرض السعر تجيب العروض المفقودة وتكون جمبها كلمة مفقودة», then, asked which rows: «نفس النتائج اللى بتطلع + العروض اللى بعد كده تم فقدها».
- **Rule** (`lib/visit-list.ts` `lostQuoteVisitIds`, one pass over the reader's records, per customer in `visitOrder`): a visit at `quoted` is lost when the first closing contact after it (a visit or follow-up at `won`/`lost`) is `lost`; a visit at `lost` is a lost quotation when a quotation (a visit or follow-up at `quoted`, a contact of type `quote`, or a quotation record) came after the customer's previous close. `filterVisitRows` with `stage: 'quoted'` keeps every `quoted` visit and adds those lost visits; every other filter is unchanged. Follow-ups stay out of the visit list as before.
- **Display** (`app/visits-table.tsx`, `lostQuotes` prop from `VisitsPage`): «مفقودة» / «Lost» (`badge lost`) beside the stage on the phone card and beside the visit number on the desktop table; the CSV export (`app/crm-app.tsx`) appends «— مفقودة» to the stage column under that filter. No server value or API changed; pages loaded before the release keep the old filter until reloaded.
- **Same-day package**: `portable/activate-ui-refresh-update.cjs` lists `update-cs-no-add-customer-activation-20261107` (this morning's activation) so this package reuses the day's full backup (`tests/baseline-update-activation.mjs` shipped list).
- **Tests.** `tests/crm-regression.mjs`: the lost set (a quote lost in a follow-up, a quote lost in a visit after negotiation, a quote contact of type `quote` in a follow-up, a won quotation, a loss without a quotation since the previous close, another customer), the `quoted` and `lost` filter orders, and the staff filter on the added rows.

## Customer service no longer adds customers and corrects customer details like a representative (2026-11-07, release `update-cs-no-add-customer`, first package of the day, no migration)

- **Asked.** The owner: «شيل من خدمة العملاء اضافة عملاء بس يقدرو يعدلو بس», then, asked what editing means: «زي المندوب». Customer service (`customer_service` and `customer_service_manager`) picks an existing customer and never adds one, and corrects a customer's details exactly as a representative may; every other role is unchanged (the representative, supervisor, sales manager and administrator add customers as before).
- **Every create path, closed on the server** with one refusal, 403 «إضافة العملاء مش متاحة لخدمة العملاء؛ اختار عميل موجود أو اطلب من المبيعات يضيفه.» (`lib/customer-service.ts` `serviceCustomerAddRefused`; English pair in `lib/locales/en.json`): (1) `POST /api/crm` `action: 'save', kind: 'customer'` with no `id`/`parentId` (the opportunity form's «إضافة عميل», also what the device outbox sends): refused before anything is written; a malformed or missing `createKey` is refused the same way. The one exception is the replay of a create **committed before this release** (its `crm-create:` receipt exists and the body is identical): it answers `alreadySaved` with the existing id, so a device whose answer was lost still gets its receipt and its queued opportunity can follow; nothing new is written. (2) `POST /api/customer-service` `action: 'create'` with `newCustomer`: refused for both service roles before the body is validated (the administrator keeps it; a request committed before the release still replays from its receipt). Already closed and only re-proved: the customer import (`/api/customers/import`, administrator or token), «استيراد من ERP» (`/api/erp-customers`, administrator and sales manager), the customer-code mapping (`/api/customer-identities`, administrator). Complaints, assistance requests, visits, follow-ups and mold requests only take an existing `customerId`; the Android app has no customer form of its own (it shows the site).
- **The UI** (`app/visit-customer-picker.tsx`): no «إضافة عميل» button or inline form for the service roles in «فرصة جديدة»; «no match» reads «لا يوجد عميل مطابق. اختار عميل موجود أو اطلب من المبيعات يضيفه.» / «No matching customer. Choose an existing customer or ask sales to add them.». The customers page and its «إضافة عميل» were never open to them (`canViewPage`), nor the master customer form (`start('customer')` is sales-only).
- **Editing like a representative** (until this release customer service had no customer-detail edit: `requireSalesRole` refused it). `POST /api/crm` `action: 'save', kind: 'customer'` with an `id` and no `parentId` now passes for the service roles (`serviceCustomerEdit`), with the representative's rules: the same schema and fields, the responsible member and branch kept (`assignedTo`/`branch` changes refused 403 «لا يمكنك تغيير مسؤول العميل أو فرعه», `canManage` false retains them), a region change only under the representative's conditions (the assignee covers it, no open service case), the version check, the location rules, an «تعديل» audit entry. **Scope:** a representative may correct any customer in their regions (`canEditCustomerDetails`: rep, no ownership); customer service has no customers of its own, so it gets the customers it already sees: **its branch within its regions** (the record is looked up in `regionalRecords` with `branch === me.branch`, otherwise 404 «السجل غير موجود أو ليس لديك صلاحية»). `lib/access.ts` `canEditCustomerDetails` (both forms) adds the service roles for their branch; `lib/crm-server.ts` `customerDetailMutationGuard` gives them `accessGuard` (identity, role, branch, region and auth version frozen at commit, the customer's version and region via `assertRecordMutation`), as a representative gets. Everything else stays refused: delete (403), a machine, an opportunity, a quote, a visit through `/api/crm`, members (403 «هذا الإجراء متاح لفريق المبيعات فقط»).
- **The edit in the UI** (`app/crm-app.tsx`): the customer card («فتح بطاقة العميل» in the opportunity form) shows «تعديل» for a customer of their branch within their regions (`serviceDetailsEdit`; their rows still arrive `_readOnly` for everything else, no new server value) and opens the representative's form: no «فرع يورست المسؤول» / «المندوب المسؤول», no delete (`canManageRecordRouting` false for them), no machine. Pages loaded before this release show no «تعديل» until refreshed (they never sent an edit).
- **Pages loaded before this release** (lesson of the last releases): no new server value; the old page sends the same requests and gets the 403 with the reason. Its picker submits through the device outbox, which never throws on a refusal: the customer entry is kept on the device marked «تحتاج مراجعة» with the server's reason (the strip reads «إدخالات محفوظة تحتاج مراجعة»), the customer can still be picked on that old page, and an opportunity recorded on it is kept too, blocked «أكمل رفع العميل المرتبط أولًا.» and never sent. Nothing is written on the server and nothing typed is lost: both entries can be archived for review from «حالة الحفظ» (the typed data stays readable there), and the opportunity is recorded again on an existing customer. Refreshing the page removes the button and brings «تعديل».
- **Tests.** `tests/crm-regression.mjs` (both service roles: create refused on `/api/crm` and with `newCustomer`, nothing written; the administrator's atomic `newCustomer` with audit-failure rollback; the pre-release replay answered from its receipt, a new key, a malformed key and none refused; owner, sales manager, supervisor and representative still add; edits of phone, contact, address, city and location saved with routing kept and audited; reassign, branch change, delete, machine, parent, stale version, outside region, another branch, a demotion racing the commit, opportunity/quote/activity/member refused), `tests/customer-detail-edit-access.mjs` (both roles edit admin-, manager-owned, unassigned and legacy customers with routing kept; outside region and another branch 404; reassign, branch, delete and create refused), `tests/rep-customer-create.mjs`, `tests/offline-server.mjs` (a queued service customer refused at sync, retry refused the same, nothing written), `tests/offline-outbox-browser.mjs` (Chromium: the refused customer and its opportunity stay on the device with the reason, the opportunity is never sent, both archive), `tests/customer-edit-browser.mjs` (Chromium, built release: customer service has no «إضافة عميل», the no-match text, the card's «تعديل» opens the form without routing fields, delete or machines, the phone and location saved with routing kept, outside its region 404, adding refused), `tests/role-ui.mjs` and `tests/rep-customer-ui.mjs` (no button for either service role, the no-match text in Arabic and English, sales roles unchanged), `tests/server-authorization.mjs` (built release over HTTP: every role's create on `/api/crm` and with `newCustomer`, the customer count, a request on an existing customer, both service roles' edit saved with routing kept, reassign and delete refused).

## Mold requests: the order number comes at production's approval, `requestRef` is the key (2026-11-05, release `update-mold-request-ref`, second package of the day, no migration)

- **Asked.** The products side's second message of 2026-11-05 (verbatim in `docs/MOLD-REQUESTS-CONTRACT-AR.md`): a request gets its `orderNo` when the production manager approves it (last + 1), `null` until then in the `requests`, `status` and `pending` answers, shown «لم يأخذ رقمًا بعد (يأخذه عند اعتماد الإنتاج)», read from the latest status every time and never kept as a key; every status object and pending item carries `requestRef` (a stable UUID), the key of a request registered in the products application; `approval` takes `requestRef` for those (400 malformed, 404 unknown), `crmRequestId` for the CRM's as before, `orderNo` still for a numbered one; requests are cancelled, no longer deleted, and keep their number; the numbers from 101 up move down by one once. The owner: the CRM goes live FIRST, so it works unchanged with the products application of today (always numbered, no `requestRef`) and with the new one.
- **Parsing** (`portable/mold-rules.mjs` `MOLD_REQUEST_REF`, `moldRequestRef`, `moldStatusObject`, `moldPendingItem`, `moldApprovalBody`): `orderNo` null or absent is read as null; `requestRef` only when it is a UUID, kept as it came; a malformed one is ignored, never the status or item that carries it; an answer of today's application reads byte for byte as before (no `requestRef` key). A pending item is read while something names it (crmRequestId, requestRef or number). `moldApprovalBody` takes exactly one of `id`, `requestRef`, `orderNo`.
- **No key by number** (`lib/mold-requests.ts` `moldPendingKey`, `moldPendingTarget`, `moldPendingQuery`, `moldPendingAgain`; `app/mold-requests.tsx` `MoldPendingList`): the waiting list's React keys, errors (with the request's name kept for one that left the list), «اعتمدتها الآن», the approval's retry key and «waiting again» go by crmRequestId (the CRM's), requestRef (registered in production) or, for today's application only, the number. `approve-order`/`withdraw-order` take one of `crmRequestId`, `requestRef`, `orderNo`: the CRM's own row is found by its crmRequestId (or by the requestRef its stored status holds) and sent by crmRequestId with the CRM's checks; one registered in production is sent by requestRef (approved only while production lists it in the manager's regions, as before by number); orderNo only for an item without requestRef. Production's 400 reads «تطبيق الإنتاج لم يقبل تعريف الطلب؛ حدّث الصفحة وحاول مرة أخرى.», its 404 «الطلب غير موجود لدى الإنتاج؛ حدّث الصفحة.» (both 409, so the page refreshes), a malformed requestRef from a page 400 before production is asked. Audit and receipts: `mold-ref:<requestRef>` for one registered in production (`mold-order:<n>` for today's application, as older entries stay), the detail with requestRef and the number production answered.
- **Pages loaded before this release** (lesson of the last release): they key every pending item by `orderNo`, so their GET (without `refs=1`, which this release's page sends) gets only numbered items, and the list error `bad_response` (a code they name) when any was left out (`moldPendingForOldPage`), never an item with a null number (shared React keys, shared errors, `orderNo: null` sent). Their approval by number keeps working while the products application is today's; once the CRM has learned the new one (any valid `requestRef` read; `crm_settings` row `mold-request-ref`, written once), any approval or withdrawal by number, and `orderNo: null`, is refused 409 «الطلبات بقت بتتعرّف بمرجعها مش برقم الأمر؛ حدّث الصفحة واعتمد من جديد.» without asking production (a number may have moved with the renumbering or not exist yet).
- **Downloads** (`app/api/mold-requests/design-file/route.ts`): a pending item's files by `?ref=<requestRef>` or `?crm=<crmRequestId>` (same authorization: the sales manager, the item in his list as production answers now); `?order=` kept for a numbered item (links on open pages, today's application); two names 400.
- **Display**: «رقم أمر الإنتاج» on the card, the sheet and «طلبات بانتظار اعتمادي» from the latest status/pending item (`moldOrderNoText`): the number, «لم يأخذ رقمًا بعد (يأخذه عند اعتماد الإنتاج)» / «No number yet (given at production approval)», «—» before any status or for a request cancelled without a number. The stored status is replaced on each pull even at the same revision, so a renumbered order shows its new number on the next pull; nothing else keeps the number (search reads the stored status, no offline copy of mold requests, no notification, the diagnose script counts only). Legacy `legacyOrderNo` (1–91, historical data in the original body) is not changed; none ≥ 101 in fixtures or docs.
- **Stand-in** (`scripts/lib/products-mock.mjs`, `requestRefs: true` / `setRequestRefs`): no number until production's approval (last + 1, `approve(key, 'production')` or `produce`), a stable `requestRef` in `requests`/`status`/`pending`, `approval` by `requestRef` (400 fields `['requestRef']`, 404) or `orderNo` for a numbered one, `renumber(101)` without a new revision, `cancelHere`, and `remove`/`removeOrder` refused (no deletions). The default stays today's application (which ignores `requestRef`).
- **Review fixes (same release).** (1) A number is resolved only against production as it answers now: the by-number approval asks for the list again and pulls the status of the CRM's request holding that number (or the latest one); if either cannot be read: 409 «تعذّر التأكد من الطلب الآن؛ حدّث الصفحة وحاول مرة أخرى.», never the copy kept from before (it could have approved another request after the renumbering); the CRM's own row must still hold the number without a requestRef, a production-registered item must be listed with it and no requestRef. (2) This release's page marks its approval (`page: 'refs'`): the by-number refusal once the update is learned applies to pages loaded before only; this release's page names by number an item production gave no requestRef (a rollback of the products application, a mixed answer) and it is checked as in (1). (3) Production's 400 reads «تطبيق الإنتاج لم يقبل تعريف الطلب…» only when it names `requestRef`; any other 400 is 502 «رفض الإنتاج بعض البيانات. حاول مرة أخرى.» as before. (4) A pending item that cannot be read (nothing names it) is counted (`pending.unreadable`) and said above the list («فيه N طلب من تطبيق الإنتاج ما اتقراش …»), and a page loaded before gets the list error. (5) The files' timetable (`sendDueMoldDesignFiles`) keeps a request's files in the order attached: a file waits while an older one of the same request is due or being sent (within a lease), one file at a time re-read after each send; a page's check running beside an upload's release had sent the quotation's file past the customer's signature (seen once in `mold-requests-browser`). English pairs for «حدد الطلب» and the new text.
- **Activator**: `update-mold-quote-file-activation-20261105` added to `BACKUP_TRANSACTION`, so this second package of the day reuses the backup the morning's package took (`tests/baseline-update-activation.mjs`).
- **Tests.** `tests/mold-requests.mjs` (parsing, approval body, key/target/links/words, the old page's list checked against the released `lib/mold-requests.ts` of 57a4e5d (1dcd37e before the history rewrite of 2026-11-16), the stand-in in both modes), `tests/mold-requests-http.mjs` (a new section: today's application with this release's and an old page's calls, then the switch and renumbering: numbers on the next pull, a new request without one, approval and download by requestRef, the old page refused, 400/404 texts, the receipt, production numbering and cancelling), `tests/mold-requests-browser.mjs` (the card, sheet and list in Arabic and English, approval by requestRef and by crmRequestId, the download by ref, the number after production's approval), `tests/mold-design-files-server.mjs` and `tests/mold-design-files-http.mjs` (pending links by `crm=`, `?order=` still served).

## Mold requests: the quotation's or PO's FILE is required, the numbers are gone (2026-11-05, release `update-mold-quote-file`, no migration)

- **Asked.** The products side (2026-11-05, Egyptian Arabic, kept verbatim in `docs/MOLD-REQUESTS-CONTRACT-AR.md`): remove «رقم عرض السعر» and «رقم الـ PO» from the form and send no `quoteNo`/`poNo` with new requests (production still accepts and stores them, without showing or counting them); require a quotation or PO file (PDF or image, one at least), sent after the request on `design-files` with its `category` as today; `quoteOrPoMissing` now means no quotation or PO file and finance has not approved (a number alone is not enough), shown as «ناقص ملف عرض السعر / الـ PO» with the attach action while the request is editable; yesterday's requests sent with a number only show «ناقص» and wait for the file; attaching or deleting a quotation or PO file no longer undoes the approvals (design files still do; the warning is for design files only); resending without duplicates is unchanged. The owner: the file is required of every role that asks (like the numbers before), not the sales roles only.
- **Numbers** (`app/api/mold-requests/route.ts` `checkedRequest`, `app/mold-requests.tsx`): no fields on the form, none in the signing summary, none on the card, sheet or «طلبات بانتظار اعتمادي» (`MoldQuotePoView` is `{missing}` only). A new request stores and sends none. A never-sent request stored with numbers keeps them through an edit (as the design link) and is sent byte for byte. A number from a page loaded before that differs from the stored one (any, for a new request) is refused `400` by its field («رقم عرض السعر ورقم الـ PO اتشالوا من الطلب؛ حدّث الصفحة وأرفق ملف عرض السعر أو الـ PO بدالهم.»); the stored one sent back is taken. Refusing rather than ignoring: neither changes a built body, and nothing typed is dropped silently. `production_only` no longer adds «كلّم مدير الإنتاج يضيف رقم…».
- **The required file** (`lib/mold-requests.ts` `moldAwaitsQuoteFile`, `lib/mold-requests-server.ts` `MOLD_AWAITS_FILE_SQL`, `releaseMoldRequest`): once production's update is known (the same flag), a new request of any role is saved with `data.fileRequired` (never in the requests body) and kept in the CRM while it has no live quotation or PO file and has certainly never reached production: `sending.held: 'quote_file'`, a new field (its `sending.state` stays `waiting` or `off`, a value the 2026-11-04 page knows: a new state would make an open old page throw on `moldSendingNames[state]`), shown by this release as «بانتظار ملف عرض السعر / الـ PO» before the link's state, its explanation to the requester and «بانتظار ما صاحب الطلب يرفق ملف عرض السعر / الـ PO» to a reader who cannot attach, no resend (409 «الطلب بانتظار ملف عرض السعر / الـ PO؛ أرفق الملف ويتبعت الطلب لوحده.»), never claimed by `sendMoldRequest` (checked, and in the claim's SQL), never due in `sendDueMoldRequests` (so kept requests never crowd out others), nothing on a restart. The form refuses «حفظ وإرسال» without one («أرفق ملف عرض السعر أو الـ PO (واحد على الأقل)») and uploads the quotation's and PO's files first. The first one attached (`design-files`) releases it: the request through the usual send, then its due files oldest first (signature, design files, the quotation's), each through the usual file send; when another sender (the timetable, a page's own check) claimed the request or a file at that moment, the release waits for that claim to end (up to 12 s) so the answer shows them sent. Deleting the only one before the request went keeps it again. Requests asked for before this release (with a number or none) carry no marker and go as they always did; production marks them «ناقص». The sheet offers the quotation's and PO's groups for a kept request even on a page that did not know the update.
- **«ناقص» by case.** The hint beside it: the requester is told where to attach it; anyone else reading one of the CRM's requests «صاحب الطلب يرفقه من الـCRM، أو مدير الإنتاج من تطبيق المنتجات.»; one registered in the products application «مدير الإنتاج يرفقه من تطبيق المنتجات.» (English pairs).
- **Diagnose.** `scripts/diagnose/mold-products.cjs` counts the kept requests as `heldForQuoteFile`, apart from `waitingToSend`/`toSend`.
- **Approvals** (`moldFileResetsApprovals`, `moldApprovalWaitsFor`, `designNeedsWarning(view, category)`): the sales manager's approval (and withdrawal, also `approve-order`) waits only for a design file on its way; attaching or deleting a quotation's or PO's file shows no warning (a plain delete confirmation), and the warning now names the design file. After any file the CRM stores production's status as answered and only refreshes the waiting list's cache; it does not assume a reset.
- **Stand-in** (`scripts/lib/products-mock.mjs`, `quotePo: true`): numbers taken, stored, part of the original, not counted; `quoteOrPoMissing` = no quotation or PO file (the CRM's or production's) and finance not approved, never for cancelled requests; quote/PO attach and delete keep the approvals, design attach and delete undo them. `quotePo: false` stays the application without the key.
- **Tests.** `tests/mold-requests.mjs` (the view's flag, `sending.held`, every state, category and payment a view carries within what the 2026-11-04 page knows, the hold rule, resend, approvals waiting for design files only, the stand-in's new contract), `tests/mold-design-files-server.mjs` (no call, timetable, file timetable or resend sends a kept request; five kept requests never crowd out an older one; customer service's kept and released by a PO file; release order; a release racing another sender's claim; delete re-holds; approvals kept by a PO file), `tests/mold-design-files-ui.mjs`, `tests/dictation-coverage.mjs` (the number fields' exception removed), `tests/diagnose-mold-products.mjs` (a kept request counted apart), `tests/mold-requests-http.mjs` (the whole flow over HTTP against the built release, yesterday's request with a number: missing, approved, a quotation file fixes it without undoing the approval, a design file does), `tests/mold-design-files-http.mjs`, `tests/mold-requests-browser.mjs`, `tests/mold-design-files-browser.mjs` (the form's refusal, the kept request's card and sheet, no warning for a quotation or PO file, the approval kept, English and phone width).
- **Docs.** The contract's CRM-side section (`docs/MOLD-REQUESTS-CONTRACT-AR.md`), `docs/UPDATE-2026-11-05-MOLD-QUOTE-FILE-AR.txt`.

## The default gate in parallel too (2026-11-05, tooling only; no release)

- **Asked.** The owner approved the next step: the default gate (`npm run check`, 166 checks, about 6.5 min one after another) runs its tests in parallel, so a small change's `npm run gates` drops to about 4 min.
- **`scripts/check.mjs`.** Same interface and output (PASS/FAIL lines, `output/check/<gate>-results.json`, the exit code, the ERP workbook gates, 512 MiB heap and 120 s per test, TypeScript 768 MiB/180 s, ESLint 2048 MiB/300 s), plus `--jobs N` (default: the CPU count, 4 here; `--jobs 1` is the old sequential run with no rerun). TypeScript and ESLint start first beside the tests, then longest first from the last report; each entry runs in its own process group. The manifest's new `serial` list runs alone after the pool, with its reasons: `record-index.mjs` and `same-snapshot.mjs` (millisecond budgets) and `portable-local-mail.mjs` (a 4.5 s kill timer checked within 6 s). A failure in a parallel run is rerun once alone: passing then prints `FLAKY`, is named in the last line and in the report's `flaky`/`firstTry`, never a plain pass. Every other default-gate test was checked for fixed ports, shared temporary paths, writes to `docs/`, `output/`, `public/` or `dist/` that another test reads, locks and timing guards: all use `mkdtemp` folders and none writes repository files.
- **`scripts/gates.mjs`.** Runs `check.mjs --jobs 4` (`--check-jobs`) in one slot of the pool beside the release-build and browser tests (`--default-gate first` runs it alone before them). Measured both: beside them is faster without failures (mold-only 4 min 14 s vs 6 min 40 s; full 11 min 18 s vs 13 min 3 s). A passing default gate that reran a failure is reported flaky with the entries named.
- **Measured.** `npm run check`: 6 min 25 s with `--jobs 1`; 2 min 46 s and 2 min 58 s with the default 4 (also 3 min 2 s with 3 and 2 min 40 s with 6), every run 166/166 with no flaky test. `npm run gates` for the mold signature fix (`--since 2bbcbac --to 6e3316f`): 4 min 13 s (was 6 min 48 s); `--full`: 11 min 6 s, 49 passed, 3 owner-file gates skipped, no flaky test (was 11 min 19 s).
- **Docs.** `tests/CHECKS.md` (the gate's first paragraphs and «بوابة الإصدار السريعة»), `docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md` §7.

## Release gates in parallel, and only the tests a change touches (2026-11-05, tooling only; no release)

- **Asked.** The owner: «اعمل يونت تيست على جميع اجزاء التطبيق والموقع بحيث متكررش الاختبارات دى تانى فى كل تحديث». The unit tests (`npm run check`) already cover the code; the hour went to the 19 `release-build` and 30 `browser` tests run one after another. He chose both: run them in parallel, and on each update run the whole default gate plus only the release-build/browser tests of the parts that changed (everything when something shared changed).
- **`npm run gates`** (`scripts/gates.mjs`): a clean build, then a pool (`--jobs 6`, at most `--browser-jobs 5` Chromium runs; measured on this 4-CPU machine: 4/3 took 15 min, 6/5 11.5 min, 8/6 10.5 min with one more load-induced failure) running the default gate first and the rest longest first, each test in its own process group with its own log, timeout (900 s / 1200 s) and screenshot folder under `output/gates/<run>/`; `perf-budget-browser` and `production-load` alone after the pool (they measure the machine); every failure rerun once alone and reported «flaky» or «failed», never hidden; the owner-file tests (`erp-workbook`, `erp-customers-workbook`, `erp-sales-browser` without its workbook) «skipped». The docs/ files tests rewrite are put back. `summary.json` lists per test the gate, status, seconds, checks and log, the totals, the wall clock and the selection rule with its reason. `--plan` prints the selection only; `--full` forces everything; `--since`/`--to` pick the change (default: what the package in `deploy/request.json` was built from).
- **Selection** (`tests/test-areas.json`, `scripts/lib/test-areas.mjs`): 19 areas built from the import graph and the routes and pages each test opens; a shared list (everything `lib/crm-server.ts` and `app/crm-app.tsx` reach that most areas use, the boot path, the build, the test harness, the dependency set) that forces a full run; a file no rule covers forces a full run and is named; generated offline-shell files and an `en.json` change that only adds keys select nothing by themselves; docs, Android, deploy requests and default-gate tests run the default gate only. Of the last 80 commits, every code commit outside the shared files selects 3 to 14 of the 49 tests.
- **Measured.** Full parallel run 11 min 19 s and 11 min 34 s, all 49 passed and 3 owner-file gates skipped, no flaky test (serial baseline about 55 min); the mold signature fix (`--since 2bbcbac --to 6e3316f`: 7 tests) 6 min 48 s (7.5 min in an earlier run whose default gate needed its rerun before the hang guard was widened).
- **Tests made safe under load (what they check is unchanged).** `tests/build-notice-browser.mjs` waits for the English words to load before reading the English notice; `tests/offline-browser.mjs` gives the second offline tab the app's bridge like the first (without it the tracking gate blocked it under load); `tests/visit-file-concurrency.mjs`'s hang guard is 15 s instead of 3 s.
- **Tests.** `tests/test-areas.mjs` (default gate): the map is valid, every release-build/browser test is in an area, every glob matches a file, and sample changes select what the rules say.

## Mold requests: the customer signs the request on the phone or tablet before it is sent (2026-11-04, release `update-mold-signature`, no migration)

- **Asked.** The owner: «العميل بيوقع على طلب القالب ولازم علشان يعتمد». His choices: the customer signs with a finger or a stylus on the representative's phone or tablet («التابلت او الموبيل»), before the request is sent at all («قبل إرسال الطلب أصلًا»); the signature goes to production as an image file with the request's files («يتبعت للإنتاج كصورة»); required for the sales roles only (representative, supervisor, sales manager), not customer service or the administrator («إجباري على المبيعات بس»).
- **Rules** (`portable/mold-rules.mjs`): `moldSignatureRequired(role)`, `moldSigner`, `moldSignatureName` («توقيع العميل - <signer>.png», always a name production accepts), `moldSignatureDrawn` (12 points over a 40 px box at least: a tap or a tick is refused on the device), `moldSignatureBytes` (base64, capped at 349 528 characters), `moldSignatureCheck` (signer 2..80; a whole PNG — `moldPngWhole`: IHDR first, at least one IDAT, IEND last, every chunk's CRC — at most 256 KiB and 1200 px a side, its long side at least 64, accepted by `moldDesignFileCheck` as a design image).
- **Form** (`app/mold-signature.tsx`, `app/mold-requests.tsx`): for a sales role «حفظ وإرسال» opens «توقيع العميل» (a read-only summary: customer, description, quantity, core, model, payment, quotation/PO numbers, files), the signer's name (dictation like any free text) and a 2:1 pad drawn with pointer events (`touch-action: none`, coalesced events, one pointer, redrawn when the pad changes width: a phone or tablet turned), «امسح», «تأكيد وإرسال». The PNG is trimmed to the drawing with a white background, at twice the CSS size within 1200 px, and made once per signing (frozen on the first confirm), so a retry after a lost answer resends the same body under the same key (no duplicate request); a new drawing, «امسح» or another name starts a new signing. The step opens scrolled to its top; the summary has no files line (files may change without a new signature); a server refusal by field clears when that field changes. The design picker keeps the tenth place for the signature and says so (`signature_room`). An edit that changes what was signed opens the step again («اتغيّرت بيانات الطلب؛ لازم العميل يوقّع تاني»); a server refusal of the signature opens it, one of the form's fields (or a 409 carrying the request) returns to the form.
- **Server** (`app/api/mold-requests/route.ts`): `signature: {signer, png}` on create and update (`/api/mold-requests` JSON limit 16 000 → 380 000, `lib/request-body.ts`). A sales role's create without a valid one: 400 `fields.signature` (`signer` for the name). The request and its signature's `crm_mold_design_files` row (category design, id `mds-<requestId>`, its bytes put in the object store first) are saved in one batch; the request is sent, then the signature through `sendMoldDesignFile` (the answer waits up to 15 s; the timetable takes it from there). `data.signature = {signer, signedAt, fileId}`; `requestBody` is built from explicit fields, so the requests body is byte-identical with or without it. The receipt keeps the PNG's sha256, never its bytes. An edit before the first send that changes the specifications, payment or numbers (compared on the validated specifications with their keys sorted) needs a new signature from a sales role, or from any role when the request holds one; the old one is removed in the CRM when production never held it, else stays as a design file; an edit changing nothing keeps it; 409 when the 10 design places leave no room (an old signature refused for good frees none). A write with no `signature` at all says to refresh the page («…؛ حدّث الصفحة لو مش ظاهر مكان التوقيع.»). The delete route refuses the signature the data names (409). Customer service and the administrator ask without it (one they send is checked and kept the same way). `GET` carries `signatureRequired`.
- **Display** (`lib/mold-requests.ts`): `MoldRequestView.signature` (signer, time, the image through `design-file`, and `state`: sent, waiting, stopped or refused, each said on the sheet), the file labelled «توقيع العميل» with no delete (`MoldDesignFileView.signature`, `canDelete` false); the pending item carries the CRM row's `signature`, `signatureDelivered` (production's listing holds the image: only then «وقّع العميل», else «توقيع العميل لسه ما وصلش للإنتاج»), and labels production's listing of it by `crmFileId`.
- **Unchanged.** `scripts/lib/products-mock.mjs` (the signature is a design image like any other), the schema (19 migrations), older requests and their resends, resend and cancel (no signature asked), the products contract.
- **Tests.** `tests/mold-requests.mjs` (rules, body bytes, view, pending labels, words and English pairs), `tests/mold-requests-http.mjs` (a new section on the built release), `tests/mold-design-files-http.mjs`, `tests/mold-design-files-server.mjs` and `tests/mold-design-files-browser.mjs` (each representative's request now carries its signature: counts and labels), `tests/mold-requests-browser.mjs` (the step on desktop, a 360 px phone with real touch and turned, a tablet with a stylus turned to landscape, Arabic and English), `tests/request-body.mjs` (the new limit). Test helpers: `scripts/lib/signature-png.mjs` (a real PNG), `scripts/lib/signature-pad.mjs` (drawing in Chromium).

## Mold requests: who sees which request, and no more «رابط التصميم» (2026-11-03, in the same package `update-mold-quote-po`, no migration)

- **Asked.** The owner: «يبان للمندوب طلباته بس ومدير المبيعات طلباته وطلبات فريقه», and «الغى رابط التصميم من الطلب». His choices: the sales manager's team is every supervisor or representative whose «المشرف» is the manager, and every representative whose supervisor's supervisor is (the chain walked at any depth, cycles guarded); customer service's requests still need a sales manager's approval: the managers of the customer's region approve them from «طلبات بانتظار اعتمادي», and they do not appear in the manager's own list.
- **Team.** `lib/mold-requests.ts` `moldTeamManagerId(memberId, members)`: a sales manager is their own; a supervisor or representative belongs to the first sales manager up their `supervisorId` chain through supervisors and representatives; '' for customer service, the administrator, a missing or non-sales link, or a cycle (each member visited once).
- **List.** `canReadMoldRequest`: the sales manager reads their own and their team's within their regions (no longer every request in their regions). The representative, supervisor, customer-service manager and administrator are unchanged.
- **Waiting list and approval.** `moldApprovesRequest(row, reader)`: a sales manager approves a CRM request whose customer (the CRM's row) is in their regions and whose requester is the manager, in their team, or in no sales manager's team (customer service, the administrator, an orphan or a broken chain), which every manager of that region approves; another manager's own or team's is that manager's. `lib/mold-requests-server.ts` `moldPendingFor` (now given `members`) filters production's pending items with it for the CRM's requests, and by the customer's Yourrest number for those registered in production, as before. `approve`/`withdraw` by id and `approve-order`/`withdraw-order` for the CRM's request use it (404 before production is asked otherwise); `moldPermissions`/`moldRequestView` take it as `approver`, so `can.approve`/`can.withdraw` match.
- **Opening a request.** `canOpenMoldRequest` (server): what the reader's list shows, plus, for a sales manager, a request their waiting list shows them now (not when production's list could not be had); used by `GET /api/mold-requests?id=` and `design-file?id=`. `design-file?order=` keeps checking the waiting list. The screen's «فتح الطلب» on such an item reads it with `?id=` and opens its sheet (approve there, withdraw from the open sheet); once approved it no longer opens, and its approved card says so.
- **«رابط التصميم».** The form (new, and the edit of a request never sent) no longer has the field; it sends no `designUrl`. The route keeps an older request's stored link exactly as it is on an edit, stores '' for a new request (so `moldRequestBody` sends none), and refuses a link from a page loaded before (a new one, or a change to the stored one) with 400 `fields.designUrl` «رابط التصميم اتلغى من الطلب؛ حدّث الصفحة، وأرفق التصميم كملف.» (English pair in `lib/locales/en.json`). An older request's link is resent byte for byte and shown read-only: on its sheet only when it has one, on the waiting list's card, and in its edit dialog.
- **Tests.** `tests/mold-requests.mjs` (the team and visibility matrix: direct, under a supervisor, deeper, an inactive supervisor, two managers of one region, a manager under a manager, customer service, the administrator, orphans, a missing link, a link to the administrator, cycles and a self-link; what each role reads and what each manager approves; `can.approve`; the body without a link), `tests/mold-requests-http.mjs` (built release: two managers sharing a region, their lists and waiting lists, the sheet, downloads by order and by id, approvals refused for another team's and allowed for shown items, customer service's request approved and withdrawn; the design link refused on a new request, an older request's link resent byte for byte and kept by today's edit), `tests/mold-requests-browser.mjs` (no field on the form; an older request's link read-only on its sheet and edit; customer service's request opened from «طلبات بانتظار اعتمادي» and approved there, absent from the manager's list), `tests/mold-design-files-server.mjs` (its representatives are the manager's team), `tests/dictation-coverage.mjs`.
- **Review fixes (same day).** `moldApprovingManagerId`: a team's request whose manager cannot approve it now (deactivated, or the customer outside their regions) goes to every sales manager of the customer's region, as a request of no team, so none is left without an approver; the routes' customer records (`all`) give the customer's region. The sheet shows no empty quotation/PO rows for a request without numbers that production does not hold. `moldQuotePoNumber` drops zero-width and direction marks first (a value of only those is none). The form keeps asking for the numbers once the server demanded them (a page loaded before the update), so a retry keeps its identifier. The representative's six tabs clip a long English label instead of overlapping.
- **Operations.** `docs/UPDATE-2026-11-03-MOLD-QUOTE-PO-AR.txt` («ما الذي يتغيّر» 5 and 6), `docs/MOLD-REQUESTS-CONTRACT-AR.md` (CRM side: who sees what, the design link).

## Mold requests: the quotation and PO numbers and their files (2026-11-03, third package of the day `update-mold-quote-po`, migration 0018: 18 → 19)

- **Asked.** The products side's second update of 2026-11-03 (its contract: `requests`, `design-files`, «كائن الحالة»): two fields «رقم عرض السعر» and «رقم الـ PO», text up to 60 characters, at least one required of the representative, either or both; a PDF or image file for each, up to 5 of each kind, 25 MB a file. `requests` takes `quoteNo`/`poNo` (absent or `""` for none; Arabic digits to ASCII, ends trimmed; longer than 60 or not a text: 400 `invalid_payload` naming the field); a retry must be the same data, and adding or moving a number on a sent request is 409 `request_locked` reason `production_only`. `design-files` takes `"category": "quote"|"po"` (a design file without it, or `"design"`), a quotation/PO file a PDF or an image or 400 `not_document`, the same `crmFileId` with the same category on a retry or 400 `crm_file_id_used`, 10 design / 5 quotation / 5 PO files (`too_many_files`). Status objects and pending items carry `quoteNo`, `poNo` (current values, the production manager's included), `quoteOrPoMissing`, `quoteFiles`, `poFiles` (each file with `category`); `designFiles` lists design files only. Nothing of it may be sent before the products update is live: the old application ignores it silently and no resend can fix that. Requests sent before need no number and stay unchanged.
- **The capability.** `lib/mold-requests-server.ts`: the CRM learns the update the first time any answer (status, pending, requests, cancel, approval, design-files, design-file-delete) carries a status object (or a pending item) with the key `quoteOrPoMissing`, whatever its value (`moldQuotePoAnswered`, `noteMoldQuotePo`), and keeps it in `crm_settings` (row `mold-quote-po`, `owner_id` = when it was learned; no new table), read on each use (`moldQuotePoSupported`), never removed. The page learns it from the existing GET (`quotePo: true`); POST answers carry it too.
- **Before it.** The form and every route behave as before: no fields, no quotation/PO pickers, no `category`, no new key in any body. The route refuses a number sent anyway (409 «تطبيق المنتجات لسه ما اتحدّثش لاستقبال رقم عرض السعر والـ PO…») and the design-files route a quotation/PO file (409). A request whose data nevertheless carries a number, or a quotation/PO file, is never sent while the update is unknown: held (not due on the timetable either), shown «بانتظار تحديث تطبيق المنتجات», and sent once it is learned.
- **After it.** `portable/mold-rules.mjs`: `moldQuotePoNumber`/`validateMoldQuotePo` (normalize; ≤60 after normalizing; «رقم عرض السعر أطول من 60 حرف» / «رقم الـ PO أطول من 60 حرف»; «اكتب رقم عرض السعر أو رقم الـ PO (واحد على الأقل)»); `moldRequestBody` adds `quoteNo` then `poNo` after `payment`, each only when the request's data has it (so a request without them is byte-identical to before; the body is always built from the CRM's data, never from a status). The route requires one on create and on an edit before the first send (the server and the form alike), stores them normalized in `crm_mold_requests.data` (keys only when given). A sent request is not edited from the CRM (as before), so no path sends changed numbers; a 409 `production_only` that ever comes back now reads «… كلّم مدير الإنتاج يضيف رقم عرض السعر / الـ PO».
- **Files.** `drizzle/0018_mold_file_category.sql` adds `crm_mold_design_files.category` (`design` default, `quote`, `po`). Upload route: `category` in the form (none = design, as before), the CRM's own checks (`moldDesignFileCheck(name, bytes, category)`: PDF/image only, `not_document`), per-category limits counted with production's own (`moldDesignCount(..., category)`: 10/5/5) with Arabic refusals («الحد 5 ملفات لعرض السعر…»). `moldDesignFileBody` adds `"category"` for quote/po only, so a design file's line is byte-identical to before; a retry uses the stored category. Delete and download as before; the download route finds a file by its fileId in `designFiles`, `quoteFiles` or `poFiles` (the request's sheet and the sales manager's list). Production's new 400 reasons are said in words (`not_document`, `too_many_files` per kind). The per-request total is 10×25 MiB for design files plus 2×5×25 MiB for the quotation and PO (no separate total limit existed).
- **Display.** The request's sheet, the representative's card and «طلبات بانتظار اعتمادي» show «رقم عرض السعر» / «رقم الـ PO» from the status object or pending item (production's current values), the CRM's own only before production holds the request, and «ناقص عرض السعر / الـ PO، يضيفه مدير الإنتاج» when `quoteOrPoMissing` is true. The sheet groups files as design / quotation / PO (CRM-attached and production's own), each with its count, picker (a PDF or an image for the quotation and PO) and download; the sales manager's cards list the quotation's and PO's files with their links. Arabic and English for every text (`say(ar,en)`, `lib/locales/en.json`).
- **Stand-in.** `scripts/lib/products-mock.mjs`: `startProductsMock({quotePo})` / `setQuotePo()` switch between the application before its update (ignores the numbers and `category`, no `quoteOrPoMissing` key, every file in `designFiles`) and after it (the contract above: validation and normalization, the numbers in the original a retry is compared with, 409 `production_only` on a change, `quoteOrPoMissing` true only for a request taken after the update without either and not cancelled, `quoteFiles`/`poFiles` with `category`, `designFiles` design only, the category rules and limits); `setNumbers()` for the production manager adding or correcting a number; `addProductionFile({category})`.
- **Release.** `portable/activate-ui-refresh-update.cjs` `BACKUP_TRANSACTION` also accepts `update-erp-mold-activation-20261103` (today's second package), tested in `tests/baseline-update-activation.mjs`. To be packaged later as `update-mold-quote-po` (stage `yourrest-crm-update-mold-quote-po-<date>`, helper `yourrest-activate-update-mold-quote-po.cjs`) with `--schema-baseline 18 --new-migration 0018_mold_file_category.sql` (19 migrations after it) and the same `--verify-route` list as `update-erp-mold` (`/api/app-update=200`, `/api/mold-requests=401`, `/api/mold-requests/design-file=401` and the rest).
- **Tests.** `tests/mold-requests.mjs` (normalization, validation, the body with and without numbers, learning, categories, the view, the stand-in before/after its update), `tests/mold-design-files-server.mjs` (section 15: nothing taken before, held, learned from each route, required, normalized, categories, limits, `not_document`, a retry with the same category, downloads by fileId from `quoteFiles`/`poFiles`), `tests/mold-design-files-ui.mjs` (the groups, pickers and places), `tests/mold-requests-http.mjs` and `tests/mold-design-files-http.mjs` (built release), `tests/mold-requests-browser.mjs` and `tests/mold-design-files-browser.mjs` (Chromium: the form, the sheet's groups, the sales manager's list, English, phone width); `tests/dictation-coverage.mjs` lists the two number fields as typed (codes copied from the document); `tests/baseline-update-activation.mjs` (the same-day backup after update-erp-mold).
- **Operations.** `docs/UPDATE-2026-11-03-MOLD-QUOTE-PO-AR.txt`.

## Mold requests: «اعتماد المالية», the payment, and a cancellation production can undo (2026-11-03, second package of the day, one package with the ERP import below, no migration)

- **Asked.** The products side (already live on its site; this release must be live before the CRM sends `payment`): the third approval is shown as «اعتماد المالية» (key still `admin`); a required `payment` (`cash`/`deferred`) beside customer, salesman and specs, refused otherwise with 400 fields ["payment"], returned by pending (null for older requests), not changeable after sending; and the production manager may restore a cancelled request, after which the same cancellation (same reason) answers 200 with the request not cancelled.
- **Labels.** `lib/mold-requests.ts`: `moldWaitingNames.admin` «بانتظار اعتماد المالية» / Waiting for finance approval, `moldApprovalNames.admin` «المالية» / Finance (the sheet composes «اعتماد المالية»). Keys unchanged.
- **Payment.** `portable/mold-rules.mjs` (`MOLD_PAYMENTS`, `moldPayment`; `moldRequestBody` adds `payment` after specs only when the request has one, so a request stored before is resent byte for byte; `moldPendingItem` reads it). Stored in `crm_mold_requests.data` (JSON, no migration). The route requires it on create and on an edit before the first send («اختار طريقة الدفع: نقدي أو آجل»); the form has a required «طريقة الدفع» (نقدي / آجل); the sheet, «طلبات بانتظار اعتمادي» and the approver's sheet show «الدفع». Production's refusal of the field reads «طريقة الدفع غير صحيحة».
- **Restore.** `lib/mold-requests-server.ts`: every request production holds is pulled (accepted or with a status), cancelled ones too; `moldRemoteStatements` stores every status with, when the stored one said cancelled and the new one does not, an audit entry «رجّعه مدير الإنتاج بعد الإلغاء» and (for a CRM cancellation) its marks cleared with `last_error` code `restored` — a cancellation still waiting for its resend is dropped then (`cancel_dropped`); one production never showed as cancelled is still sent. A cancel answered 200 not cancelled is not marked cancelled (`same_reason`, 409 to the screen, never retried; «رجّعه مدير الإنتاج بعد الإلغاء، واكتملت الاعتمادات أو بدأ الإنتاج؛ لم يعد الإلغاء ممكنًا.» instead of asking for a new reason once it may no longer be cancelled). A waiting cancellation whose stored status already says cancelled is settled as delivered, not sent again, so a later restore is the pull's (audited) and never a same-reason or locked answer. The «restored» banner shows only while the request may still change, with «write a new reason» for the requester alone. A design file production refuses with 409 because the request is cancelled there is held, not refused for good: not sent while the request is cancelled in the CRM or in the stored status («لن يُرسل: الطلب ملغى»), sent once it is restored. A reason used before (the request's earlier `mold-request:cancel` audit entries, compared with spaces normalized) is refused on the screen and by the server before sending. A cancellation answered with the request's status now also keeps `accepted` when the first send's answer was lost, so its status keeps being pulled.
- **Stand-in.** `scripts/lib/products-mock.mjs`: payment validation and storage, payment in the original data and in pending, `restore()`, used cancel reasons (the same reason answers 200 with the request as it is whatever its state, checked before the 409 for a request no longer received), `loseNext()` (a call carried out whose answer is lost).
- **Tests.** `tests/mold-requests.mjs`, `tests/mold-requests-http.mjs` (built release: also the same reason after a restore and the approvals, and a waiting cancellation a pull saw cancelled), `tests/mold-requests-browser.mjs` (Chromium: also no restored banner once approved or cancelled again in production, the sales manager's banner without the instruction, production's payment on the approver's sheet, the payment choice at phone width), `tests/mold-design-files-server.mjs` (a file held while cancelled in production, sent after the restore), plus payment in `tests/mold-design-files-http.mjs` and `tests/mold-design-files-browser.mjs`.
- **Release review fixes.** A request the production manager restored before this package was deployed, whose restore the live release (4582aa4) already pulled (it pulled cancelled requests too but stored the status alone, the CRM's cancelled marks kept, so the sales manager's approval got 409 «الطلب ملغى»), is settled by this release's next pull: `RESTORED_SQL` in `lib/mold-requests-server.ts` also matches a request the CRM cancelled whose cancellation was delivered (no outbox) and whose stored status, stored after `cancelled_at`, is not cancelled, while the status coming is not cancelled either; audited «رجّعه مدير الإنتاج بعد الإلغاء» with the reason, marks cleared, approval allowed. A cancellation still waiting and a request production holds cancelled are never cleared (`tests/mold-requests-http.mjs`).
- **Package.** The ERP import below and these changes ship together: release name `update-erp-mold`, stage `yourrest-crm-update-erp-mold-20261103`, helper `yourrest-activate-update-erp-mold.cjs`. Its activator reuses the day's backup the morning's `update-fallback` activation took: `BACKUP_TRANSACTION` (`portable/activate-ui-refresh-update.cjs`) now also lists `update-fallback-activation-20261103` and the 2026-11-02 activations `update-erp-customers`, `update-erp-code`, `update-design-files` and `update-android-1012` (without them it stopped after Stop App with `INVALID_DAILY_BACKUP_INDEX`). `tests/baseline-update-activation.mjs` runs every same-day pair of 2026-11-01 to 2026-11-03 under the shipped names (232 checks); `scripts/rehearse-update.mjs` adds a site where an activation under the earlier package's name (`--after-package`, by default the package `deploy/request.json` names) takes the day's backup first and this package's activator must reuse it.
- **Operations.** `docs/UPDATE-2026-11-03-ERP-MOLD-AR.txt` (the one guide of the package; `docs/UPDATE-2026-11-03-MOLD-PAYMENT-AR.txt` is superseded by it, its stage folder and activator were never built).

## «استيراد من ERP» updates every customer's ERP code, offers similar names and adds the customers the CRM does not have (2026-11-03, second package of the day, one package with the mold request changes above, no migration)

- **Asked.** The owner: «عاوز ارفع الملف يعدل كود العميل لكود ERP بس كده، ولو العميل مش مضاف يضيفه»; the number matters most, and every existing customer already has its region. YR-C-000302 kept code 345 because no ERP row had its phone or exact name, only a name one word different; the owner chose to be shown the similar names and to pick «ده هو», «عميل جديد» or leave the row, nothing changed or added until then.
- **Matching.** `lib/erp-customers.ts`: a row with no phone or exact-name match is found by its code (current code, kept alias or stored mapping: `same` matched by `code` with nothing to change, `held-outside`, or `choose` among several holders; never added); else, with a name, by similar names (looked for among all customers and offered inside the user's regions: new status `similar`, nothing preselected, at most 5 ranked; similar names only outside the regions make the row `out-of-region`, never added); else `new`, added by default. A by-code holder whose current code is another row of the file is not preselected (a choice with `codeRow`, as in the phone/name step), so importing the same file again after an apply does not conflict. A row without a name and nothing found is `invalid` (`no-name`). The similar-name rule (`similarNameTokens`, `nameSimilarity`): nameKey words with «عبد»/«ابو» joined to the next word, «و» before «ال»/«لل», «ال»/«لل» (when three letters remain) and a final «ء» taken off; generic words dropped (`ERP_GENERIC_NAME_WORDS`: شركة, مؤسسة, مصنع, مصانع, للتجارة, التجارية, للصناعة, والتسويق, للمقاولات, المحدودة, co, ltd, est, company, factory, trading and a few more), one-letter words dropped, at most 12 words; always compared on the whole word lists: similar when the names share a word of three letters or more and at most one word differs on each side; the shared words count as evidence only when at most 20 CRM customers carry all of them (unless both names have exactly the same words); score = shared / union. Candidates come from the customers with exactly the row's words and those carrying all of its words but one (bounded by the shortest word list, memoized). `missing` is gone.
- **Choices.** `ERP_ADD_CUSTOMER` (`'+new'`, `lib/erp-customers-shared.ts`) means «عميل جديد», accepted only on `new` and `similar` rows (refused elsewhere: «السطر N مش عميل جديد؛ اعمل معاينة جديدة»); a `new` row with no choice is added, a `similar` row with no choice is left; a similar pick takes the code like a `choose` pick, conflicts included.
- **Apply.** `lib/erp-customers-server.ts`: the new customers in the same transaction as the code changes, behind the same receipt; ids `crm-<member>-erp-<requestId>-<row>` (a replay adds nobody twice); data as the customer form builds it (`schemas.customer`, location fields, `_createdBy`): name (Arabic, else English, 250), code, the phone cells as text, a valid email, the address; no ID number or date; responsible the uploader, their branch, the region chosen in the preview (`region`, or a row's own in `regions`), checked with `memberCanAccessRegion` (400 for a value that is not a region, 403 outside the scope). History: `إضافة` with «name • إضافة عميل من ملف ERP». The gate also refuses when a record has one of the ids or anyone now holds a new row's code; the preview's snapshot now covers each row's status and candidates too. At most 2000 new customers per apply. The result lists `added` and `additions` with the Yourrest numbers. The mold customer list nudge after an apply stays.
- **Screen.** `app/erp-customers-import.tsx`: the summary line (codes that change, customers to choose, new customers), «محتاج تختار» (choose and similar rows; «ده هو», «عميل جديد», «سيبه» buttons), «عملاء جداد هيتضافوا» (a «سيبه» toggle, «منطقة العملاء الجداد», a row's own region), the rest of the file with its filters, «حدّث X كود وضيف Y عميل», and after the apply what changed, what was added and what was left; Arabic and English.
- **Tests.** `tests/erp-customers.mjs` (230), `tests/erp-customers-ui.mjs` (178), `tests/erp-customers-http.mjs` (129, built release), `tests/erp-customers-browser.mjs` (71, Chromium), `tests/erp-customers-workbook.mjs` (29: the owner's file against an empty CRM, against itself, with one word of each customer's own added, and with two words or the same three words added, counts only).
- **Operations.** `docs/UPDATE-2026-11-03-ERP-MOLD-AR.txt` (the one guide of the package; rollback keeps the customers an import added). `docs/UPDATE-2026-11-03-ERP-IMPORT-ADD-AR.txt` is superseded by it; its stage folder and activator were never built.
- **Review fixes (same day, before any deploy).** Common words no longer vanish before the one-word check (a name one word longer than a customer whose words are all common was `new` and added a duplicate; two names two words apart could reduce to one shared word and score 1). A regional manager's row whose only similar names are outside their regions is `out-of-region`, not added. A row found only by an old code of a customer whose current code is another row is a choice, so re-importing the same file no longer blocks the apply with a conflict. The screen shows «منطقة العملاء الجداد» and the note about the uploader whenever a customer is added (also from «عميل جديد» on a similar row); each «ده هو» is named with its candidate (and a new row's «سيبه» with its row) for screen readers; a row the user acted on stays in the part where they acted; after the apply «اللي اتساب» lists the rows left; the region selects are 16 px / 46 px on a phone. The workbook gate now adds one word of each customer's own (and checks that two words, or the same three words for all, find nothing); the update note states the word rules as the code applies them.
- **Release review fixes.** Additions are opt-in on the server: the apply carries `adds`, the number of new customers the preview showed (`app/erp-customers-import.tsx`), and `lib/erp-customers-server.ts` refuses, before anything is written, an apply without it with 409 `ERP_SCREEN_OUTDATED` («شاشة الاستيراد دي اتفتحت قبل تحديث النظام؛ حدّث الصفحة واعمل معاينة جديدة. ما اتحفظش أي حاجة.» followed by the same sentence in English, because that screen cannot translate a new message) and one with another number with 409 «الشاشة دي ما عرضتش العملاء الجداد اللي هيتضافوا؛ حدّث الصفحة واعمل معاينة جديدة». An import screen loaded before the deploy (it said rows without a match are left alone and never sends `adds`) can no longer add every new row silently, and its code-only applies are refused too: it cannot read this release's answer (no `missing`), so a save it made read as unconfirmed and the dialog could not be closed until the page was reloaded. `tests/erp-customers-http.mjs`, `tests/erp-customers-ui.mjs`, `tests/erp-customers-browser.mjs`, `tests/mold-customers-http.mjs`.

## The browser install path for the Android update (2026-11-03, first package of the day, hotfix, no migration)

- **Asked.** On some phones (two representatives on 1.0.11) the in-app download of 1.0.12 completed but Android closed the install confirmation at once, so the panel went back to «التحديث جاهز للتثبيت» and nothing was installed; the owner's phone installed it from Chrome.
- **Change.** `app/app-update.tsx`: after a download, while Android has not answered, after an install that did not finish or after an error, the update panel (and «حدّث تطبيق يورست للمتابعة») also shows «ثبّت عن طريق المتصفح» under «تثبيت التحديث», with how to accept Chrome's warning and the install permission; it opens the announced release's APK (`/downloads/yourrest-crm-android-v1.0.12-13.apk`) in the browser, and Android's ordinary installer updates the app in place (same signature, data kept). Not shown while downloading or offline. The APK and its fingerprint are unchanged. `tests/app-update-ui.mjs`, `tests/app-update-browser.mjs`.
- **Package.** Release name `update-fallback` (4582aa4, `deploy/packages/Yourrest-CRM-Update-UpdateFallback-20261103.zip`), deployed 2026-11-03 with the owner's approval (`d468ac3`); its activation took the day's verified full backup (`yourrest-update-fallback-activation-20261103-…`), which the day's second package reuses.
- **Operations.** `docs/UPDATE-2026-11-03-UPDATE-FALLBACK-AR.txt`.

## Android 1.0.12 (forced), the products app's PR #27 and the production-only rule (2026-11-02, fifth package of the day, no migration)

- **Asked.** The owner approved a new Android release for design files in the app; the products side then reported PR #27 (PDF marker within 1024 bytes, mismatched image extensions and reserved names accepted, the refusals too_many_files and crm_file_id_used with fields ["crmFileId"]) and that a sent request is edited only by the production manager there (409 request_locked, details.reason production_only; pending returns production's current data).
- **Android 1.0.12 (13).** `mobile/android`: the file picker follows the page's accept list (all files when an extension has no Android type); «عرض» and «تنزيل» of `/api/mold-requests/design-file` are fetched natively with the session (never handed to another app), opened through the app's own read-only provider or saved with the system's save window. Built and signed on GitHub with the installed app's certificate; `.github/workflows/android.yml` now rebases before pushing the APK. Published with `scripts/publish-android-release.mjs`; the required version becomes 1.0.12.
- **PR #27.** `portable/mold-rules.mjs` and the stand-in accept a PDF whose `%PDF-n.n` marker is within the first 1024 bytes; the stand-in answers the two refusals like the site; Arabic/English text for crm_file_id_used; file links hidden on the sales manager's «اعتمدتها الآن» cards.
- **Production-only rule.** No «تعديل» for a sent request (a request that certainly never reached production may still be edited); the server refuses the update with «بيانات الطلب يعدّلها مدير الإنتاج فقط»; production_only is final and never resent; the stand-in remembers the original data (a resend of it answers 200 created:false). The pending list and the request sheet show production's customer, salesman and specs for the sales manager.
- **Review.** Adversarial reviews: Android 6 findings, PR #27 4, production-only 16; all fixed with tests.
- **Operations.** `docs/UPDATE-2026-11-02-ANDROID-1012-AR.txt`.

## Mold request design files (2026-11-02, fourth package of the day, migration 0017)

- **Asked.** The products side's contract addition «ملفات التصميم» (routes design-files, design-file-delete, design-file; designFiles in the status object and pending items) and the owner's list: attach and delete in the form and the sheet with the warning that it sends the request back to the sales manager, store in the CRM and send with retries, show every file (the rep's and production's) with downloads through the CRM after a permission check, the files in the sales manager's pending list, and tests.
- **Data.** `drizzle/0017_mold_design_files.sql`: one additive table (`crm_mold_design_files`) and two indexes; the bytes in the object store (`mold-design/<request>/<file>/<attempt>`), now also copied by the daily backup (`portable/backup-core.mjs`).
- **Rules and client.** `portable/mold-rules.mjs` (extensions and kinds, names, 25 MiB, 10 files, PDF and image header checks with production's reasons, designFiles read from status and pending), `portable/mold-client.mjs` (the binary body signed as sent, the binary download, 120 s for the two file routes).
- **Server and routes.** `lib/mold-requests-server.ts` sends files through the existing retry timer once production holds the request; 400/404/413 and 409 are not retried; deletions go through design-file-delete. `app/api/mold-requests/design-files`, `.../design-files/delete`, `.../design-file` (by request for whoever may read it, by order for the sales manager's pending items only).
- **Screens.** `app/mold-design-files.tsx` and `app/mold-requests.tsx`: the picker with checks on the device, uploads after the save, the warning before an attach or delete on a request production holds, each file's state, view and download through the CRM, the files in «طلبات بانتظار اعتمادي».
- **Review.** Two adversarial rounds (stage 1: 5 findings, stage 2: 20); all fixed with tests except the Android app's file chooser and downloads, which need an Android release.
- **Tests.** `tests/mold-design-files-server.mjs`, `tests/mold-design-files-ui.mjs`, `tests/mold-design-files-http.mjs` (built release), `tests/mold-design-files-browser.mjs` (Chromium), and more checks in `tests/mold-requests.mjs`, `tests/server-authorization.mjs`, `tests/production-backup.mjs`.
- **Operations.** `docs/UPDATE-2026-11-02-DESIGN-FILES-AR.txt` (rollback in two cases because of the migration).

## The ERP code goes with the customer list sent to the products application (2026-11-02, third package of the day, no migration)

- **Asked.** The owner, after «استيراد من ERP»: in the products application the customer cannot be found by its ERP code (146), only by its Yourrest number; «ابعت كود ERP للإنتاج».
- **List.** `moldCustomerEntry` (`portable/mold-rules.mjs`) adds `erpCode`, the customer's `data.code` trimmed, with Arabic-Indic digits as ASCII digits, control characters dropped (a code that held one must not stop the whole list) and invisible marks dropped (direction marks and zero-width characters a paste from an RTL sheet brings, as the ERP import already strips), '' when none or over 50 characters (never cut) so production clears a removed code; `lib/mold-customers-server.ts` passes it for every listed customer. A deleted customer goes without the field (its deletion record does not keep the code), so production keeps the code it holds. The list's fingerprint changes once, so the whole list goes again after the update.
- **Review.** An adversarial review of the first version found the control-character throw, the cleared code of deleted customers and the Arabic-Indic digits; a second pass found the invisible marks; all are fixed and tested.
- **After an import.** `app/api/erp-customers/route.ts` nudges the list after an apply (`nudgeMoldCustomers({soon:true})`), as a customer edit already did.
- **Contract copy.** `docs/MOLD-REQUESTS-CONTRACT-AR.md`: `erpCode` in the `customers` route; production ignores it until it supports it (its validator reads only the fields it knows).
- **Stand-in production.** `scripts/lib/products-mock.mjs` validates and stores `erpCode` (optional, up to 50).
- **Tests.** `tests/mold-requests.mjs` (the field, trimming, ASCII digits, control characters, '' when empty or too long, left out without a code given, the order of the fields), `tests/mold-customers-http.mjs` (the code in the first list, kept on an edit, sent shortly after «استيراد من ERP», cleared as '', a deleted customer keeps its code in production).
- **Operations.** `docs/UPDATE-2026-11-02-ERP-CODE-AR.txt`.

## «استيراد من ERP» replaces «ربط عملاء ERP»; the products side's notes on mold requests (2026-11-02, second package of the day, no migration)

- **Asked.** The owner: remove «ربط عملاء ERP» and put «استيراد من ERP» in its place, which updates the customers from the ERP customer export; only the ERP customer number is updated, matched by mobile or name, a doubtful match chosen by hand, a customer the CRM does not have left alone, ERP the source when the codes differ; the system administrator and the sales manager use it. The products application's review of the integration: «أُلغي في تطبيق الإنتاج» on a request cancelled there, the 409 reasons of the approval route as the contract lists them, a deleted customer sent as active:false when it is deleted, the 60-second limit of the customers route and production's corrections only after the approvals (both already true in the CRM; the contract copy updated).
- **Import.** `lib/erp-customers.ts` (pure: the header found by its names, phones normalized to Saudi national digits with placeholders dropped, names normalized loosely, outcomes auto / same / choose / missing / out-of-region / invalid, conflicts when two rows end on one customer, an explicit code mapping when another customer holds the number, a manager kept from deciding a customer outside their regions), `lib/erp-customers-server.ts` and `app/api/erp-customers/route.ts` (preview without writing; apply recomputes from the same file, refuses a stale preview with 409, writes only `data.code` with the customer's version, keeps the old code as an alias through the 0014 trigger, one audit entry per customer, a receipt for a repeated tap). The strict XLSX reader of `lib/erp-sales.ts` gained a generic `readWorkbookSheets` without changing the sales parser. Screen: `app/erp-customers-import.tsx`.
- **Removed.** `app/customer-identities.tsx` and its button; the stored code mappings keep working for ERP sales, and deleting a customer now removes its own mappings in the same transaction (no screen removes one any more).
- **Mold requests.** `moldApprovalRefusal` reads the reason in the contract's order; the card of a request cancelled in production reads «أُلغي في تطبيق الإنتاج»; `app/api/crm/route.ts` records a deleted customer's number, name, address and city (`mold-customers:removed`) and `lib/mold-customers-server.ts` sends the deletions since its last send as active:false with the list.
- **Tests.** `tests/erp-customers.mjs` (pure), `tests/erp-customers-ui.mjs`, `tests/erp-customers-http.mjs` (built release), `tests/erp-customers-browser.mjs` (Chromium), `tests/erp-customers-workbook.mjs` (gate erp-customers-workbook, the owner's file through ERP_CUSTOMERS_WORKBOOK, counts only), `tests/mold-customers-http.mjs` (a customer deleted through the CRM sent as active:false), `tests/mold-requests.mjs`, `tests/mold-requests-browser.mjs`; updated `tests/rep-mobile-shell.mjs`, `tests/server-authorization.mjs`, `tests/customer-identity-ui.mjs`.
- **Operations.** `docs/UPDATE-2026-11-02-ERP-CUSTOMERS-AR.txt`.

## Mold requests: fixes from the review of the products link (2026-11-02, no migration)

- **Asked.** The owner asked for a review of the whole integration with yourrest-products, then approved fixing what it found («تمام نفذ»): items 7, 8, 10, 14 and 20 of the review, tests for 23, 25 and 26, and a read-only check of production's `pending` and `status` routes on the live account.
- **Customer name 200.** `MOLD_LIMITS.customerName` 160 → 200 (`portable/mold-rules.mjs`): production takes 200 in both the requests and customers routes, so any customer the list carries can be asked for.
- **City as the sheet writes it.** `moldRequestCity` (`portable/mold-rules.mjs`): a new request stores and sends one of the sheet's nine cities in the sheet's form (`Damam - الدمام`), any other city untouched; existing requests keep their bytes (`app/api/mold-requests/route.ts`).
- **Retries after a restart.** `keepMoldRetrying` (`lib/mold-requests-server.ts`) checks at once, then every minute; started by the CRM page every member loads (`wakeMoldRetries` in `lib/mold-customers-hook.ts`, `app/api/crm/route.ts`) as well as by the mold requests page, so a request that waited through a restart goes without anyone opening that page.
- **Cancelled in production.** A request deleted or cancelled in the products application reads «أُلغي الطلب في تطبيق الإنتاج» on its sheet, not «production has started», and no stage is marked current (`app/mold-requests.tsx`).
- **Refusal reasons.** `moldApprovalRefusal` (`portable/mold-rules.mjs`) names the real reason production refused an approval or its withdrawal (cancelled there, a historical request, production approved first); 404 says production does not know the request. A refusal about a request registered in production (crmRequestId null) is read too (`readMoldAnswer(..., {manual})` for the approval route), and an edit that reaches a request deleted in production says so instead of «production has started».
- **Screen.** A request cancelled in the CRM reads «ملغى» at once, even while the cancellation still waits to reach production; the sales manager's list keeps a refusal readable after the request has left the list.
- **Read-only check of the link.** `scripts/diagnose/mold-products.cjs` (test `tests/diagnose-mold-products.mjs`): production's `pending` and `status` routes through the live release's own client, compared with the CRM's copy, and the clock (a signed call accepted, a 401 stale_timestamp, production's Date header); counts and times only, the database opened read-only (immutable when the app is stopped), no file written, the secret and the address never printed, a settings.cjs error never quoted.
- **Contract copy.** `docs/MOLD-REQUESTS-CONTRACT-AR.md` brought in line with yourrest-products (a deleted request is returned `cancelled`).
- **Stand-in production.** `scripts/lib/products-mock.mjs`: `remove` (deleted there, read as cancelled) and `forget` (a 404).
- **Tests.** `tests/mold-requests.mjs` (124), `tests/mold-requests-http.mjs` (84: the sheet city, a 195-character name, deleted in production, the cancelled refusal, the 404, a request sent after a restart), `tests/mold-requests-browser.mjs` (the cancelled-in-production sheet), `tests/mold-customers-http.mjs` (27: an edited name and city, production down while a customer is saved, the daily list after 24 hours and not before, across a restart).
- **Operations.** `docs/UPDATE-2026-11-02-MOLD-FIXES-AR.txt`.

## The CRM's customers in the products application (2026-11-01, fifth package of the day, no migration)

- **Asked.** Requests registered directly in the products application choose the customer from the CRM's list only (the contract's signed `customers` route: `full` deactivates whoever is missing, `upsert` adds or changes; up to 2 MB and 20000 customers a call; answer `{received, inserted, updated, deactivated, activeCustomers}`).
- **Change.** `lib/mold-customers-server.ts` (new): every CRM customer with a Yourrest number and a name (`crm_customer_numbers.number`, name, address, city; no phone, email or anything else) goes as one `full` call (`moldCustomerCalls`; over production's limits, `upsert` batches without a final `full`, so nobody is deactivated that time): the first time the server is used, a few seconds after a write through `/api/crm` or `/api/customer-identities`, whenever the list's fingerprint changed (checked every ten minutes, any path of change), and at least once a day. One send at a time; a failure waits for the next check. Each send audited as `mold-customers:sync` with counts and the fingerprint only (which also carries it across a restart). `portable/mold-rules.mjs`: `sheetCity` (a CRM city that is one of the production sheet's nine, by its Arabic or English name, goes as the sheet writes it, e.g. `Damam - الدمام`; any other city as it is, nothing guessed), `moldCustomerEntry`, `moldCustomerCalls`, the 2 MB limit of this route in `portable/mold-client.mjs`.
- **Tests.** `tests/mold-requests.mjs` (114: cities, entries, batching, the route against the stand-in), `tests/mold-customers-http.mjs` (built release: the first full list, nothing when unchanged, a new customer sent shortly after, a deleted one deactivated, the audit without names, nothing without the settings).
- **Operations.** `docs/UPDATE-2026-11-01-MOLD-CUSTOMERS-AR.txt`. Needs the products application with the `customers` route.

## Mold requests: everyone asks, the sales manager approves, each request says where it waits (2026-11-01, fourth package of the day, no migration)

- **Asked.** The owner: every role asks for molds («الكل بيعمل طلب», customer service too). The products application (its contract, docs/MOLD-REQUESTS-CONTRACT-AR.md): three approvals in order (the sales manager, from the CRM through the new signed `approval` route; then production; then the system administrator); the status stays `received` until all three, and any edit from the CRM undoes the ones given; the status object carries `waitingStep`, `waitingSince` and `approvals`; `halfBlock` takes none/one/two/three.
- **Change.** `portable/mold-rules.mjs` (`MOLD_HALF_BLOCKS` four values, `MOLD_WAITING_STEPS`, `moldApprovalBody`, the status object reads where it waits, since when and the approvals), `portable/mold-client.mjs` (the `approval` route). `lib/mold-requests.ts`: every role has the page and asks; who reads: everyone their own, a supervisor their representatives', the sales manager every request in their regions, a customer-service manager their team's, the administrator all; `canApproveMoldRequests` (the sales manager only); approve while production has it at the sales step with nothing waiting to send, withdraw until production approves. `app/api/mold-requests/route.ts`: customer service asks for its branch's customers in its regions; `approve`/`withdraw` call production first and save only its answer, with a receipt (a repeated tap asks production once). `lib/access.ts`: customer service sees the page. `app/mold-requests.tsx`: where it waits and since when (card and request), the three approvals with their times (and the sales manager who approved), «بانتظار اعتمادك» for the sales manager, the Approve / Withdraw approval buttons, a warning in the edit form that a change undoes the approvals, four half-block choices, «مقدّم الطلب».
- **Every request through the sales manager (second contract change of the day).** Production's sales-manager approval is given in the CRM only, for every request, those registered in production too: production's signed `pending` route (every request at the sales step, the longest waiting first; `moldPendingItem`) feeds the sales manager's tab «طلبات بانتظار اعتمادي» (opened first, refreshed every 3 minutes while open; the server keeps the list a minute, `pullPendingApprovals`), within their regions by the customer's Yourrest number; `approve-order` / `withdraw-order` name a request by production's order number: the CRM's own goes by its crmRequestId, one registered in production by `orderNo` (and only while production still lists it), audited as `mold-order:<n>`.
- **Stand-in production.** `scripts/lib/products-mock.mjs` follows the products application's approval chain (approval route rules, waiting step and since, edits undo approvals, historical rows need none).
- **Tests.** `tests/mold-requests.mjs` (100), `tests/mold-requests-http.mjs` (75, built release), `tests/mold-requests-browser.mjs` (40, Chromium), `tests/server-authorization.mjs`, `tests/mobile-navigation-ui.mjs`.
- **Operations.** `docs/UPDATE-2026-11-01-MOLD-APPROVALS-AR.txt`. Needs the products application with the `pending` and `approval` routes; before it, everything else works and Approve answers with production's error.

## Mold manufacturing requests, linked to the products application (prepared 2026-11-01, migration 0016)

- **Screen.** «طلبات تصنيع القوالب» (`app/mold-requests.tsx`): a representative asks for a mold for a customer of their own (search and choose; the contract fields with the usual widths and gelba sizes), the request is saved in the CRM first (`crm_mold_requests`, `drizzle/0016_mold_requests.sql`) and then signed and sent to the products application (contract v1, `docs/MOLD-REQUESTS-CONTRACT-AR.md` and its addendum) with the customer's Yourrest number. The list and each request pull the status in one call (seven stages with dates, production order, serial, production and delivery dates), cached a minute, with the last known state and its reason on failure. Failed sends wait on the §6 timetable with «إعادة الإرسال»; edit and cancel only while received, a 409 explained. Supervisors, sales managers and administrators follow in their scope; customer service has no page. On the phone the page opens from «حسابي» so the representative keeps the same five tabs. No export, notifications or files.
- **Server.** `app/api/mold-requests/route.ts`, `lib/mold-requests.ts`, `lib/mold-requests-server.ts`, `portable/mold-rules.mjs`, `portable/mold-client.mjs`. Settings `YR_PRODUCTS_API_URL` and `YR_PRODUCTS_SECRET` from `settings.cjs`; without them sending is off and the rest of the CRM is unchanged. The secret never reaches a page, a log or the package.
- **Earlier requests.** `portable/mold-import.mjs` links the 91 requests the products application imported with their order numbers 1–91: `--compare` (Yourrest number or ERP code?), `--dry-run`, `--apply`; production first, nothing guessed, reruns change nothing.
- **Tests.** `tests/mold-requests.mjs` (64), `tests/mold-requests-http.mjs` (42, built release), `tests/mold-requests-browser.mjs` (25, Chromium), `tests/mold-import.mjs` (30); `tests/mobile-navigation-ui.mjs`, `tests/server-authorization.mjs` updated; the historical package tests pin their 16 migrations. Not tested against the real products application from here.

## A tablet beside the work phone (2026-11-01, second package of the day)

- **Asked.** Representatives will carry a tablet and a work phone and use the app on both at once, one of them recording the route.
- **Change.** `lib/tracking-companion.ts` (new): a representative's device that is not set up is a *companion* when the server reports today's day as being recorded by another device (`GET /api/mobile-route` reports an open day only while its collector is heard, and the day is not this device's own `dayId`); outside working hours, when another device recorded today or this device was a companion within the last week (per-device memory). `lib/tracking-gate.ts`: a companion passes the gate without tracking permissions; until the first server answer a not-set-up device stays "checking" (nothing reported, no flash of the blocked screen). `app/journey-tracker.tsx`: the native tracker asks the server on start, every minute while not set up, and as soon as its own collector stands down; status `companion` with no errors or setup banner, a note in the visit form, a header mark; a companion never enrolls itself or creates a trip stop (`selectCustomer` returns no stop). `app/customer-journey-map.tsx`: directions open; the trip is not recorded from the companion. `app/device-status-reporter.tsx`: a companion does not report, so the team page keeps the recording phone's status. `app/tracking-gate.tsx`: a former companion whose phone went quiet is told where the route was recorded and that enabling here moves it. No server change beyond the morning's package; no migration; no new Android app.
- **Tests.** `tests/tracking-companion.mjs` (25), `tests/tracking-gate.mjs` (89), `tests/native-tracking-ui.mjs` (634), `tests/tracking-gate-ui.mjs` (80), `tests/tracking-gate-browser.mjs` (104, a real Chromium tablet beside a recording phone).

## A representative's day moves to a new phone (2026-11-01, server only)

- **Problem.** A representative's route day is bound to the phone that started it. After reinstalling the app (or moving to another phone) the same day, the new phone was refused until the end of the day ("التسجيل مرتبط بجهاز آخر"): the phone's app refuses to enroll while `GET /api/mobile-route` answers with another device's open day, and `begin` refused another device with 409.
- **Change.** `app/api/mobile-route/route.ts`, `lib/mobile-route.ts` (`MOBILE_SILENT_AFTER_MS` = 30 minutes, `mobileDayHeardAt`, `mobileDaySilent`), `lib/mobile-route-server.ts` (`mobileDayQuiet`, which also reads the newest received sample). For a representative, an open day whose collector has not been heard for half an hour (no sample, no recorded interruption, nothing received) is no longer reported by `GET`, and a continuous `begin` from another phone takes it over: the quiet day closes at the last moment it was heard, the new day starts from there, in one guarded batch. While the first phone is heard, the second is refused with a clearer message. The first phone, if it comes back, gets 409 for samples after the handover, so its app re-checks and stops instead of retrying. Supervisors and managers (the manual tracker) are answered exactly as before. No migration; no new Android app.
- **Tests.** `tests/mobile-route-devices.mjs` (62 checks); `tests/mobile-route.mjs` unchanged and green (387).
- **Not in this update.** A tablet used beside the work phone at the same time (one device records, the other works without recording) comes next.

## Space freed on the hosting account (2026-11-01, no change to the app)

- **Found.** A read-only inventory (`scripts/diagnose/space.cjs`, mode=diagnose) counted 27.62 GB in the account's home: 16 activation checkpoints (12.71 GB, a full copy of the data on each day an update was applied), 34 copies from 2026-10-03 to 10-07 made before the current tools (12.77 GB), 20 unpacked update packages, the app (0.12 GB), the live data (1.14 GB) and the nightly backups (2 kept, 74 MB each, the last at 03:15 Riyadh, verified).
- **Removed (the owner agreed).** mode=prune (`scripts/prune/old-copies.cjs`, `tests/prune-old-copies.mjs` 36 checks) removed the 13 checkpoints and 11 unpacked packages of 2026-10-07 to 10-21: 24 folders, 10.25 GB, after a dry run and after it verified last night's backup with the live release's `restore.mjs` (run 41277937755). The checkpoints of 10-29 and 10-31 (the way back from the last three updates and yesterday's full copy), their packages, the nightly backups and everything not ours stay.
- **Removed next (the owner agreed).** The early-October copies made before the current tools: 34 folders of 2026-10-03 to 10-07, 12.75 GB (run 41278444601), last night's backup verified again first. In all 58 folders and 23.0 GB; the home folder went from 27.62 GB to about 4.6 GB.
- **Found on the way.** The live data folder is 1.14 GB because of `schema-backups` (349 copies of the database taken before old migrations by `release/operations/upgrade.mjs`, 1.09 GB); the database itself is 71 MB and there are no attachment files. The nightly backup (database and attachments, 74 MB) is therefore complete. Each update's daily full copy also copies `schema-backups`; thinning it would make those copies about 15 times smaller (not done).

## Android 1.0.11 published and required (2026-10-31, second package of the day, package update-android-1011, schema 16, no migration)

- **Built and signed on GitHub.** `.github/workflows/android.yml` opens the owner's key from the repository secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), checks that its certificate is the installed app's (`1d49b33c…`, the one recorded in `scripts/publish-android-release.mjs` and carried by the served 1.0.10 APK), builds with `mobile/android/tools/build-oss.py`, reads the signer back with apksigner, and commits the APK and its report to `deploy/android/`. The key exists on the runner only during the job.
- **Published.** `scripts/publish-android-release.mjs` put 1.0.11 (code 12, 242,509 bytes, sha256 `246ce417…`) in `public/downloads`, `public/app-update.json` and `lib/app-update-release.json`, with notes that describe the request notifications. As the forced update was designed, the served version is the required one: a phone on 1.0.10 is asked to update before it continues. The owner chose this over a pilot on one phone first; 1.0.11 was not tried on a real phone before.
- **The download links follow the served version.** The install card (`app/install-app.tsx`), the route screen's update notice and the tracker's error texts (`app/journey-tracker.tsx`) named 1.0.10 and linked its APK by hand, so a new phone would have downloaded 1.0.10 and been blocked at once. They now read the version and the APK path from `lib/app-update-release.json`, as the tracking gate already did. The tests' Android phone (`scripts/lib/native-bridge.mjs`) reports the served version unless a test says otherwise.
- **Deployed** 2026-10-31 19:22 Riyadh (run 41219208124): today's backup reused, checkpoint `yourrest-update-android-1011-activation-20261031-hFZIvL`, DEPLOYMENT VERIFIED (16 migrations, record ids preserved). Verified before: rehearsal 18/18 over the morning's package, release-build 15/15, browser 26/27 (ERP workbook absent), `--check` on the account (`docs/qa/REPORT-ANDROID-1011-AR.md`).
- **Same day.** The activator accepts `update-fast-open-activation-20261029` and `update-digits-signin-activation-20261031`, so this second package of the day reuses the morning's backup (`tests/baseline-update-activation.mjs`, 181 checks).

## Daily backups on crm.yourrest.org (2026-10-31, no change to the app)

- **Found.** A read-only check (`scripts/diagnose/backups.cjs`) showed no daily backup: no cron line, no `~/yourrest-crm-backups`, only the activators' 15 checkpoints taken on the 10 days an update was applied (13.6 GB), the longest gap 8 days. The live database is about 78 MB.
- **Done.** `mode=backup` of the deploy workflow takes a backup with the live release's own `backup-scheduled.mjs`, verifies it with `restore.mjs verify`, and adds the command `backup-cron.mjs` prints as a daily cron line at 03:15 Riyadh (20:15 server time, UTC-4), once, only after a verified backup. First backup: 74 MB in 4 s while the app ran; the recheck says DAILY BACKUPS RUNNING. `tests/deploy-cpanel.mjs` (93 checks) and `tests/diagnose-backups.mjs` (16) cover both.
- **Still open.** Every copy lives on the same hosting account; the old activation checkpoints are not pruned yet (kept until the daily backups have run for a few days, and only with the owner's go).

## The deploy workflow on Node 24 actions (2026-10-31, no change to the app)

- `.github/workflows/deploy.yml` uses `actions/checkout@v5` and `actions/setup-node@v5` (Node 24) instead of v4 (Node 20, deprecated by GitHub and already forced onto Node 24 with a warning). setup-node v5 would cache the package manager named in `package.json` (pnpm, never installed by this job), so `package-manager-cache: false`. Proved with a read-only diagnose run (Actions 41207163499): green, and the Node 20 warning is gone.

## ESLint at zero errors and part of the default gate (2026-10-31, no change to the app)

- **Reviewed first.** The 96 errors and the 32 missing-dependency warnings were read one by one in the visits, follow-ups, route tracking and map screens and the rest: no bug among them. Every ref read while rendering changes together with a state update; every state set in an effect resets or loads on purpose; the four "immutability" reports are refs the React Compiler rules did not recognise; the two synchronous scripts in `app/layout.tsx` must run before the first paint; the four `any` are the per-kind JSON of a record, a target set and the CRM route's parsed body.
- **What changed.** `eslint.config.mjs` makes the four React Compiler rules (this project does not use the compiler) warnings and records the two other exceptions with their reasons; `npm run check` now runs ESLint and fails on any error (146 checks). Rewriting working code in the most used screens to satisfy those rules was judged riskier than useful. 0 errors, 162 warnings.

## Arabic digits in invoice numbers and customer codes; invisible characters in member and sign-in emails; the day report on a 360 px phone (2026-10-31, package update-digits-signin, schema 16, no migration)

- **The gap.** The invoice key (`lib/invoice-reference.ts`) and the customer-code key (`lib/customer-identity.ts`) folded marks, wide letters, spaces and case, but not the digits of an Arabic keyboard: "INV-١٠٢٣" and "INV-1023" were two invoices (a manual sale and its ERP twin both counted), and "C-١٠٢" and "C-102" two codes (ERP sales reaching no customer). Both keys now fold Arabic-Indic (٠-٩) and Persian (۰-۹) digits; display text is unchanged.
- **The live data, checked first.** `scripts/diagnose/arabic-digits.cjs` ran read-only on the hosting account (2026-10-31, `deploy.yml` diagnose mode): 0 manual sales, 54 ERP sales, 2,229 customers, and no Arabic digit in any reference, code, alias or mapping. So no stored key (`crm_sales.reference_key`, `crm_customer_code_mappings.code_key`, ERP `document_key`) changes and nothing is recomputed. Run the same check again just before the package that carries this fix is deployed.
- **Member emails.** `normalizeMemberEmail` (`lib/member-email.ts`) now also drops the zero-width non-joiner and joiner (U+200C, U+200D) a paste from a chat can carry.
- **The sign-in page.** It only trimmed and lowered the email, so one pasted from an Arabic chat (direction marks around it) was refused as «اكتب بريد الشركة الصحيح» although it was right. The page (`app/email-login.tsx`) and the server (`lib/email-auth.ts`) now clean it with the same `normalizeMemberEmail` the team form saves with; the field drops the marks as they are pasted. `tests/email-auth.mjs` (the code reaches the member) and `tests/ui-refresh-browser.mjs` (the manager signs in with a pasted email) cover it.
- **Tests.** `tests/invoice-reference-key.mjs`, `tests/customer-code-key.mjs`, `tests/member-email.mjs`, and `tests/invoice-reference.mjs` (the sales route: an invoice already entered is refused in Arabic or Persian digits, a row saved before the fix still blocks its plain twin, the ERP key meets the manual one); each fails without the fix.
- **The day report on a 360 px phone.** The team-member list of «تقرير يوم المندوب» grew to its longest name, and since phone fields use 16 px text (2026-10-20) it was wider than its box: the page scrolled sideways by 12 px for managers, supervisors and the administrator. On phones the list now fits its box (`app/journey-report.css`); a long name is cut in the closed list and shown whole when it opens.
- **Browser tests that had stopped testing.** `offline-browser` and `pwa-browser` now really go offline (Playwright's `setOffline` does not reach the service worker's own requests in this Chromium; the test's front server cuts the connection too), `app-browser-workflows` really denies location (`Browser.setPermission` with this context's id) and closes the stop the earlier visit opened before the directions tap that must meet a failing tracking request. All three pass end to end for the first time since 2026-10-12; the 360 px day-report overflow above is what `app-browser-workflows` found once it got that far.

## Opening the app on the device's copy, scripts kept in the cache, the English dictionary on demand (2026-10-29, second package, schema 16, no migration)

- **Measured first.** On the same throttled phone and slow 4G, a representative's usual opening (the app opened before on that device) took about 1.85 s, and 3.25 s when the server answered in 600 ms: the page waited for `/api/crm`, then for the IndexedDB write, before drawing anything, and asked for support and complaints only afterwards. And every opening downloaded 112 KB of scripts again.
- **The cause of the downloads.** The release check (`lib/build-freshness.ts`) asked the server with HEAD at the very address of the page's scripts; Chromium and the Android WebView drop their cached copy of a script after a HEAD request for its address (proved with a direct experiment). It now asks at `?release-check`; the server answers the same 200 or 404.
- **What changed.** The first load of a page shows this account's copy on the device at once with a quiet «يتم تحديث البيانات…» line, and the server's answer replaces it; the copy is saved after it is on screen and the first save of a session flushes the device queue at once; `lib/same-snapshot.ts` keeps an identical answer (and the copy announced again after saving) from redrawing the screen; the support and complaints requests go out with `/api/crm`. The copy is only read for the account unlocked on this device in this session: another account signing in on the same phone never sees it, and an ended session clears it. The customers page draws the cards or the table, not both (4,853 to 2,841 elements on a phone). `lib/locales/en.json` is imported only when English is chosen.
- **After, same conditions.** Usual opening 1.2 s instead of 1.85, and 1.4 s instead of 3.25 with a slow server (the data shows before the server answers); no script downloaded on a usual opening. First opening after a release: 411 KB of scripts instead of 442, about 4.25 s instead of 4.38. Splitting the rarely used pages with `React.lazy` was measured and not kept: Rolldown cut the shared code into 20 files instead of 8 and the first opening got slower on a slow link.
- **Tests.** `tests/same-snapshot.mjs`, `tests/i18n-lazy.mjs` (default gate); `tests/open-cached-browser.mjs` (browser gate: the server's answer is held back on purpose to see each step, another account never sees the copy, an ended session clears it); `tests/build-notice-browser.mjs` checks the check address and that the next opening takes every script from the cache; `tests/service-queue-browser.mjs` waits for the server's answer after a reload that needs fresh data.
- No migration, no change to permissions, data or the Android app. The activator accepts the speed release's activation name. A package of its own (`update-fast-open`).

## Lists, search and page switches at production size on phones and tablets (2026-10-29, schema 16, no migration)

- **Measured first.** The built app on a 390 px phone four times slower than the test machine, slow 4G, 2,300 customers and 6,000 visits: a manager waited about 39 s for the data, about 40 s for each page switch and about 21 s for each letter typed in the customer search; any tap froze the screen for more than 30 s. On a tablet (twice slower): 18 s, 15 s and 8 s. The cause was not the network or the bundle but computations that scanned every record once per row, on every screen update.
- **What changed.** `lib/record-index.ts` (lookups built once per snapshot); `customerPlanSources` (every customer's latest plan in one pass, used by the due-for-follow-up list and the follow-up plans); `visitCustomer`/`visitRequest` through a per-array id lookup; memoised derived lists, per-snapshot search text and `useDeferredValue` in `app/crm-app.tsx`; customer search fields prepared once per row; one module-level `Intl` formatter per format (`today`, `money`, `riyadhDate`, `formatVisitTime`, `journeyDate`, `quantityNumber`); one index and one order key per call in `filterVisitRows` and `customerHasQuotation`.
- **After, same conditions.** Manager on the phone: data about 7 s, page switches 0.8 to 1.3 s, a letter about 0.3 s, opening a customer under 1 s. Manager on the tablet: data about 2.3 s, page switches 0.4 to 1.1 s, a letter about 0.1 s. A representative's letter went from 0.45 to about 0.25 s; the representative's first load (about 5 s on slow 4G) is unchanged and is the next phase.
- **Same results.** `tests/record-index.mjs` (25,001 checks) compares every replaced computation with the scan it replaced on random snapshots; `tests/perf-budget-browser.mjs` (browser gate) keeps the timings inside a budget. The UI harnesses learnt `useDeferredValue`.
- No migration, no change to permissions or screens. The activator accepts the auto-stop release's activation name. A package of its own (`update-speed`).

## The activator stops the Node.js server the host restarts after Stop App (2026-10-27, schema 16, no migration)

- The cPanel Node.js host starts the application again when a phone's request arrives (the representatives' route tracking sends requests all day), so **Stop App** did not always leave it stopped and the activator refused with `APP_OR_DATA_STILL_IN_USE`; the way round was a manual `kill` and the activator straight after (the 2026-10-21 deployment).
- **Now** the activator stops the application's own `lsnode`/`node` processes itself: SIGTERM first (15 s), SIGKILL for what does not leave (5 s), up to three rounds if the host starts it anew. It prints `APP STILL RUNNING (PROCESS ...): STOPPING IT NOW...` and `APP PROCESSES STOPPED: n`.
- **Narrow on purpose.** Only a Node.js server holding the application or data folder (working directory, command line, or an open file under the data folder) is stopped. Never the helper itself, the shell/terminal chain that ran it, a shell sitting in the folder, or any other program: those still end in `APP_OR_DATA_STILL_IN_USE` as before. Run once, before any lock or checkpoint exists, and never for `--check`/`--verify`; the later checks stay strict.
- Changed: `portable/activate-ui-refresh-update.cjs` (`appServerProcesses`, `terminateApp`, the single call in `run()`, the update-notice release's activation name), `scripts/rehearse-update.mjs` (refusal now proven with a real `sleep` holding the folder; then the application started again as the host does and stopped by the activator), `tests/activate-auto-stop.mjs` (31), `tests/baseline-update-activation.mjs` (169), guide §9-ع.
- No migration, no change to what the application does: the client code is the 2026-10-21 code (compared chunk by chunk: the only differences are the build's random id and the hashed script names a build regenerates), plus the activator copy under `operations/`. Because the script names changed, a page left open on the previous release shows the «update available» notice, the first time it is seen in production. A package of its own (`update-auto-stop`).

## "An app update is available, reload" notice (2026-10-21, schema 16, no migration)

- A page opened before a release was deployed kept running the old code until it was closed and opened again, so representatives did not see new buttons (the add-machine button after the machines update) and had to be told to close the app. The page now notices a newer release by itself and says so: a notice at the top, «يوجد تحديث للتطبيق», with a reload button.
- **How it knows.** Every deployment renames the hashed scripts under `/_next/static/`, so the page asks the server with a HEAD request (no body, `no-store`) whether the scripts it runs still exist: a 404/410 means a newer release. A 5xx or a network failure proves nothing and raises no notice (a release being switched answers 5xx). The offline shell's script is judged from the server's shell manifest. It asks when the page opens, every ten minutes, and when the user returns after a minute or more; never offline and never while the page is hidden. A known newer release stays known until the page reloads.
- **Nothing reloads by itself**, so a half-written visit is never lost. The button first asks the service worker holding a newer offline shell to take over (the worker never calls `skipWaiting` on its own: only on the page's explicit message), then reloads.
- **The Machines tab explains itself.** For a customer that is not the representative's own (a colleague's), the tab no longer says «add the next record using the buttons above» (there is no such button): it says «لا توجد ماكينات لهذا العميل» and «تُضاف ماكينات العميل من مندوبه المسؤول عنه.» (English translated). A phone screenshot from a representative who saw no add button was exactly this case.
- Not covered: pages already open on the old code (they predate the check) need one close-and-open; a deployment that changes no client script shows nothing (correctly).
- Changed: `lib/build-freshness.ts` and `app/build-notice.tsx`/`.css` (new), `app/crm-app.tsx`, `lib/locales/en.json`, `public/sw.js` (message handler), `tests/offline-shell.mjs`, `portable/activate-ui-refresh-update.cjs` (the comfort release's activation name). Tests: `tests/build-freshness.mjs` (68), `tests/build-notice-browser.mjs` (16), `tests/machines-browser.mjs` (31, with the colleague's-customer cases), `tests/baseline-update-activation.mjs` (the new same-day pair).
- No migration. A package of its own (`update-reload-notice`) carrying everything of the comfort package. Going back to an earlier release only removes the notice.

## Phone and tablet comfort: touch targets, readable text, a working customer sheet, a lighter first load (2026-10-20, second release of the day, schema 16, no migration)

- **Touch targets.** Every control a finger must hit is at least 44 px on every touch screen, tablets wide enough for the desktop layout (1024 px and up) included: buttons, links, chips, the disclosure rows of the folded sections, the inputs, the map's zoom buttons, the logout button, the table links. The same 18 pages at 360 px: 88 controls under 40 px before, none after (the map's legal credit link excepted).
- **Text.** Nothing visible is under 12 px any more (556 occurrences on the same 18 pages at 360 px before: the bottom-bar labels, the customer card's chips, the tracking step labels, badges, captions; the map's legal credit excepted).
- **The customer sheet.** The close button is 44 px (it was 16 px) at the reading end so it no longer crowds the title; the tabs sit in one scrollable row 44 px tall (on a 360 px phone the last tab, «سجل التغييرات», fell out of its bar onto the fields below); and the sheet's tabs and fields now follow the reading direction (Radix forced left-to-right on the whole sheet: the labels, values and the tab order were mirrored in Arabic).
- **Tablets (768–1023 px).** The page header's actions wrapped past the screen edge by 63–120 px; they now wrap onto a second line when they must, and the page title keeps its own line instead of being squeezed beside them. 17 of the 18 pages overflowed at 768, 820, 900 and 1023 px; none overflows at 360, 412, 768, 820, 1023, 1024 and 1180 px, with and without the phone's emulation.
- **A lighter first load.** The build now precompresses the scripts and styles (`--precompress`), which the server serves directly: the first load of a phone is about 0.6 MB instead of about 2.2 MB; later visits download nothing (the files are cached as immutable).
- Also in this release: the representative's «add machine» button in the customer sheet (top and the Machines tab) that the machines release missed.
- Changed: `app/touch-comfort.css` (new), `app/globals.css`, `app/rep-mobile-shell.css`, the other stylesheets under `app/` (font sizes only), `app/crm-app.tsx`, `components/ui/sheet.tsx`, `scripts/build-independent.mjs`, `portable/activate-ui-refresh-update.cjs` (the machines release's activation name, so the day's backup is reused). Test: `tests/mobile-comfort-browser.mjs` (177 checks); `tests/baseline-update-activation.mjs` covers the new same-day pair.
- No migration. A package of its own (`update-mobile-comfort`) carrying everything of the machines package. Going back to an earlier release changes only the look.

## Machines recorded by the representative, model and bushings as lists, the Kingdom's border on the maps (2026-10-20, schema 16, no migration)

- A representative adds and corrects the machines of **their own customers** (the customer's responsible member owns the machine record); a colleague's customer offers neither, the server refuses it (403) before any field is judged, and deleting stays with the administrator. Supervisors, managers and the administrator are as before.
- The machine form no longer asks for the machine's place inside the factory or its number, and neither is shown on the card, the details or the search; what was recorded earlier stays in the record untouched and is kept on every later save. The single machine counts as one.
- **The model and the bushings type are drop-down lists, New or Old.** The model is no longer typed: the choice replaces it and completes the machine; a model name typed before stays on its machine and shows after the choice («Old · V3»). Changing either sends open mold requests on the machine back to technical approval like the other specifications.
- **The maps show the Kingdom and nothing beyond it.** The customer-location map and the customers map grey out everything outside the Kingdom's border (Natural Earth 1:10m, simplified to about 900 m), draw the border, and cannot be dragged away; the northern and eastern regions no longer open on Jordan, Iraq, Qatar or the Emirates. The location picker refuses a tap or a dragged pin outside the border; the server and the form refuse a new or changed customer place outside it (5 km allowed for a phone's fix at the border), while a place saved earlier is kept. Markers of customers already saved outside the border stay visible over the grey.
- The English interface: the machine card, form, choices and messages are translated, checked in a real browser to hold no Arabic beyond the names.
- Changed: `lib/crm.ts`, `lib/access.ts`, `lib/crm-server.ts`, `lib/machines.ts`, `lib/customer-fields.ts`, `app/api/crm/route.ts`, `app/crm-app.tsx`, `app/customer-machines.tsx`, `app/followups.tsx`, `app/location-picker.tsx`, `app/customer-map.tsx`, `portable/activate-ui-refresh-update.cjs` (the names of the releases of 2026-10-17 to 2026-10-18 added to the list of earlier activations); new `lib/kingdom.ts`, `lib/kingdom-border.ts`, `app/kingdom-layer.ts`, `app/kingdom-map.css`. Tests: `tests/role-scope.mjs`, `tests/role-ui.mjs`, `tests/rep-mobile-shell.mjs`, `tests/rep-customer-create.mjs`, `tests/context-performance.mjs`, `tests/baseline-update-activation.mjs`, `tests/customer-location-rules.mjs`, `tests/location-picker-browser.mjs`, and the new `tests/machines-browser.mjs`.
- No migration. A package of its own (`update-machines`) carrying everything before it. Going back to an earlier release leaves the two answers recorded and unshown (a machine the representative added shows to the earlier release as any machine, with no typed model).

## Support requests follow the approval, assignment and closure chain (2026-10-18, second release of the day, schema 16, no migration)

- Every support request, whether a sales member opened it or a customer-service representative took a missed visit, now travels the path complaints already use: the representative contacts the customer and submits the result, the customer-service manager approves it (or returns it for amendment with a reason), the sales manager assigns a supervisor or representative (the customer's current representative is suggested first), a supervisor may delegate, the assignee contacts the customer by visit, call, WhatsApp, e-mail or another channel and records the result, and the representative who took it closes it, or sends it back to the assignee with a reason. The representative alone closes; there is no second approval. Cancelling is allowed before assignment (the asker or their chain, the service manager for missed visits and what they review) and by the administrator at any open stage.
- Stage targets in working hours (contact 4, review 4, assignment 4, delegation 4, first contact 24, closure 24), shown as "late" and never acted on; one open request per customer across the whole chain; the old rows still open when the update lands continue through the chain (a "submit for approval" button replaces "record the result") and finished ones stay as they are.
- The representative sees where each request stands in two places: the tracking board «متابعة ما سجّلته» (a "support" or "missed visit" card with the stage bar, the holder and the hours, and the last three steps with the representative's own result, the return reason or assignment note, and the assignee's result with its channel) and the request sheet (stage bar, facts, the full story and the actions of the stage). The sales member's chip beside a visit follows the stage. The badge counts what waits for the reader in any role.
- The evaluation keeps measuring the time to the representative's first submission (resubmitting after an amendment does not change it); the figures feed no target.
- Changed: `lib/support.ts`, `lib/support-rows.ts`, `app/api/support/route.ts`, `lib/service-tracking.ts`, `app/support-panel.tsx` and `.css`, `app/service-tracking.tsx` and `.css`, `app/crm-app.tsx`. Tests: `tests/support.mjs`, `tests/support-http.mjs`, `tests/service-tracking.mjs`, `tests/service-tracking-ui.mjs`, `tests/support-ui.mjs`, `tests/support-browser.mjs`, `tests/service-kpi.mjs`.
- No migration. A package of its own (`Yourrest-CRM-Update-Support-Chain-20261018.zip`, release name `update-support-chain`) that carries everything of the customer-message package. Going back to an earlier release leaves the new fields in the support rows unshown and the earlier release showing a request that moved along the course as "waiting" or "in hand" with none of its stage buttons (and not preventing a new request for the same customer); they return whole on coming back.

## The customer message in the owner's final wording (2026-10-18, schema 16, no migration)

- The message a complaint's customer is sent now closes with «نشكر لكم ثقتكم.» (English: "We thank you for your trust.") instead of «نقدر ثقتكم بنا.», and its first sentence keeps the owner's separator («ترحب بكم : تم تسجيل»). Only `lib/whatsapp.ts` and its tests change.
- A package of its own (`Yourrest-CRM-Update-Customer-Message-20261018.zip`, release name `update-customer-message`) that carries everything of the 2026-10-17 package, so it can be deployed whether or not that one was.

## Visits only at the customer's place, dictation on every form, and customer-service updates (2026-10-17, second release of the day, schema 16, no migration)

- A representative's physical visit (and a follow-up that is a visit) is saved only when the phone is within 300 m of the customer's point, widened by the phone's own accuracy up to 100 m more; a fix worse than 300 m accuracy is neither accepted nor refused as far; arrival the route tracking confirmed settles it; a customer with no point takes the first visit's point (noted on their sheet); supervisors, managers and administrators are not stopped, their visit is marked "outside the customer's place"; each refused attempt is kept in the customer's history once per ten minutes. Calls, e-mails and messages have no place. The refusal reads the distance and the allowance and disables the save button. Pure rule `lib/visit-place.ts`, server `lib/visit-place-server.ts`, in `/api/visits`, `/api/customer-followups` and the older `/api/crm` entry.
- A dictation button on every free-text field of every form (`VoiceField` and `DictationButton` in `app/voice-field.tsx`): the heard text is appended and reviewed before saving, in the language of the interface, one session at a time; the native speech service inside the Android app (APK 1.0.8 and later, so no new APK) and `SpeechRecognition` in a browser that has it. Codes, amounts, coordinates, search boxes, sign-in and the competitor name stay typed; `tests/dictation-coverage.mjs` fails on any free-text field that has neither a microphone nor a reason on its list.
- Complaints: the customer's WhatsApp number and e-mail (taken from the customer, checked when typed), a sequential complaint number issued inside the INSERT (with a unique audit guard), and a step after registration that opens a ready WhatsApp message to the customer from the employee's own phone (`wa.me`), in Arabic and then in English in the one message, in the owner's wording (`complaintMessageParts` and `complaintMessage`), stamped once in the complaint's story ("WhatsApp message opened for the customer"); the system sends nothing by itself and cannot know it was sent. Pure `lib/whatsapp.ts`.
- For customer-service roles the record handed to sales is an "opportunity" and what is done inside it a "contact" (`lib/service-wording.ts`): navigation, page, table, cards, forms, the customer sheet, the export. Sales roles and administrators keep "visit".
- A tracking board at the top of the Opportunities page for customer-service members (a representative follows what they registered, a manager what the team registered): every opportunity handed to sales and every complaint registered, with a stage bar, who holds it, for how many working hours, whether that is late against the stage's target, and the last thing recorded; filters all, late, with customer service, with sales, finished within 30 days. The same stage bar is inside the complaint sheet and the request sheet. Pure `lib/service-tracking.ts`; `GET /api/customer-service` carries each case's `progress` and a `?scope=board` view. The figures are for follow-up and feed no target or evaluation.
- New files: `lib/visit-place.ts`, `lib/visit-place-server.ts`, `app/visit-place-status.tsx`, `app/followup-place.tsx`, `app/voice-field.tsx` (extended), `lib/whatsapp.ts`, `lib/service-wording.ts`, `lib/service-tracking.ts`, `app/service-tracking.tsx` and `.css`, `scripts/lib/voice-field-stub.mjs`. Tests: `tests/visit-place.mjs`, `tests/visit-place-http.mjs`, `tests/visit-place-browser.mjs`, `tests/followup-place-ui.mjs`, `tests/dictation-coverage.mjs`, `tests/dictation-browser.mjs`, `tests/native-speech.mjs` (extended), `tests/whatsapp.mjs`, `tests/service-wording.mjs`, `tests/service-tracking.mjs`, `tests/service-tracking-ui.mjs`, and the complaint, queue, KPI and support tests extended.
- No migration. Going back to an earlier release leaves the complaint numbers, the "customer told" stamps, the WhatsApp numbers and e-mails and the location notes in the database unshown.

## Customer-service evaluation and the customer's rating at closure (2026-10-17, schema 16, no migration)

- A monthly score out of 100 for every customer-service representative and every customer-service manager, computed on read from the system's own events (complaint events, assistance requests, service requests) plus a manager's quality audits and the customer's rating. A representative is measured on what they own only: sending a complaint back to sales is never charged to them, reopening after their confirmation is. Eight figures each (support response, closure confirmed in time, closures that held, audit quality, missed visits in time, registration accuracy, clearance, customer rating; team average, review in time, whole-complaint time, customer satisfaction, support response, team quality, backlog control, repeat complaints), each with its target, weight and least number of cases; a figure with too few cases is left out and its weight shared. Every number is attributed by the time of its own event, so a finished month gives the same answer however late it is asked.
- The page «تقييم خدمة العملاء» for the customer-service manager and the administrator (cards, the cases behind each figure, the suggested audit sample, closing and reopening a month, the settings), and a folded «تقييمي» section on the Complaints page for a representative. Each card shows its last three months once an earlier one has a score, and each team its median (a representative sees only their own trend); a manager whose only figure is an empty backlog has no score rather than a full one. `workingHoursBetween` now reads the weekday by arithmetic instead of building a Date per day (the result is unchanged, checked against the calendar-asking version over about 22 thousand spans in the new `tests/working-hours.mjs`): a month of the evaluation on two years of synthetic history went from about 295 to about 206 ms. Closing a month keeps a certificate (team, settings, scores) and flags drift; the settings (targets, weights, hours, audit criteria, sample size, waiting days) are the administrator's, starting from the values of the owner's evaluation sheet.
- Quality audits (seven criteria out of 100, an optional reference to the representative's own work, a verification call to the customer) are rows of a new kind, deleted by marking; the customer's rating (1 to 5, optional, only when the customer was satisfied or not) is entered with a complaint's closure and kept in the closure and its event. The new kinds never reach the administrator's record list or the displayed history.
- New files: `lib/service-kpi.ts`, `lib/service-kpi-rows.ts`, `lib/support-rows.ts`, `app/api/service-kpi/route.ts`, `app/service-kpi.tsx` and `.css`; the support route's row readers moved to the shared module. Tests: `tests/service-kpi.mjs`, `tests/service-kpi-ui.mjs`, `tests/service-kpi-http.mjs`, `tests/service-kpi-browser.mjs`; `tests/server-authorization.mjs` and `tests/mobile-navigation-ui.mjs` extended.
- No migration. Going back to an earlier release leaves the audits, certificates, settings and ratings in the database unshown.

## Mandatory app version and several regions for a member (2026-10-14, fifth release of the day, schema 16, no migration)

- The version the site serves (`lib/app-update-release.json`, 1.0.10 today) is mandatory inside the Android app: an installed app that reports an older version is blocked for every role before any tracking check, with a screen that names the installed and the required versions and offers the in-app update flow (apps with the update protocol) or the served file (older apps); an unknown version is still judged by its capabilities only, and a deactivated account still sees the account error. The gate's APK path is read from the release file instead of a constant. The team page marks a phone whose last report predates the served version as outdated. No APK change; publishing a new APK makes it required at once.
- A member may be given several regions: the team form ticks regions (or all of them), the table lists them, and the scope is stored as one canonical text in the same column (`central,eastern`), so existing members and the commit guards are untouched. A member of several regions reaches the customers of each, is offered for cases, assistance and complaints in any of them, sees the members whose regions overlap, and chooses a new customer's region among their own; ERP sales, KPI history and KPI evidence admit rows whose region overlaps the reader's instead of matching it exactly. Going back to an earlier release leaves such a member without visible customers until their scope is set to one region or all again.
- The activator also accepts the complaints-report release's same-day backup.
- Tests: `tests/regions.mjs`, `tests/member-regions-browser.mjs` (new); `tests/tracking-gate.mjs`, `tests/tracking-gate-ui.mjs`, `tests/tracking-coverage.mjs`, `tests/tracking-gate-browser.mjs`, `tests/crm-regression.mjs`, `tests/baseline-update-activation.mjs` extended.

## Monthly complaints report (2026-10-14, fourth release of the day, schema 16, no migration)

- A collapsed "Monthly complaints report" at the top of the Complaints page for customer-service managers and administrators, and of the Visits page for sales managers; fetched when opened, with a month to choose (by registration date, Riyadh time). Each reader gets the figures of the complaints they may already read; representatives, supervisors and customer-service representatives do not get it.
- Headline: registered in the month, open now, closed, cancelled, customer satisfaction (closed as "customer satisfied" over all closed), open past their stage target now, high severity, customers with more than one complaint. Tables by category, channel and region with open, closed, satisfied and the satisfied share; severity and current state; what went a step back (returned for correction, sent back to the representative, reassigned, reopened); resolution and closure outcomes; time per stage in working hours (review from the last submission, assignment, first contact after the dispatch, resolution from the last dispatch, closure confirmation, registration to closure) with median, average, target and how many went over.
- Aggregate only: no customer, text or name leaves `GET /api/complaint-report` (403 for other roles, 400 for a bad month, never cached). The figures feed no target, evaluation or movement calculation.
- The complaints route and the report share one row reader (`lib/complaint-rows.ts`); the two monthly reports share the timing arithmetic (`lib/report-timing.ts`). The activator also accepts the complaints release's same-day backup; the rehearsal reads the report after the complaint it runs and checks the route is gone after a rollback.
- Tests: `tests/complaint-report.mjs`, `tests/complaint-report-ui.mjs`, `tests/complaint-report-http.mjs` (new); `tests/complaints-browser.mjs`, `tests/server-authorization.mjs`, `tests/baseline-update-activation.mjs` extended.

## Customer complaints, from customer service to the representative until closure (2026-10-14, third release of the day, schema 16, no migration)

- Customer service (a representative, the manager or an administrator) registers a customer's complaint for a customer of its branch and region: the channel it came by, a category, a severity, the description, what the customer asks for, a reference, and the contact person and phone taken from the customer. A second open complaint for the same customer is allowed, with a warning.
- The registrar's customer-service manager reviews it: forwards it to the sales manager linked to him, returns it for correction with a note, or cancels it. A complaint registered by someone with no manager waits for any manager of the branch or an administrator.
- The sales manager assigns it to a representative or supervisor of the customer's branch who covers its region, the customer's own representative suggested first, with a note; a supervisor delegates to one of his representatives; the sales manager may reassign. The holder opens it (recorded), records each contact with the customer inside the complaint (never a visit), then the resolution with an outcome. Customer service confirms with the customer and closes it with a closure outcome, or sends it back to the representative with a reason; a closed complaint may be reopened for fourteen days.
- Targets in working hours, for display only: review 4, assignment 4, delegation 4, first contact 24, resolution 50 from the assignment, closure confirmation 24; late complaints are marked. Each reader is asked only for what is theirs, and counted: on the Complaints page entry for customer service and administrators, on the Visits entry for sales members.
- Customer service and administrators get a "Complaints" page (desktop and phone); sales members meet complaints in a panel on the Visits page; a customer's sheet gains a Complaints tab. The sheet shows the report, where it stands, the whole story (steps, contacts, notes) and only the actions the reader may take, with dial and WhatsApp links.
- Storage without a migration: a complaint is a `crm_records` row of kind `complaint` with no parent and everything in `data`; no visit, case, assistance, deletion or KPI rule sees it, the previous release ignores it, and the administrator's record list and history leave it out. New route `/api/complaints` (GET and POST with receipts and audit `complaint:<action>`), cut at 300 entries with true counts.
- The activator also accepts the location release's same-day backup; the rehearsal runs a complaint's whole course on the upgraded database and checks the rollback.
- Not in this release: a monthly complaints report, attachments, phone notifications (an APK change), offline registration.
- Tests: `tests/complaints.mjs`, `tests/complaints-ui.mjs`, `tests/complaints-http.mjs`, `tests/complaints-browser.mjs` (new); `tests/role-ui.mjs`, `tests/mobile-navigation-ui.mjs`, `tests/server-authorization.mjs`, `tests/baseline-update-activation.mjs` and the shell tests' mocks updated.

## Another location for a new customer (2026-10-14, second release of the day, schema 16, no migration)

- A new customer still starts on the phone's own position. "Another location" lets the member type coordinates (the Arabic comma is read) or paste a full maps link, or tap the place on a map and drag the pin; nothing changes until "Confirm location". It is in the customer form and in the visit form's inline "Add customer"; an existing customer keeps its editable field and gains the map button.
- A phone that never answers no longer holds saving: choosing "Another location" ends the wait, and the message about the phone points to it.
- A hand-placed point is stored as numbers the server works out from the text, with no source, time or accuracy. A device claim that no longer matches the text is refused, never relabelled. The server is unchanged.
- A pasted maps link is replaced by the plain coordinates it points to when the field is left, and at submit for a new customer (Enter never leaves the field): links outgrow the 250-character field. A pair typed by hand, text that is not coordinates and an existing customer's untouched text stay as they are.
- The national address of a typed place is looked up when the field is left and does not hold saving, so the tap on Save that ends the typing is not lost; a place chosen on the map holds saving until its address arrives, like a captured one. Only empty fields are filled, addresses filled for a previous place are cleared, a late answer never replaces later typing, and offline the lookup is skipped.
- Text that is not coordinates (a place name, a short maps link) is explained at once and refused before anything is saved or queued, offline too (`customerLocationProblem`: the server's rules on a copy, without judging the phone's clock, since positioning time may differ from it).
- The map is Leaflet with OpenStreetMap tiles (as the customer map): it needs the network for streets only; without it the dialog says so and the pin and the typed coordinates still work.
- The activator now knows the previous release's activation name, so a second release of the same Saudi day, packaged under its own name and stage folder, reuses that day's full backup; the activation test proves it, and the refusal without the entry.
- Tests: `tests/customer-entry-fields-ui.mjs` (extended), `tests/customer-location-rules.mjs` and `tests/location-picker-browser.mjs` (new; the latter in the browser gate), `tests/rep-customer-create.mjs` and `tests/baseline-update-activation.mjs` extended.

## Customer-service assistance, missed visits and the manager's late mark (2026-10-14, schema 16, no migration)

- A representative (or supervisor, sales manager, administrator) asks customer service to contact a customer from a button beside the customer's latest visit (Visits, Follow-ups, the customer's visit history). The request carries a reason and a preferred channel, never counts as a visit and never changes the follow-up plan. One open request per customer.
- Routing: the customer-service representative assigned to exactly the customer's region in the customer's branch gets it at once; otherwise it waits for the representatives who cover the region (including the one assigned to every region); with nobody covering it the manager is told. The customer-service manager sees the whole branch and assigns; the administrator sees all.
- Missed visits are derived on read: the customer's latest contact is a visit or call with a negative result, two days have passed after its follow-up date, nothing was recorded since by anyone, and the customer is not won or lost. They are routed for thirty days. Customer service sees only the plan (action, date, result) and the representative, never the visit text. One member takes one; two at once and exactly one wins.
- Customer service records an outcome (reached and interested, reached and not interested, wants a visit on a date, no answer, wrong number, other) with what happened; the representative and those above read it, with a count on Visits until opened. Four working hours to answer a waiting request; late is shown to the holder and the manager and never acts by itself.
- Customer-service manager: the approvals that wait for him are listed under "Waiting for my approval", counted on Visits and marked late after four working hours (the queue no longer returns an empty list for him; a customer-service representative still gets none).
- Storage without a migration: a request is a `crm_records` row of kind `support` with no parent and everything in `data`; no visit, case, deletion or KPI rule sees it, the previous release ignores it, and the administrator's record list leaves it out. New route `/api/support` (`lib/support.ts`, `app/api/support/route.ts`, `app/support-panel.tsx`). The packager is used with `--schema-baseline 16 --verify-route /api/support=401`; the activator also knows the 2026-10-13 activation's backup folders.
- Lists are cut for display at 300 entries (most overdue first) but never silently: `GET /api/support` works out the whole list, returns the true totals in `counts`, the panel writes how many of how many are shown, its heading and the Visits badge count all of them, and taking a missed visit searches the whole list (`SUPPORT_LIST_LIMIT`).
- Tests: `tests/support.mjs`, `tests/support-ui.mjs`, `tests/support-http.mjs`, `tests/support-browser.mjs`; `tests/service-queue*.mjs`, `tests/service-alerts.mjs` and `tests/server-authorization.mjs` extended; `tests/baseline-update-activation.mjs` covers the same-day backup reuse for the next release. Arabic description: `docs/CUSTOMER-SERVICE-WORKFLOW-AR.md` section 9; operating guide: `docs/UPDATE-2026-10-14-AR.txt`.

## Customer-service requests reach sales and are followed to the first contact (2026-10-13, schema 16, no migration)

- Sales roles receive a `serviceQueue` list in `/api/crm`: each customer-service request they may already read, its stage (approval, assignment, delegation, first contact, follow-up), who it waits for, and whether it is late against its target in working hours (Saturday to Thursday, 08:00-18:00 Riyadh): 4 h to approve, assign or delegate, 24 h to the first contact. A request late with one person is flagged for those above. It is built from the existing read and permission functions and never carries the registration text, attachments or notes.
- The Visits page shows the queue to managers, supervisors and representatives, the Visits entry carries a count of what waits for the reader, and a representative sees a banner on every page while an assigned request waits for the first contact; it leaves with that contact. A signed-in idle user is refreshed every ten minutes, never under an open editor or sheet.
- Case actions: `reassign` (the routed sales manager and administrators; the current holder is not a valid target; the customer moves to the new holder, who starts afresh), `seen` (the holder's first opening, recorded once), and an optional note written with every assignment or delegation that the holder reads on arrival. The customer's current representative is suggested when assigning. A returned request restarts the approval clock when resubmitted.
- A request's history is visible along its own chain (registrar, customer-service manager, sales manager, supervisor, holder); a previous holder's contacts and notes stay out of the new holder's view.
- Monthly customer-service report (administrator, sales manager, customer-service manager): requests by channel and current state, time per stage in working hours against the targets (median, average, over target), win rate and loss reasons. Aggregate only and never part of a target, evaluation or movement calculation.
- The team page warns when a customer-service member is not linked to a customer-service manager, or a customer-service manager not to a sales manager, since such a request cannot be approved or routed.
- Phone notifications (Android app 1.0.11, versionCode 12, source in `mobile/android`): the tracking service asks the new `GET /api/service-queue/alerts` every ten minutes in working hours (and the app when opened) and announces each request that waits for the representative once, with a generic lock-screen title; tapping it opens the request (`yourrest:open-service-case` or `#service-case=ID`, never over unsaved work). The endpoint returns only the requests waiting for the caller personally, the customer name and a one-line need. The APK must be built and signed with the company key by its owner and published with `scripts/publish-android-release.mjs`; this release still serves 1.0.10. See `docs/UPDATE-ANDROID-1.0.11-AR.txt`.
- Update tooling: the packager takes `--schema-baseline N` (default 15) so a release built on top of an already migrated database (here 16) is packaged and activated without a new migration; the activator accepts a same-day full backup taken by the previous activator at any earlier schema from 14 up and knows the 2026-10-12 activation's backup folders. Tests: `tests/baseline-update-activation.mjs`, `tests/update-package-parameters.mjs` (extended).
- No migration: the new facts live in the request's `data`. Going back to the previous release needs no database restore.
- Tests: `tests/service-queue.mjs`, `tests/service-queue-ui.mjs`, `tests/service-report.mjs`, `tests/role-scope.mjs` (extended), `tests/service-queue-http.mjs`, `tests/service-report-http.mjs`, `tests/service-queue-browser.mjs`, `tests/service-alerts.mjs`, and the Android JVM check `ServiceAlertCheck`. `tests/app-update-release.mjs` no longer pins the published version. Arabic description of the whole customer-service role: `docs/CUSTOMER-SERVICE-WORKFLOW-AR.md`.

## Mandatory route tracking for representatives (2026-10-12, schema 16)

- A representative uses the system only from the Android app with consent, precise location, notifications, all-the-time location and the phone location service on, and the phone enrolled for the account. Browsers, iPhone, old apps and a silent app bridge get a full-page block that names what is missing and the action that fixes it; other roles are unchanged and daytime trouble (GPS wait, no network, queued points) never blocks work. `lib/tracking-gate.ts`, `app/tracking-gate.tsx`.
- The phone reports its own tracking state (`POST /api/device-status`, table `crm_member_devices`, migration `0015_member_devices`). Supervisors, managers and administrators read it for the representatives they already see in the daily report; it is diagnostic only and never counts as movement, a visit, a target or an evaluation figure.
- The daily route report says why a day has no GPS (never activated / no points that day / a tracking day opened without points) together with the phone's last report, and the team page has a Tracking column. Fridays and the hours before 06:00 are not failures.
- Update activator and packager can ship a declared database migration (`--new-migration`, `--verify-route`); the application applies it on first start after its own private schema backup, and `--verify` states plainly when the application has not started yet.
- Fixed: in the Android app a stray "update the app" notice flashed at every launch (and raised a React hydration error) before the app had reported its capabilities.
- Tests: `tests/tracking-gate*.mjs`, `tests/device-status*.mjs`, `tests/tracking-coverage.mjs`, `tests/schema-update-activation.mjs`, `tests/tracking-gate-browser.mjs`; browser tests that sign in as a representative now run inside the emulated Android app (`scripts/lib/native-bridge.mjs`). Arabic operating guide: `docs/UPDATE-2026-10-12-AR.txt`; plan: `docs/qa/PLAN-TRACKING-ENFORCEMENT-AR.md`.

## Current update at the time: offline recording

New customers, visits, service registrations, confirmed-source follow-ups and competitor attachments can be saved locally and synchronized when connectivity returns while the application is active. Open online once after deployment to prepare the public shell and authorized snapshot. See docs/UPDATE-OFFLINE-AR.txt and docs/OFFLINE-VERIFICATION.json. No new migration or native APK.

## Yourrest CRM — Namecheap

Independent email OTP edition. See ../START-HERE.html for deployment.

Node >=22.16; install locked dependencies with pnpm, then pnpm build.
The runnable build is dist/standalone. Keep settings and production data outside the release.
No production credentials or runtime database are bundled.

Migrations are append-only SQL files applied by portable/initialize.mjs. Startup applies pending migrations only to a recognized existing database after a private schema backup through portable/upgrade.mjs. Do not edit applied files. Migration0009 contains a manually managed authorization trigger. Migration0010 contains manually managed journey tables and indexes. Migration0011 adds continuous mobile workday tables. Preserve these when maintaining the schema. The installation ledger is authoritative, not the original Drizzle generation journal.

Regression tests: node tests/crm-regression.mjs; node tests/email-auth.mjs; node tests/email-auth-ui.mjs; node tests/portable-storage.mjs; node tests/portable-local-mail.mjs; node tests/portable-hosting.mjs; node tests/portable-installer.mjs; node tests/namecheap-http.mjs (after build).
The package-install test accepts the absolute ZIP path and requires unzip; it changes only a temporary copy.

Activity map checks: node tests/customer-map-activity.mjs; node tests/customer-map-ui.mjs; node tests/map-workspace-ui.mjs.
Mobile navigation checks: node tests/mobile-navigation-ui.mjs; node tests/pwa-install-ui.mjs.
Rep customer creation checks: node tests/rep-customer-create.mjs; node tests/rep-customer-ui.mjs.
Own targets checks: node tests/own-targets.mjs; node tests/my-targets-ui.mjs.
Journey checks: node tests/journeys.mjs; node tests/journey-ui.mjs; node tests/startup-upgrade.mjs. The PWA reports GPS gaps explicitly and does not guarantee background location on locked devices.
Mobile app checks: node tests/pwa-foundation.mjs; node tests/pwa-install-ui.mjs.
The optional tests/pwa-browser.mjs needs Playwright with a Chromium binary and openssl; browser/device installation was not verified in the release environment.

Native Android source: mobile/android; reproducible signed APK builder: mobile/android/tools/README.md. The signing key is delivered separately and must never be deployed. Native checks: node tests/mobile-route.mjs; node tests/native-tracking-ui.mjs. Migration0011 is append-only. Actual GPS on a physical phone still requires acceptance testing.

Earlier Mobile UX release: checks include node tests/customer-directory-mobile.mjs; node tests/visit-mobile-ux.mjs; node tests/rep-mobile-shell.mjs; node tests/rep-customer-ui.mjs. The mobile UI loads from the server inside the existing Android APK; this UI release does not require reinstalling it. The cumulative update includes migration0011 for installations that have not received it; no migration was added for this UI release. See docs/UPDATE-MOBILE-UX-AR.txt.

Earlier map search update: see docs/UPDATE-MAP-SEARCH-AR.txt. Search the authorized customer list, select a result, then use Directions to start acknowledged journey tracking before opening Maps. Selection itself opens no visit form. Android 1.0.1 (versionCode 2) adds native directions handoff after asynchronous tracking startup. Update the server, then install the same-signed new APK over the existing app without uninstalling; old APKs retain an extra Open directions link tap. No new database migration was added. Checks: node tests/customer-map-search.mjs; node tests/customer-map-ui.mjs; node tests/map-directions-ui.mjs; node tests/map-workspace-ui.mjs. Physical-phone appearance and GPS handoff still require acceptance testing.

Earlier representative controls update: see docs/UPDATE-REP-CONTROLS-AR.txt. Representative accounts have no general page search or export controls and cannot manually edit or delete existing records. New customer, visit and follow-up creation remain available within the existing scope, with safe repeated saves and append-only follow-ups preserved. Map autocomplete and customer-picker search remain available. Supervisor and manager capabilities are unchanged. This cumulative server release includes the earlier map changes, migration0011 and the unchanged Android 1.0.1 APK (versionCode 2); no new migration or APK was introduced. Existing 1.0.1 installations need no reinstall.

Earlier customer search update: see docs/UPDATE-CUSTOMER-SEARCH-AR.txt. The Clients page offers search for all authorized users, including representatives, by customer name, code, phones, contact names, city, region and address. It reuses the existing normalized map search and searches only supplied authorized customers. Representatives still have no export controls, manual editing/deletion of existing records, or general search on other pages. Map autocomplete, customer-picker search and allowed creation remain available. This is a cumulative server UI update with the unchanged Android 1.0.1 APK (versionCode 2); it adds no database migration, native or backend change. Existing 1.0.1 installations need no reinstall.

Earlier continuous tracking update: see docs/UPDATE-CONTINUOUS-TRACKING-AR.txt. Android 1.0.2/code3 offers explicit 24-hour enrollment, background permission setup, continuous day rollover and permitted boot recovery. Rep manual day-stop is removed and denied server-side. Generic GPS dwell stops remain distinct from customer visits. Reinstall the same-signed APK over the current app and complete disclosure/permissions once. OS force-stop, permission removal and logout remain respected. Actual-phone 24-hour validation remains required.

Earlier Targets & performance update: see docs/UPDATE-TARGETS-PERFORMANCE-AR.txt. A single authorized management page combines targets and KPIs with shared month, member, branch and search filters. Representative My targets remains separate and read-only. Future-month targets remain supported, while future performance is not evaluated. The top summary compares the selected product target, actual quantity, attainment and remaining quantity per member; server weighted attainment, KPI completeness and detail navigation remain scoped. Unknown inputs stay unavailable and future months show targets only. This cumulative server update includes the unchanged Android1.0.2/code3 APK and no new migration.

Earlier production hardening: see docs/UPDATE-PRODUCTION-AR.txt and docs/PRODUCTION-BACKUP-AR.md. GPS reads only authenticated customer roots; visit writes load the selected customer graph, read-only CRM directories hydrate authorized records from compact metadata, regional contexts avoid unrelated history, and identity-only operations skip history. Body streams are bounded before JSON/multipart parsing. Administrative member changes use an optimistic token and commit-time relationship guards. Verified online database/attachment snapshots, safe retention and restore-to-new-directory tools are included. Daily scheduling still requires the documented cPanel cron setup. The load harness uses isolated synthetic data and does not establish Namecheap capacity. No new migration or Android APK is required.

Earlier tracking hours: see docs/UPDATE-TRACKING-HOURS-AR.txt. Route observation is limited to06:00 inclusive through18:00 exclusive Asia/Riyadh. Server acceptance uses capture timestamps and permits later uploads of in-window offline observations. Android1.0.3/code4 releases location subscriptions outside the window and retains scheduled enrollment. Install the same-signed updated APK over the existing app. Historical data and business entry remain available; cutoff does not invent customer departure or visit duration. Physical-phone boundary and background acceptance remains required.

Earlier trip-start fix: see docs/UPDATE-TRIP-START-AR.txt. Healthy tracking is reused; no duplicate postselection outbox drain. Background sync passes are bounded; paused native requests return an error. The Directions button waits at most30seconds and propagates cancellation before subsequent mutations and navigation. Pending points remain ack-only deleted and stay ordered before customer changes. Update both server and same-key Android1.0.4/code5 without uninstalling. Tracking remains06:00–18:00 Asia/Riyadh. No new migration. Controlled JS/native tests are not physical-device validation.

Earlier Google Maps fix: see docs/UPDATE-GOOGLE-MAPS-AR.txt. Android1.0.5/code6 explicitly launches com.google.android.apps.maps with google.navigation after binding and exact-destination checks, then fixedHTTPS fallback on unavailable or denied launch. Narrow trusted main-frame Maps links also tolerate lost WebView gesture metadata. Other links retain gesture guards. Selection failures expose redacted actionable feedback; a post-preflight launch failure alone may expose a fixed retry destination. Phone version is reported without credentials. Upgrade server and install the same-key APK over the existing phone app without uninstalling. Tracking remains06:00–18:00 Riyadh; no migration. Physical-phone Maps launch remains unverified.

Earlier follow-ups: standalone creation controls removed. Execute only open scheduled prior customer contacts; fixed customer, saved previous-source link, stale-source and absent-plan rejection. No new migration or Android build. See docs/UPDATE-FOLLOWUPS-AR.txt.

Earlier rebuild: Android1.0.6/code7 + complete server. See docs/UPDATE-REBUILD-AR.txt and docs/REBUILD-VERIFICATION.json. Foreground visit GPS is independent of background enrollment; Directions opens immediately while recording is acknowledged separately. Request/location waits are bounded, cold-account loading preserves native enrollment, old evidence keeps immutable captured bindings, and new visits do not infer a stale stop. Same-owner scope changes with pending old-scope evidence halt and preserve the queue. Update server and install the same-signed APK over the existing app. No new server migration. Run node scripts/test-rebuild.mjs for broad local regressions; native, built HTTP, browser, load and package reports retain their exact environment limits.

Current ERP sales update (2026-10-03): see docs/UPDATE-ERP-SALES-AR.txt and docs/ERP-SALES-VERIFICATION.json. Migration0012 adds ERP documents, durable employee and category mapping, import receipts, and revision guards. The release migration manifest selects canonical SQL and rejects hash mismatches; foreign unapplied SQL is ignored. Startup backs up the recognized database before pending migrations.

ERP reports: XLSX up to5MiB and5000 lines; employee names مبيعات مكتب / مبيعات المكتب are always excluded before invoice grouping. Other employees require saved authorized representative mappings; blank employees are unresolved. Categories map to target products once; supervisors cannot change existing global category defaults. Invoice dates determine months; signed returns reduce net sales/quantities in their own month. HMAC-bound preview, explicit skip acknowledgement, idempotent receipts, canonical line-order-independent dedupe, changed-document conflicts, manual/ERP collision guards and transaction-time access checks protect imports. Imported invoices are read-only. Growth/variety and quantity attainment use scoped imported facts; own-target API exposes only caller quantities. Other KPI inputs remain separate.

ERP checks: node tests/erp-sales-parser.mjs (set ERP_TEST_WORKBOOK to an exported fixture path if the original report is unavailable); node tests/erp-sales-server.mjs; node tests/erp-kpi-integration.mjs; node tests/erp-migration-manifest.mjs; node tests/own-targets.mjs; node tests/my-targets-ui.mjs. Browser integration: tests/erp-sales-browser.mjs after build with Playwright/Chromium; all DB writes use isolated synthetic accounts. Cumulative release packaging: python3 scripts/package-erp-sales-update.py then python3 tests/erp-sales-update-package.py. Android1.0.6/code7 is unchanged.

Persistent targets (2026-10-03): quantity targets now follow the latest saved set at or before the selected report month, as activity targets and weights already did. Editing a later month creates an effective-dated override and leaves earlier months untouched; future explicit overrides retain precedence. Zero/null remain explicit. Team rollups use effective representative targets and achieved sales remain monthly. Sales target creation now validates inherited source versions and rejects concurrent intermediate changes. No new database migration. Tests: node tests/target-carry-forward.mjs; own-targets.mjs; UI tests; erp-sales-browser.mjs now enters the target once and verifies both months.

## Competitors workspace

The management-only Competitors page groups existing authorized visit observations by normalized competitor name. It exposes only the received CRM record scope, retains original visit names and notes, opens existing protected attachment routes, and creates new observations through the normal visit form with an editable name prefill. No new table, API, or migration. Rep and customer-service navigation stays unchanged. Tests: `node tests/competitors.mjs`, `node tests/competitors-ui.mjs`, `node tests/competitors-browser.mjs` (built app and isolated browser/database), plus existing visit/mobile-navigation checks.

Competitors workspace: management-only, sourced from authorized visit records, with normalized-name grouping, search, customer/contact history and protected quote attachments. New observations use the existing visit form; no new table or migration. See docs/COMPETITORS-BROWSER-VERIFICATION.json and tests/competitors.mjs, tests/competitors-ui.mjs, tests/competitors-browser.mjs.

Competitor intelligence update: reusable authorized name picker, optional editable speech-to-text notes and private quote files in visits/new follow-up observations; management profile tabs with distinct customers, quotes and source history, region/date scope, and explicitly observed-customer coverage. Android1.0.8/code9 adds native dictation without location enrollment. Update the same-signed APK for this capability. No additional database migration. See docs/COMPETITOR-INTELLIGENCE-VERIFICATION.json and docs/UPDATE-COMPETITOR-INTELLIGENCE-AR.txt.

Offline route recovery: Android 1.0.9/code10 plus the matching server update supports previously authorized offline restarts within a seven-day account/scope-bound lease. Pending samples have no automatic age expiry; only acknowledged IDs are removed. The 100,000-point capacity refuses new samples rather than deleting pending evidence. Logout stops collection and retains pending evidence for the same account to authenticate and upload. See docs/UPDATE-OFFLINE-ROUTES-AR.txt. Physical-device acceptance remains required.

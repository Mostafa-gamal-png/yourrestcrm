// The filters of «طلبات القوالب» (the owner, 2026-11-17: «ضيف الفلاتر دى فى طلبات القوالب ماعدا المصدر لان المصدر عندك واحد») without a
// build: lib/mold-filters.ts transpiled with what it imports.
// - The card's own words now come from there (its chip, its small line while the request waits in the CRM): each case reads as before.
// - «الحالة»: the choices a request answers to (not in production yet, each reason it waits in the CRM, refused, the link off, returned by
//   finance, each of production's statuses, cancelled in production, cancelled, and «المفتوحة»), in the card's words, offered only when the
//   list holds them, in a fixed order.
// - «واقف عند»: production's step, the manufacturing stage reached (the first of the seven not done), «بانتظار اعتمادك»; nothing for a
//   request cancelled, delivered or not yet held by production.
// - «المندوب»: offered only with more than one requester, by name; a requester no longer listed is let go.
// - The days: Riyadh's (a moment just after midnight in Riyadh belongs to the new day), both ends included, a range typed the wrong way
//   round turned round, Arabic and Persian digits, a day that cannot be read ignored.
// - «بحث»: every field (customer name and its letter forms, ERP code, Yourrest code, requester, description, mold number, serial, order
//   number), Arabic and Persian digits, words across fields, nothing typed.
// - Everything together, and with «أعادتها المالية»; how many filters are set («مسح الفلاتر»).
// Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {MOLD_STAGES} from '../portable/mold-rules.mjs';

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-filters-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const source = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, quote, imported) => {
    if (!imported.startsWith('.') && !imported.startsWith('@/')) return match;
    let target = imported.startsWith('@/') ? imported.slice(2) : path.relative(root, path.resolve(path.dirname(source), imported));
    if (target.endsWith('.mjs')) return 'from ' + JSON.stringify(path.join(root, target));
    if (!/\.tsx?$/.test(target)) target += fs.existsSync(path.join(root, target + '.ts')) ? '.ts' : '.tsx';
    compile(target); return 'from ' + JSON.stringify(path.join(out, target.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
compile('lib/mold-filters.ts');
const lib = await import(path.join(out, 'lib/mold-filters.mjs'));
const mold = await import(path.join(out, 'lib/mold-requests.mjs'));
const ar = pair => pair[0], en = pair => pair[1];

// ---- what the module may import: the card's names, the customers' normalizer, the Riyadh day, the day reader (nothing of the server)
{
  const source = fs.readFileSync(path.join(root, 'lib/mold-filters.ts'), 'utf8');
  check([...source.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]), ['./mold-requests', './customer-map-search', './visits', './daily-target'], 'the filters import the card\'s words, the customers\' normalizer, the Riyadh day and the day reader only');
}

// ---- made-up requests
const stages = (done = 0) => Object.fromEntries(MOLD_STAGES.map((key, index) => [key, {done: index < done, at: index < done ? '2026-11-0' + (index + 1) : null}]));
const remote = (extra = {}) => ({crmRequestId: 'x', orderNo: null, status: 'received', editable: false, moldSerial: null, productionDate: null, stages: stages(0), stagesDone: 0, stagesTotal: 7, delivered: false, deliveryDate: null, updatedAt: null, revision: 1, waitingStep: 'sales', waitingSince: null, ...extra});
const sent = {state: 'sent', outbox: null, attempts: 0, nextAttemptAt: null, lastAttemptAt: null, error: null};
const can = {edit: false, cancel: false, resend: false, approve: false, withdraw: false, attach: false, deleteFile: false};
let serial = 0;
const view = (extra = {}) => ({id: 'mr-' + (++serial), memberId: 'rep1', memberName: 'أحمد العتيبي', customerId: 'c1', customerName: 'مصنع الشرق', customerAddress: '', customerCity: '', crmNumber: 27, customerErpCode: '', requestedAt: '2026-11-05T09:00:00.000Z', legacyOrderNo: null,
  specs: {description: 'قالب بلوك 20', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 1, designUrl: '', notes: ''}, payment: 'cash', paymentTerms: null, unconfirmed: false, cancelled: false, cancelReason: '', cancelReasons: [],
  sending: sent, remote: null, remoteAt: null, editable: false, can, version: 1, designFiles: [], quotePo: null, signature: null, designRequired: false, signing: {awaits: false, link: null, via: null, stamped: false, copies: 0, skipped: [], after: []}, returned: null, ...extra});
const unsent = (extra = {}) => ({...sent, state: 'waiting', outbox: 'send', ...extra});

// ---- the card's words (moved from the page, unchanged)
{
  const card = (extra) => lib.moldCardStatus(view(extra));
  check(card({can: {...can, approve: true}, remote: remote()}), ['بانتظار اعتمادك', 'Waiting for your approval'], 'the sales manager who may approve it: «بانتظار اعتمادك»');
  check(card({cancelled: true, remote: remote({waitingStep: 'admin'})}), ['ملغى', 'Cancelled'], 'cancelled in the CRM: «ملغى» whatever production says');
  check(card({remote: remote({status: 'cancelled', waitingStep: 'cancelled'})}), ['أُلغي في تطبيق الإنتاج', 'Cancelled in production'], 'cancelled in production');
  check(card({remote: remote({waitingStep: 'admin'})}), ['بانتظار اعتماد المالية', 'Waiting for finance approval'], 'where it waits');
  check(card({remote: remote({status: 'in_production', waitingStep: null})}), ['قيد التصنيع', 'In production'], 'no step: production\'s status');
  check(card({}), ['لم يصل للإنتاج بعد', 'Not in production yet'], 'not held by production');
  check(lib.moldSendingKey(sent, true), null, 'sent: no line');
  check(lib.moldSendingKey(unsent({held: 'design_file'}), true), 'design_file', 'kept for its design file');
  check(lib.moldSendingKey(unsent({held: 'design_file', state: 'off'}), false), 'design_file', 'kept for its file, link off or not');
  check(lib.moldSendingKey(unsent({held: 'something_new'}), true), 'waiting', 'a reason this page cannot name: the state');
  check([lib.moldSendingKey(unsent(), true), lib.moldSendingKey(unsent(), false), lib.moldSendingKey(unsent({state: 'rejected'}), true), lib.moldSendingKey(unsent({state: 'held'}), true)], ['waiting', 'off', 'rejected', 'held'], 'the states (every one «off» while the link is off)');
  for (const key of ['quote_file', 'design_file', 'customer_signature', 'free_customer']) check(lib.moldSendingLabel(key), mold.moldHeldTexts[key].name, 'the held line in the card\'s words: ' + key);
  for (const key of ['waiting', 'rejected', 'held', 'off']) check(lib.moldSendingLabel(key), mold.moldSendingNames[key], 'the state in the card\'s words: ' + key);
  const page = fs.readFileSync(path.join(root, 'app/mold-requests.tsx'), 'utf8');
  ok(page.includes('say(...moldCardStatus(view))') && page.includes('moldSendingLabel(moldSendingKey(sending,linkReady)'), 'the page draws the chip and the line from the same words');
  ok(!page.includes("'لم يصل للإنتاج بعد'") && !page.includes("'بانتظار اعتمادك'"), 'and no second copy of them');
}

// ---- «الحالة» and «واقف عند» of each request
const R = {
  design: view({customerName: 'مؤسسة الإبداع للبلوك', sending: unsent({held: 'design_file'}), requestedAt: '2026-10-31T21:30:00.000Z'}),
  waiting: view({sending: unsent()}),
  sales: view({memberId: 'rep2', memberName: 'خالد الشمري', remote: remote({orderNo: null, waitingStep: 'sales'}), can: {...can, approve: true}}),
  finance: view({memberId: 'rep2', memberName: 'خالد الشمري', remote: remote({waitingStep: 'admin', returned: {by: 'finance', reason: 'الحد الائتماني', at: null, correctedAt: null}}), returned: {by: 'finance', reason: 'الحد الائتماني', at: null, correctedAt: null}, requestedAt: '2026-11-10T08:00:00.000Z'}),
  making: view({customerName: 'مصنع الجنوب', customerErpCode: 'ERP-7781', crmNumber: 114, specs: {...view().specs, description: '200*400*27.5TH MM OPEN', moldNo: 'YR-14'}, remote: remote({status: 'in_production', waitingStep: 'manufacturing', orderNo: 117, moldSerial: '049 / 050', stages: stages(2), stagesDone: 2}), requestedAt: '2026-11-12T12:00:00.000Z'}),
  ready: view({memberId: 'cs1', memberName: 'سارة خدمة العملاء', remote: remote({status: 'produced', waitingStep: 'delivery', orderNo: 98, stages: stages(7), stagesDone: 7}), requestedAt: '2026-11-15T20:59:59.000Z'}),
  delivered: view({remote: remote({status: 'delivered', waitingStep: 'done', delivered: true, deliveryDate: '2026-11-14', orderNo: 90}), requestedAt: '2026-10-01T09:00:00.000Z'}),
  cancelled: view({cancelled: true, remote: remote({waitingStep: 'production'}), sending: unsent({outbox: 'cancel'})}),
  production_cancelled: view({remote: remote({status: 'cancelled', waitingStep: 'cancelled'})}),
};
{
  const statuses = Object.fromEntries(Object.entries(R).map(([name, item]) => [name, lib.moldStatusKeys(item, true)]));
  check(statuses, {
    design: ['open', 'local', 'sending:design_file'], waiting: ['open', 'local', 'sending:waiting'], sales: ['open', 'status:received'], finance: ['open', 'status:received', 'returned'],
    making: ['open', 'status:in_production'], ready: ['open', 'status:produced'], delivered: ['status:delivered'], cancelled: ['cancelled', 'sending:waiting'], production_cancelled: ['production_cancelled'],
  }, 'the choices of «الحالة» each request answers to');
  check(lib.moldStatusKeys(R.waiting, false), ['open', 'local', 'sending:off'], 'the link off: «الربط مع الإنتاج غير مفعَّل», as the card says');
  const steps = Object.fromEntries(Object.entries(R).map(([name, item]) => [name, lib.moldStepKeys(item)]));
  check(steps, {design: [], waiting: [], sales: ['approve', 'step:sales'], finance: ['step:admin'], making: ['step:manufacturing', 'stage:coreConnector'], ready: ['step:delivery'], delivered: [], cancelled: [], production_cancelled: []}, 'the choices of «واقف عند»');
  check(lib.moldStepKeys(view({remote: remote({status: 'in_production', waitingStep: 'manufacturing', stages: stages(7)})})), ['step:manufacturing'], 'every stage done: manufacturing without a stage');
  check(lib.moldStepKeys(view({remote: remote({status: 'in_production', waitingStep: 'manufacturing', stages: {...stages(0), box: {done: true, at: null}}})})), ['step:manufacturing', 'stage:laserCutting'], 'a later stage done first: the first not done, as the sheet marks it');
  check(lib.moldStepKeys(view({remote: remote({waitingStep: null})})), [], 'a status stored before the approval chain: no step');
  check(lib.moldStepKeys(view({remote: remote({waitingStep: 'nowhere'})})), [], 'a step this page does not know: none');
}

// ---- the words of each choice: the card's
{
  check(lib.MOLD_STATUS_FILTERS.map(key => ar(lib.moldStatusLabel(key))), ['المفتوحة (لم تُسلَّم)', 'لم يصل للإنتاج بعد', 'بانتظار ملف عرض السعر / الـ PO', 'بانتظار ملف التصميم', 'بانتظار توقيع العميل', 'بانتظار تحديث تطبيق الإنتاج (عميل بلا كود يورست)', 'بانتظار الإرسال', 'رفض الإنتاج البيانات', 'بانتظار تحديث تطبيق المنتجات', 'الربط مع الإنتاج غير مفعَّل', 'أعادتها المالية', 'استلمه الإنتاج', 'اكتملت الاعتمادات', 'قيد التصنيع', 'تم التصنيع', 'تم التسليم للعميل', 'أُلغي في تطبيق الإنتاج', 'ملغى'], 'every choice of «الحالة» in Arabic, in order');
  check(lib.MOLD_STATUS_FILTERS.map(key => en(lib.moldStatusLabel(key))), ['Open (not delivered)', 'Not in production yet', 'Waiting for the quotation / PO file', 'Waiting for the design file', 'Waiting for the customer\'s signature', 'Waiting for the production application update (a customer without a Yourrest code)', 'Waiting to be sent', 'Production refused the data', 'Waiting for the products application update', 'The production link is off', 'Returned by finance', 'Received by production', 'Approved', 'In production', 'Produced', 'Delivered', 'Cancelled in production', 'Cancelled'], 'and in English');
  for (const key of ['received', 'confirmed', 'in_production', 'produced', 'delivered']) check(lib.moldStatusLabel('status:' + key), mold.moldStatusNames[key], 'production\'s status as the card names it: ' + key);
  check(lib.moldStatusLabel('returned'), mold.MOLD_RETURNED_TEXT.badge, '«أعادتها المالية» as the card\'s badge');
  check(lib.MOLD_STEP_FILTERS.map(key => ar(lib.moldStepLabel(key))), ['بانتظار اعتمادك', 'بانتظار اعتماد مدير المبيعات', 'بانتظار اعتماد الإنتاج', 'بانتظار اعتماد المالية', 'في التصنيع', 'في التصنيع · Laser Cutting', 'في التصنيع · BOX', 'في التصنيع · Core and Connector', 'في التصنيع · Lower Mold', 'في التصنيع · Tempershoe', 'في التصنيع · Alignment', 'في التصنيع · Paint', 'بانتظار التسليم'], 'every choice of «واقف عند» in Arabic, in order');
  check(lib.MOLD_STEP_FILTERS.map(key => en(lib.moldStepLabel(key))), ['Waiting for your approval', 'Waiting for the sales manager\'s approval', 'Waiting for production\'s approval', 'Waiting for finance approval', 'In manufacturing', 'In manufacturing · Laser Cutting', 'In manufacturing · BOX', 'In manufacturing · Core and Connector', 'In manufacturing · Lower Mold', 'In manufacturing · Tempershoe', 'In manufacturing · Alignment', 'In manufacturing · Paint', 'Waiting for delivery'], 'and in English');
  for (const key of ['sales', 'production', 'admin', 'manufacturing', 'delivery']) check(lib.moldStepLabel('step:' + key), mold.moldWaitingNames[key], 'the step as the card names it: ' + key);
  check(['', 'nothing', 'status:cancelled', 'status:', 'sending:sent', 'step:done', 'step:cancelled', 'stage:roof', 'toString', 'constructor'].map(key => [lib.moldStatusLabel(key), lib.moldStepLabel(key)]), Array(10).fill([null, null]), 'a choice this page does not know has no words');
  for (const pair of [...lib.MOLD_STATUS_FILTERS.map(lib.moldStatusLabel), ...lib.MOLD_STEP_FILTERS.map(lib.moldStepLabel), ...Object.values(lib.MOLD_FILTER_TEXT)]) ok(/[؀-ۿ]/.test(pair[0]) && !/[؀-ۿ]/.test(pair[1]), 'Arabic and English, no Arabic in the English: ' + pair[1]);
  // «المصدر» (2026-11-19): offered once the list holds the products application's requests too (tests/mold-orders.mjs).
  check(Object.values(lib.MOLD_FILTER_TEXT).map(ar), ['تصفية طلبات القوالب', 'الحالة', 'كل الحالات', 'المفتوحة (لم تُسلَّم)', 'واقف عند', 'كل المراحل', 'المندوب', 'كل المندوبين', 'المصدر', 'كل المصادر', 'من تاريخ', 'إلى تاريخ', 'بحث', 'عميل، مندوب، وصف، سريال، رقم أمر...', 'مسح الفلاتر'], 'the panel\'s words, as the owner\'s picture has them («كل المندوبين» as the CRM writes it; «المصدر» since 2026-11-19)');
  check([lib.moldFilterCount(3, 10, (a) => a), lib.moldFilterCount(3, 10, (a, b) => b)], ['يظهر 3 من 10', 'Showing 3 of 10'], 'how many are shown');
}

// ---- the days: Riyadh's, both ends, turned round, Arabic digits
{
  check([lib.moldRequestDay(R.design), lib.moldRequestDay(R.ready), lib.moldRequestDay({requestedAt: '2026-10-31T20:59:59.999Z'}), lib.moldRequestDay({requestedAt: 'not a time'}), lib.moldRequestDay({requestedAt: ''})], ['2026-11-01', '2026-11-15', '2026-10-31', '', ''], 'the Riyadh day: 00:30 in Riyadh is the new day; a time that cannot be read is none');
  check(lib.moldDateRange('2026-11-10', '2026-11-01'), {from: '2026-11-01', to: '2026-11-10'}, 'a range typed the wrong way round is turned round');
  check(lib.moldDateRange('٢٠٢٦-١١-٠١', '۲۰۲۶-۱۱-۱۰'), {from: '2026-11-01', to: '2026-11-10'}, 'Arabic and Persian digits');
  check([lib.moldDateRange('2026-02-30', ''), lib.moldDateRange('', 'tomorrow'), lib.moldDateRange(' 2026-11-01 ', '')], [{from: '', to: ''}, {from: '', to: ''}, {from: '2026-11-01', to: ''}], 'a day that is not one is ignored');
  const days = (from, to) => lib.filterMoldRequests(Object.values(R), {...lib.MOLD_NO_FILTERS, from, to}, true).map(item => Object.keys(R).find(name => R[name] === item));
  check(days('2026-11-01', '2026-11-01'), ['design'], 'one day: the request asked for at 00:30 in Riyadh (21:30 UTC the day before)');
  check(days('2026-10-31', '2026-10-31'), [], 'and not the day before');
  check(days('2026-11-05', '2026-11-12'), ['waiting', 'sales', 'cancelled', 'production_cancelled', 'finance', 'making'].sort((a, b) => Object.keys(R).indexOf(a) - Object.keys(R).indexOf(b)), 'both ends included');
  check(days('2026-11-12', '2026-11-05'), days('2026-11-05', '2026-11-12'), 'the same range typed the wrong way round');
  check(days('2026-11-13', ''), ['ready'], 'from a day only (23:59:59 on the 15th in Riyadh is the 15th)');
  check(days('', '2026-10-01'), ['delivered'], 'to a day only');
  check(days('2026-11-16', '2026-11-30'), [], 'none in the range');
  check(lib.filterMoldRequests([view({requestedAt: 'garbage'})], {...lib.MOLD_NO_FILTERS, from: '2026-01-01'}, true).length, 0, 'a request whose day cannot be read leaves a dated filter');
  check(lib.filterMoldRequests([view({requestedAt: 'garbage'})], lib.MOLD_NO_FILTERS, true).length, 1, 'and stays without one');
}

// ---- «بحث»
{
  const found = query => lib.filterMoldRequests(Object.values(R), {...lib.MOLD_NO_FILTERS, query}, true).map(item => Object.keys(R).find(name => R[name] === item));
  check(found('الابداع'), ['design'], 'the customer\'s name without its hamza');
  check(found('مُؤَسَّسَة الإبداع'), ['design'], 'with diacritics');
  check(found('مصنع الجنوب'), ['making'], 'the customer\'s name');
  check(found('erp-7781'), ['making'], 'the ERP code, any case');
  check(found('ERP ٧٧٨١'), ['making'], 'the ERP code in Arabic digits');
  check(found('YR-C-000114'), ['making'], 'the Yourrest code');
  check(found('YR-C-114'), ['making'], 'the Yourrest code without its zeros');
  check(found('الشمري'), ['sales', 'finance'], 'the requester');
  check(found('سارة'), ['ready'], 'another requester');
  check(found('27.5TH'), ['making'], 'the description');
  check(found('open mm'), ['making'], 'the description\'s words in another order');
  check(found('YR-١٤'), ['making'], 'the mold number, Arabic digits');
  check(found('050'), ['making'], 'the serial, one mold of the order');
  check(found('049 / 050'), ['making'], 'the serial as written');
  check(found('١١٧'), ['making'], 'the production order number in Arabic digits');
  check(found('۹۸'), ['ready'], 'and in Persian digits');
  check(found('الجنوب 117'), ['making'], 'words across fields: every word somewhere');
  check(found('الجنوب 98'), [], 'every word, not any');
  check(found('لا يوجد'), [], 'nothing found');
  check(found('   '), Object.keys(R), 'nothing typed: every request');
  check(found('،،'), Object.keys(R), 'punctuation only: every request');
  const old = view({customerName: 'Gulf Blocks', specs: {...view().specs, description: 'Paver mold', moldNo: 'M-31'}, remote: remote({orderNo: 4410}), memberName: 'Omar'});
  for (const query of ['gulf', 'paver', 'm-31', '4410', 'omar']) check(lib.moldSearchMatches(old, query), true, 'what the search found before still found: ' + query);
  check(lib.moldSearchFields(view({crmNumber: null, customerErpCode: '', remote: null})), ['مصنع الشرق', 'احمد العتيبي', 'قالب بلوك 20'], 'a customer not in the CRM, not in production: no codes, no numbers');
}

// ---- each filter alone, and together
{
  const run = filters => lib.filterMoldRequests(Object.values(R), {...lib.MOLD_NO_FILTERS, ...filters}, true).map(item => Object.keys(R).find(name => R[name] === item));
  check(run({status: 'open'}), ['design', 'waiting', 'sales', 'finance', 'making', 'ready'], '«المفتوحة»: neither delivered nor cancelled');
  check(run({status: 'local'}), ['design', 'waiting'], '«لم يصل للإنتاج بعد»');
  check(run({status: 'sending:design_file'}), ['design'], '«بانتظار ملف التصميم»');
  check(run({status: 'sending:waiting'}), ['waiting', 'cancelled'], '«بانتظار الإرسال»: the request, and the cancellation on its way');
  check(run({status: 'returned'}), ['finance'], '«أعادتها المالية»');
  check(run({status: 'status:received'}), ['sales', 'finance'], '«استلمه الإنتاج»');
  check(run({status: 'status:in_production'}), ['making'], '«قيد التصنيع»');
  check(run({status: 'status:delivered'}), ['delivered'], '«تم التسليم للعميل»');
  check(run({status: 'production_cancelled'}), ['production_cancelled'], '«أُلغي في تطبيق الإنتاج»');
  check(run({status: 'cancelled'}), ['cancelled'], '«ملغى»');
  check(run({step: 'approve'}), ['sales'], '«بانتظار اعتمادك»');
  check(run({step: 'step:sales'}), ['sales'], '«بانتظار اعتماد مدير المبيعات»');
  check(run({step: 'step:admin'}), ['finance'], '«بانتظار اعتماد المالية»');
  check(run({step: 'step:manufacturing'}), ['making'], '«في التصنيع», every stage');
  check(run({step: 'stage:coreConnector'}), ['making'], 'the stage reached');
  check(run({step: 'stage:box'}), [], 'a stage done is not where it waits');
  check(run({step: 'step:delivery'}), ['ready'], '«بانتظار التسليم»');
  check(run({member: 'rep2'}), ['sales', 'finance'], 'one requester');
  check(run({member: 'rep2', status: 'returned'}), ['finance'], 'requester AND status');
  check(run({member: 'rep2', step: 'step:sales', from: '2026-11-05', to: '2026-11-05'}), ['sales'], 'requester AND step AND day');
  check(run({member: 'rep2', step: 'step:sales', from: '2026-11-06'}), [], 'one of them failing leaves nothing');
  check(run({status: 'open', query: 'الشمري', returned: true}), ['finance'], 'status AND words AND «أعادتها المالية»');
  check(run({returned: true, step: 'step:sales'}), [], '«أعادتها المالية» AND another step: nothing');
  check(run({status: 'open', step: 'step:manufacturing', member: 'rep1', from: '2026-11-12', to: '2026-11-12', query: '١١٧'}), ['making'], 'every filter at once');
}

// ---- what the panel offers, and the filters in force
{
  const all = Object.values(R);
  const choices = lib.moldFilterChoices(all, true, lib.MOLD_NO_FILTERS);
  check(choices.statuses.map(option => option.key), ['open', 'local', 'sending:design_file', 'sending:waiting', 'returned', 'status:received', 'status:in_production', 'status:produced', 'status:delivered', 'production_cancelled', 'cancelled'], 'only the statuses the list holds, in order');
  check(choices.steps.map(option => option.key), ['approve', 'step:sales', 'step:admin', 'step:manufacturing', 'stage:coreConnector', 'step:delivery'], 'only the steps and the stage the list holds, in order');
  check(choices.statuses.find(option => option.key === 'sending:design_file').label, mold.moldHeldTexts.design_file.name, 'an option\'s words are the card\'s');
  check(choices.members, [{id: 'rep1', name: 'أحمد العتيبي'}, {id: 'rep2', name: 'خالد الشمري'}, {id: 'cs1', name: 'سارة خدمة العملاء'}], 'the requesters, each once, by name');
  check([choices.active, choices.filters], [0, lib.MOLD_NO_FILTERS], 'nothing set');
  const kept = lib.moldFilterChoices(all, true, {...lib.MOLD_NO_FILTERS, status: 'status:confirmed', step: 'stage:paint'});
  check([kept.statuses.some(option => option.key === 'status:confirmed'), kept.steps.some(option => option.key === 'stage:paint'), kept.filters.status, kept.filters.step], [true, true, 'status:confirmed', 'stage:paint'], 'a choice the list no longer holds stays offered while chosen');
  check(lib.filterMoldRequests(all, kept.filters, true), [], 'and leaves nothing («لا نتائج»)');
  const unknown = lib.moldFilterChoices(all, true, {...lib.MOLD_NO_FILTERS, status: 'status:lost', step: 'step:done', member: 'nobody'});
  check([unknown.filters.status, unknown.filters.step, unknown.filters.member, unknown.active], ['', '', '', 0], 'an unknown status, a step that is a state, a requester not listed: let go');
  const one = lib.moldFilterChoices([R.design, R.waiting, R.making], true, {...lib.MOLD_NO_FILTERS, member: 'rep1'});
  check([one.members.length, one.filters.member, one.active], [1, '', 0], 'one requester (a representative\'s own list): no select, and no filter by it');
  const two = lib.moldFilterChoices(all, true, {...lib.MOLD_NO_FILTERS, member: 'rep2', from: '2026-11-30', to: '2026-11-01', query: '  ', returned: true});
  check([two.filters.member, two.filters.from, two.filters.to, two.filters.returned, two.active], ['rep2', '2026-11-01', '2026-11-30', true, 4], 'requester, days in order, «أعادتها المالية»: four set (spaces typed are not a search)');
  const noneReturned = lib.moldFilterChoices([R.design, R.making], true, {...lib.MOLD_NO_FILTERS, returned: true});
  check([noneReturned.filters.returned, noneReturned.active], [false, 0], '«أعادتها المالية» with nothing returned: not in force (its button is not shown)');
  check(lib.moldFilterChoices(all, true, {...lib.MOLD_NO_FILTERS, query: 'x', status: 'open', step: 'approve', from: '2026-11-01'}).active, 4, 'each one set counts');
  check(lib.moldFilterChoices([], true, lib.MOLD_NO_FILTERS), {statuses: [], steps: [], members: [], sources: [], filters: lib.MOLD_NO_FILTERS, active: 0}, 'an empty list offers nothing');
  check(lib.moldFilterChoices(all, true, lib.MOLD_NO_FILTERS).sources.map(option => option.key), ['crm'], 'the CRM\'s requests alone: one source, so no «المصدر»');
  const off = lib.moldFilterChoices([R.waiting], false, lib.MOLD_NO_FILTERS);
  check(off.statuses.map(option => option.key), ['open', 'local', 'sending:off'], 'the link off: the choice the card shows');
}

console.log(JSON.stringify({ok: true, checks, scope: 'mold requests filters: the card\'s words, «الحالة», «واقف عند», «المندوب», the Riyadh days, «بحث», together, the choices offered', productionDataUsed: false}));

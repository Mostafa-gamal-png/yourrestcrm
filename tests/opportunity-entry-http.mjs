// A new opportunity needs its result and its next step (lib/opportunity-entry.ts) over real HTTP against the BUILT release (run the build
// first): a new visit or contact (POST /api/visits) and customer service's «فرصة جديدة» (POST /api/customer-service) without «نتيجة الزيارة»
// or «نتيجة التواصل» (3 letters at least), the next action or the follow-up date are refused 400 with that field's words and write nothing,
// online and as an entry queued on the device; the queued entry completed by the member is saved once and its replay answers from the
// receipt; editing a saved visit without a result is saved; 401 without a session. Synthetic fixtures only: temporary SQLite, mocked mail.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'},
  {id: 'rep', role: 'rep', sup: 'sup'}, {id: 'cs', role: 'customer_service'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const MESSAGES = {visit: 'اكتب نتيجة الزيارة قبل حفظ الفرصة (3 أحرف على الأقل).', contact: 'اكتب نتيجة التواصل قبل حفظ الفرصة (3 أحرف على الأقل).', nextAction: 'اكتب الإجراء القادم قبل حفظ الفرصة.', nextDate: 'حدد موعد المتابعة قبل حفظ الفرصة.'};
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:57') await new Promise(resolve => setTimeout(resolve, 20000));
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), stamp = new Date().toISOString();
  const point = {latitude: 24.7136, longitude: 46.6753}, where = {location: '24.7136000, 46.6753000', latitude: point.latitude, longitude: point.longitude};
  const customer = (id, assignedTo = 'rep') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', code: id, branch: 'الرئيسي', assignedTo, ...where}), stamp, stamp).run();
  for (const id of ['c1', 'c2', 'c3', 's1']) await customer(id);
  const version = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first()).version;
  const count = async () => (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind='activity'").first()).n;
  const fields = {type: 'call', summary: 'تعريف بمنتجات الشركة', result: 'متابعة العميل', nextAction: 'متابعة المواصفات', nextDate: day, ...where, locationSource: 'device', locationCapturedAt: stamp, locationAccuracy: 10};
  const visit = async (customerId, data = {}, extra = {}) => ({createKey: crypto.randomUUID(), customerId, customerVersion: await version(customerId), timingMode: 'automatic', elapsedMilliseconds: 5000, data: {...fields, ...data}, ...extra});
  const post = (id, payload, url = '/api/visits') => as(id)(url, {method: 'POST', body: payload});
  const refused = async (id, payload, message, label, url) => { const result = await post(id, payload, url); check([result.status, result.json().error], [400, message], label); };

  check((await app.as(null)('/api/visits', {method: 'POST', body: await visit('c1', {result: ''})})).status, 401, 'anonymous: 401 before anything is read');
  // A new visit or contact, online.
  const before = await count();
  await refused('rep', await visit('c1', {result: ''}), MESSAGES.contact, 'a call without its result');
  await refused('rep', await visit('c1', {type: 'visit', result: ''}), MESSAGES.visit, 'a visit without its result');
  await refused('rep', await visit('c1', {result: 'نع'}), MESSAGES.contact, 'two letters');
  await refused('rep', await visit('c1', {result: '   '}), MESSAGES.contact, 'spaces only');
  await refused('rep', await visit('c1', {nextAction: ''}), MESSAGES.nextAction, 'no next action');
  await refused('rep', await visit('c1', {nextDate: ''}), MESSAGES.nextDate, 'no follow-up date');
  await refused('sup', await visit('c1', {type: 'whatsapp', result: ''}), MESSAGES.contact, 'a supervisor: the same rule');
  check(await count(), before, 'nothing written');
  let result = await post('rep', await visit('c1', {type: 'visit', result: 'تم أخذ موعد'}));
  check(result.status, 200, 'a complete visit is saved: ' + result.text);
  const saved = result.json().id;
  // Queued on the device: refused when it uploads, then the member's completed entry is saved once.
  const queued = await visit('c2', {result: ''}, {offline: {memberId: 'rep', capturedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, '.000Z')}});
  await refused('rep', queued, MESSAGES.contact, 'a queued entry without its result');
  await refused('rep', queued, MESSAGES.contact, 'sent again unchanged: the same answer');
  const completed = {...queued, data: {...queued.data, result: 'متابعة العميل'}};
  result = await post('rep', completed);
  check([result.status, result.json().id], [200, 'customer-visit-' + queued.createKey], 'the completed entry: saved under its own key');
  check((await post('rep', completed)).json().alreadySaved, true, 'its replay answers from the receipt');
  check(await count(), before + 2, 'two visits in all, never a duplicate');
  // Editing a saved visit asks nothing new: two letters are kept; an ended visit with no result at all keeps its earlier rule and words.
  const edit = async result => { const row = await app.db.prepare('SELECT data,version FROM crm_records WHERE id=?').bind(saved).first(); return post('owner', {createKey: crypto.randomUUID(), id: saved, version: row.version, customerId: 'c1', customerVersion: await version('c1'), timingMode: 'automatic', elapsedMilliseconds: 0, data: {...JSON.parse(row.data), result, summary: 'تعديل الإدارة'}}); };
  result = await edit('نع');
  check(result.status, 200, 'an edit with a two-letter result is saved (the 3 letters are a new opportunity\'s rule): ' + result.text);
  check(JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(saved).first()).data).result, 'نع', 'as it was written');
  result = await edit('');
  check([result.status, result.json().error], [400, 'سجّل نتيجة الزيارة قبل إنهائها'], 'an ended visit emptied of its result: the earlier rule, unchanged');
  // Customer service: «فرصة جديدة».
  const service = async (data = {}, extra = {}) => ({action: 'create', requestId: crypto.randomUUID(), customerId: 's1', customerVersion: await version('s1'), registration: {...fields, type: 'visit', salesStage: 'new', strength: 'strong', requestedProducts: ['قوالب البلوك المتحركة'], ...data}, elapsedMilliseconds: 60000, ...extra});
  await refused('cs', await service({result: ''}), MESSAGES.contact, 'customer service without a result: the contact\'s words', '/api/customer-service');
  await refused('cs', await service({result: 'نع'}), MESSAGES.contact, 'two letters', '/api/customer-service');
  await refused('cs', await service({nextAction: ''}), MESSAGES.nextAction, 'no next action', '/api/customer-service');
  check((await app.db.prepare('SELECT COUNT(*) AS n FROM crm_service_cases').first()).n, 0, 'no request written');
  result = await post('cs', await service({result: 'تم أخذ موعد'}), '/api/customer-service');
  check(result.status, 200, 'complete: the request is opened: ' + result.text);
  ok(JSON.parse((await app.db.prepare('SELECT data FROM crm_service_cases').first()).data).registration.result === 'تم أخذ موعد', 'with its result');
  console.log(JSON.stringify({ok: true, checks, scope: 'the new opportunity\'s result, next action and date on the built release: /api/visits online and queued, /api/customer-service, the completed entry saved once, an edit unchanged', realBrowser: false}));
} finally {
  await app.stop();
}

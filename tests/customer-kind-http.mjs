// «تصنيف العميل» and «نوع العميل» over real HTTP against the BUILT release (run the build first): POST /api/crm saves a customer with or
// without data.customerKind; a value outside مصنع، مؤسسة، شركة، محل تجاري is refused with 400 and writes nothing; a save that leaves the
// field out (a page opened before this update, an offline save queued before it) keeps the stored value, while an empty value clears it;
// a customer classified «خدمات» before keeps it through an unrelated edit (the classification stays free text on the server); the
// administrator's new customer with a customer-service request follows the same rule; GET /api/crm hands the field back; the audit and
// the version move like any edit. Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [{id: 'owner', role: 'admin'}, {id: 'mgr', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'mgr'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern'}];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const REFUSED = 'اختار نوع العميل من القائمة: مصنع، مؤسسة، شركة، محل تجاري';
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const owner = app.as(sessions.owner), rep = app.as(sessions.rep);
  const row = async id => { const found = await app.db.prepare('SELECT data,version FROM crm_records WHERE id=?').bind(id).first(); return found && {data: JSON.parse(found.data), version: found.version}; };
  const customers = async () => (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind='customer'").first()).n;
  const base = {region: 'الشرقية', city: 'الدمام', branch: 'الرئيسي', assignedTo: 'rep', phone: '0501234567', contact: 'م', customerType: 'جملة', customerStatus: 'نشط', category: '', location: '26.43, 50.03'};
  const create = (who, data) => who('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {...base, ...data}}});
  const edit = async (who, id, change, {drop = []} = {}) => {
    const {data, version} = await row(id), sent = {...data, ...change};
    for (const key of drop) delete sent[key];
    return who('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id, version, data: sent}});
  };

  // ---- new customers
  let response = await create(owner, {name: 'مؤسسة النور', customerKind: 'مؤسسة'});
  check(response.status, 200, 'saved with «نوع العميل»');
  const withKind = response.json().id;
  check([(await row(withKind)).data.customerKind, (await row(withKind)).data.customerType], ['مؤسسة', 'جملة'], 'stored as sent, next to the classification');
  response = await create(owner, {name: 'مصنع بلا نوع'});
  check(response.status, 200, 'saved without the field (an old page)');
  const withoutKind = response.json().id;
  check('customerKind' in (await row(withoutKind)).data, false, 'nothing stored for it');
  response = await create(owner, {name: 'شركة فاضية', customerKind: ''});
  check([response.status, (await row(response.json().id)).data.customerKind], [200, ''], 'an empty type is allowed');
  response = await create(owner, {name: 'محل بمسافات', customerKind: '  محل تجاري '});
  check([response.status, (await row(response.json().id)).data.customerKind], [200, 'محل تجاري'], 'trimmed');
  let before = await customers();
  for (const bad of ['خدمات', 'Company', 'محل', 7]) {
    response = await create(owner, {name: 'مرفوض ' + bad, customerKind: bad});
    check([response.status, response.json().error], [400, REFUSED], 'refused with 400: ' + bad);
  }
  check(await customers(), before, 'nothing written by a refused save');
  // a representative's own new customer: the same rule
  response = await create(rep, {name: 'محل المندوب', customerKind: 'محل تجاري'});
  check([response.status, (await row(response.json().id)).data.customerKind], [200, 'محل تجاري'], 'a representative saves it');
  response = await create(rep, {name: 'محل مرفوض', customerKind: 'دكان'});
  check(response.status, 400, 'and is refused another value');

  // ---- edits
  const v0 = (await row(withKind)).version;
  check((await edit(owner, withKind, {customerKind: 'شركة'})).status, 200, 'changed to another type');
  check([(await row(withKind)).data.customerKind, (await row(withKind)).version], ['شركة', v0 + 1], 'stored, and the version moves');
  check((await edit(owner, withKind, {city: 'الخبر'}, {drop: ['customerKind']})).status, 200, 'an old page edits the city and sends no type');
  check([(await row(withKind)).data.customerKind, (await row(withKind)).data.city], ['شركة', 'الخبر'], 'the stored type is kept, the city saved');
  const v1 = (await row(withKind)).version;
  response = await edit(owner, withKind, {customerKind: 'خدمات'});
  check([response.status, response.json().error], [400, REFUSED], 'an invalid edit: 400');
  check([(await row(withKind)).data.customerKind, (await row(withKind)).version], ['شركة', v1], 'nothing changed');
  check((await edit(owner, withKind, {customerKind: ''})).status, 200, 'cleared on purpose');
  check((await row(withKind)).data.customerKind, '', 'an empty type stored');
  check((await edit(owner, withoutKind, {city: 'الجبيل'}, {drop: ['customerKind']})).status, 200, 'an old page edits a customer that never had a type');
  check('customerKind' in (await row(withoutKind)).data, false, 'still none');
  // the audit records the edit as for any field
  const audits = (await app.db.prepare("SELECT action FROM crm_audit WHERE record_id=? ORDER BY created_at").bind(withKind).all()).results.map(entry => entry.action);
  check(audits.filter(action => action === 'تعديل').length >= 3 && audits[0] === 'إضافة', true, 'audited: «إضافة» then each «تعديل»');

  // ---- a customer classified «خدمات» before this update
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('legacy','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(JSON.stringify({...base, name: 'مصنع خدمات قديم', customerType: 'خدمات', customerKind: 'مصنع'}), now, now).run();
  check((await edit(owner, 'legacy', {phone: '0559999999'})).status, 200, 'an unrelated edit as the form sends it (the stored «خدمات» included)');
  check([(await row('legacy')).data.customerType, (await row('legacy')).data.customerKind, (await row('legacy')).data.phone], ['خدمات', 'مصنع', '0559999999'], '«خدمات» unchanged, the phone saved');
  check((await edit(owner, 'legacy', {city: 'القطيف'}, {drop: ['customerKind']})).status, 200, 'an old page');
  check([(await row('legacy')).data.customerType, (await row('legacy')).data.customerKind], ['خدمات', 'مصنع'], 'still «خدمات» and «مصنع»');
  check((await edit(owner, 'legacy', {customerType: 'تجاري'})).status, 200, 'another classification chosen');
  check((await row('legacy')).data.customerType, 'تجاري', 'replaces «خدمات»');

  // ---- what the pages read
  const listed = (await owner('/api/crm')).json().records.filter(record => record.kind === 'customer');
  check(Object.fromEntries(listed.filter(record => [withKind, 'legacy'].includes(record.id)).map(record => [record.id, [record.data.customerType, record.data.customerKind]])),
    {[withKind]: ['جملة', ''], legacy: ['تجاري', 'مصنع']}, 'GET /api/crm hands both fields back');

  // ---- the administrator's new customer with a customer-service request (serviceCustomerSchema, strict)
  const intake = {source: 'website', products: ['قوالب البلوك المتحركة'], strength: 'strong', needs: 'احتياج لقوالب جديدة', nextAction: 'تحديد المواصفات', nextDate: new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date())};
  const service = newCustomer => owner('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), newCustomer: {phone: '0500000000', region: 'الشرقية', location: '26.43, 50.03', ...newCustomer}, data: intake}});
  before = await customers();
  response = await service({name: 'عميل خدمة مرفوض', customerKind: 'خدمات'});
  check([response.status, await customers()], [400, before], 'customer service: another value refused, nothing written');
  response = await service({name: 'عميل خدمة', customerKind: 'شركة', customerType: 'خدمات'});
  check(response.status, 200, 'customer service: saved');
  const serviceCustomer = await app.db.prepare("SELECT data FROM crm_records WHERE kind='customer' AND json_extract(data,'$.name')='عميل خدمة'").first();
  check([JSON.parse(serviceCustomer.data).customerKind, JSON.parse(serviceCustomer.data).customerType], ['شركة', 'خدمات'], 'customer service: the type stored, the classification as free text as before');

  console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true}));
} finally {
  await app.stop();
}

// «طلب مساندة» inside an opportunity (the owner, 2026-11-16, item 3 of the GSCO list, «د»; lib/support-opportunity.ts) over real HTTP
// against the BUILT release (run the build first): GET /api/support/opportunity (anonymous 401, customer service 403, «الزيارات» hidden 404,
// an opportunity the reader may not read 404, POST 405, the answer for an open, a won and a busy opportunity); POST /api/support
// {action:'request',opportunityId} (opened in «التواصل مع العملاء» with the opportunity kept on it; a second while it is open, a closed
// opportunity, another customer, customer service and another representative refused; a retry answers as it did; customer service takes it
// as any request, timed from there); the retired «طلب مساعدة داخلية» (a new one refused 409 with where to go; an open one still answered
// with «الرد وإغلاق طلب المساعدة»; the earlier ones still in the case's history). Synthetic fixtures only: temporary SQLite, mocked mail,
// no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'المندوب'}, {id: 'rep2', role: 'rep', sup: 'mgr', name: 'مندوب ثانٍ'},
  {id: 'reph', role: 'rep', sup: 'sup', name: 'مندوب بلا زيارات'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString(), earlier = new Date(Date.now() - 26 * 3600000).toISOString();
  const insert = (id, kind, parent, assigned, data, when = earlier) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assigned, JSON.stringify(data), when, when).run();
  for (const [id, rep] of [['c-open', 'rep'], ['c-won', 'rep'], ['c-busy', 'rep'], ['c-other', 'rep2'], ['c-assist', 'rep']]) await insert(id, 'customer', null, rep, {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', phone: '0551234567'});
  const kase = (id, customerId, assignedTo, data = {}) => app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,2,?)')
    .bind(id, customerId, 'assigned', 'cs', 'csm', 'mgr', assignedTo, 'sup', JSON.stringify({source: 'call', products: ['خدمات صيانة'], strength: 'strong', needs: 'تحديد موعد زيارة', nextAction: 'زيارة', nextDate: '2030-01-01', participants: ['cs', 'csm'], approvedAt: earlier, assignedAt: earlier, registration: {type: 'call', visitNumber: 77}, ...data}), earlier, earlier, 'fixture').run();
  await kase('case-open', 'c-open', 'rep');
  await kase('case-won', 'c-won', 'rep');
  await insert('k-won', 'activity', 'c-won', 'rep', {type: 'call', date: now.slice(0, 10), result: 'تم', salesStage: 'won', serviceCaseId: 'case-won', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, now);
  await kase('case-busy', 'c-busy', 'rep');
  await kase('case-other', 'c-other', 'rep2');
  await kase('case-assist', 'c-assist', 'rep', {assistanceOpen: true});
  await app.db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('assist-old','case-assist','خدمة العملاء','service:assist',?,?)").bind(JSON.stringify({label: 'طلب مساعدة داخلية', note: 'برجاء متابعة عرض السعر داخليًا', targetName: '', state: 'assigned'}), earlier).run();
  await insert('support-busy', 'support', null, 'rep', {kind: 'support', customerId: 'c-busy', origin: 'rep', status: 'open', requestedBy: 'rep', requestedAt: earlier, repId: 'rep', note: 'طلب سابق', channel: 'any', handlerId: '', handlerAt: '', handlerBy: '', events: [{at: earlier, by: 'rep', action: 'request', text: 'طلب سابق'}]});
  await app.db.prepare('INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES(?,?,?,1,?,?)').bind('reph', '{}', JSON.stringify(['activity']), now, 'owner').run();
  const cookies = {};
  for (const member of members) cookies[member.id] = await app.login(member.id);
  const preflight = (who, id) => app.as(who ? cookies[who] : null)('/api/support/opportunity?id=' + encodeURIComponent(id));
  const customer = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first()).version;
  const ask = async (who, caseId, customerId, extra = {}) => app.as(cookies[who])('/api/support', {method: 'POST', body: {action: 'request', origin: 'rep', opportunityId: caseId, customerId, customerVersion: await customer(customerId), note: 'العميل لا يرد على اتصالاتي، اسألوه عن موعد مناسب', channel: 'call', requestId: crypto.randomUUID(), ...extra}});

  // ---- GET /api/support/opportunity: the doors
  eq((await preflight(null, 'case-open')).status, 401, 'anonymous: 401');
  for (const who of ['cs', 'csm']) eq([(await preflight(who, 'case-open')).status, (await preflight(who, 'case-open')).json().error], [403, 'طلب المساندة متاح للمندوب والمشرف ومدير المبيعات ومدير النظام فقط.'], who + ': customer service is the one asked: 403');
  eq([(await preflight('reph', 'case-open')).status, (await preflight('reph', 'case-open')).json().error], [404, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.'], '«الزيارات» hidden: 404');
  eq([(await preflight('rep2', 'case-open')).status, (await preflight('rep2', 'case-open')).json().error], [404, 'الفرصة غير متاحة.'], 'another representative\'s opportunity: 404');
  eq((await preflight('rep', 'nothing')).status, 404, 'an unknown one: 404');
  eq((await app.as(cookies.rep)('/api/support/opportunity?id=case-open', {method: 'POST', body: {}})).status, 405, 'GET only');
  // ---- the answers
  let response = await preflight('rep', 'case-open');
  eq([response.status, response.headers['cache-control'], response.json()], [200, 'no-store', {opportunity: {id: 'case-open', number: 77, products: ['خدمات صيانة'], open: true}, customer: {id: 'c-open', name: 'مصنع c-open', version: 1}, openRequest: null, canAsk: true}], 'the holder\'s open opportunity: the form may be offered');
  for (const who of ['sup', 'mgr', 'owner']) eq((await preflight(who, 'case-open')).json().canAsk, true, who + ': may ask too');
  eq([(await preflight('rep', 'case-won')).json().opportunity.open, (await preflight('rep', 'case-won')).json().canAsk], [false, false], 'a won opportunity: closed');
  eq((await preflight('rep', 'case-busy')).json().openRequest, {id: 'support-busy', readable: true}, 'the customer\'s open request, which he may open');

  // ---- POST: a request in «التواصل مع العملاء» from the opportunity
  const first = await ask('rep', 'case-open', 'c-open');
  eq(first.status, 200, 'the representative asks from his open opportunity');
  const id = first.json().id;
  const row = JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(id).first()).data);
  eq([row.kind, row.origin, row.status, row.customerId, row.requestedBy, row.channel, row.opportunity], ['support', 'rep', 'open', 'c-open', 'rep', 'call', {id: 'case-open', number: 77, products: ['خدمات صيانة']}], 'a support request like any other, with the opportunity kept on it');
  let support = (await app.as(cookies.rep)('/api/support')).json().requests.find(entry => entry.id === id);
  eq([support.opportunity, support.state], [{id: 'case-open', number: 77, products: ['خدمات صيانة']}, 'waiting'], 'the requester reads it with its opportunity, waiting for customer service');
  eq((await preflight('rep', 'case-open')).json().openRequest, {id, readable: true}, 'the opportunity now names it as the open request');
  const again = await ask('rep', 'case-open', 'c-open');
  eq([again.status, again.json().error], [409, 'يوجد طلب مساندة مفتوح لهذا العميل تتابعه خدمة العملاء في «التواصل مع العملاء»، ولا يُفتح له طلب ثانٍ حتى ينتهي.'], 'a second request while one is open: refused with the reason');
  const receipt = await app.db.prepare("SELECT detail FROM crm_audit WHERE id LIKE 'support-receipt:rep:%' AND record_id=?").bind(id).first();
  eq((await app.as(cookies.rep)('/api/support', {method: 'POST', body: JSON.parse(receipt.detail)})).json(), {ok: true, id, alreadySaved: true}, 'a retry of the same request answers as it did');
  eq([(await ask('rep', 'case-won', 'c-won')).status, (await ask('rep', 'case-won', 'c-won')).json().error], [409, 'طلب المساندة متاح للفرص المفتوحة فقط.'], 'a closed opportunity: refused');
  eq([(await ask('rep', 'case-busy', 'c-busy')).status], [409], 'a customer with an open request: refused');
  eq((await ask('rep', 'case-other', 'c-other')).status, 404, 'another representative\'s opportunity: 404');
  eq([(await ask('rep', 'case-busy', 'c-open')).status], [409], 'a customer other than the opportunity\'s: refused');
  eq((await ask('cs', 'case-open', 'c-open')).status, 403, 'customer service never asks');
  eq((await ask('reph', 'case-open', 'c-open')).status, 404, 'a member with «الزيارات» hidden: the opportunity is not his to read');
  // ---- from there it follows the support chain: customer service takes it
  const waiting = (await app.as(cookies.cs)('/api/support')).json().requests.find(entry => entry.id === id);
  ok(waiting && waiting.permissions.take && waiting.targetHours === 4 && waiting.opportunity?.number === 77, 'customer service sees it in «التواصل مع العملاء», may take it, against its 4-hour target');
  eq((await app.as(cookies.cs)('/api/support', {method: 'POST', body: {action: 'take', id, version: waiting.version, requestId: crypto.randomUUID()}})).status, 200, 'and takes it');
  support = (await app.as(cookies.rep)('/api/support')).json().requests.find(entry => entry.id === id);
  eq(support.state, 'in_progress', 'the requester sees customer service in contact');

  // ---- the retired «طلب مساعدة داخلية»
  const caseOf = async (who, caseId) => (await app.as(cookies[who])('/api/customer-service')).json().cases.find(item => item.id === caseId);
  for (const who of ['cs', 'rep']) {
    const item = await caseOf(who, 'case-open');
    const refused = await app.as(cookies[who])('/api/customer-service', {method: 'POST', body: {action: 'assist', id: 'case-open', version: item.version, note: 'برجاء المساعدة في المتابعة', requestId: crypto.randomUUID()}});
    eq([refused.status, refused.json().error], [409, 'لم يعد «طلب مساعدة داخلية» متاحًا: طلب المساندة الجديد يُفتح من زر «طلب مساندة» في الفرصة، وتتابعه خدمة العملاء في «التواصل مع العملاء». تبقى الطلبات السابقة مقروءة، ويُكمل المفتوح منها بالرد.'], who + ': a new internal help request is refused, saying where to go');
  }
  eq((await caseOf('cs', 'case-open')).data.assistanceOpen, undefined, 'nothing was written');
  let assisted = await caseOf('rep', 'case-assist');
  ok(assisted.data.assistanceOpen === true && assisted.history.some(entry => entry.action === 'service:assist' && entry.detail.label === 'طلب مساعدة داخلية'), 'an earlier one stays open and readable in the case\'s history');
  eq((await app.as(cookies.rep)('/api/customer-service', {method: 'POST', body: {action: 'reply', id: 'case-assist', version: assisted.version, note: 'تم التواصل وتحديد الاحتياج', requestId: crypto.randomUUID()}})).status, 200, 'an open one is still answered by the holder');
  assisted = await caseOf('cs', 'case-assist');
  ok(assisted.data.assistanceOpen === false && assisted.history.some(entry => entry.action === 'service:reply'), 'and closes, its history kept');
  eq((await app.as(cookies.cs)('/api/customer-service', {method: 'POST', body: {action: 'note', id: 'case-open', version: (await caseOf('cs', 'case-open')).version, note: 'ملاحظة داخلية للفريق', requestId: crypto.randomUUID()}})).status, 200, 'the internal note stays');
  console.log(JSON.stringify({ok: true, checks, syntheticFixtures: true, productionDataUsed: false}));
} finally { await app.stop(); }

// «المحذوفات» over real HTTP against the BUILT release (run `pnpm build` first), on the release's own SQLite: the administrator deletes a
// customer with POST /api/crm, finds it in GET /api/trash with its Yourrest code, restores it with POST /api/trash and it is back in
// GET /api/crm with the same YR-C code, nothing of the deletion or the restoration in the history GET /api/crm sends; a second
// restoration is 409, a lost answer's retry (same request id) is alreadySaved; a visit comes back with its number; the quotation waits for
// its opportunity; a sales manager lists and restores only their own deletions; since 2026-11-10 a representative or a supervisor granted
// «حذف» lists and restores their own deletions (a visit deleted with «حذف» on visits, refused with its reason once that cell is off, another
// member's deletion refused, back with nothing of the page once every «حذف» cell is off: 404), while customer service (no «حذف» cell) and
// a member without one get 404; another site's request 403; an oversized body 413. Synthetic fixtures only: temporary SQLite, mocked sendmail.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب الوسطى'}, {id: 'cs', role: 'customer_service', name: 'خدمة العملاء'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

const app = await bootBuiltApp({members});
try {
  const owner = app.as(await app.login('owner')), sm = app.as(await app.login('sm'));
  const raw = id => app.db.prepare('SELECT * FROM crm_records WHERE id=?').bind(id).first();
  const deletion = async id => app.db.prepare("SELECT id FROM crm_audit WHERE record_id=? AND action='حذف' ORDER BY created_at DESC LIMIT 1").bind(id).first();
  const remove = async (as, id) => { const row = await raw(id); const response = await as('/api/crm', {method: 'POST', body: {action: 'delete', kind: row.kind, id, version: row.version}}); check(response.status, 200, 'delete ' + id + ': ' + response.text); };
  const restore = (as, auditId, requestId = crypto.randomUUID()) => as('/api/trash', {method: 'POST', body: {auditId, requestId}});
  const listed = async (as, query = '') => { const response = await as('/api/trash' + query); check(response.status, 200, response.text); return response.json(); };

  // ---- a customer: delete, find, restore, the same YR-C code
  let response = await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name: 'مصنع المحذوفات', region: 'الوسطى', city: 'الرياض', code: 'TR-1', branch: 'الرئيسي', assignedTo: 'rep', phone: '0501234567', contact: 'م'}}});
  check(response.status, 200, response.text);
  const customer = response.json().id;
  const code = (await owner('/api/crm')).json().records.find(r => r.id === customer).data.internalCode;
  check(/^YR-C-\d{6}$/.test(code), true, 'a Yourrest code');
  await remove(owner, customer);
  let page = await listed(owner);
  check(page.items.map(item => [item.type, item.title, item.number, item.deletedBy, item.blocked]), [['customer', 'مصنع المحذوفات', code, 'مدير النظام', null]], 'listed with its code and who deleted it');
  check((await listed(owner, '?type=visit')).items, [], 'not under visits');
  const audit = page.items[0].id, requestId = crypto.randomUUID();
  response = await restore(owner, audit, requestId);
  check([response.status, response.json().id, response.json().type], [200, customer, 'customer'], 'restored');
  check((await restore(owner, audit, requestId)).json().alreadySaved, true, 'the same request again: the first answer');
  response = await restore(owner, audit);
  check([response.status, response.json().error], [409, 'استُرجع السجل من قبل.'], 'a second restoration: 409');
  const crm = (await owner('/api/crm')).json();
  check(crm.records.find(r => r.id === customer)?.data.internalCode, code, 'back in the customers with the same YR-C code');
  check(crm.audits.filter(a => a.recordId === customer).map(a => a.action), ['إضافة'], 'its history: the addition only (no «حذف», no «استرجاع سجل»)');
  check((await listed(owner)).items, [], 'the list is empty again');

  // ---- a visit keeps its number; a quotation waits for its opportunity
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_visit_numbers(record_id) VALUES('visit-h')").run();
  const number = (await app.db.prepare("SELECT number FROM crm_visit_numbers WHERE record_id='visit-h'").first()).number;
  const insert = (id, kind, parent, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,'rep','الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, JSON.stringify(data), now, now).run();
  await insert('visit-h', 'activity', customer, {type: 'visit', date: now.slice(0, 10), summary: 'زيارة للاسترجاع', performedBy: 'rep', visitNumber: number});
  await insert('opp-h', 'opportunity', customer, {moldType: 'قالب انترلوك', product: 'p', dimensions: 'd', quantity: 1, stage: 'technical', technicalStatus: 'approved', technicalNotes: 'ok', nextAction: 'x', nextDate: '2026-12-01', performedBy: 'sm'});
  await insert('quote-h', 'quote', 'opp-h', {number: 'YR-2026-HTTP', date: '2026-11-09', validUntil: '2026-11-30', status: 'draft', items: [{description: 'قالب', quantity: 1, price: 10}], taxRate: 15, performedBy: 'sm'});
  await remove(owner, 'visit-h'); await remove(owner, 'quote-h'); await remove(owner, 'opp-h');
  page = await listed(owner);
  check(page.items.map(item => [item.type, item.number, item.customerName, item.blocked]), [['opportunity', '', 'مصنع المحذوفات', null], ['quote', '', 'مصنع المحذوفات', 'استرجع السجل الأصلي أولًا: الفرصة «قالب انترلوك».'], ['visit', String(number), 'مصنع المحذوفات', null]], 'newest first; the quotation waits for its opportunity');
  response = await restore(owner, (await deletion('quote-h')).id);
  check([response.status, response.json().error], [409, 'استرجع السجل الأصلي أولًا: الفرصة «قالب انترلوك».'], 'refused');
  for (const id of ['opp-h', 'quote-h', 'visit-h']) check((await restore(owner, (await deletion(id)).id)).status, 200, 'restored ' + id);
  const visit = (await owner('/api/crm')).json().records.find(r => r.id === 'visit-h');
  check([visit.data.visitNumber, visit.version], [number, 2], 'the visit with its number, at the next version');

  // ---- a sales manager: their own deletions («حذف» is off by default since 2026-11-09: the administrator grants it)
  const grant = async (memberId, cells) => check((await owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId, version: 0, cells, hidden: [], viewAll: false}})).status, 200, 'grant ' + memberId);
  await grant('sm', {'customer:delete': true});
  response = await sm('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name: 'مصنع مدير المبيعات', region: 'الوسطى', city: 'الرياض', branch: 'الرئيسي', assignedTo: 'rep', phone: '0501234568', contact: 'م'}}});
  const managed = response.json().id;
  await remove(sm, managed);
  await insert('visit-o', 'activity', customer, {type: 'call', date: now.slice(0, 10), summary: 'اتصال', performedBy: 'rep'});
  await remove(owner, 'visit-o');
  check((await listed(sm)).items.map(item => item.recordId), [managed], 'the manager sees their own deletion only');
  check((await listed(owner)).items.map(item => item.recordId).sort(), [managed, 'visit-o'].sort(), 'the administrator both');
  response = await restore(sm, (await deletion('visit-o')).id);
  check([response.status, response.json().error], [403, 'استرجاع ما حذفه غيرك متاح لمدير النظام فقط.'], 'not the administrator\'s');
  check((await restore(sm, (await deletion(managed)).id)).status, 200, 'their own: restored');

  // ---- «حذف» brings «المحذوفات» (the owner, 2026-11-10): the representative's own visit, deleted and restored by them
  const rep = app.as(await app.login('rep')), sup = app.as(await app.login('sup')), cs = app.as(await app.login('cs'));
  for (const [id, as] of [['sup', sup], ['rep', rep], ['cs', cs]]) {
    const list = await as('/api/trash');
    check([list.status, list.json().error, (await restore(as, 'x')).status], [404, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.', 404], id + ' without «حذف»: no page (404, as a hidden screen), no restoration');
  }
  await insert('visit-r', 'activity', customer, {type: 'call', date: now.slice(0, 10), summary: 'زيارة المندوب', performedBy: 'rep'});
  await insert('visit-r2', 'activity', customer, {type: 'call', date: now.slice(0, 10), summary: 'زيارة المندوب التانية', performedBy: 'rep'});
  await insert('visit-s', 'activity', customer, {type: 'call', date: now.slice(0, 10), summary: 'زيارة للمشرف', performedBy: 'rep'});
  await grant('rep', {'activity:delete': true});
  await remove(rep, 'visit-r'); await remove(rep, 'visit-r2'); await remove(owner, 'visit-s');
  page = await listed(rep);
  check([page.scope, page.items.map(item => [item.recordId, item.deletedBy, item.blocked]).sort()], ['own', [['visit-r', 'مندوب الوسطى', null], ['visit-r2', 'مندوب الوسطى', null]]], 'the representative: their own deletions only (not the administrator\'s of their visit)');
  response = await restore(rep, (await deletion('visit-s')).id);
  check([response.status, response.json().error], [403, 'استرجاع ما حذفه غيرك متاح لمدير النظام فقط.'], 'another member\'s deletion: 403');
  response = await restore(rep, (await deletion('visit-r')).id);
  check([response.status, response.json().type], [200, 'visit'], 'their own: restored');
  check((await rep('/api/crm')).json().records.some(r => r.id === 'visit-r'), true, 'the visit is back in their records');
  // the cell switched off after deleting: listed with why, refused with it; «حذف» elsewhere keeps the page
  const repVersion = (await app.db.prepare("SELECT version FROM crm_member_permissions WHERE member_id='rep'").first()).version;
  check((await owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: 'rep', version: repVersion, cells: {'followup:delete': true}, hidden: [], viewAll: false}})).status, 200, 'the administrator switches «حذف» of visits off');
  const reason = 'استرجاع هذا السجل يتطلب صلاحية «حذف» في الزيارات، وهي غير مفتوحة لك حاليًا. راجع مدير النظام.';
  check((await listed(rep)).items.map(item => [item.recordId, item.blocked]), [['visit-r2', reason]], 'listed with why');
  response = await restore(rep, (await deletion('visit-r2')).id);
  check([response.status, response.json().error], [403, reason], 'refused: 403 with the reason');
  check((await owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: 'rep', version: repVersion + 1, cells: {}, hidden: [], viewAll: false}})).status, 200, 'every «حذف» off');
  check([(await rep('/api/trash')).status, (await restore(rep, (await deletion('visit-r2')).id)).status], [404, 404], 'no «حذف» left: no page');
  check((await listed(owner)).items.some(item => item.recordId === 'visit-r2' && item.deletedBy === 'مندوب الوسطى' && !item.blocked), true, 'the administrator has it, and may restore it');
  // a supervisor granted «حذف» on visits: their own; customer service holds no «حذف» cell whatever is sent
  await grant('sup', {'activity:delete': true}); await grant('cs', {'activity:delete': true, 'customer:delete': true});
  check((await listed(sup)).scope, 'own', 'the supervisor with «حذف»: their own');
  check([(await cs('/api/trash')).status, (await restore(cs, 'x')).status], [404, 404], 'customer service: never');

  // ---- another site; a body over the limit
  check((await owner('/api/trash', {method: 'POST', body: {auditId: 'x', requestId: crypto.randomUUID()}, headers: {Origin: 'https://evil.example'}})).status, 403, 'another site: 403');
  check((await owner('/api/trash', {method: 'POST', body: {auditId: 'x'.repeat(3000), requestId: crypto.randomUUID()}})).status, 413, 'over 2 000 bytes: 413');
  check((await owner('/api/trash', {method: 'POST', body: {auditId: 'nothing', requestId: crypto.randomUUID()}})).status, 404, 'an unknown entry: 404');
} finally { await app.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true}));

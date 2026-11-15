// «طلبات تعديل بيانات العميل» (lib/customer-edit-requests*.ts) over real HTTP against the BUILT release (run the build first): every door with
// no session (401), from another site (403), with a role that may not decide (403) and with the right one; the two steps (the
// representative's supervisor, then the sales manager), the sales manager refused while it is with the supervisor; customer service and a
// supervisor straight to the sales manager; a rejection's reason reaching its sender; cancel; the ERP code and the routing refused on the
// server (nothing waits); the same send repeated after a lost answer making one request; another edit while one waits; a field changed
// since (stale) refused, another field changed since kept; an edit saved on the device refused (an edit needs a connection, as before);
// the history's words; no-store. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'mgrw', role: 'manager', region: 'western', name: 'مدير مبيعات الغربية'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup2', region: 'eastern', name: 'المندوب خالد'},
  {id: 'lone', role: 'rep', sup: 'mgr', region: 'eastern', name: 'مندوب بلا مشرف'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'},
  {id: 'cs', role: 'customer_service', sup: 'csm', name: 'خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const stamp = new Date().toISOString();
  const insert = (id, assigned, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1)").bind(id, assigned, JSON.stringify({name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', phone: '0500000000', contact: 'مسؤول', location: '26.43, 50.03', code: 'ERP-' + id, branch: 'الرئيسي', assignedTo: assigned, ...data}), stamp, stamp).run();
  await insert('c1', 'rep1', {}); await insert('c2', 'rep2', {}); await insert('c3', 'sup', {});
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null);
  const stored = async id => { const row = await app.db.prepare('SELECT data,version,assigned_to,branch FROM crm_records WHERE id=?').bind(id).first(); return {...row, data: JSON.parse(row.data)}; };
  const edit = async (id, changes, editKey = crypto.randomUUID()) => { const row = await stored(id); return {action: 'save', kind: 'customer', id, version: row.version, editKey, data: {...row.data, ...changes}}; };
  const send = async (who, body, status = 200) => { const reply = await session[who]('/api/crm', {method: 'POST', body}); eq(reply.status, status, who + ' -> ' + reply.text.slice(0, 300)); return reply.json(); };
  const decide = (who, decision, id, status = 200, note) => send(who, {action: 'customer-edit', decision, id, ...(note === undefined ? {} : {note})}, status);
  const list = async (who, customerId) => { const reply = await session[who]('/api/customer-edits' + (customerId ? '?customerId=' + customerId : '')); eq([reply.status, reply.headers['cache-control']], [200, 'no-store'], 'the list of ' + who + ': 200, never cached'); return reply.json(); };
  const waiting = async id => (await app.db.prepare("SELECT COUNT(*) n FROM crm_audit q WHERE q.record_id=? AND q.action='customer-edit:request' AND NOT EXISTS (SELECT 1 FROM crm_audit d WHERE d.id='customer-edit-decision:'||q.id)").bind(id).first()).n;

  // The doors.
  for (const url of ['/api/customer-edits', '/api/customer-edits?customerId=c1']) eq((await anonymous(url)).status, 401, 'anonymous GET ' + url);
  eq((await anonymous('/api/crm', {method: 'POST', body: {action: 'customer-edit', decision: 'cancel', id: 'customer-edit:rep1:' + crypto.randomUUID()}})).status, 401, 'anonymous decision: 401');
  eq((await session.rep1('/api/crm', {method: 'POST', body: {action: 'customer-edit', decision: 'cancel', id: 'customer-edit:rep1:' + crypto.randomUUID()}, headers: {Origin: 'https://evil.example'}})).status, 403, 'a decision from another site: 403');
  for (const member of members) eq((await list(member.id)).requests, [], member.id + ' reads an empty list at first');

  // The administrator and the sales manager edit directly.
  eq((await send('mgr', await edit('c1', {notes: 'مباشر'}))).pendingApproval, undefined, 'the sales manager edits directly');
  eq((await stored('c1')).data.notes, 'مباشر', 'and it applies');

  // A representative: the supervisor, then the sales manager.
  let before = await stored('c1');
  let sent = await send('rep1', await edit('c1', {phone: '0511111111'}));
  eq([sent.pendingApproval, sent.approvalStage, (await stored('c1')).version], [true, 'supervisor', before.version], 'the representative\'s edit waits for their supervisor');
  eq((await decide('mgr', 'approve', sent.requestId, 403)).error, 'الطلب عند مشرف المندوب. يصل إلى مدير المبيعات بعد موافقة المشرف.', 'the sales manager is refused at the supervisor\'s step');
  await decide('owner', 'reject', sent.requestId, 403, 'سبب'); await decide('sup2', 'approve', sent.requestId, 403); await decide('rep2', 'approve', sent.requestId, 403); await decide('cs', 'approve', sent.requestId, 403);
  eq((await list('sup')).requests.map(r => [r.id, r.stage, r.canDecide]), [[sent.requestId, 'supervisor', true]], 'the supervisor sees it and may decide');
  eq((await list('mgr')).requests.length, 0, 'not in the sales manager\'s list yet');
  eq((await list('sup2')).requests.length + (await list('rep2')).requests.length + (await list('cs')).requests.length, 0, 'nobody else sees it');
  eq((await decide('sup', 'approve', sent.requestId)).stage, 'sales_manager', 'the supervisor passes it on');
  eq((await stored('c1')).version, before.version, 'the customer still waits');
  eq((await list('mgrw')).requests.length, 0, 'a sales manager of another region does not see it');
  await decide('mgrw', 'approve', sent.requestId, 403);
  const atManager = (await list('mgr')).requests[0];
  eq([atManager.stage, atManager.supervisorName, atManager.changes], ['sales_manager', 'المشرف سالم', [{field: 'phone', before: '0500000000', after: '0511111111'}]], 'the sales manager sees it, who approved it first, before and after');
  eq((await decide('mgr', 'approve', sent.requestId)).status, 'approved', 'approved');
  eq([(await stored('c1')).data.phone, (await stored('c1')).data.code, (await stored('c1')).assigned_to], ['0511111111', 'ERP-c1', 'rep1'], 'applied; the ERP code and the routing stay');
  await decide('mgr', 'approve', sent.requestId, 409);
  // The history's words.
  const history = (await session.mgr('/api/crm')).json().audits.filter(a => a.recordId === 'c1').map(a => a.action);
  for (const words of ['طلب تعديل بيانات العميل', 'موافقة المشرف على تعديل بيانات العميل', 'الموافقة على تعديل بيانات العميل']) ok(history.includes(words), 'the history names: ' + words);

  // A rejection needs its reason, which reaches the sender.
  sent = await send('rep1', await edit('c1', {city: 'الخبر'}));
  for (const note of ['', '   ', '‏‎', 'x', 'س'.repeat(1001)]) await decide('sup', 'reject', sent.requestId, 400, note);
  await decide('sup', 'reject', sent.requestId, 200, 'المدينة غير صحيحة');
  const answered = (await list('rep1')).requests.find(r => r.id === sent.requestId);
  eq([answered.status, answered.note, answered.decidedByName, (await stored('c1')).data.city], ['rejected', 'المدينة غير صحيحة', 'المشرف سالم', 'الدمام'], 'the sender reads the reason; nothing changes');

  // Cancel at either step; only the sender.
  sent = await send('rep1', await edit('c1', {city: 'القطيف'}));
  await decide('sup', 'cancel', sent.requestId, 403); await decide('mgr', 'cancel', sent.requestId, 403);
  eq((await decide('rep1', 'cancel', sent.requestId)).status, 'cancelled', 'cancelled with the supervisor');
  sent = await send('rep1', await edit('c1', {city: 'القطيف'}));
  await decide('sup', 'approve', sent.requestId);
  eq((await decide('rep1', 'cancel', sent.requestId)).status, 'cancelled', 'cancelled after the supervisor');
  await decide('mgr', 'approve', sent.requestId, 409);

  // Straight to the sales manager: customer service, its manager, a supervisor, a representative whose supervisor is the sales manager.
  for (const [who, id] of [['cs', 'c1'], ['csm', 'c1'], ['sup', 'c3'], ['lone', 'c1']]) {
    const answer = await send(who, await edit(id, {supplier: 'مورد ' + who}));
    eq([answer.pendingApproval, answer.approvalStage], [true, 'sales_manager'], who + ': straight to the sales manager');
    eq((await list('mgr')).requests.find(r => r.id === answer.requestId)?.canDecide, true, who + ': the sales manager may decide at once');
    await decide(who, 'cancel', answer.requestId);
  }

  // Locked fields are refused on the server: nothing waits.
  before = await stored('c1');
  for (const [who, changes, error] of [['rep1', {code: 'ERP-X'}, 'كود ERP لا يُكتب ولا يُعدَّل يدويًا لأي مستخدم، ولا لمدير النظام؛ يُحدَّث من ملف عملاء ERP فقط («استيراد من ERP»).'], ['cs', {code: ''}, null], ['rep1', {assignedTo: 'rep2'}, 'لا يمكنك تغيير مسؤول العميل أو فرعه'], ['cs', {branch: 'آخر'}, 'لا يمكنك تغيير مسؤول العميل أو فرعه']]) {
    const refused = await send(who, await edit('c1', {...changes, notes: 'مع حقل مقفول'}), 403);
    if (error) eq(refused.error, error, who + ': ' + Object.keys(changes)[0] + ' refused');
  }
  eq([await waiting('c1'), JSON.stringify((await stored('c1')).data)], [0, JSON.stringify(before.data)], 'no request, no change');
  // A forged field beside a real change never enters the request.
  sent = await send('rep1', await edit('c1', {notes: 'تصحيح', sourceFile: 'forged.xlsx', erpRep: 'forged'}));
  const held = await app.db.prepare("SELECT detail FROM crm_audit WHERE id=?").bind(sent.requestId).first();
  eq(Object.keys(JSON.parse(held.detail).values), ['notes'], 'only the note is held');
  await decide('rep1', 'cancel', sent.requestId);

  // The same send after a lost answer: one request. Another edit while one waits: refused, whoever sends it.
  const body = await edit('c1', {contact: 'مسؤول جديد'});
  const first = await send('rep1', body), again = await send('rep1', body);
  eq([again.alreadySaved, again.requestId, await waiting('c1')], [true, first.requestId, 1], 'the same send: the same request');
  eq((await send('rep1', await edit('c1', {contact: 'آخر'}), 409)).error, 'لديك طلب تعديل بانتظار الموافقة على هذا العميل. ألغِه من بيانات العميل ثم أرسل التعديل الجديد.', 'the sender\'s other edit: 409');
  eq((await send('rep2', await edit('c1', {contact: 'آخر'}), 409)).error, 'يوجد طلب تعديل آخر على هذا العميل بانتظار الموافقة.', 'another member: 409');
  await decide('rep1', 'cancel', first.requestId);

  // Stale: the same field changed since is refused; another field changed since keeps both.
  sent = await send('rep1', await edit('c1', {phone: '0522222222'}));
  await decide('sup', 'approve', sent.requestId);
  await send('owner', await edit('c1', {phone: '0533333333'}));
  eq((await list('mgr')).requests.find(r => r.id === sent.requestId).stale, true, 'marked stale');
  eq((await decide('mgr', 'approve', sent.requestId, 409)).error, 'تغيرت البيانات نفسها بعد إرسال الطلب. ارفض الطلب ليعيد صاحبه إرساله على البيانات الحالية.', 'a stale request is not approved');
  eq((await stored('c1')).data.phone, '0533333333', 'the newer value stays');
  await decide('mgr', 'reject', sent.requestId, 200, 'قديم');
  sent = await send('rep1', await edit('c1', {phone: '0544444444'}));
  await decide('sup', 'approve', sent.requestId);
  await send('mgr', await edit('c1', {city: 'الأحساء'}));
  await decide('mgr', 'approve', sent.requestId);
  eq([(await stored('c1')).data.phone, (await stored('c1')).data.city], ['0544444444', 'الأحساء'], 'both changes hold');

  // An edit queued on the device is refused (an edit needs a connection), and makes no request.
  const offlineBody = {...await edit('c1', {phone: '0555555555'}), offline: {memberId: 'rep1', capturedAt: new Date().toISOString().replace(/\.\d+Z$/, '.000Z')}};
  eq((await send('rep1', offlineBody, 400)).error, 'هذا الإجراء يتطلب اتصالًا مباشرًا.', 'an offline edit: refused');
  eq(await waiting('c1'), 0, 'no request');

  // A supervisor deactivated while a request waits for them: the sales manager may decide it, read live.
  sent = await send('rep1', await edit('c1', {machineTypes: 'هيدروليك'}));
  await app.db.prepare("UPDATE crm_members SET active=0 WHERE id='sup'").run();
  eq((await list('mgr')).requests.find(r => r.id === sent.requestId)?.stage, 'sales_manager', 'the supervisor deactivated: with the sales manager');
  await decide('mgr', 'approve', sent.requestId);
  eq((await stored('c1')).data.machineTypes, 'هيدروليك', 'and approved by them');
  console.log(JSON.stringify({ok: true, checks, scope: 'customer edit requests over HTTP on the built release: the doors, both steps, the sales manager refused at the supervisor, reject with a reason, cancel, locked fields, a repeated send, stale, offline, a deactivated supervisor, the history', realBrowser: false}));
} finally {
  await app.stop();
}

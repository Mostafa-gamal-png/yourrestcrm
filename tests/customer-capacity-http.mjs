// «الطاقة الإنتاجية والاحتياج» of a customer and «موعد احتياج القوالب المتوقع» of a visit (lib/customer-capacity.ts, the owner, 2026-11-21)
// over real HTTP against the BUILT release (run the build first): the doors (401, 403 from another site); a representative's change of the
// three entered fields ALONE on their own customer saved directly (the stored customer with the three and nothing else, its history with
// the fields before and after, no request), Arabic digits read, an empty one removed, a value out of range refused with its words and
// nothing written; the same with another field, or on a colleague's customer, waiting for approval as before (the three travelling in the
// request, applied at the approval), a direct update while their other request waits leaving that request whole; a customer outside their
// regions not found; «العملاء · تحرير» switched off refusing it (restrict-only); a marketing officer's own customer of another branch
// direct, the same with another field a request, their branch's customers direct as before; a supervisor and customer service through the
// request; the sales manager and the administrator direct; a save that does not carry the three (a page or a queue of the release before)
// keeping them, at a direct save and at an approval; a new customer, online and queued on the device, with them; every reader of the
// customer reading them. The visit's day: saved with a new visit, refused before the day of recording, a queued entry judged against its own
// day, kept by an edit that does not carry it or sends it back unchanged though past, refused when changed to a past day, never written by a
// representative's edit (they edit no saved visit), refused on the older entry point (POST /api/crm activity), and read back by GET /api/crm.
// Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup2', region: 'eastern', name: 'المندوب خالد'},
  {id: 'mkt', role: 'marketing', sup: 'sup', region: 'eastern', name: 'مسؤولة التسويق ريم'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'},
  {id: 'cs', role: 'customer_service', sup: 'csm', name: 'خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const CAPACITY = ['moldsInUse', 'productionCapacity', 'annualDemand'];
const MOLDS_REFUSED = 'اكتب عدد القوالب المستخدمة رقمًا صحيحًا من 0 إلى 10000.', TEXT_REFUSED = 'اكتب الطاقة الإنتاجية نصًا قصيرًا لا يزيد على 100 حرف.';
const MOLD_NEED_PAST = 'موعد احتياج القوالب المتوقع يجب أن يكون يوم التسجيل أو لاحقًا';
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:57') await new Promise(resolve => setTimeout(resolve, 20000));
const app = await bootBuiltApp({members});
try {
  const stamp = new Date().toISOString(), day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());
  const shift = (days) => new Date(Date.parse(day + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
  const where = {location: '26.4373410, 50.0344990', latitude: 26.437341, longitude: 50.034499};
  const insert = (id, assigned, data = {}, branch = 'الرئيسي', region = 'الشرقية') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,?,?,?,?,1)")
    .bind(id, assigned, branch, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', code: 'ERP-' + id, phone: '0500000000', contact: 'المسؤول', branch, assignedTo: assigned, ...where, ...data}), stamp, stamp).run();
  const machine = (id, parent, assigned, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'factory',?,?,'الرئيسي',?,?,?,1)").bind(id, parent, assigned, JSON.stringify({name: 'خط ' + id, recordType: 'machine', quantity: 1, machineBrand: 'Besser', modelCondition: 'new', machineType: 'stationary', ...data}), stamp, stamp).run();
  await insert('c1', 'rep1'); await insert('c2', 'rep2'); await insert('cw', 'rep1', {}, 'الرئيسي', 'الغربية'); await insert('cx', 'mkt', {}, 'جدة'); await insert('cm', 'rep2');
  await insert('cold', 'rep1', {moldsInUse: 8, productionCapacity: 'قديمة', annualDemand: 'سنوي قديم'});
  await machine('m1', 'c1', 'rep1', {quantity: 2}); await machine('m2', 'c1', 'rep1', {machineType: 'unknown', machineBrand: 'QGM'});
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null);
  const stored = async id => { const row = await app.db.prepare('SELECT data,version,assigned_to,branch FROM crm_records WHERE id=?').bind(id).first(); return {...row, data: JSON.parse(row.data)}; };
  const edit = async (id, changes, {drop = [], editKey = crypto.randomUUID()} = {}) => { const row = await stored(id); const data = {...row.data, ...changes}; for (const key of drop) delete data[key]; return {action: 'save', kind: 'customer', id, version: row.version, editKey, data}; };
  const send = async (who, body, status = 200, url = '/api/crm') => { const reply = await session[who](url, {method: 'POST', body}); eq(reply.status, status, who + ' ' + url + ' -> ' + reply.text.slice(0, 300)); return reply.json(); };
  const capacity = data => Object.fromEntries(CAPACITY.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  const without = data => { const copy = {...data}; for (const key of CAPACITY) delete copy[key]; return copy; };
  const waiting = async id => (await app.db.prepare("SELECT q.detail FROM crm_audit q WHERE q.record_id=? AND q.action='customer-edit:request' AND NOT EXISTS (SELECT 1 FROM crm_audit d WHERE d.id='customer-edit-decision:'||q.id)").bind(id).all()).results.map(row => JSON.parse(row.detail));
  const audits = async (id, action) => (await app.db.prepare('SELECT actor,detail FROM crm_audit WHERE record_id=? AND action=? ORDER BY created_at').bind(id, action).all()).results;
  const decide = (who, decision, id) => send(who, {action: 'customer-edit', decision, id});

  // ---- The doors.
  eq((await anonymous('/api/crm', {method: 'POST', body: await edit('c1', {moldsInUse: 3})})).status, 401, 'anonymous: 401');
  eq((await session.rep1('/api/crm', {method: 'POST', body: await edit('c1', {moldsInUse: 3}), headers: {Origin: 'https://evil.example'}})).status, 403, 'from another site: 403');
  eq(capacity((await stored('c1')).data), {}, 'nothing written by either');

  // ---- A representative, their own customer, the three alone: saved directly.
  let before = await stored('c1');
  let answer = await send('rep1', await edit('c1', {moldsInUse: '١٢', productionCapacity: '  5000 بلكة   يوميًا ', annualDemand: '40 قالبًا'}));
  eq([answer.ok, answer.id, answer.pendingApproval, answer.requestId], [true, 'c1', undefined, undefined], 'saved directly, no request');
  let after = await stored('c1');
  eq(capacity(after.data), {moldsInUse: 12, productionCapacity: '5000 بلكة يوميًا', annualDemand: '40 قالبًا'}, 'as read: Arabic digits, one line');
  eq([without(after.data), after.version, after.assigned_to, after.branch], [without(before.data), before.version + 1, 'rep1', 'الرئيسي'], 'the stored customer with the three and nothing else');
  eq((await waiting('c1')).length, 0, 'no request waits');
  let history = await audits('c1', 'customer-edit:capacity');
  eq(history.length, 1, 'one history line');
  let held = JSON.parse(history[0].detail);
  eq([history[0].actor, held.by, held.fields, held.base, held.values], ['المندوب أحمد', 'rep1', CAPACITY, {moldsInUse: '', productionCapacity: '', annualDemand: ''}, {moldsInUse: 12, productionCapacity: '5000 بلكة يوميًا', annualDemand: '40 قالبًا'}], 'by whom, with the fields before and after');
  // The history as the sales manager reads it (GET /api/crm): its words and changes.
  const page = async who => { const reply = await session[who]('/api/crm'); eq(reply.status, 200, 'GET /api/crm as ' + who); return reply.json(); };
  const line = (await page('mgr')).audits.find(entry => entry.recordId === 'c1' && entry.action === 'تحديث الطاقة الإنتاجية والاحتياج');
  eq([line?.detail, line?.changes?.map(change => [change.field, change.before, change.after])], ['مصنع c1', [['moldsInUse', '', '12'], ['productionCapacity', '', '5000 بلكة يوميًا'], ['annualDemand', '', '40 قالبًا']]], 'the sales manager reads the update in the customer\'s history');
  // Every reader of the customer reads them.
  for (const who of ['rep1', 'rep2', 'mkt', 'sup', 'mgr', 'owner']) eq(capacity((await page(who)).records.find(row => row.id === 'c1').data), {moldsInUse: 12, productionCapacity: '5000 بلكة يوميًا', annualDemand: '40 قالبًا'}, who + ' reads them');
  // Emptied, changed: direct again.
  await send('rep1', await edit('c1', {moldsInUse: '0', annualDemand: ''}));
  eq(capacity((await stored('c1')).data), {moldsInUse: 0, productionCapacity: '5000 بلكة يوميًا'}, '0 kept, an emptied one removed');
  // Refused: nothing written.
  before = await stored('c1');
  eq((await send('rep1', await edit('c1', {moldsInUse: '10001'}), 400)).error, MOLDS_REFUSED, 'over 10,000: refused with its words');
  eq((await send('rep1', await edit('c1', {moldsInUse: '1.5'}), 400)).error, MOLDS_REFUSED, 'a fraction: refused');
  eq((await send('rep1', await edit('c1', {productionCapacity: 'ب'.repeat(101)}), 400)).error, TEXT_REFUSED, '101 characters: refused');
  eq((await stored('c1')).version, before.version, 'nothing written');
  // A save that does not carry the three (a page of the release before) leaves them: the sales manager's direct edit.
  await send('mgr', await edit('c1', {notes: 'تعديل الإدارة'}, {drop: CAPACITY}));
  after = await stored('c1');
  eq([after.data.notes, capacity(after.data)], ['تعديل الإدارة', {moldsInUse: 0, productionCapacity: '5000 بلكة يوميًا'}], 'a save without them keeps them');

  // ---- With another field: the whole edit waits, the three in it, applied at the approval.
  before = await stored('c1');
  answer = await send('rep1', await edit('c1', {moldsInUse: 15, phone: '0511111111'}));
  eq([answer.pendingApproval, answer.approvalStage, (await stored('c1')).version], [true, 'supervisor', before.version], 'with the phone: a request to the supervisor, the customer unchanged');
  held = (await waiting('c1'))[0];
  eq([held.fields, held.values], [['phone', 'moldsInUse'], {phone: '0511111111', moldsInUse: 15}], 'the request holds the phone and the molds');
  // While it waits, the representative updates the annual demand alone: direct, and the request stays whole.
  await send('rep1', await edit('c1', {annualDemand: 'نحو 60 قالبًا'}));
  eq([(await stored('c1')).data.annualDemand, (await waiting('c1')).length], ['نحو 60 قالبًا', 1], 'a direct update while a request waits (it is not blocked by it)');
  await decide('sup', 'approve', answer.requestId);
  await decide('mgr', 'approve', answer.requestId);
  after = await stored('c1');
  eq([after.data.phone, capacity(after.data)], ['0511111111', {moldsInUse: 15, productionCapacity: '5000 بلكة يوميًا', annualDemand: 'نحو 60 قالبًا'}], 'approved: the phone and the molds applied, the direct update kept');

  // ---- A colleague's customer: a request, never direct.
  before = await stored('c2');
  answer = await send('rep1', await edit('c2', {moldsInUse: 4}));
  eq([answer.pendingApproval, (await stored('c2')).version, capacity((await stored('c2')).data)], [true, before.version, {}], 'a colleague\'s customer: a request, nothing written');
  eq((await waiting('c2'))[0].fields, ['moldsInUse'], 'holding the molds');
  // Outside their regions: not found.
  eq((await send('rep1', await edit('cw', {moldsInUse: 4}), 404)).error, 'السجل غير موجود أو ليس لديك صلاحية', 'their own customer in another region: not found');
  // «العملاء · تحرير» switched off (restrict-only): refused, nothing written.
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('rep1',?,'[]',1,'owner',?)").bind(JSON.stringify({'customer:edit': false}), stamp).run();
  before = await stored('c1');
  eq((await send('rep1', await edit('c1', {moldsInUse: 20}), 403)).error, 'غير مسموح لك بالتعديل في العملاء. راجع مدير النظام.', 'the cell off: refused');
  eq((await stored('c1')).version, before.version, 'nothing written');
  await app.db.prepare("DELETE FROM crm_member_permissions WHERE member_id='rep1'").run();
  session.rep1 = app.as(await app.login('rep1'));
  await send('rep1', await edit('c1', {moldsInUse: 21}));
  eq((await stored('c1')).data.moldsInUse, 21, 'the cell on again: direct');

  // ---- A marketing officer.
  // Their own customer of another branch (their other corrections of it wait): the three alone direct, recorded as such.
  answer = await send('mkt', await edit('cx', {productionCapacity: '3000 بلكة'}));
  eq([answer.pendingApproval, (await stored('cx')).data.productionCapacity, (await audits('cx', 'customer-edit:capacity')).length], [undefined, '3000 بلكة', 1], 'a marketing officer\'s own customer of another branch: direct');
  answer = await send('mkt', await edit('cx', {productionCapacity: '3500 بلكة', notes: 'ملاحظة'}));
  eq([answer.pendingApproval, (await stored('cx')).data.productionCapacity], [true, '3000 بلكة'], 'with another field: a request');
  // Their branch's customers: direct as before (their correction), the three among its fields.
  answer = await send('mkt', await edit('cm', {annualDemand: '20 قالبًا'}));
  const direct = await audits('cm', 'customer-edit:direct');
  eq([answer.pendingApproval, (await stored('cm')).data.annualDemand, JSON.parse(direct.at(-1).detail).fields], [undefined, '20 قالبًا', ['annualDemand']], 'their branch\'s customer: their direct correction, as before');

  // ---- A supervisor and customer service: through the request, as their other corrections.
  answer = await send('sup', await edit('c1', {moldsInUse: 3}));
  eq([answer.pendingApproval, answer.approvalStage, (await stored('c1')).data.moldsInUse], [true, 'sales_manager', 21], 'the supervisor (their team\'s customer): a request to the sales manager');
  answer = await send('cs', await edit('cold', {moldsInUse: 9}));
  eq([answer.pendingApproval, answer.approvalStage, (await stored('cold')).data.moldsInUse], [true, 'sales_manager', 8], 'customer service: a request to the sales manager');
  // The sales manager and the administrator: direct.
  await send('owner', await edit('c2', {moldsInUse: '٧'}, {}));
  await send('mgr', await edit('cw', {annualDemand: 'كبير'}));
  eq([(await stored('c2')).data.moldsInUse, (await stored('cw')).data.annualDemand], [7, 'كبير'], 'the administrator and the sales manager: direct');

  // ---- The approval of a request sent by a page of the release before (no capacity fields): what is stored stays.
  answer = await send('rep1', await edit('cold', {phone: '0533333333'}, {drop: CAPACITY}), 409);
  ok(answer.error, 'customer service\'s request waits on that customer: another request is refused as before (' + answer.error + ')');
  const csRequest = (await waiting('cold'))[0];
  await send('cs', {action: 'customer-edit', decision: 'cancel', id: 'customer-edit:cs:' + csRequest.key});
  answer = await send('rep1', await edit('cold', {phone: '0533333333'}, {drop: CAPACITY}));
  eq(answer.pendingApproval, true, 'an old page\'s request (no capacity fields)');
  eq((await waiting('cold'))[0].fields, ['phone'], 'holds the phone alone');
  await decide('sup', 'approve', answer.requestId); await decide('mgr', 'approve', answer.requestId);
  after = await stored('cold');
  eq([after.data.phone, capacity(after.data)], ['0533333333', {moldsInUse: 8, productionCapacity: 'قديمة', annualDemand: 'سنوي قديم'}], 'approved: the phone applied, the three kept');

  // ---- A new customer, online and queued on the device.
  const newCustomer = (who, data, extra = {}) => ({action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name: 'عميل جديد ' + crypto.randomUUID().slice(0, 6), region: 'الشرقية', city: 'الدمام', ...where, phone: '0500000002', ...data}, ...extra});
  answer = await send('rep1', newCustomer('rep1', {moldsInUse: '٢٥', productionCapacity: 'ألف بلكة', annualDemand: ''}));
  eq(capacity((await stored(answer.id)).data), {moldsInUse: 25, productionCapacity: 'ألف بلكة'}, 'a new customer with them');
  answer = await send('rep1', newCustomer('rep1', {moldsInUse: 5}, {offline: {memberId: 'rep1', capturedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, '.000Z')}}));
  eq(capacity((await stored(answer.id)).data), {moldsInUse: 5}, 'queued on the device: with them');
  answer = await send('rep1', newCustomer('rep1', {}));
  eq(capacity((await stored(answer.id)).data), {}, 'none: none');

  // ---- The visit's «موعد احتياج القوالب المتوقع».
  const version = async id => (await stored(id)).version;
  const fields = {type: 'visit', summary: 'تعريف بمنتجات الشركة', result: 'متابعة العميل', nextAction: 'متابعة المواصفات', nextDate: day, ...where, locationSource: 'device', locationCapturedAt: stamp, locationAccuracy: 10};
  const visit = async (customerId, data = {}, extra = {}) => ({createKey: crypto.randomUUID(), customerId, customerVersion: await version(customerId), timingMode: 'automatic', elapsedMilliseconds: 5000, data: {...fields, ...data}, ...extra});
  const visits = async () => (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind='activity'").first()).n;
  let count = await visits();
  eq((await send('rep1', await visit('c1', {moldNeedBy: shift(-1)}), 400, '/api/visits')).error, MOLD_NEED_PAST, 'a new visit with a past day: refused');
  eq((await send('rep1', await visit('c1', {moldNeedBy: '2027-02-30'}), 400, '/api/visits')).error, 'التاريخ غير صالح', 'not a day: refused');
  eq(await visits(), count, 'nothing written');
  answer = await send('rep1', await visit('c1', {moldNeedBy: shift(90)}), 200, '/api/visits');
  const saved = answer.id;
  eq((await stored(saved)).data.moldNeedBy, shift(90), 'a new visit with the day');
  answer = await send('rep1', await visit('c1', {moldNeedBy: day}), 200, '/api/visits');
  eq((await stored(answer.id)).data.moldNeedBy, day, 'the day of recording: allowed');
  answer = await send('rep1', await visit('c1', {moldNeedBy: ''}), 200, '/api/visits');
  eq('moldNeedBy' in (await stored(answer.id)).data, false, 'none: none');
  // Queued on the device yesterday: judged against the day it was recorded.
  const yesterday = new Date(Date.parse(shift(-1) + 'T09:00:00Z')).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  answer = await send('rep1', await visit('c2', {moldNeedBy: shift(-1), nextDate: shift(-1)}, {offline: {memberId: 'rep1', capturedAt: yesterday}}), 200, '/api/visits');
  eq((await stored(answer.id)).data.moldNeedBy, shift(-1), 'an entry queued yesterday with yesterday\'s day: saved');
  // The read back.
  eq((await page('mgr')).records.find(row => row.id === saved).data.moldNeedBy, shift(90), 'GET /api/crm reads it back');
  // Edits (the management edits saved visits; a representative edits none).
  const visitEdit = async (who, changes, {drop = false} = {}) => { const row = await stored(saved); const data = {...row.data, ...changes}; if (drop) delete data.moldNeedBy; return session[who]('/api/visits', {method: 'POST', body: {createKey: crypto.randomUUID(), id: saved, version: row.version, customerId: 'c1', customerVersion: await version('c1'), timingMode: 'automatic', elapsedMilliseconds: 0, data}}); };
  eq((await visitEdit('rep1', {moldNeedBy: shift(100)})).status, 403, 'a representative edits no saved visit');
  let reply = await visitEdit('sup', {summary: 'تعديل المشرف'}, {drop: true});
  eq([reply.status, (await stored(saved)).data.moldNeedBy], [200, shift(90)], 'an edit that does not carry the day (a page of the release before): kept');
  reply = await visitEdit('sup', {moldNeedBy: shift(-2)});
  eq([reply.status, reply.json().error, (await stored(saved)).data.moldNeedBy], [400, MOLD_NEED_PAST, shift(90)], 'changed to a past day: refused');
  reply = await visitEdit('mgr', {moldNeedBy: shift(120)});
  eq([reply.status, (await stored(saved)).data.moldNeedBy], [200, shift(120)], 'changed to a later day: saved');
  // A stored day that has passed is kept by an edit that sends it back unchanged.
  await app.db.prepare("UPDATE crm_records SET data=json_set(data,'$.moldNeedBy','2026-01-15') WHERE id=?").bind(saved).run();
  reply = await visitEdit('mgr', {summary: 'تعديل آخر'});
  eq([reply.status, (await stored(saved)).data.moldNeedBy], [200, '2026-01-15'], 'a past stored day sent back unchanged: never refused');
  reply = await visitEdit('mgr', {moldNeedBy: ''});
  eq([reply.status, 'moldNeedBy' in (await stored(saved)).data], [200, false], 'emptied: removed');
  // The older entry point refuses the field, as every field of the visits page.
  eq((await send('owner', {action: 'save', kind: 'activity', parentId: 'c1', data: {type: 'call', date: day, summary: 'اتصال', nextAction: 'x', nextDate: day, moldNeedBy: shift(10)}}, 400)).error, 'استخدم قسم الزيارات لحفظ بيانات الزيارة والعميل.', 'POST /api/crm activity: refused');

  console.log(JSON.stringify({ok: true, checks, scope: 'customer capacity and demand, and the visit\'s expected mold need date, on the built release', realBrowser: false}));
} finally {
  await app.stop();
}

// «المسؤولون» of a customer (lib/customer-contacts.ts, the customer form of 2026-11-21) over real HTTP against the BUILT release (run the
// build first): a representative's new customer with several contacts and their roles, online and queued on the device (a contact with
// nothing in it dropped, the second kept in the customer's «المسؤول الثاني», the rest in data.contacts); a representative's correction of the
// contacts waiting for their supervisor and the sales manager as every correction of theirs (nothing changes before; the approval applies
// the list and the roles), never saved directly even on their own customer (only «الطاقة الإنتاجية والاحتياج» is); customer service and a
// supervisor through the request; the sales manager and the administrator direct; a marketing officer's own branch direct, recorded with
// the fields before and after; an unknown role, a bad email and more than ten refused with their words and nothing written; a save without
// the contacts or the roles (a page or a device queue of the release before) keeping them, at a direct save and at an approval; the second
// deleted with others after it taking the first of them; every reader of the customer reading them; a colleague's customer and another
// region as before. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب خالد'},
  {id: 'mkt', role: 'marketing', sup: 'sup', region: 'eastern', name: 'مسؤولة التسويق ريم'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'},
  {id: 'cs', role: 'customer_service', sup: 'csm', name: 'خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const TITLE_REFUSED = 'اختر صفة المسؤول من القائمة: مدير المصنع، المالك، المشتريات، مسؤول الإنتاج، المحاسب، أخرى.';
const EMAIL_REFUSED = 'اكتب البريد الإلكتروني لكل مسؤول بصيغة صحيحة، أو اتركه فارغًا.', TOO_MANY = 'عشرة مسؤولين على الأكثر للعميل الواحد.';
const KEYS = ['contact', 'contactTitle', 'phone', 'email', 'contact2', 'contactTitle2', 'phone2', 'email2', 'contacts'];
const app = await bootBuiltApp({members});
try {
  const stamp = new Date().toISOString();
  const where = {location: '26.4373410, 50.0344990', latitude: 26.437341, longitude: 50.034499};
  const insert = (id, assigned, data = {}, region = 'الشرقية') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1)")
    .bind(id, assigned, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', code: 'ERP-' + id, branch: 'الرئيسي', assignedTo: assigned, ...where, ...data}), stamp, stamp).run();
  await insert('c1', 'rep1', {contact: 'علي', phone: '0500000001'});
  await insert('c2', 'rep2', {contact: 'سامي', phone: '0500000002', contactTitle: 'owner', contact2: 'منى', phone2: '0500000003', contacts: [{name: 'هند', title: 'accountant', phone: '0500000004', email: ''}]});
  await insert('cw', 'rep1', {contact: 'غربي'}, 'الغربية');
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const stored = async id => { const row = await app.db.prepare('SELECT data,version FROM crm_records WHERE id=?').bind(id).first(); return {...row, data: JSON.parse(row.data)}; };
  const contacts = data => Object.fromEntries(KEYS.filter(key => data[key] !== undefined && data[key] !== '').map(key => [key, data[key]]));
  const edit = async (id, changes, drop = []) => { const row = await stored(id); const data = {...row.data, ...changes}; for (const key of drop) delete data[key]; return {action: 'save', kind: 'customer', id, version: row.version, editKey: crypto.randomUUID(), data}; };
  const send = async (who, body, status = 200) => { const reply = await session[who]('/api/crm', {method: 'POST', body}); eq(reply.status, status, who + ' -> ' + reply.text.slice(0, 300)); return reply.json(); };
  const waiting = async id => (await app.db.prepare("SELECT q.detail FROM crm_audit q WHERE q.record_id=? AND q.action='customer-edit:request' AND NOT EXISTS (SELECT 1 FROM crm_audit d WHERE d.id='customer-edit-decision:'||q.id)").bind(id).all()).results.map(row => JSON.parse(row.detail));
  const decide = (who, decision, id) => send(who, {action: 'customer-edit', decision, id});
  const page = async who => { const reply = await session[who]('/api/crm'); eq(reply.status, 200, 'GET /api/crm as ' + who); return reply.json(); };
  // What the form sends: the list as the customer's fields (app/customer-form.tsx contactsData).
  const asFields = list => { const [one = {}, two = {}, ...rest] = list; return {contact: one.name || '', contactTitle: one.title || '', phone: one.phone || '', email: one.email || '', contact2: two.name || '', contactTitle2: two.title || '', phone2: two.phone || '', email2: two.email || '', contacts: rest}; };

  // ---- The doors.
  eq((await app.as(null)('/api/crm', {method: 'POST', body: await edit('c1', asFields([{name: 'x'}]))})).status, 401, 'anonymous: 401');
  eq((await session.rep1('/api/crm', {method: 'POST', body: await edit('c1', asFields([{name: 'x'}])), headers: {Origin: 'https://evil.example'}})).status, 403, 'from another site: 403');

  // ---- A representative's new customer: several contacts.
  const list = [{name: 'م. خالد', title: 'factory_manager', phone: '0551234567', email: 'k@factory.example'}, {name: 'أ. سعد', title: 'purchasing', phone: '0509876543', email: ''}, {name: '', title: '', phone: '', email: ''}, {name: 'سارة', title: 'accountant', phone: '0533333333', email: 's@factory.example'}];
  const create = (who, data, extra = {}) => ({action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name: 'عميل ' + crypto.randomUUID().slice(0, 6), region: 'الشرقية', city: 'الدمام', ...where, ...data}, ...extra});
  let answer = await send('rep1', create('rep1', asFields(list)));
  let row = await stored(answer.id);
  eq(contacts(row.data), {contact: 'م. خالد', contactTitle: 'factory_manager', phone: '0551234567', email: 'k@factory.example', contact2: 'أ. سعد', contactTitle2: 'purchasing', phone2: '0509876543', contacts: [{name: 'سارة', title: 'accountant', phone: '0533333333', email: 's@factory.example'}]},
    'the primary in the customer\'s own fields, the second in «المسؤول الثاني», the others in data.contacts (an empty one dropped)');
  answer = await send('rep1', create('rep1', asFields([{name: 'نوال', phone: '0544444444'}, {name: '', phone: ''}, {name: 'ريم', title: 'owner', phone: '0555555555'}]), {offline: {memberId: 'rep1', capturedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, '.000Z')}}));
  eq(contacts((await stored(answer.id)).data), {contact: 'نوال', phone: '0544444444', contact2: 'ريم', contactTitle2: 'owner', phone2: '0555555555'}, 'queued on the device: the same, the second left empty taken by the next');
  answer = await send('rep1', create('rep1', {contact: 'قديم', phone: '0566666666'}));
  eq(contacts((await stored(answer.id)).data), {contact: 'قديم', phone: '0566666666'}, 'a page of the release before (no list, no roles): as before');
  // Refused, nothing written.
  const count = async () => (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind='customer'").first()).n;
  let before = await count();
  eq((await send('rep1', create('rep1', {...asFields(list), contactTitle: 'boss'}), 400)).error, TITLE_REFUSED, 'an unknown role');
  eq((await send('rep1', create('rep1', asFields([...list, {name: 'x', email: 'not-an-email'}])), 400)).error, EMAIL_REFUSED, 'a bad email');
  eq((await send('rep1', create('rep1', asFields(Array.from({length: 11}, (_, i) => ({name: 'م' + i})))), 400)).error, TOO_MANY, 'eleven contacts');
  eq(await count(), before, 'nothing written');
  answer = await send('rep1', create('rep1', asFields(Array.from({length: 10}, (_, i) => ({name: 'م' + i, phone: '05000000' + String(i).padStart(2, '0')})))));
  eq((await stored(answer.id)).data.contacts.length, 8, 'ten in all: accepted');

  // ---- A representative's correction of the contacts: a request, even on their own customer.
  before = await stored('c1');
  answer = await send('rep1', await edit('c1', asFields([{name: 'علي', title: 'owner', phone: '0500000001'}, {name: 'جديد', phone: '0500000009'}])));
  eq([answer.pendingApproval, answer.approvalStage, (await stored('c1')).version], [true, 'supervisor', before.version], 'their own customer\'s contacts: a request to the supervisor, nothing changed');
  eq((await waiting('c1'))[0].fields, ['contactTitle', 'contact2', 'phone2'], 'the request holds what changed');
  await decide('sup', 'approve', answer.requestId); await decide('mgr', 'approve', answer.requestId);
  eq(contacts((await stored('c1')).data), {contact: 'علي', contactTitle: 'owner', phone: '0500000001', contact2: 'جديد', phone2: '0500000009'}, 'approved: applied');
  // A third and a fourth through the request.
  answer = await send('rep1', await edit('c1', asFields([{name: 'علي', title: 'owner', phone: '0500000001'}, {name: 'جديد', phone: '0500000009'}, {name: 'ثالث', title: 'production', phone: '0500000010'}])));
  eq((await waiting('c1'))[0].fields, ['contacts'], 'the third: the list');
  await decide('sup', 'approve', answer.requestId); await decide('mgr', 'approve', answer.requestId);
  eq((await stored('c1')).data.contacts, [{name: 'ثالث', title: 'production', phone: '0500000010', email: ''}], 'approved: the third in data.contacts');
  // A colleague's customer: a request too; another region: not found.
  answer = await send('rep1', await edit('c2', asFields([{name: 'سامي', title: 'owner', phone: '0500000002'}])));
  eq([answer.pendingApproval, contacts((await stored('c2')).data).contacts.length], [true, 1], 'a colleague\'s customer: a request, nothing changed');
  await send('rep1', {action: 'customer-edit', decision: 'cancel', id: answer.requestId});
  eq((await send('rep1', await edit('cw', asFields([{name: 'x'}])), 404)).error, 'السجل غير موجود أو ليس لديك صلاحية', 'another region: not found');

  // ---- Customer service and a supervisor: through the request; the sales manager and the administrator: direct.
  answer = await send('cs', await edit('c2', {contactTitle2: 'purchasing'}));
  eq([answer.pendingApproval, answer.approvalStage, (await stored('c2')).data.contactTitle2], [true, 'sales_manager', undefined], 'customer service: a request to the sales manager');
  await send('cs', {action: 'customer-edit', decision: 'cancel', id: answer.requestId});
  answer = await send('sup', await edit('c2', {contactTitle2: 'purchasing'}));
  eq([answer.pendingApproval, answer.approvalStage], [true, 'sales_manager'], 'the supervisor: a request to the sales manager');
  await send('sup', {action: 'customer-edit', decision: 'cancel', id: answer.requestId});
  answer = await send('mgr', await edit('c2', asFields([{name: 'سامي', title: 'owner', phone: '0500000002'}, {name: '', phone: ''}, {name: 'هند', title: 'accountant', phone: '0500000004'}, {name: 'وليد', title: 'other', phone: '0500000005'}])));
  eq(contacts((await stored('c2')).data), {contact: 'سامي', contactTitle: 'owner', phone: '0500000002', contact2: 'هند', contactTitle2: 'accountant', phone2: '0500000004', contacts: [{name: 'وليد', title: 'other', phone: '0500000005', email: ''}]}, 'the sales manager: direct; the second deleted, the next takes its place');
  // A save without the contacts or the roles (a page of the release before): kept.
  await send('owner', await edit('c2', {notes: 'المدير'}, ['contacts', 'contactTitle', 'contactTitle2']));
  eq(contacts((await stored('c2')).data).contacts, [{name: 'وليد', title: 'other', phone: '0500000005', email: ''}], 'the administrator\'s save without them: the list kept');
  eq([(await stored('c2')).data.contactTitle, (await stored('c2')).data.contactTitle2], ['owner', 'accountant'], 'and the roles');
  // At an approval of a request sent by a page of the release before: kept too.
  answer = await send('rep2', await edit('c2', {phone: '0500000099'}, ['contacts', 'contactTitle', 'contactTitle2']));
  await decide('sup', 'approve', answer.requestId); await decide('mgr', 'approve', answer.requestId);
  eq(contacts((await stored('c2')).data), {contact: 'سامي', contactTitle: 'owner', phone: '0500000099', contact2: 'هند', contactTitle2: 'accountant', phone2: '0500000004', contacts: [{name: 'وليد', title: 'other', phone: '0500000005', email: ''}]}, 'an old page\'s request approved: the phone applied, the rest kept');

  // ---- A marketing officer: their branch's customer, direct, recorded with before and after.
  answer = await send('mkt', await edit('c1', {contactTitle: 'factory_manager'}));
  eq([answer.pendingApproval, (await stored('c1')).data.contactTitle], [undefined, 'factory_manager'], 'the marketing officer: direct');
  const direct = (await app.db.prepare("SELECT detail FROM crm_audit WHERE record_id='c1' AND action='customer-edit:direct' ORDER BY created_at DESC LIMIT 1").first()).detail;
  eq([JSON.parse(direct).fields, JSON.parse(direct).base], [['contactTitle'], {contactTitle: 'owner'}], 'with the field before and after');
  const history = (await page('mgr')).audits.find(entry => entry.recordId === 'c1' && entry.changes?.some(change => change.field === 'contactTitle'));
  eq(history?.changes?.map(change => [change.field, change.before, change.after]), [['contactTitle', 'owner', 'factory_manager']], 'the history reads it (the page shows the role\'s words)');

  // ---- Every reader of the customer reads them.
  for (const who of ['rep1', 'rep2', 'mkt', 'sup', 'mgr', 'owner']) eq((await page(who)).records.find(item => item.id === 'c2').data.contacts, [{name: 'وليد', title: 'other', phone: '0500000005', email: ''}], who + ' reads the others');

  console.log(JSON.stringify({ok: true, checks, scope: 'the customer\'s contacts on the built release: create online and queued, requests and approvals, direct saves by role, refusals, old clients', realBrowser: false}));
} finally {
  await app.stop();
}

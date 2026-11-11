// The CRM's customer list for the products application (lib/mold-customers-server.ts) over real HTTP against the BUILT release (run
// `pnpm build` first), sending to the stand-in production API (scripts/lib/products-mock.mjs): the first page load sends the whole list
// as `full` (Yourrest numbers, names, addresses, the cities as the production sheet writes them); a customer added through the CRM is
// sent shortly after; a deleted one is deactivated by the next full list; nothing is sent when nothing changed; the send is audited
// with counts and a fingerprint only; without the link settings nothing is sent and the CRM works. Since 2026-11-02: a changed name,
// address and city go with the next list; production down does not stop a save and the next send carries what changed meanwhile; the
// same list goes again after 24 hours and not before, across a restart; a customer deleted through the CRM goes at once as active:false.
// Since 2026-11-02 (second part): each customer carries its ERP code (`erpCode`, '' when none); a code changed by «استيراد من ERP» goes
// shortly after the apply, and a code removed in the CRM goes as ''; a deleted customer goes without it, so production keeps its code.
// Since 2026-11-09: a code «استيراد من ERP» clears (a customer the ERP file does not name, the box checked) goes as '' too, never left out.
// Synthetic fixtures only.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {createHash} from 'node:crypto';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {zipSync, strToU8} from 'fflate';
import {moldCustomerEntry} from '../portable/mold-rules.mjs';

const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'rep', role: 'rep', sup: 'sm', region: 'eastern'}];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const until = async (condition, what, ms = 25_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw new Error('timed out waiting for ' + what); };
const mock = await startProductsMock();
const app = await bootBuiltApp({members}, {env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const owner = app.as(await app.login('owner')), now = new Date().toISOString();
  const customer = (id, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind(id, JSON.stringify({branch: 'الرئيسي', assignedTo: 'rep', region: 'الشرقية', phone: '0551234567', ...data}), now, now).run();
  await customer('c1', {name: 'مصنع الدمام', city: 'الدمام', address: 'حي الصناعية', code: ' 146 '});
  await customer('c2', {name: 'مصنع جدة', city: 'جدة'});
  await customer('c3', {name: 'مصنع الخبر', city: 'الخبر'});
  const number = async id => (await app.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number;
  const sends = () => mock.state.calls.filter(call => call.route === 'customers');

  // ---- the first page load: the whole list, full
  check(sends().length, 0, 'nothing sent before the server is used');
  check((await owner('/api/crm')).status, 200, 'the page loads');
  await until(() => sends().length === 1, 'the first full list');
  const first = JSON.parse(sends()[0].body);
  check(first.mode, 'full', 'the whole list as full');
  check(first.customers, [
    {crmNumber: await number('c1'), name: 'مصنع الدمام', address: 'حي الصناعية', city: 'Damam - الدمام', erpCode: '146', active: true},
    {crmNumber: await number('c2'), name: 'مصنع جدة', city: 'Jeddah - جده', erpCode: '', active: true},
    {crmNumber: await number('c3'), name: 'مصنع الخبر', city: 'الخبر', erpCode: '', active: true},
  ], 'each customer by its Yourrest number, the sheet\'s cities as the sheet writes them, another city as it is, its ERP code (\'\' when none); no phone');
  check(mock.state.customers.get(await number('c1')).erpCode, '146', 'production holds the ERP code');
  ok(sends()[0].signed, 'signed with the shared secret');
  check(mock.state.customers.size, 3, 'production holds the three');
  const audit = async () => (await app.db.prepare("SELECT detail FROM crm_audit WHERE record_id='mold-customers' AND action='mold-customers:sync' ORDER BY created_at").all()).results.map(row => JSON.parse(row.detail));
  await until(async () => (await audit()).length === 1, 'the audit entry');
  const [entry] = await audit();
  check([entry.mode, entry.count, entry.sheetCities, entry.inserted, entry.deactivated, /^[a-f0-9]{64}$/.test(entry.hash)], ['full', 3, 2, 3, 0, true], 'audited: counts and a fingerprint');
  ok(!JSON.stringify(entry).includes('مصنع'), 'no customer names in the audit');

  // ---- unchanged: a page load sends nothing
  await owner('/api/crm');
  await new Promise(resolve => setTimeout(resolve, 6_500));
  check(sends().length, 1, 'nothing changed: nothing sent');

  // ---- a customer added through the CRM: sent shortly after
  const added = await (await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', data: {name: 'مصنع الرياض الجديد', city: 'الرياض', region: 'الشرقية', assignedTo: 'rep', branch: 'الرئيسي'}}})).json();
  ok(added.id, 'saved');
  await until(() => sends().length === 2, 'the list after the new customer');
  const second = JSON.parse(sends()[1].body);
  await until(async () => (await audit()).length === 2, 'the second audit entry');
  check([second.mode, second.customers.length, second.customers.find(item => item.name === 'مصنع الرياض الجديد')?.city], ['full', 4, 'Riyadh - الرياض'], 'the new customer goes with the whole list');

  // ---- a customer deleted: deactivated by the next full list (production deletes nobody)
  const gone = await number('c3');
  await app.db.prepare("DELETE FROM crm_records WHERE id='c3'").run();
  await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', data: {name: 'مصنع آخر', city: 'جازان', region: 'الشرقية', assignedTo: 'rep', branch: 'الرئيسي'}}});
  await until(() => sends().length === 3, 'the list after the deletion');
  check([mock.state.customers.get(gone).active, mock.state.customers.size], [false, 5], 'the deleted customer is deactivated there, not deleted');
  await until(async () => (await audit()).length === 3, 'the third audit entry');
  check((await audit()).at(-1).deactivated, 1, 'and the audit says so');


  // ---- a customer's name, address and city changed through the CRM: the next list carries them, production updates it
  const edit = async (id, change) => {
    const row = await app.db.prepare('SELECT version,data FROM crm_records WHERE id=?').bind(id).first();
    return owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id, version: row.version, data: {...JSON.parse(row.data), region: 'الشرقية', assignedTo: 'rep', branch: 'الرئيسي', ...change}}});
  };
  const n1 = await number('c1'), n2 = await number('c2');
  check((await edit('c1', {name: 'مصنع الدمام الجديد', city: 'الرياض'})).status, 200, 'the edit is saved');
  await until(() => sends().length === 4, 'the list after the edit');
  check(JSON.parse(sends()[3].body).customers.find(item => item.crmNumber === n1), {crmNumber: n1, name: 'مصنع الدمام الجديد', address: 'حي الصناعية', city: 'Riyadh - الرياض', erpCode: '146', active: true}, 'the new name and the new city, as the sheet writes it');
  await until(async () => (await audit()).length === 4, 'the fourth audit entry');
  check([mock.state.customers.get(n1).name, (await audit()).at(-1).updated], ['مصنع الدمام الجديد', 1], 'production updated that customer');

  // ---- production unreachable: the customer is saved all the same, no send is recorded, and the next send carries the change
  mock.state.down = true;
  check((await edit('c2', {name: 'مصنع جدة الكبير'})).status, 200, 'saved while production is down');
  await new Promise(resolve => setTimeout(resolve, 6_500));
  check([sends().length, (await audit()).length], [4, 4], 'nothing reached production, nothing recorded as sent');
  mock.state.down = false;
  check((await edit('c1', {address: 'المنطقة الصناعية الثانية'})).status, 200, 'another change once production is back');
  await until(() => sends().length === 5, 'the list once production is back');
  const after = JSON.parse(sends()[4].body).customers;
  check([after.find(item => item.crmNumber === n2).name, after.find(item => item.crmNumber === n1).address], ['مصنع جدة الكبير', 'المنطقة الصناعية الثانية'], 'the change made while it was down goes too');
  await until(async () => (await audit()).length === 5, 'the fifth audit entry');

  // ---- a customer deleted through the CRM: sent at once as active:false (the products contract), with its number and name
  await customer('c5', {name: 'مصنع هيتمسح', city: 'الرياض', address: 'حي النسيم', code: '٥٥٥'});
  const fifth = await number('c5'), sentBefore = sends().length;
  await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', data: {name: 'مصنع إضافي', city: 'جدة', region: 'الشرقية', assignedTo: 'rep', branch: 'الرئيسي'}}});
  await until(() => sends().length === sentBefore + 1, 'the list with the fifth customer');
  await until(async () => mock.state.customers.get(fifth)?.active === true, 'the fifth customer held by production');
  check(mock.state.customers.get(fifth).erpCode, '555', 'its ERP code in ASCII digits');
  const c5 = await app.db.prepare("SELECT version FROM crm_records WHERE id='c5'").first();
  check((await owner('/api/crm', {method: 'POST', body: {action: 'delete', kind: 'customer', id: 'c5', version: c5.version}})).status, 200, 'the customer is deleted through the CRM');
  await until(() => sends().slice(sentBefore + 1).some(call => JSON.parse(call.body).customers.some(item => item.crmNumber === fifth && item.active === false)), 'the deleted customer sent as active:false');
  const gone5 = JSON.parse(sends().findLast(call => JSON.parse(call.body).customers.some(item => item.crmNumber === fifth)).body).customers.find(item => item.crmNumber === fifth);
  check(gone5, {crmNumber: fifth, name: 'مصنع هيتمسح', address: 'حي النسيم', city: 'Riyadh - الرياض', active: false}, 'sent with its number, name, address and city, active:false, without erpCode');
  check([mock.state.customers.get(fifth).active, mock.state.customers.get(fifth).erpCode], [false, '555'], 'production holds it as inactive and keeps its ERP code');

  // ---- «استيراد من ERP» changes a customer's ERP code: the list goes shortly after the apply, with the new code
  const header = ['رقم العميل', 'رقم الهوية', 'الاسم بالعربي', 'الاسم بالانجليزي', 'رقم الجوال', 'رقم الهاتف', 'البريد الالكتروني', 'العنوان', 'التاريخ'];
  const cell = value => `<c t="inlineStr"><is><t>${String(value)}</t></is></c>`;
  const workbook = rows => Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Customer" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${[['Customer'], header, ...rows].map((cells, index) => `<row r="${index + 1}">${cells.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`),
  })).toString('base64');
  const file = workbook([['777', '1000000000', 'مصنع جدة الكبير', 'مصنع جدة الكبير', '', '', '', '', '2026/11/02']]);
  const preview = await (await owner('/api/erp-customers', {method: 'POST', body: {action: 'preview', fileName: 'Customer.xlsx', base64: file}})).json();
  check([preview.summary?.auto, preview.summary?.changes], [1, 1], 'the import matches the customer by its name and will change its code');
  const beforeImport = sends().length;
  const applied = await owner('/api/erp-customers', {method: 'POST', body: {action: 'apply', fileName: 'Customer.xlsx', base64: file, snapshot: preview.snapshot, requestId: crypto.randomUUID(), adds: 0}});
  check(applied.status, 200, 'the import is applied');
  await until(() => sends().length > beforeImport && JSON.parse(sends().at(-1).body).customers.some(item => item.crmNumber === n2 && item.erpCode === '777'), 'the list after the import', 15_000);
  check(mock.state.customers.get(n2).erpCode, '777', 'production holds the code the import wrote');

  // ---- the ERP code removed in the CRM: sent as '' so production clears it
  check((await edit('c1', {code: ''})).status, 200, 'the code is removed');
  await until(() => mock.state.customers.get(n1)?.erpCode === '', 'the list after the code was removed');
  check(JSON.parse(sends().at(-1).body).customers.find(item => item.crmNumber === n1).erpCode, '', 'sent as an empty ERP code');

  // ---- 2026-11-09: «امسح كود ERP للعملاء غير الموجودين في الشيت» clears the code of a customer the ERP file does not name; the list goes
  //  shortly after the apply with erpCode '' (never left out: production would keep the old code), so production clears it too
  const typed = await (await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', data: {name: 'مصنع مش في ERP', city: 'الرياض', region: 'الشرقية', assignedTo: 'rep', branch: 'الرئيسي', code: '333'}}})).json();
  ok(typed.id, 'a customer saved with a code the ERP does not have');
  const n3 = await number(typed.id);
  await until(() => mock.state.customers.get(n3)?.erpCode === '333', 'the list with the typed code');
  const clearPreview = await (await owner('/api/erp-customers', {method: 'POST', body: {action: 'preview', fileName: 'Customer.xlsx', base64: file}})).json();
  check(clearPreview.clears?.map(clear => [clear.customerId, clear.code]), [[typed.id, '333']], 'the preview lists the customer the file does not name, with its code');
  const beforeClear = sends().length;
  const cleared = await owner('/api/erp-customers', {method: 'POST', body: {action: 'apply', fileName: 'Customer.xlsx', base64: file, snapshot: clearPreview.snapshot, clearCodes: true, clearSnapshot: clearPreview.clearSnapshot, requestId: crypto.randomUUID(), adds: 0}});
  check([cleared.status, cleared.json().cleared], [200, 1], 'the apply clears it');
  await until(() => sends().length > beforeClear && mock.state.customers.get(n3)?.erpCode === '', 'the list after the code was cleared', 15_000);
  const clearedEntry = JSON.parse(sends().at(-1).body).customers.find(item => item.crmNumber === n3);
  check([Object.hasOwn(clearedEntry, 'erpCode'), clearedEntry.erpCode, mock.state.customers.get(n2).erpCode], [true, '', '777'], 'sent with erpCode \'\' (production clears it); the customer in the file keeps its code');
} finally { await app.stop(); }

// ---- the daily full list: a list unchanged for 24 hours goes again; one sent an hour ago does not (the fingerprint read after a restart)
const listSends = () => mock.state.calls.filter(call => call.route === 'customers');
for (const [hours, expected] of [[25, 1], [1, 0]]) {
  const fresh = await bootBuiltApp({members}, {env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
  try {
    const now = new Date().toISOString();
    for (const [id, data] of [['d1', {name: 'مصنع يومي', city: 'الدمام'}], ['d2', {name: 'مصنع آخر', address: 'حي'}]]) await fresh.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind(id, JSON.stringify(data), now, now).run();
    const rows = (await fresh.db.prepare("SELECT n.number,r.data FROM crm_records r JOIN crm_customer_numbers n ON n.customer_id=r.id WHERE r.kind='customer' ORDER BY n.number").all()).results;
    const list = rows.map(row => { const data = JSON.parse(row.data); return moldCustomerEntry({crmNumber: row.number, name: data.name, address: data.address, city: data.city, erpCode: data.code ?? ''}); });
    const hash = createHash('sha256').update(JSON.stringify(list)).digest('hex'), sentAt = new Date(Date.now() - hours * 3600_000).toISOString();
    await fresh.db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,'mold-customers','system','mold-customers:sync',?,?)").bind(crypto.randomUUID(), JSON.stringify({mode: 'full', count: list.length, hash}), sentAt).run();
    const before = listSends().length;
    check((await fresh.as(await fresh.login('owner'))('/api/crm')).status, 200, 'the page loads after a restart');
    if (expected) await until(() => listSends().length === before + 1, 'the daily list');
    else await new Promise(resolve => setTimeout(resolve, 6_500));
    check(listSends().length - before, expected, hours + ' hours after the last send of the same list: ' + (expected ? 'sent again, full' : 'nothing sent'));
    if (expected) check(JSON.parse(listSends().at(-1).body).mode, 'full', 'the daily send is the whole list');
  } finally { await fresh.stop(); }
}

// ---- without the link settings: nothing is sent, the CRM works
const plain = await bootBuiltApp({members}, {env: {NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const calls = mock.state.calls.length, owner = plain.as(await plain.login('owner'));
  check((await owner('/api/crm')).status, 200, 'the page loads');
  await new Promise(resolve => setTimeout(resolve, 6_500));
  check(mock.state.calls.length - calls, 0, 'nothing sent without the settings');
} finally { await plain.stop(); await mock.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, realProductionTested: false}));

// The CRM's customer list for the products application (lib/mold-customers-server.ts) over real HTTP against the BUILT release (run
// `pnpm build` first), sending to the stand-in production API (scripts/lib/products-mock.mjs): the first page load sends the whole list
// as `full` (Yourrest numbers, names, addresses, the cities as the production sheet writes them); a customer added through the CRM is
// sent shortly after; a deleted one is deactivated by the next full list; nothing is sent when nothing changed; the send is audited
// with counts and a fingerprint only; without the link settings nothing is sent and the CRM works. Synthetic fixtures only.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

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
  await customer('c1', {name: 'مصنع الدمام', city: 'الدمام', address: 'حي الصناعية'});
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
    {crmNumber: await number('c1'), name: 'مصنع الدمام', address: 'حي الصناعية', city: 'Damam - الدمام', active: true},
    {crmNumber: await number('c2'), name: 'مصنع جدة', city: 'Jeddah - جده', active: true},
    {crmNumber: await number('c3'), name: 'مصنع الخبر', city: 'الخبر', active: true},
  ], 'each customer by its Yourrest number, the sheet\'s cities as the sheet writes them, another city as it is; no phone');
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
  check([second.mode, second.customers.length, second.customers.find(item => item.name === 'مصنع الرياض الجديد')?.city], ['full', 4, 'Riyadh - الرياض'], 'the new customer goes with the whole list');

  // ---- a customer deleted: deactivated by the next full list (production deletes nobody)
  const gone = await number('c3');
  await app.db.prepare("DELETE FROM crm_records WHERE id='c3'").run();
  await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', data: {name: 'مصنع آخر', city: 'جازان', region: 'الشرقية', assignedTo: 'rep', branch: 'الرئيسي'}}});
  await until(() => sends().length === 3, 'the list after the deletion');
  check([mock.state.customers.get(gone).active, mock.state.customers.size], [false, 5], 'the deleted customer is deactivated there, not deleted');
  check((await audit()).at(-1).deactivated, 1, 'and the audit says so');
} finally { await app.stop(); }

// ---- without the link settings: nothing is sent, the CRM works
const plain = await bootBuiltApp({members}, {env: {NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const calls = mock.state.calls.length, owner = plain.as(await plain.login('owner'));
  check((await owner('/api/crm')).status, 200, 'the page loads');
  await new Promise(resolve => setTimeout(resolve, 6_500));
  check(mock.state.calls.length - calls, 0, 'nothing sent without the settings');
} finally { await plain.stop(); await mock.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, realProductionTested: false}));

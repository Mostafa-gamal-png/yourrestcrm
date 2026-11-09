// «لم يشترِ منذ 60 يومًا» over real HTTP against the BUILT release (run `pnpm build` first): GET /api/crm attaches data._lastPurchase
// (the latest ERP sale, never a return, of a code that maps to exactly that customer, and of its confirmed manual invoices) to the
// customers each reader may see, and nothing to the rest; a representative sees it on their own customers and never sees another region's
// customer; a save that sends the field back (as the page does with the row it loaded) stores nothing of it, the history entry does not
// mention it and the next GET still shows the computed date. Synthetic fixtures only: temporary SQLite, mocked sendmail.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager', region: 'central'}, {id: 'sup', role: 'supervisor', sup: 'sm', region: 'central'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب الوسطى'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'eastern', name: 'مندوب الشرقية'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const day = back => new Date(Date.parse(today + 'T00:00:00Z') - back * 86400000).toISOString().slice(0, 10);

const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString();
  const customer = (id, assignedTo, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({branch: 'الرئيسي', assignedTo, region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '', code: '', ...data}), now, now).run();
  await customer('recent', 'rep', {name: 'مصنع حديث الشراء', code: 'C-1'});
  await customer('old', 'rep', {name: 'مصنع قديم الشراء', code: 'C-2'});
  await customer('never', 'rep', {name: 'مصنع لم يشتر'});
  await customer('manual', 'rep', {name: 'مصنع فاتورة يدوية'});
  await customer('shareA', 'rep', {name: 'مصنع الكود المشترك أ', code: 'S-1'});
  await customer('shareB', 'sup', {name: 'مصنع الكود المشترك ب', code: 's-1'});
  await customer('returns', 'rep', {name: 'مصنع المرتجع', code: 'R-1'});
  await customer('east', 'rep2', {name: 'مصنع الشرقية', code: 'E-1', region: 'الشرقية', city: 'الدمام'});
  await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','f','sales.xml','{}',?)").bind(now).run();
  let n = 0;
  const erp = (code, date, type = 'sale', total = 10000, rep = 'rep') => app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','h',?,?,?,'e1',?,'الرئيسي','all',?,'n','{}',?,'imp','owner',?)")
    .bind('erp-' + (++n), 'doc-' + n, 'INV-' + n, type, date, rep, code, total, now).run();
  const manual = (customerId, date, status = 'confirmed') => app.db.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,'rep','الرئيسي',?,?,?,'{}',5000,?,1,?,'f','rep',?,?)")
    .bind('sale-' + (++n), customerId, date, 'M-' + n, 'm-' + n, status, 'mut-' + n, now, now).run();
  await erp('C-1', day(90)); await erp(' c-1', day(12)); await erp('C-1', day(2), 'return', -3000);
  await erp('C-2', day(61));
  await manual('manual', day(30)); await manual('manual', day(3), 'void');
  await erp('S-1', day(1));
  await erp('R-1', day(4), 'return', -2000);
  await erp('E-1', day(5), 'sale', 10000, 'rep2');
  const expected = {recent: day(12), old: day(61), manual: day(30), east: day(5)};

  const owner = app.as(await app.login('owner')), sm = app.as(await app.login('sm')), rep = app.as(await app.login('rep')), rep2 = app.as(await app.login('rep2'));
  const dates = async as => { const response = await as('/api/crm'); assert.equal(response.status, 200); return Object.fromEntries(response.json().records.filter(r => r.kind === 'customer').map(r => [r.id, r.data._lastPurchase ?? null])); };

  // ---- each reader: the customers they may see, each with its own last purchase
  const all = await dates(owner);
  check(all, {recent: expected.recent, old: expected.old, never: null, manual: expected.manual, shareA: null, shareB: null, returns: null, east: expected.east},
    'the administrator: the later of two ERP sales (a later return ignored), a manual invoice (a later void one ignored), none for a shared code, a return only or no sale');
  check(await dates(sm), {recent: expected.recent, old: expected.old, never: null, manual: expected.manual, shareA: null, shareB: null, returns: null}, 'the central sales manager: the same dates, no eastern customer');
  const own = await dates(rep);
  check(own, {recent: expected.recent, old: expected.old, never: null, manual: expected.manual, shareA: null, shareB: null, returns: null}, 'the representative: their region\'s customers with their dates (a shared code stays unique company-wide: none)');
  check(await dates(rep2), {east: expected.east}, 'the eastern representative: their own customer only');
  const raw = (await owner('/api/crm')).json().records.find(r => r.id === 'recent');
  check([typeof raw.data._lastPurchase, /^\d{4}-\d{2}-\d{2}$/.test(raw.data._lastPurchase)], ['string', true], 'a plain YYYY-MM-DD date');
  ok((await owner('/api/crm')).json().records.filter(r => r.kind !== 'customer').every(r => r.data._lastPurchase === undefined), 'no other kind of record carries it');

  // ---- a save never stores it
  const stored = async id => { const row = await app.db.prepare('SELECT data,version FROM crm_records WHERE id=?').bind(id).first(); return {data: JSON.parse(row.data), version: row.version}; };
  const loaded = (await rep('/api/crm')).json().records.find(r => r.id === 'recent');
  let response = await rep('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: 'recent', version: (await stored('recent')).version, data: {...loaded.data, notes: 'edited by the representative', _lastPurchase: '1999-01-01'}}});
  check(response.status, 200, 'the representative saves their customer with the loaded row\'s fields');
  let saved = await stored('recent');
  check([saved.data.notes, '_lastPurchase' in saved.data, saved.version], ['edited by the representative', false, 2], 'the record is saved without _lastPurchase');
  const before = await stored('old');
  response = await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: 'old', version: before.version, data: {...before.data, _lastPurchase: day(1), city: 'الخرج'}}});
  check(response.status, 200, 'the administrator saves another one');
  saved = await stored('old');
  check([saved.data.city, '_lastPurchase' in saved.data], ['الخرج', false], 'nothing of it is stored there either');
  const history = (await app.db.prepare("SELECT action,detail FROM crm_audit WHERE record_id IN ('recent','old') ORDER BY created_at").all()).results;
  check(history.map(entry => entry.action), ['تعديل', 'تعديل'], 'one history entry each');
  ok(history.every(entry => !entry.detail.includes('_lastPurchase') && !entry.detail.includes('1999-01-01')), 'that does not mention it');
  const after = await dates(owner);
  check([after.recent, after.old], [expected.recent, expected.old], 'the next GET shows the computed dates, not the ones sent');
  ok(!(await app.db.prepare("SELECT count(*) AS n FROM crm_records WHERE data LIKE '%_lastPurchase%'").first()).n, 'no stored record holds the field');

  // ---- a new purchase shows on the next load
  await manual('never', today);
  check((await dates(rep)).never, today, 'a manual invoice of today shows at once');
} finally { await app.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true}));

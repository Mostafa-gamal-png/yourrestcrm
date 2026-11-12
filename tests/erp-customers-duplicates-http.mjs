// «استيراد من ERP» resolves the customers that carry the same ERP code (the owner, 2026-11-12: «ده اخر تحديث للعملاء ومفيش حد ادى لعميلين
// نفس الكود»), over real HTTP against the BUILT release (run `npm run build` first). Before: the ERP quotations import lists 103, 104, 105
// and 106 among «أكواد مشتركة» (two customers carry each). A row of the ERP customers file that ends on one customer gives it the number
// alone: every OTHER current holder loses it in the same transaction (listed in the preview's `duplicates`, cleared whatever the «امسح»
// box says, audited {from, to: '', cleared: true, reason: 'duplicate'}); its name decides between holders, and a stored mapping to one of
// them is the choice; when nothing decides, the row is a choice and nobody is cleared until the importer picks; a stored mapping to a
// customer that loses the number is left in its table and decides nothing. A sales manager never clears a holder outside their regions
// (the row is «held-outside»; only the administrator with every region does it). After: «أكواد مشتركة» lists none of them, the
// reconciliation list shows each with one holder, the quotations go to the customer that keeps the number, and the customer form can
// neither give the number back nor type another (the ERP code is read-only). Synthetic fixtures only: temporary SQLite, never the owner's file.
import assert from 'node:assert/strict';
import {zipSync, strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {quotation, erpQuotesXls} from '../scripts/lib/erp-quotes-fixture.mjs';

const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager', region: 'central'}, {id: 'sup', role: 'supervisor', sup: 'sm', region: 'central'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'أحمد المندوب'}];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

const header = ['رقم العميل', 'رقم الهوية', 'الاسم بالعربي', 'الاسم بالانجليزي', 'رقم الجوال', 'رقم الهاتف', 'البريد الالكتروني', 'العنوان', 'التاريخ'];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cell = value => `<c t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
const row = (code, name) => [code, '1000000000', name, name, '', '', '', 'A B C D 1 2 3 4', '2026/11/01'];
const xlsx = rows => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Customer" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${[['Customer'], header, ...rows].map((cells, index) => `<row r="${index + 1}">${cells.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`),
})).toString('base64');
const LOCKED = 'كود ERP لا يُكتب ولا يُعدَّل يدويًا لأي مستخدم، ولا لمدير النظام؛ يُحدَّث من ملف عملاء ERP فقط («استيراد من ERP»).';
const DUPLICATE = 'مسح كود ERP: الكود يخص عميلًا آخر في ملف ERP';

const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString();
  const customer = (id, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', address: 'حي الصناعية', notes: 'keep', phone: '', phone2: '', ...data}), now, now).run();
  // Pairs that carry one code each, as hand edits and old data left them (made-up names).
  await customer('a103', {name: 'مصنع الأصل مئة وثلاثة', code: '103'});
  await customer('b103', {name: 'مصنع أخذ الرقم خطأ', code: '103'});
  await customer('a104', {name: 'مصنع أربعة الأول', code: '104'});
  await customer('b104', {name: 'مصنع أربعة الثاني', code: '104'});
  await customer('c105', {name: 'مصنع خمسة الوسطى', code: '105'});
  await customer('e105', {name: 'مصنع خمسة الشرقية', code: '105', region: 'الشرقية'});
  await customer('d106', {name: 'مصنع ستة الأول', code: '106'});
  await customer('e106', {name: 'مصنع ستة الثاني', code: '106'});
  // Stored mappings: 103 → the customer that will lose it (left, deciding nothing afterwards); 106 → e106 (the administrator's choice).
  for (const [code, id] of [['103', 'b103'], ['106', 'e106']]) await app.db.prepare("INSERT INTO crm_customer_code_mappings(code_key,customer_id,version,updated_by,updated_at) VALUES(?,?,1,'owner',?)").bind(code, id, now).run();
  const record = async id => { const raw = await app.db.prepare('SELECT data,version FROM crm_records WHERE id=?').bind(id).first(); return {data: JSON.parse(raw.data), version: raw.version}; };
  const codes = async ids => Promise.all(ids.map(async id => (await record(id)).data.code));
  const internal = async id => 'YR-C-' + String((await app.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number).padStart(6, '0');
  const owner = app.as(await app.login('owner')), sm = app.as(await app.login('sm')), rep = app.as(await app.login('rep'));
  const post = (as, body) => as('/api/erp-customers', {method: 'POST', body});
  const all = ['a103', 'b103', 'a104', 'b104', 'c105', 'e105', 'd106', 'e106'];

  // ---- the ERP quotations import before: four codes «مسجل لأكثر من عميل»
  const report = ['103', '104', '105', '106'].flatMap((code, index) => quotation({code: 'Qut-20' + index, customerCode: code, empCode: '7001', empName: 'أحمد المندوب', lines: [{name: 'قالب بلوك 20 سم', qty: 1, price: 18500, code: '10010001'}]}));
  const quotes = async () => (await owner('/api/erp-quotes', {method: 'POST', body: {action: 'preview', fileName: 'Reports_Invoices_dups.xls', base64: erpQuotesXls(report).toString('base64')}})).json();
  let shared = await quotes();
  check(shared.sharedCodes.codes.map(c => [c.codeKey, c.status]), [['103', 'mapped'], ['104', 'ambiguous'], ['105', 'ambiguous'], ['106', 'mapped']], 'before: four codes carried by two customers each');

  const file = xlsx([
    row('103', 'مصنع الأصل مئة وثلاثة'),   // 3: the name decides a103 (over the stored mapping to b103): b103 loses 103
    row('104', 'اسم في ERP لا يطابق أحدًا'), // 4: two holders, nothing decides: a choice, nobody cleared until chosen
    row('105', 'مصنع خمسة الوسطى'),        // 5: c105 by name; e105 (another region) loses 105: the administrator only
    row('106', 'اسم آخر للستة'),            // 6: two holders, the stored mapping picks e106: d106 loses 106
  ]);
  const preview = {action: 'preview', fileName: 'Customer.xlsx', base64: file};

  // ---- the sales manager: the outside holder of 105 makes that row the administrator's; the rest inside the regions
  let body = (await post(sm, preview)).json();
  check(body.rows.map(r => [r.row, r.status, r.customerId, r.sharedWith]), [[3, 'same', 'a103', 1], [4, 'choose', '', 0], [5, 'held-outside', '', 0], [6, 'same', 'e106', 1]], 'the manager\'s rows: 103 and 106 decided, 104 to choose, 105 held outside their regions');
  check(body.duplicates.map(d => [d.customerId, d.code, d.row, d.ownerId, d.region]), [['b103', '103', 3, 'a103', 'الوسطى'], ['d106', '106', 6, 'e106', 'الوسطى']], 'the customers that lose their code, with region; nobody for the row to choose or the row held outside');
  check([body.summary.duplicates, body.summary.changes, body.summary.heldOutside, body.summary.pending], [2, 0, 1, 1], 'the counts');
  ok(!JSON.stringify(body).includes('e105') && !JSON.stringify(body).includes('مصنع خمسة الشرقية'), 'nothing of the customer outside the manager\'s regions');
  check((await post(sm, {...preview, choices: [{row: 5, customerId: 'c105'}]})).status, 400, 'the manager cannot choose for the row held outside');
  check((await post(rep, preview)).status, 403, 'a representative: 403');
  // apply: no change of code and the «امسح» box not sent; the duplicates alone are applied
  let response = await post(sm, {action: 'apply', fileName: 'Customer.xlsx', base64: file, snapshot: body.snapshot, requestId: crypto.randomUUID(), adds: 0});
  check([response.status, response.json().duplicatesCleared, response.json().changed, response.json().cleared, response.json().heldOutside], [200, 2, 0, 0, 1], 'the manager applies: two duplicate holders cleared');
  check(await codes(all), ['103', '', '104', '104', '105', '105', '', '106'], 'b103 and d106 lost their code; 104 waits for a choice; 105 untouched');
  const audits = async ids => (await app.db.prepare(`SELECT record_id,actor,detail FROM crm_audit WHERE action='erp-customer-code' AND record_id IN (${ids.map(() => '?').join(',')}) ORDER BY record_id`).bind(...ids).all()).results.map(r => [r.record_id, r.actor, JSON.parse(r.detail)]);
  check(await audits(['b103', 'd106']), [
    ['b103', 'sm', {label: DUPLICATE, from: '103', to: '', cleared: true, reason: 'duplicate', row: 3, keptBy: 'a103'}],
    ['d106', 'sm', {label: DUPLICATE, from: '106', to: '', cleared: true, reason: 'duplicate', row: 6, keptBy: 'e106'}],
  ], 'one audit entry each, as a cleared code with its reason');
  check((await app.db.prepare('SELECT code_key,customer_id,version FROM crm_customer_code_mappings ORDER BY code_key').all()).results.map(r => ({...r})), [{code_key: '103', customer_id: 'b103', version: 1}, {code_key: '106', customer_id: 'e106', version: 1}], 'no mapping written or removed: the one to b103 stays and decides nothing now');

  // ---- the administrator: 104 needs a choice and nothing is cleared before it; then the choice and the outside holder of 105
  body = (await post(owner, preview)).json();
  check(body.rows.map(r => [r.row, r.status, r.customerId]), [[3, 'same', 'a103'], [4, 'choose', ''], [5, 'same', 'c105'], [6, 'same', 'e106']], 'the administrator\'s rows');
  check(body.rows[1].candidates.map(c => [c.id, c.matchedBy]), [['a104', 'code'], ['b104', 'code']], 'the two holders of 104 are offered by their code');
  check(body.duplicates.map(d => [d.customerId, d.code, d.ownerId, d.ownerName, d.internalCode]), [['e105', '105', 'c105', 'مصنع خمسة الوسطى', await internal('e105')]], 'only the outside holder of 105 for now (104 not chosen)');
  const chosen = (await post(owner, {...preview, choices: [{row: 4, customerId: 'b104'}]})).json();
  check([chosen.snapshot, chosen.duplicates.map(d => [d.customerId, d.code, d.ownerId])], [body.snapshot, [['a104', '104', 'b104'], ['e105', '105', 'c105']]], 'choosing b104 for 104 lists a104 as losing it (the snapshot does not depend on the choice)');
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: file, snapshot: body.snapshot, requestId: crypto.randomUUID(), choices: [{row: 4, customerId: 'b104'}], adds: 0});
  check([response.status, response.json().duplicatesCleared, response.json().cleared], [200, 2, 0], 'applied with the choice: two more cleared, the box not sent');
  check(await codes(all), ['103', '', '', '104', '105', '', '', '106'], 'each code is carried by one customer now');
  check((await audits(['a104', 'e105'])).map(([id, actor, detail]) => [id, actor, detail.reason, detail.from, detail.keptBy]), [['a104', 'owner', 'duplicate', '104', 'b104'], ['e105', 'owner', 'duplicate', '105', 'c105']], 'audited as duplicates by the administrator');
  check((await app.db.prepare("SELECT source_code FROM crm_customer_code_aliases WHERE customer_id='b103'").all()).results.map(r => r.source_code), ['103'], 'a cleared holder keeps the old code as history only');
  body = (await post(owner, preview)).json();
  check([body.duplicates, body.summary.changes, body.rows.map(r => r.status)], [[], 0, ['same', 'same', 'same', 'same']], 'the same file again: nothing left to clear or change');

  // ---- the ERP quotations import after: no shared code left; the quotations go to the customer that keeps each number
  shared = await quotes();
  check(shared.sharedCodes.codes, [], 'after: «أكواد مشتركة» lists none of 103, 104, 105, 106');
  check(shared.quotations.map(q => [q.code, q.status, q.customerName]), [['Qut-200', 'new', 'مصنع الأصل مئة وثلاثة'], ['Qut-201', 'new', 'مصنع أربعة الثاني'], ['Qut-202', 'new', 'مصنع خمسة الوسطى'], ['Qut-203', 'new', 'مصنع ستة الثاني']], 'each quotation under the customer that keeps its number');
  const identities = (await owner('/api/customer-identities')).json().identities;
  check(['103', '104', '105', '106'].map(code => { const i = identities.find(x => x.codeKey === code); return [code, i.customerIds, i.status]; }), [['103', ['a103'], 'unique'], ['104', ['b104'], 'unique'], ['105', ['c105'], 'unique'], ['106', ['e106'], 'mapped']], 'the reconciliation list: one holder each (the mapping to b103 no longer decides anything)');

  // ---- and the customer form cannot make a duplicate again, nor change a code: read-only for everyone
  const b103 = await record('b103');
  for (const [who, as] of [['owner', owner], ['sm', sm], ['rep', rep]]) {
    response = await as('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: 'b103', version: b103.version, data: {...b103.data, code: '103'}}});
    check([response.status, response.json().error], [403, LOCKED], who + ': the cleared code cannot be typed back');
  }
  const a103 = await record('a103');
  response = await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: 'a103', version: a103.version, data: {...a103.data, code: '103-X'}}});
  check([response.status, response.json().error, (await record('a103')).data.code], [403, LOCKED, '103'], 'the administrator cannot change a code either');
  response = await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: 'a103', version: a103.version, data: {...a103.data, notes: 'تعديل يحتفظ بالكود'}}});
  check([response.status, (await record('a103')).data.code, (await record('a103')).data.notes], [200, '103', 'تعديل يحتفظ بالكود'], 'a save that keeps the code is accepted');
} catch (error) {
  console.error(app.log().slice(-3000));
  throw error;
} finally { await app.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticWorkbook: true, ownerFileUsed: false}));

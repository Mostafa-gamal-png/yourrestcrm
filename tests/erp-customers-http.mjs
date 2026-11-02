// «استيراد من ERP» (POST /api/erp-customers, lib/erp-customers-server.ts) over real HTTP against the BUILT release (run `pnpm build`
// first): a synthetic ERP customer export built here; the preview's rows and counts and that it writes nothing; the apply in one step
// (only `data.code` changes, the old code stays as an alias, an explicit mapping where another customer holds the number, one audit
// entry per changed customer with no phone number, versions moved once); a repeated tap returns the saved answer and the same request
// with other choices is 409; a customer edited after the preview gives 409 and writes nothing; two rows on one customer are refused;
// the sales manager sees and changes only their regions' customers and never a number a customer outside them holds (by its code or by
// a stored mapping): the mapping stays as it was; a representative 403, anonymous 401, a foreign origin 403; a customer the import mapped
// can still be deleted, its mapping going with it.
// Synthetic fixtures only: temporary SQLite, mocked sendmail, never the owner's file.
import assert from 'node:assert/strict';
import {zipSync, strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager', region: 'central'}, {id: 'sup', role: 'supervisor', sup: 'sm', region: 'central'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'central'}];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

// The ERP export as the owner's file lays it out: sheet "Customer", a title cell on row 1, the header on row 2, customers from row 3.
const header = ['رقم العميل', 'رقم الهوية', 'الاسم بالعربي', 'الاسم بالانجليزي', 'رقم الجوال', 'رقم الهاتف', 'البريد الالكتروني', 'العنوان', 'التاريخ'];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cell = value => `<c t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
const row = (code, name, mobile = '', phone = '') => [code, '1000000000', name, name, mobile, phone, 'erp@example.invalid', 'A B C D 1 2 3 4', '2026/11/01'];
const xlsx = rows => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Customer" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${[['Customer'], header, ...rows].map((cells, index) => `<row r="${index + 1}">${cells.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`),
})).toString('base64');

const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString();
  const customer = (id, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', address: 'حي الصناعية', notes: 'keep', phone: '', phone2: '', code: '', ...data}), now, now).run();
  await customer('nour', {name: 'مصنع النور', phone: '0551234567', code: 'OLD-1'});
  await customer('fajr', {name: 'مصنع الفجر', phone2: '+966 50 123 4567'});
  await customer('holder', {name: 'مصنع قديم', code: '12'});
  await customer('twinA', {name: 'مصنع التوأم', code: 'T-1'});
  await customer('twinB', {name: 'مصنع التوأم'});
  await customer('badr', {name: 'مصنع البدر', phone: '0561234567', code: '33'});
  await customer('east', {name: 'مصنع الشرق', phone: '0531234567', region: 'الشرقية'});
  await customer('east2', {name: 'مصنع الشرق الثاني', code: '81', region: 'الشرقية'});
  const record = async id => { const raw = await app.db.prepare('SELECT data,version FROM crm_records WHERE id=?').bind(id).first(); return {data: JSON.parse(raw.data), version: raw.version}; };
  const ids = ['nour', 'fajr', 'holder', 'twinA', 'twinB', 'badr', 'east'], before = Object.fromEntries(await Promise.all(ids.map(async id => [id, await record(id)])));
  const internal = async id => (await app.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number;
  const count = async (sql, ...args) => (await app.db.prepare(sql).bind(...args).first()).n;
  const owner = app.as(await app.login('owner')), sm = app.as(await app.login('sm')), rep = app.as(await app.login('rep')), sup = app.as(await app.login('sup'));
  const post = (as, body, headers) => as('/api/erp-customers', {method: 'POST', body, headers});

  const file = xlsx([
    row('12', 'مصنع النور', '+966551234567'),           // 3: phone and name → nour; 12 is also holder's code → mapping
    row('44', 'مصنع الفجر', '', '0501234567'),          // 4: phone2 and name → fajr
    row('55', 'مصنع التوأم'),                             // 5: two customers with this name → choose
    row('66', 'مصنع الشرق', '0531234567'),              // 6: → east (another region for the manager)
    row('77', 'مصنع غير موجود', '0599999999'),           // 7: nobody → missing
    row('33', 'مصنع البدر', '٠٥٦١٢٣٤٥٦٧'),              // 8: Arabic digits → badr, which already has 33 → same
    row('', 'سطر بلا رقم'),                                // 9: no ERP number → invalid
  ]);

  // ---- who may call it
  const preview = {action: 'preview', fileName: 'Customer.xlsx', base64: file};
  let response = await app.as(null)('/api/erp-customers', {method: 'POST', body: preview});
  check([response.status, typeof response.json().error], [401, 'string'], 'anonymous: 401 with a message');
  for (const [as, who] of [[rep, 'a representative'], [sup, 'a supervisor']]) check((await post(as, preview)).status, 403, who + ': 403');
  check((await post(owner, preview, {Origin: 'https://evil.example'})).status, 403, 'a foreign origin: 403');
  check((await owner('/api/erp-customers')).status, 405, 'no GET');
  check((await post(owner, {...preview, base64: Buffer.from('not a workbook at all').toString('base64')})).status, 400, 'a file that is not XLSX: 400');
  response = await post(owner, {...preview, base64: xlsx([])});
  check(response.status, 400, 'a sheet with only the header: 400');
  ok(/عملاء/.test(response.json().error), 'with an Arabic message');

  // ---- the administrator's preview: every outcome, writes nothing
  response = await post(owner, preview);
  check([response.status, response.headers['cache-control']], [200, 'no-store'], 'preview: 200, no-store');
  let body = response.json();
  check([body.sheet, /^[a-f0-9]{64}$/.test(body.snapshot)], ['Customer', true], 'the sheet and a snapshot');
  check(body.rows.map(r => [r.row, r.code, r.status, r.customerId, r.matchedBy, r.change, r.mapping, r.sharedWith]), [
    [3, '12', 'auto', 'nour', 'both', true, true, 1],
    [4, '44', 'auto', 'fajr', 'both', true, false, 0],
    [5, '55', 'choose', '', '', false, false, 0],
    [6, '66', 'auto', 'east', 'both', true, false, 0],
    [7, '77', 'missing', '', '', false, false, 0],
    [8, '33', 'same', 'badr', 'both', false, false, 0],
    [9, '', 'invalid', '', '', false, false, 0],
  ], 'auto by phone and name, choose, missing, same, invalid');
  check(body.rows[2].candidates.map(c => c.id).sort(), ['twinA', 'twinB'], 'both customers of the same name are offered');
  check(body.rows[0].candidates[0], {id: 'nour', name: 'مصنع النور', internalCode: 'YR-C-' + String(await internal('nour')).padStart(6, '0'), code: 'OLD-1', region: 'الوسطى', phones: ['4567'], matchedBy: 'both'}, 'a candidate: name, Yourrest code, current ERP code, region, last 4 phone digits');
  check([body.rows[0].from, body.rows[0].to], ['OLD-1', '12'], 'before → after');
  check(body.rows[0].phones, ['4567'], 'the file\'s phones as their last 4 digits');
  ok(!/551234567|501234567|1000000000|erp@example/.test(response.text), 'no full phone, ID number or email in the preview');
  check(body.summary, {rows: 7, auto: 3, same: 1, choose: 1, missing: 1, outOfRegion: 0, heldOutside: 0, invalid: 1, conflicts: 0, pending: 1, changes: 3, codeChanges: 3, mappings: 1}, 'the counts');
  check([await count('SELECT count(*) AS n FROM crm_audit'), await count('SELECT count(*) AS n FROM crm_customer_code_mappings')], [0, 0], 'a preview writes nothing');
  for (const id of ids) check((await record(id)).version, 1, 'a preview changes no customer: ' + id);

  // ---- a choice for the ambiguous row, previewed again: the snapshot does not depend on the choices
  response = await post(owner, {...preview, choices: [{row: 5, customerId: 'twinB'}]});
  const chosen = response.json();
  check([chosen.snapshot, chosen.rows[2].customerId, chosen.rows[2].chosen, chosen.rows[2].change, chosen.summary.changes], [body.snapshot, 'twinB', true, true, 4], 'the chosen customer is planned');
  check((await post(owner, {...preview, choices: [{row: 5, customerId: 'east'}]})).status, 400, 'a customer that is not a candidate of that row: 400');

  // ---- two rows ending on one customer: both are a choice, the apply is refused
  const twice = xlsx([row('91', 'مصنع الفجر'), row('92', '', '0501234567')]);
  const conflict = (await post(owner, {...preview, base64: twice})).json();
  check(conflict.rows.map(r => [r.status, r.conflict, r.customerId]), [['choose', true, 'fajr'], ['choose', true, 'fajr']], 'two rows on one customer: both choose, conflict');
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: twice, snapshot: conflict.snapshot, requestId: crypto.randomUUID()});
  check(response.status, 400, 'applying with both on one customer is refused');
  ok(/أكثر من سطر/.test(response.json().error), 'and says why');
  const leaveOne = (await post(owner, {...preview, base64: twice, choices: [{row: 4, customerId: ''}]})).json();
  check([leaveOne.summary.conflicts, leaveOne.rows[0].status, leaveOne.rows[1].customerId], [0, 'auto', ''], 'leaving one row resolves it');

  // ---- apply: one transaction
  const requestId = crypto.randomUUID(), apply = {action: 'apply', fileName: 'Customer.xlsx', base64: file, snapshot: body.snapshot, requestId, choices: [{row: 5, customerId: 'twinB'}]};
  const revision = async () => (await app.db.prepare("SELECT revision FROM crm_customer_identity_state WHERE id='company'").first()).revision, revisionBefore = await revision();
  response = await post(owner, apply);
  check([response.status, response.headers['cache-control']], [200, 'no-store'], 'apply: 200, no-store');
  const result = response.json();
  check([result.ok, result.updated, result.mappings, result.changed, result.unchanged, result.skipped, result.missing, result.outOfRegion, result.heldOutside, result.invalid], [true, 4, 1, 4, 1, 0, 1, 0, 0, 1], 'the result counts');
  check(result.changes, [{row: 3, customerId: 'nour', from: 'OLD-1', to: '12', mapping: true}, {row: 4, customerId: 'fajr', from: '', to: '44', mapping: false}, {row: 5, customerId: 'twinB', from: '', to: '55', mapping: false}, {row: 6, customerId: 'east', from: '', to: '66', mapping: false}], 'before → after per changed customer');
  const after = Object.fromEntries(await Promise.all(ids.map(async id => [id, await record(id)])));
  check(ids.map(id => after[id].data.code), ['12', '44', '12', 'T-1', '55', '33', '66'], 'the ERP codes: changed for the matched customers, untouched for the others');
  for (const id of ids) {
    const withoutCode = data => Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'code'));
    check(withoutCode(after[id].data), withoutCode(before[id].data), 'nothing but the code changed in ' + id);
    check(after[id].version, ['nour', 'fajr', 'twinB', 'east'].includes(id) ? 2 : 1, 'version moved once for a changed customer only: ' + id);
  }
  check((await app.db.prepare("SELECT source_code FROM crm_customer_code_aliases WHERE customer_id='nour' ORDER BY source_code").all()).results.map(r => r.source_code), ['12', 'OLD-1'], 'the old code stays as an alias, so old invoices still find the customer');
  check((await app.db.prepare('SELECT code_key,customer_id,version FROM crm_customer_code_mappings').all()).results.map(r => ({...r})), [{code_key: '12', customer_id: 'nour', version: 1}], 'the shared number is mapped to the matched customer; the other holder keeps its code');
  ok(await revision() > revisionBefore, 'the identity revision moved');
  const audits = (await app.db.prepare("SELECT record_id,action,detail FROM crm_audit WHERE action='erp-customer-code' ORDER BY record_id").all()).results;
  check(audits.map(a => [a.record_id, JSON.parse(a.detail)]), [
    ['east', {label: 'تحديث كود ERP من ملف ERP', from: '', to: '66', row: 6}],
    ['fajr', {label: 'تحديث كود ERP من ملف ERP', from: '', to: '44', row: 4}],
    ['nour', {label: 'تحديث كود ERP من ملف ERP', from: 'OLD-1', to: '12', row: 3, mapping: true}],
    ['twinB', {label: 'تحديث كود ERP من ملف ERP', from: '', to: '55', row: 5}],
  ], 'one audit entry per changed customer');
  ok(!(await app.db.prepare('SELECT detail FROM crm_audit').all()).results.some(r => /\d{9}/.test(r.detail.replace(/[a-f0-9]{64}/g, ''))), 'no phone number in any audit detail');
  const listed = (await (await owner('/api/crm')).json()).records.filter(r => r.kind === 'customer');
  check(listed.find(r => r.id === 'nour').data.code, '12', 'the customers list shows the new code');

  // ---- the same tap again: the saved answer; the same request with other choices: 409
  const auditCount = await count('SELECT count(*) AS n FROM crm_audit');
  response = await post(owner, apply);
  check([response.status, response.json().alreadySaved, response.json().updated, response.json().changes], [200, true, 4, result.changes], 'a repeated tap returns the saved answer');
  check(await count('SELECT count(*) AS n FROM crm_audit'), auditCount, 'and writes nothing');
  check((await post(owner, {...apply, choices: [{row: 5, customerId: ''}]})).status, 409, 'the same request with other choices: 409');
  check((await post(owner, {...apply, requestId: crypto.randomUUID()})).status, 409, 'a new request on the old preview (the data changed since): 409');
  check((await post(owner, preview)).json().summary.changes, 0, 'previewing the same file again: nothing left to change');

  // ---- a customer edited after the preview: 409, nothing written
  const second = xlsx([row('88', 'مصنع الفجر'), row('89', 'مصنع البدر')]);
  const fresh = (await post(owner, {...preview, base64: second})).json();
  check(fresh.summary.changes, 2, 'two changes to make');
  const edited = await record('fajr');
  response = await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: 'fajr', version: edited.version, data: {...edited.data, notes: 'edited after the preview'}}});
  check(response.status, 200, 'the customer is edited through the CRM');
  const auditsBefore = await count('SELECT count(*) AS n FROM crm_audit');
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: second, snapshot: fresh.snapshot, requestId: crypto.randomUUID()});
  check([response.status, response.json().error], [409, 'اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة'], 'a stale preview: 409 with the message');
  check([(await record('fajr')).data.code, (await record('badr')).data.code, await count('SELECT count(*) AS n FROM crm_audit')], ['44', '33', auditsBefore], 'nothing was written');

  // ---- the sales manager: their regions only, and never a number a customer outside them holds
  // 66 is east's code (Eastern region) and the administrator mapped it to east; 81 is east2's code (Eastern), with no mapping.
  await app.db.prepare("INSERT INTO crm_customer_code_mappings(code_key,customer_id,version,updated_by,updated_at) VALUES('66','east',1,'owner',?)").bind(now).run();
  const mappings = async () => (await app.db.prepare('SELECT code_key,customer_id,version,updated_by FROM crm_customer_code_mappings ORDER BY code_key').all()).results.map(r => ({...r}));
  const mappingsBefore = await mappings();
  const regional = xlsx([row('71', 'مصنع الشرق', '0531234567'), row('72', 'مصنع الفجر'), row('66', 'مصنع النور'), row('81', 'مصنع البدر')]);
  response = await post(sm, {...preview, base64: regional});
  check(response.status, 200, 'the sales manager previews');
  body = response.json();
  check(body.rows.map(r => [r.status, r.candidates.length, r.customerId, r.mapping, r.sharedWith]), [['out-of-region', 0, '', false, 0], ['auto', 1, 'fajr', false, 0], ['held-outside', 0, '', false, 0], ['held-outside', 0, '', false, 0]], 'a customer outside their regions reads «outside your regions» with no candidate; a number held outside them (mapped there, or another customer\'s code) is left for the administrator, with no detail');
  ok(!response.text.includes('"east"') && !response.text.includes('east2') && !response.text.includes('YR-C-' + String(await internal('east')).padStart(6, '0')) && !response.text.includes('YR-C-' + String(await internal('east2')).padStart(6, '0')), 'no detail of the out-of-region customers');
  check([body.summary.outOfRegion, body.summary.heldOutside, body.summary.changes, body.summary.mappings], [1, 2, 1, 0], 'counted, and only the in-region change is planned');
  check((await post(sm, {...preview, base64: regional, choices: [{row: 3, customerId: 'east'}]})).status, 400, 'an out-of-region row takes no choice');
  check((await post(sm, {...preview, base64: regional, choices: [{row: 5, customerId: 'nour'}]})).status, 400, 'a held-outside row takes no choice either');
  response = await post(sm, {action: 'apply', fileName: 'Customer.xlsx', base64: regional, snapshot: body.snapshot, requestId: crypto.randomUUID()});
  check([response.status, response.json().updated, response.json().mappings, response.json().outOfRegion, response.json().heldOutside], [200, 1, 0, 1, 2], 'the manager applies');
  check([(await record('east')).data.code, (await record('fajr')).data.code, (await record('nour')).data.code, (await record('badr')).data.code, (await record('east2')).data.code], ['66', '72', '12', '33', '81'], 'only the in-region customer changed; the numbers held outside the regions changed nobody');
  check(await mappings(), mappingsBefore, 'the stored mappings are as they were (the administrator\'s 66 → east included)');
  // The same file by the administrator links them: their invoices are the administrator's to move.
  const ownerView = (await post(owner, {...preview, base64: regional})).json();
  check(ownerView.rows.slice(2).map(r => [r.status, r.customerId, r.mapping]), [['auto', 'nour', true], ['auto', 'badr', true]], 'the system administrator sees them as ordinary links');
  check((await post(rep, {action: 'apply', fileName: 'Customer.xlsx', base64: regional, snapshot: body.snapshot, requestId: crypto.randomUUID()})).status, 403, 'a representative cannot apply either');

  // ---- a customer the import mapped can still be deleted; its mapping goes with it, in the delete's audit entry
  const nourNow = await record('nour');
  response = await owner('/api/crm', {method: 'POST', body: {action: 'delete', kind: 'customer', id: 'nour', version: nourNow.version}});
  check(response.status, 200, 'the mapped customer is deleted');
  check([await count("SELECT count(*) AS n FROM crm_records WHERE id='nour'"), (await mappings()).map(m => m.code_key)], [0, ['66']], 'the customer and its mapping are gone; the other mapping stays');
  const deletion = JSON.parse((await app.db.prepare("SELECT detail FROM crm_audit WHERE record_id='nour' AND action='حذف'").first()).detail);
  check([deletion.kind, deletion.codeMappings], ['customer', ['12']], 'the removed mapping is in the delete\'s audit entry');
  check((await post(owner, {...preview, base64: xlsx([row('12', 'مصنع قديم')])})).json().rows.map(r => [r.status, r.customerId]), [['same', 'holder']], 'the number is the remaining holder\'s again');
} finally { await app.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticWorkbook: true, ownerFileUsed: false}));

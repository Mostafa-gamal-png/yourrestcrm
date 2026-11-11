// «استيراد من ERP» (POST /api/erp-customers, lib/erp-customers-server.ts) over real HTTP against the BUILT release (run `pnpm build`
// first): a synthetic ERP customer export built here; the preview's rows and counts and that it writes nothing; the apply in one step
// (only `data.code` changes, the old code stays as an alias, an explicit mapping where another customer holds the number, one audit
// entry per changed customer with no phone number, versions moved once); a repeated tap returns the saved answer and the same request
// with other choices is 409; a customer edited after the preview gives 409 and writes nothing; two rows on one customer are refused;
// the sales manager sees and changes only their regions' customers and never a number a customer outside them holds (by its code or by
// a stored mapping): the mapping stays as it was; a representative 403, anonymous 401, a foreign origin 403; a customer the import mapped
// can still be deleted, its mapping going with it. New customers (2026-11-03): a row the CRM does not have is added in the same
// transaction (its Yourrest number from the trigger, the uploader responsible, their branch, the chosen region, the file's name, code,
// phones, email and address only, an «إضافة» history entry); a repeated request adds nobody twice; a region outside the user's scope is
// refused (400 / 403) and the sales manager adds only in their region; a similar name left alone adds nothing, «هو نفسه» gives that
// customer the code, «عميل جديد» adds; a code that became held between the preview and the apply refuses with 409; the same file
// again after «هو نفسه» (the old code kept) has no conflict; a similar name only outside the manager's regions is out-of-region, not added.
// Additions are opt-in: the apply carries `adds` (the number the preview showed). An apply without it (a screen loaded before the deploy,
// which said rows without a match are left alone and cannot read this release's answer) is refused with 409 and a reload message in
// Arabic and English, code-only applies too; one with another number is refused with 409; neither writes anything.
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
const row = (code, name, mobile = '', phone = '', email = 'erp@example.invalid') => [code, '1000000000', name, name, mobile, phone, email, 'A B C D 1 2 3 4', '2026/11/01'];
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
    row('77', 'مصنع غير موجود', '0599999999'),           // 7: nobody, no similar name, 77 held by nobody → new (added)
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
  check(body.rows.map(r => [r.row, r.code, r.status, r.customerId, r.matchedBy, r.change, r.mapping, r.sharedWith, r.add]), [
    [3, '12', 'auto', 'nour', 'both', true, true, 1, false],
    [4, '44', 'auto', 'fajr', 'both', true, false, 0, false],
    [5, '55', 'choose', '', '', false, false, 0, false],
    [6, '66', 'auto', 'east', 'both', true, false, 0, false],
    [7, '77', 'new', '', '', false, false, 0, true],
    [8, '33', 'same', 'badr', 'both', false, false, 0, false],
    [9, '', 'invalid', '', '', false, false, 0, false],
  ], 'auto by phone and name, choose, new, same, invalid');
  check([body.newRegions, body.newRegion], [['', 'الوسطى', 'الشرقية', 'الغربية', 'الشمالية', 'الجنوبية'], ''], 'the regions the administrator may give new customers, «المنطقة غير محددة» by default');
  check(body.rows[2].candidates.map(c => c.id).sort(), ['twinA', 'twinB'], 'both customers of the same name are offered');
  check(body.rows[0].candidates[0], {id: 'nour', name: 'مصنع النور', internalCode: 'YR-C-' + String(await internal('nour')).padStart(6, '0'), code: 'OLD-1', region: 'الوسطى', phones: ['4567'], matchedBy: 'both'}, 'a candidate: name, Yourrest code, current ERP code, region, last 4 phone digits');
  check([body.rows[0].from, body.rows[0].to], ['OLD-1', '12'], 'before → after');
  check(body.rows[0].phones, ['4567'], 'the file\'s phones as their last 4 digits');
  ok(!/551234567|501234567|1000000000|erp@example/.test(response.text), 'no full phone, ID number or email in the preview');
  check(body.summary, {rows: 7, auto: 3, same: 1, choose: 1, similar: 0, new: 1, outOfRegion: 0, heldOutside: 0, invalid: 1, conflicts: 0, pending: 1, changes: 3, codeChanges: 3, mappings: 1, adds: 1}, 'the counts');
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
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: twice, snapshot: conflict.snapshot, requestId: crypto.randomUUID(), adds: 0});
  check(response.status, 400, 'applying with both on one customer is refused');
  ok(/أكثر من سطر/.test(response.json().error), 'and says why');
  const leaveOne = (await post(owner, {...preview, base64: twice, choices: [{row: 4, customerId: ''}]})).json();
  check([leaveOne.summary.conflicts, leaveOne.rows[0].status, leaveOne.rows[1].customerId], [0, 'auto', ''], 'leaving one row resolves it');

  // ---- an apply without `adds` (a screen loaded before the deploy) or with another number than the file adds: 409 asking for a reload
  //  and a new preview, nothing written
  const ADDS_UNCONFIRMED = 'لم تعرض هذه الشاشة العملاء الجدد الذين سيُضافون؛ حدّث الصفحة وأجرِ معاينة جديدة';
  const SCREEN_OUTDATED = 'فُتحت شاشة الاستيراد هذه قبل تحديث النظام؛ حدّث الصفحة وأجرِ معاينة جديدة. لم يُحفظ أي شيء. / This import screen was opened before the system update. Reload the page and run a new preview. Nothing was saved.';
  const unconfirmedBefore = [await count("SELECT count(*) AS n FROM crm_records WHERE kind='customer'"), await count('SELECT count(*) AS n FROM crm_audit'), await count('SELECT count(*) AS n FROM crm_customer_code_mappings')];
  const oldScreen = {action: 'apply', fileName: 'Customer.xlsx', base64: file, snapshot: body.snapshot, choices: [{row: 5, customerId: 'twinB'}]};
  for (const [extra, message, label] of [[{}, SCREEN_OUTDATED, 'no adds (the screen before the deploy)'], [{adds: 0}, ADDS_UNCONFIRMED, 'adds 0'], [{adds: 2}, ADDS_UNCONFIRMED, 'another number']]) {
    response = await post(owner, {...oldScreen, requestId: crypto.randomUUID(), ...extra});
    check([response.status, response.json().error], [409, message], label + ' while the file adds a customer: 409 asking for a reload');
  }
  check([await count("SELECT count(*) AS n FROM crm_records WHERE kind='customer'"), await count('SELECT count(*) AS n FROM crm_audit'), await count('SELECT count(*) AS n FROM crm_customer_code_mappings')], unconfirmedBefore, 'nobody added, no code changed, no receipt');
  for (const id of ids) check((await record(id)).version, 1, 'no customer changed by the refused applies: ' + id);

  // ---- apply: one transaction (the new screen sends the number of new customers its preview showed)
  const requestId = crypto.randomUUID(), apply = {action: 'apply', fileName: 'Customer.xlsx', base64: file, snapshot: body.snapshot, requestId, choices: [{row: 5, customerId: 'twinB'}], region: 'الوسطى', adds: 1};
  const customersBefore = await count("SELECT count(*) AS n FROM crm_records WHERE kind='customer'");
  const revision = async () => (await app.db.prepare("SELECT revision FROM crm_customer_identity_state WHERE id='company'").first()).revision, revisionBefore = await revision();
  response = await post(owner, apply);
  check([response.status, response.headers['cache-control']], [200, 'no-store'], 'apply: 200, no-store');
  const result = response.json();
  check([result.ok, result.updated, result.mappings, result.changed, result.added, result.unchanged, result.skipped, result.outOfRegion, result.heldOutside, result.invalid], [true, 4, 1, 4, 1, 1, 0, 0, 0, 1], 'the result counts');
  // ---- the new customer: one record in the same transaction, as the form makes one
  const addedId = 'crm-owner-erp-' + requestId + '-7';
  check(result.additions, [{row: 7, customerId: addedId, code: '77', name: 'مصنع غير موجود', region: 'الوسطى', internalCode: 'YR-C-' + String(await internal(addedId)).padStart(6, '0')}], 'what was added, with the Yourrest number the trigger gave it');
  check(await count("SELECT count(*) AS n FROM crm_records WHERE kind='customer'"), customersBefore + 1, 'one customer added');
  const added = await app.db.prepare('SELECT kind,parent_id,assigned_to,branch,data,version,mutation_id FROM crm_records WHERE id=?').bind(addedId).first(), addedData = JSON.parse(added.data);
  check([added.kind, added.parent_id, added.assigned_to, added.branch, added.version, /^erp-customers-import:/.test(added.mutation_id)], ['customer', null, 'owner', 'الرئيسي', 1, true], 'responsible: the uploader, in their branch; version 1, the import\'s mutation');
  check([addedData.name, addedData.code, addedData.phone, addedData.phone2, addedData.email, addedData.address, addedData.region, addedData.branch, addedData.assignedTo, addedData._createdBy, addedData.city, addedData.contact, addedData.latitude, addedData.longitude], ['مصنع غير موجود', '77', '0599999999', '', 'erp@example.invalid', 'A B C D 1 2 3 4', 'الوسطى', 'الرئيسي', 'owner', 'owner', '', '', null, null], 'the data: the file\'s name, code, phones, email and address, the chosen region, as the form stores them');
  ok(!added.data.includes('1000000000') && !added.data.includes('2026/11/01') && !('sourceFile' in addedData), 'nothing else from the file: no ID number, no date');
  check((await app.db.prepare('SELECT source_code FROM crm_customer_code_aliases WHERE customer_id=?').bind(addedId).all()).results.map(r => r.source_code), ['77'], 'its ERP code is known to the identity tables');
  const addAudit = (await app.db.prepare("SELECT actor,action,detail FROM crm_audit WHERE record_id=?").bind(addedId).all()).results.map(r => ({...r}));
  check(addAudit, [{actor: 'owner', action: 'إضافة', detail: 'مصنع غير موجود • إضافة عميل من ملف ERP'}], 'one «إضافة» history entry: the name, then the import label');
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
  ok(!(await app.db.prepare('SELECT detail FROM crm_audit').all()).results.some(r => /\d{9}/.test(r.detail.replace(/[a-f0-9]{64}/g, '').replace(/[a-f0-9-]{36}/g, ''))), 'no phone number in any audit detail');
  const crm = await (await owner('/api/crm')).json(), listed = crm.records.filter(r => r.kind === 'customer');
  check(listed.find(r => r.id === 'nour').data.code, '12', 'the customers list shows the new code');
  check([listed.find(r => r.id === addedId)?.data.internalCode, listed.find(r => r.id === addedId)?.data.code], [result.additions[0].internalCode, '77'], 'and the new customer with its Yourrest number and ERP code');
  check(crm.audits.filter(a => a.recordId === addedId).map(a => [a.action, a.detail]), [['إضافة', 'مصنع غير موجود • إضافة عميل من ملف ERP']], 'its history reads «إضافة · name • إضافة عميل من ملف ERP»');

  // ---- the same tap again: the saved answer; the same request with other choices: 409
  const auditCount = await count('SELECT count(*) AS n FROM crm_audit');
  response = await post(owner, apply);
  check([response.status, response.json().alreadySaved, response.json().updated, response.json().changes, response.json().added, response.json().additions], [200, true, 4, result.changes, 1, result.additions], 'a repeated tap returns the saved answer');
  check([await count('SELECT count(*) AS n FROM crm_audit'), await count("SELECT count(*) AS n FROM crm_records WHERE kind='customer'")], [auditCount, customersBefore + 1], 'and writes nothing: nobody added twice');
  check((await post(owner, {...apply, choices: [{row: 5, customerId: ''}]})).status, 409, 'the same request with other choices: 409');
  check((await post(owner, {...apply, requestId: crypto.randomUUID()})).status, 409, 'a new request on the old preview (the data changed since): 409');
  const again = (await post(owner, preview)).json();
  check([again.summary.changes, again.summary.adds, again.rows[4].status, again.rows[4].customerId], [0, 0, 'same', addedId], 'previewing the same file again: nothing left to change or add (the added customer is found by its phone and name)');

  // ---- a customer edited after the preview: 409, nothing written
  const second = xlsx([row('88', 'مصنع الفجر'), row('89', 'مصنع البدر')]);
  const fresh = (await post(owner, {...preview, base64: second})).json();
  check(fresh.summary.changes, 2, 'two changes to make');
  const edited = await record('fajr');
  response = await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: 'fajr', version: edited.version, data: {...edited.data, notes: 'edited after the preview'}}});
  check(response.status, 200, 'the customer is edited through the CRM');
  const auditsBefore = await count('SELECT count(*) AS n FROM crm_audit');
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: second, snapshot: fresh.snapshot, requestId: crypto.randomUUID(), adds: 0});
  check([response.status, response.json().error], [409, 'تغيّرت بيانات العملاء منذ المعاينة؛ أجرِ معاينة جديدة'], 'a stale preview: 409 with the message');
  check([(await record('fajr')).data.code, (await record('badr')).data.code, await count('SELECT count(*) AS n FROM crm_audit')], ['44', '33', auditsBefore], 'nothing was written');

  // ---- similar names: left alone adds nothing; «هو نفسه» gives that customer the code; «عميل جديد» adds
  await customer('safa', {name: 'مصنع الصفا للبلوك الاسمنتي', phone: '0551110000', code: '345'});
  const simFile = xlsx([row('9001', 'مصنع الصفا للبلوك الحديث', '0598887777'), row('9002', 'مصنع جديد كليا', '0598886666', '', 'not an email')]);
  let sim = (await post(owner, {...preview, base64: simFile})).json();
  check(sim.rows.map(r => [r.row, r.status, r.customerId, r.add, r.chosen, r.candidates.map(c => [c.id, c.matchedBy, c.code])]), [[3, 'similar', '', false, false, [['safa', 'similar', '345']]], [4, 'new', '', true, false, []]], 'a similar name is offered with nothing chosen; a name like nobody\'s is new');
  check([sim.summary.similar, sim.summary.new, sim.summary.adds, sim.summary.pending, sim.summary.changes], [1, 1, 1, 1, 0], 'the counts');
  let simId = crypto.randomUUID();
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: simFile, snapshot: sim.snapshot, requestId: simId, adds: 1});
  check([response.status, response.json().added, response.json().changed, response.json().skipped], [200, 1, 0, 1], 'the similar row left alone: only the new one is added');
  check([(await record('safa')).data.code, await count("SELECT count(*) AS n FROM crm_records WHERE json_extract(data,'$.name')='مصنع الصفا للبلوك الحديث'"), JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind('crm-owner-erp-' + simId + '-4').first()).data).email], ['345', 0, ''], 'the similar customer kept its code, nobody was added for that row, and an invalid email is not stored');
  check(JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind('crm-owner-erp-' + simId + '-4').first()).data).region, '', 'with no region chosen: «المنطقة غير محددة»');
  const thisOne = xlsx([row('9003', 'مصنع الصفا للبلوك الحديث')]);
  sim = (await post(owner, {...preview, base64: thisOne, choices: [{row: 3, customerId: 'safa'}]})).json();
  check([sim.rows[0].status, sim.rows[0].customerId, sim.rows[0].change, sim.summary.changes, sim.summary.adds], ['similar', 'safa', true, 1, 0], '«هو نفسه» previewed: that customer takes the code');
  check((await post(owner, {...preview, base64: thisOne, choices: [{row: 3, customerId: 'nour'}]})).status, 400, 'a customer that is not a similar candidate: 400');
  check((await post(owner, {...preview, base64: thisOne, choices: [{row: 3, customerId: 'crm-owner-erp-x'}]})).status, 400, 'nor a made-up id');
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: thisOne, snapshot: sim.snapshot, requestId: crypto.randomUUID(), choices: [{row: 3, customerId: 'safa'}], adds: 0});
  check([response.status, response.json().changed, response.json().added, response.json().changes], [200, 1, 0, [{row: 3, customerId: 'safa', from: '345', to: '9003', mapping: false}]], '«هو نفسه» applied');
  check([(await record('safa')).data.code, (await app.db.prepare("SELECT action FROM crm_audit WHERE record_id='safa'").first()).action], ['9003', 'erp-customer-code'], 'the code changed, with its history entry');
  const asNew = xlsx([row('9004', 'مصنع الصفا للبلوك الجديد', '0598885555')]);
  sim = (await post(owner, {...preview, base64: asNew})).json();
  check([sim.rows[0].status, sim.rows[0].candidates.map(c => c.id)], ['similar', ['safa']], 'another similar row');
  check((await post(owner, {...preview, base64: thisOne, choices: [{row: 3, customerId: '+new'}]})).status, 400, '«عميل جديد» on the row now found by its code: 400');
  check((await post(owner, {...preview, base64: file, choices: [{row: 3, customerId: '+new'}]})).status, 400, '«عميل جديد» on a row the CRM has: 400');
  simId = crypto.randomUUID();
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: asNew, snapshot: sim.snapshot, requestId: crypto.randomUUID(), choices: [{row: 3, customerId: '+new'}], region: 'الغربية'});
  check([response.status, response.json().error], [409, SCREEN_OUTDATED], '«عميل جديد» without adds: 409, nobody added');
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: asNew, snapshot: sim.snapshot, requestId: simId, choices: [{row: 3, customerId: '+new'}], region: 'الغربية', adds: 1});
  check([response.status, response.json().added, response.json().changed, response.json().additions.map(a => [a.customerId, a.code, a.region])], [200, 1, 0, [['crm-owner-erp-' + simId + '-3', '9004', 'الغربية']]], '«عميل جديد» applied: added');
  check((await record('safa')).data.code, '9003', 'and the similar customer is untouched');
  // The same kind of file again after «هو نفسه»: safa's code is 9003 and 345 a kept old code. Row 345 (another customer) finds safa only by
  // that old code and safa's current code is another row of the file: a choice, not a second row on safa, so nothing conflicts and the
  // new customer in the file can still be added.
  const reimport = xlsx([row('345', 'اسم تاني خالص'), row('9003', 'مصنع الصفا للبلوك الحديث'), row('9006', 'مصنع المرجان')]);
  sim = (await post(owner, {...preview, base64: reimport})).json();
  check(sim.rows.map(r => [r.row, r.status, r.customerId, r.codeRow, r.conflict]), [[3, 'choose', '', 4, false], [4, 'same', 'safa', 0, false], [5, 'new', '', 0, false]], 're-imported: the old code is a choice pointing at the row with safa\'s current code, which is the same');
  check([sim.summary.conflicts, sim.summary.adds, sim.summary.changes], [0, 1, 0], 'no conflict, one customer to add');
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: reimport, snapshot: sim.snapshot, requestId: crypto.randomUUID(), adds: 1});
  check([response.status, response.json().added, response.json().changed, (await record('safa')).data.code], [200, 1, 0, '9003'], 'the re-import applies: the new customer is added, safa keeps 9003');

  // ---- a code that became held between the preview and the apply: 409, nothing written
  const late = xlsx([row('501', 'مصنع الريحان')]);
  const latePreview = (await post(owner, {...preview, base64: late})).json();
  check([latePreview.rows[0].status, latePreview.summary.adds], ['new', 1], 'a new row');
  await customer('late', {name: 'مصنع وصل متأخر', code: '501'});
  const lateBefore = [await count("SELECT count(*) AS n FROM crm_records WHERE kind='customer'"), await count('SELECT count(*) AS n FROM crm_audit')];
  response = await post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: late, snapshot: latePreview.snapshot, requestId: crypto.randomUUID(), adds: 1});
  check([response.status, response.json().error], [409, 'تغيّرت بيانات العملاء منذ المعاينة؛ أجرِ معاينة جديدة'], 'someone now holds 501: 409');
  check([await count("SELECT count(*) AS n FROM crm_records WHERE kind='customer'"), await count('SELECT count(*) AS n FROM crm_audit')], lateBefore, 'nothing written');
  check((await post(owner, {...preview, base64: late})).json().rows.map(r => [r.status, r.customerId, r.matchedBy, r.add]), [['same', 'late', 'code', false]], 'a new preview finds it by its code: never added');

  // ---- regions: a value that is not a region 400; a region outside the user's scope 403; a row region for a row that is not new 400
  const regionFile = xlsx([row('701', 'مصنع الياسمين', '0597770001'), row('44', 'مصنع الفجر')]);
  const regionPreview = (await post(owner, {...preview, base64: regionFile})).json();
  check(regionPreview.rows.map(r => r.status), ['new', 'same'], 'a new row and a row the CRM has');
  const regionApply = extra => post(owner, {action: 'apply', fileName: 'Customer.xlsx', base64: regionFile, snapshot: regionPreview.snapshot, requestId: crypto.randomUUID(), adds: 1, ...extra});
  check((await regionApply({region: 'مكة'})).status, 400, 'a region that is not one of the form\'s: 400');
  check((await regionApply({regions: [{row: 4, region: 'الوسطى'}]})).status, 400, 'a row region for a row that is not new: 400');
  check((await regionApply({regions: [{row: 3, region: 'الوسطى'}, {row: 3, region: 'الشرقية'}]})).status, 400, 'a row given two regions: 400');
  check(await count("SELECT count(*) AS n FROM crm_records WHERE json_extract(data,'$.code')='701'"), 0, 'nothing added by the refused requests');
  response = await regionApply({region: 'الشرقية', regions: [{row: 3, region: 'الجنوبية'}]});
  check([response.status, response.json().additions.map(a => a.region)], [200, ['الجنوبية']], 'a row\'s own region wins over the one for all');

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
  // A code-only apply from a screen loaded before the deploy (no `adds`) is refused too: that screen cannot read this release's answer
  // (no `missing`), so a save it made would read as unconfirmed and the dialog could not be closed. Nothing is written.
  const codeOnlyBefore = [await count('SELECT count(*) AS n FROM crm_audit'), (await record('fajr')).version, (await record('fajr')).data.code];
  response = await post(sm, {action: 'apply', fileName: 'Customer.xlsx', base64: regional, snapshot: body.snapshot, requestId: crypto.randomUUID()});
  check([response.status, response.json().error], [409, SCREEN_OUTDATED], 'a code-only apply without adds (the screen before the deploy): 409 asking for a reload');
  check([await count('SELECT count(*) AS n FROM crm_audit'), (await record('fajr')).version, (await record('fajr')).data.code], codeOnlyBefore, 'nothing written by it');
  response = await post(sm, {action: 'apply', fileName: 'Customer.xlsx', base64: regional, snapshot: body.snapshot, requestId: crypto.randomUUID(), adds: 0});
  check([response.status, response.json().updated, response.json().mappings, response.json().outOfRegion, response.json().heldOutside], [200, 1, 0, 1, 2], 'the manager applies (no customer to add: adds 0)');
  check([(await record('east')).data.code, (await record('fajr')).data.code, (await record('nour')).data.code, (await record('badr')).data.code, (await record('east2')).data.code], ['66', '72', '12', '33', '81'], 'only the in-region customer changed; the numbers held outside the regions changed nobody');
  check(await mappings(), mappingsBefore, 'the stored mappings are as they were (the administrator\'s 66 → east included)');
  // The same file by the administrator links them: their invoices are the administrator's to move.
  const ownerView = (await post(owner, {...preview, base64: regional})).json();
  check(ownerView.rows.slice(2).map(r => [r.status, r.customerId, r.mapping]), [['auto', 'nour', true], ['auto', 'badr', true]], 'the system administrator sees them as ordinary links');
  check((await post(rep, {action: 'apply', fileName: 'Customer.xlsx', base64: regional, snapshot: body.snapshot, requestId: crypto.randomUUID(), adds: 0})).status, 403, 'a representative cannot apply either');

  // ---- the sales manager adds customers in their region only, as the responsible
  const mine = xlsx([row('601', 'مصنع النخيل', '0597776666')]);
  const minePreview = (await post(sm, {...preview, base64: mine})).json();
  check([minePreview.rows[0].status, minePreview.newRegions, minePreview.newRegion], ['new', ['الوسطى'], 'الوسطى'], 'the manager of the central region: new customers go there');
  const mineApply = extra => post(sm, {action: 'apply', fileName: 'Customer.xlsx', base64: mine, snapshot: minePreview.snapshot, requestId: crypto.randomUUID(), adds: 1, ...extra});
  for (const [region, label] of [['', '«المنطقة غير محددة»'], ['الشرقية', 'another region']]) {
    response = await mineApply({region});
    check([response.status, response.json().error], [403, 'لا يمكنك إنشاء أو نقل عميل خارج منطقتك المسموح بها'], 'the manager cannot add a customer in ' + label + ': 403');
  }
  check((await mineApply({regions: [{row: 3, region: 'الشمالية'}]})).status, 403, 'nor give one row a region outside theirs');
  check(await count("SELECT count(*) AS n FROM crm_records WHERE json_extract(data,'$.code')='601'"), 0, 'nothing added by the refused requests');
  const mineId = crypto.randomUUID();
  response = await post(sm, {action: 'apply', fileName: 'Customer.xlsx', base64: mine, snapshot: minePreview.snapshot, requestId: mineId, adds: 1});
  check([response.status, response.json().added], [200, 1], 'the manager adds it');
  const smAdded = await app.db.prepare('SELECT assigned_to,branch,data FROM crm_records WHERE id=?').bind('crm-sm-erp-' + mineId + '-3').first();
  check([smAdded.assigned_to, smAdded.branch, JSON.parse(smAdded.data).region, JSON.parse(smAdded.data).assignedTo, (await app.db.prepare("SELECT actor FROM crm_audit WHERE record_id=? AND action='إضافة'").bind('crm-sm-erp-' + mineId + '-3').first()).actor], ['sm', 'الرئيسي', 'الوسطى', 'sm', 'sm'], 'responsible: the manager, in their region, the history entry theirs');
  ok(await internal('crm-sm-erp-' + mineId + '-3') > 0, 'with a Yourrest number');
  // a similar name only outside the manager's regions: never added by them (the customer may be one they cannot see), no details
  const eastern = xlsx([row('602', 'مصنع الشرق الحديث', '0597775555')]);
  response = await post(sm, {...preview, base64: eastern});
  check([response.json().rows[0].status, response.json().rows[0].matchedBy, response.json().rows[0].candidates, response.json().summary.adds, response.json().summary.outOfRegion], ['out-of-region', 'similar', [], 0, 1], 'the manager: out-of-region, not added');
  ok(!response.text.includes('"east"') && !response.text.includes('east2') && !response.text.includes('مصنع الشرق الثاني'), 'no detail of the outside customers');
  check((await post(sm, {...preview, base64: eastern, choices: [{row: 3, customerId: '+new'}]})).status, 400, 'and «عميل جديد» is refused on it');
  const easternView = (await post(owner, {...preview, base64: eastern})).json();
  check([easternView.rows[0].status, easternView.rows[0].candidates.map(c => c.id).sort()], ['similar', ['east', 'east2']], 'the administrator sees the similar customers');

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

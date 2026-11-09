// «استيراد من ERP»: the ERP code of the customers the file does not name (the owner, 2026-11-09: «عايزه العملاء اللى مش موجودين فى
// الشييت يبقى كود erp فاضى»), over real HTTP against the BUILT release (run `pnpm build` first). The preview lists, under `clears`, exactly
// the customers of the importer's regions that still carry an ERP code and that no row names (by phone, name, number, kept code, mapping or
// similar name), with a `clearSnapshot`, and writes nothing; an apply without `clearCodes` (the box unchecked, or a screen of before) clears
// nobody, and one with only codes to clear and the box unchecked has nothing to apply (400); an apply with `clearCodes` and the
// preview's clearSnapshot sets data.code to '' for exactly those customers in the same transaction (version, mutation id, updated_at
// moved; nothing else of the record changes), one 'erp-customer-code' audit entry each {label, from, to: '', cleared: true}, `cleared`
// in the answer; the matched customer keeps the code the file gives it; the old code stays an alias, a stored mapping of it stays, the
// last purchase of an invoice under the old code still resolves to the customer;
// a customer edited after the preview (or moved to another region), or an apply without/with another clearSnapshot, is 409 and writes
// nothing; a repeated request returns the saved answer, the same request with the box changed is 409; the sales manager clears only
// their regions' customers. Synthetic fixtures only: temporary SQLite, mocked sendmail, never the owner's file.
import assert from 'node:assert/strict';
import {zipSync, strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager', region: 'central'}, {id: 'sup', role: 'supervisor', sup: 'sm', region: 'central'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'central'}];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

const header = ['رقم العميل', 'رقم الهوية', 'الاسم بالعربي', 'الاسم بالانجليزي', 'رقم الجوال', 'رقم الهاتف', 'البريد الالكتروني', 'العنوان', 'التاريخ'];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cell = value => `<c t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
const row = (code, name, mobile = '') => [code, '1000000000', name, name, mobile, '', '', 'A B C D 1 2 3 4', '2026/11/01'];
const xlsx = rows => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Customer" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${[['Customer'], header, ...rows].map((cells, index) => `<row r="${index + 1}">${cells.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`),
})).toString('base64');
const STALE = 'اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة';
const day = days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString();
  const customer = (id, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', address: 'حي الصناعية', notes: 'keep', customerStatus: 'نشط', phone: '', phone2: '', code: '', ...data}), now, now).run();
  await customer('nour', {name: 'مصنع النور', phone: '0551234567', code: 'OLD-1'});     // in the file by its phone: takes 12
  await customer('gone', {name: 'مصنع غايب', code: '900'});                               // nobody names it: cleared
  await customer('mapped', {name: 'مصنع مربوط', code: '901'});                            // nobody names it; 901 mapped to it: cleared, mapping kept
  await customer('nocode', {name: 'مصنع من غير كود'});                                    // no code: never listed
  await customer('similar', {name: 'مصنع الياسمين', code: '903'});                        // a similar name of row 4: not cleared
  await customer('kept', {name: 'مصنع قديم الكود', code: 'K-2', phone: '0561234567'});      // in the file by phone, its code the same: untouched
  await customer('east', {name: 'مصنع شرقي', code: '902', region: 'الشرقية'});            // nobody names it, outside the manager's regions
  await app.db.prepare("INSERT INTO crm_customer_code_mappings(code_key,customer_id,version,updated_by,updated_at) VALUES('901','mapped',1,'owner',?)").bind(now).run();
  await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','f','sales.xml','{}',?)").bind(now).run();
  await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES('erp-1','doc-1','h','h','INV-1','sale',?,'e1','rep','الرئيسي','all','900','n','{}',10000,'imp','owner',?)").bind(day(12), now).run();
  const record = async id => { const raw = await app.db.prepare('SELECT data,version,mutation_id,updated_at FROM crm_records WHERE id=?').bind(id).first(); return {data: JSON.parse(raw.data), version: raw.version, mutationId: raw.mutation_id, updatedAt: raw.updated_at}; };
  const internal = async id => 'YR-C-' + String((await app.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number).padStart(6, '0');
  const count = async (sql, ...args) => (await app.db.prepare(sql).bind(...args).first()).n;
  const aliases = async id => (await app.db.prepare('SELECT source_code FROM crm_customer_code_aliases WHERE customer_id=? ORDER BY source_code').bind(id).all()).results.map(r => r.source_code);
  const owner = app.as(await app.login('owner')), sm = app.as(await app.login('sm'));
  const post = (as, body) => as('/api/erp-customers', {method: 'POST', body});
  const file = xlsx([row('12', 'مصنع النور', '+966551234567'), row('904', 'مصنع الياسمين للبلوك'), row('K-2', 'اسم في ERP غير', '0561234567')]);
  const preview = {action: 'preview', fileName: 'Customer.xlsx', base64: file};
  const ids = ['nour', 'gone', 'mapped', 'nocode', 'similar', 'kept', 'east'], before = Object.fromEntries(await Promise.all(ids.map(async id => [id, await record(id)])));

  // ---- the preview: exactly the customers nobody in the file names, with a code, within the importer's regions; nothing written
  let response = await post(owner, preview);
  check(response.status, 200, 'preview: 200');
  let body = response.json();
  check(body.clears, [
    {customerId: 'gone', name: 'مصنع غايب', internalCode: await internal('gone'), code: '900', region: 'الوسطى'},
    {customerId: 'mapped', name: 'مصنع مربوط', internalCode: await internal('mapped'), code: '901', region: 'الوسطى'},
    {customerId: 'east', name: 'مصنع شرقي', internalCode: await internal('east'), code: '902', region: 'الشرقية'},
  ], 'the administrator: every customer with a code the file does not name (name, Yourrest code, current ERP code); not the matched, the similar name or the one with no code');
  ok(/^[a-f0-9]{64}$/.test(body.clearSnapshot) && body.clearSnapshot !== body.snapshot, 'with its own snapshot');
  ok(!('version' in body.clears[0]), 'versions stay on the server');
  check([body.summary.changes, body.rows.map(r => [r.row, r.status, r.customerId])], [1, [[3, 'auto', 'nour'], [4, 'similar', ''], [5, 'same', 'kept']]], 'the rows as before');
  check(await count("SELECT count(*) AS n FROM crm_audit"), 0, 'a preview writes nothing');
  const smPreview = (await post(sm, preview)).json();
  check(smPreview.clears.map(c => c.customerId), ['gone', 'mapped'], 'the sales manager: only their regions\' customers');

  // ---- the box checked but the apply without the preview's clearSnapshot, or with another one: 409, nothing written
  const base = {action: 'apply', fileName: 'Customer.xlsx', base64: file, snapshot: body.snapshot, adds: 0};
  for (const [extra, label] of [[{}, 'without clearSnapshot'], [{clearSnapshot: 'e'.repeat(64)}, 'with another clearSnapshot'], [{clearSnapshot: smPreview.clearSnapshot}, 'with the manager\'s']]) {
    response = await post(owner, {...base, clearCodes: true, requestId: crypto.randomUUID(), ...extra});
    check([response.status, response.json().error], [409, STALE], 'clearCodes ' + label + ': 409');
  }
  // ---- a customer edited after the preview: 409, nothing written (nobody's code changed, cleared or not)
  const edited = await record('gone');
  check((await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: 'gone', version: edited.version, data: {...edited.data, notes: 'edited after the preview'}}})).status, 200, 'a listed customer is edited through the CRM');
  response = await post(owner, {...base, clearCodes: true, clearSnapshot: body.clearSnapshot, requestId: crypto.randomUUID()});
  check([response.status, response.json().error], [409, STALE], 'a stale list: 409 with the usual message');
  check([(await record('gone')).data.code, (await record('nour')).data.code, await count("SELECT count(*) AS n FROM crm_audit WHERE action IN ('erp-customer-code','erp-customers-receipt')")], ['900', 'OLD-1', 0], 'nothing was written');
  // a listed customer moved to another region: 409 too
  body = (await post(owner, preview)).json();
  await app.db.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الغربية'),version=version+1 WHERE id='mapped'").run();
  response = await post(owner, {...base, snapshot: body.snapshot, clearCodes: true, clearSnapshot: body.clearSnapshot, requestId: crypto.randomUUID()});
  check(response.status, 409, 'a listed customer moved to another region since the preview: 409');
  await app.db.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الوسطى'),version=version+1 WHERE id='mapped'").run();

  // ---- the box unchecked: the apply of before; nobody's code is cleared
  body = (await post(owner, preview)).json();
  const uncheckedId = crypto.randomUUID();
  response = await post(owner, {...base, snapshot: body.snapshot, requestId: uncheckedId});
  check([response.status, response.json().updated, response.json().cleared], [200, 1, 0], 'unchecked: the code of the matched customer changes, none is cleared');
  check(await Promise.all(ids.map(async id => (await record(id)).data.code)), ['12', '900', '901', '', '903', 'K-2', '902'], 'the codes: only the matched customer\'s changed');
  check((await post(owner, {...base, snapshot: body.snapshot, requestId: uncheckedId, clearCodes: true, clearSnapshot: body.clearSnapshot})).status, 409, 'the same request with the box checked: 409 (saved with other data)');

  // ---- only codes to clear: unchecked there is nothing to apply (400)
  body = (await post(sm, preview)).json();
  check([body.summary.changes, body.summary.adds, body.clears.map(c => c.customerId)], [0, 0, ['gone', 'mapped']], 'the same file again: nothing to change, two codes to clear for the manager');
  response = await post(sm, {...base, snapshot: body.snapshot, requestId: crypto.randomUUID()});
  check([response.status, response.json().error], [400, 'لا توجد أكواد تتغير ولا عملاء جدد في هذا الملف.'], 'unchecked with nothing else: nothing to apply');

  // ---- the sales manager clears: their regions' customers only, in one transaction
  const revision = async () => (await app.db.prepare("SELECT revision FROM crm_customer_identity_state WHERE id='company'").first()).revision, revisionBefore = await revision();
  const mid = Object.fromEntries(await Promise.all(ids.map(async id => [id, await record(id)])));
  const smApply = {...base, snapshot: body.snapshot, clearCodes: true, clearSnapshot: body.clearSnapshot, requestId: crypto.randomUUID()};
  response = await post(sm, smApply);
  check(response.status, 200, 'the manager\'s apply: 200');
  const result = response.json();
  check([result.cleared, result.updated, result.changed, result.added], [2, 0, 0, 0], 'the answer: 2 codes cleared, nothing else');
  check(await Promise.all(ids.map(async id => (await record(id)).data.code)), ['12', '', '', '', '903', 'K-2', '902'], 'cleared: the two customers of the manager\'s regions; the matched, similar and eastern ones untouched');
  for (const id of ids) {
    const now = await record(id), was = mid[id], cleared = ['gone', 'mapped'].includes(id), withoutCode = data => Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'code'));
    check(withoutCode(now.data), withoutCode(was.data), 'nothing but the code changed in ' + id);
    check([now.version - was.version, now.mutationId !== was.mutationId && /^erp-customers-import:/.test(now.mutationId), now.updatedAt > was.updatedAt], cleared ? [1, true, true] : [0, false, false], (cleared ? 'version, mutation id and updated_at moved once: ' : 'untouched: ') + id);
  }
  check([await aliases('gone'), await aliases('mapped')], [['900'], ['901']], 'the old code stays as an alias (the identity trigger), so earlier invoices still find the customer');
  check((await app.db.prepare('SELECT code_key,customer_id,version FROM crm_customer_code_mappings').all()).results.map(r => ({...r})), [{code_key: '901', customer_id: 'mapped', version: 1}], 'the stored mapping of the cleared code stays as it was');
  ok(await revision() > revisionBefore, 'the identity revision moved');
  const audits = (await app.db.prepare("SELECT record_id,actor,action,detail FROM crm_audit WHERE action='erp-customer-code' AND record_id IN ('gone','mapped') ORDER BY record_id").all()).results;
  check(audits.map(a => [a.record_id, a.actor, JSON.parse(a.detail)]), [
    ['gone', 'sm', {label: 'مسح كود ERP: العميل مش في ملف ERP', from: '900', to: '', cleared: true}],
    ['mapped', 'sm', {label: 'مسح كود ERP: العميل مش في ملف ERP', from: '901', to: '', cleared: true}],
  ], 'one audit entry per cleared code: from, to \'\'');
  // a repeated tap: the saved answer, nothing written twice
  const auditCount = await count('SELECT count(*) AS n FROM crm_audit');
  response = await post(sm, smApply);
  check([response.status, response.json().alreadySaved, response.json().cleared, await count('SELECT count(*) AS n FROM crm_audit')], [200, true, 2, auditCount], 'a repeated request returns the saved answer');

  // ---- the administrator then clears the eastern one; the list is then empty
  body = (await post(owner, preview)).json();
  check(body.clears.map(c => c.customerId), ['east'], 'the administrator\'s list now: the eastern customer');
  response = await post(owner, {...base, snapshot: body.snapshot, clearCodes: true, clearSnapshot: body.clearSnapshot, requestId: crypto.randomUUID()});
  check([response.status, response.json().cleared, (await record('east')).data.code, await aliases('east')], [200, 1, '', ['902']], 'cleared, its old code kept as an alias');
  check((await post(owner, preview)).json().clears, [], 'nobody left to clear');

  // ---- the customers list and what still resolves through the old code
  const crm = (await owner('/api/crm')).json(), listed = Object.fromEntries(crm.records.filter(r => r.kind === 'customer').map(r => [r.id, r]));
  check([listed.gone.data.code, listed.gone.data._erpCodeAliases, listed.gone.data._lastPurchase], ['', ['900'], day(12)], 'the customers list: an empty ERP code, the old one kept, and the invoice under it still its last purchase');
  check([listed.nour.data.code, listed.kept.data.code, listed.nocode.data.code, listed.similar.data.code], ['12', 'K-2', '', '903'], 'the others as the file and the CRM leave them');
  ok(Object.values(before).length === ids.length, 'every fixture checked');
} finally { await app.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true}));

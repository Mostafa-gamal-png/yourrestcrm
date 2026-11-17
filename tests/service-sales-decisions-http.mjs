// The owner's four decisions on customer service in the sales process (2026-11-17, as GSCO 2.13.79), the follow-up of update-cs-sales-20261116,
// over real HTTP against the BUILT release (`npm run build` first), on a database as update-cs-sales left it (22 migrations, no new one):
// 1. «نسبة الفرص المتحولة إلى مبيعات» against 100%: settings saved under update-cs-sales with its placeholder (50) read 100, a target set by hand
//    stays, what the administrator saves from now on stays (the server stamps the revision), a month closed under update-cs-sales keeps 50;
// 2. the support-sales window 30 days: a saved placeholder (60) reads 30 on the evaluation and the dashboard, a window set by hand stays;
// 3. «أداء خدمة العملاء», its Excel file and its API for a sales manager: only the customer-service teams that report to him; one with none
//    gets an empty answer, not an error; the administrator every team;
// 4. «عملاء منقطعون عن الشراء 90 يومًا» with the customers who never bought, after the others, marked, counted, searchable, in the reader's
//    branch, a page of 300 at a time; the source the system fills in from such a customer is the stored «عميل منقطع عن الشراء 90 يومًا».
// Synthetic isolated fixtures only: temporary SQLite, made-up members, customers and documents.
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات الأول'}, {id: 'mgr2', role: 'manager', name: 'مدير المبيعات الثاني'}, {id: 'mgr3', role: 'manager', name: 'مدير المبيعات الثالث'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'المندوب'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء الأول'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثلة الفريق الأول'},
  {id: 'csm2', role: 'customer_service_manager', sup: 'mgr2', name: 'مدير خدمة العملاء الثاني'}, {id: 'cs3', role: 'customer_service', sup: 'csm2', name: 'ممثل الفريق الثاني'},
  {id: 'csj', role: 'customer_service', sup: 'csm', name: 'ممثل فرع جدة', branch: 'جدة'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const zipText = buf => { let out = '', i = 0; while ((i = buf.indexOf(Buffer.from([0x50, 0x4b, 3, 4]), i)) >= 0) { const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28), start = i + 30 + nameLen + extra, data = buf.subarray(start, start + size); try { out += method === 8 ? inflateRawSync(data).toString('utf8') : data.toString('utf8'); } catch { /* not an entry */ } i = start + size; } return out; };

const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const m of members) sessions[m.id] = await app.login(m.id);
  const get = (id, url) => app.as(id ? sessions[id] : null)(url);
  const post = (id, url, body) => app.as(id ? sessions[id] : null)(url, {method: 'POST', body});
  const fmt = d => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(d);
  const day = fmt(new Date()), month = day.slice(0, 7), ago = n => new Date(Date.now() - n * 86400000).toISOString(), dayAgo = n => fmt(new Date(Date.now() - n * 86400000));
  const monthsBack = n => { const [y, m] = month.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 - n, 15)); return t.toISOString().slice(0, 7); };
  const migrations = (await app.db.prepare('SELECT count(*) AS n FROM yr_schema_migrations').first()).n;
  eq(migrations, 22, 'the database is update-cs-sales\'s: 22 migrations, no new one');
  const insert = (id, kind, parent, assigned, data, when = ago(3), branch = 'الرئيسي') => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').bind(id, kind, parent, assigned, branch, JSON.stringify(data), when, when, 'fixture').run();
  const point = {location: '24.7136000, 46.6753000', latitude: 24.7136, longitude: 46.6753};
  const customerData = (name, code) => ({name, region: 'الشرقية', city: 'الدمام', code, phone: '0500000001', branch: 'الرئيسي', assignedTo: 'rep', ...point});
  await app.db.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES(?,?,?,?,?,?)').bind('erp-import-1', 'owner', 'fp-1', 'synthetic.xlsx', '{}', ago(1)).run();
  const erp = (id, code, date, cents) => app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,'sale',?,'E-rep','rep','الرئيسي','eastern',?,'عميل اصطناعي',?,?,'erp-import-1','owner',?)")
    .bind(id, 'doc-' + id, 'INV-' + id, date, code, JSON.stringify({items: [{product: 'قوالب البلوك المتحركة', quantity: 2, unitPrice: cents / 200}], discount: 0}), cents, new Date().toISOString()).run();

  // ---- 1 and 2: the settings as update-cs-sales saved them, with its placeholders, and with values set by hand
  const fresh = (await get('owner', '/api/service-kpi?month=' + month)).json();
  eq([fresh.settings.rep.conversion.target, fresh.settings.supportSalesDays, fresh.settings.revision, fresh.settingsVersion], [100, 30, 2, 0], 'nothing saved: the owner\'s figures, 100% and 30 days');
  const v78 = JSON.parse(JSON.stringify(fresh.settings)); delete v78.revision; v78.rep.conversion.target = 50; v78.supportSalesDays = 60;
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('service-kpi-settings','service_kpi_settings',NULL,'owner','الرئيسي',?,?,?,1,'update-cs-sales')").bind(JSON.stringify(v78), ago(1), ago(1)).run();
  const settingsOf = async (who = 'csm') => (await get(who, '/api/service-kpi?month=' + month)).json().settings;
  const supportDays = async (who = 'csm') => (await get(who, '/api/service-performance?month=' + month)).json().supportDays;
  let settings = await settingsOf();
  eq([settings.rep.conversion.target, settings.supportSalesDays, await supportDays()], [100, 30, 30], 'saved under update-cs-sales with its placeholders: 50% reads 100%, 60 days read 30, the dashboard too');
  const byHand = {...v78, rep: {...v78.rep, conversion: {...v78.rep.conversion, target: 70}}, supportSalesDays: 45};
  await app.db.prepare("UPDATE crm_records SET data=? WHERE id='service-kpi-settings'").bind(JSON.stringify(byHand)).run();
  settings = await settingsOf();
  eq([settings.rep.conversion.target, settings.supportSalesDays, await supportDays()], [70, 45, 45], 'a target and a window set by hand under update-cs-sales stay');
  // A month closed under update-cs-sales keeps the target it was closed with.
  const closedMonth = monthsBack(2);
  await insert('service-kpi-month-csm-' + closedMonth, 'service_kpi_month', null, 'csm', {kind: 'service_kpi_month', month: closedMonth, managerId: 'csm', team: ['cs', 'csj'], settings: v78, closedBy: 'owner', closedAt: ago(20), scores: {cs: null, csj: null, csm: null}}, ago(20));
  const closed = (await get('csm', '/api/service-kpi?month=' + closedMonth)).json().groups.find(g => g.managerId === 'csm');
  eq([closed.closed, closed.settings.rep.conversion.target, closed.settings.supportSalesDays], [true, 50, 60], 'a month closed under update-cs-sales keeps its certificate: 50% and 60 days');
  // Saved by the administrator from now on: what he chooses stays, 50% and 60 days included; the server stamps the revision.
  const current = (await get('owner', '/api/service-kpi?month=' + month)).json();
  const chosen = {...current.settings, rep: {...current.settings.rep, conversion: {...current.settings.rep.conversion, target: 50}}, supportSalesDays: 60};
  eq((await post('owner', '/api/service-kpi', {action: 'settings', requestId: crypto.randomUUID(), version: current.settingsVersion, settings: chosen})).status, 200, 'the administrator saves 50% and 60 days');
  settings = await settingsOf();
  eq([settings.rep.conversion.target, settings.supportSalesDays, await supportDays()], [50, 60, 60], 'and they stay: saved after the decisions, they are his');
  eq(JSON.parse((await app.db.prepare("SELECT data FROM crm_records WHERE id='service-kpi-settings'").first()).data).revision, 2, 'the server stamped the revision on the save');
  const older = {...current.settings, rep: {...current.settings.rep, conversion: {...current.settings.rep.conversion, target: 50}}}; delete older.revision; delete older.supportSalesDays;
  const again = (await get('owner', '/api/service-kpi?month=' + month)).json();
  eq((await post('owner', '/api/service-kpi', {action: 'settings', requestId: crypto.randomUUID(), version: again.settingsVersion, settings: older})).status, 200, 'a page of update-cs-sales (no revision, no window) saves too');
  settings = await settingsOf();
  eq([settings.rep.conversion.target, settings.supportSalesDays], [50, 60], 'its 50% is the administrator\'s choice (stamped), and the saved window is kept');
  eq((await post('owner', '/api/service-kpi', {action: 'settings', requestId: crypto.randomUUID(), version: (await get('owner', '/api/service-kpi?month=' + month)).json().settingsVersion, settings: {...older, revision: 'x'}})).status, 400, 'a revision that is not a number: refused');

  // ---- 3. «أداء خدمة العملاء»: each sales manager the customer-service team under him
  for (const [id, code] of [['c-one', 'C-ONE'], ['c-two', 'C-TWO']]) await insert(id, 'customer', null, 'rep', customerData('مصنع ' + id, code), ago(400));
  const version = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first()).version;
  const fields = {type: 'call', summary: 'تعريف بالمنتجات', result: 'العميل مهتم', nextAction: 'إرسال عرض سعر', nextDate: day, strength: 'strong', requestedProducts: ['قوالب البلوك المتحركة'], salesStage: 'new', ...point, locationSource: 'device', locationCapturedAt: new Date().toISOString(), locationAccuracy: 10};
  const create = async (who, customerId) => post(who, '/api/customer-service', {action: 'create', requestId: crypto.randomUUID(), customerId, customerVersion: await version(customerId), registration: fields, elapsedMilliseconds: 60000, lead: {group: 'service', source: 'واتساب'}});
  eq([(await create('cs', 'c-one')).status, (await create('cs3', 'c-two')).status], [200, 200], 'an opportunity in each team');
  const perf = async who => { const response = await get(who, '/api/service-performance?month=' + month); eq(response.status, 200, who + ' reads «أداء خدمة العملاء»'); return response.json(); };
  const teamsOf = view => view.teams.map(t => [t.managerId, t.rows.map(r => r.memberId).sort()]);
  const [asMgr, asMgr2, asMgr3, asOwner, asCsm] = [await perf('mgr'), await perf('mgr2'), await perf('mgr3'), await perf('owner'), await perf('csm')];
  eq([asMgr.reach, teamsOf(asMgr)], ['reporting', [['csm', ['cs', 'csj', 'csm']]]], 'the first sales manager: the customer-service manager under him, with his members');
  eq([asMgr2.reach, teamsOf(asMgr2)], ['reporting', [['csm2', ['cs3', 'csm2']]]], 'the second: his own team');
  const leaks = (view, words) => words.filter(word => JSON.stringify(view).includes(word));
  eq([leaks(asMgr, ['csm2', 'cs3', 'ممثل الفريق الثاني', 'مدير خدمة العملاء الثاني', 'مصنع c-two']), leaks(asMgr2, ['"csm"', '"cs"', 'ممثلة الفريق الأول', 'مدير خدمة العملاء الأول', 'مصنع c-one'])], [[], []], 'nothing of the other team leaves the server');
  eq([asMgr.opportunities.map(o => o.registrarName), asMgr2.opportunities.map(o => o.registrarName)], [['ممثلة الفريق الأول'], ['ممثل الفريق الثاني']], 'each one\'s opportunities are his team\'s');
  eq([asMgr3.reach, asMgr3.teams, asMgr3.invoices, asMgr3.opportunities], ['reporting', [], [], []], 'a sales manager no team reports to: an empty answer, not an error');
  eq([asOwner.reach, asOwner.teams.map(t => t.managerId).sort(), asCsm.reach, teamsOf(asCsm).map(t => t[0])], ['all', ['csm', 'csm2'], 'team', ['csm']], 'the administrator reads every team; a customer-service manager his own, as before');
  const exported = async who => { const file = await get(who, '/api/service-performance/export?month=' + month); eq([file.status, file.bytes.subarray(0, 2).toString()], [200, 'PK'], who + ' downloads the Excel file'); return zipText(file.bytes); };
  const [mgrFile, mgr2File, mgr3File, ownerFile] = [await exported('mgr'), await exported('mgr2'), await exported('mgr3'), await exported('owner')];
  eq([leaks(mgrFile, ['ممثل الفريق الثاني', 'مدير خدمة العملاء الثاني']), leaks(mgr2File, ['ممثلة الفريق الأول', 'مدير خدمة العملاء الأول']), leaks(mgr3File, ['ممثلة الفريق الأول', 'ممثل الفريق الثاني']), leaks(ownerFile, ['ممثلة الفريق الأول', 'ممثل الفريق الثاني'])],
    [[], [], [], ['ممثلة الفريق الأول', 'ممثل الفريق الثاني']], 'and the Excel file: no row of another team (none at all for the one with no team), every team for the administrator');

  // ---- 4. «عملاء منقطعون عن الشراء 90 يومًا» with the customers who never bought, a page of 300 at a time
  await insert('c-lapsed', 'customer', null, 'rep', customerData('مصنع منقطع', 'C-LAPSED'), ago(400));
  await erp('old-lapsed', 'C-LAPSED', dayAgo(200), 10000);
  await insert('c-recent', 'customer', null, 'rep', customerData('مصنع اشترى حديثًا', 'C-RECENT'), ago(400));
  await erp('new-recent', 'C-RECENT', dayAgo(5), 10000);
  const statements = [];
  for (let n = 1; n <= 301; n++) { const code = 'N-' + String(n).padStart(3, '0'); statements.push(app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,NULL,?,?,?,?,?,1,?)').bind('c-new-' + n, 'customer', 'rep', 'الرئيسي', JSON.stringify(customerData('عميل جديد ' + String(302 - n).padStart(3, '0'), code)), ago(400), ago(400), 'fixture')); }
  await app.db.batch(statements);
  const dormant = async (who, query = '') => { const response = await get(who, '/api/service-leads?list=dormant' + query); eq(response.status, 200, who + ' reads the dormant list ' + query); return response.json(); };
  const page1 = await dormant('cs');
  const never = page1.never;
  ok(never >= 301, 'every customer of the branch who never bought is counted: ' + never);
  eq([page1.lapsed, page1.total, page1.page, page1.pageSize, page1.rows.length], [1, 1 + never, 1, 300, 300], 'counted in full by kind, read a page of 300');
  eq([page1.rows[0].id, page1.rows[0].lastPurchase, page1.rows[0].neverBought, page1.rows.some(r => r.id === 'c-recent')], ['c-lapsed', dayAgo(200), false, false], 'the customer whose last purchase is older than 90 days first; not the recent buyer');
  ok(page1.rows.slice(1).every(r => r.neverBought && r.lastPurchase === ''), 'then the ones who never bought, marked');
  const names = page1.rows.slice(1).map(r => r.name);
  eq(names, [...names].sort((a, b) => a.localeCompare(b, 'ar')), 'by name');
  const page2 = await dormant('cs', '&page=2');
  eq([page2.page, page2.rows.length, page2.rows.some(r => page1.rows.some(x => x.id === r.id))], [2, 1 + never - 300, false], 'the second page carries on where the first stopped');
  eq([(await dormant('cs', '&page=3')).rows, (await dormant('cs', '&page=x')).page, (await dormant('cs', '&page=0')).page], [[], 1, 1], 'past the end: nothing; a page that is not one reads the first');
  const found = await dormant('cs', '&q=' + encodeURIComponent('عميل جديد 007'));
  eq([found.rows.map(r => [r.id, r.neverBought]), found.lapsed, found.never], [[['c-new-295', true]], 0, 1], 'the search reaches the customers who never bought, and the counts follow it');
  eq((await dormant('cs', '&q=C-LAPSED')).rows.map(r => r.id), ['c-lapsed'], 'and leaves them out when they do not match');
  eq([(await dormant('csj')).total, (await dormant('owner')).total >= 1 + never], [0, true], 'a member of another branch reads none of them; the administrator all');
  const reference = (await get('cs', '/api/service-leads?kind=customer&id=c-new-1')).json().reference;
  eq([reference.source, reference.blocked], ['عميل منقطع عن الشراء 90 يومًا', ''], 'a customer who never bought starts an opportunity with the stored source «عميل منقطع عن الشراء 90 يومًا»');

  console.log(JSON.stringify({ok: true, checks, scope: 'the owner\'s four decisions on customer service in the sales process on the built release, over update-cs-sales\'s database state: the placeholders and values set by hand, a closed month, the sales managers\' teams in the API and the Excel file, the dormant list with the customers who never bought, paged', productionDataUsed: false}));
} catch (error) {
  console.error(app.log().slice(-4000));
  throw error;
} finally {
  await app.stop();
}

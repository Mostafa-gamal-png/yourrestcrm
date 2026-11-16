// «إخفاء تبويبات صفحة المستهدفات لكل حساب» (the owner, 2026-11-16, item 6 of the GSCO list) over real HTTP against the BUILT release (run
// the build first). Synthetic fixtures only: temporary SQLite, mocked mail.
// - No session: 401 on every route the targets page's tabs use (and on the save of the permissions).
// - Who changes the switches: the administrator only (403 for a sales manager, a supervisor, a representative, customer service); a
//   representative's, customer service's and the administrator's own row keep no tab; GET /api/crm sends the administrator every member's
//   hidden tabs and each member their own (me.access.hidden); every save is a «صلاحيات» history entry with before and after.
// - A tab hidden from a member: the requests that serve only it answer 404 «هذا الجزء غير متاح لحسابك. راجع مدير النظام.» (never 401/403):
//   POST /api/kpis («نتائج الأداء»), GET/POST /api/kpi-evidence/import («التحصيل»), GET/POST /api/erp-quotes («عروض الأسعار»), POST
//   /api/targets and GET /api/targets/history («المستهدفات والأوزان»); GET/POST /api/kpi-evidence (shared by the three evaluation tabs)
//   only when the three are hidden; GET /api/sales?kpis=1 (shared by every tab and «المبيعات») keeps answering 200 and leaves out the
//   evaluation once its three tabs are hidden; every tab and «المبيعات» hidden: /api/sales 404 too. A member who sees the tab: as before;
//   another member of the same role is untouched, and so is the administrator.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'mgr2', role: 'manager', name: 'مدير مبيعات آخر'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'},
  {id: 'rep1', role: 'rep', sup: 'sup', name: 'المندوب أحمد'},
  {id: 'cs', role: 'customer_service', sup: 'mgr', name: 'ممثل خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const HIDDEN = 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.';
const KEYS = ['targets.results', 'targets.collection', 'targets.quotes', 'targets.targets'];
const app = await bootBuiltApp({members});
try {
  const month = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()).slice(0, 7);
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null);
  // Each request of a tab, with a body the route's own schema refuses (400) once the permission checks are passed.
  const asks = {
    kpis: who => who('/api/kpis', {method: 'POST', body: {}}),
    evidenceGet: who => who('/api/kpi-evidence?memberId=rep1&month=' + month),
    evidencePost: who => who('/api/kpi-evidence', {method: 'POST', body: {}}),
    collectionGet: who => who('/api/kpi-evidence/import'),
    collectionPost: who => who('/api/kpi-evidence/import', {method: 'POST', body: {}}),
    quotesGet: who => who('/api/erp-quotes'),
    quotesPost: who => who('/api/erp-quotes', {method: 'POST', body: {}}),
    targetsPost: who => who('/api/targets', {method: 'POST', body: {}}),
    history: who => who('/api/targets/history?scopeId=rep1'),
    sales: who => who('/api/sales?month=' + month + '&kpis=1')
  };
  const TAB = {results: ['kpis'], collection: ['collectionGet', 'collectionPost'], quotes: ['quotesGet', 'quotesPost'], targets: ['targetsPost', 'history']};
  const OPEN = {kpis: 400, evidenceGet: 200, evidencePost: 400, collectionGet: 200, collectionPost: 400, quotesGet: 200, quotesPost: 400, targetsPost: 400, history: 200, sales: 200};
  const statuses = async who => Object.fromEntries(await Promise.all(Object.entries(asks).map(async ([name, ask]) => [name, (await ask(who)).status])));
  const hidden = (response, label) => eq([response.status, response.json().error], [404, HIDDEN], label + ' -> ' + response.text.slice(0, 200));
  const open = (response, name, label) => eq(response.status, OPEN[name], label + ' -> ' + response.text.slice(0, 200));
  let versions = {};
  const save = async (memberId, hiddenKeys, status = 200, as = 'owner') => {
    const response = await session[as]('/api/crm', {method: 'POST', body: {action: 'permissions', memberId, version: versions[memberId] || 0, cells: {}, hidden: hiddenKeys, viewAll: false, requestId: crypto.randomUUID()}});
    eq(response.status, status, 'save ' + memberId + ' ' + JSON.stringify(hiddenKeys) + ' as ' + as + ' -> ' + response.text.slice(0, 200));
    if (response.status === 200) versions[memberId] = response.json().permissions.version;
    return response.status === 200 ? response.json() : null;
  };
  const access = async who => (await session[who]('/api/crm')).json().me.access;

  // 1. No session: 401 everywhere.
  for (const [name, ask] of Object.entries(asks)) eq((await ask(anonymous)).status, 401, 'no session: ' + name);
  eq((await anonymous('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: 'mgr', version: 0, cells: {}, hidden: KEYS, viewAll: false}})).status, 401, 'no session: the save of the switches');

  // 2. Release day: nothing hidden; every role answers as before (the management roles past the permissions; the others refused by role).
  eq(Number((await app.db.prepare('SELECT COUNT(*) n FROM crm_member_permissions').first()).n), 0, 'nobody has saved permissions');
  for (const who of ['owner', 'mgr', 'mgr2']) eq(await statuses(session[who]), OPEN, who + ': every tab\'s request as before');
  ok((await asks.sales(session.mgr)).json().kpis, 'the evaluation is sent');
  const roleRefused = {};
  for (const who of ['rep1', 'cs']) { roleRefused[who] = await statuses(session[who]); eq(Object.values(roleRefused[who]).filter(status => status !== 403), [], who + ': every tab\'s request refused by role (403), as before: ' + JSON.stringify(roleRefused[who])); }
  eq((await access('mgr')).hidden, [], 'the manager\'s access: nothing hidden');

  // 3. Who changes the switches: the administrator only; nothing is stored for a role without the hub nor for an administrator.
  for (const as of ['mgr', 'sup', 'rep1', 'cs']) await save('mgr2', KEYS, 403, as);
  eq((await access('mgr2')).hidden, [], 'a refused save hides nothing');
  for (const [id, label] of [['rep1', 'a representative'], ['cs', 'customer service'], ['owner', 'the administrator']]) eq((await save(id, KEYS)).permissions.hidden, [], label + ': no tab kept');
  eq(await statuses(session.owner), OPEN, 'the administrator keeps every tab');
  for (const who of ['rep1', 'cs']) eq(await statuses(session[who]), roleRefused[who], who + ': a save with every tab hidden changes nothing (the role\'s own refusals, never the hidden answer)');

  // 4. One tab at a time for the manager; the other manager and the administrator untouched.
  for (const tab of ['results', 'collection', 'quotes', 'targets']) {
    eq((await save('mgr', ['targets.' + tab])).permissions.hidden, ['targets.' + tab], tab + ': saved');
    eq((await access('mgr')).hidden, ['targets.' + tab], tab + ': the manager\'s next load carries it');
    const admin = (await session.owner('/api/crm')).json();
    eq(admin.members.find(member => member.id === 'mgr').permissions.hidden, ['targets.' + tab], tab + ': the administrator\'s team page shows it');
    for (const [name, ask] of Object.entries(asks)) { const response = await ask(session.mgr); if (TAB[tab].includes(name)) hidden(response, tab + ' hidden: ' + name); else open(response, name, tab + ' hidden: ' + name); }
    eq(await statuses(session.mgr2), OPEN, tab + ' hidden from mgr: mgr2 as before');
    ok((await asks.sales(session.mgr)).json().kpis, tab + ' hidden: the shared read still carries the evaluation');
  }

  // 5. The three evaluation tabs hidden: «بيانات المؤشرات» closes; /api/sales serves the rest without the evaluation.
  await save('mgr', ['targets.results', 'targets.collection', 'targets.quotes']);
  for (const name of ['kpis', 'evidenceGet', 'evidencePost', 'collectionGet', 'collectionPost', 'quotesGet', 'quotesPost']) hidden(await asks[name](session.mgr), 'the three hidden: ' + name);
  for (const name of ['targetsPost', 'history']) open(await asks[name](session.mgr), name, 'the three hidden: ' + name);
  let read = await asks.sales(session.mgr);
  eq([read.status, read.json().kpis, Array.isArray(read.json().sales), !!read.json().targets], [200, null, true, true], '/api/sales?kpis=1: 200, no evaluation, the sales and the targets kept');
  ok((await asks.sales(session.mgr2)).json().kpis, 'the other manager still receives it');

  // 6. Every tab hidden: the page keeps «رفع المبيعات» (/api/sales 200); with «المبيعات» hidden too the screen goes (/api/sales 404).
  await save('mgr', KEYS);
  for (const name of Object.keys(asks).filter(name => name !== 'sales')) hidden(await asks[name](session.mgr), 'every tab hidden: ' + name);
  read = await asks.sales(session.mgr); eq([read.status, read.json().kpis], [200, null], 'every tab hidden, «المبيعات» shown: /api/sales serves the sales');
  await save('mgr', ['sales', ...KEYS]);
  hidden(await asks.sales(session.mgr), 'every tab and «المبيعات» hidden: /api/sales');
  eq((await access('mgr')).hidden, ['sales', ...KEYS], 'what the page reads to hide the screen');

  // 7. A supervisor: its own switches; a stale save is 409 as for every permission.
  await save('sup', ['targets.targets']);
  hidden(await asks.history(session.sup), 'the supervisor without «المستهدفات والأوزان»: the targets history');
  eq((await asks.evidenceGet(session.sup)).status, 200, 'the supervisor still reads «بيانات المؤشرات»');
  ok((await asks.sales(session.sup)).json().kpis, 'and the evaluation');
  const stale = await session.owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: 'sup', version: 0, cells: {}, hidden: [], viewAll: false, requestId: crypto.randomUUID()}});
  eq([stale.status, stale.json().code], [409, 'PERMISSIONS_CONFLICT'], 'a stale save is refused (409)');
  hidden(await asks.history(session.sup), 'and changed nothing');

  // 8. Shown again: as on release day. Every save on the record.
  await save('mgr', []); await save('sup', []);
  eq(await statuses(session.mgr), OPEN, 'everything shown again: as on release day');
  const audit = (await app.db.prepare("SELECT detail FROM crm_audit WHERE action='صلاحيات' AND record_id='mgr' ORDER BY created_at").all()).results.map(row => JSON.parse(row.detail));
  eq(audit.length, 8, 'eight saves of the manager, eight «صلاحيات» entries');
  eq([audit[0].before.hidden, audit[0].after.hidden, audit.at(-1).before.hidden, audit.at(-1).after.hidden], [[], ['targets.results'], ['sales', ...KEYS], []], 'each with before and after');
  console.log(JSON.stringify({ok: true, checks, syntheticFixtures: true, productionDataUsed: false}));
} finally { await app.stop(); }

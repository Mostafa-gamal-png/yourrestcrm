// Server-side authorization over real HTTP against the BUILT release (run `pnpm build` first).
// Anonymous callers always get 401, every role gets only the endpoints its policy allows,
// and each role sees only its own slice of customers, visits, members and sales.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'},
  {id: 'mgr', role: 'manager'},
  {id: 'mgrw', role: 'manager', region: 'western'},
  {id: 'sup', role: 'supervisor', sup: 'mgr'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern'},
  {id: 'rep2', role: 'rep', sup: 'mgr', region: 'eastern'},
  {id: 'repw', role: 'rep', sup: 'mgr', region: 'western'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr'},
  {id: 'cs', role: 'customer_service', sup: 'csm'},
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), month = day.slice(0, 7);

  // Role groups used by the expectation tables below.
  const management = ['owner', 'mgr', 'mgrw', 'sup'], reps = ['rep1', 'rep2', 'repw'], everyone = members.map(m => m.id);
  const expect = (allowed, ok, denied) => Object.fromEntries(everyone.map(id => [id, allowed.includes(id) ? ok : denied]));

  // 1. Anonymous callers: 401 for every protected route, with an empty body AND a plausible body.
  const anonymous = app.as(null);
  const protectedGets = ['/api/crm', '/api/sales?month=' + month, '/api/targets?month=' + month, '/api/customer-service', '/api/journeys', '/api/mobile-route', '/api/device-status', '/api/kpi-evidence?memberId=rep1&month=' + month, '/api/customer-identities', '/api/sales/import', '/api/visit-files?id=x', '/api/service-report', '/api/service-queue/alerts', '/api/support'];
  for (const url of protectedGets) check((await anonymous(url)).status, 401, 'anonymous GET ' + url);
  check((await anonymous('/api/app-update')).status, 200, 'update metadata is public by design');
  const posts = ['/api/crm', '/api/sales', '/api/targets', '/api/kpis', '/api/visits', '/api/followups', '/api/customer-followups', '/api/customer-service', '/api/support', '/api/journeys', '/api/mobile-route', '/api/device-status', '/api/kpi-evidence', '/api/visit-files', '/api/customer-identities', '/api/customer-address', '/api/customers/import', '/api/machines/import', '/api/sales/import'];
  for (const url of posts) {
    check((await anonymous(url, {method: 'POST', body: {}})).status, 401, 'anonymous empty POST ' + url);
    check((await anonymous(url, {method: 'POST', body: {createKey: crypto.randomUUID(), requestId: crypto.randomUUID(), action: 'save', kind: 'customer', sourceHash: 'a'.repeat(64), rows: []}})).status, 401, 'anonymous shaped POST ' + url);
  }

  // 2. Role matrix. A 400 means the caller passed authorization and only failed validation of the empty body.
  const getMatrix = {
    '/api/crm': expect(everyone, 200, 0),
    ['/api/sales?month=' + month]: expect(management, 200, 403),
    ['/api/targets?month=' + month]: expect(reps, 200, 403),
    '/api/customer-service': expect(everyone, 200, 0),
    '/api/journeys': expect([...management, ...reps], 200, 403),
    '/api/mobile-route': expect([...management, ...reps], 200, 403),
    '/api/device-status': expect(management, 200, 403),
    '/api/customer-identities': expect(['owner'], 200, 403),
    '/api/sales/import': expect(management, 200, 403),
    '/api/service-report': expect(['owner', 'mgr', 'mgrw', 'csm'], 200, 403),
    '/api/service-queue/alerts': expect(everyone, 200, 0),
    '/api/support': expect(everyone, 200, 0)
  };
  for (const [url, byRole] of Object.entries(getMatrix)) for (const id of everyone) check((await app.as(sessions[id])(url)).status, byRole[id], `GET ${url} as ${id}`);
  // KPI evidence is read per member; ask each management role about a member inside its own scope.
  const kpiSubject = {owner: 'rep1', mgr: 'rep1', mgrw: 'repw', sup: 'rep1'};
  for (const id of everyone) check((await app.as(sessions[id])('/api/kpi-evidence?memberId=' + (kpiSubject[id] || 'rep1') + '&month=' + month)).status, management.includes(id) ? 200 : 403, 'GET kpi-evidence as ' + id);
  const postMatrix = {
    '/api/crm': expect([...management, ...reps], 400, 403),
    '/api/support': expect(everyone, 400, 0),
    '/api/sales': expect(management, 400, 403),
    '/api/targets': expect(['owner', 'mgr', 'mgrw'], 400, 403),
    '/api/kpis': expect(['owner', 'mgr', 'mgrw'], 400, 403),
    '/api/journeys': expect([...management, ...reps], 400, 403),
    '/api/mobile-route': expect([...management, ...reps], 400, 403),
    '/api/device-status': expect(reps, 400, 403),
    '/api/kpi-evidence': expect(['owner', 'mgr', 'mgrw'], 400, 403),
    '/api/customer-identities': expect(['owner'], 400, 403),
    '/api/sales/import': expect(management, 400, 403)
  };
  for (const [url, byRole] of Object.entries(postMatrix)) for (const id of everyone) check((await app.as(sessions[id])(url, {method: 'POST', body: {}})).status, byRole[id], `POST ${url} as ${id}`);

  // 3. Data scope. Customers are created through the real API; visits are inserted as stored recorder evidence.
  const admin = app.as(sessions.owner), ids = {};
  for (const [key, name, region, rep] of [['e1', 'شرق-1', 'الشرقية', 'rep1'], ['e2', 'شرق-2', 'الشرقية', 'rep2'], ['w1', 'غرب-1', 'الغربية', 'repw']]) {
    const created = await admin('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name, region, city: 'x', code: key, branch: 'الرئيسي', assignedTo: rep, phone: '0501234567', contact: 'م', customerType: 'مصنع', customerStatus: 'نشط'}}});
    check(created.status, 200, created.text);
    ids[key] = created.json().id;
  }
  const stamp = new Date().toISOString();
  async function visit(id, customer, author) {
    await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'activity',?,?,'الرئيسي',?,?,?,1,'fixture')")
      .bind(id, customer, author, JSON.stringify({type: 'visit', date: day, summary: 's', result: 'تم الشراء', salesStage: 'new', visitWorkflow: 'visit-v2', performedBy: author, responsibleId: author, recordedByEmail: author + '@yourrest.org'}), stamp, stamp).run();
  }
  await visit('v-rep1', ids.e1, 'rep1'); await visit('v-rep2', ids.e2, 'rep2'); await visit('v-repw', ids.w1, 'repw'); await visit('v-rep2-on-e1', ids.e1, 'rep2');
  for (const [key, rep] of [['e1', 'rep1'], ['e2', 'rep2'], ['w1', 'repw']]) {
    const sale = await admin('/api/sales', {method: 'POST', body: {action: 'save', createKey: crypto.randomUUID(), data: {customerId: ids[key], repId: rep, date: day, reference: 'INV-' + key, items: [{product: 'قوالب البلوك المتحركة', description: '', quantity: 3, unitPrice: 1000}], discount: 0, notes: ''}}});
    check(sale.status, 200, sale.text);
  }
  const names = records => records.filter(r => r.kind === 'customer').map(r => r.data.name).sort();
  const visits = records => records.filter(r => r.kind === 'activity').map(r => r.id).sort();
  const expectedScope = {
    owner: {customers: ['شرق-1', 'شرق-2', 'غرب-1'], visits: ['v-rep1', 'v-rep2', 'v-rep2-on-e1', 'v-repw'], invoices: ['INV-e1', 'INV-e2', 'INV-w1']},
    mgr: {customers: ['شرق-1', 'شرق-2', 'غرب-1'], visits: ['v-rep1', 'v-rep2', 'v-rep2-on-e1', 'v-repw'], invoices: ['INV-e1', 'INV-e2', 'INV-w1']},
    mgrw: {customers: ['غرب-1'], visits: ['v-repw'], invoices: ['INV-w1']},
    sup: {customers: ['شرق-1', 'شرق-2', 'غرب-1'], visits: ['v-rep1'], invoices: ['INV-e1']},
    rep1: {customers: ['شرق-1', 'شرق-2'], visits: ['v-rep1']},
    rep2: {customers: ['شرق-1', 'شرق-2'], visits: ['v-rep2', 'v-rep2-on-e1']},
    repw: {customers: ['غرب-1'], visits: ['v-repw']},
    csm: {customers: ['شرق-1', 'شرق-2', 'غرب-1'], visits: []},
    cs: {customers: ['شرق-1', 'شرق-2', 'غرب-1'], visits: []}
  };
  for (const id of everyone) {
    const call = app.as(sessions[id]), crm = (await call('/api/crm')).json(), expected = expectedScope[id];
    check(names(crm.records), expected.customers, id + ' customers');
    check(visits(crm.records), expected.visits, id + ' visits');
    check(crm.members.some(m => m.id !== id && reps.includes(id)), false, id + ' sees no other member');
    const sales = await call('/api/sales?month=' + month);
    if (expected.invoices) check(sales.json().sales.map(s => s.reference).sort(), expected.invoices, id + ' invoices');
  }
  // Manager and supervisor roll-ups follow explicit reporting links, never wider visibility.
  const performance = async id => Object.fromEntries((await app.as(sessions[id])('/api/sales?month=' + month)).json().performance.map(p => [p.member.id, p.invoices]));
  check(await performance('mgr'), {mgr: 3, sup: 1, rep1: 1, rep2: 1, repw: 1}, 'manager roll-up');
  check(await performance('sup'), {sup: 1, rep1: 1}, 'supervisor roll-up');

  // 4. A representative cannot write commercial records even with a well-formed request.
  const rep = app.as(sessions.rep1);
  check((await rep('/api/sales', {method: 'POST', body: {action: 'save', createKey: crypto.randomUUID(), data: {customerId: ids.e1, repId: 'rep1', date: day, reference: 'INV-forbidden', items: [{product: 'قوالب البلوك المتحركة', description: '', quantity: 1, unitPrice: 10}], discount: 0, notes: ''}}})).status, 403, 'rep cannot create a sale');
  const quote = await rep('/api/crm', {method: 'POST', body: {action: 'save', kind: 'quote', data: {}}});
  check(quote.status, 403, 'rep cannot create quotes');
  check((await rep('/api/crm', {method: 'POST', body: {action: 'member', data: {name: 'x', email: 'x@yourrest.org', role: 'admin', branch: 'b', active: 1, target: 0}}})).status, 403, 'rep cannot manage members');
  const manager = app.as(sessions.mgr);
  check((await manager('/api/crm', {method: 'POST', body: {action: 'member', data: {name: 'x', email: 'x@yourrest.org', role: 'admin', branch: 'b', active: 1, target: 0}}})).status, 403, 'manager cannot manage members');
  const rows = await app.db.prepare("SELECT COUNT(*) AS n FROM crm_sales WHERE reference='INV-forbidden'").first();
  check(rows.n, 0, 'rejected writes leave no rows');
  assert(!/at .*node_modules|stack/i.test(app.log().replace(/ExperimentalWarning[^\n]*/g, '')), 'Server log must not contain stack traces for rejected requests');checks++;

  console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true, productionDataUsed: false}));
} finally {
  await app.stop();
}

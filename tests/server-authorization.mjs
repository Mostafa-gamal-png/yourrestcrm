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
  const protectedGets = ['/api/crm', '/api/team-today', '/api/sales?month=' + month, '/api/targets?month=' + month, '/api/customer-service', '/api/journeys', '/api/mobile-route', '/api/mold-requests', '/api/mold-requests/design-file?id=x&file=y', '/api/mold-requests/design-file?order=1&file=y', '/api/device-status', '/api/kpi-evidence?memberId=rep1&month=' + month, '/api/customer-identities', '/api/sales/import', '/api/visit-files?id=x', '/api/service-report', '/api/service-queue/alerts', '/api/support', '/api/complaints', '/api/complaint-report', '/api/service-kpi?month=' + month, '/api/trash', '/api/reviews?date=' + day, '/api/review-inbox'];
  for (const url of protectedGets) check((await anonymous(url)).status, 401, 'anonymous GET ' + url);
  check((await anonymous('/api/app-update')).status, 200, 'update metadata is public by design');
  const posts = ['/api/crm', '/api/sales', '/api/targets', '/api/kpis', '/api/visits', '/api/followups', '/api/customer-followups', '/api/customer-service', '/api/support', '/api/complaints', '/api/service-kpi', '/api/journeys', '/api/mobile-route', '/api/mold-requests', '/api/mold-requests/design-files', '/api/mold-requests/design-files/delete', '/api/device-status', '/api/kpi-evidence', '/api/visit-files', '/api/customer-identities', '/api/erp-customers', '/api/customer-address', '/api/customers/import', '/api/machines/import', '/api/sales/import', '/api/trash', '/api/reviews', '/api/review-inbox'];
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
    '/api/mold-requests': expect(everyone, 200, 403),
    // A mold request's design file: every role may read the requests it may see (an unknown request is 404 for all); by order number
    // only the sales managers (no production link here: their pending list cannot be had, so 503 «the link is off»).
    '/api/mold-requests/design-file?id=x&file=y': expect(everyone, 404, 403),
    '/api/mold-requests/design-file?order=1&file=y': expect(['mgr', 'mgrw'], 503, 403),
    '/api/device-status': expect(management, 200, 403),
    '/api/customer-identities': expect(['owner'], 200, 403),
    '/api/sales/import': expect(management, 200, 403),
    '/api/service-report': expect(['owner', 'mgr', 'mgrw', 'csm'], 200, 403),
    '/api/service-queue/alerts': expect(everyone, 200, 0),
    '/api/support': expect(everyone, 200, 0),
    '/api/complaints': expect(everyone, 200, 0),
    '/api/complaint-report': expect(['owner', 'mgr', 'mgrw', 'csm'], 200, 403),
    ['/api/service-kpi?month=' + month]: expect(['owner', 'csm', 'cs'], 200, 403),
    // «المحذوفات» (2026-11-09): the administrator (all deletions) and the sales managers (their own); since 2026-11-10 also whoever has a
    // «حذف» cell on (none here yet: off by default), and anyone else gets 404 as for a hidden screen (never 403, which locks the offline session).
    '/api/trash': expect(['owner', 'mgr', 'mgrw'], 200, 404),
    // The supervisor's notes (2026-11-09): those of a day report for the roles that open it; everyone reads their own unread notes.
    ['/api/reviews?date=' + day]: expect(management, 200, 403),
    '/api/review-inbox': expect(everyone, 200, 0),
    // «فريقي النهارده» (2026-11-10): the roles that open «تقرير يوم المندوب»; a representative and customer service are refused.
    '/api/team-today': expect(management, 200, 403)
  };
  for (const [url, byRole] of Object.entries(getMatrix)) for (const id of everyone) check((await app.as(sessions[id])(url)).status, byRole[id], `GET ${url} as ${id}`);
  // KPI evidence is read per member; ask each management role about a member inside its own scope.
  const kpiSubject = {owner: 'rep1', mgr: 'rep1', mgrw: 'repw', sup: 'rep1'};
  for (const id of everyone) check((await app.as(sessions[id])('/api/kpi-evidence?memberId=' + (kpiSubject[id] || 'rep1') + '&month=' + month)).status, management.includes(id) ? 200 : 403, 'GET kpi-evidence as ' + id);
  const postMatrix = {
    '/api/crm': expect([...management, ...reps], 400, 403),
    '/api/support': expect(everyone, 400, 0),
    '/api/complaints': expect(everyone, 400, 0),
    '/api/service-kpi': expect(everyone, 400, 0),
    '/api/sales': expect(management, 400, 403),
    '/api/targets': expect(['owner', 'mgr', 'mgrw'], 400, 403),
    '/api/kpis': expect(['owner', 'mgr', 'mgrw'], 400, 403),
    '/api/journeys': expect([...management, ...reps], 400, 403),
    '/api/mobile-route': expect([...management, ...reps], 400, 403),
    '/api/mold-requests': expect(everyone, 400, 403),
    // Design files: the upload takes multipart only (415 once the role has passed); the deletion validates its JSON (400).
    '/api/mold-requests/design-files': expect(everyone, 415, 403),
    '/api/mold-requests/design-files/delete': expect(everyone, 400, 403),
    '/api/device-status': expect(reps, 400, 403),
    '/api/kpi-evidence': expect(['owner', 'mgr', 'mgrw'], 400, 403),
    '/api/customer-identities': expect(['owner'], 400, 403),
    // «استيراد من ERP»: the administrator and the sales managers (each limited to their regions' customers by the route itself).
    '/api/erp-customers': expect(['owner', 'mgr', 'mgrw'], 400, 403),
    '/api/sales/import': expect(management, 400, 403),
    '/api/trash': expect(['owner', 'mgr', 'mgrw'], 400, 404),
    '/api/reviews': expect(management, 400, 403),
    '/api/review-inbox': expect(everyone, 400, 0)
  };
  for (const [url, byRole] of Object.entries(postMatrix)) for (const id of everyone) check((await app.as(sessions[id])(url, {method: 'POST', body: {}})).status, byRole[id], `POST ${url} as ${id}`);
  // A signed-in member's write from another site is refused before anything is read (the design files' routes, 2026-11-02).
  for (const url of ['/api/mold-requests', '/api/mold-requests/design-files', '/api/mold-requests/design-files/delete', '/api/trash', '/api/reviews', '/api/review-inbox']) for (const origin of ['https://evil.example', null]) {
    const headers = origin ? {Origin: origin} : {Origin: ''};
    check((await app.as(sessions.rep1)(url, {method: 'POST', body: {}, headers})).status, 403, `POST ${url} from ${origin || 'no origin'}: 403`);
  }

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
  // 5. Adding customers (the owner, 2026-11-07): customer service picks an existing customer and never adds one, by any route;
  // sales and the administrator keep adding; customer service keeps registering requests on existing customers.
  const refused = 'إضافة العملاء مش متاحة لخدمة العملاء؛ اختار عميل موجود أو اطلب من المبيعات يضيفه.';
  const customerTotal = async () => (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind='customer'").first()).n;
  for (const id of everyone) {
    const before = await customerTotal(), service = id === 'cs' || id === 'csm';
    const added = await app.as(sessions[id])('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name: 'إضافة ' + id, region: id === 'repw' || id === 'mgrw' ? 'الغربية' : 'الشرقية', branch: 'الرئيسي', assignedTo: ['owner', 'csm', 'cs'].includes(id) ? 'rep1' : id}}});
    check(added.status, service ? 403 : 200, 'POST /api/crm customer create as ' + id + ': ' + added.text);
    if (service) check(added.json().error, refused, id + ' is told why');
    check(await customerTotal(), before + (service ? 0 : 1), id + (service ? ' wrote no customer' : ' added one customer'));
  }
  const intake = {source: 'website', products: ['قوالب البلوك المتحركة'], strength: 'strong', needs: 'احتياج', nextAction: 'تحديد المواصفات', nextDate: day};
  for (const id of ['cs', 'csm', 'owner']) {
    const before = await customerTotal();
    const withNew = await app.as(sessions[id])('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), newCustomer: {name: 'طلب بعميل جديد ' + id, phone: '0500000000', region: 'الشرقية'}, data: intake}});
    check(withNew.status, id === 'owner' ? 200 : 403, 'POST /api/customer-service with a new customer as ' + id + ': ' + withNew.text);
    if (id !== 'owner') check(withNew.json().error, refused, id + ' is told why (service request)');
    check(await customerTotal(), before + (id === 'owner' ? 1 : 0), id + ' service request customer count');
  }
  const existing = await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(ids.e2).first();
  const onExisting = await app.as(sessions.cs)('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: ids.e2, customerVersion: existing.version, data: intake}});
  check(onExisting.status, 200, 'customer service still registers a request on an existing customer: ' + onExisting.text);
  // Customer service corrects a customer's details like a representative; the responsible member, branch and delete stay out of reach.
  for (const id of ['cs', 'csm']) {
    const call = app.as(sessions[id]), current = async () => app.db.prepare('SELECT data,version,assigned_to,branch FROM crm_records WHERE id=?').bind(ids.e1).first();
    let row = await current();
    const phone = id === 'cs' ? '0509999999' : '0508888888';
    const edit = await call('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: ids.e1, version: row.version, data: {...JSON.parse(row.data), phone, contact: 'تواصل ' + id}}});
    check(edit.status, 200, id + ' edits a customer\'s details: ' + edit.text);
    const saved = await current();
    check([JSON.parse(saved.data).phone, JSON.parse(saved.data).contact, saved.assigned_to, saved.branch], [phone, 'تواصل ' + id, row.assigned_to, row.branch], id + ' edit saved, routing kept');
    row = saved;
    const reassign = await call('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: ids.e1, version: row.version, data: {...JSON.parse(row.data), assignedTo: 'rep2'}}});
    check(reassign.status, 403, id + ' cannot reassign');
    const removed = await call('/api/crm', {method: 'POST', body: {action: 'delete', kind: 'customer', id: ids.e1, version: row.version}});
    check(removed.status, 403, id + ' cannot delete');
    check((await current()).version, row.version, id + ' refused writes change nothing');
  }

  // «الصلاحيات» (2026-11-09, migration 0020): only the administrator saves a member's permissions; a hidden screen's own requests answer
  // 404 (never 401/403, which lock the offline session) for that member only; a switched-off action is 403 with its message.
  const permissions = (as, memberId, version, input = {}) => app.as(sessions[as])('/api/crm', {method: 'POST', body: {action: 'permissions', memberId, version, cells: {}, hidden: [], viewAll: false, ...input}});
  for (const id of everyone.filter(id => id !== 'owner')) check((await permissions(id, 'rep1', 0, {hidden: ['mold-requests']})).status, 403, 'POST /api/crm permissions as ' + id);
  check(await app.db.prepare('SELECT COUNT(*) AS n FROM crm_member_permissions').first().then(row => row.n), 0, 'nothing saved by them');
  const savedRep = await permissions('owner', 'rep1', 0, {hidden: ['mold-requests'], cells: {'customer:add': false}});
  check(savedRep.status, 200, 'the administrator saves rep1\'s permissions: ' + savedRep.text);
  check((await permissions('owner', 'rep1', 0, {})).status, 409, 'a stale version: 409');
  const hiddenMold = await app.as(sessions.rep1)('/api/mold-requests');
  check([hiddenMold.status, hiddenMold.json().error], [404, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.'], 'rep1: «طلبات تصنيع القوالب» hidden: 404 with its message');
  check((await app.as(sessions.rep2)('/api/mold-requests')).status, 200, 'rep2 is unaffected');
  const addRefused = await app.as(sessions.rep1)('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name: 'عميل ممنوع', region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03', phone: '0500000001'}}});
  check([addRefused.status, addRefused.json().error], [403, 'مش مسموح لك بالإضافة في العملاء. راجع مدير النظام.'], 'rep1: adding a customer switched off: 403 with its message');
  check((await permissions('owner', 'sup', 0, {hidden: ['journeys']})).status, 200, 'the administrator hides «تقرير يوم المندوب» from the supervisor');
  for (const url of ['/api/journeys?date=' + day, '/api/reviews?date=' + day, '/api/device-status', '/api/team-today']) {
    check((await app.as(sessions.sup)(url)).status, 404, 'sup GET ' + url + ' hidden: 404');
    check((await app.as(sessions.mgr)(url)).status, 200, 'mgr GET ' + url + ' unaffected');
  }
  check((await app.as(sessions.sup)('/api/crm')).status, 200, 'GET /api/crm stays open whatever is hidden (every screen reads it)');
  check((await app.as(sessions.sup)('/api/crm')).json().me.access.hidden, ['journeys'], 'and carries the member\'s hidden screens');

  // «حذف» (the owner, 2026-11-09): off by default for every role but the administrator; the 403 names the screen. Customer service meets
  // /api/crm's own refusal. Granted, a representative deletes their own visit and nothing of another's.
  const visitVersion = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first())?.version;
  const removeAs = async (id, record, kind = 'activity') => app.as(sessions[id])('/api/crm', {method: 'POST', body: {action: 'delete', kind, id: record, version: await visitVersion(record)}});
  for (const id of ['mgr', 'sup', 'rep1']) {
    const refused = await removeAs(id, 'v-rep1');
    check([refused.status, refused.json().error], [403, 'مش مسموح لك بالحذف في الزيارات. راجع مدير النظام.'], id + ': deleting a visit is off by default');
  }
  for (const id of ['cs', 'csm']) check((await removeAs(id, 'v-rep1')).status, 403, id + ': no delete through /api/crm');
  const sale1 = await app.db.prepare("SELECT id,version FROM crm_sales WHERE reference='INV-e1'").first();
  for (const id of ['mgr', 'sup']) {
    const voided = await app.as(sessions[id])('/api/sales', {method: 'POST', body: {action: 'void', id: sale1.id, version: sale1.version, reason: 'تجربة'}});
    check([voided.status, voided.json().error], [403, 'مش مسموح لك بالحذف في المبيعات. راجع مدير النظام.'], id + ': voiding a sale is off by default');
  }
  check(await visitVersion('v-rep1'), 1, 'nothing deleted');
  const repVersion = (await app.db.prepare("SELECT version FROM crm_member_permissions WHERE member_id='rep1'").first()).version;
  check((await permissions('owner', 'rep1', repVersion, {hidden: ['mold-requests'], cells: {'customer:add': false, 'activity:delete': true}})).status, 200, 'the administrator grants rep1 «حذف» on visits');
  check((await removeAs('rep1', 'v-rep2-on-e1')).status, 404, 'rep1: another representative\'s visit on their customer is not theirs');
  check((await removeAs('rep1', 'v-rep1')).status, 200, 'rep1: their own visit is deleted');
  check(await visitVersion('v-rep1'), undefined, 'gone');
  check((await removeAs('rep2', 'v-rep2')).status, 403, 'rep2 is unaffected');
  // «المحذوفات» with «حذف» (the owner, 2026-11-10): rep1 now sees their own deletion and restores it; rep2 (no «حذف») still 404.
  const repTrash = await app.as(sessions.rep1)('/api/trash');
  check([repTrash.status, repTrash.json().scope, repTrash.json().items.map(item => [item.recordId, item.blocked])], [200, 'own', [['v-rep1', null]]], 'rep1 granted «حذف»: «المحذوفات» with their own deletion');
  for (const id of ['rep2', 'sup', 'cs']) check([(await app.as(sessions[id])('/api/trash')).status, (await app.as(sessions[id])('/api/trash', {method: 'POST', body: {}})).status], [404, 404], id + ' without «حذف»: still 404');
  const deletedRep1 = await app.db.prepare("SELECT id FROM crm_audit WHERE record_id='v-rep1' AND action='حذف'").first();
  check((await app.as(sessions.rep2)('/api/trash', {method: 'POST', body: {auditId: deletedRep1.id, requestId: crypto.randomUUID()}})).status, 404, 'rep2 cannot restore it');
  const repRestored = await app.as(sessions.rep1)('/api/trash', {method: 'POST', body: {auditId: deletedRep1.id, requestId: crypto.randomUUID()}});
  check([repRestored.status, repRestored.json().type, await visitVersion('v-rep1')], [200, 'visit', 2], 'rep1 restores their own visit');
  const repVersion2 = (await app.db.prepare("SELECT version FROM crm_member_permissions WHERE member_id='rep1'").first()).version;
  check((await permissions('owner', 'rep1', repVersion2, {hidden: ['mold-requests'], cells: {'customer:add': false}})).status, 200, 'the administrator takes «حذف» back');
  check((await app.as(sessions.rep1)('/api/trash')).status, 404, 'rep1 without «حذف» again: 404');
  const extra = await admin('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name: 'للحذف', region: 'الشرقية', city: 'x', code: 'del-1', branch: 'الرئيسي', assignedTo: 'rep2', phone: '0501234567', contact: 'م', customerType: 'مصنع', customerStatus: 'نشط'}}});
  check((await removeAs('owner', extra.json().id, 'customer')).status, 200, 'the administrator deletes by default');

  assert(!/at .*node_modules|stack/i.test(app.log().replace(/ExperimentalWarning[^\n]*/g, '')), 'Server log must not contain stack traces for rejected requests');checks++;

  console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true, productionDataUsed: false}));
} finally {
  await app.stop();
}

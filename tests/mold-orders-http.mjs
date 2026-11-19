// The requests that exist only in the products application (the owner, 2026-11-19), over real HTTP against the BUILT release (run the build
// first), with the stand-in production API (scripts/lib/products-mock.mjs) serving its `orders` route:
// - every role's GET /api/mold-requests?refs=1&orders=1 carries exactly the orders the CRM's rule gives it (canReadMoldRequest on the
//   salesman production names and the customer as the CRM finds it: by its Yourrest number, or its ERP code): the administrator all, a
//   representative his own only, another representative his, the supervisor his representatives' in his regions, the customer-service
//   manager and customer service their team's, each sales manager his team's and what he would approve, a manager of every region what
//   no team holds and an order whose customer the CRM does not know; the CRM's own requests exactly as without orders=1;
// - the orders read-only (no action offered), production's data and status, the CRM member when it knows the salesman, files through
//   ?ref=; every page read (three of three) and kept a minute (no second call for the next readers); an item production sent that cannot be
//   read left out and counted for the administrator only;
// - a page loaded before this release (no orders=1) gets nothing of them, and production is not asked for them;
// - the files: an order's file downloaded by whoever may read the order (its representative, his sales manager, the customer-service
//   manager, the administrator), refused to anyone else as before (403 for whoever approves nothing; 404 for a manager it is neither in
//   his list nor waiting for him), a file of another order refused, a made-up reference refused;
// - the products application before its release (404 unknown_route): the page as before (orders null, the list unchanged), production
//   asked once and not again; a file by ?ref= refused as before;
// - production unreachable at the first pull: the list answers at once, with the orders' reason and none of them.
// Synthetic fixtures only: temporary SQLite, the stand-in production, no production data; the shared secret is never printed.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const linkTo = mock => ({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca});
const now = new Date().toISOString();
async function customer(app, id, assignedTo, region, code) {
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', address: 'حي الصناعية', phone: '0551234567', code, branch: 'الرئيسي', assignedTo}), now, now).run();
  return (await app.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number;
}
const ordersCalls = mock => mock.state.calls.filter(call => call.route === 'orders').length;

// ---- 1. The products application with the route: every role
{
  const members = [
    {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager', region: 'eastern'}, {id: 'sm2', role: 'manager', region: 'eastern'}, {id: 'smAll', role: 'manager'},
    {id: 'sup', role: 'supervisor', sup: 'sm', region: 'eastern'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أنور عبد الحكيم'}, {id: 'rep2', role: 'rep', sup: 'sm2', region: 'eastern'},
    {id: 'csm', role: 'customer_service_manager', sup: 'sm', region: 'eastern'}, {id: 'cs', role: 'customer_service', sup: 'csm', region: 'eastern'},
  ];
  const mock = await startProductsMock({requestRefs: true, quotePo: true, orders: true});
  const app = await bootBuiltApp({members}, {env: linkTo(mock)});
  try {
    const east = await customer(app, 'east1', 'rep', 'الشرقية', 'ERP-east1'), west = await customer(app, 'west1', 'rep2', 'الغربية', 'ERP-west1');
    // The orders, as production holds them (three a page, as the route pages them; nine items, one of them unreadable).
    mock.setOrdersPageSize(3);
    const order = (key, options) => [key, mock.registerManual({customerName: 'مصنع ' + key, description: 'order ' + key, ...options})];
    const O = Object.fromEntries([
      order('rep', {salesmanId: 'rep', salesmanName: 'أنور عبد الحكيم', customerNo: east, requestedAt: '2026-11-18T09:00:00.000Z'}),
      order('rep2', {salesmanId: 'rep2', salesmanName: 'rep2', customerNo: east, requestedAt: '2026-11-17T09:00:00.000Z'}),
      order('cancelled', {salesmanId: 'rep', customerNo: east, requestedAt: '2026-11-15T09:00:00.000Z'}),
      order('none', {salesmanId: '', salesmanName: 'مندوب غير معروف', customerErpCode: 'ERP-east1', requestedAt: '2026-11-10T09:00:00.000Z'}),
      order('making', {salesmanId: 'rep', customerNo: east, requestedAt: '2026-11-08T09:00:00.000Z', moldNo: 'YR-14'}),
      order('cs', {salesmanId: 'cs', customerNo: east, requestedAt: '2026-11-05T09:00:00.000Z'}),
      order('west', {salesmanId: 'rep', customerNo: west, requestedAt: '2026-11-02T09:00:00.000Z'}),
    ]);
    O.legacy = mock.registerLegacy({customerName: 'مصنع الشيت', customerErpCode: 'OLD-77', description: 'order legacy', moldSerial: 'YR-SHEET-07'});
    mock.cancelHere(O.cancelled.requestRef);
    for (const step of ['sales', 'production', 'admin']) mock.approve(O.making.requestRef, step);
    Object.assign(O.making, {moldSerial: '049 / 050', stages: {...O.making.stages, laserCutting: {done: true, at: '2026-11-11'}, box: {done: true, at: '2026-11-12'}}});
    const files = {rep: mock.addProductionFile(O.rep.requestRef, {name: 'تصميم المندوب.pdf', bytes: Buffer.from('%PDF-1.4 rep drawing')}), making: mock.addProductionFile(O.making.requestRef, {name: 'عرض السعر.pdf', bytes: Buffer.from('%PDF-1.4 quote of making'), category: 'quote'}),
      cs: mock.addProductionFile(O.cs.requestRef, {name: 'تصميم خدمة العملاء.png', bytes: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3b30000000049454e44ae426082', 'hex')}),
      legacy: mock.addProductionFile(O.legacy.requestRef, {name: 'شيت.pdf', bytes: Buffer.from('%PDF-1.4 sheet')})};
    mock.addRawOrder({requestRef: 'not-a-uuid', source: 'manual', status: 'received', editable: true});
    // One of the CRM's own requests (the representative's, kept in the CRM), so the list holds both.
    const crmData = {requestedAt: '2026-11-12T09:00:00.000Z', customer: {crmNumber: east, name: 'مصنع east1', address: 'حي الصناعية', city: 'Damam - الدمام'}, salesman: {crmMemberId: 'rep', name: 'أنور عبد الحكيم', email: 'rep@yourrest.org'},
      specs: {description: 'crm order', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'C-1', quantity: 1, designUrl: '', notes: ''}, payment: 'cash'};
    await app.db.prepare('INSERT INTO crm_mold_requests(id,member_id,customer_id,data,created_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,1)').bind('mr-crm-1', 'rep', 'east1', JSON.stringify(crmData), 'rep', now, now).run();

    const sessions = {};
    for (const member of members) sessions[member.id] = await app.login(member.id);
    const get = (who, query) => app.as(sessions[who])('/api/mold-requests' + query);
    const keyOf = Object.fromEntries(Object.entries(O).map(([key, row]) => [row.requestRef, key]));
    const keys = answer => answer.orders.items.map(item => keyOf[item.requestRef]);

    // The first reader's page pulls every page once; the next readers within the minute ask nothing more.
    const first = await get('owner', '?refs=1&orders=1'), owner = await first.json();
    check([first.status, ordersCalls(mock), owner.orders.error, owner.orders.unreadable, owner.orders.truncated], [200, 3, null, 1, undefined], 'the administrator: three pages read, one item that cannot be read counted for him');
    check(keys(owner), ['rep', 'rep2', 'cancelled', 'none', 'making', 'cs', 'west', 'legacy'], 'the administrator: every order, newest asked for first');
    check(owner.requests.map(view => view.id), ['mr-crm-1'], 'and the CRM\'s own request, as before');
    const seen = {};
    for (const who of ['rep', 'rep2', 'sup', 'sm', 'sm2', 'smAll', 'csm', 'cs']) { const res = await get(who, '?refs=1&orders=1'); check(res.status, 200, who + ': 200'); seen[who] = await res.json(); }
    check(ordersCalls(mock), 3, 'kept a minute: the eight other readers asked production nothing');
    check(keys(seen.rep), ['rep', 'cancelled', 'making', 'west'], 'a representative: only the orders production names him on (his western customer\'s too)');
    check(keys(seen.rep2), ['rep2'], 'another representative: his own only, never the first one\'s');
    check(keys(seen.sup), ['rep', 'cancelled', 'making'], 'the supervisor: his representative\'s, within his regions');
    check(keys(seen.sm), ['rep', 'cancelled', 'none', 'making', 'cs'], 'the sales manager: his team\'s in his regions, and what he would approve (no salesman the CRM knows, customer service\'s); not the other manager\'s team');
    check(keys(seen.sm2), ['rep2', 'none', 'cs'], 'the other manager of the region: his team\'s and what he would approve; never the first manager\'s team');
    check(keys(seen.smAll), ['none', 'cs', 'west', 'legacy'], 'a manager of every region: no team\'s, a team\'s its manager cannot approve (a western customer), and the order whose customer the CRM does not know');
    check([keys(seen.csm), keys(seen.cs)], [['cs'], ['cs']], 'the customer-service manager and customer service: their team\'s');
    check(Object.values(seen).map(answer => answer.orders.unreadable), Array(8).fill(undefined), 'nobody but the administrator is told of what could not be read');
    check(seen.rep.requests.map(view => view.id), ['mr-crm-1'], 'the representative\'s own CRM request as before');

    // The view: read-only, production's data and status, the CRM member, files through ?ref=.
    const making = seen.rep.orders.items.find(item => keyOf[item.requestRef] === 'making'), legacy = owner.orders.items.find(item => keyOf[item.requestRef] === 'legacy');
    check([making.id, making.source, making.memberId, making.memberName, making.can, making.sending, making.cancelled, making.customerName, making.crmNumber, making.specs.moldNo, making.requestedAt],
      ['order:' + O.making.requestRef, 'manual', 'rep', 'أنور عبد الحكيم', {approve: false}, {state: 'sent'}, false, 'مصنع making', east, 'YR-14', '2026-11-08T12:00:00+03:00'], 'an order: read-only, its CRM member, its customer and time asked as production sends them');
    check([making.remote.status, making.remote.waitingStep, making.remote.moldSerial, making.remote.stagesDone, !!making.remote.approvals.sales && !!making.remote.approvals.production && !!making.remote.approvals.admin, Number.isInteger(making.remote.orderNo)],
      ['in_production', 'manufacturing', '049 / 050', 2, true, true], 'and production\'s status: approved, numbered, in production at manufacturing, two stages, its serial');
    check(making.quoteFiles.map(file => [file.name, file.href]), [['عرض السعر.pdf', '/api/mold-requests/design-file?ref=' + O.making.requestRef + '&file=' + files.making.fileId]], 'its file through the CRM by its reference');
    check([legacy.source, legacy.memberId, legacy.memberName, legacy.remote.delivered, legacy.remote.approvals.required, legacy.crmNumber], ['legacy', '', 'مندوب قديم', true, false, null], 'a legacy order: delivered, needing no approval, its salesman by production\'s name');
    check(seen.rep.orders.items.find(item => keyOf[item.requestRef] === 'cancelled').remote.status, 'cancelled', 'a cancelled one, listed');

    // A page loaded before this release asks without orders=1: nothing of them, the rest the same.
    const before = await (await get('rep', '?refs=1')).json();
    check(['orders' in before, before.requests.map(view => view.id), before.pending], [false, ['mr-crm-1'], null], 'a page loaded before: no orders, its list as it was');
    const smBefore = await (await get('sm', '?refs=1')).json(), smNow = seen.sm;
    check([smBefore.pending.items.map(item => item.requestRef || item.crmRequestId).sort(), 'orders' in smBefore], [smNow.pending.items.map(item => item.requestRef || item.crmRequestId).sort(), false], '«طلبات بانتظار اعتمادي» is the same with or without the orders');
    const sheet = await get('rep', '?id=mr-crm-1&orders=1');
    check([sheet.status, 'orders' in (await sheet.json())], [200, false], '?id= never carries the orders');

    // The files of an order: whoever may read it; anyone else as before.
    const download = (who, ref, fileId, inline = false) => app.as(sessions[who])('/api/mold-requests/design-file?ref=' + ref + '&file=' + fileId + (inline ? '&inline=1' : ''));
    let res = await download('rep', O.making.requestRef, files.making.fileId);
    check([res.status, res.bytes.toString(), res.headers['content-type'], /attachment/.test(res.headers['content-disposition'])], [200, '%PDF-1.4 quote of making', 'application/pdf', true], 'the representative downloads his order\'s file');
    res = await download('rep', O.making.requestRef, files.making.fileId, true);
    check([res.status, /^inline/.test(res.headers['content-disposition'])], [200, true], 'and opens it in the browser');
    check([(await download('sm', O.making.requestRef, files.making.fileId)).status, (await download('owner', O.legacy.requestRef, files.legacy.fileId)).status, (await download('csm', O.cs.requestRef, files.cs.fileId)).status, (await download('smAll', O.legacy.requestRef, files.legacy.fileId)).status],
      [200, 200, 200, 200], 'his sales manager, the administrator (a legacy order), the customer-service manager, the manager of every region: each an order of his list');
    res = await download('rep2', O.making.requestRef, files.making.fileId);
    check([res.status, res.json().error], [403, 'ملفات الطلبات بانتظار الاعتماد لمدير المبيعات'], 'another representative: refused as before');
    res = await download('sm2', O.making.requestRef, files.making.fileId);
    check([res.status, res.json().error], [404, 'الطلب لم يعد بانتظار اعتمادك. حدّث الصفحة.'], 'the other manager: neither in his list nor waiting for him, refused');
    res = await download('sm2', O.rep.requestRef, files.rep.fileId);
    check(res.status, 200, 'the other manager, an order waiting for the region\'s sales managers (the waiting list\'s own rule, unchanged)');
    res = await download('rep', O.making.requestRef, files.rep.fileId);
    check([res.status, res.json().error], [404, 'الملف غير متاح'], 'a file of another order, named on his: not served');
    res = await download('rep', '33333333-3333-4333-8333-333333333333', files.rep.fileId);
    check(res.status, 403, 'a made-up reference: refused as before');
    check([(await download('cs', O.rep.requestRef, files.rep.fileId)).status, (await download('sup', O.cs.requestRef, files.cs.fileId)).status], [403, 403], 'customer service and the supervisor: an order not theirs, refused');
    check((await app.request('/api/mold-requests/design-file?ref=' + O.making.requestRef + '&file=' + files.making.fileId)).status, 401, 'nobody signed in: 401');
    ok(!JSON.stringify(owner).includes(mock.state.secret), 'the shared secret is in no answer');
  } finally { await app.stop(); await mock.stop(); }
}

// ---- 2. The products application before its release (404 unknown_route): the page as before
{
  const members = [{id: 'owner', role: 'admin'}, {id: 'rep', role: 'rep', region: 'eastern'}];
  const mock = await startProductsMock({requestRefs: true});
  const app = await bootBuiltApp({members}, {env: linkTo(mock)});
  try {
    const east = await customer(app, 'east1', 'rep', 'الشرقية', 'ERP-east1');
    const manual = mock.registerManual({salesmanId: 'rep', customerNo: east});
    const sessions = {owner: await app.login('owner'), rep: await app.login('rep')};
    const get = (who, query) => app.as(sessions[who])('/api/mold-requests' + query);
    const oldPage = await (await get('owner', '?refs=1')).json();
    check([ordersCalls(mock), 'orders' in oldPage], [0, false], 'a page loaded before this release: production is not asked for the orders');
    const withOrders = await get('owner', '?refs=1&orders=1'), body = await withOrders.json();
    check([withOrders.status, body.orders, body.requests, ordersCalls(mock)], [200, null, oldPage.requests, 1], 'the route missing: orders null, the list exactly as before, production asked once');
    check(mock.state.calls.filter(call => call.route === 'orders').at(-1).answer.http, 404, 'production answered 404 unknown_route');
    check([(await (await get('rep', '?refs=1&orders=1')).json()).orders, (await (await get('owner', '?refs=1&orders=1')).json()).orders, ordersCalls(mock)], [null, null, 1], 'remembered: the next readers get the page as before, and production is not asked again');
    const res = await app.as(sessions.rep)('/api/mold-requests/design-file?ref=' + manual.requestRef + '&file=1');
    check(res.status, 403, 'a file by ?ref= for a representative: refused as before');
  } finally { await app.stop(); await mock.stop(); }
}

// ---- 3. Production unreachable at the first pull: the list answers, without the orders, with why
{
  const members = [{id: 'owner', role: 'admin'}];
  const mock = await startProductsMock({requestRefs: true, orders: true});
  const app = await bootBuiltApp({members}, {env: linkTo(mock)});
  try {
    mock.registerManual({description: 'unreachable'});
    const session = await app.login('owner');
    mock.state.down = true;
    const started = Date.now(), res = await app.as(session)('/api/mold-requests?refs=1&orders=1'), body = await res.json();
    check([res.status, body.orders.items, body.orders.error.code, body.requests], [200, [], 'network', []], 'production unreachable: the CRM\'s list, no orders, and why');
    ok(Date.now() - started < 10_000, 'the list does not wait for production beyond a failed call');
    mock.state.down = false;
    const again = await (await app.as(session)('/api/mold-requests?refs=1&orders=1')).json();
    check([again.orders.items, again.orders.error.code], [[], 'network'], 'within half a minute: the same failure, production not asked again');
  } finally { await app.stop(); await mock.stop(); }
}

console.log(JSON.stringify({ok: true, checks, scope: 'mold requests of the products application over HTTP: every role\'s orders, read-only views, paging and the minute\'s copy, the page before, the files, the route missing, production unreachable', productionDataUsed: false}));

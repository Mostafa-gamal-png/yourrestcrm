// The constant-time lookups that replace whole-list scans on every screen update must answer exactly what the scans answered.
// lib/record-index.ts against records.find / records.filter / the parent walk, and lib/customer-visits.ts customerPlanSources (one
// pass for every customer) against customerPlanSource called customer by customer, on random snapshots full of ties, duplicate
// ids, broken and too-deep parent chains, intakes, follow-ups and won or lost requests. Then customerVisitDue and
// customerFollowupPlans, which now use the one pass, against the per-customer definition, and the time both take on a snapshot
// the size of production (2,300 customers, 6,000 visits). No database, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {performance} from 'node:perf_hooks';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'record-index-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const src = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs')); fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(src, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, quote, imported) => {
    if (!imported.startsWith('.')) return match;
    let child = path.relative(root, path.resolve(path.dirname(src), imported));
    if (!/\.tsx?$/.test(child)) child += fs.existsSync(path.join(root, child + '.ts')) ? '.ts' : '.tsx';
    compile(child); return 'from ' + JSON.stringify(path.join(out, child.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
for (const file of ['lib/record-index.ts', 'lib/customer-visits.ts', 'lib/customer-followups.ts', 'lib/visit-list.ts', 'lib/customer-service.ts']) compile(file);
const {recordIndex} = await import(path.join(out, 'lib/record-index.mjs'));
const V = await import(path.join(out, 'lib/customer-visits.mjs'));
const F = await import(path.join(out, 'lib/customer-followups.mjs'));
const L = await import(path.join(out, 'lib/visit-list.mjs'));
const S = await import(path.join(out, 'lib/customer-service.mjs'));
const C = await import(path.join(out, 'lib/crm.mjs'));

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const same = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };

// A small deterministic generator, so a failure names a seed that reproduces it.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const day = (r, base = Date.UTC(2026, 8, 1)) => new Date(base + Math.floor(r() * 50) * 86400e3 + Math.floor(r() * 4) * 3600e3).toISOString();

function snapshot(seed, size) {
  const r = rng(seed), pick = list => list[Math.floor(r() * list.length)], rows = [];
  const add = (kind, parentId, data = {}) => {
    const created = day(r), updated = r() < .3 ? created : day(r);
    // Some ids repeat: the first in snapshot order is the one every lookup must return.
    const id = r() < .03 && rows.length ? pick(rows).id : kind[0] + rows.length;
    const row = {id, kind, parentId, assignedTo: pick(['rep', 'rep2', 'sup']), branch: 'b', data, createdAt: created, updatedAt: updated, version: 1};
    rows.push(row); return row;
  };
  const customers = Array.from({length: Math.max(2, Math.floor(size / 6))}, () => add('customer', null, {name: 'c', region: pick(['الشرقية', 'الغربية'])}));
  const machines = Array.from({length: Math.floor(size / 10)}, () => add('factory', pick(customers).id, {name: 'm'}));
  const requests = Array.from({length: Math.floor(size / 8)}, () => add('opportunity', pick([...customers, ...machines]).id, {hasRequest: r() < .8, stage: pick(['new', 'quoted', 'won', 'lost']), salesStage: pick(['', 'new', 'won']), followupStatus: pick(['open', 'closed'])}));
  for (const request of requests) if (r() < .4) add('quote', request.id, {number: 'q', status: pick(['draft', 'sent'])});
  for (const customer of customers) if (r() < .2) customer.data._serviceIntake = {id: 'intake', createdAt: day(r)};
  for (let i = 0; i < size; i++) {
    const parent = r() < .07 ? 'missing-' + i : pick([...customers, ...machines, ...requests]).id;
    add('activity', r() < .02 ? null : parent, {
      visitWorkflow: pick(['customer-v1', 'customer-v1', 'followup-v1', 'service-intake-v1', undefined]),
      requestId: r() < .4 ? pick(requests).id : undefined,
      salesStage: pick(['', 'new', 'won', 'lost', 'quoted']), stage: pick(['new', 'won']),
      followupStatus: pick(['open', 'closed', undefined]), nextDate: r() < .5 ? day(r).slice(0, 10) : '', nextAction: r() < .5 ? 'call' : '',
      date: day(r).slice(0, 10), offlineRecordedAt: r() < .1 ? day(r) : undefined, type: pick(['visit', 'call', 'quote']), hasQuotation: r() < .1
    });
  }
  // Chains deeper than the five records the walks give up after, and a parent cycle.
  const deep = add('customer', null, {name: 'deep'}); let parent = deep.id;
  for (let i = 0; i < 6; i++) parent = add(i % 2 ? 'opportunity' : 'factory', parent, {stage: 'new'}).id;
  add('activity', parent, {visitWorkflow: 'customer-v1'});
  const a = add('opportunity', 'cycle-b', {stage: 'new'}); a.id = 'cycle-a'; const b = add('opportunity', 'cycle-a', {stage: 'new'}); b.id = 'cycle-b';
  // Shuffle so snapshot order is not creation order.
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  return rows;
}

// 1. recordIndex answers what the scans answered.
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const rows = snapshot(seed, 240), index = recordIndex(rows);
  const ids = [...new Set(rows.map(row => row.id)), 'none', '', null, undefined];
  for (const id of ids) same(index.get(id), rows.find(row => row.id === id), `get ${id} (seed ${seed})`);
  for (const kind of ['customer', 'factory', 'opportunity', 'activity', 'quote']) eq(index.ofKind(kind), rows.filter(row => row.kind === kind), `ofKind ${kind}`);
  for (const id of ids) {
    eq(index.children(id), id === null || id === undefined ? [] : rows.filter(row => row.parentId === id), `children ${id}`);
    for (const kind of ['factory', 'opportunity', 'activity']) eq(index.children(id, kind), id === null || id === undefined ? [] : rows.filter(row => row.parentId === id && row.kind === kind), `children ${id} ${kind}`);
  }
  const walk = (row, kind, steps) => { let current = row; for (let i = 0; i < steps; i++) { if (!current || current.kind === kind) return current; current = rows.find(r => r.id === current.parentId); } return undefined; };
  for (const row of [...rows, undefined]) { same(index.ancestor(row, 'customer', 5), walk(row, 'customer', 5), 'customer of ' + row?.id); same(index.ancestor(row, 'factory', 4), walk(row, 'factory', 4), 'machine of ' + row?.id); }
  // The same arrays come back for the same question, and a snapshot is never changed.
  same(index.children(rows[0].id, 'activity'), index.children(rows[0].id, 'activity'), 'children are kept per snapshot');
}

// 1b. visitCustomer and visitRequest look parents up through a lookup kept per records array: the same answers as the scans.
{
  const customerOf = (row, records) => { for (let i = 0; row && i < 5; i++) { if (row.kind === 'customer') return row; row = records.find(r => r.id === row?.parentId); } return undefined; };
  const requestOf = (row, records) => { if (!row) return; const candidate = records.find(r => r.id === (row.data.requestId || row.parentId)); return candidate && C.isSalesRequest(candidate) ? candidate : undefined; };
  for (const seed of [51, 52, 53, 54, 55, 56]) {
    const rows = snapshot(seed, 220);
    for (const row of [...rows, undefined]) {
      same(V.visitCustomer(row, rows), customerOf(row, rows), `visitCustomer ${row?.id} (seed ${seed})`);
      same(V.visitRequest(row, rows), requestOf(row, rows), `visitRequest ${row?.id}`);
    }
    // A records array that grows (never done by the app) gets a fresh lookup.
    const grown = [...rows], orphan = rows.find(r => r.kind === 'activity' && r.parentId && !rows.some(p => p.id === r.parentId));
    if (orphan) { same(V.visitCustomer(orphan, grown), undefined, 'an orphan has no customer'); grown.push({id: orphan.parentId, kind: 'customer', parentId: null, data: {}, assignedTo: 'rep', branch: 'b', createdAt: '', updatedAt: '', version: 1}); same(V.visitCustomer(orphan, grown)?.id, orphan.parentId, 'the lookup follows a grown array'); }
  }
}

// 2. One pass for every customer = customerPlanSource customer by customer.
for (const seed of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
  const rows = snapshot(seed, 300), plans = V.customerPlanSources(rows);
  const customers = rows.filter(row => row.kind === 'customer');
  for (const customer of customers) same(plans.get(customer.id), V.customerPlanSource(customer.id, rows), `plan of ${customer.id} (seed ${seed})`);
  eq([...plans.keys()].sort(), [...new Set(customers.map(c => c.id))].sort(), 'a plan entry for each customer id');
  // The lists built on it give what they give with the per-customer definition, in the same order.
  const reference = new Map(customers.map(c => [c.id, V.customerPlanSource(c.id, rows)]));
  const dueNow = V.customerVisitDue(rows);
  eq(dueNow, V.customerVisitDue(rows, reference), 'customerVisitDue');
  eq(dueNow, customers.flatMap(c => { const source = V.customerPlanSource(c.id, rows); return source && !['won', 'lost'].includes(source.data.salesStage || source.data.stage || 'new') && source.data.followupStatus !== 'closed' ? [source] : []; }), 'customerVisitDue as defined');
  eq(F.customerFollowupPlans(rows), F.customerFollowupPlans(rows, reference), 'customerFollowupPlans');
}

// 2b. The visits list: one index for the customer of each visit and one order key per visit give the list the scans gave.
{
  // The list as it was written before: a scan for each visit's customer and the order computed twice per comparison.
  const before = (records, {query = '', staff = 'all', stage = 'all', workflow = 'all'}) => { const term = query.trim().toLowerCase(); return records.filter(r => r.kind === 'activity' && r.data.visitWorkflow !== 'followup-v1' && S.matchesServiceFilter(r, workflow) && (staff === 'all' || (r.data.performedBy || r.data.responsibleId) === staff) && (stage === 'all' || r.data.salesStage === stage) && (!term || [V.visitCustomer(r, records)?.data.name, r.data.summary, r.data.result, r.data.customerNeeds, r.data.competitorName, r.data.visitNumber, ...(r.data.requestedProducts || [])].join(' ').toLowerCase().includes(term))).sort((a, b) => V.visitOrder(b).localeCompare(V.visitOrder(a))); };
  for (const seed of [31, 32, 33, 34, 35, 36]) {
    const rows = snapshot(seed, 260);
    for (const row of rows) if (row.kind === 'activity') { row.data.summary = ['زيارة', 'اتصال بالمصنع', 'Call', ''][row.id.length % 4]; row.data.performedBy = ['rep', 'rep2'][row.id.length % 2]; }
    for (const row of rows) if (row.kind === 'customer') row.data.name = ['مصنع الأمل', 'Gulf', 'النور'][row.id.length % 3];
    for (const options of [{}, {query: 'مصنع'}, {query: ' gulf '}, {query: 'اتصال'}, {query: 'zzz'}, {staff: 'rep'}, {stage: 'won'}, {query: 'ال', staff: 'rep2', stage: 'new'}])
      eq(L.filterVisitRows(rows, options).map(r => r.id), before(rows, options).map(r => r.id), `visits list ${JSON.stringify(options)} (seed ${seed})`);
  }
}

// 2c. Whether a customer has a quotation in the current cycle, with one index per call, against the scans it replaced.
{
  const before = (customerId, records, service) => {
    const active = service || records.find(r => r.id === customerId)?.data._serviceIntake;
    const since = active?.id && active?.createdAt ? active.createdAt : '';
    const contacts = records.filter(r => r.kind === 'activity' && r.data.visitWorkflow !== 'service-intake-v1' && V.visitCustomer(r, records)?.id === customerId && (!since || r.createdAt >= since)).sort((a, b) => V.visitOrder(b).localeCompare(V.visitOrder(a)));
    let source = V.customerPlanSource(customerId, records); if (since && source && source.createdAt < since) source = undefined;
    const request = source?.kind === 'opportunity' ? source : V.visitRequest(source, records);
    const evidence = r => r.kind === 'quote' || r.data.type === 'quote' || r.data.salesStage === 'quoted' || r.data.stage === 'quoted' || r.data.hasQuotation === true;
    if (request) return records.some(r => (!since || r.createdAt >= since) && (r.id === request.id || r.kind === 'quote' && r.parentId === request.id || r.kind === 'activity' && V.visitRequest(r, records)?.id === request.id) && evidence(r));
    const current = contacts[0], previousClose = contacts.find(r => r.id !== current?.id && F.followupClosed(r.data.salesStage));
    const boundary = previousClose ? V.visitOrder(previousClose) : '';
    return contacts.some(r => (!boundary || V.visitOrder(r) > boundary) && evidence(r)) || records.some(r => r.kind === 'quote' && V.visitCustomer(r, records)?.id === customerId && (!since || r.createdAt >= since) && (!boundary || V.visitOrder(r) > boundary));
  };
  let yes = 0;
  for (const seed of [41, 42, 43, 44, 45, 46, 47, 48]) {
    const rows = snapshot(seed, 260);
    for (const customer of rows.filter(row => row.kind === 'customer')) {
      const now = F.customerHasQuotation(customer.id, rows); same(now, before(customer.id, rows), `quotation of ${customer.id} (seed ${seed})`); if (now) yes++;
      same(F.customerHasQuotation(customer.id, rows, {id: 's', createdAt: '2026-09-20T00:00:00.000Z'}), before(customer.id, rows, {id: 's', createdAt: '2026-09-20T00:00:00.000Z'}), `quotation since a request of ${customer.id}`);
    }
  }
  assert(yes > 20, 'the snapshots hold customers with and without a quotation'); checks++;
}

// 3. At the size of production the one pass is fast enough to run on every screen update.
{
  const r = rng(99), rows = [], customers = [];
  for (let i = 0; i < 2300; i++) { const c = {id: 'c' + i, kind: 'customer', parentId: null, assignedTo: 'rep', branch: 'b', data: {name: 'c' + i}, createdAt: day(r), updatedAt: day(r), version: 1}; rows.push(c); customers.push(c); }
  for (let i = 0; i < 6000; i++) rows.push({id: 'v' + i, kind: 'activity', parentId: customers[(i * 7919) % 2300].id, assignedTo: 'rep', branch: 'b', data: {visitWorkflow: 'customer-v1', salesStage: 'new', nextDate: '2026-10-01', nextAction: 'call'}, createdAt: day(r), updatedAt: day(r), version: 1});
  const t0 = performance.now(); const due = V.customerVisitDue(rows); const ms = performance.now() - t0;
  same(due.length > 0, true, 'some customers are due');
  assert(ms < 400, `customerVisitDue took ${Math.round(ms)} ms on 2,300 customers and 6,000 visits`); checks++;
  const t1 = performance.now(); recordIndex(rows); const indexMs = performance.now() - t1;
  assert(indexMs < 100, `recordIndex took ${Math.round(indexMs)} ms`); checks++;
  console.error(`production size: customerVisitDue ${Math.round(ms)} ms, recordIndex ${Math.round(indexMs)} ms`);
}

console.log(JSON.stringify({ok: true, checks, scope: 'record index and one-pass customer plans equal the scans they replace; production-size timing'}));

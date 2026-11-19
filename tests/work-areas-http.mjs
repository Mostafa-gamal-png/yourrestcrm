// «خريطة المصانع»: the representatives' work areas and the streets with no customer (lib/work-areas*.ts, migrations 0023 and 0024) over real
// HTTP against the BUILT release (`npm run build` first), with Overpass played by a local stand-in named in YR_OVERPASS_URL (nothing leaves
// this machine): every route with no session (401), with a role that has no right (customer service 403, a representative asking for another
// 403, a supervisor drawing 403, another team's or region's representative 403, a hidden map 404, a switched-off cell 403 in its words) and
// with the right role; the 500 m default around the representative's customers and its streets, the stand-in asked by the server only (its
// User-Agent), once per box (the cache), paused after 502; the local data first (no request); a drawn area saved, a save repeated after a cut
// connection writing nothing twice, a stale version 409, deleted; GET /api/crm without the work areas' audit rows. Synthetic fixtures only:
// temporary SQLite, mocked mail.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'mgrw', role: 'manager', region: 'western', name: 'مدير الغربية'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'mk1', role: 'marketing', sup: 'sup', region: 'eastern', name: 'مسؤول التسويق'},
  {id: 'repw', role: 'rep', sup: 'mgrw', region: 'western', name: 'مندوب الغربية'},
  {id: 'csm', role: 'customer_service_manager', name: 'مدير خدمة العملاء'},
  {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثل خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

// The stand-in for Overpass: one street beside the customers and one in empty land; it answers 502 when told to.
const requests = [];let busy = false;
const street = [[26.42973, 50.096], [26.42973, 50.104]], far = [[26.4335, 50.0985], [26.4335, 50.1015]];
const overpass = createServer((request, response) => {
  let body = '';request.on('data', part => body += part);
  request.on('end', () => {
    requests.push({method: request.method, agent: request.headers['user-agent'], query: decodeURIComponent(body.replace(/^data=/, '').replace(/\+/g, ' '))});
    if (busy) { response.writeHead(502, {'Content-Type': 'text/html'}); response.end('<h1>at capacity</h1>'); return; }
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({version: 0.6, elements: [
      {type: 'way', id: 1, tags: {highway: 'residential', name: 'شارع قريب', 'name:en': 'Near street'}, geometry: street.map(([lat, lon]) => ({lat, lon}))},
      {type: 'way', id: 2, tags: {highway: 'tertiary', 'name:en': 'Far street'}, geometry: far.map(([lat, lon]) => ({lat, lon}))}]}));
  });
});
overpass.listen(0, '127.0.0.1');await once(overpass, 'listening');
const overpassUrl = 'http://127.0.0.1:' + overpass.address().port + '/api/interpreter';

const app = await bootBuiltApp({members}, {env: {YR_OVERPASS_URL: overpassUrl}});
try {
  const now = new Date().toISOString();
  const insert = (id, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, 'customer', null, assigned, 'الرئيسي', JSON.stringify(data), now, now).run();
  await insert('cA', 'rep1', {name: 'مصنع أ', region: 'الشرقية', city: 'الدمام', phone: '0500000000', contact: 'أحمد', customerKind: 'مصنع', latitude: 26.43, longitude: 50.1, customerStatus: 'نشط'});
  await insert('cB', 'rep1', {name: 'مصنع ب', region: 'الشرقية', location: '26.432, 50.103'});
  await insert('cD', 'rep1', {name: 'مصنع خامل', region: 'الشرقية', location: '26.44, 50.11', customerStatus: 'خامل'});
  await insert('cW', 'repw', {name: 'مصنع الغرب', region: 'الغربية', location: '21.5, 39.2'});
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null);
  const json = async (response, status, label) => { eq(response.status, status, label + ' -> ' + response.text.slice(0, 300)); return response.json(); };
  const get = async (who, url, status = 200) => json(await (who ? session[who](url) : anonymous(url)), status, 'GET ' + url + ' as ' + who);
  const post = async (who, body, status = 200) => json(await (who ? session[who]('/api/work-areas', {method: 'POST', body: {request_id: crypto.randomUUID(), ...body}}) : anonymous('/api/work-areas', {method: 'POST', body})), status, 'POST ' + body.action + ' as ' + who);
  const square = (lat, lng, half) => ({type: 'Polygon', coordinates: [[[lng - half, lat - half], [lng + half, lat - half], [lng + half, lat + half], [lng - half, lat + half], [lng - half, lat - half]]]});

  // No session: 401 on every route (the release's verify routes).
  for (const url of ['/api/work-areas', '/api/work-areas?list=1', '/api/work-areas?member=rep1', '/api/work-area-streets', '/api/work-area-streets?member=rep1']) await get(null, url, 401);
  for (const body of [{}, {action: 'save', rep_id: 'rep1', polygon: square(26.43, 50.1, 0.01), version: null, request_id: crypto.randomUUID()}]) await post(null, body, 401);
  eq((await session.mgr('/api/work-areas', {method: 'POST', body: {}, headers: {Origin: 'https://evil.example'}})).status, 403, 'another origin');
  eq((await session.mgr('/api/work-area-streets?member=rep1', {method: 'POST', body: {}})).status, 405, 'the streets route reads only');
  // Customer service: no map.
  for (const who of ['cs', 'csm']) { await get(who, '/api/work-areas?list=1', 403); await get(who, '/api/work-area-streets?member=rep1', 403); await post(who, {action: 'delete', rep_id: 'rep1', version: 1}, 403); }
  // Who reads whom.
  eq((await get('mgr', '/api/work-areas?list=1')).reps.map(r => r.id), ['rep1', 'mk1', 'repw'], 'the sales manager of every region: every field member, by name');
  eq((await get('mgrw', '/api/work-areas?list=1')).reps.map(r => r.id), ['repw'], 'the western sales manager: the western representative only');
  eq((await get('sup', '/api/work-areas?list=1')).reps.map(r => r.id), ['rep1', 'mk1'], 'the supervisor: his team');
  eq((await get('rep1', '/api/work-areas?list=1')).reps.map(r => r.id), ['rep1'], 'a representative: himself');
  await get('rep1', '/api/work-areas?member=mk1', 403);await get('rep1', '/api/work-area-streets?member=repw', 403);await get('mgrw', '/api/work-areas?member=rep1', 403);await get('sup', '/api/work-areas?member=repw', 403);
  // The 500 m default and its streets, through the stand-in.
  let view = await get('rep1', '/api/work-areas?member=rep1');
  eq([view.area.source, view.area.radius, view.area.centers, view.can_edit], ['fallback', 500, [[26.43, 50.1], [26.432, 50.103]], false], 'his two customers that are not «خامل», 500 m around each; a representative never draws');
  let found = await get('rep1', '/api/work-area-streets?member=rep1');
  eq([found.status, found.clusters.total, requests.length], ['ready', 1, 1], 'one group, one request to the stand-in');
  ok(found.segments.length > 0 && found.segments.every(s => Object.keys(s).sort().join() === 'name,name_en,points'), 'the empty pieces: lines and street names only');
  ok(/^Yourrest-CRM/.test(requests[0].agent) && requests[0].method === 'POST' && /\[out:json\]/.test(requests[0].query) && /residential\|living_street/.test(requests[0].query), 'asked by the server, with its name, for the street kinds only');
  await get('mgr', '/api/work-area-streets?member=rep1');eq(requests.length, 1, 'the same box again: from the cache');
  // A drawn area outside the cache, while Overpass is «at capacity»: unavailable, and the service paused (asked once).
  busy = true;
  await post('sup', {action: 'save', rep_id: 'rep1', polygon: square(26.6, 50.0, 0.01), version: null}, 403);
  await post('rep1', {action: 'save', rep_id: 'rep1', polygon: square(26.6, 50.0, 0.01), version: null}, 403);
  await post('mgrw', {action: 'save', rep_id: 'rep1', polygon: square(26.6, 50.0, 0.01), version: null}, 403);
  await post('mgr', {action: 'save', rep_id: 'rep1', polygon: square(26.6, 50.0, 0.2), version: null}, 400);
  const first = crypto.randomUUID(), polygon = square(26.6, 50.0, 0.01);
  eq((await post('mgr', {action: 'save', rep_id: 'rep1', polygon, version: null, request_id: first})).version, 1, 'the sales manager draws rep1\'s area');
  eq(await post('mgr', {action: 'save', rep_id: 'rep1', polygon, version: null, request_id: first}), {ok: true, rep_id: 'rep1', version: 1, repeated: true}, 'the same save after a cut connection writes nothing twice');
  await post('owner', {action: 'save', rep_id: 'rep1', polygon, version: null}, 409);
  view = await get('rep1', '/api/work-areas?member=rep1');
  eq([view.area.source, view.area.version, view.area.updated_by_name, (await get('mgr', '/api/work-areas?list=1')).reps.find(r => r.id === 'rep1').drawn], ['drawn', 1, 'مدير المبيعات', true], 'the representative reads the drawn area');
  found = await get('rep1', '/api/work-area-streets?member=rep1');
  eq([found.status, requests.length], ['unavailable', 2], '502: unavailable');
  found = await get('rep1', '/api/work-area-streets?member=rep1');
  eq([found.status, requests.length], ['unavailable', 2], 'paused: not asked again for two minutes');
  // The local data first: once the area's cells are imported, nothing is asked.
  for (let y = 2659; y <= 2661; y++) for (let x = 4998; x <= 5001; x++) await app.db.prepare("INSERT INTO crm_osm_street_local VALUES(?,?,?,?,?,?,?,?,1,'eastern-1','osm:test',?)").bind([y, x, y + 1, x + 1].map(v => (v / 100).toFixed(2)).join(','), y, x, y / 100, x / 100, (y + 1) / 100, (x + 1) / 100, JSON.stringify({v: 1, ways: [['شارع محلي', 'Local street', y / 100 + 0.005, x / 100, y / 100 + 0.005, x / 100 + 0.01]]}), now).run();
  found = await get('mgr', '/api/work-area-streets?member=rep1');
  eq([found.status, found.fetched_at, requests.length], ['ready', now, 2], 'the imported cells answer: ready, dated by the import, nothing asked');
  ok(found.segments.length > 0 && found.segments.every(s => s.name === 'شارع محلي'), 'the local streets inside the drawn area');
  // A switched-off cell, a hidden map.
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('owner','{\"map:edit\":false}','[]',1,'owner',?)").bind(now).run();
  eq((await post('owner', {action: 'delete', rep_id: 'rep1', version: 1}, 403)).error, 'غير مسموح لك بالتعديل في خريطة المصانع. راجع مدير النظام.', 'the cell switched off: refused in its words');
  await app.db.prepare("DELETE FROM crm_member_permissions WHERE member_id='owner'").run();
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('sup','{}','[\"map\"]',1,'owner',?)").bind(now).run();
  await get('sup', '/api/work-areas?list=1', 404);await get('sup', '/api/work-area-streets?member=rep1', 404);
  await app.db.prepare("DELETE FROM crm_member_permissions WHERE member_id='sup'").run();
  // Deleted on its version.
  await post('mgr', {action: 'delete', rep_id: 'rep1', version: 2}, 409);
  eq(await post('mgr', {action: 'delete', rep_id: 'rep1', version: 1}), {ok: true, rep_id: 'rep1', version: null}, 'deleted');
  eq((await get('rep1', '/api/work-areas?member=rep1')).area.source, 'fallback', 'back to the default');
  eq((await app.db.prepare("SELECT action,actor FROM crm_audit WHERE action LIKE 'work-area:%' ORDER BY created_at,rowid").all()).results.map(row => [row.action, row.actor]), [['work-area:save', 'مدير المبيعات'], ['work-area:delete', 'مدير المبيعات']], 'one audit row per save and delete');
  ok(!(await get('owner', '/api/crm')).audits.some(row => String(row.action).startsWith('work-area:')), 'none in GET /api/crm\'s recent changes');
  console.log(JSON.stringify({ok: true, checks, overpassRequests: requests.length}));
} finally {
  await app.stop();
  overpass.close();
}

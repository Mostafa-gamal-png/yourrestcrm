// «خريطة المصانع»: the representatives' work areas (lib/work-areas*.ts, migration 0023) over real HTTP against the BUILT release (`npm run
// build` first): every route with no session (401), with a role that has no right (customer service 403, a representative asking for another
// 403, a supervisor drawing 403, another team's or region's representative 403, a hidden map 404, a switched-off cell 403 in its words) and
// with the right role; the 500 m default around the representative's customers; a drawn area saved, a save repeated after a cut connection
// writing nothing twice, a stale version 409, deleted; GET /api/crm without the work areas' audit rows. The purple streets were removed on
// 2026-11-21: GET /api/work-area-streets answers exactly as an address the application never had (with and without a session, GET and POST),
// and the release ships no street tool. Synthetic fixtures only: temporary SQLite, mocked mail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
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

const app = await bootBuiltApp({members});
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

  // No session: 401 on every route (the release's verify route).
  for (const url of ['/api/work-areas', '/api/work-areas?list=1', '/api/work-areas?member=rep1']) await get(null, url, 401);
  // The streets route is gone: it answers exactly as an address the application never had (the same status, type and page, the address
  // itself aside), with no session, signed in, read or written.
  const unknownPath = '/api/no-such-route-' + crypto.randomUUID().slice(0, 8);
  const shape = (response, asked) => ({status: response.status, type: (response.headers['content-type'] || '').split(';')[0], location: response.headers.location || '', page: createHash('sha256').update(response.text.split(asked).join('<path>')).digest('hex').slice(0, 16)});
  for (const [who, call] of [['nobody', anonymous], ['rep1', session.rep1], ['mgr', session.mgr], ['cs', session.cs]]) for (const query of ['', '?member=rep1']) {
    const unknown = shape(await call(unknownPath + query), unknownPath), gone = shape(await call('/api/work-area-streets' + query), '/api/work-area-streets');
    eq(gone, unknown, 'GET /api/work-area-streets' + query + ' as ' + who + ': as an unknown address (' + unknown.status + ' ' + unknown.type + ')');
    eq(shape(await call('/api/work-area-streets' + query, {method: 'POST', body: {}}), '/api/work-area-streets'), shape(await call(unknownPath + query, {method: 'POST', body: {}}), unknownPath), 'POST /api/work-area-streets' + query + ' as ' + who + ': as an unknown address');
  }
  eq((await anonymous('/api/work-area-streets?member=rep1')).status, 404, 'no session: 404, not 401 (the package must not verify it as 401)');
  eq(fs.readdirSync(path.join(process.cwd(), 'dist/standalone/operations')).filter(name => /street/i.test(name)), [], 'the release\'s operations ship no street import tool');
  for (const body of [{}, {action: 'save', rep_id: 'rep1', polygon: square(26.43, 50.1, 0.01), version: null, request_id: crypto.randomUUID()}]) await post(null, body, 401);
  eq((await session.mgr('/api/work-areas', {method: 'POST', body: {}, headers: {Origin: 'https://evil.example'}})).status, 403, 'another origin');
  // Customer service: no map.
  for (const who of ['cs', 'csm']) { await get(who, '/api/work-areas?list=1', 403); await post(who, {action: 'delete', rep_id: 'rep1', version: 1}, 403); }
  // Who reads whom.
  eq((await get('mgr', '/api/work-areas?list=1')).reps.map(r => r.id), ['rep1', 'mk1', 'repw'], 'the sales manager of every region: every field member, by name');
  eq((await get('mgrw', '/api/work-areas?list=1')).reps.map(r => r.id), ['repw'], 'the western sales manager: the western representative only');
  eq((await get('sup', '/api/work-areas?list=1')).reps.map(r => r.id), ['rep1', 'mk1'], 'the supervisor: his team');
  eq((await get('rep1', '/api/work-areas?list=1')).reps.map(r => r.id), ['rep1'], 'a representative: himself');
  await get('rep1', '/api/work-areas?member=mk1', 403);await get('mgrw', '/api/work-areas?member=rep1', 403);await get('sup', '/api/work-areas?member=repw', 403);
  // The 500 m default.
  let view = await get('rep1', '/api/work-areas?member=rep1');
  eq([view.area.source, view.area.radius, view.area.centers, view.can_edit], ['fallback', 500, [[26.43, 50.1], [26.432, 50.103]], false], 'his two customers that are not «خامل», 500 m around each; a representative never draws');
  eq(view.area.clusters, 1, 'one group, as a page of the previous release still reads it');
  // A drawn area.
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
  // A switched-off cell, a hidden map.
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('owner','{\"map:edit\":false}','[]',1,'owner',?)").bind(now).run();
  eq((await post('owner', {action: 'delete', rep_id: 'rep1', version: 1}, 403)).error, 'غير مسموح لك بالتعديل في خريطة المصانع. راجع مدير النظام.', 'the cell switched off: refused in its words');
  await app.db.prepare("DELETE FROM crm_member_permissions WHERE member_id='owner'").run();
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('sup','{}','[\"map\"]',1,'owner',?)").bind(now).run();
  await get('sup', '/api/work-areas?list=1', 404);
  await app.db.prepare("DELETE FROM crm_member_permissions WHERE member_id='sup'").run();
  // Deleted on its version.
  await post('mgr', {action: 'delete', rep_id: 'rep1', version: 2}, 409);
  eq(await post('mgr', {action: 'delete', rep_id: 'rep1', version: 1}), {ok: true, rep_id: 'rep1', version: null}, 'deleted');
  eq((await get('rep1', '/api/work-areas?member=rep1')).area.source, 'fallback', 'back to the default');
  eq((await app.db.prepare("SELECT action,actor FROM crm_audit WHERE action LIKE 'work-area:%' ORDER BY created_at,rowid").all()).results.map(row => [row.action, row.actor]), [['work-area:save', 'مدير المبيعات'], ['work-area:delete', 'مدير المبيعات']], 'one audit row per save and delete');
  ok(!(await get('owner', '/api/crm')).audits.some(row => String(row.action).startsWith('work-area:')), 'none in GET /api/crm\'s recent changes');
  // The two street tables stay in the database (migrations 0023 and 0024 are applied), and nothing of the application wrote to them.
  const count = async table => Number((await app.db.prepare('SELECT COUNT(*) AS n FROM ' + table).first()).n);
  // A later release's 0025 (the plans' targets, 2026-11-22) is applied after them: the ledger holds 0023 and 0024 among every migration.
  const recorded = (await app.db.prepare('SELECT name FROM yr_schema_migrations ORDER BY name').all()).results.map(row => row.name);
  eq([recorded.filter(name => name === '0023_work_areas.sql' || name === '0024_local_streets.sql'), recorded.length === fs.readdirSync(path.join(process.cwd(), 'drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).length, await count('crm_osm_street_cache'), await count('crm_osm_street_local')], [['0023_work_areas.sql', '0024_local_streets.sql'], true, 0, 0], '0023 and 0024 recorded with every migration; the two street tables kept, empty');
  console.log(JSON.stringify({ok: true, checks}));
} finally {
  await app.stop();
}

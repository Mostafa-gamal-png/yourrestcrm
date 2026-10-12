// Phone status reports over real HTTP against the BUILT release (run `pnpm build` first): who may write, the
// throttle, validation, text hygiene, and who may read which representative's state and last GPS point.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'mgr', role: 'manager'}, {id: 'mgrw', role: 'manager', region: 'western'},
  {id: 'sup', role: 'supervisor', sup: 'mgr'}, {id: 'supb', role: 'supervisor', sup: 'mgr'}, {id: 'supw', role: 'supervisor', sup: 'mgrw', region: 'western'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'eastern'}, {id: 'repb', role: 'rep', sup: 'supb', region: 'eastern'}, {id: 'repw', role: 'rep', sup: 'supw', region: 'western'},
  {id: 'cs', role: 'customer_service'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]), anon = app.as('');
  const base = () => ({platform: 'android-app', deviceClass: 'android', gate: 'ok', missing: [], appVersion: '1.0.10', tracking: true, windowActive: true, enrolled: true, consent: true, foreground: 'granted', fineLocation: 'granted', notifications: 'granted', background: 'granted', locationServices: true,
    lastFixAt: new Date(Date.now() - 60000).toISOString(), accuracy: 8, pendingCount: 0, pendingGapCount: 0, quarantinedCount: 0, error: '', syncError: ''});
  const post = (id, body, options = {}) => as(id)('/api/device-status', {method: 'POST', body, ...options});
  const rows = id => app.db.prepare('SELECT platform,app_version AS appVersion,reported_at AS reportedAt,data,version FROM crm_member_devices WHERE member_id=? ORDER BY platform').bind(id).all().then(result => result.results);
  const age = async (id, seconds) => app.db.prepare('UPDATE crm_member_devices SET reported_at=? WHERE member_id=?').bind(new Date(Date.now() - seconds * 1000).toISOString(), id).run();

  // ---- who may call
  check((await anon('/api/device-status', {method: 'POST', body: base()})).status, 401, 'anonymous POST is unauthorized');
  check((await anon('/api/device-status', {method: 'POST', body: {nonsense: true}})).status, 401, 'anonymous callers get 401 before validation');
  check((await anon('/api/device-status')).status, 401, 'anonymous GET is unauthorized');
  check((await app.request('/api/device-status', {method: 'POST', headers: {Cookie: sessions.rep1}, body: base()})).status, 403, 'a POST without the app origin is refused');
  for (const id of ['owner', 'mgr', 'sup', 'cs']) check((await post(id, base())).status, 403, id + ' does not report a phone');
  check((await rows('owner')).length + (await rows('mgr')).length + (await rows('sup')).length + (await rows('cs')).length, 0, 'nothing was stored for non-representatives');

  // ---- saving and the throttle
  const first = await post('rep1', base());
  check(first.status, 200, 'a representative reports their phone');
  let stored = await rows('rep1');
  check(stored.length, 1, 'one row');
  check([stored[0].platform, stored[0].appVersion, stored[0].version], ['android-app', '1.0.10', 1], 'row identity');
  check(JSON.parse(stored[0].data).gate, 'ok', 'the report is stored');
  check(Math.abs(Date.parse(stored[0].reportedAt) - Date.now()) < 15000, true, 'reported_at is the server clock');
  const twice = await post('rep1', {...base(), gate: 'permission', missing: ['background_location'], background: 'denied'});
  check(twice.status, 429, 'a second report inside the minimum gap is throttled');
  check(Number(twice.headers['retry-after']) > 0, true, 'the throttle says when to retry');
  stored = await rows('rep1');
  check([stored[0].version, JSON.parse(stored[0].data).gate], [1, 'ok'], 'a throttled report changes nothing');
  await age('rep1', 31);
  check((await post('rep1', {...base(), gate: 'permission', missing: ['background_location'], background: 'denied'})).status, 200, 'after the gap the next report is accepted');
  stored = await rows('rep1');
  check([stored.length, stored[0].version, JSON.parse(stored[0].data).gate], [1, 2, 'permission'], 'the row is replaced and versioned');
  check((await post('rep1', {...base(), platform: 'browser', deviceClass: 'desktop', gate: 'browser', appVersion: '', tracking: false, windowActive: false, enrolled: false, consent: null, foreground: null, fineLocation: null, notifications: null, background: null, locationServices: null, lastFixAt: '', accuracy: null, pendingGapCount: null})).status, 200, 'a browser report is a separate row');
  check((await rows('rep1')).map(r => r.platform), ['android-app', 'browser'], 'one row per platform');

  // ---- validation
  const bad = async (patch, message) => check((await post('rep2', {...base(), ...patch})).status, 400, message);
  await bad({platform: 'ios'}, 'unknown platform');
  await bad({gate: 'maybe'}, 'unknown gate');
  await bad({missing: ['camera']}, 'unknown requirement');
  await bad({appVersion: '1.0 <b>'}, 'markup in the version');
  await bad({pendingCount: -5}, 'negative count');
  await bad({accuracy: 'n/a'}, 'non-numeric accuracy');
  await bad({lastFixAt: 'yesterday'}, 'bad time');
  await bad({error: 'x'.repeat(401)}, 'oversized text');
  await bad({memberId: 'rep1'}, 'a member id in the body is not accepted');
  check((await as('rep2')('/api/device-status', {method: 'POST', body: {platform: 'browser'}})).status, 400, 'missing fields');
  check((await as('rep2')('/api/device-status', {method: 'POST', body: 'not json', headers: {'Content-Type': 'application/json'}})).status >= 400, true, 'malformed JSON');
  check((await as('rep2')('/api/device-status', {method: 'POST', body: {...base(), error: 'x'.repeat(4500)}})).status, 400, 'oversized body');
  check((await rows('rep2')).length, 0, 'rejected reports leave no trace');

  // ---- the server cleans what phones say
  const dirty = {...base(), error: 'تعذر‮ الرفع https://evil.example/x?token=abc\nsecond line', syncError: 'Authorization: Bearer abc.def.ghi', lastFixAt: new Date(Date.now() + 3600_000).toISOString()};
  check((await post('rep2', dirty)).status, 200, 'a dirty report is accepted but cleaned');
  const cleaned = JSON.parse((await rows('rep2'))[0].data);
  check(cleaned.error.includes('evil.example') || cleaned.error.includes('‮') || cleaned.error.includes('second line'), false, 'links, bidi overrides and extra lines are removed');
  check(cleaned.error.startsWith('تعذر'), true, 'the readable part remains');
  check(cleaned.syncError.includes('abc.def.ghi'), false, 'credentials are redacted');
  check(cleaned.lastFixAt, '', 'a fix time in the future is discarded');

  // ---- reading: scope follows the daily report
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());
  const ids = async id => (await as(id)('/api/device-status').then(r => r.json())).members.map(m => m.memberId);
  check(await ids('sup'), ['rep1', 'rep2'], 'a supervisor sees only their own representatives');
  check(await ids('supb'), ['repb'], 'another supervisor sees only theirs');
  check(await ids('mgr'), ['rep1', 'rep2', 'repb', 'repw'].sort((a, b) => a.localeCompare(b)), 'an all-region manager sees every representative');
  check(await ids('mgrw'), ['repw'], 'a regional manager sees only their region');
  check(await ids('owner'), ['rep1', 'rep2', 'repb', 'repw'].sort((a, b) => a.localeCompare(b)), 'an administrator sees every representative');
  for (const id of ['rep1', 'cs']) check((await as(id)('/api/device-status')).status, 403, id + ' cannot read tracking state');
  check((await as('sup')('/api/device-status?date=2026-02-30')).status, 400, 'an impossible date');
  check((await as('sup')('/api/device-status?date=today')).status, 400, 'a malformed date');
  const overview = (await as('sup')('/api/device-status').then(r => r.json()));
  check(overview.date, day, 'the default day is the Riyadh day');
  const rep1 = overview.members.find(m => m.memberId === 'rep1');
  check(rep1.devices.map(d => d.platform).sort(), ['android-app', 'browser'], 'both reports are visible');
  check(rep1.devices.find(d => d.platform === 'android-app').gate, 'permission', 'the latest android report is shown');
  check(typeof rep1.devices[0].reportedAt, 'string', 'reports carry the server time');
  check([rep1.lastPointAt, rep1.pointsOnDate, rep1.tripsOnDate, rep1.dayStartedAt], [null, 0, 0, null], 'no GPS yet');
  check(overview.members.find(m => m.memberId === 'rep2').devices.length, 1, 'a representative with one phone report');

  // ---- last point and the day's counts come from the tracking tables
  const dayData = JSON.stringify({gaps: [], trackingWindow: '06-18'});
  const stamp = offset => new Date(Date.parse(day + 'T06:00:00+03:00') + offset * 60_000).toISOString();
  await app.db.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,last_point_at,data,version) VALUES(?,?,?,?,?,?,?,?,1)').bind('day-1', 'rep1', 'device-1', day, 'eastern', stamp(0), stamp(30), dayData).run();
  for (let i = 0; i < 3; i++) await app.db.prepare('INSERT INTO crm_mobile_route_points(day_id,point_id,captured_at,received_at,latitude,longitude,accuracy) VALUES(?,?,?,?,?,?,?)').bind('day-1', 'p' + i, stamp(10 * i), stamp(10 * i), 26.43, 50.03, 8).run();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES('c1','customer',NULL,'rep2','الرئيسي','{}',?,?,1)").bind(stamp(0), stamp(0)).run();
  await app.db.prepare("INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,state,data,version) VALUES('stop-1','rep2',?,'c1','eastern','{}',?,'completed',?,1)").bind(day, stamp(5), JSON.stringify({lastPoint: {capturedAt: stamp(45)}})).run();
  for (let i = 0; i < 2; i++) await app.db.prepare('INSERT INTO crm_journey_points(stop_id,point_id,captured_at,received_at,latitude,longitude,accuracy) VALUES(?,?,?,?,?,?,?)').bind('stop-1', 'w' + i, stamp(40 + i), stamp(40 + i), 26.43, 50.03, 9).run();
  const counted = (await as('sup')('/api/device-status').then(r => r.json())).members;
  const c1 = counted.find(m => m.memberId === 'rep1'), c2 = counted.find(m => m.memberId === 'rep2');
  check([c1.lastPointAt, c1.pointsOnDate, c1.tripsOnDate, c1.dayStartedAt], [stamp(30), 3, 0, stamp(0)], 'app tracking: last point, points on the day, day start');
  check([c2.lastPointAt, c2.pointsOnDate, c2.tripsOnDate, c2.dayStartedAt], [stamp(45), 2, 1, null], 'web trip: its last point and counts also count');
  const other = (await as('sup')('/api/device-status?date=2020-01-01').then(r => r.json())).members.find(m => m.memberId === 'rep1');
  check([other.pointsOnDate, other.tripsOnDate, other.dayStartedAt, other.lastPointAt], [0, 0, null, stamp(30)], 'another day has no points but the newest point ever is unchanged');
  await app.db.prepare("UPDATE crm_mobile_route_days SET last_point_at=? WHERE id='day-1'").bind('2026-10-11T16:00:00+03:00').run();
  check((await as('sup')('/api/device-status').then(r => r.json())).members.find(m => m.memberId === 'rep1').lastPointAt, '2026-10-11T13:00:00.000Z', 'timestamps with an offset are compared as instants, not as text');

  // ---- the daily report explains a day without GPS
  const wed = '2026-10-07', thu = '2026-10-08', fri = '2026-10-09', at = (date, hhmm) => new Date(date + 'T' + hhmm + ':00+03:00').toISOString();
  await app.db.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,last_point_at,data,version) VALUES(?,?,?,?,?,?,?,?,?,1)').bind('day-wed-1', 'rep1', 'device-1', wed, 'eastern', at(wed, '06:00'), at(wed, '18:00'), at(wed, '09:10'), dayData).run();
  for (let i = 0; i < 2; i++) await app.db.prepare('INSERT INTO crm_mobile_route_points(day_id,point_id,captured_at,received_at,latitude,longitude,accuracy) VALUES(?,?,?,?,?,?,?)').bind('day-wed-1', 'q' + i, at(wed, '09:0' + i), at(wed, '09:0' + i), 26.43, 50.03, 8).run();
  await app.db.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,data,version) VALUES(?,?,?,?,?,?,?,?,1)').bind('day-wed-2', 'rep2', 'device-2', wed, 'eastern', at(wed, '06:10'), at(wed, '18:00'), dayData).run();
  const journeys = async (id, date, memberId) => { const response = await as(id)('/api/journeys?date=' + date + '&memberId=' + memberId); check(response.status, 200, `${id} reads the ${date} report`); return response.json(); };
  const pick = (report, id) => report.tracking.find(entry => entry.memberId === id);

  let report = await journeys('sup', wed, 'rep1');
  check(report.tracking.map(e => [e.memberId, e.status, e.pointsOnDate]), [['rep1', 'tracked', 2]], 'a representative whose points arrived is tracked');
  report = await journeys('sup', wed, 'rep2');
  check(report.tracking.map(e => [e.memberId, e.status, e.dayStartedAt]), [['rep2', 'day_without_points', at(wed, '06:10')]], 'a tracking day with no points is named');
  report = await journeys('sup', thu, 'rep2');
  check([pick(report, 'rep2').status, pick(report, 'rep2').lastPointAt], ['no_points_today', stamp(45)], 'a day without points shows the last point that ever arrived');
  report = await journeys('sup', wed, 'all');
  check(report.tracking.map(e => [e.memberId, e.status]), [['rep1', 'tracked'], ['rep2', 'day_without_points']], 'the all-team view covers every representative of the supervisor');
  check(pick(report, 'rep1').phone.gate, 'permission', 'the phone report rides along');
  check(pick(report, 'rep1').browser.platform, 'browser', 'and so does the browser attempt');
  check(typeof report.members.length + typeof report.serverTime, 'numberstring', 'the rest of the report is unchanged');
  report = await journeys('supb', wed, 'all');
  check(report.tracking.map(e => [e.memberId, e.status, e.phone, e.browser]), [['repb', 'never_tracked', null, null]], 'never activated, never reported');
  check((await post('repb', {...base(), platform: 'browser', deviceClass: 'iphone', gate: 'browser', appVersion: '', tracking: false, windowActive: false, enrolled: false, consent: null, foreground: null, fineLocation: null, notifications: null, background: null, locationServices: null, lastFixAt: '', accuracy: null, pendingGapCount: null})).status, 200, 'the representative tries the browser');
  report = await journeys('supb', wed, 'repb');
  check([pick(report, 'repb').status, pick(report, 'repb').phone, pick(report, 'repb').browser.deviceClass, pick(report, 'repb').browser.gate], ['never_tracked', null, 'iphone', 'browser'], 'the supervisor can see why: a browser on an iPhone');
  report = await journeys('sup', fri, 'rep1');
  check(report.tracking.map(e => [e.memberId, e.status]), [['rep1', 'rest_day']], 'Friday is a rest day, not a failure');
  report = await journeys('sup', wed, 'sup');
  check(report.tracking, [], 'a non-representative has no tracking coverage');
  report = await journeys('mgrw', wed, 'all');
  check(report.tracking.map(e => e.memberId), ['repw'], 'a regional manager sees coverage only for their region');
  check(pick(await journeys('owner', wed, 'all'), 'repb').status, 'never_tracked', 'an administrator sees every representative');

  // ---- stored rows that cannot be trusted are skipped, not shown
  await app.db.prepare("UPDATE crm_member_devices SET data='{' WHERE member_id='rep1' AND platform='browser'").run();
  check((await as('sup')('/api/device-status').then(r => r.json())).members.find(m => m.memberId === 'rep1').devices.map(d => d.platform), ['android-app'], 'a corrupt row is ignored');
  await app.db.prepare("UPDATE crm_member_devices SET data=json_set(data,'$.gate','hacked') WHERE member_id='rep1' AND platform='android-app'").run();
  check((await as('sup')('/api/device-status').then(r => r.json())).members.find(m => m.memberId === 'rep1').devices, [], 'a row that fails the schema is ignored');

  // ---- the table follows its member
  await app.db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES('gone','opaque-gone','gone@yourrest.org','gone','rep','x',NULL,1,0,?,'all')").bind(new Date().toISOString()).run();
  await app.db.prepare("INSERT INTO crm_member_devices(member_id,platform,app_version,reported_at,data,version) VALUES('gone','browser',NULL,?,'{}',1)").bind(new Date().toISOString()).run();
  await app.db.prepare("DELETE FROM crm_members WHERE id='gone'").run();
  check((await rows('gone')).length, 0, 'deleting a member removes their device rows');
  const noPlatform = app.db.prepare("INSERT INTO crm_member_devices(member_id,platform,app_version,reported_at,data,version) VALUES('rep2','tablet',NULL,?,'{}',1)").bind(new Date().toISOString()).run();
  await assert.rejects(noPlatform, /CHECK|constraint/i, 'the table itself only accepts the two platforms'); checks++;
  console.log(JSON.stringify({ok: true, checks, scope: 'real HTTP against the built release; temporary SQLite; no production data'}));
} finally { await app.stop(); }

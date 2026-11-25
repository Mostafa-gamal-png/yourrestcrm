// What happens to a representative's phone when the administrator changes the account (the owner, 2026-11-25, item 1 of «اعمل التلاتة»:
// the marketing officer stopped because two correct rules met; no unit test tried them together). Against the BUILT release (run the build
// first), on a temporary database with made-up people and places, the server's clock shifted into a working morning, and a stand-in of the
// Android app 1.0.16 and of the page that drives it (scripts/lib/phone-standin.mjs: the same requests, the same decisions).
// What the server does to every edit, and the scenarios hold: a change of the role, branch, supervisor, region or active state ends every
// session of the account (the trigger crm_member_revoke_auth of drizzle/0009), so the phone's next request is refused (401), the phone stops
// collecting and keeps everything, and the representative signs in again with a code by mail (there is no password). The page then enrolls
// the phone again by itself: through «refreshAccount» when the region or role changed (the evidence of before is held under its region),
// and, since 2026-11-25, whenever the phone still holds this representative's enrollment (before, «تفعيل التتبع» had to be pressed once
// after every other edit). Only a representative who stopped being one and came back presses it. Every scenario ends with every point the
// phone captured stored exactly once on the server and nothing left on it.
//  A. The incident: five regions ticked one by one become «كل المناطق» while the phone holds points of yesterday and of today.
//  B. A representative becomes a marketing officer (the same tracking role).
//  C. A representative becomes a supervisor and back: the points wait on the phone, then upload.
//  D. A new supervisor: the new supervisor sees the day, the old one no longer does.
//  E. The account deactivated and reactivated.
//  F. Signing out and in, and another representative signing in on the same phone: the points never change owner; the other account waits
//     until the first one uploads.
//  G. A region changed with nothing waiting: no warning, a new day at once.
//  H. A phone offline a whole day, then the region changes: that day reaches the earlier region as a closed day of its own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {PhoneStandIn, Failure, riyadhDate, windowStart} from '../scripts/lib/phone-standin.mjs';

// The stand-in plays what these lines of the app and the page do; a change to any of them must be mirrored in scripts/lib/phone-standin.mjs.
const java = name => fs.readFileSync('mobile/android/app/src/main/java/org/yourrest/crm/' + name + '.java', 'utf8');
const tracker = java('ContinuousRouteTracker'), failures = java('TrackingFailurePolicy'), page = fs.readFileSync('app/journey-tracker.tsx', 'utf8');
for (const [source, marker] of [
  [tracker, 'put("action","begin").put("createKey",store.key(date)).put("deviceId",deviceId).put("continuous",true).put("regionScope",store.get("regionScope")).put("date",date).put("startedAt",RouteRules.iso(first))'],
  [tracker, 'put("action","begin").put("held",true).put("createKey",key).put("deviceId",deviceId).put("continuous",true).put("regionScope",scope).put("date",date).put("startedAt",RouteRules.iso(span[0])).put("endedAt",RouteRules.iso(span[1]+1000))'],
  [tracker, 'request("samples",day).put("held",true).put("points",batch)'],
  [tracker, 'boolean resume="rep".equals(response.optString("memberRole"))&&consent()&&RouteTracker.get(context).permission()&&backgroundGranted(context)&&!"1".equals(store.get("userStopped"));'],
  [tracker, 'if(TrackingFailurePolicy.authenticationRejected(status)||status==409){disable(false);'],
  [tracker, '.put("enrolled",enabled())'],
  [tracker, 'if(!unreachable)drainHeld(owner,expected,HELD_OPERATIONS);'],
  [tracker, 'static final int HELD_OPERATIONS=3;'],
  [failures, 'static boolean heldRefused(int status){return status>=400&&status<500&&status!=401&&status!=408&&status!=409&&status!=429;}'],
  [page, "if(state.memberId&&state.memberId!==member.current?.id){state=await nativeTrackingRequest('logout');"],
  [page, 'state.pendingGapCount!==null&&state.memberId===member.current.id&&state.permission===\'granted\'&&state.backgroundPermission===\'granted\''],
  [page, "try{state=await nativeTrackingRequest('enroll',{memberId:member.current.id});}catch(failure){if(!resuming)throw failure;"],
]) assert.ok(source.includes(marker), 'the phone stand-in no longer matches the app: ' + marker.slice(0, 90));

const FIVE = 'central,eastern,western,northern,southern';
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup1', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف الأول'}, {id: 'sup2', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف الثاني'},
  ...['repA', 'repB', 'repC', 'repD', 'repE', 'repF', 'repG', 'repH', 'repI'].map(id => ({id, role: 'rep', sup: 'sup1', region: id === 'repA' ? FIVE : 'eastern', name: 'مندوب ' + id.slice(3)}))];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const taps = {};

// The day the scenarios run on: a Monday to Thursday at least four days ahead (so the day before and the one before it are working days,
// and after the accounts were made), at 10:00 in Riyadh.
let day = Date.now() + 4 * 86400_000;
while (![1, 2, 3, 4].includes(new Date(riyadhDate(day) + 'T12:00:00Z').getUTCDay())) day += 86400_000;
const d0 = riyadhDate(day), d1 = riyadhDate(Date.parse(d0 + 'T12:00:00Z') - 86400_000), d2 = riyadhDate(Date.parse(d0 + 'T12:00:00Z') - 2 * 86400_000);
const offset = Date.parse(d0 + 'T10:00:00+03:00') - Date.now(), clock = () => Date.now() + offset;
const at = (date, hhmm) => Date.parse(date + 'T' + hhmm + ':00.000+03:00');

const app = await bootBuiltApp({members}, {env: {NODE_OPTIONS: '--import ' + new URL('../scripts/lib/shifted-clock.mjs', import.meta.url).href, TEST_CLOCK_OFFSET_MS: String(offset)}});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const send = (method, body, cookie) => app.as(cookie)('/api/mobile-route', {method, ...(body ? {body} : {})});
  /** A phone enrolled for `member` before the day before yesterday began, collecting. */
  const phoneOf = (member, scope) => { const phone = new PhoneStandIn({send, clock}); phone.signIn(sessions[member]); Object.assign(phone.meta, {memberId: member, regionScope: scope, memberRole: 'rep', enrolledAt: String(windowStart(d2) - 3600_000), enrolledServerAt: new Date(windowStart(d2) - 3600_000).toISOString(), enabled: '1', loggedOut: '0'}); return phone; };
  const hhmm = minutes => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  /** Points every minute from `from` (HH:MM), at made-up places in the Kingdom. */
  const capture = (phone, date, from, count, seed = 0) => { const ids = [], [h, m] = from.split(':').map(Number); for (let n = 0; n < count; n++) { ok(phone.capture(at(date, hhmm(h * 60 + m + n)), 24.6 + seed * 0.01 + n * 0.0003, 46.7 + seed * 0.01 + n * 0.0002), 'captured'); ids.push(phone.points.at(-1).id); } return ids; };
  /** New points now (the phone's clock), a little apart. */
  const captureNow = async (phone, count, seed = 0) => { const ids = []; for (let n = 0; n < count; n++) { await sleep(25); ok(phone.capture(clock(), 26.4 + seed * 0.01 + n * 0.0003, 50.1 + n * 0.0002), 'captured now'); ids.push(phone.points.at(-1).id); } return ids; };
  const stored = async member => (await app.db.prepare('SELECT p.point_id AS id,d.region_scope AS scope,d.date AS date,d.ended_at AS endedAt FROM crm_mobile_route_points p JOIN crm_mobile_route_days d ON d.id=p.day_id WHERE d.member_id=? ORDER BY p.captured_at').bind(member).all()).results;
  const everyPointOnce = async (member, ids, label) => { const rows = await stored(member), found = rows.map(r => r.id); check([found.length, new Set(found).size, ids.every(id => found.includes(id))], [ids.length, ids.length, true], label + ': every point stored exactly once'); return rows; };
  const report = (member, phone) => as(member)('/api/device-status', {method: 'POST', body: phone.report()});
  async function edit(id, patch, {confirm = false} = {}) {
    const list = (await as('owner')('/api/crm')).json().members, m = list.find(x => x.id === id);
    const data = {id, name: m.name, email: m.email, role: m.role, branch: m.branch, supervisorId: m.supervisorId || '', regionScope: m.regionScope || 'all', active: m.active, target: m.target || 0, ...patch};
    return as('owner')('/api/crm', {method: 'POST', body: {action: 'member', data, memberSnapshot: m.editToken, ...(confirm ? {confirmTrackingPending: true} : {})}});
  }
  /** After an edit: the phone's next sync is refused because the session ended; it stops collecting and keeps everything. */
  async function sessionEnded(id, phone, label) {
    const before = phone.status(), refused = await phone.sync(), after = phone.status();
    check([refused instanceof Failure && refused.status, after.enabled, after.pendingCount, after.heldCount], [401, false, before.pendingCount, before.heldCount], label + ': the session ended (401): the phone stops collecting and keeps every point');
    check((await as(id)('/api/crm')).status, 401, label + ': the old session no longer opens the pages');
  }
  /** The representative signs in again (a new mail code) and the page opens; `tap` is «تفعيل التتبع» when the page shows it. */
  async function signInAgain(id, phone, label, {tap = true} = {}) {
    sessions[id] = await app.login(id); phone.signIn(sessions[id]);
    const reply = await as(id)('/api/crm');check(reply.status, 200, label + ': the account\'s pages open after signing in');
    const me = reply.json().me;
    let state = await phone.openPage(me);
    taps[label] = 0;
    if (tap && !state.enabled && (me.role === 'rep' || me.role === 'marketing')) { taps[label] = 1; state = await phone.enroll(id); }
    return {me, state};
  }
  const settled = (phone, label) => { const s = phone.status(); check([s.enabled, s.pendingCount, s.pendingGapCount, s.heldCount, s.heldGapCount, s.error, s.heldError], [true, 0, 0, 0, 0, '', ''], label + ': collecting, nothing left on the phone, no error'); };

  // ---- A. The incident: five regions ticked one by one become «كل المناطق»
  {
    const phone = phoneOf('repA', FIVE), ids = [];
    ids.push(...capture(phone, d1, '09:00', 6, 1));
    check(await phone.sync(), null, 'A: yesterday\'s morning uploads');
    ids.push(...capture(phone, d0, '07:00', 6, 2));
    check(await phone.sync(), null, 'A: this morning uploads');
    ids.push(...capture(phone, d1, '14:00', 6, 3), ...capture(phone, d0, '09:00', 6, 4));
    check(phone.status().pendingCount, 12, 'A: twelve points not yet uploaded (yesterday afternoon, this morning)');
    check((await report('repA', phone)).status, 200, 'A: the phone tells the server what waits');
    const warned = await edit('repA', {regionScope: 'all'});
    check([warned.status, warned.json().code, warned.json().pendingCount], [409, 'MEMBER_TRACKING_PENDING', 12], 'A: the users screen warns first, with the count');
    check((await edit('repA', {regionScope: 'all'}, {confirm: true})).status, 200, 'A: «الحفظ رغم ذلك» saves');
    await sessionEnded('repA', phone, 'A');
    const {me, state} = await signInAgain('repA', phone, 'A');
    check([me.regionScope, state.enabled, state.regionScope, state.pendingCount, state.heldCount, taps.A], ['all', true, 'all', 0, 12, 0], 'A: signed in again, the page holds the twelve under the five regions and enrolls «كل المناطق» by itself (no tap)');
    ids.push(...await captureNow(phone, 3, 5));
    check(await phone.sync(), null, 'A: the new points and the held ones upload');
    settled(phone, 'A');
    const rows = await everyPointOnce('repA', ids, 'A');
    check(rows.filter(r => r.scope === FIVE).length, 24, 'A: the 24 points of before the change on days of the five regions (never relabeled)');
    check([...new Set(rows.filter(r => r.scope === 'all').map(r => r.date))], [d0], 'A: the new points on today\'s day of «كل المناطق»');
    ok(rows.filter(r => r.scope === FIVE && r.date === d0).every(r => r.endedAt), 'A: today\'s day of the five regions was closed by the new one');
    const overview = (await as('owner')('/api/device-status?date=' + d0)).json().members.find(m => m.memberId === 'repA');
    check(overview.pointsOnDate, 15, 'A: the day report counts today\'s 15 points of both days');
  }

  // ---- B. A representative becomes a marketing officer
  {
    const phone = phoneOf('repB', 'eastern'), ids = [];
    ids.push(...capture(phone, d0, '07:00', 4, 6));
    check(await phone.sync(), null, 'B: uploads');
    ids.push(...capture(phone, d0, '08:00', 4, 7));
    check((await report('repB', phone)).status, 200, 'B: report');
    check((await edit('repB', {role: 'marketing'})).status, 200, 'B: no warning (the tracking role is the same)');
    await sessionEnded('repB', phone, 'B');
    const {me, state} = await signInAgain('repB', phone, 'B');
    check([me.role, state.enabled, taps.B], ['marketing', true, 0], 'B: signed in again as a marketing officer, tracking resumes by itself (no tap)');
    ids.push(...await captureNow(phone, 2, 8));
    check(await phone.sync(), null, 'B: everything uploads');
    settled(phone, 'B');
    await everyPointOnce('repB', ids, 'B');
  }

  // ---- C. A representative becomes a supervisor, and back
  {
    const phone = phoneOf('repC', 'eastern'), ids = [];
    ids.push(...capture(phone, d1, '10:00', 3, 9));
    check(await phone.sync(), null, 'C: yesterday uploads');
    ids.push(...capture(phone, d0, '07:00', 3, 10));
    check(await phone.sync(), null, 'C: this morning uploads');
    ids.push(...capture(phone, d1, '15:00', 3, 11), ...capture(phone, d0, '08:30', 3, 12));
    check((await report('repC', phone)).status, 200, 'C: report');
    check((await edit('repC', {role: 'supervisor'})).status, 409, 'C: warned before a representative stops being one');
    check((await edit('repC', {role: 'supervisor'}, {confirm: true})).status, 200, 'C: saved');
    await sessionEnded('repC', phone, 'C');
    const asSupervisor = await signInAgain('repC', phone, 'C (supervisor)');
    check([asSupervisor.me.role, asSupervisor.state.enabled, asSupervisor.state.heldCount], ['supervisor', false, 6], 'C: a supervisor\'s phone stops collecting and keeps the six points');
    check(await phone.sync(), null, 'C: nothing is sent while the account is a supervisor (and nothing fails)');
    check(phone.status().heldCount, 6, 'C: still kept');
    check((await edit('repC', {role: 'rep'})).status, 200, 'C: back to representative (no warning: a supervisor has nothing waiting)');
    const back = await signInAgain('repC', phone, 'C');
    check([back.state.enabled, back.state.regionScope, taps.C], [true, 'eastern', 1], 'C: signed in again as a representative, «تفعيل التتبع» once');
    ids.push(...await captureNow(phone, 2, 13));
    check(await phone.sync(), null, 'C: everything uploads');
    settled(phone, 'C');
    await everyPointOnce('repC', ids, 'C');
  }

  // ---- D. A new supervisor
  {
    const phone = phoneOf('repD', 'eastern'), ids = [];
    ids.push(...capture(phone, d0, '07:00', 3, 14));
    check(await phone.sync(), null, 'D: uploads');
    ids.push(...capture(phone, d0, '08:00', 3, 15));
    check((await report('repD', phone)).status, 200, 'D: report');
    check((await edit('repD', {supervisorId: 'sup2'})).status, 200, 'D: no warning for a new supervisor');
    await sessionEnded('repD', phone, 'D');
    check([(await signInAgain('repD', phone, 'D')).state.enabled, taps.D], [true, 0], 'D: signed in again, tracking resumes by itself');
    ids.push(...await captureNow(phone, 2, 16));
    check(await phone.sync(), null, 'D: everything uploads');
    settled(phone, 'D');
    await everyPointOnce('repD', ids, 'D');
    const read = async sup => (await as(sup)('/api/device-status?date=' + d0)).json().members.find(m => m.memberId === 'repD');
    check((await read('sup2'))?.pointsOnDate, 8, 'D: the new supervisor sees the day');
    check(await read('sup1'), undefined, 'D: the old supervisor no longer does');
  }

  // ---- E. Deactivated, then reactivated
  {
    const phone = phoneOf('repE', 'eastern'), ids = [];
    ids.push(...capture(phone, d0, '07:00', 3, 17));
    check(await phone.sync(), null, 'E: uploads');
    ids.push(...capture(phone, d0, '08:00', 4, 18));
    check((await edit('repE', {active: 0})).status, 200, 'E: deactivated');
    await sessionEnded('repE', phone, 'E');
    await assert.rejects(app.login('repE'), /auth\/verify failed|No OTP mail/);checks++;
    check((await edit('repE', {active: 1})).status, 200, 'E: reactivated');
    check([(await signInAgain('repE', phone, 'E')).state.enabled, taps.E], [true, 0], 'E: signed in again, tracking resumes by itself');
    ids.push(...await captureNow(phone, 2, 19));
    check(await phone.sync(), null, 'E: everything uploads');
    settled(phone, 'E');
    await everyPointOnce('repE', ids, 'E');
  }

  // ---- F. Signing out and in, and another representative on the same phone
  {
    const phone = phoneOf('repF', 'eastern'), ids = [];
    ids.push(...capture(phone, d0, '07:00', 3, 20));
    check(await phone.sync(), null, 'F: uploads');
    ids.push(...capture(phone, d0, '08:00', 3, 21));
    phone.logout();
    check([phone.status().enabled, phone.status().pendingCount], [false, 3], 'F: signing out keeps the three points waiting');
    phone.signIn(sessions.repG);
    const other = await phone.openPage((await as('repG')('/api/crm')).json().me);
    check([other.enabled, other.memberId, other.pendingCount], [false, 'repF', 3], 'F: the other representative\'s page opens; the phone still holds the first one\'s points');
    await assert.rejects(phone.enroll('repG'), error => error.status === 403 && /حسابًا سابقًا/.test(error.message));checks++;
    check([phone.status().memberId, phone.status().pendingCount], ['repF', 3], 'F: «تفعيل التتبع» of the other account is refused with the reason; the points never change owner');
    const back = await signInAgain('repF', phone, 'F');
    check([back.state.enabled, taps.F], [true, 0], 'F: the first representative signs in again; tracking resumes by itself');
    check(await phone.sync(), null, 'F: the three upload');
    settled(phone, 'F');
    await everyPointOnce('repF', ids, 'F');
    phone.logout();phone.signIn(sessions.repG);
    await phone.openPage((await as('repG')('/api/crm')).json().me);
    const g = await phone.enroll('repG');
    check([g.enabled, g.memberId], [true, 'repG'], 'F: with nothing waiting, the other representative enrolls the phone');
    const gIds = await captureNow(phone, 2, 22);
    check(await phone.sync(), null, 'F: and uploads as itself');
    await everyPointOnce('repG', gIds, 'F (the other representative)');
  }

  // ---- G. A region changed with nothing waiting
  {
    const phone = phoneOf('repH', 'eastern'), ids = [];
    ids.push(...capture(phone, d0, '07:00', 3, 23));
    check(await phone.sync(), null, 'G: uploads');
    check((await report('repH', phone)).status, 200, 'G: report (nothing waits)');
    check((await edit('repH', {regionScope: 'western'})).status, 200, 'G: no warning when nothing waits');
    await sessionEnded('repH', phone, 'G');
    const {state} = await signInAgain('repH', phone, 'G');
    check([state.enabled, state.regionScope, state.heldCount, taps.G], [true, 'western', 0, 0], 'G: signed in again, enrolled on the new region by itself');
    ids.push(...await captureNow(phone, 2, 24));
    check(await phone.sync(), null, 'G: uploads');
    settled(phone, 'G');
    const rows = await everyPointOnce('repH', ids, 'G');
    check(rows.map(r => r.scope), ['eastern', 'eastern', 'eastern', 'western', 'western'], 'G: each point on its own region');
  }

  // ---- H. A phone offline a whole day, then the region changes
  {
    const phone = phoneOf('repI', 'eastern'), ids = [];
    ids.push(...capture(phone, d2, '09:00', 3, 25));
    check(await phone.sync(), null, 'H: the day before yesterday uploads (the account has a day of its region)');
    ids.push(...capture(phone, d1, '11:00', 5, 26));
    check(phone.status().pendingCount, 5, 'H: yesterday never reached the server');
    check((await edit('repI', {regionScope: 'central'}, {confirm: true})).status, 200, 'H: region changed');
    await sessionEnded('repI', phone, 'H');
    const {state} = await signInAgain('repI', phone, 'H');
    check([state.enabled, state.heldCount, taps.H], [true, 5, 0], 'H: yesterday held, the new region enrolled by itself');
    ids.push(...await captureNow(phone, 2, 27));
    check(await phone.sync(), null, 'H: uploads');
    settled(phone, 'H');
    const rows = await everyPointOnce('repI', ids, 'H');
    const yesterday = rows.filter(r => r.date === d1);
    check([yesterday.length, [...new Set(yesterday.map(r => r.scope))], yesterday.every(r => r.endedAt)], [5, ['eastern'], true], 'H: yesterday on a closed day of the earlier region');
  }

  console.log(JSON.stringify({ok: true, checks, day: d0, tapsAfterSigningIn: taps, builtRelease: true, syntheticFixtures: true, productionDataUsed: false, androidStandIn: '1.0.16'}));
} finally {
  await app.stop();
}

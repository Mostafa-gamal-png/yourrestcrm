// A visit is recorded where the customer is, over real HTTP against the BUILT release (run `pnpm build` first): a representative at the
// customer saves; one 1.8 km away is refused with the distance and the refusal is kept in the customer's history once per ten
// minutes; the phone's accuracy widens the limit by up to 100 m and a fix too weak to judge is not accepted; calls have no place;
// a customer with no point of their own takes the first visit's point, and the next visit from afar is refused; a customer whose
// location is only a word is left alone; a supervisor away from the customer is marked, not stopped; arrival the route tracking
// confirmed settles it, and a stop already left does not; follow-ups that are visits carry and obey the same rule; the older
// /api/crm entry point does not offer a way around it; editing a saved visit is not judged again. Synthetic isolated fixtures only:
// temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'},
  {id: 'rep', role: 'rep', sup: 'sup'}, {id: 'rep2', role: 'rep', sup: 'sup'}, {id: 'cs', role: 'customer_service'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const DEGREE = 6371000 * Math.PI / 180;
const BASE = {latitude: 24.7136, longitude: 46.6753};
const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const later = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const north = (meters, base = BASE) => ({latitude: base.latitude + meters / DEGREE, longitude: base.longitude});
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const stamp = new Date().toISOString();
  const customer = (id, name, data, assignedTo = 'rep') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name, region: 'الشرقية', city: 'الدمام', phone: '0551234567', contact: 'أبو خالد', code: id, branch: 'الرئيسي', assignedTo, ...data}), stamp, stamp).run();
  const where = (point, extra = {}) => ({location: `${point.latitude.toFixed(7)}, ${point.longitude.toFixed(7)}`, latitude: point.latitude, longitude: point.longitude, ...extra});
  await customer('c1', 'مصنع الأمل', where(BASE, {locationSource: 'device', locationCapturedAt: stamp, locationAccuracy: 8}));
  await customer('c2', 'مصنع بلا موقع', {location: ''});
  await customer('c3', 'مصنع بموقع كلمة', {location: 'الدمام، حي الفيحاء'});
  await customer('c4', 'مصنع المتابعة', where(BASE));
  await customer('c5', 'مصنع الثاني', where(BASE), 'rep2');
  const version = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first()).version;
  const row = async id => { const found = await app.db.prepare('SELECT data,version FROM crm_records WHERE id=?').bind(id).first(); return found && {...found, data: JSON.parse(found.data)}; };
  const visits = async () => (await app.db.prepare("SELECT id,data FROM crm_records WHERE kind='activity' ORDER BY created_at,id").all()).results.map(r => ({id: r.id, data: JSON.parse(r.data)}));
  const audits = async action => (await app.db.prepare('SELECT record_id AS recordId,actor,detail FROM crm_audit WHERE action=? ORDER BY created_at,id').bind(action).all()).results;
  // A visit body as the form sends it: the device's point, how far it is, the accuracy.
  const body = async (customerId, point, accuracy, over = {}, data = {}) => ({
    createKey: crypto.randomUUID(), customerId, customerVersion: await version(customerId), timingMode: 'automatic', elapsedMilliseconds: 5000,
    data: {type: 'visit', date: day, summary: 'تعريف بمنتجات الشركة', result: 'تم تحديد احتياج العميل', nextAction: 'متابعة المواصفات', nextDate: later, ...where(point), locationSource: 'device', locationCapturedAt: new Date().toISOString(), locationAccuracy: accuracy, ...data}, ...over
  });
  const post = (id, payload, url = '/api/visits') => as(id)(url, {method: 'POST', body: payload});

  // ---- a representative at the customer, and 1.8 km away
  let result = await post('rep', await body('c1', north(120), 15));
  check(result.status, 200, 'a representative 120 m from the customer saves: ' + result.text);
  let saved = (await visits()).at(-1);
  check([saved.data.placeDistance > 119 && saved.data.placeDistance < 121, saved.data.placeOutside], [true, undefined], 'the visit keeps how far from the customer it was recorded, and is not marked');
  const before = (await visits()).length;
  result = await post('rep', await body('c1', north(1800), 15));
  const message = result.json().error || '';
  check(result.status, 400, 'a representative 1.8 km away is refused');
  ok(/^لا يمكن تسجيل الزيارة إلا عند العميل\. أنت على بعد 1[78]\d\d متر من موقع «مصنع الأمل» \(الدقة ±15 متر\)\. انتقل إلى موقع العميل ثم اضغط تحديث موقع الجهاز\.$/.test(message), 'with the distance, the customer and what to do: ' + message);
  check((await visits()).length, before, 'and nothing was saved');
  let refusals = await audits('محاولة تسجيل زيارة بعيدة عن العميل');
  check([refusals.length, refusals[0].recordId, refusals[0].actor, refusals[0].detail.replace(/\d+ متر والمسموح/, 'N متر والمسموح')], [1, 'c1', 'rep', 'على بعد N متر والمسموح 315 متر'], 'the refusal is kept in the customer\'s history with the distance and the allowed distance, 300 plus the accuracy');
  await post('rep', await body('c1', north(2500), 15));
  check((await audits('محاولة تسجيل زيارة بعيدة عن العميل')).length, 1, 'trying again within ten minutes adds no second line');
  check((await post('rep2', await body('c5', north(1800), 15))).status, 400, 'another representative, with a customer of their own, is refused as well');
  refusals = await audits('محاولة تسجيل زيارة بعيدة عن العميل');
  check([refusals.length, refusals[1].recordId, refusals[1].actor], [2, 'c5', 'rep2'], 'and has a line of their own, on their own customer');

  // ---- the limit and the phone's accuracy
  check((await post('rep', await body('c1', north(310), 15))).status, 200, '310 m with an accuracy of 15 is inside the 315 allowed');
  result = await post('rep', await body('c1', north(320), 15));
  check(result.status, 400, '320 m with an accuracy of 15 is not');
  check((await post('rep', await body('c1', north(399), 250))).status, 200, '399 m with an accuracy of 250 is inside the 400 allowed: the accuracy adds 100 at most');
  check((await post('rep', await body('c1', north(401), 250))).status, 400, '401 m with an accuracy of 250 is not');
  result = await post('rep', await body('c1', north(100), 400));
  check([result.status, /^دقة الموقع ضعيفة \(±400 متر\) فلا يمكن التأكد أنك عند «مصنع الأمل»/.test(result.json().error)], [400, true], 'a fix with an accuracy of 400 is neither accepted nor refused as far: it asks for a better one');
  check((await post('rep', await body('c1', north(5000), 400))).status, 400, 'a weak fix 5 km away is clearly away');

  // ---- calls have no place
  result = await post('rep', await body('c1', north(5000), 15, {}, {type: 'call'}));
  check(result.status, 200, 'a call from anywhere is recorded: ' + result.text);
  saved = (await visits()).at(-1);
  check([saved.data.type, saved.data.placeDistance, saved.data.placeOutside], ['call', undefined, undefined], 'and carries no distance');

  // ---- a customer with no point of their own
  result = await post('rep', await body('c2', north(5000), 12));
  check(result.status, 200, 'a customer with no location takes the visit from anywhere: ' + result.text);
  const visitId = result.json().id;
  let c2 = await row('c2');
  check([c2.data.latitude, c2.data.longitude, c2.data.location, c2.data.locationSource, c2.data.locationAccuracy, c2.data._locationFromVisit.visitId, c2.data._locationFromVisit.byName], [Number(north(5000).latitude.toFixed(7)), north(5000).longitude, where(north(5000)).location, 'device', 12, visitId, 'rep'], 'and the visit\'s point becomes the customer\'s, with where it came from');
  const adopted = await audits('تسجيل موقع العميل من زيارة');
  check([adopted.length, adopted[0].recordId], [1, 'c2'], 'one line in the customer\'s history says so');
  result = await post('rep', await body('c2', BASE, 12));
  check([result.status, /على بعد/.test(result.json().error)], [400, true], 'the next visit, from the other end of the city, is refused: the customer has a place now');
  check((await post('rep', await body('c2', north(5100), 12))).status, 200, 'a visit at that place is fine');

  // ---- a location that is only a word is left alone
  result = await post('rep', await body('c3', north(7000), 12));
  check(result.status, 200, 'a customer whose location is only a word has nothing to be far from: ' + result.text);
  const c3 = await row('c3');
  check([c3.data.location, c3.data.latitude, c3.data._locationFromVisit], ['الدمام، حي الفيحاء', undefined, undefined], 'and the word is not overwritten');

  // ---- those the rule does not stop are marked
  result = await post('sup', await body('c1', north(1800), 15));
  check(result.status, 200, 'a supervisor away from the customer is not stopped: ' + result.text);
  saved = (await visits()).at(-1);
  check([saved.data.placeOutside, saved.data.placeDistance > 1790 && saved.data.placeDistance < 1810], [true, true], 'the visit is marked as recorded away, with the distance');
  result = await post('sup', await body('c1', north(100), 400));
  check(result.status, 200, 'a weak fix is not held against a supervisor');
  saved = (await visits()).at(-1);
  check([saved.data.placeOutside], [undefined], 'and is not marked as away');
  check((await post('owner', await body('c1', north(3000), 15))).status, 200, 'the administrator is not stopped either');

  // ---- arrival the route tracking confirmed
  const selected = new Date().toISOString();
  const journey = (id, member, customerId, extra) => app.db.prepare("INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data,version) VALUES(?,?,?,?,'eastern',?,?,?,?,?,1)")
    .bind(id, member, day, customerId, JSON.stringify({customerName: 'مصنع الأمل', region: 'الشرقية', latitude: BASE.latitude, longitude: BASE.longitude}), selected, extra.closedAt || null, extra.state, JSON.stringify({arrivalAt: selected, departureAt: extra.departureAt || null, durationSeconds: null, durationUncertain: false, observedSeconds: 0, gaps: [], events: [{type: 'selected', at: selected}, {type: 'arrival', at: selected}]})).run();
  await journey('stop-here', 'rep', 'c1', {state: 'onsite'});
  result = await post('rep', await body('c1', north(900), 15, {}, {journeyStopId: 'stop-here'}));
  check(result.status, 200, 'arrival already confirmed at this customer settles it, even 900 m from where the phone says: ' + result.text);
  await journey('stop-left', 'rep2', 'c5', {state: 'completed', departureAt: selected});
  result = await post('rep2', await body('c5', north(900), 15, {}, {journeyStopId: 'stop-left'}));
  check(result.status, 400, 'a stop the representative has already left does not');

  // ---- follow-ups that are visits
  const planned = (id, customerId) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'activity',?,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, customerId, JSON.stringify({visitWorkflow: 'customer-v1', type: 'visit', date: day, summary: 'زيارة أولى', result: 'سلبية', nextAction: 'اتصال', nextDate: day, performedBy: 'rep', responsibleId: 'rep', requestedProducts: [], salesStage: 'new', ...where(BASE)}), stamp, stamp).run();
  await planned('first-c4', 'c4');
  const followup = async (point, accuracy, type = 'visit', withPlace = true, sourceId = 'first-c4') => {
    const source = await row(sourceId);
    return {createKey: crypto.randomUUID(), customerId: 'c4', customerVersion: await version('c4'), sourceId, sourceVersion: source.version,
      data: {type, date: day, result: 'اتفقنا على إرسال العرض', salesStage: 'new', invoiceOutcome: 'pending', nextAction: 'إرسال العرض', nextDate: later, lossReason: '', lossDetails: '', competitorObservation: null, ...(withPlace ? {...where(point), locationSource: 'device', locationCapturedAt: new Date().toISOString(), locationAccuracy: accuracy} : {})}};
  };
  result = await post('rep', await followup(north(1800), 15), '/api/customer-followups');
  check([result.status, /على بعد/.test(result.json().error)], [400, true], 'a follow-up that is a visit, recorded 1.8 km away, is refused like a visit');
  result = await post('rep', await followup(north(50), 15, 'visit', false), '/api/customer-followups');
  check([result.status, /انتظر تحديد موقع الجهاز/.test(result.json().error)], [400, true], 'and one without the device\'s point is not saved');
  result = await post('rep', await followup(north(50), 15), '/api/customer-followups');
  check(result.status, 200, 'a follow-up that is a visit, at the customer, is saved: ' + result.text);
  const firstFollowup = result.json().id, followupRow = await row(firstFollowup);
  check([followupRow.data.visitWorkflow, followupRow.data.latitude > 24.7 && followupRow.data.latitude < 24.72, followupRow.data.placeDistance > 49 && followupRow.data.placeDistance < 51], ['followup-v1', true, true], 'carrying the device\'s point and the distance');
  result = await post('rep', await followup(north(9000), 15, 'call', true, firstFollowup), '/api/customer-followups');
  check(result.status, 200, 'a follow-up that is a call has no place, wherever it is recorded: ' + result.text);
  const callRow = await row(result.json().id);
  check([callRow.data.latitude, callRow.data.location, callRow.data.locationSource], [undefined, undefined, undefined], 'and keeps none, whatever the form sent');

  // ---- no way around it through the older entry point
  const legacy = async (point, accuracy, over = {}) => ({action: 'save', kind: 'activity', parentId: 'c1', createKey: crypto.randomUUID(), data: {type: 'visit', date: day, summary: 'زيارة', result: 'تمت', nextAction: 'متابعة', nextDate: later, ...where(point), locationSource: 'device', locationCapturedAt: new Date().toISOString(), locationAccuracy: accuracy, ...over}});
  result = await post('rep', await legacy(north(1800), 15), '/api/crm');
  check([result.status, /لا يمكن تسجيل الزيارة إلا عند العميل/.test(result.json().error || '')], [400, true], 'a representative cannot record a far visit through /api/crm either');
  result = await post('sup', await legacy(north(1800), 15), '/api/crm');
  check(result.status, 200, 'a supervisor can: ' + result.text);
  check((await row(result.json().id)).data.placeOutside, true, 'and the visit is marked');

  // ---- a saved visit is not judged again, and customer service is not asked for a place
  const mine = (await visits()).find(v => v.data.placeDistance > 119 && v.data.placeDistance < 121);
  result = await post('owner', {createKey: crypto.randomUUID(), customerId: 'c1', id: mine.id, version: (await row(mine.id)).version, customerVersion: await version('c1'), data: {...mine.data, summary: 'تعريف معدّل'}});
  check(result.status, 200, 'editing a saved visit does not judge it again: ' + result.text);
  check((await row(mine.id)).data.placeDistance, mine.data.placeDistance, 'and its distance stays');
  check((await post('cs', await body('c1', north(5000), 15))).status, 403, 'customer service cannot record a visit at all');
  ok((await audits('محاولة تسجيل زيارة بعيدة عن العميل')).every(line => line.actor.startsWith('rep')), 'only representatives\' attempts are in the history');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, productionDataUsed: false}));
} finally {
  await app.stop();
}

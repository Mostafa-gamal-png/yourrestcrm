// The mold requests' pure rules no other measured test calls (the owner's unit-test plan, 2026-11-22): lib/mold-requests.ts transpiled into
// .sites-runtime as tests/mold-design-files-server.mjs transpiles it (the coverage measure merges the runs; tests/mold-requests.mjs runs
// some of these in a vm, which the measure cannot see). The customer typed exactly as written (the owner, 2026-11-21: a request stored
// linked keeps its link only while its name and ERP code are the ones stored: spaces, a tab, Arabic and Persian digits and hidden marks in
// the code read as the server reads them; any other name or code, or something that is not text, drops it); who sees and approves a
// request for a customer not in the CRM (by its requester's regions: a representative, a supervisor, the sales manager of the team and of
// every region, a requester no longer listed) and one whose customer the route did not load (counted within); the waiting list's key and
// «waiting again»; the order number, the sheet's cities, why a request is active again after a cancellation, a change refused for good,
// why a PDF got no signed copy, the sending state, and the counts of what could not be read, in Arabic and English. Made-up data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {MOLD_SHEET_CITIES} from '../portable/mold-rules.mjs';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-requests-unit-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env={};');
fs.writeFileSync(path.join(out, 'auth.mjs'), 'export async function getApplicationUser(){return null;}');
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const source = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, quote, imported) => {
    if (imported === 'cloudflare:workers') return 'from ' + JSON.stringify(path.join(out, 'env.mjs'));
    if (imported === '@/app/application-auth') return 'from ' + JSON.stringify(path.join(out, 'auth.mjs'));
    if (!imported.startsWith('.') && !imported.startsWith('@/')) return match;
    let target = imported.startsWith('@/') ? imported.slice(2) : path.relative(root, path.resolve(path.dirname(source), imported));
    if (target.endsWith('.mjs')) return 'from ' + JSON.stringify(path.join(root, target));
    if (!/\.tsx?$/.test(target)) target += fs.existsSync(path.join(root, target + '.ts')) ? '.ts' : '.tsx';
    compile(target); return 'from ' + JSON.stringify(path.join(out, target.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
compile('lib/mold-requests.ts');
const lib = await import(path.join(out, 'lib/mold-requests.mjs'));

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ar = (a) => a, en = (a, b) => b;

// ---- the customer typed exactly as written: the link kept only for the same name and ERP code
{
  const stored = {name: 'مصنع الاختبار للبلوك', erpCode: 'C-456'};
  eq(lib.moldSameCustomerTyped({name: 'مصنع الاختبار للبلوك', erpCode: 'C-456'}, stored), true, 'the same name and code: the link kept');
  eq(lib.moldSameCustomerTyped({name: '  مصنع   الاختبار\tللبلوك ', erpCode: ' C-٤٥٦ '}, stored), true, 'spaces, a tab and Arabic digits read as the server reads them: the same');
  eq(lib.moldSameCustomerTyped({name: 'مصنع الاختبار للبلوك', erpCode: '‏C-۴۵۶‎'}, stored), true, 'Persian digits and hidden direction marks in the code: the same');
  eq(lib.moldSameCustomerTyped({name: 'مصنع الاختبار للبلوك', erpCode: 'C-457'}, stored), false, 'another code: unlinked');
  eq(lib.moldSameCustomerTyped({name: 'مصنع الاختبار للبلوكات', erpCode: 'C-456'}, stored), false, 'another name: unlinked');
  eq(lib.moldSameCustomerTyped({name: 'مصنع الاختبار للبلوك'}, stored), false, 'the code left out: unlinked');
  eq(lib.moldSameCustomerTyped({name: 'مصنع الاختبار للبلوك', erpCode: ''}, {name: 'مصنع الاختبار للبلوك'}), true, 'stored with no code and none typed: the same');
  eq(lib.moldSameCustomerTyped({name: 'مصنع الاختبار للبلوك', erpCode: 456}, {name: 'مصنع الاختبار للبلوك', erpCode: '456'}), false, 'a code that is not text: unlinked');
  for (const typed of [null, undefined, 'مصنع الاختبار للبلوك', ['مصنع الاختبار للبلوك', 'C-456'], 7]) eq(lib.moldSameCustomerTyped(typed, stored), false, 'not a customer object: unlinked (' + JSON.stringify(typed) + ')');
  eq(lib.moldSameCustomerTyped({name: 'ن'.repeat(300), erpCode: 'C-456'}, {name: 'ن'.repeat(300), erpCode: 'C-456'}), true, 'a very long name compared whole');
  eq([lib.moldFreeCustomer({customer: {crmNumber: null}}), lib.moldFreeCustomer({customer: {crmNumber: 27}}), lib.moldFreeCustomer({customer: {}}), lib.moldFreeCustomer(null)], [true, false, false, false], 'a request with no Yourrest number is typed only');
}

// ---- who sees and approves a request for a customer not in the CRM (customerId ''): by its requester's regions
{
  const member = (id, role, regionScope, supervisorId = '', active = 1) => ({id, name: 'عضو ' + id, email: id + '@example.invalid', role, branch: 'الرئيسي', supervisorId, regionScope, active, target: 0});
  const members = [member('sm-east', 'manager', 'eastern'), member('sm-west', 'manager', 'western'), member('sup', 'supervisor', 'eastern', 'sm-east'), member('rep', 'rep', 'eastern', 'sup'), member('rep-west', 'rep', 'western', 'sm-west'),
    member('admin', 'admin', 'all'), member('cs', 'customer_service', 'eastern'), member('sm-all', 'manager', 'all'), member('sm-gone', 'manager', 'eastern', '', 0), member('rep-orphan', 'rep', 'eastern', 'sm-gone')];
  const reader = id => ({me: members.find(m => m.id === id), members, regionCustomerIds: new Set()});
  const free = memberId => ({memberId, customerId: ''});
  const reads = id => ['rep', 'rep-west', 'cs', 'rep-orphan', 'gone'].filter(owner => lib.canReadMoldRequest(free(owner), reader(id)));
  eq(reads('rep'), ['rep'], 'a representative: their own only');
  eq(reads('sup'), ['rep'], 'a supervisor: their representative\'s, within the region they share');
  eq(reads('sm-east'), ['rep', 'cs', 'rep-orphan'], 'the eastern sales manager: his team\'s, customer service\'s and one whose manager left, all of his region; never the western team\'s');
  eq(reads('sm-west'), ['rep-west'], 'the western sales manager: his team only (customer service is eastern)');
  eq(reads('sm-all'), ['cs', 'rep-orphan', 'gone'], 'a sales manager of every region: every request in no active manager\'s team, a requester no longer listed included (someone approves it); never the eastern team\'s');
  eq(reads('admin'), ['rep', 'rep-west', 'cs', 'rep-orphan', 'gone'], 'the administrator: all');
  eq(reads('cs'), ['cs'], 'customer service: their own');
  eq(['rep', 'cs', 'rep-orphan', 'gone'].map(owner => lib.moldApprovesRequest(free(owner), reader('sm-east'))), [true, true, true, false], 'the eastern manager approves his team\'s, customer service\'s and the orphan\'s; never a requester no longer listed');
  eq(lib.moldApprovesRequest(free('rep'), reader('rep')), false, 'only a sales manager approves');
  eq([lib.moldApprovingManagerId(free('rep'), reader('admin')), lib.moldApprovingManagerId(free('rep-orphan'), reader('admin'))], ['sm-east', ''], 'his team\'s manager approves it; a team whose manager left: every manager of the region');
  // A CRM customer the route did not load (no records): counted within the team manager's regions.
  const linked = {memberId: 'rep', customerId: 'cust-unknown'};
  eq(lib.moldApprovingManagerId(linked, reader('admin')), 'sm-east', 'a customer whose region the route did not load: counted within (its team manager approves)');
  const loaded = {...reader('admin'), all: [{id: 'cust-west', kind: 'customer', data: {region: 'الغربية'}}]};
  eq(lib.moldApprovingManagerId({memberId: 'rep', customerId: 'cust-west'}, loaded), '', 'a customer of another region than the team manager\'s: every manager of that region');
}

// ---- the waiting list's key and «waiting again»; the order number in words
{
  const crm = {orderNo: null, requestRef: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', crmRequestId: 'mr-1', waitingSince: '2026-11-20T10:00:00+03:00'};
  eq([lib.moldPendingKey(crm), lib.moldPendingKey({...crm, crmRequestId: null}), lib.moldPendingKey({orderNo: 95, requestRef: undefined, crmRequestId: null})], ['crm:mr-1', 'ref:' + crm.requestRef, 'order:95'], 'by crmRequestId, else requestRef, else the number');
  eq(lib.moldPendingAgain(crm, [{...crm, waitingSince: '2026-11-20T10:05:00+03:00'}]), true, 'listed at the sales step since a later time: waiting again');
  eq(lib.moldPendingAgain(crm, [{...crm}]), false, 'the same wait listed again: not');
  eq(lib.moldPendingAgain(crm, [{...crm, crmRequestId: 'mr-2', waitingSince: '2026-11-21T10:00:00+03:00'}]), false, 'another request: not');
  eq(lib.moldPendingAgain({...crm, waitingSince: null}, [{...crm, waitingSince: 'not a time'}]), false, 'no time on either side: not');
  eq(lib.moldPendingAgain({...crm, waitingSince: null}, [crm]), true, 'a copy with no time, a listing with one: waiting again');
  eq([lib.moldOrderNoText(null, ar), lib.moldOrderNoText({orderNo: 101}, ar), lib.moldOrderNoText({orderNo: null}, en), lib.moldOrderNoText({orderNo: 0}, ar), lib.moldOrderNoText({orderNo: null}, ar, {cancelled: true})],
    ['—', '101', 'No number yet (given at production approval)', 'لم يأخذ رقمًا بعد (يأخذه عند اعتماد الإنتاج)', '—'], 'the number as given; none yet; never 0; none for one cancelled without a number');
  eq([lib.moldPendingUnreadableText(2, ar).startsWith('يوجد 2 طلب'), lib.moldPendingUnreadableText(2, en).startsWith('2 '), lib.moldOrdersUnreadableText(3, ar).startsWith('يوجد 3 طلب'), lib.moldOrdersUnreadableText(3, en).startsWith('3 request(s)')], [true, true, true, true], 'how many could not be read, in both languages');
}

// ---- the sheet's cities in the reader's language
{
  eq(MOLD_SHEET_CITIES.map(city => lib.moldCityText(city, ar)), ['الدمام', 'الرياض', 'القصيم', 'المدينة', 'جده', 'مكة', 'الطائف', 'خميس مشيط', 'جيزان'], 'Arabic: the part after the dash');
  eq(MOLD_SHEET_CITIES.map(city => lib.moldCityText(city, en)), ['Damam', 'Riyadh', 'Qassem', 'Madina', 'Jeddah', 'Makkah', 'Taif', 'Khames', 'Jizan'], 'English: the sheet\'s spelling, its letter case evened (MAkkah)');
  eq([lib.moldCityText('الدمام', en), lib.moldCityText('Tabuk - تبوك', en), lib.moldCityText('', ar)], ['الدمام', 'Tabuk - تبوك', ''], 'an older city, or one not of the sheet: as it is');
}

// ---- why a request is active again, a change refused for good, why a PDF got no signed copy, the sending state
{
  eq([lib.moldRestoredText(null, ar), lib.moldRestoredText({code: 'request_locked'}, ar)], ['', ''], 'no restore: nothing');
  eq(lib.moldRestoredText({code: 'restored', reason: 'same_reason'}, ar), 'أعاد مدير الإنتاج الطلب؛ لإلغائه مرة أخرى اكتب سببًا جديدًا.', 'the same reason came again: a new one asked for');
  eq(lib.moldRestoredText({code: 'restored', reason: 'same_reason'}, ar, {cancellable: false}), 'أعاده مدير الإنتاج بعد الإلغاء.', 'for a reader who may not cancel it: no reason asked for');
  eq(lib.moldRestoredText({code: 'restored', reason: 'cancel_dropped'}, en), 'The production manager restored it after the cancellation, so the waiting cancellation will not be sent again; to cancel it again, write a new reason.', 'a waiting cancellation dropped, in English');
  eq(lib.moldRestoredText({code: 'restored', reason: 'restored'}, ar), 'أعاده مدير الإنتاج بعد الإلغاء؛ لإلغائه مرة أخرى اكتب سببًا جديدًا.', 'restored after the cancellation reached production');
  eq([lib.moldProductionOnly({code: 'request_locked', reason: 'production_only'}), lib.moldProductionOnly({code: 'request_locked'}), lib.moldProductionOnly({code: 'invalid_payload', reason: 'production_only'}), lib.moldProductionOnly(null)], [true, false, false, false], 'production_only: the 409 with its reason only');
  eq([lib.moldChangeRefused({code: 'request_locked', reason: 'production_only'}), lib.moldChangeRefused({code: 'invalid_payload', final: true}), lib.moldChangeRefused({code: 'network'}), lib.moldChangeRefused({code: 'request_locked', final: false}), lib.moldChangeRefused(undefined)],
    [true, true, false, false, false], 'a change refused for good: production_only or marked final');
  eq(['protected', 'damaged', 'too_many_files', 'too_large', 'mismatch'].map(reason => lib.moldNotSignedText('Q-77.pdf', reason, ar)), [
    'لم يوضع التوقيع داخل Q-77.pdf: الملف محمي أو تالف', 'لم يوضع التوقيع داخل Q-77.pdf: الملف محمي أو تالف', 'لم يوضع التوقيع داخل Q-77.pdf: لا مكان لنسخة موقّعة (اكتمل حد ملفات هذا النوع)',
    'لم يوضع التوقيع داخل Q-77.pdf: النسخة الموقّعة أكبر من 25 ميجابايت', 'لم يوضع التوقيع داخل Q-77.pdf: لم تُنشأ نسخة موقّعة'], 'why a PDF got no signed copy, each reason');
  eq(lib.moldNotSignedText('تصميم.pdf', 'too_large', en), 'The signature was not put inside تصميم.pdf: the signed copy is larger than 25 MB', 'and in English');
  const state = (outbox, lastError = null, extra = {}) => ({outbox, lastError, data: {quoteNo: '', poNo: '', ...extra}});
  eq([lib.moldSendingState(state(null), false), lib.moldSendingState(state('send'), false), lib.moldSendingState(state('send', null, {quoteNo: 'Q-1'}), true, false), lib.moldSendingState(state('send', {code: 'payload_too_large'}), true), lib.moldSendingState(state('cancel', {code: 'network'}), true)],
    ['sent', 'off', 'held', 'rejected', 'waiting'], 'the sending state: sent even with the link off; off; a number before production\'s update held; refused for its data; waiting');
}

console.log(JSON.stringify({ok: true, checks}));

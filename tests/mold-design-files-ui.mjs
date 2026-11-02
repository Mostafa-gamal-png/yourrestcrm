// Mold request design files on the request's sheet, rendered from the real source (app/mold-design-files.tsx with lib/mold-requests.ts):
// what each file says beside its state: a deletion production refused (the file stays, and why), the last failure of a send (its limit is
// 2 minutes) and of a deletion (10 seconds), production not finding the request (404: not sent again by itself, use Resend), tries
// stopped after 24 hours (use Resend), a cancelled request's file (never «sent once production has the request»); a file production
// refused stays refused and takes no place when the production link is off (the counter and the picker); and the English wording.
// Render contracts only: no browser, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const root = process.cwd(), nativeRequire = createRequire(import.meta.url), modules = new Map();
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true};
const rules = await import(path.join(root, 'portable/mold-rules.mjs'));
let checks = 0, language = 'ar';
// Values made in the sandbox (its own Array and Object) are compared as plain data.
const eq = (actual, expected, message) => { assert.deepEqual(actual === undefined ? undefined : JSON.parse(JSON.stringify(actual)), expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const i18n = {useLanguage: () => ({language}), getLanguage: () => language, direction: () => language === 'en' ? 'ltr' : 'rtl', t: value => value};
const icon = () => null;
/** The source as the build sees it (TypeScript, the @/ paths), with the icons drawn as nothing. */
function load(filename) {
  if (modules.has(filename)) return modules.get(filename);
  const exports = {}; modules.set(filename, exports);
  const resolve = name => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === '@/lib/i18n') return i18n;
    if (name === '@/portable/mold-rules.mjs') return rules;
    if (name === 'lucide-react') return new Proxy({}, {get: () => icon});
    if (name.startsWith('@/lib/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('./')) return load(path.join(path.dirname(filename), name) + '.ts');
    return nativeRequire(name);
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {compilerOptions: compiler, fileName: filename}).outputText,
    // No server here: every request fails as an unreachable network would.
    {exports, require: resolve, console, Date, Intl, crypto, URL, Promise, setTimeout, clearTimeout, FormData, File, Blob, AbortController, fetch: async () => { throw new TypeError('offline'); }, window: undefined, navigator: undefined}, {filename});
  return exports;
}
const ui = load('app/mold-design-files.tsx'), lib = load('lib/mold-requests.ts');
const say = (ar, en) => language === 'en' ? en : ar;

const at = '2026-11-02T08:00:00.000Z', later = '2026-11-02T08:05:00.000Z', me = {id: 'rep', role: 'rep', regionScope: 'eastern'};
const specs = {description: 'قالب بلوك 20 سم', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 1, designUrl: '', notes: ''};
const data = {requestedAt: '2026-11-02T10:00:00+03:00', customer: {crmNumber: 27, name: 'مصنع تجريبي', address: 'الدمام', city: 'الدمام'}, salesman: {crmMemberId: 'rep', name: 'مندوب تجريبي', email: 'rep@yourrest.org'}, specs};
const remote = (designFiles = []) => ({crmRequestId: 'mr-1', orderNo: 94, status: 'received', editable: true, moldSerial: null, productionDate: null, stages: {}, stagesDone: 0, stagesTotal: 7, delivered: false, deliveryDate: null,
  updatedAt: null, revision: 3, waitingStep: 'sales', waitingSince: at, approvals: {required: true, sales: null, production: null, admin: null}, designFiles});
const request = (change = {}) => ({id: 'mr-1', memberId: 'rep', customerId: 'factory', legacyOrderNo: null, data, accepted: data, cancelledAt: null, cancelReason: '', outbox: null, attempts: 0, firstFailedAt: null,
  nextAttemptAt: null, lastAttemptAt: null, lastError: null, remote: remote(), remoteAt: at, createdBy: 'rep', createdAt: at, updatedAt: at, version: 1, ...change});
let serial = 0;
const file = (name, change = {}) => ({id: 'mdf-' + (++serial), requestId: 'mr-1', memberId: 'rep', name, kind: 'pdf', contentType: 'application/pdf', size: 2048, sha256: 'x', objectKey: 'mold-design/mr-1/' + serial, createdAt: at,
  deletedAt: null, outbox: 'send', attempts: 1, firstFailedAt: at, nextAttemptAt: '2026-11-02T08:06:00.000Z', lastAttemptAt: later, lastError: null, remoteFileId: null, sentAt: null, version: 1, ...change});
/** The sheet's files section as it renders, and the text of each file's row. */
function render(row, files, linkReady = true) {
  const view = lib.moldRequestView(row, me, [], linkReady, files);
  const html = renderToStaticMarkup(React.createElement(ui.MoldDesignFiles, {view, uploads: [], queue: new ui.DesignUploadQueue(), onView: () => {}, say}));
  const rows = html.split('<li class="mold-design-file"').slice(1).map(part => part.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  return {view, html, rows, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')};
}

// ---- 1. Beside each state, why it stands there
{
  const refusedDeletion = file('رسم باقٍ.pdf', {outbox: null, sentAt: at, attempts: 0, nextAttemptAt: null, remoteFileId: 501, lastError: {code: 'request_locked', http: 409, at: later, final: true}});
  const timedOut = file('رسم كبير.pdf', {lastError: {code: 'timeout', http: 0, at: later}});
  const stopped = file('رسم متوقف.pdf', {nextAttemptAt: null, attempts: 12, lastError: {code: 'network', http: 0, at: later}});
  const notThere = file('رسم 404.pdf', {nextAttemptAt: null, lastError: {code: 'unknown_route', http: 404, at: later}});
  const deleting = file('رسم يُحذف.pdf', {outbox: 'delete', deletedAt: later, sentAt: at, lastError: {code: 'timeout', http: 0, at: later}});
  const {rows, view} = render(request(), [refusedDeletion, timedOut, stopped, notThere, deleting]);
  eq(view.designFiles.map(entry => [entry.name, entry.state, entry.stopped]), [['رسم باقٍ.pdf', 'sent', false], ['رسم كبير.pdf', 'waiting', false], ['رسم متوقف.pdf', 'waiting', true], ['رسم 404.pdf', 'waiting', true], ['رسم يُحذف.pdf', 'deleting', false]], 'the states and which have stopped');
  ok(rows[0].includes('وصل للإنتاج') && rows[0].includes('لم يُحذف من الإنتاج: اكتملت الاعتمادات؛ لم يعد تغيير ملفات الطلب ممكنًا'), 'a deletion production refused: the file stays, and why: ' + rows[0]);
  ok(rows[1].includes('آخر محاولة: لم يرد تطبيق الإنتاج خلال دقيقتين.') && !rows[1].includes('10 ثوانٍ'), 'a file\'s send waits up to 2 minutes, not 10 seconds: ' + rows[1]);
  ok(!rows[1].includes('توقفت'), 'still tried by itself: no word of stopping');
  ok(rows[2].includes('آخر محاولة: تعذّر الوصول إلى تطبيق الإنتاج.') && rows[2].includes('توقفت المحاولات التلقائية بعد 24 ساعة؛ استخدم «إعادة الإرسال».'), 'stopped after 24 hours: use Resend: ' + rows[2]);
  ok(rows[3].includes('لم يجد تطبيق الإنتاج الطلب، أو لا يستقبل ملفات التصميم بعد. لن يُعاد الإرسال تلقائيًا؛ استخدم «إعادة الإرسال».') && !rows[3].includes('24 ساعة'), 'production did not find it (404): use Resend: ' + rows[3]);
  ok(rows[4].includes('جارٍ حذفه من الإنتاج') && rows[4].includes('خلال 10 ثوانٍ'), 'a deletion\'s call waits 10 seconds: ' + rows[4]);
  eq((render(request(), [deleting]).html.match(/<a /g) || []).length, 0, 'a file being deleted offers no link');
}

// ---- 2. A cancelled request's file is not sent, and says so (not «sent once production has the request»)
{
  const waiting = file('قبل الإلغاء.pdf', {attempts: 0, lastAttemptAt: null, nextAttemptAt: at});
  for (const [label, row] of [['never accepted', request({accepted: null, remote: null, remoteAt: null, cancelledAt: later})], ['accepted', request({cancelledAt: later, outbox: 'cancel', nextAttemptAt: later})]]) {
    const {rows, view} = render(row, [waiting]);
    eq(view.designFiles[0].state, 'cancelled', label + ': cancelled');
    ok(rows[0].includes('لن يُرسل: الطلب ملغى') && !rows[0].includes('يُرسل بعد وصول الطلب للإنتاج'), label + ': not sent: ' + rows[0]);
  }
}

// ---- 3. A refused file stays refused when the link is off: it takes no place, so the counter and the picker agree with the server
{
  const refused = Array.from({length: 10}, (_, n) => file('مرفوض ' + (n + 1) + '.png', {kind: 'image', contentType: 'image/png', nextAttemptAt: null, lastError: {code: 'invalid_payload', reason: 'bad_image', http: 400, at: later, final: true}}));
  for (const linkReady of [true, false]) {
    const {view, html, rows} = render(request(), refused, linkReady);
    eq([...new Set(view.designFiles.map(entry => entry.state))], ['rejected'], 'refused, link ' + (linkReady ? 'on' : 'off'));
    eq(lib.moldDesignCount(request(), refused).crm, 0, 'the server counts none of them');
    eq([ui.designUsed(view, []), /dir="ltr">0\/10</.test(html), html.includes('type="file"'), html.includes('احذف ملفًا أولًا')], [0, true, true, false], 'link ' + (linkReady ? 'on' : 'off') + ': 0/10, the picker offered');
    ok(rows.every(text => text.includes('الصورة تالفة أو بصيغة غير مدعومة')), 'each with production\'s reason');
  }
}

// ---- 4. The same in English
{
  language = 'en';
  const {rows} = render(request(), [
    file('kept.pdf', {outbox: null, sentAt: at, nextAttemptAt: null, lastError: {code: 'request_locked', http: 409, at: later, final: true}}),
    file('slow.pdf', {lastError: {code: 'timeout', http: 0, at: later}}),
    file('stopped.pdf', {nextAttemptAt: null, lastError: {code: 'network', http: 0, at: later}}),
  ]);
  ok(rows[0].includes('Not deleted at production: The approvals are complete; the files can no longer change'), rows[0]);
  ok(rows[1].includes('Last try: Production did not answer within 2 minutes.'), rows[1]);
  ok(rows[2].includes('Automatic tries stopped after 24 hours; use Resend.'), rows[2]);
  eq(render(request({cancelledAt: later}), [file('c.pdf', {attempts: 0, lastAttemptAt: null})]).rows[0].includes('Not sent: the request is cancelled'), true, 'a cancelled request\'s file');
  ok(rows.every(text => !/[؀-ۿ]/.test(text.replace(/kept|slow|stopped/g, ''))), 'no Arabic left in the rows: ' + rows.join(' | '));
  language = 'ar';
}

// ---- 5. The member's upload queue outlives the page (the same one each time the page opens) and takes the same file once
{
  const queue = ui.designUploadQueue('rep');
  eq([queue === ui.designUploadQueue('rep'), queue === ui.designUploadQueue('rep2')], [true, false], 'one queue a member, kept while the app is open');
  // No network here: an upload that starts fails at once, so the queue's handling of a second pick of the same file can be read.
  const quiet = new ui.DesignUploadQueue(), picked = name => new File(['AC10'], name, {lastModified: 1});
  const choice = (key, file) => ({key, file, name: file.name, size: file.size, kind: 'other', refusal: ''});
  quiet.add('mr-1', [choice('k1', picked('رسم.dwg'))]);
  await new Promise(resolve => setTimeout(resolve, 50));
  eq(quiet.snapshot().map(item => [item.key, item.phase]), [['k1', 'failed']], 'the first upload failed (no server here)');
  quiet.add('mr-1', [choice('k2', picked('رسم.dwg')), choice('k3', picked('رسم آخر.dwg'))]);
  eq(quiet.snapshot().map(item => item.key), ['k1', 'k3'], 'the same file chosen again retries its own upload (its requestId), only the other file is added');
  quiet.add('mr-2', [choice('k4', picked('رسم.dwg'))]);
  await new Promise(resolve => setTimeout(resolve, 50));
  eq(quiet.snapshot().map(item => item.key), ['k1', 'k3', 'k4'], 'the same file for another request is its own upload');
}

// ---- 6. Production's refusals for a file's place (PR #27: 400, fields crmFileId, details.reason): said in words, final, taking no place
{
  const used = file('رسم مكرر.pdf', {nextAttemptAt: null, lastError: {code: 'invalid_payload', fields: ['crmFileId'], reason: 'crm_file_id_used', http: 400, at: later, final: true}});
  const full = file('الحادي عشر.pdf', {nextAttemptAt: null, lastError: {code: 'invalid_payload', fields: ['crmFileId'], reason: 'too_many_files', http: 400, at: later, final: true}});
  const {rows, view} = render(request(), [used, full]);
  eq([view.designFiles.map(entry => entry.state), view.designFiles.map(entry => entry.stopped), view.can.resend, lib.moldDesignCount(request(), [used, full]).crm], [['rejected', 'rejected'], [false, false], false, 0], 'refused for good: not stopped, nothing to resend, no place taken');
  // The state says production refused it; the reason below says why, without saying it twice, and with the words the other reasons use.
  ok(rows[0].includes('رفض الإنتاج الملف رقم الملف مستخدم قبل كده لملف تاني أو لملف اتحذف؛ احذفه وأرفقه من جديد') && rows[0].split('رفض').length === 2 && !rows[0].includes('ارفعه'), 'crm_file_id_used in words, the refusal said once: ' + rows[0]);
  ok(rows[1].includes('الحد 10 ملفات للطلب (ملفاتك وملفات الإنتاج)'), 'too_many_files in words: ' + rows[1]);
  eq([ui.designRefusal({code: 'invalid_payload', fields: ['crmFileId'], reason: 'crm_file_id_used'}, (ar, en) => en), ui.designRefusal({code: 'invalid_payload', fields: ['crmFileId']}, say)],
    ['The file\'s number was already used for another file or a deleted one; delete it and attach it again', 'رفض الإنتاج الملف'], 'in English too; a crmFileId refusal without a reason reads as a plain refusal');
}

// ---- 7. The sales manager's pending files: links while the request waits; named only, with a note, on a card just approved
{
  const item = {orderNo: 94, designFiles: [{fileId: 501, crmFileId: 'mdf-1', name: 'رسم.pdf', kind: 'pdf', size: 2048, source: 'crm', uploadedAt: at}, {fileId: 'p-2', crmFileId: null, name: 'مسقط.dwg', kind: 'other', size: 10, source: 'production', uploadedAt: at}]};
  const files = lib.moldPendingDesignFiles(item), pending = note => renderToStaticMarkup(React.createElement(ui.MoldPendingDesignFiles, {files, say, note}));
  const waiting = pending(undefined);
  eq([(waiting.match(/<a /g) || []).length, waiting.includes('/api/mold-requests/design-file?order=94&amp;file=501'), waiting.includes('data-links')], [3, true, false], 'waiting: Open and Download for the PDF, Download for the drawing, by order number');
  for (const inCrm of [true, false]) {
    const note = ui.pendingFilesApprovedNote(inCrm, say), done = pending(note), text = done.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    eq([(done.match(/<a /g) || []).length, done.includes('design-file?'), done.includes('data-links="off"'), text.includes('رسم.pdf') && text.includes('مسقط.dwg'), text.includes(note)], [0, false, true, true, true], 'just approved' + (inCrm ? ' (a CRM request)' : ' (registered in production)') + ': no view or download link, the names and the note');
  }
  eq([ui.pendingFilesApprovedNote(true, say), ui.pendingFilesApprovedNote(false, (ar, en) => en)], ['بعد اعتمادك لا تُفتح الملفات من هنا؛ افتح الطلب لعرضها.', 'Once you approve, the files no longer open from here.'], 'the note: where the files are, in both languages');
}

console.log(JSON.stringify({ok: true, checks, scope: 'mold design files on the sheet: state details, stopped, cancelled, refused with the link off, place refusals, English; the pending files with and without links', productionDataUsed: false}));

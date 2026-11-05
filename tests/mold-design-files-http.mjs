// Mold request design files (the contract's addition «ملفات التصميم», 2026-11-02) over real HTTP against the BUILT release (run
// `pnpm build` first), sending to the stand-in production API (scripts/lib/products-mock.mjs, HTTPS with a throwaway CA): a representative
// attaches a file to a request production holds (sent at once, the approvals undone, the request back with the sales manager); a file
// attached before production holds the request waits and goes after it is accepted; the same tap twice stores and sends once, and a send
// whose answer was lost is answered 200 created:false; the CRM's own refusals (each reason, the name, 413) store and send nothing; what
// production's PR #27 accepts (a PDF header after other bytes, CON.pdf, a PNG named .jpg) goes through and is served as what it is;
// production's refusals (400 with each reason, the place refusals of PR #27 naming crmFileId, 413, 409 request_locked) are shown with
// their reason and never retried; a 404 (production
// does not hold the request) is not retried by itself but the requester's resend tries again; deletion (a file production never held,
// in the CRM alone; one it holds, through design-file-delete; its 409 keeps the file with the reason and the status, its 404 completes
// it); production's
// own files in the request and in the sales manager's pending list; downloads through the CRM with the permission check (the requester,
// the supervisor, not another representative or customer service, the sales manager by order number only for their pending items, the
// other region's manager not, anonymous 401); the 10 files a request with production's; uploads beyond two at once answered 429; and
// (production's second update of 2026-11-03) the quotation's and PO's files: none before the update is known, then each with its category,
// its 5 places, production's refusals (not_document, too_many_files), a retry with the same category, production's own PO file, and a
// download by fileId from any list.
// Synthetic isolated fixtures only: temporary SQLite and object store, mocked sendmail, no production data, no real production application.
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {withSignature} from '../scripts/lib/signature-png.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'smw', role: 'manager', region: 'western'},
  {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'},
  {id: 'rep2', role: 'rep', sup: 'sm', region: 'eastern'}, {id: 'csm', role: 'customer_service_manager', sup: 'sm'}, {id: 'cs', role: 'customer_service', sup: 'csm'},
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const specs = {description: 'قالب بلوك 20 سم', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 1, designUrl: '', notes: ''};
const pdf = text => Buffer.from('%PDF-1.4\n% ' + text + '\n%%EOF\n');
/** A PNG header declaring its size (the CRM and production read the size from IHDR). */
const png = (width, height) => { const b = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); b[24] = 8; b[25] = 6; return b; };
const MiB = 1024 * 1024;

const mock = await startProductsMock();
const app = await bootBuiltApp({members}, {env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(id ? sessions[id] : null);
  const now = new Date().toISOString();
  const customer = (id, assignedTo, region) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', address: 'حي الصناعية', code: 'ERP-' + id, branch: 'الرئيسي', assignedTo}), now, now).run();
  await customer('east1', 'rep', 'الشرقية'); await customer('east2', 'rep', 'الشرقية'); await customer('west1', 'rep2', 'الغربية');
  // A representative's request carries the customer's signature (2026-11-04), one of its design files: each request below starts with it.
  const post = (who, body) => as(who)('/api/mold-requests', {method: 'POST', body: withSignature(members.find(member => member.id === who)?.role, {requestId: crypto.randomUUID(), ...body})});
  const create = async (who, customerId, description) => (await (await post(who, {action: 'create', customerId, specs: {...specs, description}, payment: 'cash'})).json()).request;
  const list = async who => (await as(who)('/api/mold-requests')).json();
  const viewOf = async (who, id) => (await list(who)).requests.find(item => item.id === id);
  const age = id => app.db.prepare("UPDATE crm_mold_requests SET remote_at='2026-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
  const calls = route => mock.state.calls.filter(call => call.route === route).length;
  const fileRow = id => app.db.prepare('SELECT * FROM crm_mold_design_files WHERE id=?').bind(id).first();
  // The files attached here, without the customer's signature each request carries (its crmFileId starts mds-, 2026-11-04).
  const rowsOf = async requestId => (await app.db.prepare("SELECT id FROM crm_mold_design_files WHERE request_id=? AND id NOT LIKE 'mds-%'").bind(requestId).all()).results.length;
  const drawn = files => (files || []).filter(file => !file.signature && !String(file.crmFileId || '').startsWith('mds-'));
  const multipart = async fields => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) if (value && typeof value === 'object' && 'bytes' in value) form.set(key, new Blob([value.bytes]), value.name); else form.set(key, value);
    const encoded = new Response(form);
    return {body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}};
  };
  const upload = async (who, id, name, bytes, requestId = crypto.randomUUID(), headers = {}) => {
    const encoded = await multipart({requestId, id, file: {name, bytes}});
    return as(who)('/api/mold-requests/design-files', {method: 'POST', body: encoded.body, headers: {...encoded.headers, ...headers}});
  };
  /** Where the private object store keeps an object (portable/storage.mjs: the SHA-256 of its key). */
  const objectPath = key => path.join(app.work, 'data/objects', createHash('sha256').update(key).digest('hex'));
  const remove = (who, id, fileId, requestId = crypto.randomUUID()) => as(who)('/api/mold-requests/design-files/delete', {method: 'POST', body: {requestId, id, fileId}});
  const download = (who, query) => as(who)('/api/mold-requests/design-file?' + query);
  const until = async (test, message) => { for (let n = 0; n < 100; n++) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 100)); } assert.fail(message); };

  // ---- the routes are closed to strangers
  const first = await create('rep', 'east1', 'first mold');
  check([first.remote.orderNo, first.remote.status, first.can.attach, first.can.deleteFile, drawn(first.designFiles)], [92, 'received', true, true, []], 'a request production holds: the requester may attach and delete');
  check([first.designFiles.map(file => [file.signature, file.state, file.canDelete, file.kind]), drawn(mock.row(first.id).designFiles).length, mock.row(first.id).designFiles.length], [[[true, 'sent', false, 'image']], 0, 1], 'its only file is the customer\'s signature, sent to production as a design image, not deletable');
  const anonymousUpload = await multipart({requestId: crypto.randomUUID(), id: first.id, file: {name: 'x.pdf', bytes: pdf('x')}});
  check((await app.request('/api/mold-requests/design-files', {method: 'POST', headers: {Origin: app.origin, ...anonymousUpload.headers}, body: anonymousUpload.body})).status, 401, 'anonymous upload: 401');
  check((await app.request('/api/mold-requests/design-files/delete', {method: 'POST', headers: {Origin: app.origin}, body: {requestId: crypto.randomUUID(), id: first.id, fileId: 'mdf-x'}})).status, 401, 'anonymous delete: 401');
  check((await app.request('/api/mold-requests/design-file?id=' + first.id + '&file=mdf-x')).status, 401, 'anonymous download: 401');
  check((await upload('rep', first.id, 'x.pdf', pdf('x'), crypto.randomUUID(), {Origin: 'https://evil.example'})).status, 403, 'another origin: 403');
  for (const who of ['sup', 'sm', 'owner']) check((await upload(who, first.id, 'x.pdf', pdf('x'))).status, 403, who + ' reads the request but only the requester attaches');
  check((await upload('rep2', first.id, 'x.pdf', pdf('x'))).status, 404, 'another representative: the request is not there for them');
  check(await rowsOf(first.id), 0, 'none of these stored anything');

  // ---- attach to a request production holds: sent at once; the approvals are undone and the request goes back to the sales manager
  check((await post('sm', {action: 'approve', id: first.id})).status, 200, 'the sales manager approves');
  check((await viewOf('rep', first.id)).remote.waitingStep, 'production', 'it waits for production');
  const drawing = pdf('رسم القالب الأول'), drawingKey = crypto.randomUUID(), drawingId = 'mdf-' + drawingKey, sendsBefore = calls('design-files');
  let res = await upload('rep', first.id, 'رسم القالب 1380.pdf', drawing, drawingKey);
  let body = await res.json();
  check([res.status, body.ok, body.send, body.file.crmFileId, body.file.state, body.file.source, body.file.kind, body.file.size, body.file.viewable], [200, true, {kind: 'ok', code: ''}, drawingId, 'sent', 'crm', 'pdf', drawing.length, true], 'attached and sent at once');
  check([body.request.remote.approvals.sales, body.request.remote.waitingStep, drawn(body.request.remote.designFiles).map(file => file.crmFileId)], [null, 'sales', [drawingId]], 'the answer\'s request: the approval undone, back with the sales manager, the file listed by production');
  check(calls('design-files') - sendsBefore, 1, 'one send');
  const sent = mock.state.calls.findLast(call => call.route === 'design-files');
  check([JSON.parse(sent.body), sent.headers['content-type'], sent.signed], [{crmRequestId: first.id, crmFileId: drawingId, name: 'رسم القالب 1380.pdf'}, 'application/octet-stream', true], 'the JSON line, application/octet-stream, signed over the whole body');
  check(Buffer.compare(drawn(mock.row(first.id).designFiles)[0].bytes, drawing), 0, 'production holds the same bytes');
  const stored = await fileRow(drawingId);
  ok(stored.sent_at && stored.object_key && stored.outbox === null && JSON.parse(stored.remote_file_id) === drawn(mock.row(first.id).designFiles)[0].fileId, 'stored as sent, with production\'s fileId and the CRM\'s copy');
  check([(await viewOf('sm', first.id)).can.approve, drawn((await viewOf('rep', first.id)).designFiles).map(file => [file.name, file.state])], [true, [['رسم القالب 1380.pdf', 'sent']]], 'the sales manager may approve again; the list shows the file sent');
  const audit = (await app.db.prepare("SELECT detail FROM crm_audit WHERE record_id=? AND action='mold-design:attach'").bind(first.id).all()).results;
  check([audit.length, JSON.parse(audit[0].detail).name, audit[0].detail.includes('PDF-1.4')], [1, 'رسم القالب 1380.pdf', false], 'audited by name and size, never the contents');

  // ---- the same tap twice: one file, one send; the same requestId with another file is refused
  res = await upload('rep', first.id, 'رسم القالب 1380.pdf', drawing, drawingKey);
  body = await res.json();
  check([res.status, body.file.crmFileId, body.file.state, calls('design-files') - sendsBefore, await rowsOf(first.id)], [200, drawingId, 'sent', 1, 1], 'repeated: the saved answer, nothing stored or sent again');
  check((await upload('rep', first.id, 'رسم آخر.pdf', pdf('other'), drawingKey)).status, 409, 'the same requestId with another file: 409');
  // A send whose answer was lost (a timeout after production saved it): sent again by the resend, production answers 200 created:false.
  const filesAtProduction = mock.state.nextFile;
  await app.db.prepare("UPDATE crm_mold_design_files SET outbox='send',sent_at=NULL,next_attempt_at=NULL,attempts=3,last_error=? WHERE id=?").bind(JSON.stringify({code: 'timeout', http: 0, at: now}), drawingId).run();
  check((await viewOf('rep', first.id)).can.resend, true, 'a send stopped after its tries: the requester may resend');
  check((await post('rep', {action: 'resend', id: first.id})).status, 200, 'resend');
  await until(async () => (await fileRow(drawingId)).sent_at, 'the file was sent again');
  check([calls('design-files') - sendsBefore, mock.state.nextFile, drawn(mock.row(first.id).designFiles).length, (await fileRow(drawingId)).outbox], [2, filesAtProduction, 1, null], 'sent once more: production answered 200 created:false (no second file there); the CRM marks it sent');

  // ---- the CRM's own checks, as production's: each refusal says why; nothing is stored or sent
  const refusals = [['empty.pdf', Buffer.alloc(0), 400, 'empty', 'file'], ['not-a-pdf.pdf', Buffer.from('hello'), 400, 'not_pdf', 'file'], ['broken.png', Buffer.from('not an image at all'), 400, 'bad_image', 'file'],
    ['huge.png', png(10000, 9000), 400, 'too_many_pixels', 'file'], ['drawing.exe', pdf('exe'), 400, 'name', 'name'], ['a<b>.pdf', pdf('bad name'), 400, 'name', 'name'], ['big.pdf', Buffer.concat([pdf('big'), Buffer.alloc(25 * MiB)]), 413, 'too_large', 'file']];
  const before = calls('design-files');
  for (const [name, bytes, status, reason, field] of refusals) {
    res = await upload('rep', first.id, name, bytes);
    body = await res.json();
    check([res.status, body.reason, Object.keys(body.fields)], [status, reason, [field]], name + ': ' + status + ' ' + reason);
    ok(typeof body.error === 'string' && body.error.length > 5, name + ': said in words');
  }
  check([calls('design-files') - before, await rowsOf(first.id)], [0, 1], 'nothing stored, nothing sent');

  // ---- PR #27: what production accepts now, the CRM accepts too: a PDF whose %PDF-1.x follows other bytes within its first 1024, a
  //  Windows reserved name, an image whose extension names another of the four (sent, kept and served as what it is); never a bare %PDF-
  const pr27 = await create('rep', 'east2', 'pr27 mold');
  const leading = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.alloc(600, 0x0a), pdf('after leading bytes')]), photo = png(640, 480);
  for (const [name, bytes, kind] of [['CON.pdf', leading, 'pdf'], ['COM1.jpg', photo, 'image'], ['aux.dwg', Buffer.from('AC1027 aux'), 'other']]) {
    res = await upload('rep', pr27.id, name, bytes);
    body = await res.json();
    check([res.status, body.file?.name, body.file?.kind, body.file?.state], [200, name, kind, 'sent'], name + ': accepted by the CRM and by production');
  }
  check(drawn(mock.row(pr27.id).designFiles).map(file => [file.name, file.type]), [['CON.pdf', 'application/pdf'], ['COM1.jpg', 'image/png'], ['aux.dwg', 'application/octet-stream']], 'production keeps each as what it is');
  const mismatched = (await viewOf('rep', pr27.id)).designFiles.find(file => file.name === 'COM1.jpg');
  res = await download('rep', 'id=' + pr27.id + '&file=' + mismatched.crmFileId + '&inline=1');
  check([res.status, res.headers['content-type'], res.headers['content-disposition'].split(';')[0], Buffer.compare(res.bytes, photo)], [200, 'image/png', 'inline', 0], 'the PNG named .jpg is served by the CRM as the PNG it is');
  const pr27Sends = calls('design-files');
  for (const [name, bytes] of [['bare.pdf', Buffer.from('%PDF-\n%%EOF\n')], ['late.pdf', Buffer.concat([Buffer.alloc(1024, 0x20), pdf('too late')])]]) {
    res = await upload('rep', pr27.id, name, bytes);
    body = await res.json();
    check([res.status, body.reason], [400, 'not_pdf'], name + ': not a PDF (no version, or beyond the first 1024 bytes), refused by the CRM itself');
  }
  check([calls('design-files') - pr27Sends, await rowsOf(pr27.id)], [0, 3], 'those were neither stored nor sent');

  // ---- attached before production holds the request: kept, sent once the request is accepted
  mock.state.down = true;
  const second = await create('rep', 'east2', 'second mold');
  check(second.sending.state, 'waiting', 'production unreachable: the request waits');
  const photoKey = crypto.randomUUID(), photoId = 'mdf-' + photoKey;
  res = await upload('rep', second.id, 'صورة القالب.png', png(800, 600), photoKey);
  body = await res.json();
  check([res.status, body.send, body.file.state, body.file.kind], [200, null, 'held', 'image'], 'kept in the CRM: sent once production holds the request');
  const spare = (await (await upload('rep', second.id, 'نسخة زائدة.pdf', pdf('spare'))).json()).file;
  mock.state.down = false;
  const heldSends = calls('design-files');
  check((await post('rep', {action: 'resend', id: second.id})).status, 200, 'the request is resent and accepted');
  // Two files a run: the third (the customer's signature, waiting with them) goes on the next check, which any page load makes.
  await until(async () => { await list('rep'); return (await fileRow(photoId)).sent_at && (await fileRow(spare.crmFileId)).sent_at && (await fileRow('mds-' + second.id.slice(3))).sent_at; }, 'both files and the signature followed the request');
  check([calls('design-files') - heldSends, (await viewOf('rep', second.id)).designFiles.map(file => [file.signature || false, file.state])], [3, [[true, 'sent'], [false, 'sent'], [false, 'sent']]], 'sent after the request was accepted, the customer\'s signature too');

  // ---- production refuses a file the CRM accepted (400 with each reason, 413): shown with the reason, final, never retried
  const third = await create('rep', 'east1', 'third mold');
  const productionRefusals = [[400, {code: 'invalid_payload', message: 'The file was refused.', fields: ['file'], details: {reason: 'empty'}}, 'empty'],
    [400, {code: 'invalid_payload', message: 'The file was refused.', fields: ['file'], details: {reason: 'not_pdf'}}, 'not_pdf'],
    [400, {code: 'invalid_payload', message: 'The file was refused.', fields: ['file'], details: {reason: 'bad_image'}}, 'bad_image'],
    [400, {code: 'invalid_payload', message: 'The file was refused.', fields: ['file'], details: {reason: 'too_many_pixels'}}, 'too_many_pixels'],
    // PR #27: the refusals for a file's place name crmFileId, not file
    [400, {code: 'invalid_payload', message: 'A request holds at most 10 files.', fields: ['crmFileId'], details: {reason: 'too_many_files'}}, 'too_many_files'],
    [400, {code: 'invalid_payload', message: 'This crmFileId belonged to a file deleted since.', fields: ['crmFileId'], details: {reason: 'crm_file_id_used'}}, 'crm_file_id_used'],
    [413, {code: 'payload_too_large', message: 'The file is larger than 25 MB.'}, undefined]];
  const refusedIds = [];
  for (const [http, error, reason] of productionRefusals) {
    mock.answerNext('design-files', http, {error});
    res = await upload('rep', third.id, 'رفض ' + (reason || http) + '.pdf', pdf('refused ' + http + reason));
    body = await res.json();
    check([res.status, body.send.kind, body.send.code, body.send.reason, body.file.state, body.file.error.code, body.file.error.reason, body.file.error.final, body.file.canDelete],
      [200, 'rejected', error.code, reason, 'rejected', error.code, reason, true, true], 'production ' + http + ' ' + (reason || error.code) + ': shown as refused with its reason, final, deletable');
    refusedIds.push(body.file.crmFileId);
    const row = await fileRow(body.file.crmFileId);
    check([row.next_attempt_at, row.sent_at, row.outbox], [null, null, 'send'], 'not on the timetable');
  }
  const refusedSends = calls('design-files'), approvalAfter = await viewOf('rep', third.id);
  check([approvalAfter.can.resend, (await post('rep', {action: 'resend', id: third.id})).status], [false, 409], 'not resent by the resend button either');
  await list('owner');
  check(calls('design-files'), refusedSends, 'and never sent again by itself');
  check(approvalAfter.designFiles.filter(file => file.state === 'rejected').length, 7, 'each one listed with its refusal');
  check(approvalAfter.designFiles.filter(file => file.error?.reason === 'too_many_files' || file.error?.reason === 'crm_file_id_used').map(file => [file.error.reason, file.error.fields, file.error.http, file.error.final]),
    [['too_many_files', ['crmFileId'], 400, true], ['crm_file_id_used', ['crmFileId'], 400, true]], 'the place refusals keep their field and reason, final');

  // ---- 404: production does not hold the request: not tried again by itself, the reason shown, the resend tries again
  // 409 request_locked: production's approvals were complete first
  const fourth = await create('rep', 'east1', 'fourth mold');
  mock.forget(fourth.id);
  res = await upload('rep', fourth.id, 'قبل الطلب.pdf', pdf('before the request'));
  body = await res.json();
  check([res.status, body.send.kind, body.file.state, body.file.stopped, body.file.error.code, body.file.error.http, body.file.error.final, (await fileRow(body.file.crmFileId)).next_attempt_at],
    [200, 'not_found', 'waiting', true, 'not_found', 404, undefined, null], '404 from production: not tried again by itself, the reason shown');
  const notFoundSends = calls('design-files');
  check([body.request.can.resend, (await post('rep', {action: 'resend', id: fourth.id})).status], [true, 200], 'the requester may resend it');
  await until(async () => calls('design-files') > notFoundSends && (await fileRow(body.file.crmFileId)).next_attempt_at === null, 'the resend tried again');
  check([calls('design-files') - notFoundSends, drawn((await viewOf('rep', fourth.id)).designFiles)[0].stopped], [1, true], 'tried once more; production still lacks the request, so it stops again');
  const fifth = await create('rep', 'east1', 'fifth mold');
  for (const step of ['sales', 'production', 'admin']) mock.approve(fifth.id, step);
  const lockedSends = calls('design-files');
  res = await upload('rep', fifth.id, 'بعد الاعتماد.pdf', pdf('after the approvals'));
  body = await res.json();
  check([res.status, body.ok, body.send, body.file.state, body.file.error.code, body.request.remote.status, body.request.editable, body.request.can.attach], [409, false, {kind: 'locked', code: 'request_locked'}, 'locked', 'request_locked', 'confirmed', false, false], '409 request_locked: the file is kept as not sent, the request shows production\'s status');
  ok(/اكتملت الاعتمادات/.test(body.error), 'with a clear message');
  check([calls('design-files') - lockedSends, drawn(mock.row(fifth.id).designFiles)], [1, []], 'production holds no file (but the signature, sent with the request)');
  check((await upload('rep', fifth.id, 'مرة أخرى.pdf', pdf('again'))).status, 409, 'a request no longer editable takes no more files');
  const lockedFile = body.file;
  res = await remove('rep', fifth.id, lockedFile.crmFileId);
  check([res.status, drawn((await res.json()).request.designFiles), calls('design-file-delete')], [200, [], 0], 'a file production never held is removed in the CRM alone, even when locked');

  // ---- delete: a file production never held, in the CRM alone; one it holds, through design-file-delete (the approvals undone)
  const refusedRow = await fileRow(refusedIds[0]);
  ok(existsSync(objectPath(refusedRow.object_key)), 'the CRM kept the refused file\'s bytes until it is deleted');
  res = await remove('rep', third.id, refusedIds[0]);
  check([res.status, calls('design-file-delete'), (await fileRow(refusedIds[0])).object_key, existsSync(objectPath(refusedRow.object_key))], [200, 0, null, false], 'a refused file: removed in the CRM alone, its bytes gone');
  check((await post('sm', {action: 'approve', id: first.id})).status, 200, 'the sales manager approves the first request again');
  check((await remove('sup', first.id, drawingId)).status, 403, 'the supervisor reads it but does not delete');
  check((await remove('rep2', first.id, drawingId)).status, 404, 'another representative: not there for them');
  const deleteKey = crypto.randomUUID();
  res = await remove('rep', first.id, drawingId, deleteKey);
  body = await res.json();
  check([res.status, calls('design-file-delete'), body.request.remote.approvals.sales, body.request.remote.waitingStep, drawn(body.request.designFiles)], [200, 1, null, 'sales', []], 'deleted at production: the approval undone, back with the sales manager');
  check([drawn(mock.row(first.id).designFiles).length, (await fileRow(drawingId)).object_key, (await fileRow(drawingId)).deleted_at !== null, existsSync(objectPath(stored.object_key))], [0, null, true, false], 'gone there and its bytes gone here; the row stays as the record');
  check([(await remove('rep', first.id, drawingId, deleteKey)).status, calls('design-file-delete')], [200, 1], 'the same tap twice: production asked once');
  check((await download('rep', 'id=' + first.id + '&file=' + drawingId)).status, 404, 'a deleted file is never served');

  // ---- production's own files: in the request (not deletable from the CRM) and in the sales manager's pending list
  const production = mock.addProductionFile(first.id, {name: 'رسم الإنتاج المعدل.pdf', bytes: pdf('production drawing')});
  await age(first.id);
  const withProduction = await viewOf('rep', first.id);
  check(drawn(withProduction.designFiles).map(file => [file.name, file.source, file.state, file.canDelete, file.fileId]), [['رسم الإنتاج المعدل.pdf', 'production', 'production', false, String(production.fileId)]], 'production\'s file in the request, as production\'s');
  check((await remove('rep', first.id, String(production.fileId))).status, 404, 'production\'s file is not the CRM\'s to delete');
  const manual = mock.registerManual({customerNo: (await app.db.prepare("SELECT number FROM crm_customer_numbers WHERE customer_id='east2'").first()).number, customerName: 'مصنع مسجّل في الإنتاج', createdBy: 'prod@yourrest.org'});
  const manualFile = mock.addProductionFile(manual.orderNo, {name: 'تصميم الطلب اليدوي.png', bytes: png(640, 480)});
  const pending = (await list('sm')).pending;
  const firstItem = pending.items.find(item => item.orderNo === first.remote.orderNo), manualItem = pending.items.find(item => item.orderNo === manual.orderNo);
  // The CRM request's signature (2026-11-04): said on the pending item, its image among the design files, labelled so.
  check([firstItem.signature.signer, firstItem.designFiles.filter(file => file.signature).map(file => [file.crmFileId, file.kind, file.viewable])], ['م. خالد العتيبي', [['mds-' + first.id.slice(3), 'image', true]]], 'the pending item: signed by the customer, the signature among its files');
  check(drawn(firstItem.designFiles).map(file => [file.name, file.source, file.href, file.viewable]), [['رسم الإنتاج المعدل.pdf', 'production', '/api/mold-requests/design-file?crm=' + first.id + '&file=' + production.fileId, true]], 'the pending item lists the file, downloaded through the CRM by the request\'s crmRequestId (2026-11-05: never by its order number)');
  check(manualItem.designFiles.map(file => [file.name, file.kind, file.source]), [['تصميم الطلب اليدوي.png', 'image', 'production']], 'a request registered in production shows its design too');

  // ---- downloads through the CRM, with the permission check
  const third2 = await create('rep', 'east1', 'download mold'), sheetKey = crypto.randomUUID(), sheetBytes = pdf('ملف للتنزيل');
  await upload('rep', third2.id, 'ملف للتنزيل.pdf', sheetBytes, sheetKey);
  const dwgBytes = Buffer.from('AC1027 synthetic drawing bytes'), dwg = (await (await upload('rep', third2.id, 'مسقط.dwg', dwgBytes)).json()).file;
  const downloads = calls('design-file');
  res = await download('rep', 'id=' + third2.id + '&file=mdf-' + sheetKey);
  check([res.status, Buffer.compare(res.bytes, sheetBytes), res.headers['content-type'], res.headers['content-disposition'], res.headers['cache-control'], res.headers['x-content-type-options'], calls('design-file') - downloads],
    [200, 0, 'application/pdf', "attachment; filename*=UTF-8''" + encodeURIComponent('ملف للتنزيل.pdf'), 'private, no-store', 'nosniff', 0], 'the requester downloads their file from the CRM\'s copy, with its Arabic name');
  check((await download('rep', 'id=' + third2.id + '&file=mdf-' + sheetKey + '&inline=1')).headers['content-disposition'].split(';')[0], 'inline', 'a PDF opens inline when asked');
  res = await download('rep', 'id=' + third2.id + '&file=' + dwg.crmFileId + '&inline=1');
  check([res.status, res.headers['content-type'], res.headers['content-disposition'].split(';')[0], Buffer.compare(res.bytes, dwgBytes)], [200, 'application/octet-stream', 'attachment', 0], 'a drawing always downloads as plain bytes');
  res = await download('rep', 'id=' + first.id + '&file=' + production.fileId);
  check([res.status, Buffer.compare(res.bytes, pdf('production drawing')), res.headers['content-type'], calls('design-file') - downloads], [200, 0, 'application/pdf', 1], 'production\'s file comes through the CRM (design-file), never a link to production');
  ok(!res.text.includes(mock.url) && !JSON.stringify(res.headers).includes('localhost:'), 'no production address in the answer');
  for (const who of ['sup', 'sm', 'owner']) check((await download(who, 'id=' + third2.id + '&file=mdf-' + sheetKey)).status, 200, who + ' reads the request, so the file');
  for (const who of ['rep2', 'cs', 'smw']) check((await download(who, 'id=' + third2.id + '&file=mdf-' + sheetKey)).status, 404, who + ' does not read the request: 404');
  check((await download(null, 'id=' + third2.id + '&file=mdf-' + sheetKey)).status, 401, 'anonymous: 401');
  check((await download('rep', 'id=' + third2.id + '&file=mdf-' + crypto.randomUUID())).status, 404, 'a file the request does not show: 404');
  check((await download('rep', 'id=' + third2.id + '&file=..%2Fsecret')).status, 400, 'a malformed file key: 400');
  // by order number: the sales manager, for a request in their pending list, a file that item lists
  res = await download('sm', 'order=' + manual.orderNo + '&file=' + manualFile.fileId + '&inline=1');
  check([res.status, res.headers['content-type'], res.headers['content-disposition'].split(';')[0]], [200, 'image/png', 'inline'], 'the sales manager opens a pending request\'s image by its order number');
  check((await download('sm', 'order=' + first.remote.orderNo + '&file=' + production.fileId)).status, 200, 'and the CRM request\'s file the pending item lists (by order number, as a page loaded before links it)');
  check((await download('sm', firstItem.designFiles.find(file => file.fileId === production.fileId).href.split('?')[1])).status, 200, 'and by the link listed now (crm=)');
  check([(await download('sm', 'crm=' + first.id + '&file=' + manualFile.fileId)).status, (await download('sm', 'crm=mr-none&file=' + production.fileId)).status, (await download('sm', 'crm=' + first.id + '&order=' + first.remote.orderNo + '&file=' + production.fileId)).status], [404, 404, 400], 'crm=: a file of another request, or a request not waiting: 404; two names: 400');
  check((await download('sm', 'order=' + manual.orderNo + '&file=' + production.fileId)).status, 404, 'a file of another order: 404');
  // An order no longer waiting for them (its approvals complete), asked for by a file it does list: refused for the order, not the file.
  const fifthFile = mock.addProductionFile(fifth.id, {name: 'رسم أمر مكتمل.pdf', bytes: pdf('confirmed order drawing')});
  await age(fifth.id); await list('owner');
  check([mock.row(fifth.id).designFiles.some(file => file.fileId === fifthFile.fileId), (await download('owner', 'id=' + fifth.id + '&file=' + fifthFile.fileId)).status], [true, 200], 'the file is the order\'s (the administrator downloads it by the request)');
  res = await download('sm', 'order=' + fifth.remote.orderNo + '&file=' + fifthFile.fileId);
  check([res.status, /لم يعد بانتظار اعتمادك/.test(res.text)], [404, true], 'an order no longer waiting for them: 404, even for a file it lists');
  check((await download('smw', 'order=' + manual.orderNo + '&file=' + manualFile.fileId)).status, 404, 'the other region\'s sales manager: 404');
  for (const who of ['rep', 'sup', 'owner', 'cs']) check((await download(who, 'order=' + manual.orderNo + '&file=' + manualFile.fileId)).status, 403, who + ': by order number is the sales manager\'s only');
  check((await download(null, 'order=' + manual.orderNo + '&file=' + manualFile.fileId)).status, 401, 'anonymous by order: 401');

  // ---- the delete route against production's answers: 409 request_locked keeps the file with its reason and production's status;
  // 404 (production no longer holds it) completes the deletion
  const seventh = await create('rep', 'east2', 'locked delete mold');
  const lockedDrawing = (await (await upload('rep', seventh.id, 'رسم بعد القفل.pdf', pdf('locked delete'))).json()).file;
  for (const step of ['sales', 'production', 'admin']) mock.approve(seventh.id, step);
  const deletesBeforeLock = calls('design-file-delete');
  res = await remove('rep', seventh.id, lockedDrawing.crmFileId);
  body = await res.json();
  const keptFile = body.request.designFiles.find(file => file.crmFileId === lockedDrawing.crmFileId);
  check([res.status, body.ok, body.send.kind, keptFile.state, keptFile.error.code, keptFile.canDelete, body.request.remote.status, body.request.editable, calls('design-file-delete') - deletesBeforeLock],
    [409, false, 'locked', 'sent', 'request_locked', false, 'confirmed', false, 1], '409 from production: the file stays as delivered, with the reason and production\'s status');
  ok(/اكتملت الاعتمادات/.test(body.error), 'said in words');
  const lockedRow = await fileRow(lockedDrawing.crmFileId);
  check([lockedRow.deleted_at, lockedRow.outbox, !!lockedRow.object_key, drawn(mock.row(seventh.id).designFiles).length, (await download('rep', 'id=' + seventh.id + '&file=' + lockedDrawing.crmFileId)).status], [null, null, true, 1, 200], 'kept here and there, still downloadable');
  const eighth = await create('rep', 'east2', 'gone at production mold');
  const goneDrawing = (await (await upload('rep', eighth.id, 'رسم أزاله الإنتاج.pdf', pdf('removed at production'))).json()).file;
  mock.row(eighth.id).designFiles = [];
  res = await remove('rep', eighth.id, goneDrawing.crmFileId);
  body = await res.json();
  check([res.status, body.send.kind, drawn(body.request.designFiles), (await fileRow(goneDrawing.crmFileId)).deleted_at !== null, (await fileRow(goneDrawing.crmFileId)).object_key, (await fileRow(goneDrawing.crmFileId)).outbox], [200, 'ok', [], true, null, null], '404 from production: already gone there, the deletion completes');

  // ---- 10 files a request, production's included, and the customer's signature among them (2026-11-04)
  const sixth = await create('rep', 'east2', 'ten files mold');
  mock.addProductionFile(sixth.id, {name: 'من الإنتاج.pdf'});
  await age(sixth.id);
  await list('rep');
  for (let n = 1; n <= 8; n++) check((await upload('rep', sixth.id, 'ملف ' + n + '.pdf', pdf('file ' + n))).status, 200, 'file ' + n + ' of the 8 left (the signature takes one)');
  const full = await viewOf('rep', sixth.id);
  check([full.designFiles.length, full.designFiles.filter(file => file.source === 'production').length, full.designFiles.filter(file => file.signature).length, mock.row(sixth.id).designFiles.length], [10, 1, 1, 10], 'ten files: the signature, eight of the CRM\'s and production\'s one');
  res = await upload('rep', sixth.id, 'الحادي عشر.pdf', pdf('eleventh'));
  body = await res.json();
  check([res.status, /الحد 10 ملفات/.test(body.error), await rowsOf(sixth.id)], [409, true, 8], 'the eleventh is refused by the CRM itself, nothing stored');
  const signatureFile = full.designFiles.find(file => file.signature);
  res = await remove('rep', sixth.id, signatureFile.crmFileId);
  check([res.status, (await res.json()).error, !!(await fileRow(signatureFile.crmFileId)).deleted_at], [409, 'توقيع العميل ما بيتحذفش من الطلب؛ لو اتغيّرت بيانات الطلب قبل إرساله بيوقّع العميل من جديد.', false], 'the customer\'s signature cannot be deleted from the request');
  const one = drawn(full.designFiles).find(file => file.source === 'crm');
  check((await remove('rep', sixth.id, one.crmFileId)).status, 200, 'one deleted');
  check((await upload('rep', sixth.id, 'الحادي عشر.pdf', pdf('eleventh'))).status, 200, 'a place is free again');

  // ---- two uploads at once per process: a third waits its turn (429, Retry-After)
  const slow = () => {
    const req = httpRequest({host: '127.0.0.1', port: app.port, path: '/api/mold-requests/design-files', method: 'POST',
      headers: {Host: new URL(app.origin).host, 'X-Forwarded-Proto': 'https', Origin: app.origin, Cookie: sessions.rep, 'Content-Type': 'multipart/form-data; boundary=slowly', 'Content-Length': String(MiB)}});
    req.on('error', () => {});
    req.write('--slowly\r\nContent-Disposition: form-data; name="requestId"\r\n\r\n');
    return req;
  };
  const held = [slow(), slow()];
  // Asked until both slow uploads have been admitted (no fixed wait): the probe names a file the CRM refuses, so a probe admitted before
  // they are stores nothing (400) and is simply asked again.
  for (let n = 0; n < 100; n++) { res = await upload('rep', third2.id, 'مشغول.exe', pdf('busy')); if (res.status === 429) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  body = await res.json();
  check([res.status, res.headers['retry-after'], typeof body.error], [429, '5', 'string'], 'a third upload while two are being read: 429, try again in 5 seconds');
  for (const req of held) req.destroy();
  let freed = 0;
  await until(async () => { freed = (await upload('rep', third2.id, 'بعد الانشغال.pdf', pdf('after busy'))).status; return freed !== 429; }, 'the places came back');
  check(freed, 200, 'abandoned uploads give their places back');

  // ---- 2026-11-03 (production's second update): the quotation's and PO's files. Before the CRM knows the update is live none is taken;
  // after it each goes with its category (a PDF or an image, 5 of each), production's refusals are said with their reason, a retry keeps
  // the category, production's own PO file shows in its group, and a file of any list downloads by its fileId (the request's sheet and the
  // sales manager's list). Since 2026-11-05 a new request carries no number and waits in the CRM for its first quotation or PO file,
  // which releases it.
  const uploadAs = async (id, name, bytes, category) => { const encoded = await multipart({requestId: crypto.randomUUID(), id, ...(category ? {category} : {}), file: {name, bytes}}); return as('rep')('/api/mold-requests/design-files', {method: 'POST', body: encoded.body, headers: encoded.headers}); };
  const early = await create('rep', 'east1', 'quotation before the update');
  res = await uploadAs(early.id, 'عرض سعر.pdf', pdf('quotation before'), 'quote');
  check([res.status, (await rowsOf(early.id))], [409, 0], 'a quotation file before the update is known: refused, nothing stored');
  mock.setQuotePo(true);
  await age(early.id);
  check((await list('rep')).quotePo, true, 'production updates; the next pull teaches the CRM');
  const quoted = (await (await post('rep', {action: 'create', customerId: 'east1', specs: {...specs, description: 'with its quotation'}, payment: 'cash'})).json()).request;
  check([quoted.sending.state, quoted.sending.held, quoted.remote], ['waiting', 'quote_file', null], 'a new request: kept in the CRM until its quotation or PO file');
  body = await (await uploadAs(quoted.id, 'عرض سعر Q-2026-0153.pdf', pdf('quotation'), 'quote')).json();
  const quoteFile = body.file;
  check([quoteFile.state, quoteFile.category, JSON.parse(mock.state.calls.findLast(call => call.route === 'design-files').body).category, body.request.remote.quoteFiles.map(file => file.crmFileId), body.request.sending.state], ['sent', 'quote', 'quote', [quoteFile.crmFileId], 'sent'], 'a quotation PDF: releases the request, then goes with its category, listed by production in quoteFiles');
  check((await (await uploadAs(quoted.id, 'PO.png', png(8, 8), 'po')).json()).file.category, 'po', 'a PO image');
  const quoteSends = calls('design-files');
  res = await uploadAs(quoted.id, 'مسقط.dwg', Buffer.from('AC1027'), 'quote');
  body = await res.json();
  check([res.status, body.reason, calls('design-files') - quoteSends], [400, 'not_document', 0], 'a drawing as the quotation: refused by the CRM itself (not_document), nothing sent');
  mock.answerNext('design-files', 400, {error: {code: 'invalid_payload', message: 'x', fields: ['name'], details: {reason: 'not_document'}}});
  body = await (await uploadAs(quoted.id, 'عرض 2.pdf', pdf('quotation two'), 'quote')).json();
  check([body.file.state, body.file.error.reason, body.file.error.final], ['rejected', 'not_document', true], 'production\'s own not_document: final, with its reason');
  for (let n = 3; n <= 6; n++) check((await uploadAs(quoted.id, 'عرض ' + n + '.pdf', pdf('quotation ' + n), 'quote')).status, 200, 'quotation file ' + n + ' (the refused one takes no place)');
  res = await uploadAs(quoted.id, 'عرض 7.pdf', pdf('quotation 7'), 'quote');
  check([res.status, (await res.json()).error], [409, 'الحد 5 ملفات لعرض السعر (ملفاتك وملفات الإنتاج). احذف ملفًا أولًا.'], 'a sixth live quotation file: refused here, in its own words');
  mock.answerNext('design-files', 400, {error: {code: 'invalid_payload', message: 'x', fields: ['crmFileId'], details: {reason: 'too_many_files'}}});
  body = await (await uploadAs(quoted.id, 'PO 2.pdf', pdf('po two'), 'po')).json();
  check([body.file.state, body.file.error.reason], ['rejected', 'too_many_files'], 'production\'s too_many_files for a PO file: final, with its reason');
  // A retry after a lost answer: the same crmFileId, the same category; production answers 200 created:false
  mock.loseNext('design-files');
  body = await (await uploadAs(quoted.id, 'PO 3.pdf', pdf('po three'), 'po')).json();
  const lostPo = body.file.crmFileId;
  await app.db.prepare('UPDATE crm_mold_design_files SET next_attempt_at=? WHERE id=?').bind(new Date(Date.now() - 1000).toISOString(), lostPo).run();
  await list('rep');
  await until(async () => !(await fileRow(lostPo)).outbox, 'the lost PO file was sent again');
  const lostCalls = mock.state.calls.filter(call => call.route === 'design-files' && call.body.includes(lostPo)).map(call => JSON.parse(call.body));
  check([lostCalls.length, lostCalls.map(line => line.category), mock.row(quoted.id).designFiles.filter(file => file.crmFileId === lostPo).length], [2, ['po', 'po'], 1], 'sent again with the same category; production holds it once');
  // Production's own PO file, on the request and in the sales manager's list, downloaded by its fileId
  const ownPo = mock.addProductionFile(quoted.id, {name: 'PO من الإنتاج.pdf', bytes: pdf('production po'), category: 'po'});
  await age(quoted.id);
  const sheet = await viewOf('rep', quoted.id), listedPo = sheet.designFiles.find(file => file.fileId === String(ownPo.fileId));
  check([listedPo.category, listedPo.source, sheet.designFiles.filter(file => file.category === 'po' && file.state !== 'rejected').length], ['po', 'production', 3], 'production\'s PO file in the PO group, with the CRM\'s');
  res = await as('rep')(listedPo.href);
  check([res.status, res.bytes.equals(pdf('production po'))], [200, true], 'downloaded through the CRM by its fileId');
  const item = (await list('sm')).pending.items.find(entry => entry.crmRequestId === quoted.id), pendingPo = item.poFiles.find(file => file.fileId === ownPo.fileId);
  res = await as('sm')(pendingPo.href);
  check([item.quoteNo, item.quoteOrPoMissing, item.quoteFiles.length, res.status, res.bytes.equals(pdf('production po'))], ['', false, 5, 200, true], 'the sales manager: no number, not missing, the quotation files, and production\'s PO file by order number and fileId');
  res = await remove('rep', quoted.id, quoteFile.crmFileId);
  check([res.status, (await res.json()).request.remote.quoteFiles.some(file => file.crmFileId === quoteFile.crmFileId)], [200, false], 'a quotation file is deleted as a design file is');
  mock.setQuotePo(false);

  // ---- the secret never leaves the server
  ok(!JSON.stringify(mock.state.calls.map(call => call.body)).includes(mock.state.secret), 'not in any body sent');
  ok(!app.log().includes(mock.state.secret), 'not in the server log');
  const page = await list('rep');
  ok(!JSON.stringify(page).includes(mock.state.secret) && !JSON.stringify(page).includes('YR_PRODUCTS'), 'not in an answer');
} finally { await app.stop(); await mock.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, realProductionTested: false}));

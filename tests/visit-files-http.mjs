// Competitor/quote attachment upload and download over real HTTP against the BUILT release (run `pnpm build` first).
// File type comes from the bytes, not the name; size limits, region isolation, idempotent retries and forced downloads.
// Synthetic isolated fixtures only: temporary SQLite and object folder, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'mgr', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'mgr'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern'}, {id: 'rep2', role: 'rep', sup: 'mgr', region: 'eastern'},
  {id: 'repw', role: 'rep', sup: 'mgr', region: 'western'}, {id: 'cs', role: 'customer_service', sup: 'mgr'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const admin = app.as(sessions.owner);
  async function customer(name, region, rep) {
    const created = await admin('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name, region, city: 'x', code: name, branch: 'الرئيسي', assignedTo: rep, phone: '0501234567', contact: 'م', customerType: 'مصنع', customerStatus: 'نشط'}}});
    check(created.status, 200, created.text);
    return created.json().id;
  }
  const east = await customer('E', 'الشرقية', 'rep1');
  async function upload(who, customerId, bytes, name, extra = {}) {
    const form = new FormData();
    form.set('customerId', customerId);
    form.set('file', new File([bytes], name, {type: 'application/octet-stream'}));
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    const encoded = new Response(form);
    return app.as(sessions[who])('/api/visit-files', {method: 'POST', body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}});
  }
  const pdf = Buffer.from('%PDF-1.4\n%synthetic\n%%EOF');

  // Valid upload and who may download it.
  const saved = await upload('rep1', east, pdf, 'quote.pdf');
  check(saved.status, 200, saved.text);
  check([saved.json().name, saved.json().size], ['quote.pdf', pdf.length]);
  const fileId = saved.json().id;
  for (const who of ['owner', 'mgr', 'sup', 'rep1']) {
    const download = await app.as(sessions[who])('/api/visit-files?id=' + fileId);
    check(download.status, 200, 'download as ' + who);
    check(download.bytes, pdf, 'stored bytes unchanged for ' + who);
    check(download.headers['content-type'], 'application/pdf');
    check(download.headers['x-content-type-options'], 'nosniff');
    assert.match(download.headers['content-disposition'], /^attachment;/, 'files are always downloaded, never rendered inline');checks++;
  }
  for (const who of ['rep2', 'repw', 'cs']) check((await app.as(sessions[who])('/api/visit-files?id=' + fileId)).status, 404, 'no download for ' + who);
  check((await app.as(sessions.owner)('/api/visit-files?id=missing')).status, 404);
  check((await app.as(null)('/api/visit-files?id=' + fileId)).status, 401);

  // Type is decided by content: renamed executables and markup are rejected, real images accepted.
  check((await upload('rep1', east, Buffer.from('MZ\x90\x00fake'), 'virus.pdf')).status, 400, 'executable renamed to .pdf');
  check((await upload('rep1', east, Buffer.from('<script>alert(1)</script>'), 'x.png')).status, 400, 'markup renamed to .png');
  check((await upload('rep1', east, Buffer.alloc(0), 'empty.pdf')).status, 400, 'empty file');
  check((await upload('rep1', east, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), 'a.png')).status, 200, 'png signature');
  check((await upload('rep1', east, Buffer.from([255, 216, 255, 224, 0]), 'a.jpg')).status, 200, 'jpeg signature');
  check((await upload('rep1', east, Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024)]), 'big.pdf')).status, 400, 'larger than 10 MB');
  const weird = await upload('rep1', east, pdf, 'a\u0000b\u001fc.pdf');
  check([weird.status, weird.json().name], [200, 'abc.pdf'], 'control characters are stripped from the stored name');

  // Scope: customer must be visible to the uploader.
  check((await upload('repw', east, pdf, 'x.pdf')).status, 403, 'western representative cannot attach to an eastern customer');
  check((await upload('rep1', 'unknown-customer', pdf, 'x.pdf')).status, 403, 'unknown customer');

  // Offline retries: same key replays the same file; keys are bound to the member and must be UUIDs.
  const key = crypto.randomUUID();
  const first = await upload('rep1', east, pdf, 'k.pdf', {uploadKey: key, memberId: 'rep1'}), again = await upload('rep1', east, pdf, 'k.pdf', {uploadKey: key, memberId: 'rep1'});
  check([first.status, again.status, first.json().id === again.json().id], [200, 200, true], 'retry with the same key is idempotent');
  check((await upload('rep1', east, pdf, 'k.pdf', {uploadKey: crypto.randomUUID(), memberId: 'rep2'})).status, 403, 'queued file bound to another account');
  check((await upload('rep1', east, pdf, 'k.pdf', {uploadKey: 'not-a-uuid', memberId: 'rep1'})).status, 400, 'malformed upload key');
  const stored = await app.db.prepare('SELECT COUNT(*) AS n FROM crm_visit_files').first();
  check(stored.n, 5, 'only accepted uploads create rows (pdf, png, jpeg, sanitized name, one idempotent retry)');

  console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true, productionDataUsed: false}));
} finally {
  await app.stop();
}

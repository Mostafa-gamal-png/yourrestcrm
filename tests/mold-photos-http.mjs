// «صور القالب» over real HTTP against the BUILT release (run `pnpm build` first): every role adds, lists, opens and deletes what the rules
// give it (lib/mold-photos.ts: adding as for the customer's machines, seeing as for the customer, deleting by whoever added it and the
// administrator) and is refused the rest; the 21st photo, a file that is not a photo, a photo over 2 MB and another representative's
// customer are refused; the same key again stores nothing twice; the bytes come back as they went, as an image never sniffed; the history
// lines reach the customer's «سجل التغييرات»; a photo is never served as a competitor's offer. Synthetic isolated fixtures only:
// temporary SQLite and object folder, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'sup2', role: 'supervisor', sup: 'mgr', name: 'المشرف الثاني'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب الأول'}, {id: 'rep2', role: 'rep', sup: 'sup2', region: 'eastern', name: 'المندوب الثاني'},
  {id: 'repw', role: 'rep', sup: 'sup2', region: 'western', name: 'مندوب الغربية'}, {id: 'mkt', role: 'marketing', sup: 'sup', region: 'eastern', name: 'مسؤول التسويق'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثل خدمة العملاء'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = who => app.as(who ? sessions[who] : null);
  const now = new Date().toISOString();
  const customer = (id, name, assignedTo, region = 'الشرقية') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name, code: '', region, city: 'الدمام', phone: '0551234567', contact: 'م', branch: 'الرئيسي', assignedTo}), now, now).run();
  await customer('c1', 'مصنع المندوب الأول', 'rep1'); await customer('c2', 'مصنع المندوب الثاني', 'rep2'); await customer('cw', 'مصنع الغربية', 'repw', 'الغربية');
  await customer('cm', 'مصنع مسؤول التسويق', 'mkt');

  const jpeg = n => { const bytes = Buffer.alloc(Math.max(n, 4)); bytes.set([0xff, 0xd8, 0xff, 0xe0]); for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 7) % 251; return bytes; };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), webp = Buffer.from('RIFF\u0004\u0000\u0000\u0000WEBPVP8 ', 'latin1');
  async function upload(who, customerId, bytes, {key = crypto.randomUUID(), name = 'IMG_20261119.jpg'} = {}) {
    const form = new FormData();
    if (bytes) form.set('file', new File([bytes], name, {type: 'image/jpeg'}));
    const encoded = new Response(form);
    return as(who)('/api/mold-photos?customerId=' + encodeURIComponent(customerId) + '&key=' + key, {method: 'POST', body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}});
  }
  const list = (who, customerId) => as(who)('/api/mold-photos?customerId=' + encodeURIComponent(customerId));
  const remove = (who, id) => as(who)('/api/mold-photos/delete', {method: 'POST', body: {id}});
  const photoRows = async customerId => (await app.db.prepare("SELECT * FROM crm_visit_files WHERE customer_id=? AND substr(id,1,11)='mold-photo-' ORDER BY created_at,id").bind(customerId).all()).results;

  // Anonymous: 401 before anything is read; from another site: refused.
  check([(await as(null)('/api/mold-photos?customerId=c1')).status, (await as(null)('/api/mold-photos?id=mold-photo-' + 'a'.repeat(64))).status, (await upload(null, 'c1', jpeg(10))).status, (await remove(null, 'x')).status], [401, 401, 401, 401], 'anonymous');
  check((await as('rep1')('/api/mold-photos/delete', {method: 'POST', body: {id: 'x'}, headers: {Origin: 'https://evil.example'}})).status, 403, 'a delete from another site');

  // Who sees rep1's customer and who may add (the list says canAdd).
  const roles = {};
  for (const {id} of members) { const answer = await list(id, 'c1'); roles[id] = answer.status === 200 ? answer.json().canAdd ? 'add' : 'see' : answer.status; }
  check(roles, {owner: 'add', mgr: 'add', sup: 'add', sup2: 'see', rep1: 'add', rep2: 'see', repw: 404, mkt: 'see', csm: 'see', cs: 'see'}, 'every role on rep1\'s customer');
  check((await list('rep1', 'c1')).headers['cache-control'], 'private, no-store', 'the list is never kept');

  // Adding, by each role allowed, with the bytes deciding the type.
  const added = [];
  for (const [who, bytes] of [['rep1', jpeg(3000)], ['sup', png], ['mgr', webp], ['owner', jpeg(50)]]) {
    const saved = await upload(who, 'c1', bytes);
    check(saved.status, 200, who + ' adds: ' + saved.text);
    added.push({who, id: saved.json().photo.id, bytes, type: saved.json().photo.contentType});
  }
  check(added.map(photo => photo.type), ['image/jpeg', 'image/png', 'image/webp', 'image/jpeg'], 'the type from the bytes');
  for (const who of ['sup2', 'rep2', 'mkt', 'cs', 'csm']) check((await upload(who, 'c1', jpeg(10))).status, 403, who + ' may not add');
  check((await upload('repw', 'c1', jpeg(10))).status, 404, 'another region: not seen');
  check((await upload('rep1', 'c2', jpeg(10))).status, 403, 'another representative\'s customer is refused');
  check((await upload('mkt', 'cm', jpeg(10))).status, 200, 'a marketing officer adds to their own customer');

  // Files that are not photos, and the size.
  check((await upload('rep1', 'c1', Buffer.from('%PDF-1.4\n%%EOF'), {name: 'mold.jpg'})).json().error, 'الصور المقبولة: JPG، PNG، WEBP.', 'a PDF named .jpg');
  check((await upload('rep1', 'c1', Buffer.from('MZ\x90\x00fake'), {name: 'x.png'})).status, 415, 'an executable named .png');
  check((await upload('rep1', 'c1', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), {name: 'x.webp'})).status, 415, 'markup named .webp');
  check((await upload('rep1', 'c1', Buffer.alloc(0))).status, 400, 'an empty file');
  check((await upload('rep1', 'c1', jpeg(2 * 1024 * 1024 + 1))).status, 413, 'over 2 MB');
  check((await upload('rep1', 'c1', jpeg(2 * 1024 * 1024 + 300 * 1024))).status, 413, 'a body beyond the form\'s bound');
  check((await photoRows('c1')).length, 4, 'refusals stored nothing');

  // The same key again: one photo.
  const key = crypto.randomUUID(), bytes = jpeg(4321);
  const first = await upload('rep1', 'c1', bytes, {key}), again = await upload('rep1', 'c1', bytes, {key});
  check([first.status, again.status, again.json().alreadySaved, again.json().photo.id === first.json().photo.id, (await photoRows('c1')).length], [200, 200, true, true, 5], 'a retry with the same key stores nothing twice');
  check((await upload('rep1', 'c1', jpeg(4322), {key})).status, 409, 'the same key with other bytes');
  check((await as('rep1')('/api/mold-photos?customerId=c1&key=not-a-uuid', {method: 'POST', body: Buffer.from('--x--'), headers: {'Content-Type': 'multipart/form-data; boundary=x'}})).status, 400, 'a key that is not a UUID');

  // The photo itself.
  for (const photo of added) {
    const shown = await as('cs')('/api/mold-photos?id=' + photo.id);
    check([shown.status, shown.bytes.equals(photo.bytes), shown.headers['content-type'], shown.headers['x-content-type-options'], /^inline;/.test(shown.headers['content-disposition']), shown.headers['cache-control']], [200, true, photo.type, 'nosniff', true, 'private, max-age=86400'], 'the bytes as they went, shown as an image: ' + photo.who);
  }
  for (const who of ['owner', 'mgr', 'sup', 'sup2', 'rep1', 'rep2', 'mkt', 'csm']) check((await as(who)('/api/mold-photos?id=' + added[0].id)).status, 200, who + ' opens it');
  check([(await as('repw')('/api/mold-photos?id=' + added[0].id)).status, (await as('rep1')('/api/mold-photos?id=mold-photo-' + '0'.repeat(64))).status], [404, 404], 'another region, an unknown photo');
  check((await as('rep1')('/api/visit-files?id=' + added[0].id)).status, 404, 'never served as a competitor\'s offer');
  const names = (await list('mgr', 'c1')).json().photos.map(photo => photo.uploadedBy);
  check([names.includes('المندوب الأول'), names.includes('المشرف'), names.includes('مدير النظام'), names.includes('')], [true, true, false, true], 'the sales manager reads his team\'s names (not the administrator\'s, as GET /api/crm lists members)');
  ok((await list('rep2', 'c1')).json().photos.every(photo => photo.uploadedBy === '' && !photo.canDelete), 'a representative reads no other member\'s name and may delete none');

  // The limit: 20, the 21st refused.
  while ((await photoRows('c1')).length < 20) check((await upload('owner', 'c1', jpeg(64))).status, 200, 'filling');
  const refused = await upload('rep1', 'c1', jpeg(65));
  check([refused.status, refused.json().error, (await photoRows('c1')).length], [409, 'الحد 20 صورة للقالب لكل عميل. احذف صورة أولًا.', 20], 'the 21st is refused');

  // Deleting: whoever added it, and the administrator.
  const supPhoto = added.find(photo => photo.who === 'sup');
  for (const who of ['rep1', 'mgr', 'sup2', 'cs']) check((await remove(who, supPhoto.id)).status, 403, who + ' may not delete the supervisor\'s photo');
  check((await remove('repw', supPhoto.id)).status, 404, 'another region: not seen');
  const deleted = await remove('sup', supPhoto.id);
  check([deleted.status, deleted.json().count, (await as('sup')('/api/mold-photos?id=' + supPhoto.id)).status], [200, 19, 404], 'the supervisor deletes their own');
  check((await remove('sup', supPhoto.id)).json().alreadyDeleted, true, 'a repeated delete is harmless');
  check((await remove('owner', added.find(photo => photo.who === 'rep1').id)).status, 200, 'the administrator deletes another\'s');
  check((await upload('rep1', 'c1', jpeg(66))).status, 200, 'a place freed: rep1 adds again');

  // «سجل التغييرات»: the lines with their counts on the customer; the sales manager reads his team's lines, as for every customer change.
  const lines = async who => (await as(who)('/api/crm')).json().audits.filter(entry => entry.recordId === 'c1');
  const history = await lines('owner'), team = await lines('mgr');
  check([history.filter(entry => entry.action === 'إضافة صورة للقالب').length, history.filter(entry => entry.action === 'حذف صورة من صور القالب').map(entry => entry.detail).sort()], [21, ['عدد صور القالب: 18', 'عدد صور القالب: 19']], 'one line a photo added and a line a photo deleted, with the count after each');
  check([team.filter(entry => entry.action === 'إضافة صورة للقالب').map(entry => entry.actor).sort(), team.filter(entry => entry.action === 'حذف صورة من صور القالب').map(entry => entry.actor)], [['المشرف', 'المندوب الأول', 'المندوب الأول', 'المندوب الأول', 'مدير المبيعات'], ['المشرف']], 'the sales manager reads the lines of his team');
  ok(!(await as('rep1')('/api/crm')).json().audits.some(entry => entry.recordId === 'c1'), 'a representative reads no customer history, as before');

  console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true, productionDataUsed: false}));
} finally {
  await app.stop();
}

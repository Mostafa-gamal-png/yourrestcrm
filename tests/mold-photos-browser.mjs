// «صور القالب» in a real Chromium against the BUILT release (run `pnpm build` first): the representative, in the Android app's emulator
// at 360 pixels, picks three files at once from the customer's sheet (an ordinary input of images, several allowed, no capture attribute,
// so a phone offers the camera and the gallery): the two photos are shrunk on the device (1600 pixels at most, JPEG, 400 KB at most) and
// shown as squares, the file that is not a photo waits with its reason; one opens large with the previous and the next, is deleted after a
// confirmation (cancelled first). Another representative sees the photos without adding or deleting (320 pixels); the administrator, on a
// computer in Arabic and in English, deletes another's photo and reads the lines in «سجل التغييرات»; a customer with twenty photos shows the
// limit to the sales manager on a tablet upright and on its side. No sideways scrolling and every button inside the screen at each size.
// Synthetic isolated fixtures only: temporary SQLite and objects, mocked sendmail, generated pictures, no production data, no device.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب خالد'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-photos-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = {'phone-320': {width: 320, height: 700}, 'phone-360': {width: 360, height: 800}, 'tablet-upright': {width: 768, height: 1024}, 'tablet-sideways': {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const OWN = 'مصنع الأمل للبلوك', FULL = 'مصنع الصور الكاملة';

/** A PNG drawn here (no picture is read from anywhere): a gradient with stripes, so the photo is not a flat colour. */
function png(width, height) {
  const row = width * 3 + 1, raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x++) { const o = y * row + 1 + x * 3, stripe = (Math.floor(x / 40) + Math.floor(y / 40)) % 2; raw[o] = (x * 255 / width) | 0; raw[o + 1] = (y * 255 / height) | 0; raw[o + 2] = stripe ? 200 : 60; }
  }
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body)); return Buffer.concat([length, body, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, {level: 1})), chunk('IEND', Buffer.alloc(0))]);
}
/** A JPEG's width and height, read from its frame header. */
function jpegSize(bytes) {
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return {width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5)};
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return null;
}

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const customer = (id, name, assigned) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assigned, JSON.stringify({name, branch: 'الرئيسي', assignedTo: assigned, region: 'الشرقية', city: 'الدمام', customerStatus: 'نشط', phone: '0551234567', contact: 'أبو فهد'}), now, now).run();
  await customer('c1', OWN, 'rep'); await customer('c2', FULL, 'rep2');
  const rows = async id => (await app.db.prepare("SELECT * FROM crm_visit_files WHERE customer_id=? AND substr(id,1,11)='mold-photo-' ORDER BY created_at,id").bind(id).all()).results;
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});

  async function open(memberId, {english = false, viewport = SIZES['phone-360'], inApp = false} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, geolocation: {latitude: 26.43, longitude: 50.03, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId, regionScope: 'eastern'});
    await page.goto(app.origin + '/#customer');
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.customer-machines-page').first().waitFor();
    return page;
  }
  const still = page => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await page.locator('.crm-sheet [data-mold-photos]').first().scrollIntoViewIfNeeded().catch(() => {}); await page.evaluate(() => Promise.all([...document.querySelectorAll('.mold-photos img, .mold-photo-viewer img')].filter(image => image.complete && image.naturalWidth).map(image => image.decode().catch(() => {})))); await settle(page); await page.waitForTimeout(400); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const noSidewaysIn = async (locator, label) => check(await locator.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, label + ': nothing wider than its box');
  // In the sheet, which scrolls up and down: nothing past the screen's sides. In a dialog: nothing past any edge.
  const allInside = async (locator, label, {vertical = false} = {}) => check(await locator.evaluateAll((nodes, vertical) => nodes.filter(node => { const box = node.getBoundingClientRect(); return box.width && (box.left < -1 || box.right > innerWidth + 1 || vertical && (box.top < -1 || box.bottom > innerHeight + 1)); }).map(node => node.textContent.trim().slice(0, 40) || node.tagName), vertical), [], label + ': inside the screen');
  const noArabic = async (locator, label) => { const words = await locator.evaluate(node => { const copy = node.cloneNode(true); copy.querySelectorAll('bdi').forEach(item => item.remove()); return copy.textContent; }); check(/[؀-ۿ]/.test(words), false, label + ': no Arabic left (' + words.slice(0, 160) + ')'); };
  const compactList = page => page.locator('.customer-mobile-card').first().isVisible();
  const openSheet = async (page, name, english = false) => {
    if (await compactList(page)) await page.getByRole('button', {name: (english ? 'Customer details: ' : 'بيانات العميل: ') + name, exact: true}).click();
    else await page.locator('.unified-customers tbody tr').filter({has: page.locator('strong', {hasText: name})}).getByRole('button', {name: english ? 'Customer details' : 'بيانات العميل', exact: true}).click();
    await page.locator('.crm-sheet').waitFor(); await still(page);
    const section = page.locator('.crm-sheet [data-mold-photos]');
    await section.waitFor();
    return section;
  };
  const loaded = section => section.locator('.mold-photos-grid img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0));
  const viewer = page => page.locator('.mold-photo-viewer');
  const heading = async section => (await section.locator('h3').innerText()).replace(/\s+/g, ' ').trim();

  // ---- 1. The representative, in the app, 360 pixels, Arabic: three files at once.
  let page = await open('rep', {inApp: true});
  let section = await openSheet(page, OWN);
  check([await heading(section), await section.locator('.mold-photos-note').innerText()], ['صور القالب 0 / 20', 'لا توجد صور للقالب بعد. أضف صورًا من الكاميرا أو من معرض الصور.'], 'the empty section and its count');
  const input = section.locator('input[data-mold-photo-input]');
  check(await input.evaluate(node => [node.type, node.accept, node.multiple, node.hasAttribute('capture')]), ['file', 'image/*', true, false], 'an input of images, several at once, no capture: the phone offers the camera and the gallery');
  const add = section.getByRole('button', {name: 'إضافة صور', exact: true});
  ok((await add.boundingBox()).height >= 44, 'the add button is a full touch target');
  await shot(page, 'mold-photos-empty-phone-360-ar');
  const landscape = png(3200, 2000), portrait = png(1000, 2400);
  await input.setInputFiles([{name: 'IMG_LANDSCAPE.png', mimeType: 'image/png', buffer: landscape}, {name: 'IMG_PORTRAIT.png', mimeType: 'image/png', buffer: portrait}, {name: 'note.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not a picture')}]);
  await section.locator('.mold-photos-grid button').nth(1).waitFor({timeout: 60000});
  await section.locator('[data-mold-photo-failed]').waitFor();
  await page.waitForFunction(() => !document.querySelector('.mold-photos-status p'));
  check(await section.locator('.mold-photos-grid button').count(), 2, 'the two photos are shown');
  check((await section.locator('[data-mold-photo-failed]').innerText()).includes('تعذر قراءة هذا الملف صورةً على هذا الجهاز'), true, 'the file that is not a photo waits with its reason');
  check(await section.locator('[data-mold-photo-failed]').getByRole('button', {name: 'إعادة المحاولة'}).count(), 0, 'and is not offered again as it is');
  const stored = await rows('c1');
  check(stored.map(row => [row.content_type, row.uploaded_by]), [['image/jpeg', 'rep'], ['image/jpeg', 'rep']], 'stored as two JPEGs by the representative');
  const repSession = await app.login('rep'), sizes = [];
  for (const row of stored) {
    const answer = await app.as(repSession)('/api/mold-photos?id=' + row.id);
    sizes.push({...jpegSize(answer.bytes), bytes: answer.bytes.length});
  }
  check(sizes.map(size => [size.width, size.height]), [[1600, 1000], [667, 1600]], 'shrunk on the device to 1600 pixels on the longest side, proportions kept');
  ok(sizes.every(size => size.bytes <= 400 * 1024), 'each at most 400 KB: ' + sizes.map(size => size.bytes).join(', '));
  const sampleJpeg = (await app.as(repSession)('/api/mold-photos?id=' + stored[1].id)).bytes;
  check(await heading(section), 'صور القالب 2 / 20', 'the count');
  await page.waitForFunction(() => [...document.querySelectorAll('.mold-photos-grid img')].every(image => image.complete && image.naturalWidth > 0));
  check(await loaded(section), true, 'the squares are drawn');
  await section.locator('[data-mold-photo-failed]').getByRole('button', {name: 'إخفاء'}).click();
  check(await section.locator('[data-mold-photo-failed]').count(), 0, 'the failed file can be dismissed');
  await noSideways(page, 'the sheet with photos, 360');
  await noSidewaysIn(page.locator('.crm-sheet'), 'the sheet, 360');
  await allInside(section.locator('button:visible'), 'the section\'s buttons, 360');
  await shot(page, 'mold-photos-phone-360-ar');
  // the large view
  await section.locator('.mold-photos-grid button').first().click();
  await viewer(page).waitFor(); await still(page);
  check(await viewer(page).getByRole('heading').innerText(), 'صورة القالب 1 من 2', 'the large view');
  await page.waitForFunction(() => { const image = document.querySelector('.mold-photo-viewer figure img'); return image && image.complete && image.naturalWidth > 0; });
  check(await viewer(page).getByRole('button', {name: 'السابقة'}).isDisabled(), true, 'no previous before the first');
  ok((await viewer(page).locator('[data-slot=dialog-description]').innerText()).startsWith('أضافها المندوب أحمد في '), 'who added it and when');
  await allInside(viewer(page).locator('button:visible, img'), 'the large view, 360', {vertical: true});
  await shot(page, 'mold-photos-viewer-phone-360-ar');
  await viewer(page).getByRole('button', {name: 'التالية'}).click();
  check([await viewer(page).getByRole('heading').innerText(), await viewer(page).getByRole('button', {name: 'التالية'}).isDisabled()], ['صورة القالب 2 من 2', true], 'the next, and none after the last');
  // deleting, cancelled first
  await viewer(page).getByRole('button', {name: 'حذف الصورة'}).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.waitFor(); await still(page);
  check([await confirm.getByRole('heading').innerText(), (await confirm.innerText()).includes('ولا يمكن استرجاعها')], ['حذف هذه الصورة؟', true], 'asked first, saying it cannot be restored');
  await allInside(confirm.locator('button:visible'), 'the confirmation, 360', {vertical: true});
  await shot(page, 'mold-photos-confirm-phone-360-ar');
  await confirm.getByRole('button', {name: 'إلغاء'}).click();
  await confirm.waitFor({state: 'hidden'});
  check((await rows('c1')).length, 2, 'cancelled: nothing deleted');
  await viewer(page).getByRole('button', {name: 'حذف الصورة'}).click();
  await confirm.getByRole('button', {name: 'حذف', exact: true}).click();
  await page.waitForFunction(() => document.querySelectorAll('.mold-photos-grid button').length === 1);
  check([(await rows('c1')).map(row => row.id), await viewer(page).getByRole('heading').innerText()], [[stored[0].id], 'صورة القالب 1 من 1'], 'deleted: the other photo is shown');
  await page.keyboard.press('Escape'); await viewer(page).waitFor({state: 'hidden'});
  await page.context().close();

  // ---- 2. Another representative, 320 pixels: sees, adds nothing, deletes nothing.
  page = await open('rep2', {viewport: SIZES['phone-320'], inApp: true});
  section = await openSheet(page, OWN);
  check([await section.locator('.mold-photos-grid button').count(), await section.getByRole('button', {name: 'إضافة صور'}).count(), await section.locator('input[type=file]').count()], [1, 0, 0], 'the photo is shown, nothing to add with');
  await page.waitForFunction(() => [...document.querySelectorAll('.mold-photos-grid img')].every(image => image.complete && image.naturalWidth > 0));
  await noSideways(page, 'the sheet, 320');
  await shot(page, 'mold-photos-other-rep-phone-320-ar');
  await section.locator('.mold-photos-grid button').first().click();
  await viewer(page).waitFor(); await still(page);
  check([await viewer(page).getByRole('button', {name: 'حذف الصورة'}).count(), (await viewer(page).locator('[data-slot=dialog-description]').innerText()).startsWith('أُضيفت في ')], [0, true], 'no delete; the uploader\'s name is not his to read');
  await allInside(viewer(page).locator('button:visible, img'), 'the large view, 320', {vertical: true});
  await noSideways(page, 'the large view, 320');
  await shot(page, 'mold-photos-viewer-phone-320-ar');
  await page.context().close();

  // ---- 3. The representative at 320 pixels in English.
  page = await open('rep', {viewport: SIZES['phone-320'], english: true, inApp: true});
  section = await openSheet(page, OWN, true);
  check([await heading(section), await section.getByRole('button', {name: 'Add photos'}).count()], ['Mold photos 1 / 20', 1], 'English: the title and the add button');
  await noArabic(section, 'the section, 320 en');
  await noSideways(page, 'the sheet, 320 en');
  await section.locator('.mold-photos-grid button').first().click();
  await viewer(page).waitFor(); await still(page);
  check(await viewer(page).getByRole('heading').innerText(), 'Mold photo 1 of 1', 'the large view in English');
  ok((await viewer(page).locator('[data-slot=dialog-description]').innerText()).startsWith('Added by '), 'who added it, in English');
  await noArabic(viewer(page).locator('.mold-photo-viewer-actions'), 'the large view\'s buttons, 320 en');
  await viewer(page).getByRole('button', {name: 'Delete photo'}).click();
  const englishConfirm = page.getByRole('alertdialog');
  await englishConfirm.waitFor(); await still(page);
  check(await englishConfirm.getByRole('heading').innerText(), 'Delete this photo?', 'the confirmation in English');
  await noArabic(englishConfirm, 'the confirmation, 320 en');
  await allInside(englishConfirm.locator('button:visible'), 'the confirmation, 320 en', {vertical: true});
  await shot(page, 'mold-photos-confirm-phone-320-en');
  await englishConfirm.getByRole('button', {name: 'Cancel'}).click();
  await page.context().close();

  // ---- 4. The administrator on a computer: Arabic, then English; deletes the representative's photo; the history lines.
  page = await open('owner', {viewport: SIZES.desktop});
  section = await openSheet(page, OWN);
  check([await heading(section), await section.getByRole('button', {name: 'إضافة صور'}).count()], ['صور القالب 1 / 20', 1], 'the administrator may add');
  await page.waitForFunction(() => [...document.querySelectorAll('.mold-photos-grid img')].every(image => image.complete && image.naturalWidth > 0));
  await noSideways(page, 'desktop ar'); await shot(page, 'mold-photos-desktop-ar');
  await page.context().close();
  page = await open('owner', {viewport: SIZES.desktop, english: true});
  section = await openSheet(page, OWN, true);
  await noArabic(section, 'the section, desktop en');
  await section.locator('.mold-photos-grid button').first().click();
  await viewer(page).waitFor(); await still(page);
  await allInside(viewer(page).locator('button:visible, img'), 'the large view, desktop', {vertical: true});
  await shot(page, 'mold-photos-viewer-desktop-en');
  await viewer(page).getByRole('button', {name: 'Delete photo'}).click();
  await page.getByRole('alertdialog').getByRole('button', {name: 'Delete', exact: true}).click();
  await viewer(page).waitFor({state: 'hidden'});
  await section.locator('.mold-photos-note').waitFor();
  check([await section.locator('.mold-photos-note').innerText(), (await rows('c1')).length], ['No mold photos yet. Add photos from the camera or the gallery.', 0], 'the administrator deleted the representative\'s photo');
  await page.locator('.crm-sheet').getByRole('tab', {name: 'Change log'}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.crm-sheet .audit-item strong')].filter(node => node.textContent.startsWith('Mold photo')).length >= 4, null, {timeout: 20000});
  const lines = await page.locator('.crm-sheet .audit-item strong').allInnerTexts();
  check(lines.filter(line => line.startsWith('Mold photo')), ['Mold photo deleted · Mold photos now: 0', 'Mold photo deleted · Mold photos now: 1', 'Mold photo added · Mold photos now: 2', 'Mold photo added · Mold photos now: 1'], 'the four lines in «سجل التغييرات», newest first, in English');
  await shot(page, 'mold-photos-history-desktop-en');
  await page.context().close();

  // ---- 5. Twenty photos: the limit, for the sales manager on a tablet upright (Arabic) and on its side (English).
  const ownerSession = await app.login('owner');
  for (let i = 0; i < 20; i++) {
    const form = new FormData(); form.set('file', new File([sampleJpeg], 'p.jpg', {type: 'image/jpeg'}));
    const encoded = new Response(form);
    const saved = await app.as(ownerSession)('/api/mold-photos?customerId=c2&key=' + crypto.randomUUID(), {method: 'POST', body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}});
    if (saved.status !== 200) throw Error('seeding: ' + saved.text);
  }
  for (const [label, viewport, english] of [['tablet-upright', SIZES['tablet-upright'], false], ['tablet-sideways', SIZES['tablet-sideways'], true]]) {
    page = await open('mgr', {viewport, english});
    section = await openSheet(page, FULL, english);
    check([await section.locator('.mold-photos-grid button').count(), await section.getByRole('button', {name: english ? 'Add photos' : 'إضافة صور'}).isDisabled(), await section.locator('[data-mold-photos-full]').innerText()], [20, true, english ? 'The limit is reached: 20 photos per customer. Delete a photo to add another.' : 'اكتمل الحد: 20 صورة لكل عميل. احذف صورة لإضافة غيرها.'], label + ': twenty, and no more can be added');
    // Every square is drawn once on screen (each asks the server for its photo, lazily).
    await section.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const images = [...document.querySelectorAll('.mold-photos-grid img')]; images.forEach(image => { image.loading = 'eager'; }); return images.length === 20 && images.every(image => image.complete && image.naturalWidth > 0); }, null, {timeout: 40000});
    check(await loaded(section), true, label + ': the twenty squares are drawn');
    if (english) await noArabic(section, label);
    await noSideways(page, label); await noSidewaysIn(page.locator('.crm-sheet'), label + ' sheet');
    await allInside(section.locator('button:visible').first(), label + ' add button');
    await shot(page, 'mold-photos-full-' + label + '-' + (english ? 'en' : 'ar'));
    await page.context().close();
  }

  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, realBrowser: true}));
} finally {
  await browser?.close();
  await app?.stop();
}

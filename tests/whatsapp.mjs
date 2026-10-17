// The WhatsApp link and the message to the customer, as pure functions: Saudi numbers in every way they are written (05..., 5..., 966...,
// +966..., 00966..., Arabic digits) reach the same chat, numbers WhatsApp cannot open are refused, the message is encoded whole, and the
// words of the complaint message are fixed, in Arabic and in English (with and without a number), so that every employee sends the same ones. No
// browser, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'whatsapp-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const src = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs')); fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(src, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, quote, imported) => {
    if (!imported.startsWith('.') && !imported.startsWith('@/')) return match;
    let child = imported.startsWith('@/') ? imported.slice(2) : path.relative(root, path.resolve(path.dirname(src), imported));
    if (!/\.tsx?$/.test(child)) child += fs.existsSync(path.join(root, child + '.ts')) ? '.ts' : '.tsx';
    compile(child); return 'from ' + JSON.stringify(path.join(out, child.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
compile('lib/whatsapp.ts'); compile('lib/complaints.ts');
const W = await import(path.join(out, 'lib/whatsapp.mjs')), C = await import(path.join(out, 'lib/complaints.mjs'));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

// ---- a Saudi mobile number reaches the same chat however it is written
const CHAT = '966551234567';
for (const written of ['0551234567', '551234567', '966551234567', '+966551234567', '+966 55 123 4567', '00966551234567', '٠٥٥١٢٣٤٥٦٧', '05-5123-4567', ' 055 123 4567 ', '(055) 123 4567'])
  eq(W.whatsappNumber(written), CHAT, 'written as ' + JSON.stringify(written));
eq(W.whatsappNumber('+971501234567'), '971501234567', 'a number with another country\'s code is kept as it is when it carries the plus');
eq(W.whatsappNumber('00201001234567'), '201001234567', 'and with the double zero');
// ---- and numbers WhatsApp cannot open are refused
for (const refused of ['', '   ', 'abc', '12345', '0112345678', '201001234567', '0551234', '05512345678901234567', null, undefined])
  eq(W.whatsappNumber(refused), '', 'no chat for ' + JSON.stringify(refused));
// ---- the contact number as it is kept: 7 to 15 digits
eq(['0551234567', '٠٥٥١٢٣٤٥٦٧', '+966 55 123 4567', '1234567', '123456789012345', '0112345678'].map(W.validContactNumber), [true, true, true, true, true, true], 'seven to fifteen digits, written however');
eq(['', '123456', '1234567890123456', 'abc', '12-34', null].map(W.validContactNumber), [false, false, false, false, false, false], 'fewer, more, or none');

// ---- the link, with the message encoded whole
eq(W.whatsappUrl('0551234567'), 'https://wa.me/966551234567', 'the chat alone');
const text = 'السلام عليكم. شكواكم رقم 7 بخصوص «جودة المنتج»، نشكر لكم ثقتكم.';
const url = W.whatsappUrl('0551234567', text);
eq(url.startsWith('https://wa.me/966551234567?text='), true, 'the message rides in the text parameter');
eq(decodeURIComponent(url.slice(url.indexOf('=') + 1)), text, 'and decodes back to the words exactly');
eq(/[^A-Za-z0-9%._~*'()!-]/.test(url.slice(url.indexOf('=') + 1)), false, 'with nothing in it that a link could break on: no space, no Arabic letter, no quotation mark');
eq(W.whatsappUrl('0112345678', text), '', 'no link for a number WhatsApp cannot open');
eq(W.whatsappUrl('', text), '', 'or for none');

// ---- the date as the customer reads it, in Riyadh
eq([W.messageDate('2026-10-17T05:00:00.000Z'), W.messageDate('2026-10-17T22:30:00.000Z'), W.messageDate('2026-01-05T00:00:00.000Z')], ['17/10/2026', '18/10/2026', '05/01/2026'], 'day, month, year; 22:30 UTC is already the next day in Riyadh');

// ---- the words of the message: Arabic first, the same words in English after a blank line
const when = '2026-10-17T05:00:00.000Z';
eq([W.COMPANY_NAME, W.COMPANY_NAME_EN], ['شركة يورست للصناعات', 'Yourrest Industries'], 'the company as the customer reads it, in each language');
const AR124 = 'شركة يورست للصناعات ترحب بكم: تم تسجيل شكوى برقم 124 بتاريخ 17/10/2026 بخصوص «جودة المنتج أو القالب»، وسيتم التواصل معكم للمتابعة حتى الحل. نقدر ثقتكم بنا.';
const EN124 = 'Yourrest Industries welcomes you: a complaint has been registered under number 124 on 17/10/2026 regarding “Product or mold quality”, and we will contact you to follow up until it is resolved. We appreciate your trust in us.';
const numbered = {number: 124, createdAt: when, category: C.complaintCategories.product_quality, categoryEn: C.complaintCategoriesEn.product_quality};
eq(W.complaintMessageParts(numbered), {ar: AR124, en: EN124}, 'the message of a numbered complaint, word for word, in both languages');
eq(W.complaintMessage(numbered), AR124 + '\n\n' + EN124, 'sent as one message: the Arabic paragraph, a blank line, the English paragraph');
eq(W.complaintMessageParts({number: null, createdAt: when, category: C.complaintCategories.delivery_delay, categoryEn: C.complaintCategoriesEn.delivery_delay}),
  {ar: 'شركة يورست للصناعات ترحب بكم: تم تسجيل شكوى بتاريخ 17/10/2026 بخصوص «التأخر في التسليم»، وسيتم التواصل معكم للمتابعة حتى الحل. نقدر ثقتكم بنا.',
   en: 'Yourrest Industries welcomes you: a complaint has been registered on 17/10/2026 regarding “Delivery delay”, and we will contact you to follow up until it is resolved. We appreciate your trust in us.'},
  'a complaint registered before numbering began says no number, in either language');
eq(W.complaintMessageParts({number: 3, createdAt: when, category: '', categoryEn: ''}),
  {ar: 'شركة يورست للصناعات ترحب بكم: تم تسجيل شكوى برقم 3 بتاريخ 17/10/2026، وسيتم التواصل معكم للمتابعة حتى الحل. نقدر ثقتكم بنا.',
   en: 'Yourrest Industries welcomes you: a complaint has been registered under number 3 on 17/10/2026, and we will contact you to follow up until it is resolved. We appreciate your trust in us.'},
  'and one with no category names none, in either language');
eq(W.complaintMessageParts({number: 3, createdAt: when, category: 'جودة المنتج أو القالب'}).en.includes('regarding'), false, 'an English label that is missing leaves the English sentence whole rather than naming a topic in Arabic');
eq(Object.keys(C.complaintCategories).every(key => {
  const parts = W.complaintMessageParts({number: 1, createdAt: when, category: C.complaintCategories[key], categoryEn: C.complaintCategoriesEn[key]});
  return parts.ar.includes('«' + C.complaintCategories[key] + '»') && parts.en.includes('“' + C.complaintCategoriesEn[key] + '”');
}), true, 'every category of the complaint form fits the sentence, named in Arabic and in English');
eq(Object.keys(C.complaintCategories).sort(), Object.keys(C.complaintCategoriesEn).sort(), 'and every category has its English label');
// each paragraph keeps to its own language, so that WhatsApp sets each in its own direction
const sample = W.complaintMessageParts(numbered);
eq([/[A-Za-z]/.test(sample.ar), /[\u0600-\u06FF]/.test(sample.en)], [false, false], 'no English letter in the Arabic paragraph and no Arabic letter in the English one');
// the link carries all of it, nothing a link could break on, and stays far below what browsers and WhatsApp accept
const whole = W.whatsappUrl('0551234567', W.complaintMessage(numbered));
eq(decodeURIComponent(whole.slice(whole.indexOf('=') + 1)), AR124 + '\n\n' + EN124, 'the link decodes back to both paragraphs exactly, the blank line included');
eq([/[^A-Za-z0-9%._~*'()!-]/.test(whole.slice(whole.indexOf('=') + 1)), whole.length < 2000], [false, true], 'safe characters only, and a length well within what a link may be');
console.log(JSON.stringify({ok: true, checks, pureFunctions: true, productionDataUsed: false}));

// The WhatsApp link and the message to the customer, as pure functions: Saudi numbers in every way they are written (05..., 5..., 966...,
// +966..., 00966..., Arabic digits) reach the same chat, numbers WhatsApp cannot open are refused, the message is encoded whole, and the
// words of the complaint message are fixed (with and without a number) so that every employee sends the same ones. No browser, no network.
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

// ---- the words of the message
const when = '2026-10-17T05:00:00.000Z';
eq(W.COMPANY_NAME, 'شركة يورست للصناعات', 'the company as the customer reads it');
eq(W.complaintMessage({number: 124, createdAt: when, category: C.complaintCategories.product_quality}),
  'السلام عليكم. شركة يورست للصناعات: تم تسجيل شكواكم رقم 124 بتاريخ 17/10/2026 بخصوص «جودة المنتج أو القالب»، وسيتواصل معكم فريقنا للمتابعة حتى الحل. نشكر لكم ثقتكم.',
  'the message of a numbered complaint, word for word');
eq(W.complaintMessage({number: null, createdAt: when, category: C.complaintCategories.delivery_delay}),
  'السلام عليكم. شركة يورست للصناعات: تم تسجيل شكواكم بتاريخ 17/10/2026 بخصوص «التأخر في التسليم»، وسيتواصل معكم فريقنا للمتابعة حتى الحل. نشكر لكم ثقتكم.',
  'a complaint registered before numbering began says no number');
eq(W.complaintMessage({number: 3, createdAt: when, category: ''}),
  'السلام عليكم. شركة يورست للصناعات: تم تسجيل شكواكم رقم 3 بتاريخ 17/10/2026، وسيتواصل معكم فريقنا للمتابعة حتى الحل. نشكر لكم ثقتكم.',
  'and one with no category names none');
eq(Object.keys(C.complaintCategories).every(key => W.complaintMessage({number: 1, createdAt: when, category: C.complaintCategories[key]}).includes('«' + C.complaintCategories[key] + '»')), true, 'every category of the complaint form fits the sentence');
console.log(JSON.stringify({ok: true, checks, pureFunctions: true, productionDataUsed: false}));

// The signature page and the signature block laid out as CELLS, without a browser (lib/sign-page-canvas.ts, transpiled; the canvas a
// recording stand-in measuring 10 units a character): a fact is a label cell at the start side and a value cell in its own direction; a
// document is kind | file name | pages, the pages one piece never wrapped and on the row's first line; a long name wraps inside its cell;
// every cell line is ONE fillText with the canvas's direction set to the cell's (2026-11-11: hand-cut runs mixed «كود» into the value,
// detached «.pdf» and put «صفحات 1–2» on a line of its own). Arabic and English pages. Synthetic text only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'sign-page-canvas-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
const source = fs.readFileSync(path.join(root, 'lib/sign-page-canvas.ts'), 'utf8');
ok(!/^import /m.test(source), 'the drawing imports nothing (the app and the browser test run the same code)');
fs.writeFileSync(path.join(out, 'canvas.mjs'), ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const C = await import(path.join(out, 'canvas.mjs'));

// ---- the direction of a cell: its first strong character (dir="auto")
check(['ERP-east1', 'DEMO-east1', 'Q-77.pdf', 'رسم القالب.pdf', 'Q-77 رسم.pdf', 'رسم Q-77.pdf', '1380', '⁦Q-1⁩ مصنع', 'Eng. Khalid', 'م. خالد'].map(text => C.firstStrongDir(text, 'rtl')),
  ['ltr', 'ltr', 'ltr', 'rtl', 'ltr', 'rtl', 'rtl', 'rtl', 'ltr', 'rtl'], 'Latin first: left to right; Arabic first: right to left; digits only: the page\'s; an isolate skipped');
check(C.firstStrongDir('1380', 'ltr'), 'ltr', 'digits only on an English page: left to right');
check(C.ltrIsolate('1–2'), '⁦1–2⁩', 'a range isolated left to right');
check(C.wrapWords('ملف طويل جدا للقالب', 100, text => [...text].length * 10), ['ملف طويل', 'جدا للقالب'], 'words wrap at the width');
check(C.wrapWords('ABCDEFGHIJKL', 50, text => [...text].length * 10), ['ABCDE', 'FGHIJ', 'KL'], 'a word wider than the cell is cut by characters');

/** A canvas that measures 10 units a character and records every fillText with the state it was drawn in. */
function recorder() {
  const texts = [];
  const g = {font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, direction: 'inherit', textAlign: 'start', textBaseline: 'alphabetic',
    measureText: text => ({width: [...text].length * 10}), fillText(text, x, y) { texts.push({text, x, y, dir: this.direction, align: this.textAlign, font: this.font}); },
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}};
  return {g, texts};
}
const LONG = 'ملف تصميم قالب البلوك الكبير للمصنع الشرقي الجديد في المنطقة الصناعية الثانية النسخة النهائية المعتمدة بعد المراجعة.pdf';
const content = (rtl) => rtl ? {
  title: 'إقرار وتوقيع العميل', heading: 'طلب تصنيع قالب', facts: [['كود ERP:', 'DEMO-east1'], ['العميل:', 'مصنع الشرق'], ['الكمية:', '3']],
  documentsTitle: 'المستندات في هذا الملف', documents: [['عرض السعر', 'Q-77.pdf', 'صفحات ⁦1–2⁩'], ['التصميم', 'رسم القالب.pdf', 'صفحات ⁦3–5⁩'], ['صورة', 'صورة القالب.png', 'صفحة 6'], ['التصميم', LONG, 'صفحات ⁦7–9⁩']],
  none: 'لا توجد مستندات معروضة في هذا الملف.', othersTitle: 'ملفات مرفقة غير معروضة هنا', others: [['التصميم', 'مجسم.step', 'يُرسل إلى الإنتاج كما هو']],
  consent: 'أقر بأني اطلعت على عرض السعر والتصميم الموضحين في الصفحات السابقة وأوافق عليهم.', signerLabel: 'اسم الموقّع عن العميل:', signer: 'Eng. Khalid', when: 'التاريخ: ⁦11/11/2026 - 14:05⁩ (توقيت الرياض)', counter: 'صفحة 10 من 10',
} : {
  title: 'Customer acknowledgement and signature', heading: 'Mold manufacturing request', facts: [['Customer ERP code:', 'DEMO-east1'], ['Customer:', 'مصنع الشرق']],
  documentsTitle: 'The documents in this file', documents: [['Quotation', 'Q-77.pdf', 'pages 1–2'], ['Design', 'رسم القالب.pdf', 'pages 3–5']],
  none: 'No document is shown in this file.', othersTitle: 'Attached files not shown here', others: [], consent: 'I confirm that I have reviewed the quotation and the design.',
  signerLabel: 'Name of the person signing for the customer:', signer: 'م. خالد العتيبي', when: 'Date: 11/11/2026 - 14:05 (Riyadh time)', counter: 'Page 3 of 3',
};
const W = 1240, H = 1754, MARGIN = 90;
for (const rtl of [true, false]) {
  const {g, texts} = recorder(), page = content(rtl), lang = rtl ? 'ar' : 'en';
  let room = null;
  C.drawSignaturePage(g, page, {width: W, height: H, rtl, family: 'X', drawing: given => { room = given; }});
  const find = text => texts.filter(item => item.text === text);
  const startX = rtl ? W - MARGIN : MARGIN, before = (a, b) => rtl ? a.x > b.x : a.x < b.x;
  // Facts: the label alone at the start edge in the page's direction, the value alone after it in its own.
  for (const [label, value] of page.facts) {
    const [labelText] = find(label), [valueText] = find(value);
    ok(labelText && valueText, lang + ': «' + label + '» and «' + value + '» are each one fillText of their own');
    check([labelText.x, labelText.dir, labelText.align], [startX, rtl ? 'rtl' : 'ltr', rtl ? 'right' : 'left'], lang + ': the label cell at the start side');
    check(valueText.y, labelText.y, lang + ': the value on the label\'s line');
    ok(before(labelText, valueText) && Math.abs(labelText.x - valueText.x) >= [...label].length * 10, lang + ': the value cell after the label cell, not overlapping it');
    check(valueText.dir, C.firstStrongDir(value, rtl ? 'rtl' : 'ltr'), lang + ': «' + value + '» drawn in its own direction');
    ok(!texts.some(item => item.text.includes(label) && item.text.includes(value)), lang + ': no fillText mixes the label and the value');
  }
  // Documents: kind | name | pages, one row each; the pages one piece, on the row's first line, after the name column.
  const kindX = startX;
  for (const [kind, name, pages] of page.documents) {
    const pageText = find(pages);
    check(pageText.length, 1, lang + ': «' + pages + '» drawn once, whole');
    const row = texts.filter(item => item.y >= pageText[0].y - 1 && item.y <= pageText[0].y + 1);
    const kindText = row.find(item => item.text === kind), nameText = row.find(item => item !== kindText && item.text !== pages && name.startsWith(item.text));
    ok(kindText && nameText, lang + ': «' + pages + '» on the same line as its kind and the first line of its name (never on a line of its own)');
    check(kindText.x, kindX, lang + ': the kind cell at the start side');
    ok(before(kindText, nameText) && before(nameText, pageText[0]), lang + ': kind, then name, then pages');
    check(nameText.dir, C.firstStrongDir(name, rtl ? 'rtl' : 'ltr'), lang + ': the name in its own direction');
    check(pageText[0].dir, rtl ? 'rtl' : 'ltr', lang + ': the pages in the page\'s direction (its numbers isolated)');
    ok(!texts.some(item => item.text.includes(kind + ' ' + name) || item.text.includes(kind + ': ') || item.text.includes(name + ' ')), lang + ': no fillText mixes the kind and the name');
  }
  if (rtl) {
    const longRow = find('صفحات \u20667–9\u2069')[0].y, nameLines = texts.filter(item => LONG.includes(item.text) && item.y >= longRow - 1 && item.y < longRow + 200);
    ok(nameLines.length >= 2, 'a long Arabic file name wraps (' + nameLines.length + ' lines)');
    check(nameLines.map(item => item.text).join(' '), LONG, 'inside its own cell, its words in order');
    ok(nameLines.every(item => item.x === nameLines[0].x && item.dir === 'rtl'), 'every line of it in the name column, right to left');
    check(find('صفحات ⁦7–9⁩').length, 1, 'its pages once, beside the first line');
    const [other] = find('مجسم.step'), [note] = find('يُرسل إلى الإنتاج كما هو');
    ok(other && note && other.y === note.y && note.x < other.x, 'a file named only: kind | name | note');
  }
  // The signer's row: two cells; the moment one line.
  const [signerLabel] = find(page.signerLabel), [signer] = find(page.signer);
  check([signerLabel.x, signer.y, before(signerLabel, signer), signer.dir], [rtl ? W - MARGIN - 26 : MARGIN + 26, signerLabel.y, true, C.firstStrongDir(page.signer, 'rtl')], lang + ': the signer\'s label and name as two cells');
  check(find(page.when).map(item => item.dir), [rtl ? 'rtl' : 'ltr'], lang + ': the moment one line in the page\'s direction');
  ok(room && room.width > 0 && room.height >= 40, lang + ': the drawing has its room in the box');
  ok(texts.every(item => item.x >= MARGIN - 1 && item.x <= W - MARGIN + 1 || item.align === 'center'), lang + ': nothing outside the margins');
}
// The signature block (app/mold-signature.tsx): «توقيع العميل:» and the name as two cells.
{
  const {g, texts} = recorder();
  C.drawTexts(g, C.labelValueRow(g, 'توقيع العميل:', 'Eng. Khalid', {room: 908, start: 934, y: 18, rtl: true, family: 'X', size: 32, min: 14, weight: 'bold'}).texts);
  check(texts.map(item => [item.text, item.dir, item.align]), [['توقيع العميل:', 'rtl', 'right'], ['Eng. Khalid', 'ltr', 'right']], 'the block: the label, then the name in its own direction');
  ok(texts[1].x < texts[0].x - 130, 'the name after the label');
}
{
  const block = fs.readFileSync(path.join(root, 'app/mold-signature.tsx'), 'utf8'), page = fs.readFileSync(path.join(root, 'app/mold-signature-page.tsx'), 'utf8'), viewer = fs.readFileSync(path.join(root, 'app/mold-document-viewer.tsx'), 'utf8');
  ok(/labelValueRow/.test(block) && !/\.fillText\(/.test(block), 'the signature block draws its cells through lib/sign-page-canvas.ts');
  ok(/drawSignaturePage/.test(page) && !/\.fillText\(/.test(page), 'the signature page PNG too');
  ok(/mold-sign-page-kind/.test(page) && /mold-sign-page-name/.test(page) && /mold-sign-page-range/.test(page) && /<dd \{\.\.\.valueProps/.test(page), 'the screen\'s page as cells: kind | name | pages, the value with its own direction');
  ok(/captionCells/.test(viewer), 'the captions as two pieces: the kind and the name (dir=auto)');
}
console.log(`sign page canvas checks passed: ${checks}`);

// The order of a line that mixes Arabic and Latin, without a browser (lib/bidi-text.ts, transpiled): the signature page drawn as a picture
// and the signature block read «كود ERP: ERP-east1», «رسم القالب.pdf», «عرض سعر Q-77.pdf — صفحات 1–2» and the Riyadh moment in one order
// (2026-11-11: they came out as «ERP-east1 :ERP كود», «pdf.» and a scrambled range). Each line is cut into runs; a Latin run inside Arabic
// (a code, a file name with its extension, a number, a date, a page range) is laid out whole and left to right, an Arabic run inside
// English right to left, and the runs follow one another from the line's start. The positions are checked with a measure of 10 units a
// character, so the visual order (left to right on the page) is read from the x of each piece. Synthetic text only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'bidi-text-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
const source = fs.readFileSync(path.join(root, 'lib/bidi-text.ts'), 'utf8');
ok(!/^import /m.test(source), 'the rules import nothing (the screen and the canvas share them)');
fs.writeFileSync(path.join(out, 'bidi.mjs'), ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const bidi = await import(path.join(out, 'bidi.mjs'));

const measure = text => [...text].length * 10;
/** The runs of a line as text, an opposite run in brackets. */
const runs = (segments, rtl) => {
  const parts = bidi.bidiParts(segments, rtl), outRuns = [];
  for (const part of parts) {
    const last = outRuns.at(-1);
    if (last && last.run === part.run) last.text += part.text; else outRuns.push({run: part.run, text: part.text, opposite: part.opposite});
  }
  return outRuns.map(run => run.opposite ? '[' + run.text + ']' : run.text);
};
/** What the page shows, left to right: each piece's text with its direction, in the order of its left edge. */
const visual = (segments, rtl, max = 10000) => bidi.layoutBidi(segments, rtl, max, measure).map(line => {
  const width = 10000;
  return bidi.placeBidiLine(line, rtl, rtl ? width : 0)
    .map(piece => ({text: piece.text, left: piece.align === 'right' ? piece.x - measure(piece.text) : piece.x, rtl: piece.rtl}))
    .sort((a, b) => a.left - b.left).map(piece => (piece.rtl ? '«' : '') + piece.text + (piece.rtl ? '»' : ''));
});
const seg = (label, value) => [{text: label + ':', bold: true}, {text: ' ' + value}];

// ---- the runs of a right-to-left line
check(runs(seg('كود ERP', 'ERP-east1'), true), ['كود ', '[ERP: ERP-east1]'], 'a label ending in Latin and a Latin value: one Latin run «ERP: ERP-east1», as written');
check(runs(seg('كود العميل', 'DEMO-east1'), true), ['كود العميل: ', '[DEMO-east1]'], 'an Arabic label and a code');
check(runs([{text: 'التصميم: رسم القالب.pdf — صفحات 3–5'}], true), ['التصميم: رسم القالب', '[.pdf]', ' — صفحات ', '[3–5]'], 'an Arabic file name keeps «.pdf» whole, after it; the range whole');
check(runs([{text: 'عرض السعر: عرض سعر Q-77.pdf — صفحات 1–2'}], true), ['عرض السعر: عرض سعر ', '[Q-77.pdf]', ' — صفحات ', '[1–2]'], 'a Latin file name inside an Arabic name kept whole');
check(runs([{text: 'عرض السعر: Quotation Q-77 final.pdf — صفحة 6'}], true), ['عرض السعر: ', '[Quotation Q-77 final.pdf]', ' — صفحة ', '[6]'], 'an English file name with spaces: one run');
check(runs([{text: 'PO: Q-77.pdf — صفحات 1–2'}], true), ['[PO: Q-77.pdf]', ' — صفحات ', '[1–2]'], 'a Latin label and a Latin name read as one Latin run');
check(runs([{text: 'التاريخ: 11/11/2026 - 14:05 (توقيت الرياض)'}], true), ['التاريخ: ', '[11/11/2026 - 14:05]', ' (توقيت الرياض)'], 'the moment whole, the brackets of the Arabic note in the Arabic');
check(runs([{text: 'عرض القالب (مم): 1380'}], true), ['عرض القالب (مم): ', '[1380]'], 'an Arabic bracket stays with the Arabic, the number its own');
check(runs([{text: 'الوصف: قالب بلوك 20 - مستند واحد'}], true), ['الوصف: قالب بلوك ', '[20]', ' - مستند واحد'], 'a number inside an Arabic phrase');
check(runs([{text: 'صفحات ⁦3–5⁩ ‏x'}], true), ['صفحات ', '[3–5 x]'], 'the direction marks the text carried are taken out first');
check(runs([{text: 'اسم الموقّع عن العميل: Eng. Khalid Al-Otaibi'}], true), ['اسم الموقّع عن العميل: ', '[Eng. Khalid Al-Otaibi]'], 'a Latin signer\'s name whole');
check(runs([{text: 'الدفع: آجل'}], true), ['الدفع: آجل'], 'nothing Latin: one run');

// ---- the runs of a left-to-right line (English)
check(runs([{text: 'Design: رسم القالب.pdf — pages 3–5'}], false), ['Design: ', '[رسم القالب]', '.pdf — pages 3–5'], 'in English the Arabic name is one right-to-left run, «.pdf» after it');
check(runs(seg('Description', 'قالب بلوك 20 - مستند واحد'), false), ['Description: ', '[قالب بلوك 20 - مستند واحد]'], 'an Arabic value with a number inside: one run');
check(runs([{text: 'Name of the person signing for the customer: م. خالد العتيبي'}], false), ['Name of the person signing for the customer: ', '[م. خالد العتيبي]'], 'an Arabic signer in English');
check(runs([{text: 'Date: 11/11/2026 - 14:05 (Riyadh time)'}], false), ['Date: 11/11/2026 - 14:05 (Riyadh time)'], 'nothing Arabic: one run');

// ---- where each piece goes (left to right on the page)
check(visual(seg('كود ERP', 'ERP-east1'), true), [['ERP:', 'ERP-east1', '«كود»']], '«كود ERP: ERP-east1»: «كود» at the right, «ERP: ERP-east1» read left to right beside it');
check(visual([{text: 'التصميم: رسم القالب.pdf — صفحات 3–5'}], true), [['3–5', '«— صفحات»', '.pdf', '«التصميم: رسم القالب»']], 'the range at the left end, «.pdf» right after the name, the label at the right');
check(visual([{text: 'Design: رسم القالب.pdf — pages 3–5'}], false), [['Design:', '«رسم القالب»', '.pdf — pages 3–5']], 'in English: the Arabic name, then «.pdf», in reading order');
check(visual([{text: '• '}, {text: 'عرض السعر:', bold: true}, {text: ' عرض سعر Q-77.pdf — صفحات 1–2'}], true), [['1–2', '«— صفحات»', 'Q-77.pdf', '«عرض سعر»', '«عرض السعر:»', '«•»']], 'a document line: bullet, bold label, name, range, right to left');
{
  const [line] = bidi.layoutBidi([{text: 'التصميم: رسم القالب.pdf'}], true, 10000, measure);
  const placed = bidi.placeBidiLine(line, true, 1000), name = placed.find(piece => piece.text.endsWith('القالب')), extension = placed.find(piece => piece.text === '.pdf');
  check([extension.align, extension.x + measure('.pdf'), name.align, name.x - measure(name.text)], ['left', name.x - measure(name.text), 'right', extension.x + measure('.pdf')], '«.pdf» touches the name (no space was written between them)');
  ok(placed.every(piece => piece.x <= 1000), 'nothing past the line\'s start');
}
{
  const [line] = bidi.layoutBidi(seg('كود ERP', 'ERP-east1'), true, 10000, measure);
  check(line.groups.map(group => [group.rtl, group.pieces.map(piece => [piece.text, piece.segment])]), [[true, [['كود', 0]]], [false, [['ERP:', 0], ['ERP-east1', 1]]]], 'one Latin group across the bold label and the value: two pieces, each in its style');
  check(line.width, 30 + 10 + 40 + 10 + 90, 'the width: the pieces and the spaces between them');
}

// ---- breaking a long line keeps each run's order and never cuts a run's marks apart
{
  const lines = bidi.layoutBidi([{text: 'عرض السعر: ملف عرض سعر طويل جدًا Quotation Q-77 final version two.pdf — صفحات 1–2'}], true, 220, measure);
  ok(lines.length > 1, 'a long line is broken');
  ok(lines.every(line => line.width <= 220), 'every line fits');
  const words = lines.flatMap(line => line.groups.flatMap(group => group.pieces.map(piece => piece.text))).join(' ');
  check(words, 'عرض السعر: ملف عرض سعر طويل جدًا Quotation Q-77 final version two.pdf — صفحات 1–2', 'the words in their order across the lines');
  const latin = lines.map(line => line.groups.filter(group => !group.rtl).map(group => group.pieces.map(piece => piece.text).join(' ')));
  check(latin, [[], ['Quotation'], ['Q-77 final version'], ['two.pdf', '1–2']], 'the Latin run broken across lines continues in its own order, line after line');
}
{
  const lines = bidi.layoutBidi([{text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.pdf'}], true, 100, measure);
  ok(lines.length === 3 && lines.every(line => line.width <= 100), 'a word wider than the line is cut by characters');
  check(lines.map(line => line.groups[0].pieces[0].text).join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.pdf', 'and nothing is lost');
}
check(bidi.layoutBidi([{text: ''}], true, 100, measure), [{groups: [], width: 0}], 'an empty line: one empty line');

// ---- drawBidiLine sets the direction and the anchor of each piece on the canvas
{
  const calls = [];
  const canvas = {font: '', fillStyle: '', direction: 'inherit', textAlign: 'start', measureText: text => ({width: measure(text)}), fillText(text, x, y) { calls.push([text, x, y, this.direction, this.textAlign, this.font]); }};
  const fonts = ['bold 20px X', 'normal 20px X'], [line] = bidi.layoutBidi(seg('كود ERP', 'ERP-east1'), true, 10000, bidi.canvasMeasure(canvas, fonts));
  bidi.drawBidiLine(canvas, line, {rtl: true, start: 1000, y: 50, fonts, colors: ['#111', '#222']});
  check(calls, [['كود', 1000, 50, 'rtl', 'right', 'bold 20px X'], ['ERP:', 820, 50, 'ltr', 'left', 'bold 20px X'], ['ERP-east1', 870, 50, 'ltr', 'left', 'normal 20px X']], 'each piece in its own direction and style');
  calls.length = 0;
  bidi.drawBidiLine(canvas, line, {rtl: true, center: 500, y: 9, fonts, colors: ['#111']});
  check(calls[0][1], 500 + line.width / 2, 'centred: the line starts half its width right of the centre');
}

// ---- the screens and the pictures use it (and no isolate around a whole value any more)
{
  const page = fs.readFileSync(path.join(root, 'app/mold-signature-page.tsx'), 'utf8'), block = fs.readFileSync(path.join(root, 'app/mold-signature.tsx'), 'utf8');
  ok(/drawBidiLine/.test(page) && /layoutBidi/.test(page) && !/\.fillText\(/.test(page), 'the signature page PNG draws every line through drawBidiLine');
  ok(/drawBidiLine/.test(block) && !/\.fillText\(/.test(block), 'the signature block too');
  ok(/<BidiText/.test(page) && !/<bdi>\{line\.name\}<\/bdi>/.test(page), 'the signature page on the screen uses the same runs');
  ok(/<BidiText/.test(fs.readFileSync(path.join(root, 'app/mold-document-viewer.tsx'), 'utf8')), 'the captions under the pages too');
}
console.log(`bidi text checks passed: ${checks}`);

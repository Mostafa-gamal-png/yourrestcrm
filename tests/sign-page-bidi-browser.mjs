// The signature page drawn on a REAL canvas in Chromium by the app's own drawing (lib/sign-page-canvas.ts drawSignaturePage, transpiled,
// with the page's fonts), in Arabic and in English, with the mixed values of 2026-11-11: «كود ERP» + DEMO-east1, «رسم القالب.pdf»,
// «صورة القالب.png», a Latin «Q-77.pdf», a long Arabic file name that wraps, «صفحات 1–2» and «صفحة 6», the Riyadh moment. Every fillText is
// recorded (the real context still draws) with Chromium's own measure, and the CELL layout is checked: the label cell at the start side
// and the value cell after it on the same line (in Arabic: the label to the right of the value), each drawn alone in its own direction;
// kind | name | pages on one line, the pages one piece on the row's first line (never on a line of its own); and what the pixels show:
// the numbers of a range read «1–2» (the left end of «صفحات 1–2» matches «1–2» drawn alone, not «2–1»), and an Arabic file name shows the
// platform's standard order (its left end is «pdf.», as Windows and Android show «رسم القالب.pdf»). The pictures are saved for the report
// (the folder printed at the end). No build, no server: Chromium only. Synthetic text only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const root = process.cwd();
const shots = process.env.YR_BIDI_SCREENSHOT_DIR ? path.resolve(process.env.YR_BIDI_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-bidi-shots-'));
fs.mkdirSync(shots, {recursive: true});
const drawing = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/sign-page-canvas.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const FAMILY = '"Segoe UI",Tahoma,"Noto Naskh Arabic","Noto Sans Arabic","DejaVu Sans",Arial,sans-serif';
const LRI = '⁦', PDI = '⁩';
const LONG = 'ملف تصميم قالب البلوك الكبير للمصنع الشرقي الجديد في المنطقة الصناعية الثانية.pdf';
const PAGES = {
  ar: {rtl: true, content: {title: 'إقرار وتوقيع العميل', heading: 'طلب تصنيع قالب',
    facts: [['العميل:', 'مصنع الشرق'], ['كود ERP:', 'DEMO-east1'], ['العنوان:', 'حي الصناعية'], ['الوصف:', 'قالب بلوك 20 - مستند واحد'], ['الكمية:', '1'], ['عرض القالب (مم):', '1380']],
    documentsTitle: 'المستندات في هذا الملف', documents: [['عرض السعر', 'Q-77.pdf', 'صفحات ' + LRI + '1–2' + PDI], ['التصميم', 'رسم القالب.pdf', 'صفحات ' + LRI + '3–5' + PDI], ['صورة', 'صورة القالب.png', 'صفحة 6'], ['التصميم', LONG, 'صفحات ' + LRI + '7–9' + PDI]],
    none: 'لا توجد مستندات معروضة في هذا الملف.', othersTitle: 'ملفات مرفقة غير معروضة هنا', others: [['التصميم', 'مجسم.step', 'يُرسل إلى الإنتاج كما هو']],
    consent: 'أقر بأني اطلعت على عرض السعر والتصميم الموضحين في الصفحات السابقة وأوافق عليهم.', signerLabel: 'اسم الموقّع عن العميل:', signer: 'م. خالد العتيبي',
    when: 'التاريخ: ' + LRI + '11/11/2026 - 14:05' + PDI + ' (توقيت الرياض)', counter: 'صفحة 10 من 10'}},
  en: {rtl: false, content: {title: 'Customer acknowledgement and signature', heading: 'Mold manufacturing request',
    facts: [['Customer:', 'مصنع الشرق'], ['Customer ERP code:', 'DEMO-east1'], ['Description:', 'قالب بلوك 20 - مستند واحد'], ['Quantity:', '1']],
    documentsTitle: 'The documents in this file', documents: [['Quotation', 'Q-77.pdf', 'pages 1–2'], ['Design', 'رسم القالب.pdf', 'pages 3–5'], ['Picture', 'صورة القالب.png', 'page 6']],
    none: 'No document is shown in this file.', othersTitle: 'Attached files not shown here', others: [], consent: 'I confirm that I have reviewed the quotation and the design shown on the previous pages and that I agree to them.',
    signerLabel: 'Name of the person signing for the customer:', signer: 'Eng. Khalid Al-Otaibi', when: 'Date: 11/11/2026 - 14:05 (Riyadh time)', counter: 'Page 4 of 4'}},
};

const browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox']});
try {
  const page = await browser.newPage({viewport: {width: 800, height: 600}, deviceScaleFactor: 1});
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({type: 'module', content: drawing.replace(/export /g, '') + '\nwindow.signPage={drawSignaturePage,firstStrongDir};'});
  await page.waitForFunction(() => !!window.signPage);
  for (const [lang, {rtl, content}] of Object.entries(PAGES)) {
    const result = await page.evaluate(({content, rtl, family}) => {
      const W = 1240, H = 1754, canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const g = canvas.getContext('2d'), texts = [], fill = g.fillText.bind(g);
      g.fillText = (text, x, y) => { const width = g.measureText(text).width, left = g.textAlign === 'right' ? x - width : g.textAlign === 'center' ? x - width / 2 : x; texts.push({text, x, y, left, right: left + width, dir: g.direction, font: g.font}); fill(text, x, y); };
      window.signPage.drawSignaturePage(g, content, {width: W, height: H, rtl, family, drawing: room => { g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.moveTo(room.x + 40, room.y + room.height / 2); g.lineTo(room.x + room.width - 40, room.y + room.height / 3); g.stroke(); }});
      g.fillText = fill;
      // The pixels of a box on the page (gray levels), and of a text drawn alone in the same font and direction, to compare.
      const ink = (source, x, y, w, h) => { const data = source.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data, out = []; for (let i = 0; i < data.length; i += 4) out.push(data[i]); return out; };
      const alone = (text, font, w, h, ascent) => { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111'; x.font = font; x.direction = 'ltr'; x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillText(text, 3, ascent); return x; };
      /** How far the left (or right) end of a drawn text is from a text drawn alone in its font: the smallest mean gray difference over
       *  shifts of up to 3 pixels either way. */
      const distance = (item, probe, side) => {
        g.font = item.font; const w = Math.round(g.measureText(probe).width), top = Math.round(item.y - 40), h = 56;
        const x0 = side === 'left' ? item.left : item.right - w, here = ink(g, x0, top, w, h), ref = alone(probe, item.font, w + 6, h, item.y - top);
        let best = Infinity;
        for (let shift = 0; shift <= 6; shift++) { const there = ink(ref, shift, 0, w, h); let sum = 0; for (let i = 0; i < here.length; i++) sum += Math.abs(here[i] - there[i]); best = Math.min(best, sum / here.length); }
        return best;
      };
      const ranges = texts.filter(item => /[0-9]–[0-9]/.test(item.text)).map(item => { const digits = item.text.match(/([0-9]+)–([0-9]+)/); return {text: item.text, right: distance(item, digits[0], rtl ? 'left' : 'right'), reversed: distance(item, digits[2] + '–' + digits[1], rtl ? 'left' : 'right')}; });
      const names = texts.filter(item => /^[؀-ۿ][^]*\.(pdf|png)$/.test(item.text)).map(item => ({text: item.text, standard: distance(item, item.text.split('.').pop() + '.', 'left'), detached: distance(item, '.' + item.text.split('.').pop(), 'left'), dir: item.dir}));
      return {png: canvas.toDataURL('image/png'), texts, ranges, names};
    }, {content, rtl, family: FAMILY});
    fs.writeFileSync(path.join(shots, `20-signature-page-canvas-${lang}.png`), Buffer.from(result.png.split(',')[1], 'base64'));
    const {texts} = result, find = text => texts.filter(item => item.text === text), startEdge = rtl ? 1240 - 90 : 90;
    const after = (a, b) => rtl ? b.right <= a.left + 1 : b.left >= a.right - 1;
    for (const [label, value] of content.facts) {
      const [labelText] = find(label), [valueText] = find(value);
      ok(labelText && valueText, lang + ': «' + label + '» and «' + value + '» each drawn alone');
      check(Math.round(rtl ? labelText.right : labelText.left), startEdge, lang + ': the label cell at the start side (' + label + ')');
      ok(Math.abs(labelText.y - valueText.y) < 1 && after(labelText, valueText), lang + ': the value cell after the label cell on its line' + (rtl ? ' (to its left)' : '') + ' (' + value + ')');
      check(valueText.dir, /^[A-Za-z]/.test(value) ? 'ltr' : /^[؀-ۿ]/.test(value) ? 'rtl' : rtl ? 'rtl' : 'ltr', lang + ': «' + value + '» in its own direction');
    }
    for (const [kind, name, pages] of content.documents) {
      const [pageText] = find(pages), [kindText] = find(kind).filter(item => Math.abs(item.y - pageText.y) < 1), nameText = texts.find(item => Math.abs(item.y - pageText.y) < 1 && item !== kindText && item !== pageText && name.startsWith(item.text));
      ok(pageText && kindText && nameText, lang + ': «' + pages.replace(/[⁦-⁩]/g, '') + '» on the line of its kind and its name (never on a line of its own)');
      ok(after(kindText, nameText) && after(nameText, pageText), lang + ': kind | name | pages, in that order from the start side');
      check(nameText.dir, /^[A-Za-z]/.test(name) ? 'ltr' : 'rtl', lang + ': «' + name.slice(0, 20) + '» in its own direction');
    }
    for (const range of result.ranges) ok(range.right < range.reversed, lang + ': «' + range.text.replace(/[⁦-⁩]/g, '') + '» shows its numbers in order (' + range.right.toFixed(1) + ' vs reversed ' + range.reversed.toFixed(1) + ')');
    check(result.ranges.length, rtl ? 3 : 2, lang + ': every range was looked at');
    for (const name of result.names) if (!name.text.includes(' ') || name.text.length < 20) ok(name.dir === 'rtl' && name.standard < name.detached, lang + ': «' + name.text + '» in the standard order of an Arabic file name (its left end «pdf.»: ' + name.standard.toFixed(1) + ' vs ' + name.detached.toFixed(1) + ')');
    if (rtl) {
      const longRow = find('صفحات ' + LRI + '7–9' + PDI)[0].y, lines = texts.filter(item => item.y >= longRow - 1 && item.y < longRow + 200 && LONG.includes(item.text));
      ok(lines.length >= 2 && lines.map(item => item.text).join(' ') === LONG, 'the long Arabic file name wraps inside its cell (' + lines.length + ' lines), its words in order');
      ok(lines.every(item => Math.abs(item.right - lines[0].right) < 1), 'every line of it aligned in the name column');
    }
    const [signerLabel] = find(content.signerLabel), [signer] = find(content.signer);
    ok(signerLabel && signer && Math.abs(signerLabel.y - signer.y) < 1 && after(signerLabel, signer), lang + ': the signer\'s label and name as two cells');
    ok(texts.every(item => item.left >= 89 && item.right <= 1240 - 89), lang + ': nothing drawn outside the margins');
  }
} finally {
  await browser.close();
}
console.log(`sign page bidi browser checks passed: ${checks} (screenshots: ${shots})`);

// The order of mixed Arabic and Latin lines on a REAL canvas in Chromium (lib/bidi-text.ts, transpiled, with the fonts of the signature
// page): the lines of the signature page and of the signature block that came out in a confusing order on 2026-11-11 («كود ERP:
// ERP-east1», «رسم القالب.pdf», «عرض سعر Q-77.pdf — صفحات 1–2», a code like DEMO-east1, an English file name, numbers, the Riyadh
// moment), in Arabic and in English. Each piece is drawn by itself (fillText recorded on the real context, which still draws); with
// Chromium's own measures the pieces must follow the expected visual order without overlapping, every inked column must lie inside a
// piece (a piece drawn on the wrong side of its anchor would ink outside), and the same lines as HTML (the screen's BidiText: isolates
// for the opposite runs) must show the same order and width. The canvas is saved as a PNG for the report
// (YR_BIDI_SCREENSHOT_DIR). No build, no server: Chromium only. Synthetic text only.
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
const bidiModule = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/bidi-text.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const FAMILY = '"Segoe UI",Tahoma,"Noto Naskh Arabic","Noto Sans Arabic","DejaVu Sans",Arial,sans-serif';

// Each case: its segments, its direction, and the pieces as the page shows them left to right.
const label = (key, value) => [{text: key + ':', bold: true}, {text: ' ' + value}];
const CASES = [
  {name: 'ERP code', rtl: true, segments: label('كود ERP', 'ERP-east1'), visual: ['ERP:', 'ERP-east1', 'كود']},
  {name: 'demo code', rtl: true, segments: label('كود العميل', 'DEMO-east1'), visual: ['DEMO-east1', 'كود العميل:']},
  {name: 'Arabic file name', rtl: true, segments: [{text: '• '}, {text: 'التصميم:', bold: true}, {text: ' رسم القالب.pdf — صفحات 3–5'}], visual: ['3–5', '— صفحات', '.pdf', 'رسم القالب', 'التصميم:', '•']},
  {name: 'quotation', rtl: true, segments: [{text: '• '}, {text: 'عرض السعر:', bold: true}, {text: ' عرض سعر Q-77.pdf — صفحات 1–2'}], visual: ['1–2', '— صفحات', 'Q-77.pdf', 'عرض سعر', 'عرض السعر:', '•']},
  {name: 'English file name', rtl: true, segments: [{text: '• '}, {text: 'PO:', bold: true}, {text: ' Purchase Order 2026-118 final.pdf — صفحة 6'}], visual: ['6', '— صفحة', 'PO:', 'Purchase Order 2026-118 final.pdf', '•']},
  {name: 'numbers', rtl: true, segments: label('عرض القالب (مم)', '1380'), visual: ['1380', 'عرض القالب (مم):']},
  {name: 'moment', rtl: true, segments: [{text: 'التاريخ: 11/11/2026 - 14:05 (توقيت الرياض)'}], visual: ['(توقيت الرياض)', '11/11/2026 - 14:05', 'التاريخ:']},
  {name: 'signer', rtl: true, segments: [{text: 'اسم الموقّع عن العميل:', bold: true}, {text: ' Eng. Khalid Al-Otaibi', bold: true}], visual: ['Eng. Khalid Al-Otaibi', 'اسم الموقّع عن العميل:']},
  {name: 'English, Arabic name', rtl: false, segments: [{text: '• '}, {text: 'Design:', bold: true}, {text: ' رسم القالب.pdf — pages 3–5'}], visual: ['•', 'Design:', 'رسم القالب', '.pdf — pages 3–5']},
  {name: 'English, Arabic value', rtl: false, segments: label('Description', 'قالب بلوك 20 - مستند واحد'), visual: ['Description:', 'قالب بلوك 20 - مستند واحد']},
  {name: 'English moment', rtl: false, segments: [{text: 'Date: 11/11/2026 - 14:05 (Riyadh time)'}], visual: ['Date: 11/11/2026 - 14:05 (Riyadh time)']},
];

const browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox']});
try {
  const page = await browser.newPage({viewport: {width: 1300, height: 1400}, deviceScaleFactor: 1});
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff}.line{position:absolute;white-space:nowrap;font:24px ' + FAMILY.replace(/"/g, '\'') + ';color:#111}.line b{font-weight:bold}</style></head><body></body></html>');
  await page.addScriptTag({type: 'module', content: bidiModule.replace(/export /g, '') + '\nwindow.bidi={bidiParts,layoutBidi,placeBidiLine,drawBidiLine,canvasMeasure};'});
  await page.waitForFunction(() => !!window.bidi);
  const result = await page.evaluate(({cases, family}) => {
    const W = 1240, rowHeight = 60, canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = rowHeight * cases.length + 20;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); g.textBaseline = 'alphabetic';
    const out = [];
    for (const [index, item] of cases.entries()) {
      const y = 20 + index * rowHeight + 40, fonts = item.segments.map(segment => (segment.bold ? 'bold' : 'normal') + ' 24px ' + family);
      const [line] = window.bidi.layoutBidi(item.segments, item.rtl, Infinity, window.bidi.canvasMeasure(g, fonts));
      // Record every fillText with the canvas's own measure of it, then let the real context draw.
      const pieces = [], fill = g.fillText.bind(g);
      g.fillText = (text, x, yy) => { const width = g.measureText(text).width, left = g.textAlign === 'right' ? x - width : x; pieces.push({text, left, right: left + width, direction: g.direction}); fill(text, x, yy); };
      const start = item.rtl ? W - 40 : 40;
      window.bidi.drawBidiLine(g, line, {rtl: item.rtl, start, y, fonts, colors: ['#111']});
      g.fillText = fill;
      // The inked columns of this row.
      const data = g.getImageData(0, y - 32, W, 44).data, inked = [];
      for (let x = 0; x < W; x++) { let dark = false; for (let yy = 0; yy < 44 && !dark; yy++) { const at = (yy * W + x) * 4; if (data[at] < 140) dark = true; } if (dark) inked.push(x); }
      // The same line as the screen draws it (app/bidi-text.tsx): the page's direction, each opposite run its own isolate, bold where bold;
      // each part's text node measured where the browser put it.
      const html = document.createElement('div');
      html.className = 'line'; html.dir = item.rtl ? 'rtl' : 'ltr';
      const parts = window.bidi.bidiParts(item.segments, item.rtl), nodes = [];
      for (let at = 0; at < parts.length;) {
        const run = parts[at].run, holder = parts[at].opposite ? document.createElement('bdi') : document.createDocumentFragment();
        if (parts[at].opposite) holder.dir = item.rtl ? 'ltr' : 'rtl';
        while (at < parts.length && parts[at].run === run) {
          const part = parts[at++], text = document.createTextNode(part.text);
          nodes.push(text);
          if (item.segments[part.segment].bold) { const bold = document.createElement('b'); bold.appendChild(text); holder.appendChild(bold); } else holder.appendChild(text);
        }
        html.appendChild(holder);
      }
      document.body.appendChild(html);
      const screen = nodes.filter(node => node.data.trim()).map(node => { const range = document.createRange(); range.selectNodeContents(node); return {text: node.data.trim(), left: range.getBoundingClientRect().left}; }).sort((a, b) => a.left - b.left).map(item => item.text);
      const width = html.getBoundingClientRect().width;
      html.remove();
      out.push({pieces, inked, lineWidth: line.width, screen, width});
    }
    return {png: canvas.toDataURL('image/png'), rows: out};
  }, {cases: CASES, family: FAMILY});
  fs.writeFileSync(path.join(shots, 'bidi-lines-canvas.png'), Buffer.from(result.png.split(',')[1], 'base64'));
  for (const [index, item] of CASES.entries()) {
    const row = result.rows[index], sorted = [...row.pieces].sort((a, b) => a.left - b.left);
    check(sorted.map(piece => piece.text), item.visual, item.name + ': the pieces left to right');
    ok(sorted.every((piece, at) => !at || piece.left >= sorted[at - 1].right - 0.5), item.name + ': no piece overlaps the next');
    const outside = row.inked.filter(x => !row.pieces.some(piece => x >= Math.floor(piece.left) - 2 && x <= Math.ceil(piece.right) + 2));
    check(outside, [], item.name + ': every inked column lies inside a piece (each drawn on its own side of its anchor)');
    const inkWidth = row.inked.length ? row.inked.at(-1) - row.inked[0] : 0;
    ok(Math.abs(row.lineWidth - inkWidth) < 12, item.name + ': the line inks about its laid-out width (' + Math.round(inkWidth) + ' / ' + Math.round(row.lineWidth) + ')');
    ok(Math.abs(row.width - row.lineWidth) < 8, item.name + ': the screen\'s line is as wide as the canvas line (' + Math.round(row.width) + ' / ' + Math.round(row.lineWidth) + ')');
    check(row.screen, item.visual, item.name + ': the screen (HTML with isolates) shows the same order');
    for (const piece of row.pieces) check(piece.direction, /[؀-ۿ]/.test(piece.text) || (item.rtl && !/[A-Za-z0-9]/.test(piece.text)) ? 'rtl' : 'ltr', item.name + ': «' + piece.text + '» drawn in its own direction');
  }
} finally {
  await browser.close();
}
console.log(`sign page bidi browser checks passed: ${checks} (screenshots: ${shots})`);

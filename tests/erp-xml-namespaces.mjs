import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { zipSync, strToU8 } from 'fflate';

const require = createRequire(import.meta.url), xml = require('fast-xml-parser'), trees = [];
class ObservedParser extends xml.XMLParser {
    parse(text, ...args) { const result = super.parse(text, ...args); trees.push(result); return result; }
}
const module = { exports: {} };
const code = ts.transpileModule(fs.readFileSync('lib/erp-sales.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('require', 'module', 'exports', code)(name => name === 'fast-xml-parser'
    ? { ...xml, XMLParser: ObservedParser } : require(name), module, module.exports);
const { parseErpWorkbook, ErpWorkbookError } = module.exports;
let checks = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function rejects(parts, pattern) {
    assert.throws(() => parseErpWorkbook(zipSync(parts)), error => error instanceof ErpWorkbookError && pattern.test(error.message));
    checks++;
}
const encode = strToU8;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const spreadsheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const headers = ['رقم الفاتورة', 'التاريخ', 'النوع', 'رقم الصنف', 'اسم الصنف', 'الفئة', 'الكمية', 'الوحدة', 'سعر الوحدة', 'الخصم', 'الإجمالي', 'القيمة المضافة', 'رقم العميل', 'اسم العميل', 'رقم الموظف', 'اسم الموظف'];
const line = ['INV-NS-1', '2026-10-03', 'فاتورة مبيعات', 'ITEM-1', 'قالب', 'قوالب', '2', 'حبة', '10', '0', '20', '3', 'CUSTOMER-1', 'مصنع اختباري', 'REP-1', 'مندوب اختباري'];
const row = values => `<row>${values.map(value => `<c t="str"><v>${escape(value)}</v></c>`).join('')}</row>`;
function qualify(text, prefix, uri = spreadsheetNs) {
    if (!prefix) return text.replace(/^<([^\s/>]+)/, `<$1 xmlns="${uri}"`);
    return text.replace(/<(\/?)([A-Za-z][\w]*)(?=[\s/>])/g, `<$1${prefix}:$2`)
        .replace(/^<([^\s/>]+)/, `<$1 xmlns:${prefix}="${uri}"`);
}
function workbook(prefix = '') {
    return {
        '[Content_Types].xml': encode(qualify('<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>', prefix, 'http://schemas.openxmlformats.org/package/2006/content-types')),
        'xl/workbook.xml': encode(qualify('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>', prefix)),
        'xl/_rels/workbook.xml.rels': encode(qualify('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>', prefix, relationshipNs)),
        'xl/worksheets/sheet1.xml': encode(qualify(`<worksheet><sheetData>${row(headers)}${row(line)}</sheetData></worksheet>`, prefix)),
    };
}
const parse = parts => parseErpWorkbook(zipSync(parts));
const plain = parse(workbook());
for (const prefix of ['x', 'report.xml', 'report_2026']) {
    equal(parse(workbook(prefix)), plain, `Qualified ${prefix} tags preserve all sales values`);
}
const mixed = workbook('x');
mixed['xl/workbook.xml'] = encode(`<x:workbook xmlns:x="${spreadsheetNs}" xmlns:y="${spreadsheetNs}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets xmlns="${spreadsheetNs}"><y:sheet name="Report" sheetId="1" r:id="rId1"/></sheets></x:workbook>`);
equal(parse(mixed), plain, 'Default and prefixed namespaces may coexist in one path');

const textParts = workbook('x');
let sheet = new TextDecoder().decode(textParts['xl/worksheets/sheet1.xml']);
sheet = sheet.replace('<x:c t="str"><x:v>مصنع اختباري</x:v></x:c>', '<x:c t="s"><x:v>0</x:v></x:c>')
    .replace('<x:c t="str"><x:v>مندوب اختباري</x:v></x:c>', '<x:c t="inlineStr"><x:is><x:r><x:t>مندوب </x:t></x:r><x:r><x:t>اختباري</x:t></x:r></x:is></x:c>');
textParts['xl/worksheets/sheet1.xml'] = encode(sheet);
textParts['xl/sharedStrings.xml'] = encode(qualify('<sst><si><r><t>مصنع </t></r><r><t>اختباري</t></r></si></sst>', 's'));
equal(parse(textParts), plain, 'Shared strings and inline rich text work with different prefixes');

const dateParts = workbook('x');
dateParts['xl/workbook.xml'] = encode(new TextDecoder().decode(dateParts['xl/workbook.xml']).replace('<x:sheets>', '<x:workbookPr date1904="1"/><x:sheets>'));
dateParts['xl/worksheets/sheet1.xml'] = encode(new TextDecoder().decode(dateParts['xl/worksheets/sheet1.xml']).replace('<x:c t="str"><x:v>2026-10-03</x:v></x:c>', '<x:c t="n"><x:v>44836</x:v></x:c>'));
equal(parse(dateParts), plain, 'Prefixed workbook date-system metadata is retained');

const nested = workbook('x');
nested['xl/worksheets/sheet1.xml'] = encode(new TextDecoder().decode(nested['xl/worksheets/sheet1.xml']).replace('</x:worksheet>', `<x:unused>${'<x:row><x:c><x:v>ignored</x:v></x:c></x:row>'.repeat(1000)}</x:unused></x:worksheet>`));
trees.length = 0;
equal(parse(nested), plain, 'Unknown namespaced subtrees do not affect sales');
equal(trees.some(tree => tree.worksheet?.unused !== undefined), false, 'Unknown subtrees are not retained');

const excessiveRows = workbook('x');
excessiveRows['xl/worksheets/sheet1.xml'] = encode(qualify(`<worksheet><sheetData>${'<row><c><v>x</v></c></row>'.repeat(5051)}</sheetData></worksheet>`, 'x'));
trees.length = 0;
rejects(excessiveRows, /5000/);
equal(trees.some(tree => tree.worksheet), false, 'Qualified row limit fails before retaining a completed worksheet AST');
const excessiveColumns = workbook('x');
excessiveColumns['xl/worksheets/sheet1.xml'] = encode(qualify(`<worksheet><sheetData><row>${'<c><v>x</v></c>'.repeat(101)}</row></sheetData></worksheet>`, 'x'));
rejects(excessiveColumns, /أعمدة/);
const excessiveStrings = workbook('x');
excessiveStrings['xl/sharedStrings.xml'] = encode(qualify(`<sst>${'<si><t>x</t></si>'.repeat(100001)}</sst>`, 's'));
rejects(excessiveStrings, /عدد النصوص/);
const formula = workbook('x');
formula['xl/worksheets/sheet1.xml'] = encode(new TextDecoder().decode(formula['xl/worksheets/sheet1.xml']).replace('<x:v>20</x:v>', '<x:f>10*2</x:f><x:v>20</x:v>'));
rejects(formula, /معادلات/);
const external = workbook('x');
external['customXml/_rels/unused.xml.rels'] = encode(qualify('<Relationships><Relationship Id="external" Type="urn:internal" TargetMode="Exter&#110;al" Target="https://never-request.invalid/"/></Relationships>', 'r', relationshipNs));
rejects(external, /روابط خارجية/);
const malformed = workbook('x');
malformed['customXml/unused.xml'] = encode('<x:root xmlns:x="urn:unused"><x:child></x:root>');
rejects(malformed, /XML/);
const duplicateSheets = workbook('x');
duplicateSheets['xl/workbook.xml'] = encode(new TextDecoder().decode(duplicateSheets['xl/workbook.xml']).replace('</x:sheets>', '<x:sheet name="Extra" sheetId="2" r:id="rId2"/></x:sheets>'));
rejects(duplicateSheets, /ورقة Excel واحدة/);

console.log(JSON.stringify({ ok: true, checks, scope: 'Synthetic namespaced XLSX compatibility with bounded collections, selective AST retention, formula/external-link/malformed XML guards' }));

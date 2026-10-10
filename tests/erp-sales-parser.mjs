import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { zipSync, unzipSync, strToU8 } from 'fflate';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, { recursive: true });
const out = fs.mkdtempSync(path.join(runtime, 'erp-parser-'));
process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }));
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/erp-sales.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
fs.writeFileSync(path.join(out, 'parser.mjs'), code);
const { parseErpWorkbook, normalizeErpText, isOfficeEmployee, ErpWorkbookError } = await import(path.join(out, 'parser.mjs'));
let checks = 0;
function equal(actual, expected) { assert.deepEqual(actual, expected); checks++; }
function ok(value) { assert.ok(value); checks++; }
function rejects(bytes, pattern) { assert.throws(() => parseErpWorkbook(bytes), error => error instanceof ErpWorkbookError && pattern.test(error.message)); checks++; }
const encoder = value => strToU8(value);
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const headers = ['رقم الفاتورة', 'التاريخ', 'النوع', 'رقم الصنف', 'اسم الصنف', 'الفئة', 'الكمية ', 'الوحدة', 'سعر الوحدة', 'الخصم', 'الإجمالي', 'القيمة المضافة', 'رقم العميل', 'اسم العميل', 'رقم الموظف', 'اسم الموظف', 'العملة', 'التعادل'];
const line = ['INV-1', '2026/10/03', 'فاتورة مبيعات', '00123', 'قالب', 'قوالب', '2', 'حبة', '1,234.56', '10.00', '2,459.12', '368.87', '0007', 'مصنع', '07018', 'مندوب', 'ريال سعودي', '1.00'];
const rowXml = cells => `<row>${cells.map(v => typeof v === 'object' && v !== null ? v.xml : `<c t="str"><v>${escape(v)}</v></c>`).join('')}</row>`;
function workbook(rows = [headers, line], extra = {}) {
    return {
        '[Content_Types].xml': encoder('<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
        'xl/workbook.xml': encoder('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),
        'xl/_rels/workbook.xml.rels': encoder('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
        'xl/worksheets/sheet1.xml': encoder(`<worksheet><sheetData>${rows.map(rowXml).join('')}</sheetData></worksheet>`),
        ...extra,
    };
}
const pack = parts => zipSync(parts);
const fixture = fs.existsSync(process.env.ERP_TEST_WORKBOOK || '') ? process.env.ERP_TEST_WORKBOOK : path.resolve(root, '../../upload/Reports_Invoices_14480422_094904.xlsx');
if (fs.existsSync(fixture)) {
    const actual = parseErpWorkbook(fs.readFileSync(fixture));
    equal(actual.rows.length, 55);
    equal(new Set(actual.rows.map(r => `${r.documentType}:${r.reference}`)).size, 33);
    equal(actual.rows.filter(r => r.documentType === 'return').length, 3);
    equal(actual.rows[0].date, '2026-10-03');
    equal(actual.rows[0].itemCode, '01111002');
    equal(actual.rows[0].totalCents, 1000000);
    equal(actual.rows[0].vatCents, 150000);
    equal(actual.rows[0].employeeId, '7018');
    equal(actual.rows.filter(r => r.documentType === 'return').reduce((n, r) => n + r.totalCents, 0), -149930000);
    equal(actual.rows.reduce((n, r) => n + r.totalCents, 0), 172723913);
    equal(actual.rows.filter(r => r.date.startsWith('2026-10')).length, 4);
    equal(actual.rows.filter(r => r.date.startsWith('2026-09')).length, 51);
    ok(actual.rows.some(r => isOfficeEmployee(r.employeeName)));
    ok(actual.rows.every(r => r.rowNumber >= 3 && r.rowNumber <= 57));
} else throw new Error('Set ERP_TEST_WORKBOOK to the actual uploaded ERP fixture');

let result = parseErpWorkbook(pack(workbook()));
equal(result.rows[0], { rowNumber: 2, reference: 'INV-1', date: '2026-10-03', documentType: 'sale', itemCode: '00123', itemName: 'قالب', category: 'قوالب', quantity: 2, unit: 'حبة', unitPrice: 1234.56, discountCents: 1000, totalCents: 245912, vatCents: 36887, customerCode: '0007', customerName: 'مصنع', employeeId: '07018', employeeName: 'مندوب' });
equal(result.categories, ['قوالب']); equal(result.employees, [{ employeeId: '07018', employeeName: 'مندوب' }]);
equal(normalizeErpText(' ﻣﺒﻴﻌﺎت\u00a0\u200f مكتب '), 'مبيعات مكتب');
ok(isOfficeEmployee('مبيعات المكتب')); ok(isOfficeEmployee('مبيعات\nمكتب'));
equal(isOfficeEmployee('أحمد مبيعات مكتب'), false);

const returned = [...line]; returned[0] = 'CM-1'; returned[2] = 'مردودات المبيعات';
result = parseErpWorkbook(pack(workbook([headers, returned])));
equal([result.rows[0].quantity, result.rows[0].unitPrice, result.rows[0].discountCents, result.rows[0].totalCents, result.rows[0].vatCents], [-2, 1234.56, -1000, -245912, -36887]);
returned[6] = '-2'; returned[9] = '-10'; returned[10] = '-2,459.12'; returned[11] = '-368.87';
equal(parseErpWorkbook(pack(workbook([headers, returned]))).rows[0].totalCents, -245912);
const dmy = [...line]; dmy[1] = { xml: '<c t="d"><v>03/10/2026 08:22:49</v></c>' };
equal(parseErpWorkbook(pack(workbook([headers, dmy]))).rows[0].date, '2026-10-03');
const serial = [...line]; serial[1] = { xml: '<c t="n"><v>46298.5</v></c>' };
equal(parseErpWorkbook(pack(workbook([headers, serial]))).rows[0].date, '2026-10-03');
const leap = [...line]; leap[1] = '2024/02/29';
equal(parseErpWorkbook(pack(workbook([headers, leap]))).rows[0].date, '2024-02-29');
const arabic = [...line]; arabic[1] = '٢٠٢٦/١٠/٠٣'; arabic[10] = '٢٬٤٥٩٫١٢';
equal(parseErpWorkbook(pack(workbook([headers, arabic]))).rows[0].totalCents, 245912);
const pennies = [...line]; pennies[10] = '1.005';
equal(parseErpWorkbook(pack(workbook([headers, pennies]))).rows[0].totalCents, 101);
const entities = [...line]; entities[13] = 'A & B <C> "D"';
equal(parseErpWorkbook(pack(workbook([headers, entities]))).rows[0].customerName, 'A & B <C> "D"');
const inline = [...line]; inline[13] = { xml: '<c t="inlineStr"><is><r><t>A &amp; </t></r><r><t>B</t></r></is></c>' };
equal(parseErpWorkbook(pack(workbook([headers, inline]))).rows[0].customerName, 'A & B');
const shared = [...line]; shared[13] = { xml: '<c t="s"><v>0</v></c>' };
equal(parseErpWorkbook(pack(workbook([headers, shared], { 'xl/sharedStrings.xml': encoder('<sst><si><t>مصنع &amp; أبناء</t></si></sst>') }))).rows[0].customerName, 'مصنع & أبناء');
const numeric = [...line]; numeric[10] = '2.45912e3';
equal(parseErpWorkbook(pack(workbook([headers, numeric]))).rows[0].totalCents, 245912);
const normalizedHeaders = headers.map(h => h === 'الإجمالي' ? '  الاجمالي  ' : h === 'الكمية ' ? 'الكمية\u00a0' : h);
equal(parseErpWorkbook(pack(workbook([['تقرير المبيعات'], normalizedHeaders, line]))).rows.length, 1);
const summary = headers.map(() => ''); summary[4] = 'الإجمالي'; summary[6] = '2'; summary[10] = '2459.12';
equal(parseErpWorkbook(pack(workbook([headers, line, [], headers, summary]))).rows.length, 1);
const totalNamedItem = [...line]; totalNamedItem[4] = 'الإجمالي';
equal(parseErpWorkbook(pack(workbook([headers, totalNamedItem]))).rows.length, 1);
const blankEmployee = [...line]; blankEmployee[14] = ''; blankEmployee[15] = '';
ok(parseErpWorkbook(pack(workbook([headers, blankEmployee]))).warnings.length > 0);
equal(parseErpWorkbook(pack(workbook([headers, line, line]))).rows.length, 2); // Do not collapse legitimate equal invoice lines.

for (const [column, invalid, pattern] of [[1, '2026/02/30', /تاريخ/], [1, '10-03-26', /التاريخ/], [10, '12,34.00', /رقم/], [10, 'Infinity', /رقم/], [10, '1000000001', /الحد/], [6, '0', /إشارة/], [10, '-1', /إشارة/], [0, '', /مطلوب/], [3, '', /مطلوب/], [2, 'فاتورة مشتريات', /نوع المستند/], [16, 'USD', /الريال/], [17, '3.75', /التعادل/]]) {
    const bad = [...line]; bad[column] = invalid; rejects(pack(workbook([headers, bad])), pattern);
}
const suspiciousSummary = [...summary]; suspiciousSummary[14] = '123';
rejects(pack(workbook([headers, line, suspiciousSummary])), /مطلوب/);
const missingHeaders = [...headers]; missingHeaders[10] = 'الصافي';
rejects(pack(workbook([missingHeaders, line])), /عمود مطلوب/);
rejects(pack(workbook([[...headers, 'الإجمالي'], line])), /عمود مكرر/);
const formula = [...line]; formula[10] = { xml: '<c><f>1+2</f><v>3</v></c>' };
rejects(pack(workbook([headers, formula])), /معادلات/);
const errorCell = [...line]; errorCell[10] = { xml: '<c t="e"><v>#DIV\/0!</v></c>' };
rejects(pack(workbook([headers, errorCell])), /قيمة خلية/);
rejects(pack(workbook([headers, shared])), /مرجع نص/);
rejects(new Uint8Array(5 * 1024 * 1024 + 1), /5 ميجابايت/);
rejects(encoder('not an XLSX'), /XLSX/);
rejects(pack(workbook([headers, ...Array.from({ length: 5001 }, () => line)])), /5000/);
rejects(pack(workbook([headers, line], { 'xl/vbaProject.bin': encoder('vba') })), /ماكرو/);
rejects(pack(workbook([headers, line], { '../evil.xml': encoder('<x/>') })), /غير آمنة/);
rejects(pack(workbook([headers, line], { 'xl/externalLinks/link.xml': encoder('<x/>') })), /خارجية/);
rejects(pack(workbook([headers, line], { '_rels/.rels': encoder('<Relationships><Relationship Id="external" Type="hyperlink" TargetMode="External" Target="https://bad.invalid/"/></Relationships>') })), /خارجية/);
rejects(pack(workbook([headers, line], { 'xl/styles.xml': encoder('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><style>&x;</style>') })), /XML الخارجية/);
rejects(pack(workbook([headers, line], { 'xl/styles.xml': encoder('<x>'.repeat(33) + '</x>'.repeat(33)) })), /أعمق/);
rejects(pack(workbook([headers, line], { 'xl/styles.xml': encoder('<x><broken></x>') })), /XML غير صالح/);
rejects(pack(workbook([headers, line], { 'xl/styles.xml': encoder('<x>' + 'A'.repeat(10 * 1024 * 1024) + '</x>') })), /فك الضغط/);
const tooManyFiles = workbook(); for (let i = 0; i < 100; i++) tooManyFiles[`x${i}.xml`] = encoder('<x/>');
rejects(pack(tooManyFiles), /الحد/);
const duplicateSheets = workbook(); duplicateSheets['xl/workbook.xml'] = encoder('<workbook xmlns:r="r"><sheets><sheet name="Report" r:id="rId1"/><sheet name="Report" r:id="rId1"/></sheets></workbook>');
rejects(pack(duplicateSheets), /ورقة Excel واحدة/);
const duplicateRefs = workbook(); duplicateRefs['xl/_rels/workbook.xml.rels'] = encoder('<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
rejects(pack(duplicateRefs), /مراجع أوراق/);
const badRowReferences = workbook(); badRowReferences['xl/worksheets/sheet1.xml'] = encoder('<worksheet><sheetData><row r="1"><c r="A2"><v>x</v></c></row></sheetData></worksheet>');
rejects(pack(badRowReferences), /عنوان خلية/);
// Dishonest ZIP size: update both local and central advertised lengths to avoid
// a superficial directory mismatch; the native inflater must still stop.
const bombParts = workbook(); bombParts['padding.bin'] = encoder('A'.repeat(100000));
const falseSize = pack(bombParts), view = new DataView(falseSize.buffer, falseSize.byteOffset, falseSize.byteLength);
for (let p = 0; p < falseSize.length - 46; p++) {
    if (view.getUint32(p, true) === 0x02014b50) {
        const name = new TextDecoder().decode(falseSize.subarray(p + 46, p + 46 + view.getUint16(p + 28, true)));
        if (name === 'padding.bin') { const local = view.getUint32(p + 42, true); view.setUint32(p + 24, 10, true); view.setUint32(local + 22, 10, true); break; }
    }
}
rejects(falseSize, /الحجم/);
const damaged = pack(workbook()); const damagedView = new DataView(damaged.buffer, damaged.byteOffset, damaged.byteLength);
for (let p = 0; p < damaged.length - 46; p++) if (damagedView.getUint32(p, true) === 0x02014b50) { damagedView.setUint32(p + 16, 0, true); const local = damagedView.getUint32(p + 42, true); damagedView.setUint32(local + 14, 0, true); break; }
rejects(damaged, /تالف/);
// Valid archive fixture generated by another implementation round-trips.
equal(parseErpWorkbook(pack(unzipSync(pack(workbook())))).rows[0].reference, 'INV-1');
console.log(JSON.stringify({ passed: true, checks, actualWorkbookRows: 55, maxRows: 5000, source: 'ERP XLSX parser' }));

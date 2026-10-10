import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {zipSync,strToU8} from 'fflate';
const require=createRequire(import.meta.url),realXml=require('fast-xml-parser'),parsed=[],trees=[];
class ObservedParser extends realXml.XMLParser { parse(text,...args){parsed.push(text);const result=super.parse(text,...args);trees.push(result);return result;} }
const loadedModule={exports:{}},code=ts.transpileModule(fs.readFileSync('lib/erp-sales.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',code)(name=>name==='fast-xml-parser'?{...realXml,XMLParser:ObservedParser}:require(name),loadedModule,loadedModule.exports);
const {parseErpWorkbook,ErpWorkbookError}=loadedModule.exports;
let checks=0;function equal(actual,expected,message){assert.deepEqual(actual,expected,message);checks++;}
function rejects(bytes,pattern){assert.throws(()=>parseErpWorkbook(bytes),error=>error instanceof ErpWorkbookError&&pattern.test(error.message));checks++;}
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

const plain=parseErpWorkbook(pack(workbook()));parsed.length=0;
const extra={
 'customXml/item1.xml':encoder('<unused>'+ '<a><b>1</b></a>'.repeat(1000)+'</unused>'),
 'xl/worksheets/not-selected.xml':encoder('<unused><a>ignored</a></unused>'),
 'docProps/custom.xml':encoder('<unused><text>ignored</text></unused>')
};
equal(parseErpWorkbook(pack(workbook(undefined,extra))),plain,'Unused valid XML does not affect sales');
equal(parsed.some(text=>text.includes('<unused>')),false,'Unreferenced XML must never allocate an AST');
equal(parsed.length,4,'Only workbook metadata, content types, relationships and chosen worksheet are parsed');
const nested=workbook();
nested['xl/worksheets/sheet1.xml']=encoder(new TextDecoder().decode(nested['xl/worksheets/sheet1.xml']).replace('</worksheet>','<unused>'+ '<a><b>1</b></a>'.repeat(1000)+'</unused></worksheet>'));
trees.length=0;equal(parseErpWorkbook(pack(nested)),plain,'Irrelevant subtrees inside selected parts do not change the sales');
equal(trees.some(tree=>tree.worksheet?.unused!==undefined),false,'Selected-part parser also discards unused XML subtrees');
trees.length=0;const oversizedRows=workbook();oversizedRows['xl/worksheets/sheet1.xml']=encoder('<worksheet><sheetData>'+'<row><c><v>x</v></c></row>'.repeat(5051)+'</sheetData></worksheet>');
rejects(pack(oversizedRows),/5000/);equal(trees.some(tree=>tree.worksheet!==undefined),false,'Too many rows are rejected before a complete AST exists');
trees.length=0;const oversizedColumns=workbook();oversizedColumns['xl/worksheets/sheet1.xml']=encoder('<worksheet><sheetData><row>'+'<c><v>x</v></c>'.repeat(101)+'</row></sheetData></worksheet>');
rejects(pack(oversizedColumns),/أعمدة/);equal(trees.some(tree=>tree.worksheet!==undefined),false,'Too many cells are rejected before a complete AST exists');
rejects(pack(workbook(undefined,{'customXml/unused.xml':encoder('<root><item></root>')})),/XML/);
rejects(pack(workbook(undefined,{'customXml/unused.xml':encoder('<!DOCTYPE root [<!ENTITY value SYSTEM "file:///never-read">]><root>&value;</root>')})),/XML/);
rejects(pack(workbook(undefined,{'customXml/unused.xml':encoder('<root>'+ '<a>'.repeat(34)+'</a>'.repeat(34)+'</root>')})),/XML/);
for(const relationship of [
 '<Relationship Id="x" Type="http://test.invalid/worksheet" TargetMode="External" Target="http://never-request.invalid/"/>',
 '<x:Relationship xmlns:x="urn:test" Id="x" Type="http://test.invalid/worksheet" TargetMode="Exter&#110;al"/>',
 "<Relationship Id='x' Type='http://test.invalid/vbaProject'/>",
 '<Relationship Id="x" Type="http://test.invalid/macro&#115;heet"/>'
])rejects(pack(workbook(undefined,{'customXml/unused.xml':encoder('<Relationships>'+relationship+'</Relationships>')})),/روابط خارجية|ماكرو/);
// Quoted text, comments and CDATA are data, not active relationship attributes.
equal(parseErpWorkbook(pack(workbook(undefined,{'customXml/unused.xml':encoder(`<root><Relationship Note="TargetMode='External'" Type="urn:internal"/><![CDATA[<Relationship TargetMode="External"/>]]><!-- <Relationship TargetMode="External"/> --></root>`)}))),plain);
// Unreferenced relationship files receive the same external-link protection.
rejects(pack(workbook(undefined,{'customXml/_rels/item.xml.rels':encoder('<Relationships><Relationship TargetMode="External" Type="urn:internal"/></Relationships>')})),/روابط خارجية/);
// Keep expanded archive guards effective even when the unneeded XML is never parsed.
rejects(pack(workbook(undefined,{'customXml/large.xml':encoder('<root>'+ 'x'.repeat(10*1024*1024)+'</root>')})),/حجم محتوى/);
const big=encoder('<root>'+'x'.repeat(7*1024*1024)+'</root>');
rejects(pack(workbook(undefined,{'customXml/a.xml':big,'customXml/b.xml':big,'customXml/c.xml':big})),/حجم محتوى/);
equal(parseErpWorkbook(pack(workbook())).rows[0].totalCents,245912,'Used worksheet values remain unchanged');
console.log(JSON.stringify({ok:true,checks,scope:'Actual bounded XLSX parser; unused XML is validated without AST allocation, XXE/external/malformed/ZIP guards preserved'}));

import { inflateRawSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

/** Values taken from the ERP's invoice lines. All monetary totals exclude VAT. */
export type ErpRow = {
    rowNumber: number; reference: string; date: string; documentType: 'sale' | 'return';
    itemCode: string; itemName: string; category: string; quantity: number; unit: string;
    unitPrice: number; discountCents: number; totalCents: number; vatCents: number;
    customerCode: string; customerName: string; employeeId: string; employeeName: string;
};
export type ErpWorkbook = {
    rows: ErpRow[]; categories: string[];
    employees: { employeeId: string; employeeName: string }[]; warnings: string[];
};

const MAX_FILE = 5 * 1024 * 1024, MAX_PART = 10 * 1024 * 1024;
const MAX_EXPANDED = 20 * 1024 * 1024, MAX_ENTRIES = 100, MAX_ROWS = 5000;
const MAX_COLUMNS = 100, MAX_CENTS = 100000000000;
const decoder = new TextDecoder('utf-8', { fatal: true });
// Retain only the fields consumed below. Otherwise the same unused-XML attack
// could move irrelevant subtrees inside the selected worksheet or workbook.
const salesXmlPaths = new Set([
    'Types', 'Types.Default', 'Types.Override',
    'workbook', 'workbook.workbookPr', 'workbook.sheets', 'workbook.sheets.sheet',
    'Relationships', 'Relationships.Relationship',
    'sst', 'sst.si', 'sst.si.t', 'sst.si.r', 'sst.si.r.t',
    'worksheet', 'worksheet.sheetData', 'worksheet.sheetData.row',
    'worksheet.sheetData.row.c', 'worksheet.sheetData.row.c.v', 'worksheet.sheetData.row.c.f',
    'worksheet.sheetData.row.c.is', 'worksheet.sheetData.row.c.is.t',
    'worksheet.sheetData.row.c.is.r', 'worksheet.sheetData.row.c.is.r.t',
]);
function salesXmlParser() {
    let rows = 0, columns = 0, strings = 0;
    return new XMLParser({
        ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false,
        parseAttributeValue: false, trimValues: false, processEntities: false,
        alwaysCreateTextNode: true, jPath: false,
        updateTag: (name, path) => {
            // removeNSPrefix normalizes node names, but the default string path
            // still contains prefixes. Use the matcher's local-name path so real
            // ERP exports (x:workbook, x:worksheet, ...) share the same allowlist.
            const key = typeof path === 'string' ? path : path.toString('.', false);
            if (!salesXmlPaths.has(key)) return false;
            // Enforce the existing limits before retaining oversized collections.
            if (key === 'worksheet.sheetData.row') {
                columns = 0;
                if (++rows > MAX_ROWS + 50) fail('الحد الأقصى للتقرير 5000 بند');
            }
            if (key === 'worksheet.sheetData.row.c' && ++columns > MAX_COLUMNS) fail('عدد أعمدة التقرير يتجاوز الحد المسموح');
            if (key === 'sst.si' && ++strings > 100000) fail('عدد النصوص أو طولها في Excel يتجاوز الحد المسموح');
            return name;
        },
    });
}
type XmlNodes = XmlNode | XmlNode[];
interface XmlNode {
    '#text'?: unknown; '@_r'?: unknown; '@_t'?: unknown; '@_id'?: unknown; '@_Id'?: unknown; '@_Type'?: unknown; '@_Target'?: unknown; '@_ContentType'?: unknown; '@_date1904'?: unknown;
    t?: unknown; f?: unknown; v?: unknown; is?: XmlNode; r?: XmlNodes; c?: XmlNodes; row?: XmlNodes;
    worksheet?: XmlNode; sheetData?: XmlNode; workbook?: XmlNode; workbookPr?: XmlNode; sheets?: XmlNode; sheet?: XmlNodes;
    Types?: XmlNode; Default?: XmlNodes; Override?: XmlNodes; Relationships?: XmlNode; Relationship?: XmlNodes; sst?: XmlNode; si?: XmlNodes;
}
type Cell = { text: string; type: string };
type SheetRow = { rowNumber: number; cells: Cell[] };

/** Expected workbook validation failure, safe to show as an HTTP 400 message. */
export class ErpWorkbookError extends Error {
    constructor(message: string) { super(message); this.name = 'ErpWorkbookError'; }
}
function fail(message: string): never { throw new ErpWorkbookError(message); }
export function normalizeErpText(value: unknown): string {
    return String(value ?? '').normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}
export function isOfficeEmployee(value: unknown): boolean { return ['مبيعات مكتب', 'مبيعات المكتب'].includes(normalizeErpText(value)); }
function headerKey(value: unknown) { return normalizeErpText(value).replace(/[أإآ]/g, 'ا').toLowerCase(); }
function list<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function scalar(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'object' && '#text' in value) return scalar((value as XmlNode)['#text']);
    return '';
}
// Entity expansion is disabled in the XML parser. Only XML's five predefined
// entities and numeric character references are decoded, once, as literal text.
function literal(value: unknown): string {
    return scalar(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|apos|quot);/gi, (match, entity: string) => {
        const basics: Record<string, string> = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };
        if (entity[0] !== '#') return basics[entity] ?? match;
        const point = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (!Number.isInteger(point) || point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) fail('رمز نصي غير صالح في ملف Excel');
        return String.fromCodePoint(point);
    });
}
function richText(value: XmlNode | undefined): string {
    if (!value) return '';
    return value.t !== undefined ? literal(value.t) : list<XmlNode>(value.r).map(r => literal(r.t)).join('');
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
});
function crc32(bytes: Uint8Array): number {
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
}

/** Strict, bounded ZIP reader: validates both directories and limits the inflater
 * itself, so a dishonest uncompressed-size field cannot allocate a ZIP bomb. */
function unzipWorkbook(bytes: Uint8Array): Map<string, Uint8Array> {
    if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > MAX_FILE) fail('ارفع ملف XLSX بحجم لا يتجاوز 5 ميجابايت');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (p: number) => view.getUint16(p, true), u32 = (p: number) => view.getUint32(p, true);
    let end = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
        if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) { end = p; break; }
    }
    if (end < 0) fail('ملف XLSX تالف أو بصيغة غير مدعومة');
    const count = u16(end + 10), directorySize = u32(end + 12), directoryOffset = u32(end + 16);
    if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== count || !count || count > MAX_ENTRIES || directoryOffset + directorySize !== end) fail('تركيب ملف XLSX غير مدعوم أو يتجاوز الحد المسموح');
    const parts = new Map<string, Uint8Array>(), ranges: [number, number][] = [];
    let at = directoryOffset, expanded = 0;
    for (let index = 0; index < count; index++) {
        if (at + 46 > end || u32(at) !== 0x02014b50) fail('فهرس ملف Excel غير صالح');
        const flags = u16(at + 8), method = u16(at + 10), checksum = u32(at + 16);
        const compressed = u32(at + 20), original = u32(at + 24);
        const nameLength = u16(at + 28), extraLength = u16(at + 30), commentLength = u16(at + 32), local = u32(at + 42);
        const next = at + 46 + nameLength + extraLength + commentLength;
        if (next > end || !nameLength || nameLength > 240 || u16(at + 34) !== 0 || (flags & ~0x80e) || ![0, 8].includes(method)) fail('ملف Excel مشفر أو يحتوي ضغطًا غير مدعوم');
        if (original > MAX_PART || compressed > MAX_FILE || (expanded += original) > MAX_EXPANDED) fail('حجم محتوى Excel بعد فك الضغط أكبر من المسموح');
        let name: string;
        try { name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)); } catch { fail('اسم ملف داخلي غير صالح'); }
        if (name.startsWith('/') || name.includes('\\') || name.split('/').some(s => s === '..' || s === '.') || /[\x00-\x1f]/.test(name) || parts.has(name)) fail('مسارات مكررة أو غير آمنة في ملف Excel');
        if (/(?:vba|macrosheet|activex|embeddings|externallinks|connections\.xml)/i.test(name)) fail('ارفع تقرير XLSX بدون وحدات ماكرو أو روابط بيانات خارجية');
        if (local + 30 > directoryOffset || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) fail('ترويسة ملف Excel غير صالحة');
        const localNameLength = u16(local + 26), localExtraLength = u16(local + 28);
        const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
        let localName: string;
        try { localName = decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)); } catch { fail('اسم ملف داخلي غير صالح'); }
        if (dataEnd > directoryOffset || localNameLength !== nameLength || localName !== name) fail('فهرس Excel لا يطابق محتواه');
        if (!(flags & 8) && (u32(local + 14) !== checksum || u32(local + 18) !== compressed || u32(local + 22) !== original)) fail('أحجام ملفات Excel غير متطابقة');
        if (ranges.some(([start, finish]) => local < finish && dataEnd > start)) fail('ملفات متداخلة في أرشيف Excel');
        ranges.push([local, dataEnd]);
        let content: Uint8Array;
        try {
            const input = bytes.subarray(dataStart, dataEnd);
            content = method === 0 ? input : inflateRawSync(input, { maxOutputLength: Math.max(1, original) });
        } catch { fail('تعذر فك محتوى Excel أو تجاوز الحجم المسموح'); }
        if (content.length !== original || crc32(content) !== checksum) fail('ملف Excel تالف؛ نزّل التقرير من ERP مرة أخرى');
        parts.set(name, content); at = next;
    }
    if (at !== end || !parts.has('[Content_Types].xml') || !parts.has('xl/workbook.xml')) fail('ارفع تقريرًا بصيغة XLSX الصحيحة');
    return parts;
}

// Inspect active relationship attributes without building a tree for the part.
// XMLValidator still verifies all structure/attribute syntax. Consume complete
// quoted attributes so text inside another attribute cannot act as an attribute.
function guardRelationshipTag(tag: string) {
    const name = tag.match(/^([^\s/>]+)/)?.[1];
    if (!name || name.split(':').pop() !== 'Relationship') return;
    const attributes = tag.slice(name.length).matchAll(/([^\s=]+)\s*=\s*(["'])([\s\S]*?)\2/g);
    for (const [, qualified, , raw] of attributes) {
        if (qualified.startsWith('xmlns:')) continue;
        const attribute = qualified.split(':').pop(), value = literal(raw);
        if (attribute === 'TargetMode' && value.toLowerCase() === 'external' || attribute === 'Type' && /(?:vba|macro|externalLink|oleObject)/i.test(value)) fail('التقرير يحتوي روابط خارجية أو وحدات ماكرو غير مسموحة');
    }
}

// Lexical resource and relationship guards; XMLValidator verifies structure.
// Skip comments/CDATA before inspecting tags or counting depth.
function guardXml(text: string) {
    if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text) || text.includes('\0')) fail('تعريفات XML الخارجية غير مسموحة');
    let position = 0, depth = 0, tags = 0;
    while ((position = text.indexOf('<', position)) !== -1) {
        if (text.startsWith('<!--', position) || text.startsWith('<![CDATA[', position)) {
            const marker = text.startsWith('<!--', position) ? '-->' : ']]>';
            const ending = text.indexOf(marker, position + 4);
            if (ending < 0) fail('XML غير مكتمل في ملف Excel');
            position = ending + marker.length; continue;
        }
        let end = position + 1, quote = '';
        for (; end < text.length; end++) {
            const c = text[end];
            if (quote) { if (c === quote) quote = ''; }
            else if (c === '"' || c === "'") quote = c;
            else if (c === '>') break;
        }
        if (end === text.length) fail('XML غير مكتمل في ملف Excel');
        if (text[position + 1] !== '?') {
            if (++tags > 750000) fail('عدد عناصر Excel يتجاوز الحد المسموح');
            if (text[position + 1] === '/') depth--;
            else {
                guardRelationshipTag(text.slice(position + 1, end));
                if (text[end - 1] !== '/') depth++;
            }
            if (depth > 32 || depth < 0) fail('تركيب XML أعمق من المسموح');
        }
        position = end + 1;
    }
}
function validateXml(bytes: Uint8Array, name: string) {
    let text: string;
    try { text = decoder.decode(bytes); } catch { fail(`ترميز XML غير صالح: ${name}`); }
    guardXml(text);
    if (XMLValidator.validate(text) !== true) fail(`ملف XML غير صالح: ${name}`);
}

function digits(value: string): string { return value.replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) - (c >= '۰' ? 0x6f0 : 0x660))); }
function decimal(value: string, label: string, row: number, optional = false): string {
    let input = digits(normalizeErpText(value)).replace(/٬/g, ',').replace(/٫/g, '.');
    if (!input && optional) return '0';
    if (/^[+-]?\d{1,3}(?: \d{3})+(?:\.\d+)?$/.test(input)) input = input.replace(/ /g, '');
    const scientific = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(input);
    if (scientific && input.length <= 32 && Number.isFinite(Number(input)) && Math.abs(Number(input)) <= 1000000000) input = Number(input).toFixed(6).replace(/\.?0+$/, '');
    if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(input)) fail(`السطر ${row}: ${label} ليس رقمًا صالحًا`);
    input = input.replace(/,/g, '');
    if (input.length > 30 || !Number.isFinite(Number(input)) || Math.abs(Number(input)) > 1000000000) fail(`السطر ${row}: ${label} يتجاوز الحد المسموح`);
    return input;
}
function money(value: string, label: string, row: number, optional = false): number {
    const input = decimal(value, label, row, optional), negative = input.startsWith('-');
    const [whole, fraction = ''] = input.replace(/^[+-]/, '').split('.');
    const result = Number(whole) * 100 + Number((fraction + '00').slice(0, 2)) + (Number(fraction[2] || '0') >= 5 ? 1 : 0);
    if (!Number.isSafeInteger(result) || result > MAX_CENTS) fail(`السطر ${row}: ${label} يتجاوز الحد المسموح`);
    return (negative ? -1 : 1) * result;
}
function erpDate(cell: Cell, row: number, date1904: boolean): string {
    const value = digits(normalizeErpText(cell.text));
    let year: number, month: number, day: number;
    const ymd = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/);
    const dmy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/);
    if (ymd) [, year, month, day] = ymd.map(Number);
    else if (dmy) { day = Number(dmy[1]); month = Number(dmy[2]); year = Number(dmy[3]); }
    else if ((cell.type === 'n' || !cell.type) && /^\d+(?:\.\d+)?$/.test(value)) {
        const serial = Number(value);
        if (!Number.isFinite(serial) || serial < (date1904 ? 0 : 61) || serial > 110000) fail(`السطر ${row}: تاريخ Excel غير صالح`);
        const instant = new Date((date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) + Math.floor(serial) * 86400000);
        return instant.toISOString().slice(0, 10);
    } else fail(`السطر ${row}: التاريخ غير صالح؛ استخدم تاريخ الفاتورة`);
    const instant = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || year > 2200 || instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) fail(`السطر ${row}: تاريخ الفاتورة غير صالح`);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const fields = {
    reference: 'رقم الفاتورة', date: 'التاريخ', documentType: 'النوع', itemCode: 'رقم الصنف', itemName: 'اسم الصنف',
    category: 'الفئة', quantity: 'الكمية', unit: 'الوحدة', unitPrice: 'سعر الوحدة', discountCents: 'الخصم', totalCents: 'الإجمالي',
    vatCents: 'القيمة المضافة', customerCode: 'رقم العميل', customerName: 'اسم العميل', employeeId: 'رقم الموظف', employeeName: 'اسم الموظف',
} as const;
type Field = keyof typeof fields;
const fieldNames = Object.keys(fields) as Field[];
function headerColumns(row: SheetRow): Record<Field, number> | null {
    const headers = row.cells.map(c => headerKey(c.text));
    if (!headers.includes(headerKey(fields.reference)) || !headers.includes(headerKey(fields.date))) return null;
    const columns = {} as Record<Field, number>;
    for (const field of fieldNames) {
        const key = headerKey(fields[field]), index = headers.indexOf(key);
        if (index < 0) fail(`عمود مطلوب غير موجود: ${fields[field]}`);
        if (headers.lastIndexOf(key) !== index) fail(`عمود مكرر في التقرير: ${fields[field]}`);
        columns[field] = index;
    }
    return columns;
}
function worksheetRows(sheet: XmlNode, strings: string[]): SheetRow[] {
    if (!sheet.worksheet?.sheetData) fail('لا توجد بيانات في ورقة التقرير');
    const source = list<XmlNode>(sheet.worksheet.sheetData.row);
    if (source.length > MAX_ROWS + 50) fail('الحد الأقصى للتقرير 5000 بند');
    let previousRow = 0;
    return source.map(row => {
        const rowNumber = row['@_r'] === undefined ? previousRow + 1 : Number(row['@_r']);
        if (!Number.isSafeInteger(rowNumber) || rowNumber <= previousRow || rowNumber > 1048576) fail('أرقام صفوف Excel مكررة أو غير مرتبة');
        previousRow = rowNumber;
        const cells: Cell[] = [], rawCells = list<XmlNode>(row.c);
        if (rawCells.length > MAX_COLUMNS) fail('عدد أعمدة التقرير يتجاوز الحد المسموح');
        let previousColumn = -1;
        for (const cell of rawCells) {
            let column = previousColumn + 1;
            if (cell['@_r'] !== undefined) {
                const address = String(cell['@_r']).match(/^([A-Z]{1,3})([1-9]\d*)$/);
                if (!address || Number(address[2]) !== rowNumber) fail(`السطر ${rowNumber}: عنوان خلية غير صالح`);
                column = Array.from(address[1]).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
            }
            if (column <= previousColumn || column >= MAX_COLUMNS) fail(`السطر ${rowNumber}: أعمدة مكررة أو تتجاوز الحد المسموح`);
            previousColumn = column;
            if (cell.f !== undefined) fail(`السطر ${rowNumber}: التقرير يحتوي معادلات؛ صدّره بالقيم فقط`);
            const type = String(cell['@_t'] || ''), raw = literal(cell.v);
            let text = type === 'inlineStr' ? richText(cell.is) : raw;
            if (type === 's') {
                const index = /^\d+$/.test(raw) ? Number(raw) : -1;
                if (!Number.isSafeInteger(index) || index < 0 || index >= strings.length) fail(`السطر ${rowNumber}: مرجع نص Excel غير صالح`);
                text = strings[index];
            }
            if (type === 'e' || text.length > 5000) fail(`السطر ${rowNumber}: قيمة خلية غير صالحة أو طويلة جدًا`);
            cells[column] = { text, type };
        }
        for (let i = 0; i < cells.length; i++) if (!cells[i]) cells[i] = { text: '', type: '' };
        return { rowNumber, cells };
    });
}

/** Pure parser. Company exclusion, member assignment and product/category mapping
 * intentionally belong to the authenticated preview/commit layer. */
export function parseErpWorkbook(bytes: Uint8Array): ErpWorkbook {
    const parts = unzipWorkbook(bytes), documents = new Map<string, XmlNode>(), validated = new Set<string>();
    for (const [name, data] of parts) {
        if (name.endsWith('.xml') || name.endsWith('.rels')) {
            validateXml(data, name); validated.add(name);
        }
    }
    // The archive may contain large unused custom XML, metadata or worksheets.
    // Validate all of it above, but retain ASTs only for the sales data we use.
    const document = (name: string): XmlNode | undefined => {
        if (!validated.has(name)) return undefined;
        if (!documents.has(name)) {
            try { documents.set(name, salesXmlParser().parse(decoder.decode(parts.get(name)!)) as XmlNode); }
            catch (error) { if (error instanceof ErpWorkbookError) throw error; fail(`تعذر قراءة XML: ${name}`); }
        }
        return documents.get(name);
    };
    const contentTypes = document('[Content_Types].xml');
    if (!contentTypes?.Types || [...list<XmlNode>(contentTypes.Types.Default), ...list<XmlNode>(contentTypes.Types.Override)].some(t => /(?:macroenabled|vba|activex|oleobject)/i.test(String(t['@_ContentType'] || '')))) fail('ارفع ملف XLSX عادي بدون وحدات ماكرو');
    const workbook = document('xl/workbook.xml')?.workbook;
    const sheets = list<XmlNode>(workbook?.sheets?.sheet);
    if (sheets.length !== 1) fail('ارفع تقرير المبيعات في ورقة Excel واحدة');
    const relationships = list<XmlNode>(document('xl/_rels/workbook.xml.rels')?.Relationships?.Relationship);
    const seenRelationships = new Set<string>();
    for (const relationship of relationships) {
        const id = literal(relationship['@_Id']);
        if (!id || seenRelationships.has(id)) fail('مراجع أوراق Excel مكررة أو غير صالحة');
        seenRelationships.add(id);
    }
    const sheetId = literal(sheets[0]['@_id']);
    const relationship = relationships.find(r => literal(r['@_Id']) === sheetId && /\/worksheet$/.test(String(r['@_Type'])));
    if (!relationship) fail('تعذر العثور على ورقة المبيعات داخل Excel');
    const target = literal(relationship['@_Target']);
    if (!target || target.includes('\\') || target.split('/').some(s => s === '..' || s === '.') || /[?#:]/.test(target)) fail('مسار ورقة المبيعات غير صالح');
    const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    if (!sheetPath.startsWith('xl/worksheets/') || !validated.has(sheetPath)) fail('ملف ورقة المبيعات غير موجود');
    const strings = list<XmlNode>(document('xl/sharedStrings.xml')?.sst?.si).map(richText);
    if (strings.length > 100000 || strings.some(s => s.length > 5000)) fail('عدد النصوص أو طولها في Excel يتجاوز الحد المسموح');
    const source = worksheetRows(document(sheetPath)!, strings);
    let columns: Record<Field, number> | null = null, headerIndex = -1;
    for (let i = 0; i < Math.min(25, source.length); i++) {
        columns = headerColumns(source[i]);
        if (columns) { headerIndex = i; break; }
    }
    if (!columns) fail('لم يتم العثور على عناوين تقرير فواتير ERP؛ استخدم التقرير الأصلي');
    const header = source[headerIndex].cells.map(c => headerKey(c.text));
    const currencyColumn = header.indexOf(headerKey('العملة')), exchangeColumn = header.indexOf(headerKey('التعادل'));
    const date1904 = ['1', 'true'].includes(String(workbook?.workbookPr?.['@_date1904'] || ''));
    const rows: ErpRow[] = [], warnings: string[] = [];
    for (const row of source.slice(headerIndex + 1)) {
        if (row.cells.every(c => !normalizeErpText(c.text))) continue;
        if (row.cells.some(c => headerKey(c.text) === headerKey(fields.reference)) && headerColumns(row)) continue;
        const cell = (field: Field): Cell => row.cells[columns![field]] || { text: '', type: '' };
        const text = (field: Field, limit = 500): string => {
            const value = normalizeErpText(cell(field).text);
            if (value.length > limit) fail(`السطر ${row.rowNumber}: ${fields[field]} طويل جدًا`);
            return value;
        };
        const reference = text('reference', 100), itemName = text('itemName');
        const totalLabel = ['الاجمالي', 'المجموع', 'اجمالي', 'grand total', 'total'].includes(headerKey(itemName));
        const summaryOnly = !reference && !text('date') && !text('documentType') && !text('itemCode') && !text('employeeId') && !text('employeeName') && !text('customerCode') && !text('customerName');
        if (summaryOnly && totalLabel && text('totalCents')) continue;
        if (!reference || !itemName || !text('itemCode')) fail(`السطر ${row.rowNumber}: رقم الفاتورة ورقم الصنف واسمه مطلوبون`);
        const kind = headerKey(text('documentType'));
        const documentType = ['فاتورة مبيعات', 'مبيعات', 'sales invoice', 'sale'].includes(kind) ? 'sale' : ['مردودات المبيعات', 'مردود مبيعات', 'مرتجع مبيعات', 'مرتجعات المبيعات', 'sales return', 'credit note', 'return'].includes(kind) ? 'return' : null;
        if (!documentType) fail(`السطر ${row.rowNumber}: نوع المستند ليس فاتورة أو مردود مبيعات`);
        const quantity = Number(decimal(text('quantity'), fields.quantity, row.rowNumber));
        const unitPrice = Number(decimal(text('unitPrice'), fields.unitPrice, row.rowNumber));
        const totalCents = money(text('totalCents'), fields.totalCents, row.rowNumber);
        const discountCents = money(text('discountCents'), fields.discountCents, row.rowNumber, true);
        const vatCents = money(text('vatCents'), fields.vatCents, row.rowNumber, true);
        if (!quantity || (documentType === 'sale' && [quantity, unitPrice, totalCents, discountCents, vatCents].some(n => n < 0))) fail(`السطر ${row.rowNumber}: راجع إشارة الكمية والقيم ونوع المستند`);
        const currency = headerKey(row.cells[currencyColumn]?.text);
        if (currency && !['ريال سعودي', 'الريال السعودي', 'sar', 'saudi riyal', 'saudi riyals'].includes(currency)) fail(`السطر ${row.rowNumber}: التقرير يجب أن يكون بالريال السعودي`);
        const exchange = normalizeErpText(row.cells[exchangeColumn]?.text);
        if (exchange && Number(decimal(exchange, 'التعادل', row.rowNumber)) !== 1) fail(`السطر ${row.rowNumber}: راجع عملة التقرير والتعادل قبل الرفع`);
        const sign = documentType === 'return' ? -1 : 1;
        rows.push({
            rowNumber: row.rowNumber, reference, date: erpDate(cell('date'), row.rowNumber, date1904), documentType,
            itemCode: text('itemCode', 100), itemName, category: text('category', 200), quantity: sign * Math.abs(quantity), unit: text('unit', 100),
            unitPrice: Math.abs(unitPrice), discountCents: sign * Math.abs(discountCents), totalCents: sign * Math.abs(totalCents), vatCents: sign * Math.abs(vatCents),
            customerCode: text('customerCode', 100), customerName: text('customerName'), employeeId: text('employeeId', 100), employeeName: text('employeeName', 200),
        });
        if (rows.length > MAX_ROWS) fail('الحد الأقصى للتقرير 5000 بند');
    }
    if (!rows.length) fail('التقرير لا يحتوي بنود مبيعات قابلة للقراءة');
    if (rows.some(r => !r.employeeId || !r.employeeName)) warnings.push('توجد بنود بدون رقم أو اسم موظف؛ يلزم مراجعة الربط قبل الاعتماد');
    if (rows.some(r => !r.category)) warnings.push('توجد بنود بدون فئة؛ يلزم تحديد تصنيفها في المعاينة');
    const employees = new Map<string, { employeeId: string; employeeName: string }>();
    for (const row of rows) employees.set(JSON.stringify([row.employeeId, row.employeeName]), { employeeId: row.employeeId, employeeName: row.employeeName });
    return { rows, categories: [...new Set(rows.map(r => r.category))], employees: [...employees.values()], warnings };
}

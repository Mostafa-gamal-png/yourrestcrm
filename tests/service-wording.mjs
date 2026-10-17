// Customer service reads what it records as an opportunity handed to sales, not as a visit: «فرصة» for the record and «التواصل» for what was done
// in it, in the navigation, the page title, the registration form, the history and the list; sales members and administrators keep «زيارة».
// The words as pure functions (Arabic and English, every phrase of the screens), that the English dictionary reads them, and the real
// components rendered for each role. Render contracts only: no browser, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const root = process.cwd(), nativeRequire = createRequire(import.meta.url), libs = new Map(), apps = new Map();
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true};
let checks = 0, language = 'ar';
const eq = (a, b, message) => { assert.deepEqual(a === undefined ? undefined : JSON.parse(JSON.stringify(a)), b, message); checks++; }, ok = (value, message) => { assert.ok(value, message); checks++; };
const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'lib/locales/en.json'), 'utf8'));
const translate = value => language === 'en' && typeof value === 'string' ? (dictionary[value.replace(/\s+/g, ' ').trim()] || value) : value;
const i18n = {t: translate, useLanguage: () => ({language}), getLanguage: () => language, direction: () => language === 'en' ? 'ltr' : 'rtl'};
const pass = ({children}) => children, mock = new Proxy({}, {get: () => pass});
function library(filename) {
  if (libs.has(filename)) return libs.get(filename);
  const exports = {}; libs.set(filename, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {compilerOptions: compiler}).outputText, {exports, require: name => name.startsWith('.') ? library(path.join(path.dirname(filename), name) + '.ts') : name === 'react' ? React : nativeRequire(name), Date, Intl, console, crypto, URL, Promise, setTimeout, clearTimeout}, {filename});
  return exports;
}
/** A component file with real React, the translating i18n and the project's own libraries; sibling components are loaded for real, styles and UI primitives are pass-through mocks. */
function load(filename) {
  if (apps.has(filename)) return apps.get(filename);
  const exports = {}; apps.set(filename, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {compilerOptions: compiler}).outputText, {exports, require: name => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === '@/lib/i18n') return i18n;
    if (name.startsWith('@/lib/')) return library(name.replace('@/', '') + '.ts');
    if (name.startsWith('./') && !name.endsWith('.css') && fs.existsSync(path.join(root, 'app', name.slice(2) + '.tsx'))) return load('app/' + name.slice(2) + '.tsx');
    return mock;
  }, console, Date, Intl, crypto, URL, Promise, setTimeout, clearTimeout, window: undefined, navigator: undefined});
  return exports;
}
const W = library('lib/service-wording.ts');
const html = element => renderToStaticMarkup(element);
const arabicLeft = source => (source.replace(/<[^>]+>/g, ' ').match(/[؀-ۿ]+/g) || []);
const plain = source => source.replace(/<[^>]+>/g, ' ');

// ---- who reads the opportunity's words
eq(['customer_service', 'customer_service_manager', 'rep', 'supervisor', 'manager', 'admin', '', null, undefined].map(W.serviceWording), [true, true, false, false, false, false, false, false, false], 'customer service and its manager; nobody else');

// ---- the Arabic: the record is an opportunity, what was done in it is the contact
const arabic = [
  ['الزيارات', 'الفرص'], ['زيارة جديدة', 'فرصة جديدة'], ['سجل الزيارات', 'سجل الفرص'], ['زيارة / اتصال', 'فرصة / اتصال'], ['تسجيل زيارة', 'تسجيل فرصة'], ['تسجيل زيارة لهذا الطلب', 'تسجيل فرصة لهذا الطلب'],
  ['تفاصيل الزيارة #', 'تفاصيل الفرصة #'], ['تعديل الزيارة #', 'تعديل الفرصة #'], ['عرض / تعديل الزيارة', 'عرض / تعديل الفرصة'], ['حفظ الزيارة', 'حفظ الفرصة'], ['حذف الزيارة', 'حذف الفرصة'],
  ['الهدف من الزيارة *', 'الهدف من التواصل *'], ['اختر الهدف من الزيارة', 'اختر الهدف من التواصل'], ['الهدف الآخر من الزيارة', 'الهدف الآخر من التواصل'], ['نتيجة الزيارة', 'نتيجة التواصل'], ['اختر نتيجة الزيارة', 'اختر نتيجة التواصل'], ['تاريخ الزيارة', 'تاريخ التواصل'],
  ['رقم الزيارة', 'رقم الفرصة'], ['رقم الزيارة: ', 'رقم الفرصة: '], ['لوكيشن الزيارة التلقائي', 'لوكيشن التواصل التلقائي'], ['لوكيشن الزيارة', 'لوكيشن التواصل'], ['بداية الزيارة', 'بداية التواصل'], ['نهاية الزيارة', 'نهاية التواصل'], ['مدة الزيارة', 'مدة التواصل'], ['توقيت الزيارة', 'توقيت التواصل'],
  ['لا توجد زيارات سابقة لهذا العميل.', 'لا توجد فرص سابقة لهذا العميل.'], ['ترتيب الزيارات', 'ترتيب الفرص'], ['تعذر حفظ الزيارة. أعد المحاولة.', 'تعذر حفظ الفرصة. أعد المحاولة.'], ['للزيارة', 'للفرصة'], ['كل الزيارات', 'كل الفرص'], ['عرض الزيارات', 'عرض الفرص']
];
for (const role of ['customer_service', 'customer_service_manager']) for (const [from, to] of arabic) eq(W.serviceText(role, from), to, role + ': ' + from);
for (const role of ['rep', 'supervisor', 'manager', 'admin', '', null, undefined]) eq(arabic.map(([from]) => W.serviceText(role, from)), arabic.map(([from]) => from), 'for ' + JSON.stringify(role) + ' every phrase stays as it is');
eq(['العملاء', 'الشكاوى', 'متابعة العميل', '', 'تأكيد الإغلاق'].map(text => W.serviceText('customer_service', text)), ['العملاء', 'الشكاوى', 'متابعة العميل', '', 'تأكيد الإغلاق'], 'a phrase with no visit in it is left alone');
eq(arabic.every(([, to]) => W.serviceText('customer_service', to) === to), true, 'and the words are not rewritten twice');

// ---- the English
const english = [
  ['Visits', 'Opportunities'], ['New visit', 'New opportunity'], ['Visit history', 'Opportunity history'], ['Visits / contacts', 'Opportunities / contacts'], ['Log a visit', 'Log an opportunity'], ['Record a visit for this request', 'Record an opportunity for this request'],
  ['Visit purpose *', 'Contact purpose *'], ['Select the visit purpose', 'Select the contact purpose'], ['Other visit purpose', 'Other contact purpose'], ['Visit outcome', 'Contact outcome'], ['Visit date', 'Contact date'], ['Visit number', 'Opportunity number'], ['Visit ID:', 'Opportunity ID:'],
  ['Visit location', 'Contact location'], ['Visit duration', 'Contact duration'], ['Save visit', 'Save opportunity'], ['Visit details #', 'Opportunity details #'], ['The visit could not be saved. Retry.', 'The opportunity could not be saved. Retry.'], ['A visit can only be recorded here.', 'An opportunity can only be recorded here.']
];
for (const [from, to] of english) eq(W.serviceText('customer_service', from), to, 'English: ' + from);
eq(english.map(([from]) => W.serviceText('manager', from)), english.map(([from]) => from), 'and unchanged for sales');
eq(['Customers', 'Complaints', 'No complaints.'].map(text => W.serviceText('customer_service', text)), ['Customers', 'Complaints', 'No complaints.'], 'an English phrase with no visit is left alone');
eq(W.serviceWords('customer_service')('زيارة جديدة'), 'فرصة جديدة', 'the same function for one role, to hand to a component');

// ---- the English dictionary reads every one of them, and says the same
const toEnglish = text => dictionary[text.replace(/\s+/g, ' ').trim()] ?? text;
for (const [from, to] of arabic) {
  const once = toEnglish(W.serviceText('customer_service', from));
  const expected = W.serviceText('customer_service', toEnglish(from));
  if (dictionary[from.replace(/\s+/g, ' ').trim()] === undefined) continue; // phrases the screens write in pairs (Arabic, English) are not in the dictionary
  eq([once, /[؀-ۿ]/.test(once.replace(/[«»#]/g, ''))], [expected, false], 'the dictionary reads «' + to + '» as «' + expected + '»');
}

// ---- the components, for each role
const row = {id: 'visit-1', kind: 'activity', parentId: 'c-1', assignedTo: 'rep', branch: 'Main', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z', version: 1,
  data: {type: 'call', date: '2026-10-01', summary: 'Intro', result: 'Interested', visitNumber: 7, performedBy: 'rep', recordedByName: 'Rep One', startedAt: '2026-10-01T08:00:00.000Z', endedAt: '2026-10-01T08:10:00.000Z', location: '', salesStage: 'new'}};
const customer = {id: 'c-1', kind: 'customer', parentId: null, assignedTo: 'rep', branch: 'Main', createdAt: '2026-08-01T05:00:00.000Z', updatedAt: '2026-08-01T05:00:00.000Z', version: 2, data: {name: 'Factory One', region: 'الشرقية', city: 'Dammam', phone: '0551234567', contact: 'Abu Khalid'}};
const noop = () => {};
const {default: VisitsTable} = load('app/visits-table.tsx');
const table = role => html(React.createElement(VisitsTable, {rows: [row], customerFor: () => customer, onOpen: noop, onEdit: noop, onCustomer: noop, expanded: true, role, canEdit: true}));
let out = table('customer_service');
ok(['رقم الفرصة', 'الهدف من التواصل', 'نتيجة التواصل', 'لوكيشن التواصل', 'بداية التواصل', 'نهاية التواصل', 'مدة التواصل'].every(word => out.includes(word)), 'the list for customer service: opportunity number, and the contact\'s purpose, outcome, location, start, end and duration');
ok(!out.includes('رقم الزيارة') && !out.includes('الهدف من الزيارة') && !out.includes('نتيجة الزيارة') && !out.includes('سجل الزيارات'), 'with no visit word left in it');
ok(out.includes('سجل الفرص'), 'and the history says opportunities');
out = table('manager');
ok(['رقم الزيارة', 'الهدف من الزيارة', 'نتيجة الزيارة', 'لوكيشن الزيارة', 'بداية الزيارة', 'نهاية الزيارة', 'مدة الزيارة', 'سجل الزيارات'].every(word => out.includes(word)), 'for a sales manager the list is the visits list');
ok(!out.includes('رقم الفرصة') && !out.includes('الهدف من التواصل') && !out.includes('نتيجة التواصل') && !out.includes('سجل الفرص'), 'with no opportunity word in it');
const {CustomerVisitHistory} = load('app/customer-visits.tsx');
const history = role => html(React.createElement(CustomerVisitHistory, {customer, records: [customer, row], onVisit: noop, onNew: noop, canEdit: true, role}));
out = history('customer_service_manager');
ok(out.includes('سجل الفرص') && out.includes('فرصة / اتصال') && out.includes('ترتيب الفرص') && !out.includes('سجل الزيارات') && !out.includes('ترتيب الزيارات'), 'a customer\'s history in the words of customer service');
out = history('rep');
ok(out.includes('سجل الزيارات') && out.includes('زيارة / اتصال') && out.includes('ترتيب الزيارات') && !out.includes('الفرص'), 'and in the words of sales');
out = html(React.createElement(CustomerVisitHistory, {customer, records: [customer], onVisit: noop, onNew: noop, canEdit: true, role: 'customer_service'}));
ok(out.includes('لا توجد فرص سابقة لهذا العميل.'), 'with nothing yet, it says so in the same words');
// the page itself: its filters, heading, table and empty state
const {VisitsPage} = load('app/customer-visits.tsx');
const intake = {...row, id: 'intake-1', data: {...row.data, serviceIntakeId: 'svc-1', visitWorkflow: 'service-intake-v1', _serviceWorkflow: {id: 'svc-1', state: 'pending_approval', permissions: {approve: false, assign: false, delegate: false, reassign: false}, assistanceOpen: false}}};
const pageOf = (role, records = [customer, intake]) => html(React.createElement(VisitsPage, {records, members: [], query: '', staff: 'all', stage: 'all', workflow: 'all', onWorkflowFilter: noop, onWorkflow: noop, onOpen: noop, onNew: noop, onCustomer: noop, canEdit: true, role}));
out = pageOf('customer_service');
ok(out.includes('كل الفرص') && out.includes('سجل الفرص') && out.includes('كل فرصة مرتبطة بالعميل وسجله السابق'), 'the page of customer service: the filter, the heading and its line say opportunities');
ok(!out.includes('كل الزيارات') && !out.includes('سجل الزيارات') && !out.includes('كل زيارة مرتبطة') && !out.includes('رقم الزيارة') && !out.includes('تعديل الزيارة'), 'with no visit word left on it, the table and its cards included');
ok(out.includes('رقم الفرصة') && out.includes('عرض / تعديل الفرصة'), 'the table and the card button inside it follow');
out = pageOf('customer_service_manager');
ok(out.includes('كل الفرص') && out.includes('سجل الفرص'), 'the manager of customer service reads the same page');
out = pageOf('manager');
ok(out.includes('كل الزيارات') && out.includes('سجل الزيارات') && out.includes('كل زيارة مرتبطة بالعميل وسجله السابق') && !out.includes('كل الفرص') && !out.includes('سجل الفرص') && !out.includes('رقم الفرصة') && !out.includes('تعديل الفرصة'), 'a sales manager\'s page keeps the visits (the opportunity\'s strength is a sales column and stays)');
out = pageOf('customer_service', [customer]);
ok(out.includes('لا توجد فرص مسجلة') && out.includes('فرصة جديدة') && !out.includes('زيارة'), 'with nothing yet, customer service is told so, and offered a new opportunity');
out = pageOf('rep', [customer]);
ok(out.includes('لا توجد زيارات مسجلة') && out.includes('زيارة جديدة') && !out.includes('فرص'), 'and a representative a new visit');
const {default: VisitFields} = load('app/visit-fields.tsx');
const fields = (role, over = {}) => html(React.createElement(VisitFields, {unified: true, service: role.startsWith('customer_service'), role, data: {type: 'call', date: '2026-10-01', summary: '', result: '', location: '', ...over}, parentId: 'c-1', records: [customer], editing: false, busy: false, email: 'x@yourrest.org', onChange: noop, onParent: noop}));
out = fields('customer_service');
ok(out.includes('الهدف من التواصل *') && out.includes('نتيجة التواصل') && !out.includes('الهدف من الزيارة') && !out.includes('نتيجة الزيارة'), 'the form for customer service asks for the contact\'s purpose and outcome');
out = fields('rep');
ok(out.includes('الهدف من الزيارة *') && out.includes('نتيجة الزيارة') && !out.includes('التواصل *'), 'and the form for a representative for the visit\'s');
out = html(React.createElement(VisitFields, {unified: true, service: true, role: 'customer_service', data: {type: 'call', date: '2026-10-01', summary: 'x', result: 'y', location: '', visitNumber: 12}, parentId: 'c-1', records: [customer], editing: true, busy: false, email: 'x@yourrest.org', onChange: noop, onParent: noop}));
ok(out.includes('رقم الفرصة: ') && !out.includes('رقم الزيارة'), 'a saved record shows its opportunity number');
const MobileNavigation = load('app/mobile-navigation.tsx').default;
const bar = (role, over = {}) => html(React.createElement(MobileNavigation, {me: {id: role, userId: 'u', email: role + '@yourrest.org', name: role, role, branch: 'Main', supervisorId: '', regionScope: 'all', active: 1, target: 0}, view: 'activity', onNavigate: noop, accountOpen: false, onAccountOpenChange: noop, ...over}));
out = bar('customer_service');
ok(/data-page="activity"[^]*?الفرص/.test(out) && !out.includes('الزيارات'), 'the bottom bar of customer service says Opportunities');
ok(/data-page="activity"[^]*?الزيارات/.test(bar('rep')) && !bar('rep').includes('الفرص'), 'and that of a representative Visits');

// ---- English: the opportunity's words, with no Arabic left behind
language = 'en';
out = table('customer_service');
ok(['Opportunity number', 'Contact purpose', 'Contact outcome', 'Contact location', 'Contact duration', 'Opportunity history'].every(word => out.includes(word)) && !/\bVisit\b/.test(out.replace(/<[^>]+>/g, ' ').replace(/Visit details/g, '')), 'the English list for customer service');
eq(arabicLeft(table('customer_service')).filter(word => /زيار|فرص|تواصل/.test(word)), [], 'with no Arabic visit word');
out = history('customer_service');
ok(out.includes('Opportunity history') && out.includes('Opportunities / contacts'), 'the English history');
out = fields('customer_service');
ok(out.includes('Contact purpose *') && out.includes('Contact outcome') && !out.includes('Visit purpose'), 'the English form');
out = bar('customer_service_manager');
ok(/data-page="activity"[^]*?Opportunities/.test(out) && !out.includes('Visits'), 'the English bottom bar');
out = pageOf('customer_service');
ok(out.includes('All opportunities') && out.includes('Opportunity history') && out.includes('Every opportunity is linked to the customer and their history') && out.includes('Opportunity number'), 'the English page of customer service');
eq(arabicLeft(out).filter(word => /زيار|فرص|تواصل/.test(word)), [], 'with no Arabic visit word');
ok(!/\bvisits?\b/i.test(plain(out).replace(/Visit details/g, '')), 'and no English visit word either');
out = pageOf('customer_service', [customer]);
ok(out.includes('No opportunities recorded') && out.includes('New opportunity'), 'its empty state in English');
out = pageOf('rep');
ok(out.includes('All visits') && out.includes('Visit history') && !/All opportunities|Opportunity history|Opportunity number|Contact purpose/.test(out), 'a representative\'s page keeps the visits in English');
out = fields('manager');
ok(out.includes('Visit purpose *') && out.includes('Visit outcome'), 'sales keep the visit in English too');
language = 'ar';
console.log(JSON.stringify({ok: true, checks, scope: 'the words of customer service for visits (Arabic and English, every phrase of the screens), the dictionary, and the list, the history, the form and the bottom bar for each role', realBrowser: false}));

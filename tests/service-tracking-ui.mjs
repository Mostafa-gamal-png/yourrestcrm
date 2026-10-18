// The tracking board and its stage bar rendered from the real source: the board each customer-service role sees at the top of the
// Opportunities page (heading, the five filters with their counts, the cards with their stage bar, who holds each item and for how long,
// the late mark, the last thing recorded, the finished ones), the filter and the "show all" control, the empty and loading states, the bar
// inside a sheet, and the callbacks of the buttons, in Arabic and in English. Render and interaction contracts only: no browser, no
// network, no production data. (The real clicks and the data from the server are exercised in tests/service-queue-browser.mjs.)
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
const i18n = {t: value => language === 'en' && typeof value === 'string' ? (dictionary[value] || value) : value, useLanguage: () => ({language}), getLanguage: () => language, direction: () => language === 'en' ? 'ltr' : 'rtl'};
const pass = ({children}) => children, mock = new Proxy({}, {get: () => pass});
function library(filename) {
  if (libs.has(filename)) return libs.get(filename);
  const exports = {}; libs.set(filename, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {compilerOptions: compiler}).outputText, {exports, require: name => name.startsWith('.') ? library(path.join(path.dirname(filename), name) + '.ts') : name === 'react' ? React : nativeRequire(name), Date, Intl, console, crypto, URL, Promise, setTimeout, clearTimeout}, {filename});
  return exports;
}
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
/** Run function components so the whole host-element tree can be inspected. */
function expand(node) {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expand);
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return {...node, props: {...node.props, children: expand(node.props?.children)}};
}
function nodes(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(item => nodes(item, predicate)); return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)]; }
function text(tree) { if (tree == null || typeof tree === 'boolean') return ''; if (typeof tree !== 'object') return String(tree); return Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children); }
const T = library('lib/service-tracking.ts');
const {TrackingBoardView, ServiceTrackingBoard, TrackingSteps, TrackingSheetSteps, TRACKING_VISIBLE} = load('app/service-tracking.tsx');
const html = element => renderToStaticMarkup(element);
const count = (source, part) => source.split(part).length - 1;
const plain = source => source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const arabicLeft = source => (plain(source).match(/[؀-ۿ]+/g) || []);
const noop = () => {};
const BASE = Date.now(), NOW = new Date(BASE).toISOString(), hoursAgo = hours => new Date(BASE - hours * 3600000).toISOString();

// ---- fixtures: the same shapes the routes return. Each item has its own registration time so that the order never depends on a tie.
const progress = (o = {}) => ({stage: 'approval', since: hoursAgo(3), stageHours: 3, targetHours: 4, late: false, assigneeRole: '', finishedAt: '', ...o});
const opportunity = (o = {}) => ({id: 'service-1', state: 'pending_approval', creatorId: 'rep-1', creatorName: 'Reem', serviceManagerName: 'Mona', salesManagerName: 'Khaled', assignedName: '', createdAt: hoursAgo(30), updatedAt: hoursAgo(30), data: {products: ['Molds'], needs: 'Mold for 500 g boxes', delegatedAt: ''}, customer: {id: 'c-1', name: 'Al Amal Plastics'}, progress: progress(), contacts: [], history: [], ...o});
const complaint = (o = {}) => ({id: 'complaint-1', customerId: 'c-2', customerName: 'Al Noor Factory', complaintNumber: 7, category: 'product_quality', severity: 'normal', description: 'A block comes out broken', status: 'submitted', stage: 'review', stageSince: hoursAgo(3), stageHours: 3, targetHours: 4, late: false, createdAt: hoursAgo(30), updatedAt: hoursAgo(30), registrarId: 'rep-1', registrarName: 'Reem', serviceManagerName: 'Mona', salesManagerName: 'Khaled', assigneeName: '', assigneeRole: '', events: [], updates: [], notes: [], closure: null, ...o});
const cases = [
  opportunity({id: 'o-late', createdAt: hoursAgo(30), progress: progress({stage: 'assignment', late: true, stageHours: 9})}),
  opportunity({id: 'o-follow', assignedName: 'Salem', createdAt: hoursAgo(80), progress: progress({stage: 'follow_up', stageHours: 40, targetHours: null, assigneeRole: 'rep'}), data: {products: ['Molds', 'Maintenance services'], needs: '', delegatedAt: hoursAgo(60)}, contacts: [{createdAt: hoursAgo(10), result: 'Customer asked for a quote', actor: 'Salem'}]}),
  opportunity({id: 'o-won', state: 'won', createdAt: hoursAgo(100), progress: progress({stage: 'closed', finishedAt: hoursAgo(48)})}),
  opportunity({id: 'o-new-1', createdAt: hoursAgo(26)}),
  opportunity({id: 'o-new-2', createdAt: hoursAgo(20), progress: progress({stageHours: 2})})
];
const complaints = [
  complaint({id: 'k-review', createdAt: hoursAgo(28)}),
  complaint({id: 'k-resolution', createdAt: hoursAgo(60), stage: 'resolution', stageHours: 20, targetHours: 50, assigneeName: 'Salem', assigneeRole: 'rep', severity: 'high', updates: [{at: hoursAgo(5), byName: 'Salem', text: 'Visited the factory'}]}),
  complaint({id: 'k-closed', createdAt: hoursAgo(90), status: 'closed', stage: 'closed', stageSince: hoursAgo(72), closure: {outcome: 'satisfied'}, registrarId: 'rep-2', registrarName: 'Huda'}),
  complaint({id: 'k-old', createdAt: hoursAgo(70), complaintNumber: null, category: 'delivery_delay', stage: 'closure', stageHours: 30, targetHours: 24, late: true})
];
const rep = {id: 'rep-1', role: 'customer_service', name: 'Reem'}, manager = {id: 'csm-1', role: 'customer_service_manager', name: 'Mona'};
const board = who => T.trackingItems({me: who, cases, complaints});
const keysOf = markup => [...markup.matchAll(/data-tracking-card="([^"]+)"/g)].map(m => m[1]);
const cardOf = (markup, key) => { const start = markup.indexOf('data-tracking-card="' + key + '"'), next = markup.indexOf('data-tracking-card=', start + 10); return markup.slice(start, next < 0 ? undefined : next); };
// the order the board gives a representative: the late first (the longer wait first), then the open by wait, then the finished
const REP_ORDER = ['complaint:k-old', 'opportunity:o-late', 'opportunity:o-follow', 'complaint:k-resolution', 'opportunity:o-new-1', 'complaint:k-review', 'opportunity:o-new-2', 'opportunity:o-won'];
const MANAGER_ORDER = [...REP_ORDER, 'complaint:k-closed'];

// ---- the stage bar
{
  language = 'ar';
  const view = items => html(React.createElement(TrackingSteps, {item: items, say: (ar, en) => language === 'en' ? en : ar}));
  const opp = T.trackedOpportunity(opportunity({progress: progress({stage: 'assignment'})}));
  const markup = view(opp);
  ok(markup.includes('class="tracking-steps"') && markup.includes('data-layout="card"'), 'the bar is an ordered list for a card');
  eq(count(markup, '<li '), 6, 'six steps for an opportunity');
  eq([...markup.matchAll(/data-step="([a-z_]+)" data-state="([a-z]+)"/g)].map(m => m[1] + ':' + m[2]), ['registered:done', 'approval:done', 'assignment:current', 'first_contact:upcoming', 'follow_up:upcoming', 'finished:upcoming'], 'registered and approval done, assignment current');
  ok(markup.includes('aria-current="step"'), 'the current step is announced');
  ok(markup.includes('تسجيل') && markup.includes('اعتماد خدمة العملاء') && markup.includes('تكليف المبيعات') && markup.includes('أول تواصل') && markup.includes('متابعة') && markup.includes('فوز أو فقد'), 'each step is named in Arabic');
  ok(markup.includes('class="sr-only"') && markup.includes('(تمّت)') && markup.includes('(المرحلة الحالية)') && markup.includes('(لاحقة)'), 'each step says its state to a screen reader');
  ok(!markup.includes('data-returned'), 'nothing is marked returned');
  const returned = view(T.trackedOpportunity(opportunity({progress: progress({stage: 'returned'})})));
  ok(/data-step="approval" data-state="current" data-returned="true"/.test(returned), 'a returned item marks its current step');
  const done = view(T.trackedOpportunity(opportunity({state: 'won', progress: progress({stage: 'closed', finishedAt: NOW})})));
  eq(count(done, 'data-state="done"'), 6, 'a finished opportunity has every step done');
  ok(done.includes('تم الفوز') && !done.includes('فوز أو فقد'), 'and its last step says how it ended');
  ok(view(T.trackedOpportunity(opportunity({state: 'lost', progress: progress({stage: 'closed', finishedAt: NOW})}))).includes('تم الفقد'), 'lost reads lost');
  eq(view(T.trackedComplaint(complaint({status: 'cancelled', stage: 'cancelled'}))), '', 'a cancelled complaint has no bar');
  const delegated = view(T.trackedComplaint(complaint({stage: 'delegation', assigneeName: 'Sami', assigneeRole: 'supervisor'})));
  ok(delegated.includes('data-step="delegation" data-state="current"') && delegated.includes('تفويض المشرف'), 'a complaint with a supervisor shows the delegation step');
  ok(html(React.createElement(TrackingSteps, {item: opp, say: (ar) => ar, layout: 'sheet'})).includes('data-layout="sheet"'), 'the sheet lays the bar out as a list on a phone');
  language = 'en';
  const english = view(opp);
  ok(english.includes('Registered') && english.includes('Service approval') && english.includes('Sales assignment') && english.includes('First contact') && english.includes('Follow-up') && english.includes('Won or lost') && english.includes('(current stage)'), 'English names every step');
  eq(arabicLeft(english), [], 'and leaves no Arabic');
  ok(view(T.trackedOpportunity(opportunity({state: 'won', progress: progress({stage: 'closed', finishedAt: NOW})}))).includes('Won'), 'a won opportunity reads Won');
  language = 'ar';
}

// ---- the board of a representative
{
  language = 'ar';
  const items = board(rep), render = expanded => html(React.createElement(TrackingBoardView, {items, filter: 'all', onFilter: noop, expanded, onExpand: noop, role: rep.role, loaded: true, onOpen: noop}));
  eq(items.map(item => item.key), REP_ORDER, 'the fixture gives a representative eight items in the board\'s order');
  const markup = render(false);
  ok(markup.includes('class="tracking-board panel"') && markup.includes('data-role="customer_service"') && markup.includes('dir="rtl"'), 'the board is a panel, right to left');
  ok(markup.includes('متابعة ما سجّلته') && !markup.includes('متابعة ما سجّله فريقك'), 'the representative\'s heading');
  ok(plain(markup).includes('أين وصلت، ومن يحملها الآن، ومنذ متى') && plain(markup).includes('ولا تدخل في التقييم'), 'and the line that says the figures feed no evaluation');
  eq([...markup.matchAll(/data-filter="([a-z]+)"[^>]*aria-pressed="(true|false)">([^<]*)<span class="tracking-count">(\d+)/g)].map(m => [m[1], m[2], m[3].trim(), m[4]]), [['all', 'true', 'الكل', '8'], ['late', 'false', 'متأخرة', '2'], ['service', 'false', 'عند خدمة العملاء', '4'], ['sales', 'false', 'عند المبيعات', '3'], ['finished', 'false', 'منتهية (30 يومًا)', '1']], 'five filters with their counts, the first pressed');
  ok(/data-filter="late" data-late-tab="true"/.test(markup), 'the late tab is marked when something is late');
  eq(keysOf(markup), REP_ORDER.slice(0, TRACKING_VISIBLE), 'six cards until the rest is asked for');
  ok(markup.includes('عرض الكل (8)') && markup.includes('aria-expanded="false"'), 'and a button to show all eight');
  ok(!markup.includes('سجّلها: '), 'a representative\'s cards do not name the registrar: it is them');
  const late = cardOf(markup, 'opportunity:o-late');
  ok(/data-side="sales"/.test(late) && /data-late="true"/.test(late) && /data-stage="assignment"/.test(late) && /data-kind="opportunity"/.test(late), 'the late opportunity waits on sales at assignment');
  ok(plain(late).includes('فرصة') && plain(late).includes('Al Amal Plastics') && plain(late).includes('بانتظار تكليف المبيعات'), 'it names its kind, customer and stage');
  ok(plain(late).includes('Molds') && plain(late).includes('Mold for 500 g boxes'), 'its products and need');
  ok(plain(late).includes('عند: Khaled (مدير المبيعات) · منذ 9 ساعة عمل'), 'with who holds it and for how long');
  ok(plain(late).includes('متأخر عن هدف 4 ساعات عمل'), 'and the late mark with its target');
  ok(plain(late).includes('فتح الفرصة') && !plain(late).includes('فتح الشكوى'), 'a button to open the opportunity');
  const follow = cardOf(markup, 'opportunity:o-follow');
  eq(count(follow, '<li '), 7, 'an opportunity that passed a supervisor shows the delegation step');
  ok(plain(follow).includes('Molds · Maintenance services') && plain(follow).includes('عند: Salem (مندوب المبيعات) · منذ 40 ساعة عمل') && !plain(follow).includes('متأخر'), 'its products, its holder, and no late mark where the stage has no target');
  ok(plain(follow).includes('آخر ما سُجّل: تواصل') && plain(follow).includes('Salem: Customer asked for a quote'), 'and the last contact recorded');
  const cmp = cardOf(markup, 'complaint:k-resolution');
  ok(/data-kind="complaint"/.test(cmp) && /data-severity="high"/.test(cmp) && /data-side="sales"/.test(cmp), 'a complaint card, high, with sales');
  ok(plain(cmp).includes('شكوى') && plain(cmp).includes('#7') && plain(cmp).includes('جودة المنتج أو القالب') && plain(cmp).includes('A block comes out broken'), 'with its number, category and description');
  ok(plain(cmp).includes('عند: Salem (مندوب المبيعات) · منذ 20 ساعة عمل') && plain(cmp).includes('قيد الحل مع المندوب'), 'held by the representative for twenty working hours');
  ok(plain(cmp).includes('آخر ما سُجّل: تحديث') && plain(cmp).includes('Visited the factory'), 'and the last update recorded');
  ok(plain(cmp).includes('فتح الشكوى') && !plain(cmp).includes('فتح الفرصة'), 'a button to open the complaint');
  const all = render(true);
  eq(keysOf(all), REP_ORDER, 'expanded shows every card, in the board\'s order');
  ok(all.includes('عرض أقل') && all.includes('aria-expanded="true"'), 'and offers fewer');
  const old = cardOf(all, 'complaint:k-old');
  ok(!plain(old).includes('#') && plain(old).includes('التأخر في التسليم') && plain(old).includes('عند: Reem (خدمة العملاء)') && plain(old).includes('بانتظار تأكيد الإغلاق مع العميل') && /data-side="service"/.test(old), 'a complaint from before numbering shows no number, and waits on its registrar for the closure');
  ok(plain(old).includes('متأخر عن هدف 24 ساعات عمل'), 'late against the closure target');
  const won = cardOf(all, 'opportunity:o-won'), date = new Date(hoursAgo(48)).toLocaleDateString('en-GB', {timeZone: 'Asia/Riyadh'});
  ok(plain(won).includes('انتهت ' + date) && plain(won).includes('تم الفوز') && /data-side="done"/.test(won) && /data-late="false"/.test(won), 'a finished opportunity says when it finished and how, and is not late');
  eq(count(won, '<li '), 6, 'its bar is complete');
  ok(!plain(won).includes('عند: '), 'and it has no holder');
}

// ---- the board of a manager
{
  language = 'ar';
  const items = board(manager), markup = html(React.createElement(TrackingBoardView, {items, filter: 'all', onFilter: noop, expanded: true, onExpand: noop, role: manager.role, loaded: true, onOpen: noop}));
  ok(markup.includes('متابعة ما سجّله فريقك وما سجّلته'), 'the manager\'s heading');
  ok(plain(markup).includes('سجّلها: Huda') && plain(markup).includes('سجّلها: Reem'), 'a manager\'s cards name who registered each item');
  eq(keysOf(markup), MANAGER_ORDER, 'every item the routes gave them, in the same order plus the complaint a colleague registered and closed');
  ok(/data-filter="all"[^>]*aria-pressed="true">[^<]*<span class="tracking-count">9<\/span>/.test(markup) && /data-filter="finished"[^>]*aria-pressed="false">[^<]*<span class="tracking-count">2<\/span>/.test(markup), 'nine on the board, two finished');
  const closed = cardOf(markup, 'complaint:k-closed');
  ok(plain(closed).includes('العميل راضٍ') && plain(closed).includes('سجّلها: Huda'), 'a closed complaint says how it closed and who registered it');
}

// ---- filters
{
  language = 'ar';
  const items = board(manager), render = filter => html(React.createElement(TrackingBoardView, {items, filter, onFilter: noop, expanded: true, onExpand: noop, role: manager.role, loaded: true, onOpen: noop}));
  eq(keysOf(render('late')), ['complaint:k-old', 'opportunity:o-late'], 'the late filter shows the late ones, the longer wait first');
  ok(/data-filter="late"[^>]*aria-pressed="true"/.test(render('late')) && /data-filter="all"[^>]*aria-pressed="false"/.test(render('late')), 'and presses its tab');
  eq(keysOf(render('service')), ['complaint:k-old', 'opportunity:o-new-1', 'complaint:k-review', 'opportunity:o-new-2'], 'with customer service: the late first, then the longest waiting, then the newest');
  eq(keysOf(render('sales')), ['opportunity:o-late', 'opportunity:o-follow', 'complaint:k-resolution'], 'with sales');
  eq(keysOf(render('finished')), ['opportunity:o-won', 'complaint:k-closed'], 'finished, the latest first');
  const empty = html(React.createElement(TrackingBoardView, {items: items.filter(item => item.side !== 'sales'), filter: 'sales', onFilter: noop, expanded: false, onExpand: noop, role: manager.role, loaded: true, onOpen: noop}));
  ok(plain(empty).includes('لا شيء في هذا التصنيف.') && count(empty, 'data-tracking-card=') === 0 && !empty.includes('عرض الكل'), 'a filter with nothing in it says so');
}

// ---- empty and loading
{
  language = 'ar';
  const render = (items, loaded) => html(React.createElement(TrackingBoardView, {items, filter: 'all', onFilter: noop, expanded: false, onExpand: noop, role: rep.role, loaded, onOpen: noop}));
  ok(plain(render([], true)).includes('لا فرص ولا شكاوى ولا طلبات مساندة بعد'), 'nothing registered: the board says so and explains');
  ok(plain(render([], false)).includes('جارٍ تحميل المتابعة'), 'not loaded yet: the board says it is loading');
  ok(/data-filter="all"[^>]*aria-pressed="true">[^<]*<span class="tracking-count">0<\/span>/.test(render([], true)), 'the filters still show, at zero');
  ok(!render([], true).includes('عرض الكل'), 'and no "show all" with nothing to show');
}

// ---- who gets the board
{
  language = 'ar';
  const render = (who, loaded = cases) => html(React.createElement(ServiceTrackingBoard, {me: who, cases: loaded, complaints, onOpenCase: noop, onOpenComplaint: noop}));
  eq(keysOf(render(rep)), REP_ORDER.slice(0, TRACKING_VISIBLE), 'a representative: the first six of the eight they registered');
  eq(keysOf(render(manager)), MANAGER_ORDER.slice(0, TRACKING_VISIBLE), 'a manager: the first six of the nine');
  eq([render({id: 'a', role: 'admin'}), render({id: 'r', role: 'rep'}), render({id: 'm', role: 'manager'})], ['', '', ''], 'no board for an administrator or a sales member');
  eq(keysOf(render(rep, null)), ['complaint:k-old', 'complaint:k-resolution', 'complaint:k-review'], 'before the cases load, the representative\'s complaints already show');
  ok(render(rep, null).includes('class="tracking-board panel"'), 'and the board is there');
}

// ---- the callbacks of the controls
{
  language = 'ar';
  const items = board(rep), calls = [];
  const tree = expand(React.createElement(TrackingBoardView, {items, filter: 'all', onFilter: filter => calls.push(['filter', filter]), expanded: false, onExpand: value => calls.push(['expand', value]), role: rep.role, loaded: true, onOpen: item => calls.push(['open', item.key])}));
  const tabs = nodes(tree, node => node.type === 'button' && node.props?.['data-filter']);
  eq(tabs.map(tab => tab.props['data-filter']), ['all', 'late', 'service', 'sales', 'finished'], 'five tab buttons');
  tabs[1].props.onClick(); tabs[4].props.onClick();
  nodes(tree, node => node.type === 'button' && /tracking-more/.test(node.props?.className || ''))[0].props.onClick();
  const openers = nodes(tree, node => node.type === 'button' && /فتح/.test(text(node)));
  eq(openers.length, TRACKING_VISIBLE, 'one open button on each card shown');
  openers[0].props.onClick(); openers[1].props.onClick();
  eq(calls, [['filter', 'late'], ['filter', 'finished'], ['expand', true], ['open', 'complaint:k-old'], ['open', 'opportunity:o-late']], 'the tabs, "show all" and the open buttons call back with what was chosen');
  eq(openers.map(button => button.props.type), Array(openers.length).fill('button'), 'every button is a plain button, never a submit');
}

// ---- the bar inside a sheet
{
  language = 'ar';
  const sheet = (item, caption) => html(React.createElement(TrackingSheetSteps, {item, caption}));
  const opp = T.trackedOpportunity(opportunity({progress: progress({stage: 'assignment', late: true, stageHours: 6})}));
  const withCaption = sheet(opp, true);
  ok(withCaption.includes('class="tracking-sheet-steps"') && plain(withCaption).includes('أين وصلت') && withCaption.includes('data-layout="sheet"'), 'the sheet names the section and lays the bar out for a sheet');
  ok(plain(withCaption).includes('عند: Khaled (مدير المبيعات) · منذ 6 ساعة عمل') && plain(withCaption).includes('متأخر عن هدف 4 ساعات عمل'), 'a caption says who holds it, for how long, and that it is late');
  ok(!plain(sheet(opp, false)).includes('عند: '), 'without the caption the bar stands alone');
  eq(sheet(T.trackedComplaint(complaint({status: 'cancelled', stage: 'cancelled'})), true), '', 'a cancelled complaint has no section');
  ok(!plain(sheet(T.trackedOpportunity(opportunity({state: 'won', progress: progress({stage: 'closed', finishedAt: NOW})})), true)).includes('عند: '), 'a finished item has no holder line');
  language = 'en';
  const english = sheet(opp, true);
  ok(plain(english).includes('Where it stands') && plain(english).includes('With: Khaled (sales manager) · for 6 working hours') && plain(english).includes('Late against a 4-working-hour target'), 'English');
  eq(arabicLeft(english), [], 'without Arabic');
  language = 'ar';
}

// ---- English
{
  language = 'en';
  const items = board(manager), markup = html(React.createElement(TrackingBoardView, {items, filter: 'all', onFilter: noop, expanded: true, onExpand: noop, role: manager.role, loaded: true, onOpen: noop}));
  ok(markup.includes('dir="ltr"'), 'left to right');
  ok(plain(markup).includes('Tracking what your team and you registered') && plain(markup).includes('feed no evaluation'), 'the heading and the line that says it feeds no evaluation');
  ok(['All', 'Late', 'With customer service', 'With sales', 'Finished (30 days)'].every(label => plain(markup).includes(label)), 'the five filters');
  ok(plain(markup).includes('Opportunity') && plain(markup).includes('Complaint') && plain(markup).includes('#7') && plain(markup).includes('Product or mold quality'), 'the kinds and the category');
  ok(plain(markup).includes('With: Khaled (sales manager) · for 9 working hours'), 'who holds it and for how long');
  ok(plain(markup).includes('Late against a 4-working-hour target') && plain(markup).includes('Open the opportunity') && plain(markup).includes('Open the complaint'), 'the late mark and the buttons');
  ok(plain(markup).includes('Finished') && plain(markup).includes('Customer satisfied') && plain(markup).includes('Won'), 'finished items and how they ended');
  ok(plain(markup).includes('by Huda') && plain(markup).includes('Registered'), 'the registrar and the date');
  ok(plain(markup).includes('Last recorded: Update') && plain(markup).includes('Customer asked for a quote'), 'the last thing recorded');
  eq(arabicLeft(markup), [], 'English leaves no Arabic');
  const rep2 = html(React.createElement(TrackingBoardView, {items: [], filter: 'all', onFilter: noop, expanded: false, onExpand: noop, role: rep.role, loaded: true, onOpen: noop}));
  ok(plain(rep2).includes('Tracking what you registered') && plain(rep2).includes('No opportunities, complaints or assistance requests yet'), 'the representative\'s English heading and empty line');
  eq(arabicLeft(rep2), [], 'without Arabic');
  language = 'ar';
}

// ---- assistance requests and missed visits on the board
{
  language = 'ar';
  const SP = library('lib/support.ts');
  const hours = n => new Date(BASE - n * 3600000).toISOString();
  const event = (action, at, byName, extra = {}) => ({at, by: byName, byName, action, targetName: '', ...extra});
  const request = (o = {}) => ({
    id: 'support-1', customerId: 'c-3', customerName: 'Al Rayyan Factory', origin: 'rep', state: 'in_progress', status: 'open', note: 'The customer does not answer our representative', plan: null, requestedByName: 'Mohammed',
    handlerId: 'rep-1', handlerName: 'Reem', serviceManagerName: 'Mona', salesManagerName: 'Khaled', assigneeName: '', assigneeRole: '', result: null, resolution: null,
    stage: 'contact', stageSince: hours(3), stageHours: 3, targetHours: 4, late: false, createdAt: hours(40), updatedAt: hours(3), events: [], ...o
  });
  const supports = [
    request({id: 's-contact', createdAt: hours(30), events: [event('request', hours(30), 'Mohammed', {text: 'The customer does not answer our representative'}), event('assign', hours(30), '', {targetName: 'Reem'})]}),
    request({id: 's-review', state: 'submitted', status: 'submitted', stage: 'review', stageHours: 6, targetHours: 4, late: true, createdAt: hours(50), result: {outcome: 'reached_interested', note: 'Interested in an offer'}, events: [event('request', hours(50), 'Mohammed'), event('submit', hours(8), 'Reem', {outcome: 'reached_interested', text: 'Interested in an offer'})]}),
    request({id: 's-sales', origin: 'missed_visit', note: '', plan: {visitId: 'v-1', visitDate: '2026-10-01', result: 'x', nextAction: 'Follow-up visit', nextDate: '2026-10-05'}, state: 'assigned', status: 'assigned', stage: 'first_contact', stageHours: 14, targetHours: 24, assigneeName: 'Salem', assigneeRole: 'rep', createdAt: hours(70), events: [event('request', hours(70), 'Reem'), event('submit', hours(60), 'Reem', {outcome: 'no_answer', text: 'No reply after three tries'}), event('forward', hours(50), 'Mona', {targetName: 'Khaled'}), event('allocate', hours(40), 'Khaled', {targetName: 'Salem', text: 'Visit this week'}), event('seen', hours(35), 'Salem')]}),
    request({id: 's-closure', state: 'resolved', status: 'resolved', stage: 'closure', stageHours: 2, targetHours: 24, assigneeName: 'Salem', assigneeRole: 'rep', createdAt: hours(90), result: {outcome: 'reached_interested', note: 'x'}, resolution: {outcome: 'wants_visit', note: 'Wants a visit', channel: 'call'}, events: [event('request', hours(90), 'Mohammed'), event('resolve', hours(2), 'Salem', {outcome: 'wants_visit', text: 'Wants a visit'})]}),
    request({id: 's-done', state: 'done', status: 'done', stage: 'closed', stageSince: hours(48), stageHours: 0, targetHours: null, createdAt: hours(120), assigneeName: 'Salem', assigneeRole: 'rep', resolution: {outcome: 'reached_interested', note: 'ok', channel: 'visit'}, events: [event('request', hours(120), 'Mohammed'), event('close', hours(48), 'Reem', {text: 'Reviewed'})]}),
    request({id: 's-other', handlerId: 'rep-2', handlerName: 'Huda', createdAt: hours(33)}),
    request({id: 's-untaken', handlerId: '', handlerName: '', state: 'waiting', stage: 'take', createdAt: hours(10)})
  ];
  const mineRows = T.trackingItems({me: rep, cases: [], complaints: [], support: supports});
  eq(mineRows.map(item => item.key), ['support:s-review', 'support:s-sales', 'support:s-contact', 'support:s-closure', 'support:s-done'], 'a representative: only what they took, the late first, then by wait, then the finished');
  const teamRows = T.trackingItems({me: manager, cases: [], complaints: [], support: supports});
  eq(teamRows.length, 7, 'a manager: every request the route gave them, taken or not');
  const render = (items, role = rep.role) => html(React.createElement(TrackingBoardView, {items, filter: 'all', onFilter: noop, expanded: true, onExpand: noop, role, loaded: true, onOpen: noop}));
  let markup = render(mineRows);
  eq(keysOf(markup), [...mineRows.map(item => item.key)], 'one card per request');
  ok(plain(markup).includes('وطلبات المساندة والزيارات المفقودة التي تولّيتها') && plain(markup).includes('وما سُجّل في كل مرحلة'), 'the heading line says the board also follows assistance requests and what each stage recorded');
  const review = cardOf(markup, 'support:s-review');
  ok(/data-kind="support"/.test(review) && /data-stage="review"/.test(review) && /data-side="service"/.test(review) && /data-late="true"/.test(review), 'a request waiting for the manager\'s review is with customer service and late');
  ok(review.includes('مساندة') && review.includes('بانتظار مراجعة المدير') && review.includes('Al Rayyan Factory') && review.includes('The customer does not answer our representative'), 'the card names the kind, the stage, the customer and the reason');
  ok(review.includes('Mona') && review.includes('مدير خدمة العملاء') && review.includes('متأخر عن هدف 4 ساعات عمل'), 'the manager holds it, and the late mark says against which target');
  eq(count(review, 'data-step='), 6, 'the bar has the six steps of a request');
  ok(review.includes('فتح الطلب') && review.includes('تواصل خدمة العملاء') && review.includes('مراجعة المدير') && review.includes('تكليف المبيعات') && review.includes('أول تواصل') && review.includes('الإغلاق'), 'named for a request, the first step as the opening');
  ok(review.includes('class="tracking-trail"') && review.includes('رفع نتيجة التواصل للاعتماد') && review.includes('تم التواصل والعميل مهتم') && review.includes('Interested in an offer'), 'what the stage recorded is on the card: the submission, its outcome and its words');
  ok(!review.includes('tracking-last'), 'the trail replaces the single last line');
  ok(review.includes('فتح الطلب') && /data-tracking-open|class="btn subtle"/.test(review), 'and a button to open the request');
  const sales = cardOf(markup, 'support:s-sales');
  ok(sales.includes('زيارة مفقودة') && sales.includes('Follow-up visit · 2026-10-05') && sales.includes('بانتظار تواصل المندوب مع العميل') && /data-side="sales"/.test(sales), 'a missed visit with sales reads its planned visit, and says the representative is to contact the customer');
  ok(sales.includes('Salem') && sales.includes('مندوب المبيعات') && sales.includes('تكليف المبيعات') && sales.includes('Visit this week') && sales.includes('اعتماد وإحالة إلى مدير المبيعات'), 'the representative holds it, and the trail tells the approval and the assignment with its note');
  ok(!sales.includes('الاطلاع على الرد'), 'opening the answer is not a step of the story');
  const contactCard = cardOf(markup, 'support:s-contact');
  ok(contactCard.includes('قيد تواصل خدمة العملاء') && contactCard.includes('Reem') && /data-side="service"/.test(contactCard) && /data-late="false"/.test(contactCard), 'in the member\'s contact: with customer service, not late');
  ok(contactCard.includes('تكليف ممثل خدمة العملاء') && contactCard.includes('إلى Reem'), 'the routing to the member is on the trail, with the name');
  const closure = cardOf(markup, 'support:s-closure');
  ok(closure.includes('بانتظار إغلاق خدمة العملاء') && closure.includes('Wants a visit') && /data-side="service"/.test(closure), 'a request waiting for closure is with customer service again, and shows what the representative recorded');
  const done = cardOf(markup, 'support:s-done');
  ok(done.includes('تم التواصل والعميل مهتم') && done.includes('انتهت') && /data-side="done"/.test(done) && !done.includes('tracking-late'), 'a closed request is finished, with the outcome the representative recorded');
  eq(count(done, 'data-state="done"'), 6, 'every step done');
  // the managers' board names who took each request
  markup = render(teamRows, manager.role);
  ok(keysOf(markup).includes('support:s-untaken') && keysOf(markup).includes('support:s-other') && cardOf(markup, 'support:s-other').includes('Huda'), 'the manager sees the request nobody took and the colleague\'s, with the name of who took it');
  ok(cardOf(markup, 'support:s-untaken').includes('بانتظار تولّي خدمة العملاء') && /data-stage="take"/.test(cardOf(markup, 'support:s-untaken')), 'a request nobody took waits to be taken');
  // the open button of a card hands over the item itself, so the page opens the request, not a case or a complaint
  const opened = [];
  const tree = expand(React.createElement(TrackingBoardView, {items: mineRows, filter: 'all', onFilter: noop, expanded: true, onExpand: noop, role: rep.role, loaded: true, onOpen: item => opened.push(item.kind + ':' + item.id)})), buttons = nodes(tree, node => node.type === 'button' && /فتح الطلب/.test(text(node)));
  buttons[0].props.onClick(); buttons[buttons.length - 1].props.onClick();
  eq(opened, ['support:s-review', 'support:s-done'], 'the open button of a card opens that request');
  eq(keysOf(html(React.createElement(ServiceTrackingBoard, {me: rep, cases: [], complaints: [], support: null, onOpenCase: noop, onOpenComplaint: noop}))), [], 'with nothing loaded the board is empty');
  // English: no Arabic is left on a request's card
  language = 'en';
  const english = render(mineRows);
  eq(arabicLeft(english), [], 'English cards of requests have no untranslated wording');
  ok(english.includes('Support') && english.includes('Missed visit') && english.includes('Awaiting customer-service closure') && english.includes('Awaiting the representative&#x27;s contact with the customer') && english.includes('Opened') && english.includes('Contact result submitted for approval') && english.includes('Reached, customer is interested'), 'English kind, stages, first step and trail');
  language = 'ar';
}

console.log(JSON.stringify({ok: true, checks, render: 'source components, Arabic and English', physicalDevice: false, productionDataUsed: false}));

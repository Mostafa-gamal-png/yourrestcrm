// Executes the actual workspace with controlled hooks. Real browser checks are separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const root = process.cwd(), nativeRequire = createRequire(import.meta.url), cache = new Map();
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true};
let language = 'en', checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

function library(filename) {
  if (cache.has(filename)) return cache.get(filename);
  const exports = {}; cache.set(filename, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {compilerOptions: compiler}).outputText, {
    exports, Intl, console,
    require: name => name.startsWith('.') ? library(path.join(path.dirname(filename), name) + '.ts') : nativeRequire(name),
  });
  return exports;
}

const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'lib/locales/en.json'), 'utf8'));
const i18n = {useLanguage: () => ({language}), t: value => language === 'en' ? (dictionary[value] || value) : value};
const icons = new Proxy({}, {get: () => () => null});
const member = {id: 'rep', email: 'rep@yourrest.org', name: 'Representative One', role: 'rep', branch: 'HQ', active: 1, target: 0};
const row = (id, kind, parentId, data) => ({id, kind, parentId, assignedTo: 'rep', branch: 'HQ', data,
  createdAt: '2026-10-03T07:00:00Z', updatedAt: '2026-10-03T07:00:00Z', version: 1});
const customer = (id, name, code, region, city) => row(id, 'customer', null, {name, code, region, city});
const eastA = customer('east-a', 'Eastern Factory A', 'CUS-A', 'الشرقية', 'Dammam');
const eastB = customer('east-b', 'Eastern Factory B', 'CUS-B', 'الشرقية', 'Khobar');
const eastC = customer('east-c', 'Eastern Factory C', 'CUS-C', 'الشرقية', 'Qatif');
const westD = customer('west-d', 'Western Factory D', 'CUS-D', 'الغربية', 'Jeddah');
const unobserved = customer('unobserved', 'Customer without competitor evidence', 'CUS-NONE', 'الشرقية', 'Dammam');
const sharedFileId = ' file&/shared ';
const contact = (id, customerId, date, data = {}) => row(id, 'activity', customerId, {
  hasCompetitor: true, competitorName: 'Alpha Co', date, performedBy: 'rep', type: 'visit', salesStage: 'quoted',
  requestedProducts: ['قوالب البلوك الثابتة'], ...data,
});
const newest = contact('alpha-newest', eastA.id, '2026-10-03', {
  competitorFileId: sharedFileId, competitorFileName: 'Quote <October>.pdf',
  competitorNotes: 'Competitor source <script>alert(1)</script>\nDelivery in ten days.',
  notes: 'General visit source note & delivery concern.', summary: 'Source visit purpose: evaluate the offer.',
  customerNeeds: 'Source customer needs: two replacement molds.',
  nextAction: 'Source next action: call the purchasing manager.', nextDate: '2026-10-07',
  result: 'Source contact result: requested a comparison.',
});
const earlier = contact('alpha-earlier', eastA.id, '2026-10-01', {
  competitorFileId: sharedFileId, competitorFileName: 'Earlier alias of shared quote.pdf',
  competitorNotes: 'Earlier competitor source note retained.', notes: 'Earlier general visit source note retained.',
});
const second = contact('alpha-second', eastB.id, '2026-10-02', {
  competitorFileId: 'quote/second?x=1&y=2', competitorFileName: 'Second customer quote.pdf',
  competitorNotes: 'Second customer source note retained.',
});
const western = contact('alpha-western', westD.id, '2026-09-30', {
  competitorFileId: 'west-file', competitorFileName: 'Western customer quote.pdf',
  competitorNotes: 'Western source note outside eastern scope.',
});
const beta = contact('beta-eastern', eastC.id, '2026-10-02', {competitorName: 'Beta Co', competitorNotes: 'Beta only source note.'});
const betaWestern = contact('beta-western', westD.id, '2026-10-04', {competitorName: 'Beta Co', competitorNotes: 'Beta western source note.'});
const records = [eastA, eastB, eastC, westD, unobserved, earlier, beta, western, second, betaWestern, newest];

function descendants(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(item => descendants(item, predicate));
  if (typeof tree.type === 'function') return descendants(tree.type(tree.props), predicate);
  return [...(predicate(tree) ? [tree] : []), ...descendants(tree.props?.children, predicate)];
}
function text(tree) {
  if (tree === null || tree === undefined || tree === false) return '';
  if (typeof tree !== 'object') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (typeof tree.type === 'function') return text(tree.type(tree.props));
  return text(tree.props?.children);
}

function harness(initialRecords = records) {
  let props, cursor = 0, tree;
  const hooks = [], customers = [], visits = [], created = [], refreshes = [];
  props = {records: initialRecords, members: [member], onCustomer: id => customers.push(id),
    onVisit: record => visits.push(record), onNew: (...args) => created.push(args),
    onRefresh: () => new Promise((resolve, reject) => refreshes.push({resolve, reject}))};
  const hooksReact = {...React,
    useMemo: fn => fn(),
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = {value: typeof initial === 'function' ? initial() : initial};
      return [hooks[index].value, value => {hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value;}];
    },
    useRef(value) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = {current: value};
      return hooks[index];
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'app/competitors-workspace.tsx'), 'utf8'), {compilerOptions: compiler}).outputText, {
    exports, console, Intl, requestAnimationFrame: fn => fn(),
    require: name => {
      if (name === 'react') return hooksReact;
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'lucide-react') return icons;
      if (name === '@/lib/i18n') return i18n;
      if (name.endsWith('.css')) return {};
      if (name.startsWith('@/lib/')) return library(name.slice(2) + '.ts');
      throw Error('Unexpected UI dependency ' + name);
    },
  });
  const render = () => {cursor = 0; tree = exports.default(props); return renderToStaticMarkup(tree);};
  const find = predicate => descendants(tree, predicate);
  const button = label => find(node => node.type === 'button' && text(node) === label)[0];
  const tab = label => find(node => node.props?.role === 'tab' && text(node).startsWith(label))[0];
  const select = name => {
    const item = find(node => node.type === 'button' && node.props.className?.split(' ').includes('competitors-item') && text(node).includes(name))[0];
    assert.ok(item, 'Competitor selectable: ' + name); item.props.onClick(); return render();
  };
  const changeField = (id, value) => {
    const input = find(node => node.props?.id === id)[0];
    assert.ok(input, 'Filter control exists: ' + id); input.props.onChange({target: {value}}); return render();
  };
  return {render, find, button, tab, select, changeField, customers, visits, created, refreshes,
    change: next => {props = {...props, ...next};}, tree: () => tree};
}

const classes = (node, name) => typeof node.props?.className === 'string' && node.props.className.split(' ').includes(name);
const within = (node, predicate) => descendants(node, predicate);
const buttonWithin = (node, label) => within(node, child => child.type === 'button' && text(child) === label)[0];
const contactsOf = h => h.find(node => classes(node, 'competitors-contact'));
const datesOf = h => contactsOf(h).map(node => within(node, child => child.type === 'time')[0].props.dateTime);
const coverageOf = h => text(h.find(node => classes(node, 'competitors-coverage'))[0]);
const activate = (h, label) => {
  const tab = h.tab(label); assert.ok(tab, 'Profile tab exists: ' + label);
  tab.props.onClick(); return h.render();
};
const cardsOf = (h, kind) => h.find(node => classes(node, 'competitors-' + kind + '-card'));
const selectedPanel = h => h.find(node => node.props?.role === 'tabpanel')[0];

const h = harness(); let html = h.render();
ok(html.includes('dir="ltr"'), 'English profile workspace uses LTR direction');
ok(html.includes('<h2>Competitors'), 'English workspace heading is explicit');
for (const id of ['competitors-region', 'competitors-from', 'competitors-through', 'competitors-query']) {
  ok(h.find(node => node.type === 'label' && node.props.htmlFor === id).length === 1, 'Filter has an explicit label: ' + id);
}
eq(h.find(node => node.props?.role === 'tablist').length, 0, 'Profile tabs do not appear before selection');
html = h.select('Alpha Co');
eq(h.find(node => node.props?.role === 'tablist').length, 1, 'Selected profile has one semantic tablist');
const englishTabLabels = ['Overview', 'Customers', 'Quotes', 'History'];
eq(h.find(node => node.props?.role === 'tab').length, 4, 'All four profile tabs are semantic tabs');
for (const label of englishTabLabels) ok(h.tab(label), 'English tab label: ' + label);
eq(h.tab('Overview').props['aria-selected'], true, 'Overview selected by default');
eq(h.tab('Overview').props.tabIndex, 0, 'Selected tab is keyboard reachable');
eq(h.find(node => node.props?.role === 'tab' && node.props.tabIndex === 0).length, 1, 'Tablist has one keyboard entry point');
eq(selectedPanel(h).props['aria-labelledby'], h.tab('Overview').props.id, 'Panel labelled by active tab');
eq(h.tab('Overview').props['aria-controls'], selectedPanel(h).props.id, 'Active tab controls the rendered panel');
eq(contactsOf(h).length, 3, 'Overview shows the latest three original observations');
eq(datesOf(h), ['2026-10-03', '2026-10-02', '2026-10-01'], 'Overview observations ordered newest first');
ok(coverageOf(h).includes('75%'), 'Coverage counts three Alpha customers among four observed customers');
ok(coverageOf(h).includes('3 / 4'), 'Coverage exposes its observed-customer numerator and denominator');
ok(coverageOf(h).includes('recorded competitor in the selected region and period'), 'Coverage names the recorded evidence and selected scope');
ok(coverageOf(h).includes('not market share or a sales percentage'), 'Coverage is explicitly not market share or sales percentage');
ok(html.includes('Products associated with visits'), 'Product summary is labelled as visit-associated evidence');
eq(html.includes('Customer without competitor evidence'), false, 'Unobserved customer is excluded from evidence profile');
ok(html.includes('Competitor source &lt;script&gt;alert(1)&lt;/script&gt;'), 'Source competitor note is escaped');
eq(html.includes('<script>alert(1)</script>'), false, 'Competitor note never becomes executable markup');
ok(html.includes('Delivery in ten days.'), 'Multiline competitor note retained');
h.button('Add visit').props.onClick();
eq(h.created, [['Alpha Co']], 'Profile action seeds the selected competitor');
const latestContact = contactsOf(h)[0];
buttonWithin(latestContact, 'View contact details').props.onClick();
eq(h.visits[0], newest, 'Observation action receives the unchanged original activity');
for (const field of ['notes', 'summary', 'customerNeeds', 'nextAction', 'nextDate', 'result', 'competitorNotes']) {
  eq(h.visits[0].data[field], newest.data[field], 'Original source field preserved when opening observation: ' + field);
}

html = activate(h, 'Customers');
eq(cardsOf(h, 'customer').length, 3, 'Customers tab has distinct customer records rather than one card per visit');
const customerCards = cardsOf(h, 'customer');
eq(customerCards.map(card => within(card, node => node.type === 'header')[0]).map(text),
  ['Eastern Factory ACUS-A · Dammam · الشرقية', 'Eastern Factory BCUS-B · Khobar · الشرقية', 'Western Factory DCUS-D · Jeddah · الغربية'],
  'Customer records retain exact identities and location details in newest-first order');
const firstCard = customerCards[0];
eq(within(firstCard, node => node.type === 'dd').map(text), ['2', '1', '2026-10-03'], 'Repeated visits and duplicate quote counted once for the customer file total');
buttonWithin(firstCard, eastA.data.name).props.onClick();
eq(h.customers, [eastA.id], 'Customer card action opens the exact customer record');
buttonWithin(firstCard, 'Add customer visit').props.onClick();
eq(h.created[1], ['Alpha Co', eastA.id], 'Customer visit action seeds both competitor and exact customer ID');
buttonWithin(customerCards[1], 'Add customer visit').props.onClick();
eq(h.created[2], ['Alpha Co', eastB.id], 'Each customer visit action retains its own customer ID');
buttonWithin(firstCard, 'Open note source').props.onClick();
eq(h.visits[1], newest, 'Latest customer note links back to its original source activity');
buttonWithin(firstCard, 'View customer history').props.onClick(); h.render();
eq(h.tab('History').props['aria-selected'], true, 'Customer history action selects the observations tab');
eq(h.find(node => node.props?.id === 'competitor-history-customer')[0].props.value, eastA.id, 'Customer history action scopes observations to exact customer');
eq(datesOf(h), ['2026-10-03', '2026-10-01'], 'Customer history retains only that customer, newest first');
h.changeField('competitor-history-customer', '');
eq(datesOf(h), ['2026-10-03', '2026-10-02', '2026-10-01', '2026-09-30'], 'Clearing customer filter restores the full competitor history');
for (const source of [newest, second, earlier, western]) {
  ok(contactsOf(h).some(node => text(node).includes(source.data.competitorNotes)), 'Every competitor source note remains present: ' + source.id);
}

html = activate(h, 'Quotes');
eq(cardsOf(h, 'quote').length, 3, 'Quotes tab deduplicates repeated file IDs');
const quoteCards = cardsOf(h, 'quote');
const sharedQuote = quoteCards[0];
const quoteLinks = h.find(node => node.type === 'a');
eq(quoteLinks.map(node => node.props.href), [
  '/api/visit-files?id=' + encodeURIComponent(sharedFileId),
  '/api/visit-files?id=' + encodeURIComponent(second.data.competitorFileId),
  '/api/visit-files?id=' + encodeURIComponent(western.data.competitorFileId),
], 'Every quote uses the authorized endpoint with its exact opaque file ID');
eq(quoteLinks.map(node => text(node)), ['Quote <October>.pdf', 'Second customer quote.pdf', 'Western customer quote.pdf'], 'Quote names use latest source and remain distinct');
ok(html.includes('Quote &lt;October&gt;.pdf'), 'Quote filename is escaped');
for (const link of quoteLinks) {
  eq(link.props.target, '_blank', 'Quote opens a separate tab');
  eq(link.props.rel, 'noopener noreferrer', 'Quote has safe new-tab attributes');
}
eq(within(sharedQuote, node => node.type === 'summary').map(text), ['Linked records (2)'], 'Deduplicated quote retains both original source records');
const linkedQuoteRecords = within(sharedQuote, node => node.type === 'li');
eq(linkedQuoteRecords.map(node => within(node, child => child.type === 'time')[0].props.dateTime), ['2026-10-03', '2026-10-01'], 'Shared quote source records are newest first');
within(linkedQuoteRecords[1], node => node.type === 'button')[0].props.onClick();
eq(h.visits.at(-1), earlier, 'Older source on shared quote opens its own original activity');
buttonWithin(sharedQuote, eastA.data.name).props.onClick();
eq(h.customers.at(-1), eastA.id, 'Quote customer action opens the exact associated customer');

html = h.changeField('competitors-region', 'eastern');
eq(h.find(node => node.props?.role === 'tabpanel').length, 0, 'Region change clears the old profile on the first render');
eq(html.includes('Western source note outside eastern scope.'), false, 'Region change never displays the stale western source');
h.select('Alpha Co');
ok(coverageOf(h).includes('66.7%') && coverageOf(h).includes('2 / 3'), 'Region coverage uses distinct observed customers within the region');
html = activate(h, 'Quotes');
eq(cardsOf(h, 'quote').length, 2, 'Region filtering also scopes quote files');
eq(html.includes('west-file'), false, 'Out-of-region quote endpoint is absent');
html = h.changeField('competitors-query', 'Alpha Co');
eq(h.find(node => classes(node, 'competitors-item')).length, 1, 'Text search narrows the displayed competitor list');
h.select('Alpha Co');
ok(coverageOf(h).includes('2 / 3'), 'Text search preserves the scoped coverage denominator from all competitors');
ok(coverageOf(h).includes('66.7%'), 'Text search does not inflate coverage to 100 percent');
h.changeField('competitors-query', 'Western source note');
eq(h.find(node => classes(node, 'competitors-item')).length, 0, 'Text search cannot match notes outside the region scope');
h.changeField('competitors-query', '');
h.changeField('competitors-from', '2026-10-02');
h.changeField('competitors-through', '2026-10-02');
h.select('Alpha Co');
ok(coverageOf(h).includes('50%') && coverageOf(h).includes('1 / 2'), 'Inclusive date boundaries derive both coverage numerator and denominator');
activate(h, 'History');
eq(datesOf(h), ['2026-10-02'], 'From/through boundaries exclude observations outside the exact day');
html = h.changeField('competitors-from', '2026-10-03');
ok(html.includes('The start date must not be after the end date.'), 'Reversed date range gives a clear validation message');
eq(h.find(node => classes(node, 'competitors-item')).length, 0, 'Invalid date range does not expose unfiltered results');
h.button('Clear filters').props.onClick(); h.render();
for (const id of ['competitors-region', 'competitors-from', 'competitors-through']) {
  eq(h.find(node => node.props?.id === id)[0].props.value, '', 'Clear filters resets scope: ' + id);
}
h.select('Alpha Co');
ok(coverageOf(h).includes('3 / 4'), 'Clearing filters restores the authorized full-evidence denominator');

for (const label of englishTabLabels) {
  const scoped = harness(); scoped.render(); scoped.select('Alpha Co'); activate(scoped, label);
  scoped.change({records: [eastC, beta]}); const narrowed = scoped.render();
  eq(scoped.find(node => node.props?.role === 'tabpanel').length, 0, 'Authorization refresh removes selected profile synchronously from ' + label);
  eq(narrowed.includes('Competitor source'), false, 'Stale source note absent after authorized records change from ' + label);
  eq(narrowed.includes(encodeURIComponent(sharedFileId)), false, 'Stale quote ID absent after authorized records change from ' + label);
}
const focused = harness(); focused.render(); focused.select('Alpha Co'); activate(focused, 'History');
focused.changeField('competitor-history-customer', eastA.id);
focused.change({records: [eastB, second, eastC, beta]}); focused.render();
eq(focused.find(node => node.props?.id === 'competitor-history-customer')[0].props.value, '', 'Removed customer focus resets synchronously to available history');
eq(datesOf(focused), ['2026-10-02'], 'Changed authorization cannot retain stale focused-customer observations');

const manyContacts = Array.from({length: 25}, (_, index) => contact('paged-' + index, eastA.id, '2026-10-' + String(index + 1).padStart(2, '0'), {competitorNotes: 'Paged note ' + index}));
const paged = harness([eastA, ...manyContacts]); paged.render(); paged.select('Alpha Co');
eq(contactsOf(paged).length, 3, 'Large profile still has bounded overview observations');
activate(paged, 'History');
eq(contactsOf(paged).length, 20, 'Observations tab initially limits history to 20 records');
paged.button('Show older records (5)').props.onClick(); paged.render();
eq(contactsOf(paged).length, 25, 'Older observation action exposes the remaining original records');
eq(datesOf(paged)[0], '2026-10-25', 'Paged observations start with latest date');
eq(datesOf(paged).at(-1), '2026-10-01', 'Paged observations preserve the oldest date');
paged.select('Alpha Co'); activate(paged, 'History');
eq(contactsOf(paged).length, 20, 'Selecting a competitor resets observation paging');

const noQuotes = harness([eastC, beta]); noQuotes.render(); noQuotes.select('Beta Co');
html = activate(noQuotes, 'Quotes');
ok(html.includes('No quote files in this scope'), 'Quotes empty state is scoped and explicit');
noQuotes.button('Add a quote through a visit').props.onClick();
eq(noQuotes.created, [['Beta Co']], 'Quote empty-state action uses existing visit workflow with selected competitor');

const keyboard = harness(); keyboard.render(); keyboard.select('Alpha Co'); let prevented = 0;
keyboard.tab('Overview').props.onKeyDown({key: 'ArrowRight', preventDefault: () => prevented++}); keyboard.render();
eq(keyboard.tab('Customers').props['aria-selected'], true, 'English right arrow advances to the next tab');
keyboard.tab('Customers').props.onKeyDown({key: 'End', preventDefault: () => prevented++}); keyboard.render();
eq(keyboard.tab('History').props['aria-selected'], true, 'End key selects the final tab');
keyboard.tab('History').props.onKeyDown({key: 'Home', preventDefault: () => prevented++}); keyboard.render();
eq(keyboard.tab('Overview').props['aria-selected'], true, 'Home key selects the first tab');
eq(prevented, 3, 'Handled tab keys prevent browser scrolling');

language = 'ar';
const arabic = harness(); html = arabic.render();
ok(html.includes('dir="rtl"') && html.includes('<h2>المنافسون'), 'Arabic workspace has its Arabic heading and RTL direction');
html = arabic.select('Alpha Co');
for (const label of ['نظرة عامة', 'العملاء', 'العروض', 'السجل']) ok(arabic.tab(label), 'Arabic tab label: ' + label);
ok(html.includes('التغطية ضمن العملاء المرصودين'), 'Arabic coverage heading uses observed customers');
ok(html.includes('مؤشر من السجلات المتاحة، وليس حصة سوقية أو نسبة مبيعات.'), 'Arabic coverage explains recorded evidence and excludes market share');
ok(html.includes('أصناف مرتبطة بالزيارات'), 'Arabic product summary is tied to recorded visits');
arabic.tab('نظرة عامة').props.onKeyDown({key: 'ArrowLeft', preventDefault() {}}); arabic.render();
eq(arabic.tab('العملاء').props['aria-selected'], true, 'Arabic left arrow advances in RTL order');
arabic.tab('العملاء').props.onKeyDown({key: 'ArrowRight', preventDefault() {}}); arabic.render();
eq(arabic.tab('نظرة عامة').props['aria-selected'], true, 'Arabic right arrow reverses in RTL order');
html = activate(arabic, 'السجل');
ok(html.includes('سجل المنافس لدى العملاء') && html.includes('الأحدث أولًا'), 'Arabic history headings remain explicit');
arabic.button('كل المنافسين').props.onClick(); html = arabic.render();
eq(html.includes('has-selection'), false, 'Mobile back action restores the competitor list');

const css = fs.readFileSync(path.join(root, 'app/competitors-workspace.css'), 'utf8');
ok(css.includes('@media(max-width:760px)'), 'Workspace defines a mobile breakpoint');
ok(css.includes('.competitors-workspace.has-selection .competitors-list{display:none}'), 'Mobile selected state replaces the list with the profile');
ok(css.includes('.competitors-profile-tabs'), 'Tabbed profile has explicit responsive styling');
ok(css.includes('overflow-wrap:anywhere'), 'Long names, notes, and file names can wrap');
ok(css.includes('minmax(0,1fr)'), 'Flexible columns can shrink within a mobile viewport');
console.log(JSON.stringify({ok: true, checks, type: 'expanded competitor profile SSR and controlled interactions', realBrowser: false}));

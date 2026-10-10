import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/customer-map-search.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { searchMapCustomers, normalizeMapSearch } = exports;
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (actual, message) => { assert.ok(actual, message); checks++; };
const row = (id, data = {}) => ({ id, kind: 'customer', parentId: null, assignedTo: 'rep-west', branch: 'HQ', data, createdAt: '', updatedAt: '', version: 1 });
const ids = (rows, query, limit) => Array.from(searchMapCustomers(rows, query, limit), item => item.id);
const customers = [
    row('dammam', { name: 'مَصْنَع أَفْلَاك المعمار', code: 'E-١٢٣', city: 'الدمام', region: 'الشرقية', contact: 'أحمد مصطفى', phone: '+966 (55) 123-4567', address: 'المنطقة الصناعية شارع الملك' }),
    row('jeddah', { name: 'مصنع إتقان البلوك', code: 'W-456', city: 'جدة', region: 'الغربية', contact: 'حسن', phone: '050 888 1122', phone2: '٠٥٤٩٩٩٢٢٣٣', address: 'طريق مكة' }),
    row('homonym-a', { name: 'مصنع الأمل', city: 'جدة', region: 'الغربية' }),
    row('homonym-b', { name: 'مصنع الأمل', city: 'المدينة', region: 'الغربية' }),
];

eq(normalizeMapSearch('  إِبـراهيم، آفاق | على ٠١٢۳۴ '), 'ابراهيم افاق علي 01234', 'Arabic letters, tatweel, diacritics, digits and punctuation normalize');
for (const query of ['', '   ', '، | +--- ()', '😀']) eq(ids(customers, query), [], 'Empty or punctuation-only query never lists customers');
eq(ids(customers, 'افلاك'), ['dammam'], 'Arabic diacritics and Alif variants do not prevent partial-name match');
eq(ids(customers, 'المعمار افلاك'), ['dammam'], 'Name word order is independent');
eq(ids(customers, 'جدة اتقان'), ['jeddah'], 'Words can match name and city together');
eq(ids(customers, 'مصطفي'), ['dammam'], 'Contact names normalize final Ya');
eq(ids(customers, 'E-123'), ['dammam'], 'Customer codes normalize punctuation and Arabic digits');
eq(ids(customers, 'W ۴۵۶'), ['jeddah'], 'Persian digits can find customer code');
eq(ids(customers, 'الملك الصناعية'), ['dammam'], 'Address search supports unordered partial words');
eq(ids(customers, 'الشرقية'), ['dammam'], 'Region search uses customer region');
eq(ids(customers, 'حسن'), ['jeddah'], 'Contact search is supported');
eq(ids(customers, '٠٥٤ ٩٩٩ ٢٢٣٣'), ['jeddah'], 'Secondary phone can be searched using spaced Arabic digits');
for (const query of ['0551234567', '٠٥٥١٢٣٤٥٦٧', '+966551234567', '00966 55 123 4567', '055-123']) eq(ids(customers, query), ['dammam'], 'Saudi local/international and partial phone match: ' + query);
eq(ids(customers, '+966508881122'), ['jeddah'], 'International search finds a saved local mobile number');
eq(ids(customers, '9992233'), ['jeddah'], 'Phone suffix can find its customer');
eq(ids(customers, 'مصنع الامل'), ['homonym-a', 'homonym-b'], 'Homonyms remain separate choices');
eq(ids(customers, 'الامل المدينة'), ['homonym-b'], 'City disambiguates homonyms without auto-selection');

const ranked = [row('contains', { name: 'Global Atlas Factory' }), row('prefix', { name: 'Atlas Factory' }), row('phone-exact', { name: 'Phone factory', phone: '0550000000' }), row('code-exact', { name: 'Code factory', code: 'Atlas' }), row('name-exact', { name: 'Atlas' }), row('typo', { name: 'Atals' })];
eq(ids(ranked, 'Atlas'), ['name-exact', 'code-exact', 'prefix', 'contains', 'typo'], 'Exact name/code precede prefix/contains and then typo matches');
const phoneRanked = [row('phone-partial', { name: 'Call 0550000000 today' }), row('phone', { phone: '+966550000000' }), row('code', { code: '0550000000' })];
eq(ids(phoneRanked, '0550000000'), ['code', 'phone', 'phone-partial'], 'Exact customer code/phone outrank partial text matches');
eq(ids([row('name-contains', { name: 'MegaAtlas' }), row('name-prefix', { name: 'Atlas factory' })], 'atlas'), ['name-prefix', 'name-contains'], 'Token prefixes precede middle-of-word matches');

const spelling = [row('arabic', { name: 'مصنع افلاك', city: 'الدمام' }), row('english', { name: 'Atlas Concrete', city: 'Jeddah' }), row('address-only', { name: 'Other', address: 'Atlas Concrete' }), row('code-only', { name: 'Other', code: 'Atlas' })];
eq(ids(spelling, 'افلاط'), ['arabic'], 'One substitution in a four-letter or longer name is tolerated');
eq(ids(spelling, 'افلااك'), ['arabic'], 'One extra letter is tolerated');
eq(ids(spelling, 'اتلس'), [], 'Unrelated names are not suggested');
eq(ids(spelling, 'Atals'), ['english'], 'One adjacent transposition is tolerated only in the customer name');
eq(ids(spelling, 'Atla'), ['english', 'code-only', 'address-only'], 'Literal partial matches rank name and code above an address match');
eq(ids(spelling, 'Atas'), ['english'], 'One omitted letter is tolerated');
eq(ids(spelling, 'Atals Jeddah'), ['english'], 'One name typo can combine with an exact city');
eq(ids(spelling, 'Atals JeddaX'), [], 'A location typo is not silently guessed');
eq(ids(spelling, 'Atals Concreet'), [], 'Multiple misspelled words do not produce broad fuzzy matches');
eq(ids([row('short', { name: 'AB' })], 'AC'), [], 'Two-character fuzzy matching is disabled');
eq(ids([row('three', { name: 'حسن' })], 'حسم'), [], 'Three-character fuzzy matching is disabled');
eq(ids([row('numeric', { name: 'A123' })], 'A124'), [], 'Codes/numeric name tokens do not use fuzzy correction');
eq(ids([row('international', { phone: '+44 7700 900123' })], '07700900123'), [], 'Non-Saudi country codes are never inferred');

const authorized = customers.filter(item => item.data.region === 'الغربية');
eq(ids(authorized, 'افلاك'), [], 'Only supplied authorized customers can be returned');
const selected = searchMapCustomers(authorized, 'الأمل');
ok(selected[0] === authorized[1] && selected[1] === authorized[2], 'Search returns original row identities');
eq(ids([], 'factory'), [], 'Empty authorized scope stays empty');
const malformed = [row('empty'), row('null', null), row('number', { name: 12345 }), { ...row('visit', { name: 'factory' }), kind: 'activity' }];
eq(ids(malformed, 'factory'), [], 'Missing fields and non-customer rows are handled safely');
eq(ids(malformed, '12345'), ['number'], 'Imported numeric fields can be searched');
const frozen = Object.freeze(customers.map(item => Object.freeze({ ...item, data: Object.freeze({ ...item.data }) })));
const before = JSON.stringify(frozen); searchMapCustomers(frozen, 'مصنع');
eq(JSON.stringify(frozen), before, 'Search does not mutate customer rows or infer coordinates');
const many = Array.from({ length: 12 }, (_, index) => row(String(index), { name: 'Factory ' + index }));
eq(ids(many, 'Factory').length, 8, 'Autocomplete defaults to eight suggestions');
eq(ids(many, 'Factory', 10).length, 10, 'Caller can request ten suggestions');
eq(ids(many, 'Factory', 0), [], 'Explicit zero limit is respected');
eq(ids(many, 'Factory', -1), [], 'Negative limits do not expose all rows');
eq(ids(many, 'Factory', 2.9), ['0', '1'], 'Limits are integer bounded with stable tie order');
eq(ids(many, 'Factory', NaN).length, 8, 'Invalid limit uses safe default');
eq(ids([row('changed', { name: 'Before' })], 'Before'), ['changed'], 'First call sees its own input');
eq(ids([row('changed', { name: 'After' })], 'Before'), [], 'No prior-scope or prior-data cache leaks into a later call');

console.log(JSON.stringify({ ok: true, checks, type: 'authorized map autocomplete, Arabic normalization, phones, ranking and conservative typo tolerance' }));

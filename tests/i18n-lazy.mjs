// The English dictionary is downloaded only when English is chosen (lib/i18n.ts, 2026-10-29): it was about 94 KB of every opening, in
// Arabic too. The real module, with a pretend page (document, localStorage) and the real dictionary file: nothing is fetched in
// Arabic; choosing English waits for the dictionary and then switches; a quick change of mind back to Arabic wins; a saved English
// choice starts the download as the module loads. No browser, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const source = fs.readFileSync(path.join(root, 'lib/i18n.ts'), 'utf8');
eq(/import\s+\w+\s+from\s+['"]\.\/locales\/en\.json['"]/.test(source), false, 'the dictionary is not imported with the module');
eq((source.match(/import\(['"]\.\/locales\/en\.json['"]\)/g) || []).length, 1, 'it is imported on demand, in one place');

// A fresh copy of the module per scenario, each with its own pretend page and a count of dictionary downloads.
let copies = 0;
async function fresh({saved} = {}) {
  const out = fs.mkdtempSync(path.join(runtime, 'i18n-lazy-'));
  process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
  fs.mkdirSync(path.join(out, 'locales'));
  fs.copyFileSync(path.join(root, 'lib/locales/en.json'), path.join(out, 'locales/en.json'));
  const page = {downloads: 0, storage: new Map(saved ? [['yr-language', saved]] : []), document: {documentElement: {lang: 'ar', dir: 'rtl'}, title: ''}};
  globalThis.window = {}; globalThis.document = page.document;
  globalThis.localStorage = {getItem: key => page.storage.get(key) ?? null, setItem: (key, value) => page.storage.set(key, String(value))};
  globalThis.__countDownload = () => { page.downloads++; };
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText
    .replace("import('./locales/en.json')", "(globalThis.__countDownload(), import('./locales/en.json', {with: {type: 'json'}}))")
    .replace(/^import \{[^}]*\} from 'react';$/m, 'const useEffect = () => {}, useSyncExternalStore = (s, get) => get();');
  const file = path.join(out, `i18n-${++copies}.mjs`);
  fs.writeFileSync(file, code);
  return {i18n: await import(file), page};
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const KEY = 'إنهاء وحفظ', ENGLISH = 'Finish and save';

{ // Arabic: nothing downloaded, Arabic text stays as it is
  const {i18n, page} = await fresh();
  eq([i18n.getLanguage(), i18n.t(KEY), page.downloads], ['ar', KEY, 0], 'Arabic opens without the dictionary');
  i18n.setLanguage('ar'); await settle();
  eq([i18n.getLanguage(), page.downloads, page.storage.get('yr-language')], ['ar', 0, 'ar'], 'choosing Arabic downloads nothing');
}
{ // choosing English: the page stays Arabic until the dictionary arrives, then switches once
  const {i18n, page} = await fresh();
  i18n.setLanguage('en');
  eq([i18n.getLanguage(), page.storage.get('yr-language'), page.downloads], ['ar', 'en', 1], 'the choice is saved and the download starts; the page waits in Arabic');
  await settle();
  eq([i18n.getLanguage(), i18n.t(KEY), page.document.documentElement.dir, page.document.documentElement.lang], ['en', ENGLISH, 'ltr', 'en'], 'then the page is in English');
  eq(i18n.t('7 زيارة فعالة'), '7 active visits', 'entries with a number in them work once the dictionary is in');
  i18n.setLanguage('ar'); i18n.setLanguage('en'); await settle();
  eq([i18n.getLanguage(), page.downloads], ['en', 1], 'switching back and forth downloads the dictionary once');
}
{ // a change of mind before the dictionary arrives: the last choice wins
  const {i18n, page} = await fresh();
  i18n.setLanguage('en'); i18n.setLanguage('ar'); await settle();
  eq([i18n.getLanguage(), page.document.documentElement.dir, page.storage.get('yr-language')], ['ar', 'rtl', 'ar'], 'Arabic chosen last stays, even after the dictionary arrives');
}
{ // a saved English choice starts the download as the module loads, before any component asks
  const {i18n, page} = await fresh({saved: 'en'});
  eq(page.downloads, 1, 'the download starts with the page');
  await settle();
  i18n.setLanguage('en');
  eq([i18n.getLanguage(), i18n.t(KEY), page.downloads], ['en', ENGLISH, 1], 'and English applies at once when the page asks');
}
{ // a dictionary handed over directly (tests, tools) needs no download
  const {i18n, page} = await fresh();
  i18n.installEnglish({[KEY]: 'Done'});
  i18n.setLanguage('en');
  eq([i18n.getLanguage(), i18n.t(KEY), page.downloads], ['en', 'Done', 0], 'installEnglish makes English immediate');
}
console.log(JSON.stringify({ok: true, checks}));

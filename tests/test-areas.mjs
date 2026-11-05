// tests/test-areas.json and its selection (scripts/lib/test-areas.mjs, used by scripts/gates.mjs): the map is valid, every release-build
// and browser test of the manifest belongs to an area, every glob matches a file of the repository, and sample change lists select what
// the rules say (a mold file -> the mold tests; a shared file -> everything; a file nothing covers -> everything; docs -> the area or none).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadAreas, selectTests, validateAreas, gatedTests, globToRegExp} from '../scripts/lib/test-areas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

const text = fs.readFileSync(path.join(root, 'tests/test-areas.json'), 'utf8');
ok(JSON.parse(text), 'tests/test-areas.json is valid JSON');
const data = loadAreas(root), {map, manifest} = data;
// The repository's files: git when this is a checkout, else every file on disk (a source archive).
let files;
try { files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).split('\n').filter(Boolean); } catch { files = []; }
if (!files.length) {
  const walk = directory => fs.readdirSync(path.join(root, directory), {withFileTypes: true}).flatMap(entry => ['node_modules', 'dist', 'output', '.git'].includes(entry.name) ? [] : entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name).split(path.sep).join('/')]);
  files = walk('.').map(file => file.replace(/^\.\//, ''));
}
eq(validateAreas(data, files), [], 'The map has no problem: every release-build/browser test is in an area, every area names real tests, every glob matches a file');

const all = gatedTests(manifest).map(test => test.file);
eq(all.length > 40, true, 'The manifest has the release-build and browser tests');
const covered = new Set(Object.values(map.areas).flatMap(area => area.tests));
for (const file of all) ok(covered.has(file), 'In an area: ' + file);
for (const file of Object.keys(map.serial.tests)) ok(all.includes(file) && map.serial.tests[file].length > 20, 'A serial test is in the manifest with its reason: ' + file);

// The globs themselves.
eq([globToRegExp('app/api/mold-requests/**').test('app/api/mold-requests/design-files/delete/route.ts'), globToRegExp('components/**').test('components/ui/button.tsx'), globToRegExp('tests/mold-requests*.mjs').test('tests/mold-requests-browser.mjs'), globToRegExp('tests/*.mjs').test('tests/a/b.mjs'), globToRegExp('lib/crm.ts').test('lib/crmXts'), globToRegExp('docs/**').test('docs/a.md')], [true, true, true, false, false, true], 'Glob syntax: ** spans folders, * stays in one, dots are literal');

const pick = changed => selectTests(changed, data);
const mold = pick(['app/mold-requests.tsx', 'lib/mold-requests.ts', 'portable/mold-rules.mjs']);
eq(mold.full, false, 'A mold change is not a full run');
eq(mold.tests, all.filter(file => map.areas['mold-requests'].tests.includes(file)), 'A mold change runs the mold-requests area');
ok(mold.tests.includes('tests/mold-requests-browser.mjs') && mold.tests.includes('tests/mold-requests-http.mjs') && !mold.tests.includes('tests/tracking-gate-browser.mjs'), 'The mold tests and not the tracking test');
eq(Object.keys(mold.areas), ['mold-requests'], 'One area named');

const design = pick(['app/api/mold-requests/design-files/route.ts']);
eq([design.full, design.tests.includes('tests/mold-design-files-http.mjs'), design.tests.includes('tests/support-http.mjs')], [false, true, false], 'A design-file route runs the design-file tests only');

for (const shared of ['lib/access.ts', 'lib/crm.ts', 'lib/regions.ts', 'lib/request-body.ts', 'app/crm-app.tsx', 'app/layout.tsx', 'components/ui/button.tsx', 'db/schema.ts', 'drizzle/0018_mold_file_category.sql', 'scripts/lib/built-app.mjs', 'package.json', 'public/sw.js', 'lib/locales/en.json', 'tests/test-areas.json']) {
  const result = pick(['app/mold-requests.tsx', shared]);
  eq([result.full, result.tests, result.shared], [true, all, [shared]], 'A shared file runs everything: ' + shared);
}
const unknown = pick(['app/mold-requests.tsx', 'lib/brand-new-thing.ts']);
eq([unknown.full, unknown.tests, unknown.unmatched], [true, all, ['lib/brand-new-thing.ts']], 'A file no rule covers runs everything and is named');
ok(unknown.reasons.some(reason => reason.includes('lib/brand-new-thing.ts')), 'The reason names the file');

const docs = pick(['docs/CHANGELOG-HISTORY.md', 'docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md', 'tests/CHECKS.md']);
eq([docs.full, docs.tests, docs.defaultGateOnly.length], [false, [], 3], 'General docs: the default gate only');
const moldDocs = pick(['docs/MOLD-REQUESTS-CONTRACT-AR.md']);
eq([moldDocs.full, moldDocs.tests], [false, mold.tests], "An area's docs: that area's tests");
const changedTest = pick(['tests/tracking-gate-browser.mjs']);
ok(!changedTest.full && changedTest.tests.includes('tests/tracking-gate-browser.mjs'), 'A changed browser test runs itself');
const unit = pick(['tests/request-body.mjs']);
eq([unit.full, unit.tests], [false, []], "A default-gate test of no area: the default gate (which runs it)");
const generated = pick(['public/offline-app.html', 'public/offline-shell-manifest.json', 'public/offline-app/assets/app-X.js']);
eq([generated.full, generated.tests, generated.generated.length], [false, [], 3], 'Generated offline-shell files select nothing by themselves');
const tracking = pick(['lib/tracking-gate.ts']);
ok(!tracking.full && tracking.tests.includes('tests/tracking-gate-browser.mjs') && tracking.tests.includes('tests/device-status-http.mjs') && !tracking.tests.includes('tests/mold-requests-http.mjs'), 'A tracking change runs the tracking tests');
const service = pick(['lib/complaints.ts']);
ok(!service.full && ['tests/complaints-http.mjs', 'tests/complaints-browser.mjs', 'tests/service-kpi-http.mjs', 'tests/support-browser.mjs'].every(file => service.tests.includes(file)), 'A complaints change runs the customer-service domain');
const nothing = pick([]);
eq([nothing.full, nothing.tests], [false, []], 'No change: nothing beyond the default gate');
eq(pick(['app/mold-requests.tsx', 'lib/tracking-gate.ts']).tests, all.filter(file => mold.tests.includes(file) || tracking.tests.includes(file)), 'Two areas: the union, in manifest order');

console.log(JSON.stringify({ok: true, checks, areas: Object.keys(map.areas).length, tests: all.length}));

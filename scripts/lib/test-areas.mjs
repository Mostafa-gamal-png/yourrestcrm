// Which release-build and browser tests a change needs (tests/test-areas.json; scripts/gates.mjs runs them, tests/test-areas.mjs checks
// this file). Pure functions on paths: reading git (what changed, whether a locale change only adds keys, whether public/sw.js only
// changed its BUILD_REVISION line) stays in scripts/gates.mjs.
import fs from 'node:fs';
import path from 'node:path';

/** A glob of tests/test-areas.json as a RegExp: `**` any path (also empty), `*` and `?` inside one path segment. */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
}

const matcher = globs => { const res = globs.map(globToRegExp); return file => res.some(re => re.test(file)); };

/** Reads tests/test-areas.json and tests/check-manifest.json under root. */
export function loadAreas(root) {
  const map = JSON.parse(fs.readFileSync(path.join(root, 'tests/test-areas.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests/check-manifest.json'), 'utf8'));
  return {map, manifest};
}

/** The release-build and browser tests of the manifest: [{file, gate}], in manifest order. */
export const gatedTests = manifest => manifest.excluded.filter(entry => entry.gate === 'release-build' || entry.gate === 'browser').map(({file, gate}) => ({file, gate}));

/**
 * The selection for a list of changed paths (repository-relative, forward slashes). Rules, for each path, in this order:
 * generated -> ignored; shared or a locale file -> full run; a release-build/browser test -> runs itself (and the areas naming it);
 * an area's sources -> that area's tests; defaultGateOnly -> nothing beyond the default gate; anything else -> full run.
 * Callers remove first what only looks changed (a locale change that only adds keys, public/sw.js with only a new BUILD_REVISION).
 */
export function selectTests(changed, {map, manifest}) {
  const all = gatedTests(manifest), known = new Set(all.map(test => test.file));
  const isGenerated = matcher(map.generated.globs), isShared = matcher([...map.shared.globs, ...map.locales.globs, map.generated.serviceWorker]);
  const isDefaultOnly = matcher(map.defaultGateOnly.globs);
  const areaMatchers = Object.entries(map.areas).map(([name, area]) => [name, matcher(area.sources)]);
  const result = {full: false, reasons: [], generated: [], shared: [], unmatched: [], defaultGateOnly: [], changedTests: [], areas: {}, tests: []};
  const selected = new Set();
  for (const file of [...new Set(changed)].sort()) {
    if (isGenerated(file)) { result.generated.push(file); continue; }
    if (isShared(file)) { result.shared.push(file); continue; }
    const areas = areaMatchers.filter(([, match]) => match(file)).map(([name]) => name);
    if (known.has(file)) { result.changedTests.push(file); selected.add(file); }
    for (const name of areas) { (result.areas[name] ??= []).push(file); for (const test of map.areas[name].tests) selected.add(test); }
    if (areas.length || known.has(file)) continue;
    if (isDefaultOnly(file)) { result.defaultGateOnly.push(file); continue; }
    result.unmatched.push(file);
  }
  if (result.shared.length) result.reasons.push('shared files changed: ' + result.shared.join(', '));
  if (result.unmatched.length) result.reasons.push('files no area or shared rule covers (safe default): ' + result.unmatched.join(', '));
  result.full = result.reasons.length > 0;
  if (result.full) result.tests = all.map(test => test.file);
  else {
    result.tests = all.map(test => test.file).filter(file => selected.has(file));
    const names = Object.keys(result.areas);
    result.reasons.push(names.length || result.changedTests.length
      ? 'only these areas changed: ' + [...names, ...(result.changedTests.length ? ['changed tests: ' + result.changedTests.join(', ')] : [])].join('; ')
      : 'nothing beyond the default gate changed');
  }
  return result;
}

/** Problems with the map itself (tests/test-areas.mjs and scripts/gates.mjs both refuse a broken map). files: every tracked path. */
export function validateAreas({map, manifest}, files) {
  const problems = [], all = gatedTests(manifest), known = new Set(all.map(test => test.file));
  if (map.schema !== 1) problems.push('Unsupported tests/test-areas.json schema');
  const covered = new Set(Object.values(map.areas).flatMap(area => area.tests));
  for (const test of all) if (!covered.has(test.file)) problems.push('No area covers ' + test.file);
  for (const [name, area] of Object.entries(map.areas)) {
    if (!area.about || !Array.isArray(area.sources) || !area.sources.length || !Array.isArray(area.tests) || !area.tests.length) problems.push('Area ' + name + ' needs about, sources and tests');
    for (const test of area.tests || []) if (!known.has(test)) problems.push('Area ' + name + ' names ' + test + ', not a release-build or browser test of the manifest');
  }
  for (const test of Object.keys(map.serial?.tests || {})) if (!known.has(test)) problems.push('Serial test ' + test + ' is not in the manifest');
  const globs = [
    ...map.generated.globs.map(glob => ['generated', glob]), ['generated', map.generated.serviceWorker], ...map.locales.globs.map(glob => ['locales', glob]),
    ...map.shared.globs.map(glob => ['shared', glob]), ...(map.docsWrittenByTests?.globs || []).map(glob => ['docsWrittenByTests', glob]), ...map.defaultGateOnly.globs.map(glob => ['defaultGateOnly', glob]),
    ...Object.entries(map.areas).flatMap(([name, area]) => (area.sources || []).map(glob => ['area ' + name, glob]))
  ];
  for (const [where, glob] of globs) { const re = globToRegExp(glob); if (!files.some(file => re.test(file))) problems.push(where + ': ' + glob + ' matches no file'); }
  return problems;
}

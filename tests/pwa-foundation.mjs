import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const manifest = JSON.parse(await fs.readFile(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
equal([manifest.id, manifest.start_url, manifest.scope], ['/', '/', '/'], 'Stable same-origin app identity');
equal([manifest.display, manifest.lang, manifest.dir], ['standalone', 'ar', 'rtl'], 'Standalone Arabic application');
for (const purpose of ['any', 'maskable']) for (const size of [192, 512]) {
  const icon = manifest.icons.find((entry) => entry.purpose === purpose && entry.sizes === `${size}x${size}`);
  check(icon && icon.type === 'image/png' && /^\/icons\/[a-z0-9-]+\.png$/.test(icon.src), `${purpose} ${size} manifest icon`);
  const bytes = await fs.readFile(path.join(root, 'public', icon.src));
  equal([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'Real PNG signature');
  equal([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [size, size], 'Correct raster icon dimensions');
}
const apple = await fs.readFile(path.join(root, 'public/icons/yourrest-company-apple.png'));
equal([apple.readUInt32BE(16), apple.readUInt32BE(20)], [180, 180], 'Apple icon dimensions');

const layoutSource = await fs.readFile(path.join(root, 'app/layout.tsx'), 'utf8');
const layoutCode = ts.transpileModule(layoutSource, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const layoutExports = {};
vm.runInNewContext(layoutCode, { exports: layoutExports, require: (name) => name.endsWith('.css') ? {} : require(name) });
equal(layoutExports.metadata.manifest, '/manifest.webmanifest', 'Layout exposes the manifest');
equal(layoutExports.metadata.icons.apple[0].url, '/icons/yourrest-company-apple.png', 'Apple icon is linked');
check(layoutExports.metadata.appleWebApp.capable, 'Apple standalone mode');
equal(layoutExports.metadata.other['apple-mobile-web-app-capable'], 'yes', 'Apple capability remains explicit through vinext');
equal(layoutExports.viewport.width, 'device-width', 'Responsive viewport');
equal(layoutExports.viewport.viewportFit, 'cover', 'Safe-area-aware app viewport');
const layoutTree = layoutExports.default({children: null});
const head = layoutTree.props.children.find((entry) => entry.type === 'head');
const headScripts = [head.props.children].flat();
const promptScript = headScripts.find(entry => entry.props?.src === '/install-bootstrap.js');
equal(promptScript?.type, 'script', 'Prompt capture is a synchronous head script');
equal(promptScript.props.src, '/install-bootstrap.js', 'Prompt bootstrap URL is stable');
check(!promptScript.props.async && !promptScript.props.defer, 'Prompt capture runs before hydration');
const themeScript = headScripts.find(entry => entry.props?.src === '/theme-bootstrap.js');
equal(themeScript?.type, 'script', 'Persisted theme is restored before hydration');
check(!themeScript.props.async && !themeScript.props.defer, 'Theme bootstrap is synchronous');
check(layoutExports.viewport.userScalable !== false && !layoutExports.viewport.maximumScale, 'Zoom remains accessible');

await import('./offline-shell.mjs');
console.log(`PWA foundation: ${checks} checks passed (plus offline shell checks).`);

// Published dependency-policy regression and harmless compatibility checks.
// This does not claim a reachable exploit in the Yourrest application.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=process.env.DEPENDENCY_TEST_ROOT||fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(resolve(root,'package.json'));
let checks=0;
const atLeast=(name,version,major,minor,patch)=>{
 const parts=version.split('.').map(Number);
 assert(parts[0]===major&&(parts[1]>minor||(parts[1]===minor&&parts[2]>=patch)),`${name} must use the patched ${major}.x line, >=${major}.${minor}.${patch}; found ${version}`);checks++;
};
const next=require('next/package.json').version;
const eslintNext=JSON.parse(readFileSync(resolve(root,'node_modules/eslint-config-next/package.json'),'utf8')).version;
atLeast('next (GHSA-vcvr-r3jv-pc5j)',next,16,3,6);
assert.equal(eslintNext,next,'Next and its ESLint configuration stay aligned');checks++;
const nextRequire=createRequire(require.resolve('next/package.json'));
const wranglerRequire=createRequire(require.resolve('wrangler'));
const miniflareRequire=createRequire(wranglerRequire.resolve('miniflare'));
for(const [name,scopedRequire] of [['next',nextRequire],['miniflare',miniflareRequire]]){
 const sharp=scopedRequire('sharp');
 atLeast(`${name}/sharp (GHSA-wq5f-xc86-pv6w)`,sharp.versions.sharp,0,35,5);
 const pixels=Buffer.alloc(4*4*3,90);
 const png=await sharp(pixels,{raw:{width:4,height:4,channels:3}}).png().toBuffer();
 const metadata=await sharp(png).metadata();
 assert.equal(metadata.width,4);checks++;
 assert.equal(metadata.height,4);checks++;
 assert.equal(metadata.format,'png');checks++;
}
const {NextRequest,NextResponse}=require('next/server');
const request=new NextRequest('https://example.invalid/check?value=ordinary');
assert.equal(request.nextUrl.searchParams.get('value'),'ordinary');checks++;
const response=NextResponse.json({ok:true});
assert.deepEqual(await response.json(),{ok:true});checks++;
assert.equal(response.status,200);checks++;
// pdf-lib (2026-11-10: the customer's signature stamped inside a mold request's PDFs, lib/mold-signed-pdf.ts): the exact version, its
// licence (MIT, pure JavaScript, no native code or install script), bundled into the server's build, and an ordinary round trip.
const pdfLibPackage=JSON.parse(readFileSync(require.resolve('pdf-lib/package.json'),'utf8'));
assert.equal(pdfLibPackage.version,'1.17.1','pdf-lib stays on the reviewed version');checks++;
assert.equal(pdfLibPackage.license,'MIT','pdf-lib is MIT');checks++;
assert.equal(pdfLibPackage.scripts?.install??pdfLibPackage.scripts?.postinstall??null,null,'pdf-lib runs nothing at install');checks++;
const {PDFDocument}=await import(pathToFileURL(require.resolve('pdf-lib')).href);
const made=await PDFDocument.create();made.addPage([200,100]);
const read=await PDFDocument.load(await made.save());
assert.equal(read.getPageCount(),1);checks++;
assert.equal(Math.round(read.getPage(0).getWidth()),200);checks++;
// pdfjs-dist (2026-11-10, second release of the day: the customer reads the request's PDFs on the signing screens, app/mold-document-viewer.tsx):
// the exact version, its licence (Apache-2.0), nothing run at install, its one native package (@napi-rs/canvas, for Node only) optional
// and never what the browser build loads, and an ordinary read of a PDF's pages with the legacy build the screens load.
const pdfjsPackage=JSON.parse(readFileSync(require.resolve('pdfjs-dist/package.json'),'utf8'));
assert.equal(pdfjsPackage.version,'4.10.38','pdfjs-dist stays on the reviewed version');checks++;
assert.equal(pdfjsPackage.license,'Apache-2.0','pdfjs-dist is Apache-2.0');checks++;
assert.deepEqual(pdfjsPackage.scripts||{},{},'pdfjs-dist runs nothing at install');checks++;
assert.deepEqual([Object.keys(pdfjsPackage.dependencies||{}),Object.keys(pdfjsPackage.optionalDependencies||{})],[[],['@napi-rs/canvas']],'its only native package is optional');checks++;
const browserBuild=readFileSync(resolve(require.resolve('pdfjs-dist/package.json'),'..','legacy/build/pdf.min.mjs'),'utf8');
assert.ok(!/^\s*import\s/m.test(browserBuild)&&!/from\s*["']@napi-rs\/canvas["']/.test(browserBuild),'the browser build imports nothing (the native canvas only through Node\'s own require, never in a browser)');checks++;
const pdfjs=await import(pathToFileURL(resolve(require.resolve('pdfjs-dist/package.json'),'..','legacy/build/pdf.mjs')).href);
const three=await PDFDocument.create();for(let n=0;n<3;n++)three.addPage([300,400]);
const opened=await pdfjs.getDocument({data:new Uint8Array(await three.save()),isEvalSupported:false,useSystemFonts:false,verbosity:0}).promise;
const firstPage=await opened.getPage(1);
assert.deepEqual([opened.numPages,firstPage.getViewport({scale:1}).width],[3,300],'pdf.js reads the pages and their size');checks++;
await opened.destroy();
console.log(JSON.stringify({ok:true,checks,next,eslintNext,pdfLib:pdfLibPackage.version,pdfjs:pdfjsPackage.version,exploitReproduction:false}));

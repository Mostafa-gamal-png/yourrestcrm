import {build} from 'vite';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicDir=path.join(root,'public'),output=path.join(publicDir,'offline-app');
// No RSC output, authenticated HTML, cookies, API responses or customer data
// enter this build. The normal CRM client owns account unlock and data loading.
// This directory contains generated client assets only. Clear it explicitly so
// old hashed bundles cannot be collected into the next offline cache manifest.
await rm(output,{recursive:true,force:true});
const result=await build({
 configFile:false,root,base:'/offline-app/',publicDir:false,
 resolve:{alias:{'@':root}},
 esbuild:{jsx:'automatic'},
 build:{outDir:output,emptyOutDir:true,target:'es2020',cssCodeSplit:false,sourcemap:false,
  rollupOptions:{input:path.join(root,'app/offline-entry.tsx'),output:{entryFileNames:'assets/app-[hash].js',chunkFileNames:'assets/chunk-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}}},
});
const bundle=(Array.isArray(result)?result:[result]).flatMap(item=>item.output||[]);
const entry=bundle.find(item=>item.type==='chunk'&&item.isEntry);
if(!entry)throw new Error('Offline client entry was not emitted');
const styles=bundle.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css'));
if(!styles.length)throw new Error('Offline stylesheet was not emitted');
const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><meta name="theme-color" content="#166344"><meta name="robots" content="noindex"><title>يورست للصناعات | Yourrest CRM</title><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/yourrest-company-icon.svg"><script src="/theme-bootstrap.js"></script><script src="/install-bootstrap.js"></script>'+styles.map(file=>'<link rel="stylesheet" href="/offline-app/'+file.fileName+'">').join('')+'</head><body><div id="yourrest-offline-app"></div><noscript>يحتاج التطبيق تشغيل JavaScript. / JavaScript is required.</noscript><script type="module" src="/offline-app/'+entry.fileName+'"></script></body></html>\n';
await writeFile(path.join(publicDir,'offline-app.html'),html);
const paths=['/offline-app.html','/offline.html','/theme-bootstrap.js','/install-bootstrap.js','/yourrest-logo.png','/yourrest-company-icon.svg','/manifest.webmanifest'];
// Vite's emitted bundle is the authoritative inventory. A synchronizer can
// restore tracked files after cleanup; those files must never enter this cache.
for(const file of bundle)paths.push('/offline-app/'+file.fileName);
// Include the actual current application icons, not unrelated legacy aliases
// that may also happen to exist in the public/icons directory.
paths.push('/icons/yourrest-company-192.png','/icons/yourrest-company-512.png','/icons/yourrest-company-apple.png','/icons/yourrest-company-maskable-192.png','/icons/yourrest-company-maskable-512.png');
const assets=[];
for(const url of paths.sort())assets.push({url,sha256:createHash('sha256').update(await readFile(path.join(publicDir,url))).digest('hex')});
const workerPath=path.join(publicDir,'sw.js');
let worker=await readFile(workerPath,'utf8');
if(!/const BUILD_REVISION = '[^']+';/.test(worker))throw new Error('Offline worker revision marker is missing');
// Changing worker behavior also gets a distinct cache, so a failed new install
// cannot erase the active version's already-working offline resources.
const workerTemplate=worker.replace(/const BUILD_REVISION = '[^']+';/,"const BUILD_REVISION = 'development';");
const revision=createHash('sha256').update(JSON.stringify(assets)+'\n'+workerTemplate).digest('hex');
worker=worker.replace(/const BUILD_REVISION = '[^']+';/,"const BUILD_REVISION = '"+revision+"';");
const manifest={format:'yourrest-offline-shell-v1',revision,assets};
// Execute the production validator against the generated artifact before a
// release is built. Fixtures alone cannot detect mismatched generated URLs.
runInNewContext(worker+'\nvalidateManifest('+JSON.stringify(manifest)+');',{self:{addEventListener(){}}},{timeout:1000});
await writeFile(path.join(publicDir,'offline-shell-manifest.json'),JSON.stringify(manifest)+'\n');
await writeFile(workerPath,worker);
console.log(JSON.stringify({offlineShell:true,revision,assets:assets.length}));

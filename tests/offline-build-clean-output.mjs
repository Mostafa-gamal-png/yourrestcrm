// Exercise the actual build script with a lightweight Vite emitter. A Vite
// configuration flag is not evidence that files left by a prior build vanished.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=process.cwd(),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-offline-output-'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
function write(relative,content){const file=path.join(temporary,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
try{
 write('package.json','{"type":"module"}');
 write('scripts/build-offline-shell.mjs',fs.readFileSync(process.env.OFFLINE_BUILD_SCRIPT||path.join(root,'scripts/build-offline-shell.mjs')));
 write('public/sw.js',fs.readFileSync(path.join(root,'public/sw.js')));
 const staticFiles=['offline.html','theme-bootstrap.js','install-bootstrap.js','yourrest-logo.png','yourrest-company-icon.svg','manifest.webmanifest','icons/yourrest-company-192.png','icons/yourrest-company-512.png','icons/yourrest-company-apple.png','icons/yourrest-company-maskable-192.png','icons/yourrest-company-maskable-512.png'];
 for(const name of staticFiles)write('public/'+name,'fixture '+name);
 const preserved=['settings.cjs','data/database.sqlite','public/customer-photos/existing.png','public/other-app/assets.js','public/icons/legacy-icon.png'];
 for(const name of preserved)write(name,'keep '+name);
 const stale=['assets/app-old.js','assets/chunk-old.js','assets/style-old.css','assets/previous-build.js'];
 for(const name of stale)write('public/offline-app/'+name,'obsolete '+name);
 write('node_modules/vite/package.json','{"name":"vite","type":"module","exports":"./index.js"}');
 write('node_modules/vite/index.js',`
import fs from 'node:fs/promises';
import path from 'node:path';
export async function build(config){
 if(config.publicDir!==false||config.build.emptyOutDir!==true)throw Error('Existing build isolation changed');
 const files=[['assets/app-current.js','current application'],['assets/chunk-current.js','current dependency'],['assets/style-current.css','body{color:green}']];
 // Deliberately emit without implicit cleanup. Also simulate an old tracked
 // file restored by a synchronizer after the script's initial cleanup.
 for(const [name,content] of files){const file=path.join(config.build.outDir,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);}
 await fs.writeFile(path.join(config.build.outDir,'assets/app-restored-stale.js'),'stale synchronization '+Math.random());
 return {output:files.map(([fileName],index)=>({type:fileName.endsWith('.css')?'asset':'chunk',fileName,isEntry:index===0}))};
}
`);
 const run=()=>{const result=spawnSync(process.execPath,['scripts/build-offline-shell.mjs'],{cwd:temporary,encoding:'utf8',timeout:20000});eq(result.status,0,'Offline build completes: '+result.stderr);return JSON.parse(result.stdout.trim());};
 const first=run();
 for(const name of stale)eq(fs.existsSync(path.join(temporary,'public/offline-app',name)),false,'Old asset removed: '+name);
 ok(fs.existsSync(path.join(temporary,'public/offline-app/assets/app-restored-stale.js')),'Fixture restores an unreported old file after cleanup');
 const manifest=JSON.parse(fs.readFileSync(path.join(temporary,'public/offline-shell-manifest.json'),'utf8'));
 const expected=['/offline-app/assets/app-current.js','/offline-app/assets/chunk-current.js','/offline-app/assets/style-current.css'];
 eq(manifest.assets.filter(asset=>asset.url.startsWith('/offline-app/')).map(asset=>asset.url),expected,'Manifest uses only reported bundle entries, even when stale output is restored');
 const html=fs.readFileSync(path.join(temporary,'public/offline-app.html'),'utf8');
 const expectedAssetCount=staticFiles.length+1+expected.length-(html.includes('/theme-bootstrap.js')?0:1);
 eq(first.assets,expectedAssetCount,'Legacy output cannot enlarge the cache inventory');
 ok(html.includes('/offline-app/assets/app-current.js'),'Offline HTML references new entry');
 ok(html.includes('/offline-app/assets/style-current.css'),'Offline HTML references new stylesheet');
 for(const name of preserved)eq(fs.readFileSync(path.join(temporary,name),'utf8'),'keep '+name,'Outside generated output preserved: '+name);
 for(const name of staticFiles)eq(fs.readFileSync(path.join(temporary,'public',name),'utf8'),'fixture '+name,'Static public asset preserved: '+name);
 for(const asset of manifest.assets)eq(asset.sha256,createHash('sha256').update(fs.readFileSync(path.join(temporary,'public',asset.url))).digest('hex'),'Manifest hashes current bytes: '+asset.url);
 // A second invocation also cleans files introduced after the first build;
 // identical source output therefore has an identical cache revision.
 write('public/offline-app/assets/app-another-old-build.js','obsolete injected between builds');
 const second=run();eq(second.revision,first.revision,'Rebuilding identical assets is deterministic');
 eq(fs.existsSync(path.join(temporary,'public/offline-app/assets/app-another-old-build.js')),false,'Repeated build clears newly stale output');
 eq(second.assets,expectedAssetCount,'Repeated build does not accumulate cache entries');
 console.log(JSON.stringify({ok:true,checks,coverage:'actual offline build script, stale output cleanup and post-cleanup resurrection, emitted-only manifest and hashes, deterministic rebuild, scoped preservation',stubbedVite:true}));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}

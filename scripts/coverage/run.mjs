// Unit-test coverage of lib/ and app/ (2026-11-22, the unit-test plan's phase 0): runs the default gate's test files (not tsc or ESLint)
// with V8 coverage, 4 at a time, keeping a copy of every module a test transpiles into .sites-runtime (hook.mjs), then report.mjs maps it
// back to the source files. Measures the unit tests only: the HTTP and browser suites run the built bundle, whose names are minified.
//   node scripts/coverage/run.mjs <out folder> [substring of the test files to run]
//   node scripts/coverage/report.mjs <out folder>
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
const root=process.cwd(),hook=path.join(path.dirname(new URL(import.meta.url).pathname),'hook.mjs'),here=path.resolve(process.argv[2]||'output/coverage'),only=process.argv[3]||'';fs.mkdirSync(here,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(root+'/tests/check-manifest.json','utf8'));
const excluded=new Set(manifest.excluded.map(e=>e.file));
const files=fs.readdirSync(root+'/tests').filter(f=>f.endsWith('.mjs')).map(f=>'tests/'+f).filter(f=>!excluded.has(f)&&f.includes(only)).sort();
const covDir=path.join(here,'v8'),saveDir=path.join(here,'src');fs.rmSync(covDir,{recursive:true,force:true});fs.rmSync(saveDir,{recursive:true,force:true});
const results=[];let next=0;
async function worker(){while(next<files.length){const file=files[next++];const t=Date.now();
 const code=await new Promise(res=>{const env={...process.env,NODE_V8_COVERAGE:covDir,COVSAVE_DIR:saveDir,NODE_OPTIONS:'--max-old-space-size=1024 --import='+hook};
  for(const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','NO_PROXY','no_proxy'])delete env[k];
  const c=spawn(process.execPath,[file],{cwd:root,env,stdio:['ignore','pipe','pipe']});let out='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>out+=d);
  const timer=setTimeout(()=>c.kill('SIGKILL'),300000);c.on('close',code=>{clearTimeout(timer);res({code,out})});});
 results.push({file,code:code.code,ms:Date.now()-t,tail:code.out.split('\n').filter(Boolean).slice(-1)[0]?.slice(0,200)});
 process.stdout.write((code.code===0?'ok   ':'FAIL ')+file+'\n');}}
await Promise.all(Array.from({length:4},worker));
fs.writeFileSync(path.join(here,'run-results.json'),JSON.stringify(results,null,1));
console.log('files',files.length,'passed',results.filter(r=>r.code===0).length,'failed',results.filter(r=>r.code!==0).map(r=>r.file).join(' '));

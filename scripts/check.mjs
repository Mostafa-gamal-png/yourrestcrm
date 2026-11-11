import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import os from 'node:os';

// npm run check [-- --gate erp-workbook|erp-customers-workbook|erp-quotes-workbook] [-- --jobs N]
// Each test in its own process (512 MiB JS heap, 120 s; TypeScript 768 MiB/180 s, ESLint 2048 MiB/300 s) through a pool of N workers
// (default: the CPU count, 4 here; --jobs 1 runs one after another, as before 2026-11-05). The tests the manifest lists under
// `serial` run alone after the pool. In a parallel run, a failure is run once more alone: passing then is reported as flaky
// (in the line, the summary and the report), never as a plain pass; failing again fails the gate.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const usage='Usage: npm run check [-- --gate erp-workbook|erp-customers-workbook|erp-quotes-workbook] [-- --jobs N]';
let gate='default',jobs=os.availableParallelism();
for(let i=2;i<process.argv.length;i++){
 const arg=process.argv[i],value=process.argv[i+1];
 if(arg==='--gate'&&value){gate=value;i++;}
 else if(arg==='--jobs'&&/^\d+$/.test(value||'')){jobs=Number(value);i++;}
 else throw Error(usage);
}
if(!Number.isInteger(jobs)||jobs<1||jobs>16)throw Error('--jobs must be 1..16');
if(!['default','erp-workbook','erp-customers-workbook','erp-quotes-workbook'].includes(gate))throw Error('Browser/build/archive gates require explicit preparation; see tests/CHECKS.md.');
const manifest=JSON.parse(fs.readFileSync('tests/check-manifest.json','utf8'));
if(manifest.schema!==1||!Array.isArray(manifest.excluded))throw Error('Unsupported check manifest');
const exclusions=new Map();
for(const entry of manifest.excluded){
 if(!entry.file?.startsWith('tests/')||!entry.reason||!entry.gate||exclusions.has(entry.file)||!fs.statSync(entry.file).isFile())throw Error('Invalid or obsolete check exclusion: '+entry.file);
 exclusions.set(entry.file,entry);
}
// Tests that measure time on this machine: run alone, after the pool, so other tests' load cannot fail them.
const serial=new Map();
for(const entry of manifest.serial||[]){
 if(!entry.file?.startsWith('tests/')||!entry.reason||serial.has(entry.file)||exclusions.has(entry.file)||!fs.statSync(entry.file).isFile())throw Error('Invalid or obsolete serial entry: '+entry.file);
 serial.set(entry.file,entry.reason);
}
function discover(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?discover(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
const files=discover('tests').filter(file=>/\.(mjs|py)$/.test(file)).sort();
for(const file of files)if(file.endsWith('.py')&&!exclusions.has(file))throw Error('Classify the new Python suite in check-manifest.json: '+file);
const selected=files.filter(file=>gate==='default'?!exclusions.has(file):exclusions.get(file)?.gate===gate);
if(!selected.length)throw Error('The selected gate has no tests');
if(gate==='erp-workbook'&&(!process.env.ERP_TEST_WORKBOOK||!fs.existsSync(process.env.ERP_TEST_WORKBOOK)))throw Error('Set ERP_TEST_WORKBOOK to the original ERP workbook. No workbook checks have run.');
// The ERP customer export is another file: its own gate, so the sales gate still runs with ERP_TEST_WORKBOOK alone.
if(gate==='erp-customers-workbook'&&(!process.env.ERP_CUSTOMERS_WORKBOOK||!fs.existsSync(process.env.ERP_CUSTOMERS_WORKBOOK)))throw Error('Set ERP_CUSTOMERS_WORKBOOK to the ERP customer export. No workbook checks have run.');
// The ERP quotations report (Reports_Invoices_*.xls) is a third file: its own gate.
if(gate==='erp-quotes-workbook'&&(!process.env.ERP_QUOTES_WORKBOOK||!fs.existsSync(process.env.ERP_QUOTES_WORKBOOK)))throw Error('Set ERP_QUOTES_WORKBOOK to the ERP quotations report. No workbook checks have run.');
const output=path.join(root,'output','check');fs.mkdirSync(output,{recursive:true});

const entries=[];
if(gate==='default')entries.push({name:'typescript',args:['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],heap:768,timeout:180000});
// ESLint errors fail the gate (warnings do not); the reviewed exceptions and their reasons are in eslint.config.mjs.
if(gate==='default')entries.push({name:'eslint',args:['node_modules/eslint/bin/eslint.js','.'],heap:2048,timeout:300000});
for(const file of selected)entries.push({name:file,args:[file],heap:512,timeout:120000,serial:serial.has(file)});
const order=new Map(entries.map((entry,index)=>[entry.name,index]));
const reportFile=path.join(output,gate+'-results.json');
// Longest first, from the last report of this gate (a new test counts as long, so it starts early).
const previous=new Map();
try{for(const row of JSON.parse(fs.readFileSync(reportFile,'utf8')).results)previous.set(row.name,row.firstTry?.seconds??row.seconds);}catch{/* first run */}

const running=new Set();
function run(entry,suffix=''){
 const started=Date.now(),log=path.join(output,entry.name.replaceAll('/','__')+suffix+'.log');
 const descriptor=fs.openSync(log,'w',0o600);
 const child=spawn(process.execPath,entry.args,{cwd:root,env:{...process.env,NODE_OPTIONS:'--max-old-space-size='+entry.heap},stdio:['ignore',descriptor,descriptor],detached:true});
 fs.closeSync(descriptor);running.add(child);
 const group=signal=>{try{process.kill(-child.pid,signal);}catch{/* gone */}};
 let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;group('SIGTERM');setTimeout(()=>group('SIGKILL'),5000).unref();},entry.timeout);
 return new Promise(resolve=>{
  let error;
  child.on('error',failure=>{error=failure;});
  child.on('close',(status,signal)=>{
   clearTimeout(timer);running.delete(child);group('SIGKILL');
   resolve({name:entry.name,passed:status===0&&!timedOut&&!error,exitCode:status,signal,seconds:Math.round((Date.now()-started)/10)/100,log:path.relative(root,log),error:error?.message||(timedOut?'timed out after '+entry.timeout/1000+' s':undefined)});
  });
 });
}
process.on('SIGINT',()=>{for(const child of running)try{process.kill(-child.pid,'SIGKILL');}catch{/* gone */}process.exit(130);});
const tail=row=>fs.readFileSync(row.log,'utf8').slice(-6000);
const print=(row,note='')=>{console.log(`${row.flaky?'FLAKY':row.passed?'PASS':'FAIL'} ${row.name} (${row.seconds}s)${note}`);if(!row.passed)console.error(tail(row));};

const started=Date.now(),results=new Map();
const pool=entries.filter(entry=>jobs>1&&entry.serial?false:true),alone=entries.filter(entry=>jobs>1&&entry.serial);
pool.sort((a,b)=>jobs===1?order.get(a.name)-order.get(b.name):(previous.get(b.name)??60)-(previous.get(a.name)??60));
console.log(`Gate: ${gate}; ${selected.length} test files; ${jobs===1?'sequential processes':jobs+' parallel processes, '+alone.length+' alone after them, a failure run once more alone'}; 512 MiB JS heap per test.`);
const retry=[];
async function worker(){
 for(let entry;(entry=pool.shift());){
  const row=await run(entry);
  if(row.passed||jobs===1){results.set(row.name,row);print(row);}
  else{retry.push(entry);console.log(`RETRY ${row.name} (${row.seconds}s) failed with ${jobs} in parallel; it runs again alone at the end`);results.set(row.name,row);}
 }
}
await Promise.all(Array.from({length:jobs},worker));
for(const entry of alone){const row=await run(entry);row.alone=true;results.set(row.name,row);print(row,' alone');}
for(const entry of retry){
 const first=results.get(entry.name),again=await run(entry,'.rerun');
 const row={...again,seconds:first.seconds,log:first.log,flaky:again.passed,firstTry:{seconds:first.seconds,exitCode:first.exitCode,signal:first.signal,error:first.error,log:first.log},rerun:{seconds:again.seconds,exitCode:again.exitCode,log:again.log}};
 results.set(entry.name,row);
 if(again.passed)print(row,' — failed in parallel, passed alone (rerun log '+again.log+')');
 else{console.log(`FAIL ${entry.name} (${first.seconds}s, again alone ${again.seconds}s)`);console.error(tail(first));}
}
const rows=entries.map(entry=>results.get(entry.name));
const flaky=rows.filter(row=>row.flaky).map(row=>row.name);
const report={gate,passed:rows.every(row=>row.passed),jobs,wallClockSeconds:Math.round((Date.now()-started)/100)/10,flaky,results:rows,serial:[...serial].map(([file,reason])=>({file,reason})),excluded:gate==='default'?manifest.excluded:[],limitations:['Controlled UI component tests are not real browser or device tests.','Default gate does not execute release, archive, browser or original-workbook gates.']};
fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(`${rows.filter(row=>row.passed).length}/${rows.length} checks passed${flaky.length?` (${flaky.length} flaky: ${flaky.join(', ')})`:''}; ${report.wallClockSeconds}s with ${jobs} job${jobs===1?'':'s'}; report: output/check/${gate}-results.json`);
process.exitCode=report.passed?0:1;

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--gate'))throw Error('Usage: npm run check [-- --gate erp-workbook]');
const gate=args[1]||'default';
if(!['default','erp-workbook'].includes(gate))throw Error('Browser/build/archive gates require explicit preparation; see tests/CHECKS.md.');
const manifest=JSON.parse(fs.readFileSync('tests/check-manifest.json','utf8'));
if(manifest.schema!==1||!Array.isArray(manifest.excluded))throw Error('Unsupported check manifest');
const exclusions=new Map();
for(const entry of manifest.excluded){
 if(!entry.file?.startsWith('tests/')||!entry.reason||!entry.gate||exclusions.has(entry.file)||!fs.statSync(entry.file).isFile())throw Error('Invalid or obsolete check exclusion: '+entry.file);
 exclusions.set(entry.file,entry);
}
function discover(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?discover(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
const files=discover('tests').filter(file=>/\.(mjs|py)$/.test(file)).sort();
for(const file of files)if(file.endsWith('.py')&&!exclusions.has(file))throw Error('Classify the new Python suite in check-manifest.json: '+file);
const selected=files.filter(file=>gate==='default'?!exclusions.has(file):exclusions.get(file)?.gate===gate);
if(!selected.length)throw Error('The selected gate has no tests');
if(gate==='erp-workbook'&&(!process.env.ERP_TEST_WORKBOOK||!fs.existsSync(process.env.ERP_TEST_WORKBOOK)))throw Error('Set ERP_TEST_WORKBOOK to the original ERP workbook. No workbook checks have run.');
const output=path.join(root,'output','check');fs.mkdirSync(output,{recursive:true});
const results=[];
function run(name,commandArgs,heap=512,timeout=120000){
 const started=Date.now(),log=path.join(output,name.replaceAll('/','__')+'.log');
 const descriptor=fs.openSync(log,'w',0o600);
 let result;
 try{result=spawnSync(process.execPath,commandArgs,{cwd:root,env:{...process.env,NODE_OPTIONS:'--max-old-space-size='+heap},stdio:['ignore',descriptor,descriptor],timeout,killSignal:'SIGTERM'});}finally{fs.closeSync(descriptor);}
 const row={name,passed:result.status===0&&!result.error,exitCode:result.status,signal:result.signal,seconds:Math.round((Date.now()-started)/10)/100,log:path.relative(root,log),error:result.error?.message};results.push(row);
 console.log(`${row.passed?'PASS':'FAIL'} ${name} (${row.seconds}s)`);
 if(!row.passed){const contents=fs.readFileSync(log,'utf8');console.error(contents.slice(-6000));}
}
console.log(`Gate: ${gate}; ${selected.length} test files; sequential processes; 512 MiB JS heap per test.`);
if(gate==='default')run('typescript',['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],768,180000);
for(const file of selected)run(file,[file]);
const report={gate,passed:results.every(row=>row.passed),results,excluded:gate==='default'?manifest.excluded:[],limitations:['Controlled UI component tests are not real browser or device tests.','Default gate does not execute release, archive, browser or original-workbook gates.']};
fs.writeFileSync(path.join(output,gate+'-results.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(`${results.filter(row=>row.passed).length}/${results.length} checks passed; report: output/check/${gate}-results.json`);
process.exitCode=report.passed?0:1;

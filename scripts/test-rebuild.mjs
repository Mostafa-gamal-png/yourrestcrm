import {readdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const exclusions=new Set(['pwa-browser.mjs','app-browser-workflows.mjs','package-install.mjs','namecheap-http.mjs','production-load.mjs','native-tracking-ui.mjs','journey-ui.mjs']);
const files=(await readdir('tests')).filter(name=>name.endsWith('.mjs')&&!exclusions.has(name)).sort();
const results=[];
for(const file of files){
 const result=await new Promise(resolve=>{
  const child=spawn(process.execPath,['tests/'+file],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},180000);
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.on('exit',code=>{clearTimeout(timer);const last=stdout.trim().split('\n').at(-1)||'';let detail;try{detail=JSON.parse(last);}catch{detail={summary:last.slice(0,500)};}resolve({suite:file,passed:code===0&&!timedOut,exitCode:code,timedOut,detail,...(code===0?{}:{diagnostic:stderr.replace(/[a-f0-9]{64}/gi,'[redacted]').slice(-3000)})});});
 });results.push(result);console.log(JSON.stringify({suite:file,passed:result.passed}));
}
const report={date:'2026-10-01',node:process.version,productionDataUsed:false,realPhoneTested:false,results,passed:results.every(result=>result.passed)};
await writeFile('docs/REBUILD-REGRESSION-VERIFICATION.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,suites:results.length,failures:results.filter(result=>!result.passed).map(result=>result.suite)}));
if(!report.passed)process.exitCode=1;

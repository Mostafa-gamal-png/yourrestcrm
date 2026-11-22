// Reads the V8 coverage of run.mjs, maps every transpiled module back to its source file, and merges the runs:
// per source file, the share of executable lines that ran and the named functions that never ran.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=process.cwd(),here=path.resolve(process.argv[2]||'output/coverage');
const saved=new Map();for(const line of fs.readFileSync(path.join(here,'src/index.tsv'),'utf8').split('\n'))if(line){const [h,f]=line.split('\t');saved.set(f,h);}
const AREAS=/^(lib|app|portable|db|components|hooks|mobile\/web)\//;
function sourceOf(file){
 const m=file.match(/\/\.sites-runtime\/[^/]+\/(.+)$/);
 if(m){let rel=m[1];const base=rel.replace(/\.(mjs|js|cjs)$/,'');for(const ext of ['.ts','.tsx','.mjs','.cjs','.js'])if(fs.existsSync(path.join(root,base+ext)))return {rel:base+ext,text:saved.has(file)?fs.readFileSync(path.join(here,'src',saved.get(file)+'.js'),'utf8'):null};return null;}
 if(file.startsWith(root+'/')){const rel=file.slice(root.length+1);if(!AREAS.test(rel)||rel.includes('node_modules'))return null;try{return {rel,text:fs.readFileSync(file,'utf8')}}catch{return null}}
 return null;
}
const per=new Map();// rel -> {versions: Map(key->{text,lines:Set covered, code:Set}), fns: Map(name->bool), runs}
for(const f of fs.readdirSync(path.join(here,'v8'))){
 let data;try{data=JSON.parse(fs.readFileSync(path.join(here,'v8',f),'utf8'))}catch{continue}
 for(const s of data.result||[]){
  if(!s.url.startsWith('file://'))continue;const file=decodeURIComponent(new URL(s.url).pathname);
  const src=sourceOf(file);if(!src||src.text==null)continue;
  const text=src.text,len=text.length,counts=new Int32Array(len+1).fill(-1);
  const ranges=s.functions.flatMap(fn=>fn.ranges.map((r,i)=>({...r,fn:i===0?fn.functionName:null})));
  ranges.sort((a,b)=>a.startOffset-b.startOffset||(b.endOffset-b.startOffset)-(a.endOffset-a.startOffset));
  for(const r of ranges)counts.fill(r.count,r.startOffset,Math.min(r.endOffset,len));
  const key=crypto.createHash('sha1').update(text.replace(/\/[^"']*\/\.sites-runtime\/[^/"']+\//g,'@/')).digest('hex');
  let e=per.get(src.rel);if(!e)per.set(src.rel,e={versions:new Map(),fns:new Map(),runs:0});e.runs++;
  let v=e.versions.get(key);if(!v){v={code:new Set(),cov:new Set(),runs:0};e.versions.set(key,v);
   let off=0;text.split('\n').forEach((line,i)=>{const t=line.trim();const first=off+line.length-line.trimStart().length;off+=line.length+1;
    if(!t||/^(\/\/|\/\*|\*|\}|\)|\]|;|,|import\s|export\s*\{\s*\}|\}\)|\]\))/.test(t))return;v.code.add(i);v.first=v.first||new Map();v.first.set(i,first);});}
  v.runs++;
  for(const i of v.code)if(counts[v.first.get(i)]>0)v.cov.add(i);
  for(const fn of s.functions){const n=fn.functionName;if(!n||n==='')continue;const c=fn.ranges[0].count>0;e.fns.set(n,(e.fns.get(n)||false)||c);}
 }
}
function list(dir){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(d=>d.isDirectory()?(d.name==='node_modules'?[]:list(path.join(dir,d.name))):[path.join(dir,d.name)]);}
const all=[...list('lib'),...list('app')].filter(f=>/\.(ts|tsx|mjs|cjs)$/.test(f)&&!f.endsWith('.d.ts'));
const rows=[];
for(const rel of all){const e=per.get(rel);const lines=fs.readFileSync(path.join(root,rel),'utf8').split('\n').length;
 if(!e){rows.push({rel,lines,loaded:false,pct:0,uncoveredFns:[]});continue;}
 const best=[...e.versions.values()].sort((a,b)=>b.runs-a.runs)[0];
 const pct=best.code.size?Math.round(1000*best.cov.size/best.code.size)/10:100;
 rows.push({rel,lines,loaded:true,runs:e.runs,pct,uncoveredFns:[...e.fns].filter(([,c])=>!c).map(([n])=>n)});}
fs.writeFileSync(path.join(here,'coverage.json'),JSON.stringify(rows,null,1));
const sum=(xs,f)=>xs.reduce((a,x)=>a+f(x),0);
const libRows=rows.filter(r=>r.rel.startsWith('lib/')),appRows=rows.filter(r=>r.rel.startsWith('app/')&&!/\/route\.ts$/.test(r.rel)),routeRows=rows.filter(r=>/\/route\.ts$/.test(r.rel));
for(const [name,xs] of [['lib',libRows],['app (screens)',appRows],['app/api routes',routeRows]]){
 const w=sum(xs,r=>r.lines),cov=sum(xs,r=>r.lines*r.pct/100);
 console.log(`${name}: files ${xs.length}, loaded by a unit test ${xs.filter(r=>r.loaded).length}, line coverage (weighted) ${(100*cov/w).toFixed(1)}%`);
}

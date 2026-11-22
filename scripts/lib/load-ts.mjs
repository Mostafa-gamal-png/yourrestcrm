// Loads the real TypeScript modules of the application for the unit tests that run them in Node: each file is transpiled with
// ts.transpileModule (as the build does, per file) into a folder of its own under .sites-runtime, its relative and `@/` imports
// are compiled the same way, and the folder is removed when the test ends. The coverage run (scripts/coverage/hook.mjs) keeps a copy of
// every file written under .sites-runtime, so the modules loaded here are measured. `replace` maps a bare or relative import to a file that
// the test writes (a stand-in for a module outside the unit).
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

export function createLoader(prefix,{replace={}}={}){
 const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
 fs.mkdirSync(runtime,{recursive:true});
 const out=fs.mkdtempSync(path.join(runtime,prefix+'-')),seen=new Set();
 process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
 const stubs=new Map();
 for(const [name,code] of Object.entries(replace)){const file=path.join(out,'stub-'+stubs.size+'.mjs');fs.writeFileSync(file,code);stubs.set(name,file);}
 function compile(relative){
  if(seen.has(relative))return;seen.add(relative);
  const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.(tsx?|mts)$/,'.mjs'));
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
   if(stubs.has(imp))return 'from '+JSON.stringify(stubs.get(imp));
   if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
   let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
   if(/\.json$/.test(source)){const target=path.join(out,source);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,source),target);return 'from '+JSON.stringify(target)+' with {type:"json"}';}
   if(/\.mjs$/.test(source)&&!fs.existsSync(path.join(root,source.replace(/\.mjs$/,'.mts'))))return 'from '+JSON.stringify(pathToFileURL(path.join(root,source)).href);
   if(/\.mjs$/.test(source))source=source.replace(/\.mjs$/,'.mts');
   else if(!/\.(tsx?|mts)$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
   compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.(tsx?|mts)$/,'.mjs')));
  });
  code=code.replace(/^import\s+(['"])[^'"]+\.css\1;?$/mg,'');
  fs.writeFileSync(dest,code);
 }
 return {out,load:async relative=>{compile(relative);return import(pathToFileURL(path.join(out,relative.replace(/\.(tsx?|mts)$/,'.mjs'))));}};
}

/** The counters every unit test of this kind uses. */
export function makeChecks(assert){
 const state={checks:0};
 return {
  state,
  eq:(a,b,m)=>{assert.deepEqual(a,b,m);state.checks++;},
  ok:(v,m)=>{assert.ok(v,m);state.checks++;},
  throws:(fn,m)=>{assert.throws(fn,m);state.checks++;},
  async rejects(promise,m){await assert.rejects(promise,m);state.checks++;},
  report:()=>console.log(JSON.stringify({ok:true,checks:state.checks}))
 };
}

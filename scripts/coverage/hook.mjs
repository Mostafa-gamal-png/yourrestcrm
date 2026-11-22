// Preloaded with --import: keeps a copy of every module a test transpiles into .sites-runtime, so V8 coverage of a temporary file can be read later.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const keep=process.env.COVSAVE_DIR;
if(keep){
 fs.mkdirSync(keep,{recursive:true});
 const orig=fs.writeFileSync;
 fs.writeFileSync=function(file,data,...rest){
  const r=orig.call(this,file,data,...rest);
  try{const f=String(file);if(f.includes('/.sites-runtime/')&&/\.(mjs|js|cjs)$/.test(f)){const h=crypto.createHash('sha1').update(f).digest('hex');orig(path.join(keep,h+'.js'),data);fs.appendFileSync(path.join(keep,'index.tsv'),h+'\t'+f+'\n');}}catch{}
  return r;
 };
}

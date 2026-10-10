// Scoped dependency policy and an offline Wrangler bundle; never deploys or starts a server.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=process.env.DEPENDENCY_TEST_ROOT||fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(resolve(root,'package.json'));
const plugin=createRequire(realpathSync(join(root,'node_modules/@cloudflare/vite-plugin/package.json')));
const wranglers=[require,plugin].map(from=>createRequire(from.resolve('wrangler/package.json')));
let checks=0;
const versions=[];
for(const scoped of wranglers){
 const version=scoped('esbuild').version;versions.push(version);
 if(!process.argv.includes('--compatibility-only')){
  const [major,minor,patch]=version.split('.').map(Number);
  assert(major===0&&minor===28&&patch>=1,`Wrangler must use the tested patched esbuild 0.28.x line, >=0.28.1; found ${version}`);checks++;
 }
}
const scratch=mkdtempSync(join(tmpdir(),'yourrest-wrangler-compat-'));
try{
 writeFileSync(join(scratch,'package.json'),JSON.stringify({type:'module'}));
 writeFileSync(join(scratch,'values.ts'),'export enum Region { West = "west" }; export const count: number = 4;\n');
 writeFileSync(join(scratch,'worker.ts'),`import {Region,count} from './values';
export default {fetch(request: Request) {return Response.json({region:Region.West,count,path:new URL(request.url).pathname});}};
`);
 const config=join(scratch,'wrangler.json');
 writeFileSync(config,JSON.stringify({name:'yourrest-compatibility-only',main:'worker.ts',compatibility_date:'2026-05-01',send_metrics:false}));
 const out=join(scratch,'bundle');
 const cli=join(dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
 const env={...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'error',CI:'true',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',WRANGLER_LOG_PATH:join(scratch,'wrangler.log')};
 const bundle=spawnSync(process.execPath,[cli,'deploy','--dry-run','--config',config,'--outdir',out],{cwd:scratch,env,encoding:'utf8',timeout:60000});
 assert.equal(bundle.status,0,bundle.stdout+'\n'+bundle.stderr);checks++;
 const files=readdirSync(out);assert(files.includes('worker.js'));checks++;
 const built=readFileSync(join(out,'worker.js'),'utf8');
 assert.match(built,/west/);checks++;
 assert.doesNotMatch(built,/from ['"]\.\/values/);checks++;
 const module=await import(pathToFileURL(join(out,'worker.js')).href);
 const response=await module.default.fetch(new Request('https://example.invalid/customer'));
 assert.equal(response.status,200);checks++;
 assert.deepEqual(await response.json(),{region:'west',count:4,path:'/customer'});checks++;
 console.log(JSON.stringify({ok:true,checks,versions,compatibilityOnly:process.argv.includes('--compatibility-only'),dryRun:true,deployed:false,exploitReproduction:false}));
}finally{rmSync(scratch,{recursive:true,force:true});}

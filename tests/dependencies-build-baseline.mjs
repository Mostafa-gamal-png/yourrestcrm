// Dependency-policy and ordinary compatibility checks, not exploit payloads.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {once} from 'node:events';

const root=process.env.DEPENDENCY_TEST_ROOT||fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(resolve(root,'package.json'));
let checks=0;
const atLeast=(name,version,major,minor,patch)=>{
 const parts=version.split('.').map(Number);
 assert(parts[0]===major&&(parts[1]>minor||(parts[1]===minor&&parts[2]>=patch)),`${name} must use the patched ${major}.x line, >=${major}.${minor}.${patch}; found ${version}`);checks++;
};
const esbuild=require('esbuild');
const viteVersion=require('vite/package.json').version;
atLeast('esbuild (GHSA-g7r4-m6w7-qqqr)',esbuild.version,0,28,1);
atLeast('vite (GHSA-fx2h-pf6j-xcff)',viteVersion,8,0,16);
const wranglerRequire=createRequire(require.resolve('wrangler'));
const miniflareRequire=createRequire(wranglerRequire.resolve('miniflare'));
const pluginRequire=createRequire(realpathSync(resolve(root,'node_modules/@cloudflare/vite-plugin/package.json')));
const undiciVersion=miniflareRequire('undici/package.json').version;
atLeast('miniflare/undici (September 2026 advisories)',undiciVersion,7,29,1);
for(const [name,scopedRequire] of [['miniflare',miniflareRequire],['@cloudflare/vite-plugin',pluginRequire]]){
 atLeast(`${name}/ws (GHSA-96hv-2xvq-fx4p)`,scopedRequire('ws/package.json').version,8,21,0);
}
const code='export const sum = ({a,b}: {a:number,b:number}) => a+b;';
const compile=await esbuild.transform(code,{loader:'ts',format:'esm',target:'es2019'});
const evaluated=await import('data:text/javascript;base64,'+Buffer.from(compile.code).toString('base64'));
assert.equal(evaluated.sum({a:2,b:3}),5);checks++;
const vite=await import(pathToFileURL(require.resolve('vite')));
const compiled=await vite.transformWithEsbuild(code,'ordinary.ts',{loader:'ts',format:'esm',target:'es2019'});
const evaluatedVite=await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));
assert.equal(evaluatedVite.sum({a:4,b:5}),9);checks++;
const {MockAgent,fetch}=miniflareRequire('undici');
const agent=new MockAgent();agent.disableNetConnect();
try{
 agent.get('https://dependency.invalid').intercept({path:'/ordinary',method:'GET'}).reply(200,{ok:true},{headers:{'content-type':'application/json'}});
 const response=await fetch('https://dependency.invalid/ordinary',{dispatcher:agent});
 assert.equal(response.status,200);checks++;
 assert.deepEqual(await response.json(),{ok:true});checks++;
 agent.assertNoPendingInterceptors();checks++;
}finally{await agent.close();}
const {WebSocket,WebSocketServer}=miniflareRequire('ws');
const server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:1024});
let client;
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),5000);
try{
 await once(server,'listening',{signal:controller.signal});
 server.on('connection',socket=>socket.on('message',data=>socket.send(data)));
 client=new WebSocket(`ws://127.0.0.1:${server.address().port}`);
 await once(client,'open',{signal:controller.signal});
 const received=once(client,'message',{signal:controller.signal});
 client.send('ordinary fixture');
 const [message]=await received;
 assert.equal(message.toString(),'ordinary fixture');checks++;
}finally{
 clearTimeout(timer);client?.terminate();
 for(const socket of server.clients)socket.terminate();
 await new Promise(done=>server.close(done));
}
console.log(JSON.stringify({ok:true,checks,esbuild:esbuild.version,vite:viteVersion,undici:undiciVersion,exploitReproduction:false}));

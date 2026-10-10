// Dependency-policy regression for the published React RSC advisory, followed
// by ordinary SSR/decoder compatibility checks. This is not an exploit test.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url);
let checks=0;
const versions=['react','react-dom','react-server-dom-webpack'].map(name=>{
 const version=require(name+'/package.json').version;
 const [major,minor,patch]=version.split('.').map(Number);
 assert(major===19&&minor===2&&patch>=8,
  `${name} must use the patched 19.2 line (>=19.2.8) for GHSA-wx67-qw84-cm4g; found ${version}`);
 checks++;return version;
});
assert.equal(new Set(versions).size,1,'The React renderer and RSC decoder stay on the same release');checks++;
assert.equal(renderToStaticMarkup(createElement('p',null,'Yourrest review')), '<p>Yourrest review</p>');checks++;
const child=spawnSync(process.execPath,['--conditions=react-server','--input-type=module','-e',`
 import assert from 'node:assert/strict';
 import {decodeReply,decodeAction} from 'react-server-dom-webpack/server.node';
 assert.deepEqual(await decodeReply(JSON.stringify({message:'ordinary fixture',count:2}),{}),{message:'ordinary fixture',count:2});
 assert.equal(await decodeAction(new FormData(),{}),null);
 console.log('benign RSC round-trip passed');
`],{cwd:process.cwd(),encoding:'utf8',timeout:10000,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=128'}});
assert.equal(child.status,0,child.stderr);checks++;
assert.match(child.stdout,/benign RSC round-trip passed/);checks++;
console.log(JSON.stringify({ok:true,checks,versions,advisory:'GHSA-wx67-qw84-cm4g',exploitReproduction:false}));

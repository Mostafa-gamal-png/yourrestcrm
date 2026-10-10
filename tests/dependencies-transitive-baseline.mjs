// Scoped dependency policy plus small ordinary API round trips. No attack data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=process.env.DEPENDENCY_TEST_ROOT||fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(resolve(root,'package.json'));
const packagePath=(name,from=require)=>{
 for(const base of from.resolve.paths(name)||[]){
  const path=join(base,name,'package.json');
  if(existsSync(path))return realpathSync(path);
 }
 throw new Error(`Cannot resolve ${name} from ${from.resolve.paths(name)}`);
};
const scope=(name,from=require)=>createRequire(packagePath(name,from));
const version=(name,from=require)=>JSON.parse(readFileSync(packagePath(name,from),'utf8')).version;
let checks=0;
const versions={};
const atLeast=(name,from,major,minor,patch)=>{
 const found=version(name,from),parts=found.split('.').map(Number);
 assert(parts[0]===major&&(parts[1]>minor||(parts[1]===minor&&parts[2]>=patch)),`${name} must retain major ${major} and use >=${major}.${minor}.${patch}; found ${found}`);checks++;
 versions[`${name}@${major}`]=found;
};
const next=scope('next'),vinext=scope('vinext'),eslint=scope('eslint');
const styled=scope('styled-jsx',next),babel=scope('@babel/core',styled);
const targetHelpers=scope('@babel/helper-compilation-targets',babel);
const yamlOwner=scope('@eslint/eslintrc',eslint);
const minimatch1=scope('minimatch',eslint);
const ts=scope('@typescript-eslint/typescript-estree',scope('@typescript-eslint/parser',scope('typescript-eslint',scope('eslint-config-next'))));
const minimatch5=scope('minimatch',ts);
const opentype=scope('@shuding/opentype.js',scope('satori',scope('@vercel/og',vinext)));
const ajv=scope('ajv',scope('@hookform/resolvers'));
const tsx=scope('tsx',scope('vite'));
atLeast('@babel/core',styled,7,29,6);
atLeast('brace-expansion',minimatch1,1,1,21);
atLeast('brace-expansion',minimatch5,5,0,12);
atLeast('js-yaml',yamlOwner,4,3,2);
atLeast('browserslist',targetHelpers,4,28,7);
atLeast('baseline-browser-mapping',next,2,11,0);
atLeast('fflate',opentype,0,7,5);
assert.equal(version('fflate'),'0.8.3','The independent ERP ZIP parser is not downgraded');checks++;
atLeast('image-size',vinext,2,0,3);
atLeast('fast-uri',ajv,3,1,8);
atLeast('esbuild',tsx,0,28,1);

const transformed=styled('@babel/core').transformSync('export const total = 2 + 3;',{configFile:false,babelrc:false});
const evaluated=await import('data:text/javascript;base64,'+Buffer.from(transformed.code).toString('base64'));
assert.equal(evaluated.total,5);checks++;
for(const owner of [minimatch1,minimatch5]){
 const expansion=owner('brace-expansion');
 const expand=typeof expansion==='function'?expansion:expansion.expand;
 assert.deepEqual(expand('customer-{1..3}'),['customer-1','customer-2','customer-3']);checks++;
}
const yaml=yamlOwner('js-yaml');
const parsed=yaml.load('defaults: &defaults\n  region: west\ncustomer:\n  <<: *defaults\n  count: 2\n');
assert.deepEqual(parsed.customer,{region:'west',count:2});checks++;
assert.deepEqual(yaml.load(yaml.dump(parsed)),parsed);checks++;
assert.deepEqual(targetHelpers('browserslist')('chrome 120'),['chrome 120']);checks++;
const mapped=next('baseline-browser-mapping').getCompatibleVersions({targetYear:2023});
assert(mapped.some(item=>item.browser==='chrome'&&Number(item.version)>=120));checks++;
const zip=opentype('fflate');
const fixture=zip.zipSync({'ordinary.txt':zip.strToU8('ordinary fixture')});
assert.equal(zip.strFromU8(zip.unzipSync(fixture)['ordinary.txt']),'ordinary fixture');checks++;
const dimensions=vinext('image-size').imageSize(readFileSync(resolve(root,'public/icons/icon-192.png')));
assert.equal(dimensions.width,192);checks++;
assert.equal(dimensions.height,192);checks++;
const uri=ajv('fast-uri');
assert.equal(uri.parse('https://example.invalid/customer').host,'example.invalid');checks++;
assert(uri.equal('https://EXAMPLE.invalid/customer','https://example.invalid/customer'));checks++;
const bundled=await tsx('esbuild').transform('export const value: number = 4;',{loader:'ts',format:'esm',target:'es2019'});
const imported=await import('data:text/javascript;base64,'+Buffer.from(bundled.code).toString('base64'));
assert.equal(imported.value,4);checks++;
console.log(JSON.stringify({ok:true,checks,versions,exploitReproduction:false}));

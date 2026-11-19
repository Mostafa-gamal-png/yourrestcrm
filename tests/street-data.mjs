// «بيانات شوارع محلية» (the owner, 2026-11-19: the port of GSCO 2.13.82): the street data file and its two tools, on made-up streets only and
// with no network. scripts/streets/build-street-data.mjs: the features osmium exports become the compact file (only the server's street kinds,
// no «area=yes», each way once, the Arabic and English names), run end to end with a stand-in for the osmium program (its calls checked: one
// extract pass with a 0.02° margin, the street kinds, a GeoJSON export). portable/import-street-data.mjs: the file read and checked (format,
// system, sha256, the 0.01° grid, the Kingdom, overlaps and sizes), a dry run that writes nothing (the database's bytes unchanged), --apply in
// one transaction, twice giving the same rows, --regions replacing one region only, --verify, --remove (dry run, a region, --all), --settings
// naming the database, and the refusals (another application's database, a database before 0024, another system's file, a bad file, a database
// that is not there is never created); the rows read by the server's own code (lib/work-area-streets.ts: the cell's key, the compact form, a
// street cut at every cell border without loss, and lib/work-areas-server.ts localStreets: a covered box «complete»).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import ts from 'typescript';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import * as I from '../portable/import-street-data.mjs';
import {build,parseArgs as buildArgs,parseRegion,streetFileFromFeatures,MARGIN} from '../scripts/streets/build-street-data.mjs';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-street-data-')),out=fs.mkdtempSync(path.join(runtime,'street-data-'));
process.on('exit',()=>{fs.rmSync(work,{recursive:true,force:true});fs.rmSync(out,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const rejects=async(promise,pattern,message)=>{await assert.rejects(promise,pattern,message);checks++;};
const throws=(fn,pattern,message)=>{assert.throws(fn,pattern,message);checks++;};
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// The server's own street code, compiled as the build does.
const seen=new Set();
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
globalThis.testEnv={};fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');fs.writeFileSync(path.join(out,'auth.mjs'),'export async function getApplicationUser(){return null;}');
compile('lib/work-area-streets.ts');compile('lib/work-areas-server.ts');
const St=await import(pathToFileURL(path.join(out,'lib/work-area-streets.mjs'))),Server=await import(pathToFileURL(path.join(out,'lib/work-areas-server.mjs')));
const G=await import(pathToFileURL(path.join(out,'lib/work-area-geometry.mjs')));

// ---- 1. Made-up streets, as osmium exports them (GeoJSON lines, [longitude, latitude]).
const regions=[parseRegion('eastern-1:26.40,50.05,26.46,50.12:Dammam'),parseRegion('central-1:24.70,46.70,24.73,46.74')];
eq(regions[0],{id:'eastern-1',south:26.4,west:50.05,north:26.46,east:50.12,name:'Dammam'},'a region: id, its box on the grid, a name');
throws(()=>parseRegion('Eastern:1,2,3,4'),/Bad region/,'an id of small letters');
const line=(id,highway,coords,tags={})=>({type:'Feature',properties:{'@id':id,highway,...tags},geometry:{type:'LineString',coordinates:coords.map(([lat,lng])=>[lng,lat])}});
const crossing=[[26.4205,50.0605],[26.4255,50.0705],[26.4305,50.0805],[26.4305,50.0955]];
const features={'eastern-1':[
 line(1,'residential',crossing,{'name:ar':'شارع العبور','name':'Crossing Street','name:en':'Crossing Street'}),
 line(2,'primary',[[26.441,50.081],[26.449,50.081]],{name:'طريق الملك'}),
 line(3,'motorway',[[26.41,50.06],[26.42,50.07]]),
 line(4,'residential',[[26.43,50.09],[26.431,50.091],[26.43,50.09]],{area:'yes'}),
 line(2,'primary',[[26.441,50.081],[26.449,50.081]],{name:'طريق الملك'}),
 line(5,'living_street',[[26.4555,50.1155],[26.4555,50.1155]]),
],'central-1':[line(9,'tertiary',[[24.705,46.705],[24.725,46.735]],{'name:en':'Central Road'})]};
const {data,perRegion}=streetFileFromFeatures({regions,features,system:'yourrest-crm',dataset:'osm:made-up@2026-11-18T00:00:00Z',source:{name:'made-up'},createdAt:'2026-11-19T00:00:00.000Z'});
eq(perRegion,{'eastern-1':{features:6,kept:2,areaYes:1,otherKind:1,duplicate:1},'central-1':{features:1,kept:1,areaYes:0,otherKind:0,duplicate:0}},'only the server\'s kinds, no area=yes, each way once, a line of one point dropped');
eq(data.names,['شارع العبور','Crossing Street','طريق الملك','Central Road'],'the Arabic name first (name:ar, else name), the English name');
eq(data.ways[0].slice(0,4),[0,1,2642050,5006050],'names by index, the first point in 1e-5 degree, then differences');
const file=path.join(work,'streets.json.gz');fs.writeFileSync(file,zlib.gzipSync(Buffer.from(JSON.stringify(data))));
const sha=digest(file);

// ---- 2. The file, read and checked.
const read=I.readStreetFile(file,{expectSha256:sha});
eq([read.system,read.dataset,read.regions.map(r=>[r.id,r.count]),read.ways.length],['yourrest-crm','osm:made-up@2026-11-18T00:00:00Z',[['eastern-1',42],['central-1',12]],3],'two regions of 42 and 12 cells, three streets');
throws(()=>I.readStreetFile(file,{expectSha256:'0'.repeat(64)}),/sha256/,'another sha256 is refused');
const variant=(name,change)=>{const copy=JSON.parse(JSON.stringify(data));change(copy);const target=path.join(work,name+'.json.gz');fs.writeFileSync(target,zlib.gzipSync(Buffer.from(JSON.stringify(copy))));return target;};
for(const [name,change,pattern] of [
 ['format',d=>{d.format='gsco-street-data';},/Not a yourrest-street-data/],
 ['grid',d=>{d.regions[0].south=26.405;},/0\.01° grid/],
 ['outside',d=>{d.regions[1]={id:'abroad',south:40,west:50,north:40.1,east:50.1};},/outside Saudi Arabia/],
 ['overlap',d=>{d.regions[1]={id:'again',south:26.45,west:50.1,north:26.5,east:50.2};},/overlap/],
 ['large',d=>{d.regions[1]={id:'large',south:20,west:40,north:21.5,east:41.5};},/too large/],
 ['many',d=>{d.regions=Array.from({length:3},(_,i)=>({id:'r'+i,south:20+i*1.3,west:40,north:21.2+i*1.3,east:41.4}));},/more than 40000 cells/],
 ['kinds',d=>{d.highways=['primary'];},/other street kinds/],
 ['scale',d=>{d.scale=1e6;},/scale/],
 ['name',d=>{d.ways[0][0]=99;},/name index/],
 ['coordinate',d=>{d.ways[0][2]=1.5;},/coordinate/i],
 ['same',d=>{d.regions[1].id='eastern-1';},/share an id/],
])throws(()=>I.readStreetFile(variant(name,change)),pattern,'a bad file is refused: '+name);
const half=path.join(work,'half.json.gz');fs.writeFileSync(half,fs.readFileSync(file).subarray(0,40));
throws(()=>I.readStreetFile(half),/whole gzip/,'a file cut short is refused');

// ---- 3. The rows: every cell of the regions, the streets cut at the cells' borders, read by the server's code.
const built=I.buildRows(read,{importedAt:'2026-11-20T08:00:00.000Z'});
eq([built.rows.length,built.regions.map(r=>[r.id,r.cells,r.cellsWithStreets])],[54,[['eastern-1',42,6],['central-1',12,6]]],'54 rows, 12 of them with streets; an empty cell is kept (so the region counts as covered)');
for(const row of built.rows){if(St.cellKey(row.cell_lat,row.cell_lng)!==row.bbox_key||!St.decodeStreets(row.ways))throw Error('row '+row.bbox_key);}
checks++;
const pieces=built.rows.flatMap(row=>St.decodeStreets(row.ways).filter(w=>w.name==='شارع العبور').map(w=>({cell:[row.cell_lat,row.cell_lng],points:w.points})));
ok(pieces.every(p=>p.points.every(([lat,lng])=>lat>=p.cell[0]/100-1e-9&&lat<=(p.cell[0]+1)/100+1e-9&&lng>=p.cell[1]/100-1e-9&&lng<=(p.cell[1]+1)/100+1e-9)),'each piece lies in its own cell');
ok(Math.abs(pieces.reduce((n,p)=>n+G.polylineMetres(p.points),0)-G.polylineMetres(crossing))<1,'joined end to end the pieces are the street (within a metre)');
eq(pieces.map(p=>p.cell.join(':')),['2642:5006','2642:5007','2643:5007','2643:5008','2643:5009'],'the crossing street is cut where it crosses a cell border: one piece in each of its five cells');

// ---- 4. The database: this application's, after 0024.
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
const makeDatabase=(name,upTo='9999')=>{const target=path.join(work,name+'.sqlite'),db=new DatabaseSync(target);db.exec('PRAGMA journal_mode=WAL');db.exec('CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');for(const m of migrations.filter(m=>m<=upTo)){db.exec(fs.readFileSync(path.join(root,'drizzle',m),'utf8'));db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').run(m,'x','t');}db.close();return target;};
const dbFile=makeDatabase('app');
const rows=target=>{const db=new DatabaseSync(target,{readOnly:true});try{return db.prepare('SELECT bbox_key,cell_lat,cell_lng,south,west,north,east,ways,way_count,region,dataset FROM crm_osm_street_local ORDER BY bbox_key').all().map(r=>({...r}));}finally{db.close();}};
const before=digest(dbFile);
const dry=await I.main(['--db',dbFile,'--file',file,'--sha256',sha]);
eq([dry.ok,dry.mode,dry.readOnly,dry.rows,dry.lastMigration,dry.file.streets,dry.before,dry.wouldWrite.map(r=>r.cells)],[true,'dry-run',true,54,'0024_local_streets.sql',3,[],[42,12]],'the dry run says what it would write');
eq(digest(dbFile),before,'and writes nothing');
const applied=await I.main(['--db',dbFile,'--file',file,'--apply']);
eq([applied.mode,applied.rowsWritten,applied.removedBefore,applied.regions.map(r=>[r.region,r.cells,r.cellsWithStreets,r.pieces])],['apply',54,0,[['central-1',12,6,6],['eastern-1',42,6,6]]],'--apply writes every cell in one transaction');
ok(applied.lockMs<5000,'the lock is held briefly');
const once=rows(dbFile);
eq((await I.main(['--db',dbFile,'--file',file,'--apply'])).removedBefore,54,'again: the regions\' rows are replaced');
eq(rows(dbFile),once,'running it twice gives the same rows');
// The server reads them: a box whose every cell is imported is complete.
const sqlite=new DatabaseSync(dbFile,{readOnly:true});
const statement=(q,a)=>({bind:(...b)=>statement(q,b),all:async()=>({results:sqlite.prepare(q).all(...a)}),first:async()=>sqlite.prepare(q).get(...a)||null}),D1={prepare:q=>statement(q,[])};
const local=await Server.localStreets(D1,{south:26.42,west:50.06,north:26.44,east:50.08});
eq([local.complete,local.imported_at.length>10,local.ways.every(w=>Array.isArray(w.points))],[true,true,true],'a box of four imported cells is complete');
eq((await Server.localStreets(D1,{south:26.45,west:50.11,north:26.47,east:50.13})).complete,false,'a box on the region\'s edge is not');
eq(await Server.localStreets(D1,{south:21.4,west:39.1,north:21.42,east:39.12}),null,'outside every region: nothing local');
sqlite.close();
// One region replaced, the other untouched.
const central=variant('central',d=>{d.dataset='osm:newer';});
eq((await I.main(['--db',dbFile,'--file',central,'--regions','central-1','--apply'])).removedBefore,12,'--regions replaces that region only');
const after=rows(dbFile);
eq([after.filter(r=>r.region==='central-1').every(r=>r.dataset==='osm:newer'),after.filter(r=>r.region==='eastern-1')],[true,once.filter(r=>r.region==='eastern-1')],'the other region\'s rows unchanged');
await rejects(I.main(['--db',dbFile,'--file',file,'--regions','western-1']),/no region western-1/,'a region the file does not have');
const verify=await I.main(['--db',dbFile,'--verify']);
eq([verify.mode,verify.readOnly,verify.totalCells,verify.cacheBoxes,verify.regions.map(r=>[r.region,r.cells,r.dataset])],['verify',true,54,0,[['central-1',12,'osm:newer'],['eastern-1',42,'osm:made-up@2026-11-18T00:00:00Z']]],'--verify counts per region, read-only');
const removeDry=await I.main(['--db',dbFile,'--remove','--regions','central-1']);
eq([removeDry.mode,removeDry.wouldRemove.map(r=>r.region),rows(dbFile).length],['remove-dry-run',['central-1'],54],'--remove without --apply removes nothing');
eq((await I.main(['--db',dbFile,'--remove','--regions','central-1','--apply'])).removed,12,'a region removed');
eq((await I.main(['--db',dbFile,'--remove','--all','--apply'])).removed,42,'--all removes the rest');
eq(rows(dbFile),[],'nothing local left; the map goes back to Overpass');
// --settings names the database as settings.cjs does.
const settings=path.join(work,'settings.cjs');fs.writeFileSync(settings,'module.exports={YR_DATABASE_PATH:'+JSON.stringify(dbFile)+'};');
eq((await I.main(['--settings',settings,'--file',file,'--apply'])).database,fs.realpathSync(dbFile),'--settings: the database of settings.cjs');

// ---- 5. Refusals.
await rejects(I.main(['--db',makeDatabase('before-0024','0023_work_areas.sql'),'--file',file]),/migration 0024_local_streets\.sql is not recorded/,'a database before 0024 is refused');
const foreign=path.join(work,'foreign.sqlite');{const db=new DatabaseSync(foreign);db.exec('CREATE TABLE gsco_schema_migrations(name TEXT)');db.close();}
await rejects(I.main(['--db',foreign,'--file',file]),/Not a Yourrest CRM database/,'another application\'s database is refused');
const changed=makeDatabase('changed');{const db=new DatabaseSync(changed);db.exec('DROP TABLE crm_osm_street_local;CREATE TABLE crm_osm_street_local(bbox_key TEXT PRIMARY KEY,ways TEXT)');db.close();}
await rejects(I.main(['--db',changed,'--file',file]),/not as migration 0024/,'a changed table is refused');
await rejects(I.main(['--db',dbFile,'--file',variant('gsco',d=>{d.system='gsco-invest';})]),/for gsco-invest, not for yourrest-crm/,'another system\'s file is refused');
const missing=path.join(work,'missing.sqlite');
await rejects(I.main(['--db',missing,'--file',file,'--apply']),/No database/,'a database that is not there');
eq(fs.existsSync(missing),false,'is never created');
for(const [args,pattern] of [[['--db',dbFile,'--verify','--apply'],/only reads/],[['--db',dbFile,'--nope'],/Unknown option/],[['--db',dbFile,'--remove'],/--regions a,b\) or --all/],[['--db',dbFile,'--all','--file',file],/--all goes with --remove/],[['--db',dbFile,'--settings',settings],/once/],[['--db',dbFile,'--sha256','xyz','--file',file],/64 hex/],[['--db',dbFile],/street data file/],[[],/Name the database/]])await rejects(I.main(args),pattern,'refused: '+args.join(' '));
// The command line: one JSON answer, exit 0, or the reason and exit 1.
const cli=args=>spawnSync(process.execPath,['--no-warnings',path.join(root,'portable/import-street-data.mjs'),...args],{encoding:'utf8'});
const good=cli(['--db',dbFile,'--verify']),bad=cli(['--db',dbFile,'--file',half]);
eq([good.status,JSON.parse(good.stdout).ok,bad.status,JSON.parse(bad.stdout)],[0,true,1,{ok:false,tool:'import-street-data',error:'The street data file is not a whole gzip file.'}],'the command line answers in one JSON object');

// ---- 6. The build tool end to end, with a stand-in for osmium (no network, no extract: the stand-in writes the export from made-up features).
const fake=path.join(work,'osmium'),calls=path.join(work,'osmium-calls.jsonl'),fixtures=path.join(work,'features.json');
fs.writeFileSync(fixtures,JSON.stringify(features));
fs.writeFileSync(fake,`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args[0]==='fileinfo'){console.log('2026-11-18T21:21:02Z');process.exit(0);}
if(args[0]==='extract'){const config=JSON.parse(fs.readFileSync(args[args.indexOf('-c')+1],'utf8'));for(const e of config.extracts)fs.writeFileSync(path.join(config.directory,e.output),'pbf');process.exit(0);}
if(args[0]==='tags-filter'){fs.writeFileSync(args[args.indexOf('-o')+1],'pbf');process.exit(0);}
if(args[0]==='export'){const target=args[args.indexOf('-o')+1],id=path.basename(target,'.geojsonseq'),all=JSON.parse(fs.readFileSync(${JSON.stringify(fixtures)},'utf8'));fs.writeFileSync(target,(all[id]||[]).map(f=>'\\x1e'+JSON.stringify(f)).join('\\n')+'\\n');process.exit(0);}
process.exit(3);
`,{mode:0o755});
const pbf=path.join(work,'gcc-states-261118.osm.pbf');fs.writeFileSync(pbf,'made-up extract');
const target=path.join(work,'out','streets-yourrest.json.gz');
const result=await build(buildArgs(['--pbf',pbf,'--out',target,'--region','eastern-1:26.40,50.05,26.46,50.12:Dammam','--region','central-1:24.70,46.70,24.73,46.74','--osmium',fake,'--work',path.join(work,'osm')]));
eq([result.ok,result.system,result.dataset,result.osmDataUpTo,result.streets,result.rows,result.regions.map(r=>r.cells)],[true,'yourrest-crm','osm:gcc-states-261118@2026-11-18T21:21:02Z','2026-11-18T21:21:02Z',3,54,[42,12]],'one file for both regions, named by the extract and its date');
eq(fs.readFileSync(target+'.sha256','utf8'),result.sha256+'  streets-yourrest.json.gz\n','its sha256 beside it');
const osmium=fs.readFileSync(calls,'utf8').trim().split('\n').map(l=>JSON.parse(l));
eq(osmium.map(a=>a[0]),['fileinfo','extract','tags-filter','export','tags-filter','export'],'one extract pass for every region, then the streets and the export of each');
const extracts=JSON.parse(fs.readFileSync(path.join(work,'osm','extracts.json'),'utf8')).extracts;
eq(extracts.map(e=>e.bbox.map(v=>Math.round(v*100)/100)),[[50.05-MARGIN,26.4-MARGIN,50.12+MARGIN,26.46+MARGIN].map(v=>Math.round(v*100)/100),[46.68,24.68,46.76,24.75]],'each region cut with a 0.02° margin');
ok(osmium[2].includes('w/highway=primary,secondary,tertiary,unclassified,residential,living_street'),'only the street kinds the server asks Overpass for');
eq((await I.main(['--db',makeDatabase('built'),'--file',target,'--sha256',result.sha256,'--apply'])).rowsWritten,54,'and the importer takes the file');
await rejects(build(buildArgs(['--pbf',pbf,'--out',path.join(work,'x.json.gz'),'--region','eastern-1:26.40,50.05,26.46,50.12','--osmium',path.join(work,'no-osmium')])),/osmium is not available/,'without osmium the build stops with the reason');
throws(()=>buildArgs(['--pbf',pbf,'--out',target]),/at least one --region/,'a region is needed');

console.log(JSON.stringify({ok:true,checks}));

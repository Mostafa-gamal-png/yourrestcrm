#!/usr/bin/env node
// «بيانات شوارع محلية» (the owner, 2026-11-19: the port of GSCO 2.13.82 tools/import-street-data.mjs): local street data for the factory map's
// «شارع بلا عملاء» marks. The public Overpass services answered 502 or nothing on 2026-11-19, so the streets of the regions where Yourrest has
// customers are taken once from an OpenStreetMap extract (cut and compacted by scripts/streets/build-street-data.mjs, off the host: the host
// has no osmium) and written here into crm_osm_street_local, one row per 0.01° cell, keyed and encoded exactly as the server keys and caches an
// Overpass box (lib/work-area-streets.ts: streetBox, boxCells, cellKey, encodeStreets). The server prefers these rows and asks Overpass only
// for a box outside the imported regions. Rows never expire; the server's 90-day cache cleanup never touches them. The data travels as ONE
// file (the hosting account is close to its file limit) and becomes rows of the existing database: no file is left behind but the one copied.
// Shipped with every release as release/operations/import-street-data.mjs; self-contained (Node's own modules only).
//
//   node import-street-data.mjs --db <database.sqlite> | --settings <yourrest-crm/settings.cjs>  --file <streets.json.gz> [--regions a,b] [--sha256 <hex>]
//       dry run (the default): reads the file and the database read-only, prints the target database, what would be written per region
//       and what is there now. Writes nothing.
//   ... --apply      writes every cell of the file's regions (or --regions) in ONE transaction: the regions' old rows are replaced, so running
//                    it twice gives the same rows. Refuses a database that is not this application's, or not after migration 0024.
//   node import-street-data.mjs --db <database.sqlite> --verify
//                    read-only: local street rows per region (cells, cells with streets, street pieces, import date) and the cache's boxes.
//   node import-street-data.mjs --db <database.sqlite> --remove --regions a,b|--all [--apply]
//                    removes local rows (a dry run unless --apply); the map then goes back to Overpass for those boxes.
// Safe while the application runs: the database is in WAL mode (readers never wait), the rows are prepared before the write lock is taken,
// and the lock is held only for the inserts (well under a second for a city); the application's own writes wait for it (busy_timeout 5 s).
// Every answer is one JSON object on stdout; a refusal exits 1 and writes nothing. No YR_* variable is read or set: --settings reads the file.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

/** This application, as its database proves it: the migration ledger must hold the work-area and local-street migrations. */
export const APP={id:'yourrest-crm',name:'Yourrest CRM',ledgerTable:'yr_schema_migrations',requiredMigrations:['0023_work_areas.sql','0024_local_streets.sql'],cacheTable:'crm_osm_street_cache'};
export const FORMAT='yourrest-street-data',FORMAT_VERSION=1;
/** Coordinates in the file are whole units of 1e-5 degree (about 1.1 m); a cell is 0.01 degree = 1000 units. */
export const SCALE=100000,CELL_UNITS=1000,CELLS_PER_DEGREE=100;
/** Exactly the kinds the server's Overpass query asks for (STREET_HIGHWAYS in lib/work-area-streets.ts). */
export const STREET_HIGHWAYS=['primary','secondary','tertiary','unclassified','residential','living_street'];
/** The Kingdom with a small margin (SAUDI_BOUNDS in lib/work-area-geometry.ts). */
export const SAUDI_BOUNDS={south:16,west:34.4,north:32.3,east:55.7};
/** A region of at most 20 000 cells (about 1.4° × 1.4°), and a file of at most 40 000 cells (about 80 MB of rows): the database is copied
 *  by every nightly backup. */
export const MAX_NAME_LENGTH=120,MAX_FILE_BYTES=64*1024*1024,MAX_DATA_BYTES=512*1024*1024,MAX_REGION_CELLS=20000,MAX_FILE_CELLS=40000,MAX_REGIONS=30;
export const TABLE='crm_osm_street_local';
export const TABLE_SHAPE=[['bbox_key','TEXT',1,1],['cell_lat','INTEGER',1,0],['cell_lng','INTEGER',1,0],['south','REAL',1,0],['west','REAL',1,0],['north','REAL',1,0],['east','REAL',1,0],['ways','TEXT',1,0],['way_count','INTEGER',1,0],['region','TEXT',1,0],['dataset','TEXT',1,0],['imported_at','TEXT',1,0]];

const text=v=>typeof v==='string'&&v.trim()?v.trim().slice(0,MAX_NAME_LENGTH):null;
const isInt=v=>Number.isSafeInteger(v);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
/** The cell's name, exactly as streetBox names a 0.01° box: "south,west,north,east" with two decimals. */
export function cellKey(cellLat,cellLng){const f=v=>(v/CELLS_PER_DEGREE).toFixed(2);return [f(cellLat),f(cellLng),f(cellLat+1),f(cellLng+1)].join(',');}
export const cellBounds=(cellLat,cellLng)=>({south:cellLat/CELLS_PER_DEGREE,west:cellLng/CELLS_PER_DEGREE,north:(cellLat+1)/CELLS_PER_DEGREE,east:(cellLng+1)/CELLS_PER_DEGREE});
/** Degrees from file units, rounded to 1e-6 as the server rounds a coordinate. */
const degrees=u=>Math.round(u*10)/1e6;

/** Cuts one street line (points in file units, [lat, lng]) at every 0.01° grid line it crosses. Returns Map "cellLat:cellLng" → runs; each
 * run is a line in degrees lying in that one cell, its ends on the cell's border where the street goes on. Joined end to end, the runs give
 * back the street. */
export function clipToCells(points){
 const out=new Map();let run=null,runCell='';
 const close=()=>{if(run){const clean=[];for(const p of run.map(q=>[degrees(q[0]),degrees(q[1])]))if(!clean.length||clean.at(-1)[0]!==p[0]||clean.at(-1)[1]!==p[1])clean.push(p);if(clean.length>=2){const list=out.get(runCell);if(list)list.push(clean);else out.set(runCell,[clean]);}}run=null;};
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];if(a[0]===b[0]&&a[1]===b[1])continue;
  const ts=[0,1],dLat=b[0]-a[0],dLng=b[1]-a[1];
  const lines=(from,to,d,start)=>{if(!d)return;const lo=Math.min(Math.floor(from/CELL_UNITS),Math.floor(to/CELL_UNITS)),hi=Math.max(Math.floor(from/CELL_UNITS),Math.floor(to/CELL_UNITS));for(let k=lo+1;k<=hi;k++){const t=(k*CELL_UNITS-start)/d;if(t>0&&t<1)ts.push(t);}};
  lines(a[0],b[0],dLat,a[0]);lines(a[1],b[1],dLng,a[1]);
  ts.sort((x,y)=>x-y);
  const at=t=>t===0?a:t===1?b:[a[0]+t*dLat,a[1]+t*dLng];
  for(let j=1;j<ts.length;j++){
   const t0=ts[j-1],t1=ts[j];if(t1-t0<1e-12)continue;
   const p0=at(t0),p1=at(t1),m=at((t0+t1)/2),cell=Math.floor(m[0]/CELL_UNITS)+':'+Math.floor(m[1]/CELL_UNITS);
   const last=run?.at(-1);
   if(run&&cell===runCell&&last[0]===p0[0]&&last[1]===p0[1])run.push(p1);
   else{close();run=[p0,p1];runCell=cell;}
  }
 }
 close();
 return out;
}

/** The same compact form the server caches an Overpass answer in (encodeStreets), so decodeStreets reads both. */
export const encodeWays=ways=>JSON.stringify({v:1,ways:ways.map(w=>[w.name,w.name_en,...w.points.flat()])});

/** Reads and checks a street data file (gzip or plain JSON):
 * {format, version, system, dataset, source:{…}, created_at, scale, highways, regions:[{id, name, south, west, north, east}], names:[…],
 *  ways:[[name index or -1, English name index or -1, lat0, lng0, Δlat1, Δlng1, …], …]} — coordinates in 1e-5 degree units, each after the
 * first as a difference from the one before. */
export function readStreetFile(file,{expectSha256}={}){
 const st=fs.statSync(file);if(!st.isFile())throw Error('The street data file is not a file.');
 if(st.size>MAX_FILE_BYTES)throw Error('The street data file is larger than '+MAX_FILE_BYTES+' bytes.');
 const raw=fs.readFileSync(file),fileSha256=sha256(raw);
 if(expectSha256&&String(expectSha256).toLowerCase()!==fileSha256)throw Error('The street data file does not match the expected sha256.');
 let bytes;try{bytes=raw[0]===0x1f&&raw[1]===0x8b?zlib.gunzipSync(raw,{maxOutputLength:MAX_DATA_BYTES}):raw;}catch{throw Error('The street data file is not a whole gzip file.');}
 let d;try{d=JSON.parse(bytes.toString('utf8'));}catch{throw Error('The street data file is not valid JSON.');}
 if(!d||typeof d!=='object'||d.format!==FORMAT||d.version!==FORMAT_VERSION)throw Error('Not a '+FORMAT+' v'+FORMAT_VERSION+' file.');
 if(d.scale!==SCALE)throw Error('Unexpected coordinate scale.');
 if(JSON.stringify(d.highways)!==JSON.stringify(STREET_HIGHWAYS))throw Error('The file holds other street kinds than the server asks Overpass for.');
 if(typeof d.system!=='string'||typeof d.dataset!=='string'||!d.dataset||d.dataset.length>200)throw Error('The file names no system or dataset.');
 if(!Array.isArray(d.regions)||!d.regions.length||d.regions.length>MAX_REGIONS)throw Error('The file has no regions, or more than '+MAX_REGIONS+'.');
 const regions=d.regions.map(r=>{
  if(!r||typeof r.id!=='string'||!/^[a-z][a-z0-9-]{1,30}$/.test(r.id))throw Error('Bad region id.');
  const cells={};for(const side of ['south','west','north','east']){const v=r[side]*CELLS_PER_DEGREE;if(typeof r[side]!=='number'||!Number.isFinite(v)||Math.abs(v-Math.round(v))>1e-6)throw Error('Region '+r.id+' is not on the 0.01° grid.');cells[side]=Math.round(v);}
  if(cells.north<=cells.south||cells.east<=cells.west)throw Error('Region '+r.id+' is empty.');
  if(r.south<SAUDI_BOUNDS.south||r.north>SAUDI_BOUNDS.north||r.west<SAUDI_BOUNDS.west||r.east>SAUDI_BOUNDS.east)throw Error('Region '+r.id+' is outside Saudi Arabia.');
  const count=(cells.north-cells.south)*(cells.east-cells.west);if(count>MAX_REGION_CELLS)throw Error('Region '+r.id+' is too large.');
  return {id:r.id,name:typeof r.name==='string'?r.name.slice(0,80):r.id,south:r.south,west:r.west,north:r.north,east:r.east,cells,count};
 });
 if(new Set(regions.map(r=>r.id)).size!==regions.length)throw Error('Two regions share an id.');
 for(let i=0;i<regions.length;i++)for(let j=i+1;j<regions.length;j++){const a=regions[i].cells,b=regions[j].cells;if(a.south<b.north&&b.south<a.north&&a.west<b.east&&b.west<a.east)throw Error('Regions '+regions[i].id+' and '+regions[j].id+' overlap.');}
 if(regions.reduce((n,r)=>n+r.count,0)>MAX_FILE_CELLS)throw Error('The file covers more than '+MAX_FILE_CELLS+' cells.');
 if(!Array.isArray(d.names)||!d.names.every(n=>typeof n==='string'))throw Error('Bad name list.');
 if(!Array.isArray(d.ways))throw Error('Bad street list.');
 const name=i=>{if(!isInt(i)||i<-1||i>=d.names.length)throw Error('Bad name index.');return i<0?null:text(d.names[i]);};
 const ways=d.ways.map(w=>{
  if(!Array.isArray(w)||w.length<6||w.length%2)throw Error('Bad street line.');
  const points=[];let lat=0,lng=0;
  for(let i=2;i<w.length;i+=2){if(!isInt(w[i])||!isInt(w[i+1]))throw Error('Bad coordinate.');lat=i===2?w[i]:lat+w[i];lng=i===2?w[i+1]:lng+w[i+1];if(Math.abs(lat)>90*SCALE||Math.abs(lng)>180*SCALE)throw Error('Coordinate out of range.');points.push([lat,lng]);}
  return {name:name(w[0]),name_en:name(w[1]),points};
 });
 return {system:d.system,dataset:d.dataset,source:d.source??null,created_at:d.created_at??null,regions,ways,fileSha256,fileBytes:st.size,dataBytes:bytes.length};
}

/** Every cell of the chosen regions, with the street pieces in it (an empty list for a cell with no street, so it counts as covered). */
export function buildRows(data,{regionIds,importedAt}){
 const chosen=regionIds?.length?regionIds.map(id=>{const r=data.regions.find(x=>x.id===id);if(!r)throw Error('The file has no region '+id+'.');return r;}):data.regions;
 const byCell=new Map();
 for(const r of chosen)for(let y=r.cells.south;y<r.cells.north;y++)for(let x=r.cells.west;x<r.cells.east;x++)byCell.set(y+':'+x,{region:r.id,cellLat:y,cellLng:x,ways:[]});
 for(const way of data.ways){
  // Cheap test first: the street's own box against the chosen regions.
  let s=Infinity,n=-Infinity,w=Infinity,e=-Infinity;for(const [la,lo] of way.points){if(la<s)s=la;if(la>n)n=la;if(lo<w)w=lo;if(lo>e)e=lo;}
  if(!chosen.some(r=>n>=r.cells.south*CELL_UNITS&&s<=r.cells.north*CELL_UNITS&&e>=r.cells.west*CELL_UNITS&&w<=r.cells.east*CELL_UNITS))continue;
  for(const [cell,runs] of clipToCells(way.points)){const target=byCell.get(cell);if(target)for(const points of runs)target.ways.push({name:way.name,name_en:way.name_en,points});}
 }
 const rows=[],stats={};
 for(const c of byCell.values()){
  const b=cellBounds(c.cellLat,c.cellLng),ways=encodeWays(c.ways);
  rows.push({bbox_key:cellKey(c.cellLat,c.cellLng),cell_lat:c.cellLat,cell_lng:c.cellLng,...b,ways,way_count:c.ways.length,region:c.region,dataset:data.dataset,imported_at:importedAt});
  const st=stats[c.region]??={cells:0,cellsWithStreets:0,pieces:0,bytes:0};st.cells++;if(c.ways.length)st.cellsWithStreets++;st.pieces+=c.ways.length;st.bytes+=ways.length;
 }
 return {rows,regions:chosen.map(r=>({id:r.id,name:r.name,south:r.south,west:r.west,north:r.north,east:r.east,...stats[r.id]}))};
}

/** Proves the database is this application's, with the local street table exactly as migration 0024 made it. Read-only. */
export function checkDatabase(db){
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
 if(!tables.has(APP.ledgerTable))throw Error('Not a '+APP.name+' database: no migration ledger.');
 const ledger=db.prepare(`SELECT name FROM ${APP.ledgerTable} ORDER BY name`).all().map(r=>r.name);
 for(const name of APP.requiredMigrations)if(!ledger.includes(name))throw Error('Not a '+APP.name+' database with local streets: migration '+name+' is not recorded.');
 if(!tables.has(TABLE)||!tables.has(APP.cacheTable))throw Error('The local street table is missing.');
 const shape=db.prepare(`PRAGMA table_info(${TABLE})`).all().map(c=>[c.name,String(c.type).toUpperCase(),c.notnull,c.pk]);
 if(JSON.stringify(shape)!==JSON.stringify(TABLE_SHAPE))throw Error('The local street table is not as migration '+APP.requiredMigrations.at(-1)+' made it.');
 return {app:APP.id,ledger:ledger.length,lastMigration:ledger.at(-1),journalMode:db.prepare('PRAGMA journal_mode').get().journal_mode};
}
export function countLocal(db){
 const rows=db.prepare(`SELECT region,COUNT(*) AS cells,SUM(way_count>0) AS cells_with_streets,SUM(way_count) AS pieces,MIN(imported_at) AS imported_at,MAX(imported_at) AS last_imported_at,MIN(dataset) AS dataset FROM ${TABLE} GROUP BY region ORDER BY region`).all();
 return rows.map(r=>({region:r.region,cells:r.cells,cellsWithStreets:r.cells_with_streets,pieces:r.pieces,importedAt:r.imported_at,...(r.last_imported_at!==r.imported_at?{lastImportedAt:r.last_imported_at}:{}),dataset:r.dataset}));
}
/** Replaces the regions' rows in one transaction (all or nothing), then reads the count back. A cell another region of the database holds is
 *  taken over by the new region (one row per cell). */
export function writeRows(db,rows,regionIds){
 db.exec('PRAGMA busy_timeout=15000');
 const del=db.prepare(`DELETE FROM ${TABLE} WHERE region IN (${regionIds.map(()=>'?').join(',')})`);
 const put=db.prepare(`INSERT INTO ${TABLE}(bbox_key,cell_lat,cell_lng,south,west,north,east,ways,way_count,region,dataset,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bbox_key) DO UPDATE SET cell_lat=excluded.cell_lat,cell_lng=excluded.cell_lng,south=excluded.south,west=excluded.west,north=excluded.north,east=excluded.east,ways=excluded.ways,way_count=excluded.way_count,region=excluded.region,dataset=excluded.dataset,imported_at=excluded.imported_at`);
 const started=Date.now();let removed=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  removed=Number(del.run(...regionIds).changes);
  for(const r of rows)put.run(r.bbox_key,r.cell_lat,r.cell_lng,r.south,r.west,r.north,r.east,r.ways,r.way_count,r.region,r.dataset,r.imported_at);
  const now=db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE region IN (${regionIds.map(()=>'?').join(',')})`).get(...regionIds).n;
  if(now!==rows.length)throw Error('Row count after writing differs ('+now+' / '+rows.length+').');
  db.exec('COMMIT');
 }catch(error){try{db.exec('ROLLBACK');}catch{/* already rolled back */}throw error;}
 return {removedBefore:removed,rowsWritten:rows.length,lockMs:Date.now()-started};
}
export function removeRows(db,regionIds){
 db.exec('PRAGMA busy_timeout=15000');
 const started=Date.now();db.exec('BEGIN IMMEDIATE');
 try{const removed=regionIds?Number(db.prepare(`DELETE FROM ${TABLE} WHERE region IN (${regionIds.map(()=>'?').join(',')})`).run(...regionIds).changes):Number(db.prepare(`DELETE FROM ${TABLE}`).run().changes);db.exec('COMMIT');return {removed,lockMs:Date.now()-started};}
 catch(error){try{db.exec('ROLLBACK');}catch{/* already rolled back */}throw error;}
}

const FLAGS=['apply','verify','remove','all'],VALUES=['db','settings','file','regions','sha256'];
export function parseArgs(argv){
 const o={};for(let i=0;i<argv.length;i++){const a=argv[i];if(!a.startsWith('--'))throw Error('Unexpected argument '+a);const key=a.slice(2);if(FLAGS.includes(key))o[key]=true;else if(VALUES.includes(key)){const v=argv[++i];if(v===undefined||v.startsWith('--'))throw Error('Missing value for '+a);o[key]=v;}else throw Error('Unknown option '+a);}
 if(o.db&&o.settings)throw Error('Name the database once: --db or --settings.');
 if(o.verify&&(o.apply||o.remove||o.file))throw Error('--verify only reads: no --apply, --remove or --file.');
 if(o.regions!==undefined&&!/^[a-z][a-z0-9-]{1,30}(,[a-z][a-z0-9-]{1,30})*$/.test(o.regions))throw Error('--regions: region ids separated by commas.');
 if(o.sha256!==undefined&&!/^[0-9a-f]{64}$/i.test(o.sha256))throw Error('--sha256: the 64 hex digits of the file.');
 return o;
}
/** The database named by settings.cjs (YR_DATABASE_PATH), read as a file: no YR_* variable of this process is used. */
function databaseFromSettings(file){
 const require=createRequire(import.meta.url),resolved=path.resolve(file);
 const settings=require(resolved);const value=settings&&settings.YR_DATABASE_PATH;
 if(typeof value!=='string'||!path.isAbsolute(value))throw Error('settings.cjs names no absolute YR_DATABASE_PATH.');
 return value;
}
async function openDatabase(file,readOnly){
 const st=fs.statSync(file,{throwIfNoEntry:false});
 if(!st||!st.isFile()||st.size===0)throw Error('No database at '+file+' (it is never created here).');
 const {DatabaseSync}=await import('node:sqlite');
 return new DatabaseSync(file,{readOnly});
}
export async function main(argv=process.argv.slice(2)){
 const o=parseArgs(argv);
 const named=o.db||(o.settings?databaseFromSettings(o.settings):'');
 if(!named)throw Error('Name the database: --db <path to database.sqlite> or --settings <yourrest-crm/settings.cjs>');
 if(!fs.existsSync(named))throw Error('No database at '+named+' (it is never created here).');
 const target=fs.realpathSync(named),regionIds=o.regions?o.regions.split(',').map(s=>s.trim()).filter(Boolean):null;
 const base={tool:'import-street-data',app:APP.id,database:target,databaseBytes:fs.statSync(target).size};
 if(o.verify){
  const db=await openDatabase(target,true);
  try{const info=checkDatabase(db);const regions=countLocal(db);return {ok:true,mode:'verify',readOnly:true,...base,...info,regions,totalCells:regions.reduce((n,r)=>n+r.cells,0),cacheBoxes:db.prepare(`SELECT COUNT(*) AS n FROM ${APP.cacheTable}`).get().n};}
  finally{db.close();}
 }
 if(o.remove){
  if(!regionIds&&!o.all)throw Error('Name the regions to remove (--regions a,b) or --all.');
  if(regionIds&&o.all)throw Error('--regions or --all, not both.');
  const db=await openDatabase(target,!o.apply);
  try{const info=checkDatabase(db);const before=countLocal(db);
   if(!o.apply)return {ok:true,mode:'remove-dry-run',readOnly:true,...base,...info,wouldRemove:before.filter(r=>!regionIds||regionIds.includes(r.region))};
   const done=removeRows(db,regionIds);return {ok:true,mode:'remove',...base,...info,...done,regions:countLocal(db)};}
  finally{db.close();}
 }
 if(o.all)throw Error('--all goes with --remove only.');
 if(!o.file)throw Error('Name the street data file: --file <streets.json.gz>');
 const prepStart=Date.now(),data=readStreetFile(o.file,{expectSha256:o.sha256});
 if(data.system!==APP.id)throw Error('This street data file is for '+data.system+', not for '+APP.id+'.');
 const importedAt=new Date().toISOString(),built=buildRows(data,{regionIds,importedAt}),ids=built.regions.map(r=>r.id);
 const file={file:fs.realpathSync(o.file),sha256:data.fileSha256,bytes:data.fileBytes,system:data.system,dataset:data.dataset,source:data.source,streets:data.ways.length};
 const db=await openDatabase(target,!o.apply);
 try{
  const info=checkDatabase(db),before=countLocal(db),prepareMs=Date.now()-prepStart;
  if(!o.apply)return {ok:true,mode:'dry-run',readOnly:true,...base,...info,file,wouldWrite:built.regions,rows:built.rows.length,before,prepareMs};
  const done=writeRows(db,built.rows,ids);
  try{db.exec('PRAGMA wal_checkpoint(PASSIVE)');}catch{/* the application checkpoints too */}
  return {ok:true,mode:'apply',...base,...info,file,written:built.regions,...done,importedAt,prepareMs,regions:countLocal(db)};
 }finally{db.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().then(r=>{console.log(JSON.stringify(r,null,2));},error=>{console.log(JSON.stringify({ok:false,tool:'import-street-data',error:error.message},null,2));process.exitCode=1;});
}

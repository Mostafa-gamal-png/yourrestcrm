#!/usr/bin/env node
// «بيانات شوارع محلية» (the owner, 2026-11-19: the port of GSCO 2.13.82 tools/build-street-data.mjs): builds the ONE compact street data file
// that portable/import-street-data.mjs loads into crm_osm_street_local on the host. It runs where osmium-tool is installed (a GitHub runner of
// the «streets» mode, docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md 9-أك, or an office PC with WSL), never on the hosting account (no osmium there,
// and close to its file limit), and never with business data: its only inputs are a public OpenStreetMap extract and the regions, rectangles on
// the 0.01° grid that scripts/diagnose/street-regions.cjs proposes from the live pins without naming a customer.
//   node scripts/streets/build-street-data.mjs --pbf <gcc-states-YYMMDD.osm.pbf> --out <streets.json.gz>
//        --region riyadh:24.40,46.50,24.90,47.00[:Riyadh] [--region …] [--system yourrest-crm] [--work <folder>] [--osmium <program>]
// Steps: one osmium pass cuts every region (with a 0.02° margin, complete ways) from the extract, keeps only the street kinds the server's
// Overpass query asks for, exports the lines as GeoJSON, drops «area=yes» ways, keeps the Arabic name (name:ar, else name) and the English name
// (name:en) as the server does, rounds the points to 1e-5 degree (about 1.1 m) and writes them as differences, then gzip. The file is read back
// exactly as the importer will read it, and its sha256 is written beside it. Refresh: a newer extract, this again, the import again (the
// regions' rows are replaced). Map data © OpenStreetMap contributors, ODbL 1.0 (the map already shows the attribution).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import readline from 'node:readline';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {APP,FORMAT,FORMAT_VERSION,SCALE,STREET_HIGHWAYS,MAX_NAME_LENGTH,readStreetFile,buildRows} from '../../portable/import-street-data.mjs';

export const MARGIN=0.02;
const REGION=/^([a-z][a-z0-9-]{1,30}):(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)(?::(.{1,80}))?$/;
export function parseRegion(value){
 const m=REGION.exec(String(value));if(!m)throw Error('Bad region '+value+' (id:south,west,north,east[:name])');
 return {id:m[1],south:+m[2],west:+m[3],north:+m[4],east:+m[5],name:m[6]||m[1]};
}
export function parseArgs(argv){
 const o={regions:[]};
 for(let i=0;i<argv.length;i++){const a=argv[i],v=argv[i+1];if(!a.startsWith('--')||v===undefined||v.startsWith('--'))throw Error('Bad argument '+a);i++;
  if(a==='--region')o.regions.push(parseRegion(v));
  else if(['--pbf','--out','--system','--work','--osmium'].includes(a))o[a.slice(2)]=v;
  else throw Error('Unknown option '+a);}
 for(const k of ['pbf','out'])if(!o[k])throw Error('Missing --'+k);
 if(!o.regions.length)throw Error('Name at least one --region');
 o.system??=APP.id;
 return o;
}
const text=v=>typeof v==='string'&&v.trim()?v.trim().slice(0,MAX_NAME_LENGTH):null;

/** The compact file from the GeoJSON line features osmium exported (one list per region): only the server's street kinds, no «area=yes», each
 * way once (by its id), names kept as the server keeps them. Pure: the tests give it features of their own. */
export function streetFileFromFeatures({regions,features,system,dataset,source,createdAt=new Date().toISOString()}){
 const allowed=new Set(STREET_HIGHWAYS),names=[],nameIndex=new Map(),ways=[],seen=new Set(),perRegion={};
 const nameId=v=>{const t=text(v);if(t===null)return -1;let i=nameIndex.get(t);if(i===undefined){i=names.length;names.push(t);nameIndex.set(t,i);}return i;};
 for(const r of regions){
  const count={features:0,kept:0,areaYes:0,otherKind:0,duplicate:0};
  for(const f of features[r.id]||[]){
   count.features++;
   const p=f?.properties||{},g=f?.geometry;
   if(!g||g.type!=='LineString'||!Array.isArray(g.coordinates))continue;
   if(!allowed.has(p.highway)){count.otherKind++;continue;}
   if(p.area==='yes'){count.areaYes++;continue;}
   const id=p['@id']??f.id;if(id!==undefined&&id!==null){if(seen.has(String(id))){count.duplicate++;continue;}seen.add(String(id));}
   const pts=[];for(const c of g.coordinates){if(!Array.isArray(c)||!Number.isFinite(c[0])||!Number.isFinite(c[1]))continue;const q=[Math.round(c[1]*SCALE),Math.round(c[0]*SCALE)];if(!pts.length||pts.at(-1)[0]!==q[0]||pts.at(-1)[1]!==q[1])pts.push(q);}
   if(pts.length<2)continue;
   const row=[nameId(p['name:ar']??p.name),nameId(p['name:en'])];
   pts.forEach((q,i)=>{if(i===0)row.push(q[0],q[1]);else row.push(q[0]-pts[i-1][0],q[1]-pts[i-1][1]);});
   ways.push(row);count.kept++;
  }
  perRegion[r.id]=count;
 }
 return {data:{format:FORMAT,version:FORMAT_VERSION,system,dataset,source,created_at:createdAt,scale:SCALE,highways:STREET_HIGHWAYS,
  regions:regions.map(r=>({id:r.id,name:r.name,south:r.south,west:r.west,north:r.north,east:r.east})),names,ways},perRegion};
}

function runOsmium(program,args,label){
 const r=spawnSync(program,args,{encoding:'utf8',maxBuffer:64*1024*1024});
 if(r.error)throw Error('osmium is not available ('+r.error.message+'); install osmium-tool');
 if(r.status!==0)throw Error(label+' failed: '+String(r.stderr||r.stdout).slice(0,2000));
 return r.stdout;
}
async function readFeatures(file){
 const out=[],rl=readline.createInterface({input:fs.createReadStream(file,'utf8'),crlfDelay:Infinity});
 for await (let line of rl){line=line.replace(/^\x1e/,'').trim();if(line)out.push(JSON.parse(line));}
 return out;
}

export async function build(o){
 const osmium=o.osmium||'osmium';
 const work=o.work?path.resolve(o.work):fs.mkdtempSync(path.join(os.tmpdir(),'street-data-'));fs.mkdirSync(work,{recursive:true});
 const pbf=path.resolve(o.pbf),pbfSha=createHash('sha256').update(fs.readFileSync(pbf)).digest('hex');
 const stamp=runOsmium(osmium,['fileinfo','-g','header.option.osmosis_replication_timestamp',pbf],'fileinfo').trim()||null;
 // One pass for every region.
 const config={directory:work,extracts:o.regions.map(r=>({output:r.id+'.osm.pbf',output_format:'pbf',bbox:[r.west-MARGIN,r.south-MARGIN,r.east+MARGIN,r.north+MARGIN]}))};
 fs.writeFileSync(path.join(work,'extracts.json'),JSON.stringify(config,null,1));
 runOsmium(osmium,['extract','--overwrite','-s','complete_ways','-c',path.join(work,'extracts.json'),pbf],'extract');
 fs.writeFileSync(path.join(work,'export-config.json'),JSON.stringify({attributes:{type:false,id:true},linear_tags:true,area_tags:false}));
 const features={};
 for(const r of o.regions){
  const cut=path.join(work,r.id+'.osm.pbf'),streets=path.join(work,r.id+'-streets.osm.pbf'),lines=path.join(work,r.id+'.geojsonseq');
  runOsmium(osmium,['tags-filter','--overwrite','-o',streets,cut,'w/highway='+STREET_HIGHWAYS.join(',')],'tags-filter '+r.id);
  runOsmium(osmium,['export','--overwrite','-c',path.join(work,'export-config.json'),'-f','geojsonseq','--geometry-types=linestring','-o',lines,streets],'export '+r.id);
  features[r.id]=await readFeatures(lines);
 }
 const {data,perRegion}=streetFileFromFeatures({regions:o.regions,features,system:o.system,
  dataset:'osm:'+path.basename(pbf).replace(/\.osm\.pbf$/,'')+(stamp?'@'+stamp:''),
  source:{name:'OpenStreetMap',attribution:'© OpenStreetMap contributors',license:'ODbL-1.0',extract:path.basename(pbf),extractSha256:pbfSha,osmDataUpTo:stamp}});
 const out=path.resolve(o.out);fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,zlib.gzipSync(Buffer.from(JSON.stringify(data)),{level:9}));
 // Read it back exactly as the importer will, and count what each region would get.
 const back=readStreetFile(out),built=buildRows(back,{importedAt:'(preview)'});
 const sha=createHash('sha256').update(fs.readFileSync(out)).digest('hex');
 fs.writeFileSync(out+'.sha256',sha+'  '+path.basename(out)+'\n');
 return {ok:true,out,bytes:fs.statSync(out).size,sha256:sha,system:o.system,dataset:data.dataset,osmDataUpTo:stamp,extract:path.basename(pbf),extractSha256:pbfSha,streets:data.ways.length,names:data.names.length,osmium:perRegion,regions:built.regions,rows:built.rows.length,work};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 build(parseArgs(process.argv.slice(2))).then(r=>console.log(JSON.stringify(r,null,2)),error=>{console.error(error.stack||error.message);process.exitCode=1;});
}

import {bboxContains,bboxGrow,bboxOf,clipPolyline,NEAR_PROJECT_METRES,plane,pointSegmentMetres,roundCoordinate,SEGMENT_METRES,splitPolyline,type Area,type BBox,type LatLng} from './work-area-geometry';

/** «خريطة المصانع» (the owner, 2026-11-19: the port of GSCO 2.13.81 and 2.13.82): the streets of a work area that have no customer. The
 * street lines come from OpenStreetMap, on the server only: first from the local data imported once per 0.01° cell (crm_osm_street_local,
 * portable/import-street-data.mjs), else through the public Overpass API. This file holds the pure parts: the query, the check of Overpass's
 * answer, the compact form kept in the cache and in the local data, and the cut into «empty» pieces. A piece is empty when no customer pin of
 * the whole company lies within 50 m of it. The same file as GSCO's lib/crm/work-area-streets.ts, so the street data files are the same. */
export type StreetWay={name:string|null;name_en:string|null;points:LatLng[]};
export type EmptySegment={name:string|null;name_en:string|null;points:LatLng[]};

/** Streets people drive along to find sites. Motorways, trunk roads, their links, service roads, paths, tracks, steps and roads under
 * construction are left out. */
export const STREET_HIGHWAYS=['primary','secondary','tertiary','unclassified','residential','living_street'] as const;
export const STREET_LIMITS={maxWays:20000,maxPointsPerWay:4000,maxSegments:3000,maxNameLength:120} as const;

/** The box Overpass is asked for: the area's box widened outward to a 0.01° grid (about 1.1 km), so small edits of an area reuse the
 * same cached answer. The key names the box. */
export function streetBox(area:Area):{box:BBox;key:string}|null{
 const b=bboxOf(area);if(!b)return null;
 const down=(v:number)=>Math.floor(v*100+1e-9)/100,up=(v:number)=>Math.ceil(v*100-1e-9)/100;
 const box={south:down(b.south),west:down(b.west),north:up(b.north),east:up(b.east)};
 if(box.north===box.south)box.north=Math.round((box.north+0.01)*100)/100;
 if(box.east===box.west)box.east=Math.round((box.east+0.01)*100)/100;
 const f=(v:number)=>v.toFixed(2);
 return {box,key:[f(box.south),f(box.west),f(box.north),f(box.east)].join(',')};
}

/** The local street data (loaded once from an OpenStreetMap extract by portable/import-street-data.mjs) is kept per cell of the
 * same 0.01° grid. A cell is named exactly as streetBox names a box inside it ("south,west,north,east" with two decimals), and a box
 * streetBox returns is always whole cells, so the local data for a box is the union of its cells. Cells are numbered by
 * floor(latitude × 100) and floor(longitude × 100). */
export const STREET_CELLS_PER_DEGREE=100;
export function boxCells(box:BBox){
 const s=Math.round(box.south*STREET_CELLS_PER_DEGREE),n=Math.round(box.north*STREET_CELLS_PER_DEGREE),w=Math.round(box.west*STREET_CELLS_PER_DEGREE),e=Math.round(box.east*STREET_CELLS_PER_DEGREE);
 return {south:s,north:n-1,west:w,east:e-1,count:Math.max(0,n-s)*Math.max(0,e-w)};
}
export function cellKey(cellLat:number,cellLng:number){
 const f=(v:number)=>(v/STREET_CELLS_PER_DEGREE).toFixed(2);
 return [f(cellLat),f(cellLng),f(cellLat+1),f(cellLng+1)].join(',');
}

/** Overpass QL: the ways of those kinds in the box, with their names and their geometry only. */
export function overpassQuery(box:BBox,timeoutSeconds=25){
 const b=[box.south,box.west,box.north,box.east].map(v=>v.toFixed(5)).join(',');
 return `[out:json][timeout:${timeoutSeconds}][maxsize:67108864];way["highway"~"^(${STREET_HIGHWAYS.join('|')})$"]["area"!="yes"](${b});out tags geom qt;`;
}

const text=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim().slice(0,STREET_LIMITS.maxNameLength):null;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
/** Checks an answer against Overpass's JSON contract ({version, osm3s, elements:[{type:'way', id, tags, geometry:[{lat, lon}]}], remark?}).
 * A «remark» with an error (a query that ran out of time or memory) means a cut answer: it is refused so a partial street list is never
 * cached. A geometry point may be null (a node outside the data); the line is split there. */
export function parseOverpassStreets(data:unknown):{ok:true;ways:StreetWay[]}|{ok:false;reason:string}{
 if(!data||typeof data!=='object'||Array.isArray(data))return {ok:false,reason:'shape'};
 const d=data as {elements?:unknown;remark?:unknown};
 if(typeof d.remark==='string'&&/error|timed out|out of memory/i.test(d.remark))return {ok:false,reason:'remark'};
 if(!Array.isArray(d.elements))return {ok:false,reason:'shape'};
 if(d.elements.length>STREET_LIMITS.maxWays)return {ok:false,reason:'too_many'};
 const allowed=new Set<string>(STREET_HIGHWAYS),ways:StreetWay[]=[];
 for(const e of d.elements as unknown[]){
  if(!e||typeof e!=='object')return {ok:false,reason:'shape'};
  const w=e as {type?:unknown;tags?:unknown;geometry?:unknown};
  if(w.type!=='way')continue;
  const tags=(w.tags&&typeof w.tags==='object'?w.tags:{}) as Record<string,unknown>;
  if(typeof tags.highway!=='string'||!allowed.has(tags.highway)||tags.area==='yes')continue;
  if(!Array.isArray(w.geometry))return {ok:false,reason:'shape'};
  if(w.geometry.length>STREET_LIMITS.maxPointsPerWay)return {ok:false,reason:'too_many'};
  const name=text(tags['name:ar'])??text(tags.name),name_en=text(tags['name:en']);
  let run:LatLng[]=[];
  const flush=()=>{if(run.length>=2)ways.push({name,name_en,points:run});run=[];};
  for(const g of w.geometry as unknown[]){
   const p=g as {lat?:unknown;lon?:unknown}|null;
   if(p&&finite(p.lat)&&finite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180)run.push([roundCoordinate(p.lat),roundCoordinate(p.lon)]);else flush();
  }
  flush();
 }
 return {ok:true,ways};
}

/** The cached form: [[name, english name, lat, lng, lat, lng, …], …]; about half the size of Overpass's answer. */
export function encodeStreets(ways:readonly StreetWay[]){return JSON.stringify({v:1,ways:ways.map(w=>[w.name,w.name_en,...w.points.flat()])});}
export function decodeStreets(value:string):StreetWay[]|null{
 try{
  const d=JSON.parse(value) as {v?:unknown;ways?:unknown};if(d.v!==1||!Array.isArray(d.ways))return null;
  const out:StreetWay[]=[];
  for(const w of d.ways as unknown[]){
   if(!Array.isArray(w)||w.length<6||w.length%2)return null;
   const [name,name_en,...flat]=w as [unknown,unknown,...unknown[]],points:LatLng[]=[];
   for(let i=0;i<flat.length;i+=2){const lat=flat[i],lng=flat[i+1];if(!finite(lat)||!finite(lng))return null;points.push([lat,lng]);}
   out.push({name:text(name),name_en:text(name_en),points});
  }
  return out;
 }catch{return null;}
}

/** Pins indexed on a 100 m grid of the area's flat projection. */
function pinIndex(pins:readonly LatLng[],latitude:number,cell=100){
 const f=plane(latitude),cells=new Map<string,LatLng[]>();
 for(const p of pins){const [x,y]=f.xy(p),key=Math.floor(x/cell)+':'+Math.floor(y/cell);const list=cells.get(key);if(list)list.push(p);else cells.set(key,[p]);}
 return {near(line:readonly LatLng[],metres:number){
  const xy=line.map(p=>f.xy(p)),x0=Math.floor((Math.min(...xy.map(v=>v[0]))-metres)/cell),x1=Math.floor((Math.max(...xy.map(v=>v[0]))+metres)/cell),y0=Math.floor((Math.min(...xy.map(v=>v[1]))-metres)/cell),y1=Math.floor((Math.max(...xy.map(v=>v[1]))+metres)/cell);
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(const p of cells.get(x+':'+y)||[])for(let i=1;i<line.length;i++)if(pointSegmentMetres(p,line[i-1],line[i])<=metres)return true;
  return false;
 }};
}

/** The pieces of the area's streets with no customer pin within 50 m: each street clipped to the area, cut into pieces of at most 150 m,
 * and kept when no pin is near. Only the line and the street's name come back, never anything about a customer. At most `limit` pieces. */
export function emptyStreetSegments(area:Area,ways:readonly StreetWay[],pins:readonly LatLng[],options:{nearMetres?:number;segmentMetres?:number;limit?:number;exclude?:Area}={}){
 const near=options.nearMetres??NEAR_PROJECT_METRES,length=options.segmentMetres??SEGMENT_METRES,limit=options.limit??STREET_LIMITS.maxSegments;
 const box=bboxOf(area);if(!box)return {segments:[] as EmptySegment[],pieces:0,empty:0,truncated:false};
 const reach=bboxGrow(box,near+10),index=pinIndex(pins.filter(p=>bboxContains(reach,p)),(box.south+box.north)/2);
 const segments:EmptySegment[]=[];let pieces=0,empty=0;
 for(const way of ways){
  if(!way.points.some(p=>bboxContains(reach,p))&&!crossesBox(way.points,box))continue;
  for(const part of clipPolyline(way.points,area,options.exclude))for(const piece of splitPolyline(part,length)){
   pieces++;
   if(index.near(piece,near))continue;
   empty++;
   if(segments.length<limit)segments.push({name:way.name,name_en:way.name_en,points:piece.map(p=>[roundCoordinate(p[0]),roundCoordinate(p[1])] as LatLng)});
  }
 }
 return {segments,pieces,empty,truncated:empty>segments.length};
}
/** A long street can cross the area with no point inside its box. */
function crossesBox(points:readonly LatLng[],b:BBox){
 for(let i=1;i<points.length;i++){const [a,c]=[points[i-1],points[i]];if(Math.max(a[0],c[0])>=b.south&&Math.min(a[0],c[0])<=b.north&&Math.max(a[1],c[1])>=b.west&&Math.min(a[1],c[1])<=b.east)return true;}
 return false;
}

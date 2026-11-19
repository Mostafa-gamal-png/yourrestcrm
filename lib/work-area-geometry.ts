/** «خريطة المصانع» (the owner, 2026-11-19: the port of GSCO 2.13.81 and 2.13.82): the geometry behind the representatives' work areas and
 * the streets with no customer. Pure functions shared by the page and the server, with no dependency on the rest of the application (the same
 * file as GSCO's lib/crm/work-area-geometry.ts, with Yourrest's words).
 * Points are [latitude, longitude]. Distances are in metres on a local flat projection (equirectangular around the area), which is exact to
 * well under a metre at the size of a work area (a few kilometres). */
export type LatLng=[number,number];
/** A simple polygon, open (the first point is not repeated at the end). */
export type Ring=LatLng[];
/** A work area: one drawn polygon, or the fallback around a representative's pins (one polygon, or one circle per pin for one or two pins). */
export type Area={rings:Ring[]};
export type BBox={south:number;west:number;north:number;east:number};
export type GeoJsonPolygon={type:'Polygon';coordinates:number[][][]};

/** The Kingdom with a small margin: a drawn area outside it is a mistake. */
export const SAUDI_BOUNDS:BBox={south:16,west:34.4,north:32.3,east:55.7};
export const WORK_AREA_LIMITS={minVertices:3,maxVertices:200,minAreaM2:2500,maxAreaKm2:40,maxSideKm:15} as const;
/** The fallback area: 500 m around each pin of the representative's own customers (lib/work-areas-server.ts says which). */
export const FALLBACK_BUFFER_METRES=500;
/** A street piece is «empty» when no customer pin of the company lies this close to it. */
export const NEAR_PROJECT_METRES=50;
/** Street pieces are cut to at most this length (so about 100 to 150 m each). */
export const SEGMENT_METRES=150;

const EARTH=6371008.8,RAD=Math.PI/180;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export const roundCoordinate=(v:number)=>Math.round(v*1e6)/1e6;

/** Great-circle distance in metres. */
export function metresBetween(a:LatLng,b:LatLng){
 const dLat=(b[0]-a[0])*RAD,dLng=(b[1]-a[1])*RAD,h=Math.sin(dLat/2)**2+Math.cos(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.sin(dLng/2)**2;
 return 2*EARTH*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
/** A flat projection in metres around a reference latitude; x grows east, y north. */
export function plane(latitude:number){
 const k=Math.cos(latitude*RAD),m=EARTH*RAD;
 return {xy:(p:LatLng):[number,number]=>[p[1]*m*k,p[0]*m],point:(x:number,y:number):LatLng=>[y/m,x/(m*k)]};
}
type Plane=ReturnType<typeof plane>;
const mean=(values:number[])=>values.reduce((n,v)=>n+v,0)/(values.length||1);

/** Shortest distance in metres from a point to the segment a–b. */
export function pointSegmentMetres(p:LatLng,a:LatLng,b:LatLng){
 const f=plane(p[0]),[px,py]=f.xy(p),[ax,ay]=f.xy(a),[bx,by]=f.xy(b),dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy;
 const t=len?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len)):0;
 return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
export function polylineMetres(line:readonly LatLng[]){let n=0;for(let i=1;i<line.length;i++)n+=metresBetween(line[i-1],line[i]);return n;}
export function pointPolylineMetres(p:LatLng,line:readonly LatLng[]){
 if(line.length===1)return metresBetween(p,line[0]);
 let best=Infinity;for(let i=1;i<line.length;i++)best=Math.min(best,pointSegmentMetres(p,line[i-1],line[i]));return best;
}

function dedupe(points:readonly LatLng[]){const seen=new Set<string>(),out:LatLng[]=[];for(const p of points){if(!finite(p?.[0])||!finite(p?.[1]))continue;const key=roundCoordinate(p[0])+','+roundCoordinate(p[1]);if(!seen.has(key)){seen.add(key);out.push([p[0],p[1]]);}}return out;}

/** A circle as a polygon of `steps` points, drawn just outside the true circle so that the circle is always inside it. */
export function circle(center:LatLng,metres:number,steps=24):Ring{
 const f=plane(center[0]),[cx,cy]=f.xy(center),r=metres/Math.cos(Math.PI/steps),out:Ring=[];
 for(let i=0;i<steps;i++){const a=2*Math.PI*i/steps;out.push(f.point(cx+r*Math.cos(a),cy+r*Math.sin(a)));}
 return out;
}

/** The fallback work area (GSCO's owner, 2026-11-18: «منطقة المندوب = حوالين مشاريعه + نص كيلو»; Yourrest: his customers): a 500 m disk
 * around each of the representative's pins; the area is their union (a point is in it when it is in any disk). Repeated pins count once. */
export function pinDisks(points:readonly LatLng[],metres=FALLBACK_BUFFER_METRES,steps=24):Area{
 return {rings:dedupe(points).map(p=>circle(p,metres,steps))};
}

/** The disks grouped for the street lookup: disks that touch or overlap form one group (one box asked of OpenStreetMap), so a representative
 * whose customers are spread over a city still gets the streets near each of them. A group wider than `maxSideKm` is cut into square tiles by
 * its pins, so every group's box stays within the lookup's limits. Biggest groups first. */
export function pinClusters(points:readonly LatLng[],metres=FALLBACK_BUFFER_METRES,maxSideKm=10):LatLng[][]{
 const unique=dedupe(points);if(!unique.length)return [];
 const f=plane(mean(unique.map(p=>p[0]))),xy=unique.map(p=>f.xy(p)),link=2*metres;
 const parent=unique.map((_,i)=>i),find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
 const grid=new Map<string,number[]>(),bucket=<T,>(map:Map<string,T[]>,key:string)=>{let list=map.get(key);if(!list){list=[];map.set(key,list);}return list;};
 xy.forEach(([x,y],i)=>{
  const gx=Math.floor(x/link),gy=Math.floor(y/link);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of grid.get((gx+dx)+':'+(gy+dy))||[])if(Math.hypot(x-xy[j][0],y-xy[j][1])<=link){const a=find(i),b=find(j);if(a!==b)parent[a]=b;}
  bucket(grid,gx+':'+gy).push(i);
 });
 const groups=new Map<string,number[]>();unique.forEach((_,i)=>bucket(groups,String(find(i))).push(i));
 const tile=Math.max(link,maxSideKm*1000-2*metres),out:LatLng[][]=[];
 for(const members of groups.values()){
  const xs=members.map(i=>xy[i][0]),ys=members.map(i=>xy[i][1]),x0=Math.min(...xs),y0=Math.min(...ys);
  if(Math.max(...xs)-x0<=tile&&Math.max(...ys)-y0<=tile){out.push(members.map(i=>unique[i]));continue;}
  const tiles=new Map<string,LatLng[]>();
  for(const i of members)bucket(tiles,Math.floor((xy[i][0]-x0)/tile)+':'+Math.floor((xy[i][1]-y0)/tile)).push(unique[i]);
  out.push(...tiles.values());
 }
 return out.sort((a,b)=>b.length-a.length||a[0][0]-b[0][0]||a[0][1]-b[0][1]);
}

/** The line to draw around an area: a drawn polygon closed on itself, or for the disks each circle without the part inside another disk, cut
 * exactly where the circles cross (the outline of their union). */
export function areaOutline(area:Area):LatLng[][]{
 if(area.rings.length===1)return [[...area.rings[0],area.rings[0][0]]];
 const boxes=area.rings.map(r=>bboxOf({rings:[r]})!),overlap=(a:BBox,b:BBox)=>a.south<=b.north&&b.south<=a.north&&a.west<=b.east&&b.west<=a.east;
 return area.rings.flatMap((ring,i)=>{
  const others=area.rings.filter((_,j)=>j!==i&&overlap(boxes[i],boxes[j])),closed=[...ring,ring[0]];
  if(!others.length)return [closed];
  const g=bboxGrow(boxes[i],20),frame:Ring=[[g.south,g.west],[g.south,g.east],[g.north,g.east],[g.north,g.west]];
  return clipPolyline(closed,{rings:[frame]},{rings:others});
 });
}

/** Area in square metres (the shoelace formula on the flat projection). */
export function ringAreaM2(ring:readonly LatLng[]){
 if(ring.length<3)return 0;
 const f=plane(mean(ring.map(p=>p[0])));let sum=0;
 for(let i=0;i<ring.length;i++){const [x1,y1]=f.xy(ring[i]),[x2,y2]=f.xy(ring[(i+1)%ring.length]);sum+=x1*y2-x2*y1;}
 return Math.abs(sum)/2;
}
export const areaM2=(area:Area)=>area.rings.reduce((n,r)=>n+ringAreaM2(r),0);
export function bboxOf(area:Area):BBox|null{
 const all=area.rings.flat();if(!all.length)return null;
 return {south:Math.min(...all.map(p=>p[0])),west:Math.min(...all.map(p=>p[1])),north:Math.max(...all.map(p=>p[0])),east:Math.max(...all.map(p=>p[1]))};
}
/** The two sides of a box in kilometres (north–south, east–west at its middle). */
export function bboxSidesKm(b:BBox){
 const mid=(b.south+b.north)/2;
 return {height:metresBetween([b.south,b.west],[b.north,b.west])/1000,width:metresBetween([mid,b.west],[mid,b.east])/1000};
}
export function bboxContains(b:BBox,p:LatLng){return p[0]>=b.south&&p[0]<=b.north&&p[1]>=b.west&&p[1]<=b.east;}
/** The box widened by a margin in metres on every side. */
export function bboxGrow(b:BBox,metres:number):BBox{
 const dLat=metres/(EARTH*RAD),dLng=metres/(EARTH*RAD*Math.max(0.01,Math.cos(((b.south+b.north)/2)*RAD)));
 return {south:b.south-dLat,west:b.west-dLng,north:b.north+dLat,east:b.east+dLng};
}

/** Ray casting; a point exactly on an edge may fall either way, which does not matter at street scale. */
export function pointInRing(p:LatLng,ring:readonly LatLng[]){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [yi,xi]=ring[i],[yj,xj]=ring[j];
  if((yi>p[0])!==(yj>p[0])&&p[1]<(xj-xi)*(p[0]-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
export const pointInArea=(p:LatLng,area:Area)=>area.rings.some(r=>pointInRing(p,r));

type XY=[number,number];
const orient=(a:XY,b:XY,c:XY)=>{const v=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);return Math.abs(v)<1e-9?0:v>0?1:-1;};
const onSegment=(a:XY,b:XY,p:XY)=>Math.min(a[0],b[0])-1e-9<=p[0]&&p[0]<=Math.max(a[0],b[0])+1e-9&&Math.min(a[1],b[1])-1e-9<=p[1]&&p[1]<=Math.max(a[1],b[1])+1e-9;
function segmentsTouch(a:XY,b:XY,c:XY,d:XY){
 const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
 if(o1!==o2&&o3!==o4&&o1!==0&&o2!==0&&o3!==0&&o4!==0)return true;
 return (o1===0&&onSegment(a,b,c))||(o2===0&&onSegment(a,b,d))||(o3===0&&onSegment(c,d,a))||(o4===0&&onSegment(c,d,b));
}
/** Whether any two edges of the ring cross or touch, other than neighbours at their shared corner. */
export function ringSelfIntersects(ring:readonly LatLng[]){
 const f=plane(mean(ring.map(p=>p[0]))),v=ring.map(p=>f.xy(p)),n=v.length;
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  if(j===i+1||(i===0&&j===n-1))continue;
  if(segmentsTouch(v[i],v[(i+1)%n],v[j],v[(j+1)%n]))return true;
 }
 return false;
}

export type PolygonCheck={ok:true;ring:Ring;areaM2:number}|{ok:false;error:string};
/** The one check for a drawn work area, on the page before saving and on the server before storing: a GeoJSON Polygon with one ring (no
 * holes) of 3 to 200 corners given as numbers [longitude, latitude], inside Saudi Arabia, not crossing itself, at least 2,500 m² and at most
 * 40 km², and no side of its box longer than 15 km. The ring comes back open, rounded to 6 decimals (about 10 cm), without repeated corners. */
export function checkWorkAreaPolygon(input:unknown):PolygonCheck{
 const shape='شكل منطقة العمل غير صحيح.';
 if(!input||typeof input!=='object'||Array.isArray(input))return {ok:false,error:shape};
 const g=input as {type?:unknown;coordinates?:unknown};
 if(g.type!=='Polygon'||!Array.isArray(g.coordinates)||g.coordinates.length!==1||!Array.isArray(g.coordinates[0]))return {ok:false,error:shape};
 const raw=g.coordinates[0] as unknown[];
 if(raw.length>WORK_AREA_LIMITS.maxVertices+1)return {ok:false,error:'منطقة العمل تتجاوز 200 نقطة.'};
 const ring:Ring=[];
 for(const c of raw){
  if(!Array.isArray(c)||c.length!==2||!finite(c[0])||!finite(c[1]))return {ok:false,error:shape};
  const p:LatLng=[roundCoordinate(c[1]),roundCoordinate(c[0])];
  if(!ring.length||ring[ring.length-1][0]!==p[0]||ring[ring.length-1][1]!==p[1])ring.push(p);
 }
 while(ring.length>1&&ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1])ring.pop();
 if(ring.length<WORK_AREA_LIMITS.minVertices)return {ok:false,error:'ارسم منطقة العمل بثلاث نقاط على الأقل.'};
 if(ring.length>WORK_AREA_LIMITS.maxVertices)return {ok:false,error:'منطقة العمل تتجاوز 200 نقطة.'};
 if(!ring.every(p=>bboxContains(SAUDI_BOUNDS,p)))return {ok:false,error:'منطقة العمل خارج حدود المملكة العربية السعودية.'};
 const box=bboxOf({rings:[ring]})!,sides=bboxSidesKm(box);
 if(sides.height>WORK_AREA_LIMITS.maxSideKm||sides.width>WORK_AREA_LIMITS.maxSideKm)return {ok:false,error:'يتجاوز طول منطقة العمل أو عرضها 15 كم.'};
 if(ringSelfIntersects(ring))return {ok:false,error:'أضلاع منطقة العمل متقاطعة. حرّك النقاط حتى لا تتقاطع الحدود.'};
 const area=ringAreaM2(ring);
 if(area<WORK_AREA_LIMITS.minAreaM2)return {ok:false,error:'منطقة العمل صغيرة جدًا.'};
 if(area>WORK_AREA_LIMITS.maxAreaKm2*1e6)return {ok:false,error:'مساحة منطقة العمل تتجاوز 40 كم².'};
 return {ok:true,ring,areaM2:area};
}
export function ringToGeoJson(ring:readonly LatLng[]):GeoJsonPolygon{
 const coordinates=ring.map(([lat,lng])=>[roundCoordinate(lng),roundCoordinate(lat)]);
 return {type:'Polygon',coordinates:[[...coordinates,coordinates[0]]]};
}
/** Whether an area is small enough to look up its streets: the same caps as a drawn area. */
export function areaWithinLimits(area:Area){
 const box=bboxOf(area);if(!box)return false;const sides=bboxSidesKm(box);
 return sides.height<=WORK_AREA_LIMITS.maxSideKm&&sides.width<=WORK_AREA_LIMITS.maxSideKm&&areaM2(area)<=WORK_AREA_LIMITS.maxAreaKm2*1e6;
}

/** The parts of a line inside the area (and outside `exclude`, when given). Each line segment is cut where it crosses an edge, a piece is kept
 * when its middle is inside, and pieces that follow each other are joined (so a street through overlapping disks stays one piece). */
export function clipPolyline(line:readonly LatLng[],area:Area,exclude?:Area):LatLng[][]{
 if(line.length<2||!area.rings.length)return [];
 const f:Plane=plane(mean(area.rings.flat().map(p=>p[0])));
 const prep=(ring:Ring,inArea:boolean)=>{const v=ring.map(p=>f.xy(p)),xs=v.map(p=>p[0]),ys=v.map(p=>p[1]);return {v,inArea,x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};};
 const rings=[...area.rings.map(r=>prep(r,true)),...(exclude?.rings||[]).map(r=>prep(r,false))];
 const inPolygon=(p:XY,v:XY[])=>{let inside=false;for(let i=0,j=v.length-1;i<v.length;j=i++){if((v[i][1]>p[1])!==(v[j][1]>p[1])&&p[0]<(v[j][0]-v[i][0])*(p[1]-v[i][1])/(v[j][1]-v[i][1])+v[i][0])inside=!inside;}return inside;};
 const inside=(p:XY)=>{let hit=false;for(const r of rings){if(p[0]<r.x0||p[0]>r.x1||p[1]<r.y0||p[1]>r.y1||!inPolygon(p,r.v))continue;if(!r.inArea)return false;hit=true;}return hit;};
 const pieces:LatLng[][]=[];let current:LatLng[]|null=null;
 for(let i=1;i<line.length;i++){
  const a=f.xy(line[i-1]),b=f.xy(line[i]),cuts=[0,1];
  const sx0=Math.min(a[0],b[0]),sx1=Math.max(a[0],b[0]),sy0=Math.min(a[1],b[1]),sy1=Math.max(a[1],b[1]);
  for(const r of rings){
   if(r.x1<sx0||r.x0>sx1||r.y1<sy0||r.y0>sy1)continue;
   for(let k=0;k<r.v.length;k++){
    const c=r.v[k],d=r.v[(k+1)%r.v.length],rx=b[0]-a[0],ry=b[1]-a[1],qx=d[0]-c[0],qy=d[1]-c[1],den=rx*qy-ry*qx;
    if(Math.abs(den)<1e-12)continue;
    const t=((c[0]-a[0])*qy-(c[1]-a[1])*qx)/den,u=((c[0]-a[0])*ry-(c[1]-a[1])*rx)/den;
    if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);
   }
  }
  cuts.sort((x,y)=>x-y);
  for(let k=1;k<cuts.length;k++){
   const t0=cuts[k-1],t1=cuts[k];if(t1-t0<1e-9)continue;
   const at=(t:number):XY=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
   if(inside(at((t0+t1)/2))){const p1=f.point(...at(t1));if(current)current.push(p1);else{current=[f.point(...at(t0)),p1];pieces.push(current);}}
   else current=null;
  }
 }
 return pieces;
}

/** A line cut into equal pieces of at most `metres` each (so a 400 m street gives three pieces of about 133 m). */
export function splitPolyline(line:readonly LatLng[],metres=SEGMENT_METRES):LatLng[][]{
 if(line.length<2)return [];
 const total=polylineMetres(line);if(!(total>0))return [];
 const count=Math.max(1,Math.ceil(total/metres)),step=total/count,out:LatLng[][]=[];
 let piece:LatLng[]=[line[0]],walked=0,target=step;
 for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i],len=metresBetween(a,b);
  while(out.length<count-1&&walked+len>=target&&len>0){
   const t=(target-walked)/len,cut:LatLng=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
   piece.push(cut);out.push(piece);piece=[cut];target+=step;
  }
  piece.push(b);walked+=len;
 }
 out.push(piece);
 return out.filter(p=>p.length>=2);
}

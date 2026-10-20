import {kingdomRings} from './kingdom-border';

/** The Kingdom's envelope with a margin: the most a map may be dragged away from it ([south, west], [north, east]). */
export const kingdomBounds:[[number,number],[number,number]]=[[15.6,34.2],[32.6,56.0]];
/** How far outside the drawn border a point may still be taken as inside: the border is simplified to about 900 m and a phone's fix at the border can be off by a few. */
export const KINGDOM_MARGIN_KM=5;

const KM_PER_DEGREE=111.32;
/** Ray casting on one ring (the ring is not repeated at its end). */
function inRing(lat:number,lng:number,ring:readonly (readonly [number,number])[]){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [la,ln]=ring[i],[lb,lnb]=ring[j];
  if((la>lat)!==(lb>lat)&&lng<(lnb-ln)*(lat-la)/(lb-la)+ln)inside=!inside;
 }
 return inside;
}
/** Distance in kilometres from a point to the nearest border segment (flat approximation, ample at a few kilometres). */
function borderDistanceKm(lat:number,lng:number){
 const scale=Math.cos(lat*Math.PI/180);let best=Infinity;
 for(const ring of kingdomRings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const ax=(ring[j][1]-lng)*scale,ay=ring[j][0]-lat,bx=(ring[i][1]-lng)*scale,by=ring[i][0]-lat;
  const dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/len)):0;
  best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy));
 }
 return best*KM_PER_DEGREE;
}
/** Whether a point lies within the Kingdom's border, or within `marginKm` of it. */
export function insideKingdom(latitude:number,longitude:number,marginKm=KINGDOM_MARGIN_KM){
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return false;
 if(latitude<kingdomBounds[0][0]||latitude>kingdomBounds[1][0]||longitude<kingdomBounds[0][1]||longitude>kingdomBounds[1][1])return false;
 if(kingdomRings.some(ring=>inRing(latitude,longitude,ring)))return true;
 return marginKm>0&&borderDistanceKm(latitude,longitude)<=marginKm;
}

import type * as Leaflet from 'leaflet';
import {pointSegmentMetres,type LatLng} from './work-area-geometry';

/** «خريطة المصانع» (the port of GSCO 2.13.81): the sales manager draws a representative's work area on the map. A small tool on Leaflet
 * itself (no drawing library): tap the map to add corners; drag a corner to move it; tap a corner for «حذف النقطة»; while editing, a tap on the map adds a
 * corner on the nearest side. Corners are plain DOM markers, so they work with a finger in the Android app too. */
export type AreaEditor={points:()=>LatLng[];undo:()=>void;setMode:(mode:'draw'|'edit')=>void;destroy:()=>void};
export type AreaEditorOptions={points:LatLng[];mode:'draw'|'edit';color:string;deleteLabel:string;cornerLabel:string;onChange:(points:LatLng[])=>void};

/** Where a new corner goes when editing: after the corner that starts the side nearest to the tap. */
export function insertionIndex(points:readonly LatLng[],p:LatLng){
 if(points.length<2)return points.length;
 let best=0,distance=Infinity;
 for(let i=0;i<points.length;i++){const d=pointSegmentMetres(p,points[i],points[(i+1)%points.length]);if(d<distance){distance=d;best=i;}}
 return best+1;
}

export function createAreaEditor(L:typeof Leaflet,map:Leaflet.Map,options:AreaEditorOptions):AreaEditor{
 const points=options.points.map(p=>[p[0],p[1]] as LatLng);let mode=options.mode;
 const group=L.layerGroup().addTo(map);
 const shape=L.polygon([],{color:options.color,weight:2,fillColor:options.color,fillOpacity:.08,interactive:false});
 const open=L.polyline([],{color:options.color,weight:2,dashArray:'6 6',interactive:false});
 const changed=()=>options.onChange(points.map(p=>[p[0],p[1]] as LatLng));
 const outline=()=>{if(points.length>=3){shape.setLatLngs(points);open.setLatLngs([]);}else{shape.setLatLngs([]);open.setLatLngs(points);}};
 function render(){
  group.clearLayers();group.addLayer(shape);group.addLayer(open);outline();
  points.forEach((p,i)=>{
   const corner=L.marker(p,{draggable:true,keyboard:true,title:options.cornerLabel+' '+(i+1),alt:options.cornerLabel+' '+(i+1),icon:L.divIcon({className:'work-area-vertex',iconSize:[22,22],iconAnchor:[11,11]})});
   corner.on('drag',()=>{const at=corner.getLatLng();points[i]=[at.lat,at.lng];outline();});
   corner.on('dragend',changed);
   // Built from DOM nodes with textContent only.
   const box=document.createElement('div'),button=document.createElement('button');box.className='work-area-vertex-popup';button.type='button';button.className='work-area-vertex-delete';button.textContent=options.deleteLabel;
   button.addEventListener('click',()=>{map.closePopup();points.splice(i,1);render();changed();});box.appendChild(button);
   corner.bindPopup(box,{closeButton:false,offset:[0,-8],autoPanPadding:[12,12]});
   group.addLayer(corner);
  });
 }
 const onClick=(e:Leaflet.LeafletMouseEvent)=>{
  const p:LatLng=[e.latlng.lat,e.latlng.lng];
  if(mode==='draw'||points.length<3)points.push(p);else points.splice(insertionIndex(points,p),0,p);
  render();changed();
 };
 map.on('click',onClick);map.doubleClickZoom.disable();render();
 return {
  points:()=>points.map(p=>[p[0],p[1]] as LatLng),
  undo(){if(!points.length)return;points.pop();render();changed();},
  setMode(next){mode=next;},
  // Leaving always puts the map back, even if a drag was cut off half-way.
 destroy(){map.off('click',onClick);map.doubleClickZoom.enable();try{map.closePopup();group.remove();}catch{/* a half-finished drag cannot stop the map from being given back */}},
 };
}

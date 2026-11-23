'use client';
/** «موقعي» on the customers' map (lib/my-location.ts): the device's position as a blue dot with its accuracy circle, kept up to date while
 *  the map is open. «موقعي» starts it (the device asks for the permission the first time) and centres the map on the dot; when the
 *  permission was already given, the dot shows by itself when the map opens, without moving the map. Read on the device only. */
import {useCallback,useEffect,useRef,useState} from 'react';
import type * as Leaflet from 'leaflet';
import {MY_LOCATION_WATCH,myLocationOnMap,myLocationProblemOf,myLocationZoom,readMyLocation,type MyLocationFix,type MyLocationState} from '@/lib/my-location';
import type {MapRefs} from './work-area-map';

const PANE='cmMyLocation',BLUE='#1a73e8';
type Shapes={circle:Leaflet.Circle;dot:Leaflet.CircleMarker};

export function useMyLocation(refs:MapRefs){
 const [state,setState]=useState<MyLocationState>({status:'off'});
 const watch=useRef<number|null>(null),centre=useRef(false),shapes=useRef<Shapes|null>(null),fixRef=useRef<MyLocationFix|null>(null),alive=useRef(true);
 const geo=()=>typeof navigator!=='undefined'&&navigator.geolocation?navigator.geolocation:null;
 const stop=useCallback(()=>{const g=geo();if(watch.current!==null&&g)g.clearWatch(watch.current);watch.current=null;},[]);
 const erase=useCallback(()=>{if(shapes.current){shapes.current.circle.remove();shapes.current.dot.remove();shapes.current=null;}},[]);
 // The dot and its circle, on a pane of their own above the customers, never tapped.
 const draw=useCallback((fix:MyLocationFix)=>{
  const m=refs.map.current,L=refs.leaflet.current;if(!m||!L)return;
  if(!myLocationOnMap(fix)){erase();return;}
  if(!m.getPane(PANE)){const pane=m.createPane(PANE);pane.style.zIndex='610';pane.style.pointerEvents='none';}
  const at:[number,number]=[fix.latitude,fix.longitude];
  if(shapes.current){shapes.current.circle.setLatLng(at).setRadius(fix.accuracy);shapes.current.dot.setLatLng(at);return;}
  shapes.current={
   circle:L.circle(at,{radius:fix.accuracy,pane:PANE,color:BLUE,weight:1,opacity:.5,fillColor:BLUE,fillOpacity:.14,interactive:false}).addTo(m),
   dot:L.circleMarker(at,{radius:8,pane:PANE,color:'#fff',weight:3,fillColor:BLUE,fillOpacity:1,interactive:false}).addTo(m)
  };
 },[refs,erase]);
 const centreOn=useCallback((fix:MyLocationFix)=>{const m=refs.map.current;if(!m)return false;m.setView([fix.latitude,fix.longitude],Math.max(m.getZoom(),myLocationZoom(fix.accuracy)));return true;},[refs]);
 const take=useCallback((fix:MyLocationFix)=>{
  fixRef.current=fix;draw(fix);
  if(!myLocationOnMap(fix)){centre.current=false;setState({status:'problem',problem:'outside',fix});return;}
  if(centre.current&&centreOn(fix))centre.current=false;
  setState({status:'shown',fix});
 },[draw,centreOn]);
 const start=useCallback((centred:boolean)=>{
  const g=geo();if(!g){setState({status:'problem',problem:'unsupported'});return;}
  if(centred)centre.current=true;
  const fix=fixRef.current;
  if(watch.current!==null){if(centred&&fix&&myLocationOnMap(fix)&&centreOn(fix))centre.current=false;return;}
  setState(fix?{status:'shown',fix}:{status:'locating'});
  try{
   watch.current=g.watchPosition(position=>{if(!alive.current)return;const reading=readMyLocation(position);if(reading)take(reading);},error=>{
    if(!alive.current)return;const problem=myLocationProblemOf(error?.code);
    // Refused: the watch ends and the dot goes. A slow or missing reading: the watch goes on, and a dot already shown stays.
    if(problem==='denied'){stop();erase();fixRef.current=null;centre.current=false;setState({status:'problem',problem});return;}
    if(!fixRef.current)setState({status:'problem',problem});
   },MY_LOCATION_WATCH);
  }catch{watch.current=null;setState({status:'problem',problem:'unavailable'});}
 },[take,stop,erase,centreOn]);
 /** «موقعي»: starts the watch (asking the permission the first time, again after a refusal) and centres the map on the dot. */
 const locate=useCallback(()=>{
  // After a refusal or an error before any reading, ask afresh.
  if(state.status==='problem'&&!fixRef.current)stop();
  start(true);
 },[start,stop,state.status]);
 // The permission already given: the dot without a tap, the map left where it is.
 useEffect(()=>{
  if(!refs.ready)return;let cancelled=false;
  const permissions=typeof navigator!=='undefined'?navigator.permissions:undefined;
  void permissions?.query({name:'geolocation' as PermissionName}).then(status=>{if(!cancelled&&status.state==='granted')start(false);}).catch(()=>{});
  return()=>{cancelled=true;};
 },[refs.ready,start]);
 // A fix read before the map was ready is drawn once it is.
 useEffect(()=>{if(refs.ready&&fixRef.current)draw(fixRef.current);},[refs.ready,draw]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop();erase();};},[stop,erase]);
 return {state,locate};
}

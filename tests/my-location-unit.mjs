// «موقعي» on the customers' map (the owner, 2026-11-23: «عايز فى الخريطة اقدر اشوف انا واقف فين بالظبط»), unit by unit:
// - lib/my-location.ts: a reading of the device (coordinates, accuracy, time; a coarse guess over 5 km is no reading), whether the map
//   shows the place, the error codes, the zoom by accuracy, and the words in Arabic and English.
// - app/my-location.tsx (the hook) with React's hooks played here, a stand-in map and Leaflet, and a stand-in geolocation: «موقعي» starts
//   the watch (the GPS, a fresh reading) and centres the map on the first reading, later readings move the dot without moving the map,
//   «موقعي» again centres it, a slow reading keeps a dot already shown, a refusal ends the watch and removes the dot, «موقعي» after it asks
//   again, a place outside the map draws nothing and moves nothing, a permission already given shows the dot without a tap and without
//   moving the map, no geolocation says so, and leaving the map ends the watch and removes the dot. Nothing is sent anywhere.
import assert from 'node:assert/strict';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const {eq,ok,report}=makeChecks(assert);
// React's hooks as a component calls them, in order (a re-render reads the same slots).
const hooksModule=`const H=()=>globalThis.testHooks;export const useState=v=>H().useState(v);export const useRef=v=>H().useRef(v);export const useCallback=(f,d)=>H().useCallback(f,d);export const useEffect=(f,d)=>H().useEffect(f,d);export default {};`;
const {load}=createLoader('my-location-unit',{replace:{react:hooksModule}});
const M=await load('lib/my-location.ts');

// ======================================================================================== lib/my-location.ts
const reading=(latitude,longitude,accuracy=12,timestamp=1700000000000)=>({coords:{latitude,longitude,accuracy},timestamp});
eq(M.readMyLocation(reading(21.5,39.2,12.4)),{latitude:21.5,longitude:39.2,accuracy:12.4,at:1700000000000},'a reading of the device');
for(const [name,value] of [['no coords',{timestamp:1}],['latitude out of range',reading(91,39)],['longitude out of range',reading(21,-181)],['a negative accuracy',reading(21,39,-1)],['a coarse guess over 5 km',reading(21,39,5001)],['no time',{coords:{latitude:21,longitude:39,accuracy:5}}],['a zero time',reading(21,39,5,0)],['a text latitude',{coords:{latitude:'21',longitude:39,accuracy:5},timestamp:1}],['NaN',reading(NaN,39)],['null',null],['undefined',undefined]])
 eq(M.readMyLocation(value),null,'not a reading: '+name);
eq(M.readMyLocation(reading(21,39,5000))?.accuracy,5000,'5 km exactly is still a reading');
eq([M.myLocationOnMap({latitude:24.7,longitude:46.7}),M.myLocationOnMap({latitude:21.5,longitude:39.2}),M.myLocationOnMap({latitude:30.04,longitude:31.24}),M.myLocationOnMap({latitude:25.3,longitude:55.3}),M.myLocationOnMap({latitude:15.6,longitude:34.2})],[true,true,false,true,true],'Riyadh and Jeddah on the map, Cairo not; the map\'s own margin (Dubai, the corner) counts');
eq([1,2,3,0,undefined,'x'].map(M.myLocationProblemOf),['denied','unavailable','timeout','unavailable','unavailable','unavailable'],'the error codes');
eq([5,50,51,200,201,1000,1001,5000].map(M.myLocationZoom),[17,17,16,16,15,15,13,13],'the finer the reading, the closer');
eq([M.myLocationAccuracyText(12.4,'ar'),M.myLocationAccuracyText(12.5,'en'),M.myLocationAccuracyText(999.4,'ar'),M.myLocationAccuracyText(1500,'ar'),M.myLocationAccuracyText(1500,'en'),M.myLocationAccuracyText(-3,'ar')],['أنت هنا · الدقة ±12 م','You are here · accuracy ±13 m','أنت هنا · الدقة ±999 م','أنت هنا · الدقة ±1.5 كم','You are here · accuracy ±1.5 km','أنت هنا · الدقة ±0 م'],'the accuracy in metres, then kilometres');
eq([M.myLocationLine({status:'off'},'ar'),M.myLocationLine({status:'locating'},'ar'),M.myLocationLine({status:'locating'},'en'),M.myLocationLine({status:'shown',fix:{latitude:1,longitude:1,accuracy:8,at:1}},'ar'),M.myLocationLine({status:'problem',problem:'denied'},'ar'),M.myLocationLine({status:'problem',problem:'outside'},'en')],['','جارٍ تحديد موقعك…','Finding your location…','أنت هنا · الدقة ±8 م',M.MY_LOCATION_TEXT.denied[0],'Your location is outside the map.'],'the line under the buttons, for each state');
for(const [key,[ar,en]] of Object.entries(M.MY_LOCATION_TEXT))ok(/[؀-ۿ]/.test(ar)&&!/[؀-ۿ]/.test(en)&&en.trim()===en&&ar.trim()===ar,'Arabic and English for '+key);
eq(M.MY_LOCATION_WATCH,{enableHighAccuracy:true,maximumAge:0,timeout:20000},'the GPS itself, a fresh reading, 20 seconds');

// ======================================================================================== app/my-location.tsx
function harness({geolocation=true,permission='prompt'}={}){
 const states=[],refs=[],effects=[],memo=[];let cursor=0,dirty=false;
 globalThis.testHooks={
  useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{const next=typeof value==='function'?value(states[i]):value;if(!Object.is(next,states[i])){states[i]=next;dirty=true;}}];},
  useRef(initial){const i=cursor++;return refs[i]||(refs[i]={current:initial});},
  useCallback(fn,deps){const i=cursor++,old=memo[i];if(old&&deps&&deps.length===old.deps.length&&deps.every((d,k)=>Object.is(d,old.deps[k])))return old.fn;memo[i]={fn,deps:deps||[]};return fn;},
  useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||!deps||deps.length!==old.deps?.length||deps.some((d,k)=>!Object.is(d,old.deps[k])))effects[i]={fn,deps,cleanup:old?.cleanup,pending:true};}
 };
 const panes=new Map(),shapes=[];
 const map={views:[],zoom:11,getZoom(){return this.zoom;},setView(at,zoom){this.views.push({at,zoom});this.zoom=zoom;},getPane:name=>panes.get(name),createPane(name){const pane={style:{}};panes.set(name,pane);return pane;}};
 const shape=(kind)=>(at,options)=>{const value={kind,at,options,radius:options.radius,on:false,addTo(){this.on=true;shapes.push(this);return this;},setLatLng(next){this.at=next;return this;},setRadius(r){this.radius=r;return this;},remove(){this.on=false;return this;}};return value;};
 const L={circle:shape('circle'),circleMarker:shape('dot')};
 const watches=[];let nextId=1;
 const geo={watchPosition(success,failure,options){const w={id:nextId++,success,failure,options,cleared:false};watches.push(w);return w.id;},clearWatch(id){const w=watches.find(item=>item.id===id);if(w)w.cleared=true;}};
 const permissionQueries=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,writable:true,value:{...(geolocation?{geolocation:geo}:{}),permissions:{query:async q=>{permissionQueries.push(q);return {state:permission};}}}});
 const mapRefs={map:{current:map},leaflet:{current:L},ready:false};
 let hook,api;
 const render=()=>{cursor=0;dirty=false;api=hook.useMyLocation(mapRefs);for(const e of effects.filter(Boolean))if(e.pending){e.pending=false;e.cleanup?.();e.cleanup=e.fn();}return api;};
 const flush=async()=>{for(let i=0;i<10;i++){render();await new Promise(r=>setImmediate(r));if(!dirty)break;}return api;};
 const live=()=>watches.filter(w=>!w.cleared);
 const fire=async(value)=>{for(const w of live())w.success(value);return flush();};
 const fail=async(code)=>{for(const w of live())w.failure({code});return flush();};
 return {async mount(){hook=await load('app/my-location.tsx');return flush();},async ready(){mapRefs.ready=true;return flush();},unmount(){for(const e of effects.filter(Boolean))e.cleanup?.();},get api(){return api;},map,panes,shapes,watches,live,fire,fail,flush,permissionQueries,visible:()=>shapes.filter(s=>s.on)};
}

{
 const h=harness();await h.mount();await h.ready();
 eq([h.api.state,h.watches.length,h.permissionQueries.map(q=>q.name)],[{status:'off'},0,['geolocation']],'opened with the permission not yet given: nothing asked of the GPS, no dot');
 h.api.locate();await h.flush();
 eq([h.api.state,h.live().length,h.live()[0].options],[{status:'locating'},1,M.MY_LOCATION_WATCH],'«موقعي»: one watch, the GPS, a fresh reading');
 await h.fire(reading(24.7136,46.6753,9));
 const [circle,dot]=h.visible();
 eq([h.api.state.status,h.api.state.fix.accuracy,circle.kind,circle.at,circle.radius,dot.kind,dot.at,dot.options.radius],['shown',9,'circle',[24.7136,46.6753],9,'dot',[24.7136,46.6753],8],'the first reading: the dot and a circle as wide as the accuracy');
 eq([circle.options.pane,dot.options.pane,circle.options.interactive,dot.options.interactive,h.panes.get('cmMyLocation').style],['cmMyLocation','cmMyLocation',false,false,{zIndex:'610',pointerEvents:'none'}],'on a pane of their own, above the customers, never tapped');
 eq(h.map.views,[{at:[24.7136,46.6753],zoom:17}],'and the map centred on it, close');
 h.map.zoom=12;await h.fire(reading(24.7140,46.6760,30));
 eq([h.visible().length,dot.at,circle.radius,h.map.views.length],[2,[24.714,46.676],30,1],'a later reading moves the dot and its circle, the map stays where the person left it');
 h.api.locate();await h.flush();
 eq([h.map.views.at(-1),h.live().length],[{at:[24.714,46.676],zoom:17},1],'«موقعي» again: centred on the last reading, the same watch');
 await h.fail(3);
 eq([h.api.state.status,h.visible().length,h.live().length],['shown',2,1],'a slow reading after one was shown: the dot stays and the watch goes on');
 await h.fire({coords:{latitude:'x'},timestamp:1});
 eq([h.api.state.fix.latitude,dot.at],[24.714,[24.714,46.676]],'a reading that is not one changes nothing');
 await h.fail(1);
 eq([h.api.state,h.visible().length,h.live().length],[{status:'problem',problem:'denied'},0,0],'refused: the watch ends and the dot goes');
 h.api.locate();await h.flush();
 eq([h.api.state,h.live().length,h.watches.length],[{status:'locating'},1,2],'«موقعي» after a refusal asks again');
 await h.fail(2);
 eq([h.api.state,h.live().length],[{status:'problem',problem:'unavailable'},1],'no reading yet and the device cannot tell: said so, the watch goes on');
 const views=h.map.views.length;
 await h.fire(reading(30.0444,31.2357,15));
 eq([h.api.state.status,h.api.state.problem,h.visible().length,h.map.views.length],['problem','outside',0,views],'a place outside the map: said so, no dot, the map not moved');
 await h.fire(reading(21.4858,39.1925,4));
 eq([h.api.state.status,h.visible().length,h.visible()[1].at],['shown',2,[21.4858,39.1925]],'back on the map: the dot again');
 h.unmount();
 eq([h.live().length,h.visible().length],[0,0],'leaving the map ends the watch and removes the dot');
}
{
 const h=harness({permission:'granted'});await h.mount();
 eq(h.watches.length,0,'nothing before the map is ready');
 await h.ready();
 eq([h.api.state,h.live().length],[{status:'locating'},1],'the permission already given: the watch starts by itself');
 await h.fire(reading(26.4207,50.0888,20));
 eq([h.api.state.status,h.visible().length,h.map.views],['shown',2,[]],'the dot shows without a tap, and the map is not moved');
 h.api.locate();await h.flush();
 eq(h.map.views,[{at:[26.4207,50.0888],zoom:17}],'«موقعي» centres it');
 h.unmount();
}
{
 const h=harness({permission:'denied'});await h.mount();await h.ready();
 eq([h.api.state,h.watches.length],[{status:'off'},0],'a permission refused before: nothing asked until «موقعي»');
 h.unmount();
}
{
 const h=harness({geolocation:false});await h.mount();await h.ready();
 h.api.locate();await h.flush();
 eq(h.api.state,{status:'problem',problem:'unsupported'},'a device without geolocation: said so');
 h.unmount();
}
delete globalThis.testHooks;
report();

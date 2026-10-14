'use client';
import {useEffect,useRef,useState} from 'react';
import type * as Leaflet from 'leaflet';
import {Check,Crosshair} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {direction,useLanguage} from '@/lib/i18n';
import './location-picker.css';

export type PickedPoint={latitude:number;longitude:number};
type View={center:[number,number];zoom:number};
/** Where the map opens when the customer has no location yet: its region, else the whole kingdom. */
const regionViews:Record<string,View>={'الشرقية':{center:[26.43,50.1],zoom:8},'الغربية':{center:[21.54,39.17],zoom:8},'الوسطى':{center:[24.71,46.67],zoom:8},'الشمالية':{center:[28.4,36.57],zoom:7},'الجنوبية':{center:[18.22,42.5],zoom:8}};
const kingdom:View={center:[24,45],zoom:5};
const pinHtml='<svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" fill="currentColor" stroke="#fff" stroke-width="1.4"/><circle cx="12" cy="10" r="3" fill="#fff"/></svg>';
const toPoint=(latlng:Leaflet.LatLng):PickedPoint=>{const wrapped=latlng.wrap();return{latitude:Number(wrapped.lat.toFixed(7)),longitude:Number(wrapped.lng.toFixed(7))};};
export const pointLabel=(value:PickedPoint)=>`${value.latitude.toFixed(7)}, ${value.longitude.toFixed(7)}`;

function PickerMap({initial,region,onChange}:{initial:PickedPoint|null;region:string;onChange:(value:PickedPoint)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const container=useRef<HTMLDivElement|null>(null),map=useRef<Leaflet.Map|null>(null),pin=useRef<Leaflet.Marker|null>(null),change=useRef(onChange),placeAtCenter=useRef<(()=>void)|null>(null);
 // What the map was opened with: it is built once, so later renders must not rebuild it.
 const start=useRef({initial,region,say});
 const [failed,setFailed]=useState(false),[tilesFailed,setTilesFailed]=useState(false);
 useEffect(()=>{change.current=onChange;});
 useEffect(()=>{
  const {initial:first,region:where,say:tr}=start.current;
  let alive=true;let resize:ResizeObserver|undefined;let settle:ReturnType<typeof setTimeout>|undefined;
  void import('leaflet').then(mod=>{
   if(!alive||!container.current)return;
   const L=mod.default||mod;
   const view:View=first?{center:[first.latitude,first.longitude],zoom:16}:regionViews[where]||kingdom;
   const m=L.map(container.current,{center:view.center,zoom:view.zoom,minZoom:2,maxZoom:19,zoomControl:false});map.current=m;
   L.control.zoom({position:'bottomleft',zoomInTitle:tr('تكبير','Zoom in'),zoomOutTitle:tr('تصغير','Zoom out')}).addTo(m);
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).on('tileerror',()=>{if(alive)setTilesFailed(true);}).on('tileload',()=>{if(alive)setTilesFailed(false);}).addTo(m);
   const place=(latlng:Leaflet.LatLng)=>{
    if(pin.current)pin.current.setLatLng(latlng);
    else{
     const label=tr('موقع العميل. اسحبه لتعديله.','Customer location. Drag to adjust.');
     const marker=L.marker(latlng,{draggable:true,keyboard:true,title:label,alt:label,icon:L.divIcon({className:'location-picker-pin',html:pinHtml,iconSize:[38,38],iconAnchor:[19,35]})}).addTo(m);
     marker.on('dragend',()=>change.current(toPoint(marker.getLatLng())));
     pin.current=marker;
    }
    change.current(toPoint(latlng));
   };
   m.on('click',event=>place(event.latlng));
   if(first)place(L.latLng(first.latitude,first.longitude));
   placeAtCenter.current=()=>place(m.getCenter());
   // The dialog animates in and a phone keyboard may resize it: keep the map's size in step.
   resize=new ResizeObserver(()=>m.invalidateSize({pan:false}));resize.observe(container.current);
   settle=setTimeout(()=>m.invalidateSize({pan:false}),300);
  }).catch(()=>{if(alive)setFailed(true);});
  return()=>{alive=false;placeAtCenter.current=null;resize?.disconnect();if(settle)clearTimeout(settle);map.current?.remove();map.current=null;pin.current=null;};
 },[]);
 const offline=typeof navigator!=='undefined'&&navigator.onLine===false;
 return <>
  <div className="location-picker-map-wrap">
   <div ref={container} className="location-picker-map" dir="ltr" role="application" aria-label={say('خريطة اختيار موقع العميل','Map for choosing the customer location')}/>
   {failed&&<p className="location-picker-note" role="alert">{say('تعذر تحميل الخريطة. اكتب الإحداثيات في النموذج بدلًا منها.','The map could not load. Type the coordinates in the form instead.')}</p>}
   {!failed&&(tilesFailed||offline)&&<p className="location-picker-note" role="status">{say('الخريطة تحتاج اتصالًا بالإنترنت لتظهر الشوارع. يمكنك كتابة الإحداثيات في النموذج بدلًا منها.','The map needs an internet connection to show streets. You can type the coordinates in the form instead.')}</p>}
  </div>
  <button type="button" className="btn subtle small location-picker-center" onClick={()=>placeAtCenter.current?.()}><Crosshair size={16}/>{say('وضع الدبوس في وسط الخريطة','Put the pin at the map centre')}</button>
 </>;
}

/** A full-screen map on which the member taps the customer's place; nothing is saved until they confirm. */
export default function LocationPicker({initial=null,region='',onPick,onClose}:{initial?:PickedPoint|null;region?:string;onPick:(value:PickedPoint)=>void;onClose:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const [selected,setSelected]=useState<PickedPoint|null>(initial);
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="crm-dialog location-picker-dialog" dir={direction()}>
  <DialogTitle>{say('اختيار موقع العميل','Choose the customer location')}</DialogTitle>
  <DialogDescription>{say('اضغط على الخريطة في مكان المصنع، أو اسحب الدبوس لتعديله، ثم اضغط «تأكيد الموقع».','Tap the map where the factory is, or drag the pin to adjust it, then press “Confirm location”.')}</DialogDescription>
  <PickerMap initial={initial} region={region} onChange={setSelected}/>
  <p className="location-picker-point" dir="ltr" role="status">{selected?pointLabel(selected):say('لم يُحدد موقع بعد.','No location selected yet.')}</p>
  <div className="location-picker-actions">
   <button type="button" className="btn subtle" onClick={onClose}>{say('إلغاء','Cancel')}</button>
   <button type="button" className="btn primary" disabled={!selected} onClick={()=>{if(selected)onPick(selected);}}><Check size={18}/>{say('تأكيد الموقع','Confirm location')}</button>
  </div>
 </DialogContent></Dialog>;
}

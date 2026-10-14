'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {Loader2, LocateFixed, MapPin, MapPinned, RefreshCw} from 'lucide-react';
import {t, useLanguage} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import {captureVisitLocation} from '@/lib/visit-location';
import {coordinatesFromText, tidyLocationText} from '@/lib/customer-location';
import {customerTypes, customerStatuses, factoryCategories} from '@/lib/customer-options';
import LocationPicker from './location-picker';
import './customer-entry-fields.css';

const messageOf=(e:unknown)=>typeof e==='object'&&e!==null&&'message' in e&&typeof e.message==='string'?e.message:'';
export type CustomerData = { [field: string]: unknown; name?: string; code?: string; region?: string; city?: string; contact?: string; phone?: string; address?: string; location?: string; shortAddress?: string; customerType?: string; customerStatus?: string; category?: string };
export type CustomerDataUpdate = (current:CustomerData) => CustomerData;
type AddressResult = {status:'found'|'not_configured'|'not_found'|'unavailable'|'ambiguous';shortAddress?:string;address?:string;city?:string;message?:string};
export function CustomerClassificationFields({data,onChange,disabled=false}:{data:CustomerData;onChange:(key:string,value:string)=>void;disabled?:boolean}){
 useLanguage();
 return <>{([
  ['customerType','نوع العميل',customerTypes],
  ['customerStatus','حالة العميل',customerStatuses],
  ['category','فئة المصنع',factoryCategories],
 ] as const).map(([key,label,choices])=>{
  const values=[...choices,...(data[key]&&!choices.some(value=>value===data[key])?[data[key]]:[])];
  return <fieldset className="customer-choice-field full" key={key} disabled={disabled}><legend>{t(label)}</legend><div className="customer-choice-grid">{values.map(value=><label className="customer-choice" key={value}><input type="radio" name={'customer-choice-'+key} value={value} checked={data[key]===value} onChange={event=>{if(event.target.checked)onChange(key,value);}}/><span>{t(value)}</span></label>)}</div></fieldset>;
 })}</>;
}

const asText=(point:{latitude:number;longitude:number})=>`${point.latitude.toFixed(7)}, ${point.longitude.toFixed(7)}`;
/** A location chosen by hand is not something the phone captured: the coordinates are worked out when the record is saved. */
const byHand={latitude:null,longitude:null,locationSource:undefined,locationCapturedAt:undefined,locationAccuracy:undefined};

/** A new customer's location: the phone's current position by default, or another place typed or chosen on a map.
 * Existing records are never relocated on open. */
export default function CustomerLocationFields({data,editing=false,disabled=false,onUpdate,onPendingChange}:{data:CustomerData;editing?:boolean;disabled?:boolean;onUpdate:(update:CustomerDataUpdate)=>void;onPendingChange?:(pending:boolean)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const sourceGroup='customer-location-source-'+useId();
 const [mode,setMode]=useState<'device'|'manual'>('device');
 const [phase,setPhase]=useState<'idle'|'locating'|'address'|'done'|'error'>('idle');
 const [locationError,setLocationError]=useState(''),[addressStatus,setAddressStatus]=useState<AddressResult['status']|''>(''),[pickerOpen,setPickerOpen]=useState(false);
 const ownedAddress=useRef<Record<string,string>>({}),lookedUp=useRef(String(data.location||''));
 const runRef=useRef(0),abortRef=useRef<AbortController|null>(null),dataRef=useRef(data),updateRef=useRef(onUpdate),pendingRef=useRef(onPendingChange),disabledRef=useRef(disabled);
 dataRef.current=data;updateRef.current=onUpdate;pendingRef.current=onPendingChange;disabledRef.current=disabled;
 const manual=editing||mode==='manual';
 useEffect(()=>{
  if(!editing&&!dataRef.current.location)void capture();
  return()=>{runRef.current++;abortRef.current?.abort();pendingRef.current?.(false);};
 },[editing]);
 /** Puts a location on the draft. Address fields filled for the previous place are cleared so they never describe another one. */
 function adopt(fields:Partial<CustomerData>){
  const before={...dataRef.current},previousAuto={...ownedAddress.current};
  for(const [key,value]of Object.entries(previousAuto))if(before[key]===value)before[key]='';
  ownedAddress.current={};
  updateRef.current(current=>{
   const next:CustomerData={...current,...fields};
   for(const [key,value]of Object.entries(previousAuto))if(current[key]===value)next[key]='';
   return next;
  });
  return before;
 }
 /** The national address of a place, when the optional provider is configured: it only fills fields that are still empty. */
 async function lookup(point:{latitude:number;longitude:number},locationText:string,before:CustomerData,run:number,controller:AbortController){
  lookedUp.current=locationText;
  if(typeof navigator!=='undefined'&&navigator.onLine===false){
   setAddressStatus('unavailable');setPhase('done');return;
  }
  setPhase('address');
  try{
   const result=await submitJson<AddressResult>('/api/customer-address',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latitude:point.latitude,longitude:point.longitude,language}),signal:controller.signal},{language,timeout:12000});
   if(run!==runRef.current||controller.signal.aborted)return;
   const normalized=String(result.shortAddress||'').trim().toUpperCase();
   if(result.status==='found'&&/^[A-Z]{4}[0-9]{4}$/.test(normalized)){
    // Re-check the current draft inside the state update: a late lookup cannot replace typing.
    updateRef.current(current=>{
     if(current.location!==locationText)return current;
     const next={...current};
     for(const [key,value]of Object.entries({shortAddress:normalized,address:result.address,city:result.city})){
      if(typeof value==='string'&&value.trim()&&!before[key]&&current[key]===before[key]){next[key]=value.trim();ownedAddress.current[key]=value.trim();}
     }
     return next;
    });
    setAddressStatus('found');
   }else setAddressStatus(result.status==='found'?'not_found':result.status);
  }catch{if(run===runRef.current&&!controller.signal.aborted)setAddressStatus('unavailable');}
  if(run===runRef.current&&!controller.signal.aborted)setPhase('done');
 }
 async function capture(){
  if(disabledRef.current)return;
  const run=++runRef.current;abortRef.current?.abort();const controller=new AbortController();abortRef.current=controller;
  setPhase('locating');setLocationError('');setAddressStatus('');pendingRef.current?.(true);
  try{
   const captured=await captureVisitLocation(typeof navigator==='undefined'?undefined:navigator.geolocation,controller.signal);
   if(run!==runRef.current||controller.signal.aborted)return;
   const before=adopt(captured);
   await lookup(captured,captured.location,before,run,controller);
  }catch(error){
   if(run!==runRef.current||controller.signal.aborted)return;
   setPhase('error');setLocationError(messageOf(error)||say('تعذر تحديد الموقع. أعد المحاولة.','Could not get your location. Retry.'));
  }finally{if(run===runRef.current){pendingRef.current?.(false);abortRef.current=null;}}
 }
 /** A place the member typed or chose on the map: it replaces what the phone captured and gets its own address lookup.
  * A place chosen on the map holds saving until its address arrives, like a captured one. A typed place does not: the tap on
  * Save that ends the typing is also what starts the lookup, and that tap must not be lost. */
 async function applyPoint(point:{latitude:number;longitude:number},fields:Partial<CustomerData>,holdSaving=true){
  if(disabledRef.current)return;
  const locationText=String(fields.location??dataRef.current.location??'');
  const run=++runRef.current;abortRef.current?.abort();const controller=new AbortController();abortRef.current=controller;
  setPhase('idle');setLocationError('');setAddressStatus('');if(holdSaving)pendingRef.current?.(true);
  try{
   const before=adopt(fields);
   await lookup(point,locationText,before,run,controller);
  }finally{if(run===runRef.current){if(holdSaving)pendingRef.current?.(false);abortRef.current=null;}}
 }
 function chooseMode(next:'device'|'manual'){
  if(next===mode||disabledRef.current)return;
  setMode(next);
  if(next==='device'){void capture();return;}
  // Leaving the phone's position: stop waiting for it, so a slow or refused fix never holds back saving.
  runRef.current++;abortRef.current?.abort();abortRef.current=null;pendingRef.current?.(false);setPhase('idle');setLocationError('');
 }
 /** Leaving the field after the place was typed or pasted: a pasted link becomes the plain coordinates it points to, and the place gets its address. */
 function lookAtTyped(){
  if(!manual||disabledRef.current)return;
  const text=String(dataRef.current.location||''),point=coordinatesFromText(text);
  if(!point||text===lookedUp.current)return;
  const tidy=tidyLocationText(text);
  void applyPoint(point,tidy===text?{}:{location:tidy,...byHand},false);
 }
 const pending=phase==='locating'||phase==='address';
 const addressUnavailable=!!addressStatus&&addressStatus!=='found';
 const typed=String(data.location||''),typedPoint=coordinatesFromText(typed),typedInvalid=manual&&typed.trim()!==''&&!typedPoint;
 return <section className="customer-auto-location full" aria-label={say('موقع العميل والعنوان الوطني','Customer location and national address')} aria-busy={pending}>
  <div className="customer-auto-location-heading"><span><MapPin size={17}/>{say(manual?'موقع العميل':'موقع الجهاز الحالي',manual?'Customer location':'Current device location')}</span>
   <div className="customer-auto-location-actions">
    {manual&&<button type="button" className="btn subtle small" onClick={()=>setPickerOpen(true)} disabled={disabled}><MapPinned size={15}/>{say('اختيار على الخريطة','Choose on the map')}</button>}
    {(editing||mode==='device')&&<button type="button" className="btn subtle small" onClick={()=>void capture()} disabled={disabled||pending}><RefreshCw size={15}/>{say(editing?'تحديث من موقعي الحالي':data.location?'تحديث الموقع':'إعادة المحاولة',editing?'Use my current location':data.location?'Refresh location':'Retry')}</button>}
   </div>
  </div>
  {!editing&&<fieldset className="customer-choice-field customer-location-modes" disabled={disabled}>
   <legend className="sr-only">{say('مصدر موقع العميل','Source of the customer location')}</legend>
   <div className="customer-choice-grid">{(['device','manual'] as const).map(value=><label className="customer-choice" key={value}><input type="radio" name={sourceGroup} value={value} checked={mode===value} onChange={event=>{if(event.target.checked)chooseMode(value);}}/><span>{value==='device'?<LocateFixed size={16}/>:<MapPinned size={16}/>}{value==='device'?say('موقعي الحالي','My current location'):say('موقع آخر','Another location')}</span></label>)}</div>
  </fieldset>}
  <div className="form-grid">
   <label className="field"><span>{say('اللوكيشن (خط العرض، خط الطول)','Location (latitude, longitude)')}</span><input readOnly={!manual} disabled={disabled} dir="ltr" value={data.location||''} placeholder={manual?'21.5, 39.2':say('يتحدد تلقائيًا من الجهاز','Captured from this device')} aria-label={say('اللوكيشن (خط العرض، خط الطول)','Location (latitude, longitude)')} aria-invalid={typedInvalid||undefined} onChange={manual?event=>{const location=event.target.value;onUpdate(current=>({...current,location,...byHand}));}:undefined} onBlur={manual?lookAtTyped:undefined}/></label>
   <label className="field"><span>{say('العنوان الوطني المختصر','Short national address')}</span><input value={data.shortAddress||''} onChange={event=>{const value=event.target.value.toUpperCase().replace(/\s/g,'');delete ownedAddress.current.shortAddress;onUpdate(current=>({...current,shortAddress:value}));}} disabled={disabled} dir="ltr" autoCapitalize="characters" autoComplete="off" maxLength={8} pattern="[A-Za-z]{4}[0-9]{4}" placeholder="ABCD1234" aria-label={say('العنوان الوطني المختصر','Short national address')}/></label>
  </div>
  {pending?<p className="customer-location-status" role="status"><Loader2 className="spin" size={15}/>{phase==='locating'?say('جارٍ تحديد الموقع…','Getting your location…'):say('جارٍ جلب العنوان الوطني…','Looking up the national address…')}</p>:locationError?<p className="customer-location-error" role="alert">{t(locationError)}{!editing&&mode==='device'&&<> {say('أو اختر «موقع آخر» لتحديد مكان العميل بنفسك.','Or choose “Another location” to set the customer\'s place yourself.')}</>}</p>:typedInvalid?<p className="customer-location-error" role="alert">{say('اكتب الإحداثيات هكذا: 26.4373, 50.0344. أو الصق رابط خرائط كاملًا فيه الإحداثيات.','Enter coordinates like 26.4373, 50.0344, or paste a full maps link that contains them.')}</p>:addressUnavailable?<p className="customer-location-status" role="status">{say('تم تحديد الموقع؛ العنوان المختصر غير متاح. أدخله يدويًا.','Location ready; short address unavailable. Enter it manually.')}</p>:!editing&&mode==='manual'&&typedPoint?<p className="customer-location-status" role="status">{say('سيُحفظ الموقع الذي حددته.','The location you set will be saved.')}</p>:!editing&&data.location?<p className="customer-location-status" role="status">{say('تم تحديد الموقع تلقائيًا.','Location captured automatically.')}</p>:null}
  {pickerOpen&&<LocationPicker initial={typedPoint} region={String(data.region||'')} onClose={()=>setPickerOpen(false)} onPick={point=>{setPickerOpen(false);void applyPoint(point,{location:asText(point),...byHand});}}/>}
 </section>;
}

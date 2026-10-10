'use client';
import {useEffect, useRef, useState} from 'react';
import {Loader2, MapPin, RefreshCw} from 'lucide-react';
import {t, useLanguage} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import {captureVisitLocation} from '@/lib/visit-location';
import {customerTypes, customerStatuses, factoryCategories} from '@/lib/customer-options';
import './customer-entry-fields.css';

type CustomerData = Record<string, any>;
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

/** Foreground GPS for a new customer. Existing records are never relocated on open. */
export default function CustomerLocationFields({data,editing=false,disabled=false,onUpdate,onPendingChange}:{data:CustomerData;editing?:boolean;disabled?:boolean;onUpdate:(update:CustomerDataUpdate)=>void;onPendingChange?:(pending:boolean)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const [phase,setPhase]=useState<'idle'|'locating'|'address'|'done'|'error'>('idle');
 const [locationError,setLocationError]=useState(''),[addressStatus,setAddressStatus]=useState<AddressResult['status']|''>('');
 const ownedAddress=useRef<Record<string,string>>({});
 const runRef=useRef(0),abortRef=useRef<AbortController|null>(null),dataRef=useRef(data),updateRef=useRef(onUpdate),pendingRef=useRef(onPendingChange),disabledRef=useRef(disabled);
 dataRef.current=data;updateRef.current=onUpdate;pendingRef.current=onPendingChange;disabledRef.current=disabled;
 useEffect(()=>{
  if(!editing&&!dataRef.current.location)void capture();
  return()=>{runRef.current++;abortRef.current?.abort();pendingRef.current?.(false);};
 },[editing]);
 async function capture(){
  if(disabledRef.current)return;
  const run=++runRef.current;abortRef.current?.abort();const controller=new AbortController();abortRef.current=controller;
  setPhase('locating');setLocationError('');setAddressStatus('');pendingRef.current?.(true);
  try{
   const captured=await captureVisitLocation(typeof navigator==='undefined'?undefined:navigator.geolocation,controller.signal);
   if(run!==runRef.current||controller.signal.aborted)return;
   const before={...dataRef.current},previousAuto={...ownedAddress.current};
   for(const [key,value]of Object.entries(previousAuto))if(before[key]===value)before[key]='';
   ownedAddress.current={};
   updateRef.current(current=>{
    const next:CustomerData={...current,...captured};
    for(const [key,value]of Object.entries(previousAuto))if(current[key]===value)next[key]='';
    return next;
   });
   if(typeof navigator!=='undefined'&&navigator.onLine===false){
    setAddressStatus('unavailable');setPhase('done');return;
   }
   setPhase('address');
   try{
    const result=await submitJson<AddressResult>('/api/customer-address',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latitude:captured.latitude,longitude:captured.longitude,language}),signal:controller.signal},{language,timeout:12000});
    if(run!==runRef.current||controller.signal.aborted)return;
    const normalized=String(result.shortAddress||'').trim().toUpperCase();
    if(result.status==='found'&&/^[A-Z]{4}[0-9]{4}$/.test(normalized)){
     // Re-check the current draft inside the state update: a late lookup cannot replace typing.
     updateRef.current(current=>{
      if(current.location!==captured.location)return current;
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
  }catch(error:any){
   if(run!==runRef.current||controller.signal.aborted)return;
   setPhase('error');setLocationError(error?.message||say('تعذر تحديد الموقع. أعد المحاولة.','Could not get your location. Retry.'));
  }finally{if(run===runRef.current){pendingRef.current?.(false);abortRef.current=null;}}
 }
 const pending=phase==='locating'||phase==='address';
 const addressUnavailable=!!addressStatus&&addressStatus!=='found';
 return <section className="customer-auto-location full" aria-label={say('موقع العميل والعنوان الوطني','Customer location and national address')} aria-busy={pending}>
  <div className="customer-auto-location-heading"><span><MapPin size={17}/>{say(editing?'موقع العميل':'موقع الجهاز الحالي',editing?'Customer location':'Current device location')}</span>{<button type="button" className="btn subtle small" onClick={()=>void capture()} disabled={disabled||pending}><RefreshCw size={15}/>{say(editing?'تحديث من موقعي الحالي':data.location?'تحديث الموقع':'إعادة المحاولة',editing?'Use my current location':data.location?'Refresh location':'Retry')}</button>}</div>
  <div className="form-grid">
   <label className="field"><span>{say('اللوكيشن (خط العرض، خط الطول)','Location (latitude, longitude)')}</span><input readOnly={!editing} disabled={disabled} dir="ltr" value={data.location||''} placeholder={editing?'21.5, 39.2':say('يتحدد تلقائيًا من الجهاز','Captured from this device')} aria-label={say('اللوكيشن (خط العرض، خط الطول)','Location (latitude, longitude)')} onChange={editing?event=>{const location=event.target.value;onUpdate(current=>({...current,location,latitude:null,longitude:null,locationSource:undefined,locationCapturedAt:undefined,locationAccuracy:undefined}));}:undefined}/></label>
   <label className="field"><span>{say('العنوان الوطني المختصر','Short national address')}</span><input value={data.shortAddress||''} onChange={event=>{const value=event.target.value.toUpperCase().replace(/\s/g,'');delete ownedAddress.current.shortAddress;onUpdate(current=>({...current,shortAddress:value}));}} disabled={disabled} dir="ltr" autoCapitalize="characters" autoComplete="off" maxLength={8} pattern="[A-Za-z]{4}[0-9]{4}" placeholder="ABCD1234" aria-label={say('العنوان الوطني المختصر','Short national address')}/></label>
  </div>
  {pending?<p className="customer-location-status" role="status"><Loader2 className="spin" size={15}/>{phase==='locating'?say('جارٍ تحديد الموقع…','Getting your location…'):say('جارٍ جلب العنوان الوطني…','Looking up the national address…')}</p>:locationError?<p className="customer-location-error" role="alert">{t(locationError)}</p>:addressUnavailable?<p className="customer-location-status" role="status">{say('تم تحديد الموقع؛ العنوان المختصر غير متاح. أدخله يدويًا.','Location captured; short address unavailable. Enter it manually.')}</p>:!editing&&data.location?<p className="customer-location-status" role="status">{say('تم تحديد الموقع تلقائيًا.','Location captured automatically.')}</p>:null}
 </section>;
}

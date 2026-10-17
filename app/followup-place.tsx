'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Loader2,MapPin} from 'lucide-react';
import {t,useLanguage} from '@/lib/i18n';
import type {Row} from '@/lib/crm';
import {captureVisitLocation,type DeviceVisitLocation} from '@/lib/visit-location';
import {visitPlaceView,type VisitPlaceView} from '@/lib/visit-place';
import VisitPlaceStatus from './visit-place-status';
import {useJourneyTracker} from './journey-tracker';
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof (error as {message:unknown}).message==='string'?(error as {message:string}).message:'';
const idle:VisitPlaceView={status:'idle',blocked:false,message:'',distance:null};

/** The device's point for a follow-up that is a visit: taken as soon as the form is open, kept for the save, taken again on request. */
export function useFollowupPlace({enabled,customer,type,role}:{enabled:boolean;customer:Row|undefined;type:string;role:string}){
 const {language}=useLanguage();
 const [fix,setFix]=useState<DeviceVisitLocation|null>(null),[locating,setLocating]=useState(false),[error,setError]=useState('');
 const run=useRef(0),abort=useRef<AbortController|null>(null);
 const locate=useCallback(async()=>{
  const current=++run.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;
  setError('');setLocating(true);
  try{const captured=await captureVisitLocation(navigator.geolocation,controller.signal);if(current===run.current)setFix(captured);}
  catch(failure){if(current===run.current)setError(messageOf(failure)||'تعذر تحديد الموقع. أعد المحاولة.');}
  finally{if(current===run.current)setLocating(false);}
 },[]);
 const wants=enabled&&type==='visit';
 // The capture starts after the form has painted, not inside the effect itself.
 useEffect(()=>{
  if(!wants||fix||locating||error)return;
  const timer=window.setTimeout(()=>{void locate();},0);
  return()=>window.clearTimeout(timer);
 },[wants,fix,locating,error,locate]);
 useEffect(()=>()=>{run.current++;abort.current?.abort();},[]);
 const tracked=useJourneyTracker().active,journeyArrived=!!tracked&&!!customer&&tracked.customerId===customer.id&&!!tracked.data.arrivalAt&&!tracked.data.departureAt&&!tracked.closedAt;
 const view=wants&&fix?visitPlaceView({customer:customer?.data,data:{type,...fix},role,language,journeyArrived}):idle;
 return {wants,fix:wants?fix:null,locating,error,locate,view};
}

/** What the form says about where the follow-up is being recorded, with the button that takes the point again. */
export function FollowupPlace({place,busy}:{place:ReturnType<typeof useFollowupPlace>;busy:boolean}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 if(!place.wants)return null;
 return <div className="visit-location full automatic-location visit-compact-location followup-place" id="followup-device-location">
  <div className="location-status" aria-live="polite">{place.locating?<span><Loader2 className="spin" size={16}/>{t('جارٍ تحديد الموقع…')}</span>:place.fix?<span><MapPin size={16}/>{say('تم تحديد الموقع تلقائيًا','Location captured automatically')}</span>:<span><MapPin size={16}/>{t('يلزم السماح بالموقع لحفظ المتابعة.')}</span>}</div>
  {place.error&&<p role="alert">{t(place.error)}</p>}
  <VisitPlaceStatus view={place.view}/>
  {!place.locating&&<button type="button" className="btn subtle small" disabled={busy} onClick={()=>void place.locate()}>{place.fix?t('تحديث موقع الجهاز'):t('إعادة المحاولة')}</button>}
 </div>;
}

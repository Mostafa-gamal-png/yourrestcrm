'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {Member,Row} from '@/lib/crm';
import {customerCoordinates} from '@/lib/customer-location';
import {customerDirectionsLink as navigationLink} from '@/lib/customer-directions';
import {journeyDay} from '@/lib/journey-client';
import {isNativeTrackingApp,nativeTrackingRequest} from '@/lib/native-tracking';
import {useLanguage} from '@/lib/i18n';
import {useJourneyTracker} from './journey-tracker';
import {trackingWindowOpen} from '@/lib/tracking-window';
import {waitForDirectionsStep} from '@/lib/directions-attempt';
import {directionsProblem} from '@/lib/directions-problem';
import CustomerMap from './customer-map';

type Props={customers:Row[];me:Member;focusId?:string|null;filters?:ReactNode;scopeKey:string};
type ReadyLink={customerId:string;href:string;target:'_self'|'_blank';version:number};
type RecordingNotice={customerId:string;version:number;href:string;text:string;error?:boolean};
const canNavigate=(me:Member)=>me.active===1&&['rep','supervisor','manager','admin'].includes(me.role);

/** Directions opens only the selected, currently scoped customer destination.
 * Recording is a separate acknowledged operation: an unavailable GPS service or
 * a pending upload cannot prevent the person from opening the customer's Maps. */
export default function CustomerJourneyMap(props:Props){
 const tracker=useJourneyTracker(),{selectCustomer}=tracker,{language}=useLanguage();
 const say=(ar:string,en:string)=>language==='ar'?ar:en;
 const [directionsReady,setDirectionsReady]=useState<ReadyLink|null>(null),[recordingNotice,setRecordingNotice]=useState<RecordingNotice|null>(null),[navigationError,setNavigationError]=useState<RecordingNotice|null>(null);
 const current=useRef(props),epoch=useRef(0),locked=useRef(false);
 current.current=props;
 useEffect(()=>{epoch.current++;setDirectionsReady(null);setRecordingNotice(null);setNavigationError(null);return()=>{epoch.current++;};},[props.scopeKey,props.me.id,props.me.role]);
 useEffect(()=>{
  if(directionsReady){const row=props.customers.find(row=>row.id===directionsReady.customerId);if(!row||row.version!==directionsReady.version||navigationLink(row.data)!==directionsReady.href||!canNavigate(props.me))setDirectionsReady(null);}
  if(recordingNotice){const row=props.customers.find(row=>row.id===recordingNotice.customerId);if(!row||row.version!==recordingNotice.version||navigationLink(row.data)!==recordingNotice.href||!canNavigate(props.me))setRecordingNotice(null);}
  if(navigationError){const row=props.customers.find(row=>row.id===navigationError.customerId);if(!row||row.version!==navigationError.version||navigationLink(row.data)!==navigationError.href||!canNavigate(props.me))setNavigationError(null);}
 },[props.customers,props.me,directionsReady,recordingNotice,navigationError]);

 async function directions(id:string,signal:AbortSignal):Promise<boolean>{
  if(locked.current||signal.aborted)return false;
  const context=current.current,customer=context.customers.find(row=>row.id===id),point=customer&&customerCoordinates(customer.data);
  if(!customer||!point||!canNavigate(context.me))return false;
  const href=navigationLink(customer.data)!,version=customer.version,generation=epoch.current,native=isNativeTrackingApp();
  const stillCurrent=()=>!signal.aborted&&epoch.current===generation&&current.current.scopeKey===context.scopeKey&&current.current.me.id===context.me.id&&current.current.me.role===context.me.role&&canNavigate(current.current.me)&&current.current.customers.some(row=>row.id===id&&row.version===version&&navigationLink(row.data)===href);
  const notice=(text:string,error=false)=>{if(stillCurrent())setRecordingNotice({customerId:id,version,href,text,error});};
  const navigationFailed=(text:string)=>{if(stillCurrent())setNavigationError({customerId:id,version,href,text,error:true});};
  const aborted=()=>{if(epoch.current===generation)setRecordingNotice(old=>old?.customerId===id?null:old);};
  signal.addEventListener('abort',aborted,{once:true});
  locked.current=true;setDirectionsReady(null);setRecordingNotice(null);setNavigationError(null);
  // Keep a real link available immediately. Old APKs and popup-blocking browsers
  // can always use another genuine tap; this is a destination, never a claim that
  // a journey station was recorded. The link is invalidated with customer scope.
  const fallback:ReadyLink={customerId:id,href,target:native?'_self':'_blank',version};
  setDirectionsReady(fallback);
  // Start both operations in the original gesture, without waiting for GPS,
  // registration, a station POST or an upload acknowledgment to open Maps.
  let launch:Promise<unknown>=Promise.resolve();
  try{
   if(native){
    if(tracker.foregroundDirectionsSupported)launch=nativeTrackingRequest('openDirections',point);
    else window.location.assign(href);
   }else{
    const destinationWindow=window.open(href,'_blank');
    if(destinationWindow)destinationWindow.opener=null;
    else navigationFailed(say('المتصفح منع فتح نافذة الخرائط. اضغط «فتح Google Maps».','The browser blocked the Maps window. Tap Open Google Maps.'));
   }
  }catch(error){navigationFailed(directionsProblem(error instanceof Error?error.message:String(error),language));}
  // Attach rejection handling now, even if recording remains pending. A failed
  // foreground native handoff exposes the same fixed destination for a retry.
  const launchResult=launch.then(()=>{},error=>{navigationFailed(directionsProblem(error&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message:String(error),language));});
  try{
   if(!trackingWindowOpen()){
    notice(say('الاتجاهات متاحة. تسجيل خط السير يعمل من 6 صباحًا إلى 6 مساءً بتوقيت السعودية ماعدا الجمعة.','Directions are available. Route recording runs from 6 a.m. to 6 p.m. Saudi time except Friday.'));
   }else{
    notice(say('جارٍ تأكيد تسجيل الرحلة؛ يمكنك فتح الخرائط الآن.','Confirming trip recording; you can open Maps now.'));
    try{
     const stop=await waitForDirectionsStep(selectCustomer(id,signal),signal);
     if(!stillCurrent())return false;
     if(!stop||stop.customerId!==id||stop.closedAt||stop.date!==journeyDay()){
      const reason=stop?say('لم يتم تأكيد محطة هذا العميل لليوم.','Today’s stop for this customer was not confirmed.'):directionsProblem(tracker.selectFailure?.()||tracker.errorMessage||'',language);
      notice(say('لم يتم تأكيد تسجيل الرحلة. ','Trip recording was not confirmed. ')+reason,true);
     }else notice(say('تم تسجيل محطة العميل في خط سير اليوم.','The customer’s stop is recorded in today’s route.'));
    }catch(error){
     if(!stillCurrent())return false;
     const reason=directionsProblem(error&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message:String(error),language);
     notice(say('لم يتم تأكيد تسجيل الرحلة. ','Trip recording was not confirmed. ')+reason,true);
    }
   }
   await waitForDirectionsStep(launchResult,signal);
   if(!stillCurrent())return false;
   return true;
  }catch(error){if(signal.aborted)return false;throw error;}finally{signal.removeEventListener('abort',aborted);locked.current=false;}
 }
 return <CustomerMap customers={props.customers} focusId={props.focusId} filters={props.filters} scopeKey={props.scopeKey} onDirections={canNavigate(props.me)?directions:undefined} directionsReady={directionsReady} recordingNotice={recordingNotice} navigationError={navigationError}/>;
}

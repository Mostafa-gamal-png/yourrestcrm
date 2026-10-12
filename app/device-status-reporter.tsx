'use client';
import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import type {Member} from '@/lib/crm';
import {buildDeviceReport,createDeviceReporter,detectDeviceClass,postDeviceStatus,type DeviceClass,type DeviceReporter} from '@/lib/device-status';
import {trackingGateDecision} from '@/lib/tracking-gate';
import {useJourneyTracker} from './journey-tracker';

const noSubscription=()=>()=>{};
const currentDeviceClass=():DeviceClass=>detectDeviceClass(navigator.userAgent,navigator.platform,navigator.maxTouchPoints);

/** Tells the server what this phone says about route tracking, so a supervisor can see why a representative
 * has no GPS. It runs for a blocked representative too, and it never affects what the person can do. */
export default function DeviceStatusReporter({me}:{me:Member|null}){
 const {gate}=useJourneyTracker(),deviceClass=useSyncExternalStore(noSubscription,currentDeviceClass,()=>'other' as DeviceClass);
 const memberId=me?.role==='rep'&&me.active===1?me.id:'';
 const report=useMemo(()=>memberId?buildDeviceReport(trackingGateDecision({role:'rep',active:1,...gate}),gate,deviceClass):null,[memberId,gate,deviceClass]);
 const reporter=useRef<DeviceReporter|null>(null);
 useEffect(()=>{
  if(!memberId)return;
  const instance=createDeviceReporter({send:postDeviceStatus});
  reporter.current=instance;
  const wake=()=>{if(document.visibilityState!=='hidden')instance.nudge();},online=()=>instance.nudge(true);
  document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);window.addEventListener('online',online);
  return()=>{reporter.current=null;instance.dispose();document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);window.removeEventListener('online',online);};
 },[memberId]);
 useEffect(()=>{if(report)reporter.current?.submit(report);},[report,memberId]);
 return null;
}

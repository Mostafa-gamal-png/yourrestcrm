'use client';
import {useEffect} from 'react';
import {lockOfflineSession} from '@/lib/offline-store';
import {isOfflineLogoutPending} from '@/lib/offline-auth';

// Renew the server-managed cookie on app entry and during continued use.
// No credentials are exposed to JavaScript or saved in browser storage.
export default function EmailSession(){
 useEffect(()=>{
  const day=24*60*60*1000;
  let lastSuccess:number|null=null,lastAttempt:number|null=null,stopped=false,inflight:AbortController|null=null;
  async function renew(){
   const now=Date.now();
   if(stopped||inflight||isOfflineLogoutPending()||document.visibilityState==='hidden'||(lastSuccess!==null&&now-lastSuccess<day)||(lastAttempt!==null&&now-lastAttempt<60000))return;
   lastAttempt=now;
   const controller=new AbortController();inflight=controller;
   const timeout=window.setTimeout(()=>controller.abort(),20000);
   try{
    const response=await fetch('/api/auth/refresh',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});
    if(response.ok&&!stopped)lastSuccess=Date.now();
    if((response.status===401||response.status===403)&&!stopped)await lockOfflineSession();
   }catch{/* A temporary connection failure must not interrupt unsaved work. */}
   finally{window.clearTimeout(timeout);if(inflight===controller)inflight=null;}
  }
  const refresh=()=>{void renew();};
  refresh();
  const timer=window.setInterval(refresh,60*60*1000);
  document.addEventListener('visibilitychange',refresh);
  window.addEventListener('focus',refresh);
  window.addEventListener('online',refresh);
  return()=>{stopped=true;inflight?.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);};
 },[]);
 return null;
}

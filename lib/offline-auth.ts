import {lockOfflineSession} from './offline-store';

// This contains no credentials or account data. It prevents an unchanged HTTP
// cookie from silently reopening an account after a device-only offline logout.
const PENDING_LOGOUT='yr-offline-pending-logout-v1';
let logoutRequest:Promise<boolean>|null=null;
export function isOfflineLogoutPending():boolean{
 if(typeof window==='undefined')return false;
 try{return window.localStorage.getItem(PENDING_LOGOUT)!==null;}catch{return true;}
}
export async function prepareOfflineLogout():Promise<void>{
 // Persist before signalling the other tabs; failure must not claim sign-out.
 window.localStorage.setItem(PENDING_LOGOUT,'1');
 await lockOfflineSession();
}
export function confirmOfflineSignIn():void{
 // Call only after the explicit /api/auth/verify response succeeded.
 window.localStorage.removeItem(PENDING_LOGOUT);
}
export async function finishPendingOfflineLogout():Promise<boolean>{
 if(!isOfflineLogoutPending())return false;
 if(logoutRequest)return logoutRequest;
 logoutRequest=(async()=>{
  await lockOfflineSession();
  const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});
   const result:unknown=await response.json();
   if(!response.ok||!result||typeof result!=='object'||Array.isArray(result)||(result as {ok?:unknown}).ok!==true)throw new Error('Unable to complete sign-out');
   // Retain the local lock until an explicit successful sign-in. Repeated server
   // logout is safe and avoids unlocking another tab during an auth transition.
   return true;
  }finally{window.clearTimeout(timeout);}
 })();
 try{return await logoutRequest;}finally{logoutRequest=null;}
}

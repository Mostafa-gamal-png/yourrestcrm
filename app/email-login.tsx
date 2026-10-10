'use client';
import {useEffect,useRef,useState} from 'react';
import {LogOut,ShieldCheck} from 'lucide-react';
import {useLanguage} from '@/lib/i18n';
import {logoutNativeTracking} from '@/lib/native-tracking';
import {lockOfflineSession} from '@/lib/offline-store';
import {prepareOfflineLogout,finishPendingOfflineLogout,confirmOfflineSignIn,isOfflineLogoutPending} from '@/lib/offline-auth';
import AppUpdate from './app-update';

const messages:Record<string,string>={
 'خدمة الدخول غير مهيأة. تواصل مع الإدارة.':'Sign-in is not configured. Contact your administrator.',
 'خدمة الدخول غير متاحة. تواصل مع الإدارة.':'Sign-in is unavailable. Contact your administrator.',
 'الطلب غير مسموح.':'This request is not allowed.',
 'بيانات الطلب غير صحيحة.':'The request is invalid.',
 'محاولات كثيرة. حاول بعد دقيقة.':'Too many attempts. Please try again in a minute.',
 'اكتب بريد الشركة الصحيح المنتهي بـ @yourrest.org.':'Enter your valid @yourrest.org company email.',
 'رمز الدخول غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.':'The code is incorrect or expired. Request a new code.',
 'تعذر إتمام الدخول. حاول مجددًا.':'Unable to sign in. Please try again.',
 'انتهت مهلة الاتصال. حاول مجددًا.':'The connection timed out. Please try again.',
 'تعذر تسجيل الخروج. حاول مجددًا.':'Unable to sign out. Please try again.',
 'إذا كان البريد مسجلًا ومفعّلًا، سيصلك رمز الدخول. يمكنك إعادة الطلب بعد دقيقة.':'If your email is registered and active, a sign-in code will arrive. You can request another code in one minute.'
};
const fallback='تعذر إتمام الدخول. حاول مجددًا.';
export async function authRequest(action:'request'|'verify'|'logout',payload:unknown){
 if(action==='logout'){
  await prepareOfflineLogout();
  await logoutNativeTracking();
  // The local session is already locked. Preserve queued records for their
  // owner and finish the cookie logout before any later online sign-in.
  try{await finishPendingOfflineLogout();}catch{}
  return {ok:true as const};
 }
 if(isOfflineLogoutPending())await finishPendingOfflineLogout();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch('/api/auth/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
  const parsed:unknown=await response.json();
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error(fallback);
  const result=parsed as {ok?:boolean;error?:unknown;message?:unknown;return_to?:unknown};
  if(!response.ok||result.ok!==true)throw Error(typeof result.error==='string'&&messages[result.error]?result.error:fallback);
  if(action==='verify')confirmOfflineSignIn();
  return result as {ok:true;message?:string;return_to?:string};
 }catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw Error('انتهت مهلة الاتصال. حاول مجددًا.');throw error instanceof Error&&messages[error.message]?error:Error(fallback);}
 finally{clearTimeout(timer);}
}
export default function EmailLogin({returnTo}:{returnTo:string}){
 const {language,setLanguage}=useLanguage(),en=language==='en',label=(ar:string,english:string)=>en?english:ar,t=(message:string)=>en?(messages[message]||messages[fallback]):message;
 const [username,setUsername]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[seconds,setSeconds]=useState(0);
 const lock=useRef(false);
 useEffect(()=>{void lockOfflineSession().catch(()=>{});},[]);
 useEffect(()=>{if(!seconds)return;const timer=setTimeout(()=>setSeconds(value=>Math.max(0,value-1)),1000);return()=>clearTimeout(timer);},[seconds]);
 async function submit(action:'request'|'verify'){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   const local=username.trim().toLowerCase().replace(/@yourrest\.org$/i,'');
   if(action==='request'&&!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local))throw Error('اكتب بريد الشركة الصحيح المنتهي بـ @yourrest.org.');
   const result=await authRequest(action,action==='request'?{email:local+'@yourrest.org'}:{code,return_to:returnTo});
   if(action==='request'){setUsername(local);setSent(true);setCode('');setMessage(result.message||'');setSeconds(60);}
   else window.location.assign('/');
  }catch(e){setError(e instanceof Error&&messages[e.message]?e.message:fallback);}
  finally{setBusy(false);lock.current=false;}
 }
 const inputStyle={width:'100%',border:'1px solid #ced8d4',borderRadius:10,padding:'12px 14px',background:'transparent',color:'inherit',fontSize:16};
 return <main dir={en?'ltr':'rtl'} style={{minHeight:'100dvh',display:'grid',placeItems:'center',padding:24,background:'var(--background, #f5f7f6)'}}>
 <section style={{width:'min(100%, 440px)',padding:'32px 28px',border:'1px solid #dce4e0',borderRadius:20,background:'var(--card, #fff)',boxShadow:'0 12px 40px #113d2410'}}>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}><img src="/yourrest-logo.png" alt={label('يورست للصناعات','Yourrest Industries')} style={{width:155,height:60,objectFit:'contain'}}/><button type="button" onClick={()=>setLanguage(en?'ar':'en')} style={{padding:8,border:'1px solid #dce4e0',borderRadius:8}}>{en?'العربية':'English'}</button></div>
 <div style={{display:'flex',gap:10,alignItems:'center',marginTop:26}}><ShieldCheck size={23} color="#287347"/><h1 style={{fontSize:24,fontWeight:700}}>{label('تسجيل الدخول','Sign in')}</h1></div>
 <p style={{color:'#68766c',margin:'10px 0 24px'}}>{label('إدارة علاقات العملاء · يورست للصناعات','Yourrest Industries · Customer Relationship Management')}</p>
 <AppUpdate/>
 <form style={{display:'grid',gap:16}} onSubmit={event=>{event.preventDefault();void submit(sent?'verify':'request');}}>
 <label htmlFor="yourrest-email" style={{display:'grid',gap:8,fontWeight:600}}>{label('بريد الشركة','Company email')}<span dir="ltr" style={{display:'flex',alignItems:'center',border:'1px solid #ced8d4',borderRadius:10,overflow:'hidden'}}><input id="yourrest-email" name="username" type="text" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="username" required maxLength={241} disabled={busy||sent} value={username} onChange={event=>setUsername(event.target.value.replace(/@yourrest\.org$/i,''))} placeholder="name" style={{...inputStyle,border:0,minWidth:0}}/><span style={{paddingInlineEnd:12,color:'#68766c',fontWeight:400}}>@yourrest.org</span></span></label>
 {sent&&<><label htmlFor="yourrest-code" style={{display:'grid',gap:8,fontWeight:600}}>{label('رمز الدخول','Sign-in code')}<input id="yourrest-code" name="code" type="text" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} disabled={busy} onChange={event=>setCode(event.target.value.replace(/[^0-9]/g,''))} style={{...inputStyle,letterSpacing:8,textAlign:'center',fontSize:25}}/></label><p style={{fontSize:13,color:'#68766c',margin:0}}>{label('الرمز صالح لمدة 10 دقائق.','Your code is valid for 10 minutes.')}</p></>}
 <p style={{fontSize:13,lineHeight:1.8,color:'#68766c',margin:0}}>{label('سيُحفظ تسجيل الدخول على هذا المتصفح.','Sign-in will be remembered on this browser.')}</p>
 {message&&<p role="status" style={{fontSize:13,lineHeight:1.8,color:'#526456',margin:0}}>{t(message)}</p>}{error&&<p role="alert" style={{fontSize:14,padding:12,borderRadius:8,background:'#fff1f1',color:'#a52828',margin:0}}>{t(error)}</p>}
 <button type="submit" disabled={busy||(sent&&code.length!==6)} style={{padding:13,borderRadius:10,fontWeight:700,background:'#23683c',color:'#fff',opacity:(busy||(sent&&code.length!==6))?0.6:1}}>{busy?label('جارٍ التحقق…','Please wait…'):sent?label('دخول','Sign in'):label('إرسال رمز الدخول','Send sign-in code')}</button>
 {sent&&<div style={{display:'flex',justifyContent:'space-between',gap:12,fontSize:13}}><button type="button" disabled={busy||seconds>0} onClick={()=>void submit('request')} style={{color:seconds>0?'#8a938d':'#23683c'}}>{label('إعادة إرسال الرمز','Resend code')}{seconds>0?' ('+seconds+')':''}</button><button type="button" disabled={busy} onClick={()=>{setSent(false);setCode('');setMessage('');setError('');}}>{label('تغيير البريد','Change email')}</button></div>}
 </form></section></main>;
}
export function EmailLogout(){
 const {language}=useLanguage(),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false),en=language==='en';
 return <><button type="button" disabled={busy} title={en?'Sign out':'تسجيل الخروج'} aria-label={en?'Sign out':'تسجيل الخروج'} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await authRequest('logout',{});window.location.replace('/login');}catch{setError(en?'Unable to sign out. Please try again.':'تعذر تسجيل الخروج. حاول مجددًا.');}finally{setBusy(false);lock.current=false;}}}><LogOut size={17}/></button>{error&&<span role="alert">{error}</span>}</>;
}

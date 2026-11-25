'use client';
import {useCallback,useEffect,useState} from 'react';
import {CheckCircle2,Download,Loader2,Smartphone} from 'lucide-react';
import {toast} from 'sonner';
import type {Member} from '@/lib/crm';
import {useLanguage} from '@/lib/i18n';
import {regionScope} from '@/lib/regions';
import './app-release-pilot.css';

type Pilot={versionName:string;versionCode:number;apkPath:string;sizeBytes:number;notes:{ar:string[];en:string[]}};
const validPilot=(value:unknown):value is Pilot=>!!value&&typeof value==='object'&&typeof (value as Pilot).versionName==='string'&&Number.isSafeInteger((value as Pilot).versionCode)&&typeof (value as Pilot).apkPath==='string'&&/^\/downloads\/yourrest-crm-android-v[\d.]+-\d+\.apk$/.test((value as Pilot).apkPath)&&!!(value as Pilot).notes&&Array.isArray((value as Pilot).notes.ar)&&Array.isArray((value as Pilot).notes.en);

/** «نسخة أندرويد جاهزة للتجربة» (lib/app-release-approval.ts): for the owner's account kind only, while a published pilot waits. The owner
 * downloads it, installs it over the app on a real phone and tries it; «اعتماد التحديث للجميع» (asked twice) makes it the version every phone
 * must have. Nothing shows when no pilot waits or the account may not approve. */
export default function AppReleasePilot({me}:{me:Member}){
 const {language}=useLanguage(),en=language==='en',say=(ar:string,english:string)=>en?english:ar;
 const owner=me.role==='admin'&&regionScope(me)==='all'&&me.active===1;
 const [pilot,setPilot]=useState<Pilot|null>(null),[confirming,setConfirming]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async()=>{
  try{const response=await fetch('/api/app-update/pilot',{cache:'no-store',credentials:'same-origin'});if(!response.ok)return;const body=await response.json() as {pilot?:unknown};setPilot(validPilot(body.pilot)?body.pilot:null);}
  catch{/* offline: the card waits for the next load */}
 },[]);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- the card is filled once from the server when it mounts (as the other notices)
 useEffect(()=>{if(owner)void load();},[owner,load]);
 if(!owner||!pilot)return null;
 async function approve(){
  if(!pilot||busy)return;setBusy(true);setError('');
  try{
   const response=await fetch('/api/app-update/pilot',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',versionCode:pilot.versionCode})});
   const body=await response.json().catch(()=>({})) as {error?:string};
   if(!response.ok){setError(body.error||say('تعذر الاعتماد. حاول مرة أخرى.','Approval failed. Try again.'));return;}
   toast.success(say('اعتُمدت النسخة '+pilot.versionName+'؛ تُطلب الآن من كل الهواتف','Version '+pilot.versionName+' approved; every phone is now asked to update'));
   setConfirming(false);await load();
  }catch{setError(say('لا يوجد اتصال. حاول مرة أخرى.','No connection. Try again.'));}
  finally{setBusy(false);}
 }
 const notes=en?pilot.notes.en:pilot.notes.ar,size=(pilot.sizeBytes/1024/1024).toFixed(1);
 return <section className="release-pilot no-print" dir={en?'ltr':'rtl'} aria-label={say('نسخة أندرويد جاهزة للتجربة','Android version ready to try')} data-release-pilot={pilot.versionCode}>
  <Smartphone className="release-pilot-icon" size={22} aria-hidden="true"/>
  <div className="release-pilot-copy">
   <strong>{say('نسخة تطبيق أندرويد '+pilot.versionName+' جاهزة للتجربة','Android app version '+pilot.versionName+' is ready to try')}</strong>
   <p>{say('قبل أن تصبح إلزامية للجميع: نزّلها على هاتفك وثبّتها فوق التطبيق الحالي، وجرّب التطبيق 10 دقائق (الدخول، وتفعيل التتبع، وفتح عميل). إن عمل كل شيء فاضغط «اعتماد التحديث للجميع».','Before every phone must have it: download it on your phone, install it over the current app, and try the app for 10 minutes (sign in, enable tracking, open a customer). If everything works, press «Approve the update for everyone».')}</p>
   {notes.length>0&&<ul>{notes.map((note,index)=><li key={index}>{note}</li>)}</ul>}
   {confirming&&<p className="release-pilot-confirm" role="alert">{say('بعد الاعتماد يُطلب التحديث من كل الهواتف، ولا يعمل النظام على هاتف لم يُحدَّث. هل جرّبت النسخة على هاتف حقيقي؟','After approval every phone is asked to update, and the system does not work on a phone that has not. Did you try the version on a real phone?')}</p>}
   {error&&<p className="release-pilot-error" role="alert">{error}</p>}
  </div>
  <div className="release-pilot-actions">
   <a className="btn subtle" href={pilot.apkPath} download={'Yourrest-CRM-'+pilot.versionName+'.apk'}><Download size={17}/>{say('تنزيل النسخة للتجربة','Download to try')} ({size} MB)</a>
   {confirming
    ?<><button type="button" className="btn primary" disabled={busy} aria-busy={busy} onClick={()=>void approve()}>{busy?<Loader2 className="spin" size={17}/>:<CheckCircle2 size={17}/>}{say('نعم، اعتمدها للجميع','Yes, approve for everyone')}</button><button type="button" className="btn subtle" disabled={busy} onClick={()=>{setConfirming(false);setError('');}}>{say('إلغاء','Cancel')}</button></>
    :<button type="button" className="btn primary" onClick={()=>setConfirming(true)}><CheckCircle2 size={17}/>{say('اعتماد التحديث للجميع','Approve the update for everyone')}</button>}
  </div>
 </section>;
}

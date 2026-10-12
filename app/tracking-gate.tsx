'use client';
import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {CheckCircle2,Download,Loader2,LogOut,MapPin,RefreshCw,XCircle} from 'lucide-react';
import type {Member} from '@/lib/crm';
import {useLanguage} from '@/lib/i18n';
import {REQUIREMENT_ORDER,trackingGateDecision,type GateReason,type GateRequirement} from '@/lib/tracking-gate';
import {authRequest} from './email-login';
import {trackingFailureText,useJourneyTracker} from './journey-tracker';
import LanguageSwitch from './language-switch';
import './tracking-gate.css';

export const TRACKING_APK_PATH='/downloads/yourrest-crm-android-v1.0.10-11.apk';
const CHECK_TIMEOUT_MS=15000;
const noSubscription=()=>()=>{};
const androidBrowser=()=>typeof navigator!=='undefined'&&/Android/i.test(navigator.userAgent);
type Say=(ar:string,en:string)=>string;

function requirementLabel(item:GateRequirement,say:Say){
 switch(item){
  case 'consent':return say('الموافقة على تسجيل الموقع في ساعات العمل','Consent to location recording during work hours');
  case 'fine_location':return say('إذن الموقع الدقيق','Precise location permission');
  case 'background_location':return say('إذن الموقع «طوال الوقت» (Allow all the time)','Location permission “Allow all the time”');
  case 'notifications':return say('إذن الإشعارات (إشعار التتبع الدائم)','Notification permission (the persistent tracking notice)');
  case 'location_services':return say('تشغيل خدمة الموقع (GPS) في الهاتف','Phone location service (GPS) turned on');
  case 'enrollment':return say('تسجيل هذا الهاتف على حسابك','This phone enrolled for your account');
 }
}
function requirementStep(item:GateRequirement,say:Say){
 switch(item){
  case 'fine_location':return say('الموقع ← السماح، مع تفعيل «استخدام الموقع الدقيق».','Location → Allow, with “Use precise location” on.');
  case 'background_location':return say('الموقع ← «السماح طوال الوقت».','Location → “Allow all the time”.');
  case 'notifications':return say('الإشعارات ← السماح.','Notifications → Allow.');
  default:return '';
 }
}
function titleFor(reason:GateReason,say:Say){
 switch(reason){
  case 'browser':return say('استخدام النظام للمندوب يتم من تطبيق يورست على أندرويد','Representatives use Yourrest from the Android app');
  case 'upgrade':return say('حدّث تطبيق يورست لتفعيل تتبع خط السير','Update the Yourrest app to enable route tracking');
  case 'setup':return say('فعّل تتبع خط السير لبدء العمل','Enable route tracking to start working');
  case 'permission':return say('أذونات تتبع خط السير ناقصة','Route tracking permissions are missing');
  case 'location_services':return say('خدمة الموقع في الهاتف مغلقة','The phone location service is off');
  case 'bridge':return say('تعذر الاتصال بخدمة التتبع في التطبيق','Cannot reach the tracking service in the app');
 }
}
function bodyFor(reason:GateReason,say:Say,android:boolean){
 switch(reason){
  case 'browser':return android
   ?say('تسجيل خط السير في الخلفية إلزامي لحساب المندوب ولا يعمل من المتصفح. ثبّت التطبيق، سجّل الدخول منه، ثم وافق على أذونات الموقع والإشعارات.','Background route tracking is mandatory for representative accounts and does not work from a browser. Install the app, sign in from it, then accept the location and notification permissions.')
   :say('تسجيل خط السير في الخلفية إلزامي لحساب المندوب ويعمل على هواتف أندرويد فقط. افتح النظام من تطبيق يورست على هاتفك الأندرويد.','Background route tracking is mandatory for representative accounts and runs on Android phones only. Open Yourrest from the Android app on your phone.');
  case 'upgrade':return say('الإصدار المثبت على هاتفك لا يدعم تسجيل خط السير المستمر. نزّل آخر إصدار وثبّته فوق التطبيق الحالي دون حذفه، ثم افتحه.','The installed version does not support continuous route tracking. Download the latest version and install it over the current app without uninstalling, then open it.');
  case 'setup':return say('يعمل التتبع في الخلفية من 6 صباحًا إلى 6 مساءً بتوقيت السعودية ما عدا الجمعة، ويراه المشرف ومدير المبيعات. لا يمكن استخدام النظام قبل تفعيله.','Tracking runs in the background from 6 AM to 6 PM Saudi time except Friday, and your supervisor and sales manager can see it. The system cannot be used until it is enabled.');
  case 'permission':return say('وافقتَ على التتبع لكن أذونات أندرويد التالية غير ممنوحة. افتح إعدادات الهاتف ← التطبيقات ← يورست ← الأذونات وفعّل المطلوب، ثم ارجع للتطبيق.','You consented to tracking, but these Android permissions are not granted. Open phone Settings → Apps → Yourrest → Permissions, enable what is required, then return to the app.');
  case 'location_services':return say('فعّل الموقع (GPS) من الإعدادات السريعة أو من إعدادات الهاتف ← الموقع، ثم ارجع للتطبيق.','Turn location (GPS) on from quick settings or Settings → Location, then return to the app.');
  case 'bridge':return say('أغلق التطبيق تمامًا ثم افتحه من جديد. إن استمرت المشكلة فتأكد من تثبيت آخر إصدار من تطبيق أندرويد.','Close the app completely and open it again. If the problem continues, make sure the latest Android app is installed.');
 }
}

function SignOut({say}:{say:Say}){
 const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),lock=useRef(false);
 async function run(){
  if(lock.current)return;lock.current=true;setBusy(true);setFailed(false);
  try{await authRequest('logout',{});window.location.replace('/login');}
  catch{setFailed(true);setBusy(false);lock.current=false;}
 }
 return <>
  <button type="button" className="btn subtle tracking-gate-signout" disabled={busy} onClick={()=>void run()}><LogOut size={16}/>{say('تسجيل الخروج','Sign out')}</button>
  {failed&&<p role="alert" className="tracking-gate-error">{say('تعذر تسجيل الخروج. حاول مجددًا.','Unable to sign out. Please try again.')}</p>}
 </>;
}

function Frame({state,reason,member,say,language,children}:{state:'checking'|'blocked';reason?:GateReason;member:Member|null;say:Say;language:string;children:React.ReactNode}){
 return <main className="tracking-gate" dir={language==='en'?'ltr':'rtl'} data-gate={state} data-gate-reason={reason} aria-live="polite">
  <div className="tracking-gate-top"><div className="tracking-gate-logo" role="img" aria-label="YOUR REST INDUSTRIES"/><LanguageSwitch/></div>
  <section className="tracking-gate-card">{children}</section>
  <div className="tracking-gate-foot">{member&&<span>{say('الحساب: ','Account: ')}{member.name}</span>}<SignOut say={say}/></div>
 </main>;
}

function BlockedScreen({reason,missing,member}:{reason:GateReason;missing:GateRequirement[];member:Member|null}){
 const tracker=useJourneyTracker(),{language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const android=useSyncExternalStore(noSubscription,androidBrowser,()=>false);
 const {busy,operationError,appVersion}=tracker,device=tracker.gate.device;
 // What the last tap did wrong, or what the app itself reports (for instance that the server stopped this phone).
 // A standing permission state is not repeated: the checklist already shows it, and a first run has not been asked yet.
 const failureSource=operationError||device?.error||device?.syncError||'',failure=failureSource?trackingFailureText(failureSource,language):'';
 const showList=reason==='setup'||reason==='permission'||reason==='location_services';
 const steps=REQUIREMENT_ORDER.filter(item=>missing.includes(item)&&requirementStep(item,say)).map(item=>({item,text:requirementStep(item,say)}));
 const download=reason==='upgrade'||reason==='browser'&&android;
 const canRetry=reason==='setup'||reason==='permission'||reason==='location_services'||reason==='bridge';
 const action=reason==='bridge'?()=>tracker.retry():()=>void tracker.setupContinuous();
 const actionLabel=busy?say('جارٍ التفعيل…','Enabling…'):reason==='setup'?say('تفعيل التتبع','Enable tracking'):reason==='bridge'?say('إعادة المحاولة','Try again'):say('إعادة الفحص','Check again');
 return <Frame state="blocked" reason={reason} member={member} say={say} language={language}>
  <span className="tracking-gate-icon"><MapPin size={26}/></span>
  <h1>{titleFor(reason,say)}</h1>
  <p className="tracking-gate-body">{bodyFor(reason,say,android)}</p>
  {showList&&<ul className="tracking-gate-list" aria-label={say('متطلبات التتبع','Tracking requirements')}>
   {REQUIREMENT_ORDER.map(item=>{const needed=missing.includes(item);return <li key={item} data-requirement={item} data-needed={needed?'yes':'no'}>{needed?<XCircle size={18} aria-hidden="true"/>:<CheckCircle2 size={18} aria-hidden="true"/>}<span>{requirementLabel(item,say)}</span><b>{needed?say('مطلوب','Required'):say('تم','Done')}</b></li>;})}
  </ul>}
  {reason==='permission'&&steps.length>0&&<ol className="tracking-gate-steps">{steps.map(step=><li key={step.item}><strong>{requirementLabel(step.item,say)}:</strong> {step.text}</li>)}</ol>}
  {reason==='browser'&&<ol className="tracking-gate-steps"><li>{say('نزّل التطبيق وثبّته (قد يطلب الهاتف السماح بالتثبيت من هذا المصدر).','Download and install the app (the phone may ask you to allow installs from this source).')}</li><li>{say('افتح التطبيق وسجّل الدخول بنفس بريدك.','Open the app and sign in with the same email.')}</li><li>{say('اضغط «تفعيل التتبع» ووافق على الأذونات، واختر «السماح طوال الوقت».','Tap “Enable tracking”, accept the permissions and choose “Allow all the time”.')}</li></ol>}
  {failure&&<p role="alert" className="tracking-gate-error">{failure}</p>}
  {appVersion&&<small className="tracking-gate-version">{say('إصدار التطبيق: ','App version: ')}{appVersion}</small>}
  <div className="tracking-gate-actions">
   {download&&<a className="btn primary" href={TRACKING_APK_PATH} download="Yourrest-CRM.apk"><Download size={18}/>{reason==='upgrade'?say('تحديث تطبيق أندرويد','Update the Android app'):say('تنزيل تطبيق أندرويد','Download the Android app')}</a>}
   {canRetry&&<button type="button" className="btn primary" disabled={busy} aria-busy={busy} onClick={action}>{busy?<Loader2 className="spin" size={18}/>:<RefreshCw size={18}/>}{actionLabel}</button>}
  </div>
 </Frame>;
}

function CheckingScreen({member}:{member:Member|null}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar,[expired,setExpired]=useState(false);
 useEffect(()=>{const timer=setTimeout(()=>setExpired(true),CHECK_TIMEOUT_MS);return()=>clearTimeout(timer);},[]);
 if(expired)return <BlockedScreen reason="bridge" missing={[]} member={member}/>;
 return <Frame state="checking" member={member} say={say} language={language}>
  <span className="tracking-gate-icon"><Loader2 className="spin" size={26}/></span>
  <h1>{say('جارٍ التحقق من تتبع خط السير…','Checking route tracking…')}</h1>
 </Frame>;
}

/** Mandatory route tracking for representatives. The workspace is not rendered
 * until the installed Android app reports working tracking; everyone else passes through. */
export default function TrackingGate({me,children}:{me:Member|null;children:React.ReactNode}){
 const tracker=useJourneyTracker();
 const decision=trackingGateDecision({role:me?.role,active:me?.active,...tracker.gate});
 if(decision.status==='allowed')return <>{children}</>;
 if(decision.status==='checking')return <CheckingScreen member={me}/>;
 return <BlockedScreen reason={decision.reason} missing={decision.missing} member={me}/>;
}

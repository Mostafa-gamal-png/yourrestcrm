'use client';
import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {CheckCircle2,CloudUpload,Download,Loader2,LogOut,MapPin,RefreshCw,Smartphone,XCircle} from 'lucide-react';
import type {Member} from '@/lib/crm';
import {useLanguage} from '@/lib/i18n';
import {REQUIREMENT_ORDER,trackingGateDecision,type GateReason,type GateRequirement} from '@/lib/tracking-gate';
import {appUpdateController,appUpdateRequired,compareAppVersions,enforcedRequirement,type AppUpdateState} from '@/lib/app-update';
import {listOutbox,subscribeOffline} from '@/lib/offline-store';
import {flushOutbox} from '@/lib/offline-submit';
import release from '@/lib/app-update-release.json';
import AppUpdate from './app-update';
import {authRequest} from './email-login';
import {trackingFailureText,useJourneyTracker} from './journey-tracker';
import LanguageSwitch from './language-switch';
import './tracking-gate.css';

/** The app the site serves: its file is what the browser and capability screens offer (the mandatory version is read live, below). */
export const TRACKING_APK_PATH=new URL(release.apkUrl).pathname;
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

function Frame({state,reason,update,member,say,language,children}:{state:'checking'|'blocked';reason?:GateReason;update?:boolean;member:Member|null;say:Say;language:string;children:React.ReactNode}){
 return <main className="tracking-gate" dir={language==='en'?'ltr':'rtl'} data-gate={state} data-gate-reason={reason} data-gate-update={update?'required':undefined} aria-live="polite">
  <div className="tracking-gate-top"><div className="tracking-gate-logo" role="img" aria-label="YOUR REST INDUSTRIES"/><LanguageSwitch/></div>
  <section className="tracking-gate-card">{children}</section>
  <div className="tracking-gate-foot">{member&&<span>{say('الحساب: ','Account: ')}{member.name}</span>}<SignOut say={say}/></div>
 </main>;
}

/** The in-app update flow, for the apps that have one; older apps get the plain download instead. */
function useAppUpdateState(wanted:boolean){
 const [state,setState]=useState<AppUpdateState|null>(()=>wanted?appUpdateController().snapshot():null);
 useEffect(()=>{if(!wanted)return;return appUpdateController().subscribe(setState);},[wanted]);
 return wanted?state:null;
}

function BlockedScreen({reason,missing,member}:{reason:GateReason;missing:GateRequirement[];member:Member|null}){
 const tracker=useJourneyTracker(),{language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const android=useSyncExternalStore(noSubscription,androidBrowser,()=>false);
 const {busy,operationError,appVersion}=tracker,device=tracker.gate.device;
 const update=useAppUpdateState(reason==='upgrade'&&tracker.gate.native);
 // An app with the update protocol downloads and installs from inside; the plain file serves the rest.
 const inAppUpdate=!!update&&update.protocol===1&&!!update.availableVersionCode&&update.phase!=='upToDate';
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
  {reason==='setup'&&tracker.companionRemembered&&<p className="tracking-gate-body" data-companion="lost">{say('لا يُسجَّل خط السير الآن من جهازك الآخر. افتح التطبيق على الجهاز الذي يسجّل خط السير، أو فعّل التتبع هنا ليصبح هذا الجهاز هو الذي يسجّل.','Your route is not being recorded by your other device right now. Open the app on the device that records your route, or enable tracking here so this device records it.')}</p>}
  {showList&&<ul className="tracking-gate-list" aria-label={say('متطلبات التتبع','Tracking requirements')}>
   {REQUIREMENT_ORDER.map(item=>{const needed=missing.includes(item);return <li key={item} data-requirement={item} data-needed={needed?'yes':'no'}>{needed?<XCircle size={18} aria-hidden="true"/>:<CheckCircle2 size={18} aria-hidden="true"/>}<span>{requirementLabel(item,say)}</span><b>{needed?say('مطلوب','Required'):say('تم','Done')}</b></li>;})}
  </ul>}
  {reason==='permission'&&steps.length>0&&<ol className="tracking-gate-steps">{steps.map(step=><li key={step.item}><strong>{requirementLabel(step.item,say)}:</strong> {step.text}</li>)}</ol>}
  {reason==='browser'&&<ol className="tracking-gate-steps"><li>{say('نزّل التطبيق وثبّته (قد يطلب الهاتف السماح بالتثبيت من هذا المصدر).','Download and install the app (the phone may ask you to allow installs from this source).')}</li><li>{say('افتح التطبيق وسجّل الدخول بنفس بريدك.','Open the app and sign in with the same email.')}</li><li>{say('اضغط «تفعيل التتبع» ووافق على الأذونات، واختر «السماح طوال الوقت».','Tap “Enable tracking”, accept the permissions and choose “Allow all the time”.')}</li></ol>}
  {failure&&<p role="alert" className="tracking-gate-error">{failure}</p>}
  {appVersion&&<small className="tracking-gate-version">{say('إصدار التطبيق: ','App version: ')}{appVersion}</small>}
  {inAppUpdate&&<AppUpdate/>}
  <div className="tracking-gate-actions">
   {download&&!inAppUpdate&&<a className="btn primary" href={TRACKING_APK_PATH} download="Yourrest-CRM.apk"><Download size={18}/>{reason==='upgrade'?say('تحديث تطبيق أندرويد','Update the Android app'):say('تنزيل تطبيق أندرويد','Download the Android app')}</a>}
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

/** Entries saved on this phone that have not reached the server yet (lib/offline-store.ts). Their sending is the workspace's own
 * (app/crm-app.tsx: when the CRM loads, every 30 seconds, on reconnecting and on returning to the app), which keeps running under the
 * update screen because the workspace stays mounted there; «رفع الآن» only asks for it sooner. Installing the update keeps them. */
function SavedEntries({member,offline,say}:{member:Member;offline:boolean;say:Say}){
 const [counts,setCounts]=useState<{waiting:number;review:number}|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let alive=true;
  const read=()=>{void listOutbox(member).then(jobs=>{if(alive)setCounts({waiting:jobs.filter(job=>job.status!=='blocked').length,review:jobs.filter(job=>job.status==='blocked').length});}).catch(()=>{});};
  read();const stop=subscribeOffline(read);
  return()=>{alive=false;stop();};
 },[member]);
 if(!counts||!counts.waiting&&!counts.review)return null;
 async function send(){if(busy)return;setBusy(true);setFailed(false);try{await flushOutbox(member);}catch{setFailed(true);}finally{setBusy(false);}}
 return <div className="tracking-gate-saved" data-saved-waiting={counts.waiting} data-saved-review={counts.review}>
  <CloudUpload size={18} aria-hidden="true"/>
  <div role="status">
   {counts.waiting>0&&<p>{say(`إدخالات محفوظة على الهاتف بانتظار الرفع: ${counts.waiting}. تُرفع تلقائيًا عند توفر الاتصال وهذه الشاشة ظاهرة، ولا يحذفها التحديث.`,`Entries saved on this phone waiting to upload: ${counts.waiting}. They upload automatically when connected, even with this screen shown, and the update does not delete them.`)}</p>}
   {counts.review>0&&<p>{say(`إدخالات تحتاج مراجعة: ${counts.review}. تبقى محفوظة على الهاتف لتراجعها بعد التحديث.`,`Entries that need review: ${counts.review}. They stay saved on this phone for you to review after the update.`)}</p>}
   {failed&&<p role="alert" className="tracking-gate-error">{say('تعذر الرفع الآن؛ الإدخالات باقية على الهاتف وتُعاد المحاولة تلقائيًا.','Could not upload now; the entries stay on the phone and are retried automatically.')}</p>}
  </div>
  {counts.waiting>0&&<button type="button" className="btn subtle" disabled={busy||offline} aria-busy={busy} onClick={()=>void send()}>{busy?<Loader2 className="spin" size={17}/>:<CloudUpload size={17}/>}{say('رفع الآن','Upload now')}</button>}
 </div>;
}

/** The mandatory update (the owner's rule, taken from GSCO on 2026-10-31: every published Android release is required of every user; no
 * «continue» or «later»). Shown only while the update can proceed (lib/app-update.ts enforcedRequirement); the update panel inside keeps
 * the download, the install, a retry and the browser path, and the account's sign-out stays in the frame. */
function UpdateRequiredScreen({member,update,reported}:{member:Member;update:AppUpdateState;reported:string}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 // The version that is older (the update bridge's or the tracking service's: appUpdateRequired held the app on whichever was).
 const required=enforcedRequirement(update)?.name||update.requiredVersionName,installed=[update.installedVersionName,reported].find(version=>compareAppVersions(version,required)===-1)||update.installedVersionName||reported;
 const notes=(language==='en'?update.requiredReleaseNotes.en:update.requiredReleaseNotes.ar).filter(Boolean);
 return <Frame state="blocked" reason="upgrade" update member={member} say={say} language={language}>
  <span className="tracking-gate-icon"><Smartphone size={26}/></span>
  <h1>{say('حدّث تطبيق يورست للمتابعة','Update the Yourrest app to continue')}</h1>
  <p className="tracking-gate-body">{installed?say(`الإصدار المثبت على هاتفك ${installed} أقدم من الإصدار المطلوب ${required}. `,`The installed version ${installed} is older than the required version ${required}. `):say(`الإصدار المطلوب ${required}. `,`The required version is ${required}. `)}{say('كل إصدار جديد من التطبيق إلزامي لجميع المستخدمين، ولا يمكن استخدام النظام قبل التحديث. ثبّت التحديث فوق التطبيق الحالي دون حذفه؛ يبقى حسابك والإدخالات المحفوظة على الهاتف.','Every new version of the app is required for every user, and the system cannot be used before updating. Install the update over the current app without uninstalling it; your account and the entries saved on the phone stay.')}</p>
  <AppUpdate inGate/>
  <SavedEntries member={member} offline={update.offline} say={say}/>
  {notes.length>0&&<div className="tracking-gate-notes"><strong>{say('ما الجديد في هذا الإصدار','What is new in this version')}</strong><ul>{notes.map((note,index)=><li key={index}>{note}</li>)}</ul></div>}
  <small className="tracking-gate-version">{say('إصدار التطبيق: ','App version: ')}<span dir="ltr">{installed||say('غير معروف','unknown')}</span> · {say('المطلوب: ','Required: ')}<span dir="ltr">{required}</span></small>
 </Frame>;
}

/** Radix renders every dialog and sheet of the workspace (a visit, a customer, the save status…) as role=dialog with data-state=open. */
const OPEN_DIALOG='[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]';
const dialogOpen=()=>typeof document!=='undefined'&&!!document.querySelector(OPEN_DIALOG);
function watchDialogs(notify:()=>void){const observer=new MutationObserver(notify);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-state','role']});return()=>observer.disconnect();}
const noDialog=()=>false;
/** While the update is required, whether a dialog of the workspace is open: the screen waits until it is saved or closed, so a form
 * being filled is never taken from under the person (and a modal dialog never holds the screen's buttons behind its focus trap). */
function useOpenDialog(watch:boolean){return useSyncExternalStore(watch?watchDialogs:noSubscription,watch?dialogOpen:noDialog,noDialog);}

/** Mandatory route tracking for representatives, and the mandatory app version for everyone in the Android app.
 * The version comes first: an installed app older than the served release is held at the update screen, whatever the role, while the update
 * can proceed (lib/app-update.ts). Under that screen the workspace stays mounted but hidden, so open forms, the device's queue and the
 * workspace's own sending of it survive; the screen waits for an open dialog to be saved or closed. The tracking reasons are decided after
 * it and, as before, render no workspace until a representative's tracking works. */
export default function TrackingGate({me,children}:{me:Member|null;children:React.ReactNode}){
 const tracker=useJourneyTracker(),update=useAppUpdateState(tracker.gate.native);
 const mandatory=!!me&&me.active===1&&!!update&&appUpdateRequired(update,tracker.appVersion);
 // Once the screen holds the app it stays until the requirement goes: a dialog opened under it afterwards (a notification's request)
 // does not lift it, and the screen stays tappable over Radix's modal layer (pointer-events in tracking-gate.css).
 const editing=useOpenDialog(mandatory),[latched,setLatched]=useState(false),holding=mandatory&&(latched||!editing);
 if(latched!==holding)setLatched(holding);
 const decision=trackingGateDecision({role:me?.role,active:me?.active,...tracker.gate});
 if(holding||decision.status==='allowed')return <>
  <div className="gate-workspace" style={{display:holding?'none':'contents'}} aria-hidden={holding||undefined}>{decision.status==='allowed'?children:null}</div>
  {holding&&me&&update&&<UpdateRequiredScreen member={me} update={update} reported={tracker.appVersion}/>}
 </>;
 if(decision.status==='checking')return <CheckingScreen member={me}/>;
 return <BlockedScreen reason={decision.reason} missing={decision.missing} member={me}/>;
}

'use client';
import {useEffect,useState} from 'react';
import {Download,RefreshCw,Smartphone} from 'lucide-react';
import {useLanguage} from '@/lib/i18n';
import {appUpdateController,servedApkPath,type AppUpdateState} from '@/lib/app-update';
import './app-update.css';

/** The update panel of the Android app. Every published release is mandatory (the owner's rule, taken from GSCO on 2026-10-31): the panel
 * never says the person may keep working, and app/tracking-gate.tsx holds every older app at its update screen, with this panel inside
 * (`inGate`), whenever the update can proceed (lib/app-update.ts enforcedRequirement). Outside that screen (the sign-in page, or while the
 * update cannot proceed: offline, the file not answering) it says why the update waits.
 * Some phones (seen on 1.0.11, 2026-11-03) close Android's install confirmation for the in-app session install at once, so the panel
 * returns to «ready» or «cancelled» with nothing installed: the served APK is also offered through the browser, whose download the
 * installed app hands to Android's ordinary installer (same signature, data kept). */
export default function AppUpdate({inGate=false}:{inGate?:boolean}){
 const {language}=useLanguage(),en=language==='en',say=(ar:string,english:string)=>en?english:ar;
 const [state,setState]=useState<AppUpdateState|null>(null);
 useEffect(()=>appUpdateController().subscribe(setState),[]);
 // An app whose own check failed does not know the release; the release the site requires fills it in (a name and code taken as a pair).
 const fromApp=!!state?.availableVersionCode&&!!state.availableVersionName,versionName=fromApp?state!.availableVersionName:state?.requiredVersionName||'',versionCode=fromApp?state!.availableVersionCode:state?.requiredVersionCode??null;
 if(!state?.native||!versionCode||state.phase==='upToDate'&&!inGate)return null;
 const busy=['checking','downloading','installing'].includes(state.phase),installable=['ready','permissionRequired','cancelled'].includes(state.phase);
 const unreachable=state.apkReachable===false&&!installable&&!['downloading','installing'].includes(state.phase);
 const title=state.phase==='downloading'?say('جارٍ تنزيل التحديث','Downloading update'):state.phase==='installing'?say('أكمل تأكيد التحديث في أندرويد','Confirm the update in Android'):installable?say('التحديث جاهز للتثبيت','Update ready to install'):say('تحديث التطبيق مطلوب','App update required');
 const description=state.offline&&!installable?say('هذا التحديث إلزامي، ويمكن تنزيله عند عودة الاتصال بالإنترنت. بعد عودة الاتصال لا يمكن استخدام النظام قبل التحديث.','This update is required and can be downloaded once the internet is back. Once connected, the system cannot be used before updating.'):unreachable?say('هذا التحديث إلزامي، لكن ملف التحديث غير متاح على الموقع الآن. سيُعاد التحقق تلقائيًا.','This update is required, but the update file is not available on the site right now. It will be checked again automatically.'):state.phase==='error'?say('لم يكتمل التحديث. تأكد من الاتصال بالإنترنت ومن وجود مساحة كافية في الهاتف، ثم أعد المحاولة؛ بياناتك المحفوظة باقية.','The update did not finish. Check the internet connection and the free space on the phone, then retry; your saved data is kept.'):state.phase==='permissionRequired'?say('احفظ أي إدخال مفتوح، ثم اسمح ليورست بالتثبيت وأكمل تأكيد أندرويد.','Save any open entry, then allow Yourrest to install and confirm in Android.'):state.phase==='cancelled'?say('لم يتم التثبيت بعد. احفظ أي إدخال مفتوح قبل إعادة المحاولة.','The update is not installed yet. Save any open entry before retrying.'):state.protocol===0?say('احفظ أي إدخال مفتوح، وأكمل التنزيل في المتصفح ثم وافق على «تحديث». لا تحذف التطبيق.','Save any open entry, finish the download in your browser, then approve Update. Keep the app installed.'):state.phase==='downloading'?say('يكتمل التنزيل داخل التطبيق، ثم يطلب أندرويد تأكيد التثبيت.','The download finishes inside the app; Android then asks you to confirm the installation.'):state.phase==='ready'||state.phase==='installing'?say('احفظ أي إدخال مفتوح قبل التثبيت؛ السجلات المحفوظة والمنتظرة للرفع تبقى موجودة.','Save any open entry before installing; saved and queued records stay preserved.'):say('هذا التحديث إلزامي لجميع المستخدمين. سيطلب أندرويد موافقتك على التثبيت، والسجلات المحفوظة تبقى موجودة.','This update is required for every user. Android will ask you to confirm installation; saved records stay preserved.');
 const controller=appUpdateController();
 // After a download, an aborted install or an error, the browser path is offered beside the in-app one (it needs the network).
 const browserApk=servedApkPath(versionName,versionCode),browserFallback=state.protocol===1&&!state.offline&&!!browserApk&&(installable||state.phase==='error'||state.phase==='installing');
 return <section className="app-update-banner no-print" dir={en?'ltr':'rtl'} aria-label={say('تحديث تطبيق يورست','Yourrest app update')} data-update-phase={state.phase}>
  <Smartphone className="app-update-icon" size={22} aria-hidden="true"/>
  <div className="app-update-copy"><strong>{title} <span className="app-update-version" dir="ltr">{versionName}</span></strong><p role="status" aria-live="polite">{description}</p>
   {state.phase==='downloading'&&<div className="app-update-download"><progress max={100} value={state.progress} aria-label={say('نسبة تنزيل التحديث','Update download progress')}/><span dir="ltr">{Math.floor(state.progress)}%</span></div>}
  </div>
  <div className="app-update-actions">
   {state.protocol===0&&state.legacyUrl&&!state.offline?<a className="btn primary" href={state.legacyUrl} download="Yourrest-CRM.apk" onClick={()=>controller.legacyDownloadStarted()}><Download size={17}/>{say('تحديث التطبيق','Update app')}</a>:state.phase==='error'?<button type="button" className="btn primary" disabled={state.offline} onClick={()=>void controller.check(true)}><RefreshCw size={17}/>{say('إعادة المحاولة','Retry')}</button>:<button type="button" className="btn primary" disabled={busy||(state.offline&&!installable)} aria-busy={busy} onClick={()=>void (installable?controller.install():controller.download())}><Download size={17}/>{state.phase==='downloading'?say('جارٍ التنزيل','Downloading'):state.phase==='installing'?say('بانتظار التأكيد','Awaiting confirmation'):installable?say('تثبيت التحديث','Install update'):say('تحديث التطبيق','Update app')}</button>}
   {browserFallback&&<a className="btn subtle app-update-browser" href={browserApk} download="Yourrest-CRM.apk"><Download size={17}/>{say('ثبّت عن طريق المتصفح','Install through the browser')}</a>}
  </div>
  {browserFallback&&<p className="app-update-browser-hint">{say('إن أعادك «تثبيت التحديث» إلى هذه الشاشة دون تحديث: اضغط «ثبّت عن طريق المتصفح» ووافق على «فتح». وإن حذّرك كروم من الملف فاختر «تنزيل على أي حال». عند اكتمال التنزيل افتح الملف؛ وإن طلب أندرويد إذنًا فاختر «الإعدادات» وفعّل «السماح من هذا المصدر» ثم ارجع واضغط «تحديث». لا تحذف التطبيق؛ بياناتك باقية.','If «Install update» brings you back here without updating: tap «Install through the browser» and choose «فتح» (Open). If Chrome warns about the file, choose «Download anyway». When the download finishes, open the file; if Android asks for permission, choose Settings, turn on «Allow from this source», go back and tap «Update». Do not uninstall the app; your data stays.')}</p>}
 </section>;
}

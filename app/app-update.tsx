'use client';
import {useEffect,useState} from 'react';
import {Download,RefreshCw,Smartphone} from 'lucide-react';
import {useLanguage} from '@/lib/i18n';
import {appUpdateController,type AppUpdateState} from '@/lib/app-update';
import './app-update.css';

export default function AppUpdate(){
 const {language}=useLanguage(),en=language==='en',say=(ar:string,english:string)=>en?english:ar;
 const [state,setState]=useState<AppUpdateState|null>(null);
 useEffect(()=>appUpdateController().subscribe(setState),[]);
 if(!state?.native||state.phase==='upToDate'||!state.availableVersionCode)return null;
 const busy=['checking','downloading','installing'].includes(state.phase),installable=['ready','permissionRequired','cancelled'].includes(state.phase);
 const title=state.phase==='downloading'?say('جارٍ تنزيل التحديث','Downloading update'):state.phase==='installing'?say('أكمل تأكيد التحديث في أندرويد','Confirm the update in Android'):installable?say('التحديث جاهز للتثبيت','Update ready to install'):say('تحديث التطبيق متاح','App update available');
 const description=state.offline&&!installable?say('سيُستأنف التحقق عند رجوع الشبكة. يمكنك متابعة شغلك.','Checks resume when you reconnect. You can keep working.'):state.phase==='error'?say('لم يكتمل التحديث. أعد المحاولة؛ بياناتك المحفوظة باقية.','The update did not finish. Retry; saved data is preserved.'):state.phase==='permissionRequired'?say('احفظ أي إدخال مفتوح، ثم اسمح ليورست بالتثبيت وأكمل تأكيد أندرويد.','Save any open entry, then allow Yourrest to install and confirm in Android.'):state.phase==='cancelled'?say('لم يتم التثبيت بعد. احفظ أي إدخال مفتوح قبل إعادة المحاولة.','The update is not installed yet. Save any open entry before retrying.'):state.protocol===0?say('احفظ أي إدخال مفتوح، وأكمل التنزيل في المتصفح ثم وافق على «تحديث». لا تحذف التطبيق.','Save any open entry, finish the download in your browser, then approve Update. Keep the app installed.'):state.phase==='downloading'?say('يمكنك استخدام التطبيق أثناء التنزيل.','You can use the app while it downloads.'):state.phase==='ready'||state.phase==='installing'?say('احفظ أي إدخال مفتوح قبل التثبيت؛ السجلات المحفوظة والمنتظرة للرفع تبقى موجودة.','Save any open entry before installing; saved and queued records stay preserved.'):say('سيطلب أندرويد موافقتك على التثبيت. السجلات المحفوظة تبقى موجودة.','Android will ask you to confirm installation. Saved records stay preserved.');
 const controller=appUpdateController();
 return <section className="app-update-banner no-print" dir={en?'ltr':'rtl'} aria-label={say('تحديث تطبيق يورست','Yourrest app update')}>
  <Smartphone className="app-update-icon" size={22} aria-hidden="true"/>
  <div className="app-update-copy"><strong>{title} <span className="app-update-version" dir="ltr">{state.availableVersionName}</span></strong><p role="status" aria-live="polite">{description}</p>
   {state.phase==='downloading'&&<div className="app-update-download"><progress max={100} value={state.progress} aria-label={say('نسبة تنزيل التحديث','Update download progress')}/><span dir="ltr">{Math.floor(state.progress)}%</span></div>}
  </div>
  <div className="app-update-actions">
   {state.protocol===0&&state.legacyUrl&&!state.offline?<a className="btn primary" href={state.legacyUrl} download="Yourrest-CRM.apk" onClick={()=>controller.legacyDownloadStarted()}><Download size={17}/>{say('تحديث التطبيق','Update app')}</a>:state.phase==='error'?<button type="button" className="btn primary" disabled={state.offline} onClick={()=>void controller.check(true)}><RefreshCw size={17}/>{say('إعادة المحاولة','Retry')}</button>:<button type="button" className="btn primary" disabled={busy||(state.offline&&!installable)} aria-busy={busy} onClick={()=>void (installable?controller.install():controller.download())}><Download size={17}/>{state.phase==='downloading'?say('جارٍ التنزيل','Downloading'):state.phase==='installing'?say('بانتظار التأكيد','Awaiting confirmation'):installable?say('تثبيت التحديث','Install update'):say('تحديث التطبيق','Update app')}</button>}
  </div>
 </section>;
}

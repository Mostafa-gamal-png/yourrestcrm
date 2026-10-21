'use client';
import {useEffect,useState} from 'react';
import {Loader2,RefreshCw} from 'lucide-react';
import {useLanguage} from '@/lib/i18n';
import {buildFreshness,type FreshnessState} from '@/lib/build-freshness';
import './build-notice.css';

/** A newer release is on the server than the code this page runs. The page never reloads by itself: the user chooses when. */
export default function BuildNotice(){
 const {language}=useLanguage(),en=language==='en',say=(ar:string,english:string)=>en?english:ar;
 const [state,setState]=useState<FreshnessState|null>(null),[busy,setBusy]=useState(false);
 useEffect(()=>buildFreshness().subscribe(setState),[]);
 if(state?.freshness!=='stale')return null;
 return <section className="build-notice no-print" dir={en?'ltr':'rtl'} aria-label={say('تحديث التطبيق','App update')}>
  <RefreshCw className="build-notice-icon" size={22} aria-hidden="true"/>
  <div className="build-notice-copy"><strong>{say('يوجد تحديث للتطبيق','An app update is available')}</strong><p role="status" aria-live="polite">{say('أعد التحميل لتصلك آخر نسخة. أكمل ما تكتبه أولًا؛ لن تُعاد الصفحة من تلقاء نفسها.','Reload to get the latest version. Finish what you are typing first; the page never reloads on its own.')}</p></div>
  <div className="build-notice-actions"><button type="button" className="btn primary" disabled={busy} onClick={()=>{setBusy(true);void buildFreshness().reload();}}>{busy?<Loader2 className="spin" size={17}/>:<RefreshCw size={17}/>}{say('أعد التحميل','Reload')}</button></div>
 </section>;
}

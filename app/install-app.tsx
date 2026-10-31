'use client';
import {useEffect,useRef,useState} from 'react';
import {Download,Smartphone,Share,MoreVertical,X} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useLanguage} from '@/lib/i18n';
import {installController,registerInstallWorker,type InstallSnapshot} from '@/lib/pwa-install';
import {isNativeTrackingApp} from '@/lib/native-tracking';
import release from '@/lib/app-update-release.json';
import './install-app.css';

export default function InstallApp(){
 const {language}=useLanguage(),en=language==='en',label=(ar:string,english:string)=>en?english:ar;
 const [ready,setReady]=useState(false),[standalone,setStandalone]=useState(false),[ios,setIos]=useState(false),[android,setAndroid]=useState(false),[help,setHelp]=useState(false),[notice,setNotice]=useState<'accepted'|'dismissed'|null>(null);
 const [state,setState]=useState<InstallSnapshot>({available:false,busy:false,installed:false});
 const mounted=useRef(false),installButton=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{
  mounted.current=true;
  // Native Android uses the same HTTPS app shell when reopened offline.
  registerInstallWorker();
  if(isNativeTrackingApp()){setReady(true);setStandalone(true);return()=>{mounted.current=false;};}
  const controller=installController(),unsubscribe=controller?.subscribe(setState);
  if(controller)setState(controller.snapshot());
  const media=window.matchMedia('(display-mode: standalone)'),fullscreen=window.matchMedia('(display-mode: fullscreen)');
  const sync=()=>setStandalone(media.matches||fullscreen.matches||(navigator as Navigator&{standalone?:boolean}).standalone===true);
  setIos(/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
  setAndroid(/Android/i.test(navigator.userAgent));
  sync();setReady(true);
  media.addEventListener('change',sync);fullscreen.addEventListener('change',sync);
  return()=>{mounted.current=false;unsubscribe?.();media.removeEventListener('change',sync);fullscreen.removeEventListener('change',sync);};
 },[]);
 async function install(){
  // The bridge owns the lock across component unmounts and repeated taps.
  const controller=installController();
  if(controller?.snapshot().available)setHelp(false);
  const result=await controller?.request()??'unavailable';
  if(!mounted.current)return;
  if(result==='unavailable'||result==='error'){setNotice(null);setHelp(true);}
  else if(result==='accepted'||result==='dismissed')setNotice(result);
 }
 if(!ready||isNativeTrackingApp()||(!android&&(standalone||state.installed)))return null;
 return <div className="pwa-install pwa-install-simple no-print" dir={en?'ltr':'rtl'}>
  <section className="pwa-install-card" aria-label={label('تطبيق يورست','Yourrest app')}>
   <span className="pwa-install-icon"><Smartphone size={24}/></span>
   <div className="pwa-install-copy"><strong>{label('تطبيق يورست على موبايلك','Yourrest on your phone')}</strong></div>
   {android?<a href={new URL(release.apkUrl).pathname} download="Yourrest-CRM.apk" className="btn primary pwa-install-action"><Download size={18}/>{label('تنزيل تطبيق أندرويد','Download Android app')}</a>:<button ref={installButton} type="button" className="btn primary pwa-install-action" disabled={state.busy} aria-busy={state.busy} onClick={()=>void install()}><Download size={18}/>{label('تنزيل التطبيق','Install app')}</button>}
  </section>
  {notice&&<p className="pwa-install-status" role="status">{notice==='accepted'?label('تم قبول طلب التثبيت. انتظر حتى يكمله المتصفح.','Installation accepted. Wait for your browser to finish.'):label('يمكنك تنزيل التطبيق لاحقًا من الزر أو قائمة المتصفح.','You can install later using this button or your browser menu.')}</p>}
  <Dialog open={help} onOpenChange={setHelp}><DialogContent className="pwa-install-dialog" dir={en?'ltr':'rtl'} showCloseButton={false} onCloseAutoFocus={event=>{event.preventDefault();installButton.current?.focus();}}>
   <button type="button" className="pwa-help-close" aria-label={label('إغلاق','Close')} onClick={()=>setHelp(false)}><X size={18}/></button>
   <DialogTitle>{label('تنزيل تطبيق يورست','Install Yourrest')}</DialogTitle>
   <DialogDescription>{ios?label('على iPhone وiPad، الإضافة بتتم من قائمة المشاركة.','On iPhone and iPad, install from the Share menu.'):label('التثبيت المباشر غير متاح الآن في هذا المتصفح.','Direct installation is not currently available in this browser.')}</DialogDescription>
   {ios?<ol className="pwa-install-steps"><li>{label('افتح crm.yourrest.org في Safari.','Open crm.yourrest.org in Safari.')}</li><li><Share size={17}/>{label('اضغط «مشاركة» ثم «إضافة إلى الشاشة الرئيسية».','Tap Share, then Add to Home Screen.')}</li><li>{label('فعّل «فتح كتطبيق ويب» إذا ظهر، ثم اضغط «إضافة».','Turn on Open as Web App if shown, then tap Add.')}</li></ol>:<ol className="pwa-install-steps"><li><MoreVertical size={17}/>{label('افتح قائمة المتصفح واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».','Open your browser menu and choose Install app or Add to Home Screen.')}</li><li>{label('لو الاختيار مش ظاهر، افتح crm.yourrest.org في Chrome أو Edge محدّث.','If the option is missing, open crm.yourrest.org in an updated Chrome or Edge browser.')}</li></ol>}
   {ios&&<p className="pwa-install-note">{label('نسخة الويب على آيفون لا تجمع الموقع في الخلفية أو مع قفل الشاشة.','The iPhone web app does not collect location in the background or while the screen is locked.')}</p>}
   {state.available&&<button type="button" className="btn primary pwa-install-native" disabled={state.busy} onClick={()=>void install()}><Download size={18}/>{label('تنزيل التطبيق الآن','Install now')}</button>}
   <p className="pwa-install-note">{label('بعد أول دخول مع الإنترنت، تُحفظ الزيارات والمتابعات على الجهاز عند انقطاع الشبكة وتُرفع عند عودة الاتصال والتطبيق مفتوح.','After signing in online once, visits and follow-ups can be saved on this device offline and uploaded when connectivity returns while the app is open.')}</p>
   <button type="button" className="btn primary" onClick={()=>setHelp(false)}>{label('تمام','Got it')}</button>
  </DialogContent></Dialog>
 </div>;
}

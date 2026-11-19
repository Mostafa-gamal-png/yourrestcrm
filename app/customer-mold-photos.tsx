'use client';
// «صور القالب» in the customer's sheet (app/crm-app.tsx, the «البيانات» tab; lib/mold-photos.ts says what they are). Everyone who sees the
// customer sees the photos as small squares, a tap opens one large with the previous and the next; «إضافة صور» for whoever may add
// (the server says so: canAdd) picks several at once from the gallery, or the camera where the phone offers it (an ordinary file input
// of images, several allowed, no capture attribute, so a phone's browser offers both). Each photo is shrunk on the device
// (lib/image-shrink.ts) and uploaded one at a time with a key of its own kept through retries, so a repeat after a cut stores nothing
// twice. The uploads outlive the sheet: closing it or opening another customer stops none, and what failed waits with «إعادة المحاولة».
// Whoever added a photo, and the administrator, delete it after a confirmation; it cannot be restored.
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {ChevronLeft,ChevronRight,ImagePlus,Images,Loader2,RotateCcw,Trash2,X} from 'lucide-react';
import {direction,t,useLanguage} from '@/lib/i18n';
import {definiteSubmitRejection,submitJson,SubmitError} from '@/lib/client-submit';
import {shrinkPhoto,ShrinkError} from '@/lib/image-shrink';
import {MOLD_PHOTO_MAX_BYTES,moldPhotoSrc,validMoldPhotoList,type MoldPhotoList,type MoldPhotoView} from '@/lib/mold-photos';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle} from '@/components/ui/alert-dialog';
import './customer-mold-photos.css';

type Say=(ar:string,en:string)=>string;
/** A list read again after an upload or a delete, by every sheet that shows that customer. */
const CHANGED='yr-mold-photos-changed';
/** A photo of at most 2 MB on a slow line: the server reads the body for two minutes at most. */
const UPLOAD_TIMEOUT_MS=130_000;
/** Busy (429) or unreachable: tried again by itself this many times, a little later each time, with the same key. */
const AUTOMATIC_RETRIES=3;
const errorText=(error:unknown,fallback:string)=>error instanceof Error&&error.message?t(error.message):fallback;
const stampFormat=new Map<string,Intl.DateTimeFormat>();
function stamp(value:string,language:string){
 if(!Number.isFinite(Date.parse(value)))return '';
 const locale=language==='en'?'en-GB':'ar-SA';
 let format=stampFormat.get(locale);
 if(!format){format=new Intl.DateTimeFormat(locale,{calendar:'gregory',numberingSystem:'latn',timeZone:'Asia/Riyadh',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});stampFormat.set(locale,format);}
 return format.format(new Date(value));
}

// ---- the uploads: one queue for the app, one photo at a time
type Upload={key:string;customerId:string;file:File;name:string;blob:Blob|null;phase:'queued'|'preparing'|'uploading'|'failed';percent:number|null;error:string;retryable:boolean};
let uploads:Upload[]=[];
const watchers=new Set<()=>void>();
let running=false;
const setUploads=(next:Upload[])=>{uploads=next;for(const watch of watchers)watch();};
const patch=(key:string,change:Partial<Upload>)=>setUploads(uploads.map(item=>item.key===key?{...item,...change}:item));
const subscribe=(watch:()=>void)=>{watchers.add(watch);return()=>{watchers.delete(watch);};};
const snapshot=()=>uploads;
const announce=(customerId:string)=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(CHANGED,{detail:customerId}));};
/** The page's data is read again once (its «سجل التغييرات» gains the lines) after a photo was saved or deleted, when no upload is left on its
 *  way: kept here, not in a sheet, so closing the sheet or changing its tab meanwhile does not lose it. */
let refreshPage:(()=>void)|undefined,refreshTimer:ReturnType<typeof setTimeout>|undefined;
function changedOnServer(customerId:string){
 announce(customerId);
 if(refreshTimer)clearTimeout(refreshTimer);
 refreshTimer=setTimeout(()=>{refreshTimer=undefined;if(!uploads.some(item=>item.phase!=='failed'))refreshPage?.();},800);
}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function enqueue(customerId:string,files:File[]){
 setUploads([...uploads,...files.map(file=>({key:crypto.randomUUID(),customerId,file,name:file.name,blob:null,phase:'queued' as const,percent:null,error:'',retryable:true}))]);
 void run();
}
function retry(key:string){patch(key,{phase:'queued',error:'',percent:null});void run();}
function dismiss(key:string){setUploads(uploads.filter(item=>item.key!==key));}

async function run(){
 if(running)return;running=true;
 try{
  for(let next=uploads.find(item=>item.phase==='queued');next;next=uploads.find(item=>item.phase==='queued')){
   const item=next,say:Say=(ar,en)=>document.documentElement.lang==='en'?en:ar;
   let blob=item.blob;
   if(!blob){
    patch(item.key,{phase:'preparing'});
    try{blob=(await shrinkPhoto(item.file,{maxBytes:MOLD_PHOTO_MAX_BYTES})).blob;patch(item.key,{blob});}
    catch(error){
     patch(item.key,{phase:'failed',retryable:false,error:error instanceof ShrinkError&&error.reason==='too_large'?say('حجم الصورة أكبر من 2 ميجابايت بعد تصغيرها. اختر صورة أصغر.','The photo is larger than 2 MB after shrinking. Choose a smaller photo.'):say('تعذر قراءة هذا الملف صورةً على هذا الجهاز. اختر صورة JPG أو PNG أو WEBP.','This file could not be read as a photo on this device. Choose a JPG, PNG or WEBP photo.')});
     continue;
    }
   }
   for(let attempt=0;;attempt++){
    patch(item.key,{phase:'uploading',percent:0,error:''});
    try{
     const form=new FormData();form.set('file',new File([blob],'mold-photo.jpg',{type:blob.type||'image/jpeg'}));
     await submitJson('/api/mold-photos?customerId='+encodeURIComponent(item.customerId)+'&key='+item.key,{method:'POST',body:form,credentials:'same-origin'},{language:document.documentElement.lang==='en'?'en':'ar',timeout:UPLOAD_TIMEOUT_MS,onUploadProgress:progress=>patch(item.key,{percent:progress.percent===null?null:Math.round(progress.percent)})});
     setUploads(uploads.filter(entry=>entry.key!==item.key));
     changedOnServer(item.customerId);
     break;
    }catch(error){
     const status=error instanceof SubmitError?error.status:0,busy=status===429||status===503;
     // A refusal the server stated (a full set, no right, not a photo) is final; a cut line, a timeout or a busy server is tried again
     // with the same key: the server answers a photo it already saved instead of saving it twice.
     if((busy||!definiteSubmitRejection(error))&&attempt<AUTOMATIC_RETRIES&&status!==401){await pause(1500*(attempt+1));continue;}
     // A refusal stays final, but a session that ended (401) or a busy server may be retried by hand later.
     patch(item.key,{phase:'failed',percent:null,retryable:!definiteSubmitRejection(error)||busy||status===401,error:errorText(error,say('تعذر رفع الصورة. أعد المحاولة.','The photo could not be uploaded. Retry.'))});
     announce(item.customerId);
     break;
    }
   }
  }
 }finally{running=false;}
}

// ---- the section
type Props={customerId:string;offline?:boolean;onChanged?:()=>void};
export default function CustomerMoldPhotos({customerId,offline=false,onChanged}:Props){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [list,setList]=useState<MoldPhotoList|null>(null),[loadError,setLoadError]=useState(''),[loading,setLoading]=useState(false);
 const [viewing,setViewing]=useState<number|null>(null),[confirming,setConfirming]=useState(false),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState('');
 const [notice,setNotice]=useState('');
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(onChanged)refreshPage=onChanged;},[onChanged]);
 const queue=useSyncExternalStore(subscribe,snapshot,snapshot).filter(item=>item.customerId===customerId);
 const pending=queue.filter(item=>item.phase!=='failed'),failed=queue.filter(item=>item.phase==='failed');

 const load=useCallback(async()=>{
  if(offline)return;
  setLoading(true);
  try{
   const response=await fetch('/api/mold-photos?customerId='+encodeURIComponent(customerId),{cache:'no-store',credentials:'same-origin'});
   const body:unknown=await response.json().catch(()=>null);
   if(response.ok&&validMoldPhotoList(body)){setList(body);setLoadError('');}
   else setLoadError(body&&typeof body==='object'&&typeof (body as {error?:unknown}).error==='string'?t((body as {error:string}).error):say('تعذر تحميل صور القالب. أعد المحاولة.','The mold photos could not be loaded. Retry.'));
  }catch{setLoadError(say('تعذر تحميل صور القالب. تأكد من الاتصال ثم أعد المحاولة.','The mold photos could not be loaded. Check the connection and retry.'));}
  finally{setLoading(false);}
 // eslint-disable-next-line react-hooks/exhaustive-deps -- say follows the language; the list is the customer's whatever the language
 },[customerId,offline]);
 useEffect(()=>{const first=setTimeout(()=>{void load();},0);return()=>clearTimeout(first);},[load]);
 // An upload or a delete of this customer, from this sheet or from one closed meanwhile: the list again.
 useEffect(()=>{
  const changed=(event:Event)=>{if((event as CustomEvent<string>).detail===customerId)void load();};
  window.addEventListener(CHANGED,changed);
  return()=>window.removeEventListener(CHANGED,changed);
 },[customerId,load]);

 const photos=list?.photos||[],max=list?.max||20,room=Math.max(0,max-photos.length-pending.length);
 const shown=viewing!==null&&photos[viewing]?photos[viewing]:null;
 function choose(files:FileList|null){
  const chosen=Array.from(files||[]);
  if(input.current)input.current.value='';
  if(!chosen.length)return;
  const taken=chosen.slice(0,room),extra=chosen.length-taken.length;
  setNotice(extra?say('المتاح '+room+' من '+max+' صورة؛ لم تُضف الصور الزائدة ('+extra+').','Only '+room+' of '+max+' places are left; the extra photos ('+extra+') were not added.'):'');
  if(taken.length)enqueue(customerId,taken);
 }
 async function remove(photo:MoldPhotoView){
  setDeleting(true);setDeleteError('');
  try{
   await submitJson('/api/mold-photos/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:photo.id}),credentials:'same-origin'},{language});
   setConfirming(false);
   const left=photos.filter(item=>item.id!==photo.id);
   setViewing(left.length?Math.min(viewing??0,left.length-1):null);
   setList(current=>current?{...current,photos:current.photos.filter(item=>item.id!==photo.id)}:current);
   changedOnServer(customerId);
  }catch(error){setDeleteError(errorText(error,say('تعذر حذف الصورة. أعد المحاولة.','The photo could not be deleted. Retry.')));}
  finally{setDeleting(false);}
 }
 const current=pending.find(item=>item.phase==='preparing'||item.phase==='uploading'),position=current?queue.indexOf(current)+1:0;
 const Previous=direction()==='rtl'?ChevronRight:ChevronLeft,Next=direction()==='rtl'?ChevronLeft:ChevronRight;
 const title=say('صور القالب','Mold photos');

 return <section className="mold-photos" aria-label={title} data-mold-photos={customerId}>
  <header>
   <h3><Images size={17} aria-hidden="true"/>{title}{list&&<span className="inline-count" data-mold-photo-count><bdi>{photos.length}</bdi> / <bdi>{max}</bdi></span>}</h3>
   {list?.canAdd&&<>
    <button type="button" className="btn primary small mold-photos-add" disabled={offline||room<1} onClick={()=>input.current?.click()}><ImagePlus size={16} aria-hidden="true"/>{say('إضافة صور','Add photos')}</button>
    <input ref={input} type="file" accept="image/*" multiple hidden data-mold-photo-input onChange={event=>choose(event.currentTarget.files)}/>
   </>}
  </header>
  {offline&&<p className="mold-photos-note">{say('عرض صور القالب وإضافتها يحتاجان اتصالًا بالإنترنت.','Viewing and adding mold photos needs an internet connection.')}</p>}
  {!offline&&loadError&&<p className="mold-photos-error" role="alert">{loadError} <button type="button" className="text-button" onClick={()=>{void load();}}><RotateCcw size={14} aria-hidden="true"/>{say('إعادة المحاولة','Retry')}</button></p>}
  {!offline&&!list&&!loadError&&loading&&<p className="mold-photos-note"><Loader2 className="spin" size={14} aria-hidden="true"/> {say('جارٍ تحميل الصور…','Loading the photos…')}</p>}
  {list&&!photos.length&&!pending.length&&<p className="mold-photos-note">{list.canAdd?say('لا توجد صور للقالب بعد. أضف صورًا من الكاميرا أو من معرض الصور.','No mold photos yet. Add photos from the camera or the gallery.'):say('لا توجد صور للقالب بعد.','No mold photos yet.')}</p>}
  {list?.canAdd&&room<1&&!pending.length&&<p className="mold-photos-note" data-mold-photos-full>{say('اكتمل الحد: '+max+' صورة لكل عميل. احذف صورة لإضافة غيرها.','The limit is reached: '+max+' photos per customer. Delete a photo to add another.')}</p>}
  {photos.length>0&&<ul className="mold-photos-grid">{photos.map((photo,index)=><li key={photo.id}>
   <button type="button" onClick={()=>{setViewing(index);setDeleteError('');}} aria-label={say('عرض الصورة '+(index+1)+' من '+photos.length,'View photo '+(index+1)+' of '+photos.length)} data-mold-photo={photo.id}>
    {/* eslint-disable-next-line @next/next/no-img-element -- a private image served by the CRM with the session, never through the optimizer */}
    <img src={moldPhotoSrc(photo.id)} alt="" loading="lazy" decoding="async"/>
   </button>
  </li>)}</ul>}
  <div className="mold-photos-status" role="status" aria-live="polite">
   {current&&<p><Loader2 className="spin" size={14} aria-hidden="true"/> {current.phase==='preparing'?say('جارٍ تجهيز الصورة '+position+' من '+queue.length+'…','Preparing photo '+position+' of '+queue.length+'…'):say('جارٍ رفع الصورة '+position+' من '+queue.length+(current.percent!==null?' ('+current.percent+'%)':'')+'…','Uploading photo '+position+' of '+queue.length+(current.percent!==null?' ('+current.percent+'%)':'')+'…')}</p>}
   {notice&&<p>{notice}</p>}
  </div>
  {failed.length>0&&<ul className="mold-photos-failed" aria-label={say('صور لم تُرفع','Photos not uploaded')}>{failed.map(item=><li key={item.key} data-mold-photo-failed>
   <span><bdi dir="auto">{item.name||say('صورة','Photo')}</bdi>: {item.error}</span>
   <span className="mold-photos-failed-actions">
    {item.retryable&&<button type="button" className="btn subtle small" disabled={offline} onClick={()=>retry(item.key)}><RotateCcw size={14} aria-hidden="true"/>{say('إعادة المحاولة','Retry')}</button>}
    <button type="button" className="btn subtle small" onClick={()=>dismiss(item.key)}><X size={14} aria-hidden="true"/>{say('إخفاء','Dismiss')}</button>
   </span>
  </li>)}</ul>}

  <Dialog open={!!shown} onOpenChange={open=>{if(!open&&!deleting){setViewing(null);setConfirming(false);}}}>
   <DialogContent className="crm-dialog mold-photo-viewer" dir={direction()} showCloseButton={false}>
    {shown&&viewing!==null&&<>
     <div className="mold-photo-viewer-bar">
      <DialogTitle>{say('صورة القالب '+(viewing+1)+' من '+photos.length,'Mold photo '+(viewing+1)+' of '+photos.length)}</DialogTitle>
      <button type="button" className="icon-button" onClick={()=>{setViewing(null);setConfirming(false);}} aria-label={say('إغلاق','Close')}><X size={18} aria-hidden="true"/></button>
     </div>
     <DialogDescription>{shown.uploadedBy?<>{say('أضافها ','Added by ')}<bdi>{shown.uploadedBy}</bdi>{say(' في ',' on ')}</>:say('أُضيفت في ','Added on ')}<bdi>{stamp(shown.createdAt,language)}</bdi></DialogDescription>
     <figure>
      {/* eslint-disable-next-line @next/next/no-img-element -- a private image served by the CRM with the session, never through the optimizer */}
      <img key={shown.id} src={moldPhotoSrc(shown.id)} alt={say('صورة القالب '+(viewing+1),'Mold photo '+(viewing+1))} decoding="async"/>
     </figure>
     <div className="mold-photo-viewer-actions">
      <button type="button" className="btn subtle small" disabled={viewing<1} onClick={()=>{setViewing(viewing-1);setDeleteError('');}}><Previous size={16} aria-hidden="true"/>{say('السابقة','Previous')}</button>
      <button type="button" className="btn subtle small" disabled={viewing>=photos.length-1} onClick={()=>{setViewing(viewing+1);setDeleteError('');}}>{say('التالية','Next')}<Next size={16} aria-hidden="true"/></button>
      {shown.canDelete&&<button type="button" className="btn subtle small danger mold-photo-delete" disabled={offline} onClick={()=>{setDeleteError('');setConfirming(true);}}><Trash2 size={15} aria-hidden="true"/>{say('حذف الصورة','Delete photo')}</button>}
     </div>
     {deleteError&&<p className="mold-photos-error" role="alert">{deleteError}</p>}
    </>}
   </DialogContent>
  </Dialog>
  <AlertDialog open={confirming&&!!shown} onOpenChange={open=>{if(!open&&!deleting)setConfirming(false);}}>
   <AlertDialogContent dir={direction()}>
    <AlertDialogTitle>{say('حذف هذه الصورة؟','Delete this photo?')}</AlertDialogTitle>
    <AlertDialogDescription>{say('تُحذف الصورة من صور القالب نهائيًا، ولا يمكن استرجاعها من «المحذوفات».','The photo is removed from the mold photos for good and cannot be restored from «Deleted records».')}</AlertDialogDescription>
    {deleteError&&<p className="mold-photos-error" role="alert">{deleteError}</p>}
    <AlertDialogFooter>
     <AlertDialogCancel disabled={deleting}>{say('إلغاء','Cancel')}</AlertDialogCancel>
     <AlertDialogAction disabled={deleting} aria-busy={deleting} onClick={event=>{event.preventDefault();if(shown)void remove(shown);}}>{deleting?<Loader2 className="spin" size={15} aria-hidden="true"/>:<Trash2 size={15} aria-hidden="true"/>}{say('حذف','Delete')}</AlertDialogAction>
    </AlertDialogFooter>
   </AlertDialogContent>
  </AlertDialog>
 </section>;
}

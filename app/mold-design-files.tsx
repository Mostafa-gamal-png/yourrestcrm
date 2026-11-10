'use client';
// Design files of a mold request (the contract's addition «ملفات التصميم», 2026-11-02): chosen in the request form or attached from the
// request's sheet, checked on the device as production checks them (portable/mold-rules.mjs), uploaded to the CRM one at a time (each
// with its own requestId, kept for retries of the same file), then sent to production by the server once production holds the request.
// Everyone who reads the request sees every file (the representative's and production's) and opens or downloads it through the CRM;
// the requester deletes their own while the request may change. Attaching or deleting a design file undoes the approvals, so it is
// confirmed first with that warning; a quotation's or PO's file no longer does (production's update of 2026-11-05): a plain confirmation.
// The uploads outlive the page (a member's queue lasts as long as the app is open), so moving to another page and back loses none.
// The quotation's and PO's files (production's second update of 2026-11-03) go the same way, each in its own group with its own limit (5
// of each, a PDF or an image only), offered once production's update is known to be live. The customer's signature (2026-11-04) is one of
// the design files: labelled «توقيع العميل», never deletable while the request names it, and taking one of the 10 places. Since 2026-11-05
// a new request needs one quotation or PO file (kept in the CRM until then: its groups are offered to attach it from the request's sheet).
// Since 2026-11-10 a signed copy of a PDF (the customer's signature stamped on its last page) is labelled «نسخة موقّعة», not deletable.
import React,{useRef,useState} from 'react';
import {Download,Eye,FileBox,FileText,ImageIcon,Loader2,Paperclip,PenLine,RotateCcw,Trash2,TriangleAlert,X} from 'lucide-react';
import {getLanguage} from '@/lib/i18n';
import {isNativeTrackingApp} from '@/lib/native-tracking';
import {definiteSubmitRejection,submitJson,SubmitError} from '@/lib/client-submit';
import {moldDesignRefusalText,moldDesignStateNames,moldErrorText,moldFileCategoryNames,MOLD_FILE_CATEGORY_ORDER,MOLD_SIGNATURE_TEXT,MOLD_SIGN_LINK_TEXT,type MoldDesignFileView,type MoldDesignKind,type MoldError,type MoldFileCategory,type MoldPendingDesignFile,type MoldRequestView} from '@/lib/mold-requests';
import {MOLD_CATEGORY_MAX_FILES,MOLD_DESIGN_EXTENSIONS,MOLD_DESIGN_MAX_BYTES,MOLD_DESIGN_MAX_FILES,moldDesignFileCheck,moldDesignName} from '@/portable/mold-rules.mjs';

type Say=(ar:string,en:string)=>string;
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof (error as {message:unknown}).message==='string'?(error as {message:string}).message:'';
/** The picker offers the extensions production accepts (the device's own check follows). */
export const MOLD_DESIGN_ACCEPT=Object.keys(MOLD_DESIGN_EXTENSIONS).map(extension=>'.'+extension).join(',');
/** A quotation's or PO's file: a PDF or an image only. */
export const MOLD_DOCUMENT_ACCEPT=Object.entries(MOLD_DESIGN_EXTENSIONS).filter(([,kind])=>kind==='pdf'||kind==='image').map(([extension])=>'.'+extension).join(',');
const acceptFor=(category:MoldFileCategory)=>category==='design'?MOLD_DESIGN_ACCEPT:MOLD_DOCUMENT_ACCEPT;
/** An upload of up to 25 MiB from a phone may take minutes: the server reads the body for up to 300 seconds, then sends for up to 15. */
const UPLOAD_TIMEOUT_MS=330_000;
/** The first bytes are enough for a PDF (its %PDF-1.x within the first 1024 bytes) and nearly every image header; an image whose header
 *  lies further is read whole. */
const HEAD_BYTES=1024*1024;
const crmFileIdOf=(key:string)=>'mdf-'+key;

/** A file chosen on the device: its check (refusal: the reason, '' when it may go), the requestId its upload keeps through retries, and
 *  what it is (a design file, the quotation's or the PO's). */
export type DesignChoice={key:string;file:File;name:string;size:number;kind:MoldDesignKind|null;refusal:string;category:MoldFileCategory};
/** One upload to the CRM: queued, on its way (uploading, then processing: saved and sent to production), or failed (final: refused
 *  for good, not to be retried as it is; busy: the CRM was taking other uploads). */
export type DesignUpload={key:string;moldId:string;file:File;name:string;size:number;kind:MoldDesignKind|null;phase:'queued'|'uploading'|'processing'|'failed';percent:number|null;error:string;busy:boolean;final:boolean;category:MoldFileCategory};

export const designSize=(size:number|null)=>size===null?'—':size<1024?size+' B':size<1024*1024?Math.max(1,Math.round(size/1024))+' KB':(size/1024/1024).toFixed(1)+' MB';
const KindIcon=({kind}:{kind:MoldDesignKind|null})=>kind==='pdf'?<FileText size={18} aria-hidden="true"/>:kind==='image'?<ImageIcon size={18} aria-hidden="true"/>:<FileBox size={18} aria-hidden="true"/>;
/** What attaching or deleting a design file does to a request production holds (the contract: it counts as a change). Not said for a
 *  quotation's or PO's file, which no longer undoes the approvals (2026-11-05). */
export const designWarningText=(say:Say)=>say('إرفاق ملف تصميم أو حذفه بيتحسب تعديل على الطلب: هيلغي الاعتمادات اللي تمت، ويرجع الطلب لمدير المبيعات من الأول.','Attaching or deleting a design file counts as a change to the request: it undoes the approvals given so far and the request goes back to the sales manager.');
/** A confirmation scrolls itself into view when it appears (a stable callback ref: once per appearance, not on every render), so its
 *  buttons are on a phone's screen; centered keeps the button that follows a warning in view too. */
export const reveal=(element:HTMLElement|null)=>{element?.scrollIntoView({block:'nearest'});};
export const revealCentered=(element:HTMLElement|null)=>{element?.scrollIntoView({block:'center'});};
/** The warning applies to a design file once production holds the request; before that nothing has been approved. A quotation's or PO's
 *  file never needs it (2026-11-05: attaching or deleting one keeps the approvals). */
export const designNeedsWarning=(view:Pick<MoldRequestView,'remote'>,category:MoldFileCategory='design')=>category==='design'&&!!view.remote;
/** Why a file was refused, in the representative's words: production's reason, or the code. category: the file's kind (its limit). */
export function designRefusal(error:Pick<MoldError,'code'|'reason'|'fields'>|null,say:Say,category:MoldFileCategory='design'){
 if(!error)return '';
 const reason=error.reason||(error.fields?.includes('name')?'name':error.code);
 return moldDesignRefusalText(reason,say,category);
}

/** Checks one file as production does, reading only what is needed (a PDF's first bytes, an image's header). A quotation's or PO's file
 *  is a PDF or an image only (not_document). */
export async function checkDesignFile(file:File,category:MoldFileCategory='design'):Promise<{kind:MoldDesignKind|null;refusal:string}>{
 const named=moldDesignName(file.name);
 if(!named)return {kind:null,refusal:'name'};
 if(category!=='design'&&named.kind==='other')return {kind:named.kind,refusal:'not_document'};
 if(!file.size)return {kind:named.kind,refusal:'empty'};
 if(file.size>MOLD_DESIGN_MAX_BYTES)return {kind:named.kind,refusal:'too_large'};
 if(named.kind==='other')return {kind:named.kind,refusal:''};
 const read=async(size:number)=>new Uint8Array(await file.slice(0,size).arrayBuffer());
 let checked=moldDesignFileCheck(file.name,await read(Math.min(file.size,HEAD_BYTES)),category);
 if(!checked.ok&&checked.reason==='bad_image'&&file.size>HEAD_BYTES)checked=moldDesignFileCheck(file.name,await read(file.size),category);
 return {kind:named.kind,refusal:checked.ok?'':checked.reason};
}
/** The chosen files, each checked; those beyond the places left are refused as too many (the 10 design files a request, or 5 of the
 *  quotation, 5 of the PO, production's too). overflow: the reason given to those (signature_room when the customer's signature takes
 *  the tenth place, 2026-11-04). */
export async function checkDesignFiles(files:File[],room:number,category:MoldFileCategory='design',overflow='too_many_files'):Promise<DesignChoice[]>{
 const out:DesignChoice[]=[];let left=room;
 for(const file of files){
  const checked=await checkDesignFile(file,category),refusal=checked.refusal||(left>0?'':overflow);
  if(!refusal)left--;
  out.push({key:crypto.randomUUID(),file,name:file.name,size:file.size,kind:checked.kind,refusal,category});
 }
 return out;
}
/** How many of a category's places a request's files take, as the server counts them (moldDesignCount): every file of it shown except
 *  those refused for good, and its uploads still on their way or retryable. */
export function designUsed(view:Pick<MoldRequestView,'designFiles'>,uploads:DesignUpload[],category:MoldFileCategory='design'){
 const shown=new Set(view.designFiles.map(file=>file.crmFileId)),of=(item:{category?:MoldFileCategory})=>(item.category||'design')===category;
 return view.designFiles.filter(file=>of(file)&&file.state!=='rejected'&&file.state!=='locked').length+uploads.filter(upload=>of(upload)&&!shown.has(crmFileIdOf(upload.key))&&!(upload.phase==='failed'&&upload.final)).length;
}

type Listener=(view:MoldRequestView)=>void;
const sameFile=(a:File,b:File)=>a.name===b.name&&a.size===b.size&&a.lastModified===b.lastModified;
/**
 * A member's uploads, one at a time (a phone's connection, and the server's two uploads at once). Lives as long as the app is open
 * (designUploadQueue), not the page: closing the request's sheet or moving to another page does not stop an upload, and its outcome (a
 * failure with its reason and Retry too) is shown when the sheet opens again. A repeated upload of the same file keeps its requestId, so
 * the server stores it once: the same file chosen again for the same request is not added twice (one whose upload failed is retried).
 */
export class DesignUploadQueue{
 private items:DesignUpload[]=[];
 private watchers=new Set<()=>void>();
 private listeners=new Map<string,Set<Listener>>();
 private latest=new Map<string,{view:MoldRequestView;seq:number}>();
 private seq=0;
 private running=false;
 subscribe=(watcher:()=>void)=>{this.watchers.add(watcher);return()=>{this.watchers.delete(watcher);};};
 snapshot=()=>this.items;
 /** Told of every request an upload answered with (moldId '' for all of them). */
 listen=(moldId:string,listener:Listener)=>{
  const set=this.listeners.get(moldId)||new Set<Listener>();set.add(listener);this.listeners.set(moldId,set);
  return()=>{set.delete(listener);};
 };
 /** A mark to compare with: an answer delivered after it is newer than a read started before it. */
 mark=()=>this.seq;
 newer=(moldId:string,mark:number)=>{const last=this.latest.get(moldId);return last&&last.seq>mark?last.view:null;};
 add=(moldId:string,choices:DesignChoice[])=>{
  const fresh:DesignChoice[]=[];
  for(const choice of choices){
   if(choice.refusal||this.items.some(item=>item.key===choice.key))continue;
   const same=this.items.find(item=>item.moldId===moldId&&(item.category||'design')===(choice.category||'design')&&sameFile(item.file,choice.file));
   if(!same)fresh.push(choice);else if(same.phase==='failed'&&!same.final)this.retry(same.key);
  }
  if(!fresh.length)return;
  this.write([...this.items,...fresh.map(choice=>({key:choice.key,moldId,file:choice.file,name:choice.name,size:choice.size,kind:choice.kind,phase:'queued' as const,percent:null,error:'',busy:false,final:false,category:choice.category||'design'}))]);
  void this.pump();
 };
 retry=(key:string)=>{this.patch(key,{phase:'queued',error:'',busy:false,final:false,percent:null});void this.pump();};
 discard=(key:string)=>{this.write(this.items.filter(item=>item.key!==key||item.phase==='uploading'||item.phase==='processing'));};
 private write(next:DesignUpload[]){this.items=next;this.watchers.forEach(watcher=>watcher());}
 private patch(key:string,change:Partial<DesignUpload>){this.write(this.items.map(item=>item.key===key?{...item,...change}:item));}
 private deliver(view:MoldRequestView){
  this.latest.set(view.id,{view,seq:++this.seq});
  for(const id of [view.id,''])this.listeners.get(id)?.forEach(listener=>listener(view));
 }
 private async pump(){
  if(this.running)return;
  this.running=true;
  try{
   for(let item=this.items.find(entry=>entry.phase==='queued');item;item=this.items.find(entry=>entry.phase==='queued'))await this.upload(item);
  }finally{this.running=false;}
 }
 private async upload(item:DesignUpload){
  const language=getLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
  this.patch(item.key,{phase:'uploading',percent:null});
  // A design file goes without category, exactly as before; the quotation's or PO's with its own.
  const form=new FormData();form.set('requestId',item.key);form.set('id',item.moldId);if(item.category!=='design')form.set('category',item.category);form.set('file',item.file,item.name);
  try{
   const reply=await submitJson<{request:MoldRequestView}>('/api/mold-requests/design-files',{method:'POST',body:form,credentials:'same-origin'},{language,timeout:UPLOAD_TIMEOUT_MS,
    onUploadProgress:progress=>this.patch(item.key,{phase:progress.phase,percent:progress.percent===null?null:Math.round(progress.percent)})});
   this.write(this.items.filter(entry=>entry.key!==item.key));
   this.deliver(reply.request);
  }catch(failure){
   const status=failure instanceof SubmitError?failure.status:0,body=failure instanceof SubmitError?failure.body as {request?:MoldRequestView;reason?:unknown}|null:null;
   // 409 with the request: the CRM kept the file, but production's approvals were complete first; the request shows it as locked.
   if(body?.request){this.write(this.items.filter(entry=>entry.key!==item.key));this.deliver(body.request);return;}
   const reason=typeof body?.reason==='string'?body.reason:status===413?'too_large':'';
   const error=reason?moldDesignRefusalText(reason,say,item.category)
    :status===429?say('رفع الملفات مشغول الآن على الخادم. انتظر لحظات ثم اضغط «إعادة المحاولة».','The server is busy with other uploads. Wait a moment, then tap Retry.')
    :messageOf(failure)||say('تعذّر رفع الملف. أعد المحاولة.','The file could not be uploaded. Retry.');
   // A refusal of the file itself (400, 413) is final: the same bytes would be refused again. Anything else may be retried as it is.
   this.patch(item.key,{phase:'failed',percent:null,error,busy:status===429,final:status===400||status===413});
  }
 }
}

const queues=new Map<string,DesignUploadQueue>();
/** The member's upload queue, the same one each time the mold requests page opens while the app is open. */
export function designUploadQueue(memberId:string){
 let queue=queues.get(memberId);
 if(!queue){queue=new DesignUploadQueue();queues.set(memberId,queue);}
 return queue;
}

const uploadPhase=(upload:DesignUpload,say:Say)=>upload.phase==='queued'?say('في انتظار الرفع','Waiting to upload')
 :upload.phase==='uploading'?say('جارٍ الرفع','Uploading')+(upload.percent!==null?' '+upload.percent+'%':'')
 :upload.phase==='processing'?say('جارٍ الحفظ والإرسال للإنتاج…','Saving and sending to production…'):say('لم يُرفع','Not uploaded');

/** A download through the CRM, fetched by the page so that a failure (production unreachable, the file gone there, the CRM busy) is
 *  said beside the file rather than lost in the browser's download list. '' once the file is handed to the browser to save. */
export async function downloadDesignFile(href:string,name:string,say:Say){
 try{
  const response=await fetch(href,{credentials:'same-origin',cache:'no-store'});
  if(!response.ok){
   let message='';
   try{message=String(((await response.json()) as {error?:unknown}).error||'');}catch{message='';}
   return message||(response.status===401?say('انتهت جلسة الدخول. سجّل الدخول مرة أخرى.','Your session has ended. Sign in again.'):say('تعذّر تنزيل الملف. حاول مرة أخرى.','The file could not be downloaded. Try again.'));
  }
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
  link.href=url;link.download=name;link.hidden=true;document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
  return '';
 }catch{return say('تعذّر تنزيل الملف؛ تحقق من الاتصال ثم حاول مرة أخرى.','The file could not be downloaded; check the connection and try again.');}
}
/** Open (a PDF or an image, in the browser; a failure reads as a page in words there) and download, both through the CRM. In the Android
 *  app the download stays a plain link: its WebView hands downloads to the system, which the page cannot follow. */
function FileLinks({href,viewable,name,say,onFailure}:{href:string;viewable:boolean;name:string;say:Say;onFailure:(message:string)=>void}){
 const [busy,setBusy]=useState(false);
 const download=(event:React.MouseEvent<HTMLAnchorElement>)=>{
  if(isNativeTrackingApp()||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  if(busy)return;
  setBusy(true);onFailure('');
  void downloadDesignFile(href,name,say).then(onFailure).finally(()=>setBusy(false));
 };
 return <>
  {viewable&&<a className="btn small subtle" href={href+'&inline=1'} target="_blank" rel="noopener noreferrer" aria-label={say('عرض ','Open ')+name}><Eye size={15} aria-hidden="true"/>{say('عرض','Open')}</a>}
  <a className="btn small subtle" href={href} download={name} aria-label={say('تنزيل ','Download ')+name} aria-busy={busy||undefined} onClick={download}>{busy?<Loader2 className="spin" size={15} aria-hidden="true"/>:<Download size={15} aria-hidden="true"/>}{say('تنزيل','Download')}</a>
 </>;
}

/** The picker (a button over an invisible input, so a phone's tap and the keyboard both reach it). */
function DesignInput({label,disabled,busy,onFiles,say,category='design'}:{label:string;disabled:boolean;busy:boolean;onFiles:(files:File[])=>void;say:Say;category?:MoldFileCategory}){
 return <label className="btn subtle mold-design-attach" data-disabled={disabled||busy||undefined} data-category={category}>
  {busy?<Loader2 className="spin" size={16} aria-hidden="true"/>:<Paperclip size={16} aria-hidden="true"/>}{label}
  <input type="file" multiple accept={acceptFor(category)} className="mold-design-input" disabled={disabled||busy} aria-label={label}
   title={category==='design'?say('PDF أو صورة أو ملف رسم','A PDF, an image or a drawing'):say('PDF أو صورة','A PDF or an image')} onChange={event=>{const files=Array.from(event.currentTarget.files||[]);event.currentTarget.value='';if(files.length)onFiles(files);}}/>
 </label>;
}
const hint=(say:Say,category:MoldFileCategory='design')=>category==='design'
 ?say('PDF أو صورة أو ملف رسم (DWG وDXF وSTEP وSTL وZIP…) · حتى 25 ميجابايت للملف · '+MOLD_DESIGN_MAX_FILES+' ملفات للطلب مع ملفات الإنتاج','A PDF, an image or a drawing (DWG, DXF, STEP, STL, ZIP…) · up to 25 MB a file · '+MOLD_DESIGN_MAX_FILES+' files a request with production\'s')
 :say('PDF أو صورة بس · حتى 25 ميجابايت للملف · '+MOLD_CATEGORY_MAX_FILES[category]+' ملفات مع ملفات الإنتاج','A PDF or an image only · up to 25 MB a file · '+MOLD_CATEGORY_MAX_FILES[category]+' files with production\'s');
/** The picker's title in the form, for each kind of file. The quotation's and PO's pickers sit under «عرض السعر أو الـ PO (ملف واحد على
 *  الأقل)» (2026-11-05): no «اختياري» of their own. The design files' is «(اختياري)» unless the form gives its own title (a new request,
 *  2026-11-08: «ملفات التصميم (ملف واحد على الأقل)»). */
const pickerTitle=(say:Say,category:MoldFileCategory)=>category==='quote'?say('ملفات عرض السعر','Quotation files'):category==='po'?say('ملفات الـ PO','PO files'):say('ملفات التصميم (اختياري)','Design files (optional)');

/** The files chosen in the request form: each checked at once; those that may go upload right after the request is saved. category: the
 *  kind of file this picker takes (design by default; the quotation's or PO's: a PDF or an image only). title: the form's own (a required
 *  kind, 2026-11-08), with its refusal (error) said under it. */
export function MoldDesignPicker({choices,onChange,room,disabled,say,category='design',overflow='too_many_files',note='',title='',error=''}:{choices:DesignChoice[];onChange:(next:DesignChoice[])=>void;room:number;disabled:boolean;say:Say;category?:MoldFileCategory;overflow?:string;note?:string;title?:string;error?:string}){
 const [checking,setChecking]=useState(false);
 const ready=choices.filter(choice=>!choice.refusal).length;
 const pick=async(files:File[])=>{
  setChecking(true);
  try{
   // The same file chosen twice goes once.
   const fresh=files.filter(file=>!choices.some(choice=>choice.file.name===file.name&&choice.file.size===file.size&&choice.file.lastModified===file.lastModified));
   onChange([...choices,...await checkDesignFiles(fresh,room-ready,category,overflow)]);
  }finally{setChecking(false);}
 };
 return <fieldset className="mold-design-picker" data-category={category} data-required={title?true:undefined} aria-invalid={!!error||undefined}><legend>{title||pickerTitle(say,category)}</legend>
  <DesignInput label={say('اختيار ملفات','Choose files')} disabled={disabled||room-ready<=0} busy={checking} onFiles={files=>void pick(files)} say={say} category={category}/>
  <small className="mold-design-hint">{hint(say,category)}</small>
  {/* The customer's signature takes the tenth place (2026-11-04): said before the representative chooses, and on a tenth file. */}
  {note&&<small className="mold-design-hint mold-signature-room" data-full={ready>=room||undefined}>{note}</small>}
  {!!choices.length&&<ul className="mold-design-list">{choices.map(choice=><li key={choice.key} className="mold-design-file" data-state={choice.refusal?'refused':'ready'}>
   <span className="mold-design-icon"><KindIcon kind={choice.kind}/></span>
   <div className="mold-design-main"><bdi className="mold-design-name">{choice.name}</bdi>
    <span className="mold-design-meta"><span dir="ltr">{designSize(choice.size)}</span><span className="mold-design-state">{choice.refusal?say('لن يُرفع','Will not be uploaded'):say('يُرفع بعد حفظ الطلب','Uploads once the request is saved')}</span></span>
    {choice.refusal&&<small className="mold-design-reason" role="alert">{moldDesignRefusalText(choice.refusal,say,category)}</small>}</div>
   <div className="mold-design-actions"><button type="button" className="btn small subtle" disabled={disabled} onClick={()=>onChange(choices.filter(other=>other.key!==choice.key))} aria-label={say('إزالة ','Remove ')+choice.name}><X size={15} aria-hidden="true"/>{say('إزالة','Remove')}</button></div>
  </li>)}</ul>}
  {error&&<small className="field-error" role="alert">{error}</small>}
 </fieldset>;
}

/** Why a file stands where it does, beside its state: production's refusal of the file, or of its deletion (the file then stays as
 *  production holds it); the last failure of a send or a deletion still on its way; and, once the automatic tries have stopped (24 hours
 *  of failures, or production did not find the request), that the requester's resend is the way on. */
export function designFileDetail(file:Pick<MoldDesignFileView,'state'|'error'|'stopped'>&{category?:MoldFileCategory},say:Say){
 const error=file.error;
 if(file.state==='rejected')return designRefusal(error,say,file.category);
 if(file.state==='sent'&&error)return say('لم يُحذف من الإنتاج: ','Not deleted at production: ')+designRefusal(error,say,file.category);
 if(file.state!=='waiting'&&file.state!=='deleting')return '';
 const parts=[];
 if(error?.http===404)parts.push(say('لم يجد تطبيق الإنتاج الطلب، أو لا يستقبل ملفات التصميم بعد. لن يُعاد الإرسال تلقائيًا؛ استخدم «إعادة الإرسال».','Production did not find the request, or does not take design files yet. It is not sent again by itself; use Resend.'));
 else{
  // A file's own call waits up to 2 minutes; a deletion's, 10 seconds.
  if(error)parts.push(say('آخر محاولة: ','Last try: ')+moldErrorText(error.code,say,{file:file.state==='waiting'})+'.');
  if(file.stopped)parts.push(say('توقفت المحاولات التلقائية بعد 24 ساعة؛ استخدم «إعادة الإرسال».','Automatic tries stopped after 24 hours; use Resend.'));
 }
 return parts.join(' ');
}

/** The request's files in its sheet, one group for each kind: its design files, and (once production's update of 2026-11-03 is live, or
 *  when the request has some) the quotation's and the PO's. quotePo: production's update is known to be live, so those may be attached;
 *  so may they for a request kept for its quotation's or PO's file (sending.held: the server knows the update even if the page did not).
 *  The design files' group is always attachable by the requester (view.can.attach), a request kept for its design file (2026-11-08)
 *  among them. */
export function MoldDesignFiles({view,uploads,queue,onView,say,quotePo=false}:{view:MoldRequestView;uploads:DesignUpload[];queue:DesignUploadQueue;onView:(view:MoldRequestView)=>void;say:Say;quotePo?:boolean}){
 const offered=quotePo||view.sending.held==='quote_file';
 const groups=MOLD_FILE_CATEGORY_ORDER.filter(category=>category==='design'||offered||view.designFiles.some(file=>file.category===category)||uploads.some(upload=>upload.category===category));
 return <>{groups.map(category=><MoldFileGroup key={category} category={category} attachable={category==='design'||offered} view={view} uploads={uploads} queue={queue} onView={onView} say={say}/>)}</>;
}
const emptyText=(say:Say,category:MoldFileCategory)=>category==='quote'?say('لا توجد ملفات عرض سعر.','No quotation files.'):category==='po'?say('لا توجد ملفات PO.','No PO files.'):say('لا توجد ملفات تصميم.','No design files.');
/** One kind of the request's files: every file of it, the representative's with where it stands and production's marked as such, each
 *  opened or downloaded through the CRM; the requester attaches (when attachable) and deletes while the request may change. */
function MoldFileGroup({view,uploads,queue,onView,say,category,attachable}:{view:MoldRequestView;uploads:DesignUpload[];queue:DesignUploadQueue;onView:(view:MoldRequestView)=>void;say:Say;category:MoldFileCategory;attachable:boolean}){
 const [checking,setChecking]=useState(false),[refused,setRefused]=useState<DesignChoice[]>([]),[asking,setAsking]=useState<DesignChoice[]|null>(null);
 const [confirming,setConfirming]=useState<string|null>(null),[deleting,setDeleting]=useState<string|null>(null),[errors,setErrors]=useState<Record<string,string>>({});
 const keys=useRef(new Map<string,string>());
 const listed=view.designFiles.filter(file=>(file.category||'design')===category);
 const shown=new Set(view.designFiles.map(file=>file.crmFileId)),pending=uploads.filter(upload=>(upload.category||'design')===category&&!shown.has(crmFileIdOf(upload.key)));
 const max=MOLD_CATEGORY_MAX_FILES[category],used=designUsed(view,uploads,category),room=max-used,warn=designNeedsWarning(view,category);
 const pick=async(files:File[])=>{
  setChecking(true);setAsking(null);
  try{
   const choices=await checkDesignFiles(files,room,category),ready=choices.filter(choice=>!choice.refusal);
   setRefused(choices.filter(choice=>choice.refusal));
   if(!ready.length)return;
   if(warn)setAsking(ready);else queue.add(view.id,ready);
  }finally{setChecking(false);}
 };
 const failed=(key:string)=>(message:string)=>setErrors(previous=>previous[key]===message?previous:{...previous,[key]:message});
 const remove=async(file:MoldDesignFileView)=>{
  if(deleting||!file.crmFileId)return;
  setDeleting(file.key);failed(file.key)('');
  // A retry after an unclear failure keeps its identifier, so the deletion is asked for once.
  const name='delete:'+file.key;if(!keys.current.has(name))keys.current.set(name,crypto.randomUUID());
  try{
   const reply=await submitJson<{request:MoldRequestView}>('/api/mold-requests/design-files/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:keys.current.get(name),id:view.id,fileId:file.crmFileId})},{language:getLanguage()});
   keys.current.delete(name);setConfirming(null);onView(reply.request);
  }catch(failure){
   const body=failure instanceof SubmitError?failure.body as {request?:MoldRequestView}|null:null;
   if(definiteSubmitRejection(failure))keys.current.delete(name);
   setConfirming(null);setErrors(previous=>({...previous,[file.key]:failure instanceof SubmitError&&failure.status===429?say('الخادم مشغول الآن. أعد المحاولة بعد لحظات.','The server is busy. Retry in a moment.'):messageOf(failure)}));
   if(body?.request)onView(body.request);
  }finally{setDeleting(null);}
 };
 const stateText=(file:MoldDesignFileView)=>say(...moldDesignStateNames[file.state]);
 return <section className="mold-design" aria-label={say(...moldFileCategoryNames[category])} data-category={category}>
  <div className="mold-design-head"><h3 className="mold-subtitle">{say(...moldFileCategoryNames[category])}</h3><span className="mold-design-count" dir="ltr">{used}/{max}</span></div>
  {!listed.length&&!pending.length&&<p className="mold-design-empty">{emptyText(say,category)}</p>}
  {(!!listed.length||!!pending.length)&&<ul className="mold-design-list">
   {listed.map(file=>{
    const reason=designFileDetail(file,say),mayReach=warn&&['sent','waiting'].includes(file.state);
    return <li key={file.key} className="mold-design-file" data-state={file.state} data-source={file.source} data-signature={file.signature||undefined} data-signed-copy={file.signedCopy||undefined}>
     <span className="mold-design-icon">{file.signature||file.signedCopy?<PenLine size={18} aria-hidden="true"/>:<KindIcon kind={file.kind}/>}</span>
     <div className="mold-design-main"><bdi className="mold-design-name">{file.name}</bdi>
      <span className="mold-design-meta"><span dir="ltr">{designSize(file.size)}</span>{file.signature&&<span className="mold-chip" data-kind="signature">{say(...MOLD_SIGNATURE_TEXT.title)}</span>}{file.signedCopy&&<span className="mold-chip" data-kind="signed-copy">{say(...MOLD_SIGN_LINK_TEXT.copyMark)}</span>}{file.source==='production'?<span className="mold-chip" data-source="production">{say('من الإنتاج','From production')}</span>:<span className="mold-design-state">{stateText(file)}</span>}</span>
      {reason&&<small className="mold-design-reason">{reason}</small>}
      {errors[file.key]&&<small className="mold-design-reason" role="alert">{errors[file.key]}</small>}</div>
     <div className="mold-design-actions">
      {file.state!=='deleting'&&<FileLinks href={file.href} viewable={file.viewable} name={file.name} say={say} onFailure={failed(file.key)}/>}
      {file.canDelete&&confirming!==file.key&&<button type="button" className="btn small subtle mold-design-delete" disabled={!!deleting} onClick={()=>setConfirming(file.key)} aria-label={say('حذف ','Delete ')+file.name}>{deleting===file.key?<Loader2 className="spin" size={15}/>:<Trash2 size={15} aria-hidden="true"/>}{say('حذف','Delete')}</button>}
     </div>
     {confirming===file.key&&<div className="mold-design-confirm" role="group" ref={reveal} aria-label={say('تأكيد حذف الملف','Confirm deleting the file')}>
      <p>{mayReach?<><TriangleAlert size={16} aria-hidden="true"/>{designWarningText(say)}</>:say('حذف الملف من الطلب؟','Delete the file from the request?')}</p>
      <div className="mold-actions"><button type="button" className="btn danger-outline" disabled={!!deleting} onClick={()=>void remove(file)}>{deleting===file.key?<Loader2 className="spin" size={16}/>:<Trash2 size={16} aria-hidden="true"/>}{say('تأكيد الحذف','Confirm delete')}</button>
       <button type="button" className="btn subtle" disabled={!!deleting} onClick={()=>setConfirming(null)}>{say('رجوع','Back')}</button></div>
     </div>}
    </li>;
   })}
   {pending.map(upload=><li key={upload.key} className="mold-design-file" data-state={'upload-'+upload.phase}>
    <span className="mold-design-icon">{upload.phase==='uploading'||upload.phase==='processing'?<Loader2 className="spin" size={18} aria-hidden="true"/>:<KindIcon kind={upload.kind}/>}</span>
    <div className="mold-design-main"><bdi className="mold-design-name">{upload.name}</bdi>
     <span className="mold-design-meta"><span dir="ltr">{designSize(upload.size)}</span><span className="mold-design-state" role="status">{uploadPhase(upload,say)}</span></span>
     {upload.phase==='failed'&&<small className="mold-design-reason" role="alert">{upload.error}</small>}</div>
    <div className="mold-design-actions">
     {upload.phase==='failed'&&!upload.final&&<button type="button" className="btn small subtle" onClick={()=>queue.retry(upload.key)}><RotateCcw size={15} aria-hidden="true"/>{say('إعادة المحاولة','Retry')}</button>}
     {(upload.phase==='failed'||upload.phase==='queued')&&<button type="button" className="btn small subtle" onClick={()=>queue.discard(upload.key)} aria-label={say('إزالة ','Remove ')+upload.name}><X size={15} aria-hidden="true"/>{say('إزالة','Remove')}</button>}
    </div>
   </li>)}
  </ul>}
  {!!refused.length&&<div className="mold-design-refused" role="alert">
   <ul>{refused.map(choice=><li key={choice.key}><bdi>{choice.name}</bdi>: {moldDesignRefusalText(choice.refusal,say,category)}</li>)}</ul>
   <button type="button" className="btn small subtle" onClick={()=>setRefused([])} aria-label={say('إخفاء','Dismiss')}><X size={15} aria-hidden="true"/></button>
  </div>}
  {asking&&<div className="mold-design-confirm" role="group" ref={reveal} aria-label={say('تأكيد إرفاق الملفات','Confirm attaching the files')}>
   <p><TriangleAlert size={16} aria-hidden="true"/>{designWarningText(say)}</p>
   <ul>{asking.map(choice=><li key={choice.key}><bdi>{choice.name}</bdi> <span dir="ltr">({designSize(choice.size)})</span></li>)}</ul>
   <div className="mold-actions"><button type="button" className="btn primary" onClick={()=>{queue.add(view.id,asking);setAsking(null);}}><Paperclip size={16} aria-hidden="true"/>{say('تأكيد الإرفاق','Confirm attaching')}</button>
    <button type="button" className="btn subtle" onClick={()=>setAsking(null)}>{say('إلغاء','Cancel')}</button></div>
  </div>}
  {view.can.attach&&attachable&&<div className="mold-design-tools">
   <DesignInput label={say('إرفاق ملفات','Attach files')} disabled={room<=0||!!asking} busy={checking} onFiles={files=>void pick(files)} say={say} category={category}/>
   <small className="mold-design-hint">{room<=0?moldDesignRefusalText('too_many_files',say,category)+'. '+say('احذف ملفًا أولًا.','Delete a file first.'):hint(say,category)}</small>
   {category==='design'&&listed.some(file=>file.signature)&&<small className="mold-design-hint mold-signature-room">{say('توقيع العميل من ملفات الطلب الـ 10، ومينفعش يتحذف.','The customer\'s signature is one of the request\'s 10 files and cannot be deleted.')}</small>}
  </div>}
 </section>;
}

/** Why a request the sales manager has just approved lists its files without links: those links serve a request only while it waits for
 *  them (app/api/mold-requests/design-file/route.ts by the item's crmRequestId, requestRef or number), so right after the approval they would answer 404. A request of the CRM
 *  shows its files on its own sheet. */
export const pendingFilesApprovedNote=(inCrm:boolean,say:Say)=>inCrm
 ?say('بعد اعتمادك لا تُفتح الملفات من هنا؛ افتح الطلب لعرضها.','Once you approve, the files no longer open from here; open the request to see them.')
 :say('بعد اعتمادك لا تُفتح الملفات من هنا.','Once you approve, the files no longer open from here.');
/** A pending request's files in the sales manager's list, each opened or downloaded through the CRM by the item's name (moldPendingQuery). note: the
 *  files are listed by name only, with this said once (a request just approved, pendingFilesApprovedNote). category: the kind of these
 *  files (design by default; the quotation's or PO's since production's update of 2026-11-03). */
export function MoldPendingDesignFiles({files,say,note='',category='design'}:{files:MoldPendingDesignFile[];say:Say;note?:string;category?:MoldFileCategory}){
 const [errors,setErrors]=useState<Record<string,string>>({});
 if(!files.length)return null;
 return <div className="mold-design mold-design-compact" aria-label={say(...moldFileCategoryNames[category])} data-links={note?'off':undefined} data-category={category}>
  <strong className="mold-design-title">{say(...moldFileCategoryNames[category])} <span className="mold-design-count" dir="ltr">({files.length})</span></strong>
  {note&&<small className="mold-design-hint mold-design-links-off">{note}</small>}
  <ul className="mold-design-list">{files.map(file=><li key={String(file.fileId)} className="mold-design-file" data-source={file.source} data-signature={file.signature||undefined}>
   <span className="mold-design-icon">{file.signature?<PenLine size={18} aria-hidden="true"/>:<KindIcon kind={file.kind}/>}</span>
   <div className="mold-design-main"><bdi className="mold-design-name">{file.name}</bdi>
    <span className="mold-design-meta"><span dir="ltr">{designSize(file.size)}</span>{file.signature&&<span className="mold-chip" data-kind="signature">{say(...MOLD_SIGNATURE_TEXT.title)}</span>}{file.source==='production'?<span className="mold-chip" data-source="production">{say('من الإنتاج','From production')}</span>:<span>{say('من المندوب','From the representative')}</span>}</span>
    {errors[String(file.fileId)]&&<small className="mold-design-reason" role="alert">{errors[String(file.fileId)]}</small>}</div>
   {!note&&<div className="mold-design-actions"><FileLinks href={file.href} viewable={file.viewable} name={file.name} say={say} onFailure={message=>setErrors(previous=>({...previous,[String(file.fileId)]:message}))}/></div>}
  </li>)}</ul>
 </div>;
}

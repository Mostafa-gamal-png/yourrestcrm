'use client';
import {useRef,useState} from 'react';
import {Download,FileSpreadsheet,Loader2,Upload,CheckCircle2} from 'lucide-react';
import {toast} from 'sonner';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {submitJson} from '@/lib/client-submit';
import {t,useLanguage,direction} from '@/lib/i18n';
import type {RecordImportAnswer,RecordImportStatus} from '@/lib/record-import-server';
import './record-import.css';

type Kind='targets'|'followups';
const TITLE:Record<Kind,[string,string]>={targets:['استيراد المستهدفات من Excel','Import targets from Excel'],followups:['استيراد المتابعات من Excel','Import follow-ups from Excel']};
const MAX_BYTES=2*1024*1024;
/** «صف واحد»، «صفان»، «3 صفوف»، «11 صفًا» (MSA counting). */
const rowsAr=(n:number)=>n===1?'صفًا واحدًا':n===2?'صفين':n>=3&&n<=10?n+' صفوف':n+' صفًا';
const messageOf=(e:unknown)=>typeof e==='object'&&e!==null&&'message' in e&&typeof e.message==='string'?e.message:'';
function readFile(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reader.onabort=()=>reject(new Error('FILE_READ_FAILED'));reader.onload=()=>{const result=String(reader.result||''),at=result.indexOf(',');if(at<0||!result.slice(at+1))reject(new Error('FILE_READ_FAILED'));else resolve(result.slice(at+1));};reader.readAsDataURL(file);});}

/** «استيراد من Excel» (the owner, 2026-11-16, GSCO list item 8; lib/record-import*.ts): the template, the file, a preview that saves nothing
 *  (each row's status and, for a refused one, its Excel row and the reason), then «استيراد» once. The server decides everything again. */
export default function RecordImportButton({kind,month,onImported}:{kind:Kind;month?:string;onImported:()=>void|Promise<void>}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const [open,setOpen]=useState(false);
 // The page's data is read again when the dialog closes after an import (reading it while the dialog is open would replace the page under it and
 // close the result before it is read).
 return <><button type="button" className="btn subtle" data-record-import={kind} onClick={()=>setOpen(true)}><FileSpreadsheet size={17}/>{say(...TITLE[kind])}</button>{open&&<RecordImportDialog kind={kind} month={month} onClose={imported=>{setOpen(false);if(imported)void onImported();}}/>}</>;
}

type Stage={step:'pick'}|{step:'reading'}|{step:'checked';answer:RecordImportAnswer;file:{fileName:string;base64:string};requestId:string}|{step:'saving';answer:RecordImportAnswer}|{step:'saved';answer:RecordImportAnswer};
function RecordImportDialog({kind,month,onClose:close}:{kind:Kind;month?:string;onClose:(imported:boolean)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const [stage,setStage]=useState<Stage>({step:'pick'}),[error,setError]=useState(''),[downloading,setDownloading]=useState(false),lock=useRef(false);
 const busy=stage.step==='reading'||stage.step==='saving'||downloading;
 const imported=useRef(false),onClose=()=>close(imported.current);
 const send=(body:Record<string,unknown>)=>submitJson<RecordImportAnswer>('/api/record-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,language})},{language,timeout:120000});
 async function template(){
  if(lock.current)return;lock.current=true;setDownloading(true);setError('');
  try{
   const response=await fetch('/api/record-import?kind='+kind+(month?'&month='+encodeURIComponent(month):'')+'&lang='+language,{cache:'no-store'});
   if(!response.ok){let text='';try{text=((await response.json()) as {error?:string}).error||'';}catch{text='';}throw new Error(text||say('تعذر تنزيل القالب. أعد المحاولة.','Could not download the template. Retry.'));}
   const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||'Yourrest-'+kind+'-template.xlsx';
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(messageOf(e)||say('تعذر تنزيل القالب. أعد المحاولة.','Could not download the template. Retry.'));}
  finally{lock.current=false;setDownloading(false);}
 }
 async function choose(selected:File|undefined){
  if(!selected||lock.current)return;
  if(!/\.xlsx$/i.test(selected.name)){setError(say('ارفع ملف Excel بصيغة xlsx.','Upload an Excel file (.xlsx).'));return;}
  if(selected.size>MAX_BYTES){setError(say('أقصى حجم لملف الاستيراد 2 ميجابايت','The import file may be 2 MB at most'));return;}
  lock.current=true;setError('');setStage({step:'reading'});
  try{const file={fileName:selected.name,base64:await readFile(selected)};const answer=await send({kind,action:'preview',...file});setStage({step:'checked',answer,file,requestId:crypto.randomUUID()});}
  catch(e){setError(messageOf(e)==='FILE_READ_FAILED'?say('تعذر قراءة الملف من الجهاز.','The file could not be read on this device.'):messageOf(e)||say('تعذر قراءة الملف.','The file could not be read.'));setStage({step:'pick'});}
  finally{lock.current=false;}
 }
 async function save(){
  if(lock.current||stage.step!=='checked')return;lock.current=true;setError('');const current=stage;setStage({step:'saving',answer:current.answer});
  try{const answer=await send({kind,action:'commit',...current.file,requestId:current.requestId,planDigest:current.answer.planDigest});setStage({step:'saved',answer});if(answer.written)imported.current=true;toast.success(say('تم الاستيراد','Imported'));}
  // A cut connection keeps the same request: «استيراد» again returns its first answer and saves nothing twice.
  catch(e){setError(messageOf(e)||say('تعذر الاستيراد.','The import failed.'));setStage(current);}
  finally{lock.current=false;}
 }
 const answer=stage.step==='checked'||stage.step==='saving'||stage.step==='saved'?stage.answer:null;
 const label:Record<RecordImportStatus,[string,string]>={new:['جديد','New'],changed:['تحديث','Update'],unchanged:['بلا تغيير','No change'],duplicate:['سبق استيراده','Already imported'],empty:['صف بلا قيم','Row without values'],refused:['مرفوض','Refused']};
 const shown=answer?[...answer.rows].sort((a,b)=>Number(b.status==='refused')-Number(a.status==='refused')||a.row-b.row):[];
 return <Dialog open onOpenChange={value=>{if(!value&&!busy)onClose();}}><DialogContent className="crm-dialog record-import-dialog" dir={direction()} showCloseButton={!busy} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onInteractOutside={event=>{if(busy)event.preventDefault();}} data-record-import-dialog={kind}>
  <DialogTitle>{say(...TITLE[kind])}</DialogTitle>
  <DialogDescription>{kind==='targets'?say('القالب فيه أعضاء فريقك ومستهدفاتهم السارية للشهر. عدّل ما تريد ثم ارفعه: الخلية الفارغة في صنف = غير محدد، و0 = صنف غير مكلف به. لا يُحفظ شيء قبل «استيراد»، ورفع الملف نفسه مرة أخرى لا يغيّر شيئًا.','The template lists your team with the month\'s targets in force. Change what you need and upload it: an empty product cell = not set, and 0 = not assigned. Nothing is saved before «Import», and uploading the same file again changes nothing.'):say('القالب فيه عملاؤك الذين لديهم متابعة مفتوحة. اكتب نتيجة كل متابعة وما بعدها ثم ارفعه. تُسجَّل كل متابعة كما لو كُتبت في صفحة المتابعات، ولا يُحفظ شيء قبل «استيراد»، والصف المستورد مرة أخرى لا يتكرر.','The template lists your customers with an open follow-up. Write each follow-up\'s outcome and next step, then upload it. Each follow-up is recorded as if typed on the follow-ups page; nothing is saved before «Import», and a row imported again is not repeated.')}</DialogDescription>
  <div className="record-import-body">
   <div className="record-import-actions">
    <button type="button" className="btn subtle" disabled={busy} onClick={()=>void template()} data-record-import-template>{downloading?<Loader2 size={17} className="spin"/>:<Download size={17}/>}{say('تنزيل القالب','Download the template')}</button>
    {(stage.step==='pick'||stage.step==='reading'||stage.step==='checked')&&<label className={'btn '+(stage.step==='checked'?'subtle':'primary')+' record-import-file'} aria-disabled={busy}>{stage.step==='reading'?<Loader2 size={17} className="spin"/>:<Upload size={17}/>}{stage.step==='reading'?say('جارٍ قراءة الملف…','Reading the file…'):stage.step==='checked'?say('ملف آخر','Another file'):say('اختر الملف','Choose the file')}<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden disabled={busy} data-record-import-file onChange={event=>{const file=event.target.files?.[0];event.target.value='';void choose(file);}}/></label>}
   </div>
   {error&&<div className="form-error" role="alert">{t(error)}</div>}
   {answer&&<div className="record-import-summary" role="status" data-record-import-summary>
    {stage.step==='saved'?<p className="record-import-done"><CheckCircle2 size={18}/>{answer.alreadySaved?say('هذا الاستيراد محفوظ من قبل؛ لم يُحفظ شيء مرة ثانية.','This import was already saved; nothing was saved twice.'):say(`تم حفظ ${answer.written||0} من ${answer.counts.rows} من صفوف الملف.`,`${answer.written||0} of the file's ${answer.counts.rows} rows saved.`)}</p>:<p><bdi>{answer.fileName}</bdi> · {say('ورقة','Sheet')} <bdi>{answer.sheet}</bdi></p>}
    <dl>
     <div><dt>{say('صفوف الملف','Rows in the file')}</dt><dd>{answer.counts.rows}</dd></div>
     <div data-count="write"><dt>{stage.step==='saved'?say('حُفظت','Saved'):say('ستُحفظ','To be saved')}</dt><dd>{stage.step==='saved'?answer.written||0:answer.counts.write}</dd></div>
     <div><dt>{say('بلا تغيير أو سبق استيرادها','Unchanged or already imported')}</dt><dd>{answer.counts.unchanged+answer.counts.duplicate+answer.counts.empty}</dd></div>
     <div data-count="refused"><dt>{say('مرفوضة ولن تُحفظ','Refused, not saved')}</dt><dd>{answer.counts.refused}</dd></div>
    </dl>
    {!!answer.closedMonths?.length&&<p className="record-import-note">{say('يشمل الاستيراد شهرًا منتهيًا؛ بصفتك مدير النظام يُسجَّل التعديل في «سجل التعديلات»: ','The import includes a finished month; as the system administrator the change is kept in the change history: ')}<bdi dir="ltr">{answer.closedMonths.join(', ')}</bdi></p>}
    {!!answer.ignoredColumns.length&&<p className="record-import-note">{say('أعمدة غير معروفة لم تُقرأ: ','Unknown columns not read: ')}{answer.ignoredColumns.join('، ')}</p>}
   </div>}
   {answer&&<div className="record-import-rows"><table><thead><tr><th>{say('صف Excel','Excel row')}</th><th>{say('الحالة','Status')}</th><th>{kind==='targets'?say('العضو','Member'):say('العميل','Customer')}</th><th>{say('التفاصيل','Details')}</th></tr></thead><tbody>{shown.slice(0,300).map(row=><tr key={row.row} data-row-status={row.status}><td><bdi>{row.row}</bdi></td><td><span className={'badge record-import-'+row.status}>{say(...label[row.status])}</span></td><td>{row.subject}{row.detail&&<small><bdi dir="ltr">{row.detail}</bdi></small>}</td><td>{t(row.message)}</td></tr>)}</tbody></table>{shown.length>300&&<p className="record-import-note">{say(`يظهر أول 300 صف من ${shown.length}.`,`The first 300 of ${shown.length} rows are shown.`)}</p>}</div>}
   <div className="form-footer">
    <button type="button" className="btn subtle" disabled={busy} onClick={onClose}>{stage.step==='saved'?t('إغلاق'):t('إلغاء')}</button>
    {(stage.step==='checked'||stage.step==='saving')&&stage.answer.counts.write>0&&<button type="button" className="btn primary" disabled={busy} onClick={()=>void save()} data-record-import-save>{stage.step==='saving'?<Loader2 size={17} className="spin"/>:<CheckCircle2 size={17}/>}{say('استيراد '+rowsAr(stage.answer.counts.write),`Import ${stage.answer.counts.write} ${stage.answer.counts.write===1?'row':'rows'}`)}</button>}
   </div>
  </div>
 </DialogContent></Dialog>;
}

'use client';
import {useEffect,useState} from 'react';
import {CloudUpload,Loader2,WifiOff,CheckCircle2,AlertCircle} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useLanguage,direction} from '@/lib/i18n';
import type {Member} from '@/lib/crm';
import {listOutbox,listOfflineArchive,archiveOfflineJob,subscribeOffline,type OfflineJob} from '@/lib/offline-store';
import {flushOutbox,retryOutbox} from '@/lib/offline-submit';
import './offline-status.css';

const messageOf=(e:unknown)=>typeof e==='object'&&e!==null&&'message' in e&&typeof e.message==='string'?e.message:'';
type JobFields={name?:string;summary?:string;result?:string;nextAction?:string;nextDate?:string;customerNeeds?:string;location?:string;competitorName?:string;competitorNotes?:string;competitorFileName?:string;competitorObservation?:JobFields};
type JobPayload={customerId?:string;data?:JobFields;registration?:JobFields};
/** Device-only entries stay visibly separate from confirmed server records. */
export default function OfflineStatus({me,offline}:{me:Member;offline:boolean}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const [jobs,setJobs]=useState<OfflineJob[]>([]),[archive,setArchive]=useState<OfflineJob[]>([]),[showArchive,setShowArchive]=useState(false),[archiveId,setArchiveId]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true;setJobs([]);setArchive([]);setArchiveId('');const read=()=>{void Promise.all([listOutbox(me),listOfflineArchive(me)]).then(([rows,archived])=>{if(alive){setJobs(rows);setArchive(archived);}}).catch(()=>{if(alive)setError(say('تعذر قراءة الإدخالات المحفوظة على الجهاز.','Could not read entries saved on this device.'));});};read();const unsub=subscribeOffline(read);return()=>{alive=false;unsub();};},[me.id,me.authVersion,me.role,me.regionScope,language]);
 const blocked=jobs.filter(job=>job.status==='blocked').length,syncing=busy||jobs.some(job=>job.status==='syncing');
 async function sync(id?:string){if(busy||offline)return;setBusy(true);setError('');try{if(id)await retryOutbox(id,me);else await flushOutbox(me);}catch(e){setError(messageOf(e)||say('تعذرت المزامنة؛ الإدخالات محفوظة.','Sync failed; your entries are still saved.'));}finally{setBusy(false);}}
 async function archiveEntry(job:OfflineJob){if(busy)return;setBusy(true);setError('');try{await archiveOfflineJob(job.id,me);setArchiveId('');}catch(e){setError(messageOf(e));}finally{setBusy(false);}}
 function details(job:OfflineJob){let payload:JobPayload={};try{payload=JSON.parse(job.body||'{}');}catch{}const data=payload.data||payload.registration||{},observation=data.competitorObservation||data;return [
  [say('العميل','Customer'),data.name||payload.customerId],
  [say('الهدف','Purpose'),data.summary],
  [say('النتيجة','Outcome'),data.result],
  [say('الإجراء القادم','Next action'),data.nextAction],
  [say('موعد المتابعة','Follow-up date'),data.nextDate],
  [say('المنافس','Competitor'),observation.competitorName],
  [say('ملاحظات المنافس','Competitor notes'),observation.competitorNotes],
  [say('الاحتياج','Customer needs'),data.customerNeeds],
  [say('الموقع','Location'),data.location],
  [say('المرفق','Attachment'),job.fileName||observation.competitorFileName],
 ].filter(([,value])=>typeof value==='string'&&value.trim());}
 return <>
  {(offline||jobs.length>0||archive.length>0||error)&&<div className={'offline-sync-strip'+(blocked?' has-errors':'')} role="status">
   {offline?<WifiOff size={18}/>:syncing?<Loader2 size={18} className="spin"/>:blocked?<AlertCircle size={18}/>:<CloudUpload size={18}/>}
   <span>{offline?say('بدون شبكة · التسجيل محفوظ على الجهاز','Offline · entries are saved on this device'):syncing?say('جارٍ رفع الإدخالات المحفوظة…','Syncing saved entries…'):blocked?say('إدخالات محفوظة تحتاج مراجعة','Saved entries need review'):!jobs.length&&archive.length?say('إدخالات مؤرشفة للمراجعة','Entries archived for review'):say('إدخالات بانتظار الرفع','Entries waiting to sync')}{jobs.length>0&&<b> · {jobs.length}</b>}</span>
   <button type="button" onClick={()=>setOpen(true)}>{say('حالة الحفظ','Save status')}</button>
  </div>}
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="crm-dialog offline-sync-dialog" dir={direction()}>
   <DialogTitle>{say('الإدخالات المحفوظة على الجهاز','Entries saved on this device')}</DialogTitle>
   <DialogDescription>{say('تُرفع تلقائيًا عند رجوع الإنترنت والتطبيق مفتوح، وتظل محفوظة هنا حتى يؤكد الخادم استلامها.','Entries sync automatically when internet returns and the app is open. They remain here until the server confirms receipt.')}</DialogDescription>
   {error&&<p className="form-error" role="alert">{error}</p>}
   {archive.length>0&&<button type="button" className="text-button" aria-pressed={showArchive} onClick={()=>setShowArchive(value=>!value)}>{say('الأرشيف المحلي','Local archive')} ({archive.length})</button>}
   {!jobs.length&&!showArchive?<p className="offline-sync-empty"><CheckCircle2 size={22}/>{say('لا توجد إدخالات بانتظار الرفع.','No entries waiting to sync.')}</p>:<ul className="offline-sync-list">{[...jobs,...(showArchive?archive:[])].map(job=><li key={job.id}>
    <div className="offline-sync-title"><strong>{job.label||say('إدخال محفوظ','Saved entry')}</strong><span>{job.archivedAt?say('مؤرشف على الجهاز','Archived on this device'):job.status==='blocked'?say('تحتاج مراجعة','Needs review'):job.status==='syncing'?say('جارٍ الرفع','Syncing'):say('بانتظار الرفع','Waiting to sync')}</span></div>
    <time dateTime={job.capturedAt}>{new Intl.DateTimeFormat(language==='en'?'en-GB':'ar-SA',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(job.capturedAt))}</time>
    {job.message&&<p className="offline-sync-error">{job.message}</p>}
    <details><summary>{say('عرض البيانات المحفوظة','View saved entries')}</summary><dl>{details(job).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
    {job.status==='blocked'&&!job.archivedAt&&<button type="button" className="btn subtle small" disabled={offline||busy} onClick={()=>void sync(job.id)}>{say('إعادة المحاولة','Retry')}</button>}
    {job.status==='blocked'&&!job.archivedAt&&(archiveId===job.id?<div className="offline-archive-confirm"><p>{say('يظل الإدخال محفوظًا في الأرشيف المحلي ولن يُرفع تلقائيًا. راجع سجل العميل ثم سجّل متابعة صحيحة عند الحاجة.','This entry stays in the local archive and will not upload automatically. Review the customer history before recording a new follow-up.')}</p><button type="button" className="btn subtle small" disabled={busy} onClick={()=>void archiveEntry(job)}>{say('تأكيد الأرشفة','Confirm archive')}</button><button type="button" className="btn subtle small" disabled={busy} onClick={()=>setArchiveId('')}>{say('إلغاء','Cancel')}</button></div>:<button type="button" className="text-button" disabled={busy} onClick={()=>setArchiveId(job.id)}>{say('أرشفة للمراجعة','Archive for review')}</button>)}
    {job.archivedAt&&<p className="muted">{say('نسخة محفوظة محليًا للمراجعة؛ لا تدخل في المزامنة الآلية.','A local review copy; excluded from automatic sync.')}</p>}
   </li>)}</ul>}
   <footer className="form-footer"><button type="button" className="btn subtle" onClick={()=>setOpen(false)}>{say('إغلاق','Close')}</button><button type="button" className="btn primary" disabled={offline||busy||!jobs.length} onClick={()=>void sync()}>{busy?<Loader2 size={17} className="spin"/>:<CloudUpload size={17}/>} {say('مزامنة الآن','Sync now')}</button></footer>
  </DialogContent></Dialog>
 </>;
}

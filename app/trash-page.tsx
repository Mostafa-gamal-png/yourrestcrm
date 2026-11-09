'use client';
// «المحذوفات» / «Deleted records» (2026-11-09, after GSCO's Trash() in components/crm/record-actions.tsx): the deletions the reader may
// restore (/api/trash, lib/trash-server.ts), newest first, 40 at a time with «تحميل المزيد», filtered by «نوع السجل»; each with «استرجاع»
// behind a confirmation. No permanent deletion here: the CRM's deletion already removes the record. The administrator and the sales manager
// (their own deletions) only (lib/access.ts trashScope).
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArchiveRestore,Loader2,RefreshCw,RotateCcw,TriangleAlert,Info} from 'lucide-react';
import {toast} from 'sonner';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {AlertDialog,AlertDialogContent,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {Empty,EmptyHeader,EmptyMedia,EmptyTitle,EmptyDescription} from '@/components/ui/empty';
import {submitJson,definiteSubmitRejection} from '@/lib/client-submit';
import {t,useLanguage,direction,getLanguage} from '@/lib/i18n';
import type {Member} from '@/lib/crm';
import {TRASH_TYPES,trashTypeNames,type TrashAnswer,type TrashItem,type TrashRestoreAnswer,type TrashType} from '@/lib/trash';
import './trash-page.css';

const messageOf=(error:unknown)=>error instanceof Error?error.message:'';
const stamp=(iso:string)=>{const date=new Date(iso);return Number.isNaN(date.getTime())?iso:date.toLocaleString('en-GB',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'});};

export default function TrashPage({me,onRestored}:{me:Member;onRestored?:()=>unknown}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const [type,setType]=useState<'all'|TrashType>('all');
 const [answer,setAnswer]=useState<{items:TrashItem[];next:string|null;scope:TrashAnswer['scope']}|null>(null);
 const [loadingMore,setLoadingMore]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState<TrashItem|null>(null),[restoring,setRestoring]=useState(false);
 const generation=useRef(0),attempt=useRef<{auditId:string;requestId:string}|null>(null);
 const load=useCallback(async(more?:string)=>{
  // No state is set before the answer: the first load runs from an effect.
  const current=++generation.current;
  try{
   const query=new URLSearchParams({type});if(more)query.set('before',more);
   const next=await submitJson<TrashAnswer>('/api/trash?'+query.toString(),{cache:'no-store'},{language:getLanguage()});
   if(current!==generation.current)return;
   setAnswer(previous=>more&&previous?{items:[...previous.items,...next.items.filter(item=>!previous.items.some(old=>old.id===item.id))],next:next.next,scope:next.scope}:next);setError('');
  }catch(failure){if(current===generation.current){if(more)toast.error(t(messageOf(failure)));else setError(messageOf(failure));}}
  finally{if(current===generation.current)setLoadingMore(false);}
 },[type]);
 // The page is keyed by the reader (app/crm-app.tsx); a new type clears the list where it is chosen.
 useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>window.clearTimeout(timer);},[load]);
 async function restore(item:TrashItem){
  if(restoring)return;setRestoring(true);
  // A retry of the same restoration (an answer lost on the way) carries the same request id and gets the first answer back.
  if(attempt.current?.auditId!==item.id)attempt.current={auditId:item.id,requestId:crypto.randomUUID()};
  try{
   const result=await submitJson<TrashRestoreAnswer>('/api/trash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(attempt.current)},{language:getLanguage()});
   attempt.current=null;setConfirm(null);
   toast.success(say('تم استرجاع السجل','Record restored'));
   for(const note of result.notes||[])toast.info(t(note),{duration:12000});
   await onRestored?.();await load();
  }catch(failure){
   if(definiteSubmitRejection(failure)){attempt.current=null;setConfirm(null);void load();}
   toast.error(t(messageOf(failure)));
  }finally{setRestoring(false);}
 }
 const typeName=(value:TrashType)=>say(...trashTypeNames[value]);
 const heading=(item:TrashItem)=>item.type==='visit'&&item.number?say('زيارة رقم ','Visit no. ')+item.number:item.title||say('بدون عنوان','Untitled');
 const items=answer?.items;
 return <section className="trash-page" dir={direction()}>
  <div className="trash-toolbar">
   <p className="trash-intro"><ArchiveRestore size={18} aria-hidden="true"/><span>{answer?.scope==='own'||me.role!=='admin'?say('السجلات اللي انت حذفتها. «استرجاع» يرجّع السجل بتاريخه وزياراته وملفاته.','Records you deleted. «Restore» brings a record back with its history, visits and files.'):say('كل السجلات المحذوفة. «استرجاع» يرجّع السجل بتاريخه وزياراته وملفاته.','All deleted records. «Restore» brings a record back with its history, visits and files.')}</span></p>
   <label className="trash-filter"><span>{say('نوع السجل','Record type')}</span>
    <Select dir={direction()} value={type} onValueChange={value=>{setAnswer(null);setType(value as 'all'|TrashType);}}>
     <SelectTrigger className="pick" aria-label={say('نوع السجل','Record type')}><SelectValue/></SelectTrigger>
     <SelectContent><SelectItem value="all">{say('كل الأقسام','All sections')}</SelectItem>{TRASH_TYPES.map(value=><SelectItem key={value} value={value}>{typeName(value)}</SelectItem>)}</SelectContent>
    </Select>
   </label>
  </div>
  {error?<div className="error-banner trash-error" role="alert"><strong>{t(error)}</strong><button type="button" className="btn subtle" onClick={()=>{setError('');setAnswer(null);void load();}}><RefreshCw size={16} aria-hidden="true"/>{say('إعادة المحاولة','Retry')}</button></div>
   :!items?<p className="trash-loading" role="status"><Loader2 className="spin" size={18} aria-hidden="true"/>{say('جاري التحميل…','Loading…')}</p>
   :!items.length?<Empty className="empty trash-empty"><EmptyHeader><EmptyMedia className="empty-icon"><ArchiveRestore size={27}/></EmptyMedia><EmptyTitle>{say('لا توجد محذوفات','No deleted records')}</EmptyTitle><EmptyDescription>{type==='all'?say('أي سجل يتحذف يظهر هنا ويمكن استرجاعه.','Any record that is deleted appears here and can be restored.'):say('لا توجد محذوفات من هذا النوع.','No deleted records of this type.')}</EmptyDescription></EmptyHeader></Empty>
   :<ul className="trash-list">{items.map(item=><li key={item.id} className="trash-card" data-type={item.type} data-record={item.recordId}>
     <div className="trash-card-top"><span className="badge trash-type">{typeName(item.type)}</span>{item.number&&item.type!=='visit'&&<bdi className="trash-number" dir="ltr">{item.number}</bdi>}</div>
     <h3><bdi>{heading(item)}</bdi></h3>
     {item.customerName&&item.type!=='customer'&&<p className="trash-customer">{say('العميل: ','Customer: ')}<bdi>{item.customerName}</bdi></p>}
     <p className="trash-meta">{say('حذفه: ','Deleted by: ')}<bdi>{item.deletedBy||'—'}</bdi> · <bdi dir="ltr">{stamp(item.deletedAt)}</bdi></p>
     {item.note&&<p className="trash-note"><Info size={15} aria-hidden="true"/><span>{t(item.note)}</span></p>}
     {item.blocked&&<p className="trash-blocked" role="note"><TriangleAlert size={15} aria-hidden="true"/><span>{t(item.blocked)}</span></p>}
     <button type="button" className="btn subtle trash-restore" disabled={!!item.blocked||restoring} aria-label={say('استرجاع ','Restore ')+heading(item)} onClick={()=>setConfirm(item)}><RotateCcw size={16} aria-hidden="true"/>{say('استرجاع','Restore')}</button>
    </li>)}</ul>}
  {!!items?.length&&answer?.next&&<button type="button" className="btn subtle trash-more" disabled={loadingMore} onClick={()=>{setLoadingMore(true);void load(answer.next!);}}>{loadingMore&&<Loader2 className="spin" size={16} aria-hidden="true"/>}{say('تحميل المزيد','Load more')}</button>}
  <AlertDialog open={!!confirm} onOpenChange={open=>{if(!open&&!restoring)setConfirm(null);}}>
   <AlertDialogContent dir={direction()}>
    <AlertDialogTitle>{say('استرجاع السجل','Restore record')}</AlertDialogTitle>
    <AlertDialogDescription>{confirm&&<><bdi>{heading(confirm)}</bdi> · {typeName(confirm.type)}<br/></>}{say('سيعود السجل إلى القوائم مع تاريخه ومرفقاته.','The record will return to the lists with its history and attachments.')}</AlertDialogDescription>
    <AlertDialogFooter><AlertDialogCancel disabled={restoring}>{say('إلغاء','Cancel')}</AlertDialogCancel><AlertDialogAction disabled={restoring} onClick={event=>{event.preventDefault();if(confirm)void restore(confirm);}}>{restoring&&<Loader2 className="spin" size={16} aria-hidden="true"/>}{say('استرجاع','Restore')}</AlertDialogAction></AlertDialogFooter>
   </AlertDialogContent>
  </AlertDialog>
 </section>;
}

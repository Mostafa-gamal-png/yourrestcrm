'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Loader2,CheckCircle2} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {t,useLanguage,direction} from '@/lib/i18n';
import {type Row,type Member,today,stageLabels} from '@/lib/crm';
import {visitCustomer} from '@/lib/customer-visits';
import {latestCustomerContact,customerHasQuotation,followupTypes,invoiceOutcomes,followupLossReasons,followupClosed,canExecuteCustomerFollowup} from '@/lib/customer-followups';
import VoiceField from './voice-field';
import CompetitorFields,{emptyCompetitorInput,type CompetitorInput} from './competitor-fields';
import type {UploadState} from './upload-status';
import {useAutomaticJourney,JourneyFormNotice} from './journey-tracker';
import {isServiceRole} from '@/lib/customer-service';
import {FollowupDateField} from './visit-fields';
import {FollowupPlace,useFollowupPlace} from './followup-place';
import {SubmitError,definiteSubmitRejection} from '@/lib/client-submit';
import {offlineSubmit,uploadOfflineVisitFile} from '@/lib/offline-submit';
import './visit-mobile.css';
import {escapeBelongsToOpenPopup} from '@/lib/dialog-escape';

function Pick({value,onChange,options,label}:{value:string;onChange:(value:string)=>void;options:Record<string,string>;label:string}){return <Select dir={direction()} value={value||undefined} onValueChange={onChange}><SelectTrigger className="pick" aria-label={t(label)}><SelectValue placeholder={t(label)}/></SelectTrigger><SelectContent>{Object.entries(options).map(([id,text])=><SelectItem key={id} value={id}>{t(text)}</SelectItem>)}</SelectContent></Select>;}
export {CustomerFollowupsPage} from './customer-followup-list';
type Props={initial?:Row;customerId?:string;records:Row[];me:Member;onClose:()=>void;onSaved:(queued?:boolean)=>Promise<void>};
const messageOf=(e:unknown)=>typeof e==='object'&&e!==null&&'message' in e&&typeof e.message==='string'?e.message:'';
type FollowupData={[field:string]:unknown;type:string;date:string;result:string;salesStage:string;invoiceOutcome:string;nextAction:string;nextDate:string;lossReason:string;lossDetails:string;competitorObservation:CompetitorInput|null;hasQuotation?:boolean;hasCompetitor?:boolean};
export function CustomerFollowupDialog({initial,customerId:seed,records,me,onClose,onSaved}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const currentSource=(id:string)=>{const source=latestCustomerContact(id,records),intake=records.find(r=>r.id===id)?.data._serviceIntake;return intake?.createdAt&&source&&source.createdAt<intake.createdAt?undefined:source;};
 const seedCustomer=initial?visitCustomer(initial,records)?.id:seed,seedSource=seedCustomer?currentSource(seedCustomer):undefined;
 const [customerId]=useState(seedCustomer||''),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState('');
 const defaults=(source?:Row,id=seedCustomer)=>({type:'visit',date:today(),result:'',salesStage:source?.data.salesStage||source?.data.stage||'',invoiceOutcome:source?.data.invoiceOutcome||'pending',nextAction:source?.data.nextAction||records.find(r=>r.id===id)?.data._serviceIntake?.nextAction||'',nextDate:today(),lossReason:'',lossDetails:'',competitorObservation:null});
 const [source]=useState(seedSource);
 const [data,setData]=useState<FollowupData>(initial?initial.data:defaults(seedSource)),[retryPending,setRetryPending]=useState(false);const lock=useRef(false),attempt=useRef<string|null>(null),savedReceipt=useRef(false),uploadLock=useRef(false),uploadVersion=useRef(0);
 const [uploadState,setUploadState]=useState<UploadState|null>(null),uploadAttempt=useRef<{file:File;context:string;key:string}|null>(null);
 const observation:CompetitorInput=data.competitorObservation||emptyCompetitorInput(),competitorContext=useRef('');competitorContext.current=me.id+'\n'+customerId+'\n'+observation.competitorName;
 useEffect(()=>()=>{uploadVersion.current++;},[]);
 const customer=records.find(r=>r.id===customerId),closed=followupClosed(data.salesStage);
 // Read from the records once per snapshot, not on every letter typed into the form.
 const quoted=useMemo(()=>!!customer&&customerHasQuotation(customer.id,records),[customer,records]),hasQuotation=!!customer&&(quoted||data.type==='quote'||data.salesStage==='quoted');
 const journeyStopId=useAutomaticJourney({customerId,type:data.type,date:data.date,enabled:!initial&&canExecuteCustomerFollowup(source)&&!isServiceRole(me.role)});
 // A follow-up that is a visit is recorded where the customer is, like any visit; the other kinds have no place.
 const place=useFollowupPlace({enabled:!initial&&!isServiceRole(me.role),customer,type:data.type,role:me.role});
 const [dirty,setDirty]=useState(false),[confirmLeave,setConfirmLeave]=useState(false),[salesOpen,setSalesOpen]=useState(!!seedSource&&followupClosed(seedSource.data.salesStage));
 const titleRef=useRef<HTMLHeadingElement>(null),errorRef=useRef<HTMLDivElement>(null),keepRef=useRef<HTMLButtonElement>(null),invalidFrame=useRef<number|null>(null);
 useEffect(()=>{if(hasQuotation)setSalesOpen(true);},[hasQuotation]);
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 useEffect(()=>{if(confirmLeave)keepRef.current?.focus();},[confirmLeave]);
 useEffect(()=>{if(!dirty)return;const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[dirty]);
 useEffect(()=>()=>{if(invalidFrame.current!==null)cancelAnimationFrame(invalidFrame.current);},[]);
 const change=(key:string,value:string)=>{if(savedReceipt.current||retryPending||lock.current||uploadLock.current)return;setDirty(true);setData(d=>({...d,[key]:value}));};
 function requestClose(){if(busy||uploading||uploadLock.current)return;if((dirty||retryPending)&&!savedReceipt.current)setConfirmLeave(true);else onClose();}
 function revealInvalid(event:React.FormEvent<HTMLFormElement>){const target=event.target as HTMLElement;for(let element:HTMLElement|null=target;element;element=element.parentElement){if(element instanceof HTMLDetailsElement){element.open=true;if(element.classList.contains('visit-sales-details'))setSalesOpen(true);}}if(invalidFrame.current!==null)return;invalidFrame.current=requestAnimationFrame(()=>{invalidFrame.current=null;target.focus();target.scrollIntoView({block:'center',behavior:'smooth'});});}

 function stageChanged(stage:string){if(savedReceipt.current||retryPending||lock.current||uploadLock.current)return;setDirty(true);setData(d=>({...d,salesStage:stage,invoiceOutcome:followupClosed(stage)?d.invoiceOutcome:'pending'}));}
 function changeCompetitor(patch:Partial<CompetitorInput>){if(initial||savedReceipt.current||retryPending||lock.current||uploadLock.current)return;setDirty(true);setData(previous=>({...previous,competitorObservation:{...(previous.competitorObservation||emptyCompetitorInput()),...patch}}));}
 async function uploadCompetitor(file:File,retry=false){
  if(initial||savedReceipt.current||retryPending||lock.current||uploadLock.current)return;
  if(!customerId){setError(say('اختر العميل قبل رفع الملف.','Choose the customer before uploading.'));return;}
  if(!file.size||file.size>10*1024*1024){setError(say('اختر ملفًا حتى 10 ميجابايت.','Choose a file up to 10 MB.'));return;}
  const context=competitorContext.current;if(retry&&uploadAttempt.current?.context!==context)return;
  if(!retry)uploadAttempt.current={file,context,key:crypto.randomUUID()};const currentAttempt=uploadAttempt.current;if(!currentAttempt)return;
  uploadLock.current=true;const version=++uploadVersion.current;setUploading(true);setUploadState({phase:'reading'});setError('');
  const onUploadProgress=(progress:import('@/lib/client-submit').UploadProgress)=>{if(uploadVersion.current===version&&competitorContext.current===context)setUploadState(progress);};
  try{const result=await uploadOfflineVisitFile(file,{me,customerId,language,uploadKey:currentAttempt.key,onUploadProgress});if(typeof result.id!=='string'||!result.id||typeof result.name!=='string')throw new Error(say('لم يؤكد الجهاز حفظ الملف. أعد المحاولة.','The device did not confirm saving the file. Retry.'));if(uploadVersion.current===version&&competitorContext.current===context&&!savedReceipt.current&&!retryPending&&!lock.current){setUploadState({phase:result.queued?'queued':'complete'});uploadAttempt.current=null;setDirty(true);setData(previous=>({...previous,competitorObservation:{...(previous.competitorObservation||emptyCompetitorInput()),competitorFileId:result.id,competitorFileName:result.name}}));}}
  catch(error){if(uploadVersion.current===version){setUploadState({phase:'error'});setError(messageOf(error)||say('تعذر رفع الملف.','Could not upload the file.'));}}
  finally{uploadLock.current=false;if(uploadVersion.current===version)setUploading(false);}
 }
 async function save(e:React.FormEvent){
  e.preventDefault();if(lock.current||initial||uploadLock.current)return;
  if(!savedReceipt.current&&!retryPending&&!customer){setError(say('العميل غير متاح. أعد فتح المتابعة من قائمته.','The customer is unavailable. Reopen the follow-up from the list.'));return;}
  if(!savedReceipt.current&&!retryPending&&!canExecuteCustomerFollowup(source)){setError('افتح الزيارة السابقة وحدد الإجراء القادم وموعد المتابعة أولًا.');return;}
  if(!savedReceipt.current&&!retryPending&&place.wants&&(!place.fix||place.view.blocked)){setError(place.view.message||place.error||say('انتظر تحديد موقع الجهاز أو اضغط تحديث موقع الجهاز.','Wait for the device location, or tap Refresh device location.'));return;}
  lock.current=true;setBusy(true);setError('');
  try{
   if(!savedReceipt.current){
    if(!attempt.current){const stopId=journeyStopId();attempt.current=JSON.stringify({customerId,customerVersion:customer?.version,sourceId:source?.id,sourceVersion:source?.version,data:{...data,...(place.wants&&place.fix?place.fix:{}),...(stopId?{journeyStopId:stopId}:{})},createKey:crypto.randomUUID()});}
    const result=await offlineSubmit('/api/customer-followups',attempt.current,{me,language,label:customer?.data.name||say('متابعة','Follow-up'),kind:'followup'});
    if(result.ok!==true||typeof result.id!=='string'||!result.id)throw new SubmitError(say('الخادم لم يؤكد حفظ المتابعة. أعد المحاولة بنفس البيانات.','The server did not confirm the follow-up. Retry with the same entries.'),200,result);
    savedReceipt.current=true;setRetryPending(false);setDirty(false);
    if(result.queued){void onSaved(true).catch(()=>{});onClose();return;}
   }
   await onSaved(false);onClose();
  }catch(e){
   if(!savedReceipt.current){if(definiteSubmitRejection(e)){attempt.current=null;setRetryPending(false);}else setRetryPending(true);}
   setError(savedReceipt.current?say('تم حفظ المتابعة؛ تعذر تحديث الشاشة. اضغط تحديث السجل لعرضها.','The follow-up was saved, but the screen could not refresh. Tap Refresh history to view it.'):messageOf(e)||t('تعذر حفظ المتابعة'));
  }finally{lock.current=false;setBusy(false);}
 }
 return <Dialog open onOpenChange={open=>{if(!open)requestClose();}}><DialogContent className="crm-dialog followup-record-dialog mobile-record-dialog" dir={direction()} showCloseButton={!busy&&!uploading} onOpenAutoFocus={event=>{event.preventDefault();titleRef.current?.focus();}} onEscapeKeyDown={event=>{if(busy||uploading||escapeBelongsToOpenPopup(event))event.preventDefault();}} onInteractOutside={event=>{if(busy||uploading)event.preventDefault();}}>
  <header className="visit-dialog-heading"><DialogTitle ref={titleRef} tabIndex={-1}>{t(initial?'تفاصيل المتابعة':'تنفيذ المتابعة')}</DialogTitle><DialogDescription className="sr-only">{t('نتيجة التواصل والخطوة القادمة للعميل')}</DialogDescription></header>
  {initial?<><div className="visit-form-scroll"><div className="followup-customer-strip">{customer?.data.name}</div><dl className="followup-detail-grid">{[['نوع المتابعة',t(followupTypes[data.type])],['تاريخ المتابعة المنفذة',data.date],['ما نتيجة المتابعة؟',data.result],['مرحلة البيع بعد المتابعة',t(stageLabels[data.salesStage])],...(data.hasQuotation?[['هل تحوّل عرض السعر إلى فاتورة؟',t(invoiceOutcomes[data.invoiceOutcome])]]:[]),['الإجراء القادم',data.nextAction||'—'],['موعد المتابعة القادمة',data.nextDate||'—'],...(data.lossReason?[['سبب الفقد',t(data.lossReason)],['تفاصيل سبب الفقد',data.lossDetails||'—']]:[])].map(([label,value])=><div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl>{data.hasCompetitor&&<CompetitorFields value={{...emptyCompetitorInput(),...data}} records={records} customerId={customerId} identityKey={me.id} readOnly onChange={()=>{}}/>}</div><footer className="visit-save-bar"><div className="form-footer"><button type="button" className="btn subtle" onClick={onClose}>{t('إغلاق')}</button></div></footer></>:<form onSubmit={save} onInvalidCapture={revealInvalid} className="visit-entry-form">
   <fieldset disabled={busy||uploading||savedReceipt.current||retryPending} className="visit-form-scroll min-w-0">
    <div className="followup-customer-strip">{customer?.data.name}</div>
    {!customer&&<p className="form-error" role="alert">{say('العميل غير متاح. أغلق النافذة وحدّث قائمة المتابعات.','The customer is unavailable. Close this form and refresh the follow-up list.')}</p>}
    {customer&&!canExecuteCustomerFollowup(source)&&<p className="form-error" role="alert">{say('المتابعة تحتاج زيارة سابقة مفتوحة فيها إجراء قادم وموعد متابعة. ارجع للزيارة السابقة أو سجّل زيارة جديدة.','A follow-up needs an open previous contact with a next action and date. Open that contact or record a new visit.')}</p>}
    {source&&<details className="visit-context-details followup-source-summary"><summary>{say('الزيارة السابقة المرتبطة بالمتابعة','Previous contact linked to this follow-up')} <bdi>{source.data.date}</bdi></summary><div className="visit-context-body"><p>{source.data.result||'—'}</p>{source.data.nextAction&&<p><strong>{t('الإجراء القادم')}: </strong>{source.data.nextAction}</p>}</div></details>}
    {!isServiceRole(me.role)&&data.type==='visit'&&data.date===today()&&<JourneyFormNotice/>}
    <section className="visit-form-section"><h3>{say('التواصل والنتيجة','Contact & outcome')}</h3><div className="form-grid">
     <label className="field full"><span>{t('نوع المتابعة')}</span><Pick label="نوع المتابعة" value={data.type} onChange={value=>change('type',value)} options={followupTypes}/></label>
     <FollowupPlace place={place} busy={busy||uploading||retryPending}/>
     <VoiceField label="ما نتيجة المتابعة؟" value={data.result} onChange={value=>change('result',value)} required multiline/>
    </div></section>
    {!closed&&<section className="visit-form-section"><h3>{say('الخطوة الجاية','Next step')}</h3><div className="form-grid"><VoiceField label="الإجراء القادم" value={data.nextAction} onChange={value=>change('nextAction',value)} required/><FollowupDateField value={data.nextDate} min={data.date} onChange={value=>change('nextDate',value)}/></div></section>}
    <section className="visit-form-section"><CompetitorFields value={observation} records={records} customerId={customerId} identityKey={me.id} disabled={busy||uploading||savedReceipt.current||retryPending} uploading={uploading} uploadState={uploadAttempt.current?.context===competitorContext.current||observation.competitorFileId?uploadState:null} onUploadRetry={()=>{const retry=uploadAttempt.current;if(retry)void uploadCompetitor(retry.file,true);}} toggleLabel={say('تسجيل منافس في هذه المتابعة','Record a competitor in this follow-up')} onChange={changeCompetitor} onUpload={uploadCompetitor}/></section>
    <details className="visit-sales-details" open={salesOpen} onToggle={event=>setSalesOpen(event.currentTarget.open)}><summary><span>{say('مرحلة البيع وتفاصيل إضافية','Sales stage & more')}</span><span className="badge">{t(stageLabels[data.salesStage])||say('اختياري','Optional')}</span></summary><div className="form-grid visit-extended-fields">
     {hasQuotation&&<label className="field"><span>{t('هل تحوّل عرض السعر إلى فاتورة؟')}</span><Pick label="هل تحوّل عرض السعر إلى فاتورة؟" value={data.invoiceOutcome} onChange={value=>{if(savedReceipt.current||retryPending||lock.current)return;setDirty(true);setData(previous=>({...previous,invoiceOutcome:value,salesStage:value==='invoiced'?'won':value==='lost'?'lost':followupClosed(previous.salesStage)?'quoted':previous.salesStage}));}} options={invoiceOutcomes}/></label>}
     <label className="field"><span>{t('مرحلة البيع بعد المتابعة')}</span><Pick label="مرحلة البيع بعد المتابعة" value={data.salesStage} onChange={stageChanged} options={hasQuotation?Object.fromEntries(Object.entries(stageLabels).filter(([id])=>!followupClosed(id)||id===data.salesStage)):stageLabels}/></label>
     {data.salesStage==='lost'&&<><label className="field"><span>{t('سبب الفقد')} <b>*</b></span><Pick label="اختر سبب الفقد" value={data.lossReason} onChange={value=>change('lossReason',value)} options={Object.fromEntries(followupLossReasons.map(reason=>[reason,reason]))}/></label><VoiceField label="تفاصيل سبب الفقد" value={data.lossDetails} onChange={value=>change('lossDetails',value)} required={data.lossReason==='أخرى'} multiline/></>}
     <label className="field"><span>{t('تاريخ المتابعة المنفذة')} <b>*</b></span><input type="date" required max={today()} value={data.date} onChange={event=>change('date',event.target.value)}/></label>
     {hasQuotation&&data.invoiceOutcome==='invoiced'&&<p className="form-note full">{me.role==='rep'?say('اطلب من المشرف تسجيل الفاتورة لاحتساب المبيعات.','Ask your supervisor to record the invoice to count the sale.'):say('سجّل الفاتورة في المبيعات لاحتسابها في الأداء.','Record the invoice in Sales to include it in performance.')}</p>}
    </div></details>
   </fieldset>
   <footer className="visit-save-bar">{error&&<div ref={errorRef} tabIndex={-1} className="form-error" role="alert">{t(error)}</div>}{retryPending&&<p className="visit-save-hint" role="status">{say('حالة الحفظ غير مؤكدة. البيانات مقفولة مؤقتًا؛ اضغط «تأكيد الحفظ» لإعادة نفس الطلب بدون متابعة مكررة.','The save is unconfirmed. Entries are temporarily locked; tap Confirm save to retry the identical request without creating a duplicate follow-up.')}</p>}{confirmLeave?<div className="visit-discard-prompt" role="alert"><p>{retryPending?say('الحفظ غير مؤكد. لو خرجت راجع سجل العميل قبل تسجيل متابعة أخرى.','The save is unconfirmed. If you leave, check the customer history before recording another follow-up.'):say('فيه بيانات لسه ما اتحفظتش. تخرج من غير حفظ؟','You have unsaved changes. Leave without saving?')}</p><div><button ref={keepRef} type="button" className="btn primary" onClick={()=>setConfirmLeave(false)}>{say('أكمل التسجيل','Keep editing')}</button><button type="button" className="btn subtle danger" onClick={onClose}>{retryPending?say('إغلاق ومراجعة السجل','Close and check history'):say('خروج بدون حفظ','Discard changes')}</button></div></div>:<div className="form-footer"><button type="button" className="btn subtle" disabled={busy||uploading} onClick={requestClose}>{t(savedReceipt.current?'إغلاق':'إلغاء')}</button><button type="submit" className="btn primary" aria-busy={busy} disabled={busy||uploading||!retryPending&&!savedReceipt.current&&(!customer||!canExecuteCustomerFollowup(source)||place.wants&&(place.locating||!place.fix||place.view.blocked))}>{busy?<Loader2 size={18} className="spin"/>:<CheckCircle2 size={18}/>} {savedReceipt.current?say('تحديث السجل','Refresh history'):retryPending?say('تأكيد الحفظ','Confirm save'):t('حفظ المتابعة')}</button></div>}</footer>
  </form>}
 </DialogContent></Dialog>;
}

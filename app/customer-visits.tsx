'use client';
import {t,useLanguage,direction} from "@/lib/i18n";
import React, { useState, useRef, useEffect } from 'react';
import { History, MapPin, Plus, Loader2, CheckCircle2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { type Row, type Member, isSalesRequest, money, today, stageLabels } from '@/lib/crm';
import { visitCustomer, visitRequest, customerVisits, strengthLabels, visitProducts } from '@/lib/customer-visits';
import { mapsLink } from '@/lib/customer-location';
import { contactTypes, visitPurposes, visitResult, formatVisitTime} from '@/lib/visits';
import {isServiceRole,serviceStatusLabels} from '@/lib/customer-service';
import {filterVisitRows} from '@/lib/visit-list';
import LanguageSwitch from './language-switch';
import VisitFields, {FollowupDateField,type VisitLocationState,type VisitData,type VisitValue} from './visit-fields';
import {submitJson,SubmitError,definiteSubmitRejection} from '@/lib/client-submit';
import {offlineSubmit,uploadOfflineVisitFile} from '@/lib/offline-submit';
import VoiceField from './voice-field';
import CompetitorFields,{type CompetitorInput} from './competitor-fields';
import type {UploadState} from './upload-status';
import VisitCustomerPicker from './visit-customer-picker';
import VisitsTable from './visits-table';
import {SupportButton,type SupportBinding} from './support-panel';
import {useAutomaticJourney,JourneyFormNotice} from './journey-tracker';
import './visit-mobile.css';
import {escapeBelongsToOpenPopup} from '@/lib/dialog-escape';
const messageOf = (e: unknown) => typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' ? e.message : '';
type VisitForm = VisitData & CompetitorInput & { type: string; requestedProducts: string[]; salesStage: string; strength: string; customerNeeds: string; nextAction: string; nextDate: string; responsibleId: string };
function Pick({ value, onChange, options, label, disabled = false }: {
    value: string;
    onChange: (v: string) => void;
    options: [
        string,
        string
    ][];
    label: string;
    disabled?: boolean;
}) { useLanguage(); return <Select dir={direction()} value={value || undefined} onValueChange={onChange} disabled={disabled}><SelectTrigger className="pick" aria-label={t(label)}><SelectValue placeholder={t(label)}/></SelectTrigger><SelectContent>{t(options.map(([id, text]) => <SelectItem key={id} value={id}>{t(text)}</SelectItem>))}</SelectContent></Select>; }
export function CustomerVisitHistory({ customer, records, onVisit, onNew, onQuote, canEdit = true, onDelete, support }: {
    customer: Row;
    support?: SupportBinding;
    records: Row[];
    onVisit: (r: Row) => void;
    onNew?: (request?: Row) => void;
    onQuote?: (id: string) => void;
    canEdit?: boolean;
    onDelete?: (row:Row)=>void;
}) {
    useLanguage();
    const visits = customerVisits(customer.id, records), requests = records.filter(r => isSalesRequest(r) && visitCustomer(r, records)?.id === customer.id);
    const [order, setOrder] = useState('newest');
    const orderedVisits = order === 'newest' ? visits : [...visits].reverse();
    return <section className="customer-visit-history">
        <div className="history-title"><h3><History size={18}/>{t("سجل الزيارات")}</h3><span className="count-badge">{visits.length} {t("زيارة / اتصال")}</span><SupportButton customerId={customer.id} support={support}/></div>
        <div className="visit-history-toolbar"><label><span>{t("ترتيب الزيارات")}</span><select value={order} onChange={e => setOrder(e.target.value)}><option value="newest">{t("الأحدث أولًا")}</option><option value="oldest">{t("الأقدم أولًا")}</option></select></label></div>
        {!visits.length && <p className="muted">{t("لا توجد زيارات سابقة لهذا العميل.")}</p>}
        <ol className="visit-history-timeline">{orderedVisits.map(v => {
            const hasTime = !!v.data.startedAt && Number.isFinite(Date.parse(v.data.startedAt));
            const date = hasTime ? formatVisitTime(v.data.startedAt) : v.data.date || (Number.isFinite(Date.parse(v.createdAt)) ? new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Riyadh'}).format(new Date(v.createdAt)) : '—');
            return <li key={v.id}><article className="visit-history-entry">
                <header><strong>{v.data.visitWorkflow==='followup-v1'&&<span className="badge">{t('متابعة')}</span>} {t(contactTypes[v.data.type]) || t('زيارة')} {v.data.visitNumber ? <bdi>#{v.data.visitNumber}</bdi> : ''}</strong><div className="visit-history-date"><span dir="ltr">{date}</span>{!hasTime && <small>{t("الوقت غير مسجل")}</small>}</div></header>
                <dl className="visit-history-facts">
                    <div><dt>{t("الهدف من الزيارة")}</dt><dd>{visitPurposes.includes(v.data.summary) ? t(v.data.summary) : v.data.summary || '—'}</dd></div>
                    <div><dt>{t("نتيجة الزيارة")}</dt><dd>{t(visitResult(v.data)) || t('لم تسجل نتيجة')}</dd></div>
                    <div><dt>{t("مرحلة البيع")}</dt><dd>{t(stageLabels[v.data.salesStage]) || t('مرحلة البيع غير مسجلة')}</dd></div>
                    <div><dt>{t("موعد المتابعة")}</dt><dd>{v.data.nextDate || '—'}</dd></div>
                    <div className="full"><dt>{t("الإجراء القادم")}</dt><dd>{v.data.nextAction || '—'}</dd></div>
                    {v.data.customerNeeds && <div className="full"><dt>{t("احتياج العميل")}</dt><dd>{v.data.customerNeeds}</dd></div>}
                </dl>
                {v.data.requestSnapshot?.lossReason && <p>{t('سبب فقد الطلب')}: {v.data.requestSnapshot.lossReason}</p>}
                {v.data.recordedByEmail && <small className="visit-history-recorder"><bdi>{v.data.recordedByEmail}</bdi></small>}
                <button type="button" className="text-button" onClick={() => onVisit(v)}>{t(!canEdit||v.data._readOnly?'عرض التفاصيل':v.data.visitWorkflow==='followup-v1'?'تفاصيل المتابعة':'عرض / تعديل الزيارة')}</button>
                {onDelete&&v.data.visitWorkflow!=='service-intake-v1'&&!v.data._offlineState&&!v.data._offlineAcknowledged&&<button type="button" className="btn subtle small danger" onClick={()=>onDelete(v)}>{t("حذف السجل")}</button>}
            </article></li>;
        })}</ol>{requests.length > 0 && <details className="previous-requests"><summary>{t("طلبات القوالب وعروض الأسعار (")}{t(requests.length)})</summary>{t(requests.map(r => { const linked = visits.filter(v => visitRequest(v, records)?.id === r.id), quotes = records.filter(q => q.kind === 'quote' && q.parentId === r.id); return <article key={r.id}><strong>{r.data.moldType} · {t(stageLabels[r.data.stage])} · {r.data.value == null ? t('غير مسعّر') : t(money(r.data.value)) + t(' ر.س')}</strong><small>{linked.length ? t(`${linked.length} زيارة مرتبطة`) : t('طلب قالب سابق — لا توجد زيارة مسجلة')}{r.data.lossReason ? t(' · ') + r.data.lossReason : t('')}</small>{onNew && <button type="button" className="text-button" onClick={() => onNew(r)}>{t("تسجيل زيارة لهذا الطلب")}</button>}{t(quotes.map(q => <button type="button" className="text-button" key={q.id} onClick={() => onQuote?.(q.id)}>{q.data.number} · {t(money(q.data.total))}{t(" ر.س")}</button>))}</article>; }))}</details>}</section>;
}
export function VisitsPage({ records, members, query, staff, stage, onOpen, onNew, onCustomer, onWorkflow, workflow, onWorkflowFilter, canEdit = true, onDelete, support }: {
    support?: SupportBinding;
    records: Row[];
    members: Member[];
    query: string;
    staff: string;
    stage: string;
    workflow: string;
    onWorkflowFilter: (value:string)=>void;
    onWorkflow: (id:string) => void;
    onOpen: (r: Row) => void;
    onNew: () => void;
    onCustomer: (id: string) => void;
    canEdit?: boolean;
    onDelete?: (row:Row)=>void;
}) {
    useLanguage();
    const [page, setPage] = useState(1);
    const rows = filterVisitRows(records,{query,staff,stage,workflow});
    const pages = Math.max(1, Math.ceil(rows.length / 30)), current = Math.min(page, pages);
    return <section className="panel">{records.some(r=>r.data.serviceIntakeId)&&<div className="panel-heading followup-list-heading"><div className="followup-list-filters" role="group" aria-label={t('حالة الاعتماد والتكليف')}>{[['all','كل الزيارات'],['mine','بانتظار إجرائي'],...Object.entries(serviceStatusLabels),['assistance','طلبات المساعدة']].map(([id,label])=><button key={id} className={'followup-list-filter '+(workflow===id?'selected':'')} aria-pressed={workflow===id} onClick={()=>{onWorkflowFilter(id);setPage(1);}}>{t(label)}</button>)}</div></div>}<div className="panel-heading"><h2>{t("سجل الزيارات ")}<span className="inline-count">{t(rows.length)}</span></h2><span className="muted">{t("كل زيارة مرتبطة بالعميل وسجله السابق")}</span></div>{rows.length ? <><VisitsTable onDelete={onDelete} rows={rows.slice((current - 1) * 30, current * 30)} customerFor={r => visitCustomer(r, records)} onOpen={id => { const r = records.find(r => r.id === id); if (r)
        onOpen(r); }} onEdit={onOpen} onCustomer={onCustomer} canEdit={canEdit} expanded members={members} onWorkflow={onWorkflow} support={support}/><div className="table-paging"><button className="btn subtle small" disabled={current === 1} onClick={() => setPage(current - 1)}>{t("السابق")}</button><span>{t(current)} / {t(pages)}</span><button className="btn subtle small" disabled={current === pages} onClick={() => setPage(current + 1)}>{t("التالي")}</button></div></> : <div className="followup-empty"><History size={30}/><h3>{query ? t('لا توجد نتائج مطابقة') : t('لا توجد زيارات مسجلة')}</h3><button className="btn primary" onClick={onNew}><Plus size={18}/>{t("زيارة جديدة")}</button></div>}</section>;
}
type Props = {
    initial?: Row;
    competitorName?: string;
    showCompetitor?: boolean;
    customerId?: string;
    requestId?: string;
    records: Row[];
    members: Member[];
    me: Member;
    onClose: () => void;
    onSaved: (queued?: boolean) => Promise<void>;
    onCustomerCreated: (id: string) => Promise<Row>;
    onOpenVisit: (r: Row) => void;
    onNewVisit: (customerId: string, request?: Row) => void;
    onOpenCustomer: (id: string) => void;
    onOpenQuote: (id: string) => void;
    onDelete: (r: Row) => void;
    onWorkflow: (id:string) => void;
};
export function CustomerVisitDialog({ initial, competitorName: seedCompetitorName = '', showCompetitor = false, customerId: seedCustomerId, requestId: seedRequestId, records, members, me, onClose, onSaved, onCustomerCreated, onOpenVisit, onNewVisit, onOpenCustomer, onOpenQuote, onDelete, onWorkflow }: Props) {
    const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
    const initialCustomer = initial ? visitCustomer(initial, records) : records.find(r => r.id === seedCustomerId), originalRequest = initial ? visitRequest(initial, records) : records.find(r => r.id === seedRequestId);
    const intake=initialCustomer?.data._serviceIntake;
    const service=initial?initial.data.visitWorkflow==='service-intake-v1':isServiceRole(me.role), readOnly=!!initial&&(me.role==='rep'||!!initial.data._readOnly), workflow=initial?.data._serviceWorkflow;
    const [customerId, setCustomerId] = useState(initialCustomer?.id || ''), [creatingCustomer, setCreatingCustomer] = useState(false), [savingCustomer, setSavingCustomer] = useState(false), [requestId, setRequestId] = useState(originalRequest?.id || '');
    const [data, setData] = useState<VisitForm>({ type: 'visit', date: today(), summary: '', result: '', outcome: 'pending', notes: '', location: '', startedAt: '', endedAt: '', nextAction: intake?.nextAction||'', nextDate: intake?.nextDate&&intake.nextDate>=today()?intake.nextDate:today(), salesStage: originalRequest?.data.stage || '', strength: '', requestedProducts: [], hasCompetitor: showCompetitor || !!seedCompetitorName, competitorName: seedCompetitorName, competitorNotes: '', competitorFileId: '', competitorFileName: '', customerNeeds: intake?.needs||'', ...initial?.data, responsibleId: initial ? (initial.data.responsibleId || initial.data.performedBy || '') : me.id });
    const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState(''), [key] = useState(() => crypto.randomUUID()), [formOpenedTick] = useState(() => performance.now());
    const [locationState,setLocationState]=useState<VisitLocationState>({status:'idle',error:''});
    const [retryPending,setRetryPending]=useState(false);
    const [uploadState,setUploadState]=useState<UploadState|null>(null);
    const uploadAttempt=useRef<{file:File;context:string;key:string}|null>(null);
    const [dirty,setDirty]=useState(false),[confirmLeave,setConfirmLeave]=useState(false),[salesOpen,setSalesOpen]=useState(showCompetitor||!!seedCompetitorName||!!initial||!!intake||!!originalRequest);
    const titleRef=useRef<HTMLHeadingElement>(null),errorRef=useRef<HTMLDivElement>(null),keepRef=useRef<HTMLButtonElement>(null),leaveAction=useRef(onClose),invalidFrame=useRef<number|null>(null);
    useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
    useEffect(()=>{if(confirmLeave)keepRef.current?.focus();},[confirmLeave]);
    useEffect(()=>{if(!dirty)return;const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[dirty]);
    useEffect(()=>()=>{if(invalidFrame.current!==null)cancelAnimationFrame(invalidFrame.current);},[]);
    const elapsedAtSave=useRef<number|null>(null), attempt=useRef<{body:string;url:string}|null>(null),saveLock=useRef(false),savedReceipt=useRef(false),uploadLock=useRef(false),uploadVersion=useRef(0);
    const competitorContext=useRef('');competitorContext.current=me.id+'\n'+customerId+'\n'+(data.competitorName||'');
    useEffect(()=>()=>{uploadVersion.current++;},[]);
    const customer = records.find(r => r.id === customerId);
    const journeyStopId=useAutomaticJourney({customerId,type:data.type,enabled:!initial&&!service&&!readOnly});
    const change = (k: string, v: VisitValue | string[]) => {if(readOnly||savedReceipt.current||retryPending||saveLock.current)return;if(!['location','latitude','longitude','locationSource','locationCapturedAt','locationAccuracy'].includes(k))setDirty(true);setData(d => ({ ...d, [k]: v }));};
    function requestLeave(action=onClose){if(busy||uploading||uploadLock.current||savingCustomer)return;if(!savedReceipt.current&&(retryPending||dirty||creatingCustomer)){leaveAction.current=action;setConfirmLeave(true);}else action();}
    function revealInvalid(event:React.FormEvent<HTMLFormElement>){const target=event.target as HTMLElement;for(let element:HTMLElement|null=target;element;element=element.parentElement){if(element instanceof HTMLDetailsElement){element.open=true;if(element.classList.contains('visit-sales-details'))setSalesOpen(true);}}if(invalidFrame.current!==null)return;invalidFrame.current=requestAnimationFrame(()=>{invalidFrame.current=null;target.focus();target.scrollIntoView({block:'center',behavior:'smooth'});});}
    const productOptions = [...visitProducts,'خدمات صيانة'];
    function selectCustomer(id: string) { if (id === customerId)
        return; if(retryPending||saveLock.current||savedReceipt.current||uploadLock.current)return;setCustomerId(id); setRequestId(''); setData(previous=>({...previous,salesStage:'',strength:'',requestedProducts:[],customerNeeds:''})); change('competitorFileId', ''); change('competitorFileName', ''); }
    async function upload(file: File | undefined, retry = false) { if (!file||readOnly||retryPending||saveLock.current||savedReceipt.current||uploadLock.current)
        return; if (!customerId) {
        setError('اختر العميل قبل رفع الملف');
        return;
    } if (!file.size||file.size > 10 * 1024 * 1024) {
        setError('الحد الأقصى 10 ميجابايت');
        return;
    } const context=competitorContext.current; if(retry&&uploadAttempt.current?.context!==context)return;
    if(!retry)uploadAttempt.current={file,context,key:crypto.randomUUID()};
    const currentAttempt=uploadAttempt.current;if(!currentAttempt)return;
    uploadLock.current=true;const uploadId=++uploadVersion.current;setUploading(true);setUploadState({phase:'reading'}); setError('');
    const onUploadProgress=(progress:import('@/lib/client-submit').UploadProgress)=>{if(uploadVersion.current===uploadId&&competitorContext.current===context)setUploadState(progress);};
    try {
        let result:{id:string;name:string;queued?:boolean};
        if(initial){
            if(navigator.onLine===false)throw new Error(say('تعديل الزيارات القديمة وملفاتها يحتاج اتصالًا بالإنترنت. يمكنك تسجيل زيارة جديدة بدون شبكة.','Editing existing visits and their files needs an internet connection. You can record a new visit offline.'));
            const form = new FormData();form.set('file', file);form.set('customerId', customerId);form.set('uploadKey',currentAttempt.key);form.set('memberId',me.id);
            result=await submitJson<{id:string;name:string;queued?:boolean}>('/api/visit-files', { method: 'POST', body: form },{language,timeout:45000,onUploadProgress});
        }else result=await uploadOfflineVisitFile(file,{me,customerId,language,uploadKey:currentAttempt.key,onUploadProgress});
        if(typeof result.id!=='string'||!result.id||typeof result.name!=='string')throw new Error(say('لم يؤكد الخادم رفع الملف. أعد المحاولة.','The server did not confirm the file upload. Retry.'));
        if(uploadVersion.current===uploadId&&competitorContext.current===context&&!retryPending&&!saveLock.current&&!savedReceipt.current){setUploadState({phase:result.queued?'queued':'complete'});uploadAttempt.current=null;setDirty(true);setData(previous=>({...previous,competitorFileId:result.id,competitorFileName:result.name}));}
    }
    catch (e) {
        if(uploadVersion.current===uploadId){setUploadState({phase:'error'});setError(messageOf(e));}
    }
    finally {
        uploadLock.current=false;if(uploadVersion.current===uploadId)setUploading(false);
    } }
    async function save(e: React.FormEvent) { e.preventDefault(); if (readOnly || saveLock.current || busy || uploading || uploadLock.current || savingCustomer || creatingCustomer)
        return; if(initial&&navigator.onLine===false){setError(say('تعديل الزيارات القديمة يحتاج اتصالًا بالإنترنت. يمكنك تسجيل زيارة جديدة بدون شبكة.','Editing existing visits needs an internet connection. You can record a new visit offline.'));return;}if(!savedReceipt.current&&!retryPending&&!customer){setError(say('اختر العميل أولًا، ثم سجّل الزيارة.','Choose a customer before recording the visit.'));return;}if (!savedReceipt.current&&!retryPending&&!initial && (locationState.status==='locating'||!data.locationCapturedAt)) {
        setError(locationState.error||say('انتظر تحديد موقع الجهاز أو اضغط إعادة المحاولة في قسم الموقع.','Wait for the device location, or tap Retry in the location section.'));
        return;
    } saveLock.current=true;setBusy(true); setError(''); elapsedAtSave.current ??= Math.max(0,Math.round(performance.now()-formOpenedTick)); try {
        if(savedReceipt.current){await onSaved();onClose();return;}
        if(!attempt.current){const stopId=!initial?journeyStopId():undefined;const payload=service?{action:initial?'edit':'create',id:initial?.data.serviceIntakeId,version:initial?.version,customerId,customerVersion:customer?.version,registration:data,elapsedMilliseconds:elapsedAtSave.current,requestId:crypto.randomUUID()}:{createKey:key,id:initial?.id,version:initial?.version,customerId,customerVersion:customer?.version,data:{...data,...(stopId?{journeyStopId:stopId}:{})},requestId,timingMode:'automatic',elapsedMilliseconds:elapsedAtSave.current};attempt.current={body:JSON.stringify(payload),url:service?'/api/customer-service':'/api/visits'};}
        const result=initial
            ?await submitJson(attempt.current.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: attempt.current.body },{language})
            :await offlineSubmit(attempt.current.url,attempt.current.body,{me,language,label:customer?.data.name||say('زيارة جديدة','New visit'),kind:service?'service':'visit'});
        if(result.ok!==true||typeof result.id!=='string'||!result.id)throw new SubmitError(say('الخادم لم يؤكد حفظ الزيارة. أعد المحاولة بنفس البيانات.','The server did not confirm the visit. Retry with the same entries.'),200,result);
        savedReceipt.current=true;setRetryPending(false);
        setDirty(false);
        if(result.queued){void onSaved(true).catch(()=>{});onClose();return;}
        await onSaved(false);
        onClose();
    }
    catch (e) {
        if(!savedReceipt.current){if(definiteSubmitRejection(e)){elapsedAtSave.current=null;attempt.current=null;setRetryPending(false);}else setRetryPending(true);}
        setError(savedReceipt.current?say('تم حفظ الزيارة؛ تعذر تحديث الشاشة. اضغط تحديث السجل لعرضها.','The visit was saved, but the screen could not refresh. Tap Refresh history to view it.'):messageOf(e)||say('تعذر حفظ الزيارة. أعد المحاولة.','The visit could not be saved. Retry.'));
    }
    finally {
        saveLock.current=false;setBusy(false);
    } }
    return <Dialog open onOpenChange={open=>{if(!open)requestLeave();}}>
      <DialogContent showCloseButton={!busy&&!uploading&&!savingCustomer} className="crm-dialog customer-visit-dialog mobile-record-dialog" dir={direction()}
        onOpenAutoFocus={event=>{event.preventDefault();titleRef.current?.focus();}}
        onEscapeKeyDown={event=>{if(busy||uploading||savingCustomer||escapeBelongsToOpenPopup(event))event.preventDefault();}}
        onInteractOutside={event=>{if(busy||uploading||savingCustomer)event.preventDefault();}}>
        <header className="visit-dialog-heading">
          <div className="visit-language"><LanguageSwitch/></div>
          <DialogTitle ref={titleRef} tabIndex={-1}>{initial ? t(readOnly?'تفاصيل الزيارة #':'تعديل الزيارة #') + (t(initial.data.visitNumber) || t('—')) : t('زيارة جديدة')}</DialogTitle>
          <DialogDescription className="sr-only">{readOnly?say('بيانات الزيارة ونتيجتها والخطوة القادمة.','Recorded visit, outcome and next step.'):say('اختار العميل، سجّل نتيجة التواصل وحدّد الخطوة الجاية.','Choose a customer, record the outcome, and set the next step.')}</DialogDescription>
        </header>
        <form onSubmit={save} onInvalidCapture={revealInvalid} className="visit-entry-form">
          <fieldset disabled={savingCustomer||busy||savedReceipt.current||retryPending} className="visit-form-scroll min-w-0">
            <VisitCustomerPicker customers={records.filter(r => r.kind === 'customer'&&(r.id===customerId||isServiceRole(me.role)||!r.data._readOnly))} value={customerId} me={me} locked={!!initial||readOnly} disabled={busy || uploading||retryPending} onChange={selectCustomer} onCreated={onCustomerCreated} onCreating={value=>{setCreatingCustomer(value);if(value)setDirty(true);}} onSaving={setSavingCustomer}/>
            {!initial&&!service&&data.type==='visit'&&<JourneyFormNotice/>}
            {customer&&<section className="visit-customer-context">
              <div className="visit-context-disclosures">
                <details className="visit-context-details"><summary>{t('بيانات العميل')}</summary><div className="visit-context-body">
                  <div className="customer-card-grid">{Object.entries({'المنطقة / المدينة':[customer.data.region,customer.data.city].filter(Boolean).join(' · '),'نوع العميل':customer.data.customerType,'مسؤول التواصل':customer.data.contact||customer.data.contact2,'رقم التواصل':customer.data.phone||customer.data.phone2,'حالة التعامل / السحب':customer.data.customerStatus,'الماكينات':customer.data.machineTypes||'','عدد الماكينات':customer.data.machineCount??''}).map(([label,value])=><div key={label}><span>{t(label)}</span><strong>{t(String(value||'غير مسجل'))}</strong></div>)}</div>
                  {customer.data.notes&&<p>{customer.data.notes}</p>}<button type="button" className="text-button" onClick={()=>requestLeave(()=>onOpenCustomer(customer.id))}>{say('فتح بطاقة العميل','Open customer card')}</button>
                </div></details>
                <details className="visit-context-details"><summary><History size={16}/>{t('سجل الزيارات')} <span className="count-badge">{customerVisits(customer.id,records).length}</span></summary><div className="visit-context-body"><CustomerVisitHistory key={customer.id} customer={customer} records={records} canEdit={me.role!=='rep'} onVisit={row=>requestLeave(()=>onOpenVisit(row))} onNew={customer.data._readOnly&&!isServiceRole(me.role)?undefined:row=>requestLeave(()=>onNewVisit(customer.id,row))} onQuote={id=>requestLeave(()=>onOpenQuote(id))}/></div></details>
                {mapsLink(customer.data)&&<a className="text-button visit-customer-map-link" href={mapsLink(customer.data)!} target="_blank" rel="noopener noreferrer"><MapPin size={16}/>{say('موقع العميل','Customer map')}</a>}
              </div>
            </section>}
            {workflow&&<div className="service-button-row"><span className="badge pending">{t(serviceStatusLabels[workflow.state])}</span><button type="button" className="btn subtle small" onClick={()=>requestLeave(()=>onWorkflow(workflow.id))}>{t('الاعتماد والتكليف')}</button></div>}
            <fieldset disabled={readOnly} className="visit-form-fields">
              <section className="visit-form-section"><h3>{say('التواصل والنتيجة','Contact & outcome')}</h3><div className="form-grid">
                <VisitFields unified service={service} readOnly={readOnly} data={data} parentId={customerId} records={records} editing={!!initial} busy={busy||uploading||creatingCustomer||savedReceipt.current||retryPending} email={me.email} onChange={change} onParent={()=>{}} onLocationState={setLocationState}/>
              </div></section>
              <section className="visit-form-section"><h3>{say('الخطوة الجاية','Next step')}</h3><div className="form-grid">
                <VoiceField label={t('الإجراء القادم')} value={data.nextAction||''} required onChange={value=>change('nextAction',value)}/><FollowupDateField value={data.nextDate||''} onChange={value=>change('nextDate',value)}/>
              </div></section>
              <details className="visit-sales-details" open={salesOpen} onToggle={event=>setSalesOpen(event.currentTarget.open)}>
                <summary><span>{say('تفاصيل البيع والأصناف','Sales & products')}</span><span className="badge">{t(stageLabels[data.salesStage])||say('اختياري','Optional')}</span></summary>
                <div className="form-grid visit-extended-fields">
                  <label className="field"><span>{t('مرحلة البيع')}</span><Pick value={data.salesStage||'__unset'} onChange={value=>change('salesStage',value==='__unset'?'':value)} label="مرحلة البيع" options={[[ '__unset',say('غير محددة','Not specified')],...Object.entries(stageLabels)]} disabled={service||readOnly}/></label>
                  <label className="field"><span>{t('قوة الفرصة')}{service?' *':''}</span><Pick value={data.strength||'__unset'} onChange={value=>change('strength',value==='__unset'?'':value)} label="قوة الفرصة" options={[[ '__unset',say('غير محددة','Not specified')],...Object.entries(strengthLabels)]} disabled={readOnly}/></label>
                  <fieldset className="full requested-products"><legend>{t('الأصناف المطلوبة')}</legend><div>{productOptions.map(product=><label key={product}><input type="checkbox" checked={data.requestedProducts.includes(product)} onChange={event=>change('requestedProducts',event.target.checked?[...data.requestedProducts,product]:data.requestedProducts.filter((value:string)=>value!==product))}/>{t(product)}</label>)}</div>{initial&&data.requestedProducts.some((product:string)=>!visitProducts.includes(product))&&<p className="muted">{t('أصناف مسجلة سابقًا: ')}{t(data.requestedProducts.filter((product:string)=>!visitProducts.includes(product)).join('، '))}</p>}</fieldset>
                  <CompetitorFields value={data} records={records} members={members} customerId={customerId} identityKey={me.id} disabled={busy||uploading||savingCustomer||creatingCustomer||savedReceipt.current||retryPending} readOnly={readOnly} uploading={uploading} uploadState={uploadAttempt.current?.context===competitorContext.current||data.competitorFileId?uploadState:null} onUploadRetry={()=>{const retry=uploadAttempt.current;if(retry)void upload(retry.file,true);}} onChange={patch=>{if(readOnly||savedReceipt.current||retryPending||saveLock.current||uploadLock.current)return;setDirty(true);setData(previous=>({...previous,...patch}));}} onUpload={upload}/>
                  <VoiceField label={t('احتياج العميل')} value={data.customerNeeds||''} onChange={value=>change('customerNeeds',value)} multiline/>
                </div>
              </details>
            </fieldset>
          </fieldset>
          <footer className="visit-save-bar">
            {error&&<div ref={errorRef} tabIndex={-1} className="form-error" role="alert">{t(error)}</div>}
            {retryPending&&<p className="visit-save-hint" role="status">{say('حالة الحفظ غير مؤكدة. البيانات مقفولة مؤقتًا؛ اضغط «تأكيد الحفظ» لإعادة نفس الطلب بدون تسجيل زيارة مكررة.','The save is unconfirmed. Entries are temporarily locked; tap Confirm save to retry the identical request without creating a duplicate visit.')}</p>}
            {confirmLeave?<div className="visit-discard-prompt" role="alert"><p>{retryPending?say('الحفظ غير مؤكد. لو خرجت راجع سجل العميل قبل تسجيل زيارة أخرى.','The save is unconfirmed. If you leave, check the customer history before recording another visit.'):say('فيه بيانات لسه ما اتحفظتش. تخرج من غير حفظ؟','You have unsaved changes. Leave without saving?')}</p><div><button ref={keepRef} type="button" className="btn primary" onClick={()=>setConfirmLeave(false)}>{say('أكمل التسجيل','Keep editing')}</button><button type="button" className="btn subtle danger" onClick={()=>leaveAction.current()}>{retryPending?say('إغلاق ومراجعة السجل','Close and check history'):say('خروج بدون حفظ','Discard changes')}</button></div></div>:<>
              {!readOnly&&!customerId&&<p className="visit-save-hint">{say('اختر العميل أولًا.','Choose a customer first.')}</p>}
              {!initial&&!readOnly&&(locationState.status==='locating'||!data.locationCapturedAt)&&<p className="visit-save-hint" role={locationState.status==='error'?'alert':'status'}>{locationState.error?t(locationState.error):locationState.status==='locating'?say('جارٍ تحديد موقع الجهاز… وافق على إذن الموقع أثناء الاستخدام.','Getting the device location… allow location while using the app.'):say('السماح بالموقع مطلوب لحفظ الزيارة. اضغط إعادة المحاولة في قسم الموقع.','Location access is required. Tap Retry in the location section.')}</p>}
              {creatingCustomer&&<p className="visit-save-hint">{say('احفظ العميل أو ألغِ إضافته للمتابعة.','Save the customer or cancel adding to continue.')}</p>}
              <div className="form-footer">{initial&&!readOnly&&!service&&!savedReceipt.current&&!retryPending&&<button type="button" className="icon-button danger" onClick={()=>requestLeave(()=>onDelete(initial))} aria-label={t('حذف الزيارة')} disabled={busy||uploading||savingCustomer}><Trash2 size={17}/></button>}<button type="button" className="btn subtle" onClick={()=>requestLeave()} disabled={busy||uploading||savingCustomer}>{t(readOnly||savedReceipt.current?'إغلاق':'إلغاء')}</button>{!readOnly&&<button type="submit" className="btn primary" aria-busy={busy} disabled={busy||uploading||savingCustomer||creatingCustomer||(!retryPending&&!savedReceipt.current&&(!customerId||!initial&&(locationState.status==='locating'||!data.locationCapturedAt)))}>{busy?<Loader2 size={18} className="spin"/>:<CheckCircle2 size={18}/>} {savedReceipt.current?say('تحديث السجل','Refresh history'):retryPending?say('تأكيد الحفظ','Confirm save'):initial?t('حفظ التعديلات'):t('حفظ الزيارة')}</button>}</div>
            </>}
          </footer>
        </form>
      </DialogContent>
    </Dialog>;
}

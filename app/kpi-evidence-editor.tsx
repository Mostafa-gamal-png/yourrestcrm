'use client';
import React,{useEffect,useRef,useState} from 'react';
import {AlertCircle,FileCheck2,Loader2,Plus,RefreshCw,Trash2,X} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {definiteSubmitRejection,submitJson} from '@/lib/client-submit';
import {t,useLanguage} from '@/lib/i18n';
import {emptyKpiEvidenceInput,kpiEvidenceInputSchema,type KpiEvidenceInput,type KpiEvidenceOptions} from '@/lib/kpi-evidence';
import './kpi-evidence-editor.css';
import VoiceField from './voice-field';

type Props={memberId:string;memberName:string;month:string;identityKey:string;onClose:()=>void;onSaved:()=>void};
type Draft={due:string;collected:string;collectionReference:string;historyComplete:boolean;historyReference:string;quotationsComplete:boolean;quotations:KpiEvidenceInput['quotations']};
type Snapshot={key:string;phase:'loading'|'ready'|'error';options?:KpiEvidenceOptions;draft?:Draft;initial?:string;error?:string};

/** Parse decimal currency directly into cents without floating-point multiplication. */
export function parseEvidenceMoney(value:string):number|null|undefined{
 const normalized=value.trim().replace(/[٠-٩]/g,digit=>String(digit.charCodeAt(0)-1632)).replace(/[۰-۹]/g,digit=>String(digit.charCodeAt(0)-1776)).replace(/٫/g,'.');
 if(!normalized)return null;
 if(!/^(?:\d+|\d*\.\d{1,2})$/.test(normalized))return undefined;
 const [whole='',fraction='']=normalized.split('.'),cents=Number(whole||'0')*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(cents)&&cents>=0&&cents<=1_000_000_000_000?cents:undefined;
}
export function formatEvidenceMoney(cents:number|null):string{return cents===null?'':Math.floor(cents/100)+'.'+String(cents%100).padStart(2,'0');}
const isStale=(options:KpiEvidenceOptions)=>!!options.evidence&&(options.evidence.salesRevision!==options.salesRevision||options.evidence.scopeKey!==options.scopeKey||options.evidence.cutoff!==options.period.through);
function initialDraft(options:KpiEvidenceOptions):Draft{
 const input=options.evidence?.input||emptyKpiEvidenceInput(),reviewAgain=options.canEdit&&!options.computed&&isStale(options);
 return{due:formatEvidenceMoney(input.collection.dueCents),collected:formatEvidenceMoney(input.collection.collectedCents),collectionReference:input.collection.reference,historyComplete:reviewAgain?false:input.history.complete,historyReference:input.history.reference,quotationsComplete:reviewAgain?false:input.quotationsComplete,quotations:input.quotations.map(row=>({...row}))};
}

export default function KpiEvidenceEditor({memberId,memberName,month,identityKey,onClose,onSaved}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const key=JSON.stringify([identityKey,memberId,month]);
 const [revision,setRevision]=useState(0),[snapshot,setSnapshot]=useState<Snapshot>({key:'',phase:'loading'}),[busy,setBusy]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),request=useRef<{key:string;body:string}|null>(null),currentKey=useRef(key),live=useRef(true),saveController=useRef<AbortController|null>(null);
 currentKey.current=key;
 useEffect(()=>{
  const controller=new AbortController();live.current=true;lock.current=false;request.current=null;setBusy(false);setPending(false);setError('');setSnapshot({key,phase:'loading'});
  void submitJson<KpiEvidenceOptions>('/api/kpi-evidence?memberId='+encodeURIComponent(memberId)+'&month='+encodeURIComponent(month),{cache:'no-store',signal:controller.signal},{language}).then(options=>{
   if(controller.signal.aborted||currentKey.current!==key)return;
   if(options.memberId!==memberId||options.month!==month)throw new Error(say('تعذر تأكيد بيانات العضو والشهر.','The member and month could not be verified.'));
   const draft=initialDraft(options);setSnapshot({key,phase:'ready',options,draft,initial:JSON.stringify(draft)});
  }).catch(cause=>{if(!controller.signal.aborted&&currentKey.current===key)setSnapshot({key,phase:'error',error:cause instanceof Error?cause.message:say('تعذر تحميل بيانات المؤشرات.','Could not load KPI evidence.')});});
  return()=>{live.current=false;controller.abort();saveController.current?.abort();};
 },[key,revision]);
 const current=snapshot.key===key?snapshot:null,options=current?.options,draft=current?.draft,editable=!!options?.canEdit&&!options.computed;
 const immutable=busy||pending||!editable,dirty=!!draft&&JSON.stringify(draft)!==current?.initial;
 const present=(message:string)=>{
  const translated:Record<string,string>={
   'أدخل المستحق والمحصل معًا.':'Enter both the due and collected amounts.',
   'أدخل مرجع بيانات التحصيل.':'Enter a collection source reference.',
   'المحصل يحتاج مبلغًا مستحقًا أكبر من صفر.':'A collected amount requires a due amount greater than zero.',
   'أدخل مرجع اكتمال سجل المبيعات.':'Enter a sales-history source reference.',
   'اختر كل عرض سعر مرة واحدة.':'Select each quote only once.',
   'اربط الفاتورة بعرض سعر واحد فقط.':'Link each invoice to only one quote.'
  };
  return language==='en'?(translated[message]||t(message)):message;
 };
 function update(change:Partial<Draft>){if(immutable)return;setSnapshot(value=>value.key===key&&value.draft?{...value,draft:{...value.draft,...change}}:value);setError('');}
 function close(){if(lock.current||pending)return;if(dirty&&!window.confirm(say('تجاهل التغييرات غير المحفوظة؟','Discard unsaved changes?')))return;onClose();}
 async function save(event:React.FormEvent){
  event.preventDefault();if(lock.current||!options||!draft||!editable)return;
  let body=request.current?.key===key&&pending?request.current.body:null;
  if(!body){
   const dueCents=parseEvidenceMoney(draft.due),collectedCents=parseEvidenceMoney(draft.collected);
   if(dueCents===undefined||collectedCents===undefined){setError(say('أدخل مبالغ صحيحة حتى منزلتين عشريتين.','Enter valid amounts with up to two decimal places.'));return;}
   if(draft.quotations.some(row=>!row.quoteId)){setError(say('اختر عرض سعر لكل صف أو احذف الصف الفارغ.','Choose a quote for each row or remove the empty row.'));return;}
   const input:KpiEvidenceInput={collection:{dueCents,collectedCents,reference:draft.collectionReference},history:{complete:draft.historyComplete,reference:draft.historyReference},quotationsComplete:draft.quotationsComplete,quotations:draft.quotations};
   const parsed=kpiEvidenceInputSchema.safeParse(input);
   if(!parsed.success){setError(parsed.error.issues.map(issue=>present(issue.message)).join(' · '));return;}
   body=JSON.stringify({memberId,month,version:options.evidence?.version||0,requestId:crypto.randomUUID(),salesRevision:options.salesRevision,evidenceRevision:options.evidenceRevision,input:parsed.data});request.current={key,body};
  }
  lock.current=true;setBusy(true);setError('');const controller=new AbortController();saveController.current=controller;
  try{
   const receipt=await submitJson<{ok?:boolean}>('/api/kpi-evidence',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal},{language});
   if(receipt.ok!==true)throw new Error(say('لم يؤكد الخادم حفظ بيانات المؤشرات.','The server did not confirm the KPI evidence save.'));
   if(live.current&&currentKey.current===key){setPending(false);onSaved();}
  }catch(cause){
   if(live.current&&currentKey.current===key&&!controller.signal.aborted){setPending(!definiteSubmitRejection(cause));setError(cause instanceof Error?present(cause.message):say('تعذر تأكيد الحفظ.','The save could not be confirmed.'));}
  }finally{if(live.current&&currentKey.current===key){lock.current=false;setBusy(false);}}
 }
 return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="crm-dialog kpi-evidence-dialog" dir={language==='en'?'ltr':'rtl'} showCloseButton={false} onEscapeKeyDown={event=>{event.preventDefault();close();}} onInteractOutside={event=>{event.preventDefault();close();}}>
  <header className="kpi-evidence-heading"><div><DialogTitle><FileCheck2 size={21}/>{say('بيانات المؤشرات','KPI evidence')}</DialogTitle><DialogDescription>{memberName} · <bdi>{month}</bdi></DialogDescription></div><button type="button" className="icon-button" disabled={busy||pending} aria-label={say('إغلاق','Close')} onClick={close}><X size={19}/></button></header>
  {!current||current.phase==='loading'?<div className="kpi-evidence-state" role="status"><Loader2 size={22} className="spin"/>{say('جارٍ تحميل بيانات المؤشرات…','Loading KPI evidence…')}</div>:current.phase==='error'?<div className="kpi-evidence-state" role="alert"><AlertCircle size={22}/><p>{present(current.error||'')}</p><button type="button" className="btn subtle" onClick={()=>setRevision(value=>value+1)}><RefreshCw size={17}/>{say('إعادة المحاولة','Retry')}</button></div>:options&&draft&&<form onSubmit={save}>
   <div className="kpi-evidence-scroll">
    {!editable&&<p className="kpi-evidence-notice">{say(options.computed?'محسوب من بيانات مناديب الفريق.':'للعرض فقط.',options.computed?'Calculated from team reps’ evidence.':'Read only.')}</p>}
    {isStale(options)&&<p className="kpi-evidence-notice" role="status">{say('تغيّر سجل المبيعات أو نطاقه منذ آخر تأكيد. التأكيد السابق يحتاج مراجعة.','Sales history or its scope has changed since the last confirmation. The previous confirmation needs review.')}{editable&&<> {say('راجع البيانات ثم أعد تأكيد اكتمالها.','Review the data, then confirm completeness again.')}</>}</p>}
    <fieldset disabled={immutable}>
     <section className="kpi-evidence-section" aria-labelledby="kpi-collection-title"><h3 id="kpi-collection-title">{say('التحصيل الشهري','Monthly collection')}</h3><div className="form-grid">
      <label className="field"><span>{say('المستحق · ر.س','Due · SAR')}</span><input name="due" type="text" inputMode="decimal" dir="ltr" maxLength={24} aria-label={say('المستحق · ر.س','Due · SAR')} value={draft.due} onChange={event=>update({due:event.target.value})}/></label>
      <label className="field"><span>{say('المحصل · ر.س','Collected · SAR')}</span><input name="collected" type="text" inputMode="decimal" dir="ltr" maxLength={24} aria-label={say('المحصل · ر.س','Collected · SAR')} value={draft.collected} onChange={event=>update({collected:event.target.value})}/></label>
      <VoiceField label={say('مرجع بيانات التحصيل','Collection source reference')} multiline full rows={2} value={draft.collectionReference} onChange={value=>update({collectionReference:value})} contextKey="kpi-evidence-collection" inputProps={{name:'collectionReference',maxLength:2000}}/>
     </div><p className="kpi-evidence-hint">{say('الخانة الفارغة تعني بيانات غير مكتملة؛ الصفر مبلغ مؤكد.','Blank means incomplete data; zero is a confirmed amount.')}</p></section>
     <section className="kpi-evidence-section" aria-labelledby="kpi-history-title"><h3 id="kpi-history-title">{say('اكتمال سجل المبيعات','Sales-history coverage')}</h3><p className="kpi-evidence-period"><bdi>{options.period.from}</bdi> — <bdi>{options.period.through}</bdi></p>
      <label className="kpi-evidence-check"><input name="historyComplete" type="checkbox" checked={draft.historyComplete} onChange={event=>update({historyComplete:event.target.checked})}/><span>{say('أؤكد اكتمال مبيعات الفترة ومرتجعاتها، وإدراج تاريخ الشراء الأقدم للعملاء لتحديد المستردين.','I confirm this period’s sales and returns are complete, with older customer purchases included to identify recovered customers.')}</span></label>
      <VoiceField label={say('مرجع اكتمال سجل المبيعات','Sales-history source reference')} multiline rows={2} value={draft.historyReference} onChange={value=>update({historyReference:value})} contextKey="kpi-evidence-history" inputProps={{name:'historyReference',maxLength:2000}}/>
     </section>
     <section className="kpi-evidence-section" aria-labelledby="kpi-quotes-title"><div className="kpi-evidence-section-heading"><h3 id="kpi-quotes-title">{say('عروض الأسعار والفواتير','Quotes and invoices')}</h3>{editable&&<button type="button" className="btn subtle small" disabled={immutable||draft.quotations.length>=200} onClick={()=>update({quotations:[...draft.quotations,{quoteId:'',saleId:null}]})}><Plus size={16}/>{say('إضافة عرض','Add quote')}</button>}</div>
      {!draft.quotations.length&&<p className="kpi-evidence-hint">{say(draft.quotationsComplete?'لا توجد عروض في هذا الشهر.':'لم يُؤكد سجل العروض لهذا الشهر.',draft.quotationsComplete?'No quotes for this month.':'The quote list for this month has not been confirmed.')}</p>}
      <div className="kpi-evidence-quote-list">{draft.quotations.map((row,index)=>{
       const quote=options.quotes.find(option=>option.id===row.quoteId),invoice=options.invoices.find(option=>option.id===row.saleId),eligibleInvoices=quote?options.invoices.filter(option=>option.customerId===quote.customerId&&option.date>=quote.date):[];
       const invalidQuote=!!row.quoteId&&!quote,invalidInvoice=!!row.saleId&&!eligibleInvoices.some(option=>option.id===row.saleId);
       const changeRow=(change:Partial<KpiEvidenceInput['quotations'][number]>)=>update({quotations:draft.quotations.map((existing,i)=>i===index?{...existing,...change}:existing)});
       return <div className="kpi-evidence-quote-row" key={index}>
        <label className="field"><span>{say('عرض السعر','Quote')} {index+1}</span><select aria-label={say('عرض السعر ','Quote ')+(index+1)} value={row.quoteId} onChange={event=>changeRow({quoteId:event.target.value})}>
         <option value="">{say('اختر عرضًا صادرًا','Choose an issued quote')}</option>{invalidQuote&&<option value={row.quoteId}>{say('عرض محفوظ غير متاح','Saved quote unavailable')}: {row.quoteId}</option>}
         {options.quotes.map(option=><option key={option.id} value={option.id} disabled={draft.quotations.some((existing,i)=>i!==index&&existing.quoteId===option.id)}>{option.reference} · {option.customerName} · {option.date}</option>)}
        </select></label>
        <label className="field"><span>{say('الفاتورة المرتبطة','Linked invoice')}</span><select aria-label={say('الفاتورة المرتبطة ','Linked invoice ')+(index+1)} value={row.saleId||''} onChange={event=>changeRow({saleId:event.target.value||null})}>
         <option value="">{say('بدون فاتورة مرتبطة','No linked invoice')}</option>{invalidInvoice&&<option value={row.saleId!}>{say('ربط محفوظ يحتاج مراجعة','Saved link needs review')}: {invoice?.reference||row.saleId}</option>}
         {eligibleInvoices.map(option=><option key={option.id} value={option.id} disabled={draft.quotations.some((existing,i)=>i!==index&&existing.saleId===option.id)}>{option.reference} · {option.customerName} · {option.date} · {option.source==='erp'?'ERP':say('التطبيق','App')}</option>)}
        </select></label>
        {editable&&<button type="button" className="icon-button" disabled={immutable} aria-label={say('حذف عرض السعر ','Remove quote ')+(index+1)} onClick={()=>update({quotations:draft.quotations.filter((_,i)=>i!==index)})}><Trash2 size={17}/></button>}
        {(invalidQuote||invalidInvoice)&&<p className="kpi-evidence-row-warning" role="status">{say('الربط المحفوظ غير متاح أو لا يطابق العميل وتاريخ العرض. راجعه قبل الحفظ.','The saved link is unavailable or does not match the customer and quote date. Review it before saving.')}</p>}
        {quote&&!eligibleInvoices.length&&!row.saleId&&<p className="kpi-evidence-hint">{say('لا توجد فاتورة مؤهلة لهذا العميل بعد تاريخ العرض.','No eligible invoice for this customer on or after the quote date.')}</p>}
       </div>;
      })}</div>
      <label className="kpi-evidence-check"><input name="quotationsComplete" type="checkbox" checked={draft.quotationsComplete} onChange={event=>update({quotationsComplete:event.target.checked})}/><span>{say('أؤكد أن القائمة تشمل كل عروض الشهر؛ القائمة الفارغة تعني عدم وجود عروض.','I confirm this list includes every quote for the month; an empty list means there were no quotes.')}</span></label>
     </section>
    </fieldset>
    {options.evidence&&<p className="kpi-evidence-hint">{say('آخر تحديث','Last updated')}: {options.evidence.updatedBy} · <bdi>{options.evidence.updatedAt.slice(0,10)}</bdi></p>}
   </div>
   <footer className="kpi-evidence-footer">{error&&<div className="form-error" role="alert">{present(error)}</div>}{pending&&<p className="kpi-evidence-notice" role="status">{say('لم يتأكد الحفظ. البيانات مثبتة؛ اضغط «تأكيد الحفظ» لإعادة نفس الطلب.','The save was not confirmed. Entries are locked; choose “Confirm save” to retry the same request.')}</p>}<div><button type="button" className="btn subtle" disabled={busy||pending} onClick={close}>{say('إغلاق','Close')}</button>{editable&&<button type="submit" className="btn primary" disabled={busy}>{busy&&<Loader2 size={17} className="spin"/>}{say(pending?'تأكيد الحفظ':'حفظ بيانات المؤشرات',pending?'Confirm save':'Save KPI evidence')}</button>}</div></footer>
  </form>}
 </DialogContent></Dialog>;
}

'use client';
// «استيراد كشف التحصيل من ERP»: the ERP's «كشف حساب» (HTML .xls, or .xlsx) becomes each representative's collection evidence for the
// chosen month (lib/erp-collections-server.ts). Preview first (nothing written), then «اعتماد». The same request is resent after a
// network cut, so a repeat writes nothing twice.
import React,{useEffect,useRef,useState} from 'react';
import {AlertCircle,CheckCircle2,FileSpreadsheet,Loader2,RefreshCw,Upload,X} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {definiteSubmitRejection,submitJson,SubmitError} from '@/lib/client-submit';
import {t,useLanguage} from '@/lib/i18n';
import type {CollectionNamePreview,CollectionRepPreview} from '@/lib/erp-collections-server';
import UploadStatus,{type UploadState} from './upload-status';
import './erp-sales-import.css';
import './erp-collections-import.css';

type Options={members:{id:string;name:string;branch:string;active:boolean}[];currentMonth:string;admin:boolean;meaning:string};
type Preview={month:string;fileName:string;title:string;closedMonth:boolean;meaning:string;reference:string;planDigest:string;names:CollectionNamePreview[];reps:CollectionRepPreview[];warnings:string[];
 summary:{rows:number;officeRows:number;noRepRows:number;mismatchRows:number;names:number;unmappedNames:number;outOfScopeNames:number;reps:number;newCount:number;replaceCount:number;unchangedCount:number;invalidCount:number;dueCents:number;collectedCents:number}};
type Receipt={writtenCount:number;newCount:number;replaceCount:number;unchangedCount:number;invalidCount:number;skippedNames:number;month:string;alreadySaved?:boolean};
type Body={month:string;fileName:string;base64:string;mappings:{name:string;repId:string}[];replaceConfirmed:boolean};
const endpoint='/api/kpi-evidence/import',maxBytes=2*1024*1024;
const messageOf=(e:unknown)=>typeof e==='object'&&e!==null&&'message' in e&&typeof e.message==='string'?e.message:'';
const english:Record<string,string>={
 'المحصل = «حركة الفترة دائن»؛ المستحق = الرصيد السابق المدين بعد خصم الدائن (إن كان موجبًا) + «حركة الفترة مدين». يُنسب كل حساب إلى «المندوب»، وإلى «المحصل» إن خلا اسم المندوب. «مبيعات مكتب» مستبعدة. الكشف لا يحمل تاريخًا، فيُحسب للشهر المختار.':'Collected = the period\'s credit movement. Due = the previous debit balance less its credit (when positive) + the period\'s debit movement. Each account belongs to the representative column, or to the collector column when no representative is named. Office sales are excluded. The statement carries no date, so it counts for the month chosen.',
 'لا يوجد مبلغ مستحق والمحصل أكبر من صفر؛ لا يُعتمد كتحصيل':'Nothing is due but something was collected; it cannot be saved as collection.',
 'المبلغ يتجاوز الحد المسموح':'The amount exceeds the allowed limit.',
 'القيمة نفسها محفوظة؛ لن تتغير':'The same value is already saved; nothing changes.',
 'سيستبدل القيمة الحالية':'Replaces the current value',
 'انتهى هذا الشهر؛ استيراد تحصيله لمدير النظام فقط':'This month has ended; only the system administrator can import its collection.',
 'لا يمكن اعتماد تحصيل شهر قادم.':'A future month\'s collection cannot be saved.',
 'أكّد استبدال قيم التحصيل المحفوظة قبل الاعتماد':'Confirm replacing the saved collection values before saving.',
 'تغيّرت بيانات المؤشرات أو الربط بعد المعاينة؛ اعرض الملف مرة أخرى':'The KPI evidence or the mappings changed after the preview. Preview the file again.',
 'تغيّرت بيانات المؤشرات أو الصلاحيات أثناء الاعتماد؛ اعرض الملف مرة أخرى':'The KPI evidence or permissions changed while saving. Preview the file again.',
 'تم حفظ الطلب ببيانات مختلفة؛ ارفع الملف للمعاينة من جديد':'This request was saved with different data. Upload the file for a new preview.',
 'هذا الملف ليس كشف حساب ERP المتوقع: لم تُعثر على عناوين الأعمدة (رقم الحساب، اسم الحساب، المندوب، المحصل، الأرصدة والحركة)':'This is not the expected ERP account statement: the column headings (account number, account name, representative, collector, balances and movements) were not found.',
 'هذا الملف ليس كشف حساب ERP: لا يحتوي جدولًا':'This is not an ERP account statement: it holds no table.',
 'ربط المندوب خارج نطاق فريقك أو منطقتك':'The mapped representative is outside your team or region.',
 'بيانات المؤشرات متاحة للتعديل لمدير النظام ومدير المبيعات فقط.':'Only the system administrator and sales managers can edit KPI evidence.',
};
function readFile(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reader.onabort=()=>reject(new Error('FILE_READ_FAILED'));reader.onload=()=>{const result=String(reader.result||''),at=result.indexOf(',');if(at<0||!result.slice(at+1))reject(new Error('FILE_READ_FAILED'));else resolve(result.slice(at+1));};reader.readAsDataURL(file);});}

export default function ErpCollectionsImport({month:initialMonth,onClose,onImported}:{month:string;onClose:()=>void;onImported:()=>void|Promise<void>}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const counted:Record<string,string>={'حسابات «مبيعات مكتب» المستبعدة':'Office sales accounts excluded','حسابات بلا مندوب ولا محصل لا تُنسب لأحد':'Accounts with no representative or collector, counted for nobody','حسابات لا يساوي رصيدها الحالي الرصيد السابق مع حركة الفترة':'Accounts whose current balance is not the previous balance plus the period\'s movement','أسماء غير مربوطة بمندوب لن تُكتب':'Names not mapped to a representative, not written','أسماء مربوطة بمندوب خارج نطاق فريقك أو منطقتك لن تُكتب':'Names mapped to a representative outside your team or region, not written'};
 const present=(value:string)=>{if(language!=='en')return value;if(english[value])return english[value];const match=/^(.*): (\d+)$/.exec(value);return match&&counted[match[1]]?counted[match[1]]+': '+match[2]:t(value);};
 const [options,setOptions]=useState<Options|null>(null),[optionsError,setOptionsError]=useState(''),[optionsRevision,setOptionsRevision]=useState(0);
 const [month,setMonth]=useState(initialMonth),[file,setFile]=useState<{fileName:string;base64:string;size:number}|null>(null),[mappings,setMappings]=useState<Record<string,string>>({}),[replaceConfirmed,setReplaceConfirmed]=useState(false);
 const [preview,setPreview]=useState<Preview|null>(null),[previewBody,setPreviewBody]=useState<Body|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState<'read'|'preview'|'commit'|'refresh'|null>(null),[uploadState,setUploadState]=useState<UploadState|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false),[receipt,setReceipt]=useState<Receipt|null>(null),[refreshFailed,setRefreshFailed]=useState(false);
 const lock=useRef(false),attempt=useRef<string|null>(null),live=useRef(true),previewHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{const controller=new AbortController();submitJson<Options>(endpoint,{cache:'no-store',signal:controller.signal},{language}).then(data=>{if(!controller.signal.aborted)setOptions(data);}).catch(e=>{if(!controller.signal.aborted)setOptionsError(messageOf(e));});return()=>controller.abort();
  // Changing the presentation language must not discard an import in progress.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[optionsRevision]);
 const immutable=!!busy||pending||!!receipt;
 const money=(cents:number)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);
 const statusText=(status:CollectionRepPreview['status'])=>({new:say('جديد','New'),replace:say('سيستبدل القيمة الحالية','Replaces the current value'),unchanged:say('دون تغيير','Unchanged'),invalid:say('لن يُكتب','Not written')})[status];
 const nameStatus=(status:CollectionNamePreview['status'])=>({mapped:say('مربوط','Mapped'),unmapped:say('غير مربوط — لن يُكتب','Not mapped — not written'),out_of_scope:say('خارج صلاحيتك — لن يُكتب','Outside your access — not written')})[status];
 const sourceText=(source:CollectionNamePreview['mappingSource'])=>({selected:say('اختيارك','Your choice'),name:say('مطابقة الاسم','Name match'),erp:say('من مبيعات ERP','From ERP sales'),previous:say('من استيراد سابق','From an earlier import'),none:''})[source];
 const replacing=preview?.reps.filter(rep=>rep.status==='replace')||[],writes=preview?.reps.filter(rep=>rep.status==='new'||rep.status==='replace').length||0;
 const blocked=!preview||dirty||!writes||(replacing.length>0&&!replaceConfirmed);
 function changed(){setDirty(true);setError('');}
 async function selectFile(selected?:File){
  if(!selected||lock.current||pending||receipt)return;
  setError('');setUploadState(null);setPreview(null);setPreviewBody(null);setDirty(false);setReplaceConfirmed(false);setFile(null);
  if(!/\.(xls|xlsx|html?)$/i.test(selected.name)){setError(say('اختر كشف الحساب كما صدّره ERP (.xls أو .xlsx).','Choose the account statement as the ERP exported it (.xls or .xlsx).'));return;}
  if(!selected.size||selected.size>maxBytes){setError(say('حجم الملف يجب أن يكون أكبر من صفر ولا يزيد على 2 ميجابايت.','The file must not be empty and must be no larger than 2 MB.'));return;}
  lock.current=true;setBusy('read');setUploadState({phase:'reading'});
  try{const base64=await readFile(selected);if(live.current){setFile({fileName:selected.name,base64,size:selected.size});setUploadState(null);}}
  catch{if(live.current)setError(say('تعذرت قراءة الملف. اختره مرة أخرى أو أعد تصديره من ERP.','Could not read the file. Select it again or export a fresh copy from ERP.'));}
  finally{lock.current=false;if(live.current){setBusy(null);setUploadState(null);}}
 }
 async function buildPreview(){
  if(!file||lock.current||pending||receipt)return;
  lock.current=true;setBusy('preview');setError('');setUploadState({phase:'uploading',loaded:0,total:null,percent:null});
  const body:Body={month,fileName:file.fileName,base64:file.base64,replaceConfirmed:false,mappings:Object.entries(mappings).sort(([a],[b])=>a.localeCompare(b)).map(([name,repId])=>({name,repId}))};
  try{
   const result=await submitJson<Preview>(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'preview',...body})},{language,onUploadProgress:progress=>{if(live.current)setUploadState(progress);}});
   if(typeof result.planDigest!=='string'||!Array.isArray(result.reps)||!Array.isArray(result.names)||result.month!==month)throw new SubmitError(say('الخادم لم يؤكد تجهيز المعاينة. أعد المحاولة.','The server did not confirm the preview. Retry.'));
   if(!live.current)return;
   setUploadState(null);setPreview(result);setPreviewBody(body);setDirty(false);setReplaceConfirmed(false);requestAnimationFrame(()=>previewHeading.current?.focus());
  }catch(e){if(live.current){setUploadState({phase:'error'});setPreview(null);setPreviewBody(null);setError(messageOf(e));}}
  finally{lock.current=false;if(live.current)setBusy(null);}
 }
 async function refreshAfterImport(){
  if(lock.current)return;lock.current=true;setBusy('refresh');setError('');
  try{await onImported();if(live.current)setRefreshFailed(false);}
  catch{if(live.current){setRefreshFailed(true);setError(say('تم الاعتماد، لكن تعذر تحديث الشاشة. أعد تحديث العرض فقط؛ لن يُرسل الاستيراد مرة أخرى.','Saved, but the page could not refresh. Retry the refresh only; the import will not be sent again.'));}}
  finally{lock.current=false;if(live.current)setBusy(null);}
 }
 async function commit(){
  if(lock.current||!preview||!previewBody||blocked||receipt)return;
  lock.current=true;setBusy('commit');setError('');setUploadState({phase:'uploading',loaded:0,total:null,percent:null});
  // One request id for the whole attempt: resending after a lost answer is the same request, never a second import.
  if(!attempt.current)attempt.current=JSON.stringify({action:'commit',...previewBody,replaceConfirmed,planDigest:preview.planDigest,requestId:crypto.randomUUID()});
  let acknowledged=false;
  try{
   const result=await submitJson<Receipt>(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:attempt.current},{language,onUploadProgress:progress=>{if(live.current)setUploadState(progress);}});
   if(!Number.isSafeInteger(result.writtenCount)||result.month!==preview.month)throw new SubmitError(say('الخادم لم يؤكد نتيجة الاعتماد. أعد المحاولة بنفس البيانات.','The server did not confirm the result. Retry with the same entries.'));
   acknowledged=true;attempt.current=null;
   if(live.current){setUploadState({phase:'complete'});setReceipt(result);setPending(false);}
  }catch(e){
   if(!live.current)return;setUploadState({phase:'error'});
   if(definiteSubmitRejection(e)){attempt.current=null;setPending(false);setDirty(true);setPreviewBody(null);}else setPending(true);
   setError(messageOf(e));
  }finally{lock.current=false;if(live.current)setBusy(null);}
  if(acknowledged&&live.current)await refreshAfterImport();
 }
 function close(){if(!lock.current&&!pending)onClose();}
 return <Dialog open onOpenChange={open=>{if(!open)close();}}>
  <DialogContent className="crm-dialog erp-import-dialog collections-import-dialog" dir={language==='en'?'ltr':'rtl'} showCloseButton={false} onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{if(busy||pending)event.preventDefault();}}>
   <header className="erp-import-heading"><div><DialogTitle><FileSpreadsheet size={22} aria-hidden="true"/>{say('استيراد كشف التحصيل من ERP','Import the ERP collection statement')}</DialogTitle><DialogDescription className="sr-only">{say('معاينة كشف الحساب وربط المناديب قبل اعتماد التحصيل.','Preview the account statement and map representatives before saving the collection.')}</DialogDescription></div><button type="button" className="icon-button" aria-label={say('إغلاق','Close')} disabled={!!busy||pending} onClick={close}><X size={20}/></button></header>
   <div className="erp-import-scroll">
    {!options&&!optionsError?<div className="erp-import-state" role="status"><Loader2 className="spin" size={22}/>{say('جارٍ تحميل المناديب…','Loading representatives…')}</div>:!options?<div className="erp-import-state"><AlertCircle size={24}/><p>{present(optionsError)}</p><button type="button" className="btn subtle" onClick={()=>{setOptionsError('');setOptionsRevision(v=>v+1);}}><RefreshCw size={17}/>{say('إعادة المحاولة','Retry')}</button></div>:<>
     <p className="erp-import-office-note"><AlertCircle size={17} aria-hidden="true"/>{present(options.meaning)}</p>
     <section className="erp-import-file collections-import-file" aria-label={say('ملف كشف الحساب','Statement file')}>
      <label className="field" htmlFor="erp-collections-month"><span>{say('شهر التحصيل','Collection month')}</span><input id="erp-collections-month" type="month" value={month} max={options.currentMonth} required disabled={immutable} onChange={event=>{if(event.target.value){setMonth(event.target.value);changed();}}}/></label>
      <label className="field" htmlFor="erp-collections-file"><span>{say('كشف حساب ERP','ERP account statement')} · XLS · {say('حتى 2 ميجابايت','up to 2 MB')}</span><input id="erp-collections-file" type="file" accept=".xls,.xlsx,.htm,.html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html" disabled={immutable} onChange={event=>{const selected=event.target.files?.[0];event.target.value='';void selectFile(selected);}}/></label>
      {file&&<p className="erp-import-filename"><FileSpreadsheet size={17} aria-hidden="true"/><bdi>{file.fileName}</bdi><small dir="ltr">{(file.size/1024).toFixed(1)} KB</small></p>}
      {!receipt&&<button type="button" className="btn subtle" disabled={!file||immutable} onClick={buildPreview}>{busy==='read'||busy==='preview'?<Loader2 size={17} className="spin"/>:<RefreshCw size={17}/>}{say(preview?'تحديث المعاينة':'قراءة الكشف ومعاينته',preview?'Refresh preview':'Read and preview the statement')}</button>}
     </section>
     <UploadStatus state={uploadState} fileName={file?.fileName} completeLabel={say('اكتمل الاعتماد','Saved')} disabled={!!busy} onRetry={pending?commit:buildPreview}/>
     {preview&&<>
      <section className="erp-import-preview" aria-labelledby="collections-preview-heading">
       <h3 id="collections-preview-heading" ref={previewHeading} tabIndex={-1}>{say('ملخص المعاينة','Preview summary')}</h3>
       <p className="collections-import-month">{say('يُحسب للشهر','Counted for the month')} <strong><bdi>{preview.month}</bdi></strong> · {say('الكشف لا يحمل تاريخًا؛ اختيار الشهر منك.','The statement carries no date; the month is your choice.')}{preview.title&&<> · <bdi>{preview.title}</bdi></>}</p>
       {preview.closedMonth&&<p className="erp-import-notice" role="note">{say('هذا شهر منتهٍ؛ بصفتك مدير النظام يمكنك الاعتماد، ويُسجَّل ذلك في السجل.','This month has ended. As the system administrator you can save it; the audit records it.')}</p>}
       <div className="erp-import-counts" aria-live="polite">{[[say('الحسابات','Accounts'),preview.summary.rows],[say('المناديب','Representatives'),preview.summary.reps],[say('جديد','New'),preview.summary.newCount],[say('استبدال','Replace'),preview.summary.replaceCount],[say('دون تغيير','Unchanged'),preview.summary.unchangedCount]].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}</div>
       <div className="erp-import-summary"><p>{say('المستحق المعتمد','Due to save')}<strong dir="ltr">{money(preview.summary.dueCents)} {say('ر.س','SAR')}</strong></p><p>{say('المحصل المعتمد','Collected to save')}<strong dir="ltr">{money(preview.summary.collectedCents)} {say('ر.س','SAR')}</strong></p></div>
       {dirty&&<p className="erp-import-notice" role="status">{say('تغيّر الشهر أو الربط؛ حدّث المعاينة قبل الاعتماد.','The month or the mappings changed. Refresh the preview before saving.')}</p>}
      </section>
      {!!preview.warnings.length&&<div className="erp-import-warnings" role="note"><strong>{say('ملاحظات الكشف','Statement notes')}</strong><ul>{preview.warnings.map((w,i)=><li key={i}>{present(w)}</li>)}</ul></div>}
      {!!preview.names.length&&<section className="erp-import-mappings" aria-labelledby="collections-mapping"><h3 id="collections-mapping">{say('ربط الأسماء بالمناديب','Map names to representatives')}</h3><div className="erp-import-map-list">{preview.names.map(name=>{
       const value=mappings[name.name]??name.repId;
       return <label className="erp-import-map-row" key={name.key}><span><strong>{name.name}</strong><small>{name.accounts} {say('حساب','accounts')}{name.fromCollector?' · '+say('من المحصل','from the collector')+': '+name.fromCollector:''}{name.mismatches?' · '+say('لا تتطابق أرصدتها','balances do not add up')+': '+name.mismatches:''} · {nameStatus(name.status)}{name.mappingSource!=='none'&&name.status==='mapped'?' · '+sourceText(name.mappingSource):''}</small></span>
        <select value={value} disabled={immutable} aria-label={say('مندوب الاسم ','Representative for ')+name.name} onChange={event=>{const next=event.target.value;setMappings(current=>{const copy={...current};if(next)copy[name.name]=next;else delete copy[name.name];return copy;});changed();}}>
         <option value="">{say('اختر المندوب','Choose a representative')}</option>
         {options.members.filter(m=>m.active||m.id===value).map(m=><option key={m.id} value={m.id}>{m.name}{m.branch?' · '+m.branch:''}{m.active?'':' · '+say('معطل','inactive')}</option>)}
        </select></label>;})}</div></section>}
      <section className="erp-import-documents" aria-labelledby="collections-reps-heading"><div className="erp-import-section-heading"><h3 id="collections-reps-heading">{say('التحصيل لكل مندوب','Collection by representative')}</h3></div>
       {!preview.reps.length?<p className="erp-import-hint">{say('لا يوجد مندوب مربوط في هذا الكشف.','No representative is mapped in this statement.')}</p>:<div className="erp-import-table-wrap"><table className="erp-import-table"><thead><tr>{[say('المندوب','Representative'),say('الحسابات','Accounts'),say('المستحق · ر.س','Due · SAR'),say('المحصل · ر.س','Collected · SAR'),say('نسبة التحصيل','Rate'),say('الحالة','Status')].map(label=><th key={label}>{label}</th>)}</tr></thead>
        <tbody>{preview.reps.map(rep=><tr key={rep.repId}><td><strong>{rep.repName}</strong><small>{rep.branch}</small>{rep.names.length>1&&<small>{rep.names.join('، ')}</small>}</td><td dir="ltr">{rep.accounts}</td><td className="erp-import-amount" dir="ltr">{money(rep.dueCents)}</td><td className="erp-import-amount" dir="ltr">{money(rep.collectedCents)}</td><td dir="ltr">{rep.percent===null?'—':rep.percent.toFixed(2)+'%'}</td><td><span className={'erp-import-badge collections-'+rep.status}>{statusText(rep.status)}</span>{rep.status==='replace'&&rep.current&&<small>{say('سيستبدل القيمة الحالية','Replaces the current value')} (<bdi dir="ltr">{money(rep.current.dueCents)} / {money(rep.current.collectedCents)}</bdi>)</small>}{rep.status==='invalid'&&<small>{present(rep.reason)}</small>}{rep.mismatches>0&&<small>{say('حسابات لا تتطابق أرصدتها','Accounts whose balances do not add up')}: {rep.mismatches}</small>}</td></tr>)}</tbody></table></div>}
       <div className="erp-import-cards">{preview.reps.map(rep=><article className="erp-import-document-card" key={rep.repId}><div><strong>{rep.repName}</strong><span className={'erp-import-badge collections-'+rep.status}>{statusText(rep.status)}</span></div><small>{rep.branch} · {rep.accounts} {say('حساب','accounts')}</small><p>{say('المستحق','Due')}: <bdi dir="ltr">{money(rep.dueCents)}</bdi> · {say('المحصل','Collected')}: <bdi dir="ltr">{money(rep.collectedCents)}</bdi> · <bdi dir="ltr">{rep.percent===null?'—':rep.percent.toFixed(2)+'%'}</bdi></p>{rep.status==='replace'&&rep.current&&<small>{say('سيستبدل القيمة الحالية','Replaces the current value')} (<bdi dir="ltr">{money(rep.current.dueCents)} / {money(rep.current.collectedCents)}</bdi>)</small>}{rep.status==='invalid'&&<small>{present(rep.reason)}</small>}</article>)}</div>
      </section>
      {replacing.length>0&&!receipt&&<label className="erp-import-skip"><input type="checkbox" checked={replaceConfirmed} disabled={immutable||dirty} onChange={event=>{setReplaceConfirmed(event.target.checked);setError('');}}/><span><strong>{say('استبدال القيم الحالية','Replace the current values')}</strong><small>{say(`أوافق على استبدال تحصيل ${replacing.length} مندوب المحفوظ لهذا الشهر بقيم الكشف.`,`I agree to replace the saved collection of ${replacing.length} representatives for this month with the statement's values.`)}</small></span></label>}
     </>}
    </>}
   </div>
   <footer className="erp-import-footer">
    {!!error&&<p className="form-error" role="alert">{present(error)}</p>}
    {pending&&<p className="erp-import-notice" role="status">{say('لم يتأكد الحفظ بسبب الاتصال. البيانات مثبتة؛ اضغط «تأكيد الحفظ» لإعادة نفس الطلب دون تكرار.','The connection did not confirm the save. Your data is locked; choose “Confirm save” to retry the same request without duplicates.')}</p>}
    {receipt&&<div className="erp-import-success" role="status"><CheckCircle2 size={21}/><div><strong>{say('تم اعتماد التحصيل','Collection saved')}</strong><p>{say('كُتب لـ','Written for')} {receipt.writtenCount} {say('مندوب','representatives')} · {say('جديد','New')}: {receipt.newCount} · {say('استبدال','Replaced')}: {receipt.replaceCount} · {say('دون تغيير','Unchanged')}: {receipt.unchangedCount}{receipt.skippedNames?<> · {say('أسماء لم تُكتب','Names not written')}: {receipt.skippedNames}</>:null}</p><small>{say('الشهر','Month')}: <bdi>{receipt.month}</bdi></small></div></div>}
    <div className="erp-import-actions"><button type="button" className="btn subtle" disabled={!!busy||pending} onClick={close}>{say(receipt?'تم':'إغلاق',receipt?'Done':'Close')}</button>
     {receipt?refreshFailed&&<button type="button" className="btn primary" disabled={!!busy} onClick={refreshAfterImport}>{busy==='refresh'?<Loader2 className="spin" size={17}/>:<RefreshCw size={17}/>} {say('تحديث العرض فقط','Refresh view only')}</button>:
      dirty&&!pending?<button type="button" className="btn primary" disabled={!file||immutable} onClick={buildPreview}>{busy==='preview'?<Loader2 className="spin" size={17}/>:<RefreshCw size={17}/>} {say('تحديث المعاينة','Refresh preview')}</button>:
      <button type="button" className="btn primary" disabled={!!busy||(!pending&&blocked)} onClick={commit}>{busy==='commit'?<Loader2 className="spin" size={17}/>:<Upload size={17}/>} {pending?say('تأكيد الحفظ','Confirm save'):say('اعتماد','Approve')}</button>}
    </div>
   </footer>
  </DialogContent>
 </Dialog>;
}

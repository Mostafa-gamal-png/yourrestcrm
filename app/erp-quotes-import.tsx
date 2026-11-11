'use client';

// «استيراد عروض الأسعار من ERP» on the targets page, beside «استيراد مبيعات ERP» (app/sales-workspace.tsx; POST /api/erp-quotes, lib/erp-quotes-server.ts): the ERP's quotations report (its
// HTML «.xls», or the same columns as .xlsx) is read and previewed (added, updated, unchanged, edited in the CRM and left alone, refused
// with the row and the reason; the customers of the file the CRM does not have; the ERP employees and the representatives they are mapped
// to), then imported in one step. The pattern is the ERP sales import's (app/erp-sales-import.tsx, whose styles it shares): the preview is
// what the import does, a retried import is the same request (never twice), and the screen is refreshed from the server after it.
// «مبيعات مكتب» quotations are excluded automatically (another company's), counted under «مستبعدة». A customer code that more than one
// CRM customer carries is listed under «أكواد مشتركة بين أكثر من عميل»: the administrator who may map identities chooses the right
// customer there (app/erp-code-choice.tsx, saved on its own through /api/customer-identities, then the file is previewed again); each
// quotation refused for it jumps to its code; anyone else reads that the administrator has to choose.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { definiteSubmitRejection, submitJson, SubmitError } from '@/lib/client-submit';
import { t, useLanguage } from '@/lib/i18n';
import UploadStatus, {type UploadState} from './upload-status';
import ErpCodeChoice, {type ErpSharedCode} from './erp-code-choice';
import './erp-sales-import.css';
import './erp-quotes-import.css';
const messageOf = (e: unknown) => typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' ? e.message : '';

type Member = { id: string; name: string; branch: string };
type Options = { members: Member[]; employeeMappings: { employeeId: string; repId: string }[] };
type Status = 'new' | 'update' | 'unchanged' | 'edited' | 'refused' | 'excluded';
type Quotation = { key: string; code: string; rows: number[]; date: string; customerCode: string; customerCodeKey: string; customerName: string; lineCount: number; totalCents: number; status: Status; reason: string; employeeCode: string; employeeName: string; repName: string; totalsDiffer: boolean };
type Employee = { employeeId: string; employeeName: string; quotations: number; repId: string; savedOutside: boolean; mappingSource: 'saved' | 'selected' | 'name' | 'unmapped' };
type Preview = {
  previewToken: string; quotations: Quotation[]; rowProblems: { row: number; reason: string }[]; employees: Employee[];
  missingCustomers: { customerCode: string; customerName: string; quotations: number }[];
  sharedCodes: { canMap: boolean; revision: number; codes: ErpSharedCode[] };
  summary: { quotations: number; lines: number; newCount: number; updateCount: number; unchangedCount: number; editedCount: number; excludedCount: number; refusedCount: number; rowProblems: number; deletedRows: number; totalsDiffer: number };
};
type Body = { fileName: string; base64: string; employeeMappings: { employeeId: string; repId: string }[] };
type Receipt = { addedCount: number; updatedCount: number; unchangedCount: number; editedCount: number; excludedCount?: number; refusedCount: number; mappingsSaved: number; alreadySaved?: boolean };
type Props = { onClose: () => void; onImported: () => void | Promise<void> };
const endpoint = '/api/erp-quotes';
const maxBytes = 5 * 1024 * 1024;
const SHARED_CODE_REASON = 'كود العميل مسجل لأكثر من عميل في الـCRM؛ اربطه بعميل واحد أولًا';
const english: Record<string, string> = {
  'عُدِّل في الـCRM، تُرك كما هو': 'Edited in the CRM; left as it is.',
  'مطابق للمحفوظ؛ لا تغيير': 'Same as saved; no change.',
  'تغيّر في ERP؛ سيُحدَّث العرض المحفوظ': 'Changed in ERP; the saved quotation will be updated.',
  'عرض جديد؛ سيُضاف إلى عروض أسعار العميل': 'New; it will be added to the customer\'s quotations.',
  'العميل غير موجود في الـCRM بكود ERP هذا؛ أضفه أو حدّث كوده من «استيراد من ERP» في العملاء': 'No CRM customer has this ERP code. Add the customer or update its code with «Import from ERP» on Customers.',
  'كود العميل مسجل لأكثر من عميل في الـCRM؛ اربطه بعميل واحد أولًا': 'This ERP customer code belongs to more than one CRM customer. Map it to one customer first.',
  'مبيعات مكتب: عروض شركة أخرى مستبعدة تلقائيًا': 'Office sales: another company’s quotations, excluded automatically.',
  'العميل خارج منطقتك': 'The customer is outside your region.',
  'اربط موظف ERP بمندوب': 'Map the ERP employee to a rep.',
  'المندوب المرتبط خارج نطاق فريقك أو منطقتك': 'The mapped rep is outside your team or region.',
  'رقم العرض مستخدم لعرض سعر أُنشئ في الـCRM؛ لن يُستبدل': 'A quotation created in the CRM has this number; it will not be replaced.',
  'العرض محفوظ لمندوب خارج نطاق فريقك؛ لن يُعدَّل': 'The quotation is saved for a rep outside your team; it will not be changed.',
  'تغيّر عميل العرض في ERP؛ لن يُنقل العرض المحفوظ إلى عميل آخر تلقائيًا': 'The quotation\'s customer changed in ERP; the saved quotation is not moved to another customer automatically.',
  'سطر بلا رقم عرض (Code)': 'A line without a quotation number (Code).',
  'ربط هذا الموظف محفوظ من استيراد مبيعات ERP؛ يُعدَّل من شاشة استيراد المبيعات': 'This employee\'s mapping was saved by the ERP sales import; change it there.',
  'انتهت المعاينة أو تغيّرت البيانات أو الصلاحيات منذ عرضها؛ اعرض الملف مرة أخرى': 'The preview expired, or the data or permissions changed since. Preview the file again.',
  'تغيّرت البيانات أو الصلاحيات أثناء الحفظ؛ اعرض الملف مرة أخرى': 'The data or permissions changed while saving. Preview the file again.',
  'اعرض الملف أولًا قبل تأكيد الاستيراد': 'Preview the file before confirming the import.',
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('FILE_READ_FAILED'));
    reader.onabort = () => reject(new Error('FILE_READ_FAILED'));
    reader.onload = () => {
      const result = String(reader.result || ''), separator = result.indexOf(',');
      if (separator < 0 || !result.slice(separator + 1)) reject(new Error('FILE_READ_FAILED'));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function ErpQuotesImport({ onClose, onImported }: Props) {
  const { language } = useLanguage();
  const say = (ar: string, en: string) => language === 'en' ? en : ar;
  const present = (value: string) => language === 'en' ? english[value] || t(value) : value;
  const [options, setOptions] = useState<Options | null>(null);
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [file, setFile] = useState<{ fileName: string; base64: string; size: number } | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBody, setPreviewBody] = useState<Body | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'read' | 'preview' | 'commit' | 'refresh' | 'mapping' | null>(null);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [page, setPage] = useState(1);
  const lock = useRef(false), attempt = useRef<string | null>(null), saved = useRef(false), live = useRef(true);
  const previewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    submitJson<Options>(endpoint, { cache: 'no-store', signal: controller.signal }, { language }).then(data => {
      if (controller.signal.aborted) return;
      setOptions(data); setError('');
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
    // Changing the language must not discard an import in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsRevision]);

  const immutable = !!busy || pending || !!receipt;
  const ready = (preview?.summary.newCount || 0) + (preview?.summary.updateCount || 0);
  const list = useMemo(() => (preview?.quotations || []).filter(q => filter === 'all' || q.status === filter), [preview, filter]);
  const pages = Math.max(1, Math.ceil(list.length / 20)), currentPage = Math.min(page, pages);
  const visible = list.slice((currentPage - 1) * 20, currentPage * 20);
  const money = (cents: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
  const statusText = (status: Status) => ({
    new: say('ستُضاف', 'To add'), update: say('ستُحدَّث', 'To update'), unchanged: say('بلا تغيير', 'Unchanged'),
    edited: say('عُدِّلت في الـCRM', 'Edited in the CRM'), refused: say('مرفوضة', 'Refused'), excluded: say('مستبعدة', 'Excluded'),
  })[status];
  const sharedCodeId = (codeKey: string) => 'erp-quotes-code-' + (preview?.sharedCodes.codes.findIndex(code => code.codeKey === codeKey) ?? -1);
  const isSharedCode = (q: Quotation) => q.status === 'refused' && q.reason === SHARED_CODE_REASON && !!preview?.sharedCodes.codes.some(code => code.codeKey === q.customerCodeKey);
  function toSharedCode(codeKey: string) {
    const target = document.getElementById(sharedCodeId(codeKey));
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    (target.querySelector('input:checked,input,button') as HTMLElement | null)?.focus({ preventScroll: true });
  }
  /** A mapping is saved on its own (app/erp-code-choice.tsx); the screen is locked while it is sent, then the file is previewed again. */
  function mappingSaving(saving: boolean) {
    lock.current = saving;
    setBusy(saving ? 'mapping' : null);
  }

  async function selectFile(selected?: File) {
    if (!selected || lock.current || pending || receipt) return;
    setError(''); setUploadState(null); setPreview(null); setPreviewBody(null); setDirty(false); setFile(null); setPage(1); setFilter('all'); setChoices({});
    if (!/\.(xls|xlsx)$/i.test(selected.name)) { setError(say('اختر تقرير عروض الأسعار من ERP بصيغة .xls أو .xlsx.', 'Choose the ERP quotations report as .xls or .xlsx.')); return; }
    if (!selected.size || selected.size > maxBytes) { setError(say('حجم الملف يجب أن يكون أكبر من صفر ولا يزيد عن 5 ميجابايت.', 'The file must not be empty and must be no larger than 5 MB.')); return; }
    lock.current = true; setBusy('read'); setUploadState({ phase: 'reading' });
    try {
      const base64 = await readFile(selected);
      if (live.current) { setFile({ fileName: selected.name, base64, size: selected.size }); setUploadState(null); }
    } catch {
      if (live.current) setError(say('تعذرت قراءة الملف. اختره مرة أخرى أو أعد تصديره من ERP.', 'Could not read the file. Select it again or export a fresh copy from ERP.'));
    } finally { lock.current = false; if (live.current) { setBusy(null); setUploadState(null); } }
  }

  function choose(employeeId: string, repId: string) {
    if (immutable || lock.current) return;
    setChoices(current => { const next = { ...current }; if (repId) next[employeeId] = repId; else delete next[employeeId]; return next; });
    setDirty(true); setError('');
  }

  async function buildPreview() {
    if (!file || !options || lock.current || pending || receipt) return;
    lock.current = true; setBusy('preview'); setError(''); setUploadState({ phase: 'uploading', loaded: 0, total: null, percent: null });
    // The whole request is captured: the import always refers to exactly this preview.
    const body: Body = { fileName: file.fileName, base64: file.base64, employeeMappings: Object.entries(choices).sort(([a], [b]) => a.localeCompare(b)).map(([employeeId, repId]) => ({ employeeId, repId })) };
    try {
      const result = await submitJson<Preview>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', ...body }) }, { language, onUploadProgress: progress => { if (live.current) setUploadState(progress); } });
      if (typeof result.previewToken !== 'string' || !result.previewToken || !Array.isArray(result.quotations) || !result.summary) throw new SubmitError(say('الخادم لم يؤكد تجهيز المعاينة. أعد المحاولة.', 'The server did not confirm the preview. Retry.'));
      if (!live.current) return;
      setUploadState(null); setPreview(result); setPreviewBody(body); setDirty(false); setFilter('all'); setPage(1);
      requestAnimationFrame(() => previewHeading.current?.focus());
    } catch (e) {
      if (live.current) { setUploadState({ phase: 'error' }); setPreviewBody(null); setDirty(true); setError(messageOf(e)); }
    } finally { lock.current = false; if (live.current) setBusy(null); }
  }

  async function refreshAfterImport() {
    if (lock.current) return;
    lock.current = true; setBusy('refresh'); setError('');
    try { await onImported(); if (live.current) setRefreshFailed(false); }
    catch { if (live.current) { setRefreshFailed(true); setError(say('تم الاستيراد، لكن تعذر تحديث البيانات. أعد تحديث العرض فقط؛ لن يُرسل الاستيراد مرة أخرى.', 'Import completed, but the data could not refresh. Retry the refresh only; the import will not be sent again.')); } }
    finally { lock.current = false; if (live.current) setBusy(null); }
  }

  async function commit() {
    if (lock.current || saved.current || !preview || !previewBody || dirty || !ready) return;
    lock.current = true; setBusy('commit'); setError(''); setUploadState({ phase: 'uploading', loaded: 0, total: null, percent: null });
    if (!attempt.current) attempt.current = JSON.stringify({ action: 'commit', ...previewBody, previewToken: preview.previewToken, requestId: crypto.randomUUID() });
    let acknowledged = false;
    try {
      const result = await submitJson<Receipt>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: attempt.current }, { language, onUploadProgress: progress => { if (live.current) setUploadState(progress); } });
      if (!['addedCount', 'updatedCount', 'unchangedCount', 'editedCount', 'refusedCount'].every(key => Number.isSafeInteger(result[key as keyof Receipt]) && Number(result[key as keyof Receipt]) >= 0)) throw new SubmitError(say('الخادم لم يؤكد نتيجة الاستيراد. أعد المحاولة بالبيانات نفسها.', 'The server did not confirm the import result. Retry with the same entries.'));
      saved.current = true; acknowledged = true; attempt.current = null;
      if (live.current) { setUploadState({ phase: 'complete' }); setReceipt(result); setPending(false); }
    } catch (e) {
      if (!live.current) return;
      setUploadState({ phase: 'error' });
      if (definiteSubmitRejection(e)) { attempt.current = null; setPending(false); setDirty(true); setPreviewBody(null); }
      else setPending(true);
      setError(messageOf(e));
    } finally { lock.current = false; if (live.current) setBusy(null); }
    // Once the server acknowledged the write, only the refresh may be retried.
    if (acknowledged && live.current) await refreshAfterImport();
  }

  function close() { if (!lock.current && !pending) onClose(); }
  const repLabel = (q: Quotation) => q.repName || '—';
  /** Under a quotation refused for a shared code: the way to its code's choice, or (to anyone who may not map) who has to choose. */
  const sharedCodeHelp = (q: Quotation) => !isSharedCode(q) ? null : preview?.sharedCodes.canMap
    ? <button type="button" className="btn subtle small erp-quotes-code-jump" disabled={!!busy || pending || !!receipt} onClick={() => toSharedCode(q.customerCodeKey)}>{say('اختيار العميل الصحيح لهذا الكود', 'Choose the right customer for this code')}</button>
    : <small className="erp-quotes-code-wait">{say('يحتاج مدير النظام إلى اختيار العميل الصحيح لهذا الكود.', 'The system administrator needs to choose the right customer for this code.')}</small>;

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="crm-dialog erp-import-dialog erp-quotes-import" dir={language === 'en' ? 'ltr' : 'rtl'} showCloseButton={false}
      onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy || pending) event.preventDefault(); }}>
      <header className="erp-import-heading">
        <div><DialogTitle><FileSpreadsheet size={22} aria-hidden="true"/>{say('استيراد عروض الأسعار من ERP', 'Import quotations from ERP')}</DialogTitle>
          <DialogDescription className="sr-only">{say('معاينة تقرير عروض الأسعار وربط موظفي ERP بالمناديب قبل الاستيراد.', 'Preview the quotations report and map ERP employees to reps before importing.')}</DialogDescription></div>
        <button type="button" className="icon-button" aria-label={say('إغلاق', 'Close')} disabled={!!busy || pending} onClick={close}><X size={20}/></button>
      </header>

      <div className="erp-import-scroll">
        {optionsLoading ? <div className="erp-import-state" role="status"><Loader2 className="spin" size={22}/>{say('جارٍ تحميل المناديب والربط المحفوظ…', 'Loading reps and saved mappings…')}</div> : !options ?
          <div className="erp-import-state"><AlertCircle size={24}/><p>{say('تعذر تحميل المناديب والربط المحفوظ.', 'Could not load reps and saved mappings.')}</p><button type="button" className="btn subtle" onClick={() => { setOptionsLoading(true); setOptionsRevision(value => value + 1); }}><RefreshCw size={17}/>{say('إعادة المحاولة', 'Retry')}</button></div> : <>
          <p className="erp-import-office-note"><AlertCircle size={17} aria-hidden="true"/>{say('كل عرض في الملف يصبح عرض سعر واحدًا لعميله، ورقمه رقم ERP. الملف نفسه مرة أخرى لا يغيّر شيئًا، والعرض المعدَّل في الـCRM لا يُستبدل، ولا يُحذف شيء ولا يُضاف عميل. وتُستبعد عروض «مبيعات مكتب» تلقائيًا لأنها تخص شركات أخرى.', 'Each quotation in the file becomes one quotation of its customer, numbered as in ERP. The same file again changes nothing, a quotation edited in the CRM is not replaced, nothing is deleted and no customer is added. “Office sales” quotations belong to other companies and are excluded automatically.')}</p>
          <section className="erp-import-file" aria-label={say('ملف عروض الأسعار', 'Quotations file')}>
            <label className="field" htmlFor="erp-quotes-report"><span>{say('تقرير عروض الأسعار من ERP', 'ERP quotations report')} · XLS / XLSX · {say('حتى 5 ميجابايت', 'up to 5 MB')}</span>
              <input id="erp-quotes-report" type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={immutable} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; void selectFile(selected); }}/></label>
            {file && <p className="erp-import-filename"><FileSpreadsheet size={17} aria-hidden="true"/><bdi>{file.fileName}</bdi><small dir="ltr">{(file.size / 1024).toFixed(1)} KB</small></p>}
            {!receipt && <button type="button" className="btn subtle" disabled={!file || immutable} onClick={buildPreview}>
              {busy === 'read' || busy === 'preview' ? <Loader2 size={17} className="spin"/> : <RefreshCw size={17}/>}
              {say(preview ? 'تحديث المعاينة' : 'قراءة الملف ومعاينته', preview ? 'Refresh preview' : 'Read and preview file')}
            </button>}
          </section>

          <UploadStatus state={uploadState} fileName={file?.fileName} completeLabel={say('اكتمل الاستيراد', 'Import complete')} disabled={!!busy} onRetry={pending ? commit : buildPreview}/>

          {preview && <>
            <section className="erp-import-preview" aria-labelledby="erp-quotes-preview-heading">
              <h3 id="erp-quotes-preview-heading" ref={previewHeading} tabIndex={-1}>{say('ملخص المعاينة', 'Preview summary')}</h3>
              <div className="erp-import-counts erp-quotes-counts" aria-live="polite">
                {([['new', preview.summary.newCount], ['update', preview.summary.updateCount], ['unchanged', preview.summary.unchangedCount], ['edited', preview.summary.editedCount], ['excluded', preview.summary.excludedCount ?? 0], ['refused', preview.summary.refusedCount]] as const).map(([status, value]) => <div key={status} data-status={status}><span>{statusText(status)}</span><strong>{value}</strong></div>)}
              </div>
              <p className="erp-import-hint">{say(`في الملف ${preview.summary.quotations} عرضًا في ${preview.summary.lines} بندًا.`, `The file holds ${preview.summary.quotations} quotations in ${preview.summary.lines} lines.`)}{preview.summary.deletedRows ? ' ' + say(`تُرك ${preview.summary.deletedRows} بندًا محذوفًا في ERP.`, `${preview.summary.deletedRows} lines deleted in ERP were left out.`) : ''}{preview.summary.totalsDiffer ? ' ' + say(`${preview.summary.totalsDiffer} عرضًا يختلف حساب الـCRM لإجمالياته عن ERP بأكثر من هللة؛ تُحفظ أرقام ERP كما هي ويُشار إلى ذلك في العرض.`, `${preview.summary.totalsDiffer} quotations whose CRM totals differ from ERP by more than a halala; the ERP figures are kept and the quotation says so.`) : ''}</p>
              {dirty && <p className="erp-import-notice" role="status">{say('تغيّر الربط؛ حدّث المعاينة قبل الاستيراد.', 'Mappings changed. Refresh the preview before importing.')}</p>}
            </section>

            {!!preview.missingCustomers.length && <section className="erp-import-mappings" aria-labelledby="erp-quotes-missing">
              <h3 id="erp-quotes-missing">{say('عملاء في الملف غير موجودين في الـCRM', 'Customers of the file not in the CRM')}</h3>
              <p className="erp-import-hint">{say('عروضهم مرفوضة ولن يُضاف أي عميل. أضف العميل أو حدّث كود ERP الخاص به من «استيراد من ERP» في صفحة العملاء، ثم ارفع الملف مرة أخرى.', 'Their quotations are refused and no customer is added. Add the customer or update its ERP code with «Import from ERP» on Customers, then upload the file again.')}</p>
              <ul className="erp-quotes-missing">{preview.missingCustomers.map(item => <li key={item.customerCode}><strong><bdi>{item.customerName || '—'}</bdi></strong><small>{say('كود ERP', 'ERP code')}: <bdi>{item.customerCode}</bdi> · {item.quotations} {say('عرض', 'quotations')}</small></li>)}</ul>
            </section>}

            {!!preview.sharedCodes?.codes.length && <section className="erp-import-mappings" aria-labelledby="erp-quotes-shared">
              <h3 id="erp-quotes-shared">{say('أكواد مشتركة بين أكثر من عميل', 'Codes shared by more than one customer')}</h3>
              <p className="erp-import-hint">{preview.sharedCodes.canMap
                ? say('كل كود هنا مسجل لأكثر من عميل في الـCRM، وعروضه مرفوضة حتى يُختار العميل الصحيح. اختر العميل ثم «حفظ الربط»؛ يُحفظ الربط فورًا وتُعاد المعاينة.', 'Each code here belongs to more than one CRM customer, and its quotations are refused until the right customer is chosen. Choose the customer, then “Save mapping”; the mapping is saved at once and the file is previewed again.')
                : say('عروض هذه الأكواد مرفوضة لأن كل كود مسجل لأكثر من عميل في الـCRM. يحتاج مدير النظام إلى اختيار العميل الصحيح لكل كود، ثم ارفع الملف مرة أخرى.', 'These codes\' quotations are refused because each code belongs to more than one CRM customer. The system administrator needs to choose the right customer for each code; then upload the file again.')}</p>
              <div className="erp-import-map-list">{preview.sharedCodes.codes.map((code, index) => <ErpCodeChoice key={code.codeKey} id={'erp-quotes-code-' + index} code={code} revision={preview.sharedCodes.revision} canMap={preview.sharedCodes.canMap}
                disabled={!!busy || pending || !!receipt} countLabel={say(`${code.quotations} عرض في الملف`, code.quotations === 1 ? '1 quotation in the file' : `${code.quotations} quotations in the file`)} onSaving={mappingSaving} onSaved={buildPreview}/>)}</div>
            </section>}

            {!!preview.employees.length && <section className="erp-import-mappings" aria-labelledby="erp-quotes-employees">
              <h3 id="erp-quotes-employees">{say('ربط موظفي ERP بالمناديب', 'Map ERP employees to reps')}</h3>
              <div className="erp-import-map-list">{preview.employees.map(employee => {
                const value = choices[employee.employeeId] || employee.repId || '';
                const fixed = employee.mappingSource === 'saved' || employee.savedOutside;
                return <label className="erp-import-map-row" key={employee.employeeId}><span><strong>{employee.employeeName ? <bdi>{employee.employeeName}</bdi> : say('اسم الموظف فارغ', 'Employee name is blank')}</strong><small>{say('رقم الموظف', 'Employee number')}: <bdi>{employee.employeeId}</bdi> · {employee.quotations} {say('عرض', 'quotations')}{employee.mappingSource === 'saved' ? ' · ' + say('ربط محفوظ من استيراد المبيعات', 'Saved by the sales import') : ''}</small></span>
                  <select value={value} disabled={immutable || fixed} aria-label={say('مندوب الموظف ', 'Rep for employee ') + (employee.employeeName || employee.employeeId)} onChange={event => choose(employee.employeeId, event.target.value)}>
                    <option value="">{employee.savedOutside ? say('المندوب المحفوظ خارج نطاقك', 'The saved rep is outside your access') : say('اختر المندوب', 'Choose a rep')}</option>
                    {options.members.map(member => <option key={member.id} value={member.id}>{member.name}{member.branch ? ' · ' + member.branch : ''}</option>)}
                  </select>
                  {employee.mappingSource === 'name' && employee.repId === value && <small className="erp-import-map-hint">{say('مطابقة تلقائية للاسم؛ تُحفظ مع الاستيراد', 'Automatic name match; saved with the import')}</small>}
                  {fixed && <small className="erp-import-map-hint">{say('يُعدَّل هذا الربط من شاشة استيراد مبيعات ERP.', 'This mapping is changed from the ERP sales import.')}</small>}
                </label>;
              })}</div>
            </section>}

            {!!preview.rowProblems.length && <div className="erp-import-warnings" role="note"><strong>{say('أسطر لم تُقرأ', 'Lines not read')}</strong><ul>{preview.rowProblems.map(problem => <li key={problem.row}>{say('السطر', 'Line')} {problem.row}: {present(problem.reason)}</li>)}</ul></div>}

            <section className="erp-import-documents" aria-labelledby="erp-quotes-list">
              <div className="erp-import-section-heading"><h3 id="erp-quotes-list">{say('عروض الملف', 'Quotations in the file')}</h3>
                <label className="erp-import-filter"><span>{say('عرض', 'Show')}</span><select value={filter} onChange={event => { setFilter(event.target.value as typeof filter); setPage(1); }}>
                  <option value="all">{say('الكل', 'All')}</option>{(['new', 'update', 'unchanged', 'edited', 'excluded', 'refused'] as const).map(value => <option key={value} value={value}>{statusText(value)}</option>)}
                </select></label>
              </div>
              <div className="erp-import-table-wrap"><table className="erp-import-table"><thead><tr>{[say('رقم العرض / التاريخ', 'Number / date'), say('العميل', 'Customer'), say('الموظف ← المندوب', 'Employee → rep'), say('الإجمالي · ر.س', 'Total · SAR'), say('الحالة', 'Status')].map(label => <th key={label}>{label}</th>)}</tr></thead>
                <tbody>{visible.map(q => <tr key={q.key} data-status={q.status}><td><strong><bdi>{q.code}</bdi></strong><small dir="ltr">{q.date || '—'}</small><small>{say('السطر', 'Line')} {q.rows.join(say('، ', ', '))}</small></td><td><bdi>{q.customerName || '—'}</bdi><small>{say('كود ERP', 'ERP code')}: <bdi>{q.customerCode || '—'}</bdi> · {q.lineCount} {say('بند', 'lines')}</small></td><td><bdi>{q.employeeName || q.employeeCode || '—'}</bdi><small><bdi>{repLabel(q)}</bdi></small></td><td className="erp-import-amount" dir="ltr">{money(q.totalCents)}</td><td><span className={'erp-import-badge erp-quote-' + q.status}>{statusText(q.status)}</span>{q.reason && <small>{present(q.reason)}</small>}{sharedCodeHelp(q)}{q.totalsDiffer && q.status !== 'refused' && q.status !== 'excluded' && <small>{say('يختلف حساب الـCRM عن ERP؛ تُحفظ أرقام ERP.', 'CRM totals differ from ERP; the ERP figures are kept.')}</small>}</td></tr>)}</tbody></table></div>
              <div className="erp-import-cards">{visible.map(q => <article className="erp-import-document-card" key={q.key} data-status={q.status}><div><strong><bdi>{q.code}</bdi></strong><span className={'erp-import-badge erp-quote-' + q.status}>{statusText(q.status)}</span></div><p><bdi>{q.customerName || '—'}</bdi></p><small><bdi>{q.date || '—'}</bdi> · {q.lineCount} {say('بند', 'lines')} · {say('السطر', 'Line')} {q.rows.join(say('، ', ', '))}</small><p><bdi>{q.employeeName || q.employeeCode || '—'}</bdi><span aria-hidden="true"> · </span><bdi>{repLabel(q)}</bdi></p><strong className="erp-import-amount" dir="ltr">{money(q.totalCents)} {say('ر.س', 'SAR')}</strong>{q.reason && <small>{present(q.reason)}</small>}{sharedCodeHelp(q)}</article>)}</div>
              {!list.length && <p className="erp-import-hint">{say('لا توجد عروض بهذه الحالة.', 'No quotations match this status.')}</p>}
              {pages > 1 && <nav className="erp-import-pagination" aria-label={say('صفحات المعاينة', 'Preview pages')}><button type="button" className="btn subtle small" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{say('السابق', 'Previous')}</button><span dir="ltr">{currentPage} / {pages}</span><button type="button" className="btn subtle small" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>{say('التالي', 'Next')}</button></nav>}
            </section>
          </>}
        </>}
      </div>

      <footer className="erp-import-footer">
        {!!error && <p className="form-error" role="alert">{present(error)}</p>}
        {pending && <p className="erp-import-notice" role="status">{say('لم يتأكد الحفظ بسبب الاتصال. البيانات مثبتة؛ اضغط «تأكيد الحفظ» لإعادة الطلب نفسه بدون تكرار.', 'The connection did not confirm the import. Your data is locked; choose “Confirm save” to retry the same request without duplicates.')}</p>}
        {preview && !receipt && !ready && !dirty && <p className="erp-import-notice" role="status">{say('لا يوجد في الملف عرض جديد أو متغيّر للاستيراد.', 'The file has no new or changed quotation to import.')}</p>}
        {receipt && <div className="erp-import-success" role="status"><CheckCircle2 size={21}/><div><strong>{say('تم تأكيد الاستيراد', 'Import confirmed')}</strong><p>{say('أُضيفت', 'Added')}: {receipt.addedCount} · {say('حُدِّثت', 'Updated')}: {receipt.updatedCount} · {say('بلا تغيير', 'Unchanged')}: {receipt.unchangedCount} · {say('عُدِّلت في الـCRM وتُركت', 'Edited in the CRM, left')}: {receipt.editedCount} {receipt.excludedCount ? <> · {say('مستبعدة', 'Excluded')}: {receipt.excludedCount}</> : null} · {say('مرفوضة', 'Refused')}: {receipt.refusedCount}</p>
          {!!receipt.mappingsSaved && <small>{say('حُفظ ربط الموظفين', 'Employee mappings saved')}: {receipt.mappingsSaved}</small>}</div></div>}
        <div className="erp-import-actions"><button type="button" className="btn subtle" disabled={!!busy || pending} onClick={close}>{say(receipt ? 'تم' : 'إغلاق', receipt ? 'Done' : 'Close')}</button>
          {receipt ? refreshFailed && <button type="button" className="btn primary" disabled={!!busy} onClick={refreshAfterImport}>{busy === 'refresh' ? <Loader2 className="spin" size={17}/> : <RefreshCw size={17}/>} {say('تحديث العرض فقط', 'Refresh view only')}</button> :
            dirty && !pending ? <button type="button" className="btn primary" disabled={!file || immutable} onClick={buildPreview}>{busy === 'preview' ? <Loader2 className="spin" size={17}/> : <RefreshCw size={17}/>} {say('تحديث المعاينة', 'Refresh preview')}</button> :
            <button type="button" className="btn primary" disabled={!!busy || !previewBody || dirty || !ready} onClick={commit}>{busy === 'commit' ? <Loader2 className="spin" size={17}/> : <Upload size={17}/>} {pending ? say('تأكيد الحفظ', 'Confirm save') : say(`تأكيد الاستيراد (${ready})`, `Confirm import (${ready})`)}</button>}
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}

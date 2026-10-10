'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { definiteSubmitRejection, submitJson, SubmitError } from '@/lib/client-submit';
import { t, useLanguage } from '@/lib/i18n';
import UploadStatus, {type UploadState} from './upload-status';
import './erp-sales-import.css';

type Member = { id: string; name: string; branch: string };
type EmployeeMapping = { employeeId: string; repId: string };
type CategoryMapping = { category: string; product: string };
type Options = { members: Member[]; employeeMappings: EmployeeMapping[]; categoryMappings: CategoryMapping[]; products: string[]; canEditCategoryMappings?: boolean };
type DocumentStatus = 'new' | 'duplicate' | 'conflict' | 'excluded' | 'unassigned' | 'unmapped' | 'out_of_scope';
type Document = {
  key: string; reference: string; date: string; documentType: 'sale' | 'return';
  customerName: string; employeeId: string; employeeName: string; repId: string;
  repName: string; lineCount: number; totalCents: number; status: DocumentStatus; reason: string;
};
type Preview = {
  previewToken: string; documents: Document[];
  employees: { employeeId: string; employeeName: string; repId?: string; mappingSource?: 'saved' | 'selected' | 'name' | 'unmapped' }[]; categories: string[];
  summary: { newCount: number; duplicateCount: number; conflictCount: number; excludedCount: number; unassignedCount?: number; unassignedTotalCents?: number; unmappedCount: number; outOfScopeCount?: number; officeExcludedCount?: number; totalCents: number; months: string[] };
  warnings: string[];
};
type ImportBody = { fileName: string; base64: string; employeeMappings: EmployeeMapping[]; categoryMappings: CategoryMapping[]; allowSkipped: boolean };
type Receipt = { importedCount: number; duplicateCount: number; excludedCount: number; unassignedCount?: number; unassignedTotalCents?: number; skippedCount?: number; months: string[] };
type Props = { onClose: () => void; onImported: () => void | Promise<void> };
const endpoint = '/api/sales/import';
const maxBytes = 5 * 1024 * 1024;
const reportEnglish: Record<string, string> = {
  'مبيعات مكتب: مبيعات شركة أخرى مستبعدة تلقائيًا': 'Office sales: another company’s sales, excluded automatically.',
  'نفس رقم المستند يحتوي موظفين أو عملاء أو تواريخ مختلفة؛ راجع التقرير': 'This document number has different employees, customers or dates. Review the report.',
  'رقم الموظف أو اسمه ناقص في تقرير ERP؛ صحح التقرير أولًا': 'The ERP employee number or name is missing. Correct the report first.',
  'بدون بيانات موظف كاملة في ERP؛ تُتجاوز تلقائيًا ولا تُحتسب لأي مندوب': 'ERP employee details are incomplete. Skipped automatically and not counted for any rep.',
  'اربط رقم الموظف بالمندوب لأول مرة': 'Map this employee number to a rep for the first time.',
  'المندوب المرتبط خارج نطاق فريقك أو منطقتك': 'The mapped rep is outside your team or region.',
  'تاريخ المستند في المستقبل': 'The document date is in the future.',
  'حدد صنف المستهدف المقابل لكل فئة في الفاتورة': 'Select a target product for every category on this invoice.',
  'كل فئات هذا المستند مستبعدة من اختيارك': 'All categories on this document were excluded by your selections.',
  'رقم الفاتورة موجود في المبيعات اليدوية في نفس السنة؛ راجع السجل قبل الاستيراد لمنع التكرار': 'This invoice number already exists in manual sales for the same year. Review it before importing to avoid duplication.',
  'المستند محفوظ لمندوب أو منطقة أخرى': 'This document is already saved for another rep or region.',
  'مستند مطابق محفوظ سابقًا؛ لن يُضاف مرة أخرى': 'An identical document is already saved and will not be added again.',
  'رقم المستند محفوظ بمحتوى أو ربط مختلف؛ لن يتم استبداله': 'This document number has different saved contents or mappings. It will not be overwritten.',
  'مبيعات مكتب مستبعدة تلقائيًا حسب اسم الموظف. المرتجعات تخصم من المبيعات والمستهدف في شهر تاريخها.': 'Office sales are excluded automatically by employee name. Returns reduce sales and target achievement in the month of their date.',
  'توجد بنود بدون رقم أو اسم موظف؛ يلزم مراجعة الربط قبل الاعتماد': 'Some lines have no employee number or name. Review them before confirming the import.',
  'توجد بنود بدون فئة؛ يلزم تحديد تصنيفها في المعاينة': 'Some lines have no category. Review their classification in the preview.',
  'ربط الموظف خارج نطاق فريقك أو منطقتك': 'The employee mapping is outside your team or region.',
  'تعديل ربط فئة محفوظة متاح لمدير المبيعات أو مدير النظام فقط': 'Only the sales manager or system administrator can change a saved category mapping.',
  'يوجد تعارض في مستندات التقرير؛ صححه قبل الاستيراد': 'The report contains conflicting documents. Resolve them before importing.',
  'راجع المستندات غير المربوطة أو خارج الصلاحية ووافق صراحة على تخطيها': 'Review unmapped documents or documents outside your access, then explicitly agree to skip them.',
  'اعرض الملف أولًا قبل تأكيد الاستيراد': 'Preview the file before confirming the import.',
  'تم حفظ الطلب ببيانات مختلفة؛ ارفع الملف للمعاينة من جديد': 'This request was saved with different data. Upload the file for a new preview.',
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

export default function ErpSalesImport({ onClose, onImported }: Props) {
  const { language } = useLanguage();
  const say = (ar: string, en: string) => language === 'en' ? en : ar;
  const present = (value: string) => language === 'en' ? reportEnglish[value] || t(value) : value;
  const [options, setOptions] = useState<Options | null>(null);
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [file, setFile] = useState<{ fileName: string; base64: string; size: number } | null>(null);
  const [employeeMappings, setEmployeeMappings] = useState<Record<string, string>>({});
  const [categoryMappings, setCategoryMappings] = useState<Record<string, string>>({});
  const [allowSkipped, setAllowSkipped] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBody, setPreviewBody] = useState<ImportBody | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'read' | 'preview' | 'commit' | 'refresh' | null>(null);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [filter, setFilter] = useState<'all' | DocumentStatus>('all');
  const [page, setPage] = useState(1);
  const lock = useRef(false);
  const attempt = useRef<string | null>(null);
  const saved = useRef(false);
  const live = useRef(true);
  const previewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true);
    submitJson<Options>(endpoint, { cache: 'no-store', signal: controller.signal }, { language }).then(data => {
      if (controller.signal.aborted) return;
      setOptions(data);
      setEmployeeMappings(Object.fromEntries(data.employeeMappings.map(item => [item.employeeId, item.repId])));
      setCategoryMappings(Object.fromEntries(data.categoryMappings.map(item => [item.category, item.product])));
      setError('');
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => {
      if (!controller.signal.aborted) setOptionsLoading(false);
    });
    return () => controller.abort();
    // Changing presentation language must not discard an in-progress import.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsRevision]);

  const immutable = !!busy || pending || !!receipt;
  const skippedCount = preview?.documents.filter(doc => ['unmapped', 'out_of_scope'].includes(doc.status)).length || 0;
  const hasBlockers = !!preview?.documents.some(doc => doc.status === 'conflict') || (skippedCount > 0 && !previewBody?.allowSkipped);
  const documents = useMemo(() => (preview?.documents || []).filter(doc => filter === 'all' || doc.status === filter), [preview, filter]);
  const pages = Math.max(1, Math.ceil(documents.length / 20)), currentPage = Math.min(page, pages);
  const visibleDocuments = documents.slice((currentPage - 1) * 20, currentPage * 20);
  const money = (cents: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
  const statusText = (status: DocumentStatus) => ({
    new: say('جاهزة للإضافة', 'Ready to import'), duplicate: say('مسجلة سابقًا', 'Already imported'),
    conflict: say('فاتورة متغيرة', 'Changed invoice'), excluded: say('مستبعدة', 'Excluded'),
    unassigned: say('بدون مندوب — لن تُستورد', 'No rep — not imported'),
    unmapped: say('تحتاج ربط / مراجعة', 'Mapping / review needed'), out_of_scope: say('خارج صلاحيتك', 'Outside your access'),
  })[status];

  async function selectFile(selected?: File) {
    if (!selected || lock.current || pending || receipt) return;
    setError(''); setUploadState(null); setPreview(null); setPreviewBody(null); setDirty(false); setAllowSkipped(false); setFile(null); setPage(1); setFilter('all');
    if (!/\.xlsx$/i.test(selected.name)) { setError(say('اختر تقرير Excel بصيغة .xlsx.', 'Choose an Excel report in .xlsx format.')); return; }
    if (!selected.size || selected.size > maxBytes) { setError(say('حجم الملف يجب أن يكون أكبر من صفر ولا يزيد عن 5 ميجابايت.', 'The file must not be empty and must be no larger than 5 MB.')); return; }
    lock.current = true; setBusy('read'); setUploadState({phase:'reading'});
    try {
      const base64 = await readFile(selected);
      if (live.current) {setFile({ fileName: selected.name, base64, size: selected.size });setUploadState(null);}
    } catch {
      if (live.current) setError(say('تعذرت قراءة الملف. اختره مرة أخرى أو أعد تصديره من ERP.', 'Could not read the file. Select it again or export a fresh copy from ERP.'));
    } finally { lock.current = false; if (live.current) {setBusy(null);setUploadState(null);} }
  }

  function mappingChanged(kind: 'employee' | 'category', key: string, value: string) {
    if (immutable || lock.current) return;
    const update = (current: Record<string, string>) => { const next = { ...current }; if (value) next[key] = value; else delete next[key]; return next; };
    if (kind === 'employee') setEmployeeMappings(update); else setCategoryMappings(update);
    setDirty(true); setError('');
  }

  async function buildPreview() {
    if (!file || !options || lock.current || pending || receipt) return;
    lock.current = true; setBusy('preview'); setError(''); setUploadState({phase:'uploading',loaded:0,total:null,percent:null});
    // Capture the entire request. A commit always refers to precisely this preview.
    const body: ImportBody = {
      fileName: file.fileName, base64: file.base64, allowSkipped,
      employeeMappings: Object.entries(employeeMappings).sort(([a], [b]) => a.localeCompare(b)).map(([employeeId, repId]) => ({ employeeId, repId })),
      categoryMappings: Object.entries(categoryMappings).sort(([a], [b]) => a.localeCompare(b)).map(([category, product]) => ({ category, product })),
    };
    try {
      const result = await submitJson<Preview>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', ...body }) }, { language, onUploadProgress:progress=>{if(live.current)setUploadState(progress);} });
      if(typeof result.previewToken!=='string'||!result.previewToken||!Array.isArray(result.documents)||!result.summary)throw new SubmitError(say('الخادم لم يؤكد تجهيز المعاينة. أعد المحاولة.','The server did not confirm the preview. Retry.'));
      if (!live.current) return;
      setUploadState(null); setPreview(result); setPreviewBody(body); setDirty(false); setFilter('all'); setPage(1);
      requestAnimationFrame(() => previewHeading.current?.focus());
    } catch (e: any) {
      if (live.current) { setUploadState({phase:'error'}); setPreviewBody(null); setDirty(true); setError(e.message); }
    } finally { lock.current = false; if (live.current) setBusy(null); }
  }

  async function refreshAfterImport() {
    if (lock.current) return;
    lock.current = true; setBusy('refresh'); setError('');
    try {
      await onImported();
      if (live.current) setRefreshFailed(false);
    } catch {
      if (live.current) {
        setRefreshFailed(true);
        setError(say('تم الاستيراد، لكن تعذر تحديث شاشة المبيعات. أعد تحديث العرض فقط؛ لن يُرسل الاستيراد مرة أخرى.', 'Import completed, but the sales view could not refresh. Retry the refresh only; the import will not be sent again.'));
      }
    } finally { lock.current = false; if (live.current) setBusy(null); }
  }

  async function commit() {
    if (lock.current || saved.current || !preview || !previewBody || dirty || hasBlockers) return;
    lock.current = true; setBusy('commit'); setError(''); setUploadState({phase:'uploading',loaded:0,total:null,percent:null});
    if (!attempt.current) attempt.current = JSON.stringify({ action: 'commit', ...previewBody, previewToken: preview.previewToken, requestId: crypto.randomUUID() });
    let acknowledged = false;
    try {
      const result = await submitJson<Receipt>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: attempt.current }, { language, onUploadProgress:progress=>{if(live.current)setUploadState(progress);} });
      if(!['importedCount','duplicateCount','excludedCount'].every(key=>Number.isSafeInteger(result[key as keyof Receipt])&&Number(result[key as keyof Receipt])>=0)||!Array.isArray(result.months))throw new SubmitError(say('الخادم لم يؤكد نتيجة الاستيراد. أعد المحاولة بنفس البيانات.','The server did not confirm the import result. Retry with the same entries.'));
      saved.current = true; acknowledged = true; attempt.current = null;
      if (live.current) { setUploadState({phase:'complete'}); setReceipt(result); setPending(false); }
    } catch (e: any) {
      if (!live.current) return;
      setUploadState({phase:'error'});
      if (definiteSubmitRejection(e)) {
        attempt.current = null; setPending(false); setDirty(true); setPreviewBody(null);
      } else setPending(true);
      setError(e.message);
    } finally { lock.current = false; if (live.current) setBusy(null); }
    // Once the server acknowledges the write, only a read/refresh may be retried.
    if (acknowledged && live.current) await refreshAfterImport();
  }

  function close() { if (!lock.current && !pending) onClose(); }

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="crm-dialog erp-import-dialog" dir={language === 'en' ? 'ltr' : 'rtl'} showCloseButton={false}
      onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy || pending) event.preventDefault(); }}>
      <header className="erp-import-heading">
        <div><DialogTitle><FileSpreadsheet size={22} aria-hidden="true"/>{say('رفع مبيعات ERP', 'Import ERP sales')}</DialogTitle>
          <DialogDescription className="sr-only">{say('معاينة تقرير المبيعات وربط الموظفين والأصناف قبل الاستيراد.', 'Preview the sales report and map employees and products before importing.')}</DialogDescription></div>
        <button type="button" className="icon-button" aria-label={say('إغلاق', 'Close')} disabled={!!busy || pending} onClick={close}><X size={20}/></button>
      </header>

      <div className="erp-import-scroll">
        {optionsLoading ? <div className="erp-import-state" role="status"><Loader2 className="spin" size={22}/>{say('جارٍ تحميل الربط المحفوظ…', 'Loading saved mappings…')}</div> : !options ?
          <div className="erp-import-state"><AlertCircle size={24}/><p>{say('تعذر تحميل المناديب والربط المحفوظ.', 'Could not load reps and saved mappings.')}</p><button type="button" className="btn subtle" onClick={() => setOptionsRevision(value => value + 1)}><RefreshCw size={17}/>{say('إعادة المحاولة', 'Retry')}</button></div> : <>
          <p className="erp-import-office-note"><AlertCircle size={17} aria-hidden="true"/>{say('تُستبعد «مبيعات مكتب» تلقائيًا لأنها تخص شركات أخرى.', '“مبيعات مكتب” rows belong to other companies and are excluded automatically.')}</p>
          <section className="erp-import-file" aria-label={say('ملف التقرير', 'Report file')}>
            <label className="field" htmlFor="erp-sales-report"><span>{say('تقرير المبيعات من ERP', 'ERP sales report')} · XLSX · {say('حتى 5 ميجابايت', 'up to 5 MB')}</span>
              <input id="erp-sales-report" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={immutable} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; void selectFile(selected); }}/></label>
            {file && <p className="erp-import-filename"><FileSpreadsheet size={17} aria-hidden="true"/><bdi>{file.fileName}</bdi><small dir="ltr">{(file.size / 1024).toFixed(1)} KB</small></p>}
            {!receipt && <button type="button" className="btn subtle" disabled={!file || immutable} onClick={buildPreview}>
              {busy === 'read' || busy === 'preview' ? <Loader2 size={17} className="spin"/> : <RefreshCw size={17}/>}
              {say(preview ? 'تحديث المعاينة' : 'قراءة التقرير ومعاينته', preview ? 'Refresh preview' : 'Read and preview report')}
            </button>}
          </section>

          <UploadStatus state={uploadState} fileName={file?.fileName} completeLabel={say('اكتمل الاستيراد','Import complete')} disabled={!!busy} onRetry={pending?commit:buildPreview}/>

          {preview && <>
            <section className="erp-import-preview" aria-labelledby="erp-preview-heading">
              <h3 id="erp-preview-heading" ref={previewHeading} tabIndex={-1}>{say('ملخص المعاينة', 'Preview summary')}</h3>
              <div className="erp-import-counts" aria-live="polite">
                {[
                  [say('جديدة', 'New'), preview.summary.newCount],
                  [say('مسجلة سابقًا', 'Duplicates'), preview.summary.duplicateCount],
                  [say('مستبعدة', 'Excluded'), preview.summary.excludedCount],
                  [say('تحتاج مراجعة', 'Need review'), preview.documents.filter(doc => ['conflict', 'unmapped', 'out_of_scope'].includes(doc.status)).length],
                ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}
              </div>
              <div className="erp-import-summary"><p>{say('صافي الجديد قبل الضريبة', 'New net sales before tax')}<strong dir="ltr">{money(preview.summary.totalCents)} {say('ر.س', 'SAR')}</strong></p>
                <p>{say('الأشهر من عمود التاريخ', 'Months from the date column')}<strong><bdi>{preview.summary.months.join(' · ') || '—'}</bdi></strong></p></div>
              {!!preview.summary.unassignedCount && <div className="erp-import-unassigned" role="note"><strong>{say('مستندات بدون مندوب — لن تُستورد', 'Documents without a rep — not imported')}: {preview.summary.unassignedCount}</strong>
                <p>{say('صافيها قبل الضريبة', 'Their net value before tax')}: <bdi>{money(preview.summary.unassignedTotalCents || 0)} {say('ر.س', 'SAR')}</bdi></p>
                <p>{say('اسم الموظف أو رقمه مفقود. تُتجاوز هذه المستندات وتُستبعد قيمتها من إجمالي الاستيراد وأداء المناديب.', 'The employee name or number is missing. These documents are skipped and excluded from import totals and rep performance.')}</p></div>}
              <p className="erp-import-hint">{say('تُخصم المردودات في شهرها، وتُتخطى الفواتير المطابقة المسجلة سابقًا.', 'Returns reduce performance in their document month. Identical saved invoices are skipped.')}</p>
              {dirty && <p className="erp-import-notice" role="status">{say('الربط تغير؛ حدّث المعاينة للتأكد من الأرقام قبل الاستيراد.', 'Mappings changed. Refresh the preview to verify totals before importing.')}</p>}
            </section>

            {!!preview.employees.length && <section className="erp-import-mappings" aria-labelledby="erp-employee-mapping">
              <h3 id="erp-employee-mapping">{say('ربط الموظفين بالمناديب', 'Map employees to reps')}</h3>
              <div className="erp-import-map-list">{preview.employees.map((employee, index) => {
                // Server-inferred mappings are display-only until confirmed. Keep the
                // captured previewBody unchanged so the commit uses the same request.
                const value = employeeMappings[employee.employeeId] || employee.repId || '';
                const known = options.members.some(member => member.id === value);
                const savedMapping = options.employeeMappings.some(item => item.employeeId === employee.employeeId && item.repId === value)
                  || (employee.mappingSource === 'saved' && employee.repId === value);
                const autoMatched = employee.mappingSource === 'name' && !!employee.repId && employee.repId === value;
                const missing = !employee.employeeId || !employee.employeeName;
                return <label className="erp-import-map-row" key={employee.employeeId + ':' + index}><span><strong>{employee.employeeName || say('اسم الموظف فارغ', 'Employee name is blank')}</strong><small>{say('رقم الموظف', 'Employee number')}: <bdi>{employee.employeeId || '—'}</bdi>{savedMapping && !missing ? ' · ' + say('ربط محفوظ', 'Saved mapping') : ''}</small></span>
                  <select value={value} disabled={immutable || missing} aria-label={say('مندوب الموظف ', 'Rep for employee ') + (employee.employeeName || employee.employeeId)} onChange={event => mappingChanged('employee', employee.employeeId, event.target.value)}>
                    <option value="" disabled={employee.mappingSource === 'name' && !!employee.repId}>{say('اختر المندوب', 'Choose a rep')}</option>
                    {!!value && !known && <option value={value} disabled>{say('المندوب المحفوظ غير متاح ضمن صلاحيتك', 'Saved rep is outside your access')}</option>}
                    {options.members.map(member => <option key={member.id} value={member.id}>{member.name}{member.branch ? ' · ' + member.branch : ''}</option>)}
                  </select>
                  {autoMatched && !missing && <small className="erp-import-map-hint">{say('مطابقة تلقائية للاسم', 'Automatic name match')}</small>}
                  {missing && <small className="erp-import-map-warning">{say('أكمل اسم ورقم الموظف في ERP ثم ارفع التقرير من جديد.', 'Complete the employee name and number in ERP, then upload the report again.')}</small>}
                </label>;
              })}</div>
            </section>}

            {!!preview.categories.length && <section className="erp-import-mappings" aria-labelledby="erp-category-mapping">
              <h3 id="erp-category-mapping">{say('ربط الفئات بأصناف المستهدف', 'Map categories to target products')}</h3>
              <div className="erp-import-map-list">{preview.categories.map(category => {
                const value = categoryMappings[category] || (options.products.includes(category) ? category : '');
                const mappingLocked = options.canEditCategoryMappings === false && options.categoryMappings.some(item => item.category === category);
                return <label className="erp-import-map-row" key={category}><span><strong>{category || say('فئة فارغة', 'Blank category')}</strong>{mappingLocked && <small>{say('ربط محفوظ · تعديله لمدير المبيعات', 'Saved mapping · sales manager can change it')}</small>}</span>
                  <select value={value} disabled={immutable || mappingLocked} aria-label={say('صنف الفئة ', 'Target product for ') + category} onChange={event => mappingChanged('category', category, event.target.value)}>
                    <option value="">{say('اختر صنف المستهدف', 'Choose a target product')}</option>
                    {options.products.map(product => <option key={product} value={product}>{t(product)}</option>)}
                    <option value="exclude">{say('استبعاد هذه الفئة من الاستيراد', 'Exclude this category from import')}</option>
                  </select>
                </label>;
              })}</div>
            </section>}

            {!!preview.warnings?.length && <div className="erp-import-warnings" role="note"><strong>{say('ملاحظات التقرير', 'Report notes')}</strong><ul>{preview.warnings.map((warning, index) => <li key={index}>{present(warning)}</li>)}</ul></div>}
            {skippedCount > 0 && !receipt && <label className="erp-import-skip"><input type="checkbox" checked={allowSkipped} disabled={immutable} onChange={event => { setAllowSkipped(event.target.checked); setDirty(true); setError(''); }}/><span><strong>{say('استيراد الفواتير الجاهزة فقط', 'Import ready invoices only')}</strong><small>{say(`أوافق على استيراد ${preview.summary.newCount} مستند جديد وتجاوز ${skippedCount} مستندًا غير مربوط أو خارج صلاحيتي. يمكن إعادة رفع المتجاوز لاحقًا بعد استكماله.`, `I agree to import ${preview.summary.newCount} new documents and skip ${skippedCount} unmapped documents or documents outside my access. Skipped documents can be uploaded again after they are resolved.`)}</small></span></label>}
            {hasBlockers && !receipt && <p className="erp-import-notice" role="status">{say('أكمل الربط وراجع الفواتير المتغيرة أو البيانات خارج صلاحيتك. لن تُستبدل أي فاتورة سابقة تلقائيًا.', 'Complete mappings and review changed invoices or records outside your access. Existing invoices are never overwritten automatically.')}</p>}

            <section className="erp-import-documents" aria-labelledby="erp-documents-heading">
              <div className="erp-import-section-heading"><h3 id="erp-documents-heading">{say('الفواتير والمردودات', 'Invoices and returns')}</h3>
                <label className="erp-import-filter"><span>{say('عرض', 'Show')}</span><select value={filter} onChange={event => { setFilter(event.target.value as typeof filter); setPage(1); }}>
                  <option value="all">{say('الكل', 'All')}</option>{(['new', 'duplicate', 'excluded', 'unassigned', 'unmapped', 'conflict', 'out_of_scope'] as const).map(value => <option key={value} value={value}>{statusText(value)}</option>)}
                </select></label>
              </div>
              <div className="erp-import-table-wrap"><table className="erp-import-table"><thead><tr>{[say('المرجع / التاريخ', 'Reference / date'), say('العميل', 'Customer'), say('الموظف ← المندوب', 'Employee → rep'), say('الصافي · ر.س', 'Net · SAR'), say('الحالة', 'Status')].map(label => <th key={label}>{label}</th>)}</tr></thead>
                <tbody>{visibleDocuments.map(doc => <tr key={doc.key}><td><strong><bdi>{doc.reference}</bdi></strong><small dir="ltr">{doc.date}</small><small>{doc.documentType === 'return' ? say('مردود مبيعات', 'Sales return') : say('فاتورة مبيعات', 'Sales invoice')}</small></td><td>{doc.customerName}<small>{doc.lineCount} {say('بند', 'lines')}</small></td><td>{doc.employeeName || '—'}<small>{doc.repName || '—'}</small></td><td className="erp-import-amount" dir="ltr">{money(doc.totalCents)}</td><td><span className={'erp-import-badge ' + doc.status}>{statusText(doc.status)}</span>{doc.reason && <small>{present(doc.reason)}</small>}</td></tr>)}</tbody></table></div>
              <div className="erp-import-cards">{visibleDocuments.map(doc => <article className="erp-import-document-card" key={doc.key}><div><strong><bdi>{doc.reference}</bdi></strong><span className={'erp-import-badge ' + doc.status}>{statusText(doc.status)}</span></div><p>{doc.customerName}</p><small><bdi>{doc.date}</bdi> · {doc.documentType === 'return' ? say('مردود', 'Return') : say('فاتورة', 'Invoice')} · {doc.lineCount} {say('بند', 'lines')}</small><p>{doc.employeeName || '—'}<span aria-hidden="true"> · </span>{doc.repName || (doc.status === 'unassigned' ? say('بدون مندوب', 'No rep') : say('بدون ربط', 'Unmapped'))}</p><strong className="erp-import-amount" dir="ltr">{money(doc.totalCents)} {say('ر.س', 'SAR')}</strong>{doc.reason && <small>{present(doc.reason)}</small>}</article>)}</div>
              {!documents.length && <p className="erp-import-hint">{say('لا توجد فواتير بهذه الحالة.', 'No invoices match this status.')}</p>}
              {pages > 1 && <nav className="erp-import-pagination" aria-label={say('صفحات المعاينة', 'Preview pages')}><button type="button" className="btn subtle small" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{say('السابق', 'Previous')}</button><span dir="ltr">{currentPage} / {pages}</span><button type="button" className="btn subtle small" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>{say('التالي', 'Next')}</button></nav>}
            </section>
          </>}
        </>}
      </div>

      <footer className="erp-import-footer">
        {!!error && <p className="form-error" role="alert">{present(error)}</p>}
        {pending && <p className="erp-import-notice" role="status">{say('لم يتأكد الحفظ بسبب الاتصال. البيانات مثبتة؛ اضغط «تأكيد الحفظ» لإعادة نفس الطلب بدون تكرار.', 'The connection did not confirm the import. Your data is locked; choose “Confirm save” to retry the same request without duplicates.')}</p>}
        {receipt && <div className="erp-import-success" role="status"><CheckCircle2 size={21}/><div><strong>{say('تم تأكيد الاستيراد', 'Import confirmed')}</strong><p>{say('أُضيفت', 'Imported')}: {receipt.importedCount} · {say('مسجلة سابقًا', 'Duplicates')}: {receipt.duplicateCount} · {say('مستبعدة', 'Excluded')}: {receipt.excludedCount}{!!receipt.skippedCount && <> · {say('متجاوزة للمراجعة', 'Skipped for review')}: {receipt.skippedCount}</>}</p>
          {!!receipt.unassignedCount && <p>{say('تُجاوزت بدون مندوب ولم تُستورد', 'Skipped without a rep; not imported')}: {receipt.unassignedCount} · {say('صافيها قبل الضريبة', 'Their net value before tax')}: <bdi>{money(receipt.unassignedTotalCents || 0)} {say('ر.س', 'SAR')}</bdi>. {say('لم تُحتسب لأي مندوب.', 'Not counted for any rep.')}</p>}
          <small>{say('الأشهر', 'Months')}: <bdi>{receipt.months.join(' · ') || '—'}</bdi></small></div></div>}
        <div className="erp-import-actions"><button type="button" className="btn subtle" disabled={!!busy || pending} onClick={close}>{say(receipt ? 'تم' : 'إغلاق', receipt ? 'Done' : 'Close')}</button>
          {receipt ? refreshFailed && <button type="button" className="btn primary" disabled={!!busy} onClick={refreshAfterImport}>{busy === 'refresh' ? <Loader2 className="spin" size={17}/> : <RefreshCw size={17}/>} {say('تحديث العرض فقط', 'Refresh view only')}</button> :
            dirty && !pending ? <button type="button" className="btn primary" disabled={!file || immutable} onClick={buildPreview}>{busy === 'preview' ? <Loader2 className="spin" size={17}/> : <RefreshCw size={17}/>} {say('تحديث المعاينة', 'Refresh preview')}</button> :
            <button type="button" className="btn primary" disabled={!!busy || !previewBody || dirty || hasBlockers || !preview?.documents.length} onClick={commit}>{busy === 'commit' ? <Loader2 className="spin" size={17}/> : <Upload size={17}/>} {say(pending ? 'تأكيد الحفظ' : 'تأكيد الاستيراد', pending ? 'Confirm save' : 'Confirm import')}</button>}
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}

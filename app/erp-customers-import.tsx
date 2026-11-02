'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { definiteSubmitRejection, submitJson, SubmitError } from '@/lib/client-submit';
import { useLanguage } from '@/lib/i18n';
import { customerCodeKey } from '@/lib/customer-identity';
import type { ErpCustomerCandidate, ErpCustomerOutcome, ErpCustomersSummary } from '@/lib/erp-customers';
import UploadStatus, {type UploadState} from './upload-status';
import './erp-sales-import.css';
import './erp-customers-import.css';
const messageOf = (e: unknown) => typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' ? e.message : '';

type Preview = { fileName: string; sheet: string; snapshot: string; summary: ErpCustomersSummary; rows: ErpCustomerOutcome[] };
type Choice = { row: number; customerId: string };
type Result = { ok: true; updated: number; mappings: number; changed: number; unchanged: number; skipped: number; missing: number; outOfRegion: number; invalid: number; changes: { row: number; customerId: string; from: string; to: string; mapping: boolean }[]; alreadySaved?: boolean };
type SelectedFile = { fileName: string; base64: string; size: number };
type Filter = 'choose' | 'change' | 'same' | 'missing' | 'other' | 'all';
type Props = { onClose: () => void; onImported: () => void | Promise<void> };
const endpoint = '/api/erp-customers';
const maxBytes = 1024 * 1024;
const pageSize = 20;
const serverEnglish: Record<string, string> = {
  'اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة': 'Customer data changed since the preview. Run a new preview.',
  'اخترت نفس العميل لأكثر من سطر؛ العميل له كود ERP واحد. راجع الاختيارات.': 'The same customer is chosen for more than one row; a customer has one ERP code. Review the choices.',
  'لا توجد أكواد تتغير في هذا الملف.': 'No code changes in this file.',
  'اعرض الملف أولًا قبل تحديث الأكواد': 'Preview the file before updating the codes.',
  'الطلب محفوظ ببيانات مختلفة. اعمل معاينة جديدة.': 'This request was saved with different data. Run a new preview.',
  'استيراد عملاء ERP متاح لمدير النظام ومدير المبيعات فقط.': 'ERP customer import is for the system administrator and the sales manager only.',
  'أقصى حجم لملف عملاء ERP 1 ميجابايت': 'The ERP customer file must be 1 MB or smaller.',
  'ملف عملاء ERP لا يحتوي صفوف عملاء بعد العناوين': 'The ERP customer file has no customer rows below the header.',
};
/** The rows a filter shows. «Needs a choice» keeps the rows the user already chose, so a row does not vanish under their finger. */
const inFilter = (row: ErpCustomerOutcome, filter: Filter): boolean => filter === 'all' ? true : filter === 'choose' ? row.status === 'choose'
  : filter === 'change' ? row.change && !row.conflict : filter === 'same' ? !!row.customerId && !row.change && !row.conflict
  : filter === 'missing' ? row.status === 'missing' : !inFilter(row, 'choose') && !inFilter(row, 'change') && !inFilter(row, 'same') && !inFilter(row, 'missing');
const unresolved = (row: ErpCustomerOutcome) => row.status === 'choose' && (row.conflict || !row.customerId && !row.chosen);
const choiceList = (choices: Record<number, string>): Choice[] => Object.entries(choices).map(([row, customerId]) => ({ row: Number(row), customerId })).sort((a, b) => a.row - b.row);
/** Whether the code itself changes; a row can change only by linking a number another customer also holds. */
const codeChanges = (from: string, to: string) => customerCodeKey(from) !== customerCodeKey(to);
const sameChoices = (a: Choice[], b: Choice[]) => a.length === b.length && a.every((choice, index) => choice.row === b[index].row && choice.customerId === b[index].customerId);

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

/** «استيراد من ERP»: the ERP customer export updates only each matched customer's ERP code. The server matches by phone or full name
 * (nothing is written by a preview); the user picks a candidate or leaves each ambiguous row; «تحديث الأكواد» sends the same file and
 * choices again and the server applies them in one transaction. An unconfirmed apply is retried with the very same request. */
export default function ErpCustomersImport({ onClose, onImported }: Props) {
  const { language } = useLanguage();
  const say = (ar: string, en: string) => language === 'en' ? en : ar;
  const present = (value: string) => language === 'en' ? serverEnglish[value] || value : value;
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewChoices, setPreviewChoices] = useState<Choice[]>([]);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<'read' | 'preview' | 'apply' | 'refresh' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const lock = useRef(false);
  const previewing = useRef(false);
  const again = useRef(false);
  const wanted = useRef<Choice[]>([]);
  const attempt = useRef<string | null>(null);
  const saved = useRef(false);
  const live = useRef(true);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const current = choiceList(choices), dirty = !!preview && !sameChoices(current, previewChoices);
  const locked = !!busy || pending || !!result;
  const rows = useMemo(() => preview?.rows || [], [preview]);
  const counts = useMemo(() => ({
    choose: rows.filter(unresolved).length, change: rows.filter(row => inFilter(row, 'change')).length, same: rows.filter(row => inFilter(row, 'same')).length,
    missing: rows.filter(row => row.status === 'missing').length, other: rows.filter(row => inFilter(row, 'other')).length, all: rows.length,
  }), [rows]);
  const shown = useMemo(() => rows.filter(row => inFilter(row, filter)), [rows, filter]);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize)), currentPage = Math.min(page, pages);
  const visible = shown.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const customers = useMemo(() => new Map(rows.flatMap(row => row.candidates.map(candidate => [candidate.id, candidate] as const))), [rows]);
  const conflicts = preview?.summary.conflicts || 0, changes = preview?.summary.changes || 0;
  const canApply = !!preview && !locked && !dirty && !refreshing && !stale && !conflicts && changes > 0;
  const matchedText = (by: string) => by === 'both' ? say('بالجوال والاسم', 'by phone and name') : by === 'phone' ? say('بالجوال', 'by phone') : by === 'name' ? say('بالاسم', 'by name') : '';
  const statusText = (row: ErpCustomerOutcome) => row.status === 'invalid' ? (row.issue === 'no-code' ? say('من غير رقم عميل', 'No customer number') : row.issue === 'long-code' ? say('رقم العميل طويل جدًا', 'Customer number too long') : say('رقم العميل متكرر في الملف', 'Customer number repeated in the file'))
    : row.conflict ? say('نفس العميل في أكتر من سطر', 'Same customer on several rows')
    : row.status === 'choose' ? (row.customerId ? say('اخترت العميل', 'Customer chosen') : row.chosen ? say('متساب', 'Left as is') : say('اختار العميل', 'Choose the customer'))
    : row.status === 'missing' ? say('مش موجود في الـCRM', 'Not in the CRM') : row.status === 'out-of-region' ? say('خارج مناطقك', 'Outside your regions')
    : !row.customerId ? say('متساب', 'Left as is') : !row.change ? say('نفس الكود', 'Same code') : codeChanges(row.from, row.to) ? say('هيتغير', 'Will change') : say('هيتربط الرقم بيه', 'Number will be linked');
  const tone = (row: ErpCustomerOutcome) => row.conflict || unresolved(row) ? 'warn' : row.customerId && row.change ? 'good' : 'muted';
  const filterLabel = (value: Filter) => ({ choose: say('يحتاج اختيار', 'Needs a choice'), change: say('هيتغير', 'Will change'), same: say('من غير تغيير', 'No change'), missing: say('مش في الـCRM', 'Not in the CRM'), other: say('باقي السطور', 'Other rows'), all: say('الكل', 'All') })[value];

  async function selectFile(selected?: File) {
    if (!selected || lock.current || previewing.current || pending || result) return;
    setError(''); setUploadState(null); setPreview(null); setPreviewChoices([]); setChoices({}); setStale(false); setFile(null); setPage(1); wanted.current = []; attempt.current = null;
    if (!/\.xlsx$/i.test(selected.name)) { setError(say('اختار ملف العملاء من ERP بصيغة .xlsx.', 'Choose the ERP customer file in .xlsx format.')); return; }
    if (!selected.size || selected.size > maxBytes) { setError(say('حجم الملف لازم يكون أكبر من صفر ولا يزيد عن 1 ميجابايت.', 'The file must not be empty and must be no larger than 1 MB.')); return; }
    lock.current = true; setBusy('read'); setUploadState({phase:'reading'});
    let chosen: SelectedFile | null = null;
    try {
      chosen = { fileName: selected.name.slice(0, 255), base64: await readFile(selected), size: selected.size };
      if (live.current) setFile(chosen);
    } catch {
      if (live.current) { setUploadState(null); setError(say('تعذرت قراءة الملف. اختاره تاني أو صدّره من ERP من جديد.', 'Could not read the file. Select it again or export a fresh copy from ERP.')); }
    } finally { lock.current = false; if (live.current) setBusy(null); }
    if (chosen && live.current) await runPreview(chosen, true);
  }

  /** A fresh preview (a new file, or after the data changed) starts the choices over; otherwise the latest choices are previewed, one
   * request at a time: choices made meanwhile are sent as soon as the current answer arrives, and only the last answer is shown. */
  async function runPreview(target: SelectedFile | null, fresh: boolean) {
    if (!target || saved.current) return;
    if (fresh) { wanted.current = []; setChoices({}); }
    if (previewing.current) { again.current = true; return; }
    previewing.current = true; setError('');
    if (fresh) { setBusy('preview'); setUploadState({phase:'uploading',loaded:0,total:null,percent:null}); } else setRefreshing(true);
    try {
      let answer: Preview, sent: Choice[];
      do {
        again.current = false; sent = wanted.current;
        answer = await submitJson<Preview>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', fileName: target.fileName, base64: target.base64, choices: sent }) }, { language, timeout: 60000, onUploadProgress: fresh ? progress => { if (live.current) setUploadState(progress); } : undefined });
        if (!live.current) return;
      } while (again.current);
      if (!/^[a-f0-9]{64}$/.test(String(answer.snapshot)) || !Array.isArray(answer.rows) || !answer.summary) throw new SubmitError(say('الخادم لم يؤكد تجهيز المعاينة. أعد المحاولة.', 'The server did not confirm the preview. Retry.'));
      setPreview(answer); setPreviewChoices(sent); setStale(false); setUploadState(null);
      if (fresh) {
        const first = answer.rows.some(unresolved) ? 'choose' : answer.rows.some(row => inFilter(row, 'change')) ? 'change' : 'all';
        setFilter(first); setPage(1); requestAnimationFrame(() => previewHeading.current?.focus());
      }
    } catch (e) {
      if (!live.current) return;
      if (fresh) { setUploadState({phase:'error'}); setPreview(null); }
      setError(messageOf(e));
    } finally { previewing.current = false; if (live.current) { setBusy(null); setRefreshing(false); } }
  }

  function choose(row: number, customerId: string) {
    if (locked || stale) return;
    const next = { ...choices, [row]: customerId };
    setChoices(next); wanted.current = choiceList(next); setError('');
    void runPreview(file, false);
  }

  async function refreshAfterApply() {
    if (lock.current) return;
    lock.current = true; setBusy('refresh'); setError('');
    try {
      await onImported();
      if (live.current) setRefreshFailed(false);
    } catch {
      if (live.current) { setRefreshFailed(true); setError(say('اتحدثت الأكواد، لكن تعذر تحديث قائمة العملاء. حدّث العرض بس؛ التحديث مش هيتبعت تاني.', 'The codes were updated, but the customer list could not refresh. Refresh the view only; the update will not be sent again.')); }
    } finally { lock.current = false; if (live.current) setBusy(null); }
  }

  async function apply() {
    if (lock.current || saved.current || !file || !preview || (!pending && !canApply)) return;
    lock.current = true; setBusy('apply'); setError(''); setUploadState({phase:'uploading',loaded:0,total:null,percent:null});
    // The whole request is kept: a retry after an unconfirmed answer repeats it exactly, so the server returns the saved result.
    if (!attempt.current) attempt.current = JSON.stringify({ action: 'apply', fileName: file.fileName, base64: file.base64, snapshot: preview.snapshot, requestId: crypto.randomUUID(), choices: previewChoices });
    let acknowledged = false;
    try {
      const answer = await submitJson<Result>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: attempt.current }, { language, timeout: 60000, onUploadProgress: progress => { if (live.current) setUploadState(progress); } });
      if (answer.ok !== true || !['updated', 'mappings', 'changed', 'unchanged', 'skipped', 'missing'].every(key => Number.isSafeInteger(answer[key as keyof Result]) && Number(answer[key as keyof Result]) >= 0) || !Array.isArray(answer.changes)) throw new SubmitError(say('الخادم لم يؤكد تحديث الأكواد. أعد المحاولة بنفس البيانات.', 'The server did not confirm the update. Retry with the same data.'));
      saved.current = true; acknowledged = true; attempt.current = null;
      if (live.current) { setUploadState({phase:'complete'}); setResult(answer); setPending(false); }
    } catch (e) {
      if (!live.current) return;
      setUploadState({phase:'error'});
      if (definiteSubmitRejection(e)) { attempt.current = null; setPending(false); if (e instanceof SubmitError && e.status === 409) setStale(true); }
      else setPending(true);
      setError(messageOf(e));
    } finally { lock.current = false; if (live.current) setBusy(null); }
    if (acknowledged && live.current) await refreshAfterApply();
  }

  function close() { if (!lock.current && !pending) onClose(); }
  const customerLine = (candidate?: ErpCustomerCandidate) => candidate ? <><bdi>{candidate.name}</bdi> · <bdi dir="ltr" className="erp-customers-yr">{candidate.internalCode || '—'}</bdi></> : null;
  const beforeAfter = (from: string, to: string) => <span className="erp-customers-codes"><bdi dir="ltr">{from || '—'}</bdi><span aria-hidden="true">{language === 'en' ? ' → ' : ' ← '}</span><span className="sr-only">{say(' إلى ', ' to ')}</span><bdi dir="ltr">{to}</bdi></span>;

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="crm-dialog erp-import-dialog erp-customers-dialog" dir={language === 'en' ? 'ltr' : 'rtl'} showCloseButton={false}
      onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy || pending) event.preventDefault(); }}>
      <header className="erp-import-heading">
        <div><DialogTitle><FileSpreadsheet size={22} aria-hidden="true"/>{say('استيراد من ERP', 'Import from ERP')}</DialogTitle>
          <DialogDescription>{say('بيحدّث «كود العميل في ERP» بس، بالمطابقة بالجوال أو الاسم. الاسم والجوال وباقي بيانات العميل ما بتتغيرش.', 'Updates only the customer’s ERP code, matched by phone or name. Names, phones and everything else stay as they are.')}</DialogDescription></div>
        <button type="button" className="icon-button" aria-label={say('إغلاق', 'Close')} disabled={!!busy || pending} onClick={close}><X size={20}/></button>
      </header>

      <div className="erp-import-scroll">
        <section className="erp-import-file" aria-label={say('ملف العملاء', 'Customer file')}>
          <label className="field" htmlFor="erp-customers-file"><span>{say('ملف العملاء من ERP', 'ERP customer file')} · XLSX · {say('حتى 1 ميجابايت', 'up to 1 MB')}</span>
            <input id="erp-customers-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={locked || refreshing} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; void selectFile(selected); }}/></label>
          {file && <p className="erp-import-filename"><FileSpreadsheet size={17} aria-hidden="true"/><bdi>{file.fileName}</bdi><small dir="ltr">{(file.size / 1024).toFixed(1)} KB</small></p>}
          {!result && <button type="button" className="btn subtle" disabled={!file || locked || refreshing} onClick={() => void runPreview(file, true)}>
            {busy === 'read' || busy === 'preview' ? <Loader2 size={17} className="spin"/> : <RefreshCw size={17}/>}
            {preview ? say('معاينة جديدة', 'New preview') : say('قراءة الملف ومعاينته', 'Read and preview file')}
          </button>}
        </section>

        <UploadStatus state={uploadState} fileName={file?.fileName} completeLabel={say('تم تحديث الأكواد', 'Codes updated')} disabled={!!busy} onRetry={pending ? apply : () => void runPreview(file, true)}/>

        {result && <section className="erp-customers-result" aria-labelledby="erp-customers-result-heading">
          <h3 id="erp-customers-result-heading">{say('اللي اتغير', 'What changed')}</h3>
          {!result.changes.length ? <p className="erp-import-hint">{say('مفيش أكواد اتغيرت.', 'No codes changed.')}</p> :
            <ol className="erp-customers-changes">{result.changes.map(change => <li key={change.row}><span>{customerLine(customers.get(change.customerId)) || <bdi dir="ltr">{change.customerId}</bdi>}</span>
              <span>{codeChanges(change.from, change.to) ? <>{say('قبل ← بعد', 'Before → after')}: {beforeAfter(change.from, change.to)}</> : <>{say('نفس الكود', 'Same code')} <bdi dir="ltr">{change.to}</bdi></>}{change.mapping && <small> · {say('فواتير الرقم ده هتتحسب للعميل ده', 'invoices with this number count for this customer')}</small>}</span></li>)}</ol>}
        </section>}

        {preview && !result && <>
          <section className="erp-import-preview" aria-labelledby="erp-customers-preview-heading">
            <h3 id="erp-customers-preview-heading" ref={previewHeading} tabIndex={-1}>{say('ملخص المعاينة', 'Preview summary')}</h3>
            <div className="erp-import-counts" aria-live="polite">
              {([[say('هيتغير', 'Will change'), changes], [say('يحتاج اختيار', 'Needs a choice'), counts.choose], [say('من غير تغيير', 'No change'), counts.same], [say('مش في الـCRM', 'Not in the CRM'), preview.summary.missing]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
            </div>
            <p className="erp-customers-stats"><span>{say('السطور', 'Rows')}: <bdi>{preview.summary.rows}</bdi></span><span>{say('مطابق تلقائي', 'Matched automatically')}: <bdi>{preview.summary.auto}</bdi></span>{!!preview.summary.outOfRegion && <span>{say('خارج مناطقك', 'Outside your regions')}: <bdi>{preview.summary.outOfRegion}</bdi></span>}{!!preview.summary.invalid && <span>{say('سطور غير صالحة', 'Invalid rows')}: <bdi>{preview.summary.invalid}</bdi></span>}{!!preview.summary.mappings && <span>{say('أرقام عند عميل تاني', 'Numbers held by another customer')}: <bdi>{preview.summary.mappings}</bdi></span>}<span>{say('الورقة', 'Sheet')}: <bdi>{preview.sheet}</bdi></span></p>
            {refreshing && <p className="erp-import-hint" role="status"><Loader2 size={14} className="spin" aria-hidden="true"/> {say('جارٍ تحديث المعاينة باختياراتك…', 'Updating the preview with your choices…')}</p>}
            {!!conflicts && !dirty && <p className="erp-import-notice" role="status">{say('في عميل متختار لأكتر من سطر، والعميل ليه كود ERP واحد. اختار عميل تاني أو «سيبه» في سطر منهم.', 'A customer is chosen for more than one row, and a customer has one ERP code. Choose another customer or «Leave it» on one of them.')}</p>}
            {!!counts.choose && !conflicts && <p className="erp-import-hint">{say(`${counts.choose} سطر محتاج اختيار؛ اللي مش هتختارله هيتساب من غير تغيير.`, `Rows that need a choice: ${counts.choose}. A row left without one stays unchanged.`)}</p>}
          </section>

          <section className="erp-import-documents" aria-labelledby="erp-customers-rows-heading">
            <div className="erp-import-section-heading"><h3 id="erp-customers-rows-heading">{say('سطور الملف', 'File rows')}</h3></div>
            <div className="erp-customers-filters" role="group" aria-label={say('عرض', 'Show')}>
              {(['choose', 'change', 'same', 'missing', 'other', 'all'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }}>{filterLabel(value)} <bdi>{counts[value]}</bdi></button>)}
            </div>
            <div className="erp-customers-list">{visible.map(row => {
              const target = customers.get(row.customerId), selected = Object.hasOwn(choices, row.row) ? choices[row.row] : row.chosen || row.customerId ? row.customerId : null;
              return <article className="erp-customers-row" key={row.row} data-status={row.status} data-tone={tone(row)}>
                <div className="erp-customers-row-head"><strong>{say('رقم ERP', 'ERP number')} <bdi dir="ltr">{row.code || '—'}</bdi></strong><span className="erp-customers-badge" data-tone={tone(row)}>{statusText(row)}</span></div>
                <p className="erp-customers-name"><bdi>{row.name || '—'}</bdi></p>
                <small className="erp-customers-meta">{say('سطر', 'Row')} <bdi>{row.row}</bdi>{!!row.phones.length && <> · {say('جوال', 'Phone')} {row.phones.map(phone => <bdi dir="ltr" key={phone}>…{phone}</bdi>)}</>}{row.customerId && row.matchedBy && <> · {say('اتطابق', 'Matched')} {matchedText(row.matchedBy)}</>}</small>
                {row.customerId && !row.conflict && (codeChanges(row.from, row.to) ? <p className="erp-customers-change">{say('قبل ← بعد', 'Before → after')}: {beforeAfter(row.from, row.to)} · {customerLine(target)}</p> : <p className="erp-customers-same">{say('نفس الكود عند', 'Same code at')} {customerLine(target)}</p>)}
                {row.customerId && row.sharedWith > 0 && !row.conflict && <p className="erp-customers-shared">{say(`الكود ده كمان عند ${row.sharedWith} عميل تاني؛ الفواتير هتتحسب للعميل ده`, `This code is also held by ${row.sharedWith} other customer(s); its invoices will count for this customer`)}</p>}
                {row.status === 'out-of-region' && <p className="erp-customers-same">{say('العميل المطابق خارج مناطقك؛ مش هيتغير حاجة.', 'The matching customer is outside your regions; nothing changes.')}</p>}
                {row.status === 'missing' && <p className="erp-customers-same">{say('مفيش عميل في الـCRM بنفس الجوال أو الاسم؛ مش هيتعمل عميل جديد.', 'No CRM customer has this phone or name; no customer is created.')}</p>}
                {!!row.candidates.length && <fieldset className="erp-customers-candidates" disabled={locked || stale}>
                  <legend className="sr-only">{say('العميل لسطر ', 'Customer for row ') + row.row}</legend>
                  {row.candidates.map(candidate => <label className="erp-customers-candidate" key={candidate.id}>
                    <input type="radio" name={'erp-row-' + row.row} value={candidate.id} checked={selected === candidate.id} onChange={() => choose(row.row, candidate.id)}/>
                    <span><strong><bdi>{candidate.name}</bdi></strong>
                      <small>{say('كود يورست', 'Yourrest code')}: <bdi dir="ltr">{candidate.internalCode || '—'}</bdi> · {say('كود ERP الحالي', 'Current ERP code')}: <bdi dir="ltr">{candidate.code || '—'}</bdi></small>
                      <small>{candidate.region || '—'}{!!candidate.phones.length && <> · {candidate.phones.map(phone => <bdi dir="ltr" key={phone}>…{phone}</bdi>)}</>} · {say('اتطابق', 'Matched')} {matchedText(candidate.matchedBy)}</small></span>
                  </label>)}
                  <label className="erp-customers-candidate is-leave"><input type="radio" name={'erp-row-' + row.row} value="" checked={selected === ''} onChange={() => choose(row.row, '')}/>
                    <span><strong>{say('سيبه', 'Leave it')}</strong><small>{say('مفيش تغيير للسطر ده', 'No change for this row')}</small></span></label>
                </fieldset>}
              </article>;
            })}</div>
            {!shown.length && <p className="erp-import-hint">{say('مفيش سطور هنا.', 'No rows here.')}</p>}
            {pages > 1 && <nav className="erp-import-pagination" aria-label={say('صفحات المعاينة', 'Preview pages')}><button type="button" className="btn subtle small" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{say('السابق', 'Previous')}</button><span dir="ltr">{currentPage} / {pages}</span><button type="button" className="btn subtle small" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>{say('التالي', 'Next')}</button></nav>}
          </section>
        </>}
        {!preview && !result && !file && !busy && <div className="erp-import-state"><AlertCircle size={22} aria-hidden="true"/><p>{say('اختار ملف العملاء اللي اتصدّر من ERP (ورقة Customer).', 'Choose the customer file exported from ERP (sheet Customer).')}</p></div>}
      </div>

      <footer className="erp-import-footer">
        {!!error && <p className="form-error" role="alert">{present(error)}</p>}
        {pending && <p className="erp-import-notice" role="status">{say('الحفظ ما اتأكدش بسبب الاتصال. البيانات متثبتة؛ دوس «تأكيد الحفظ» عشان نفس الطلب يتبعت تاني من غير تكرار.', 'The connection did not confirm the update. Your data is locked; choose “Confirm save” to send the same request again without duplicates.')}</p>}
        {canApply && <p className="erp-customers-ready">{say(`هيتحدث ${changes} عميل في خطوة واحدة.`, `${changes} customers will be updated in one step.`)}</p>}
        {stale && !pending && <p className="erp-import-notice" role="status">{say('اعمل معاينة جديدة؛ اختياراتك هتبدأ من الأول على البيانات الجديدة.', 'Run a new preview; your choices start over on the new data.')}</p>}
        {result && <div className="erp-import-success" role="status"><CheckCircle2 size={21}/><div><strong>{say('تم تحديث الأكواد', 'Codes updated')}</strong>
          <p>{say('اتغير كودها', 'Codes changed')}: {result.updated} · {say('عملاء اتحدثوا', 'Customers updated')}: {result.changed}{!!result.mappings && <> · {say('أرقام اتربطت بعميلها', 'Numbers linked to their customer')}: {result.mappings}</>}</p>
          <small>{say('من غير تغيير', 'No change')}: {result.unchanged} · {say('متساب', 'Left')}: {result.skipped} · {say('مش في الـCRM', 'Not in the CRM')}: {result.missing}{!!result.outOfRegion && <> · {say('خارج مناطقك', 'Outside your regions')}: {result.outOfRegion}</>}{!!result.invalid && <> · {say('غير صالحة', 'Invalid')}: {result.invalid}</>}</small></div></div>}
        <div className="erp-import-actions"><button type="button" className="btn subtle" disabled={!!busy || pending} onClick={close}>{result ? say('تم', 'Done') : say('إغلاق', 'Close')}</button>
          {result ? refreshFailed && <button type="button" className="btn primary" disabled={!!busy} onClick={refreshAfterApply}>{busy === 'refresh' ? <Loader2 className="spin" size={17}/> : <RefreshCw size={17}/>} {say('تحديث العرض بس', 'Refresh view only')}</button> :
            stale && !pending ? <button type="button" className="btn primary" disabled={!file || !!busy || refreshing} onClick={() => void runPreview(file, true)}>{busy === 'preview' ? <Loader2 className="spin" size={17}/> : <RefreshCw size={17}/>} {say('معاينة جديدة', 'New preview')}</button> :
            dirty && !refreshing && !pending ? <button type="button" className="btn primary" disabled={!file || !!busy} onClick={() => void runPreview(file, false)}><RefreshCw size={17}/> {say('تحديث المعاينة', 'Refresh preview')}</button> :
            <button type="button" className="btn primary" disabled={pending ? !!busy : !canApply} onClick={apply}>{busy === 'apply' ? <Loader2 className="spin" size={17}/> : <Upload size={17}/>} {pending ? say('تأكيد الحفظ', 'Confirm save') : say('تحديث الأكواد', 'Update codes')}</button>}
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}

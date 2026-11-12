'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { definiteSubmitRejection, submitJson, SubmitError } from '@/lib/client-submit';
import { t, useLanguage } from '@/lib/i18n';
import { customerCodeKey } from '@/lib/customer-identity';
import { ERP_ADD_CUSTOMER, ERP_CUSTOMERS_MAX_ADDS } from '@/lib/erp-customers-shared';
import type { ErpCustomerCandidate, ErpCustomerClearView, ErpCustomerOutcome, ErpCustomersSummary } from '@/lib/erp-customers';
import UploadStatus, {type UploadState} from './upload-status';
import type {ErpDatesView} from '@/lib/erp-customer-extras-server';
import './erp-sales-import.css';
import './erp-customers-import.css';
const messageOf = (e: unknown) => typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' ? e.message : '';

/** `clears` and `clearSnapshot` (2026-11-09): the customers the file does not name whose ERP code «امسح كود ERP للعملاء غير الموجودين في الشيت» clears. */
type Preview = { fileName: string; sheet: string; snapshot: string; summary: ErpCustomersSummary; rows: ErpCustomerOutcome[]; newRegions?: string[]; newRegion?: string | null; clears?: ErpCustomerClearView[]; clearSnapshot?: string; erpDates?: ErpDatesView };
type Choice = { row: number; customerId: string };
type Addition = { row: number; customerId: string; code: string; name: string; region: string; internalCode?: string };
type Result = { ok: true; updated: number; mappings: number; changed: number; added: number; unchanged: number; skipped: number; outOfRegion: number; heldOutside?: number; invalid: number; changes: { row: number; customerId: string; from: string; to: string; mapping: boolean }[]; additions?: Addition[]; cleared?: number; erpDatesUpdated?: number; alreadySaved?: boolean };
type SelectedFile = { fileName: string; base64: string; size: number };
type Filter = 'change' | 'same' | 'other' | 'all';
type Section = 'choose' | 'new' | 'rest';
type Props = { onClose: () => void; onImported: () => void | Promise<void> };
const endpoint = '/api/erp-customers';
const maxBytes = 1024 * 1024;
const pageSize = 20;
/** «مثل المنطقة أعلاه» in a new row's own region list: that row takes the region chosen for all the new customers. */
const sameRegion = '*';
const regionEnglish: Record<string, string> = { 'الوسطى': 'Central', 'الشرقية': 'Eastern', 'الغربية': 'Western', 'الشمالية': 'Northern', 'الجنوبية': 'Southern' };
const serverEnglish: Record<string, string> = {
  'تغيّرت بيانات العملاء منذ المعاينة؛ أجرِ معاينة جديدة': 'Customer data changed since the preview. Run a new preview.',
  'لم تعرض هذه الشاشة العملاء الجدد الذين سيُضافون؛ حدّث الصفحة وأجرِ معاينة جديدة': 'This screen did not show the new customers that would be added. Reload the page and run a new preview.',
  'فُتحت شاشة الاستيراد هذه قبل تحديث النظام؛ حدّث الصفحة وأجرِ معاينة جديدة. لم يُحفظ أي شيء. / This import screen was opened before the system update. Reload the page and run a new preview. Nothing was saved.': 'This import screen was opened before the system update. Reload the page and run a new preview. Nothing was saved.',
  'اخترت نفس العميل لأكثر من سطر؛ العميل له كود ERP واحد. راجع الاختيارات.': 'The same customer is chosen for more than one row; a customer has one ERP code. Review the choices.',
  'لا توجد أكواد تتغير ولا عملاء جدد في هذا الملف.': 'Nothing in this file changes a code or adds a customer.',
  'اعرض الملف أولًا قبل تحديث الأكواد': 'Preview the file before updating the codes.',
  'الطلب محفوظ ببيانات مختلفة. أجرِ معاينة جديدة.': 'This request was saved with different data. Run a new preview.',
  'استيراد عملاء ERP متاح لمدير النظام ومدير المبيعات فقط.': 'ERP customer import is for the system administrator and the sales manager only.',
  'أقصى حجم لملف عملاء ERP 1 ميجابايت': 'The ERP customer file must be 1 MB or smaller.',
  'ملف عملاء ERP لا يحتوي صفوف عملاء بعد العناوين': 'The ERP customer file has no customer rows below the header.',
  'هذا ليس ملف عملاء ERP: يجب أن يحتوي على عمود «رقم العميل» ومعه عمود الاسم أو الجوال. صدّر ملف العملاء من ERP كما هو.': 'This is not an ERP customer file: it needs the customer number column and a name or phone column. Export the customer file from ERP as it is.',
  'ترميز ملف العملاء غير صحيح': 'The customer file was not sent correctly. Choose it again.',
  'تكرار في اختيارات العملاء؛ أجرِ معاينة جديدة': 'A row was chosen twice. Run a new preview.',
  'تكرار في مناطق العملاء الجدد؛ أجرِ معاينة جديدة': 'A new customer was given two regions. Run a new preview.',
  'اختر منطقة صحيحة للعملاء الجدد.': 'Choose a valid region for the new customers.',
  'لا يمكنك إنشاء أو نقل عميل خارج منطقتك المسموح بها': 'You cannot add a customer outside your regions.',
  'ملف Excel لا يحتوي أوراقًا صالحة': 'The Excel file has no valid sheets.',
  'ملف XLSX تالف أو بصيغة غير مدعومة': 'The XLSX file is damaged or in an unsupported format.',
  'ارفع تقريرًا بصيغة XLSX الصحيحة': 'Upload a valid XLSX file.',
  'ملف Excel تالف؛ نزّل التقرير من ERP مرة أخرى': 'The Excel file is damaged. Export it from ERP again.',
  'ارفع ملف XLSX لا يحتوي على وحدات ماكرو': 'Upload a plain XLSX file without macros.',
  'ارفع تقرير XLSX بدون وحدات ماكرو أو روابط بيانات خارجية': 'Upload an XLSX file without macros or external data links.',
  'التقرير يحتوي روابط خارجية أو وحدات ماكرو غير مسموحة': 'The file contains external links or macros, which are not allowed.',
  'ملف Excel مشفر أو يحتوي ضغطًا غير مدعوم': 'The Excel file is encrypted or uses unsupported compression.',
  'عدد النصوص أو طولها في Excel يتجاوز الحد المسموح': 'The Excel file has too many or too long texts.',
  'سطور الملف تطابق العملاء أنفسهم أكثر من اللازم؛ صدّر ملف العملاء من ERP كما هو.': 'Too many rows of the file match the same customers. Export the customer file from ERP as it is.',
};
/** Server messages that carry a row, a column or a limit. */
const serverEnglishPatterns: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^عمود مكرر في الملف: (.+)$/, () => 'A column is repeated in the file.'],
  [/^الحد الأقصى للملف (\d+) (?:عميل|صف)$/, match => `The file can have at most ${match[1]} customers.`],
  [/^اختيار لسطر غير موجود في الملف \((\d+)\)؛ أجرِ معاينة جديدة$/, match => `A choice is for row ${match[1]}, which is not in the file. Run a new preview.`],
  [/^السطر (\d+) لا يقبل اختيار عميل$/, match => `Row ${match[1]} takes no customer choice. Run a new preview.`],
  [/^السطر (\d+) ليس عميلًا جديدًا؛ أجرِ معاينة جديدة$/, match => `Row ${match[1]} is not a new customer and cannot be added. Run a new preview.`],
  [/^العميل المختار للسطر (\d+) ليس من المرشحين؛ أجرِ معاينة جديدة$/, match => `The customer chosen for row ${match[1]} is not one of its candidates. Run a new preview.`],
  [/^الرقم (.+) عند عميل خارج مناطقك؛ ربطه لمدير النظام\.$/, match => `The number ${match[1]} is held by a customer outside your regions; only the system administrator can link it.`],
  [/^الحد الأقصى للعملاء الجدد في المرة الواحدة (\d+)؛ اترك الباقي وأضفهم في مرة أخرى\.$/, match => `At most ${match[1]} new customers can be added at once. Leave the rest and add them another time.`],
  [/^السطر (\d+): التقرير يحتوي معادلات؛ صدّره بالقيم فقط$/, match => `Row ${match[1]}: the file contains formulas. Export it with values only.`],
  [/^السطر (\d+): .+$/, match => `Row ${match[1]}: a cell cannot be read. Export the file from ERP again.`],
];
const englishOf = (value: string) => serverEnglish[value] || serverEnglishPatterns.reduce<string | null>((found, [pattern, english]) => { if (found) return found; const match = value.match(pattern); return match ? english(match) : null; }, null) || t(value);
/** The part of the preview a row belongs in by itself. A row the user acted on stays in the part where they acted (see `placed`), so a
 * choice never moves it away under their finger (a conflict resolved, or a preselected row picked again). */
const needsChoice = (row: ErpCustomerOutcome) => row.status === 'choose' || row.status === 'similar';
const isNew = (row: ErpCustomerOutcome) => row.status === 'new';
const naturalSection = (row: ErpCustomerOutcome): Section => needsChoice(row) ? 'choose' : isNew(row) ? 'new' : 'rest';
/** What the result lists as left: rows that could have changed or been added and were not (the server's `skipped`). */
const wasLeft = (row: ErpCustomerOutcome) => !row.customerId && !row.add && ['auto', 'same', 'choose', 'similar', 'new'].includes(row.status);
const inFilter = (row: ErpCustomerOutcome, filter: Filter): boolean => filter === 'all' ? true
  : filter === 'change' ? row.change && !row.conflict : filter === 'same' ? !!row.customerId && !row.change && !row.conflict
  : !inFilter(row, 'change') && !inFilter(row, 'same');
const unresolved = (row: ErpCustomerOutcome) => needsChoice(row) && (row.conflict || !row.customerId && !row.chosen);
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

/** «استيراد من ERP»: the ERP customer export updates each matched customer's ERP code and adds the customers the CRM does not have. The
 * server matches by phone, name or code and offers similar names (nothing is written by a preview); the user picks «ده هو», «عميل جديد»
 * or «سيبه» where asked, leaves new rows out if they want, and picks the region of the new customers; «حدّث X كود وضيف Y عميل» sends the
 * same file and choices again and the server applies them in one transaction. An unconfirmed apply is retried with the very same request. */
export default function ErpCustomersImport({ onClose, onImported }: Props) {
  const { language } = useLanguage();
  const say = (ar: string, en: string) => language === 'en' ? en : ar;
  const present = (value: string) => language === 'en' ? englishOf(value) : value;
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewChoices, setPreviewChoices] = useState<Choice[]>([]);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [region, setRegion] = useState<string | null>(null);
  const [rowRegions, setRowRegions] = useState<Record<number, string>>({});
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
  const [choosePage, setChoosePage] = useState(1);
  const [newPage, setNewPage] = useState(1);
  const [clearPage, setClearPage] = useState(1);
  /** «امسح كود ERP للعملاء غير الموجودين في الشيت», checked by default; unchecked, the apply clears nobody's code. */
  const [clearCodes, setClearCodes] = useState(true);
  const [placed, setPlaced] = useState<Record<number, Section>>({});
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
  const sectionOf = (row: ErpCustomerOutcome) => Object.hasOwn(placed, row.row) ? placed[row.row] : naturalSection(row);
  const { chooseRows, newRows, restRows } = useMemo(() => {
    const of = (section: Section) => rows.filter(row => (Object.hasOwn(placed, row.row) ? placed[row.row] : naturalSection(row)) === section);
    return { chooseRows: of('choose'), newRows: of('new'), restRows: of('rest') };
  }, [rows, placed]);
  const counts = useMemo(() => ({
    choose: rows.filter(unresolved).length, same: rows.filter(row => inFilter(row, 'same')).length,
    change: restRows.filter(row => inFilter(row, 'change')).length, restSame: restRows.filter(row => inFilter(row, 'same')).length, other: restRows.filter(row => inFilter(row, 'other')).length, all: restRows.length,
  }), [rows, restRows]);
  // A row the user acted on here stays shown even when the choice moves it out of the filter.
  const shown = useMemo(() => restRows.filter(row => inFilter(row, filter) || Object.hasOwn(placed, row.row)), [restRows, filter, placed]);
  const paged = <T,>(list: T[], at: number) => { const pages = Math.max(1, Math.ceil(list.length / pageSize)), currentPage = Math.min(at, pages); return { pages, currentPage, items: list.slice((currentPage - 1) * pageSize, currentPage * pageSize) }; };
  const restView = paged(shown, page), chooseView = paged(chooseRows, choosePage), newView = paged(newRows, newPage);
  const customers = useMemo(() => new Map(rows.flatMap(row => row.candidates.map(candidate => [candidate.id, candidate] as const))), [rows]);
  const conflicts = preview?.summary.conflicts || 0, changes = preview?.summary.changes || 0, adds = preview?.summary.adds || 0;
  const clears = useMemo(() => preview?.clears || [], [preview]), clearing = clearCodes && /^[a-f0-9]{64}$/.test(String(preview?.clearSnapshot)) ? clears.length : 0, clearView = paged(clears, clearPage);
  const regions = preview?.newRegions || [], chosenRegion = region ?? preview?.newRegion ?? null;
  const tooMany = adds > ERP_CUSTOMERS_MAX_ADDS, noRegion = adds > 0 && chosenRegion === null;
  const similarAdds = rows.filter(row => row.status === 'similar' && row.add).length, leftRows = rows.filter(wasLeft);
  const canApply = !!preview && !locked && !dirty && !refreshing && !stale && !conflicts && changes + adds + clearing + (preview?.erpDates?.updates || 0) > 0 && !tooMany && !noRegion;
  const regionText = (value: string) => value ? say(value, regionEnglish[value] || t(value)) : say('المنطقة غير محددة', 'Region not specified');
  const matchedText = (by: string) => by === 'both' ? say('بالجوال والاسم', 'by phone and name') : by === 'phone' ? say('بالجوال', 'by phone') : by === 'name' ? say('بالاسم', 'by name') : by === 'code' ? say('نفس الكود', 'same code') : by === 'similar' ? say('اسم قريب', 'similar name') : '';
  const issueText = (issue: ErpCustomerOutcome['issue']) => issue === 'no-code' ? say('بلا رقم عميل', 'No customer number') : issue === 'long-code' ? say('رقم العميل طويل جدًا', 'Customer number too long')
    : issue === 'too-many-phones' ? say('أرقام جوال كثيرة في السطر', 'Too many phone numbers in the row') : issue === 'too-many-matches' ? say('يطابق عملاء كثيرين', 'Matches too many customers')
    : issue === 'no-name' ? say('بلا اسم', 'No name') : say('رقم العميل متكرر في الملف', 'Customer number repeated in the file');
  const statusText = (row: ErpCustomerOutcome) => row.status === 'invalid' ? issueText(row.issue)
    : row.conflict ? say('العميل نفسه في أكثر من سطر', 'Same customer on several rows')
    : row.status === 'choose' ? (row.customerId ? say('اخترت العميل', 'Customer chosen') : row.chosen ? say('متروك', 'Left as is') : say('اختر العميل', 'Choose the customer'))
    : row.status === 'similar' ? (row.customerId ? say('اخترت العميل', 'Customer chosen') : row.add ? say('سيُضاف عميلًا جديدًا', 'Will be added as new') : row.chosen ? say('متروك', 'Left as is') : say('اسم قريب: اختر', 'Similar name: choose'))
    : row.status === 'new' ? (row.add ? say('سيُضاف', 'Will be added') : say('متروك', 'Left as is'))
    : row.status === 'out-of-region' ? say('خارج مناطقك', 'Outside your regions')
    : row.status === 'held-outside' ? say('الرقم عند عميل خارج مناطقك', 'Number held outside your regions')
    : !row.customerId ? say('متروك', 'Left as is') : !row.change ? say('نفس الكود', 'Same code') : codeChanges(row.from, row.to) ? say('سيتغيّر', 'Will change') : say('سيُربط الرقم به', 'Number will be linked');
  const tone = (row: ErpCustomerOutcome) => row.conflict || unresolved(row) ? 'warn' : row.customerId && row.change || row.add ? 'good' : 'muted';
  const filterLabel = (value: Filter) => ({ change: say('سيتغيّر', 'Will change'), same: say('بلا تغيير', 'No change'), other: say('باقي السطور', 'Other rows'), all: say('الكل', 'All') })[value];
  const filterCount = (value: Filter) => value === 'same' ? counts.restSame : counts[value];

  async function selectFile(selected?: File) {
    if (!selected || lock.current || previewing.current || pending || result) return;
    setError(''); setUploadState(null); setPreview(null); setPreviewChoices([]); setChoices({}); setRegion(null); setRowRegions({}); setPlaced({}); setStale(false); setFile(null); setPage(1); setChoosePage(1); setNewPage(1); setClearPage(1); setClearCodes(true); wanted.current = []; attempt.current = null;
    if (!/\.xlsx$/i.test(selected.name)) { setError(say('اختر ملف العملاء من ERP بصيغة .xlsx.', 'Choose the ERP customer file in .xlsx format.')); return; }
    if (!selected.size || selected.size > maxBytes) { setError(say('يجب ألا يكون الملف فارغًا وألا يزيد حجمه على 1 ميجابايت.', 'The file must not be empty and must be no larger than 1 MB.')); return; }
    lock.current = true; setBusy('read'); setUploadState({phase:'reading'});
    let chosen: SelectedFile | null = null;
    try {
      chosen = { fileName: selected.name.slice(0, 255), base64: await readFile(selected), size: selected.size };
      if (live.current) setFile(chosen);
    } catch {
      if (live.current) { setUploadState(null); setError(say('تعذّرت قراءة الملف. اختره مرة أخرى أو صدّره من ERP من جديد.', 'Could not read the file. Select it again or export a fresh copy from ERP.')); }
    } finally { lock.current = false; if (live.current) setBusy(null); }
    if (chosen && live.current) await runPreview(chosen, true);
  }

  /** A fresh preview (a new file, or after the data changed) starts the choices over; otherwise the latest choices are previewed, one
   * request at a time: choices made meanwhile are sent as soon as the current answer arrives, and only the last answer is shown. */
  async function runPreview(target: SelectedFile | null, fresh: boolean) {
    if (!target || saved.current) return;
    if (fresh) { wanted.current = []; setChoices({}); setRegion(null); setRowRegions({}); setPlaced({}); setClearCodes(true); }
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
        setFilter(answer.rows.some(row => !needsChoice(row) && !isNew(row) && inFilter(row, 'change')) ? 'change' : 'all'); setPage(1); setChoosePage(1); setNewPage(1); setClearPage(1);
        requestAnimationFrame(() => previewHeading.current?.focus());
      }
    } catch (e) {
      if (!live.current) return;
      if (fresh) { setUploadState({phase:'error'}); setPreview(null); }
      setError(messageOf(e));
    } finally { previewing.current = false; if (live.current) { setBusy(null); setRefreshing(false); } }
  }

  /** A row's choice: a customer id («هو نفسه»), ERP_ADD_CUSTOMER («عميل جديد»), '' («اتركه»), or none (the row's default). */
  function decide(outcome: ErpCustomerOutcome, value?: string) {
    if (locked || stale) return;
    const row = outcome.row, next = { ...choices };
    if (!Object.hasOwn(placed, row)) setPlaced({ ...placed, [row]: sectionOf(outcome) });
    if (value === undefined) delete next[row]; else next[row] = value;
    setChoices(next); wanted.current = choiceList(next); setError('');
    void runPreview(file, false);
  }
  function setRowRegion(row: number, value: string) {
    if (locked || stale) return;
    const next = { ...rowRegions };
    if (value === sameRegion) delete next[row]; else next[row] = value;
    setRowRegions(next);
  }

  async function refreshAfterApply() {
    if (lock.current) return;
    lock.current = true; setBusy('refresh'); setError('');
    try {
      await onImported();
      if (live.current) setRefreshFailed(false);
    } catch {
      if (live.current) { setRefreshFailed(true); setError(say('حُفظ التحديث، لكن تعذّر تحديث قائمة العملاء. حدّث العرض فقط؛ لن يُرسل التحديث مرة أخرى.', 'The update was saved, but the customer list could not refresh. Refresh the view only; the update will not be sent again.')); }
    } finally { lock.current = false; if (live.current) setBusy(null); }
  }

  async function apply() {
    if (lock.current || saved.current || !file || !preview || (!pending && !canApply)) return;
    lock.current = true; setBusy('apply'); setError(''); setUploadState({phase:'uploading',loaded:0,total:null,percent:null});
    // The whole request is kept: a retry after an unconfirmed answer repeats it exactly, so the server returns the saved result.
    if (!attempt.current) {
      const added = new Set(rows.filter(row => row.add).map(row => row.row));
      const ownRegions = Object.entries(rowRegions).map(([row, value]) => ({ row: Number(row), region: value })).filter(entry => added.has(entry.row)).sort((a, b) => a.row - b.row);
      attempt.current = JSON.stringify({ action: 'apply', fileName: file.fileName, base64: file.base64, snapshot: preview.snapshot, requestId: crypto.randomUUID(), choices: previewChoices, ...(chosenRegion === null ? {} : { region: chosenRegion }), regions: ownRegions, adds, ...(clearing ? { clearCodes: true, clearSnapshot: preview.clearSnapshot } : {}) });
    }
    let acknowledged = false;
    try {
      const answer = await submitJson<Result>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: attempt.current }, { language, timeout: 60000, onUploadProgress: progress => { if (live.current) setUploadState(progress); } });
      if (answer.ok !== true || !['updated', 'mappings', 'changed', 'added', 'unchanged', 'skipped'].every(key => Number.isSafeInteger(answer[key as keyof Result]) && Number(answer[key as keyof Result]) >= 0) || !Array.isArray(answer.changes) || (answer.additions !== undefined && !Array.isArray(answer.additions)) || (answer.cleared !== undefined && !(Number.isSafeInteger(answer.cleared) && answer.cleared >= 0))) throw new SubmitError(say('الخادم لم يؤكد الحفظ. أعد المحاولة بنفس البيانات.', 'The server did not confirm the update. Retry with the same data.'));
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
  const pager = (view: { pages: number; currentPage: number }, setAt: (page: number) => void, label: string) => view.pages > 1 && <nav className="erp-import-pagination" aria-label={label}><button type="button" className="btn subtle small" disabled={view.currentPage === 1} onClick={() => setAt(view.currentPage - 1)}>{say('السابق', 'Previous')}</button><span dir="ltr">{view.currentPage} / {view.pages}</span><button type="button" className="btn subtle small" disabled={view.currentPage === view.pages} onClick={() => setAt(view.currentPage + 1)}>{say('التالي', 'Next')}</button></nav>;
  const selectedOf = (row: ErpCustomerOutcome) => Object.hasOwn(choices, row.row) ? choices[row.row] : row.add ? ERP_ADD_CUSTOMER : row.chosen || row.customerId ? row.customerId : null;
  /** A choice button; `named` (for «هو نفسه») is its accessible name with the candidate it picks, so two candidates never read the same. */
  const pick = (row: ErpCustomerOutcome, value: string, label: string, pressed: boolean, kind: string, named?: string) => <button type="button" className={'erp-customers-pick is-' + kind} data-row={row.row} data-choice={value} aria-pressed={pressed} aria-label={named} disabled={locked || stale} onClick={() => decide(row, value)}>{label}</button>;
  const rowLabel = (row: ErpCustomerOutcome) => say(`سطر ${row.row} · رقم ERP ${row.code || '—'}`, `Row ${row.row} · ERP number ${row.code || '—'}`);
  const leftReason = (row: ErpCustomerOutcome) => row.chosen ? say('تركته', 'You left it') : row.status === 'similar' ? say('اسم قريب، ولم تختر', 'Similar name, nothing chosen') : row.status === 'choose' ? say('لم تختر العميل', 'No customer chosen') : say('متروك', 'Left');

  const card = (row: ErpCustomerOutcome) => {
    const target = customers.get(row.customerId), selected = selectedOf(row), left = selected === '';
    return <article className="erp-customers-row" key={row.row} data-row={row.row} data-status={row.status} data-tone={tone(row)}>
      <div className="erp-customers-row-head"><strong>{say('رقم ERP', 'ERP number')} <bdi dir="ltr">{row.code || '—'}</bdi></strong><span className="erp-customers-badge" data-tone={tone(row)}>{statusText(row)}</span></div>
      <p className="erp-customers-name"><bdi>{row.name || '—'}</bdi></p>
      <small className="erp-customers-meta">{say('سطر', 'Row')} <bdi>{row.row}</bdi>{!!row.phones.length && <> · {say('جوال', 'Phone')} {row.phones.map(phone => <bdi dir="ltr" key={phone}>…{phone}</bdi>)}</>}{row.customerId && row.matchedBy && <> · {say('مطابق', 'Matched')} {matchedText(row.matchedBy)}</>}</small>
      {row.customerId && !row.conflict && (row.change && codeChanges(row.from, row.to) ? <p className="erp-customers-change">{say('قبل ← بعد', 'Before → after')}: {beforeAfter(row.from, row.to)} · {customerLine(target)}</p> : <p className="erp-customers-same">{say('نفس الكود عند', 'Same code at')} {customerLine(target)}</p>)}
      {row.customerId && row.matchedBy === 'code' && !row.change && !row.conflict && <p className="erp-customers-same">{say('هذا الرقم هو كود ERP الحالي لهذا العميل في الـCRM؛ لن يتغيّر شيء ولن يُضاف عميل.', 'This number is already this customer\'s current ERP code in the CRM; nothing changes and no customer is added.')}</p>}
      {row.customerId && row.sharedWith > 0 && row.change && !row.conflict && <p className="erp-customers-shared">{say(`هذا الكود لدى ${row.sharedWith} عميل آخر أيضًا؛ ستُحتسب الفواتير لهذا العميل`, `This code is also held by ${row.sharedWith} other customer(s); its invoices will count for this customer`)}</p>}
      {row.status === 'out-of-region' && <p className="erp-customers-same">{row.matchedBy === 'similar' ? say('يوجد عميل باسم قريب خارج مناطقك؛ لن يُضاف ولن يتغيّر شيء. إن كان عميلًا جديدًا فعلًا، فيمكن لمدير النظام إضافته.', 'A customer with a similar name is outside your regions; nothing is added or changed. If it really is a new customer, the system administrator can add it.') : say('العميل المطابق خارج مناطقك؛ لن يتغيّر شيء.', 'The matching customer is outside your regions; nothing changes.')}</p>}
      {row.status === 'held-outside' && <p className="erp-customers-same">{say('هذا الرقم لدى عميل خارج مناطقك؛ ربطه لمدير النظام، ولن يتغيّر شيء.', 'This number is held by a customer outside your regions; only the system administrator can link it. Nothing changes.')}</p>}
      {row.issue === 'too-many-phones' && <p className="erp-customers-same">{say('في السطر أكثر من 5 أرقام جوال؛ صحّحه في ERP. لن يتغيّر شيء.', 'The row lists more than 5 phone numbers; correct it in ERP. Nothing changes.')}</p>}
      {row.issue === 'too-many-matches' && <p className="erp-customers-same">{say('هذا الجوال أو الاسم لدى أكثر من 20 عميلًا؛ لن يتغيّر شيء.', 'More than 20 customers have this phone or name; nothing changes.')}</p>}
      {row.issue === 'no-name' && <p className="erp-customers-same">{say('السطر بلا اسم ولا يوجد عميل بالجوال أو الكود نفسه؛ لن يُضاف. صحّحه في ERP.', 'The row has no name and no customer has its phone or code; it is not added. Correct it in ERP.')}</p>}
      {!!row.codeRow && !row.conflict && <p className="erp-customers-shared">{say(`كود هذا العميل الحالي موجود في السطر ${row.codeRow} من الملف؛ أكّد أنه هو أو اتركه.`, `This customer’s current code is row ${row.codeRow} of the file; confirm it is this customer or leave it.`)}</p>}
      {row.status === 'similar' && <p className="erp-customers-shared">{say('لا يوجد عميل بالجوال أو الاسم نفسه تمامًا، لكن توجد أسماء قريبة. اضغط «هو نفسه» إن كان العميل نفسه، أو «عميل جديد» إن لم يكن، أو «اتركه». إن لم تختر فلن يتغيّر شيء.', 'No customer has exactly this phone or name, but some names are close. Choose “This one” if it is the same customer, “New customer” if not, or “Leave it”. Without a choice nothing changes.')}</p>}
      {row.status === 'new' && <p className="erp-customers-same">{row.add ? say('غير موجود في الـCRM؛ سيُضاف عميلًا جديدًا باسمه وكوده وجواله وبريده الإلكتروني وعنوانه.', 'Not in the CRM; it will be added as a new customer with its name, code, phones, email and address.') : say('متروك؛ لن يُضاف.', 'Left; it will not be added.')}</p>}
      {!!row.candidates.length && <div className="erp-customers-candidates" role="group" aria-label={say('العميل لـ', 'Customer for ') + rowLabel(row)}>
        {row.candidates.map(candidate => <div className="erp-customers-candidate" data-selected={selected === candidate.id} key={candidate.id}>
          <span><strong><bdi>{candidate.name}</bdi></strong>
            <small>{say('كود يورست', 'Yourrest code')}: <bdi dir="ltr">{candidate.internalCode || '—'}</bdi> · {say('كود ERP الحالي', 'Current ERP code')}: <bdi dir="ltr">{candidate.code || '—'}</bdi></small>
            <small>{regionText(candidate.region)}{!!candidate.phones.length && <> · {candidate.phones.map(phone => <bdi dir="ltr" key={phone}>…{phone}</bdi>)}</>} · {say('السبب', 'Why')}: {matchedText(candidate.matchedBy)}</small></span>
          {pick(row, candidate.id, say('هو نفسه', 'This one'), selected === candidate.id, 'customer', `${say('هو نفسه', 'This one')}: ${candidate.name} · ${candidate.internalCode || '—'}`)}
        </div>)}
        <div className="erp-customers-choices">
          {row.status === 'similar' && pick(row, ERP_ADD_CUSTOMER, say('عميل جديد', 'New customer'), selected === ERP_ADD_CUSTOMER, 'add')}
          {pick(row, '', say('اتركه', 'Leave it'), left, 'leave')}
        </div>
      </div>}
      {row.status === 'new' && <div className="erp-customers-choices" role="group" aria-label={rowLabel(row)}>
        <button type="button" className="erp-customers-pick is-leave" data-row={row.row} data-choice="" aria-pressed={left} disabled={locked || stale} onClick={() => decide(row, left ? undefined : '')}>{say('اتركه', 'Leave it')}</button>
        {row.add && regions.length > 1 && <label className="erp-customers-row-region"><span>{say('المنطقة', 'Region')}</span>
          <select value={Object.hasOwn(rowRegions, row.row) ? rowRegions[row.row] : sameRegion} disabled={locked || stale} onChange={event => setRowRegion(row.row, event.target.value)}>
            <option value={sameRegion}>{say('مثل المنطقة أعلاه', 'Same as above')}</option>
            {regions.map(value => <option key={value || 'none'} value={value}>{regionText(value)}</option>)}
          </select></label>}
      </div>}
    </article>;
  };

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="crm-dialog erp-import-dialog erp-customers-dialog" dir={language === 'en' ? 'ltr' : 'rtl'} showCloseButton={false}
      onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy || pending) event.preventDefault(); }}>
      <header className="erp-import-heading">
        <div><DialogTitle><FileSpreadsheet size={22} aria-hidden="true"/>{say('استيراد من ERP', 'Import from ERP')}</DialogTitle>
          <DialogDescription>{say('يحدّث «كود العميل في ERP» للعملاء الموجودين (بالجوال أو الاسم أو الكود)، ويضيف العملاء غير الموجودين في الـCRM. لا تتغيّر بقية بيانات العملاء الموجودين.', 'Updates the ERP code of the customers the CRM has (matched by phone, name or code) and adds the ones it does not have. Nothing else of the existing customers changes.')}</DialogDescription></div>
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

        <UploadStatus state={uploadState} fileName={file?.fileName} completeLabel={say('تم الحفظ', 'Saved')} disabled={!!busy} onRetry={pending ? apply : () => void runPreview(file, true)}/>

        {result && <section className="erp-customers-result" aria-labelledby="erp-customers-result-heading">
          <h3 id="erp-customers-result-heading">{say('ما تغيّر', 'What changed')}</h3>
          {!result.changes.length ? <p className="erp-import-hint">{say('لم تتغيّر أي أكواد.', 'No codes changed.')}</p> :
            <ol className="erp-customers-changes">{result.changes.map(change => <li key={change.row}><span>{customerLine(customers.get(change.customerId)) || <bdi dir="ltr">{change.customerId}</bdi>}</span>
              <span>{codeChanges(change.from, change.to) ? <>{say('قبل ← بعد', 'Before → after')}: {beforeAfter(change.from, change.to)}</> : <>{say('نفس الكود', 'Same code')} <bdi dir="ltr">{change.to}</bdi></>}{change.mapping && <small> · {say('ستُحتسب فواتير هذا الرقم لهذا العميل', 'invoices with this number count for this customer')}</small>}</span></li>)}</ol>}
          <h3 id="erp-customers-added-heading">{say('ما أُضيف', 'What was added')}</h3>
          {!result.additions?.length ? <p className="erp-import-hint">{say('لم يُضف عملاء جدد.', 'No new customers were added.')}</p> :
            <ol className="erp-customers-changes erp-customers-added">{result.additions.map(addition => <li key={addition.row}><span><bdi>{addition.name}</bdi> · <bdi dir="ltr" className="erp-customers-yr">{addition.internalCode || '—'}</bdi></span>
              <span>{say('كود ERP', 'ERP code')} <bdi dir="ltr">{addition.code}</bdi> · {regionText(addition.region)}</span></li>)}</ol>}
          {!!result.cleared && <><h3 id="erp-customers-cleared-heading">{say('ما مُسح كوده', 'Codes cleared')}</h3>
            <ol className="erp-customers-changes erp-customers-cleared-list">{clears.map(clear => <li key={clear.customerId}><span><bdi>{clear.name || '—'}</bdi> · <bdi dir="ltr" className="erp-customers-yr">{clear.internalCode || '—'}</bdi></span>
              <span>{say('قبل ← بعد', 'Before → after')}: {beforeAfter(clear.code, '—')}</span></li>)}</ol></>}
          <h3 id="erp-customers-left-heading">{say('ما تُرك', 'What was left')}</h3>
          {!leftRows.length ? <p className="erp-import-hint">{say('لم تُترك أي سطور.', 'No rows were left.')}</p> :
            <ol className="erp-customers-changes erp-customers-left">{leftRows.map(row => <li key={row.row}><span><bdi>{row.name || '—'}</bdi> · {say('رقم ERP', 'ERP number')} <bdi dir="ltr">{row.code || '—'}</bdi></span>
              <small>{say('سطر', 'Row')} <bdi>{row.row}</bdi> · {leftReason(row)}</small></li>)}</ol>}
        </section>}

        {preview && !result && <>
          <section className="erp-import-preview" aria-labelledby="erp-customers-preview-heading">
            <h3 id="erp-customers-preview-heading" ref={previewHeading} tabIndex={-1}>{say('ملخص المعاينة', 'Preview summary')}</h3>
            <p className="erp-customers-summary" aria-live="polite">{clears.length ? say(`${changes} كود سيتغيّر، ${counts.choose} عميل يحتاج إلى اختيارك، ${adds} عميل جديد سيُضاف، ${clearing} كود ERP سيُمسح.`, `${changes} code(s) will change, ${counts.choose} customer(s) need a choice, ${adds} new customer(s) will be added, ${clearing} ERP code(s) will be cleared.`)
              : say(`${changes} كود سيتغيّر، ${counts.choose} عميل يحتاج إلى اختيارك، ${adds} عميل جديد سيُضاف.`, `${changes} code(s) will change, ${counts.choose} customer(s) need a choice, ${adds} new customer(s) will be added.`)}</p>
            <div className="erp-import-counts">
              {([[say('سيتغيّر', 'Will change'), changes], [say('يحتاج إلى اختيارك', 'Needs a choice'), counts.choose], [say('عملاء جدد', 'New customers'), adds], [say('بلا تغيير', 'No change'), counts.same]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
            </div>
            <p className="erp-customers-stats"><span>{say('السطور', 'Rows')}: <bdi>{preview.summary.rows}</bdi></span><span>{say('مطابق تلقائي', 'Matched automatically')}: <bdi>{preview.summary.auto}</bdi></span>{!!preview.summary.outOfRegion && <span>{say('خارج مناطقك', 'Outside your regions')}: <bdi>{preview.summary.outOfRegion}</bdi></span>}{!!preview.summary.heldOutside && <span>{say('الرقم عند عميل خارج مناطقك', 'Number held outside your regions')}: <bdi>{preview.summary.heldOutside}</bdi></span>}{!!preview.summary.invalid && <span>{say('سطور غير صالحة', 'Invalid rows')}: <bdi>{preview.summary.invalid}</bdi></span>}{!!preview.summary.mappings && <span>{say('أرقام لدى عميل آخر', 'Numbers held by another customer')}: <bdi>{preview.summary.mappings}</bdi></span>}<span>{say('الورقة', 'Sheet')}: <bdi>{preview.sheet}</bdi></span></p>
            {/* «التاريخ» (the customer's creation day in ERP) and the representative's column: what the import writes (lib/erp-customer-extras.ts). */}
            {(preview.erpDates?.dateColumn || preview.erpDates?.repColumn) && <p className="erp-customers-stats erp-customers-dates" data-updates={preview.erpDates.updates}>
              {preview.erpDates.dateColumn && <span>{say('تاريخ الإنشاء في ERP', 'ERP creation date')}: <bdi>{preview.erpDates.dates}</bdi></span>}
              {!!preview.erpDates.invalidDates && <span>{say('تاريخ غير مقروء (يبقى كما هو)', 'Unreadable date (left as is)')}: <bdi>{preview.erpDates.invalidDates}</bdi></span>}
              {preview.erpDates.repColumn && <span>{say('المندوب في الملف', 'Representative in the file')}: <bdi>{preview.erpDates.reps}</bdi></span>}
              <span>{say('عملاء موجودون يُحدَّث تاريخهم أو مندوبهم في ERP', 'Existing customers whose ERP date or representative is updated')}: <bdi>{preview.erpDates.updates}</bdi></span></p>}
            {refreshing && <p className="erp-import-hint" role="status"><Loader2 size={14} className="spin" aria-hidden="true"/> {say('جارٍ تحديث المعاينة باختياراتك…', 'Updating the preview with your choices…')}</p>}
            {!!conflicts && !dirty && <p className="erp-import-notice" role="status">{say('اختير عميل لأكثر من سطر، وللعميل كود ERP واحد. اختر عميلًا آخر أو «اتركه» في أحد السطرين.', 'A customer is chosen for more than one row, and a customer has one ERP code. Choose another customer or “Leave it” on one of them.')}</p>}
            {tooMany && !dirty && <p className="erp-import-notice" role="status">{say(`الحد الأقصى للعملاء الجدد في المرة الواحدة ${ERP_CUSTOMERS_MAX_ADDS}؛ اترك الباقي («اتركه») وأضفهم في مرة أخرى.`, `At most ${ERP_CUSTOMERS_MAX_ADDS} new customers can be added at once; leave the rest and add them another time.`)}</p>}
            {noRegion && <p className="erp-import-notice" role="status">{say('لا توجد منطقة مسموح لك بإضافة عملاء فيها؛ اترك العملاء الجدد أو تواصل مع مدير النظام.', 'You have no region to add customers in; leave the new customers or ask the system administrator.')}</p>}
          </section>

          {!!chooseRows.length && <section className="erp-import-documents erp-customers-section" data-section="choose" aria-labelledby="erp-customers-choose-heading">
            <div className="erp-import-section-heading"><h3 id="erp-customers-choose-heading">{say('يحتاج إلى اختيارك', 'Needs a choice')} <bdi>{counts.choose}</bdi></h3></div>
            <p className="erp-import-hint">{say('لكل سطر: «هو نفسه» إن كان هذا العميل نفسه (يأخذ كود ERP)، أو «اتركه». وما لا تختار له يبقى بلا تغيير.', 'For each row: “This one” if that customer is the same (it takes the ERP code), or “Leave it”. A row left without a choice stays unchanged.')}</p>
            <div className="erp-customers-list">{chooseView.items.map(card)}</div>
            {pager(chooseView, setChoosePage, say('صفحات «يحتاج إلى اختيارك»', 'Pages of “Needs a choice”'))}
          </section>}

          {(!!newRows.length || adds > 0) && <section className="erp-import-documents erp-customers-section" data-section="new" aria-labelledby="erp-customers-new-heading">
            <div className="erp-import-section-heading"><h3 id="erp-customers-new-heading">{say('عملاء جدد سيُضافون', 'New customers to add')} <bdi>{adds}</bdi></h3></div>
            <p className="erp-import-hint">{say('هؤلاء العملاء غير موجودين في الـCRM، وسيُضافون باسمك (أنت المسؤول عنهم) وفي فرعك. يمكنك نقلهم إلى مندوب لاحقًا من «تعديل». اضغط «اتركه» على أي عميل لا تريد إضافته.', 'These customers are not in the CRM. They will be added under your name (you are responsible for them) and your branch; you can move them to a representative later with “Edit”. Choose “Leave it” on any you do not want to add.')}</p>
            {!!similarAdds && <p className="erp-import-hint erp-customers-similar-adds">{say(`منهم ${similarAdds} من «يحتاج إلى اختيارك» اخترت لهم «عميل جديد».`, `${similarAdds} of them are rows in “Needs a choice” you marked “New customer”.`)}</p>}
            {!!regions.length && <label className="field erp-customers-region" htmlFor="erp-customers-region"><span>{say('منطقة العملاء الجدد', 'Region for the new customers')}</span>
              <select id="erp-customers-region" value={chosenRegion ?? ''} disabled={locked || stale} onChange={event => setRegion(event.target.value)}>
                {regions.map(value => <option key={value || 'none'} value={value}>{regionText(value)}</option>)}
              </select></label>}
            <div className="erp-customers-list">{newView.items.map(card)}</div>
            {pager(newView, setNewPage, say('صفحات العملاء الجدد', 'Pages of new customers'))}
          </section>}

          {!!clears.length && <section className="erp-import-documents erp-customers-section" data-section="clear" aria-labelledby="erp-customers-clear-heading">
            <div className="erp-import-section-heading"><h3 id="erp-customers-clear-heading">{say('عملاء غير موجودين في الشيت: سيُمسح كود ERP الخاص بهم', 'Customers not in the sheet: their ERP code will be cleared')} <bdi>({clears.length})</bdi></h3></div>
            <label className="erp-customers-clear-toggle"><input type="checkbox" checked={clearCodes} disabled={locked || stale} onChange={event => setClearCodes(event.target.checked)}/><span>{say('امسح كود ERP للعملاء غير الموجودين في الشيت', 'Clear the ERP code of the customers not in the sheet')}</span></label>
            <p className="erp-import-hint">{clearCodes ? say('لهؤلاء العملاء كود ERP في الـCRM وهم غير موجودين في ملف ERP (لا برقمهم ولا بجوالهم ولا باسمهم). سيصبح كود ERP الخاص بهم فارغًا، فلا يُعدّون من عملاء ERP ولا تُنسب إليهم بعد ذلك أي فاتورة أو عرض سعر أو آخر شراء من ERP؛ يبقى كودهم القديم في سجل التغييرات فقط.', 'These customers have an ERP code in the CRM but are not in the ERP file (not by their number, phone or name). Their ERP code will be emptied: they are no longer ERP customers, and no ERP invoice, quotation or last purchase is attributed to them from then on; the old code stays in the change history only.')
              : say('لن يتغيّر كود ERP الخاص بهم.', 'Their ERP codes will not change.')}</p>
            <ol className="erp-customers-changes erp-customers-clears">{clearView.items.map(clear => <li key={clear.customerId} data-customer={clear.customerId}><span><bdi>{clear.name || '—'}</bdi> · <bdi dir="ltr" className="erp-customers-yr">{clear.internalCode || '—'}</bdi></span>
              <span>{say('كود ERP الحالي', 'Current ERP code')}: <bdi dir="ltr">{clear.code}</bdi>{clearCodes && <> · {say('سيُمسح', 'will be cleared')}</>}</span></li>)}</ol>
            {pager(clearView, setClearPage, say('صفحات العملاء غير الموجودين في الشيت', 'Pages of the customers not in the sheet'))}
          </section>}

          {!!restRows.length && <section className="erp-import-documents erp-customers-section" data-section="rest" aria-labelledby="erp-customers-rows-heading">
            <div className="erp-import-section-heading"><h3 id="erp-customers-rows-heading">{say('باقي سطور الملف', 'Other file rows')}</h3></div>
            <div className="erp-customers-filters" role="group" aria-label={say('عرض', 'Show')}>
              {(['change', 'same', 'other', 'all'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }}>{filterLabel(value)} <bdi>{filterCount(value)}</bdi></button>)}
            </div>
            <div className="erp-customers-list">{restView.items.map(card)}</div>
            {!shown.length && <p className="erp-import-hint">{say('لا توجد سطور هنا.', 'No rows here.')}</p>}
            {pager(restView, setPage, say('صفحات المعاينة', 'Preview pages'))}
          </section>}
        </>}
        {!preview && !result && !file && !busy && <div className="erp-import-state"><AlertCircle size={22} aria-hidden="true"/><p>{say('اختر ملف العملاء المُصدَّر من ERP (ورقة Customer).', 'Choose the customer file exported from ERP (sheet Customer).')}</p></div>}
      </div>

      <footer className="erp-import-footer">
        {!!error && <p className="form-error" role="alert">{present(error)}</p>}
        {pending && <p className="erp-import-notice" role="status">{say('لم يُؤكَّد الحفظ بسبب الاتصال. البيانات مثبّتة؛ اضغط «تأكيد الحفظ» ليُعاد إرسال الطلب نفسه دون تكرار.', 'The connection did not confirm the update. Your data is locked; choose “Confirm save” to send the same request again without duplicates.')}</p>}
        {canApply && <p className="erp-customers-ready">{clearing ? say(`سيُحدَّث ${changes} عميل ويُضاف ${adds} عميل جديد ويُمسح كود ERP لـ ${clearing} عميل في خطوة واحدة.`, `${changes} customer(s) will be updated, ${adds} new customer(s) added and ${clearing} ERP code(s) cleared in one step.`)
          : say(`سيُحدَّث ${changes} عميل ويُضاف ${adds} عميل جديد في خطوة واحدة.`, `${changes} customer(s) will be updated and ${adds} new customer(s) added in one step.`)}</p>}
        {stale && !pending && <p className="erp-import-notice" role="status">{say('أجرِ معاينة جديدة؛ ستبدأ اختياراتك من جديد على البيانات الجديدة.', 'Run a new preview; your choices start over on the new data.')}</p>}
        {result && <div className="erp-import-success" role="status"><CheckCircle2 size={21}/><div><strong>{result.added ? say('تم تحديث الأكواد وإضافة العملاء', 'Codes updated and customers added') : say('تم تحديث الأكواد', 'Codes updated')}</strong>
          <p>{say('تغيّر كودها', 'Codes changed')}: {result.updated} · {say('عملاء حُدِّثوا', 'Customers updated')}: {result.changed} · {say('عملاء أُضيفوا', 'Customers added')}: {result.added}{!!result.mappings && <> · {say('أرقام رُبطت بعميلها', 'Numbers linked to their customer')}: {result.mappings}</>}{!!result.cleared && <> · <span className="erp-customers-cleared">{say(`مُسح كود ERP لـ ${result.cleared} عميل غير موجود في الشيت`, `ERP code cleared for ${result.cleared} customer(s) not in the sheet`)}</span></>}</p>
          <small>{!!result.erpDatesUpdated && <>{say('تاريخ الإنشاء أو المندوب في ERP حُدِّث لـ', 'ERP creation date or representative updated for')}: {result.erpDatesUpdated} · </>}{say('بلا تغيير', 'No change')}: {result.unchanged} · {say('متروك', 'Left')}: {result.skipped}{!!result.outOfRegion && <> · {say('خارج مناطقك', 'Outside your regions')}: {result.outOfRegion}</>}{!!result.heldOutside && <> · {say('الرقم عند عميل خارج مناطقك', 'Number held outside your regions')}: {result.heldOutside}</>}{!!result.invalid && <> · {say('غير صالحة', 'Invalid')}: {result.invalid}</>}</small></div></div>}
        <div className="erp-import-actions"><button type="button" className="btn subtle" disabled={!!busy || pending} onClick={close}>{result ? say('تم', 'Done') : say('إغلاق', 'Close')}</button>
          {result ? refreshFailed && <button type="button" className="btn primary" disabled={!!busy} onClick={refreshAfterApply}>{busy === 'refresh' ? <Loader2 className="spin" size={17}/> : <RefreshCw size={17}/>} {say('تحديث العرض فقط', 'Refresh view only')}</button> :
            stale && !pending ? <button type="button" className="btn primary" disabled={!file || !!busy || refreshing} onClick={() => void runPreview(file, true)}>{busy === 'preview' ? <Loader2 className="spin" size={17}/> : <RefreshCw size={17}/>} {say('معاينة جديدة', 'New preview')}</button> :
            dirty && !refreshing && !pending ? <button type="button" className="btn primary" disabled={!file || !!busy} onClick={() => void runPreview(file, false)}><RefreshCw size={17}/> {say('تحديث المعاينة', 'Refresh preview')}</button> :
            <button type="button" className="btn primary erp-customers-apply" disabled={pending ? !!busy : !canApply} onClick={apply}>{busy === 'apply' ? <Loader2 className="spin" size={17}/> : <Upload size={17}/>} {pending ? say('تأكيد الحفظ', 'Confirm save') : clearing ? say(`حدّث ${changes} كود وأضف ${adds} عميل وامسح ${clearing} كود`, `Update ${changes} code(s), add ${adds} customer(s) and clear ${clearing} code(s)`) : say(`حدّث ${changes} كود وأضف ${adds} عميل`, `Update ${changes} code(s) and add ${adds} customer(s)`)}</button>}
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}

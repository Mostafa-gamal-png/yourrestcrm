'use client';

// «العميل الصحيح لهذا الكود»: one ERP customer code that two or more CRM customers carry (lib/customer-identity.ts customerCodeCandidates),
// and the choice of the one it means. Used by the ERP quotations import (app/erp-quotes-import.tsx, its «أكواد مشتركة بين أكثر من عميل»)
// and written to be used by the ERP sales import too. The choice is saved on its own, with «حفظ الربط», through the existing
// POST /api/customer-identities (lib/customer-identity-server.ts saveCustomerIdentity: the administrator with every region only, exactly
// the customers that carry the code, the identity revision and the mapping's and customer's versions, the audit line «ربط كود عميل ERP»,
// and a request id that makes a retried save the same save). It is never part of an import: a mapping is global (it also decides the KPI
// invoices and the customer's last purchase), so it is a decision of its own, and the screen previews the file again after it.
// The candidates come from the server (never a customer that does not carry the code); whoever may not map sees only the code and that
// the administrator has to choose.
import React, { useRef, useState } from 'react';
import { CheckCircle2, Link2, Loader2 } from 'lucide-react';
import { definiteSubmitRejection, submitJson, SubmitError } from '@/lib/client-submit';
import { t, useLanguage } from '@/lib/i18n';
import './erp-code-choice.css';

export type ErpCodeCandidate = { id: string; name: string; internalCode: string; region: string; branch: string; version: number };
export type ErpSharedCode = {
  codeKey: string; customerCode: string; quotations: number; status: 'mapped' | 'ambiguous';
  /** Only for whoever may map identities. */
  mappedCustomerId?: string; mappingVersion?: number; candidates?: ErpCodeCandidate[];
};
type Props = {
  code: ErpSharedCode; revision: number; canMap: boolean; disabled?: boolean; id?: string;
  /** What the count of the code means on this screen (for example «3 عروض»). */
  countLabel?: string;
  onSaving?: (saving: boolean) => void;
  /** After a save (or a conflict): the screen reads its data again. */
  onSaved: () => void | Promise<void>;
};
const english: Record<string, string> = {
  'ربط أكواد العملاء متاح لمدير النظام فقط.': 'Only the system administrator can map customer codes.',
  'تغيّرت بيانات العميل أو الربط أو الصلاحيات. حدّث الصفحة.': 'The customer, the mapping or the permissions changed. Refresh and choose again.',
  'اختر مصنعًا مرتبطًا بهذا الكود في المصدر؛ لا يمكن تخمين صاحب الفاتورة.': 'Choose a customer that carries this code in the source data; the owner of the code is never guessed.',
  'الطلب محفوظ ببيانات مختلفة. حدّث الصفحة.': 'This request was saved with different data. Refresh the page.',
  'لا يوجد ربط محفوظ لإزالته.': 'There is no saved mapping to remove.',
  'حدد كود العميل في ERP.': 'Specify the customer\'s ERP code.',
};
const messageOf = (e: unknown) => typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' ? e.message : '';

export default function ErpCodeChoice({ code, revision, canMap, disabled = false, id, countLabel, onSaving, onSaved }: Props) {
  const { language } = useLanguage();
  const say = (ar: string, en: string) => language === 'en' ? en : ar;
  const present = (value: string) => language === 'en' ? english[value] || t(value) : value;
  const mapped = code.mappedCustomerId || '';
  const [selected, setSelected] = useState(mapped);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [savedNow, setSavedNow] = useState(false);
  const attempt = useRef<string | null>(null), lock = useRef(false);
  const candidates = code.candidates || [];
  const chosen = selected || mapped;
  const name = 'erp-code-choice-' + code.codeKey;

  async function save() {
    if (lock.current || disabled || !canMap) return;
    const customer = candidates.find(c => c.id === chosen);
    if (!customer || (!pending && chosen === mapped)) return;
    lock.current = true; setBusy(true); setError(''); setSavedNow(false); onSaving?.(true);
    // The same choice is one request: a save whose answer was lost is sent again unchanged (its request id), never twice.
    if (!attempt.current) attempt.current = JSON.stringify({ codeKey: code.codeKey, customerId: customer.id, version: code.mappingVersion || 0, revision, customerVersion: customer.version, requestId: crypto.randomUUID() });
    let saved = false, refresh = false;
    try {
      const result = await submitJson<{ ok?: boolean }>('/api/customer-identities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: attempt.current }, { language });
      if (result.ok !== true) throw new SubmitError(say('الخادم لم يؤكد حفظ الربط. أعد المحاولة.', 'The server did not confirm the mapping. Retry.'));
      attempt.current = null; saved = true; setPending(false); setSavedNow(true);
    } catch (e) {
      if (definiteSubmitRejection(e)) { attempt.current = null; setPending(false); refresh = e instanceof SubmitError && e.status === 409; }
      else setPending(true);
      setError(messageOf(e));
    } finally { lock.current = false; setBusy(false); onSaving?.(false); }
    if (saved || refresh) await onSaved();
  }

  const statusBadge = code.status === 'mapped' ? say('مربوط بعميل واحد', 'Mapped to one customer') : say('لم يُحدَّد العميل', 'Customer not chosen');
  return <div className="erp-code-choice" id={id} data-code={code.codeKey} data-status={code.status}>
    <div className="erp-code-choice-head">
      <span><strong>{say('كود ERP', 'ERP code')}: <bdi>{code.customerCode}</bdi></strong>{countLabel && <small>{countLabel}</small>}</span>
      <span className={'erp-code-choice-badge erp-code-' + code.status}>{statusBadge}</span>
    </div>
    {canMap && candidates.length ? <fieldset className="erp-code-choice-options" disabled={busy || pending || disabled}>
      <legend>{say('العميل الصحيح لهذا الكود', 'The right customer for this code')}</legend>
      {candidates.map(candidate => <label key={candidate.id} className="erp-code-choice-option" data-selected={chosen === candidate.id || undefined}>
        <input type="radio" name={name} value={candidate.id} checked={chosen === candidate.id} onChange={() => { setSelected(candidate.id); setError(''); setSavedNow(false); }}/>
        <span><strong><bdi>{candidate.name || '—'}</bdi></strong>
          <small className="erp-code-choice-meta"><bdi dir="ltr">{candidate.internalCode || '—'}</bdi><span aria-hidden="true">·</span><bdi>{candidate.region || '—'}</bdi><span aria-hidden="true">·</span><bdi>{candidate.branch || '—'}</bdi></small>
          {mapped === candidate.id && <small className="erp-code-choice-current">{say('الربط المحفوظ حاليًا', 'The saved mapping')}</small>}</span>
      </label>)}
    </fieldset> : null}
    {canMap && candidates.length ? <div className="erp-code-choice-actions">
      <button type="button" className="btn small primary" disabled={busy || disabled || !chosen || (!pending && chosen === mapped)} onClick={save}>
        {busy ? <Loader2 size={16} className="spin"/> : <Link2 size={16}/>}{pending ? say('تأكيد حفظ الربط', 'Confirm the mapping') : say('حفظ الربط', 'Save mapping')}</button>
      <small className="erp-code-choice-note">{say('الربط عام: يُطبَّق أيضًا على مطابقة فواتير مؤشرات الأداء وآخر شراء للعميل.', 'A mapping applies everywhere: it also decides KPI invoice matching and the customer\'s last purchase.')}</small>
      {!!mapped && <small className="erp-code-choice-note">{say('تغيير الربط لا ينقل العروض المستوردة سابقًا إلى عميل آخر.', 'Changing the mapping does not move quotations imported before to another customer.')}</small>}
    </div> : !canMap ? <p className="erp-code-choice-wait">{say('يحتاج مدير النظام إلى اختيار العميل الصحيح لهذا الكود.', 'The system administrator needs to choose the right customer for this code.')}</p> : null}
    {pending && <p className="erp-code-choice-message" role="status">{say('لم يتأكد حفظ الربط بسبب الاتصال. الاختيار مثبت؛ اضغط «تأكيد حفظ الربط» لإعادة الطلب نفسه بدون تكرار.', 'The connection did not confirm the mapping. The choice is locked; choose “Confirm the mapping” to retry the same request without duplicates.')}</p>}
    {!!error && <p className="form-error" role="alert">{present(error)}</p>}
    {savedNow && !error && <p className="erp-code-choice-saved" role="status"><CheckCircle2 size={16} aria-hidden="true"/>{say('حُفظ الربط.', 'The mapping was saved.')}</p>}
  </div>;
}

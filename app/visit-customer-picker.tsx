'use client';
import {offlineSubmit} from '@/lib/offline-submit';
import {getLanguage} from '@/lib/i18n';
import { t, useLanguage, direction } from '@/lib/i18n';
import { useMemo, useRef, useState } from 'react';
import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { Plus, Loader2, CheckCircle2, Factory, ChevronDown } from 'lucide-react';
import { Combobox, ComboboxInput, ComboboxList, ComboboxItem } from '@/components/ui/combobox';
import { regionValue } from '@/lib/regions';
import { CustomerRegionField } from './region-picker';
import CustomerLocationFields,{CustomerClassificationFields,type CustomerData} from './customer-entry-fields';
import { schemas, type Row, type Member } from '@/lib/crm';
import { customerLocationProblem } from '@/lib/customer-fields';
import './customer-picker-mobile.css';

const messageOf = (e: unknown) => typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' ? e.message : '';
const label = (r: Row) => [r.data.name, r.data.internalCode, r.data.code, r.data.region].filter(Boolean).join(' · ');
const normalize = (s: string) => s.normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[·،,|]/g, ' ').replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).toLowerCase().trim();
const phoneSearchValues = (phone: unknown) => {
    const digits = normalize(String(phone)).replace(/\D/g, '');
    const national = digits.replace(/^(?:00966|966)(?=5\d{8}$)/, '0');
    return national === digits ? [digits] : [digits, national];
};
type Props = {
    customers: Row[];
    value: string;
    me: Member;
    disabled: boolean;
    locked: boolean;
    onChange: (id: string, customer?: Row) => void;
    onCreated: (id: string) => Promise<Row>;
    onCreating: (value: boolean) => void;
    onSaving: (value: boolean) => void;
};

export default function VisitCustomerPicker({ customers, value, me, disabled, locked, onChange, onCreated, onCreating, onSaving }: Props) {
    const { language } = useLanguage();
    const say = (ar: string, en: string) => language === 'en' ? en : ar;
    const [query, setQuery] = useState(''), [adding, setAdding] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [savedId, setSavedId] = useState('');
    const [editingSelection, setEditingSelection] = useState(false), [extraOpen, setExtraOpen] = useState(false), [invalidField, setInvalidField] = useState('');
    const savingRef = useRef(false), createKey = useRef(crypto.randomUUID());
    const nameInput = useRef<HTMLInputElement>(null);
    const [locationPending,setLocationPending]=useState(false);
    const [popupHost, setPopupHost] = useState<HTMLDivElement | null>(null);
    const [draft, setDraft] = useState<CustomerData>({ name: '', code: '', region: regionValue(me), city: '', contact: '', phone: '', location: '', shortAddress: '', address: '', customerType: '', customerStatus: '', category: '' });
    const selected = customers.find(r => r.id === value) || null;
    const canCreate = !me.readOnly && ['rep', 'supervisor', 'manager', 'admin', 'customer_service', 'customer_service_manager'].includes(me.role);
    const searchIndex = useMemo(() => customers.map(customer => ({
        customer,
        text: normalize([customer.data.name, customer.data.internalCode, customer.data.code, customer.data.region, customer.data.city, customer.data.contact, customer.data.phone, customer.data.phone2].filter(Boolean).join(' ')),
        phones: [customer.data.phone, customer.data.phone2].filter(Boolean).flatMap(phoneSearchValues),
    })), [customers]);
    const matches = useMemo(() => {
        const normalized = normalize(query), terms = normalized.split(/\s+/).filter(Boolean);
        const phoneQuery = /^[+\d\s()\-]+$/.test(normalized) ? normalized.replace(/\D/g, '') : '';
        return searchIndex.filter(entry => terms.every(term => entry.text.includes(term)) || !!phoneQuery && entry.phones.some(phone => phone.includes(phoneQuery))).map(entry => entry.customer);
    }, [searchIndex, query]);
    const customerMeta = (customer: Row) => [customer.data.internalCode&&say('يورست: ','Yourrest: ')+customer.data.internalCode, customer.data.code&&'ERP: '+customer.data.code, customer.data.region && t(customer.data.region), customer.data.city].filter(Boolean).join(' · ');

    function begin() {
        if (!canCreate || disabled || locked) return;
        createKey.current = crypto.randomUUID();
        setAdding(true); setLocationPending(false); setError(''); setSavedId(''); setExtraOpen(false); setInvalidField('');
        const initialQuery = selected ? '' : query.trim(), phoneQuery = /^[+\d\s()\-]+$/.test(normalize(initialQuery));
        setDraft({ name: phoneQuery ? '' : initialQuery, code: '', region: regionValue(me), city: '', contact: '', phone: phoneQuery ? initialQuery : '', location: '', shortAddress: '', address: '', customerType: '', customerStatus: '', category: '' });
        onCreating(true);
    }
    function cancel() {
        if (saving) return;
        setAdding(false); setError(''); setInvalidField(''); onCreating(false);
    }
    async function create() {
        if (!canCreate || savingRef.current || locationPending) return;
        setError(''); setInvalidField('');
        const parsed = schemas.customer.safeParse({ ...draft, branch: me.branch, assignedTo: me.id });
        if (!savedId && !parsed.success) {
            if (!draft.name?.trim()) { setInvalidField('name'); nameInput.current?.focus(); }
            setError(!draft.name?.trim() ? t('اكتب اسم المصنع.') : parsed.error.issues.map(i => t(i.message)).join(' • '));
            return;
        }
        // A typed or chosen location is checked before it can be queued without a network.
        const locationError = !savedId && parsed.success ? customerLocationProblem(parsed.data) : null;
        if (locationError) { setError(t(locationError)); return; }
        savingRef.current = true; setSaving(true); onSaving(true);
        try {
            let id = savedId;
            if (!id) {
                const result = await offlineSubmit('/api/crm',JSON.stringify({ action: 'save', kind: 'customer', createKey: createKey.current, data: parsed.success ? parsed.data : {} }),{me,language:getLanguage(),label:draft.name ?? '',kind:'customer'});
                if(typeof result.id!=='string'||!result.id.trim())throw new Error(t('الخادم لم يؤكد حفظ العميل. احتفظ بالبيانات وأعد المحاولة.'));
                id = result.id; setSavedId(id);
            }
            // A refresh retry reuses the saved ID; it never creates the customer twice.
            const customer = await onCreated(id);
            onChange(id, customer); setQuery(''); setEditingSelection(false); setAdding(false); onCreating(false);
        } catch (e) {
            setError(messageOf(e) || t('تعذر تحميل العميل. حاول مرة أخرى.'));
        } finally {
            savingRef.current = false; setSaving(false); onSaving(false);
        }
    }
    const showSearch = !locked && (!selected || editingSelection);
    const fieldDisabled = saving || !!savedId;
    function updateDraft(key: string, value: string) { setDraft(previous => ({ ...previous, [key]: value })); }
    function preventFormSubmit(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key !== 'Enter') return;
        // Mobile Next moves through the visible fields without submitting the visit.
        event.preventDefault();
        // The selector only returns form controls. The explicit DOM cast avoids
        // overlapping Worker/DOM Element declarations in this shared project.
        const controls = Array.from(event.currentTarget.closest('.visit-new-customer')?.querySelectorAll('input:not(:disabled), select:not(:disabled)') || []) as unknown as Array<HTMLInputElement | HTMLSelectElement>;
        const fields = controls.filter(field => !field.closest('details:not([open])'));
        const next = fields[fields.indexOf(event.currentTarget) + 1];
        if (next) next.focus(); else void create();
    }

    return <section className="visit-customer-picker" aria-label={t('اختيار العميل')}>
        <div className="visit-customer-picker-heading">
            {showSearch && !adding ? <label htmlFor="visit-customer-search">{t('العميل (المصنع) ')}<b>*</b></label> : <span className="visit-customer-field-label">{t('العميل (المصنع) ')}<b>*</b></span>}
            {canCreate && !locked && !adding && <button type="button" className="btn subtle small visit-add-customer" disabled={disabled} onClick={begin}><Plus size={18}/>{t('إضافة عميل')}</button>}
        </div>
        {!adding && (showSearch ? <div className="visit-customer-search-area">
            <Combobox items={customers} filteredItems={matches.slice(0, 40)} limit={40} value={selected} onValueChange={r => { onChange(r?.id || '', r || undefined); if (r) { setEditingSelection(false); setQuery(''); } }} itemToStringLabel={label} isItemEqualToValue={(a, b) => a.id === b.id} onInputValueChange={setQuery} disabled={disabled} autoHighlight>
                <ComboboxInput id="visit-customer-search" className="visit-customer-search" showTrigger={false} showClear placeholder={say('اسم المصنع، رقم العميل أو الجوال', 'Factory name, customer code or phone')} autoComplete="off" autoFocus={editingSelection} enterKeyHint="search" onFocus={e => e.currentTarget.select()}/>
                <div ref={setPopupHost}/>
                <ComboboxPrimitive.Portal container={popupHost}>
                    <ComboboxPrimitive.Positioner sideOffset={6} align="start" className="visit-customer-positioner">
                        <ComboboxPrimitive.Popup className="visit-customer-popup" dir={direction()}>
                            <ComboboxList>{(r: Row) => <ComboboxItem key={r.id} value={r} className="visit-customer-option"><span><strong>{r.data.name}</strong><small>{customerMeta(r) || t('بدون رقم أو منطقة')}{r.data.phone && <><span aria-hidden="true"> · </span><bdi>{r.data.phone}</bdi></>}</small></span></ComboboxItem>}</ComboboxList>
                            <ComboboxPrimitive.Empty className="visit-customer-no-results">{canCreate?say('لا يوجد عميل مطابق.','No matching customer.'):say('لا يوجد عميل مطابق في منطقتك. اطلب إضافته من المشرف.','No matching customer in your region. Ask your supervisor to add them.')}</ComboboxPrimitive.Empty>
                            {matches.length > 40 && <p className="visit-customer-no-results">{say('اكتب المزيد لتقليل النتائج.', 'Type more to narrow the results.')}</p>}
                        </ComboboxPrimitive.Popup>
                    </ComboboxPrimitive.Positioner>
                </ComboboxPrimitive.Portal>
            </Combobox>
            {selected && <div className="visit-customer-search-hint"><button type="button" disabled={disabled} onClick={() => { setEditingSelection(false); setQuery(''); }}>{t('إلغاء')}</button></div>}
        </div> : <div className="visit-selected-customer">
            <Factory size={21} aria-hidden="true"/>
            <div><strong>{selected?.data.name || t('العميل غير متاح')}</strong>{selected && <small>{customerMeta(selected) || t('بدون رقم أو منطقة')}{selected.data.phone && <><span aria-hidden="true"> · </span><bdi>{selected.data.phone}</bdi></>}</small>}</div>
            {!locked && selected && <button type="button" disabled={disabled} onClick={() => { setQuery(''); setEditingSelection(true); }}>{say('تغيير', 'Change')}</button>}
        </div>)}
        {canCreate && adding && <section className="visit-new-customer" aria-label={t('إضافة عميل')} aria-busy={saving}>
            <h3>{t('إضافة عميل')}</h3>
            <p className="form-note">{say('كود يورست يُنشأ تلقائيًا بعد المزامنة.','Yourrest code is assigned automatically after synchronization.')}</p>
            <div className="form-grid visit-new-customer-core">
                <label className="field visit-new-customer-name"><span>{t('اسم المصنع *')}</span><input ref={nameInput} value={draft.name} maxLength={250} autoFocus autoComplete="organization" enterKeyHint="next" disabled={fieldDisabled} aria-required="true" aria-invalid={invalidField === 'name'} aria-describedby={invalidField === 'name' ? 'visit-new-customer-error' : undefined} onChange={e => updateDraft('name', e.target.value)} onKeyDown={preventFormSubmit}/></label>
                <CustomerRegionField value={draft.region ?? ''} onChange={region => updateDraft('region', region)} me={me} disabled={fieldDisabled}/>
                <CustomerClassificationFields data={draft} onChange={updateDraft} disabled={fieldDisabled}/>
                <label className="field"><span>{t('رقم الجوال')}</span><input value={draft.phone} maxLength={250} type="tel" inputMode="tel" dir="ltr" autoComplete="tel" enterKeyHint="next" disabled={fieldDisabled} onChange={e => updateDraft('phone', e.target.value)} onKeyDown={preventFormSubmit}/></label>
                <label className="field"><span>{t('مسؤول التواصل')}</span><input value={draft.contact} maxLength={250} autoComplete="name" enterKeyHint="next" disabled={fieldDisabled} onChange={e => updateDraft('contact', e.target.value)} onKeyDown={preventFormSubmit}/></label>
                <label className="field"><span>{t('المدينة')}</span><input value={draft.city} maxLength={250} autoComplete="address-level2" enterKeyHint="done" disabled={fieldDisabled} onChange={e => updateDraft('city', e.target.value)} onKeyDown={preventFormSubmit}/></label>
            </div>
            <CustomerLocationFields key={createKey.current} data={draft} disabled={fieldDisabled} onUpdate={setDraft} onPendingChange={setLocationPending}/>
            <details className="visit-new-customer-extra" open={extraOpen} onToggle={e => setExtraOpen(e.currentTarget.open)}>
                <summary><span>{say('كود ERP والعنوان (اختياري)', 'ERP code and address (optional)')}</span><ChevronDown size={18}/></summary>
                <div className="form-grid">
                    <label className="field"><span>{say('كود العميل في ERP','Customer ERP code')}</span><input value={draft.code} maxLength={250} autoComplete="off" disabled={fieldDisabled} onChange={e => updateDraft('code', e.target.value)} onKeyDown={preventFormSubmit}/></label>
                    <label className="field"><span>{t('العنوان')}</span><input value={draft.address} maxLength={250} autoComplete="street-address" disabled={fieldDisabled} onChange={e => updateDraft('address', e.target.value)} onKeyDown={preventFormSubmit}/></label>
                </div>
            </details>
            {error && <p className="form-error" id="visit-new-customer-error" role="alert">{savedId ? t('تم حفظ العميل؛ تعذر تحميل بياناته. اضغط إعادة المحاولة.') : t(error)}</p>}
            <div className="visit-new-customer-actions"><button type="button" className="btn subtle small" disabled={saving} onClick={cancel}>{t('إلغاء')}</button><button type="button" className="btn primary small" disabled={saving||locationPending} onClick={create}>{saving ? <Loader2 size={18} className="spin"/> : <CheckCircle2 size={18}/>}{saving ? t('جارٍ الحفظ…') : savedId ? t('إعادة المحاولة') : t('حفظ واختيار العميل')}</button></div>
        </section>}
    </section>;
}

'use client';
import {t,useLanguage,direction} from "@/lib/i18n";
import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Row, isOpen, today } from '@/lib/crm';
import { captureVisitLocation } from '@/lib/visit-location';
import { contactTypes, visitPurposes, visitResults } from '@/lib/visits';
export function FollowupDateField({value,onChange,min}:{value:string;onChange:(value:string)=>void;min?:string}){
    const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
    const dateAfter=(days:number)=>{const date=new Date(today()+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
    return <div className="field visit-date-field"><label><span>{t('موعد المتابعة القادمة')} <b>*</b></span><input type="date" required value={value} min={min} onChange={event=>onChange(event.target.value)}/></label><div className="visit-date-shortcuts" role="group" aria-label={say('اختيار سريع لموعد المتابعة','Quick follow-up date')}>{[[0,say('اليوم','Today')],[1,say('بكرة','Tomorrow')],[3,say('بعد 3 أيام','In 3 days')]].map(([days,label])=>{const date=dateAfter(Number(days));return <button key={days} type="button" aria-pressed={value===date} disabled={!!min&&date<min} onClick={()=>onChange(date)}>{label}</button>;})}</div></div>;
}
const messageOf = (e: unknown) => typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' ? e.message : '';
export type VisitValue = string | number | boolean | null | undefined;
export type VisitData = { [field: string]: unknown; type?: string; summary?: string; result?: string; date?: string; nextDate?: string; nextAction?: string; location?: string; locationCapturedAt?: string; locationAccuracy?: number | null; visitNumber?: number | string; syncFollowup?: boolean };
type Props = {
    unified?: boolean;
    service?: boolean;
    readOnly?: boolean;
    data: VisitData;
    parentId: string;
    records: Row[];
    editing: boolean;
    busy: boolean;
    email: string;
    onChange: (key: string, value: VisitValue) => void;
    onParent: (id: string) => void;
    onLocationState?: (state:VisitLocationState) => void;
};
export type VisitLocationState={status:'idle'|'locating'|'captured'|'error';error:string};
export default function VisitFields({ unified = false, service = false, readOnly = false, data, parentId, records, editing, busy, onChange, onParent,onLocationState }: Props) {
    const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
    const captureRun = useRef(0), changeRef = useRef(onChange),stateRef=useRef(onLocationState),captureAbort=useRef<AbortController|null>(null);
    changeRef.current = onChange;
    stateRef.current=onLocationState;
    const [customGoal, setCustomGoal] = useState(!!data.summary && !visitPurposes.includes(data.summary));
    const [legacyResult] = useState(() => editing ? data.result || '' : '');
    const resultValue = data.result || '';
    const resultOptions = [...visitResults, ...(legacyResult && !visitResults.includes(legacyResult) ? [legacyResult] : [])];
    useEffect(() => { if (!readOnly && !editing && !data.locationCapturedAt)
        void locate(); return () => { captureRun.current++;captureAbort.current?.abort(); }; }, [editing,readOnly]);
    const [query, setQuery] = useState(''), [locating, setLocating] = useState(false), [locationError, setLocationError] = useState('');
    const parent = records.find(r => r.id === parentId);
    let customer = parent;
    for (let i = 0; i < 4 && customer?.kind !== 'customer'; i++)
        customer = records.find(r => r.id === customer?.parentId);
    const customers = records.filter(r => r.kind === 'customer' && (r.id === customer?.id || !query || [r.data.name, r.data.code, r.data.region].join(' ').toLowerCase().includes(query.toLowerCase())));
    const opportunities = records.filter(r => r.kind === 'opportunity' && (r.parentId === customer?.id || records.find(m => m.id === r.parentId)?.parentId === customer?.id));
    const input = (key: 'date' | 'nextDate' | 'nextAction', label: string, type = 'text', required = false, full = false) => <label className={'field ' + (full ? 'full' : '')}><span>{t(label)}{required && <b> *</b>}</span>{type === 'textarea' ? <textarea rows={3} required={required} value={data[key] || ''} onChange={e => onChange(key, e.target.value)}/> : <input type={type} required={required} value={data[key] || ''} onChange={e => onChange(key, e.target.value)}/>}</label>;
    const pick = (value: string | undefined, change: (v: string) => void, options: [
        string,
        string
    ][], placeholder: string, disabled = false, required = false) => <Select dir={direction()} value={value || undefined} onValueChange={change} disabled={disabled||readOnly||busy} required={required}><SelectTrigger className="pick" aria-label={t(placeholder)}><SelectValue placeholder={t(placeholder)}/></SelectTrigger><SelectContent>{t(options.map(([id, label]) => <SelectItem key={id} value={id}>{t(label)}</SelectItem>))}</SelectContent></Select>;
    async function locate() { if (editing||readOnly||busy)
        return; const run = ++captureRun.current;captureAbort.current?.abort();const controller=new AbortController();captureAbort.current=controller; setLocationError(''); setLocating(true);stateRef.current?.({status:'locating',error:''}); try {
        const captured = await captureVisitLocation(navigator.geolocation,controller.signal);
        if (run !== captureRun.current)
            return;
        for (const [key, value] of Object.entries(captured))
            changeRef.current(key, value);
        stateRef.current?.({status:'captured',error:''});
    }
    catch (e) {
        if (run === captureRun.current)
            {const message=messageOf(e)||'تعذر تحديد الموقع. أعد المحاولة.';setLocationError(message);stateRef.current?.({status:'error',error:message});}
    }
    finally {
        if (run === captureRun.current)
            setLocating(false);
    } }
    return <>
  {editing && data.visitNumber && <div className="visit-identity full"><span>{t("رقم الزيارة: ")}<strong>{t(data.visitNumber)}</strong></span></div>}
  {!unified && <><label className="field full"><span>{t("اسم العميل *")}</span>{!editing && <input type="search" placeholder={t("ابحث باسم المصنع أو رقمه أو المنطقة")} value={query} onChange={e => setQuery(e.target.value)}/>} {t(pick(customer?.id || '', onParent, customers.map(r => [r.id, `${r.data.name} · ${r.data.code || 'بدون رقم'} · ${r.data.region || ''}`]), 'اختر العميل', editing))}</label>
  <label className="field full"><span>{t("متابعة العميل المرتبطة")}</span>{t(pick(parent?.kind === 'opportunity' ? parent.id : 'none', v => onParent(v === 'none' ? customer?.id || '' : v), [['none', 'زيارة على العميل مباشرة'], ...opportunities.map(r => [r.id, `${r.data.followupTitle || r.data.moldType} · ${records.find(m => m.id === r.parentId)?.data.name || ''}`] as [
                string,
                string
            ])], 'المتابعة المرتبطة', editing || !customer))}</label></>}
  <label className="field"><span>{t("نوع التواصل")}</span>{t(pick(data.type, v => onChange('type', v), Object.entries(contactTypes).filter(([id])=>(service?['visit','call','email','whatsapp','website','social']:['visit','call','email','whatsapp']).includes(id)), 'نوع التواصل'))}</label>
  <label className="field"><span>{t("الهدف من الزيارة *")}</span>{t(pick(customGoal ? 'other' : data.summary || '', v => { setCustomGoal(v === 'other'); onChange('summary', v === 'other' ? '' : v); }, [...visitPurposes.map(p => [p, p] as [
            string,
            string
        ]), ['other', 'هدف آخر']], 'اختر الهدف من الزيارة',false,true))}{customGoal && <input aria-label={t("الهدف الآخر من الزيارة")} required value={data.summary || ''} onChange={e => onChange('summary', e.target.value)} placeholder={t("اكتب هدف التواصل")}/>}</label>
  {!unified && t(input('date', 'تاريخ الزيارة', 'date', true))}
  <label className="field full"><span>{t('نتيجة الزيارة')}{!editing && <b> *</b>}</span><Select dir={direction()} value={resultValue || undefined} onValueChange={value => onChange('result', value)} required={!editing} disabled={busy||readOnly}><SelectTrigger className="pick" aria-label={t('نتيجة الزيارة')}><SelectValue placeholder={t('اختر نتيجة الزيارة')}/></SelectTrigger><SelectContent>{resultOptions.map(result => <SelectItem key={result} value={result}>{t(result)}</SelectItem>)}</SelectContent></Select></label>
  <div className="visit-location full automatic-location visit-compact-location" id="visit-device-location"><div className="location-status" aria-live="polite">{locating ? <span><Loader2 className="spin" size={16}/>{t('جارٍ تحديد الموقع…')}</span> : data.location ? <span><MapPin size={16}/>{say('تم تحديد الموقع تلقائيًا','Location captured automatically')}</span> : editing ? <span>{t('الموقع غير مسجل في هذه الزيارة القديمة.')}</span> : <span><MapPin size={16}/>{t('يلزم السماح بالموقع لحفظ الزيارة.')}</span>}</div>{locating&&<small>{say('وافق على إذن الموقع أثناء استخدام التطبيق. تفعيل خط السير المستمر إجراء مستقل.','Allow location while using the app. Continuous route activation is a separate step.')}</small>}{data.location&&<details className="visit-location-details"><summary>{say('تفاصيل الموقع','Location details')}</summary><label className="field"><input aria-label={t('لوكيشن الزيارة التلقائي')} readOnly dir="ltr" value={data.location}/></label>{data.locationAccuracy!=null&&<small>{t(`دقة الجهاز ±${data.locationAccuracy} متر`)}</small>}</details>}{locationError&&<p role="alert">{t(locationError)}</p>}{!editing&&!readOnly&&!locating&&<button type="button" className="btn subtle small" disabled={busy} onClick={()=>void locate()}>{data.location?t('تحديث موقع الجهاز'):t('إعادة المحاولة')}</button>}</div>
  {!unified && <>{t(input('nextDate', 'موعد المتابعة', 'date'))}
  {t(input('nextAction', 'الإجراء القادم', 'text', false, true))}
  </>}{!unified && parent?.kind === 'opportunity' && isOpen(parent) && <label className="visit-sync full"><input type="checkbox" checked={!!data.syncFollowup} onChange={e => onChange('syncFollowup', e.target.checked)}/><span>{t("تحديث الإجراء وموعد المتابعة في المتابعة عند الحفظ أو الإنهاء")}</span></label>}
 </>;
}

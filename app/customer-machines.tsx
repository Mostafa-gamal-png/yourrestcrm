'use client';
import {t,useLanguage} from "@/lib/i18n";
import { useMemo, useState } from 'react';
import { Building2, ChevronDown, Factory, Plus, Pencil, MapPinned, History, Phone, MapPin, ChevronLeft, ChevronRight, ClipboardPlus, CircleHelp } from 'lucide-react';
import { type Row, type Member } from '@/lib/crm';
import { machineTypeLabels, machineConditionLabels, completeMachineSpecs } from '@/lib/machines';
import { visitCustomer } from '@/lib/customer-visits';
import { customerCoordinates } from '@/lib/customer-location';
import { mapActivity } from '@/lib/customer-map-activity';
import './customer-directory-mobile.css';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
type Props = {
    customers: Row[];
    records: Row[];
    members: Member[];
    canEdit?: boolean;
    /** Adding and correcting machines: open to a representative for their own customers, whose details they cannot otherwise edit. */
    canEditMachine?: boolean;
    canAddMachineTo?: (customer: Row) => boolean;
    page: number;
    onPage: (page: number) => void;
    onOpen: (id: string) => void;
    onHistory: (id: string) => void;
    onEdit: (row: Row) => void;
    onAddMachine: (id: string) => void;
    onAddOpportunity: (id: string) => void;
    onMap: (id: string) => void;
};
export default function CustomerMachines({ customers, records, members, canEdit = true, canEditMachine = canEdit, canAddMachineTo = () => canEdit, page, onPage, onOpen, onHistory, onEdit, onAddMachine, onAddOpportunity, onMap }: Props) {
    const {language} = useLanguage();
    const say = (ar:string,en:string) => language === 'ar' ? ar : en;
    const [expanded, setExpanded] = useState<string | null>(null);
    const machines = useMemo(() => { const map = new Map<string, Row[]>(); for (const row of records)
        if (row.kind === 'factory' && row.parentId)
            map.set(row.parentId, [...(map.get(row.parentId) || []), row]); return map; }, [records]);
    const visitCounts = useMemo(() => { const counts = new Map<string, number>(); for (const record of records) { if (record.kind !== 'activity') continue; const customer = visitCustomer(record, records); if (customer) counts.set(customer.id, (counts.get(customer.id) || 0) + 1); } return counts; }, [records]);
    const sourceCustomers = customers.filter(r => r.data.machineCount !== null && r.data.machineCount !== undefined || r.data.machineTypes);
    const sourceTotal = customers.reduce((n, r) => n + (typeof r.data.machineCount === 'number' ? r.data.machineCount : 0), 0);
    const maxPage = Math.max(1, Math.ceil(customers.length / 50)), currentPage = Math.min(page, maxPage);
    const shown = customers.slice((currentPage - 1) * 50, currentPage * 50);
    return <section className="customer-machines-page" dir={language === 'ar' ? 'rtl' : 'ltr'}>
  <div className="customer-mobile-count"><span>{say('العملاء','Customers')}</span><strong>{customers.length.toLocaleString('en-US')}</strong></div>
  <div className="machine-summary"><div><strong>{t(customers.length.toLocaleString('en-US'))}</strong><span>{t("مصنع مطابق")}</span></div><div><strong>{t(sourceCustomers.length.toLocaleString('en-US'))}</strong><span>{t("مصنع لديه بيانات ماكينات في الشيت")}</span></div><div><strong>{t(sourceTotal.toLocaleString('en-US'))}</strong><span>{t("إجمالي العدد المسجل في الشيت")}</span></div></div>
  <section className="panel unified-customers"><div className="panel-heading customer-directory-desktop"><h2>{t("العملاء والماكينات")}</h2></div>
   {!customers.length ? <div className="machines-empty">{t("لا توجد مصانع مطابقة للبحث.")}</div> : <><div className="customer-mobile-list">{shown.map(customer => <CustomerMobileCard key={customer.id} canEdit={canEdit} canAddMachine={canEditMachine&&canAddMachineTo(customer)} customer={customer} linked={machines.get(customer.id) || []} visitCount={visitCounts.get(customer.id) || 0} onOpen={onOpen} onHistory={onHistory} onAddMachine={onAddMachine} onAddOpportunity={onAddOpportunity} onMap={onMap}/>)}</div><div className="customer-directory-desktop"><Table><TableHeader><TableRow>{t(['المصنع', 'المنطقة / المدينة', 'مسؤول التواصل', 'الماكينات حسب الشيت', 'المندوب', ''].map((h, i) => <TableHead key={i}>{t(h)}</TableHead>))}</TableRow></TableHeader><TableBody>{t(shown.map(customer => {
                const linked = machines.get(customer.id) || [];
                const open = expanded === customer.id;
                const sourceCount = customer.data.machineCount;
                return <CustomerRows key={customer.id} canEdit={canEdit} canAddMachine={canEditMachine&&canAddMachineTo(customer)} canEditMachine={canEditMachine} customer={customer} linked={linked} open={open} onToggle={() => setExpanded(open ? null : customer.id)} sourceCount={sourceCount} visitCount={visitCounts.get(customer.id) || 0} memberName={members.find(m => m.id === customer.assignedTo)?.name || '—'} onOpen={onOpen} onHistory={onHistory} onEdit={onEdit} onAddMachine={onAddMachine} onAddOpportunity={onAddOpportunity} onMap={onMap}/>;
            }))}</TableBody></Table></div></>}
   {maxPage > 1 && <div className="customer-page-controls"><button className="btn subtle small" disabled={currentPage === 1} onClick={() => onPage(currentPage - 1)}>{t("السابق")}</button><span>{t("صفحة ")}{t(currentPage)}{t(" من ")}{t(maxPage)} · {t(customers.length)}{t(" مصنع")}</span><button className="btn subtle small" disabled={currentPage === maxPage} onClick={() => onPage(currentPage + 1)}>{t("التالي")}</button></div>}
  </section>
 </section>;
}
/** Only dial a single plausible phone number; never turn arbitrary record text into a URL. */
function dialNumber(value:unknown):string|null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized=String(value).trim().replace(/[٠-٩]/g, digit=>String(digit.charCodeAt(0)-1632)).replace(/[۰-۹]/g, digit=>String(digit.charCodeAt(0)-1776));
    if (!/^\+?[0-9\s().-]+$/.test(normalized)) return null;
    const number=normalized.replace(/[\s().-]/g,'');
    return /^\+?[0-9]{5,15}$/.test(number) ? number : null;
}

function CustomerMobileCard({customer,linked,visitCount,canEdit,canAddMachine=canEdit,onOpen,onHistory,onAddMachine,onAddOpportunity,onMap}: {
    customer:Row; linked:Row[]; visitCount:number;
} & Pick<Props,'canEdit'|'onOpen'|'onHistory'|'onAddMachine'|'onAddOpportunity'|'onMap'> & {canAddMachine?:boolean}) {
    const {language}=useLanguage();
    const say=(ar:string,en:string)=>language==='ar'?ar:en;
    const d=customer.data,activity=mapActivity(customer);
    const firstPhone=dialNumber(d.phone),secondPhone=dialNumber(d.phone2),phone=firstPhone||secondPhone;
    const contact=firstPhone?d.contact:secondPhone?d.contact2:d.contact||d.contact2;
    const place=[t(d.region),d.city].filter(Boolean).join(' · ');
    const status=activity.key==='unknown'&&activity.rawLabel?activity.rawLabel:language==='ar'?activity.labelAr:activity.labelEn;
    const Arrow=language==='ar'?ChevronLeft:ChevronRight;
    const hasMachines=linked.length>0||d.machineTypes||d.machineCount!==null&&d.machineCount!==undefined;
    return <article className="customer-mobile-card" aria-label={d.name}>
      <div className="customer-mobile-card-heading">
        <button type="button" className="customer-mobile-name" onClick={()=>onOpen(customer.id)} aria-label={say('بيانات العميل: ','Customer details: ')+d.name}>
          <Building2 size={20} aria-hidden="true"/><h3>{d.name}</h3>
        </button>
        <span className="customer-mobile-activity" data-activity={activity.key} title={say('حالة التعامل: ','Customer activity: ')+status}><i aria-hidden="true"/>{status}</span>
      </div>
      <div className="customer-mobile-meta">
        {d.internalCode&&<span className="customer-mobile-code">{say('كود يورست','Yourrest code')} <bdi>{d.internalCode}</bdi></span>}
        {d.code&&<span className="customer-mobile-code">{say('كود ERP','ERP code')} <bdi title={String(d.code)}>{d.code}</bdi></span>}
        <span><MapPin size={14} aria-hidden="true"/>{place||say('المنطقة غير محددة','Region not specified')}</span>
      </div>
      {contact&&<p className="customer-mobile-contact">{contact}{phone&&<bdi>{phone}</bdi>}</p>}
      <div className={'customer-mobile-primary'+(phone?' customer-mobile-with-phone':'')}>
        <button type="button" className="btn primary" onClick={()=>onAddOpportunity(customer.id)}><ClipboardPlus size={18} aria-hidden="true"/>{say('زيارة جديدة','New visit')}</button>
        {phone&&<a className="btn subtle" href={'tel:'+phone} aria-label={say('اتصال بـ ','Call ')+(contact||d.name)}><Phone size={17} aria-hidden="true"/>{say('اتصال','Call')}</a>}
      </div>
      <div className="customer-mobile-secondary">
        <button type="button" onClick={()=>onHistory(customer.id)}><History size={17} aria-hidden="true"/><span>{say('الزيارات','Visits')} <bdi className="customer-mobile-visit-count">{visitCount}</bdi></span></button>
        {customerCoordinates(d)?<button type="button" onClick={()=>onMap(customer.id)}><MapPinned size={17} aria-hidden="true"/><span>{say('الخريطة','Map')}</span></button>:<span className="customer-mobile-no-location"><MapPinned size={17} aria-hidden="true"/>{say('لا يوجد موقع','No location')}</span>}
        <button type="button" onClick={()=>onOpen(customer.id)}><CircleHelp size={17} aria-hidden="true"/><span>{say('البيانات','Details')}</span></button>
      </div>
      {hasMachines&&<details className="customer-mobile-machines"><summary><span>{say('بيانات الماكينات','Machine details')}</span><ChevronDown size={15} aria-hidden="true"/></summary>
        <div className="customer-mobile-machine-content">
          {d.machineCount!==null&&d.machineCount!==undefined&&<p>{say('العدد في الشيت: ','Recorded count: ')}<strong>{String(d.machineCount)}</strong></p>}
          {d.machineTypes&&<p>{t(d.machineTypes)}</p>}
          {linked.map(machine=><button type="button" className="customer-mobile-machine-link" key={machine.id} onClick={()=>onOpen(machine.id)}><Factory size={16} aria-hidden="true"/><span>{machine.data.name}</span><Arrow size={16} aria-hidden="true"/></button>)}
          {canAddMachine&&!d._masterReadOnly&&!d._masterRoutingReadOnly&&!d._readOnly&&<button type="button" className="btn subtle" onClick={()=>onAddMachine(customer.id)}><Plus size={16} aria-hidden="true"/>{say('إضافة ماكينة','Add machine')}</button>}
        </div>
      </details>}
    </article>;
}

function CustomerRows({ customer, linked, canEdit, canAddMachine = canEdit, canEditMachine = canEdit, open, onToggle, sourceCount, visitCount, memberName, onOpen, onHistory, onEdit, onAddMachine, onAddOpportunity, onMap }: {
    customer: Row;
    linked: Row[];
    open: boolean;
    onToggle: () => void;
    sourceCount: number | null | undefined;
    visitCount: number;
    memberName: string;
} & Pick<Props, 'canEdit' | 'onOpen' | 'onHistory' | 'onEdit' | 'onAddMachine' | 'onAddOpportunity' | 'onMap'> & {canAddMachine?: boolean; canEditMachine?: boolean}) {
    const {language} = useLanguage();
    const d = customer.data;
    const contact = d.contact || d.phone ? { name: d.contact, phone: d.phone } : { name: d.contact2, phone: d.phone2 };
    return <><TableRow className={open ? 'customer-row-open' : ''}><TableCell><button className="customer-expand" onClick={onToggle} aria-expanded={open} aria-controls={'machines-' + customer.id}><ChevronDown size={18} className={open ? 'expanded' : ''}/><Building2 size={19}/><span><strong>{d.name}</strong><small>{language==='ar'?'كود يورست: ':'Yourrest code: '}<bdi>{d.internalCode || '—'}</bdi></small><small>{language==='ar'?'كود ERP: ':'ERP code: '}<bdi>{d.code || '—'}</bdi></small></span></button></TableCell><TableCell>{t(d.region) || t('—')}<small>{d.city}</small></TableCell><TableCell><strong>{contact.name || t('—')}</strong><small dir="ltr">{contact.phone}</small></TableCell><TableCell><strong>{sourceCount === null || sourceCount === undefined ? t('العدد غير مسجل') : t(sourceCount) + t(' ماكينة')}</strong><small className="source-machine-types">{t(d.machineTypes) || t('الأنواع غير مسجلة')}</small>{linked.length > 0 && <button className="machine-inline-link" onClick={onToggle}>{canEdit?t("إدارة الماكينات ("):(language==='ar'?'بيانات الماكينات (':'Machine details (')}{t(linked.length)}{t(" سجل)")}</button>}</TableCell><TableCell>{t(memberName)}</TableCell><TableCell><div className="customer-row-actions"><button className="btn primary small" onClick={() => onAddOpportunity(customer.id)}>{t("زيارة جديدة")}</button><button className="btn subtle small" onClick={() => onHistory(customer.id)}><History size={16}/>{t("سجل الزيارات")} <span className="count-badge">{visitCount}</span></button><button className="btn subtle small" onClick={() => onOpen(customer.id)}>{t("بيانات العميل")}</button>{canEdit&&!d._masterReadOnly&&!d._masterRoutingReadOnly&&!d._readOnly&&<button className="icon-button" title={t("إضافة ماكينة للمصنع")} onClick={() => onAddMachine(customer.id)}><Plus size={17}/></button>}{customerCoordinates(d) && <button className="icon-button" title={t("موقع المصنع")} onClick={() => onMap(customer.id)}><MapPinned size={17}/></button>}</div></TableCell></TableRow>
 {open && <TableRow className="machines-expanded-row"><TableCell colSpan={6}><div className="machines-expanded" id={'machines-' + customer.id}><div className="machines-heading"><div><h3>{t("ماكينات ")}{d.name}</h3>{d.machineTypes && <p>{t("الأنواع في الشيت: ")}{t(d.machineTypes)}</p>}</div>{canAddMachine&&!d._masterReadOnly&&!d._masterRoutingReadOnly&&!d._readOnly&&<button className="btn primary small" onClick={() => onAddMachine(customer.id)}><Plus size={17}/>{t("إضافة ماكينة")}</button>}</div>
 {!linked.length ? <p className="machines-empty">{sourceCount === 0 ? t('الشيت يسجّل عدد الماكينات: 0.') : t('لم تُسجّل تفاصيل ماكينات لهذا المصنع.')}</p> : <div className="machine-cards">{t(linked.map(machine => <article className="machine-card" key={machine.id}><div className="machine-card-title"><Factory size={20}/><h4>{machine.data.name}</h4><span>{machine.data.recordType === 'group' ? t('مجموعة ماكينات') : t('ماكينة')}</span></div><div className="machine-card-facts"><div><span>{machine.data.recordType === 'group' ? t('إجمالي المجموعة') : t('العدد')}</span><strong>{t(machine.data.quantity) ?? t('غير مسجل')}</strong></div><div><span>{t("نوع التشغيل")}</span><strong>{t(machineTypeLabels[machine.data.machineType]) || t('غير محدد')}</strong></div><div><span>{t("الشركة")}</span><strong>{machine.data.machineBrand || t('غير مسجلة')}</strong></div><div><span>{t("الموديل")}</span><strong>{machine.data.machineModel || t('غير مسجل')}</strong></div><div><span>{t("الموديل جديد أم قديم")}</span><strong>{t(machineConditionLabels[machine.data.modelCondition || ''])}</strong></div><div><span>{t("نوع الجلب")}</span><strong>{t(machineConditionLabels[machine.data.bushingCondition || ''])}</strong></div></div>{machine.data.sourceFile && <p className="machine-source-note">{t("من ")}{machine.data.sourceFile}{machine.data.sourceMachineTypes?.includes(',') ? t(' · العدد إجمالي للأنواع المذكورة') : t('')}</p>}{!completeMachineSpecs(machine.data) && <p className="machine-spec-note">{t("يلزم استكمال المواصفات قبل الاعتماد الفني للقالب.")}</p>}<div className="machine-card-actions">{canEditMachine&&!machine.data._masterReadOnly&&!machine.data._readOnly&&<button className="btn subtle small" onClick={() => onEdit(machine)}><Pencil size={15}/>{t("تعديل")}</button>}<button className="btn subtle small" onClick={() => onOpen(machine.id)}>{t("التفاصيل والمتابعات")}</button><button className="btn primary small" onClick={() => onAddOpportunity(machine.id)}><Plus size={15}/>{t("زيارة جديدة")}</button></div></article>))}</div>}
 </div></TableCell></TableRow>}</>;
}

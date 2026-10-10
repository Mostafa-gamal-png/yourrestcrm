'use client';
import {t,useLanguage,getLanguage} from "@/lib/i18n";
import { Pencil, MapPin, CalendarDays, Eye, Clock3, Trash2 } from 'lucide-react';
import { type Row, type Member, stageLabels, today } from '@/lib/crm';
import { contactTypes, visitPurposes, visitResult, formatVisitTime, durationLabel, durationNeedsReview } from '@/lib/visits';
import {serviceStatusLabels} from '@/lib/customer-service';
import { strengthLabels } from '@/lib/customer-visits';
import { mapsLink } from '@/lib/customer-location';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import './rep-record-lists.css';
export default function VisitsTable({ rows, customerFor, onOpen, onEdit, onCustomer, expanded = false, members = [], onWorkflow, canEdit = true, onDelete }: {
    expanded?: boolean;
    onWorkflow?: (id:string)=>void;
    members?: Member[];
    onCustomer?: (id: string) => void;
    rows: Row[];
    customerFor: (row: Row) => Row | undefined;
    onOpen: (id: string) => void;
    onEdit: (row: Row) => void;
    canEdit?: boolean;
    onDelete?: (row:Row)=>void;
}) {
    const {language}=useLanguage();
    const say=(ar:string,en:string)=>language==='ar'?ar:en;
    const day=today();
    return <><div className="rep-mobile-records" aria-label={say('سجل الزيارات','Visit history')}>
        {rows.map(row=>{
            const customer=customerFor(row),result=visitResult(row.data),location=mapsLink(row.data);
            const owner=members.find(m=>m.id===(row.data.performedBy||row.assignedTo));
            const scheduled=!!row.data.nextDate&&!['won','lost'].includes(row.data.salesStage)&&row.data.followupStatus!=='closed';
            return <article className="rep-record-card" key={row.id}>
                <div className="rep-record-meta"><span>{t(contactTypes[row.data.type])||say('زيارة','Visit')} {row.data.visitNumber&&<bdi>#{row.data.visitNumber}</bdi>}</span><time dateTime={row.data.date||undefined}><bdi>{row.data.date||'—'}</bdi></time></div>
                <button type="button" className="rep-record-customer" onClick={()=>onCustomer&&customer?onCustomer(customer.id):onOpen(row.id)}>{customer?.data.name||say('تفاصيل الزيارة','Visit details')}</button>
                {row.data.summary&&<p className="rep-record-purpose">{visitPurposes.includes(row.data.summary)?t(row.data.summary):row.data.summary}</p>}
                <p className={'rep-record-result'+(!result?' is-empty':'')}>{result?t(result):say('لم تُسجّل النتيجة بعد','Result not recorded yet')}</p>
                {scheduled&&<div className={'rep-record-next'+(row.data.nextDate<day?' is-overdue':'')}><CalendarDays size={16} aria-hidden="true"/><div><span>{say('المتابعة','Follow-up')} <bdi>{row.data.nextDate}</bdi>{row.data.nextDate<day&&<strong> · {say('متأخرة','Overdue')}</strong>}</span>{row.data.nextAction&&<p>{row.data.nextAction}</p>}</div></div>}
                <div className="rep-record-badges">{expanded&&stageLabels[row.data.salesStage]&&<span className={'badge '+row.data.salesStage}>{t(stageLabels[row.data.salesStage])}</span>}{row.data._serviceWorkflow&&<span className="badge pending">{t(serviceStatusLabels[row.data._serviceWorkflow.state])}</span>}{durationNeedsReview(row.data)&&<span className="rep-record-warning"><Clock3 size={14} aria-hidden="true"/>{say('مدة الزيارة تحتاج مراجعة','Visit duration needs review')}</span>}{members.length>1&&owner&&<span className="rep-record-owner">{owner.name}</span>}</div>
                <div className="rep-record-actions"><button type="button" className="btn primary" onClick={()=>!canEdit||row.data._readOnly?onOpen(row.id):onEdit(row)}>{!canEdit||row.data._readOnly?<Eye size={17}/>:<Pencil size={17}/>}{t(!canEdit||row.data._readOnly?'عرض التفاصيل':'عرض / تعديل الزيارة')}</button>{onDelete&&row.data.visitWorkflow!=='service-intake-v1'&&!row.data._offlineState&&!row.data._offlineAcknowledged&&<button type="button" className="btn subtle danger" aria-label={say("حذف الزيارة","Delete visit")} onClick={()=>onDelete(row)}><Trash2 size={17}/>{say("حذف","Delete")}</button>}{location&&<a className="btn subtle" href={location} target="_blank" rel="noopener noreferrer" aria-label={say('موقع الزيارة','Visit location')}><MapPin size={17}/>{say('الموقع','Location')}</a>}</div>
                {onWorkflow&&row.data._serviceWorkflow&&<button type="button" className="btn subtle rep-record-workflow" onClick={()=>onWorkflow(row.data._serviceWorkflow.id)}>{t('الاعتماد والتكليف')}</button>}
            </article>;
        })}
    </div><div className="rep-desktop-records"><Table className="visits-table"><TableHeader><TableRow>{t(['رقم الزيارة', 'اسم العميل', 'نوع التواصل', 'الهدف من الزيارة', 'نتيجة الزيارة', 'الملاحظات', 'لوكيشن الزيارة', 'موعد المتابعة', 'بداية الزيارة', 'نهاية الزيارة', 'مدة الزيارة', 'Email', ...(expanded ? ['مرحلة البيع', 'قوة الفرصة', 'الأصناف', 'الإجراء القادم', 'المنافس'] : []), ''].map((label, i) => <TableHead key={i}>{t(label)}</TableHead>))}</TableRow></TableHeader><TableBody>{t(rows.map(row => <TableRow key={row.id}><TableCell><button className="visit-number" onClick={() => onOpen(row.id)}>{t(row.data.visitNumber) || t('غير مرقمة')}</button>{row.data._serviceWorkflow&&<span className="badge pending">{t(serviceStatusLabels[row.data._serviceWorkflow.state])}</span>}</TableCell><TableCell><button className="visit-customer" onClick={() => onCustomer && customerFor(row) ? onCustomer(customerFor(row)!.id) : onOpen(row.id)}>{customerFor(row)?.data.name || t('—')}</button></TableCell><TableCell>{t(contactTypes[row.data.type])}</TableCell><TableCell className="visit-long-cell">{visitPurposes.includes(row.data.summary)?t(row.data.summary):row.data.summary}</TableCell><TableCell className="visit-long-cell">{t(visitResult(row.data)) || t('لم تُسجّل بعد')}</TableCell><TableCell className="visit-long-cell"><span title={row.data.notes}>{row.data.notes || t('—')}</span></TableCell><TableCell>{mapsLink(row.data) ? <a className="visit-location-link" href={mapsLink(row.data)!} target="_blank" rel="noopener noreferrer"><MapPin size={15}/><span dir="ltr">{t(row.data.location)}</span></a> : t('غير مسجل')}</TableCell><TableCell dir="ltr">{t(row.data.nextDate) || t('—')}</TableCell><TableCell dir="ltr">{t(formatVisitTime(row.data.startedAt))}</TableCell><TableCell dir="ltr">{t(formatVisitTime(row.data.endedAt))}</TableCell><TableCell><strong>{t(durationLabel(row.data))}</strong>{durationNeedsReview(row.data) && <small className="duration-warning">{t(row.data.timingSource==='journey'?'تحتاج مراجعة':'تحتاج مراجعة · أكثر من 24 ساعة')}</small>}</TableCell><TableCell dir="ltr">{row.data.recordedByEmail || t('غير مسجل')}</TableCell>{expanded && <><TableCell>{t(stageLabels[row.data.salesStage]) || t('غير مسجلة')}</TableCell><TableCell>{t(strengthLabels[row.data.strength]) || t('غير مسجلة')}</TableCell><TableCell>{(row.data.requestedProducts || []).map((product:string)=>t(product)).join(getLanguage()==='ar'?'، ':', ') || t('—')}</TableCell><TableCell>{row.data.nextAction || t('—')}</TableCell><TableCell>{row.data.hasCompetitor ? row.data.competitorName : t('—')}</TableCell></>}<TableCell>{onDelete&&row.data.visitWorkflow!=='service-intake-v1'&&!row.data._offlineState&&!row.data._offlineAcknowledged&&<button type="button" className="btn subtle small danger" aria-label={say("حذف الزيارة","Delete visit")} onClick={()=>onDelete(row)}><Trash2 size={15}/>{say("حذف","Delete")}</button>}<button className="btn subtle small" onClick={() => !canEdit||row.data._readOnly?onOpen(row.id):onEdit(row)}>{!canEdit||row.data._readOnly?<Eye size={15}/>:<Pencil size={15}/>}{t(!canEdit||row.data._readOnly?'عرض التفاصيل':'تعديل')}</button>{onWorkflow&&row.data._serviceWorkflow&&<button className="btn subtle small" onClick={()=>onWorkflow(row.data._serviceWorkflow.id)}>{t('الاعتماد والتكليف')}</button>}</TableCell></TableRow>))}</TableBody></Table></div></>;
}

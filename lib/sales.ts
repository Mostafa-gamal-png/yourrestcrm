import { z } from 'zod';
import {lineCents,moneyCents} from './decimal-money';
import {salesScopeMemberIds,recordAuthorId} from './access';
import { type Member, type Row} from './crm';
import { visitCustomer, visitProducts } from './customer-visits';

export const salesProducts = [...visitProducts, 'خدمات صيانة'];
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'اختر شهرًا صحيحًا');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'أدخل تاريخًا صحيحًا').refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'أدخل تاريخًا صحيحًا');
const amount = z.coerce.number().finite().min(0).max(1000000000);
export type SaleRow = { id: string; customer_id: string; rep_id: string; branch: string; date: string; reference: string; data: string; total_cents: number; status: 'confirmed' | 'void'; void_reason: string; version: number; created_by: string; created_at: string; updated_at: string };
export type SaleItem = { product: string; description: string; quantity: number; unitPrice: number };
export function salesTotals(items: SaleItem[], discount: number) {
    const subtotalCents = items.reduce((n, item) => n + lineCents(item.quantity,item.unitPrice), 0);
    return { subtotalCents, totalCents: subtotalCents - moneyCents(discount) };
}
export const saleSchema = z.object({
    customerId: z.string().min(1, 'اختر العميل'), repId: z.string().min(1, 'حدد مندوب المبيعات'),
    date: dateSchema, reference: z.string().trim().min(1, 'أدخل رقم الفاتورة أو مرجع البيع').max(100),
    items: z.array(z.object({ product: z.string().refine(p => salesProducts.includes(p), 'اختر صنفًا صحيحًا'), description: z.string().trim().max(500).default(''), quantity: z.coerce.number().finite().positive('الكمية يجب أن تكون أكبر من صفر').max(100000), unitPrice: amount })).min(1).max(50),
    discount: amount.default(0), notes: z.string().trim().max(2000).default('')
}).superRefine((data, ctx) => {
    const { totalCents } = salesTotals(data.items, data.discount);
    if (totalCents <= 0 || totalCents > 100000000000) ctx.addIssue({ code: 'custom', message: 'راجع الأسعار والخصم؛ صافي المبيعات يجب أن يكون أكبر من صفر' });
});
export type Sale = z.infer<typeof saleSchema> & { id: string; customerName: string; branch: string; totalCents: number; status: 'confirmed' | 'void'; voidReason: string; version: number; createdBy: string; createdAt: string; updatedAt: string; source?: 'erp'; documentType?: 'sale' | 'return'; readOnly?: boolean };
export function salesMemberIds(members: Member[], me: Member) {
    return salesScopeMemberIds(members.filter(m=>['admin','manager','supervisor','rep'].includes(m.role)),me,{activeOnly:true});
}
/** Historical entries remain in the current reporting scope after account deactivation. */
export function salesReadMemberIds(members:Member[],me:Member){
    return salesScopeMemberIds(members.filter(m=>['admin','manager','supervisor','rep'].includes(m.role)),me);
}
/** Resolve imported email-only recorders with the same identity rule used by visibility. */
export function salesReportingRecords(records:Row[],members:Member[]){return records.map(row=>row.kind==='activity'?{...row,data:{...row.data,performedBy:recordAuthorId(row,members)||'',responsibleId:recordAuthorId(row,members)||''}}:row);}
export function effectiveVisit(row: Row) { return row.data.type === 'visit' && (['تم الشراء', 'تم أخذ موعد', 'تم اخذ موعد'].includes(String(row.data.result || '').trim()) || (!String(row.data.result || '').trim() && row.data.outcome === 'effective')); }
export function repPerformance(member: Member, month: string, records: Row[], sales: Sale[], sourceMemberIds:string[]=[member.id],salesSourceMemberIds:string[]=sourceMemberIds) {
    const ids=new Set(sourceMemberIds);
    const contacts = records.filter(r => r.kind === 'activity' && ids.has(r.data.performedBy || r.data.responsibleId) && String(r.data.date || '').startsWith(month));
    const visits = contacts.filter(r => r.data.type === 'visit'), effective = visits.filter(effectiveVisit);
    const saleIds=new Set(salesSourceMemberIds);
    const invoices = sales.filter(s => saleIds.has(s.repId) && s.status === 'confirmed' && s.date.startsWith(month));
    const total = invoices.reduce((n, s) => n + s.totalCents, 0) / 100;
    return { member, contacts: contacts.length, visits: visits.length, calls: contacts.filter(r => r.data.type === 'call').length, effective: effective.length, customers: new Set(contacts.map(r => visitCustomer(r, records)?.id).filter(Boolean)).size, invoices: invoices.filter(s=>s.documentType!=='return').length, total };
}

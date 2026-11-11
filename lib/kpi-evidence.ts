import {z} from 'zod';
import {type Member} from './crm';

const cents=z.number().int().min(0).max(1_000_000_000_000).nullable();
const reference=z.string().trim().max(2000);
export const kpiEvidenceInputSchema=z.object({
 collection:z.object({dueCents:cents,collectedCents:cents,reference}).strict(),
 history:z.object({complete:z.boolean(),reference}).strict(),
 quotationsComplete:z.boolean(),
 quotations:z.array(z.object({quoteId:z.string().min(1).max(300),saleId:z.string().min(1).max(300).nullable()}).strict()).max(200)
}).strict().superRefine((input,ctx)=>{
 const {dueCents,collectedCents,reference:collectionReference}=input.collection;
 if((dueCents===null)!==(collectedCents===null))ctx.addIssue({code:'custom',path:['collection'],message:'أدخل المستحق والمحصل معًا.'});
 if(dueCents!==null&&!collectionReference)ctx.addIssue({code:'custom',path:['collection','reference'],message:'أدخل مرجع بيانات التحصيل.'});
 if(dueCents===0&&collectedCents!==null&&collectedCents>0)ctx.addIssue({code:'custom',path:['collection','collectedCents'],message:'المحصل يحتاج مبلغًا مستحقًا أكبر من صفر.'});
 if(input.history.complete&&!input.history.reference)ctx.addIssue({code:'custom',path:['history','reference'],message:'أدخل مرجع اكتمال سجل المبيعات.'});
 if(new Set(input.quotations.map(q=>q.quoteId)).size!==input.quotations.length)ctx.addIssue({code:'custom',path:['quotations'],message:'اختر كل عرض سعر مرة واحدة.'});
 const sales=input.quotations.flatMap(q=>q.saleId?[q.saleId]:[]);
 if(new Set(sales).size!==sales.length)ctx.addIssue({code:'custom',path:['quotations'],message:'اربط الفاتورة بعرض سعر واحد فقط.'});
});
export type KpiEvidenceInput=z.infer<typeof kpiEvidenceInputSchema>;
export const emptyKpiEvidenceInput=():KpiEvidenceInput=>({collection:{dueCents:null,collectedCents:null,reference:''},history:{complete:false,reference:''},quotationsComplete:false,quotations:[]});
export type KpiEvidence={memberId:string;month:string;input:KpiEvidenceInput;version:number;updatedAt:string;updatedBy:string;salesRevision:number;scopeKey:string;cutoff:string};
export type QuoteOption={id:string;reference:string;customerId:string;customerName:string;date:string;kind:'quote'|'activity'};
export type InvoiceOption={id:string;reference:string;customerId:string;customerName:string;date:string;repId:string;source:'crm'|'erp'};
export type KpiQuoteOption=QuoteOption;
export type KpiInvoiceOption=InvoiceOption;
export type KpiEvidenceOptions={memberId:string;month:string;evidence:KpiEvidence|null;salesRevision:number;evidenceRevision:number;scopeKey:string;period:{from:string;through:string};canEdit:boolean;computed:boolean;sourceMemberIds:string[];quotes:QuoteOption[];invoices:InvoiceOption[]};
/** A reporting-scope change makes old completeness confirmations stale. */
export function evidenceScopeKey(member:Member){return JSON.stringify([member.id,member.role,member.regionScope||'all',member.branch,member.supervisorId||'',member.authVersion??0,member.active]);}
/** quotationsKnown: the month's quotations of the scope are known (lib/kpis-server.ts lists them from the CRM's quote records, so this
 *  holds whenever the scope has a sales team; it no longer waits for a confirmation in «بيانات المؤشرات»). quotations: each once, with
 *  whether it converted and, from the server, its number and the invoices that converted it (lib/kpis.ts KpiQuotation). */
export type KpiEvidenceContext={historyComplete:boolean;collection:{dueCents:number;collectedCents:number}|null;purchases:Array<{customerKey:string;date:string;netCents:number;hasSale:boolean}>;quotationsKnown:boolean;quotations:Array<{quoteId:string;converted:boolean}&Partial<KpiQuotationDetail>>;recoveryTarget:number|null;invalidHistoryReason?:string};
/** What the hub's «عروض الأسعار» shows of a quotation: its number, day, customer and representative, and the invoices that converted it
 *  (via: «description» an ERP invoice whose «الوصف» names it, «manual» a link in «بيانات المؤشرات»). */
export type KpiQuotationDetail={number:string;date:string;repId:string;customerName:string;invoices:string[];via:Array<'description'|'manual'>};

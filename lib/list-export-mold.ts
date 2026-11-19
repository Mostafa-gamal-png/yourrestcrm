// «تصدير Excel» of «طلبات تصنيع القوالب» (lib/list-export.ts; the owner, 2026-11-19, GSCO 2.13.80): «كل الطلبات» as the page filters it,
// the CRM's requests and the products application's, each in the words of its card and of the filters (lib/mold-filters.ts). Its own module
// so that only the mold page loads the mold modules. Pure.
import {exportTable,dayCell,momentCell,numberCell,sayIn,yesNo,type ExportColumn,type ExportLanguage,type ExportTable} from './list-export';
import {MOLD_SOURCE_NAMES,isMoldOrder,moldCardStatus,moldSourceKey,moldStatusKeys,moldStatusLabel,moldStepKeys,moldStepLabel} from './mold-filters';
import type {MoldOrderView,MoldRequestView} from './mold-requests';

const joinIn=(language:ExportLanguage)=>language==='en'?', ':'، ';
type MoldEntry=MoldRequestView|MoldOrderView;
/** «كل الطلبات» as filtered on the page (the CRM's requests and the products application's), with the words of its cards and filters. */
export function moldTables(entries:readonly MoldEntry[],linkReady:boolean,language:ExportLanguage):ExportTable[]{
 const say=sayIn(language),join=joinIn(language),pair=(value:readonly [string,string]|null)=>value?say(value[0],value[1]):'';
 const columns:ExportColumn<MoldEntry>[]=[
  ['رقم أمر الإنتاج','Production order',e=>numberCell(e.remote?.orderNo??(isMoldOrder(e)?null:e.legacyOrderNo))],['مرجع الطلب','Request reference',e=>isMoldOrder(e)?e.requestRef:e.remote?.requestRef||''],
  ['المصدر','Source',e=>pair(MOLD_SOURCE_NAMES[moldSourceKey(isMoldOrder(e)?{source:e.source}:{})])],['تاريخ الطلب','Requested on',e=>momentCell(e.requestedAt)],['المندوب','Representative',e=>e.memberName],
  ['العميل','Customer',e=>e.customerName],['رقم العميل في يورست','Yourrest customer number',e=>numberCell(e.crmNumber)],['كود ERP','ERP code',e=>e.customerErpCode],['المدينة','City',e=>e.customerCity],
  ['وصف القالب','Mold description',e=>e.specs.description],['رقم القالب','Mold number',e=>e.specs.moldNo],['الكمية','Quantity',e=>numberCell(e.specs.quantity)],
  ['الحالة','Status',e=>pair(moldCardStatus(e))],['تفاصيل الحالة','Status details',e=>moldStatusKeys(e,linkReady).map(key=>pair(moldStatusLabel(key))).filter(Boolean).join(join)],
  ['واقف عند','Waiting at',e=>moldStepKeys(e).map(key=>pair(moldStepLabel(key))).filter(Boolean).join(join)],['أعادتها المالية','Returned by finance',e=>yesNo(!!e.returned,say)],
  ['الرقم التسلسلي','Serial number',e=>e.remote?.moldSerial||''],['تاريخ الإنتاج','Production date',e=>dayCell(e.remote?.productionDate)],['تاريخ التسليم','Delivery date',e=>dayCell(e.remote?.deliveryDate)],
 ];
 return [exportTable(['طلبات تصنيع القوالب','Mold requests'],columns,entries,language)];
}


// «المحذوفات» (the owner, 2026-11-09, «نفذ الاربعة», GSCO's «المحذوفات مع استرجاع»): the records deleted from the CRM, read from the
// «حذف» history entries a deletion already writes (app/api/crm/route.ts; no table of its own, no migration), and restored from them by
// /api/trash (lib/trash-server.ts). Shared by the page and the server: the record types, their names and the messages.
export type TrashType='customer'|'visit'|'followup'|'opportunity'|'quote'|'machine';
export const TRASH_TYPES:readonly TrashType[]=['customer','visit','followup','opportunity','quote','machine'];
/** The app's names of the kinds of records (a follow-up is a contact of the «متابعات» page, a visit any other contact). */
export const trashTypeNames:Record<TrashType,readonly [string,string]>={customer:['عميل','Customer'],visit:['زيارة','Visit'],followup:['متابعة','Follow-up'],opportunity:['فرصة','Opportunity'],quote:['عرض سعر','Quotation'],machine:['ماكينة','Machine']};
/** GSCO's page size: 40 entries, newest first, then «تحميل المزيد». */
export const TRASH_PAGE_SIZE=40;
/** The history entries: a deletion's (unchanged since before this release, with more detail since) and a restoration's, whose id is
 *  restore:<the deletion's id>, so a deletion is restored once. */
export const TRASH_DELETE_ACTION='حذف',TRASH_RESTORE_ACTION='استرجاع سجل';
export const trashRestoreId=(deleteAuditId:string)=>'restore:'+deleteAuditId;

export function trashType(record:{kind?:unknown;data?:Record<string,unknown>|null}):TrashType|null{
 switch(record.kind){
  case 'customer':return 'customer';
  case 'factory':return 'machine';
  case 'opportunity':return 'opportunity';
  case 'quote':return 'quote';
  case 'activity':return record.data?.visitWorkflow==='followup-v1'?'followup':'visit';
  default:return null;
 }
}

/** One entry of the list. blocked: why it cannot be restored now (the same words the restoration would refuse with), or null. */
export type TrashItem={id:string;recordId:string;type:TrashType;title:string;number:string;customerName:string;deletedBy:string;deletedAt:string;blocked:string|null;note:string|null};
export type TrashAnswer={items:TrashItem[];next:string|null;scope:'all'|'own'};
export type TrashRestoreAnswer={ok:true;id:string;type:TrashType;notes:string[];alreadySaved?:boolean};

export const TRASH_TEXT={
 forbidden:'المحذوفات متاحة لمدير النظام ومدير المبيعات فقط.',
 notYours:'استرجاع ما حذفه غيرك متاح لمدير النظام فقط.',
 notFound:'السجل غير موجود في المحذوفات.',
 already:'السجل اتسترجع قبل كده.',
 exists:'السجل موجود بالفعل.',
 broken:'غير قابل للاسترجاع: بيانات الحذف ناقصة.',
 changed:'تغيّرت البيانات أثناء الاسترجاع. حدّث القائمة وأعد المحاولة.',
 outOfScope:'السجل خارج نطاق صلاحيتك',
 linked:'السجل المرتبط',
} as const;
/** GSCO's «استرجع العميل المرتبط أولًا.», naming the record to restore first. */
export const trashParentFirst=(label:string)=>'استرجع السجل الأصلي أولًا: '+label+'.';
export const trashNumberTaken=(code:string)=>'رقم يورست '+code+' أصبح لعميل آخر؛ لا يمكن استرجاع العميل بنفس الرقم.';
export const trashCodeSkipped=(code:string,holder:string)=>'لم يُسترجع كود ERP «'+code+'»: أصبح للعميل «'+holder+'».';
export const trashNewNumber=(code:string)=>'استُرجع العميل برقم يورست جديد '+code+' (حُذف قبل ترقيم العملاء).';
export const TRASH_NEW_NUMBER_NOTE='حُذف قبل ترقيم العملاء: يُسترجع برقم يورست جديد.';
export const yourrestCode=(number:number)=>'YR-C-'+String(number).padStart(6,'0');

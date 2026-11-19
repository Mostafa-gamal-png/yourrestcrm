// «صور القالب» (the owner, 2026-11-19: «عايز فى بيانات العميل ان ارفع صورة للقالب» then «اكتر من صورة»): photos of the customer's mold
// (the block-making mold the factory uses), several a customer, in the customer's sheet. Shared by the page and the server: the limits,
// the rules of who adds and who deletes, the check of the bytes, and the words.
// Where they live: rows of crm_visit_files (no migration), told apart from the competitors' offers by their id (MOLD_PHOTO_ID_PREFIX) and
// their object key (MOLD_PHOTO_KEY_PREFIX), so the backups take their bytes as they take every visit file's (portable/backup-core.mjs).
// The release before this one (update-orders-20261119) lists no visit file by customer, so it keeps the rows and their bytes and shows
// none of them.
import type {Member,Row} from './crm';
import {canUseSalesWorkspace,salesScopeMemberIds} from './access';
import {cellRefused,cellRefusalText} from './permissions';
import {isFieldRole,isMarketingRole} from './roles';
import {isServiceRole} from './customer-service';

/** At most this many photos for one customer (the owner: «اكتر من صورة»; the hosting disk filled up on 2026-11-19, so a bound). */
export const MOLD_PHOTO_MAX_COUNT=20;
/** A photo as the server accepts it, after the device shrank it (lib/image-shrink.ts aims at 400 KB). */
export const MOLD_PHOTO_MAX_BYTES=2*1024*1024;
/** The form's body: the photo and the multipart framing (lib/request-body.ts). */
export const MOLD_PHOTO_FORM_BYTES=MOLD_PHOTO_MAX_BYTES+64*1024;
/** A photo's row id: this prefix and the SHA-256 of the member and the upload's key (a retry of the same key finds the same row). */
export const MOLD_PHOTO_ID_PREFIX='mold-photo-';
/** A photo's object in the store (env.FILES): this prefix, a random part and the upload's fingerprint. */
export const MOLD_PHOTO_KEY_PREFIX='mold-photo/';
/** The SQL that keeps a crm_visit_files query to the mold photos (or, negated, to the competitors' offers). */
export const MOLD_PHOTO_SQL="substr(id,1,11)='mold-photo-'";
export const MOLD_PHOTO_ID=/^mold-photo-[0-9a-f]{64}$/;
export const isMoldPhotoId=(id:unknown)=>typeof id==='string'&&id.startsWith(MOLD_PHOTO_ID_PREFIX);
export const isMoldPhotoKey=(key:unknown)=>typeof key==='string'&&key.startsWith(MOLD_PHOTO_KEY_PREFIX);
/** The history entries (crm_audit, record_id = the customer): the add's id is its receipt (a photo deleted since is not added again by a
 *  late retry of the same key), the delete's id makes a repeated delete harmless. */
export const moldPhotoAddReceipt=(photoId:string)=>'mold-photo-add:'+photoId;
export const moldPhotoDeleteReceipt=(photoId:string)=>'mold-photo-delete:'+photoId;
/** The actions written in «سجل التغييرات» (lib/locales/en.json has their English). */
export const MOLD_PHOTO_ADD_ACTION='إضافة صورة للقالب';
export const MOLD_PHOTO_DELETE_ACTION='حذف صورة من صور القالب';
/** The detail of both entries: how many photos the customer has after it (the SQL appends the number). */
export const MOLD_PHOTO_COUNT_DETAIL='عدد صور القالب: ';

export type MoldPhotoMime='image/jpeg'|'image/png'|'image/webp';
/** What the bytes are, never what the browser called them: a JPEG, a PNG or a WEBP, else null. */
export function moldPhotoMime(bytes:Uint8Array):MoldPhotoMime|null{
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 if(bytes.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value))return 'image/png';
 const ascii=(from:number,to:number)=>String.fromCharCode(...bytes.subarray(from,to));
 if(bytes.length>=12&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'image/webp';
 return null;
}
export const moldPhotoExtension=(mime:MoldPhotoMime)=>mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';

/** The words of the server's answers (lib/locales/en.json has each one). */
export const MOLD_PHOTO_TEXT={
 customerGone:'العميل غير متاح',
 photoGone:'الصورة غير متاحة',
 addRefused:'إضافة صور القالب متاحة لمن يسجّل ماكينات هذا العميل.',
 deleteRefused:'حذف الصورة متاح لمن أضافها ولمدير النظام.',
 choose:'اختر صورة للقالب.',
 notImage:'الصور المقبولة: JPG، PNG، WEBP.',
 tooLarge:'حجم الصورة أكبر من 2 ميجابايت بعد تصغيرها. اختر صورة أصغر.',
 full:'الحد '+MOLD_PHOTO_MAX_COUNT+' صورة للقالب لكل عميل. احذف صورة أولًا.',
 busy:'رفع الصور مشغول مؤقتًا. أعد المحاولة بعد لحظات.',
 storage:'رفع الملفات غير متاح مؤقتًا.',
 changed:'تغيّرت صلاحياتك أو بيانات العميل. أعد المحاولة.',
 keyReused:'رُفعت هذه الصورة من قبل ببيانات مختلفة. اختر الصورة مرة أخرى.',
 badRequest:'بيانات رفع الصورة غير صحيحة.',
} as const;

type Who=Pick<Member,'id'|'role'|'branch'|'access'>;
/**
 * Who adds photos to a customer: exactly who may add and correct that customer's machines (app/api/crm/route.ts and
 * lib/crm-server.ts masterMutationGuard for a machine; app/crm-app.tsx canAddMachineTo), with the cell that opens it («تعديل» of «العملاء»,
 * lib/permissions.ts recordCell('factory')):
 * - a representative or a marketing officer: the customers assigned to them (a marketing officer: of their branch too);
 * - a supervisor and a sales manager: the customers of their team (the team as the role defines it; «عرض بيانات الفريق بالكامل» never
 *   widens it); the administrator: every customer;
 * - never customer service (no machine either).
 * The region and whether the reader sees the customer at all are the server's (lib/mold-photos-server.ts seenCustomer). '' when allowed,
 * else the refusal's words.
 */
export function moldPhotoAddRefusal(customer:Pick<Row,'kind'|'assignedTo'|'branch'>,members:Member[],me:Who):string{
 if(customer.kind!=='customer'||isServiceRole(me.role))return MOLD_PHOTO_TEXT.addRefused;
 if(cellRefused(me,'customer','edit'))return cellRefusalText('customer','edit');
 if(isFieldRole(me.role))return customer.assignedTo===me.id&&(!isMarketingRole(me.role)||customer.branch===me.branch)?'':MOLD_PHOTO_TEXT.addRefused;
 if(!canUseSalesWorkspace(me.role))return MOLD_PHOTO_TEXT.addRefused;
 return me.role==='admin'||salesScopeMemberIds(members,me as Member).has(customer.assignedTo)?'':MOLD_PHOTO_TEXT.addRefused;
}
/** Who deletes a photo (of a customer they see): whoever added it, and the administrator, while «تعديل» of «العملاء» is on for them. */
export function moldPhotoDeleteRefusal(photo:{uploadedBy:string},me:Who):string{
 if(cellRefused(me,'customer','edit'))return cellRefusalText('customer','edit');
 return me.role==='admin'||photo.uploadedBy===me.id?'':MOLD_PHOTO_TEXT.deleteRefused;
}

/** One photo as the page gets it (GET /api/mold-photos?customerId=). uploadedBy: the name, only when the reader may read that member's
 *  name (as GET /api/crm lists members), else ''. */
export type MoldPhotoView={id:string;contentType:string;size:number;createdAt:string;uploadedBy:string;mine:boolean;canDelete:boolean};
export type MoldPhotoList={ok:true;customerId:string;photos:MoldPhotoView[];max:number;canAdd:boolean};
export const moldPhotoSrc=(id:string)=>'/api/mold-photos?id='+encodeURIComponent(id);
export function validMoldPhotoList(value:unknown):value is MoldPhotoList{
 if(!value||typeof value!=='object')return false;
 const list=value as Partial<MoldPhotoList>;
 return list.ok===true&&typeof list.customerId==='string'&&typeof list.max==='number'&&typeof list.canAdd==='boolean'&&Array.isArray(list.photos)&&list.photos.every(photo=>!!photo&&typeof photo==='object'&&isMoldPhotoId((photo as MoldPhotoView).id)&&typeof (photo as MoldPhotoView).createdAt==='string');
}

// «صور القالب» on the server (lib/mold-photos.ts says what they are): which customer the reader sees, the list, the file, an upload and a
// deletion, each re-checked at the commit (the member, their permissions' version and the customer's version, as every customer write).
// app/api/mold-photos/route.ts (list, file, upload) and app/api/mold-photos/delete/route.ts call these.
import {env} from 'cloudflare:workers';
import {accessGuard,CRMError,masterMutationGuard,type context} from './crm-server';
import {serviceVisitRecords,isServiceRole} from './customer-service';
import {salesScopeMemberIds} from './access';
import type {Row} from './crm';
import {MOLD_PHOTO_ADD_ACTION,MOLD_PHOTO_COUNT_DETAIL,MOLD_PHOTO_DELETE_ACTION,MOLD_PHOTO_KEY_PREFIX,MOLD_PHOTO_MAX_BYTES,MOLD_PHOTO_MAX_COUNT,MOLD_PHOTO_SQL,MOLD_PHOTO_TEXT,moldPhotoAddReceipt,moldPhotoAddRefusal,moldPhotoDeleteReceipt,moldPhotoDeleteRefusal,moldPhotoExtension,moldPhotoMime,type MoldPhotoList,type MoldPhotoView} from './mold-photos';

type Context=Awaited<ReturnType<typeof context>>;
export type MoldPhotoRow={id:string;object_key:string;customer_id:string;name:string;content_type:string;size:number;uploaded_by:string;created_at:string};

const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('');
export const sha256=async(value:Uint8Array|string)=>hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value)));
/** A photo's id: the member and the upload's key, so a retry of the same upload finds the same row and another member never does. */
export const moldPhotoIdFor=async(memberId:string,key:string)=>'mold-photo-'+await sha256(memberId+':'+key);

/** The customer as stored, when the reader sees it: exactly the customers GET /api/crm gives them (their regions for the sales team; for
 *  customer service its branch's in its regions and the customers of the requests it reads). Undefined otherwise. */
export function seenCustomer(c:Context,customerId:string):Row|undefined{
 if(!serviceVisitRecords(c).some(row=>row.id===customerId&&row.kind==='customer'))return undefined;
 return c.all.find(row=>row.id===customerId&&row.kind==='customer');
}
/** The members whose names the reader reads (as GET /api/crm lists them): a team's, wider with «عرض بيانات الفريق بالكامل». */
function readableNames(c:Context){
 const ids=isServiceRole(c.me.role)?new Set(c.members.filter(member=>member.id===c.me.id||member.supervisorId===c.me.id).map(member=>member.id)):salesScopeMemberIds(c.members,c.me,{read:true});
 return (id:string)=>ids.has(id)?c.members.find(member=>member.id===id)?.name||'':'';
}
async function photoRows(c:Context,customerId:string){
 return (await c.db.prepare(`SELECT id,object_key,customer_id,name,content_type,size,uploaded_by,created_at FROM crm_visit_files WHERE customer_id=? AND ${MOLD_PHOTO_SQL} ORDER BY created_at,id`).bind(customerId).all<MoldPhotoRow>()).results;
}
const countSql=`(SELECT COUNT(*) FROM crm_visit_files WHERE customer_id=? AND ${MOLD_PHOTO_SQL})`;
/** How many photos the customer has now. */
export async function moldPhotoCount(db:D1Database,customerId:string){return Number((await db.prepare(`SELECT ${countSql} AS n`).bind(customerId).first<{n:number}>())?.n??0);}
function view(c:Context,row:MoldPhotoRow,name=readableNames(c)):MoldPhotoView{
 return {id:row.id,contentType:row.content_type,size:Number(row.size),createdAt:row.created_at,uploadedBy:name(row.uploaded_by),mine:row.uploaded_by===c.me.id,canDelete:!moldPhotoDeleteRefusal({uploadedBy:row.uploaded_by},c.me)};
}

/** GET ?customerId=: the customer's photos, oldest first, and whether the reader may add. */
export async function listMoldPhotos(c:Context,customer:Row):Promise<MoldPhotoList>{
 const name=readableNames(c);
 return {ok:true,customerId:customer.id,photos:(await photoRows(c,customer.id)).map(row=>view(c,row,name)),max:MOLD_PHOTO_MAX_COUNT,canAdd:!moldPhotoAddRefusal(customer,c.members,c.me)};
}

/** A photo's row, or null (an id of a competitor's offer is never one). */
export async function moldPhotoRow(db:D1Database,id:string){
 return await db.prepare(`SELECT id,object_key,customer_id,name,content_type,size,uploaded_by,created_at FROM crm_visit_files WHERE id=? AND ${MOLD_PHOTO_SQL}`).bind(id).first<MoldPhotoRow>();
}

/** GET ?id=: the photo's bytes, shown in the page (an image type the server checked when it was stored). The bytes of an id never
 *  change, so the reader's browser keeps them a day (private: never a shared cache). */
export async function moldPhotoResponse(row:MoldPhotoRow){
 if(!env.FILES)throw new CRMError(MOLD_PHOTO_TEXT.storage,503);
 const object=await env.FILES.get(row.object_key);
 if(!object)throw new CRMError(MOLD_PHOTO_TEXT.photoGone,404);
 return new Response(object.body,{headers:{'Content-Type':row.content_type,'Content-Length':String(row.size),'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'}});
}

/**
 * One photo added (POST ?customerId=&key=, the form's `file`). The reader sees the customer and may add (lib/mold-photos.ts); the bytes are
 * a JPEG, a PNG or a WEBP of at most 2 MB; the customer has fewer than 20. The object is written first, then the row and its history
 * entry in one batch gated as a machine's write of that customer (masterMutationGuard) and on the count; a refused or repeated write
 * removes only its own object. The same key again: the saved photo (alreadySaved), or deleted:true when it was deleted since.
 */
export async function addMoldPhoto(c:Context,customer:Row,key:string,file:FormDataEntryValue|null):Promise<Response>{
 if(!(file instanceof File)||!file.size)throw new CRMError(MOLD_PHOTO_TEXT.choose);
 if(file.size>MOLD_PHOTO_MAX_BYTES)throw new CRMError(MOLD_PHOTO_TEXT.tooLarge,413);
 const bytes=new Uint8Array(await file.arrayBuffer()),mime=moldPhotoMime(bytes);
 if(!mime)throw new CRMError(MOLD_PHOTO_TEXT.notImage,415);
 if(!env.FILES)throw new CRMError(MOLD_PHOTO_TEXT.storage,503);
 const id=await moldPhotoIdFor(c.me.id,key),fingerprint=await sha256(JSON.stringify([customer.id,mime,bytes.length,await sha256(bytes)]));
 const count=()=>moldPhotoCount(c.db,customer.id);
 const replay=async():Promise<Response|null>=>{
  const existing=await c.db.prepare('SELECT id,object_key,customer_id,name,content_type,size,uploaded_by,created_at FROM crm_visit_files WHERE id=?').bind(id).first<MoldPhotoRow>();
  if(existing){
   if(existing.uploaded_by!==c.me.id||existing.customer_id!==customer.id||!existing.object_key.endsWith('-'+fingerprint))throw new CRMError(MOLD_PHOTO_TEXT.keyReused,409);
   return Response.json({ok:true,alreadySaved:true,photo:view(c,existing),count:await count()});
  }
  if(await c.db.prepare('SELECT id FROM crm_audit WHERE id=?').bind(moldPhotoAddReceipt(id)).first())return Response.json({ok:true,alreadySaved:true,deleted:true,photo:null,count:await count()});
  return null;
 };
 const prior=await replay();if(prior)return prior;
 if(await count()>=MOLD_PHOTO_MAX_COUNT)throw new CRMError(MOLD_PHOTO_TEXT.full,409);
 // Every attempt owns its object: a losing concurrent retry removes only its own, never the saved photo's.
 let objectKey=MOLD_PHOTO_KEY_PREFIX+crypto.randomUUID()+'-'+fingerprint;
 try{
  await env.FILES.put(objectKey,bytes,{httpMetadata:{contentType:mime}});
  const permission=masterMutationGuard(c,customer),now=new Date().toISOString(),name='mold-photo-'+now.slice(0,10)+'.'+moldPhotoExtension(mime);
  const result=await c.db.batch([
   c.db.prepare(`INSERT OR IGNORE INTO crm_visit_files (id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${permission.sql} AND ${countSql}<? AND NOT EXISTS (SELECT 1 FROM crm_audit WHERE id=?)`)
    .bind(id,objectKey,customer.id,name,mime,bytes.length,c.me.id,now,...permission.args,customer.id,MOLD_PHOTO_MAX_COUNT,moldPhotoAddReceipt(id)),
   c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?||${countSql},? WHERE EXISTS (SELECT 1 FROM crm_visit_files WHERE id=? AND object_key=?)`)
    .bind(moldPhotoAddReceipt(id),customer.id,c.me.name,MOLD_PHOTO_ADD_ACTION,MOLD_PHOTO_COUNT_DETAIL,customer.id,now,id,objectKey),
  ]);
  if(result[0].meta.changes!==1){
   await env.FILES.delete(objectKey).catch(()=>{});objectKey='';
   const again=await replay();if(again)return again;
   throw new CRMError(await count()>=MOLD_PHOTO_MAX_COUNT?MOLD_PHOTO_TEXT.full:MOLD_PHOTO_TEXT.changed,409);
  }
  objectKey='';
  const saved=await c.db.prepare('SELECT id,object_key,customer_id,name,content_type,size,uploaded_by,created_at FROM crm_visit_files WHERE id=?').bind(id).first<MoldPhotoRow>();
  return Response.json({ok:true,photo:saved?view(c,saved):null,count:await count()});
 }finally{if(objectKey)await env.FILES.delete(objectKey).catch(()=>{});}
}

/**
 * One photo deleted (POST /api/mold-photos/delete {id}): by whoever added it, or the administrator, of a customer they see. Not recoverable
 * («المحذوفات» holds records, not files); the history entry stays in «سجل التغييرات». The entry is written first, gated on the row as it was
 * read and on the member and the customer as they are (accessGuard), and the row goes only with that entry; the bytes go after the commit.
 * A repeated delete of a photo already deleted answers alreadyDeleted.
 */
export async function deleteMoldPhoto(c:Context,customer:Row,row:MoldPhotoRow):Promise<Response>{
 const refusal=moldPhotoDeleteRefusal({uploadedBy:row.uploaded_by},c.me);
 if(refusal)throw new CRMError(refusal,403);
 const permission=accessGuard(c,customer),receipt=moldPhotoDeleteReceipt(row.id),now=new Date().toISOString();
 const result=await c.db.batch([
  c.db.prepare(`INSERT OR IGNORE INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?||(${countSql}-1),? WHERE EXISTS (SELECT 1 FROM crm_visit_files WHERE id=? AND object_key=? AND customer_id=? AND uploaded_by=?) AND ${permission.sql}`)
   .bind(receipt,customer.id,c.me.name,MOLD_PHOTO_DELETE_ACTION,MOLD_PHOTO_COUNT_DETAIL,customer.id,now,row.id,row.object_key,row.customer_id,row.uploaded_by,...permission.args),
  c.db.prepare('DELETE FROM crm_visit_files WHERE id=? AND object_key=? AND EXISTS (SELECT 1 FROM crm_audit WHERE id=? AND created_at=?)').bind(row.id,row.object_key,receipt,now),
 ]);
 if(result[1].meta.changes!==1){
  if(!await moldPhotoRow(c.db,row.id)&&await c.db.prepare('SELECT id FROM crm_audit WHERE id=?').bind(receipt).first())return Response.json({ok:true,alreadyDeleted:true});
  throw new CRMError(MOLD_PHOTO_TEXT.changed,409);
 }
 // The row no longer names the object: its bytes go now (a backup taken meanwhile leaves the photo out: portable/backup-core.mjs).
 if(env.FILES)await env.FILES.delete(row.object_key).catch(error=>console.error('Mold photo bytes were not removed',error instanceof Error?error.name:'error'));
 return Response.json({ok:true,count:await moldPhotoCount(c.db,customer.id)});
}

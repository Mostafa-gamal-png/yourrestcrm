// The customer's signature inside a mold request's PDFs and the link the customer signs from, on the server (the owner, 2026-11-10).
// - Signed copies: when a request gets the customer's signature (on the device, or from the link) every PDF of its design, quotation and PO
//   files the customer saw gets a copy with the signature's block stamped on its last page (lib/mold-signed-pdf.ts), named «… - موقّع.pdf»,
//   of the original's category, and sent to production like any other file of that category (production's side does not change). A PDF
//   that cannot be opened (protected or damaged), a copy that would pass the category's limit or 25 MiB gets none: a row of the copy not
//   made is kept instead (deleted at once, never sent, its reason in last_error), so the request says which file and why, and a second
//   try never makes it. Every copy's crmFileId is fixed by the signature and the original (moldSignedCopyId).
// - The link: an unguessable token (32 random bytes, 256 bits), of which only the SHA-256 is stored, in the request's data
//   (data.signatureLink: no migration), valid 14 days, one a request (a new one replaces it), ending when the request is signed or cancelled.
//   The public page (app/sign/m/[token]) and its routes find a request by that hash only (findBySignToken); every refusal looks the same.
//   Each public request is counted by address (the sign-in's limiter, auth_limits) before anything is looked up.
import {env} from 'cloudflare:workers';
import {buildSignedDocument,stampSignaturePdf,type SignedDocResult} from './mold-signed-pdf';
import {MOLD_DESIGN_MAX_BYTES,MOLD_SIGNED_DOCUMENT_NAME,MOLD_SIGN_LINK_DAYS,MOLD_SIGN_TOKEN,MOLD_SIGNER_MAX,MOLD_SIGNER_MIN,MOLD_SIGNER_REQUIRED,MOLD_SIGNATURE_BAD,MOLD_SIGNATURE_REQUIRED,moldDesignFileCheck,moldSignatureBlockAt,moldSignatureBlockBytes,moldSignatureBlockCheck,moldSignatureBytes,moldSignatureCheck,moldSignaturePageBytes,moldSignaturePageCheck,moldSignedCopyName,moldSignedDocumentCategory,moldSignedDocumentParts,moldSigner} from '@/portable/mold-rules.mjs';
import {moldDesignCount,moldFileCategory,moldNeverSent,moldReturnedNow,moldSignableFile,moldSignatureOf,moldSignedCopyId,moldSignedCopyMax,moldSignedCopyOf,moldSignedDocumentFiles,moldSignedDocumentId,moldSignedOutputOf,MOLD_NOT_SIGNED,type MoldDesignFileRow,type MoldFileCategory,type MoldPaymentTerms,type MoldRequestRow,type MoldSignatureData,type MoldSignLink} from './mold-requests';
import {docCategory,type SignedDocPart} from './mold-signed-document';
import {loadMoldDesignFiles,loadMoldRequest,loadMoldRequests,moldNov10Known,MOLD_DESIGN_REFUSED_SQL,MOLD_NEVER_SENT_SQL} from './mold-requests-server';

export const MOLD_SIGN_LINK_MS=MOLD_SIGN_LINK_DAYS*86400_000;
/** How long after signing the customer may still download the signed copies through the link that signed (its thank-you page). */
export const MOLD_SIGNED_DOWNLOAD_MS=24*3600_000;
/** The words of every refusal of a link (forged, expired, used, cancelled, changed hands): the same, saying nothing of which. Its English
 *  pair is in lib/locales/en.json. */
export const SIGN_LINK_GONE='هذا الرابط لم يعد صالحًا. اطلب من المندوب رابطًا جديدًا.';
/** The request changed after the page was opened (its data, or its files): signed again from a fresh page. */
export const SIGN_LINK_CHANGED='عُدِّل الطلب؛ افتح الرابط مرة أخرى.';

const hex=(bytes:ArrayBuffer|Uint8Array)=>Array.from(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function sha256Hex(value:Uint8Array<ArrayBuffer>|string){return hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value));}
/** A new token: 32 random bytes as base64url (43 characters). */
export function newSignToken(){
 const bytes=crypto.getRandomValues(new Uint8Array(32));let text='';
 for(const byte of bytes)text+=String.fromCharCode(byte);
 return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
/** A new link made by a member: the token (shown once, never stored) and what the request's data keeps of it. */
export async function newSignLink(memberId:string,now:string):Promise<{token:string;link:MoldSignLink}>{
 const token=newSignToken();
 return {token,link:{hash:await sha256Hex(token),sentAt:now,expiresAt:new Date(Date.parse(now)+MOLD_SIGN_LINK_MS).toISOString(),by:memberId}};
}
/** The link's address on the CRM's own origin. */
export const signLinkUrl=(token:string)=>(env.YR_APP_ORIGIN||'')+'/sign/m/'+token;
/** Whether a request's link opens now: the request waits for the customer's signature from it (no signature yet), is not cancelled, has
 *  certainly never reached production with its data still to send, and the link has not expired. */
export function signLinkOpen(row:MoldRequestRow,now=Date.now()){
 const link=row.data.signatureLink;
 return !!link&&row.data.awaitsSignature===true&&!moldSignatureOf(row.data)&&!row.cancelledAt&&row.outbox==='send'&&(moldNeverSent(row)||moldReturnedNow(row))&&Date.parse(link.expiresAt)>now;
}
/** The request a token names: 'open' while its link opens (signLinkOpen), 'signed' for the link the customer signed from, within a day of
 *  signing (its signed copies only); null for anything else, a token not of the shape included (looked up by its hash, never by itself). */
export async function findBySignToken(db:D1Database,token:string,now=Date.now()):Promise<{row:MoldRequestRow;state:'open'|'signed';hash:string}|null>{
 if(typeof token!=='string'||!MOLD_SIGN_TOKEN.test(token))return null;
 const hash=await sha256Hex(token);
 const open=(await loadMoldRequests(db,"json_extract(data,'$.signatureLink.hash')=?",[hash]))[0];
 if(open)return signLinkOpen(open,now)?{row:open,state:'open',hash}:null;
 const signed=(await loadMoldRequests(db,"json_extract(data,'$.signature.link.hash')=?",[hash]))[0],at=Date.parse(signed?.data.signature?.link?.at||'');
 return signed&&!signed.cancelledAt&&Number.isFinite(at)&&now-at<MOLD_SIGNED_DOWNLOAD_MS&&now>=at?{row:signed,state:'signed',hash}:null;
}
/** The files a link shows and serves: while it opens, the request's own PDFs and images of the design, quotation and PO files (not the
 *  signature, not a signed copy, not deleted nor refused for good; nothing of production's); once signed, what its signature made: the
 *  signed document (2026-11-11), else the signed copies. Oldest first. */
export function signLinkFiles(row:MoldRequestRow,files:MoldDesignFileRow[],state:'open'|'signed'){
 const signature=moldSignatureOf(row.data);
 if(state==='signed')return signature?files.filter(file=>!file.deletedAt&&!!file.objectKey&&!!moldSignedOutputOf(file.id,signature.fileId)):[];
 return files.filter(file=>(file.kind==='pdf'||file.kind==='image')&&!file.deletedAt&&!!file.objectKey&&file.id.startsWith('mdf-')&&!(file.outbox==='send'&&!file.sentAt&&file.nextAttemptAt===null&&file.lastError?.final===true));
}
/** The request's other files the link names but never serves (2026-11-10, the documents on the page): a drawing, a model, an archive of
 *  its design, quotation or PO files that goes to production as it is, by name and category only. Not part of the page's key (moldSignKey):
 *  the customer signs what the page shows. Oldest first. */
export function signLinkOtherFiles(files:MoldDesignFileRow[]){
 return files.filter(file=>file.kind==='other'&&!file.deletedAt&&!!file.objectKey&&file.id.startsWith('mdf-')&&!(file.outbox==='send'&&!file.sentAt&&file.nextAttemptAt===null&&file.lastError?.final===true));
}
/** What the page was opened on (its form carries it back): the request's version and its files as listed, so a change of either since is
 *  told apart (SIGN_LINK_CHANGED). */
export async function moldSignKey(row:MoldRequestRow,files:MoldDesignFileRow[]){
 return (await sha256Hex(JSON.stringify([row.id,row.version,signLinkFiles(row,files,'open').map(file=>[file.id,file.sha256])]))).slice(0,32);
}

/** Counts a public request of the signing link by address (the sign-in's limiter: auth_limits), 120 a minute an address and 1200 in all;
 *  false once over. An address the hosting cannot tell (no verified client address) shares one count. */
export async function signLinkPermit(db:D1Database,headers:Headers,now=Date.now()){
 const client=env.YR_AUTH_CLIENT_KEY?.(headers)||'independent:shared',key=await sha256Hex((env.YR_AUTH_SECRET||'')+':mold-sign:'+client);
 const permit=async(name:string,max:number)=>{
  const start=Math.floor(now/60_000)*60_000;
  return !!await db.prepare('INSERT INTO auth_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN auth_limits.window_start=excluded.window_start THEN auth_limits.count+1 ELSE 1 END WHERE auth_limits.window_start<>excluded.window_start OR auth_limits.count<? RETURNING count').bind(name,start,max).first();
 };
 return await permit('mold-sign:client:'+key,120)&&await permit('mold-sign:global',1200);
}

/** The CRM's live files of a request and a category in SQL (the design-files route's own count): not deleted (or whose deletion has not
 *  reached production), not refused for good. */
const LIVE_FILES=`SELECT COUNT(*) FROM crm_mold_design_files WHERE request_id=? AND category=? AND (deleted_at IS NULL OR outbox='delete') AND NOT ${MOLD_DESIGN_REFUSED_SQL}`;
export type SignedCopies={made:{id:string;name:string;of:string}[];skipped:{id:string;name:string;of:string;reason:string}[]};
/**
 * The signed copies of the given originals (moldSignableFile), one after the other (a PDF of up to 25 MiB at a time in memory): each read
 * from the object store, stamped with the block, checked as production checks a PDF, stored and saved with one audit entry, while the
 * request's signature is still the one given and its category has a place left (the same count as an upload). A copy that cannot be made
 * leaves its row of reason (MOLD_NOT_SIGNED) and an audit entry instead. A copy already made (or found not makeable) for this signature
 * is left as it is. actor: who the audit names (the representative, or the customer by name from the link).
 */
export async function makeSignedCopies(db:D1Database,{requestId,signatureFileId,blockKey,originals,actor,now=()=>new Date().toISOString(),store=env.FILES}:{requestId:string;signatureFileId:string;blockKey:string;originals:MoldDesignFileRow[];actor:string;now?:()=>string;store?:R2Bucket}):Promise<SignedCopies>{
 const out:SignedCopies={made:[],skipped:[]};
 if(!originals.length||!store)return out;
 const blockObject=await store.get(blockKey),block=blockObject?new Uint8Array(await blockObject.arrayBuffer()):null;
 for(const original of originals.filter(moldSignableFile)){
  const id=moldSignedCopyId(signatureFileId,original.id),category=moldFileCategory(original),name=moldSignedCopyName(original.name);
  if((await loadMoldDesignFiles(db,'id=?',[id])).length)continue;
  const row=await loadMoldRequest(db,requestId);
  if(!row||moldSignatureOf(row.data)?.fileId!==signatureFileId)break;
  const skip=async(reason:string)=>{
   const at=now(),gate=`EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND json_extract(data,'$.signature.fileId')=?)`;
   const result=await db.batch([
    db.prepare(`INSERT OR IGNORE INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,deleted_at,outbox,next_attempt_at,last_error,version,category) SELECT ?,?,?,?,'pdf','application/pdf',0,'',NULL,?,?,NULL,NULL,?,1,? WHERE ${gate}`)
     .bind(id,requestId,row.memberId,name,at,at,JSON.stringify({code:MOLD_NOT_SIGNED,reason,http:0,at}),category,requestId,signatureFileId),
    db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_mold_design_files WHERE id=? AND created_at=? AND object_key IS NULL)`)
     .bind(crypto.randomUUID(),requestId,actor,'mold-design:signed-copy-skipped',JSON.stringify({label:'لم يوضع توقيع العميل داخل ملف لطلب تصنيع قالب',customerName:row.data.customer.name,name:original.name,reason,...(category!=='design'?{category}:{})}),at,id,at),
   ]);
   if(result[0].meta.changes===1)out.skipped.push({id,name:original.name,of:original.id,reason});
  };
  const object=block&&original.objectKey?await store.get(original.objectKey):null,bytes=object?new Uint8Array(await object.arrayBuffer()):null;
  if(!block||!bytes||bytes.length!==original.size||!moldDesignFileCheck(original.name,bytes,category).ok){await skip('damaged');continue;}
  const stamped=await stampSignaturePdf(bytes,block);
  if(!stamped.ok){await skip(stamped.reason);continue;}
  const copy=new Uint8Array(stamped.bytes),checked=moldDesignFileCheck(name,copy,category);
  if(!checked.ok){await skip(checked.reason==='too_large'?'too_large':'damaged');continue;}
  // A place of the category, every file counted (the CRM's live files and production's that the CRM does not hold), within production's
  // limits: 20, 10 and 10 once its update of 2026-11-10 is known, else 10, 5 and 5 (moldSignedCopyMax).
  const places=moldDesignCount(row,await loadMoldDesignFiles(db,'request_id=?',[requestId]),category),max=moldSignedCopyMax(category,await moldNov10Known(db));
  if(places.crm+places.production>=max){await skip('too_many_files');continue;}
  const objectKey='mold-design/'+requestId+'/'+id+'/'+crypto.randomUUID(),at=now(),mutation=crypto.randomUUID();
  await store.put(objectKey,copy,{httpMetadata:{contentType:'application/pdf'}});
  const hash=await sha256Hex(copy);
  const result=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,mutation_id,category)
    SELECT ?,?,?,?,'pdf','application/pdf',?,?,?,?,'send',?,1,?,? WHERE EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND cancelled_at IS NULL AND json_extract(data,'$.signature.fileId')=?) AND (${LIVE_FILES})<?`)
    .bind(id,requestId,row.memberId,name,copy.length,hash,objectKey,at,at,mutation,category,requestId,signatureFileId,requestId,category,max-places.production),
   db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_mold_design_files WHERE id=? AND mutation_id=?)`)
    .bind(crypto.randomUUID(),requestId,actor,'mold-design:signed-copy',JSON.stringify({label:'نسخة موقّعة من ملف لطلب تصنيع قالب',customerName:row.data.customer.name,name,of:original.name,size:copy.length,...(category!=='design'?{category}:{})}),at,id,mutation),
  ]);
  if(result[0].meta.changes===1)out.made.push({id,name,of:original.id});
  else{
   await store.delete(objectKey).catch(()=>{});
   // Taken meanwhile: by the same copy (another sender made it first) nothing more; else the category filled up, said so.
   if(!(await loadMoldDesignFiles(db,'id=?',[id])).length)await skip('too_many_files');
  }
 }
 return out;
}
/** The sources of a signed document: each part's file as the CRM holds it, read from the object store when building, refused (null) when
 *  its bytes are not the ones the signing page listed. */
export function signedDocSources(parts:readonly SignedDocPart[],found:readonly (MoldDesignFileRow|null)[],store:R2Bucket){
 return parts.map((part,index)=>({part,read:async()=>{
  const file=found[index],object=file?.objectKey?await store.get(file.objectKey):null;
  if(!object)return null;
  const bytes=new Uint8Array(await object.arrayBuffer());
  return bytes.length===file!.size&&await sha256Hex(bytes)===part.sha256?bytes:null;
 }}));
}
/** The signed document's category: the first document's (quotation, else PO, else design), among its parts, else among the request's
 *  own files. */
const documentCategory=(parts:readonly SignedDocPart[],files:readonly MoldDesignFileRow[],seen?:MoldFileCategory)=>docCategory(parts,[...files.filter(file=>file.id.startsWith('mdf-')&&!file.deletedAt).map(file=>({category:moldFileCategory(file)})),...(seen?[{category:seen}]:[])]);
/**
 * The ONE signed document of a request (the owner, 2026-11-11: «ملف واحد موقّع»): once every document the signing page listed is among the
 * request's files (at once from the link or the sheet; on the device as the files the customer saw are uploaded), it is built
 * (buildSignedDocument: their pages as they are, each picture a page, the signature page last), checked as production checks a PDF, stored
 * and saved with one audit entry as «طلب القالب - موقّع.pdf», a file of the first document's category that takes none of the originals'
 * places (a signed copy's 'mdc-' id), sent to production like the others. Not made: a row of reason is kept instead (as for a copy):
 * too_large (over production's limit for one file) or mismatch (not what the page listed: another count of pages, a PDF that does not
 * open), and the per-file signed copies of today are made instead from the block (fallback); too_many_files (no place left): nothing.
 * built: the document already built (the link builds it before saving the signature, to refuse a page that showed something else).
 * Returns the ids of what it made (the document, or the copies), to send after it.
 */
export async function makeSignedDocument(db:D1Database,{requestId,signatureFileId,actor,now=()=>new Date().toISOString(),store=env.FILES,built}:{requestId:string;signatureFileId:string;actor:string;now?:()=>string;store?:R2Bucket;built?:SignedDocResult}):Promise<{made:string[];state:'made'|'waiting'|'fallback'|'none'}>{
 const row=await loadMoldRequest(db,requestId),data=row?.data.signature as MoldSignatureData|undefined,plan=data?.document;
 if(!row||!store||!plan||moldSignatureOf(row.data)?.fileId!==signatureFileId)return {made:[],state:'none'};
 const id=moldSignedDocumentId(signatureFileId),files=await loadMoldDesignFiles(db,'request_id=?',[requestId]);
 if(files.some(file=>file.id===id))return {made:[],state:'none'};
 const parts=moldSignedDocumentFiles(plan.parts,files);
 if(!parts.complete)return {made:[],state:'waiting'};
 const category=documentCategory(plan.parts,files,plan.category),name=MOLD_SIGNED_DOCUMENT_NAME;
 let result=built;
 if(!result){
  const page=await store.get(plan.key),pageBytes=page?new Uint8Array(await page.arrayBuffer()):null;
  result=pageBytes?await buildSignedDocument({sources:signedDocSources(plan.parts,parts.found,store),page:pageBytes,at:new Date(plan.at),maxBytes:MOLD_DESIGN_MAX_BYTES}):{ok:false,reason:'damaged'};
 }
 if(result.ok&&!moldDesignFileCheck(name,result.bytes,category).ok)result={ok:false,reason:'too_large'};
 const pages=plan.parts.reduce((sum,part)=>sum+part.pages,0)+1;
 const skip=async(reason:string)=>{
  const at=now();
  const saved=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,deleted_at,outbox,next_attempt_at,last_error,version,category) SELECT ?,?,?,?,'pdf','application/pdf',0,'',NULL,?,?,NULL,NULL,?,1,? WHERE EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND json_extract(data,'$.signature.fileId')=?)`)
    .bind(id,requestId,row.memberId,name,at,at,JSON.stringify({code:MOLD_NOT_SIGNED,reason,http:0,at}),category,requestId,signatureFileId),
   db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_mold_design_files WHERE id=? AND created_at=? AND object_key IS NULL)`)
    .bind(crypto.randomUUID(),requestId,actor,'mold-design:signed-document-skipped',JSON.stringify({label:'لم يُنشأ الملف الموقّع الموحّد لطلب تصنيع قالب',customerName:row.data.customer.name,name,reason,pages,...(reason!=='too_many_files'?{fallback:'signed-copies'}:{})}),at,id,at),
  ]);
  return saved[0].meta.changes===1;
 };
 // Today's per-file signed copies instead (2026-11-10), from the block, of the PDFs the page listed; each takes a place of its own
 // original's category and is made only where one is left (makeSignedCopies says which got none).
 const fallback=async(reason:string)=>{
  if(!await skip(reason))return {made:[] as string[],state:'none' as const};
  const copies=await signedCopiesInstead(db,{requestId,signatureFileId,data,parts:plan.parts,found:parts.found,actor,now,store});
  return {made:copies,state:'fallback' as const};
 };
 if(!result.ok)return fallback(result.reason==='too_large'?'too_large':'mismatch');
 // A place of the category, every file counted (the CRM's live files and production's that the CRM does not hold), as for a copy:
 // production keeps no mark of a signed copy, so the signed file takes one of its category's places there (20 design, 10 quotation,
 // 10 PO). None left: the per-file copies instead, where their categories have room.
 const places=moldDesignCount(row,files,category),max=moldSignedCopyMax(category,await moldNov10Known(db));
 if(places.crm+places.production>=max)return fallback('too_many_files');
 const bytes=new Uint8Array(result.bytes),objectKey='mold-design/'+requestId+'/'+id+'/'+crypto.randomUUID(),at=now(),mutation=crypto.randomUUID();
 await store.put(objectKey,bytes,{httpMetadata:{contentType:'application/pdf'}});
 const saved=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,mutation_id,category)
   SELECT ?,?,?,?,'pdf','application/pdf',?,?,?,?,'send',?,1,?,? WHERE EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND cancelled_at IS NULL AND json_extract(data,'$.signature.fileId')=?) AND (${LIVE_FILES})<?`)
   .bind(id,requestId,row.memberId,name,bytes.length,await sha256Hex(bytes),objectKey,at,at,mutation,category,requestId,signatureFileId,requestId,category,max-places.production),
  db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_mold_design_files WHERE id=? AND mutation_id=?)`)
   .bind(crypto.randomUUID(),requestId,actor,'mold-design:signed-document',JSON.stringify({label:'الملف الموقّع لطلب تصنيع قالب (المستندات وصفحة التوقيع)',customerName:row.data.customer.name,name,pages:result.pages,size:bytes.length,documents:plan.parts.map(part=>part.name),...(category!=='design'?{category}:{})}),at,id,mutation),
 ]);
 if(saved[0].meta.changes===1)return {made:[id],state:'made'};
 await store.delete(objectKey).catch(()=>{});
 // Taken meanwhile: by the same document (another sender made it first) nothing more; else the category filled up: the copies instead.
 if(!(await loadMoldDesignFiles(db,'id=?',[id])).length)return fallback('too_many_files');
 return {made:[],state:'none'};
}
/** The per-file signed copies of the PDFs a signed document listed, made instead of it (its block; none without one). */
async function signedCopiesInstead(db:D1Database,{requestId,signatureFileId,data,parts,found,actor,now,store}:{requestId:string;signatureFileId:string;data:MoldSignatureData|undefined;parts:readonly SignedDocPart[];found:readonly (MoldDesignFileRow|null)[];actor:string;now:()=>string;store:R2Bucket}){
 const originals=found.filter((file,index):file is MoldDesignFileRow=>!!file&&parts[index]?.kind==='pdf'&&moldSignableFile(file));
 if(!data?.block?.key||!originals.length)return [] as string[];
 const copies=await makeSignedCopies(db,{requestId,signatureFileId,blockKey:data.block.key,originals,actor,now,store}).catch(error=>{console.error('Signed copies failed',error instanceof Error?error.name:'error');return {made:[],skipped:[]} as SignedCopies;});
 return copies.made.map(copy=>copy.id);
}
/**
 * Production refused the signed document after the CRM sent it (413: over its limit for one file; too_many_files: its category full
 * there): the per-file signed copies are made instead, while the request's signature is still the one that made it, and sent like any
 * file (the timetable takes them). The refused row stays as the record (said on the sheet: MoldSigningView.document fallback).
 */
export async function signedDocumentRefused(db:D1Database,requestId:string,documentId:string,{now=()=>new Date().toISOString(),store=env.FILES}:{now?:()=>string;store?:R2Bucket}={}){
 const row=await loadMoldRequest(db,requestId),data=row?.data.signature as MoldSignatureData|undefined,signature=row?moldSignatureOf(row.data):null;
 if(!row||!store||!data?.document||!signature||moldSignedDocumentId(signature.fileId)!==documentId)return [] as string[];
 const files=await loadMoldDesignFiles(db,'request_id=?',[requestId]),parts=moldSignedDocumentFiles(data.document.parts,files);
 const made=await signedCopiesInstead(db,{requestId,signatureFileId:signature.fileId,data,parts:data.document.parts,found:parts.found,actor:'النظام (رفض الإنتاج للملف الموقّع)',now,store});
 if(made.length)await db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),requestId,'النظام','mold-design:signed-document-skipped',JSON.stringify({label:'رفض الإنتاج الملف الموقّع الموحّد؛ أُنشئت نسخة موقّعة من كل PDF بدلًا منه',customerName:row.data.customer.name,name:MOLD_SIGNED_DOCUMENT_NAME,fallback:'signed-copies',copies:made.length}),now()).run();
 return made;
}
/** The signed copies an old signature named that never reached production (removed in the CRM alone, as an old signature's image is when
 *  a new signature replaces it, 2026-11-04); one production may hold stays an ordinary file. The statements to run with the edit (each
 *  gated on the edit's own mutation) and the object keys to remove once it is saved. */
export function dropOldCopies(db:D1Database,files:MoldDesignFileRow[],oldSignatureId:string,requestId:string,mutation:string,now:string){
 const old=files.filter(file=>!!moldSignedOutputOf(file.id,oldSignatureId)&&!file.deletedAt&&!file.sentAt&&!file.lastAttemptAt);
 return {keys:old.map(file=>file.objectKey).filter((key):key is string=>!!key),statements:old.map(file=>db.prepare(`UPDATE crm_mold_design_files SET deleted_at=?,outbox=NULL,next_attempt_at=NULL,object_key=NULL,version=version+1 WHERE id=? AND deleted_at IS NULL AND sent_at IS NULL AND last_attempt_at IS NULL AND EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND mutation_id=?)`).bind(now,file.id,requestId,mutation))};
}

/** What the public page shows of a request (the fields the device's signing summary shows: nothing internal, no CRM number, no
 *  representative, no production state) and its files, each through the token. */
export type SignLinkPage={key:string;expiresAt:string;now:string;
 summary:{customerName:string;erpCode:string;address:string;city:string;description:string;core:string;vibrators:number|null;model:string;halfBlock:string;moldWidth:number|null;gelbaSize:number|null;quantity:number|null;payment:'cash'|'deferred'|null;paymentTerms:MoldPaymentTerms|null;quoteNo:string;poNo:string};
 files:{id:string;name:string;kind:'pdf'|'image'|'other';category:'design'|'quote'|'po';size:number;href:string}[];
 /** The other files (named only, never served through the link: signLinkOtherFiles). */
 others:{name:string;category:'design'|'quote'|'po'}[]};
export const signFileHref=(token:string,fileId:string)=>'/sign/m/'+token+'/file/'+encodeURIComponent(fileId);
/** The page of an open link (null: refused, the same for every reason: over the address's count, a token of another shape, unknown,
 *  expired, signed, cancelled, sent). */
export async function loadSignLinkPage(db:D1Database,token:string,headers:Headers,now=Date.now()):Promise<SignLinkPage|null>{
 if(!await signLinkPermit(db,headers,now))return null;
 const found=await findBySignToken(db,token,now);
 if(!found||found.state!=='open')return null;
 const {row}=found,files=await loadMoldDesignFiles(db,'request_id=?',[row.id]),data=row.data,specs=data.specs;
 return {key:await moldSignKey(row,files),expiresAt:data.signatureLink!.expiresAt,now:new Date(now).toISOString(),
  summary:{customerName:data.customer.name,erpCode:typeof data.customer.erpCode==='string'?data.customer.erpCode:'',address:typeof data.customer.address==='string'?data.customer.address:'',city:typeof data.customer.city==='string'?data.customer.city:'',description:specs.description,core:specs.core,vibrators:specs.vibrators,model:specs.model,halfBlock:specs.halfBlock,
   moldWidth:specs.moldWidth,gelbaSize:specs.gelbaSize,quantity:specs.quantity,payment:data.payment==='cash'||data.payment==='deferred'?data.payment:null,paymentTerms:data.payment==='deferred'&&data.paymentTerms?data.paymentTerms:null,quoteNo:data.quoteNo||'',poNo:data.poNo||''},
  files:signLinkFiles(row,files,'open').map(file=>({id:file.id,name:file.name,kind:file.kind,category:moldFileCategory(file),size:file.size,href:signFileHref(token,file.id)})),
  others:signLinkOtherFiles(files).map(file=>({name:file.name,category:moldFileCategory(file)}))};
}

/** What the customer's signing answers (and its repeat answers again within the day): who signed and when, the signed copies to download
 *  through the token, the PDFs that got none (why), and whether the request went to production at once. */
export type SignLinkDone={ok:true;signer:string;signedAt:string;copies:{id:string;name:string;href:string}[];skipped:{name:string;reason:string}[];sent:boolean};
export class SignLinkRefusal extends Error{constructor(message:string,public status:number,public fields?:Record<string,string>){super(message);}}
/** The customer's signature from the link, checked as the device's is (moldSignatureCheck for the drawing, moldSignatureBlockCheck for the
 *  block, its moment the server's). */
export type SignInput={requestId:string;token:string;key:string;signer:unknown;png:unknown;block:unknown;blockAt:unknown;consent:true;
 /** The ONE signed document (2026-11-11): the signature page the page composed (a PNG as base64) and the documents it lists in their
  *  order (moldSignedDocumentParts); a page of the release before sends none, and its signature makes the per-file copies of before. */
 document?:{page:unknown;parts:unknown;category?:unknown}};
async function doneFor(db:D1Database,token:string,row:MoldRequestRow,sent:boolean):Promise<SignLinkDone>{
 const signature=moldSignatureOf(row.data)!,files=await loadMoldDesignFiles(db,'request_id=?',[row.id]);
 const named=files.filter(file=>!!moldSignedCopyOf(file.id,signature.fileId)),made=files.filter(file=>!!moldSignedOutputOf(file.id,signature.fileId));
 return {ok:true,signer:signature.signer,signedAt:signature.signedAt,sent,
  copies:made.filter(file=>!file.deletedAt&&!!file.objectKey).map(file=>({id:file.id,name:file.name,href:signFileHref(token,file.id)})),
  skipped:named.filter(file=>file.deletedAt&&!file.outbox&&file.lastError?.code===MOLD_NOT_SIGNED).map(file=>({name:files.find(original=>original.id===moldSignedCopyOf(file.id,signature.fileId))?.name||file.name,reason:file.lastError?.reason||'damaged'}))};
}
/**
 * The customer signs from the link: the token opens (signLinkOpen), the page's key is the request's now (else SIGN_LINK_CHANGED), the
 * fields and pictures are valid; then, in one batch guarded by the same conditions, the signature is stored exactly as the device stores
 * it (the PNG as one of the request's design files, data.signature with via 'link' and the link's hash), the wait for it and the link are
 * removed, the request becomes due, with a receipt (a repeat of the same body within the day answers the same) and an audit entry naming
 * the customer. Then every PDF the page showed gets its signed copy, and the request and its files are sent at once through the usual
 * send (its failures follow the timetable); the answer waits for that a little. A refusal says nothing of why a link does not open.
 */
export async function signFromLink(db:D1Database,input:SignInput,{store=env.FILES,send,now=()=>new Date().toISOString(),waitMs=15_000}:{store?:R2Bucket;send:(requestId:string,told:(outcome:{kind:string})=>void)=>Promise<unknown>;now?:()=>string;waitMs?:number}):Promise<SignLinkDone>{
 const at=now(),found=await findBySignToken(db,input.token,Date.parse(at));
 if(!found)throw new SignLinkRefusal(SIGN_LINK_GONE,404);
 // The same five fields as before for a body without the document (a page of the release before reads its receipt as it was).
 const body=await sha256Hex(JSON.stringify(input.document===undefined?[input.key,input.signer,input.png,input.block,input.blockAt]:[input.key,input.signer,input.png,input.block,input.blockAt,input.document])),receiptId='mold-sign-receipt:'+found.hash;
 if(found.state==='signed'){
  const saved=await db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receiptId).first<{detail:string}>();
  if(saved?.detail===body)return doneFor(db,input.token,found.row,!found.row.outbox);
  throw new SignLinkRefusal(SIGN_LINK_GONE,404);
 }
 const row=found.row,files=await loadMoldDesignFiles(db,'request_id=?',[row.id]);
 if(input.key!==await moldSignKey(row,files))throw new SignLinkRefusal(SIGN_LINK_CHANGED,409);
 const signer=moldSigner(input.signer),named=signer!==undefined&&[...signer].length>=MOLD_SIGNER_MIN&&[...signer].length<=MOLD_SIGNER_MAX;
 const png=moldSignatureBytes(input.png),checked=moldSignatureCheck(named?signer:'--',png);
 const blockBytes=moldSignatureBlockBytes(input.block),block=blockBytes?moldSignatureBlockCheck(blockBytes):null,blockAt=moldSignatureBlockAt(input.blockAt,Date.parse(at));
 // The signature page and the documents it lists (2026-11-11), when the page sent them.
 const pageBytes=input.document===undefined?null:moldSignaturePageBytes(input.document?.page),pageChecked=pageBytes?moldSignaturePageCheck(pageBytes):null,parts=input.document===undefined?null:moldSignedDocumentParts(input.document?.parts);
 const documentBad=input.document!==undefined&&(!pageChecked?.ok||!parts);
 const fields:Record<string,string>={...(named?{}:{signer:MOLD_SIGNER_REQUIRED}),...(!checked.ok&&checked.field==='signature'?{signature:checked.reason==='missing'?MOLD_SIGNATURE_REQUIRED:MOLD_SIGNATURE_BAD}:{}),
  ...(!block?.ok||documentBad?{signature:MOLD_SIGNATURE_BAD}:!blockAt?{signature:'وقت التوقيع غير صحيح؛ افتح الرابط مرة أخرى ووقّع.'}:{})};
 if(Object.keys(fields).length||!checked.ok||!png||!blockBytes||!block?.ok||!blockAt)throw new SignLinkRefusal([...new Set(Object.values(fields))].join(' • ')||MOLD_SIGNATURE_BAD,400,fields);
 // The signature's image takes one of the 10 design places, as on the device (moldDesignCount).
 const places=moldDesignCount(row,files,'design',{originals:true});
 if(places.crm+places.production+1>places.max)throw new SignLinkRefusal('الطلب غير جاهز للتوقيع الآن؛ تواصل مع المندوب.',409);
 if(!store)throw new SignLinkRefusal('التوقيع غير متاح الآن؛ أعد المحاولة بعد قليل.',503);
 // The signed document is built from what the page listed BEFORE the signature is saved: a document the page listed that is not among
 // the link's files as they are now, or whose pages pdf-lib counts otherwise, means the page did not show what the CRM holds: refused as
 // a change (opened again, the page lists it right). Too large for production, or failing otherwise: signed, with the per-file copies.
 let built:SignedDocResult|undefined;
 if(parts&&pageBytes&&pageChecked?.ok){
  const match=moldSignedDocumentFiles(parts,signLinkFiles(row,files,'open'));
  if(!match.complete)throw new SignLinkRefusal(SIGN_LINK_CHANGED,409);
  built=await buildSignedDocument({sources:signedDocSources(parts,match.found,store),page:pageBytes,at:new Date(blockAt),maxBytes:MOLD_DESIGN_MAX_BYTES});
  if(!built.ok&&built.reason==='mismatch')throw new SignLinkRefusal(SIGN_LINK_CHANGED,409);
 }
 const fileId='mds-'+crypto.randomUUID(),mutation=crypto.randomUUID(),pngBytes=new Uint8Array(png),blockCopy=new Uint8Array(blockBytes);
 const objectKey='mold-design/'+row.id+'/'+fileId+'/'+crypto.randomUUID(),blockKey='mold-sign-block/'+row.id+'/'+fileId+'/'+crypto.randomUUID();
 const pageKey=parts&&pageBytes&&pageChecked?.ok?'mold-sign-page/'+row.id+'/'+fileId+'/'+crypto.randomUUID():'',pageCopy=pageKey?new Uint8Array(pageBytes!):null;
 const seenCategory=moldSignedDocumentCategory(input.document?.category);
 const document=pageKey&&pageCopy&&pageChecked?.ok&&parts?{key:pageKey,sha256:await sha256Hex(pageCopy),width:pageChecked.width,height:pageChecked.height,at:blockAt,parts,...(seenCategory?{category:seenCategory}:{})}:null;
 const data:MoldRequestRow['data']={...row.data,signature:{signer:checked.signer,signedAt:at,fileId,via:'link',block:{key:blockKey,sha256:await sha256Hex(blockCopy),width:block.width,height:block.height,at:blockAt},link:{hash:found.hash,at},...(document?{document}:{})}};
 delete data.awaitsSignature;delete data.signatureLink;
 const dropAll=async()=>{for(const key of [objectKey,blockKey,pageKey])if(key)await store.delete(key).catch(()=>{});};
 await store.put(objectKey,pngBytes,{httpMetadata:{contentType:checked.contentType}});
 await store.put(blockKey,blockCopy,{httpMetadata:{contentType:'image/png'}});
 if(pageKey&&pageCopy)await store.put(pageKey,pageCopy,{httpMetadata:{contentType:'image/png'}});
 const gate='EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND mutation_id=?)',actor=checked.signer+' (العميل، من الرابط)';
 const result=await db.batch([
  db.prepare(`UPDATE crm_mold_requests SET data=?,next_attempt_at=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND cancelled_at IS NULL AND outbox IS 'send' AND json_extract(data,'$.awaitsSignature') IS 1 AND json_extract(data,'$.signatureLink.hash')=? AND json_extract(data,'$.signatureLink.expiresAt')>? AND (${MOLD_NEVER_SENT_SQL} OR json_type(remote,'$.returned')='object')`)
   .bind(JSON.stringify(data),at,at,mutation,row.id,row.version,found.hash,at),
  db.prepare(`INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,mutation_id,category) SELECT ?,?,?,?,'image',?,?,?,?,?,'send',?,1,?,'design' WHERE ${gate}`)
   .bind(fileId,row.id,row.memberId,checked.name,checked.contentType,pngBytes.length,await sha256Hex(pngBytes),objectKey,at,at,mutation,row.id,mutation),
  db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,row.id,actor,'mold-sign-receipt',body,at,row.id,mutation),
  db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`)
   .bind(crypto.randomUUID(),row.id,actor,'mold-request:sign',JSON.stringify({label:'توقيع العميل على طلب تصنيع قالب من الرابط',customerName:row.data.customer.name,via:'link',signature:{signer:checked.signer,fileId,size:pngBytes.length,stamped:true,...(document?{document:document.parts.length}:{})}}),at,row.id,mutation),
 ]).catch(async error=>{await dropAll();throw error;});
 if(result[0].meta.changes!==1){
  await dropAll();
  // Changed between the check and the save (an edit, a new link, a cancellation, or the same signature from another tab): said as a change
  // when the link still opens, else as any refusal.
  const again=await findBySignToken(db,input.token,Date.parse(now()));
  throw again?.state==='open'?new SignLinkRefusal(SIGN_LINK_CHANGED,409):new SignLinkRefusal(SIGN_LINK_GONE,404);
 }
 // The ONE signed document (2026-11-11), else (a page of the release before) the per-file copies of before.
 if(document)await makeSignedDocument(db,{requestId:row.id,signatureFileId:fileId,actor,now,store,built}).catch(error=>{console.error('Signed document failed',error instanceof Error?error.name:'error');});
 else await makeSignedCopies(db,{requestId:row.id,signatureFileId:fileId,blockKey,originals:signLinkFiles(row,files,'open').filter(moldSignableFile),actor,now,store}).catch(error=>{console.error('Signed copies failed',error instanceof Error?error.name:'error');});
 let told:{kind:string}|null=null,timer:ReturnType<typeof setTimeout>|undefined;
 await Promise.race([send(row.id,outcome=>{told=outcome;}).catch(()=>null),new Promise(resolve=>{timer=setTimeout(resolve,waitMs);})]);
 clearTimeout(timer);
 const saved=await loadMoldRequest(db,row.id);
 return doneFor(db,input.token,saved||row,(told as {kind:string}|null)?.kind==='ok'||!!saved&&!saved.outbox);
}

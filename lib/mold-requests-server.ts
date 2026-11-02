// Mold manufacturing requests on the server: saved in the CRM first, then signed and sent to production (contract version 1, §2), tried
// again on the §6 timetable while they wait, and their status pulled in one call when a list or a request is opened (§6: no retry for
// a pull; the last known status is shown with its time). Their design files (2026-11-02) go the same way once production holds the
// request: kept in the object store, sent with design-files, deleted with design-file-delete. Sending is off, never the rest of the CRM,
// while the settings are missing. Once sent, a request's data is edited by the production manager in the products application only
// (2026-11-02): the CRM's update is for a request that has certainly never reached production (MOLD_NEVER_SENT_SQL), and a change
// production still refuses as production_only is final (sendMoldRequest).
import {env} from 'cloudflare:workers';
import {database} from './crm-server';
import {regionScope} from './regions';
import {moldConfig,callProducts} from '@/portable/mold-client.mjs';
import {moldRequestBody,moldDesignFileBody,moldNextAttempt,moldPendingItem,moldStatusObject,moldAnswerNotStored,riyadhIso,MOLD_STATUS_BATCH,MOLD_PRODUCTION_ONLY} from '@/portable/mold-rules.mjs';
import {canApproveMoldRequests,moldNeverSent,moldPendingDesignFiles,moldRemoteOlder,type MoldDesignFile,type MoldDesignFileRow,type MoldError,type MoldPendingAnswer,type MoldPendingItem,type MoldRemote,type MoldRequestData,type MoldRequestRow} from './mold-requests';
import type {Member} from './crm';

type Config=ReturnType<typeof moldConfig>;
/** Read on every use, so a change of the private settings needs no rebuild; the secret stays in this module's caller only. */
export function productsLink():Config{return moldConfig({YR_PRODUCTS_API_URL:env.YR_PRODUCTS_API_URL,YR_PRODUCTS_SECRET:env.YR_PRODUCTS_SECRET});}

const columns=`id,member_id AS memberId,customer_id AS customerId,legacy_order_no AS legacyOrderNo,data,accepted,cancelled_at AS cancelledAt,cancel_reason AS cancelReason,outbox,attempts,
 first_failed_at AS firstFailedAt,next_attempt_at AS nextAttemptAt,last_attempt_at AS lastAttemptAt,last_error AS lastError,remote,remote_at AS remoteAt,created_by AS createdBy,created_at AS createdAt,updated_at AS updatedAt,version`;
type Stored=Omit<MoldRequestRow,'data'|'accepted'|'lastError'|'remote'>&{data:string;accepted:string|null;lastError:string|null;remote:string|null};
const parse=<T,>(text:string|null):T|null=>{if(!text)return null;try{return JSON.parse(text) as T;}catch{return null;}};
const decode=(row:Stored):MoldRequestRow=>({...row,data:parse<MoldRequestData>(row.data)!,accepted:parse<MoldRequestData>(row.accepted),lastError:parse<MoldError>(row.lastError),remote:parse<MoldRemote>(row.remote)});

export async function loadMoldRequests(db:D1Database,where='1=1',args:(string|number)[]=[]){
 return (await db.prepare(`SELECT ${columns} FROM crm_mold_requests WHERE ${where} ORDER BY created_at DESC,id DESC`).bind(...args).all<Stored>()).results.map(decode);
}
export async function loadMoldRequest(db:D1Database,id:string){return (await loadMoldRequests(db,'id=?',[id]))[0]||null;}

/** The contract body of a request (§2). */
export const requestBody=(row:Pick<MoldRequestRow,'id'|'legacyOrderNo'|'data'>)=>moldRequestBody({id:row.id,legacyOrderNo:row.legacyOrderNo,requestedAt:row.data.requestedAt,customer:row.data.customer,salesman:row.data.salesman,specs:row.data.specs});
export const requestedNow=(now:string)=>riyadhIso(now);

export type SendOutcome={kind:'ok'|'locked'|'not_found'|'rejected'|'retry'|'off'|'busy'|'none';code:string;fields?:string[];reason?:string};
/** moldNeverSent (portable/mold-rules.mjs) in SQL, over crm_mold_requests: never accepted, no status from production, and either never
 *  attempted or every attempt refused before production stored it (the last error says so, and no attempt started after it). The
 *  update's guard, so a send claimed between the check and the save keeps the request as it is. */
export const MOLD_NEVER_SENT_SQL="(accepted IS NULL AND remote IS NULL AND (last_attempt_at IS NULL OR json_extract(last_error,'$.notStored') IS 1 AND json_extract(last_error,'$.at')>=last_attempt_at))";
/**
 * One send of what a request has waiting (a new request, a change made before its first arrival, or a cancellation) once its time has
 * come (a save, a resend or the timetable sets next_attempt_at). The attempt is claimed with a one-minute lease first, so two processes,
 * or the timer and a button, never send it twice at once; a change saved meanwhile wins over the answer. A failure records whether this
 * attempt and every one before it were refused before production stored the request (notStored: it may still be edited).
 *
 * 409 production_only (production holds the request with other data, which its production manager alone edits; for example a change
 * saved before 2026-11-02 while an earlier attempt had in fact arrived) is final: never tried again, production's status from the
 * answer is stored, the error keeps the reason so the request shows it, and the data goes back to what production last accepted from
 * the CRM when the CRM knows it. When it does not (the earlier attempt's answer was lost), the data stays the CRM's copy and the request
 * says plainly that production's may differ; accepted then only marks that production holds the request (its status is pulled, its
 * design files go), never that the data is production's.
 */
export async function sendMoldRequest(db:D1Database,id:string,{link=productsLink(),now=()=>new Date().toISOString(),fetch}:{link?:Config;now?:()=>string;fetch?:typeof globalThis.fetch}={}):Promise<SendOutcome>{
 if(!link.ok)return {kind:'off',code:link.reason};
 const row=await loadMoldRequest(db,id);
 if(!row||!row.outbox)return {kind:'none',code:''};
 const at=now(),claim=crypto.randomUUID(),lease=new Date(Date.parse(at)+60_000).toISOString();
 const claimed=await db.prepare('UPDATE crm_mold_requests SET mutation_id=?,last_attempt_at=?,next_attempt_at=? WHERE id=? AND version=? AND outbox=? AND next_attempt_at IS NOT NULL AND next_attempt_at<=?').bind(claim,at,lease,id,row.version,row.outbox,at).run();
 if(claimed.meta.changes!==1)return {kind:'busy',code:''};
 const options=fetch?{fetch}:{};
 const answer=row.outbox==='cancel'
  ?await callProducts(link,'cancel',{crmRequestId:row.id,reason:row.cancelReason},options)
  :await callProducts(link,'requests',requestBody(row),options);
 // This attempt and every one before it were refused before production stored the request: it may still be edited (moldNeverSent).
 const notStored=moldAnswerNotStored(answer)&&moldNeverSent(row)?{notStored:true}:{};
 const done=now(),remote=answer.kind==='ok'?moldStatusObject(answer.json?.request):answer.kind==='locked'?answer.request:null,[remoteSet,remoteArgs]=newerRemote(remote,done);
 const settle=(sql:string,...args:(string|number|null)[])=>db.prepare(`UPDATE crm_mold_requests SET ${sql},updated_at=? WHERE id=? AND mutation_id=?`).bind(...args,done,id,claim).run();
 const cleared="outbox=NULL,attempts=0,first_failed_at=NULL,next_attempt_at=NULL";
 if(answer.kind==='ok'){
  if(row.outbox==='send')await settle(`${cleared},last_error=NULL,accepted=?,${remoteSet}`,JSON.stringify(row.data),...remoteArgs);
  else await settle(`${cleared},last_error=NULL,${remoteSet}`,...remoteArgs);
 }else if(answer.kind==='not_found'&&row.outbox==='cancel'){
  // Production never had it (a send that did not get through): the cancellation is complete in the CRM.
  await settle(`${cleared},last_error=NULL`);
 }else if(answer.kind==='locked'){
  // Production started first: the change is withdrawn and the request shows what production holds.
  const error=JSON.stringify({code:'request_locked',http:409,at:done});
  if(row.outbox==='cancel')await settle(`${cleared},cancelled_at=NULL,cancel_reason='',last_error=?,${remoteSet},version=version+1`,error,...remoteArgs);
  else if(answer.reason===MOLD_PRODUCTION_ONLY&&remote){
   // The production manager alone edits it now: final, with the reason; production holds it (accepted), whatever data it holds.
   const refused=JSON.stringify({code:'request_locked',reason:MOLD_PRODUCTION_ONLY,http:409,at:done});
   await settle(`${cleared},data=COALESCE(accepted,data),accepted=COALESCE(accepted,data),last_error=?,${remoteSet},version=version+1`,refused,...remoteArgs);
  }else await settle(`${cleared},data=COALESCE(accepted,data),last_error=?,${remoteSet},version=version+1`,error,...remoteArgs);
 }else if(answer.kind==='rejected'){
  // The data must change first; a retry alone cannot help, so the timetable stops until the representative edits (allowed while it
  // has never reached production), resends or cancels.
  await settle('attempts=attempts+1,next_attempt_at=NULL,last_error=?',JSON.stringify({code:answer.code,fields:answer.fields,http:answer.http||0,at:done,...notStored}));
 }else{
  const failures=row.attempts+1,first=row.firstFailedAt||done;
  await settle('attempts=?,first_failed_at=?,next_attempt_at=?,last_error=?',failures,first,moldNextAttempt(failures,first,done),JSON.stringify({code:answer.code,http:answer.http||0,at:done,...notStored}));
 }
 return {kind:answer.kind==='not_found'&&row.outbox==='cancel'?'ok':answer.kind,code:answer.code,fields:answer.fields,...(answer.reason?{reason:answer.reason}:{})};
}

/** The requests whose next try has come, oldest first; a few per run so a page or the timer never waits long. Then the design files
 * whose turn has come (sendDueMoldDesignFiles). */
export async function sendDueMoldRequests(db:D1Database,{limit=5,now=()=>new Date().toISOString(),link=productsLink(),fetch,files}:{limit?:number;now?:()=>string;link?:Config;fetch?:typeof globalThis.fetch;files?:R2Bucket}={}){
 if(!link.ok)return 0;
 const due=(await db.prepare('SELECT id FROM crm_mold_requests WHERE outbox IS NOT NULL AND next_attempt_at IS NOT NULL AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT ?').bind(now(),limit).all<{id:string}>()).results;
 let sent=0;
 for(const {id} of due){const outcome=await sendMoldRequest(db,id,{link,now,fetch});if(outcome.kind==='ok')sent++;}
 return sent+await sendDueMoldDesignFiles(db,{now,link,fetch,...(files?{files}:{})});
}

/**
 * The SET of an UPDATE that stores production's answer about a request with its time, unless the status stored is newer (a higher
 * revision; one without a revision is always taken): answers can cross (a pull, an approval and a design file's answer at once), and an
 * older one must not bring back approvals production has since undone (moldRemoteOlder says the same in TypeScript). Every write of
 * `remote` goes through it. An answer without a status keeps the stored one, with the time production answered.
 */
export function newerRemote(remote:MoldRemote|null,at:string):[string,(string|number)[]]{
 if(!remote)return ['remote_at=?',[at]];
 const older="json_extract(remote,'$.revision')>?",revision=remote.revision??Number.MAX_SAFE_INTEGER;
 return [`remote=CASE WHEN ${older} THEN remote ELSE ? END,remote_at=CASE WHEN ${older} THEN remote_at ELSE ? END`,[revision,JSON.stringify(remote),revision,at]];
}
/** Production's answer about a request, stored unless a newer one (a higher revision) is there already. */
export async function storeMoldRemote(db:D1Database,id:string,remote:MoldRemote,at:string){
 const [set,args]=newerRemote(remote,at);
 await db.prepare(`UPDATE crm_mold_requests SET ${set} WHERE id=?`).bind(...args,id).run();
}

// ---- design files (the contract's addition of 2026-11-02)
const fileColumns=`id,request_id AS requestId,member_id AS memberId,name,kind,content_type AS contentType,size,sha256,object_key AS objectKey,created_at AS createdAt,deleted_at AS deletedAt,outbox,attempts,
 first_failed_at AS firstFailedAt,next_attempt_at AS nextAttemptAt,last_attempt_at AS lastAttemptAt,last_error AS lastError,remote_file_id AS remoteFileId,sent_at AS sentAt,version`;
type StoredFile=Omit<MoldDesignFileRow,'lastError'|'remoteFileId'>&{lastError:string|null;remoteFileId:string|null};
/** The CRM's design files (those deleted too: a deleted file still hides production's stale listing of it), oldest first. */
export async function loadMoldDesignFiles(db:D1Database,where='1=1',args:(string|number)[]=[]):Promise<MoldDesignFileRow[]>{
 return (await db.prepare(`SELECT ${fileColumns} FROM crm_mold_design_files WHERE ${where} ORDER BY created_at,id`).bind(...args).all<StoredFile>()).results.map(row=>({...row,lastError:parse<MoldError>(row.lastError),remoteFileId:parse<string|number>(row.remoteFileId)}));
}
/** Each request's files, for a list of requests (one query, grouped by request; at most ten live files a request keep it small). */
export async function moldDesignFilesByRequest(db:D1Database,ids:string[]){
 const byRequest=new Map<string,MoldDesignFileRow[]>();
 if(!ids.length)return byRequest;
 const wanted=new Set(ids),rows=ids.length===1?await loadMoldDesignFiles(db,'request_id=?',[ids[0]]):await loadMoldDesignFiles(db);
 for(const row of rows)if(wanted.has(row.requestId))byRequest.set(row.requestId,[...(byRequest.get(row.requestId)||[]),row]);
 return byRequest;
}
/** A design file goes through the timetable with a lease longer than its 120-second call; at most two files travel at once in this
 * process (each holds up to 25 MiB twice in memory), the others wait for the next check. */
const DESIGN_LEASE_MS=3*60_000,DESIGN_SENDS=2;
let filesInFlight=0;
/** A send or a deletion claimed and still within its lease (the claim sets both times from one instant, a lease apart): its answer may
 *  not have come yet. A file merely waiting for its next try is not. */
export const moldDesignClaimed=(file:Pick<MoldDesignFileRow,'outbox'|'nextAttemptAt'|'lastAttemptAt'>,now:string)=>!!file.outbox&&!!file.nextAttemptAt&&!!file.lastAttemptAt&&file.nextAttemptAt>now&&Date.parse(file.nextAttemptAt)-Date.parse(file.lastAttemptAt)===DESIGN_LEASE_MS;
/** moldDesignRefused (lib/mold-requests.ts) in SQL, over crm_mold_design_files: refused for good, never reached production. Never NULL
 *  (IS, not =), so NOT of it holds for a file with nothing waiting. */
export const MOLD_DESIGN_REFUSED_SQL="(outbox IS 'send' AND sent_at IS NULL AND next_attempt_at IS NULL AND json_extract(last_error,'$.final') IS 1)";
/** moldDesignStopped in SQL: a sending, or a deletion, that stopped after 24 hours of failures; the requester's resend starts it again. */
export const MOLD_DESIGN_STOPPED_SQL="((outbox IS 'delete' OR outbox IS 'send' AND deleted_at IS NULL) AND next_attempt_at IS NULL AND json_extract(last_error,'$.final') IS NOT 1)";
export type DesignOutcome=SendOutcome&{reason?:string};
/**
 * One send of what a design file has waiting: the file itself (only once production holds its request, never for a cancelled one), or its
 * deletion. Claimed with a lease first, like a request; a deletion asked for meanwhile wins over the answer. Each answer's request (its
 * approvals undone) is stored. Final answers stop the timetable, marked final whatever their code (a 400 or 413 from a web server in
 * front of production has no contract code): 400 and 413 (refused, with the reason) and 409 (the approvals were complete first: the file
 * is not sent). A 404, whatever its body (the contract's not_found, or the 404 of an application or web server that does not know the
 * route yet), is production's «not here»: a deletion is then complete; a file is not tried again by itself (the contract), the reason is
 * shown, and the requester's resend tries it again (production updated meanwhile, say), since nothing in the file has to change.
 * A deletion production refuses (409, or 400/413) leaves the file as production holds it, with the reason: sent when production lists
 * it (or it was sent); a file whose send never got its answer and that production's 409 does not list is not there, so the deletion is
 * complete; one production may or may not hold (no listing) stays not sent. Anything else is tried again on the §6 timetable; after 24
 * hours it stops, and the requester's resend starts it again (a deletion too).
 */
export async function sendMoldDesignFile(db:D1Database,id:string,{link=productsLink(),now=()=>new Date().toISOString(),fetch,files=env.FILES}:{link?:Config;now?:()=>string;fetch?:typeof globalThis.fetch;files?:R2Bucket}={}):Promise<DesignOutcome>{
 if(!link.ok)return {kind:'off',code:link.reason};
 const file=(await loadMoldDesignFiles(db,'id=?',[id]))[0];
 if(!file||!file.outbox)return {kind:'none',code:''};
 const row=await loadMoldRequest(db,file.requestId);
 if(!row||file.outbox==='send'&&(!row.accepted||row.cancelledAt))return {kind:'none',code:'held'};
 if(filesInFlight>=DESIGN_SENDS)return {kind:'busy',code:''};
 filesInFlight++;
 try{
  const at=now(),claim=crypto.randomUUID(),lease=new Date(Date.parse(at)+DESIGN_LEASE_MS).toISOString();
  const claimed=await db.prepare('UPDATE crm_mold_design_files SET mutation_id=?,last_attempt_at=?,next_attempt_at=? WHERE id=? AND version=? AND outbox=? AND next_attempt_at IS NOT NULL AND next_attempt_at<=?').bind(claim,at,lease,id,file.version,file.outbox,at).run();
  if(claimed.meta.changes!==1)return {kind:'busy',code:''};
  const settle=(sql:string,...args:(string|number|null)[])=>db.prepare(`UPDATE crm_mold_design_files SET ${sql} WHERE id=? AND mutation_id=?`).bind(...args,id,claim).run();
  const refuse=async(error:Omit<MoldError,'final'>)=>{await settle('attempts=attempts+1,next_attempt_at=NULL,last_error=?',JSON.stringify({...error,final:true}));};
  const options=fetch?{fetch}:{};
  let answer;
  if(file.outbox==='send'){
   const object=file.objectKey&&files?await files.get(file.objectKey):null,bytes=object?new Uint8Array(await object.arrayBuffer()):null;
   if(!bytes||bytes.length!==file.size){await refuse({code:'file_missing',http:0,at:now()});return {kind:'rejected',code:'file_missing'};}
   let body;
   try{body=moldDesignFileBody({crmRequestId:row.id,crmFileId:file.id,name:file.name},bytes);}catch(error){await refuse({code:'invalid_payload',fields:[String((error as Error).message)],http:0,at:now()});return {kind:'rejected',code:'invalid_payload'};}
   answer=await callProducts(link,'design-files',body,options);
  }else answer=await callProducts(link,'design-file-delete',{crmRequestId:row.id,crmFileId:file.id},options);
  const done=now(),remote=answer.kind==='ok'?moldStatusObject(answer.json?.request):answer.kind==='locked'?answer.request:null;
  if(remote){await storeMoldRemote(db,row.id,remote,done);forgetPendingApprovals();}
  const cleared='outbox=NULL,attempts=0,first_failed_at=NULL,next_attempt_at=NULL,last_error=NULL';
  const missing=answer.kind==='not_found'||answer.http===404;
  // Whether production holds the file, from the status a 409 carries: its entry, null when the listing leaves it out, undefined when
  // there is no listing (an older application).
  const listed=answer.kind==='locked'&&Array.isArray(remote?.designFiles)?remote.designFiles.find((entry:MoldDesignFile)=>entry.crmFileId===file.id)??null:undefined;
  const gone=file.outbox==='delete'&&(answer.kind==='ok'||missing||answer.kind==='locked'&&listed===null);
  if(gone){
   // Deleted at production, or never there: the bytes leave the CRM too (the row stays, without them, as the record).
   const settled=await settle(`${cleared},object_key=NULL`);
   if(settled.meta.changes===1&&file.objectKey&&files)await files.delete(file.objectKey).catch(()=>{});
  }else if(answer.kind==='ok'){
   await settle(`${cleared},remote_file_id=?,sent_at=?`,JSON.stringify(answer.json?.file?.fileId??null),done);
  }else if(file.outbox==='delete'&&(answer.kind==='locked'||answer.kind==='rejected')){
   // The approvals were complete first, or production refused the deletion for good: the file stays as production holds it, with the
   // reason (and may be deleted again while the request is editable): sent when production holds it; else not sent, and it never will be.
   const error=JSON.stringify({code:answer.kind==='locked'?'request_locked':answer.code,...(answer.reason?{reason:answer.reason}:{}),http:answer.http||0,at:done,final:true});
   if(file.sentAt||listed)await settle("outbox=NULL,attempts=0,first_failed_at=NULL,next_attempt_at=NULL,deleted_at=NULL,version=version+1,sent_at=COALESCE(sent_at,?),remote_file_id=COALESCE(remote_file_id,?),last_error=?",done,listed?JSON.stringify(listed.fileId):null,error);
   else await settle("outbox='send',attempts=attempts+1,first_failed_at=NULL,next_attempt_at=NULL,deleted_at=NULL,version=version+1,last_error=?",error);
  }else if(missing){
   // Production does not hold the request (or does not know the route yet): stopped, with the reason; the requester's resend tries again.
   await settle('attempts=attempts+1,next_attempt_at=NULL,last_error=?',JSON.stringify({code:answer.code||'not_found',http:404,at:done}));
  }else if(answer.kind==='locked'||answer.kind==='rejected'){
   await refuse({code:answer.kind==='locked'?'request_locked':answer.code,...(answer.reason?{reason:answer.reason}:{}),...(answer.fields.length?{fields:answer.fields}:{}),http:answer.http||0,at:done});
  }else{
   const failures=file.attempts+1,first=file.firstFailedAt||done;
   await settle('attempts=?,first_failed_at=?,next_attempt_at=?,last_error=?',failures,first,moldNextAttempt(failures,first,done),JSON.stringify({code:answer.code,http:answer.http||0,at:done}));
  }
  return {kind:gone?'ok':missing?'not_found':answer.kind,code:answer.code,fields:answer.fields,...(answer.reason?{reason:answer.reason}:{})};
 }finally{filesInFlight--;}
}
/** The design files whose turn has come, oldest first: deletions, and files whose request production holds (not cancelled). A file
 * waiting for its request is left until the request is accepted. */
export async function sendDueMoldDesignFiles(db:D1Database,{limit=2,now=()=>new Date().toISOString(),link=productsLink(),fetch,files}:{limit?:number;now?:()=>string;link?:Config;fetch?:typeof globalThis.fetch;files?:R2Bucket}={}){
 if(!link.ok||filesInFlight>=DESIGN_SENDS)return 0;
 const due=(await db.prepare(`SELECT f.id FROM crm_mold_design_files f JOIN crm_mold_requests r ON r.id=f.request_id WHERE f.outbox IS NOT NULL AND f.next_attempt_at IS NOT NULL AND f.next_attempt_at<=?
  AND (f.outbox='delete' OR (r.accepted IS NOT NULL AND r.cancelled_at IS NULL)) ORDER BY f.next_attempt_at,f.id LIMIT ?`).bind(now(),limit).all<{id:string}>()).results;
 let sent=0;
 for(const {id} of due){const outcome=await sendMoldDesignFile(db,id,{link,now,fetch,...(files?{files}:{})});if(outcome.kind==='ok')sent++;}
 return sent;
}

/**
 * While the server runs, requests (and their design files) waiting to be sent are tried on the §6 timetable: a check every minute, and
 * one right away when the timer starts, so a request that waited through a restart goes as soon as the server is used again. Started by
 * the first page any member loads (lib/mold-customers-hook.ts) and by the mold requests page; never twice in one process. The claims in
 * sendMoldRequest and sendMoldDesignFile keep two checks from sending the same request or file.
 */
export function keepMoldRetrying(){
 const holder=globalThis as typeof globalThis&{__yourrestMoldRetry?:ReturnType<typeof setInterval>};
 if(holder.__yourrestMoldRetry)return;
 const check=()=>{void sendDueMoldRequests(database()).catch(()=>{});};
 holder.__yourrestMoldRetry=setInterval(check,60_000);
 holder.__yourrestMoldRetry.unref?.();
 check();
}

/** A pull younger than this is shown as it is; a failed pull waits this long before the next one, so an unreachable production
 * does not hold every page for 10 seconds. */
export const MOLD_STATUS_TTL_MS=60_000;
let lastPullFailure:MoldError|null=null;
/**
 * The status of the given requests in one call (up to 200 per call, §2), for those production knows and whose last pull is older than
 * the TTL. Answers the reason the pull failed, if it did; the stored status stays as the last one known.
 */
export async function pullMoldStatuses(db:D1Database,rows:MoldRequestRow[],{link=productsLink(),now=()=>new Date().toISOString(),fetch,force=false}:{link?:Config;now?:()=>string;fetch?:typeof globalThis.fetch;force?:boolean}={}):Promise<MoldError|null>{
 if(!link.ok)return null;
 const at=now(),stale=rows.filter(row=>row.accepted&&(force||!row.remoteAt||Date.parse(at)-Date.parse(row.remoteAt)>=MOLD_STATUS_TTL_MS));
 if(!stale.length)return null;
 if(!force&&lastPullFailure&&Date.parse(at)-Date.parse(lastPullFailure.at)<MOLD_STATUS_TTL_MS/2)return lastPullFailure;
 const options=fetch?{fetch}:{};
 for(let start=0;start<stale.length;start+=MOLD_STATUS_BATCH){
  const ids=stale.slice(start,start+MOLD_STATUS_BATCH).map(row=>row.id);
  const answer=await callProducts(link,'status',{ids},options);
  if(answer.kind!=='ok'){lastPullFailure={code:answer.code,http:answer.http||0,at};return lastPullFailure;}
  const received=now(),statements=[];
  for(const item of answer.json!.requests){const status=moldStatusObject(item);if(status&&ids.includes(status.crmRequestId)){const [set,args]=newerRemote(status,received);statements.push(db.prepare(`UPDATE crm_mold_requests SET ${set} WHERE id=?`).bind(...args,status.crmRequestId));}}
  if(statements.length)await db.batch(statements);
  // The page shows what was stored: an older answer (a file's answer landed meanwhile) leaves the newer status as it was.
  for(const row of stale.slice(start,start+MOLD_STATUS_BATCH)){const fresh=(answer.json!.requests as unknown[]).map(item=>moldStatusObject(item)).find(item=>item?.crmRequestId===row.id);if(fresh&&!moldRemoteOlder(row.remote,fresh)){row.remote=fresh;row.remoteAt=received;}}
 }
 lastPullFailure=null;
 return null;
}

/** The requests waiting for the sales manager (production's pending route, every request, the CRM's and those registered in
 * production), kept a minute so a busy page or several managers do not ask production for each one; a failed call waits half that
 * long before the next. A change of approval (an approval, or a design file attached or deleted) empties it, and since production has
 * just answered, forgets a failure too. */
let pendingCache:{at:string;items:MoldPendingItem[]}|null=null,pendingFailure:MoldError|null=null;
export function forgetPendingApprovals(){pendingCache=null;pendingFailure=null;}
type PendingReader={me:Member;db:D1Database;regionCustomerIds:Set<string>};
/** The sales manager's «طلبات بانتظار اعتمادي»: every request production holds at the sales step (the CRM's and those registered in
 * production), within the manager's regions when they do not cover all (by the customer's Yourrest number), each with its design files
 * downloaded through the CRM; null for anyone else. */
export async function moldPendingFor(c:PendingReader,link:Config,{force=false}:{force?:boolean}={}):Promise<MoldPendingAnswer|null>{
 if(!canApproveMoldRequests(c.me))return null;
 const pulled=await pullPendingApprovals({link,force});
 const own=new Set((await c.db.prepare('SELECT id FROM crm_mold_requests').all<{id:string}>()).results.map(row=>row.id));
 let inRegion:(number:number|null)=>boolean=()=>true;
 if(regionScope(c.me)!=='all'){
  const byNumber=new Map((await c.db.prepare('SELECT customer_id AS id,number FROM crm_customer_numbers').all<{id:string;number:number}>()).results.map(row=>[row.number,row.id]));
  inRegion=number=>number!==null&&c.regionCustomerIds.has(byNumber.get(number)||'');
 }
 return {items:pulled.items.filter(item=>inRegion(item.customer.crmNumber)).map(item=>({...item,inCrm:!!item.crmRequestId&&own.has(item.crmRequestId),designFiles:moldPendingDesignFiles(item)})),error:pulled.error,at:pulled.at};
}
export async function pullPendingApprovals({link=productsLink(),now=()=>new Date().toISOString(),fetch,force=false}:{link?:Config;now?:()=>string;fetch?:typeof globalThis.fetch;force?:boolean}={}):Promise<{items:MoldPendingItem[];error:MoldError|null;at:string|null}>{
 if(!link.ok)return {items:[],error:{code:link.reason,at:now()},at:null};
 const at=now();
 if(!force&&pendingCache&&Date.parse(at)-Date.parse(pendingCache.at)<MOLD_STATUS_TTL_MS)return {items:pendingCache.items,error:null,at:pendingCache.at};
 if(!force&&pendingFailure&&Date.parse(at)-Date.parse(pendingFailure.at)<MOLD_STATUS_TTL_MS/2)return {items:pendingCache?.items||[],error:pendingFailure,at:pendingCache?.at||null};
 const answer=await callProducts(link,'pending',{},fetch?{fetch}:{});
 if(answer.kind!=='ok'){pendingFailure={code:answer.code,http:answer.http||0,at};return {items:pendingCache?.items||[],error:pendingFailure,at:pendingCache?.at||null};}
 const items=(answer.json!.requests as unknown[]).map(item=>moldPendingItem(item)).filter((item):item is MoldPendingItem=>!!item);
 pendingCache={at,items};pendingFailure=null;
 return {items,error:null,at};
}

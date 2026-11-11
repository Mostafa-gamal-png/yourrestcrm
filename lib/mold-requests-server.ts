// Mold manufacturing requests on the server: saved in the CRM first, then signed and sent to production (contract version 1, §2), tried
// again on the §6 timetable while they wait, and their status pulled in one call when a list or a request is opened (§6: no retry for
// a pull; the last known status is shown with its time). Their design files (2026-11-02) go the same way once production holds the
// request: kept in the object store, sent with design-files, deleted with design-file-delete. Sending is off, never the rest of the CRM,
// while the settings are missing. Once sent, a request's data is edited by the production manager in the products application only
// (2026-11-02): the CRM's update is for a request that has certainly never reached production (MOLD_NEVER_SENT_SQL), and a change
// production still refuses as production_only is final (sendMoldRequest). Since 2026-11-03 the production manager may restore a cancelled
// request: its status keeps being pulled, and a status that is no longer cancelled makes it active again here (moldRemoteStatements).
// Production's second update of 2026-11-03 (the quotation and PO numbers and their files) is learned from the first answer whose status
// object carries quoteOrPoMissing, kept in crm_settings (moldQuotePoSupported); until then no number, category or quotation/PO file is
// sent, and a request or file that carries one waits for it. Since production's update of 2026-11-05, a new request asked for once that is
// known (data.fileRequired) is not sent while it has no quotation or PO file in the CRM (MOLD_AWAITS_FILE_SQL: nothing sends it, neither
// the timetable, a resend nor a restart); the first one attached releases it (releaseMoldRequest): the request, then its files. Since
// 2026-11-08 every new request (data.designRequired) is kept the same way while it has no design file of its own (the customer's
// signature does not count): MOLD_AWAITS_FILE_SQL holds either reason, and the first file of the missing kind releases it the same way.
// A request for a customer not in the CRM (2026-11-09: customer.crmNumber null with its ERP code) is sent only once the CRM has learned
// that production's application takes one (moldFreeCustomersSupported, from any answer whose customer carries erpCode): today's
// application reads crmNumber as optional and would store the request without its ERP code, silently. Until then, and should production
// still refuse it for its missing Yourrest number, it waits in the CRM (error free_customer, never final), tried again every 6 hours, on
// its requester's resend, and at once when the update is learned.
// A request whose requester chose to send the customer a link to sign from (2026-11-10: data.awaitsSignature) is kept the same way as one
// waiting for a file, until the customer signs (MOLD_HELD_FOR_SQL 'customer_signature', after the files' reasons); the signing (from the
// link, or on the device from the request's sheet) sends it at once (lib/mold-sign-server.ts).
import {env} from 'cloudflare:workers';
import {database} from './crm-server';
import {regionScope} from './regions';
import {moldConfig,callProducts} from '@/portable/mold-client.mjs';
import {moldRequestBody,moldDesignFileBody,moldNextAttempt,moldPaymentTerms,moldPendingItem,moldStatusObject,moldAnswerNotStored,moldQuotePoAnswered,moldFreeCustomersAnswered,moldSignedFlagAnswered,riyadhIso,MOLD_STATUS_BATCH,MOLD_PRODUCTION_ONLY} from '@/portable/mold-rules.mjs';
import {canApproveMoldRequests,canReadMoldRequest,moldApprovesRequest,moldFileCategory,moldFreeCustomer,moldHeldFor,MOLD_FREE_CUSTOMER,moldHasQuotePo,moldListedFiles,moldNeverSent,moldPendingFiles,moldRemoteOlder,moldSignatureOf,moldSignedOutputOf,type MoldDesignFile,type MoldDesignFileRow,type MoldError,type MoldPendingAnswer,type MoldPendingItem,type MoldRemote,type MoldRequestData,type MoldRequestRow} from './mold-requests';
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

/** The contract body of a request (§2), with its payment, and its quotation and PO numbers, when it has them: a request stored without
 *  them is sent again byte for byte as first sent (production compares a resend with its original; a field added would be other data,
 *  409 production_only). Always the request's own data, never the numbers a status object carries (production's current values). Built
 *  from these fields alone: the customer's signature (data.signature, 2026-11-04) goes as a design file, never in this body. */
/** Since 2026-11-10 a deferred request's terms (paymentTerms) go right after its payment, only when this request's sends carry them
 *  (data.termsSent, decided at its first send once the products update of 2026-11-10 is known: moldNov10Known): a request first sent
 *  without them is sent again without them, byte for byte (production compares a resend with its original). */
export const requestBody=(row:Pick<MoldRequestRow,'id'|'legacyOrderNo'|'data'>,withTerms=row.data.termsSent===true)=>moldRequestBody({id:row.id,legacyOrderNo:row.legacyOrderNo,requestedAt:row.data.requestedAt,customer:row.data.customer,salesman:row.data.salesman,specs:row.data.specs,payment:row.data.payment,paymentTerms:withTerms&&row.data.payment==='deferred'?row.data.paymentTerms:undefined,quoteNo:row.data.quoteNo,poNo:row.data.poNo});

/** Where the CRM keeps that production's update of 2026-11-03 (the quotation and PO) is live: a row of crm_settings, the existing
 *  key-value table (its owner_id holds when it was learned). Written once, never removed by the CRM, so a restart keeps it. */
export const MOLD_QUOTE_PO_SETTING='mold-quote-po';
/** Whether production's update of 2026-11-03 is known to be live (read on each use: another process may have learned it). */
export async function moldQuotePoSupported(db:D1Database){
 return !!(await db.prepare('SELECT 1 AS known FROM crm_settings WHERE id=?').bind(MOLD_QUOTE_PO_SETTING).first());
}
/** Where the CRM keeps that the products update of 2026-11-05 (the second of the day: requestRef, the order number given at production's
 *  approval) is live, the same way: a row of crm_settings, written once, never removed. From then on an order number is no identity: a
 *  page loaded before this release that names a request by it (approve-order, withdraw-order) is asked to reload, never answered on a
 *  number that may have moved (the renumbering of 101 and up) or that the request does not have yet. */
export const MOLD_REQUEST_REF_SETTING='mold-request-ref';
export async function moldRequestRefKnown(db:D1Database){
 return !!(await db.prepare('SELECT 1 AS known FROM crm_settings WHERE id=?').bind(MOLD_REQUEST_REF_SETTING).first());
}
/** Learns that update from any answer read (a status object or a pending item, as moldStatusObject and moldPendingItem read it, so only
 *  a valid requestRef counts): the first one stores it, any later one changes nothing. Never unlearned. */
async function noteMoldRequestRef(db:D1Database,values:unknown[],at:string){
 if(!values.some(value=>!!value&&typeof value==='object'&&typeof (value as {requestRef?:unknown}).requestRef==='string'))return false;
 if(!await moldRequestRefKnown(db))await db.prepare('INSERT OR IGNORE INTO crm_settings(id,owner_id) VALUES(?,?)').bind(MOLD_REQUEST_REF_SETTING,at).run();
 return true;
}
/** Where the CRM keeps that production's application takes a request for a customer not in the CRM (2026-11-09: customer.crmNumber null
 *  with customer.erpCode), the same way: a row of crm_settings, written once, never removed. */
export const MOLD_FREE_CUSTOMERS_SETTING='mold-free-customers';
export async function moldFreeCustomersSupported(db:D1Database){
 return !!(await db.prepare('SELECT 1 AS known FROM crm_settings WHERE id=?').bind(MOLD_FREE_CUSTOMERS_SETTING).first());
}
/** How long a request for a customer not in the CRM waits before its next try while production does not take it yet. */
export const MOLD_FREE_CUSTOMER_RETRY_MS=6*3600_000;
/** Learns that update from any answer read whose customer carries erpCode (moldFreeCustomersAnswered: a status object, or a pending
 *  item, as moldStatusObject and moldPendingItem read them). The first one stores it and makes every request waiting for it due now. */
async function noteMoldFreeCustomers(db:D1Database,values:unknown[],at:string){
 if(!values.some(moldFreeCustomersAnswered)||await moldFreeCustomersSupported(db))return false;
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO crm_settings(id,owner_id) VALUES(?,?)').bind(MOLD_FREE_CUSTOMERS_SETTING,at),
  db.prepare(`UPDATE crm_mold_requests SET next_attempt_at=? WHERE outbox IS 'send' AND json_extract(last_error,'$.code')=? AND json_type(data,'$.customer.crmNumber')='null'`).bind(at,MOLD_FREE_CUSTOMER),
 ]);
 return true;
}
/** Where the CRM keeps that the products update of 2026-11-10 is live (a deferred payment's terms, the sales manager's acknowledgement,
 *  finance's return, 20/10/10 files): a row of crm_settings, written once, never removed. Learned from any status object or pending item
 *  that carries both keys paymentTerms and returned (null included), as production's reply of 2026-11-10 says. Until then the CRM keeps
 *  the terms and the acknowledgement for itself and sends neither (the updated application refuses paymentTerms without "deferred", the
 *  application before ignores both). */
export const MOLD_NOV10_SETTING='mold-nov10';
export async function moldNov10Known(db:D1Database){
 return !!(await db.prepare('SELECT 1 AS known FROM crm_settings WHERE id=?').bind(MOLD_NOV10_SETTING).first());
}
export const moldNov10Answered=(value:unknown)=>!!value&&typeof value==='object'&&Object.hasOwn(value,'paymentTerms')&&Object.hasOwn(value,'returned');
/** Where the CRM keeps that production's schema 19 is live (yourrest-products#52: "signed" on a design file): a row of crm_settings,
 *  written once, never removed, learned from any answer whose file objects carry the boolean "signed" (moldSignedFlagAnswered). Until
 *  then a signed copy or the signed document is sent without it (an older application would ignore it; it is not sent at all). */
export const MOLD_SIGNED_FLAG_SETTING='mold-signed-flag';
export async function moldSignedFlagKnown(db:D1Database){
 return !!(await db.prepare('SELECT 1 AS known FROM crm_settings WHERE id=?').bind(MOLD_SIGNED_FLAG_SETTING).first());
}
export async function noteMoldSignedFlag(db:D1Database,values:unknown[],at=new Date().toISOString()){
 if(!values.some(moldSignedFlagAnswered)||await moldSignedFlagKnown(db))return false;
 await db.prepare('INSERT OR IGNORE INTO crm_settings(id,owner_id) VALUES(?,?)').bind(MOLD_SIGNED_FLAG_SETTING,at).run();
 return true;
}
async function noteMoldNov10(db:D1Database,values:unknown[],at:string){
 if(!values.some(moldNov10Answered)||await moldNov10Known(db))return false;
 await db.prepare('INSERT OR IGNORE INTO crm_settings(id,owner_id) VALUES(?,?)').bind(MOLD_NOV10_SETTING,at).run();
 return true;
}
/** Learns production's update from any answer read (a status object or a pending item, as moldStatusObject and moldPendingItem read it)
 *  that carries quoteOrPoMissing, whatever its value: the first one stores it, any later one changes nothing. Never unlearned. Every
 *  answer read passes here, so the same answers teach the products update of 2026-11-05 too (noteMoldRequestRef), and the update that
 *  takes a customer not in the CRM (noteMoldFreeCustomers, 2026-11-09). */
export async function noteMoldQuotePo(db:D1Database,values:unknown[],at=new Date().toISOString()){
 await noteMoldRequestRef(db,values,at);
 await noteMoldFreeCustomers(db,values,at);
 await noteMoldNov10(db,values,at);
 await noteMoldSignedFlag(db,values,at);
 if(!values.some(moldQuotePoAnswered))return false;
 // Written only while it is not there yet (a page reads the waiting list every few minutes; no write each time).
 if(!await moldQuotePoSupported(db))await db.prepare('INSERT OR IGNORE INTO crm_settings(id,owner_id) VALUES(?,?)').bind(MOLD_QUOTE_PO_SETTING,at).run();
 return true;
}
/** Over crm_mold_requests: a request whose own change carries a quotation or PO number (held until production's update is known). */
const QUOTE_PO_SEND_SQL="(outbox IS 'send' AND (IFNULL(json_extract(data,'$.quoteNo'),'')<>'' OR IFNULL(json_extract(data,'$.poNo'),'')<>''))";
/** moldHeldFor (lib/mold-requests.ts) in SQL, over crm_mold_requests: why a request is kept, or NULL. Its own data still to send and
 *  certainly never reached production (MOLD_NEVER_SENT_SQL, below), then 'quote_file': asked for under the rule of the quotation's or
 *  PO's file (2026-11-05) and none of its files a quotation's or PO's that is not deleted nor refused for good (MOLD_DESIGN_REFUSED_SQL,
 *  over the file); else 'design_file': asked for under the rule of the design file (2026-11-08) and none of its files a design file that
 *  is not deleted, not refused for good, and not the customer's signature (the file data.signature.fileId names); else (2026-11-10)
 *  'customer_signature': the requester chose the signing link and the customer has not signed yet (data.awaitsSignature), whether or not
 *  production holds the request (a correction of one finance sent back waits for it too). The same order as moldHeldFor: the
 *  quotation's file, the design file (both for a request never sent), then the customer's signature. */
export const MOLD_HELD_FOR_SQL=()=>`(CASE WHEN outbox IS NOT 'send' THEN NULL
 WHEN ${MOLD_NEVER_SENT_SQL} AND json_extract(data,'$.fileRequired') IS 1 AND NOT EXISTS(SELECT 1 FROM crm_mold_design_files q WHERE q.request_id=crm_mold_requests.id AND q.category IN ('quote','po') AND q.deleted_at IS NULL
  AND NOT (q.outbox IS 'send' AND q.sent_at IS NULL AND q.next_attempt_at IS NULL AND json_extract(q.last_error,'$.final') IS 1)) THEN 'quote_file'
 WHEN ${MOLD_NEVER_SENT_SQL} AND json_extract(data,'$.designRequired') IS 1 AND NOT EXISTS(SELECT 1 FROM crm_mold_design_files d WHERE d.request_id=crm_mold_requests.id AND d.category NOT IN ('quote','po') AND d.deleted_at IS NULL
  AND d.id IS NOT json_extract(crm_mold_requests.data,'$.signature.fileId') AND NOT (d.outbox IS 'send' AND d.sent_at IS NULL AND d.next_attempt_at IS NULL AND json_extract(d.last_error,'$.final') IS 1)) THEN 'design_file'
 WHEN json_extract(data,'$.awaitsSignature') IS 1 THEN 'customer_signature'
 END)`;
/** Whether a request is kept in the CRM for a file, or for the customer's signature (moldHeldFor in TypeScript, any reason). Never NULL. */
export const MOLD_AWAITS_FILE_SQL=()=>`(${MOLD_HELD_FOR_SQL()} IS NOT NULL)`;
export const requestedNow=(now:string)=>riyadhIso(now);

/** What one send gave (code quote_file or design_file with kind none: the request is kept for that file, moldHeldFor). sent: what was sent (the request's data, or its cancellation), so a refusal is told in the right words. restored:
 *  a cancellation production answered with the request as it is, not cancelled (its manager had restored it, and this reason was used). */
export type SendOutcome={kind:'ok'|'locked'|'not_found'|'rejected'|'retry'|'off'|'busy'|'none'|'restored';code:string;fields?:string[];reason?:string;sent?:'send'|'cancel'};
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
 * answer is stored when it carries one for this request, the error keeps the reason (final) so the request shows it, and the data goes
 * back to what production last accepted from the CRM when the CRM knows it. When it does not (the earlier attempt's answer was lost),
 * the data stays the CRM's refused copy, and accepted becomes that copy marked unconfirmed: it marks that production holds the request
 * (its status is pulled, its design files go, the sales manager may approve it), never that these are production's data, and the
 * request says so for as long as it stands, whatever error is stored later. The same answer without a usable status still proves
 * production holds the request, so it is settled the same way (the status comes with the next pull).
 *
 * A change to a request production already holds (queued before 2026-11-02; the CRM no longer saves one) that production refuses for
 * its data (400 or 413, or the CRM's own refusal) is final too: no edit can fix it any more, so it is dropped, the data goes back to
 * what production accepted, and the error, marked final, says why.
 *
 * A cancellation answered 200 with the request NOT cancelled (2026-11-03): its production manager had restored it, and this reason was
 * used already, so production cancels nothing, whatever the request's state now (approved or in production since). The CRM does not
 * mark it cancelled either: its cancelled marks are cleared, production's status stored, nothing is tried again, and the error (code
 * restored, reason same_reason) says why (asking for a new reason only while it may still be cancelled); audited. A cancellation
 * waiting while the status stored already says cancelled is not sent at all (see below), so this answer only comes for one no pull saw.
 */
export async function sendMoldRequest(db:D1Database,id:string,{link=productsLink(),now=()=>new Date().toISOString(),fetch}:{link?:Config;now?:()=>string;fetch?:typeof globalThis.fetch}={}):Promise<SendOutcome>{
 if(!link.ok)return {kind:'off',code:link.reason};
 const row=await loadMoldRequest(db,id);
 if(!row||!row.outbox)return {kind:'none',code:''};
 // A request saved with a quotation or PO number goes only once production's update is known to be live: the older application would
 // store it without them, silently, and no resend could add them later. Kept as it is meanwhile (it cannot happen in normal use).
 if(row.outbox==='send'&&moldHasQuotePo(row.data)&&!await moldQuotePoSupported(db))return {kind:'none',code:'quote_po_update'};
 // A new request without its quotation or PO file (2026-11-05), or without its design file (2026-11-08), stays in the CRM until one is
 // attached: never sent, by anything. The claim says the same in SQL, so a file deleted between this check and the claim keeps it too.
 const kept=row.outbox==='send'?moldHeldFor(row,await loadMoldDesignFiles(db,'request_id=?',[id])):null;
 if(kept)return {kind:'none',code:kept};
 // A customer not in the CRM (2026-11-09) goes only once production's update is known; until then it waits (6 hours, or a resend), after
 // the CRM has asked production once more for what it now runs (moldFreeCustomersProbe).
 if(row.outbox==='send'&&moldFreeCustomer(row.data)&&moldNeverSent(row)&&!await moldFreeCustomersSupported(db)&&!await moldFreeCustomersProbe(db,{link,now,fetch})){
  const at=now(),error=JSON.stringify({code:MOLD_FREE_CUSTOMER,http:0,at,notStored:true});
  await db.prepare('UPDATE crm_mold_requests SET next_attempt_at=?,last_error=?,updated_at=? WHERE id=? AND version=? AND outbox IS \'send\' AND next_attempt_at IS NOT NULL AND next_attempt_at<=?').bind(new Date(Date.parse(at)+MOLD_FREE_CUSTOMER_RETRY_MS).toISOString(),error,at,id,row.version,at).run();
  return {kind:'none',code:MOLD_FREE_CUSTOMER};
 }
 // Whether this request's sends carry the payment's terms (2026-11-10), kept with the claim (data.termsSent) so every later send is the
 // same bytes (production compares a resend with its original). While every attempt so far was refused before production stored the
 // request (never sent), it is decided again at each send: with them once the update is known. Once a send may have reached production,
 // what was decided stays (a correction of a request finance sent back says true itself).
 const fresh=moldNeverSent(row)&&!row.accepted,decided=typeof row.data.termsSent==='boolean'&&!fresh;
 const withTerms=decided?row.data.termsSent===true:!!row.data.paymentTerms&&row.data.payment==='deferred'&&(row.data.termsSent===true||fresh&&await moldNov10Known(db));
 const at=now(),claim=crypto.randomUUID(),lease=new Date(Date.parse(at)+60_000).toISOString(),keepTerms=row.outbox==='send'&&!!row.data.paymentTerms&&row.data.termsSent!==withTerms;
 const claimed=await db.prepare(`UPDATE crm_mold_requests SET mutation_id=?,last_attempt_at=?,next_attempt_at=?,data=CASE WHEN ? THEN json_set(data,'$.termsSent',json(?)) ELSE data END WHERE id=? AND version=? AND outbox=? AND next_attempt_at IS NOT NULL AND next_attempt_at<=? AND NOT ${MOLD_AWAITS_FILE_SQL()}`).bind(claim,at,lease,keepTerms?1:0,withTerms?'true':'false',id,row.version,row.outbox,at).run();
 if(claimed.meta.changes!==1){const still=row.outbox==='send'?moldHeldFor(row,await loadMoldDesignFiles(db,'request_id=?',[id])):null;return still?{kind:'none',code:still}:{kind:'busy',code:''};}
 // A cancellation whose answer was lost while a pull since stored production's status as cancelled (it arrived, or production cancelled
 // the request itself): complete there, so it is settled as delivered, not sent again. A later restore is then the pull's alone
 // (moldRemoteStatements: audited «أعاده مدير الإنتاج بعد الإلغاء», active again), never read from a cancellation's answer. A restore
 // stored meanwhile (it drops the cancellation and takes the claim) wins.
 if(row.outbox==='cancel'&&row.remote?.status==='cancelled'){
  await db.prepare('UPDATE crm_mold_requests SET outbox=NULL,attempts=0,first_failed_at=NULL,next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND mutation_id=?').bind(now(),id,claim).run();
  return {kind:'ok',code:'',sent:'cancel'};
 }
 const options=fetch?{fetch}:{};
 const answer=row.outbox==='cancel'
  ?await callProducts(link,'cancel',{crmRequestId:row.id,reason:row.cancelReason},options)
  :await callProducts(link,'requests',requestBody(row,withTerms),options);
 // This attempt and every one before it were refused before production stored the request: it may still be edited (moldNeverSent).
 const notStored=moldAnswerNotStored(answer)&&moldNeverSent(row)?{notStored:true}:{};
 // A status about another request (a crmRequestId that is not this one's) is not this request's status.
 const told=answer.kind==='ok'?moldStatusObject(answer.json?.request):answer.kind==='locked'?answer.request:null,remote=told?.crmRequestId===row.id?told:null;
 const done=now(),[remoteSet,remoteArgs]=newerRemote(remote,done);
 await noteMoldQuotePo(db,[told],done);
 const settle=(sql:string,...args:(string|number|null)[])=>db.prepare(`UPDATE crm_mold_requests SET ${sql},updated_at=? WHERE id=? AND mutation_id=?`).bind(...args,done,id,claim).run();
 const cleared="outbox=NULL,attempts=0,first_failed_at=NULL,next_attempt_at=NULL";
 // A cancellation answered with this request's status proves production holds it, with the CRM's data (no edit follows a send that may
 // have arrived): kept as accepted when the first send's answer was lost, so its status is pulled from now on (a restore included).
 const [held,heldArgs]:[string,string[]]=remote&&row.outbox==='cancel'?['accepted=COALESCE(accepted,?),',[JSON.stringify(row.data)]]:['',[]];
 if(answer.kind==='ok'){
  if(row.outbox==='send')await settle(`${cleared},last_error=NULL,accepted=?,${remoteSet}`,JSON.stringify(row.data),...remoteArgs);
  else if(remote&&remote.status!=='cancelled'){
   const error=JSON.stringify({code:'restored',reason:'same_reason',http:answer.http||200,at:done}),gate='EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND mutation_id=? AND cancelled_at IS NOT NULL)';
   await db.batch([
    db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,'mold-request:cancel-restored',?,? WHERE ${gate}`)
     .bind(crypto.randomUUID(),id,MOLD_PRODUCTION_ACTOR,JSON.stringify({label:'الإلغاء لم يُنفَّذ: أعاد مدير الإنتاج الطلب، والسبب نفسه استُخدم من قبل',customerName:row.data.customer.name,reason:row.cancelReason,orderNo:remote.orderNo,status:remote.status,waitingStep:remote.waitingStep??null}),done,id,claim),
    db.prepare(`UPDATE crm_mold_requests SET ${held}${cleared},cancelled_at=NULL,cancel_reason='',last_error=?,${remoteSet},version=version+1,updated_at=? WHERE id=? AND mutation_id=?`).bind(...heldArgs,error,...remoteArgs,done,id,claim),
   ]);
   return {kind:'restored',code:'same_reason',fields:[],sent:'cancel'};
  }else await settle(`${held}${cleared},last_error=NULL,${remoteSet}`,...heldArgs,...remoteArgs);
 }else if(answer.kind==='not_found'&&row.outbox==='cancel'){
  // Production never had it (a send that did not get through): the cancellation is complete in the CRM.
  await settle(`${cleared},last_error=NULL`);
 }else if(answer.kind==='locked'){
  // Production refused the change (it started first, or the request is the production manager's to edit now): the change is withdrawn,
  // never tried again (final), and the request shows production's status.
  const productionOnly=row.outbox==='send'&&answer.reason===MOLD_PRODUCTION_ONLY;
  const error=JSON.stringify({code:'request_locked',...(answer.reason?{reason:answer.reason}:{}),http:409,at:done,...(row.outbox==='send'?{final:true}:{})});
  if(row.outbox==='cancel')await settle(`${held}${cleared},cancelled_at=NULL,cancel_reason='',last_error=?,${remoteSet},version=version+1`,...heldArgs,error,...remoteArgs);
  // production_only: production holds the request (with or without a status here), and its production manager alone edits it. When the
  // CRM never learned what production accepted, its refused copy is kept, marked unconfirmed (SQLite reads the old row on the right).
  // Without a status, the time of the last pull stays, so the next page pulls it.
  else if(productionOnly)await settle(`${cleared},data=COALESCE(accepted,data),accepted=COALESCE(accepted,json_set(data,'$.unconfirmed',json('true'))),last_error=?,${remote?remoteSet:'remote_at=remote_at'},version=version+1`,error,...(remote?remoteArgs:[]));
  else await settle(`${cleared},data=COALESCE(accepted,data),last_error=?,${remoteSet},version=version+1`,error,...remoteArgs);
 }else if(answer.kind==='rejected'&&row.outbox==='send'&&row.accepted){
  // A change (queued before 2026-11-02) to a request production holds, refused for its data: no edit can fix it now, so it is dropped
  // for good, the data back to what production accepted, with the reason.
  await settle(`${cleared},data=accepted,last_error=?,version=version+1`,JSON.stringify({code:answer.code,fields:answer.fields,http:answer.http||0,at:done,final:true}));
 }else if(answer.kind==='rejected'&&row.outbox==='send'&&moldFreeCustomer(row.data)&&answer.fields.includes('customer.crmNumber')){
  // A customer not in the CRM refused for its missing Yourrest number (production's application without the update of 2026-11-09, or
  // back to it): not final; it waits for the update and is tried again every 6 hours (and on a resend), never stopped.
  await settle('attempts=attempts+1,next_attempt_at=?,last_error=?',new Date(Date.parse(done)+MOLD_FREE_CUSTOMER_RETRY_MS).toISOString(),JSON.stringify({code:MOLD_FREE_CUSTOMER,fields:answer.fields,http:answer.http||400,at:done,...notStored}));
  return {kind:'none',code:MOLD_FREE_CUSTOMER,fields:answer.fields,sent:'send'};
 }else if(answer.kind==='rejected'){
  // The data must change first; a retry alone cannot help, so the timetable stops until the representative edits (allowed while it
  // has never reached production), resends or cancels.
  await settle('attempts=attempts+1,next_attempt_at=NULL,last_error=?',JSON.stringify({code:answer.code,fields:answer.fields,http:answer.http||0,at:done,...notStored}));
 }else{
  const failures=row.attempts+1,first=row.firstFailedAt||done;
  await settle('attempts=?,first_failed_at=?,next_attempt_at=?,last_error=?',failures,first,moldNextAttempt(failures,first,done),JSON.stringify({code:answer.code,http:answer.http||0,at:done,...notStored}));
 }
 return {kind:answer.kind==='not_found'&&row.outbox==='cancel'?'ok':answer.kind,code:answer.code,fields:answer.fields,...(answer.reason?{reason:answer.reason}:{}),sent:row.outbox};
}

/** Asks production what it runs now, for a request for a customer not in the CRM waiting for its update: the status of the request it
 *  answered last (any one it holds), else its waiting list; either answer teaches the CRM the update (noteMoldQuotePo). Whether it is
 *  known now. Nothing is asked while the link is off. */
async function moldFreeCustomersProbe(db:D1Database,{link,now,fetch}:{link:Config;now:()=>string;fetch?:typeof globalThis.fetch}){
 if(!link.ok)return false;
 const latest=await db.prepare('SELECT id FROM crm_mold_requests WHERE remote IS NOT NULL ORDER BY remote_at DESC,id LIMIT 1').first<{id:string}>();
 const row=latest?await loadMoldRequest(db,latest.id):null;
 if(row)await pullMoldStatuses(db,[row],{link,now,force:true,...(fetch?{fetch}:{})});
 if(await moldFreeCustomersSupported(db))return true;
 const pending=await pullPendingApprovals({link,now,...(fetch?{fetch}:{})});
 await noteMoldQuotePo(db,pending.items);
 return moldFreeCustomersSupported(db);
}

/** The requests whose next try has come, oldest first; a few per run so a page or the timer never waits long. Then the design files
 * whose turn has come (sendDueMoldDesignFiles). */
export async function sendDueMoldRequests(db:D1Database,{limit=5,now=()=>new Date().toISOString(),link=productsLink(),fetch,files}:{limit?:number;now?:()=>string;link?:Config;fetch?:typeof globalThis.fetch;files?:R2Bucket}={}){
 if(!link.ok)return 0;
 // Before production's update is known, a request carrying a quotation or PO number is not due: it would only be held again. A new
 // request waiting for its quotation's, PO's (2026-11-05) or design file (2026-11-08) is never due: it would only be kept again, and
 // would take the place of requests that may go.
 const held=(await moldQuotePoSupported(db)?'':` AND NOT ${QUOTE_PO_SEND_SQL}`)+` AND NOT ${MOLD_AWAITS_FILE_SQL()}`;
 const due=(await db.prepare(`SELECT id FROM crm_mold_requests WHERE outbox IS NOT NULL AND next_attempt_at IS NOT NULL AND next_attempt_at<=?${held} ORDER BY next_attempt_at,id LIMIT ?`).bind(now(),limit).all<{id:string}>()).results;
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
/** Who the audit names for what production did (its production manager's restore). */
export const MOLD_PRODUCTION_ACTOR='تطبيق الإنتاج';
/** Over crm_mold_requests as it stands before a status is stored: the status stored says cancelled, and the one coming (its revision
 *  bound, never older: newerRemote's own test) is not cancelled. The production manager restored the request (2026-11-03).
 *  Or a restore the release before this one already pulled: it pulled cancelled requests too but stored their status alone, so a request
 *  the CRM cancelled (its cancellation delivered: no outbox) holds a status that is not cancelled, stored after the cancellation, while
 *  its cancelled marks stay; the status coming says it is still not cancelled. A cancellation still waiting (outbox) is never one, and
 *  neither is a request production holds cancelled (the status coming says so, and nothing here runs then). */
const RESTORED_SQL="(json_extract(remote,'$.status') IS 'cancelled' OR (cancelled_at IS NOT NULL AND outbox IS NULL AND remote IS NOT NULL AND json_extract(remote,'$.status') IS NOT 'cancelled' AND remote_at>cancelled_at)) AND IFNULL(json_extract(remote,'$.revision')>?,0)=0";
/**
 * The statements that store production's answer about a request (newerRemote), run together in this order (one batch). When the answer
 * says the request is not cancelled while the status stored says it is (or the earlier release already stored that restore without
 * settling it: RESTORED_SQL), the production manager restored it (2026-11-03), and two come
 * first: an audit entry «أعاده مدير الإنتاج بعد الإلغاء» (whoever cancelled it), and, for a request the CRM cancelled, its cancelled marks
 * cleared (cancelled_at, cancel_reason: it is active again, its cancelling and design files back under the usual rules) with why kept
 * in last_error (code restored). A cancellation still waiting for its resend is dropped then (reason cancel_dropped): production saw the
 * request cancelled and its manager undid that, so it is never sent again. A cancellation production never showed as cancelled is not
 * touched by any status: it is sent as before. Any send in flight loses its claim (a change saved meanwhile wins over the answer).
 */
export function moldRemoteStatements(db:D1Database,id:string,remote:MoldRemote,at:string):D1PreparedStatement[]{
 const [set,args]=newerRemote(remote,at),write=db.prepare(`UPDATE crm_mold_requests SET ${set} WHERE id=?`).bind(...args,id);
 // Finance sent it back (2026-11-10): «أعادته المالية» in the audit, once for each return (named by its moment), when first seen.
 const returned=remote.returned?[db.prepare(`INSERT OR IGNORE INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,id,?,'mold-request:returned',json_object('label',?,'customerName',json_extract(data,'$.customer.name'),'reason',?,'by',?,'at',?),? FROM crm_mold_requests WHERE id=?`)
  .bind('mold-returned:'+id+':'+(remote.returned.at||''),MOLD_PRODUCTION_ACTOR,'أعادته المالية',remote.returned.reason,remote.returned.name||'finance',remote.returned.at,at,id)]:[];
 // (Last, after the write and a restore's statements: the callers count the restore by its place.)
 if(remote.status==='cancelled')return [write,...returned];
 const revision=remote.revision??Number.MAX_SAFE_INTEGER,error=(reason:string)=>JSON.stringify({code:'restored',reason,http:0,at});
 const audit=db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,id,?,'mold-request:restored',json_object('label',?,'customerName',json_extract(data,'$.customer.name'),'cancelledInCrm',json(CASE WHEN cancelled_at IS NULL THEN 'false' ELSE 'true' END),'cancelReason',cancel_reason,'cancelDropped',json(CASE WHEN outbox IS 'cancel' THEN 'true' ELSE 'false' END),'orderNo',?,'status',?,'waitingStep',?),?
  FROM crm_mold_requests WHERE id=? AND ${RESTORED_SQL}`).bind(crypto.randomUUID(),MOLD_PRODUCTION_ACTOR,'أعاده مدير الإنتاج بعد الإلغاء',remote.orderNo,remote.status,remote.waitingStep??null,at,id,revision);
 // accepted: production holds the request with the CRM's data (a cancellation whose first send's answer was lost may lack it).
 const restore=db.prepare(`UPDATE crm_mold_requests SET cancelled_at=NULL,cancel_reason='',accepted=COALESCE(accepted,data),last_error=CASE WHEN outbox IS 'cancel' THEN ? ELSE ? END,attempts=CASE WHEN outbox IS 'cancel' THEN 0 ELSE attempts END,
  first_failed_at=CASE WHEN outbox IS 'cancel' THEN NULL ELSE first_failed_at END,next_attempt_at=CASE WHEN outbox IS 'cancel' THEN NULL ELSE next_attempt_at END,outbox=CASE WHEN outbox IS 'cancel' THEN NULL ELSE outbox END,
  mutation_id=?,updated_at=?,version=version+1 WHERE id=? AND cancelled_at IS NOT NULL AND ${RESTORED_SQL}`).bind(error('cancel_dropped'),error('restored'),crypto.randomUUID(),at,id,revision);
 return [audit,restore,write,...returned];
}
/** Production's answer about a request, stored unless a newer one (a higher revision) is there already; a restore it shows is settled
 *  with it (moldRemoteStatements). An answer of production's updated application teaches the CRM so (noteMoldQuotePo). */
export async function storeMoldRemote(db:D1Database,id:string,remote:MoldRemote,at:string){
 await db.batch(moldRemoteStatements(db,id,remote,at));
 await noteMoldQuotePo(db,[remote],at);
}
/** The reasons of each request's earlier cancellations in the CRM (their audit entries, oldest first), for the requests given: a new
 *  cancellation of a request the production manager restored needs another (production answers a used one with the request as it is). */
export async function moldCancelReasons(db:D1Database,ids:string[]){
 const out=new Map<string,string[]>();
 for(let start=0;start<ids.length;start+=100){
  const chunk=ids.slice(start,start+100);
  const rows=(await db.prepare(`SELECT record_id AS id,json_extract(detail,'$.reason') AS reason FROM crm_audit WHERE record_id IN (${chunk.map(()=>'?').join(',')}) AND action='mold-request:cancel' ORDER BY created_at,id`).bind(...chunk).all<{id:string;reason:unknown}>()).results;
  for(const row of rows)out.set(row.id,[...(out.get(row.id)||[]),typeof row.reason==='string'?row.reason:'']);
 }
 return out;
}
/** The earlier reasons a reader's view carries: for the requester of a request active again after a cancellation (code restored), the
 *  only one who may cancel it; [] otherwise. */
export async function moldViewReasons(db:D1Database,rows:Pick<MoldRequestRow,'id'|'memberId'|'lastError'>[],me:Pick<Member,'id'>){
 const wanted=rows.filter(row=>row.memberId===me.id&&row.lastError?.code==='restored').map(row=>row.id);
 return wanted.length?await moldCancelReasons(db,wanted):new Map<string,string[]>();
}

// ---- design files (the contract's addition of 2026-11-02)
const fileColumns=`id,request_id AS requestId,member_id AS memberId,name,kind,content_type AS contentType,size,sha256,object_key AS objectKey,created_at AS createdAt,deleted_at AS deletedAt,outbox,attempts,
 first_failed_at AS firstFailedAt,next_attempt_at AS nextAttemptAt,last_attempt_at AS lastAttemptAt,last_error AS lastError,remote_file_id AS remoteFileId,sent_at AS sentAt,version,category`;
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
 * One send of what a design file has waiting: the file itself (only once production holds its request, never while it is cancelled, in
 * the CRM or in production as last known), or its deletion. Claimed with a lease first, like a request; a deletion asked for meanwhile
 * wins over the answer. Each answer's request (its approvals undone) is stored. Final answers stop the timetable, marked final whatever
 * their code (a 400 or 413 from a web server in front of production has no contract code): 400 and 413 (refused, with the reason) and
 * 409 (the approvals were complete first: the file is not sent). A 409 whose request is cancelled there is not final: the production
 * manager may restore it (2026-11-03), so the file waits, held, and goes once the request is active again. A 404, whatever its body (the contract's not_found, or the 404 of an application or web server that does not know the
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
 // Held while the request is cancelled, in the CRM or in production as last known (its production manager may restore it, 2026-11-03).
 if(!row||file.outbox==='send'&&(!row.accepted||row.cancelledAt||row.remote?.status==='cancelled'))return {kind:'none',code:'held'};
 // A quotation's or PO's file goes only once production's update is known to be live: the older application would keep it as a design
 // file, and print it on the work order (it cannot happen in normal use: such a file is attached only after the update).
 if(file.outbox==='send'&&moldFileCategory(file)!=='design'&&!await moldQuotePoSupported(db))return {kind:'none',code:'quote_po_update'};
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
   // A design file is sent without category, exactly as before; the quotation's or PO's with its own, the same on every retry.
   // A signed copy or the signed document (an 'mdc-' row the request's signature names) carries "signed": true once production's schema
   // 19 is known (2026-11-11); every other file, and every file before, exactly as before. The same on every retry of the file.
   const signed=file.id.startsWith('mdc-')&&!!moldSignatureOf(row.data)&&!!moldSignedOutputOf(file.id,moldSignatureOf(row.data)!.fileId)&&await moldSignedFlagKnown(db);
   try{body=moldDesignFileBody({crmRequestId:row.id,crmFileId:file.id,name:file.name,category:moldFileCategory(file),...(signed?{signed:true}:{})},bytes);}catch(error){await refuse({code:'invalid_payload',fields:[String((error as Error).message)],http:0,at:now()});return {kind:'rejected',code:'invalid_payload'};}
   answer=await callProducts(link,'design-files',body,options);
  }else answer=await callProducts(link,'design-file-delete',{crmRequestId:row.id,crmFileId:file.id},options);
  const done=now(),remote=answer.kind==='ok'?moldStatusObject(answer.json?.request):answer.kind==='locked'?answer.request:null;
  // The design-files answer's own file object teaches schema 19 too ("signed" on it).
  if(answer.kind==='ok'&&file.outbox==='send')await noteMoldSignedFlag(db,[answer.json?.file],done);
  // The answer's request is stored as production holds it now: a design file's arrival or deletion undid its approvals there, a
  // quotation's or PO's kept them (2026-11-05); the CRM pretends neither, it stores what production says. The waiting list is read again
  // (the file is listed there, and the approvals may have changed).
  if(remote){await storeMoldRemote(db,row.id,remote,done);forgetPendingApprovals();}
  const cleared='outbox=NULL,attempts=0,first_failed_at=NULL,next_attempt_at=NULL,last_error=NULL';
  const missing=answer.kind==='not_found'||answer.http===404;
  // Whether production holds the file, from the status a 409 carries: its entry (in any of its lists), null when the listing leaves it
  // out, undefined when there is no listing (an older application).
  const listed=answer.kind==='locked'&&Array.isArray(remote?.designFiles)?moldListedFiles(remote).find((entry:MoldDesignFile)=>entry.crmFileId===file.id)??null:undefined;
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
  }else if(answer.kind==='locked'&&remote?.status==='cancelled'){
   // Refused because the request is cancelled there (by its production manager, or by the CRM's cancellation that arrived first): not
   // final, since the production manager may restore it (2026-11-03). The file waits, held while the status stored says cancelled (or
   // the CRM's cancellation stands), and goes once the request is active again.
   await settle('attempts=0,first_failed_at=NULL,next_attempt_at=?,last_error=NULL',done);
   return {kind:'none',code:'held'};
  }else if(answer.kind==='locked'||answer.kind==='rejected'){
   await refuse({code:answer.kind==='locked'?'request_locked':answer.code,...(answer.reason?{reason:answer.reason}:{}),...(answer.fields.length?{fields:answer.fields}:{}),http:answer.http||0,at:done});
   // The ONE signed document refused by production for its size (413) or its place (too_many_files, 2026-11-11): the per-file signed
   // copies are made instead, as when the CRM finds it too large or without a place before sending (loaded here: that module reads this).
   if(file.outbox==='send'&&answer.kind==='rejected'&&/^mdc-.+-doc$/.test(file.id)&&(answer.code==='payload_too_large'||answer.http===413||answer.reason==='too_many_files'))
    await import('./mold-sign-server').then(module=>module.signedDocumentRefused(db,file.requestId,file.id)).catch(error=>{console.error('Signed copies failed',error instanceof Error?error.name:'error');});
  }else{
   const failures=file.attempts+1,first=file.firstFailedAt||done;
   await settle('attempts=?,first_failed_at=?,next_attempt_at=?,last_error=?',failures,first,moldNextAttempt(failures,first,done),JSON.stringify({code:answer.code,http:answer.http||0,at:done}));
  }
  return {kind:gone?'ok':missing?'not_found':answer.kind,code:answer.code,fields:answer.fields,...(answer.reason?{reason:answer.reason}:{})};
 }finally{filesInFlight--;}
}
/**
 * A request kept for its quotation's, PO's (2026-11-05) or design file (2026-11-08), released by the first file of the missing kind
 * attached once nothing else is missing (the design-files route decides, moldHeldFor): the request is sent now, through the
 * same send as ever (its claim, retries and idempotency unchanged), and once production holds it, its files whose turn has come go one
 * after the other, oldest first (the customer's signature, the design files and the quotation's or PO's, as they were attached). A file
 * that cannot go now (the request not accepted yet, another two in flight) waits for the timetable as usual. Answers the request's
 * outcome and each file's sent here.
 */
/** onRequest (2026-11-10): told the request's own outcome as soon as it is known, before its files go (a caller that answers while the files
 *  are still on their way). */
export async function releaseMoldRequest(db:D1Database,id:string,{link=productsLink(),now=()=>new Date().toISOString(),fetch,files,waitMs=12_000,onRequest}:{link?:Config;now?:()=>string;fetch?:typeof globalThis.fetch;files?:R2Bucket;waitMs?:number;onRequest?:(outcome:SendOutcome)=>void}={}){
 const extra={...(fetch?{fetch}:{})},until=Date.now()+waitMs,sent=new Map<string,DesignOutcome>();
 let outcome=await sendMoldRequest(db,id,{link,now,...extra});
 // The file saved just now makes the request due for any sender: the timetable or a page's own check may have claimed it first. Its
 // answer is waited for (within waitMs), so the request's files follow here rather than on the next check.
 while(outcome.kind==='busy'&&Date.now()<until){
  await pause(200);
  const row=await loadMoldRequest(db,id);
  if(!row)break;
  if(row.accepted&&row.outbox!=='send'){outcome={kind:'ok',code:''};break;}
  if(requestClaimed(row,now()))continue;
  // The other send ended without production holding it (a failure, kept on the timetable): one try of ours, then the timetable's.
  outcome=await sendMoldRequest(db,id,{link,now,...extra});
  if(outcome.kind==='busy')break;
 }
 onRequest?.(outcome);
 if(outcome.kind!=='ok')return {outcome,files:sent};
 const due=(await db.prepare("SELECT id FROM crm_mold_design_files WHERE request_id=? AND outbox='send' AND deleted_at IS NULL AND next_attempt_at IS NOT NULL AND next_attempt_at<=? ORDER BY created_at,id").bind(id,now()).all<{id:string}>()).results;
 for(const file of due){
  let result=await sendMoldDesignFile(db,file.id,{link,now,...extra,...(files?{files}:{})});
  // Claimed by the other sender: its answer is waited for the same way (the caller reads the file as it then stands).
  while(result.kind==='busy'&&Date.now()<until){
   await pause(200);
   const row=(await loadMoldDesignFiles(db,'id=?',[file.id]))[0];
   if(!row||!row.outbox){result={kind:'ok',code:''};break;}
   if(moldDesignClaimed(row,now()))continue;
   result=await sendMoldDesignFile(db,file.id,{link,now,...extra,...(files?{files}:{})});
   if(result.kind==='busy')break;
  }
  sent.set(file.id,result);
 }
 return {outcome,files:sent};
}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** A request's send claimed by someone and still within its lease, its answer not stored yet (the claim sets last_attempt_at and a lease
 *  a minute ahead; an answer stores its error or clears the outbox). */
const requestClaimed=(row:MoldRequestRow,at:string)=>!!row.outbox&&!!row.lastAttemptAt&&!!row.nextAttemptAt&&row.nextAttemptAt>at&&!(row.lastError&&row.lastError.at>=row.lastAttemptAt);
/** The design files whose turn has come, oldest first: deletions, and files whose request production holds (not cancelled, in the CRM
 * nor in production as last known). A file waiting for its request is left until the request is accepted, or restored. A request's
 * files reach production in the order they were attached (the customer's signature first, as releaseMoldRequest sends them): a file
 * waits while an older one of the same request is due or being sent (its next try within a send's lease), so this check, run beside
 * another sender (a page's load while an upload releases its request), never sends a newer file past an older one. An older file that
 * stopped (24 hours of failures) or was refused for good (no next try), or retries later than a lease, holds none. */
export async function sendDueMoldDesignFiles(db:D1Database,{limit=2,now=()=>new Date().toISOString(),link=productsLink(),fetch,files}:{limit?:number;now?:()=>string;link?:Config;fetch?:typeof globalThis.fetch;files?:R2Bucket}={}){
 if(!link.ok||filesInFlight>=DESIGN_SENDS)return 0;
 // Before production's update is known, a quotation's or PO's file is not due (it would only be held again), nor does it hold others.
 const known=await moldQuotePoSupported(db),update=known?'':" AND (f.outbox='delete' OR f.category='design')",olderKind=known?'':" AND o.category='design'";
 // One file at a time, read again after each send, so an older file sent here lets the newer one go in the same check.
 const tried:string[]=[];let sent=0;
 while(tried.length<limit){
  const at=now(),leaseEnd=new Date(Date.parse(at)+DESIGN_LEASE_MS).toISOString();
  const next=await db.prepare(`SELECT f.id FROM crm_mold_design_files f JOIN crm_mold_requests r ON r.id=f.request_id WHERE f.outbox IS NOT NULL AND f.next_attempt_at IS NOT NULL AND f.next_attempt_at<=?
   AND (f.outbox='delete' OR (r.accepted IS NOT NULL AND r.cancelled_at IS NULL AND json_extract(r.remote,'$.status') IS NOT 'cancelled'))${update}
   AND (f.outbox='delete' OR NOT EXISTS(SELECT 1 FROM crm_mold_design_files o WHERE o.request_id=f.request_id AND o.id<>f.id AND o.outbox='send' AND o.deleted_at IS NULL AND o.sent_at IS NULL
    AND o.next_attempt_at IS NOT NULL AND o.next_attempt_at<=? AND (o.created_at<f.created_at OR o.created_at=f.created_at AND o.id<f.id)${olderKind}))
   AND f.id NOT IN (SELECT value FROM json_each(?)) ORDER BY f.next_attempt_at,f.id LIMIT 1`).bind(at,leaseEnd,JSON.stringify(tried)).first<{id:string}>();
  if(!next)break;
  tried.push(next.id);
  const outcome=await sendMoldDesignFile(db,next.id,{link,now,fetch,...(files?{files}:{})});if(outcome.kind==='ok')sent++;
 }
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
 // Every request production holds (accepted, or a status from it), cancelled ones too: the production manager may restore one (2026-11-03).
 const at=now(),stale=rows.filter(row=>(row.accepted||row.remote)&&(force||!row.remoteAt||Date.parse(at)-Date.parse(row.remoteAt)>=MOLD_STATUS_TTL_MS));
 if(!stale.length)return null;
 if(!force&&lastPullFailure&&Date.parse(at)-Date.parse(lastPullFailure.at)<MOLD_STATUS_TTL_MS/2)return lastPullFailure;
 const options=fetch?{fetch}:{};
 for(let start=0;start<stale.length;start+=MOLD_STATUS_BATCH){
  const ids=stale.slice(start,start+MOLD_STATUS_BATCH).map(row=>row.id);
  const answer=await callProducts(link,'status',{ids},options);
  if(answer.kind!=='ok'){lastPullFailure={code:answer.code,http:answer.http||0,at};return lastPullFailure;}
  const received=now(),statements:D1PreparedStatement[]=[],restores:[number,string][]=[];
  for(const item of answer.json!.requests){const status=moldStatusObject(item);if(status&&ids.includes(status.crmRequestId)){const writes=moldRemoteStatements(db,status.crmRequestId,status,received);if(writes.length>1)restores.push([statements.length+1,status.crmRequestId]);statements.push(...writes);}}
  const results=statements.length?await db.batch(statements):[];
  await noteMoldQuotePo(db,(answer.json!.requests as unknown[]).map(item=>moldStatusObject(item)),received);
  // The page shows what was stored: an older answer (a file's answer landed meanwhile) leaves the newer status as it was; a request
  // restored now is read again whole (no longer cancelled, its cancellation's sending dropped).
  for(const row of stale.slice(start,start+MOLD_STATUS_BATCH)){const fresh=(answer.json!.requests as unknown[]).map(item=>moldStatusObject(item)).find(item=>item?.crmRequestId===row.id);if(fresh&&!moldRemoteOlder(row.remote,fresh)){row.remote=fresh;row.remoteAt=received;}}
  for(const [index,id] of restores){if(results[index]?.meta.changes!==1)continue;const fresh=await loadMoldRequest(db,id),row=stale.find(item=>item.id===id);if(fresh&&row)Object.assign(row,fresh);}
 }
 lastPullFailure=null;
 return null;
}

/** The requests waiting for the sales manager (production's pending route, every request, the CRM's and those registered in
 * production), kept a minute so a busy page or several managers do not ask production for each one; a failed call waits half that
 * long before the next. An approval, or any file attached or deleted (a design file undoes the approvals; a quotation's or PO's changes
 * what the list shows of the request, 2026-11-05), empties it, and since production has just answered, forgets a failure too. */
let pendingCache:{at:string;items:MoldPendingItem[];unreadable:number}|null=null,pendingFailure:MoldError|null=null;
export function forgetPendingApprovals(){pendingCache=null;pendingFailure=null;}
type PendingReader={me:Member;db:D1Database;members:Member[];regionCustomerIds:Set<string>;all?:readonly {id:string;kind:string;data:Record<string,unknown>}[]};
/** The sales manager's «طلبات بانتظار اعتمادي»: the requests production holds at the sales step (the CRM's and those registered in
 * production) that this manager approves (the owner, 2026-11-03), each with its design files downloaded through the CRM; null for anyone
 * else. One of the CRM's own requests by the CRM's row (moldApprovesRequest: their own, their team's, or one whose requester is in no
 * sales manager's team, such as customer service's, with its customer in their regions); another manager's team's is that manager's.
 * One registered in production by its customer's Yourrest number, within the manager's regions when they do not cover all, as before.
 * The CRM's own request carries its customer's signature (2026-11-04), and its signature's file among the design files is labelled so. */
export async function moldPendingFor(c:PendingReader,link:Config,{force=false}:{force?:boolean}={}):Promise<MoldPendingAnswer|null>{
 if(!canApproveMoldRequests(c.me))return null;
 const pulled=await pullPendingApprovals({link,force});
 await noteMoldQuotePo(c.db,pulled.items);
 // The CRM's own requests, with who asked for each and for which customer.
 const own=new Map((await c.db.prepare("SELECT id,member_id AS memberId,customer_id AS customerId,json_extract(data,'$.signature') AS signature,json_extract(data,'$.paymentTerms') AS paymentTerms FROM crm_mold_requests").all<{id:string;memberId:string;customerId:string;signature:string|null;paymentTerms:string|null}>()).results.map(row=>[row.id,row]));
 const signatureOf=(id:string|null)=>{const text=id?own.get(id)?.signature:null;if(!text)return null;try{return moldSignatureOf({signature:JSON.parse(text)});}catch{return null;}};
 let inRegion:(number:number|null)=>boolean=()=>true;
 if(regionScope(c.me)!=='all'){
  const byNumber=new Map((await c.db.prepare('SELECT customer_id AS id,number FROM crm_customer_numbers').all<{id:string;number:number}>()).results.map(row=>[row.number,row.id]));
  inRegion=number=>number!==null&&c.regionCustomerIds.has(byNumber.get(number)||'');
 }
 const shown=(item:MoldPendingItem)=>{const row=item.crmRequestId?own.get(item.crmRequestId):undefined;return row?moldApprovesRequest(row,c):inRegion(item.customer.crmNumber);};
 // Signed only once production's listing holds the signature's image (by its crmFileId); until then the item says it has not arrived.
 // The payment's terms (2026-11-10): production's when it lists some (its update), else the CRM's own request's (kept in the CRM alone
 // while the update was not known, or sent before it); none beside a payment production holds as anything but "deferred".
 const termsOf=(item:MoldPendingItem)=>item.payment!=='deferred'?null:item.paymentTerms||moldPaymentTerms(item.crmRequestId?own.get(item.crmRequestId)?.paymentTerms:null);
 return {items:pulled.items.filter(shown).map(item=>{const signature=signatureOf(item.crmRequestId);return {...item,paymentTerms:termsOf(item),inCrm:!!item.crmRequestId&&own.has(item.crmRequestId),...moldPendingFiles(item,signature),signature,signatureDelivered:!!signature&&item.designFiles.some(file=>file.crmFileId===signature.fileId)};}),error:pulled.error,at:pulled.at,...(pulled.unreadable?{unreadable:pulled.unreadable}:{})};
}
/** Whether a reader may open one request (GET ?id=, its sheet, and its files by id): every request their list shows
 * (canReadMoldRequest); and for the sales manager one that their list does not show but «طلبات بانتظار اعتمادي» shows them now (customer
 * service's, say), so they read what they approve, only while it is listed there and production's list could be had (a list kept from
 * before a failed call may name a request that has moved on). The approval and its withdrawal go by moldApprovesRequest itself. */
export async function canOpenMoldRequest(row:Pick<MoldRequestRow,'id'|'memberId'|'customerId'>,c:PendingReader,link:Config){
 if(canReadMoldRequest(row,c))return true;
 if(!moldApprovesRequest(row,c))return false;
 const pending=await moldPendingFor(c,link);
 return !!pending&&!pending.error&&pending.items.some(item=>item.crmRequestId===row.id);
}
/** unreadable: how many of production's items could not be read (moldPendingItem: nothing names one, say a request registered there with
 *  a malformed requestRef and no number); they cannot be shown or approved, and the list says how many there are. */
export async function pullPendingApprovals({link=productsLink(),now=()=>new Date().toISOString(),fetch,force=false}:{link?:Config;now?:()=>string;fetch?:typeof globalThis.fetch;force?:boolean}={}):Promise<{items:MoldPendingItem[];error:MoldError|null;at:string|null;unreadable:number}>{
 if(!link.ok)return {items:[],error:{code:link.reason,at:now()},at:null,unreadable:0};
 const at=now();
 if(!force&&pendingCache&&Date.parse(at)-Date.parse(pendingCache.at)<MOLD_STATUS_TTL_MS)return {items:pendingCache.items,error:null,at:pendingCache.at,unreadable:pendingCache.unreadable};
 if(!force&&pendingFailure&&Date.parse(at)-Date.parse(pendingFailure.at)<MOLD_STATUS_TTL_MS/2)return {items:pendingCache?.items||[],error:pendingFailure,at:pendingCache?.at||null,unreadable:pendingCache?.unreadable||0};
 const answer=await callProducts(link,'pending',{},fetch?{fetch}:{});
 if(answer.kind!=='ok'){pendingFailure={code:answer.code,http:answer.http||0,at};return {items:pendingCache?.items||[],error:pendingFailure,at:pendingCache?.at||null,unreadable:pendingCache?.unreadable||0};}
 const raw=answer.json!.requests as unknown[],items=raw.map(item=>moldPendingItem(item) as MoldPendingItem|null).filter((item):item is MoldPendingItem=>!!item),unreadable=raw.length-items.length;
 pendingCache={at,items,unreadable};pendingFailure=null;
 return {items,error:null,at,unreadable};
}

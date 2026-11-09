// Mold manufacturing requests (طلبات تصنيع القوالب): what the screen and the server share. The contract rules live in
// portable/mold-rules.mjs; this adds who may see and change a request, the shape the screen receives and the Arabic wording.
// Every member asks for a mold for a customer they can see (the owner, 2026-11-01); the sales manager approves it here first, then
// production and finance («اعتماد المالية», the third approval keyed `admin`, 2026-11-03) approve it in yourrest-products, which owns the
// status. The representative chooses how the customer pays (cash or deferred, 2026-11-03), sent with the request. The representative attaches design
// files to the request (2026-11-02): kept in the CRM, sent to production, and shown with production's own files to everyone who reads it.
// Once a request is sent its data is edited by the production manager in the products application only (yourrest-products, 2026-11-02):
// the CRM changes it only while it has certainly never reached production (moldNeverSent); cancelling and design files are unchanged.
// A cancellation is no longer final (2026-11-03): the production manager may restore a cancelled request to where it stood; the CRM keeps
// pulling its status, shows it active again, and a new cancellation takes a new reason (moldCancelReasonUsed).
// The quotation and PO numbers and their files (yourrest-products, second update of 2026-11-03): once the CRM has learned that production's
// update is live (a status object carrying quoteOrPoMissing, lib/mold-requests-server.ts moldQuotePoSupported), a new request (or an edit
// before its first send) needed at least one of the two numbers (until 2026-11-05, below), kept in the request's data and sent with it; the quotation's and PO's
// files go with design-files and their category. What a request shows is production's (the status object, the pending item) once
// production holds it: its production manager adds and corrects them there. Before the update nothing of it is asked, shown or sent.
// Who sees which request (the owner, 2026-11-03): the representative their own only, the sales manager their own and their team's
// (canReadMoldRequest, moldTeamManagerId); what the sales manager approves (moldApprovesRequest) also takes customer service's and the
// administrator's requests in their regions, shown in «طلبات بانتظار اعتمادي» only. «رابط التصميم» is no longer asked for (the owner,
// 2026-11-03): a new request has none; an older request keeps its own, shown read-only and sent as it was.
// The customer signs a new request on the representative's phone or tablet before it is sent (the owner, 2026-11-04), for the sales roles
// only (moldSignatureRequired): the signature is a PNG kept as one of the request's design files, named by the request's data (signature),
// shown on its sheet and in «طلبات بانتظار اعتمادي», and not deletable while the request names it.
// The quotation's or PO's FILE is required, the numbers are gone (production's update of 2026-11-05; the owner: every role): once the CRM
// knows production's update of 2026-11-03 (the same flag), a new request carries no number and needs at least one quotation or PO file.
// Files are uploaded after the request is saved, so a new request (data.fileRequired) stays in the CRM, not sent, while it has none
// (moldHeldFor, sending.held 'quote_file' «بانتظار ملف عرض السعر / الـ PO», its state kept one an older page knows); the first
// one attached releases it. A request stored
// with a number keeps it and is sent byte for byte. quoteOrPoMissing now says production has no quotation or PO file and finance has not
// approved: shown as «ناقص ملف عرض السعر / الـ PO», with the attach action while the request is editable. Attaching or deleting a
// quotation's or PO's file no longer undoes the approvals; a design file still does (moldFileResetsApprovals).
// A design file is required too (the owner, 2026-11-08: «إجباري على الكل», every role): every new request is saved with
// data.designRequired, whatever the CRM knows of production, and kept in the CRM the same way while it has no design file of its own (the
// customer's signature does not count): sending.held 'design_file' «بانتظار ملف التصميم». moldHeldFor says why a request is kept (the
// quotation's or PO's file first); the first file of the missing kind releases it when nothing else is missing.
import type {Member} from './crm';
import {salesScopeMemberIds} from './access';
import {memberCanAccessRegion,regionScope} from './regions';
import {MOLD_STAGES,MOLD_STAGE_NAMES,MOLD_CORES,MOLD_MODELS,MOLD_HALF_BLOCKS,MOLD_PAYMENTS,MOLD_WAITING_STEPS,MOLD_CATEGORY_MAX_FILES,MOLD_PRODUCTION_ONLY,MOLD_PRODUCTION_ONLY_TEXT,moldNeverSent as neverSent,moldQuotePoAnswered,moldSignatureRequired,MOLD_QUOTE_FILE_CATEGORIES,MOLD_ADDRESS_REQUIRED,MOLD_ADDRESS_LONG} from '@/portable/mold-rules.mjs';

export {MOLD_STAGES,MOLD_STAGE_NAMES,MOLD_CORES,MOLD_MODELS,MOLD_HALF_BLOCKS,MOLD_PAYMENTS,MOLD_WAITING_STEPS,moldSignatureRequired};
/** The customer's signature as the request's data names it (2026-11-04): who signed for the customer, when (the CRM's UTC time), and
 *  the CRM's design file (its crmFileId) that holds the PNG. */
export type MoldSignature={signer:string;signedAt:string;fileId:string};
/** How the customer pays (2026-11-03): chosen when asking; a request asked for before has none. */
export type MoldPayment='cash'|'deferred';
export type MoldStage=typeof MOLD_STAGES[number];
export type MoldStatusName='received'|'confirmed'|'in_production'|'produced'|'delivered'|'cancelled';
export type MoldSpecs={description:string;core:string;vibrators:number|null;model:string;halfBlock:string;moldWidth:number|null;gelbaSize:number|null;moldNo:string;quantity:number|null;designUrl:string;notes:string};
export type MoldWaitingStep=typeof MOLD_WAITING_STEPS[number];
/** The approvals as production reports them: when each was given (null: not yet); by whom, for the sales manager's given in the CRM. */
export type MoldApprovals={required:boolean;sales:{at:string|null;by?:string}|null;production:{at:string|null}|null;admin:{at:string|null}|null};
export type MoldDesignKind='pdf'|'image'|'other';
/** What a file of a request is: a design file, the quotation's or the PO's (the second update of 2026-11-03). */
export type MoldFileCategory='design'|'quote'|'po';
export const MOLD_FILE_CATEGORY_ORDER:MoldFileCategory[]=['design','quote','po'];
/** A design file as production lists it (designFiles of the status object and of a pending item, and quoteFiles and poFiles since the
 *  second update of 2026-11-03): fileId is production's, sent back as it came; crmFileId the CRM's for a file the CRM sent, null for one
 *  production attached; category the list it came in (absent in a status stored before: design). */
export type MoldDesignFile={fileId:string|number;crmFileId:string|null;name:string;kind:MoldDesignKind;size:number|null;source:'crm'|'production';uploadedAt:string|null;category?:MoldFileCategory};
/** orderNo: production's order number, null until its production manager approves the request (the products update of 2026-11-05, the
 *  second of the day) and renumbered once (101 and up move down by one): shown from the latest status, never a key. requestRef: the stable
 *  UUID production gives every request since that update (absent from an older application, or in a status stored before). */
export type MoldRemote={crmRequestId:string;orderNo:number|null;requestRef?:string;status:MoldStatusName;editable:boolean;moldSerial:string|null;productionDate:string|null;stages:Record<string,{done:boolean;at:string|null}>;stagesDone:number;stagesTotal:number;delivered:boolean;deliveryDate:string|null;updatedAt:string|null;revision:number|null;
 /** Where it waits now and since when (absent in a status stored before the approval chain). */
 waitingStep?:MoldWaitingStep|null;waitingSince?:string|null;approvals?:MoldApprovals|null;
 /** The request's design files, the CRM's and production's (absent in a status stored before 2026-11-02; null from an older application). */
 designFiles?:MoldDesignFile[]|null;
 /** From production's update of 2026-11-03 only (absent before): the quotation and PO numbers as production holds them now ('' for none),
  *  whether one is still missing, and their files. */
 quoteNo?:string;poNo?:string;quoteOrPoMissing?:boolean;quoteFiles?:MoldDesignFile[];poFiles?:MoldDesignFile[]};
/** The request as the CRM owns it: the customer and salesman as they were when it was asked for, and the specifications. unconfirmed
 *  (accepted only): production holds the request, but these are not its data: the CRM's change production refused for good
 *  (production_only) after an earlier attempt's answer was lost, so the CRM never learned what production stored (sendMoldRequest). */
export type MoldRequestData={requestedAt:string;customer:{crmNumber:number;name:string;address:string;city:string};salesman:{crmMemberId:string;name:string;email:string};specs:MoldSpecs;
 /** How the customer pays (2026-11-03); absent in a request asked for before, which is sent again exactly as first sent (without it). */
 payment?:MoldPayment;
 /** The quotation and PO numbers as the representative typed them, normalized (the second update of 2026-11-03): each only when given,
  *  so a request without them is sent again exactly as first sent. No longer asked for since 2026-11-05: kept as stored, never changed. */
 quoteNo?:string;poNo?:string;unconfirmed?:true;
 /** Asked for under the rule of 2026-11-05 (production's update of 2026-11-03 known): sent to production only once a quotation or PO file
  *  is attached in the CRM (moldHeldFor 'quote_file'). Absent for a request asked for before, which goes as it always did. Never part of the
  *  requests body. */
 fileRequired?:true;
 /** Asked for under the rule of 2026-11-08 (every new request, any role): sent to production only once a design file of its own (not the
  *  customer's signature) is attached in the CRM (moldHeldFor 'design_file'). Absent for a request asked for before, which goes as it
  *  always did. Never part of the requests body. */
 designRequired?:true;
 /** The customer's signature (2026-11-04): absent for a request asked for before, or by customer service or the administrator. Never part
  *  of the requests body, so a request is sent with the same bytes with it or without it. */
 signature?:MoldSignature};
export type MoldError={code:string;fields?:string[];http?:number;at:string;
 /** Why production refused (details.reason): a design file's bytes (empty, not_pdf, bad_image, too_many_pixels, with fields ['file'])
  *  or its place (too_many_files, crm_file_id_used, with fields ['crmFileId']); a request's send, production_only (409 request_locked:
  *  production holds the request with other data; its data is edited by the production manager only). With code `restored` (not a
  *  failure, 2026-11-03): why the request is active again after a cancellation: restored (the production manager restored it after the
  *  cancellation reached production), cancel_dropped (the same, while the cancellation waited for a resend: it is not sent again) or
  *  same_reason (production answered a cancellation with this reason with the request as it is, not cancelled: it had restored it). */
 reason?:string;
 /** A request's send: this attempt and every one before it were refused before production stored the request (moldAnswerNotStored),
  *  so it has certainly never reached production and may still be edited (moldNeverSent). */
 notStored?:boolean;
 /** A design file's refusal for good, whatever its code (any 400, 404 or 413, a 409 for a send, or the CRM's own refusal): not sent
  *  again by itself, and the resend button does not start it. A request's change refused for good (409 request_locked, production_only
  *  among them, or a change to a request production holds refused for its data): dropped, never sent again (moldChangeRefused). */
 final?:boolean};
/** One of the CRM's own design files as stored (crm_mold_design_files): id is its crmFileId; the bytes are in the object store under
 *  objectKey until it is deleted; outbox what waits to reach production (the file, or its deletion). */
export type MoldDesignFileRow={id:string;requestId:string;memberId:string;name:string;kind:MoldDesignKind;contentType:string;size:number;sha256:string;objectKey:string|null;createdAt:string;deletedAt:string|null;outbox:'send'|'delete'|null;attempts:number;firstFailedAt:string|null;nextAttemptAt:string|null;lastAttemptAt:string|null;lastError:MoldError|null;remoteFileId:string|number|null;sentAt:string|null;version:number;
 /** design, quote or po (crm_mold_design_files.category, 0018): sent with design-files for quote and po only. */
 category:MoldFileCategory};
/** Where a design file stands for the reader: sent (production holds it), waiting (to be sent, on the timetable), held (until production
 *  holds the request itself), rejected (production refused it; the reason is shown), locked (the approvals were complete first; not sent),
 *  cancelled (the request was cancelled in the CRM, or in production: held, not sent unless production refuses the cancellation or its
 *  production manager restores the request, 2026-11-03), deleting (its deletion waits to
 *  reach production), off (the production link is off), production (attached in production), update (a quotation's or PO's file kept
 *  until production's update of 2026-11-03 is known to be live: never sent to the older application, which would take it as a design file). */
export type MoldDesignState='sent'|'waiting'|'held'|'rejected'|'locked'|'cancelled'|'deleting'|'off'|'production'|'update';
/** A design file as a reader receives it: href downloads it through the CRM (viewable: a PDF or an image, which may open inline with &inline=1);
 *  stopped: its sending or its deletion is no longer tried by itself (24 hours of failures, or production did not find the request), and
 *  waits for the requester's resend. error: the last failure, or why production refused the file or (state sent) its deletion. */
export type MoldDesignFileView={key:string;fileId:string|null;crmFileId:string|null;name:string;kind:MoldDesignKind;size:number|null;source:'crm'|'production';uploadedAt:string|null;state:MoldDesignState;error:MoldError|null;stopped:boolean;canDelete:boolean;href:string;viewable:boolean;category:MoldFileCategory;
 /** The customer's signature (the file the request's data names): labelled so, never deletable while the request names it. */
 signature?:true};
/** A design file of a request waiting for the sales manager, with its download through the CRM; signature: the CRM request's signature. */
export type MoldPendingDesignFile=MoldDesignFile&{href:string;viewable:boolean;signature?:true};
/** The customer's signature as a reader sees it: who signed and when, with the image through the CRM (href, null once its file is gone). */
/** Where the signature's image stands (2026-11-04): sent (production holds it), waiting (on its way: held until production holds the
 *  request, or on the timetable), stopped (its tries stopped after 24 hours or production did not find the request: the requester's resend
 *  starts it again), refused (production refused it, or it is gone: it will not be sent again). */
export type MoldSignatureState='sent'|'waiting'|'stopped'|'refused';
export type MoldSignatureView=MoldSignature&{href:string|null;state:MoldSignatureState};
export type MoldRequestRow={id:string;memberId:string;customerId:string;legacyOrderNo:number|null;data:MoldRequestData;accepted:MoldRequestData|null;cancelledAt:string|null;cancelReason:string;outbox:'send'|'cancel'|null;attempts:number;firstFailedAt:string|null;nextAttemptAt:string|null;lastAttemptAt:string|null;lastError:MoldError|null;remote:MoldRemote|null;remoteAt:string|null;createdBy:string;createdAt:string;updatedAt:string;version:number};
/** held: a request saved with a quotation or PO number while production's update is not known to be live (it cannot happen in normal
 *  use: the form asks for them only after it): kept, never sent to the older application, which would drop them silently. A page loaded
 *  before a release indexes its own names by this state, so the server never returns another value (a request kept for its quotation's
 *  or PO's file says so in sending.held, 2026-11-05). */
export type MoldSendingState='sent'|'waiting'|'rejected'|'off'|'held';
/** Why a request's own data waits in the CRM, beyond its state (2026-11-05): quote_file, a new request kept until its first quotation or
 *  PO file is attached; design_file (2026-11-08), one kept until its first design file (the customer's signature does not count) is
 *  attached (moldHeldFor). A new field, so a page loaded before 2026-11-05 reads the state it knows («بانتظار الإرسال») and nothing it
 *  cannot name; a page of 2026-11-05..07 knows quote_file alone and reads the state for design_file. */
export type MoldSendingHeld='quote_file'|'design_file';
/** What a reader sees of the quotation and PO (2026-11-05): missing, production marks the request as having neither a quotation file nor
 *  a PO file while finance has not approved it (quoteOrPoMissing). The numbers are no longer shown (production no longer shows them). */
export type MoldQuotePoView={missing:boolean};
/** One request as a reader receives it. designFiles: the CRM's and production's; can.attach / can.deleteFile: the requester may attach or
 *  delete design files (each file also says whether it may be deleted). unconfirmed: the specifications are the CRM's change production
 *  refused (production_only), not production's data (MoldRequestData). payment: as the CRM stored it (null: asked for before 2026-11-03). */
export type MoldRequestView={id:string;memberId:string;memberName:string;customerId:string;customerName:string;
 /** The request's delivery address (data.customer.address, 2026-11-09): the customer's registered address when it was asked for, or the
  *  one typed for this request; '' for a request stored without one. A new field: a page loaded before reads nothing of it. */
 customerAddress:string;crmNumber:number;requestedAt:string;legacyOrderNo:number|null;specs:MoldSpecs;payment:MoldPayment|null;unconfirmed:boolean;cancelled:boolean;cancelReason:string;
 /** The reasons of the request's earlier cancellations (the production manager restored it since): a new cancellation needs another. */
 cancelReasons:string[];
 sending:{state:MoldSendingState;outbox:'send'|'cancel'|null;attempts:number;nextAttemptAt:string|null;lastAttemptAt:string|null;error:MoldError|null;
  /** Kept in the CRM for its quotation's or PO's file (2026-11-05), or for its design file (2026-11-08); absent otherwise. */
  held?:MoldSendingHeld};
 remote:MoldRemote|null;remoteAt:string|null;editable:boolean;can:{edit:boolean;cancel:boolean;resend:boolean;approve:boolean;withdraw:boolean;attach:boolean;deleteFile:boolean};version:number;
 /** Every file of the request (design, quotation and PO), each with its category. */
 designFiles:MoldDesignFileView[];
 /** Production's quotation and PO flag (MoldQuotePoView), null while production's status carries none (it does not hold the request yet,
  *  or its application is older than the update of 2026-11-03). */
 quotePo:MoldQuotePoView|null;
 /** The customer's signature (2026-11-04); null for a request without one. */
 signature:MoldSignatureView|null;
 /** Asked for under the rule of 2026-11-08 (data.designRequired): its edit before the first send asks for a design file too, unless it
  *  has one that counts. A new field: a page loaded before reads nothing of it. */
 designRequired:boolean};
/** A request waiting for the sales manager, as production's pending route lists it: from the CRM, or registered in production itself. */
/** orderNo: null while production has not numbered it (the products update of 2026-11-05: every item waiting for the sales manager);
 *  requestRef: production's stable UUID, absent from an older application. A pending item is named by moldPendingKey, never by orderNo. */
export type MoldPendingItem={orderNo:number|null;requestRef?:string;crmRequestId:string|null;source:'crm'|'manual';requestedAt:string|null;waitingSince:string|null;enteredBy:string|null;
 customer:{crmNumber:number|null;name:string;address:string;city:string};salesman:{crmMemberId:string;name:string};specs:MoldSpecs;
 /** How the customer pays, as production holds it now (null: a request asked for before 2026-11-03). */
 payment:MoldPayment|null;revision:number|null;designFiles:MoldDesignFile[];
 /** From production's update of 2026-11-03 only: the quotation and PO numbers and their files as production holds them now. */
 quoteNo?:string;poNo?:string;quoteOrPoMissing?:boolean;quoteFiles?:MoldDesignFile[];poFiles?:MoldDesignFile[]};
/** The sales manager's list «طلبات بانتظار اعتمادي»; inCrm: the request is one of the CRM's own (it opens from here: in the list below
 *  when the manager or their team asked for it, else only from here while it waits for them, as one customer service asked for);
 *  designFiles: its design files (the request's own and production's), each downloaded through the CRM. */
export type MoldPendingAnswer={items:(Omit<MoldPendingItem,'designFiles'|'quoteFiles'|'poFiles'>&{inCrm:boolean;designFiles:MoldPendingDesignFile[];quoteFiles:MoldPendingDesignFile[];poFiles:MoldPendingDesignFile[];
 /** The CRM request's signature (2026-11-04), from the CRM's own row; null for none or a request registered in production. */
 signature:MoldSignature|null;
 /** Production's listing of the pending item holds the signature's image (only then is it said to be signed). */
 signatureDelivered:boolean})[];error:MoldError|null;at:string|null;
 /** How many of production's items could not be read (nothing names one: a request registered there with a malformed requestRef and no
  *  number, say); absent when none. The list says so, rather than hiding them silently. */
 unreadable?:number};
/** The waiting list as a page loaded before this release receives it (its GET carries no `refs=1`): that page keys every item, its errors
 *  and its approval by orderNo, a number it expects on each one (two items without one would share a React key and an error, and its
 *  approval would send orderNo null). So it gets only the items production has numbered (none, once the products update of 2026-11-05 is
 *  live: an item waits for the sales manager before production numbers it), and, when any was left out, the list's error bad_response,
 *  a code that page names («تعذّر تحديث القائمة الآن: رد غير متوقع من تطبيق الإنتاج») instead of «لا توجد طلبات بانتظار اعتمادك» (the
 *  same when production sent items that could not be read, which that page cannot name otherwise); its
 *  update notice asks it to reload. This release's page asks with refs=1 and gets every item. */
export function moldPendingForOldPage(pending:MoldPendingAnswer|null):MoldPendingAnswer|null{
 if(!pending||pending.items.every(item=>item.orderNo!==null)&&!pending.unreadable)return pending;
 return {...pending,items:pending.items.filter(item=>item.orderNo!==null),error:pending.error||{code:'bad_response',at:pending.at||new Date().toISOString()}};
}
/** quotePo: production's update of 2026-11-03 is known to be live (learned once, kept): the form asks for the quotation and PO numbers
 *  (one at least) and their files. */
export type MoldRequestsAnswer={generatedAt:string;linkReady:boolean;linkProblem:string;requests:MoldRequestView[];statusError:MoldError|null;canCreate:boolean;pending:MoldPendingAnswer|null;quotePo:boolean;
 /** The reader's new request, or changing edit, needs the customer's signature (a sales role, 2026-11-04). */
 signatureRequired:boolean};
/** How often the sales manager's open page asks for the waiting list again. */
export const MOLD_PENDING_REFRESH_MS=3*60_000;
/** Whether a request the sales manager approved from their list waits for them again: production lists it at the sales step since a
 *  later time than the copy they approved (attaching or deleting a design file undoes the approvals, as may a change made in
 *  production; a quotation's or PO's file no longer does, 2026-11-05). The same wait listed again (a list kept a minute, here or in another server process) is not. */
export function moldPendingAgain(copy:PendingNamed&Pick<MoldPendingItem,'waitingSince'>,items:(PendingNamed&Pick<MoldPendingItem,'waitingSince'>)[]){
 const since=Date.parse(copy.waitingSince||'')||0,key=moldPendingKey(copy);
 return items.some(item=>moldPendingKey(item)===key&&(Date.parse(item.waitingSince||'')||0)>since);
}
/** What names a pending item. */
type PendingNamed=Pick<MoldPendingItem,'orderNo'|'requestRef'|'crmRequestId'>;
/** A pending item's identity on the sales manager's page (its React key, «اعتمدتها الآن», its errors, its approval's retry key), never its
 *  order number (null until production approves it, and renumbered once: the products update of 2026-11-05): the CRM's request by its
 *  crmRequestId, one registered in the products application by its requestRef, and only an older application's (no requestRef) by its
 *  number. */
export function moldPendingKey(item:PendingNamed){
 return item.crmRequestId?'crm:'+item.crmRequestId:item.requestRef?'ref:'+item.requestRef:'order:'+String(item.orderNo);
}
/** How the sales manager's approval (approve-order, withdraw-order) and the item's file downloads name it, by the same rule. */
export function moldPendingTarget(item:PendingNamed):{crmRequestId:string}|{requestRef:string}|{orderNo:number}|null{
 return item.crmRequestId?{crmRequestId:item.crmRequestId}:item.requestRef?{requestRef:item.requestRef}:item.orderNo?{orderNo:item.orderNo}:null;
}
/** The production order number in words: the number from the latest status (or pending item), or, while production has given none
 *  (null: given when its production manager approves, 2026-11-05), «لم يأخذ رقمًا بعد (يأخذه عند اعتماد الإنتاج)»; '—' when there is no
 *  status yet (not sent) or a request cancelled before it had a number (it will never get one). */
/** The waiting list holds items production sent that could not be read (unreadable), said above the list with how many. */
export const moldPendingUnreadableText=(count:number,say:(ar:string,en:string)=>string)=>say('فيه '+count+' طلب من تطبيق الإنتاج ما اتقراش (بيانات ناقصة أو غير صحيحة) ومش ظاهر هنا؛ بلّغ مدير الإنتاج.',count+' request(s) from production could not be read (missing or invalid data) and are not shown; tell the production manager.');
export const MOLD_NO_ORDER_YET:[string,string]=['لم يأخذ رقمًا بعد (يأخذه عند اعتماد الإنتاج)','No number yet (given at production approval)'];
export function moldOrderNoText(source:{orderNo:number|null}|null|undefined,say:(ar:string,en:string)=>string,{cancelled=false}:{cancelled?:boolean}={}){
 if(!source)return '—';
 if(source.orderNo)return String(source.orderNo);
 return cancelled?'—':say(...MOLD_NO_ORDER_YET);
}

/** Every role has the page and asks (the owner, 2026-11-01: «الكل بيعمل طلب», customer service too). */
export const MOLD_ROLES=['rep','supervisor','manager','admin','customer_service','customer_service_manager'];
export const canUseMoldRequests=(role:string)=>MOLD_ROLES.includes(role);
export const canCreateMoldRequest=(me:Member)=>canUseMoldRequests(me.role);
/** Only the sales manager approves in the CRM (the products contract leaves the choice to the CRM; the owner chose the sales manager). */
export const canApproveMoldRequests=(me:Pick<Member,'role'>)=>me.role==='manager';
const SERVICE_ROLES=['customer_service','customer_service_manager'];

/** all: the reader's customer records when the route loaded them (the customers' regions, for moldApprovingManagerId). */
type Reader={me:Member;members:Member[];regionCustomerIds:Set<string>;all?:readonly {id:string;kind:string;data:Record<string,unknown>}[]};
const customerRegions=new WeakMap<object,Map<string,unknown>>();
/** A customer's region from the reader's records: found false when the records were not loaded or do not hold that customer. */
function customerRegion(c:Reader,customerId:string):{found:boolean;region?:unknown}{
 if(!c.all)return {found:false};
 let regions=customerRegions.get(c.all);
 if(!regions){regions=new Map(c.all.filter(record=>record.kind==='customer').map(record=>[record.id,record.data.region]));customerRegions.set(c.all,regions);}
 return regions.has(customerId)?{found:true,region:regions.get(customerId)}:{found:false};
}
const SALES_TEAM_ROLES=['supervisor','rep'];
/** The sales manager whose team a member belongs to (the owner, 2026-11-03: «يبان للمندوب طلباته بس ومدير المبيعات طلباته وطلبات
 *  فريقه»): a sales manager is their own; a supervisor or representative belongs to the first sales manager up their «المشرف» chain
 *  (supervisorId), at any depth through supervisors and representatives (a representative under a supervisor under the manager). ''
 *  for anyone else (customer service, the administrator), and for a chain that reaches no sales manager: a missing member, a link to
 *  another role, or a cycle (each member is passed once). */
export function moldTeamManagerId(memberId:string,members:Pick<Member,'id'|'role'|'supervisorId'>[]):string{
 const byId=new Map(members.map(member=>[member.id,member]));
 let member=byId.get(memberId);
 if(!member)return '';
 if(member.role==='manager')return member.id;
 const seen=new Set<string>();
 while(member&&SALES_TEAM_ROLES.includes(member.role)&&!seen.has(member.id)){
  seen.add(member.id);
  const next:Pick<Member,'id'|'role'|'supervisorId'>|undefined=member.supervisorId?byId.get(member.supervisorId):undefined;
  if(next?.role==='manager')return next.id;
  member=next;
 }
 return '';
}
/** Who sees which request in the list: everyone their own. A representative nothing more. A supervisor their representatives', a
 *  customer-service manager their team's, within their regions; the administrator all. The sales manager their team's (moldTeamManagerId)
 *  within their regions (the owner, 2026-11-03): no longer another manager's team's, customer service's or the administrator's, even
 *  those they approve (moldApprovesRequest: those show in «طلبات بانتظار اعتمادي» only, and open from there: canOpenMoldRequest in
 *  lib/mold-requests-server.ts). */
export function canReadMoldRequest(row:Pick<MoldRequestRow,'memberId'|'customerId'>,c:Reader){
 if(c.me.role==='admin'||row.memberId===c.me.id)return true;
 const inRegion=regionScope(c.me)==='all'||c.regionCustomerIds.has(row.customerId);
 if(c.me.role==='manager')return inRegion&&moldTeamManagerId(row.memberId,c.members)===c.me.id;
 if(c.me.role==='supervisor')return inRegion&&salesScopeMemberIds(c.members,c.me).has(row.memberId);
 if(c.me.role==='customer_service_manager')return inRegion&&c.members.some(member=>member.id===row.memberId&&SERVICE_ROLES.includes(member.role)&&member.supervisorId===c.me.id);
 return false;
}
/** Which of the CRM's own requests a sales manager approves (the owner, 2026-11-03), decided on the CRM's row (who asked, for which
 *  customer): its customer is in their regions, and whoever asked is the manager, in their team, or in no sales manager's team at all
 *  (customer service, the administrator, a supervisor or representative whose chain reaches no sales manager), whom every sales manager
 *  of the customer's region approves. Another sales manager's own request, or their team's, is theirs. «طلبات بانتظار اعتمادي» lists
 *  such a request while production holds it at the sales step (moldPendingFor), and the approval, its withdrawal and the approver's
 *  sheet follow the same rule. */
export function moldApprovesRequest(row:Pick<MoldRequestRow,'memberId'|'customerId'>,c:Reader){
 if(!canApproveMoldRequests(c.me))return false;
 if(regionScope(c.me)!=='all'&&!c.regionCustomerIds.has(row.customerId))return false;
 const manager=moldApprovingManagerId(row,c);
 return manager===c.me.id||manager==='';
}
/** The one sales manager who approves a request of their team (moldTeamManagerId), or '' when every sales manager of the customer's
 *  region does: no team, or a team manager who cannot approve it now (deactivated, or the customer is outside their regions, such as
 *  after their regions changed or for their own request elsewhere), so that no request is left with nobody to approve it (production
 *  cannot give this approval itself). */
export function moldApprovingManagerId(row:Pick<MoldRequestRow,'memberId'|'customerId'>,c:Reader){
 const owner=moldTeamManagerId(row.memberId,c.members),manager=owner?c.members.find(member=>member.id===owner):undefined;
 if(!manager||!manager.active)return '';
 const customer=customerRegion(c,row.customerId);
 return customer.found&&!memberCanAccessRegion(manager,customer.region)?'':owner;
}
/** An answer older than the status stored (a lower revision; one without a revision is never older): answers can cross, and an older
 *  one must not bring back approvals production has since undone. The SQL twin is newerRemote in lib/mold-requests-server.ts. */
export const moldRemoteOlder=(stored:Pick<MoldRemote,'revision'>|null,incoming:Pick<MoldRemote,'revision'>)=>stored?.revision!=null&&incoming.revision!=null&&stored.revision>incoming.revision;
/** Production accepts a cancellation, or a design file attached or deleted, only while the request is `received`; before production
 *  first saw it the CRM alone decides. The request's own data is another matter: moldNeverSent. */
export const moldEditable=(row:Pick<MoldRequestRow,'cancelledAt'|'remote'>)=>!row.cancelledAt&&(row.remote?row.remote.editable:true);
/** Waiting for the sales manager: production has it as received, at the sales step, with nothing changed in the CRM still to send. */
export function moldAwaitsSalesApproval(row:Pick<MoldRequestRow,'cancelledAt'|'remote'|'outbox'|'accepted'>){
 return !row.cancelledAt&&!row.outbox&&!!row.accepted&&row.remote?.status==='received'&&row.remote.waitingStep==='sales'&&row.remote.approvals?.required!==false;
}
/** The sales manager's approval may be withdrawn until production approves (the contract: 409 request_locked after that). */
export function moldSalesApprovalWithdrawable(row:Pick<MoldRequestRow,'cancelledAt'|'remote'|'outbox'>){
 const approvals=row.remote?.approvals;
 return !row.cancelledAt&&!row.outbox&&row.remote?.status==='received'&&!!approvals?.sales&&!approvals.production&&!approvals.admin;
}
/** A design file still on its way (its sending or its deletion due on the timetable): the approval waits for it, since its arrival
 *  undoes the approvals anyway. One production refused, or that stopped after 24 hours, holds nothing. */
export const moldDesignInFlight=(file:Pick<MoldDesignFileRow,'outbox'|'nextAttemptAt'>)=>!!file.outbox&&file.nextAttemptAt!==null;
/** Whether attaching or deleting the file undoes production's approvals (2026-11-05): a design file (the customer's signature among them)
 *  does; a quotation's or PO's file no longer does. */
export const moldFileResetsApprovals=(file:{category?:unknown})=>moldFileCategory(file)==='design';
/** A file on its way whose arrival undoes the approvals (a design file): the sales manager's approval, or its withdrawal, waits for it. A
 *  quotation's or PO's file on its way holds nothing (2026-11-05). */
export const moldApprovalWaitsFor=(file:Pick<MoldDesignFileRow,'outbox'|'nextAttemptAt'|'category'>)=>moldFileResetsApprovals(file)&&moldDesignInFlight(file);
/** The file's sending, or its deletion, stopped after 24 hours of failures (not refused): the requester's resend starts it again
 *  (MOLD_DESIGN_STOPPED_SQL in lib/mold-requests-server.ts says the same in SQL). */
export const moldDesignStopped=(file:Pick<MoldDesignFileRow,'outbox'|'nextAttemptAt'|'lastError'|'deletedAt'>)=>(file.outbox==='delete'||file.outbox==='send'&&!file.deletedAt)&&file.nextAttemptAt===null&&file.lastError?.final!==true;
/** Refused for good by production (or lost by the CRM): it never reached production and never will by itself (MOLD_DESIGN_REFUSED_SQL). */
export const moldDesignRefused=(file:Pick<MoldDesignFileRow,'outbox'|'nextAttemptAt'|'lastError'|'sentAt'>)=>file.outbox==='send'&&!file.sentAt&&file.nextAttemptAt===null&&file.lastError?.final===true;
/** Whether production may hold the file: sent, or a send was tried without a final refusal (a timeout may have arrived). Such a file is
 *  deleted through design-file-delete; any other is removed in the CRM alone. */
export const moldDesignMayBeRemote=(file:Pick<MoldDesignFileRow,'outbox'|'nextAttemptAt'|'lastError'|'sentAt'|'lastAttemptAt'>)=>!!file.sentAt||!!file.lastAttemptAt&&!moldDesignRefused(file);
/** The request has certainly never reached production (portable/mold-rules.mjs): only then may the CRM change its data. Sent (accepted,
 *  production's status, or an attempt that may have arrived) it is edited by the production manager in the products application only. */
export const moldNeverSent=(row:Pick<MoldRequestRow,'accepted'|'remote'|'lastAttemptAt'|'lastError'>)=>neverSent(row);
type HoldFile=Pick<MoldDesignFileRow,'id'|'category'|'deletedAt'|'outbox'|'nextAttemptAt'|'lastError'|'sentAt'>;
/** A file of the CRM that counts for the hold: not deleted, not refused for good. */
const liveFile=(file:HoldFile)=>!file.deletedAt&&!moldDesignRefused(file);
/** A quotation's or PO's file of the CRM that counts for the hold (2026-11-05). */
const holdsQuoteFile=(file:HoldFile)=>MOLD_QUOTE_FILE_CATEGORIES.includes(moldFileCategory(file))&&liveFile(file);
/** A design file of the CRM that counts for the hold (2026-11-08): not the customer's signature (the file the request's data names). */
const holdsDesignFile=(file:HoldFile,signatureId:unknown)=>moldFileCategory(file)==='design'&&liveFile(file)&&file.id!==signatureId;
/** Why a new request is kept in the CRM, not sent (null: it is not): its own data still to send, certainly never reached production (one
 *  that may have arrived goes on as it is: production's quoteOrPoMissing then says what is missing), and, of its files (the request's
 *  own, as loaded), quote_file: asked for under the rule of 2026-11-05 (data.fileRequired) and none is a quotation's or a PO's that
 *  counts; else design_file: asked for under the rule of 2026-11-08 (data.designRequired) and none is a design file that counts (the
 *  customer's signature, data.signature.fileId, does not). The quotation's file is said first when both are missing. MOLD_AWAITS_FILE_SQL
 *  (lib/mold-requests-server.ts) says the same in SQL (whether it is kept), and MOLD_HELD_FOR_SQL why. */
export function moldHeldFor(row:Pick<MoldRequestRow,'outbox'|'accepted'|'remote'|'lastAttemptAt'|'lastError'>&{data?:Pick<MoldRequestData,'fileRequired'|'designRequired'|'signature'>|null},files:HoldFile[]):MoldSendingHeld|null{
 if(row.outbox!=='send'||!moldNeverSent(row))return null;
 if(row.data?.fileRequired===true&&!files.some(holdsQuoteFile))return 'quote_file';
 const signatureId=(row.data?.signature as {fileId?:unknown}|undefined)?.fileId;
 if(row.data?.designRequired===true&&!files.some(file=>holdsDesignFile(file,signatureId)))return 'design_file';
 return null;
}
/** What the reader may do. edit: the requester, while the request has certainly never reached production (the server's update follows
 *  the same rule, in SQL too); cancel, attach and deleteFile: the requester while production still accepts changes (moldEditable).
 *  resend: the requester, for the request's own change (not while it waits for its quotation's, PO's or design file, moldHeldFor:
 *  attaching it sends it) or a
 *  file whose tries stopped. approve and withdraw wait for a design file on its way (moldApprovalWaitsFor), not for a quotation's or PO's.
 *  approver: the reader approves this request (the routes pass moldApprovesRequest; any sales manager when not given). */
export function moldPermissions(row:MoldRequestRow,me:Member,files:MoldDesignFileRow[]=[],approver=canApproveMoldRequests(me)){
 const own=row.memberId===me.id,open=moldEditable(row),settled=!files.some(moldApprovalWaitsFor);
 return {edit:own&&open&&moldNeverSent(row),cancel:own&&open,resend:own&&(!!row.outbox&&!moldHeldFor(row,files)||files.some(moldDesignStopped)),approve:approver&&settled&&moldAwaitsSalesApproval(row),withdraw:approver&&settled&&moldSalesApprovalWithdrawable(row),attach:own&&open,deleteFile:own&&open};
}
const designHref=(query:string)=>'/api/mold-requests/design-file?'+query;
/** A file's category as stored (a status stored before 2026-11-03 carries none: design). */
export const moldFileCategory=(file:{category?:unknown}):MoldFileCategory=>file.category==='quote'||file.category==='po'?file.category:'design';
/** Every file production lists for a request: its design files, then (from production's update of 2026-11-03) its quotation's and PO's,
 *  each with its category. A download names any of them by its fileId. */
export const moldListedFiles=(remote:Pick<MoldRemote,'designFiles'|'quoteFiles'|'poFiles'>|null|undefined):MoldDesignFile[]=>[
 ...(remote?.designFiles||[]).map(file=>({...file,category:moldFileCategory(file)})),...(remote?.quoteFiles||[]).map(file=>({...file,category:'quote' as const})),...(remote?.poFiles||[]).map(file=>({...file,category:'po' as const}))];
/** A quotation's or PO's file waits for production's update to be known as live (never sent to the older application). */
const awaitsUpdate=(file:Pick<MoldDesignFileRow,'category'|'outbox'>,quotePo:boolean)=>!quotePo&&file.outbox==='send'&&moldFileCategory(file)!=='design';
/** The files a request shows: the CRM's own (with where each stands) and those production lists that the CRM does not hold (production's
 *  own, or a CRM file production kept); a file the CRM deleted is hidden even while an older status still lists it. Oldest first. A file
 *  production refused is shown as refused whatever the link's state (it takes none of the places either way, as moldDesignCount says).
 *  Design files, the quotation's and the PO's alike, each with its category. quotePo: production's update of 2026-11-03 is known to be
 *  live (a quotation's or PO's file waits for it, state update). */
export function moldDesignFilesView(row:Pick<MoldRequestRow,'id'|'memberId'|'cancelledAt'|'remote'|'accepted'>&{data?:Pick<MoldRequestData,'signature'>},files:MoldDesignFileRow[],me:Pick<Member,'id'>,linkReady:boolean,quotePo=true):MoldDesignFileView[]{
 const own=row.memberId===me.id,open=moldEditable(row),listed=moldListedFiles(row.remote),known=new Set(files.map(file=>file.id)),out:MoldDesignFileView[]=[];
 // The customer's signature (2026-11-04): the file the request's data names, labelled so and never deleted while it names it.
 const signed=row.data?.signature?.fileId||'';
 const link=(key:string)=>designHref('id='+encodeURIComponent(row.id)+'&file='+encodeURIComponent(key));
 for(const file of files){
  if(file.deletedAt&&!file.outbox)continue;
  const remote=listed.find(entry=>entry.crmFileId===file.id),fileId=remote?remote.fileId:file.remoteFileId;
  const state:MoldDesignState=file.outbox==='delete'?'deleting':!file.outbox?'sent':moldDesignRefused(file)?(file.lastError?.code==='request_locked'?'locked':'rejected'):row.cancelledAt||row.remote?.status==='cancelled'?'cancelled':!linkReady?'off':!row.accepted?'held':awaitsUpdate(file,quotePo)?'update':'waiting';
  out.push({key:file.id,fileId:fileId===null||fileId===undefined?null:String(fileId),crmFileId:file.id,name:file.name,kind:file.kind,size:file.size,source:'crm',uploadedAt:file.createdAt,state,error:file.lastError,stopped:state!=='cancelled'&&state!=='update'&&moldDesignStopped(file),
   canDelete:own&&state!=='deleting'&&file.id!==signed&&(!moldDesignMayBeRemote(file)||open),href:link(file.id),viewable:file.kind!=='other',category:moldFileCategory(file),...(signed&&file.id===signed?{signature:true as const}:{})});
 }
 for(const entry of listed){
  if(entry.crmFileId&&known.has(entry.crmFileId))continue;
  out.push({key:String(entry.fileId),fileId:String(entry.fileId),crmFileId:entry.crmFileId,name:entry.name,kind:entry.kind,size:entry.size,source:entry.source,uploadedAt:entry.uploadedAt,state:entry.source==='production'?'production':'sent',error:null,stopped:false,canDelete:false,href:link(String(entry.fileId)),viewable:entry.kind!=='other',category:moldFileCategory(entry),...(signed&&entry.crmFileId===signed?{signature:true as const}:{})});
 }
 // By the instant each was attached: the CRM writes UTC, production Riyadh time with its offset.
 const at=(file:MoldDesignFileView)=>Date.parse(file.uploadedAt||'')||0;
 return out.sort((a,b)=>at(a)-at(b));
}
/** How many of a category's places a request's files take (10 design files, 5 of the quotation, 5 of the PO): the CRM's (not refused,
 *  not deleted, or whose deletion has not reached production) and production's that the CRM does not hold. */
export function moldDesignCount(row:Pick<MoldRequestRow,'remote'>,files:MoldDesignFileRow[],category:MoldFileCategory='design'){
 const known=new Set(files.map(file=>file.id));
 const crm=files.filter(file=>moldFileCategory(file)===category&&(!file.deletedAt||file.outbox==='delete')&&!moldDesignRefused(file)).length;
 return {crm,production:moldListedFiles(row.remote).filter(entry=>entry.category===category&&(!entry.crmFileId||!known.has(entry.crmFileId))).length,max:MOLD_CATEGORY_MAX_FILES[category]};
}
/** Which pending item a download names (app/api/mold-requests/design-file/route.ts, by moldPendingTarget): crm=<crmRequestId> for the
 *  CRM's request, ref=<requestRef> for one registered in the products application, order=<orderNo> only for an older application's (no
 *  requestRef; a link an open page already holds keeps working). */
export function moldPendingQuery(item:PendingNamed){
 const target=moldPendingTarget(item);
 return !target?'':'crmRequestId' in target?'crm='+encodeURIComponent(target.crmRequestId):'requestRef' in target?'ref='+target.requestRef:'order='+target.orderNo;
}
/** A pending item's files of one list, each downloaded through the CRM by the item's identity (moldPendingQuery). */
const pendingLinks=(item:PendingNamed,files:MoldDesignFile[]|undefined,category:MoldFileCategory):MoldPendingDesignFile[]=>(files||[]).map(file=>({...file,category,href:designHref(moldPendingQuery(item)+'&file='+encodeURIComponent(String(file.fileId))),viewable:file.kind!=='other'}));
/** The pending item's design files, each downloaded through the CRM by the item's identity; the CRM request's signature (signature: its
 *  crmFileId, as production lists the file the CRM sent) labelled so. */
export const moldPendingDesignFiles=(item:PendingNamed&Pick<MoldPendingItem,'designFiles'>,signature?:Pick<MoldSignature,'fileId'>|null):MoldPendingDesignFile[]=>pendingLinks(item,item.designFiles,'design').map(file=>signature?.fileId&&file.crmFileId===signature.fileId?{...file,signature:true as const}:file);
/** The pending item's files of every list (design, quotation, PO), each downloaded through the CRM by the item's identity. */
export const moldPendingFiles=(item:PendingNamed&Pick<MoldPendingItem,'designFiles'|'quoteFiles'|'poFiles'>,signature?:Pick<MoldSignature,'fileId'>|null)=>({designFiles:moldPendingDesignFiles(item,signature),quoteFiles:pendingLinks(item,item.quoteFiles,'quote'),poFiles:pendingLinks(item,item.poFiles,'po')});
/** A request's signature as the data stores it, or null (none, or not one: each field a text). */
export function moldSignatureOf(data:{signature?:unknown}|null|undefined):MoldSignature|null{
 const value=data?.signature as Partial<MoldSignature>|null|undefined;
 return value&&typeof value==='object'&&typeof value.signer==='string'&&typeof value.signedAt==='string'&&typeof value.fileId==='string'&&value.fileId?{signer:value.signer,signedAt:value.signedAt,fileId:value.fileId}:null;
}
/** The signature a reader sees, with its image through the CRM while its file is there (not deleted), and where that image stands
 *  (MoldSignatureState) from the request's files as the reader sees them (moldDesignFilesView). */
export function moldSignatureView(row:Pick<MoldRequestRow,'id'|'data'>,files:Pick<MoldDesignFileView,'crmFileId'|'state'|'stopped'|'href'>[]):MoldSignatureView|null{
 const signature=moldSignatureOf(row.data);
 if(!signature)return null;
 const file=files.find(item=>item.crmFileId===signature.fileId);
 const state:MoldSignatureState=!file||file.state==='rejected'||file.state==='locked'||file.state==='deleting'?'refused':file.state==='sent'?'sent':file.stopped?'stopped':'waiting';
 return {...signature,href:file&&file.state!=='deleting'?file.href:null,state};
}
/** Whether a request's data carries a quotation or PO number. */
export const moldHasQuotePo=(data:Pick<MoldRequestData,'quoteNo'|'poNo'>)=>!!(data.quoteNo||data.poNo);
/** The quotation and PO a reader sees (MoldQuotePoView): production's flag from the status object once it carries one (2026-11-05:
 *  missing means production has neither a quotation file nor a PO file and finance has not approved); none otherwise. The numbers, the
 *  request's own or production's, are not shown: production no longer shows or counts them. */
export function moldQuotePoView(row:Pick<MoldRequestRow,'remote'>):MoldQuotePoView|null{
 return row.remote&&moldQuotePoAnswered(row.remote)?{missing:row.remote.quoteOrPoMissing===true}:null;
}
/** One request as its reader receives it. cancelReasons: the reasons of its earlier cancellations (moldCancelReasons in
 *  lib/mold-requests-server.ts), so the screen asks for another before cancelling again. quotePo: production's update of 2026-11-03 is
 *  known to be live (a request saved with a number, or a quotation's or PO's file, waits for it otherwise). approver: the reader
 *  approves this request (moldApprovesRequest), so can.approve and can.withdraw are offered only for a request they may approve. */
export function moldRequestView(row:MoldRequestRow,me:Member,members:Member[],linkReady:boolean,files:MoldDesignFileRow[]=[],cancelReasons:string[]=[],quotePo=false,approver=canApproveMoldRequests(me)):MoldRequestView{
 const designFiles=moldDesignFilesView(row,files,me,linkReady,quotePo),held=moldHeldFor(row,files);
 return {id:row.id,memberId:row.memberId,memberName:members.find(m=>m.id===row.memberId)?.name||row.data.salesman.name,customerId:row.customerId,customerName:row.data.customer.name,customerAddress:typeof row.data.customer.address==='string'?row.data.customer.address:'',crmNumber:row.data.customer.crmNumber,
  requestedAt:row.data.requestedAt,legacyOrderNo:row.legacyOrderNo,specs:row.data.specs,payment:row.data.payment==='cash'||row.data.payment==='deferred'?row.data.payment:null,unconfirmed:row.accepted?.unconfirmed===true,cancelled:!!row.cancelledAt,cancelReason:row.cancelReason,cancelReasons,
  sending:{state:moldSendingState(row,linkReady,quotePo),outbox:row.outbox,attempts:row.attempts,nextAttemptAt:row.nextAttemptAt,lastAttemptAt:row.lastAttemptAt,error:row.lastError,...(held?{held}:{})},
  remote:row.remote,remoteAt:row.remoteAt,editable:moldEditable(row),can:moldPermissions(row,me,files,approver),version:row.version,designFiles,quotePo:moldQuotePoView(row),signature:moldSignatureView(row,designFiles),designRequired:row.data.designRequired===true};
}
/** quotePo: production's update of 2026-11-03 is known to be live; without it a request whose data carries a number is held, not sent.
 *  Always one of the five states every page knows: a request kept for its quotation's, PO's or design file reads waiting (or off), and
 *  says why in sending.held (moldRequestView). */
export function moldSendingState(row:Pick<MoldRequestRow,'outbox'|'lastError'>&{data?:Pick<MoldRequestData,'quoteNo'|'poNo'>},linkReady:boolean,quotePo=true):MoldSendingState{
 if(!row.outbox)return 'sent';
 if(!linkReady)return 'off';
 if(row.outbox==='send'&&!quotePo&&row.data&&moldHasQuotePo(row.data))return 'held';
 return row.lastError&&['invalid_payload','payload_too_large'].includes(row.lastError.code)?'rejected':'waiting';
}

export const moldStatusNames:Record<MoldStatusName,[string,string]>={received:['استلمه الإنتاج','Received by production'],confirmed:['اكتملت الاعتمادات','Approved'],in_production:['قيد التصنيع','In production'],produced:['تم التصنيع','Produced'],delivered:['تم التسليم للعميل','Delivered'],cancelled:['ملغى','Cancelled']};
export const moldSendingNames:Record<MoldSendingState,[string,string]>={sent:['وصل للإنتاج','Delivered to production'],waiting:['بانتظار الإرسال','Waiting to be sent'],rejected:['رفض الإنتاج البيانات','Production refused the data'],off:['الربط مع الإنتاج غير مفعَّل','The production link is off'],held:['بانتظار تحديث تطبيق المنتجات','Waiting for the products application update']};
/** sending.held quote_file in words (2026-11-05), said instead of the state's name by this release's pages. */
export const MOLD_QUOTE_FILE_HELD_NAME:[string,string]=['بانتظار ملف عرض السعر / الـ PO','Waiting for the quotation / PO file'];
/** A request production marks as having neither a quotation file nor a PO file while finance has not approved it (quoteOrPoMissing,
 *  2026-11-05): the representative attaches one in the CRM while the request is editable, or the production manager in the products
 *  application. */
export const MOLD_QUOTE_PO_MISSING_TEXT:[string,string]=['ناقص ملف عرض السعر / الـ PO','The quotation / PO file is missing'];
/** Beside it: for whoever may attach (the requester, while the request is editable); for anyone else reading one of the CRM's requests
 *  (whoever asked for it: a representative, customer service, the administrator); for one registered in the products application. */
export const MOLD_QUOTE_PO_MISSING_ATTACH:[string,string]=['أرفق ملف عرض السعر أو الـ PO من «ملفات عرض السعر» أو «ملفات الـ PO» تحت.','Attach the quotation or PO file under «Quotation files» or «PO files» below.'];
export const MOLD_QUOTE_PO_MISSING_OTHERS:[string,string]=['صاحب الطلب يرفقه من الـCRM، أو مدير الإنتاج من تطبيق المنتجات.','Whoever asked for it attaches it in the CRM, or the production manager in the products application.'];
export const MOLD_QUOTE_PO_MISSING_PRODUCTION:[string,string]=['مدير الإنتاج يرفقه من تطبيق المنتجات.','The production manager attaches it in the products application.'];
/** A new request needs at least one quotation or PO file (2026-11-05, every role): the form's refusal. */
export const MOLD_QUOTE_FILE_REQUIRED_TEXT:[string,string]=['أرفق ملف عرض السعر أو الـ PO (واحد على الأقل)','Attach the quotation or PO file (at least one)'];
/** A request kept in the CRM until its quotation or PO file is attached (sending.held quote_file): to its requester, who attaches it, and
 *  to a reader who cannot (the sales manager, the administrator). */
export const MOLD_QUOTE_FILE_WAITING_OTHERS:[string,string]=['بانتظار ما صاحب الطلب يرفق ملف عرض السعر / الـ PO','Waiting for whoever asked for it to attach the quotation / PO file'];
export const MOLD_QUOTE_FILE_WAITING_TEXT:[string,string]=['الطلب محفوظ في الـCRM ومش هيتبعت للإنتاج إلا لما ترفق ملف عرض السعر أو الـ PO (واحد على الأقل)؛ أول ما ترفقه يتبعت الطلب ثم ملفاته.','The request is saved in the CRM and is not sent to production until you attach the quotation or PO file (at least one); once you do, the request goes, then its files.'];
/** A new request needs at least one design file (2026-11-08, every role; the customer's signature does not count): the form's picker
 *  title and its refusal, sending.held design_file in words, and its explanation to the requester and to a reader who cannot attach. */
export const MOLD_DESIGN_FILE_PICKER_TITLE:[string,string]=['ملفات التصميم (ملف واحد على الأقل)','Design files (at least one)'];
export const MOLD_DESIGN_FILE_REQUIRED_TEXT:[string,string]=['أرفق ملف تصميم واحد على الأقل','Attach at least one design file'];
export const MOLD_DESIGN_FILE_HELD_NAME:[string,string]=['بانتظار ملف التصميم','Waiting for the design file'];
export const MOLD_DESIGN_FILE_WAITING_OTHERS:[string,string]=['بانتظار ما صاحب الطلب يرفق ملف التصميم','Waiting for whoever asked for it to attach the design file'];
export const MOLD_DESIGN_FILE_WAITING_TEXT:[string,string]=['الطلب محفوظ في الـCRM ومش هيتبعت للإنتاج إلا لما ترفق ملف تصميم واحد على الأقل (توقيع العميل مش بيتحسب)؛ أول ما ترفقه يتبعت الطلب ثم ملفاته.','The request is saved in the CRM and is not sent to production until you attach at least one design file (the customer\'s signature does not count); once you do, the request goes, then its files.'];
/** The request's delivery address (2026-11-09): the form's refusals, the same as the server's (MOLD_ADDRESS_REQUIRED, MOLD_ADDRESS_LONG). */
export const MOLD_ADDRESS_TEXT:{required:[string,string];long:[string,string]}={required:[MOLD_ADDRESS_REQUIRED,'Enter the delivery address'],long:[MOLD_ADDRESS_LONG,'The address is up to 300 characters']};
/** sending.held in words, its explanation to the requester (who attaches) and to a reader who cannot. */
export const moldHeldTexts:Record<MoldSendingHeld,{name:[string,string];waiting:[string,string];others:[string,string]}>={
 quote_file:{name:MOLD_QUOTE_FILE_HELD_NAME,waiting:MOLD_QUOTE_FILE_WAITING_TEXT,others:MOLD_QUOTE_FILE_WAITING_OTHERS},
 design_file:{name:MOLD_DESIGN_FILE_HELD_NAME,waiting:MOLD_DESIGN_FILE_WAITING_TEXT,others:MOLD_DESIGN_FILE_WAITING_OTHERS}};
/** The customer's signature in the representative's words (2026-11-04): the step, the pad, its refusals, the sheet's line. */
export const MOLD_SIGNATURE_TEXT={title:['توقيع العميل','Customer signature'] as [string,string],signed:['وقّع العميل','Signed by the customer'] as [string,string],
 signer:['اسم اللي بيوقّع','Name of the person signing'] as [string,string],clear:['امسح','Clear'] as [string,string],confirm:['تأكيد وإرسال','Confirm and send'] as [string,string],
 required:['توقيع العميل مطلوب قبل إرسال الطلب','The customer\'s signature is required before the request is sent'] as [string,string],
 blank:['التوقيع فاضي أو صغير قوي؛ خلّي العميل يوقّع بصباعه أو بالقلم','The signature is empty or too small; have the customer sign with a finger or a stylus'] as [string,string],
 signerRequired:['اكتب اسم اللي بيوقّع عن العميل (من 2 إلى 80 حرف)','Type the name of the person signing for the customer (2 to 80 characters)'] as [string,string],
 room:['توقيع العميل بيتحسب ملف من الـ 10؛ تقدر ترفع لحد 9 ملفات تصميم','The customer\'s signature takes one of the 10 places; up to 9 design files'] as [string,string],
 again:['اتغيّرت بيانات الطلب؛ لازم العميل يوقّع تاني','The request\'s data changed; the customer signs again'] as [string,string],
 /** Where the signature's image stands (MoldSignatureState), beside «وقّع العميل». */
 waiting:['التوقيع لسه ما وصلش للإنتاج','The signature has not reached production yet'] as [string,string],
 stopped:['التوقيع ما وصلش للإنتاج؛ اضغط «إعادة الإرسال»','The signature did not reach production; tap Resend'] as [string,string],
 refused:['التوقيع ما وصلش للإنتاج ومش هيتبعت تاني؛ ألغِ الطلب واطلبه من جديد بتوقيع جديد','The signature did not reach production and will not be sent again; cancel the request and ask again with a new signature'] as [string,string],
 /** «طلبات بانتظار اعتمادي»: the CRM's request names a signature that production's listing does not hold yet. */
 pendingMissing:['توقيع العميل لسه ما وصلش للإنتاج؛ استنى لما يوصل قبل الاعتماد','The customer\'s signature has not reached production yet; wait for it before approving'] as [string,string]};
/** Each kind of file, as the request's sheet and the sales manager's list group them. */
export const moldFileCategoryNames:Record<MoldFileCategory,[string,string]>={design:['ملفات التصميم','Design files'],quote:['ملفات عرض السعر','Quotation files'],po:['ملفات الـ PO','PO files']};
/** Where the request waits now, in the requester's words (the contract's waitingStep). */
export const moldWaitingNames:Record<MoldWaitingStep,[string,string]>={sales:['بانتظار اعتماد مدير المبيعات','Waiting for the sales manager\'s approval'],production:['بانتظار اعتماد الإنتاج','Waiting for production\'s approval'],admin:['بانتظار اعتماد المالية','Waiting for finance approval'],manufacturing:['في التصنيع','In manufacturing'],delivery:['بانتظار التسليم','Waiting for delivery'],done:['تم التسليم','Delivered'],cancelled:['ملغى','Cancelled']};
/** Each approval's name, shown after «اعتماد» (Approval:): the third, keyed `admin`, is finance's since yourrest-products 2026-11-03. */
export const moldApprovalNames:Record<'sales'|'production'|'admin',[string,string]>={sales:['مدير المبيعات','Sales manager'],production:['الإنتاج','Production'],admin:['المالية','Finance']};
/** How the customer pays, in the representative's words. */
export const moldPaymentNames:Record<MoldPayment,[string,string]>={cash:[MOLD_PAYMENTS.cash,'Cash'],deferred:[MOLD_PAYMENTS.deferred,'Deferred']};
/** A cancellation answered with the request not cancelled: production had restored it and this reason was used already (2026-11-03). */
export const MOLD_SAME_REASON_TEXT:[string,string]=['مدير الإنتاج رجّع الطلب؛ عشان تلغيه تاني اكتب سبب جديد','The production manager restored the request; to cancel it again, write a new reason'];
/** Why a request is active again after a cancellation (a stored error with code `restored`), in the representative's words; '' for any
 *  other error. cancellable: the reader may cancel it now (view.can.cancel); only then is a new reason asked for, never once the
 *  approvals are complete or production has started, nor for a reader who may not cancel it. */
export function moldRestoredText(error:Pick<MoldError,'code'|'reason'>|null|undefined,say:(ar:string,en:string)=>string,{cancellable=true}:{cancellable?:boolean}={}){
 if(error?.code!=='restored')return '';
 if(error.reason==='same_reason'&&cancellable)return say(...MOLD_SAME_REASON_TEXT)+'.';
 return (error.reason==='cancel_dropped'?say('رجّعه مدير الإنتاج بعد الإلغاء، فالإلغاء المنتظر لن يُعاد إرساله','The production manager restored it after the cancellation, so the waiting cancellation will not be sent again')
  :say('رجّعه مدير الإنتاج بعد الإلغاء','The production manager restored it after the cancellation'))+(cancellable?say('؛ عشان تلغيه تاني اكتب سبب جديد.','; to cancel it again, write a new reason.'):'.');
}
/** A sent request's change refused for good by production (409 request_locked, production_only): production holds the request with
 *  other data, which its production manager alone edits. The change is not tried again; the request says so (moldProductionOnly). */
export const moldProductionOnly=(error:Pick<MoldError,'code'|'reason'>|null|undefined)=>error?.code==='request_locked'&&error.reason===MOLD_PRODUCTION_ONLY;
/** The request's last change was refused for good (final: production_only, another 409, or a change to a request production holds
 *  refused for its data): dropped, never sent again; the request says so with the reason. */
export const moldChangeRefused=(error:Pick<MoldError,'code'|'reason'|'final'>|null|undefined)=>!!error&&(error.final===true||moldProductionOnly(error));

/** Why a call did not go through, in the representative's words; the code alone is stored (with production's reason, when it gave
 *  one: production_only). file: a design file's call (design-files, design-file), whose limit is 120 seconds, not 10. */
export function moldErrorText(code:string,say:(ar:string,en:string)=>string,{file=false,reason=''}:{file?:boolean;reason?:string}={}){
 const table:Record<string,[string,string]>={
  network:['تعذّر الوصول إلى تطبيق الإنتاج','Production could not be reached'],timeout:file?['لم يرد تطبيق الإنتاج خلال دقيقتين','Production did not answer within 2 minutes']:['لم يرد تطبيق الإنتاج خلال 10 ثوانٍ','Production did not answer within 10 seconds'],
  not_configured:['الربط مع الإنتاج غير مفعَّل','The production link is off'],invalid_url:['إعداد عنوان الربط في الـCRM غير صحيح','The link address in the CRM settings is invalid'],short_secret:['مفتاح الربط في إعدادات الـCRM غير صحيح','The link key in the CRM settings is invalid'],
  invalid_signature:['مفتاح الربط غير مطابق بين البرنامجين','The link key differs between the two applications'],stale_timestamp:['ساعة الخادم غير مضبوطة','The server clock is off'],
  invalid_payload:['رفض الإنتاج بعض البيانات','Production refused some data'],payload_too_large:['الطلب أكبر من المسموح','The request is too large'],request_locked:['بدأ الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا','Production has started; no more changes'],
  bad_response:['رد غير متوقع من تطبيق الإنتاج','Unexpected answer from production'],server_error:['خطأ في تطبيق الإنتاج','Production application error'],not_found:['الطلب غير موجود لدى الإنتاج','Production does not know this request'],
  [MOLD_PRODUCTION_ONLY]:MOLD_PRODUCTION_ONLY_TEXT,
 };
 const found=(reason===MOLD_PRODUCTION_ONLY?table[reason]:undefined)||table[code]||(/^http_5/.test(code)?table.server_error:undefined);
 return found?say(...found):say('تعذّر الاتصال بتطبيق الإنتاج','Production could not be reached');
}
export const moldDesignStateNames:Record<MoldDesignState,[string,string]>={sent:['وصل للإنتاج','Delivered to production'],waiting:['بانتظار الإرسال','Waiting to be sent'],held:['يُرسل بعد وصول الطلب للإنتاج','Sent once production has the request'],
 rejected:['رفض الإنتاج الملف','Production refused the file'],locked:['اكتملت الاعتمادات قبل وصوله؛ لم يُرسل','The approvals were complete first; not sent'],cancelled:['لن يُرسل: الطلب ملغى','Not sent: the request is cancelled'],deleting:['جارٍ حذفه من الإنتاج','Being deleted at production'],off:['الربط مع الإنتاج غير مفعَّل','The production link is off'],production:['من تطبيق الإنتاج','From production'],update:['بانتظار تحديث تطبيق المنتجات','Waiting for the products application update']};
/** Why a design file was refused (the CRM's own check, or production's answer), in the representative's words. category: the file's
 *  kind (its own limit: 10 design files, 5 of the quotation, 5 of the PO). */
export function moldDesignRefusalText(reason:string,say:(ar:string,en:string)=>string,category:MoldFileCategory='design'){
 const table:Record<string,[string,string]>={
  name:['اسم الملف غير مقبول: حتى 200 حرف، بلا \\ / < > : " | ? * ، وبصيغة من الصيغ المسموحة','The file name is not accepted: up to 200 characters, none of \\ / < > : " | ? *, and an allowed extension'],
  empty:['الملف فارغ','The file is empty'],not_pdf:['الملف ليس PDF فعلًا','The file is not really a PDF'],bad_image:['الصورة تالفة أو بصيغة غير مدعومة','The image is damaged or of an unsupported type'],
  too_many_pixels:['الصورة أكبر من 80 مليون نقطة','The image is larger than 80 million pixels'],too_large:['الملف أكبر من 25 ميجابايت','The file is larger than 25 MB'],payload_too_large:['الملف أكبر من 25 ميجابايت','The file is larger than 25 MB'],
  too_many_files:category==='quote'?['الحد 5 ملفات لعرض السعر (ملفاتك وملفات الإنتاج)','At most 5 quotation files a request (yours and production\'s)']
   :category==='po'?['الحد 5 ملفات للـ PO (ملفاتك وملفات الإنتاج)','At most 5 PO files a request (yours and production\'s)']:['الحد 10 ملفات للطلب (ملفاتك وملفات الإنتاج)','At most 10 files a request (yours and production\'s)'],
  not_document:['ملف عرض السعر أو الـ PO لازم يكون PDF أو صورة','A quotation or PO file must be a PDF or an image'],category:['نوع الملف غير مقبول','The kind of file is not accepted'],
  quote_po_update:['بانتظار تحديث تطبيق المنتجات','Waiting for the products application update'],
  signature_room:['المكان العاشر لتوقيع العميل؛ تقدر ترفع لحد 9 ملفات تصميم','The tenth place is the customer\'s signature; up to 9 design files'],
  crm_file_id_used:['رقم الملف مستخدم قبل كده لملف تاني أو لملف اتحذف؛ احذفه وأرفقه من جديد','The file\'s number was already used for another file or a deleted one; delete it and attach it again'],not_found:['الطلب غير موجود لدى الإنتاج بعد','Production does not hold the request yet'],
  request_locked:['اكتملت الاعتمادات؛ لم يعد تغيير ملفات الطلب ممكنًا','The approvals are complete; the files can no longer change'],file_missing:['نسخة الملف في الـCRM مفقودة؛ احذفه وأرفقه من جديد','The CRM copy of the file is missing; delete it and attach it again'],
 };
 const found=table[reason];
 return found?say(...found):say('رفض الإنتاج الملف','Production refused the file');
}
/** The contract's field names, for a refusal that names them. */
export const moldFieldNames:Record<string,[string,string]>={'specs.description':['الوصف','Description'],'specs.core':['العلب','Core'],'specs.vibrators':['الرجاجات','Vibrators'],'specs.model':['الموديل','Model'],'specs.halfBlock':['بلوكة النص','Half block'],'specs.moldWidth':['عرض القالب','Mold width'],'specs.gelbaSize':['مقاس الجلب','Gelba size'],'specs.moldNo':['رقم القالب','Mold no.'],'specs.quantity':['الكمية','Quantity'],'specs.designUrl':['رابط التصميم','Design link'],'specs.notes':['الملاحظات','Notes'],'customer.name':['اسم العميل','Customer name'],'customer.crmNumber':['كود يورست للعميل','Customer Yourrest code'],'customer.address':['عنوان التسليم','Delivery address'],'customer.city':['مدينة العميل','Customer city'],'salesman.name':['اسم المندوب','Salesman name'],'salesman.email':['بريد المندوب','Salesman email'],requestedAt:['تاريخ الطلب','Request date'],payment:['طريقة الدفع غير صحيحة','The payment method is not valid'],quoteNo:['رقم عرض السعر غير مقبول','The quotation number is not accepted'],poNo:['رقم الـ PO غير مقبول','The PO number is not accepted'],legacyOrderNo:['رقم الطلب في الشيت','Sheet order number'],crmRequestId:['رقم الطلب','Request id']};
/** YR-C-000027 -> 27: the customer's Yourrest code, the number the contract sends as customer.crmNumber. */
export function yourrestNumber(internalCode:unknown){const match=/^YR-C-(\d{1,10})$/.exec(String(internalCode||''));const value=match?Number(match[1]):NaN;return Number.isInteger(value)&&value>0&&value<=2147483647?value:null;}

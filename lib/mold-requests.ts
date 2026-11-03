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
// before its first send) needs at least one of the two numbers, kept in the request's data and sent with it; the quotation's and PO's
// files go with design-files and their category. What a request shows is production's (the status object, the pending item) once
// production holds it: its production manager adds and corrects them there. Before the update nothing of it is asked, shown or sent.
// Who sees which request (the owner, 2026-11-03): the representative their own only, the sales manager their own and their team's
// (canReadMoldRequest, moldTeamManagerId); what the sales manager approves (moldApprovesRequest) also takes customer service's and the
// administrator's requests in their regions, shown in «طلبات بانتظار اعتمادي» only. «رابط التصميم» is no longer asked for (the owner,
// 2026-11-03): a new request has none; an older request keeps its own, shown read-only and sent as it was.
import type {Member} from './crm';
import {salesScopeMemberIds} from './access';
import {regionScope} from './regions';
import {MOLD_STAGES,MOLD_STAGE_NAMES,MOLD_CORES,MOLD_MODELS,MOLD_HALF_BLOCKS,MOLD_PAYMENTS,MOLD_WAITING_STEPS,MOLD_CATEGORY_MAX_FILES,MOLD_PRODUCTION_ONLY,MOLD_PRODUCTION_ONLY_TEXT,moldNeverSent as neverSent,moldQuotePoAnswered} from '@/portable/mold-rules.mjs';

export {MOLD_STAGES,MOLD_STAGE_NAMES,MOLD_CORES,MOLD_MODELS,MOLD_HALF_BLOCKS,MOLD_PAYMENTS,MOLD_WAITING_STEPS};
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
export type MoldRemote={crmRequestId:string;orderNo:number|null;status:MoldStatusName;editable:boolean;moldSerial:string|null;productionDate:string|null;stages:Record<string,{done:boolean;at:string|null}>;stagesDone:number;stagesTotal:number;delivered:boolean;deliveryDate:string|null;updatedAt:string|null;revision:number|null;
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
  *  so a request without them is sent again exactly as first sent. */
 quoteNo?:string;poNo?:string;unconfirmed?:true};
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
export type MoldDesignFileView={key:string;fileId:string|null;crmFileId:string|null;name:string;kind:MoldDesignKind;size:number|null;source:'crm'|'production';uploadedAt:string|null;state:MoldDesignState;error:MoldError|null;stopped:boolean;canDelete:boolean;href:string;viewable:boolean;category:MoldFileCategory};
/** A design file of a request waiting for the sales manager, with its download through the CRM. */
export type MoldPendingDesignFile=MoldDesignFile&{href:string;viewable:boolean};
export type MoldRequestRow={id:string;memberId:string;customerId:string;legacyOrderNo:number|null;data:MoldRequestData;accepted:MoldRequestData|null;cancelledAt:string|null;cancelReason:string;outbox:'send'|'cancel'|null;attempts:number;firstFailedAt:string|null;nextAttemptAt:string|null;lastAttemptAt:string|null;lastError:MoldError|null;remote:MoldRemote|null;remoteAt:string|null;createdBy:string;createdAt:string;updatedAt:string;version:number};
/** held: a request saved with a quotation or PO number while production's update is not known to be live (it cannot happen in normal
 *  use: the form asks for them only after it): kept, never sent to the older application, which would drop them silently. */
export type MoldSendingState='sent'|'waiting'|'rejected'|'off'|'held';
/** The quotation and PO a reader sees: production's (from the status object, its production manager's additions and corrections
 *  included) once it carries them, else the CRM's own while production does not hold the request yet; missing: production marks the
 *  request as lacking both (its production manager adds one). */
export type MoldQuotePoView={quoteNo:string;poNo:string;missing:boolean;from:'production'|'crm'};
/** One request as a reader receives it. designFiles: the CRM's and production's; can.attach / can.deleteFile: the requester may attach or
 *  delete design files (each file also says whether it may be deleted). unconfirmed: the specifications are the CRM's change production
 *  refused (production_only), not production's data (MoldRequestData). payment: as the CRM stored it (null: asked for before 2026-11-03). */
export type MoldRequestView={id:string;memberId:string;memberName:string;customerId:string;customerName:string;crmNumber:number;requestedAt:string;legacyOrderNo:number|null;specs:MoldSpecs;payment:MoldPayment|null;unconfirmed:boolean;cancelled:boolean;cancelReason:string;
 /** The reasons of the request's earlier cancellations (the production manager restored it since): a new cancellation needs another. */
 cancelReasons:string[];
 sending:{state:MoldSendingState;outbox:'send'|'cancel'|null;attempts:number;nextAttemptAt:string|null;lastAttemptAt:string|null;error:MoldError|null};
 remote:MoldRemote|null;remoteAt:string|null;editable:boolean;can:{edit:boolean;cancel:boolean;resend:boolean;approve:boolean;withdraw:boolean;attach:boolean;deleteFile:boolean};version:number;
 /** Every file of the request (design, quotation and PO), each with its category. */
 designFiles:MoldDesignFileView[];
 /** The numbers to show (MoldQuotePoView), null when there is none to show: production holds the request and its status carries none
  *  (production's update not live yet). */
 quotePo:MoldQuotePoView|null};
/** A request waiting for the sales manager, as production's pending route lists it: from the CRM, or registered in production itself. */
export type MoldPendingItem={orderNo:number;crmRequestId:string|null;source:'crm'|'manual';requestedAt:string|null;waitingSince:string|null;enteredBy:string|null;
 customer:{crmNumber:number|null;name:string;address:string;city:string};salesman:{crmMemberId:string;name:string};specs:MoldSpecs;
 /** How the customer pays, as production holds it now (null: a request asked for before 2026-11-03). */
 payment:MoldPayment|null;revision:number|null;designFiles:MoldDesignFile[];
 /** From production's update of 2026-11-03 only: the quotation and PO numbers and their files as production holds them now. */
 quoteNo?:string;poNo?:string;quoteOrPoMissing?:boolean;quoteFiles?:MoldDesignFile[];poFiles?:MoldDesignFile[]};
/** The sales manager's list «طلبات بانتظار اعتمادي»; inCrm: the request is one of the CRM's own (it opens from here: in the list below
 *  when the manager or their team asked for it, else only from here while it waits for them, as one customer service asked for);
 *  designFiles: its design files (the request's own and production's), each downloaded through the CRM. */
export type MoldPendingAnswer={items:(Omit<MoldPendingItem,'designFiles'|'quoteFiles'|'poFiles'>&{inCrm:boolean;designFiles:MoldPendingDesignFile[];quoteFiles:MoldPendingDesignFile[];poFiles:MoldPendingDesignFile[]})[];error:MoldError|null;at:string|null};
/** quotePo: production's update of 2026-11-03 is known to be live (learned once, kept): the form asks for the quotation and PO numbers
 *  (one at least) and their files. */
export type MoldRequestsAnswer={generatedAt:string;linkReady:boolean;linkProblem:string;requests:MoldRequestView[];statusError:MoldError|null;canCreate:boolean;pending:MoldPendingAnswer|null;quotePo:boolean};
/** How often the sales manager's open page asks for the waiting list again. */
export const MOLD_PENDING_REFRESH_MS=3*60_000;
/** Whether a request the sales manager approved from their list waits for them again: production lists it at the sales step since a
 *  later time than the copy they approved (attaching or deleting a design file undoes the approvals, as may a change made in
 *  production). The same wait listed again (a list kept a minute, here or in another server process) is not. */
export function moldPendingAgain(copy:Pick<MoldPendingItem,'orderNo'|'waitingSince'>,items:Pick<MoldPendingItem,'orderNo'|'waitingSince'>[]){
 const since=Date.parse(copy.waitingSince||'')||0;
 return items.some(item=>item.orderNo===copy.orderNo&&(Date.parse(item.waitingSince||'')||0)>since);
}

/** Every role has the page and asks (the owner, 2026-11-01: «الكل بيعمل طلب», customer service too). */
export const MOLD_ROLES=['rep','supervisor','manager','admin','customer_service','customer_service_manager'];
export const canUseMoldRequests=(role:string)=>MOLD_ROLES.includes(role);
export const canCreateMoldRequest=(me:Member)=>canUseMoldRequests(me.role);
/** Only the sales manager approves in the CRM (the products contract leaves the choice to the CRM; the owner chose the sales manager). */
export const canApproveMoldRequests=(me:Pick<Member,'role'>)=>me.role==='manager';
const SERVICE_ROLES=['customer_service','customer_service_manager'];

type Reader={me:Member;members:Member[];regionCustomerIds:Set<string>};
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
 const manager=moldTeamManagerId(row.memberId,c.members);
 return manager===c.me.id||manager==='';
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
/** What the reader may do. edit: the requester, while the request has certainly never reached production (the server's update follows
 *  the same rule, in SQL too); cancel, attach and deleteFile: the requester while production still accepts changes (moldEditable).
 *  approver: the reader approves this request (the routes pass moldApprovesRequest; any sales manager when not given). */
export function moldPermissions(row:MoldRequestRow,me:Member,files:MoldDesignFileRow[]=[],approver=canApproveMoldRequests(me)){
 const own=row.memberId===me.id,open=moldEditable(row),settled=!files.some(moldDesignInFlight);
 return {edit:own&&open&&moldNeverSent(row),cancel:own&&open,resend:own&&(!!row.outbox||files.some(moldDesignStopped)),approve:approver&&settled&&moldAwaitsSalesApproval(row),withdraw:approver&&settled&&moldSalesApprovalWithdrawable(row),attach:own&&open,deleteFile:own&&open};
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
export function moldDesignFilesView(row:Pick<MoldRequestRow,'id'|'memberId'|'cancelledAt'|'remote'|'accepted'>,files:MoldDesignFileRow[],me:Pick<Member,'id'>,linkReady:boolean,quotePo=true):MoldDesignFileView[]{
 const own=row.memberId===me.id,open=moldEditable(row),listed=moldListedFiles(row.remote),known=new Set(files.map(file=>file.id)),out:MoldDesignFileView[]=[];
 const link=(key:string)=>designHref('id='+encodeURIComponent(row.id)+'&file='+encodeURIComponent(key));
 for(const file of files){
  if(file.deletedAt&&!file.outbox)continue;
  const remote=listed.find(entry=>entry.crmFileId===file.id),fileId=remote?remote.fileId:file.remoteFileId;
  const state:MoldDesignState=file.outbox==='delete'?'deleting':!file.outbox?'sent':moldDesignRefused(file)?(file.lastError?.code==='request_locked'?'locked':'rejected'):row.cancelledAt||row.remote?.status==='cancelled'?'cancelled':!linkReady?'off':!row.accepted?'held':awaitsUpdate(file,quotePo)?'update':'waiting';
  out.push({key:file.id,fileId:fileId===null||fileId===undefined?null:String(fileId),crmFileId:file.id,name:file.name,kind:file.kind,size:file.size,source:'crm',uploadedAt:file.createdAt,state,error:file.lastError,stopped:state!=='cancelled'&&state!=='update'&&moldDesignStopped(file),
   canDelete:own&&state!=='deleting'&&(!moldDesignMayBeRemote(file)||open),href:link(file.id),viewable:file.kind!=='other',category:moldFileCategory(file)});
 }
 for(const entry of listed){
  if(entry.crmFileId&&known.has(entry.crmFileId))continue;
  out.push({key:String(entry.fileId),fileId:String(entry.fileId),crmFileId:entry.crmFileId,name:entry.name,kind:entry.kind,size:entry.size,source:entry.source,uploadedAt:entry.uploadedAt,state:entry.source==='production'?'production':'sent',error:null,stopped:false,canDelete:false,href:link(String(entry.fileId)),viewable:entry.kind!=='other',category:moldFileCategory(entry)});
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
/** A pending item's files of one list, each downloaded through the CRM by its order number. */
const pendingLinks=(orderNo:number,files:MoldDesignFile[]|undefined,category:MoldFileCategory):MoldPendingDesignFile[]=>(files||[]).map(file=>({...file,category,href:designHref('order='+orderNo+'&file='+encodeURIComponent(String(file.fileId))),viewable:file.kind!=='other'}));
/** The pending item's design files, each downloaded through the CRM by its order number. */
export const moldPendingDesignFiles=(item:Pick<MoldPendingItem,'orderNo'|'designFiles'>):MoldPendingDesignFile[]=>pendingLinks(item.orderNo,item.designFiles,'design');
/** The pending item's files of every list (design, quotation, PO), each downloaded through the CRM by its order number. */
export const moldPendingFiles=(item:Pick<MoldPendingItem,'orderNo'|'designFiles'|'quoteFiles'|'poFiles'>)=>({designFiles:moldPendingDesignFiles(item),quoteFiles:pendingLinks(item.orderNo,item.quoteFiles,'quote'),poFiles:pendingLinks(item.orderNo,item.poFiles,'po')});
/** Whether a request's data carries a quotation or PO number. */
export const moldHasQuotePo=(data:Pick<MoldRequestData,'quoteNo'|'poNo'>)=>!!(data.quoteNo||data.poNo);
/** The quotation and PO a reader sees (MoldQuotePoView): production's from the status object once it carries them (its production
 *  manager's additions and corrections included), else the CRM's own while production does not hold the request yet; none otherwise. */
export function moldQuotePoView(row:Pick<MoldRequestRow,'data'|'accepted'|'remote'>):MoldQuotePoView|null{
 if(row.remote&&moldQuotePoAnswered(row.remote))return {quoteNo:row.remote.quoteNo||'',poNo:row.remote.poNo||'',missing:row.remote.quoteOrPoMissing===true,from:'production'};
 if(row.remote||row.accepted)return null;
 return {quoteNo:row.data.quoteNo||'',poNo:row.data.poNo||'',missing:false,from:'crm'};
}
/** One request as its reader receives it. cancelReasons: the reasons of its earlier cancellations (moldCancelReasons in
 *  lib/mold-requests-server.ts), so the screen asks for another before cancelling again. quotePo: production's update of 2026-11-03 is
 *  known to be live (a request saved with a number, or a quotation's or PO's file, waits for it otherwise). approver: the reader
 *  approves this request (moldApprovesRequest), so can.approve and can.withdraw are offered only for a request they may approve. */
export function moldRequestView(row:MoldRequestRow,me:Member,members:Member[],linkReady:boolean,files:MoldDesignFileRow[]=[],cancelReasons:string[]=[],quotePo=false,approver=canApproveMoldRequests(me)):MoldRequestView{
 return {id:row.id,memberId:row.memberId,memberName:members.find(m=>m.id===row.memberId)?.name||row.data.salesman.name,customerId:row.customerId,customerName:row.data.customer.name,crmNumber:row.data.customer.crmNumber,
  requestedAt:row.data.requestedAt,legacyOrderNo:row.legacyOrderNo,specs:row.data.specs,payment:row.data.payment==='cash'||row.data.payment==='deferred'?row.data.payment:null,unconfirmed:row.accepted?.unconfirmed===true,cancelled:!!row.cancelledAt,cancelReason:row.cancelReason,cancelReasons,
  sending:{state:moldSendingState(row,linkReady,quotePo),outbox:row.outbox,attempts:row.attempts,nextAttemptAt:row.nextAttemptAt,lastAttemptAt:row.lastAttemptAt,error:row.lastError},
  remote:row.remote,remoteAt:row.remoteAt,editable:moldEditable(row),can:moldPermissions(row,me,files,approver),version:row.version,designFiles:moldDesignFilesView(row,files,me,linkReady,quotePo),quotePo:moldQuotePoView(row)};
}
/** quotePo: production's update of 2026-11-03 is known to be live; without it a request whose data carries a number is held, not sent. */
export function moldSendingState(row:Pick<MoldRequestRow,'outbox'|'lastError'>&{data?:Pick<MoldRequestData,'quoteNo'|'poNo'>},linkReady:boolean,quotePo=true):MoldSendingState{
 if(!row.outbox)return 'sent';
 if(!linkReady)return 'off';
 if(row.outbox==='send'&&!quotePo&&row.data&&moldHasQuotePo(row.data))return 'held';
 return row.lastError&&['invalid_payload','payload_too_large'].includes(row.lastError.code)?'rejected':'waiting';
}

export const moldStatusNames:Record<MoldStatusName,[string,string]>={received:['استلمه الإنتاج','Received by production'],confirmed:['اكتملت الاعتمادات','Approved'],in_production:['قيد التصنيع','In production'],produced:['تم التصنيع','Produced'],delivered:['تم التسليم للعميل','Delivered'],cancelled:['ملغى','Cancelled']};
export const moldSendingNames:Record<MoldSendingState,[string,string]>={sent:['وصل للإنتاج','Delivered to production'],waiting:['بانتظار الإرسال','Waiting to be sent'],rejected:['رفض الإنتاج البيانات','Production refused the data'],off:['الربط مع الإنتاج غير مفعَّل','The production link is off'],held:['بانتظار تحديث تطبيق المنتجات','Waiting for the products application update']};
/** The quotation and PO numbers, in the representative's words (the second update of 2026-11-03). */
export const moldQuotePoNames:Record<'quoteNo'|'poNo',[string,string]>={quoteNo:['رقم عرض السعر','Quotation no.'],poNo:['رقم الـ PO','PO no.']};
/** A request production marks as lacking both numbers (quoteOrPoMissing): its production manager adds one there. */
export const MOLD_QUOTE_PO_MISSING_TEXT:[string,string]=['ناقص عرض السعر / الـ PO، يضيفه مدير الإنتاج','The quotation / PO is missing; the production manager adds it'];
/** At least one number, for a new request or an edit before its first send (the form and the server alike). */
export const MOLD_QUOTE_PO_REQUIRED_TEXT:[string,string]=['اكتب رقم عرض السعر أو رقم الـ PO (واحد على الأقل)','Type the quotation number or the PO number (at least one)'];
/** A sent request's change refused as production_only once numbers are part of the data: only the production manager adds one now. */
export const MOLD_QUOTE_PO_PRODUCTION_ONLY_TEXT:[string,string]=['كلّم مدير الإنتاج يضيف رقم عرض السعر / الـ PO','Ask the production manager to add the quotation / PO number'];
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
 *  one: production_only). file: a design file's call (design-files, design-file), whose limit is 120 seconds, not 10. quotePo: production's
 *  update of 2026-11-03 is live, so a production_only refusal adds who adds a quotation or PO number now. */
export function moldErrorText(code:string,say:(ar:string,en:string)=>string,{file=false,reason='',quotePo=false}:{file?:boolean;reason?:string;quotePo?:boolean}={}){
 const table:Record<string,[string,string]>={
  network:['تعذّر الوصول إلى تطبيق الإنتاج','Production could not be reached'],timeout:file?['لم يرد تطبيق الإنتاج خلال دقيقتين','Production did not answer within 2 minutes']:['لم يرد تطبيق الإنتاج خلال 10 ثوانٍ','Production did not answer within 10 seconds'],
  not_configured:['الربط مع الإنتاج غير مفعَّل','The production link is off'],invalid_url:['إعداد عنوان الربط في الـCRM غير صحيح','The link address in the CRM settings is invalid'],short_secret:['مفتاح الربط في إعدادات الـCRM غير صحيح','The link key in the CRM settings is invalid'],
  invalid_signature:['مفتاح الربط غير مطابق بين البرنامجين','The link key differs between the two applications'],stale_timestamp:['ساعة الخادم غير مضبوطة','The server clock is off'],
  invalid_payload:['رفض الإنتاج بعض البيانات','Production refused some data'],payload_too_large:['الطلب أكبر من المسموح','The request is too large'],request_locked:['بدأ الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا','Production has started; no more changes'],
  bad_response:['رد غير متوقع من تطبيق الإنتاج','Unexpected answer from production'],server_error:['خطأ في تطبيق الإنتاج','Production application error'],not_found:['الطلب غير موجود لدى الإنتاج','Production does not know this request'],
  [MOLD_PRODUCTION_ONLY]:MOLD_PRODUCTION_ONLY_TEXT,
 };
 const found=(reason===MOLD_PRODUCTION_ONLY?table[reason]:undefined)||table[code]||(/^http_5/.test(code)?table.server_error:undefined);
 const text=found?say(...found):say('تعذّر الاتصال بتطبيق الإنتاج','Production could not be reached');
 return quotePo&&(reason===MOLD_PRODUCTION_ONLY||code===MOLD_PRODUCTION_ONLY)?text+say('؛ ','; ')+say(...MOLD_QUOTE_PO_PRODUCTION_ONLY_TEXT):text;
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
  crm_file_id_used:['رقم الملف مستخدم قبل كده لملف تاني أو لملف اتحذف؛ احذفه وأرفقه من جديد','The file\'s number was already used for another file or a deleted one; delete it and attach it again'],not_found:['الطلب غير موجود لدى الإنتاج بعد','Production does not hold the request yet'],
  request_locked:['اكتملت الاعتمادات؛ لم يعد تغيير ملفات الطلب ممكنًا','The approvals are complete; the files can no longer change'],file_missing:['نسخة الملف في الـCRM مفقودة؛ احذفه وأرفقه من جديد','The CRM copy of the file is missing; delete it and attach it again'],
 };
 const found=table[reason];
 return found?say(...found):say('رفض الإنتاج الملف','Production refused the file');
}
/** The contract's field names, for a refusal that names them. */
export const moldFieldNames:Record<string,[string,string]>={'specs.description':['الوصف','Description'],'specs.core':['العلب','Core'],'specs.vibrators':['الرجاجات','Vibrators'],'specs.model':['الموديل','Model'],'specs.halfBlock':['بلوكة النص','Half block'],'specs.moldWidth':['عرض القالب','Mold width'],'specs.gelbaSize':['مقاس الجلب','Gelba size'],'specs.moldNo':['رقم القالب','Mold no.'],'specs.quantity':['الكمية','Quantity'],'specs.designUrl':['رابط التصميم','Design link'],'specs.notes':['الملاحظات','Notes'],'customer.name':['اسم العميل','Customer name'],'customer.crmNumber':['كود يورست للعميل','Customer Yourrest code'],'customer.address':['عنوان العميل','Customer address'],'customer.city':['مدينة العميل','Customer city'],'salesman.name':['اسم المندوب','Salesman name'],'salesman.email':['بريد المندوب','Salesman email'],requestedAt:['تاريخ الطلب','Request date'],payment:['طريقة الدفع غير صحيحة','The payment method is not valid'],quoteNo:['رقم عرض السعر غير مقبول','The quotation number is not accepted'],poNo:['رقم الـ PO غير مقبول','The PO number is not accepted'],legacyOrderNo:['رقم الطلب في الشيت','Sheet order number'],crmRequestId:['رقم الطلب','Request id']};
/** YR-C-000027 -> 27: the customer's Yourrest code, the number the contract sends as customer.crmNumber. */
export function yourrestNumber(internalCode:unknown){const match=/^YR-C-(\d{1,10})$/.exec(String(internalCode||''));const value=match?Number(match[1]):NaN;return Number.isInteger(value)&&value>0&&value<=2147483647?value:null;}

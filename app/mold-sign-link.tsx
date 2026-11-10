'use client';
// The link the customer signs a mold request from, and the signed copies of its PDFs, on the representative's side (the owner, 2026-11-10:
// «امكانية ارسال لينك بالpdf طلب القالب للتوقيع عليه»). A link's address is known once, in the answer of whatever made it (only its hash is
// kept by the server): this page keeps it in memory for the request (rememberSignLink) so the sheet offers «نسخ اللينك» and «إرسال واتساب»
// (to the customer's mobile when the request is linked to a CRM customer with one, else WhatsApp without a number); after a reload it is
// gone, and «إرسال لينك جديد» makes another (the old one stops working). While the request is still unsent the requester may also stop the
// link or have the customer sign on the device now. The card says the request waits for the customer's signature, when the link was made
// and until when it opens, or that it expired.
import React,{useCallback,useMemo,useState,useSyncExternalStore} from 'react';
import {Copy,Link2,Loader2,MessageCircle,PenLine,TriangleAlert,X} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {direction,getLanguage,t} from '@/lib/i18n';
import {definiteSubmitRejection,submitJson,SubmitError} from '@/lib/client-submit';
import {whatsappUrl,COMPANY_NAME,COMPANY_NAME_EN} from '@/lib/whatsapp';
import type {Row} from '@/lib/crm';
import {MOLD_SIGN_LINK_TEXT,moldNotSignedText,type MoldRequestView} from '@/lib/mold-requests';
import {MoldSigningStep,type SigningResult} from './mold-signature';
import {viewerFilesFromRequest} from '@/lib/mold-document-view';

type Say=(ar:string,en:string)=>string;
export type SignLinkMade={url:string;expiresAt:string};
const stamp=(iso:string|null|undefined)=>iso?new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'}):'—';
const messageOf=(error:unknown)=>error instanceof Error?error.message:'';

// ---- the links made while this page is open (their address is never stored)
const made=new Map<string,SignLinkMade>(),watchers=new Set<()=>void>();
let version=0;
/** Keeps the address of a link an answer carried (a create, an edit or «إرسال لينك جديد»), for its request. */
export function rememberSignLink(requestId:string,link:unknown){
 if(!link||typeof link!=='object')return;
 const {url,expiresAt}=link as {url?:unknown;expiresAt?:unknown};
 if(typeof url!=='string'||typeof expiresAt!=='string')return;
 made.set(requestId,{url,expiresAt});version++;watchers.forEach(watch=>watch());
}
const forgetSignLink=(requestId:string)=>{if(made.delete(requestId)){version++;watchers.forEach(watch=>watch());}};
const subscribe=(watch:()=>void)=>{watchers.add(watch);return()=>{watchers.delete(watch);};};
export function useSignLink(requestId:string){
 useSyncExternalStore(subscribe,()=>version,()=>0);
 return made.get(requestId)||null;
}

/** What the customer reads in WhatsApp: the Arabic and the same in English, with the link and its last moment. */
export function signLinkMessage(url:string,expiresAt:string){
 const until=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(expiresAt));
 return `${COMPANY_NAME}: ده لينك طلب تصنيع القالب علشان تراجعه وتراجع ملفاته وتوقّع عليه:\n${url}\nاللينك صالح لحد ${until}.`
  +`\n\n${COMPANY_NAME_EN}: here is the link to review the mold request and its files, and sign it:\n${url}\nThe link is valid until ${until}.`;
}
/** WhatsApp with the message: to the customer's mobile when the request is linked to a CRM customer who has one, else without a number. */
export function signLinkWhatsapp(url:string,expiresAt:string,phone:unknown){
 const text=signLinkMessage(url,expiresAt);
 return whatsappUrl(phone,text)||'https://wa.me/?text='+encodeURIComponent(text);
}

/** The card's line: waiting for the customer's signature, when the link was made and until when it opens, or that it expired. */
export function SignLinkLine({view,say}:{view:MoldRequestView;say:Say}){
 const signing=view.signing;
 if(!signing?.awaits)return null;
 const link=signing.link;
 return <small className="mold-sign-link-line" data-expired={link?.expired||undefined}><Link2 size={13} aria-hidden="true"/>
  {!link?say(...MOLD_SIGN_LINK_TEXT.none):link.expired?say(...MOLD_SIGN_LINK_TEXT.expired):say(...MOLD_SIGN_LINK_TEXT.sent)+' '+stamp(link.sentAt)+' · '+say(...MOLD_SIGN_LINK_TEXT.expires)+' '+stamp(link.expiresAt)}</small>;
}

/** The signed copies on the request's sheet (2026-11-10): how many, how the customer signed, the PDFs that got none and why, and those
 *  attached after the signature (no copy: the customer did not see them). Nothing for a signature without its block (asked before). */
export function MoldSigningNotes({view,say}:{view:MoldRequestView;say:Say}){
 const signing=view.signing;
 if(!signing?.stamped)return null;
 return <div className="mold-signing-notes" role="status">
  {signing.via==='link'&&<p><Link2 size={14} aria-hidden="true"/>{say(...MOLD_SIGN_LINK_TEXT.viaLink)}</p>}
  {!!signing.copies&&<p><PenLine size={14} aria-hidden="true"/>{say(...MOLD_SIGN_LINK_TEXT.copies)}: <b>{signing.copies}</b></p>}
  {signing.skipped.map((item,index)=><p key={'s'+index} className="mold-signing-skipped"><TriangleAlert size={14} aria-hidden="true"/><span>{moldNotSignedText(item.name,item.reason,say)}</span></p>)}
  {!!signing.after.length&&<p className="mold-signing-after"><TriangleAlert size={14} aria-hidden="true"/><span>{say(...MOLD_SIGN_LINK_TEXT.after)} {signing.after.map((name,index)=><bdi key={index}>{index?'، ':''}{name}</bdi>)}</span></p>}
 </div>;
}

/** One write about the link (a new one, stopping it, or the customer's signature on the device): a retry after an unclear failure keeps its
 *  identifier, so it is done once. */
function useLinkAction(onView:(view:MoldRequestView)=>void){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[fields,setFields]=useState<Record<string,string>>({}),[attempts]=useState(()=>new Map<string,string>());
 const run=useCallback(async(body:Record<string,unknown>)=>{
  setBusy(true);setError('');setFields({});
  const text=JSON.stringify(body);if(!attempts.has(text))attempts.set(text,crypto.randomUUID());
  try{
   const reply=await submitJson<{request:MoldRequestView;link?:unknown}>('/api/mold-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:attempts.get(text)})},{language:getLanguage()});
   attempts.delete(text);
   if(reply.link)rememberSignLink(reply.request.id,reply.link);
   onView(reply.request);return true;
  }catch(failure){
   const reply=failure instanceof SubmitError?failure.body as {request?:MoldRequestView;fields?:Record<string,string>}|null:null;
   if(reply?.fields)setFields(reply.fields);
   setError(messageOf(failure));if(definiteSubmitRejection(failure))attempts.delete(text);
   if(reply?.request)onView(reply.request);
   return false;
  }finally{setBusy(false);}
 },[attempts,onView]);
 return {run,busy,error,fields};
}

/** The sheet's panel while the request waits for the customer's signature: the link's state, its address once made here (copy, WhatsApp),
 *  a new link, stopping it, or the customer's signature on the device now. customers: the CRM's customers the page holds (the mobile). */
export function MoldSignLinkPanel({view,customers,summary,onView,say}:{view:MoldRequestView;customers:Row[];summary:[string,React.ReactNode][];onView:(view:MoldRequestView)=>void;say:Say}){
 const signing=view.signing,fresh=useSignLink(view.id),action=useLinkAction(onView),[copied,setCopied]=useState(false),[signingNow,setSigningNow]=useState(false);
 const sign=useLinkAction(next=>{onView(next);if(!next.signing?.awaits)setSigningNow(false);});
 // What the customer reads before signing on the device (2026-11-10): the request's own uploaded files, page after page.
 const documents=useMemo(()=>viewerFilesFromRequest(view.designFiles),[view.designFiles]);
 if(!signing?.awaits)return null;
 const link=signing.link,active=!!link&&!link.expired,shown=active&&fresh&&fresh.expiresAt===link.expiresAt?fresh:null;
 const phone=customers.find(row=>row.id===view.customerId)?.data.phone;
 const copy=async()=>{
  if(!shown)return;
  try{await navigator.clipboard.writeText(shown.url);}catch{
   const field=document.createElement('textarea');field.value=shown.url;field.setAttribute('readonly','');field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.select();try{document.execCommand('copy');}catch{/* the address stays shown to copy by hand */}field.remove();
  }
  setCopied(true);window.setTimeout(()=>setCopied(false),2500);
 };
 const renew=()=>void action.run({action:'signature-link',op:'new',id:view.id,version:view.version});
 const stop=()=>void action.run({action:'signature-link',op:'cancel',id:view.id,version:view.version}).then(done=>{if(done)forgetSignLink(view.id);});
 return <section className="mold-sign-link" aria-label={say(...MOLD_SIGN_LINK_TEXT.title)} data-state={!link?'none':link.expired?'expired':'active'}>
  <h3 className="mold-subtitle"><Link2 size={16} aria-hidden="true"/>{say(...MOLD_SIGN_LINK_TEXT.title)}</h3>
  {!link?<p className="mold-specs-note">{say(...MOLD_SIGN_LINK_TEXT.none)}</p>
   :link.expired?<p className="mold-sign-link-expired" role="status"><TriangleAlert size={15} aria-hidden="true"/>{say(...MOLD_SIGN_LINK_TEXT.expired)} <small>({say(...MOLD_SIGN_LINK_TEXT.expires)} {stamp(link.expiresAt)})</small></p>
   :<p className="mold-sign-link-times">{say(...MOLD_SIGN_LINK_TEXT.sent)}: <bdi dir="ltr">{stamp(link.sentAt)}</bdi> · {say(...MOLD_SIGN_LINK_TEXT.expires)}: <bdi dir="ltr">{stamp(link.expiresAt)}</bdi></p>}
  {shown&&<div className="mold-sign-link-url">
   <input readOnly dir="ltr" value={shown.url} aria-label={say(...MOLD_SIGN_LINK_TEXT.title)} onFocus={event=>event.currentTarget.select()}/>
   <div className="mold-actions">
    <button type="button" className="btn subtle" onClick={()=>void copy()}><Copy size={16} aria-hidden="true"/>{copied?say(...MOLD_SIGN_LINK_TEXT.copied):say(...MOLD_SIGN_LINK_TEXT.copy)}</button>
    <a className="btn primary" href={signLinkWhatsapp(shown.url,shown.expiresAt,phone)} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} aria-hidden="true"/>{say(...MOLD_SIGN_LINK_TEXT.whatsapp)}</a>
   </div></div>}
  {active&&!shown&&<p className="mold-specs-note">{say(...MOLD_SIGN_LINK_TEXT.hidden)}</p>}
  {action.error&&<p className="form-error" role="alert">{t(action.error)}</p>}
  {view.can.link&&<div className="mold-actions">
   <button type="button" className="btn subtle" disabled={action.busy} onClick={renew}>{action.busy?<Loader2 className="spin" size={16}/>:<Link2 size={16}/>}{say(...MOLD_SIGN_LINK_TEXT.renew)}</button>
   {active&&<button type="button" className="btn subtle" disabled={action.busy} onClick={stop}><X size={16} aria-hidden="true"/>{say(...MOLD_SIGN_LINK_TEXT.cancel)}</button>}
   <button type="button" className="btn subtle" disabled={action.busy} onClick={()=>setSigningNow(true)}><PenLine size={16} aria-hidden="true"/>{say(...MOLD_SIGN_LINK_TEXT.device)}</button>
  </div>}
  {signingNow&&<Dialog open onOpenChange={open=>{if(!open&&!sign.busy)setSigningNow(false);}}>
   <DialogContent className="mold-dialog" dir={direction()}>
    <DialogTitle>{say(...MOLD_SIGN_LINK_TEXT.device)}</DialogTitle>
    <DialogDescription>{say('العميل بيوقّع دلوقتي على الجهاز بدل اللينك؛ اللينك بيبطل والطلب بيتبعت للإنتاج.','The customer signs now on the device instead of the link; the link stops working and the request goes to production.')}</DialogDescription>
    <MoldSigningStep summary={summary} documents={documents} busy={sign.busy} error={sign.error} fields={sign.fields} say={say} onBack={()=>setSigningNow(false)}
     onConfirm={(signature:SigningResult)=>void sign.run({action:'sign',id:view.id,version:view.version,signature})}/>
   </DialogContent>
  </Dialog>}
 </section>;
}

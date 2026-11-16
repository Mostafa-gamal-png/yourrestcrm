'use client';
import {useRef,useState} from 'react';
import {LifeBuoy,Loader2,ExternalLink} from 'lucide-react';
import {submitJson,definiteSubmitRejection} from '@/lib/client-submit';
import {getLanguage,t,useLanguage} from '@/lib/i18n';
import {supportChannels,supportChannelsEn} from '@/lib/support';
import {OPPORTUNITY_SUPPORT_PROBLEMS,opportunitySupportProblemKey,type OpportunitySupportCheck} from '@/lib/support-opportunity';
import VoiceField from './voice-field';
import './opportunity-support.css';

type Say=(ar:string,en:string)=>string;
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof (error as {message:unknown}).message==='string'?(error as {message:string}).message:'';

/** «طلب مساندة» inside an opportunity (the owner, 2026-11-16, item 3 of the GSCO list; lib/support-opportunity.ts): in the sheet of a
 *  customer-service request («الاعتماد والتكليف») for the administrator and the sales team while the opportunity is open. It asks the server
 *  first (GET /api/support/opportunity): a customer not in the list and an open request are said before any form, and the open request can
 *  be opened instead; otherwise the reason and the preferred way open a request in «التواصل مع العملاء» (POST /api/support), which follows
 *  the support chain's stages, targets and escalation from there. A retry after an unclear failure keeps its identifier, so it never opens two. */
export function OpportunitySupport({caseId,onOpenRequest,onSent}:{caseId:string;onOpenRequest?:(id:string)=>void;onSent?:()=>Promise<void>|void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [open,setOpen]=useState(false),[found,setFound]=useState<OpportunitySupportCheck|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [reason,setReason]=useState(''),[channel,setChannel]=useState('any'),[busy,setBusy]=useState(false),[sent,setSent]=useState('');
 const lock=useRef(false),attempt=useRef<{body:string;key:string}|null>(null);
 async function check(){
  setLoading(true);setError('');setFound(null);
  try{setFound(await submitJson<OpportunitySupportCheck>('/api/support/opportunity?id='+encodeURIComponent(caseId),{cache:'no-store'},{language:getLanguage()}));}
  catch(failure){setError(messageOf(failure)||say('تعذر التحقق من الفرصة. أعد المحاولة.','The opportunity could not be checked. Retry.'));}
  finally{setLoading(false);}
 }
 function start(){setOpen(true);setSent('');void check();}
 async function submit(){
  if(lock.current||!found?.customer||!found.canAsk)return;
  const fields={action:'request',origin:'rep',opportunityId:caseId,customerId:found.customer.id,customerVersion:found.customer.version,note:reason.trim(),channel};
  const body=JSON.stringify(fields);if(attempt.current?.body!==body)attempt.current={body,key:crypto.randomUUID()};
  lock.current=true;setBusy(true);setError('');
  try{
   const result=await submitJson<{ok:boolean;id?:string}>('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,requestId:attempt.current.key})},{language:getLanguage()});
   attempt.current=null;setSent(String(result.id||''));setOpen(false);setReason('');setChannel('any');await onSent?.();
  }catch(failure){
   setError(messageOf(failure));if(definiteSubmitRejection(failure))attempt.current=null;
   // The server refused because the opportunity or its customer changed (an open request appeared, the opportunity closed): read it again.
   if(failure&&typeof failure==='object'&&'status' in failure&&(failure as {status:number}).status===409)void check();
  }finally{lock.current=false;setBusy(false);}
 }
 const problem=found?opportunitySupportProblemKey(found):null;
 const pending=found?.openRequest||null;
 return <section className="opportunity-support" aria-label={say('طلب مساندة','Request support')} data-opportunity-support={caseId}>
  {!open&&<div className="service-button-row"><button type="button" className="btn subtle" onClick={start} data-opportunity-support-start><LifeBuoy size={16} aria-hidden="true"/>{say('طلب مساندة','Request support')}</button></div>}
  {sent&&!open&&<div className="opportunity-support-sent" role="status" data-opportunity-support-sent><b>{say('أُرسل طلب المساندة إلى «التواصل مع العملاء»، وتتابعه خدمة العملاء من هناك.','The support request was sent to «Customer contact»; customer service follows it there.')}</b>{onOpenRequest&&<button type="button" className="btn subtle small" onClick={()=>onOpenRequest(sent)}><ExternalLink size={15} aria-hidden="true"/>{say('فتح الطلب','Open the request')}</button>}</div>}
  {open&&<div className="opportunity-support-card">
   <h4>{say('طلب مساندة من خدمة العملاء','Ask customer service for support')}</h4>
   <p className="form-note">{say('يُرسل الطلب إلى «التواصل مع العملاء»: يتولاه أحد ممثلي خدمة العملاء ويتواصل مع العميل، ثم يعتمده مدير خدمة العملاء ويحيله إلى المبيعات. لكل مرحلة وقت محدد، ويظهر تأخرها لمن فوق المتأخر.','The request goes to «Customer contact»: a customer-service member takes it and contacts the customer, then the customer-service manager approves it and hands it to sales. Each stage has a set time, and a late stage is shown to whoever is above the one late.')}</p>
   {loading&&<p role="status"><Loader2 size={16} className="spin" aria-hidden="true"/> {say('جارٍ التحقق من الفرصة','Checking the opportunity')}</p>}
   {error&&<div className="form-error" role="alert">{t(error)}</div>}
   {found&&problem&&<div className="opportunity-support-problem" role="alert" data-opportunity-support-problem={problem}><p>{say(...OPPORTUNITY_SUPPORT_PROBLEMS[problem])}</p>
    {pending&&pending.readable&&onOpenRequest&&<div className="service-button-row"><button type="button" className="btn subtle small" onClick={()=>onOpenRequest(pending.id)} data-opportunity-support-open-request><ExternalLink size={15} aria-hidden="true"/>{say('فتح الطلب المفتوح','Open the open request')}</button></div>}</div>}
   {found&&found.canAsk&&found.customer&&<fieldset disabled={busy} className="support-form">
    <p className="opportunity-support-facts">{say('العميل','Customer')}: <b>{found.customer.name}</b>{found.opportunity.number!==null&&<> · {say('رقم الطلب','Request number')}: <bdi>{found.opportunity.number}</bdi></>}</p>
    <VoiceField label={say('سبب المساندة','Reason for support')} marked multiline rows={3} value={reason} onChange={setReason} contextKey={'opportunity-support:'+caseId} inputProps={{maxLength:2000,placeholder:say('مثال: العميل لا يرد على اتصالاتي، اسألوه عن موعد مناسب للزيارة','For example: the customer is not answering my calls, ask for a suitable visit date')}}/>
    <label className="field"><span>{say('وسيلة التواصل المفضلة','Preferred way to reach them')}</span><select value={channel} onChange={event=>setChannel(event.target.value)}>{Object.keys(supportChannels).map(key=><option key={key} value={key}>{say(supportChannels[key],supportChannelsEn[key]||key)}</option>)}</select></label>
    <div className="service-button-row"><button type="button" className="btn primary" disabled={reason.trim().length<3} onClick={()=>void submit()} data-opportunity-support-send>{busy?<Loader2 className="spin" size={16} aria-hidden="true"/>:<LifeBuoy size={16} aria-hidden="true"/>}{say('إرسال الطلب','Send the request')}</button><button type="button" className="btn subtle" onClick={()=>{setOpen(false);setError('');}}>{say('إلغاء','Cancel')}</button></div>
   </fieldset>}
   {(problem||(error&&!found))&&<div className="service-button-row"><button type="button" className="btn subtle small" onClick={()=>{setOpen(false);setError('');}}>{say('إغلاق','Close')}</button></div>}
  </div>}
 </section>;
}

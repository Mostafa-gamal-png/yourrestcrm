'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {CheckCircle2,Clock3,Loader2,MessageCircle,MessageSquareWarning,PhoneCall,Search} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {t,useLanguage,direction,getLanguage} from '@/lib/i18n';
import {definiteSubmitRejection,submitJson} from '@/lib/client-submit';
import {roles,today,type Member,type Row} from '@/lib/crm';
import {COMPLAINT_DEMAND_MAX,COMPLAINT_TEXT_MAX,canRegisterComplaint,closureOutcomes,closureOutcomesEn,complaintActions,complaintActionsEn,complaintCategories,complaintCategoriesEn,complaintChannels,complaintChannelsEn,complaintGroups,complaintSeverities,complaintSeveritiesEn,complaintStatusLabels,complaintStatusLabelsEn,complaintsOfCustomer,isOpenComplaint,resolutionOutcomes,resolutionOutcomesEn,type ComplaintEntry,type ComplaintGroupId} from '@/lib/complaints';
import {contactLinks} from '@/lib/support';
import {complaintMessage,validContactNumber,whatsappNumber,whatsappUrl} from '@/lib/whatsapp';
import {hoursText} from './service-queue';
import VoiceField from './voice-field';
import './complaints-panel.css';

type Say=(ar:string,en:string)=>string;
export type ComplaintsData={generatedAt:string;complaints:ComplaintEntry[];counts:{complaints:number;open:number;badge:number}};
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof (error as {message:unknown}).message==='string'?(error as {message:string}).message:'';
const stamp=(iso:string)=>iso?new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Riyadh'}):'—';
const label=(ar:Record<string,string>,en:Record<string,string>,key:string,say:Say)=>say(ar[key]||key,en[key]||key);
const categoryText=(key:string,say:Say)=>label(complaintCategories,complaintCategoriesEn,key,say);
const channelText=(key:string,say:Say)=>label(complaintChannels,complaintChannelsEn,key,say);
const severityText=(key:string,say:Say)=>label(complaintSeverities,complaintSeveritiesEn,key,say);
const actionText=(key:string,say:Say)=>label(complaintActions,complaintActionsEn,key,say);
const resolutionText=(key:string,say:Say)=>label(resolutionOutcomes,resolutionOutcomesEn,key,say);
const closureText=(key:string,say:Say)=>label(closureOutcomes,closureOutcomesEn,key,say);
/** Where the complaint stands, in words: the status, refined while the representative holds it. */
const stateText=(entry:ComplaintEntry,say:Say)=>entry.status==='assigned'?(entry.stage==='delegation'?say('لدى مشرف المبيعات','With the sales supervisor'):entry.stage==='first_contact'?say('بانتظار أول تواصل من المندوب','Waiting for the representative\'s first contact'):say('قيد الحل مع المندوب','Being resolved by the representative')):label(complaintStatusLabels,complaintStatusLabelsEn,entry.status,say);
const askText=(entry:ComplaintEntry,say:Say)=>entry.awaiting==='review'?say('مراجعة الشكوى','Review the complaint'):entry.awaiting==='fix'?say('تعديل وإعادة الإرسال','Correct and resend'):entry.awaiting==='assign'?say('تكليف مندوب','Assign a representative'):entry.awaiting==='delegate'?say('تفويض مندوب','Delegate to a representative'):entry.awaiting==='contact'?say('تسجيل التواصل','Record the contact'):entry.awaiting==='resolve'?say('تسجيل الحل','Record the resolution'):entry.awaiting==='close'?say('تأكيد الإغلاق','Confirm the closure'):say('التفاصيل','Details');

/** The complaints of the signed-in member, loaded beside the page and refreshed with it and every ten minutes. */
export function useComplaints({me,records}:{me:Member|null;records:Row[]}){
 const [loaded,setLoaded]=useState<{identity:string;data:ComplaintsData}|null>(null),generation=useRef(0),lastLoad=useRef({identity:'',at:0});
 const identity=me?[me.id,me.role,me.authVersion,me.regionScope,me.branch].join(':'):'';
 // What was loaded for another account, or before signing out, is never shown.
 const data=loaded&&loaded.identity===identity?loaded.data:null;
 // A change the member just made always reloads; the page's own reloads (focus, visibility, a refreshed snapshot) are at most one per fifteen seconds.
 const refresh=useCallback(async(force:boolean=true)=>{
  if(!identity||typeof navigator!=='undefined'&&navigator.onLine===false)return;
  if(!force&&lastLoad.current.identity===identity&&Date.now()-lastLoad.current.at<15000)return;
  const current=++generation.current;
  try{const next=await submitJson<ComplaintsData>('/api/complaints',{cache:'no-store'},{language:getLanguage()});if(current===generation.current){lastLoad.current={identity,at:Date.now()};setLoaded({identity,data:next});}}catch{/* the page works without it */}
 },[identity]);
 useEffect(()=>{
  if(!identity)return;
  const timer=window.setTimeout(()=>{void refresh(false);},0);
  return()=>window.clearTimeout(timer);
 },[identity,refresh,records]);
 useEffect(()=>{
  if(!identity)return;
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},600000);
  return()=>window.clearInterval(timer);
 },[identity,refresh]);
 const forCustomer=useCallback((customerId:string)=>complaintsOfCustomer(data?.complaints||[],customerId),[data]);
 return {data,refresh,forCustomer,badge:data?.counts.badge||0};
}

/** One write to the complaints route. A retry after an unclear failure keeps its identifier, so it can never save twice. */
function useAction(onDone:()=>Promise<void>|void){
 const lock=useRef(false),attempt=useRef<{body:string;key:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const run=useCallback(async(body:Record<string,unknown>):Promise<false|{id?:string;complaintNumber?:number}>=>{
  if(lock.current)return false;
  lock.current=true;setBusy(true);setError('');
  const text=JSON.stringify(body);if(attempt.current?.body!==text)attempt.current={body:text,key:crypto.randomUUID()};
  try{
   const reply=await submitJson<{id?:string;complaintNumber?:number}>('/api/complaints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:attempt.current.key})},{language:getLanguage()});
   attempt.current=null;await onDone();return reply||{};
  }catch(failure){setError(messageOf(failure));if(definiteSubmitRejection(failure))attempt.current=null;return false;}
  finally{lock.current=false;setBusy(false);}
 },[onDone]);
 return {run,busy,error};
}

function ContactLinks({phone,say}:{phone:string;say:Say}){
 const links=contactLinks(phone);
 if(!links.tel)return null;
 return <span className="support-links"><a className="support-link" href={links.tel}><PhoneCall size={14} aria-hidden="true"/>{say('اتصال','Call')}</a>{links.whatsapp&&<a className="support-link" href={links.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} aria-hidden="true"/>{say('واتساب','WhatsApp')}</a>}</span>;
}

const GROUP_TEXT:Record<ComplaintGroupId,[string,string]>={act:['بانتظار إجرائك','Waiting for your action'],open:['شكاوى مفتوحة','Open complaints'],finished:['مغلقة وملغاة خلال 30 يومًا','Closed and cancelled in the last 30 days']};

/** The Arabic words the customer is told, with the complaint's own number, date and category. */
const messageFor=(entry:Pick<ComplaintEntry,'complaintNumber'|'createdAt'|'category'>)=>complaintMessage({number:entry.complaintNumber,createdAt:entry.createdAt,category:complaintCategories[entry.category]||''});
/** Opens WhatsApp on the customer's number with the message ready; the employee reviews and sends it. A link, not a request, so the browser
 * and the app open it as they open any link; `onOpen` stamps the complaint's story. */
function NotifyLink({url,onOpen,say,primary=true}:{url:string;onOpen:()=>void;say:Say;primary?:boolean}){
 return <a className={'btn '+(primary?'primary':'subtle')} data-notify="open" href={url} target="_blank" rel="noopener noreferrer" onClick={onOpen}><MessageCircle size={16} aria-hidden="true"/>{say('إرسال رسالة واتساب للعميل','Send a WhatsApp message to the customer')}</a>;
}
function ComplaintCard({entry,say,onOpen,onChanged}:{entry:ComplaintEntry;say:Say;onOpen:(entry:ComplaintEntry)=>void;onChanged?:()=>Promise<void>|void}){
 const open=isOpenComplaint(entry),notify=useAction(onChanged||(()=>{})),link=entry.permissions.notify?whatsappUrl(entry.contactWhatsapp,messageFor(entry)):'';
 return <article className="complaint-card" data-complaint={entry.id} data-status={entry.status} data-stage={entry.stage} data-awaiting={entry.awaiting||'none'} data-late={entry.late?'true':'false'} data-severity={entry.severity}>
  <header><div><h4>{entry.complaintNumber&&<bdi className="complaint-number">#{entry.complaintNumber} </bdi>}{entry.customerName}</h4>{(entry.contactPhone||entry.customerCity)&&<span className="support-phone" dir="ltr">{[entry.contactPhone,entry.customerCity].filter(Boolean).join(' · ')}</span>}</div><span className="badge pending">{stateText(entry,say)}</span></header>
  <div className="support-meta">
   <span className="support-chip-static">{categoryText(entry.category,say)}</span>
   {entry.severity==='high'&&<span className="support-chip-static" data-kind="escalated">{say('أهمية عالية','High')}</span>}
   {open&&entry.targetHours!==null&&<span className="support-chip-static"><Clock3 size={12} aria-hidden="true"/> {hoursText(entry.stageHours,say)}</span>}
   {entry.late&&<span className="support-chip-static" data-kind="late">{say('متأخر عن هدف '+entry.targetHours+' ساعة عمل','Late against a '+entry.targetHours+'-working-hour target')}</span>}
   {entry.unrouted&&<span className="support-chip-static" data-kind="escalated">{say('بلا مدير لخدمة العملاء','No customer-service manager')}</span>}
   {entry.closure&&<span className="support-chip-static" data-kind="done">{closureText(entry.closure.outcome,say)}</span>}
   {entry.notifiedAt&&<span className="support-chip-static" data-kind="done" data-notified="true">{say('فُتحت رسالة واتساب للعميل','WhatsApp message opened for the customer')}</span>}
  </div>
  <p>{entry.description}</p>
  <small>{say('سجّلها: ','Registered by: ')}{entry.registrarName||'—'}{entry.assigneeName?' · '+say('يحملها: ','Held by: ')+entry.assigneeName:entry.salesManagerName?' · '+say('لدى مدير المبيعات: ','With the sales manager: ')+entry.salesManagerName:''}</small>
  <div className="support-actions"><button type="button" className={'btn '+(entry.awaiting?'primary':'subtle')} onClick={()=>onOpen(entry)}>{askText(entry,say)}</button>{link&&<NotifyLink url={link} say={say} primary={false} onOpen={()=>void notify.run({action:'notify',id:entry.id,version:entry.version})}/>}</div>
  {notify.error&&<div className="form-error" role="alert">{t(notify.error)}</div>}
 </article>;
}

/** The complaints list: the page for customer service and administrators, the panel on the Visits page for sales members. */
export function ComplaintsList({data,me,mode,onOpen,onChanged}:{data:ComplaintsData|null;me:Member;mode:'page'|'panel';onOpen:(entry:ComplaintEntry)=>void;onChanged?:()=>Promise<void>|void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const groups=data?complaintGroups(data.complaints):[];
 if(mode==='panel'&&!groups.length)return null;
 const total=Math.max(data?.counts.complaints??0,data?.complaints.length??0),openCount=data?.counts.open??0;
 const cut=data&&total>data.complaints.length?say('تُعرض '+data.complaints.length+' من أصل '+total+' شكوى، ما ينتظرك أولًا.','Showing '+data.complaints.length+' of '+total+' complaints, what waits for you first.'):'';
 const intro=me.role==='customer_service'?say('ما سجّلته أنت وزملاؤك في منطقتك، وأين وصلت كل شكوى.','What you and your colleagues registered in your region, and where each complaint stands.'):me.role==='customer_service_manager'?say('شكاوى فريقك: راجعها وأحلها إلى المبيعات وتابع حلها حتى الإغلاق.','Your team\'s complaints: review them, hand them to sales and follow them to closure.'):me.role==='admin'?say('كل الشكاوى وأين وصلت.','Every complaint and where it stands.'):me.role==='rep'?say('الشكاوى المكلَّف بها: تواصل مع العميل وسجّل ما فعلت ثم الحل.','The complaints assigned to you: contact the customer, record what you did, then the resolution.'):say('شكاوى العملاء التي أُحيلت إليك أو يحملها فريقك.','Customer complaints handed to you or held by your team.');
 return <section className={mode==='page'?'complaints-page':'complaints-panel panel'} aria-label={say('شكاوى العملاء','Customer complaints')} data-role={me.role} dir={language==='en'?'ltr':'rtl'}>
  <div className="support-heading"><div><h2><MessageSquareWarning size={18} aria-hidden="true"/> {say('شكاوى العملاء','Customer complaints')}</h2><p>{intro}</p></div><span className="support-count" title={say('الشكاوى المفتوحة','Open complaints')}>{openCount}</span></div>
  {cut&&<p className="support-cut" role="note">{cut}</p>}
  {!data&&<p className="form-note" role="status">{say('جارٍ تحميل الشكاوى','Loading complaints')}</p>}
  {data&&!groups.length&&<p className="form-note complaints-empty">{say('لا شكاوى.','No complaints.')}</p>}
  {groups.map(group=>{
   const cards=group.entries.map(entry=><ComplaintCard key={entry.id} entry={entry} say={say} onOpen={onOpen} onChanged={onChanged}/>);
   if(group.id==='finished')return <details key={group.id} className="support-folded" data-group={group.id}><summary>{say(...GROUP_TEXT[group.id])} <span className="support-count">{group.entries.length}</span></summary><div className="support-cards">{cards}</div></details>;
   return <div key={group.id} className="support-group" data-group={group.id}><h3>{say(...GROUP_TEXT[group.id])} <span className="support-count">{group.entries.length}</span></h3><div className="support-cards">{cards}</div></div>;
  })}
 </section>;
}

/** A customer's complaints inside the customer's own sheet. */
export function CustomerComplaints({entries,onOpen,onChanged}:{entries:ComplaintEntry[];onOpen:(entry:ComplaintEntry)=>void;onChanged?:()=>Promise<void>|void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 if(!entries.length)return <p className="form-note">{say('لا شكاوى لهذا العميل.','No complaints for this customer.')}</p>;
 return <div className="support-cards customer-complaints">{entries.map(entry=><ComplaintCard key={entry.id} entry={entry} say={say} onOpen={onOpen} onChanged={onChanged}/>)}</div>;
}

type Report={channel:string;category:string;severity:'normal'|'high';description:string;demand:string;reference:string;contactName:string;contactPhone:string;contactWhatsapp:string;contactEmail:string};
const emptyReport:Report={channel:'call',category:'product_quality',severity:'normal',description:'',demand:'',reference:'',contactName:'',contactPhone:'',contactWhatsapp:'',contactEmail:''};
const validEmail=(value:string)=>!value||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
/** What is wrong with the contact details, in words; empty when they can be sent. */
const contactProblem=(report:Report,say:Say)=>report.contactWhatsapp&&!validContactNumber(report.contactWhatsapp)?say('رقم واتساب غير صالح: اكتب من 7 إلى 15 رقمًا.','The WhatsApp number is not valid: write 7 to 15 digits.'):!validEmail(report.contactEmail)?say('البريد الإلكتروني غير صالح.','The e-mail address is not valid.'):'';
/** The complaint's own fields, shared by the registration and the correction. */
function ReportFields({value,onChange,say}:{value:Report;onChange:(next:Report)=>void;say:Say}){
 const set=(key:keyof Report,next:string)=>onChange({...value,[key]:next});
 return <>
  <div className="form-grid">
   <label className="field"><span>{say('وصلت الشكوى عن طريق','The complaint came by')}</span><select value={value.channel} onChange={event=>set('channel',event.target.value)}>{Object.keys(complaintChannels).map(key=><option key={key} value={key}>{channelText(key,say)}</option>)}</select></label>
   <label className="field"><span>{say('تصنيف الشكوى','Category')}</span><select value={value.category} onChange={event=>set('category',event.target.value)}>{Object.keys(complaintCategories).map(key=><option key={key} value={key}>{categoryText(key,say)}</option>)}</select></label>
  </div>
  <fieldset className="customer-choice-field complaint-severity"><legend>{say('الأهمية','Severity')}</legend><div className="customer-choice-grid">{(['normal','high'] as const).map(key=><label className="customer-choice" key={key}><input type="radio" name="complaint-severity" value={key} checked={value.severity===key} onChange={event=>{if(event.target.checked)set('severity',key);}}/><span>{severityText(key,say)}</span></label>)}</div></fieldset>
  <VoiceField label={say('وصف الشكوى','What the customer complains about')} marked multiline value={value.description} onChange={text=>set('description',text)} contextKey="complaint-report" rows={4} inputProps={{maxLength:COMPLAINT_TEXT_MAX,placeholder:say('ما الذي حدث، ومتى، وما المنتج أو الخدمة المعنية','What happened, when, and which product or service')}}/>
  <VoiceField label={say('ما يطلبه العميل','What the customer asks for')} multiline value={value.demand} onChange={text=>set('demand',text)} contextKey="complaint-report" rows={2} inputProps={{maxLength:COMPLAINT_DEMAND_MAX,placeholder:say('مثال: استبدال القالب أو تعويض عن التأخر','For example: replace the mold, or compensate the delay')}}/>
  <div className="form-grid">
   <VoiceField label={say('مرجع: رقم طلب أو فاتورة أو قالب','Reference: order, invoice or mold')} value={value.reference} onChange={text=>set('reference',text)} contextKey="complaint-report" inputProps={{maxLength:250}}/>
   <VoiceField label={say('المتصل','Contact person')} value={value.contactName} onChange={text=>set('contactName',text)} contextKey="complaint-report" inputProps={{maxLength:250}}/>
   <label className="field"><span>{say('رقم التواصل','Contact phone')}</span><input value={value.contactPhone} maxLength={100} type="tel" inputMode="tel" dir="ltr" onChange={event=>onChange({...value,contactPhone:event.target.value,...(!value.contactWhatsapp||value.contactWhatsapp===value.contactPhone?{contactWhatsapp:event.target.value}:{})})}/></label>
   <label className="field"><span>{say('واتساب العميل','Customer WhatsApp')}</span><input value={value.contactWhatsapp} maxLength={100} type="tel" inputMode="tel" dir="ltr" aria-invalid={!!value.contactWhatsapp&&!validContactNumber(value.contactWhatsapp)} onChange={event=>set('contactWhatsapp',event.target.value)}/></label>
   <label className="field"><span>{say('البريد الإلكتروني','E-mail')}</span><input value={value.contactEmail} maxLength={250} type="email" inputMode="email" dir="ltr" autoComplete="off" aria-invalid={!validEmail(value.contactEmail)} onChange={event=>set('contactEmail',event.target.value)}/></label>
  </div>
  {contactProblem(value,say)&&<p className="form-error" role="alert">{contactProblem(value,say)}</p>}
 </>;
}
const normalize=(value:string)=>value.normalize('NFKD').replace(/[ً-ٰٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).toLowerCase().trim();

/** Customer service registers a complaint for a customer of its branch and region. */
export function ComplaintRegisterDialog({me,records,complaints,onClose,onSaved,onNotified}:{me:Member;records:Row[];complaints:ComplaintEntry[];onClose:()=>void;onSaved:()=>Promise<void>|void;onNotified?:()=>Promise<void>|void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [query,setQuery]=useState(''),[customerId,setCustomerId]=useState(''),[report,setReport]=useState<Report>(emptyReport);
 // Once the complaint is saved the dialog stays on the step that tells the customer.
 const [saved,setSaved]=useState<{id:string;number:number|null;createdAt:string;category:string;whatsapp:string;notified:boolean}|null>(null);
 const action=useAction(onSaved),notify=useAction(onNotified||(()=>{}));
 const customers=useMemo(()=>records.filter(row=>row.kind==='customer'&&canRegisterComplaint(row,{me})),[records,me]);
 const matches=useMemo(()=>{const needle=normalize(query);if(!needle)return customers.slice(0,12);return customers.filter(row=>[row.data.name,row.data.code,row.data.internalCode,row.data.phone,row.data.city].some(value=>normalize(String(value||'')).includes(needle))).slice(0,12);},[customers,query]);
 const customer=customers.find(row=>row.id===customerId);
 const openOnes=customer?complaints.filter(entry=>entry.customerId===customer.id&&isOpenComplaint(entry)):[];
 const choose=(row:Row)=>{setCustomerId(row.id);setReport(current=>{const phone=current.contactPhone||String(row.data.phone||'');return {...current,contactName:current.contactName||String(row.data.contact||''),contactPhone:phone,contactWhatsapp:current.contactWhatsapp||(validContactNumber(phone)?phone:''),contactEmail:current.contactEmail||String(row.data.email||'')};});};
 const ready=!!customer&&report.description.trim().length>=10&&!contactProblem(report,say);
 const register=async()=>{
  if(!customer)return;
  const sent=await action.run({action:'register',customerId:customer.id,customerVersion:customer.version,...report,description:report.description.trim(),demand:report.demand.trim(),reference:report.reference.trim(),contactName:report.contactName.trim(),contactPhone:report.contactPhone.trim(),contactWhatsapp:report.contactWhatsapp.trim(),contactEmail:report.contactEmail.trim()});
  if(sent&&sent.id)setSaved({id:sent.id,number:sent.complaintNumber??null,createdAt:new Date().toISOString(),category:report.category,whatsapp:report.contactWhatsapp.trim(),notified:false});
  else if(sent)onClose();
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!action.busy)onClose();}}><DialogContent className="crm-dialog complaint-dialog" dir={direction()}>
  <DialogTitle>{saved?say('سُجّلت الشكوى','The complaint is registered'):say('تسجيل شكوى','Register a complaint')}</DialogTitle>
  <DialogDescription>{saved?say('أبلغ العميل بتسجيل شكواه، ثم تتابع الشكوى مسارها.','Tell the customer that the complaint is registered; it then follows its course.'):say('تصل الشكوى إلى مدير خدمة العملاء، ثم إلى مدير المبيعات الذي يكلّف مندوبًا بحلها مع العميل.','The complaint goes to the customer-service manager, then to the sales manager, who assigns a representative to put it right with the customer.')}</DialogDescription>
  {saved?<div className="complaint-notify-step" data-step="notify">
   <p className="form-note" role="status"><CheckCircle2 size={16} aria-hidden="true"/> {saved.number?say('سُجّلت الشكوى رقم '+saved.number+' ووصلت إلى مدير خدمة العملاء.','Complaint no. '+saved.number+' is registered and reached the customer-service manager.'):say('سُجّلت الشكوى ووصلت إلى مدير خدمة العملاء.','The complaint is registered and reached the customer-service manager.')}</p>
   {whatsappNumber(saved.whatsapp)?<>
    <p>{say('هذه الرسالة ستُفتح في واتساب على رقم العميل لتراجعها وترسلها من هاتفك:','This message opens in WhatsApp on the customer\'s number for you to review and send from your phone:')}</p>
    <blockquote className="complaint-message" dir="rtl" lang="ar">{messageFor({complaintNumber:saved.number,createdAt:saved.createdAt,category:saved.category})}</blockquote>
    {notify.error&&<div className="form-error" role="alert">{t(notify.error)}</div>}
    {saved.notified&&<p className="form-note" role="status" data-notified="true">{say('فُتحت رسالة واتساب للعميل وسُجّل ذلك في سير الشكوى.','The WhatsApp message was opened and the complaint\'s story says so.')}</p>}
    <div className="service-button-row">{!saved.notified&&<NotifyLink url={whatsappUrl(saved.whatsapp,messageFor({complaintNumber:saved.number,createdAt:saved.createdAt,category:saved.category}))} say={say} onOpen={()=>{setSaved(current=>current&&{...current,notified:true});void notify.run({action:'notify',id:saved.id,version:1});}}/>}<button type="button" className={'btn '+(saved.notified?'primary':'subtle')} onClick={onClose}>{saved.notified?say('تم','Done'):say('لاحقًا','Later')}</button></div>
   </>:<>
    <p className="form-note" role="note">{say('لا رقم واتساب صالح للعميل في هذه الشكوى. أضف رقمًا من «تعديل الشكوى» لتبلّغه.','The complaint has no valid WhatsApp number for the customer. Add one from "Correct the complaint" to tell the customer.')}</p>
    <div className="service-button-row"><button type="button" className="btn primary" onClick={onClose}>{say('تم','Done')}</button></div>
   </>}
  </div>:<fieldset disabled={action.busy} className="support-form complaint-form">
   {!customer?<div className="complaint-customer-search"><label className="field"><span>{say('العميل','Customer')} <b>*</b></span><span className="search"><Search size={16} aria-hidden="true"/><input type="search" value={query} autoFocus enterKeyHint="search" aria-label={say('بحث عن العميل','Search for the customer')} placeholder={say('اسم المصنع أو رقم العميل أو الجوال','Factory name, customer code or phone')} onChange={event=>setQuery(event.target.value)}/></span></label>
    <div className="complaint-customer-matches" role="listbox" aria-label={say('العملاء','Customers')}>{matches.map(row=><button type="button" role="option" aria-selected={false} key={row.id} data-customer={row.id} onClick={()=>choose(row)}><strong>{row.data.name}</strong><small dir="ltr">{[row.data.internalCode,row.data.phone,row.data.city].filter(Boolean).join(' · ')}</small></button>)}{!matches.length&&<p className="form-note">{say('لا عميل بهذا الاسم في نطاقك.','No customer by that name in your scope.')}</p>}</div></div>
   :<div className="complaint-customer-chosen"><div><strong>{customer.data.name}</strong><small dir="ltr">{[customer.data.internalCode,customer.data.phone,customer.data.city,customer.data.region].filter(Boolean).join(' · ')}</small></div><button type="button" className="btn subtle small" onClick={()=>setCustomerId('')}>{say('تغيير العميل','Change the customer')}</button></div>}
   {openOnes.length>0&&<p className="form-note complaint-open-warning" role="status">{say('لهذا العميل '+openOnes.length+' شكوى مفتوحة بالفعل: '+openOnes.map(entry=>categoryText(entry.category,say)).join('، ')+'. سجّل الشكوى الجديدة إن كانت مختلفة.','This customer already has '+openOnes.length+' open complaint(s): '+openOnes.map(entry=>categoryText(entry.category,say)).join(', ')+'. Register the new one if it is a different matter.')}</p>}
   {customer&&<ReportFields value={report} onChange={setReport} say={say}/>}
   {action.error&&<div className="form-error" role="alert">{t(action.error)}</div>}
   <div className="service-button-row"><button type="button" className="btn primary" disabled={!ready} onClick={()=>void register()}>{action.busy?<Loader2 className="spin" size={16}/>:<MessageSquareWarning size={16} aria-hidden="true"/>}{say('تسجيل الشكوى','Register the complaint')}</button><button type="button" className="btn subtle" onClick={onClose}>{say('إلغاء','Cancel')}</button></div>
  </fieldset>}
 </DialogContent></Dialog>;
}

type Moment={id:string;at:string;title:string;actor:string;text:string;kind:'event'|'update'|'note'};
/** One complaint: the report, where it stands, its story, and what the reader may do with it. */
export function ComplaintSheet({entry,onClose,onChanged}:{entry:ComplaintEntry;onClose:()=>void;onChanged:()=>Promise<void>}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const action=useAction(onChanged),{run}=action;
 const [target,setTarget]=useState(entry.suggestedId||entry.candidates[0]?.id||''),[note,setNote]=useState(''),[text,setText]=useState(''),[channel,setChannel]=useState('call'),[date,setDate]=useState(today()),[outcome,setOutcome]=useState(''),[rating,setRating]=useState(0),[reason,setReason]=useState(''),[editing,setEditing]=useState(false),[report,setReport]=useState<Report>({channel:entry.channel,category:entry.category,severity:entry.severity,description:entry.description,demand:entry.demand,reference:entry.reference,contactName:entry.contactName,contactPhone:entry.contactPhone,contactWhatsapp:entry.contactWhatsapp,contactEmail:entry.contactEmail});
 const opened=useRef('');
 useEffect(()=>{
  if(!entry.permissions.seen||opened.current===entry.id+':'+entry.version)return;
  opened.current=entry.id+':'+entry.version;void run({action:'seen',id:entry.id,version:entry.version});
 },[entry.id,entry.version,entry.permissions.seen,run]);
 const perform=(body:Record<string,unknown>)=>void run({...body,id:entry.id,version:entry.version});
 const p=entry.permissions,open=isOpenComplaint(entry);
 const handing=p.assign?'assign':p.reassign?'reassign':p.delegate?'delegate':p.forward?'forward':null;
 const story:Moment[]=[
  ...entry.events.map((event,index)=>({id:'e'+index,at:event.at,title:actionText(event.action,say)+(event.targetName?' · '+event.targetName:'')+(event.outcome?' · '+(event.action==='close'?closureText(event.outcome,say):resolutionText(event.outcome,say)):'')+(event.rating?' · ★ '+event.rating+'/5':''),actor:event.byName,text:event.text||'',kind:'event' as const})),
  ...entry.updates.map(update=>({id:update.id,at:update.at,title:say('تواصل مع العميل','Contact with the customer')+' · '+channelText(update.channel,say)+(update.date?' · '+update.date:''),actor:update.byName,text:update.text,kind:'update' as const})),
  ...entry.notes.map(item=>({id:item.id,at:item.at,title:say('ملاحظة داخلية','Internal note'),actor:item.byName,text:item.text,kind:'note' as const}))
 ].sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id));
 const facts:[string,React.ReactNode][]=[
  [say('العميل','Customer'),entry.customerName],
  [say('المتصل ورقمه','Contact'),<span key="c" dir="ltr">{[entry.contactName,entry.contactPhone].filter(Boolean).join(' · ')||'—'}{entry.contactPhone&&<> <ContactLinks phone={entry.contactPhone} say={say}/></>}</span>],
  ...(entry.contactWhatsapp?[[say('واتساب','WhatsApp'),<span key="w" dir="ltr">{whatsappUrl(entry.contactWhatsapp)?<a className="support-link" href={whatsappUrl(entry.contactWhatsapp)} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} aria-hidden="true"/>{entry.contactWhatsapp}</a>:entry.contactWhatsapp}</span>] as [string,React.ReactNode]]:[]),
  ...(entry.contactEmail?[[say('البريد الإلكتروني','E-mail'),<span key="m" dir="ltr"><a className="support-link" href={'mailto:'+entry.contactEmail}>{entry.contactEmail}</a></span>] as [string,React.ReactNode]]:[]),
  [say('المدينة والمنطقة','City and region'),[entry.customerCity,entry.customerRegion?t(entry.customerRegion):''].filter(Boolean).join(' · ')||'—'],
  [say('وصلت عن طريق','Came by'),channelText(entry.channel,say)],
  [say('التصنيف والأهمية','Category and severity'),categoryText(entry.category,say)+' · '+severityText(entry.severity,say)],
  [say('وصف الشكوى','Description'),entry.description],
  ...(entry.demand?[[say('ما يطلبه العميل','What the customer asks for'),entry.demand] as [string,React.ReactNode]]:[]),
  ...(entry.reference?[[say('المرجع','Reference'),entry.reference] as [string,React.ReactNode]]:[]),
  [say('سجّلها','Registered by'),(entry.registrarName||'—')+' · '+stamp(entry.createdAt)],
  ...(entry.notifiedAt?[[say('إبلاغ العميل','Customer told'),say('فُتحت رسالة واتساب للعميل','WhatsApp message opened for the customer')+' · '+(entry.notifiedByName||'—')+' · '+stamp(entry.notifiedAt)] as [string,React.ReactNode]]:[]),
  [say('مدير خدمة العملاء','Customer-service manager'),entry.serviceManagerName||say('بلا مدير: تنتظر مدير النظام','None: waits for an administrator')],
  ...(entry.salesManagerName?[[say('مدير المبيعات','Sales manager'),entry.salesManagerName] as [string,React.ReactNode]]:[]),
  ...(entry.assigneeName?[[say('يحملها','Held by'),entry.assigneeName+(entry.assigneeRole?' · '+t(roles[entry.assigneeRole]):'')+(entry.supervisorName&&entry.assigneeRole==='rep'?' · '+say('المشرف: ','Supervisor: ')+entry.supervisorName:'')] as [string,React.ReactNode]]:[]),
  ...(entry.assignmentNote?[[say('ملاحظة التكليف','Assignment note'),entry.assignmentNote] as [string,React.ReactNode]]:[]),
  ...(entry.returnNote&&entry.status==='returned'?[[say('سبب الإعادة للتعديل','Why it was returned'),entry.returnNote] as [string,React.ReactNode]]:[]),
  ...(entry.rejectReason&&entry.status==='assigned'?[[say('أُعيدت إلى المندوب لأن','Returned to the representative because'),entry.rejectReason] as [string,React.ReactNode]]:[]),
  ...(open&&entry.targetHours!==null?[[say('في هذه المرحلة منذ','At this stage for'),hoursText(entry.stageHours,say)+' · '+say('الهدف '+entry.targetHours+' ساعة عمل','target '+entry.targetHours+' working hours')+(entry.late?' · '+say('متأخر','late'):'')] as [string,React.ReactNode]]:[]),
  ...(entry.resolution?[[say('الحل','Resolution'),resolutionText(entry.resolution.outcome,say)+' · '+entry.resolution.note+' · '+(entry.resolution.byName||'—')+' · '+stamp(entry.resolution.at)] as [string,React.ReactNode]]:[]),
  ...(entry.closure?[[say('الإغلاق','Closure'),closureText(entry.closure.outcome,say)+(entry.closure.rating?' · '+say('تقييم العميل ','Customer rating ')+entry.closure.rating+'/5':'')+(entry.closure.note?' · '+entry.closure.note:'')+' · '+(entry.closure.byName||'—')+' · '+stamp(entry.closure.at)] as [string,React.ReactNode]]:[]),
  ...(entry.status==='cancelled'?[[say('سبب الإلغاء','Cancellation reason'),entry.cancelReason||'—'] as [string,React.ReactNode]]:[])
 ];
 return <Sheet open onOpenChange={value=>{if(!value)onClose();}}><SheetContent side={direction()==='rtl'?'left':'right'} className="crm-sheet service-sheet support-sheet complaint-sheet" dir={direction()}>
  <SheetTitle>{say('شكوى عميل','Customer complaint')}{entry.complaintNumber?' · '+say('رقم ','No. ')+entry.complaintNumber:''}</SheetTitle><SheetDescription>{entry.customerName}</SheetDescription>
  <div className="service-detail">
   <div className="service-status"><span className="badge pending">{stateText(entry,say)}</span>{entry.severity==='high'&&<span className="support-chip-static" data-kind="escalated">{say('أهمية عالية','High')}</span>}{entry.late&&<span className="support-chip-static" data-kind="late">{say('متأخر','Late')}</span>}</div>
   {editing?<fieldset disabled={action.busy} className="support-form complaint-form"><ReportFields value={report} onChange={setReport} say={say}/><div className="service-button-row"><button type="button" className="btn primary" disabled={report.description.trim().length<10||!!contactProblem(report,say)} onClick={()=>perform({action:'edit',...report,description:report.description.trim(),demand:report.demand.trim(),reference:report.reference.trim(),contactName:report.contactName.trim(),contactPhone:report.contactPhone.trim(),contactWhatsapp:report.contactWhatsapp.trim(),contactEmail:report.contactEmail.trim()})}><CheckCircle2 size={16} aria-hidden="true"/>{say('حفظ وإعادة الإرسال','Save and resend')}</button><button type="button" className="btn subtle" onClick={()=>setEditing(false)}>{say('رجوع','Back')}</button></div></fieldset>
   :<dl className="service-facts">{facts.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}
   {!editing&&<fieldset disabled={action.busy} className="service-actions">
    {p.edit&&<div className="service-button-row"><button type="button" className="btn subtle" onClick={()=>setEditing(true)}>{say('تعديل الشكوى','Correct the complaint')}</button></div>}
    {p.notify&&<div className="service-routing complaint-notify">{whatsappUrl(entry.contactWhatsapp)?<><NotifyLink url={whatsappUrl(entry.contactWhatsapp,messageFor(entry))} say={say} onOpen={()=>perform({action:'notify'})}/><p className="form-note">{say('تُفتح الرسالة في واتساب لتراجعها وترسلها من هاتفك، ويُسجَّل في سير الشكوى أنها فُتحت.','The message opens in WhatsApp for you to review and send from your phone, and the complaint\'s story records that it was opened.')}</p></>:<p className="form-note">{say('لا رقم واتساب صالح للعميل في هذه الشكوى.','The complaint has no valid WhatsApp number for the customer.')}{p.edit?' '+say('أضف رقمًا من «تعديل الشكوى».','Add one from "Correct the complaint".'):''}</p>}</div>}
    {handing&&<div className="service-routing"><label className="field"><span>{handing==='forward'?say('إحالة إلى مدير المبيعات','Hand to the sales manager'):handing==='delegate'?say('تفويض مندوب من فريقك','Delegate to one of your representatives'):handing==='reassign'?say('نقل الشكوى إلى','Move the complaint to'):say('تكليف مندوب أو مشرف','Assign a representative or supervisor')}</span><select value={target} onChange={event=>setTarget(event.target.value)}><option value="">{say('اختر','Choose')}</option>{entry.candidates.map(person=><option key={person.id} value={person.id}>{person.name} · {t(roles[person.role])}{person.id===entry.suggestedId?' · '+say('المندوب الحالي للعميل','the customer\'s current representative'):''}</option>)}</select></label>
     {handing!=='forward'&&<VoiceField label={say('ملاحظة للمكلَّف (اختياري)','A note for the assignee (optional)')} value={note} onChange={setNote} contextKey={'complaint-note:'+entry.id} inputProps={{maxLength:COMPLAINT_TEXT_MAX}}/>}
     {!entry.candidates.length&&<p className="form-note">{handing==='forward'?say('لا مدير مبيعات مرتبط بك يغطي منطقة العميل. راجع صفحة الفريق.','No sales manager linked to you covers the customer\'s region. Check the team page.'):say('لا أحد في فرع العميل يغطي منطقته.','Nobody in the customer\'s branch covers its region.')}</p>}
     <button type="button" className="btn primary" disabled={!target} onClick={()=>perform(handing==='forward'?{action:'forward',targetId:target}:{action:handing,targetId:target,note:note.trim()})}>{handing==='forward'?say('إحالة الشكوى','Forward the complaint'):handing==='delegate'?say('تفويض','Delegate'):handing==='reassign'?say('نقل الشكوى','Move the complaint'):say('تكليف','Assign')}</button></div>}
    {p.return&&<div className="service-routing"><VoiceField label={say('إعادة للتعديل: ما الذي يلزم؟','Return for correction: what is missing?')} value={reason} onChange={setReason} contextKey={'complaint-return:'+entry.id} inputProps={{maxLength:COMPLAINT_TEXT_MAX}}/><button type="button" className="btn subtle" disabled={reason.trim().length<3} onClick={()=>perform({action:'return',note:reason.trim()})}>{say('إعادة للتعديل','Return for correction')}</button></div>}
    {p.update&&<div className="service-internal complaint-update"><h3>{say('تسجيل تواصل مع العميل','Record a contact with the customer')}</h3><div className="form-grid"><label className="field"><span>{say('الوسيلة','How')}</span><select value={channel} onChange={event=>setChannel(event.target.value)}>{Object.keys(complaintChannels).map(key=><option key={key} value={key}>{channelText(key,say)}</option>)}</select></label><label className="field"><span>{say('التاريخ','Date')}</span><input type="date" max={today()} value={date} onChange={event=>setDate(event.target.value)}/></label></div>
     <VoiceField label={say('ما حدث','What happened')} multiline value={text} onChange={setText} contextKey={'complaint-update:'+entry.id} inputProps={{maxLength:COMPLAINT_TEXT_MAX,placeholder:say('ما قاله العميل وما فعلته وما اتُّفق عليه','What the customer said, what you did and what was agreed')}}/>
     <p className="form-note">{say('يُحفظ داخل الشكوى ولا يُحتسب زيارة.','Kept inside the complaint; it does not count as a visit.')}</p>
     <button type="button" className="btn subtle" disabled={text.trim().length<3} onClick={()=>{void run({action:'update',id:entry.id,version:entry.version,channel,text:text.trim(),date}).then(done=>{if(done)setText('');});}}>{say('حفظ التواصل','Save the contact')}</button></div>}
    {p.resolve&&<div className="service-internal complaint-resolve"><h3>{say('تسجيل الحل','Record the resolution')}</h3><label className="field"><span>{say('النتيجة','Outcome')}</span><select value={outcome} onChange={event=>setOutcome(event.target.value)}><option value="">{say('اختر','Choose')}</option>{Object.keys(resolutionOutcomes).map(key=><option key={key} value={key}>{resolutionText(key,say)}</option>)}</select></label>
     <VoiceField label={say('ما تم','What was done')} multiline value={note} onChange={setNote} contextKey={'complaint-resolve:'+entry.id} inputProps={{maxLength:COMPLAINT_TEXT_MAX}}/>
     <p className="form-note">{say('تذهب إلى خدمة العملاء لتتأكد من العميل وتغلق الشكوى.','It goes to customer service to confirm with the customer and close the complaint.')}</p>
     <button type="button" className="btn primary" disabled={!outcome||note.trim().length<3} onClick={()=>perform({action:'resolve',outcome,note:note.trim()})}><CheckCircle2 size={16} aria-hidden="true"/>{say('تسجيل الحل','Record the resolution')}</button></div>}
    {p.close&&<div className="service-internal complaint-close"><h3>{say('تأكيد الإغلاق مع العميل','Confirm the closure with the customer')}</h3><label className="field"><span>{say('نتيجة الإغلاق','Closure outcome')}</span><select value={outcome} onChange={event=>setOutcome(event.target.value)}><option value="">{say('اختر','Choose')}</option>{Object.keys(closureOutcomes).map(key=><option key={key} value={key}>{closureText(key,say)}</option>)}</select></label>
     <VoiceField label={say('ما قاله العميل (اختياري)','What the customer said (optional)')} multiline rows={2} value={note} onChange={setNote} contextKey={'complaint-close:'+entry.id} inputProps={{maxLength:COMPLAINT_TEXT_MAX}}/>
     {(outcome==='satisfied'||outcome==='not_satisfied')&&<div className="complaint-rating" role="group" aria-label={say('تقييم العميل من 5 (اختياري)','Customer rating out of 5 (optional)')}><span>{say('تقييم العميل من 5 (اختياري)','Customer rating out of 5 (optional)')}</span>{[1,2,3,4,5].map(value=><button key={value} type="button" className="complaint-rating-button" data-active={rating===value} aria-pressed={rating===value} onClick={()=>setRating(rating===value?0:value)}>{value}</button>)}</div>}
     <div className="service-button-row"><button type="button" className="btn primary" disabled={!outcome} onClick={()=>perform({action:'close',outcome,note:note.trim(),...(rating&&(outcome==='satisfied'||outcome==='not_satisfied')?{rating}:{})})}><CheckCircle2 size={16} aria-hidden="true"/>{say('إغلاق الشكوى','Close the complaint')}</button></div>
     {p.reject&&<><VoiceField label={say('أو إعادتها إلى المندوب: لماذا؟','Or return it to the representative: why?')} value={reason} onChange={setReason} contextKey={'complaint-reject:'+entry.id} inputProps={{maxLength:COMPLAINT_TEXT_MAX}}/><button type="button" className="btn subtle" disabled={reason.trim().length<3} onClick={()=>perform({action:'reject',reason:reason.trim()})}>{say('إعادة إلى المندوب','Return to the representative')}</button></>}</div>}
    {p.reopen&&<div className="service-routing"><VoiceField label={say('إعادة فتح الشكوى: لماذا؟','Reopen the complaint: why?')} value={reason} onChange={setReason} contextKey={'complaint-reopen:'+entry.id} inputProps={{maxLength:COMPLAINT_TEXT_MAX}}/><button type="button" className="btn subtle" disabled={reason.trim().length<3} onClick={()=>perform({action:'reopen',reason:reason.trim()})}>{say('إعادة فتح','Reopen')}</button><p className="form-note">{say('متاحة حتى '+stamp(entry.reopenUntil)+'؛ بعدها تُسجَّل شكوى جديدة.','Available until '+stamp(entry.reopenUntil)+'; after that a new complaint is registered.')}</p></div>}
    {p.note&&<div className="service-internal"><VoiceField label={say('ملاحظة داخلية','Internal note')} multiline rows={2} value={text} onChange={setText} contextKey={'complaint-note:'+entry.id} inputProps={{maxLength:COMPLAINT_TEXT_MAX,placeholder:say('تظهر لمن يرى الشكوى ولا تُرسل إلى العميل','Shown to those who see the complaint; never sent to the customer')}}/><button type="button" className="btn subtle" disabled={text.trim().length<3} onClick={()=>{void run({action:'note',id:entry.id,version:entry.version,text:text.trim()}).then(done=>{if(done)setText('');});}}>{say('إضافة الملاحظة','Add the note')}</button></div>}
    {p.cancel&&<div className="service-routing"><VoiceField label={say('إلغاء الشكوى (اختياري: السبب)','Cancel the complaint (optional reason)')} value={reason} onChange={setReason} contextKey={'complaint-cancel:'+entry.id} inputProps={{maxLength:500}}/><button type="button" className="btn subtle danger" onClick={()=>perform({action:'cancel',reason:reason.trim()})}>{say('إلغاء الشكوى','Cancel the complaint')}</button></div>}
   </fieldset>}
   {action.busy&&<p role="status">{say('جارٍ الحفظ','Saving')}</p>}{action.error&&<div className="form-error" role="alert">{t(action.error)}</div>}
   <section className="service-history complaint-story"><h3>{say('سير الشكوى','The complaint\'s story')}</h3>{story.map(moment=><article key={moment.id} data-kind={moment.kind}><header><strong>{moment.title}</strong><time>{stamp(moment.at)}</time></header><small>{moment.actor}</small>{moment.text&&<p>{moment.text}</p>}</article>)}</section>
  </div>
 </SheetContent></Sheet>;
}

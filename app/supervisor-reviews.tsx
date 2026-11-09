'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {AlertCircle,CheckCheck,ClipboardCheck,Eye,EyeOff,Loader2,MessageSquareText,Pencil,Plus} from 'lucide-react';
import {t,useLanguage} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import VoiceField from './voice-field';
import {REVIEW_INBOX_FOCUS_MS,REVIEW_INBOX_INTERVAL_MS,REVIEW_TEXT_MAX,REVIEW_TEXT_MIN,validDayReview,validEntryReview,validReportReviews,validReviewInbox,type DayReview,type EntryReview,type ReportReviews,type ReviewInbox,type ReviewInboxItem} from '@/lib/supervisor-reviews';
import './supervisor-reviews.css';

/** The supervisor's notes on a member's work (lib/supervisor-reviews.ts; GSCO components/crm/daily-entry-review.tsx,
 * daily-report-review.tsx and review-inbox.tsx). On «تقرير يوم المندوب»: «إضافة نتيجة وإجراء» under each visit or contact the reader may
 * note, the saved note with «تعديل» and whether the member read it, and the note on the member's whole day. On every page: the card
 * «ملاحظات المشرف على شغلك» for the member who has notes they have not read. */

const selectText=(language:string,ar:string,en:string)=>language==='en'?en:ar;
const stampFormats=new Map<string,Intl.DateTimeFormat>();
function stamp(value:string|null|undefined,language:string){
 if(!value||!Number.isFinite(Date.parse(value)))return '—';
 const locale=language==='en'?'en-GB':'ar-SA';
 let format=stampFormats.get(locale);
 if(!format){format=new Intl.DateTimeFormat(locale,{calendar:'gregory',numberingSystem:'latn',timeZone:'Asia/Riyadh',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});stampFormats.set(locale,format);}
 return format.format(new Date(value));
}
function dayLabel(date:string,language:string){
 const at=Date.parse(date+'T12:00:00Z');if(!Number.isFinite(at))return date;
 return new Intl.DateTimeFormat(language==='en'?'en-GB':'ar-SA',{calendar:'gregory',numberingSystem:'latn',timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(at));
}
const activityTypes:Record<string,[string,string]>={visit:['زيارة','Visit'],call:['اتصال','Call'],email:['بريد إلكتروني','Email'],whatsapp:['واتساب','WhatsApp'],website:['عن طريق الويبسايت','Website'],social:['مواقع التواصل الاجتماعي','Social media'],quote:['عرض سعر','Quotation'],meeting:['اجتماع','Meeting'],followup:['متابعة','Follow-up']};
const errorText=(error:unknown,fallback:string)=>error instanceof Error&&error.message?t(error.message):fallback;

/** Beside a saved note: whether the member it is about has read this version, and when. */
export function ReviewReadStatus({readAt}:{readAt:string|null}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 return readAt
  ?<p className="review-read-status read" data-review-read="yes"><Eye size={14} aria-hidden/>{say('تمت القراءة','Read')} <time dateTime={readAt} dir="ltr">{stamp(readAt,language)}</time></p>
  :<p className="review-read-status" data-review-read="no"><EyeOff size={14} aria-hidden/>{say('لم تُقرأ بعد','Not read yet')}</p>;
}

type ReviewsState={reviews:ReportReviews;savedEntry:(review:EntryReview)=>void;savedDay:(review:DayReview)=>void};
const ReviewsContext=createContext<ReviewsState|null>(null);
type Loaded={key:string;reviews:ReportReviews|null;error:string};

/** Loads the notes of the report on screen (date, member) and hands them to the rows below it. Nothing shows until they arrive; a failed
 * load leaves the report as it is, with a short note and Retry. */
export function ReportReviewsProvider({date,memberId,revision,children}:{date:string;memberId:string;revision:string;children:ReactNode}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const key=date+'|'+memberId+'|'+revision,[state,setState]=useState<Loaded>({key:'',reviews:null,error:''}),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController(),params=new URLSearchParams({date,memberId});
  void submitJson<ReportReviews>('/api/reviews?'+params,{cache:'no-store',signal:controller.signal},{language}).then(body=>{
   if(controller.signal.aborted)return;
   if(!validReportReviews(body))throw new Error(say('تعذر تحميل ملاحظات المشرف.','Could not load the supervisor notes.'));
   setState({key,reviews:body,error:''});
  }).catch(error=>{if(!controller.signal.aborted&&error?.name!=='AbortError')setState({key,reviews:null,error:errorText(error,say('تعذر تحميل ملاحظات المشرف.','Could not load the supervisor notes.'))});});
  return()=>controller.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps -- key names date, member and revision; say follows language
 },[key,retry,language]);
 const savedEntry=useCallback((review:EntryReview)=>setState(current=>current.reviews?{...current,reviews:{...current.reviews,entries:[...current.reviews.entries.filter(entry=>entry.activityId!==review.activityId),review]}}:current),[]);
 const savedDay=useCallback((review:DayReview)=>setState(current=>current.reviews?{...current,reviews:{...current.reviews,day:review}}:current),[]);
 const current=state.key===key?state:{key,reviews:null,error:''};
 return <ReviewsContext.Provider value={current.reviews?{reviews:current.reviews,savedEntry,savedDay}:null}>
  {current.error&&<p className="review-load-error" role="alert"><AlertCircle size={15} aria-hidden/><span>{current.error}</span><button type="button" className="btn subtle small" onClick={()=>setRetry(value=>value+1)}>{say('إعادة المحاولة','Try again')}</button></p>}
  {children}
 </ReviewsContext.Provider>;
}

/** The two required fields, each with dictation, Save and (for an edit) Cancel. A retry after a lost answer reuses its request id, so the
 * server answers with the saved note instead of a conflict. */
function ReviewEditor({initial,contextKey,busy,error,onSave,onCancel,labels}:{initial:{result:string;action:string};contextKey:string;busy:boolean;error:string;onSave:(value:{result:string;action:string})=>void;onCancel:()=>void;labels:{result:string;action:string}}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [result,setResult]=useState(initial.result),[action,setAction]=useState(initial.action),[problem,setProblem]=useState('');
 const short=result.trim().length<REVIEW_TEXT_MIN||action.trim().length<REVIEW_TEXT_MIN;
 return <form className="review-form" noValidate onSubmit={event=>{event.preventDefault();if(busy)return;if(short){setProblem(say('اكتب النتيجة والإجراء المطلوب؛ الخانتان إلزاميتان.','Write the result and the required action; both fields are required.'));return;}setProblem('');onSave({result:result.trim(),action:action.trim()});}}>
  <VoiceField label={say('النتيجة','Result')} marked multiline rows={2} value={result} onChange={setResult} disabled={busy} contextKey={contextKey} inputProps={{maxLength:REVIEW_TEXT_MAX,placeholder:labels.result,'aria-label':labels.result}}/>
  <VoiceField label={say('الإجراء المطلوب','Required action')} marked multiline rows={2} value={action} onChange={setAction} disabled={busy} contextKey={contextKey} inputProps={{maxLength:REVIEW_TEXT_MAX,placeholder:labels.action,'aria-label':labels.action}}/>
  {(problem||error)&&<p className="review-error" role="alert"><AlertCircle size={15} aria-hidden/>{problem||error}</p>}
  <div className="review-actions"><button type="submit" className="btn primary small" disabled={busy}>{busy?<Loader2 size={16} className="spin" aria-hidden/>:<ClipboardCheck size={16} aria-hidden/>}{say('حفظ','Save')}</button><button type="button" className="btn subtle small" disabled={busy} onClick={onCancel}>{say('إلغاء','Cancel')}</button></div>
 </form>;
}

/** Saves through POST /api/reviews and keeps the request id for a retry of the same text. */
function useReviewSave<T>(kind:'entry'|'day',target:Record<string,string>,version:number|null,accept:(value:unknown)=>value is T,onSaved:(review:T)=>void){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),request=useRef<{id:string;body:string}|null>(null);
 const save=async(value:{result:string;action:string})=>{
  if(busy)return false;setBusy(true);setError('');
  try{
   const payload=JSON.stringify({kind,...target,result:value.result,action:value.action,version});
   if(request.current?.body!==payload)request.current={id:crypto.randomUUID(),body:payload};
   const body=await submitJson<{ok:true;review:unknown}>('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(payload),requestId:request.current.id})},{language});
   if(!accept(body.review))throw new Error(say('الخادم لم يؤكد حفظ المراجعة. أعد المحاولة.','The server did not confirm the note. Try again.'));
   request.current=null;onSaved(body.review);return true;
  }catch(e){setError(errorText(e,say('تعذر حفظ المراجعة. أعد المحاولة.','Could not save the note. Try again.')));return false;}
  finally{setBusy(false);}
 };
 return{busy,error,save,clear:()=>setError('')};
}

function SavedReview({review,canEdit,onEdit}:{review:EntryReview|DayReview;canEdit:boolean;onEdit:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 return <div className="review-saved">
  <dl><div><dt>{say('النتيجة','Result')}</dt><dd>{review.result}</dd></div><div><dt>{say('الإجراء المطلوب','Required action')}</dt><dd>{review.action}</dd></div></dl>
  <p className="review-by">{review.reviewedByName||say('المشرف','Supervisor')} · <time dateTime={review.updatedAt} dir="ltr">{stamp(review.updatedAt,language)}</time></p>
  <div className="review-saved-foot"><ReviewReadStatus readAt={review.readAt}/>{canEdit&&<button type="button" className="btn subtle small" onClick={onEdit} data-review-edit><Pencil size={15} aria-hidden/>{say('تعديل','Edit')}</button>}</div>
 </div>;
}

/** Under one visit or contact of the report: the note on it, or «إضافة نتيجة وإجراء» for a reader who may write it. */
export function EntryReview({activityId}:{activityId:string}){
 const state=useContext(ReviewsContext);
 if(!state)return null;
 const review=state.reviews.entries.find(entry=>entry.activityId===activityId)||null,canReview=state.reviews.reviewable.includes(activityId);
 if(!review&&!canReview)return null;
 return <EntryReviewBlock key={activityId+':'+(review?.version||0)} activityId={activityId} review={review} canReview={canReview} onSaved={state.savedEntry}/>;
}
function EntryReviewBlock({activityId,review,canReview,onSaved}:{activityId:string;review:EntryReview|null;canReview:boolean;onSaved:(review:EntryReview)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),[editing,setEditing]=useState(false);
 const saving=useReviewSave('entry',{activityId},review?.version??null,validEntryReview,onSaved);
 return <section className={'review-entry'+(review?' saved':'')} data-entry-review={activityId} aria-label={say('نتيجة المشرف والإجراء المطلوب','Supervisor result and required action')} onClick={event=>event.stopPropagation()}>
  {editing&&canReview?<>
   <header><ClipboardCheck size={15} aria-hidden/><b>{say('نتيجة المشرف والإجراء المطلوب','Supervisor result and required action')}</b></header>
   <ReviewEditor initial={{result:review?.result||'',action:review?.action||''}} contextKey={'review-entry:'+activityId} busy={saving.busy} error={saving.error} labels={{result:say('تقييمك لهذه الزيارة أو التواصل','Your assessment of this visit or contact'),action:say('ما المطلوب من المندوب بعدها','What the representative should do next')}} onCancel={()=>{saving.clear();setEditing(false);}} onSave={value=>{void saving.save(value).then(done=>{if(done)setEditing(false);});}}/>
  </>:review?<>
   <header><ClipboardCheck size={15} aria-hidden/><b>{say('نتيجة المشرف والإجراء المطلوب','Supervisor result and required action')}</b></header>
   <SavedReview review={review} canEdit={canReview} onEdit={()=>setEditing(true)}/>
  </>:<button type="button" className="btn subtle small review-add" onClick={()=>setEditing(true)} data-review-add={activityId}><Plus size={15} aria-hidden/>{say('إضافة نتيجة وإجراء','Add result and action')}</button>}
 </section>;
}

/** The notes under several results of one card (a route stop or an observed stop may carry more than one visit or contact). */
export function EntryReviews({activityIds}:{activityIds:string[]}){
 const state=useContext(ReviewsContext);
 if(!state||!activityIds.some(id=>state.reviews.reviewable.includes(id)||state.reviews.entries.some(entry=>entry.activityId===id)))return null;
 return <div className="review-entries">{activityIds.map(id=><EntryReview key={id} activityId={id}/>)}</div>;
}

/** The note on the selected member's whole day («تقييم اليوم»), above the report. */
export function DayReviewPanel({memberName}:{memberName:string}){
 const state=useContext(ReviewsContext);
 if(!state||state.reviews.memberId==='all'||!state.reviews.day&&!state.reviews.dayReviewable)return null;
 const {reviews}=state;
 return <DayReviewBlock key={reviews.memberId+':'+reviews.date+':'+(reviews.day?.version||0)} memberId={reviews.memberId} date={reviews.date} memberName={memberName} review={reviews.day} canReview={reviews.dayReviewable} onSaved={state.savedDay}/>;
}
function DayReviewBlock({memberId,date,memberName,review,canReview,onSaved}:{memberId:string;date:string;memberName:string;review:DayReview|null;canReview:boolean;onSaved:(review:DayReview)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),[editing,setEditing]=useState(false);
 const saving=useReviewSave('day',{memberId,date},review?.version??null,validDayReview,onSaved);
 return <section className={'review-day'+(review?' saved':'')} data-day-review={memberId} aria-label={say('تقييم اليوم','Day review')}>
  <header><ClipboardCheck size={18} aria-hidden/><h2>{say('تقييم اليوم','Day review')}{memberName?' · '+memberName:''}</h2>{!review&&!editing&&<span className="review-day-state">{say('لم يُكتب بعد','Not written yet')}</span>}</header>
  {editing&&canReview
   ?<ReviewEditor initial={{result:review?.result||'',action:review?.action||''}} contextKey={'review-day:'+memberId+':'+date} busy={saving.busy} error={saving.error} labels={{result:say('تقييمك ليوم المندوب كله','Your assessment of the representative’s whole day'),action:say('ما المطلوب من المندوب بعده','What the representative should do next')}} onCancel={()=>{saving.clear();setEditing(false);}} onSave={value=>{void saving.save(value).then(done=>{if(done)setEditing(false);});}}/>
   :review?<SavedReview review={review} canEdit={canReview} onEdit={()=>setEditing(true)}/>
   :<button type="button" className="btn subtle small review-add" onClick={()=>setEditing(true)} data-review-add-day={memberId}><Plus size={15} aria-hidden/>{say('إضافة نتيجة وإجراء','Add result and action')}</button>}
 </section>;
}

/** «ملاحظات المشرف على شغلك»: the signed-in member's notes they have not read, at the top of every page until they press «قرأت». Asked
 * for on load, every 5 minutes and when the page comes back to the front (at most once a minute); nothing is asked offline, and a failed
 * check keeps what was shown. Nothing shows when there is nothing new. A failed «قرأت» keeps the note and says why. */
export function ReviewInboxCard({offline=false}:{offline?:boolean}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [inbox,setInbox]=useState<ReviewInbox|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const last=useRef(0),pending=useRef(false),offlineNow=useRef(offline);
 useEffect(()=>{offlineNow.current=offline;},[offline]);
 const load=useCallback(async(force=false)=>{
  if(pending.current||offlineNow.current||typeof document!=='undefined'&&document.visibilityState==='hidden'||!force&&Date.now()-last.current<REVIEW_INBOX_FOCUS_MS)return;
  pending.current=true;last.current=Date.now();
  try{const response=await fetch('/api/review-inbox',{cache:'no-store',credentials:'same-origin'});if(response.ok){const body:unknown=await response.json();if(validReviewInbox(body))setInbox(body);}}
  catch{/* offline or unreachable: the next check retries */}
  finally{pending.current=false;}
 },[]);
 useEffect(()=>{
  const first=setTimeout(()=>{void load(true);},0),timer=setInterval(()=>{void load(true);},REVIEW_INBOX_INTERVAL_MS),again=()=>{void load();};
  document.addEventListener('visibilitychange',again);window.addEventListener('focus',again);window.addEventListener('online',again);
  return()=>{clearTimeout(first);clearInterval(timer);document.removeEventListener('visibilitychange',again);window.removeEventListener('focus',again);window.removeEventListener('online',again);};
 },[load]);
 const read=async(items:ReviewInboxItem[],key:string)=>{
  if(busy)return;setBusy(key);setError('');
  try{
   const body=await submitJson<ReviewInbox>('/api/review-inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items.map(item=>({kind:item.kind,ref:item.ref,version:item.version}))})},{language,timeout:20000});
   if(!validReviewInbox(body))throw new Error(say('تعذر حفظ القراءة. حاول مرة أخرى.','Could not save. Try again.'));
   setInbox(body);
  }catch(e){setError(offline?say('لا يوجد اتصال. اضغط «قرأت» مرة أخرى عند عودة الاتصال.','You are offline. Press Read again once you are back online.'):errorText(e,say('تعذر حفظ القراءة. حاول مرة أخرى.','Could not save. Try again.')));}
  finally{setBusy('');}
 };
 if(!inbox?.items.length)return null;
 const items=inbox.items,title=say('ملاحظات المشرف على شغلك','Your supervisor’s notes on your work');
 return <section className="review-inbox no-print" aria-label={title} data-review-inbox>
  <header><h2><MessageSquareText size={19} aria-hidden/>{title} <span className="review-count" data-review-count>{items.length}{inbox.more?'+':''}</span></h2>
   {items.length>1&&<button type="button" className="btn subtle small" disabled={!!busy} onClick={()=>{void read(items,'all');}} data-review-read-all>{busy==='all'?<Loader2 size={16} className="spin" aria-hidden/>:<CheckCheck size={16} aria-hidden/>}{say('قرأت الكل','Mark all read')}</button>}</header>
  {error&&<p className="review-error" role="alert"><AlertCircle size={15} aria-hidden/>{error}</p>}
  <ol>{items.map(item=>{const key=item.kind+':'+item.ref+':'+item.version,type=activityTypes[item.activityType];return <li key={key} data-review-item={item.ref} data-review-kind={item.kind}>
   <p className="review-about">{item.kind==='day'?<strong>{say('تقييم اليوم','Day review')} {dayLabel(item.date,language)}</strong>:<><strong>{[type?type[language==='en'?1:0]:say('زيارة أو تواصل','Visit or contact'),item.customerName].filter(Boolean).join(' · ')}</strong> <span>{dayLabel(item.date,language)}</span></>}</p>
   <dl><div><dt>{say('النتيجة','Result')}</dt><dd>{item.result}</dd></div><div><dt>{say('الإجراء المطلوب','Required action')}</dt><dd>{item.action}</dd></div></dl>
   <div className="review-inbox-foot"><span className="review-by">{item.reviewedByName||say('المشرف','Supervisor')} · <time dateTime={item.updatedAt} dir="ltr">{stamp(item.updatedAt,language)}</time></span><button type="button" className="btn primary small" disabled={!!busy} onClick={()=>{void read([item],key);}} data-review-read={item.ref}>{busy===key?<Loader2 size={15} className="spin" aria-hidden/>:<CheckCheck size={15} aria-hidden/>}{say('قرأت','Read')}</button></div>
  </li>;})}</ol>
 </section>;
}

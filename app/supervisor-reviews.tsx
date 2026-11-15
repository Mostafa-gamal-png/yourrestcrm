'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {AlertCircle,BellRing,CalendarDays,CheckCheck,ClipboardCheck,ClipboardList,Eye,EyeOff,Loader2,MessageSquareText,Pencil,Plus,RefreshCw,Users} from 'lucide-react';
import {toast} from 'sonner';
import {t,useLanguage} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import {isNativeTrackingApp} from '@/lib/native-tracking';
import {isServiceRole} from '@/lib/customer-service';
import {journeyDate} from '@/lib/journeys';
import VoiceField from './voice-field';
import {CHOSEN_RATINGS,RATING_TEXT,REVIEW_INBOX_FOCUS_MS,REVIEW_INBOX_INTERVAL_MS,REVIEW_TEXT_MAX,REVIEW_TEXT_MIN,activityTypeText,hiddenPageMayAsk,rememberedNotes,reviewAskedStorageKey,reviewNoteKey,reviewNoticeStep,reviewNoticeStorageKey,reviewNoticeText,validCustomerNotes,validDayReview,validEntryReview,validReportReviews,validReviewInbox,validReviewsMade,type ChosenRating,type CustomerNotes,type DayReview,type EntryRating,type EntryReview,type ReportReviews,type ReviewInbox,type ReviewInboxItem,type ReviewsMade} from '@/lib/supervisor-reviews';
import './supervisor-reviews.css';

/** The supervisor's notes on a member's work (lib/supervisor-reviews.ts; GSCO components/crm/daily-entry-review.tsx,
 * daily-report-review.tsx, review-inbox.tsx and supervisor-notes.tsx). On «تقرير يوم المندوب»: «إضافة نتيجة وإجراء» under each visit or
 * contact the reader may note, with the evaluation («فعالة» or «سلبية» chosen, «إيجابية» by itself on a sale), the saved note with
 * «تعديل» and whether the member read it, and the note on the member's whole day; «تقرير مراجعاتي» beside it. On every page: the card
 * «ملاحظات المشرف على عملك» for the member who has notes they have not read, «قرأت» on each, and the notice of a new one. On the follow-up
 * screen and the customer's details: «ملاحظات المشرف السابقة», read-only. */

const selectText=(language:string,ar:string,en:string)=>language==='en'?en:ar;
const stampFormats=new Map<string,Intl.DateTimeFormat>();
/** A note's moment («15 نوفمبر، 09:28» / «15 Nov, 09:28»), shown in a <time dir="auto"> so the Arabic month keeps its order (a forced
 * left-to-right put the day after the time). */
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
const errorText=(error:unknown,fallback:string)=>error instanceof Error&&error.message?t(error.message):fallback;

/** The evaluation of a visit or contact: «إيجابية» (the sale, set by the system), «فعالة» or «سلبية»; nothing for a note saved before. */
export function RatingPill({rating}:{rating?:EntryRating|null}){
 const {language}=useLanguage();
 if(!rating)return null;
 const [ar,en]=RATING_TEXT[rating];
 return <span className={'review-rating '+rating} data-entry-rating={rating}>{language==='en'?en:ar}</span>;
}

/** Beside a saved note: whether the member it is about has read this version, and when. */
export function ReviewReadStatus({readAt}:{readAt:string|null}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 return readAt
  ?<p className="review-read-status read" data-review-read="yes"><Eye size={14} aria-hidden/>{say('تمت القراءة','Read')} <time dateTime={readAt} dir="auto">{stamp(readAt,language)}</time></p>
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

type ReviewValue={result:string;action:string;rating?:ChosenRating|null};
/** rating: on a visit or contact, «auto» shows «إيجابية» (the sale) and asks nothing; «choose» asks «فعالة» or «سلبية» (required). A day
 *  note has none. */
type RatingMode={mode:'auto'}|{mode:'choose';initial:ChosenRating|''};
/** The two required fields, each with dictation, the evaluation of a visit or contact, Save and Cancel. A retry after a lost answer reuses
 * its request id, so the server answers with the saved note instead of a conflict. */
function ReviewEditor({initial,contextKey,busy,error,onSave,onCancel,labels,rating}:{initial:{result:string;action:string};contextKey:string;busy:boolean;error:string;onSave:(value:ReviewValue)=>void;onCancel:()=>void;labels:{result:string;action:string};rating?:RatingMode}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [result,setResult]=useState(initial.result),[action,setAction]=useState(initial.action),[chosen,setChosen]=useState<ChosenRating|''>(rating?.mode==='choose'?rating.initial:''),[problem,setProblem]=useState('');
 const short=result.trim().length<REVIEW_TEXT_MIN||action.trim().length<REVIEW_TEXT_MIN,unrated=rating?.mode==='choose'&&!chosen;
 return <form className="review-form" noValidate onSubmit={event=>{event.preventDefault();if(busy)return;if(unrated){setProblem(say('اختر التقييم: فعالة أو سلبية.','Choose the evaluation: effective or negative.'));return;}if(short){setProblem(say('اكتب النتيجة والإجراء المطلوب؛ الخانتان إلزاميتان.','Write the result and the required action; both fields are required.'));return;}setProblem('');onSave({result:result.trim(),action:action.trim(),...(rating?{rating:rating.mode==='choose'?chosen||null:null}:{})});}}>
  {rating?.mode==='auto'&&<p className="review-rating-auto" data-rating-auto><span>{say('التقييم','Evaluation')}</span><RatingPill rating="positive"/><small>{say('تلقائي: تم البيع','Automatic: a sale')}</small></p>}
  {rating?.mode==='choose'&&<fieldset className="review-rating-choice" disabled={busy}><legend>{say('التقييم','Evaluation')} <b aria-hidden="true">*</b></legend><div>{CHOSEN_RATINGS.map(value=><label key={value} className={'review-rating-option '+value+(chosen===value?' chosen':'')}><input type="radio" name={'rating-'+contextKey} value={value} checked={chosen===value} onChange={()=>{setChosen(value);setProblem('');}}/><span>{say(RATING_TEXT[value][0],RATING_TEXT[value][1])}</span></label>)}</div></fieldset>}
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
 const save=async(value:ReviewValue)=>{
  if(busy)return false;setBusy(true);setError('');
  try{
   const payload=JSON.stringify({kind,...target,result:value.result,action:value.action,...(kind==='entry'?{rating:value.rating??null}:{}),version});
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
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),rating='rating' in review?review.rating:'';
 return <div className="review-saved">
  <dl>{rating&&<div><dt>{say('التقييم','Evaluation')}</dt><dd><RatingPill rating={rating}/></dd></div>}<div><dt>{say('النتيجة','Result')}</dt><dd>{review.result}</dd></div><div><dt>{say('الإجراء المطلوب','Required action')}</dt><dd>{review.action}</dd></div></dl>
  <p className="review-by">{review.reviewedByName||say('المشرف','Supervisor')} · <time dateTime={review.updatedAt} dir="auto">{stamp(review.updatedAt,language)}</time></p>
  <div className="review-saved-foot"><ReviewReadStatus readAt={review.readAt}/>{canEdit&&<button type="button" className="btn subtle small" onClick={onEdit} data-review-edit><Pencil size={15} aria-hidden/>{say('تعديل','Edit')}</button>}</div>
 </div>;
}

/** Under one visit or contact of the report: the note on it, or «إضافة نتيجة وإجراء» for a reader who may write it. */
export function EntryReview({activityId}:{activityId:string}){
 const state=useContext(ReviewsContext);
 if(!state)return null;
 const review=state.reviews.entries.find(entry=>entry.activityId===activityId)||null,canReview=state.reviews.reviewable.includes(activityId);
 if(!review&&!canReview)return null;
 return <EntryReviewBlock key={activityId+':'+(review?.version||0)} activityId={activityId} review={review} canReview={canReview} sale={!!state.reviews.sales?.includes(activityId)} onSaved={state.savedEntry}/>;
}
function EntryReviewBlock({activityId,review,canReview,sale,onSaved}:{activityId:string;review:EntryReview|null;canReview:boolean;sale:boolean;onSaved:(review:EntryReview)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),[editing,setEditing]=useState(false);
 const saving=useReviewSave('entry',{activityId},review?.version??null,validEntryReview,onSaved);
 return <section className={'review-entry'+(review?' saved':'')} data-entry-review={activityId} aria-label={say('نتيجة المشرف والإجراء المطلوب','Supervisor result and required action')} onClick={event=>event.stopPropagation()}>
  {editing&&canReview?<>
   <header><ClipboardCheck size={15} aria-hidden/><b>{say('نتيجة المشرف والإجراء المطلوب','Supervisor result and required action')}</b></header>
   <ReviewEditor initial={{result:review?.result||'',action:review?.action||''}} rating={sale?{mode:'auto'}:{mode:'choose',initial:review?.rating==='effective'||review?.rating==='negative'?review.rating:''}} contextKey={'review-entry:'+activityId} busy={saving.busy} error={saving.error} labels={{result:say('تقييمك لهذه الزيارة أو التواصل','Your assessment of this visit or contact'),action:say('ما المطلوب من المندوب بعدها','What the representative should do next')}} onCancel={()=>{saving.clear();setEditing(false);}} onSave={value=>{void saving.save(value).then(done=>{if(done)setEditing(false);});}}/>
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

/** Storage of this browser, which a private window or a full disk may refuse: then nothing is remembered between pages. */
function stored(key:string):string|null{try{return localStorage.getItem(key);}catch{return null;}}
function store(key:string,value:string){try{localStorage.setItem(key,value);return true;}catch{return false;}}
const notificationsSupported=()=>typeof window!=='undefined'&&'Notification' in window&&!isNativeTrackingApp();
const notificationsGranted=()=>notificationsSupported()&&Notification.permission==='granted';
/** The device's own notification of new notes, where the browser allows it (never inside the Android app, whose web view has none): through
 * the page's service worker when one is active (Chrome on a phone requires it), else the page's own Notification. One per note set (tag). */
async function deviceNotice(title:string,body:string,tag:string,language:string){
 if(!notificationsGranted())return;
 const options={body,tag,lang:language==='en'?'en':'ar',dir:(language==='en'?'ltr':'rtl') as NotificationDirection,icon:'/icons/yourrest-company-192.png',data:{url:'/'}};
 try{const registration=await navigator.serviceWorker?.getRegistration('/');if(registration?.active){await registration.showNotification(title,options);return;}}catch{/* fall back to the page's own notification */}
 try{const notice=new Notification(title,options);notice.onclick=()=>{window.focus();notice.close();};}catch{/* the browser refused: the message on the page stays */}
}

/** «ملاحظات المشرف على عملك»: the signed-in member's notes they have not read, at the top of every page until they press «قرأت» on each
 * (one at a time since 2026-11-15: no «قرأت الكل»). Asked for on load, every 5 minutes and when the page comes back to the front (at most
 * once a minute); a page in the background asks only when the device may show the notification (hiddenPageMayAsk); nothing is asked
 * offline, and a failed check keeps what was shown. A note this browser has not shown before is announced on the open page and, where
 * allowed, by the device (lib/supervisor-reviews.ts reviewNoticeStep), and marked «جديدة» in the card until read. Nothing shows when there
 * is nothing new. A failed «قرأت» keeps the note and says why. */
export function ReviewInboxCard({offline=false,memberId=''}:{offline?:boolean;memberId?:string}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [inbox,setInbox]=useState<ReviewInbox|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[fresh,setFresh]=useState<ReadonlySet<string>>(()=>new Set());
 // The card shows only after its first check (after mounting), so reading the browser's permission at once matches the server's render.
 const [permission,setPermission]=useState<'default'|'granted'|'denied'|'unsupported'>(()=>notificationsSupported()?Notification.permission as 'default'|'granted'|'denied':'unsupported');
 const last=useRef(0),pending=useRef(false),offlineNow=useRef(offline),memory=useRef<string[]|null>(null),languageNow=useRef(language),card=useRef<HTMLElement|null>(null);
 useEffect(()=>{offlineNow.current=offline;},[offline]);
 useEffect(()=>{languageNow.current=language;},[language]);
 const announce=useCallback((items:ReviewInboxItem[])=>{
  const seenKey=memberId?reviewNoticeStorageKey(memberId):'',raw=seenKey?stored(seenKey):null,remembered=raw!==null?rememberedNotes(raw):memory.current;
  const step=reviewNoticeStep(items,remembered);
  memory.current=step.remember;if(seenKey)store(seenKey,JSON.stringify(step.remember));
  if(!step.announce.length)return;
  setFresh(current=>new Set([...current,...step.announce.map(reviewNoteKey)]));
  const words=reviewNoticeText(step.announce,languageNow.current),en=languageNow.current==='en';
  toast(words.title,{id:'review-notice',description:words.body,duration:12000,action:{label:en?'Show':'عرض',onClick:()=>card.current?.scrollIntoView({block:'start',behavior:'smooth'})}});
  void deviceNotice(words.title,words.body,'yourrest-review:'+step.announce.map(reviewNoteKey).join('|').slice(0,200),languageNow.current);
 },[memberId]);
 const load=useCallback(async(force=false)=>{
  const hidden=typeof document!=='undefined'&&document.visibilityState==='hidden',askedKey=memberId?reviewAskedStorageKey(memberId):'';
  if(pending.current||offlineNow.current||!force&&Date.now()-last.current<REVIEW_INBOX_FOCUS_MS)return;
  if(hidden){const asked=askedKey?Number(stored(askedKey)):Number.NaN;if(!hiddenPageMayAsk(Date.now(),Number.isFinite(asked)?asked:null,notificationsGranted()))return;}
  pending.current=true;last.current=Date.now();if(askedKey)store(askedKey,String(last.current));
  try{const response=await fetch('/api/review-inbox',{cache:'no-store',credentials:'same-origin'});if(response.ok){const body:unknown=await response.json();if(validReviewInbox(body)){setInbox(body);announce(body.items);}}}
  catch{/* offline or unreachable: the next check retries */}
  finally{pending.current=false;}
 },[announce,memberId]);
 useEffect(()=>{
  const first=setTimeout(()=>{void load(true);},0),timer=setInterval(()=>{void load(true);},REVIEW_INBOX_INTERVAL_MS),again=()=>{void load();};
  document.addEventListener('visibilitychange',again);window.addEventListener('focus',again);window.addEventListener('online',again);
  return()=>{clearTimeout(first);clearInterval(timer);document.removeEventListener('visibilitychange',again);window.removeEventListener('focus',again);window.removeEventListener('online',again);};
 },[load]);
 const read=async(item:ReviewInboxItem,key:string)=>{
  if(busy)return;setBusy(key);setError('');
  try{
   const body=await submitJson<ReviewInbox>('/api/review-inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{kind:item.kind,ref:item.ref,version:item.version}]})},{language,timeout:20000});
   if(!validReviewInbox(body))throw new Error(say('تعذر حفظ القراءة. حاول مرة أخرى.','Could not save. Try again.'));
   setInbox(body);
  }catch(e){setError(offline?say('لا يوجد اتصال. اضغط «قرأت» مرة أخرى عند عودة الاتصال.','You are offline. Press Read again once you are back online.'):errorText(e,say('تعذر حفظ القراءة. حاول مرة أخرى.','Could not save. Try again.')));}
  finally{setBusy('');}
 };
 const allow=async()=>{try{setPermission(await Notification.requestPermission() as 'default'|'granted'|'denied');}catch{setPermission('denied');}};
 if(!inbox?.items.length)return null;
 const items=inbox.items,title=say('ملاحظات المشرف على عملك','Your supervisor’s notes on your work');
 return <section ref={card} className="review-inbox no-print" aria-label={title} data-review-inbox>
  <header><h2><MessageSquareText size={19} aria-hidden/>{title} <span className="review-count" data-review-count>{items.length}{inbox.more?'+':''}</span></h2>
   {permission==='default'&&<button type="button" className="btn subtle small" onClick={()=>{void allow();}} data-review-notify><BellRing size={16} aria-hidden/>{say('تنبيهي بالملاحظات الجديدة على هذا الجهاز','Notify me of new notes on this device')}</button>}</header>
  {error&&<p className="review-error" role="alert"><AlertCircle size={15} aria-hidden/>{error}</p>}
  <ol>{items.map(item=>{const key=reviewNoteKey(item);return <li key={key} data-review-item={item.ref} data-review-kind={item.kind} data-review-new={fresh.has(key)?'yes':undefined}>
   <p className="review-about">{fresh.has(key)&&<span className="review-new">{say('جديدة','New')}</span>}{item.kind==='day'?<strong>{say('تقييم اليوم','Day review')} {dayLabel(item.date,language)}</strong>:<><strong>{[activityTypeText(item.activityType,language),item.customerName].filter(Boolean).join(' · ')}</strong> <span>{dayLabel(item.date,language)}</span></>}</p>
   {item.rating&&<p className="review-rating-line"><span>{say('التقييم','Evaluation')}</span><RatingPill rating={item.rating}/></p>}
   <dl><div><dt>{say('النتيجة','Result')}</dt><dd>{item.result}</dd></div><div><dt>{say('الإجراء المطلوب','Required action')}</dt><dd>{item.action}</dd></div></dl>
   <div className="review-inbox-foot"><span className="review-by">{item.reviewedByName||say('المشرف','Supervisor')} · <time dateTime={item.updatedAt} dir="auto">{stamp(item.updatedAt,language)}</time></span><button type="button" className="btn primary small" disabled={!!busy} onClick={()=>{void read(item,key);}} data-review-read={item.ref}>{busy===key?<Loader2 size={15} className="spin" aria-hidden/>:<CheckCheck size={15} aria-hidden/>}{say('قرأت','Read')}</button></div>
  </li>;})}</ol>
 </section>;
}

/** «ملاحظات المشرف السابقة»: on the follow-up screen and the customer's details, the reviewers' notes on this customer's earlier visits and
 * contacts, read-only (GET /api/reviews/customer; lib/supervisor-reviews.ts CustomerNotes). Three show, the rest behind «عرض كل
 * الملاحظات». Nothing shows when there is none, when offline, for customer service, or when the answer fails. */
export function CustomerReviewNotes({customerId,me,offline=false}:{customerId:string;me:{id:string;role:string};offline?:boolean}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [state,setState]=useState<{key:string;notes:CustomerNotes|null}>({key:'',notes:null}),[all,setAll]=useState(false);
 const skip=!customerId||isServiceRole(me.role)||offline;
 useEffect(()=>{
  if(skip||typeof navigator!=='undefined'&&navigator.onLine===false)return;
  const controller=new AbortController();
  void fetch('/api/reviews/customer?'+new URLSearchParams({customerId}),{cache:'no-store',credentials:'same-origin',signal:controller.signal}).then(async response=>{
   if(!response.ok)return;const body:unknown=await response.json();
   if(!controller.signal.aborted&&validCustomerNotes(body))setState({key:customerId,notes:body});
  }).catch(()=>{/* offline or refused: nothing to show */});
  return()=>controller.abort();
 },[customerId,skip,me.id]);
 const notes=state.key===customerId?state.notes?.notes||[]:[];
 if(skip||!notes.length)return null;
 const shown=all?notes:notes.slice(0,3),title=say('ملاحظات المشرف السابقة','Earlier supervisor notes');
 return <section className="review-history" aria-label={title} data-review-history={customerId}>
  <header><MessageSquareText size={17} aria-hidden/><h3>{title}</h3><span className="review-count">{notes.length}{state.notes?.more?'+':''}</span></header>
  <ol>{shown.map(note=><li key={note.activityId} data-review-note={note.activityId}>
   <p className="review-about"><strong>{[note.followup?say('متابعة','Follow-up'):'',activityTypeText(note.activityType,language)].filter(Boolean).join(' · ')}</strong> <span>{dayLabel(note.date,language)}{note.memberId!==me.id&&note.memberName?' · '+note.memberName:''}</span> <RatingPill rating={note.rating}/></p>
   <dl><div><dt>{say('النتيجة','Result')}</dt><dd>{note.result}</dd></div><div><dt>{say('الإجراء المطلوب','Required action')}</dt><dd>{note.action}</dd></div></dl>
   <p className="review-by">{note.reviewedByName||say('المشرف','Supervisor')} · <time dateTime={note.updatedAt} dir="auto">{stamp(note.updatedAt,language)}</time></p>
  </li>)}</ol>
  {notes.length>3&&<button type="button" className="btn subtle small" onClick={()=>setAll(value=>!value)} aria-expanded={all} data-review-history-all>{all?say('عرض أقل','Show fewer'):say('عرض كل الملاحظات','Show all notes')+' ('+notes.length+')'}</button>}
 </section>;
}

/** «تقرير مراجعاتي»: what the reader (or, for the administrator and a sales manager, a reviewer they choose) wrote on one day, today by
 * default (GET /api/reviews/made; lib/supervisor-reviews.ts ReviewsMade): the counts first, then each note on a visit or contact with the
 * member, the customer, the evaluation, what the representative recorded, the result, the required action and whether it was read; then the
 * notes on whole days. */
export function ReviewsMadeReport(){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [date,setDate]=useState(()=>journeyDate()),[reviewerId,setReviewerId]=useState(''),[refresh,setRefresh]=useState(0);
 const [state,setState]=useState<{key:string;data:ReviewsMade|null;error:string}>({key:'',data:null,error:''});
 const key=date+'|'+reviewerId+'|'+refresh;
 useEffect(()=>{
  const controller=new AbortController(),params=new URLSearchParams({date});if(reviewerId)params.set('reviewerId',reviewerId);
  void submitJson<ReviewsMade>('/api/reviews/made?'+params,{cache:'no-store',signal:controller.signal},{language}).then(body=>{
   if(controller.signal.aborted)return;
   if(!validReviewsMade(body))throw new Error(say('تعذر تحميل تقرير المراجعات.','Could not load the reviews report.'));
   setState({key,data:body,error:''});
  }).catch(error=>{
   if(controller.signal.aborted||error?.name==='AbortError')return;
   if(error?.status===403&&reviewerId){setReviewerId('');return;}
   setState({key,data:null,error:errorText(error,say('تعذر تحميل تقرير المراجعات.','Could not load the reviews report.'))});
  });
  return()=>controller.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps -- key names the date, the reviewer and the refresh; say follows language
 },[key,language]);
 const current=state.key===key?state:null,data=current?.data||null,counts=data?.counts;
 const reviewer=data?.reviewers.find(item=>item.id===data.reviewerId);
 const chips:{key:string;label:string;value:number;tone?:string}[]=counts?[
  {key:'notes',label:say('الملاحظات','Notes'),value:counts.notes},
  {key:'members',label:say('أعضاء الفريق','Team members'),value:counts.members},
  {key:'positive',label:say('إيجابية','Positive'),value:counts.positive,tone:'positive'},
  {key:'effective',label:say('فعالة','Effective'),value:counts.effective,tone:'effective'},
  {key:'negative',label:say('سلبية','Negative'),value:counts.negative,tone:'negative'},
  ...(counts.unrated?[{key:'unrated',label:say('بدون تقييم','Not evaluated'),value:counts.unrated}]:[]),
  {key:'read',label:say('تمت قراءتها','Read'),value:counts.read},
  {key:'unread',label:say('لم تُقرأ بعد','Not read yet'),value:counts.unread,tone:counts.unread?'attention':undefined},
  {key:'days',label:say('تقييمات الأيام','Day reviews'),value:counts.days}
 ]:[];
 return <section className="reviews-made" aria-label={say('تقرير مراجعاتي','My reviews report')} data-reviews-made>
  <div className="journey-toolbar reviews-made-toolbar">
   <label><span><CalendarDays size={16} aria-hidden/>{say('اليوم','Day')}</span><input type="date" value={date} max={journeyDate()} required aria-label={say('تاريخ تقرير المراجعات','Reviews report date')} onChange={event=>{if(event.target.value)setDate(event.target.value);}}/></label>
   {data&&data.reviewers.length>1&&<label><span><Users size={16} aria-hidden/>{say('المراجِع','Reviewer')}</span><select aria-label={say('المراجِع في تقرير المراجعات','Reviewer of the reviews report')} value={data.reviewerId} onChange={event=>setReviewerId(event.target.value)}>{data.reviewers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
   <button type="button" className="btn subtle" disabled={!current} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={17} className={current?'':'spin'} aria-hidden/>{say('تحديث التقرير','Refresh report')}</button>
  </div>
  {!current?<div className="journey-empty" role="status"><Loader2 size={28} className="spin" aria-hidden/><p>{say('جارٍ تحميل تقرير المراجعات…','Loading the reviews report…')}</p></div>
  :current.error?<div className="journey-error" role="alert"><AlertCircle size={22} aria-hidden/><p>{current.error}</p><button type="button" className="btn subtle" onClick={()=>setRefresh(value=>value+1)}>{say('إعادة المحاولة','Try again')}</button></div>
  :data&&<>
   <header className="reviews-made-head"><h2><ClipboardList size={18} aria-hidden/>{say('ما راجعه','What was reviewed by')} {reviewer?.name||''}</h2><p>{dayLabel(data.date,language)}</p></header>
   <dl className="reviews-made-counts" data-reviews-counts>{chips.map(chip=><div key={chip.key} className={chip.tone} data-count={chip.key}><dt>{chip.label}</dt><dd>{chip.value}</dd></div>)}</dl>
   {!data.entries.length&&!data.days.length?<p className="reviews-made-empty">{say('لا توجد مراجعات محفوظة في هذا اليوم.','No reviews were saved on this day.')}</p>:null}
   {!!data.entries.length&&<section className="reviews-made-list"><h3>{say('ملاحظات الزيارات والتواصل','Notes on visits and contacts')}</h3><ol>{data.entries.map(entry=><li key={entry.activityId} data-review-made={entry.activityId}>
    <header><strong>{entry.memberName||say('عضو الفريق','Team member')}</strong><span>{[entry.followup?say('متابعة','Follow-up'):'',activityTypeText(entry.activityType,language),entry.customerName].filter(Boolean).join(' · ')}{entry.activityDate!==data.date?' · '+dayLabel(entry.activityDate,language):''}</span><time dateTime={entry.savedAt} dir="auto">{stamp(entry.savedAt,language)}</time><RatingPill rating={entry.rating}/></header>
    <dl>{entry.memberResult&&<div><dt>{say('ما سجّله المندوب','What the representative recorded')}</dt><dd>{entry.memberResult}</dd></div>}<div><dt>{say('النتيجة','Result')}</dt><dd>{entry.result}</dd></div><div><dt>{say('الإجراء المطلوب','Required action')}</dt><dd>{entry.action}</dd></div></dl>
    <ReviewReadStatus readAt={entry.readAt}/>
   </li>)}</ol></section>}
   {!!data.days.length&&<section className="reviews-made-list"><h3>{say('تقييمات الأيام','Day reviews')}</h3><ol>{data.days.map(note=><li key={note.memberId+'|'+note.date} data-review-made-day={note.memberId}>
    <header><strong>{note.memberName||say('عضو الفريق','Team member')}</strong><span>{say('تقييم اليوم','Day review')} {dayLabel(note.date,language)}</span><time dateTime={note.savedAt} dir="auto">{stamp(note.savedAt,language)}</time></header>
    <dl><div><dt>{say('النتيجة','Result')}</dt><dd>{note.result}</dd></div><div><dt>{say('الإجراء المطلوب','Required action')}</dt><dd>{note.action}</dd></div></dl>
    <ReviewReadStatus readAt={note.readAt}/>
   </li>)}</ol></section>}
  </>}
 </section>;
}

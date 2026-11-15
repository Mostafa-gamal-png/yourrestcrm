'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,ClipboardX} from 'lucide-react';
import type {Member} from '@/lib/crm';
import {useLanguage} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import {journeyDate} from '@/lib/journeys';
import {REVIEW_PENDING_DAYS,REVIEW_PENDING_FOCUS_MS,REVIEW_PENDING_INTERVAL_MS,reviewPendingLines,validReviewPending,type ReviewPending,type ReviewPendingItem} from '@/lib/supervisor-reviews';
import './review-pending.css';

/** «زيارات ومتابعات بلا نتيجة أو إجراء» (lib/supervisor-reviews.ts ReviewPending, GET /api/reviews/pending): the red card at the very top of
 * the first screen of a supervisor or a sales manager (app/team-home.tsx decides who). Asked when it opens, every 5 minutes while the
 * page is in front and when the page comes back to the front (at most once a minute); never while offline. Nothing is drawn while nothing
 * waits, while it loads, or when the answer cannot be had (the day report itself stays the place to see the work). Each line opens «تقرير
 * يوم المندوب» on that representative and day; pressing anywhere else on the card opens the newest line. */
const dayFormats=new Map<string,Intl.DateTimeFormat>();
/** «الأحد 15 نوفمبر» / «Sunday 15 November»; «اليوم» and «أمس» for the two latest days. */
export function pendingDayLabel(date:string,language:string,today=journeyDate()){
 const en=language==='en',at=Date.parse(date+'T12:00:00Z'),now=Date.parse(today+'T12:00:00Z');
 if(!Number.isFinite(at))return date;
 if(at===now)return en?'Today':'اليوم';
 if(now-at===86_400_000)return en?'Yesterday':'أمس';
 const locale=en?'en-GB':'ar-SA';
 let format=dayFormats.get(locale);
 if(!format){format=new Intl.DateTimeFormat(locale,{calendar:'gregory',numberingSystem:'latn',timeZone:'UTC',weekday:'long',day:'numeric',month:'long'});dayFormats.set(locale,format);}
 return format.format(new Date(at));
}

export function ReviewPendingCard({me,offline,onDayReport}:{me:Member;offline:boolean;onDayReport:(memberId:string,date:string)=>void}){
 const [data,setData]=useState<ReviewPending|null>(null);
 const last=useRef(0),pending=useRef(false),offlineNow=useRef(offline);
 useEffect(()=>{offlineNow.current=offline;},[offline]);
 const load=useCallback(async(force=false)=>{
  if(pending.current||offlineNow.current||typeof document!=='undefined'&&document.visibilityState==='hidden'||!force&&Date.now()-last.current<REVIEW_PENDING_FOCUS_MS)return;
  pending.current=true;last.current=Date.now();
  try{
   const body=await submitJson<unknown>('/api/reviews/pending',{cache:'no-store'},{language:document.documentElement.lang==='en'?'en':'ar',timeout:20000});
   if(validReviewPending(body))setData(body);
  }catch{/* The card waits for the next ask; the day report is unchanged. */}
  finally{pending.current=false;}
 },[]);
 useEffect(()=>{
  const first=setTimeout(()=>{void load(true);},0),timer=setInterval(()=>{void load(true);},REVIEW_PENDING_INTERVAL_MS),again=()=>{void load();};
  document.addEventListener('visibilitychange',again);window.addEventListener('focus',again);window.addEventListener('online',again);
  return()=>{clearTimeout(first);clearInterval(timer);document.removeEventListener('visibilitychange',again);window.removeEventListener('focus',again);window.removeEventListener('online',again);};
 },[load,me.id]);
 return <ReviewPendingView data={data} onDayReport={onDayReport}/>;
}

/** What the card shows, from what it holds (the asking stays in ReviewPendingCard). */
export function ReviewPendingView({data,onDayReport}:{data:ReviewPending|null;onDayReport:(memberId:string,date:string)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar,rtl=language!=='en';
 if(!data||!data.total||!data.items.length)return null;
 const {lines,others}=reviewPendingLines(data.items),newest=data.items[0];
 const open=(item:ReviewPendingItem)=>onDayReport(item.memberId,item.date);
 const title=say('زيارات ومتابعات بلا نتيجة أو إجراء','Visits and follow-ups with no result or action');
 const Chevron=rtl?ChevronLeft:ChevronRight;
 return <section className="review-pending no-print" aria-label={title} data-review-pending onClick={event=>{if(!(event.target as HTMLElement).closest('button'))open(newest);}}>
  <button type="button" className="review-pending-head" onClick={()=>open(newest)} data-review-pending-open aria-label={say(`${title}: ${data.total}. فتح الأحدث: ${newest.name}، ${pendingDayLabel(newest.date,language)}`,`${title}: ${data.total}. Open the newest: ${newest.name}, ${pendingDayLabel(newest.date,language)}`)}>
   <span className="review-pending-icon" aria-hidden><ClipboardX size={20}/></span>
   <span className="review-pending-text"><span className="review-pending-title">{title}: <b data-review-pending-total>{data.total}</b></span><small>{say(`آخر ${REVIEW_PENDING_DAYS} أيام، لم يُكتب عليها نتيجة وإجراء المشرف بعد. اضغط السطر لفتح تقرير يوم المندوب.`,`The last ${REVIEW_PENDING_DAYS} days, still without the supervisor's result and action. Tap a line to open the representative's day report.`)}</small></span>
   <Chevron size={18} aria-hidden className="review-pending-chevron"/>
  </button>
  <ul className="review-pending-list">{lines.map(item=><li key={item.memberId+'|'+item.date}>
   <button type="button" onClick={()=>open(item)} data-review-pending-line={item.memberId+'|'+item.date} aria-label={say(`${item.name}، ${pendingDayLabel(item.date,language)}: ${item.pending} بلا نتيجة أو إجراء`,`${item.name}, ${pendingDayLabel(item.date,language)}: ${item.pending} with no result or action`)}>
    <span className="review-pending-name">{item.name||say('مندوب','Representative')}</span>
    <time className="review-pending-day" dateTime={item.date} dir="auto">{pendingDayLabel(item.date,language)}</time>
    <b className="review-pending-count">{item.pending}</b>
    <Chevron size={16} aria-hidden/>
   </button>
  </li>)}</ul>
  {others>0&&<p className="review-pending-more" data-review-pending-more>{say(`وأيام أخرى: ${others}`,`And other days: ${others}`)}</p>}
 </section>;
}

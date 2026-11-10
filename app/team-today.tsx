'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {AlertCircle,ChevronLeft,ChevronRight,FileText,Loader2,RefreshCw,Users} from 'lucide-react';
import {roles,type Member} from '@/lib/crm';
import {t,useLanguage} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import {TEAM_TODAY_FOCUS_MS,TEAM_TODAY_INTERVAL_MS,validTeamToday,type TeamToday,type TeamTodayRow} from '@/lib/team-today';

/** «فريقي النهارده» (lib/team-today.ts, GET /api/team-today): on the supervisor's first screen (the dashboard). Asked when it opens, every
 * 5 minutes while the page is in front and when the page comes back to the front (at most once a minute); never while offline. Each
 * row opens «تقرير يوم المندوب» of that member for today. */
const FAILED='team-today:failed';
const clockOf=(value:string|null|undefined,language:string)=>{const at=Date.parse(value||'');return Number.isFinite(at)?new Intl.DateTimeFormat(language==='ar'?'ar-SA':'en-GB',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at)):'';};

export function TeamTodayCard({me,offline,onDayReport}:{me:Member;offline:boolean;onDayReport:(memberId:string)=>void}){
 const [data,setData]=useState<TeamToday|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const last=useRef(0),pending=useRef(false),offlineNow=useRef(offline);
 useEffect(()=>{offlineNow.current=offline;},[offline]);
 const load=useCallback(async(force=false)=>{
  if(pending.current||offlineNow.current||typeof document!=='undefined'&&document.visibilityState==='hidden'||!force&&Date.now()-last.current<TEAM_TODAY_FOCUS_MS)return;
  pending.current=true;last.current=Date.now();setLoading(true);
  try{
   const body=await submitJson<unknown>('/api/team-today',{cache:'no-store'},{language:document.documentElement.lang==='en'?'en':'ar',timeout:20000});
   if(!validTeamToday(body))throw new Error('');
   setData(body);setError('');
  }catch(e){setError(e instanceof Error&&e.message?e.message:FAILED);}
  finally{pending.current=false;setLoading(false);}
 },[]);
 useEffect(()=>{
  const first=setTimeout(()=>{void load(true);},0),timer=setInterval(()=>{void load(true);},TEAM_TODAY_INTERVAL_MS),again=()=>{void load();};
  document.addEventListener('visibilitychange',again);window.addEventListener('focus',again);window.addEventListener('online',again);
  return()=>{clearTimeout(first);clearInterval(timer);document.removeEventListener('visibilitychange',again);window.removeEventListener('focus',again);window.removeEventListener('online',again);};
 },[load,me.id]);
 return <TeamTodayView data={data} error={error} loading={loading} offline={offline} onRefresh={()=>{void load(true);}} onDayReport={onDayReport}/>;
}

/** What the card shows, from what it holds (the fetching stays in TeamTodayCard). */
export function TeamTodayView({data,error,loading,offline,onRefresh,onDayReport}:{data:TeamToday|null;error:string;loading:boolean;offline:boolean;onRefresh:()=>void;onDayReport:(memberId:string)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const title=say('فريقي النهارده','My team today'),rtl=language==='ar';
 const started=(row:TeamTodayRow)=>row.startedAt?<span className="team-today-started" data-start={row.startedBy}><b dir="ltr">{clockOf(row.startedAt,language)}</b> · {row.startedBy==='movement'?say('أول حركة','first movement'):say('أول تسجيل','first record')}</span>:<span className="team-today-not-started">{say('لسه ما بدأش','Not started yet')}</span>;
 const totals=data?.totals,before=data&&data.workingDay&&Date.parse(data.serverTime)<Date.parse(data.windowStartsAt);
 return <section className="team-today no-print" aria-label={title} data-team-today>
  <header className="team-today-head">
   <h2><Users size={19} aria-hidden/>{title}{data&&<small dir="ltr">{data.date}</small>}</h2>
   <button type="button" className="btn subtle small" disabled={loading||offline} onClick={onRefresh} data-team-today-refresh>{loading?<Loader2 size={16} className="spin" aria-hidden/>:<RefreshCw size={16} aria-hidden/>}{say('تحديث','Refresh')}</button>
  </header>
  {totals&&<p className="team-today-totals" data-team-today-totals>{say(`بدأوا ${totals.started} من ${totals.members}`,`Started ${totals.started} of ${totals.members}`)} · {say(`زيارات ${totals.visits}`,`Visits ${totals.visits}`)} · {say(`ملاحظات مش مقروءة ${totals.unreadNotes}`,`Unread notes ${totals.unreadNotes}`)}</p>}
  {data&&!data.workingDay&&<p className="team-today-note" role="status">{say('النهارده إجازة (الجمعة)؛ مفيش تتبع متوقع.','Today is the weekly day off (Friday); no tracking is expected.')}</p>}
  {before&&<p className="team-today-note" role="status">{say('ساعات التتبع بتبدأ 6 الصبح بتوقيت السعودية.','Tracking hours start at 6 AM Saudi time.')}</p>}
  {error&&<p className="team-today-error" role="alert"><AlertCircle size={16} aria-hidden/>{error===FAILED?say('تعذر تحميل ملخص الفريق. حاول مرة أخرى.','Could not load the team summary. Try again.'):t(error)}</p>}
  {offline&&!data&&<p className="team-today-note">{say('ملخص الفريق محتاج اتصال بالإنترنت.','The team summary needs an internet connection.')}</p>}
  {!data&&!error&&!offline&&<p className="team-today-note" role="status"><Loader2 size={16} className="spin" aria-hidden/>{say('جارٍ تحميل ملخص الفريق…','Loading the team summary…')}</p>}
  {data&&!data.rows.length&&<p className="team-today-note">{say('مفيش مناديب في فريقك.','No representatives in your team.')}</p>}
  {!!data?.rows.length&&<table className="team-today-table">
   <thead><tr><th scope="col">{say('المندوب','Representative')}</th><th scope="col">{say('زيارات النهارده','Visits today')}</th><th scope="col">{say('تواصل آخر','Other contacts')}</th><th scope="col">{say('بدأ يومه؟','Started the day?')}</th><th scope="col">{say('ملاحظات مش مقروءة','Unread notes')}</th><th scope="col"><span className="sr-only">{say('تقرير اليوم','Day report')}</span></th></tr></thead>
   <tbody>{data.rows.map(row=><tr key={row.memberId} data-member={row.memberId} data-started={row.startedAt?'yes':'no'}>
    <th scope="row" className="team-today-name">{row.name}{row.role!=='rep'&&<small>{t(roles[row.role]||row.role)}</small>}</th>
    <td data-label={say('زيارات النهارده','Visits today')} data-cell="visits"><b>{row.visits}</b></td>
    <td data-label={say('تواصل آخر','Other contacts')} data-cell="contacts">{row.contacts}</td>
    <td data-label={say('بدأ يومه؟','Started the day?')} data-cell="started">{started(row)}</td>
    <td data-label={say('ملاحظات مش مقروءة','Unread notes')} data-cell="notes">{row.unreadNotes>0?<span className="team-today-unread">{row.unreadNotes}</span>:0}</td>
    <td className="team-today-action"><button type="button" className="btn subtle small" onClick={()=>onDayReport(row.memberId)} data-team-today-report={row.memberId} aria-label={say(`تقرير اليوم: ${row.name}`,`Day report: ${row.name}`)}><FileText size={15} aria-hidden/>{say('تقرير اليوم','Day report')}{rtl?<ChevronLeft size={15} aria-hidden/>:<ChevronRight size={15} aria-hidden/>}</button></td>
   </tr>)}</tbody>
  </table>}
  {data&&<small className="team-today-foot">{say(`آخر تحديث ${clockOf(data.serverTime,language)} · كل الأوقات بتوقيت الرياض`,`Updated ${clockOf(data.serverTime,language)} · All times are in Riyadh time`)}</small>}
 </section>;
}

/** On «تقرير يوم المندوب»: back to the summary of the whole team. */
export function TeamTodayLink({onOpen}:{onOpen:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 return <p className="team-today-link no-print"><button type="button" className="text-button" onClick={onOpen} data-team-today-link><Users size={16} aria-hidden/>{say('ملخص فريقي النهارده','My team today')}</button></p>;
}

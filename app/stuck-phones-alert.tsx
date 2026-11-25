'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Smartphone} from 'lucide-react';
import {toast} from 'sonner';
import type {Member} from '@/lib/crm';
import {useLanguage} from '@/lib/i18n';
import {canUseSalesWorkspace} from '@/lib/access';
import {phoneProblemText,type PhoneProblem,type StuckPhone} from '@/lib/stuck-phones';
import {deviceNotice} from './supervisor-reviews';
import './stuck-phones-alert.css';

/** Asked on load, every five minutes and on coming back to the page (at most once a minute). */
export const STUCK_PHONES_POLL_MS=5*60_000,STUCK_PHONES_FOCUS_MS=60_000;
const PROBLEMS:readonly PhoneProblem[]=['setup','permission','location_services','bridge','upgrade','paused'];
function validStuck(value:unknown):value is {stuck:StuckPhone[]}{
 if(!value||typeof value!=='object'||!Array.isArray((value as {stuck?:unknown}).stuck))return false;
 return (value as {stuck:unknown[]}).stuck.every(item=>!!item&&typeof item==='object'&&typeof (item as StuckPhone).memberId==='string'&&typeof (item as StuckPhone).memberName==='string'&&PROBLEMS.includes((item as StuckPhone).problem)&&typeof (item as StuckPhone).since==='string'&&Number.isFinite((item as StuckPhone).minutes));
}
const key=(phone:StuckPhone)=>phone.memberId+'@'+phone.since;
function remembered(storageKey:string):string[]{try{const raw=localStorage.getItem(storageKey);const list:unknown=raw?JSON.parse(raw):[];return Array.isArray(list)?list.filter((item):item is string=>typeof item==='string').slice(-200):[];}catch{return [];}}
function remember(storageKey:string,keys:string[]){try{localStorage.setItem(storageKey,JSON.stringify(keys.slice(-200)));}catch{/* a private window: nothing is remembered between pages */}}

/** «هواتف مناديب متوقفة الآن» (the owner, 2026-11-25, item 3; lib/stuck-phones.ts): for whoever reads the daily report (administrators, sales
 * managers, supervisors), the representatives whose phone has been stopped or blocked for half an hour or more inside the working window,
 * at the top of every page while it lasts. A phone this browser has not announced before is announced once on the page and, where allowed,
 * by the device. A refusal (the reader's role or hidden pages) stops the asking. Nothing shows when every phone works. */
export default function StuckPhonesAlert({me,offline=false}:{me:Member;offline?:boolean}){
 const {language}=useLanguage(),en=language==='en',say=(ar:string,english:string)=>en?english:ar;
 const [stuck,setStuck]=useState<StuckPhone[]>([]),closed=useRef(false),pending=useRef(false),last=useRef(0),offlineNow=useRef(offline),languageNow=useRef(language);
 const eligible=canUseSalesWorkspace(me.role)&&me.active===1;
 useEffect(()=>{offlineNow.current=offline;},[offline]);
 useEffect(()=>{languageNow.current=language;},[language]);
 const announce=useCallback((phones:StuckPhone[])=>{
  const storageKey='yourrest-stuck-phones:'+me.id,seen=new Set(remembered(storageKey)),fresh=phones.filter(phone=>!seen.has(key(phone)));
  remember(storageKey,[...seen,...fresh.map(key)]);
  if(!fresh.length)return;
  const english=languageNow.current==='en',title=english?'A representative\'s phone has stopped':'هاتف مندوب متوقف',body=fresh.map(phone=>phone.memberName+': '+phoneProblemText(phone.problem,english)).join(' • ');
  toast(title,{id:'stuck-phones',description:body,duration:15000});
  void deviceNotice(title,body,'yourrest-stuck:'+fresh.map(key).join('|').slice(0,200),languageNow.current);
 },[me.id]);
 const load=useCallback(async(force=false)=>{
  if(closed.current||pending.current||offlineNow.current||!force&&Date.now()-last.current<STUCK_PHONES_FOCUS_MS)return;
  pending.current=true;last.current=Date.now();
  try{
   const response=await fetch('/api/device-status?alerts=1',{cache:'no-store',credentials:'same-origin'});
   if(response.status===401||response.status===403||response.status===404){closed.current=true;setStuck([]);return;}
   if(response.ok){const body:unknown=await response.json();if(validStuck(body)){setStuck(body.stuck);announce(body.stuck);}}
  }catch{/* offline or unreachable: the next check retries and what was shown stays */}
  finally{pending.current=false;}
 },[announce]);
 useEffect(()=>{
  if(!eligible)return;
  void load(true);
  const timer=setInterval(()=>void load(true),STUCK_PHONES_POLL_MS),visible=()=>{if(document.visibilityState==='visible')void load();};
  document.addEventListener('visibilitychange',visible);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[eligible,load]);
 if(!eligible||!stuck.length)return null;
 return <section className="stuck-phones no-print" dir={en?'ltr':'rtl'} role="alert" aria-label={say('هواتف مناديب متوقفة','Stopped representative phones')} data-stuck-phones={stuck.length}>
  <Smartphone className="stuck-phones-icon" size={22} aria-hidden="true"/>
  <div className="stuck-phones-copy">
   <strong>{say('هواتف مناديب متوقفة الآن ('+stuck.length+')','Representative phones stopped now ('+stuck.length+')')}</strong>
   <ul>{stuck.map(phone=><li key={key(phone)} data-stuck-member={phone.memberId}><b>{phone.memberName}</b>{' — '}{phoneProblemText(phone.problem,en)}{' — '}{say('منذ '+phone.minutes+' دقيقة','for '+phone.minutes+' minutes')}{phone.error?<small>{phone.error}</small>:null}</li>)}</ul>
   <p>{say('اتصل بالمندوب، وراجع «تقرير يوم المندوب» لتفاصيل الهاتف.','Call the representative, and see the representative\'s day report for the phone\'s details.')}</p>
  </div>
 </section>;
}

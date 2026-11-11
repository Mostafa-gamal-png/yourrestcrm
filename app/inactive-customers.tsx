'use client';
import {useState} from 'react';
import {ChevronLeft,ChevronRight,Store} from 'lucide-react';
import {useLanguage} from '@/lib/i18n';
import {INACTIVE_CUSTOMER_DAYS} from '@/lib/customer-last-purchase';
import type {TeamInactive} from '@/lib/inactive-customers';

/** «عملاء واقفين» (lib/inactive-customers.ts): the representative's card and the badge on «العملاء», and the team's card with one row per
 * member. Each opens the customers page with «لم يشترِ منذ 60 يومًا» on and the list filtered to that member. */
const DAYS=INACTIVE_CUSTOMER_DAYS;
const Chevron=({rtl}:{rtl:boolean})=>rtl?<ChevronLeft size={16} aria-hidden/>:<ChevronRight size={16} aria-hidden/>;

export function InactiveCustomersBadge({count}:{count:number}){
 const {language}=useLanguage();
 if(!count)return null;
 return <span className="nav-badge inactive-customers-badge" role="img" data-inactive-badge aria-label={language==='en'?`${count} of your customers have not bought in ${DAYS} days`:`${count} من عملائك لم يشتروا منذ ${DAYS} يومًا`}>{count}</span>;
}

export function OwnInactiveCard({count,onOpen}:{count:number;onOpen:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 if(!count)return null;
 const title=say(`عملاؤك الذين لم يشتروا منذ ${DAYS} يومًا`,`Your customers with no purchase in ${DAYS} days`);
 return <section className="team-alert inactive-alert" data-inactive-card="own" aria-label={title}>
  <span className="team-alert-icon" aria-hidden><Store size={20}/></span>
  <div className="team-alert-text"><h2>{title}: <b data-inactive-count>{count}</b></h2><p>{say(`نشطون، ولا شراء خلال آخر ${DAYS} يومًا.`,`Active, with no purchase in the last ${DAYS} days.`)}</p></div>
  <button type="button" className="btn primary small" onClick={onOpen} data-inactive-open>{say('اعرضهم','Show them')}<Chevron rtl={language==='ar'}/></button>
 </section>;
}

const SHOWN=8;
export function TeamInactiveCard({data,onOpen}:{data:TeamInactive;onOpen:(memberId:string)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en,[all,setAll]=useState(false);
 if(!data.total)return null;
 const title=say('عملاء واقفين في فريقك','Stalled customers in your team'),rows=all?data.rows:data.rows.slice(0,SHOWN);
 return <section className="team-alert inactive-alert inactive-team" data-inactive-card="team" aria-label={title}>
  <div className="team-alert-head"><span className="team-alert-icon" aria-hidden><Store size={20}/></span><div className="team-alert-text"><h2>{title}: <b data-inactive-count>{data.total}</b></h2><p>{say(`نشطون، ولا شراء خلال آخر ${DAYS} يومًا. اضغط على الاسم لعرض عملائه.`,`Active, with no purchase in the last ${DAYS} days. Tap a name to see their customers.`)}</p></div></div>
  <ul className="inactive-team-list">{rows.map(row=><li key={row.memberId}><button type="button" data-inactive-member={row.memberId} onClick={()=>onOpen(row.memberId)} aria-label={say(`${row.name}: ${row.count} عميل واقف`,`${row.name}: ${row.count} stalled customers`)}><span className="inactive-team-name">{row.name}{!row.active&&<small>{say('معطّل','inactive')}</small>}</span><b>{row.count}</b><Chevron rtl={language==='ar'}/></button></li>)}</ul>
  {data.rows.length>SHOWN&&<button type="button" className="text-button inactive-team-more" aria-expanded={all} onClick={()=>setAll(value=>!value)}>{all?say('عرض أقل','Show fewer'):say(`عرض الكل (${data.rows.length})`,`Show all (${data.rows.length})`)}</button>}
 </section>;
}

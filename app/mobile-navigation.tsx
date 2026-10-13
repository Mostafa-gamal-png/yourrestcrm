'use client';
import {useEffect,useRef,useState} from 'react';
import {Building2,MapPinned,ClipboardList,CalendarDays,Target,LayoutDashboard,FileText,BriefcaseBusiness,ShieldCheck,Users,Ellipsis,ChevronLeft,X} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {canViewPage} from '@/lib/access';
import {roles,type Member} from '@/lib/crm';
import {t,useLanguage} from '@/lib/i18n';
import {EmailLogout} from './email-login';
import {QueueBadge} from './service-queue';
import type {ServiceQueueEntry} from '@/lib/service-queue';
import './mobile-navigation.css';

const pages=[
 {id:'customer',ar:'العملاء',en:'Customers',Icon:Building2},
 {id:'map',ar:'الخريطة',en:'Map',Icon:MapPinned},
 {id:'activity',ar:'الزيارات',en:'Visits',Icon:ClipboardList},
 {id:'followup',ar:'المتابعات',en:'Follow-ups',Icon:CalendarDays},
 {id:'targets',ar:'المستهدفات وتقييم الأداء',en:'Targets & performance',Icon:Target},
 {id:'dashboard',ar:'لوحة المتابعة',en:'Dashboard',Icon:LayoutDashboard},
 {id:'journeys',ar:'تقرير يوم المندوب',en:'Daily route',Icon:MapPinned},
 {id:'quote',ar:'عروض الأسعار',en:'Quotations',Icon:FileText},
 {id:'sales',ar:'المبيعات',en:'Sales',Icon:BriefcaseBusiness},
 {id:'competitors',ar:'المنافسين',en:'Competitors',Icon:Users},
 {id:'team',ar:'الفريق والصلاحيات',en:'Team & permissions',Icon:ShieldCheck},
] as const;

type Props={me:Member;view:string;onNavigate:(view:string)=>void;accountOpen:boolean;onAccountOpenChange:(open:boolean)=>void;blocked?:boolean;queue?:ServiceQueueEntry[];extra?:number};

export default function MobileNavigation({me,view,onNavigate,accountOpen,onAccountOpenChange,blocked=false,queue,extra=0}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const [moreOpen,setMoreOpen]=useState(false),[editing,setEditing]=useState(false);
 const opener=useRef<HTMLElement|null>(null);
 // A focused field can open a keyboard even when a browser does not expose visualViewport.
 // Keep navigation out of its way; the normal content reserve stays in place while typing.
 useEffect(()=>{
  const pointers=new Set<number>();let interactionHeld=false,pending:number|undefined;
  const sync=()=>{
   const active=document.activeElement,editable=active instanceof HTMLElement&&(active.matches('input,textarea,select')||active.isContentEditable);
   // Hide immediately for fields, but never put the fixed bar under an in-flight tap.
   if(editable)setEditing(true);else if(!interactionHeld)setEditing(false);
  };
  const afterFocus=()=>{
   if(pending!==undefined)cancelAnimationFrame(pending);
   pending=requestAnimationFrame(()=>{pending=undefined;if(!pointers.size)interactionHeld=false;sync();});
  };
  const pointerDown=(event:PointerEvent)=>{pointers.add(event.pointerId);interactionHeld=true;};
  const pointerEnd=(event:PointerEvent)=>{if(pointers.delete(event.pointerId)&&!pointers.size)afterFocus();};
  const windowBlur=()=>{pointers.clear();interactionHeld=true;afterFocus();};
  document.addEventListener('pointerdown',pointerDown,true);document.addEventListener('pointerup',pointerEnd,true);document.addEventListener('pointercancel',pointerEnd,true);
  document.addEventListener('focusin',sync);document.addEventListener('focusout',afterFocus);window.visualViewport?.addEventListener('resize',sync);window.addEventListener?.('blur',windowBlur);sync();
  return()=>{
   document.removeEventListener('pointerdown',pointerDown,true);document.removeEventListener('pointerup',pointerEnd,true);document.removeEventListener('pointercancel',pointerEnd,true);
   document.removeEventListener('focusin',sync);document.removeEventListener('focusout',afterFocus);window.visualViewport?.removeEventListener('resize',sync);window.removeEventListener?.('blur',windowBlur);
   if(pending!==undefined)cancelAnimationFrame(pending);pointers.clear();
  };
 },[]);
 useEffect(()=>{setMoreOpen(false);onAccountOpenChange(false);},[me.id,me.role]);
 const allowed=pages.filter(page=>canViewPage(me.role,page.id));
 const primary=allowed.length>5?allowed.slice(0,4):allowed;
 const overflow=allowed.filter(page=>!primary.some(item=>item.id===page.id));
 const overflowActive=overflow.some(page=>page.id===view);
 const label=(page:typeof pages[number])=>page.id==='targets'&&me.role==='rep'?say('مستهدفي','My targets'):say(page.ar,page.en);
 const navigate=(id:string)=>{if(!canViewPage(me.role,id))return;setMoreOpen(false);onAccountOpenChange(false);onNavigate(id);if(typeof window!=='undefined')window.scrollTo?.({top:0,behavior:'auto'});};
 if(!allowed.length)return null;
 return <>
  <nav className="mobile-bottom-navigation no-print" aria-label={say('صفحات التطبيق','App pages')} dir={language==='ar'?'rtl':'ltr'} hidden={blocked||editing} style={{gridTemplateColumns:`repeat(${primary.length+(overflow.length?1:0)},minmax(0,1fr))`}}>
   {primary.map(page=><button type="button" key={page.id} className={'mobile-tab'+(view===page.id?' is-active':'')} aria-current={view===page.id?'page':undefined} data-page={page.id} onClick={()=>navigate(page.id)}><span className="mobile-tab-icon"><page.Icon size={21} strokeWidth={view===page.id?2.2:1.8} aria-hidden="true"/>{page.id==='activity'&&(queue||extra>0)&&<QueueBadge entries={queue||[]} extra={extra}/>}</span><span className="mobile-tab-label">{label(page)}</span></button>)}
   {!!overflow.length&&<button type="button" className={'mobile-tab'+(overflowActive?' is-active':'')} aria-label={say('المزيد من الصفحات','More pages')} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={()=>{onAccountOpenChange(false);setMoreOpen(true);}}><span className="mobile-tab-icon"><Ellipsis size={23} aria-hidden="true"/></span><span className="mobile-tab-label">{say('المزيد','More')}</span></button>}
  </nav>
  <Sheet open={!blocked&&(moreOpen||accountOpen)} onOpenChange={open=>{if(!open){setMoreOpen(false);onAccountOpenChange(false);}}}>
   <SheetContent side="bottom" className="mobile-navigation-sheet" showCloseButton={false} dir={language==='ar'?'rtl':'ltr'} onOpenAutoFocus={()=>{opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;}} onCloseAutoFocus={event=>{event.preventDefault();if(opener.current?.isConnected)opener.current.focus();}}>
    <span className="mobile-sheet-handle" aria-hidden="true"/>
    <header className="mobile-sheet-heading"><div><SheetTitle>{accountOpen?say('حسابي','My account'):say('المزيد','More')}</SheetTitle><SheetDescription className="sr-only">{accountOpen?say('بيانات حسابك في يورست للصناعات.','Your Yourrest Industries account.'):say('باقي صفحات التطبيق المتاحة لك.','More pages available to your account.')}</SheetDescription></div><button type="button" className="icon-button" aria-label={say('إغلاق','Close')} onClick={()=>{setMoreOpen(false);onAccountOpenChange(false);}}><X size={19} aria-hidden="true"/></button></header>
    {!accountOpen&&<nav className="mobile-overflow-pages" aria-label={say('المزيد من الصفحات','More pages')}>{overflow.map(page=><button type="button" key={page.id} data-page={page.id} aria-current={view===page.id?'page':undefined} className={view===page.id?'is-active':''} onClick={()=>navigate(page.id)}><page.Icon size={20} aria-hidden="true"/><span>{label(page)}</span><ChevronLeft className="mobile-menu-chevron" size={17} aria-hidden="true"/></button>)}</nav>}
    <div className="mobile-account-card"><span className="avatar" aria-hidden="true">{me.name?.slice(0,1)||'Y'}</span><div><strong>{me.name}</strong><small>{t(roles[me.role])}</small><span dir="ltr">{me.email}</span></div></div>
    <div className="mobile-account-signout"><span>{say('تسجيل الخروج','Sign out')}</span><EmailLogout/></div>
   </SheetContent>
  </Sheet>
 </>;
}

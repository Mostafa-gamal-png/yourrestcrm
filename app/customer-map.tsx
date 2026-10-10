'use client';
import {useLanguage} from '@/lib/i18n';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type * as Leaflet from 'leaflet';
import {MapPin,Maximize,Loader2,SlidersHorizontal,List,X,Search,Navigation,Building2} from 'lucide-react';
import {type Row} from '@/lib/crm';
import {customerCoordinates} from '@/lib/customer-location';
import {customerDirectionsLink} from '@/lib/customer-directions';
import {searchMapCustomers} from '@/lib/customer-map-search';
import {mapActivity,activityOptions,groupMapActivities} from '@/lib/customer-map-activity';
import {DIRECTIONS_START_TIMEOUT_MS,waitForDirectionsStep} from '@/lib/directions-attempt';
import './customer-map.css';

type ActivityKey=(typeof activityOptions)[number]['key'];
type PanelTab='filters'|'customers';
type Props={customers:Row[];onOpen?:(id:string)=>void;onVisit?:(id:string)=>void;onDirections?:(id:string,signal:AbortSignal)=>Promise<boolean>;directionsReady?:{customerId:string;href:string;target:'_self'|'_blank'}|null;recordingNotice?:{customerId:string;text:string;error?:boolean}|null;navigationError?:{customerId:string;text:string}|null;focusId?:string|null;filters?:ReactNode;actions?:ReactNode;scopeKey?:string};

export default function CustomerMap({customers,onDirections,directionsReady,recordingNotice,navigationError,focusId,filters,scopeKey=''}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en,dir=language==='ar'?'rtl':'ltr';
 const shell=useRef<HTMLElement>(null),container=useRef<HTMLDivElement>(null),panel=useRef<HTMLElement>(null),panelScroll=useRef<HTMLDivElement>(null),map=useRef<Leaflet.Map|null>(null),leaflet=useRef<typeof Leaflet|null>(null),layer=useRef<Leaflet.LayerGroup|null>(null),firstFit=useRef(false),focused=useRef(''),returnFocus=useRef<HTMLElement|null>(null),searchInput=useRef<HTMLInputElement>(null),searchResults=useRef<HTMLDivElement>(null),selectedCard=useRef<HTMLElement>(null),focusSelected=useRef(false),directionAttempt=useRef(0),directionAbort=useRef<AbortController|null>(null),latestCustomers=useRef(customers);latestCustomers.current=customers;
 const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[tileFailed,setTileFailed]=useState(false),[tilesLoaded,setTilesLoaded]=useState(false),[panelOpen,setPanelOpen]=useState(false),[tab,setTab]=useState<PanelTab>('customers'),[active,setActive]=useState<string|null>(null),[groupIds,setGroupIds]=useState<string[]>([]),[shown,setShown]=useState(40),[activity,setActivity]=useState<ActivityKey|'all'>('all'),[query,setQuery]=useState(''),[searchOpen,setSearchOpen]=useState(false),[highlighted,setHighlighted]=useState(-1),[directionsBusy,setDirectionsBusy]=useState(false),[directionsError,setDirectionsError]=useState('');
 const visible=useMemo(()=>customers.filter(row=>activity==='all'||mapActivity(row).key===activity),[customers,activity]);
 const points=useMemo(()=>visible.map(row=>({row,point:customerCoordinates(row.data)})).filter(item=>item.point!==null),[visible]);
 const selected=visible.find(row=>row.id===active);
 const results=useMemo(()=>searchMapCustomers(visible,query,8),[visible,query]);
 const suggestionsOpen=searchOpen&&!!query.trim();
 const selectedPoint=selected?customerCoordinates(selected.data):null;
 const readyLink=selected&&selectedPoint&&directionsReady&&directionsReady.customerId===selected.id&&directionsReady.href===customerDirectionsLink(selected.data)?directionsReady:null;
 const group=groupIds.length?visible.filter(row=>groupIds.includes(row.id)):[];
 const list=group.length?group:visible;
 const counts=useMemo(()=>Object.fromEntries(activityOptions.map(option=>[option.key,customers.filter(row=>mapActivity(row).key===option.key).length])),[customers]);
 const pointKey=points.map(({row,point})=>JSON.stringify([row.id,point!.latitude,point!.longitude,row.data.name,row.data.customerStatus])).join('|');
 const customerKey=visible.map(row=>row.id).join('|');
 const latestPoints=useRef(points);latestPoints.current=points;
 const activityLabel=(row:Row)=>{const value=mapActivity(row);return value.key==='unknown'&&value.rawLabel?value.rawLabel:language==='ar'?value.labelAr:value.labelEn;};
 const categoryLabel=(option:typeof activityOptions[number])=>language==='ar'?option.labelAr:option.labelEn;
 function fit(){if(!map.current||!leaflet.current||!latestPoints.current.length)return;map.current.fitBounds(leaflet.current.latLngBounds(latestPoints.current.map(item=>[item.point!.latitude,item.point!.longitude])),{padding:[35,35],maxZoom:13});}
 function showPanel(next:PanelTab){setSearchOpen(false);setTab(next);setPanelOpen(true);}
 function select(row:Row,pan=false){focusSelected.current=true;directionAbort.current?.abort();directionAbort.current=null;directionAttempt.current++;setDirectionsError('');setDirectionsBusy(false);setActive(row.id);setQuery(row.data.name||'');setSearchOpen(false);setHighlighted(-1);setPanelOpen(false);const point=customerCoordinates(row.data);if(pan&&point&&map.current)map.current.setView([point.latitude,point.longitude],Math.max(map.current.getZoom(),13));}
 function chooseResult(row:Row){setGroupIds([]);searchInput.current?.blur?.();select(row,true);}
 function clearSelection(focusSearch=false){focusSelected.current=false;directionAbort.current?.abort();directionAbort.current=null;directionAttempt.current++;setDirectionsError('');setDirectionsBusy(false);setActive(null);setQuery('');setSearchOpen(false);setHighlighted(-1);if(focusSearch)searchInput.current?.focus();else searchInput.current?.blur?.();}
 async function directions(){
  if(!selected||!selectedPoint||!onDirections||directionsBusy||directionAbort.current)return;
  const controller=new AbortController();directionAbort.current=controller;const attempt=++directionAttempt.current;setDirectionsBusy(true);setDirectionsError('');
  let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},DIRECTIONS_START_TIMEOUT_MS);
  try{const started=await waitForDirectionsStep(onDirections(selected.id,controller.signal),controller.signal);if(directionAttempt.current!==attempt)return;if(!started)setDirectionsError(say('تعذّر بدء الاتجاهات. حاول مرة أخرى.','Could not start directions. Please try again.'));}
  catch(error){if(directionAttempt.current===attempt){if(timedOut)setDirectionsError(say('بدء الرحلة استغرق وقتًا طويلًا. راجع الاتصال وإذن الموقع، ثم حاول مرة أخرى.','Starting the trip took too long. Check your connection and location permission, then retry.'));else if(!controller.signal.aborted)setDirectionsError(error instanceof Error?error.message:say('تعذّر بدء الاتجاهات. حاول مرة أخرى.','Could not start directions. Please try again.'));}}
  finally{clearTimeout(timeout);if(directionAttempt.current===attempt){directionAbort.current=null;setDirectionsBusy(false);}}
 }
 function searchKey(event:React.KeyboardEvent<HTMLInputElement>){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setSearchOpen(false);setHighlighted(-1);return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setSearchOpen(true);if(results.length)setHighlighted(index=>event.key==='ArrowDown'?(index+1)%results.length:(index<=0?results.length:index)-1);return;}
  if(event.key==='Enter'&&suggestionsOpen&&results.length){event.preventDefault();chooseResult(results[highlighted>=0&&highlighted<results.length?highlighted:0]);}
 }
 function setActivityFilter(value:ActivityKey|'all'){setActivity(value);setGroupIds([]);setShown(40);}
 useEffect(()=>{focusSelected.current=false;directionAbort.current?.abort();directionAbort.current=null;directionAttempt.current++;setDirectionsBusy(false);setDirectionsError('');setActive(null);setQuery('');setSearchOpen(false);setHighlighted(-1);setGroupIds([]);setActivity('all');setTab('customers');setPanelOpen(false);focused.current='';},[scopeKey]);
 useEffect(()=>{setShown(40);if(active&&!visible.some(row=>row.id===active)){directionAbort.current?.abort();directionAbort.current=null;directionAttempt.current++;setDirectionsBusy(false);setDirectionsError('');setActive(null);setQuery('');setSearchOpen(false);setHighlighted(-1);}if(groupIds.length&&!visible.some(row=>groupIds.includes(row.id)))setGroupIds([]);},[customerKey]);
 useEffect(()=>{panel.current?.scrollTo?.({top:0});panelScroll.current?.scrollTo?.({top:0});},[tab,active]);
 useEffect(()=>{
  if(!panelOpen||!panel.current)return;
  returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  panel.current.focus();
  // This is a complementary drawer: app navigation remains available outside it.
  // Handle only keys originating here; portaled region/team pickers own their keys.
  const surface=panel.current;
  const onKey=(event:KeyboardEvent)=>{if(event.defaultPrevented||event.key!=='Escape')return;event.preventDefault();setPanelOpen(false);};
  surface.addEventListener('keydown',onKey);
  return()=>{surface.removeEventListener('keydown',onKey);const previous=returnFocus.current;returnFocus.current=null;if(previous?.isConnected&&surface.contains(document.activeElement))previous.focus();};
 },[panelOpen]);
 useEffect(()=>{setHighlighted(-1);},[query,customerKey]);
 useEffect(()=>{if(focusSelected.current&&selected&&!panelOpen&&!suggestionsOpen){focusSelected.current=false;selectedCard.current?.focus({preventScroll:true});}},[active,panelOpen,suggestionsOpen]);
 useEffect(()=>{if(highlighted>=0)searchResults.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest'});},[highlighted]);
 useEffect(()=>()=>{directionAbort.current?.abort();directionAttempt.current++;},[]);
 useEffect(()=>{const element=shell.current;if(!element)return;const syncHeight=()=>{if(element.clientHeight>0)element.style.setProperty('--cm-map-height',element.clientHeight+'px');};syncHeight();const observer=new ResizeObserver(syncHeight);observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  let alive=true;let resize:ResizeObserver|undefined;
  void import('leaflet').then(mod=>{
   if(!alive||!container.current)return;
   const L=mod.default||mod;leaflet.current=L;
   const m=L.map(container.current,{preferCanvas:true,center:[24,45],zoom:5,minZoom:2,maxZoom:19,zoomControl:false});map.current=m;
   L.control.zoom({position:'bottomleft',zoomInTitle:say('تكبير','Zoom in'),zoomOutTitle:say('تصغير','Zoom out')}).addTo(m);
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).on('tileerror',()=>{if(alive)setTileFailed(true);}).on('tileload',()=>{if(alive)setTilesLoaded(true);}).addTo(m);
   layer.current=L.layerGroup().addTo(m);
   resize=new ResizeObserver(()=>m.invalidateSize({pan:false}));resize.observe(container.current);setReady(true);
  }).catch(()=>{if(alive)setFailed(true);});
  return()=>{alive=false;resize?.disconnect();map.current?.remove();map.current=null;layer.current=null;};
 },[]);
 useEffect(()=>{
  if(!ready||!leaflet.current||!layer.current)return;
  const L=leaflet.current;layer.current.clearLayers();
  const groups=new Map<string,typeof points>();
  for(const item of points){const point=item.point!;const key=point.latitude.toFixed(7)+','+point.longitude.toFixed(7);groups.set(key,[...(groups.get(key)||[]),item]);}
  for(const items of groups.values()){
   const point=items[0].point!,rows=items.map(item=>item.row),summary=groupMapActivities(rows);
   const title=items.length>1?say(`${items.length} عملاء في نفس الموقع`,`${items.length} customers at this location`):`${rows[0].data.name} · ${activityLabel(rows[0])}`;
   let marker:Leaflet.Marker|Leaflet.CircleMarker;
   if(items.length===1){
    // A canvas renderer keeps the imported directory light on phones.
    marker=L.circleMarker([point.latitude,point.longitude],{radius:7,color:'#fff',weight:2,fillColor:summary.color,fillOpacity:.95}).addTo(layer.current);
   }else{
    const pin=document.createElement('span');pin.className='cm-pin cm-pin-group';
    if(summary.counts.length>1){let offset=0;pin.style.background='conic-gradient('+summary.counts.map(item=>{const start=offset;offset+=item.count/summary.total*100;return `${item.color} ${start}% ${offset}%`;}).join(',')+')';}else pin.style.background=summary.color;
    const center=document.createElement('span');center.textContent=String(items.length);pin.appendChild(center);
    marker=L.marker([point.latitude,point.longitude],{icon:L.divIcon({className:'cm-map-marker',html:pin,iconSize:[30,30],iconAnchor:[15,15]}),keyboard:true,title,alt:title}).addTo(layer.current);
   }
   const tip=document.createElement('span');tip.dir=dir;tip.textContent=rows.map(row=>`${row.data.name} · ${activityLabel(row)}`).join('\n');tip.className='cm-tooltip';marker.bindTooltip(tip,{direction:'top'});
   marker.on('click',()=>{const currentRows=rows.flatMap(row=>{const current=latestCustomers.current.find(item=>item.id===row.id);return current?[current]:[];});if(currentRows.length===1){setGroupIds([]);select(currentRows[0]);}else if(currentRows.length){directionAbort.current?.abort();directionAbort.current=null;directionAttempt.current++;setDirectionsBusy(false);setDirectionsError('');setGroupIds(currentRows.map(row=>row.id));setActive(null);setShown(40);showPanel('customers');}});
  }
  if(!firstFit.current&&points.length){firstFit.current=true;fit();}
  // Markers can change without re-creating the map or resetting the user's viewport.
 },[ready,pointKey,language]);
 useEffect(()=>{if(!ready||!focusId||focused.current===scopeKey+':'+focusId)return;const row=customers.find(item=>item.id===focusId);if(!row)return;focused.current=scopeKey+':'+focusId;if(activity!=='all'&&mapActivity(row).key!==activity)setActivity('all');setGroupIds([]);select(row,true);},[ready,focusId,scopeKey,customers]);
 useEffect(()=>{for(const [selector,ar,en] of [['.leaflet-control-zoom-in','تكبير','Zoom in'],['.leaflet-control-zoom-out','تصغير','Zoom out']]){const button=container.current?.querySelector(selector);button?.setAttribute('title',say(ar,en));button?.setAttribute('aria-label',say(ar,en));}},[ready,language]);
 function badge(row:Row){const value=mapActivity(row);return <span className="cm-activity-badge" data-activity={value.key}><i style={{background:value.color}}/>{activityLabel(row)}</span>;}
 const panelTitle=tab==='filters'?say('فلترة الخريطة','Map filters'):say('العملاء','Customers');
 return <section ref={shell} className={'cm-shell'+(selected&&!panelOpen&&!suggestionsOpen?' has-selection':'')} dir={dir} aria-label={say('خريطة العملاء ونشاطهم','Customer activity map')}>
  <div className="cm-map-area">
   <div ref={container} className="cm-canvas" aria-label={say('خريطة مواقع المصانع','Factory locations map')}/>
   {!ready&&<div className="cm-message">{failed?say('تعذر تحميل الخريطة. البحث والعملاء ما زالوا متاحين.','Map unavailable. Search and the customer list are still available.'):<><Loader2 className="spin"/>{say('جارٍ تحميل الخريطة...','Loading map...')}</>}</div>}
   {tileFailed&&!tilesLoaded&&ready&&<div className="cm-warning" role="status">{say('خلفية الخريطة غير متاحة الآن. مواقع العملاء والاتجاهات ما زالت متاحة.','Map tiles are unavailable. Customer markers and directions remain available.')}</div>}
   {ready&&!points.length&&<div className="cm-empty-map" role="status">{say('لا توجد إحداثيات مطابقة للفلترة.','No mapped locations match these filters.')}<button type="button" onClick={()=>showPanel('customers')}>{say('عرض العملاء','View customers')}</button></div>}
   {!selected&&!panelOpen&&!suggestionsOpen&&<div className="cm-legend" aria-label={say('درجة نشاط العميل','Customer activity')}>{activityOptions.map(option=><button type="button" key={option.key} aria-pressed={activity===option.key} onClick={()=>setActivityFilter(activity===option.key?'all':option.key)}><i style={{background:option.color}}/>{categoryLabel(option)}</button>)}</div>}
  </div>
  <div className="cm-search-area">
   <div className="cm-search-box" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setSearchOpen(false);}}>
    <Search size={21} aria-hidden="true"/>
    <input ref={searchInput} type="search" role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen} aria-controls="customer-map-search-results" aria-activedescendant={suggestionsOpen&&highlighted>=0&&results[highlighted]?'customer-map-option-'+highlighted:undefined} aria-label={say('ابحث عن عميل','Search customers')} placeholder={say('اسم العميل، الرقم، الجوال أو المدينة','Customer name, code, phone or city')} value={query} onChange={event=>{directionAbort.current?.abort();directionAbort.current=null;directionAttempt.current++;setDirectionsBusy(false);setDirectionsError('');setActive(null);setQuery(event.target.value);setSearchOpen(true);setPanelOpen(false);setHighlighted(-1);}} onFocus={()=>{setSearchOpen(true);setPanelOpen(false);}} onKeyDown={searchKey} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"/>
    {query&&<button type="button" className="cm-search-clear" aria-label={say('مسح البحث','Clear search')} onClick={()=>clearSelection(true)}><X size={20}/></button>}
    {suggestionsOpen&&<div ref={searchResults} className="cm-search-results" id="customer-map-search-results" role="listbox" aria-label={say('نتائج البحث','Search results')}>
      {results.map((row,index)=><button type="button" id={'customer-map-option-'+index} role="option" tabIndex={-1} aria-selected={highlighted===index} key={row.id} className={'cm-search-result'+(highlighted===index?' is-highlighted':'')} onPointerDown={event=>event.preventDefault()} onClick={()=>chooseResult(row)}><MapPin size={18} aria-hidden="true"/><span><strong>{row.data.name}</strong><small>{[row.data.code,row.data.region,row.data.city].filter(Boolean).join(' · ')||say('عميل مسجل','Registered customer')}</small>{!customerCoordinates(row.data)&&<small className="cm-result-unmapped">{say('موقع العميل غير مسجل','Customer location not recorded')}</small>}</span><i style={{background:mapActivity(row).color}} aria-label={activityLabel(row)}/></button>)}
      {!results.length&&<p role="status" className="cm-search-empty">{say('لا توجد نتائج. جرّب جزءًا من الاسم أو رقم الجوال.','No results. Try part of the name or phone number.')}</p>}
    </div>}
   </div>
   <div className="cm-floating-toolbar"><div className="cm-map-controls"><button type="button" className="cm-control" onClick={()=>panelOpen&&tab==='filters'?setPanelOpen(false):showPanel('filters')} aria-controls="customer-map-panel" aria-expanded={panelOpen&&tab==='filters'}><SlidersHorizontal size={17}/><span>{say('فلترة','Filters')}</span>{activity!=='all'&&<i className="cm-filter-dot"/>}</button><button type="button" className="cm-control" onClick={()=>{setGroupIds([]);panelOpen&&tab==='customers'?setPanelOpen(false):showPanel('customers');}} aria-controls="customer-map-panel" aria-expanded={panelOpen&&tab==='customers'}><List size={17}/><span>{say('العملاء','Customers')}</span></button><button type="button" className="cm-control cm-fit" onClick={fit} disabled={!ready||!points.length} title={say('عرض جميع المواقع','Show all locations')} aria-label={say('عرض جميع المواقع','Show all locations')}><Maximize size={18}/></button></div><span className="cm-map-count">{points.length.toLocaleString('en-US')} {say('موقع','mapped')}</span></div>
  </div>
  <aside id="customer-map-panel" ref={panel} className={'cm-panel'+(panelOpen?' is-open':'')} tabIndex={-1} aria-label={panelTitle} aria-hidden={!panelOpen?true:undefined} inert={!panelOpen?true:undefined}>
   <header className="cm-panel-header"><div><strong>{panelTitle}</strong><small>{say(`${visible.length} عميل · ${points.length} على الخريطة`,`${visible.length} customers · ${points.length} mapped`)}</small></div><button type="button" className="cm-close" onClick={()=>setPanelOpen(false)} aria-label={say('العودة للخريطة','Back to map')}><X size={21}/></button></header>
   <div className="cm-panel-scroll" ref={panelScroll}>
    {tab==='filters'&&<div className="cm-filter-pane"><div className="cm-external-filters">{filters}</div><fieldset className="cm-activity-filter"><legend>{say('درجة نشاط العميل','Customer activity')}</legend><label><input type="radio" name="map-activity" value="all" checked={activity==='all'} onChange={()=>setActivityFilter('all')}/><span>{say('كل العملاء','All customers')}</span><b>{customers.length}</b></label>{activityOptions.map(option=><label key={option.key}><input type="radio" name="map-activity" value={option.key} checked={activity===option.key} onChange={()=>setActivityFilter(option.key)}/><i style={{background:option.color}}/><span>{categoryLabel(option)}</span><b>{counts[option.key]}</b></label>)}</fieldset><button type="button" className="btn primary cm-apply" onClick={()=>{fit();setPanelOpen(false);}}>{say('عرض النتائج على الخريطة','Show results on map')}</button></div>}
    {tab==='customers'&&<>{!!(group.length||visible.length>points.length)&&<div className="cm-list-summary">{group.length?<><strong>{say(`${group.length} عملاء في نفس الموقع`,`${group.length} customers at this location`)}</strong><button type="button" onClick={()=>setGroupIds([])}>{say('عرض الكل','Show all')}</button></>:<>{visible.length>points.length&&<small>{say(`${visible.length-points.length} بدون إحداثيات`,`${visible.length-points.length} without coordinates`)}</small>}</>}</div>}{list.slice(0,shown).map(row=><article key={row.id} className={'cm-customer'+(row.id===active?' is-selected':'')}><button type="button" className="cm-customer-select" onClick={()=>select(row,true)}><span className="cm-customer-top"><strong>{row.data.name}</strong>{badge(row)}</span><span className="cm-customer-meta">{[row.data.code,row.data.region,row.data.city].filter(Boolean).join(' · ')}</span>{!customerCoordinates(row.data)&&<span className="cm-customer-place"><MapPin size={13}/>{say('موقع العميل غير مسجل','Customer location not recorded')}</span>}</button></article>)}{!list.length&&<p className="cm-list-empty">{say('لا يوجد عملاء مطابقون. غيّر الفلترة.','No matching customers. Change the filters.')}</p>}{shown<list.length&&<button type="button" className="btn subtle cm-load-more" onClick={()=>setShown(value=>value+40)}>{say(`عرض المزيد (${list.length-shown})`,`Show more (${list.length-shown})`)}</button>}</>}
   </div>
  </aside>
  {selected&&!panelOpen&&!suggestionsOpen&&<section ref={selectedCard} tabIndex={-1} className="cm-selected-card" aria-label={say('العميل المحدد','Selected customer')}>
   <div className="cm-selected-heading"><Building2 size={22} aria-hidden="true"/><h2>{selected.data.name}</h2><button type="button" className="cm-close" aria-label={say('إغلاق بطاقة العميل','Close customer card')} onClick={()=>clearSelection(false)}><X size={20}/></button></div>
   <div className="cm-selected-meta">{badge(selected)}{selected.data.code&&<span className="cm-selected-code" title={String(selected.data.code)}>{say('رقم ','Code ')}<bdi>{selected.data.code}</bdi></span>}</div>
   <p className="cm-selected-location"><MapPin size={15} aria-hidden="true"/><span>{[selected.data.region,selected.data.city,selected.data.address].filter(Boolean).join(' · ')||say('العنوان غير مسجل','Address not recorded')}</span></p>
   {readyLink?<><a className="btn primary cm-directions" href={readyLink.href} target={readyLink.target} rel="noopener noreferrer"><Navigation size={18}/>{say('فتح Google Maps','Open Google Maps')}</a></>:<button type="button" className="btn primary cm-directions" disabled={!selectedPoint||!onDirections||directionsBusy} onClick={directions}>{directionsBusy?<Loader2 size={18} className="spin"/>:<Navigation size={18}/>}<span>{!selectedPoint?say('موقع العميل غير مسجل','Customer location not recorded'):directionsBusy?say('جارٍ تأكيد الرحلة…','Confirming trip…'):say('الاتجاهات','Directions')}</span></button>}
   {recordingNotice?.customerId===selected.id&&<p className={recordingNotice.error?'cm-directions-error':'cm-directions-ready'} role={recordingNotice.error?'alert':'status'}>{recordingNotice.text}</p>}
   {navigationError?.customerId===selected.id&&<p className="cm-directions-error" role="alert">{navigationError.text}</p>}
   {directionsError&&<p className="cm-directions-error" role="alert">{directionsError}</p>}
  </section>}
 </section>;
}

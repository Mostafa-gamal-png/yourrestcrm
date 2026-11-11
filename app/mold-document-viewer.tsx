'use client';
// The request's documents on the signing screens as ONE document (the owner, 2026-11-11: «التوقيع يكون داخل pdf يعنى pdf يتفتح ويكون عبارة
// عن عرض السعر او po وبعدين التصميم وفى اخره خانة للتوقيع بحيث الموقع يكون عارف هو بيوقع على ايه كأنه بيوقع على ورق حقيقى»): on the
// representative's device («توقيع العميل») and on the customer's link page, the quotation's pages, then the PO's, then the design PDFs',
// then each picture as a page, one white sheet under another, the screen's width, with ONE page counter for the whole («صفحة n من N», N
// counting the signature page), a discreet caption under each page («عرض السعر · Q-77.pdf»), and the signature page as the last sheet
// (drawn by the screen: signaturePage). What is in the document is decided as the server builds it (lib/mold-signed-document.ts): pdf-lib
// counts each PDF's pages (a PDF it cannot open, a GIF or WEBP picture, a PNG too large, any other file: named on the signature page only).
// - The files are read one after the other (a few downloads at a time is all the CRM's file routes take); a local file (the form's, before
//   its upload) is read from the device. Each is planned as it arrives (its SHA-256, its pages), and its sheets appear in their place.
// - pdf.js (drawing) and pdf-lib (counting) are loaded the first time a document is shown (lib/pdf-viewer-loader.ts: chunks of their own);
//   one pdf.js worker serves the documents of one screen and ends with it; a PDF is opened by pdf.js when one of its pages comes near.
// - A page is drawn when it comes within MOLD_VIEWER_NEAR_PX of the screen and its canvas given back beyond MOLD_VIEWER_KEEP_PX, two pages
//   at a time, at the screen's width × its density (at most 2) and never more than MOLD_VIEWER_MAX_PIXELS (lib/mold-document-view.ts):
//   a PDF of 30 pages holds a few drawn pages, not 30. «تكبير» draws one page twice as wide, to scroll sideways.
// - A page pdf.js cannot draw says so in its place and never stops the signing (the file sent is built from the bytes, not the drawing).
import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import type {PDFDocumentProxy,PDFWorker,RenderTask} from 'pdfjs-dist';
import {Loader2,TriangleAlert,ZoomIn,ZoomOut} from 'lucide-react';
import {loadPdfLib,loadPdfjs} from '@/lib/pdf-viewer-loader';
import {MOLD_VIEWER_KEEP_PX,MOLD_VIEWER_NEAR_PX,MOLD_VIEWER_TEXT,orderViewerFiles,viewerLabel,viewerRenderSize,type MoldViewerFile} from '@/lib/mold-document-view';
import {A4,docPageText,docTotal,imageLeftReason,imagePageLayout,pdfPagePlan,type SignedDocLeft,type SignedDocPart} from '@/lib/mold-signed-document';
import {moldImageSize} from '@/portable/mold-rules.mjs';
import './mold-document-viewer.css';

type Say=(ar:string,en:string)=>string;
type Watch=(element:Element,on:(near:boolean,keep:boolean)=>void)=>()=>void;
/** The document as planned so far: its parts (what is in it, in order), what is named only, and whether every file has been planned. */
export type DocPlan={parts:SignedDocPart[];left:SignedDocLeft[];ready:boolean};
/** One file as planned: in the document (its bytes, SHA-256 and pages; a picture's size), named only (why), or not planned yet. */
type Entry={file:MoldViewerFile;state:'waiting'}|{file:MoldViewerFile;state:'in';blob:Blob;part:SignedDocPart;image?:{width:number;height:number};aspects?:number[]}|{file:MoldViewerFile;state:'left';left:SignedDocLeft};
type Shared={watch:Watch;width:number;say:Say;pdf:(key:string,blob:Blob)=>Promise<PDFDocumentProxy>};
const SharedContext=createContext<Shared|null>(null);
const useShared=()=>useContext(SharedContext)!;

/** Two pages drawn at a time, whatever the number of documents on the screen. */
let drawing=0;
const waiting:(()=>void)[]=[];
function drawSlot():Promise<()=>void>{
 return new Promise(resolve=>{
  const take=()=>{drawing++;let given=false;resolve(()=>{if(given)return;given=true;drawing--;waiting.shift()?.();});};
  if(drawing<2)take();else waiting.push(take);
 });
}
/** The element the pages scroll in (the dialog on the device, the page on the link): a page is near when near the part of it shown. */
function scrollParent(element:Element):Element|null{
 for(let current=element.parentElement;current&&current!==document.body&&current!==document.documentElement;current=current.parentElement){
  const overflow=getComputedStyle(current).overflowY;
  if(overflow==='auto'||overflow==='scroll'||overflow==='overlay')return current;
 }
 return null;
}
/** A file's bytes through an address: a busy answer (429) is tried again a little later, three times at most. */
async function fetchBlob(href:string,credentials:RequestCredentials,signal:AbortSignal|undefined){
 for(let attempt=0;;attempt++){
  const response=await fetch(href,{cache:'no-store',credentials,...(signal?{signal}:{})});
  if(response.status===429&&attempt<3){await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));continue;}
  if(!response.ok)throw new Error('file '+response.status);
  return await response.blob();
 }
}
const hex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');
/** One file planned as the server will build it: in the document (a PDF pdf-lib opens, its pages; a PNG or JPEG picture), or named only. */
async function planFile(file:MoldViewerFile,blob:Blob):Promise<Entry>{
 const left=(reason:SignedDocLeft['reason']):Entry=>({file,state:'left',left:{name:file.name,category:file.category,kind:file.kind,reason}});
 if(file.kind==='other')return left('other');
 const bytes=new Uint8Array(await blob.arrayBuffer()),sha256=hex(await crypto.subtle.digest('SHA-256',bytes));
 if(file.kind==='image'){
  const reason=imageLeftReason(bytes),size=moldImageSize(bytes);
  return reason||!size?left(reason||'unopened'):{file,state:'in',blob,part:{sha256,category:file.category,kind:'image',name:file.name,pages:1},image:{width:size.width,height:size.height}};
 }
 const planned=await pdfPagePlan(await loadPdfLib(),bytes);
 return planned?{file,state:'in',blob,part:{sha256,category:file.category,kind:'pdf',name:file.name,pages:planned.pages},aspects:planned.aspects}:left('unopened');
}

/** The documents, ordered (the quotation's, the PO's, then the design's), as one document ending with signaturePage. credentials: 'omit'
 *  on the customer's link page (its file route needs no session), the CRM's own session on the device. onPlan: the plan as it grows (ready
 *  once every file is planned). */
export default function MoldDocumentViewer({files,say,credentials='same-origin',onPlan,signaturePage}:{files:MoldViewerFile[];say:Say;credentials?:RequestCredentials;onPlan?:(plan:DocPlan)=>void;signaturePage:(plan:DocPlan,page:number,total:number)=>React.ReactNode}){
 const ordered=useMemo(()=>orderViewerFiles(files),[files]);
 const box=useRef<HTMLDivElement>(null),[width,setWidth]=useState(0);
 useEffect(()=>{
  const element=box.current;
  if(!element)return;
  const measure=()=>{const next=Math.floor(element.getBoundingClientRect().width);if(next>0)setWidth(previous=>Math.abs(previous-next)<4?previous:next);};
  measure();
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
  observer?.observe(element);window.addEventListener('orientationchange',measure);
  return()=>{observer?.disconnect();window.removeEventListener('orientationchange',measure);};
 },[]);
 // The plan: every file read one after the other (stopped when the screen closes), each planned as it arrives.
 const [entries,setEntries]=useState<Entry[]>(()=>ordered.map(file=>({file,state:'waiting'})));
 const given=useRef(ordered);
 useEffect(()=>{
  let live=true;
  const controller=typeof AbortController==='undefined'?null:new AbortController();
  (async()=>{
   for(const [index,file] of given.current.entries()){
    let entry:Entry;
    try{
     const blob=file.kind==='other'?new Blob([]):file.file?file.file:file.href?await fetchBlob(file.href,credentials,controller?.signal):null;
     entry=blob?await planFile(file,blob):{file,state:'left',left:{name:file.name,category:file.category,kind:file.kind,reason:'unread'}};
    }catch{entry={file,state:'left',left:{name:file.name,category:file.category,kind:file.kind,reason:file.kind==='other'?'other':'unread'}};}
    if(!live)return;
    setEntries(previous=>previous.map((item,at)=>at===index?entry:item));
   }
  })();
  return()=>{live=false;controller?.abort();};
 },[credentials]);
 const plan=useMemo<DocPlan>(()=>({parts:entries.flatMap(entry=>entry.state==='in'?[entry.part]:[]),left:entries.flatMap(entry=>entry.state==='left'?[entry.left]:[]),ready:entries.every(entry=>entry.state!=='waiting')}),[entries]);
 const told=useRef(onPlan);
 useEffect(()=>{told.current=onPlan;},[onPlan]);
 useEffect(()=>{told.current?.(plan);},[plan]);
 // pdf.js: one worker, each PDF opened once, when one of its pages first comes near; all ended with the screen.
 const pdfWorker=useRef<PDFWorker|null>(null),opened=useRef(new Map<string,Promise<PDFDocumentProxy>>());
 const pdf=useCallback((key:string,blob:Blob)=>{
  let found=opened.current.get(key);
  if(!found){
   found=(async()=>{
    const [{pdfjs,StandardFontDataFactory},data]=await Promise.all([loadPdfjs(),blob.arrayBuffer()]);
    if(!pdfWorker.current||pdfWorker.current.destroyed)pdfWorker.current=new pdfjs.PDFWorker();
    // No script from a PDF is ever run (isEvalSupported, no XFA forms); a font the PDF names without carrying it (Helvetica, Times…)
    // comes from the build (useSystemFonts off: a phone's substitute font draws such text with the wrong spacing).
    return await pdfjs.getDocument({data:new Uint8Array(data),worker:pdfWorker.current,isEvalSupported:false,enableXfa:false,StandardFontDataFactory,useWorkerFetch:false,useSystemFonts:false}).promise;
   })();
   found.catch(()=>{opened.current.delete(key);});
   opened.current.set(key,found);
  }
  return found;
 },[]);
 // Two observers for all the pages: near (draw it) and kept (keep its canvas).
 const watchers=useRef<{near:IntersectionObserver;keep:IntersectionObserver;calls:Map<Element,{near:boolean;keep:boolean;on:(near:boolean,keep:boolean)=>void}>}|null>(null);
 const watch=useCallback<Watch>((element,on)=>{
  if(typeof IntersectionObserver==='undefined'){on(true,true);return()=>{};}
  if(!watchers.current){
   const root=scrollParent(element),calls=new Map<Element,{near:boolean;keep:boolean;on:(near:boolean,keep:boolean)=>void}>();
   const make=(px:number,key:'near'|'keep')=>new IntersectionObserver(items=>{for(const item of items){const call=calls.get(item.target);if(!call)continue;call[key]=item.isIntersecting;call.on(call.near,call.keep);}},{root,rootMargin:px+'px 0px'});
   watchers.current={calls,near:make(MOLD_VIEWER_NEAR_PX,'near'),keep:make(MOLD_VIEWER_KEEP_PX,'keep')};
  }
  const current=watchers.current;
  current.calls.set(element,{near:false,keep:false,on});current.near.observe(element);current.keep.observe(element);
  return()=>{current.calls.delete(element);current.near.unobserve(element);current.keep.unobserve(element);};
 },[]);
 useEffect(()=>{
  const docs=opened.current;
  return()=>{
   watchers.current?.near.disconnect();watchers.current?.keep.disconnect();watchers.current=null;
   for(const doc of docs.values())void doc.then(item=>item.destroy()).catch(()=>undefined);
   docs.clear();
   try{pdfWorker.current?.destroy();}catch{/* already ended */}
   pdfWorker.current=null;
  };
 },[]);
 const shared=useMemo<Shared>(()=>({watch,width,say,pdf}),[watch,width,say,pdf]);
 // The sheets in their order: each planned file's pages, a sheet «loading» at the first file still waiting (nothing after it yet: the
 // pages that follow are numbered once it is planned), then the signature page once every file is planned.
 const total=plan.ready?docTotal(plan.parts):null,sheets:React.ReactNode[]=[];
 let number=0;
 for(const entry of entries){
  if(entry.state==='waiting'){sheets.push(<LoadingSheet key={'wait:'+entry.file.key} name={entry.file.name}/>);break;}
  if(entry.state!=='in')continue;
  const caption=viewerLabel(entry.file.category,say)+' · '+entry.file.name;
  if(entry.part.kind==='image'&&entry.image)sheets.push(<ImageSheet key={entry.file.key} entry={entry} image={entry.image} number={++number} total={total} caption={caption}/>);
  else for(let page=1;page<=entry.part.pages;page++)sheets.push(<PdfSheet key={entry.file.key+':'+page} entryKey={entry.file.key} blob={entry.blob} page={page} number={++number} total={total} caption={caption} shape={entry.aspects?.[page-1]}/>);
 }
 return <div className="mold-doc-viewer" ref={box} role="region" aria-label={say(...MOLD_VIEWER_TEXT.documents)} data-ready={plan.ready||undefined} data-pages={total||undefined}>
  <SharedContext.Provider value={shared}>
   {sheets}
   {plan.ready&&total!==null&&<figure className="mold-doc-sheet mold-doc-sign-sheet" data-page={total} data-kind="signature">
    <div className="mold-doc-paper mold-doc-sign-paper" style={{minHeight:width?Math.round(width*A4.height/A4.width):undefined}}>{signaturePage(plan,total,total)}</div>
    <figcaption className="mold-doc-sheet-bar"><small className="mold-doc-counter">{docPageText(total,total,say)}</small></figcaption>
   </figure>}
  </SharedContext.Provider>
 </div>;
}

function LoadingSheet({name}:{name:string}){
 const {say}=useShared();
 return <figure className="mold-doc-sheet" data-kind="loading"><div className="mold-doc-paper mold-doc-wait-paper"><span className="mold-doc-page-wait" role="status"><Loader2 className="spin" size={18} aria-hidden="true"/><span>{say(...MOLD_VIEWER_TEXT.loading)} <bdi>{name}</bdi></span></span></div></figure>;
}
/** The bar under a page: the whole document's counter, the page's file (discreet), and «تكبير» where it applies. */
function SheetBar({number,total,caption,zoom,onZoom}:{number:number;total:number|null;caption:string;zoom?:number;onZoom?:()=>void}){
 const {say}=useShared();
 return <figcaption className="mold-doc-sheet-bar"><small className="mold-doc-counter">{docPageText(number,total,say)}</small><small className="mold-doc-caption"><bdi>{caption}</bdi></small>
  {onZoom&&<button type="button" className="btn small subtle" aria-pressed={(zoom||1)>1} onClick={onZoom}>{(zoom||1)>1?<ZoomOut size={14} aria-hidden="true"/>:<ZoomIn size={14} aria-hidden="true"/>}{say(...((zoom||1)>1?MOLD_VIEWER_TEXT.zoomOut:MOLD_VIEWER_TEXT.zoomIn))}</button>}
 </figcaption>;
}

function PdfSheet({entryKey,blob,page,number,total,caption,shape}:{entryKey:string;blob:Blob;page:number;number:number;total:number|null;caption:string;shape?:number}){
 const {watch,width,say,pdf}=useShared();
 const frame=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),drawnAt=useRef('');
 const [seen,setSeen]=useState({near:false,keep:false}),[aspect,setAspect]=useState(shape||A4.height/A4.width),[zoom,setZoom]=useState(1),[phase,setPhase]=useState<'idle'|'drawing'|'drawn'|'error'>('idle');
 useEffect(()=>{const element=frame.current;return element?watch(element,(near,keep)=>setSeen(previous=>previous.near===near&&previous.keep===keep?previous:{near,keep})):undefined;},[watch]);
 const size=width*zoom,key=size+':'+page;
 useEffect(()=>{
  const element=canvas.current;
  if(!element)return;
  // Far from the screen: the canvas is given back (a placeholder of the page's shape stays).
  if(!seen.keep){if(drawnAt.current){element.width=0;element.height=0;drawnAt.current='';setPhase('idle');}return;}
  if(!seen.near||!size||drawnAt.current===key)return;
  let live=true,task:RenderTask|null=null,release:(()=>void)|null=null;
  setPhase('drawing');
  (async()=>{
   const doc=await pdf(entryKey,blob);
   release=await drawSlot();
   if(!live)return;
   const drawn=await doc.getPage(page);
   if(!live)return;
   const base=drawn.getViewport({scale:1}),fit=viewerRenderSize({cssWidth:size,pageWidth:base.width,pageHeight:base.height,density:window.devicePixelRatio||1});
   setAspect(base.height/Math.max(1,base.width));
   element.width=fit.pixelWidth;element.height=fit.pixelHeight;
   const context=element.getContext('2d');
   if(!context)throw new Error('no canvas');
   task=drawn.render({canvasContext:context,viewport:drawn.getViewport({scale:fit.scale}),background:'#ffffff'});
   await task.promise;
   drawn.cleanup();
   if(live){drawnAt.current=key;setPhase('drawn');}
  })().catch((error:unknown)=>{if(live&&(error as {name?:string})?.name!=='RenderingCancelledException')setPhase('error');}).finally(()=>release?.());
  return()=>{live=false;task?.cancel();};
 },[seen.near,seen.keep,size,key,entryKey,blob,page,pdf]);
 const cssWidth=size||undefined,cssHeight=size?Math.round(size*aspect):undefined;
 return <figure className="mold-doc-sheet" data-kind="pdf" data-page={number} data-file-page={page} data-state={phase} data-zoom={zoom>1||undefined}>
  <div className="mold-doc-frame mold-doc-paper" ref={frame} style={cssHeight?{height:cssHeight}:{aspectRatio:String(1/Math.max(.05,aspect))}}>
   {/* Left to right: a canvas draws text in its element's direction, and pdf.js places each glyph from its left (in a right-to-left page
       every letter would be drawn its own width too far). */}
   <canvas ref={canvas} width={0} height={0} dir="ltr" role="img" aria-label={docPageText(number,total,say)+' · '+caption} style={cssWidth?{width:cssWidth,height:cssHeight}:undefined}/>
   {phase==='drawing'&&<span className="mold-doc-page-wait"><Loader2 className="spin" size={18} aria-hidden="true"/>{say(...MOLD_VIEWER_TEXT.pageLoading)}</span>}
   {phase==='error'&&<span className="mold-doc-page-wait" data-error><TriangleAlert size={16} aria-hidden="true"/>{say(...MOLD_VIEWER_TEXT.pageFailed)}</span>}
  </div>
  <SheetBar number={number} total={total} caption={caption} zoom={zoom} onZoom={()=>setZoom(zoom>1?1:2)}/>
 </figure>;
}

/** A picture as its page: a white A4 sheet (on its side for a wide picture) with the picture where the signed document puts it. */
function ImageSheet({entry,image,number,total,caption}:{entry:Extract<Entry,{state:'in'}>;image:{width:number;height:number};number:number;total:number|null;caption:string}){
 const {watch,say}=useShared(),frame=useRef<HTMLDivElement>(null),[url,setUrl]=useState(''),[failed,setFailed]=useState(false),made=useRef('');
 // The picture's address is made the first time its page comes near, and given back with the screen.
 const blob=entry.blob;
 useEffect(()=>{const element=frame.current;return element?watch(element,near=>{if(near&&!made.current){made.current=URL.createObjectURL(blob);setUrl(made.current);}}):undefined;},[watch,blob]);
 useEffect(()=>()=>{if(made.current)URL.revokeObjectURL(made.current);made.current='';},[]);
 const layout=imagePageLayout(image.width,image.height),share=layout.share,percent=(value:number)=>(value*100).toFixed(3)+'%';
 return <figure className="mold-doc-sheet" data-kind="image" data-page={number}>
  <div className="mold-doc-paper mold-doc-image-paper" ref={frame} style={{aspectRatio:layout.pageWidth+' / '+layout.pageHeight}}>
   {url&&!failed?
    // eslint-disable-next-line @next/next/no-img-element -- the request's own picture, read from the device or the CRM as bytes
    <img className="mold-doc-image" src={url} alt={entry.file.name} decoding="async" onError={()=>setFailed(true)} style={{left:percent(share.left),top:percent(share.top),width:percent(share.width),height:percent(share.height)}}/>
    :failed?<span className="mold-doc-page-wait" data-error><TriangleAlert size={16} aria-hidden="true"/>{say(...MOLD_VIEWER_TEXT.pageFailed)}</span>:null}
  </div>
  <SheetBar number={number} total={total} caption={caption}/>
 </figure>;
}

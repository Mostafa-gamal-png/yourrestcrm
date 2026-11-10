'use client';
// The request's documents on the signing screens (the owner, 2026-11-10: «ملف pdf يظهر على الشاشة فيه عرض السعر او po + التصميم وخانة فى
// الاخر العميل بيوقع داخلها»): on the representative's device («توقيع العميل») and on the customer's link page, the quotation's and PO's
// files and then the design's, one after the other, each page of a PDF drawn by pdf.js on a canvas the width of the screen (the Android
// app's WebView shows no PDF in a frame), a picture as it is, any other file named (it goes to production as it is). The signature box
// follows the last page (MoldSigningStep, MoldSignPage).
// - pdf.js is loaded the first time a document is shown (lib/pdf-viewer-loader.ts: a chunk and a worker of their own); one worker serves
//   the documents of one screen and ends with it.
// - The files are read one after the other (a few downloads at a time is all the CRM's file routes take); a local file (the form's, before
//   its upload) is read from the device.
// - A page is drawn when it comes within MOLD_VIEWER_NEAR_PX of the screen and its canvas given back beyond MOLD_VIEWER_KEEP_PX, two pages
//   at a time, at the screen's width × its density (at most 2) and never more than MOLD_VIEWER_MAX_PIXELS (lib/mold-document-view.ts):
//   a PDF of 30 pages holds a few drawn pages, not 30. «تكبير» draws one page twice as wide, to scroll sideways.
// - A file that cannot be shown (damaged, protected, not downloaded) says so in its place and never stops the signing.
import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import type {PDFDocumentProxy,PDFWorker,RenderTask} from 'pdfjs-dist';
import {Download,ExternalLink,FileBox,FileText,ImageIcon,Loader2,TriangleAlert,ZoomIn,ZoomOut} from 'lucide-react';
import {loadPdfjs,type Pdfjs} from '@/lib/pdf-viewer-loader';
import {MOLD_VIEWER_KEEP_PX,MOLD_VIEWER_NEAR_PX,MOLD_VIEWER_TEXT,orderViewerFiles,viewerLabel,viewerOtherText,viewerPageText,viewerPagesText,viewerRenderSize,type MoldViewerFile} from '@/lib/mold-document-view';
import './mold-document-viewer.css';

type Say=(ar:string,en:string)=>string;
type Watch=(element:Element,on:(near:boolean,keep:boolean)=>void)=>()=>void;
type Shared={bytes:(file:MoldViewerFile)=>Promise<Blob>;worker:(pdfjs:Pdfjs)=>PDFWorker;watch:Watch;width:number;say:Say};
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

/** The documents, ordered (the quotation's, the PO's, then the design's). credentials: 'omit' on the customer's link page (its file route
 *  needs no session), the CRM's own session on the device. */
export default function MoldDocumentViewer({files,say,credentials='same-origin'}:{files:MoldViewerFile[];say:Say;credentials?:RequestCredentials}){
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
 // One download at a time, stopped when the screen closes.
 const queue=useRef<Promise<unknown>>(Promise.resolve()),abort=useRef<AbortController|null>(null);
 const bytes=useCallback((file:MoldViewerFile)=>{
  if(file.file)return Promise.resolve(file.file);
  if(!file.href)return Promise.reject(new Error('no address'));
  if(!abort.current||abort.current.signal.aborted)abort.current=typeof AbortController==='undefined'?null:new AbortController();
  const signal=abort.current?.signal,next=queue.current.catch(()=>undefined).then(()=>fetchBlob(file.href!,credentials,signal));
  queue.current=next;
  return next;
 },[credentials]);
 const pdfWorker=useRef<PDFWorker|null>(null);
 const worker=useCallback((pdfjs:Pdfjs)=>{if(!pdfWorker.current||pdfWorker.current.destroyed)pdfWorker.current=new pdfjs.PDFWorker();return pdfWorker.current;},[]);
 // Two observers for all the pages: near (draw it) and kept (keep its canvas).
 const watchers=useRef<{near:IntersectionObserver;keep:IntersectionObserver;calls:Map<Element,{near:boolean;keep:boolean;on:(near:boolean,keep:boolean)=>void}>}|null>(null);
 const watch=useCallback<Watch>((element,on)=>{
  if(typeof IntersectionObserver==='undefined'){on(true,true);return()=>{};}
  if(!watchers.current){
   const root=scrollParent(element),calls=new Map<Element,{near:boolean;keep:boolean;on:(near:boolean,keep:boolean)=>void}>();
   const make=(px:number,key:'near'|'keep')=>new IntersectionObserver(entries=>{for(const entry of entries){const call=calls.get(entry.target);if(!call)continue;call[key]=entry.isIntersecting;call.on(call.near,call.keep);}},{root,rootMargin:px+'px 0px'});
   watchers.current={calls,near:make(MOLD_VIEWER_NEAR_PX,'near'),keep:make(MOLD_VIEWER_KEEP_PX,'keep')};
  }
  const current=watchers.current;
  current.calls.set(element,{near:false,keep:false,on});current.near.observe(element);current.keep.observe(element);
  return()=>{current.calls.delete(element);current.near.unobserve(element);current.keep.unobserve(element);};
 },[]);
 useEffect(()=>()=>{
  abort.current?.abort();abort.current=null;
  watchers.current?.near.disconnect();watchers.current?.keep.disconnect();watchers.current=null;
  try{pdfWorker.current?.destroy();}catch{/* already ended */}
  pdfWorker.current=null;
 },[]);
 const shared=useMemo<Shared>(()=>({bytes,worker,watch,width,say}),[bytes,worker,watch,width,say]);
 return <div className="mold-doc-viewer" ref={box} role="region" aria-label={say(...MOLD_VIEWER_TEXT.documents)}>
  <SharedContext.Provider value={shared}>
   {!ordered.length&&<p className="mold-doc-none">{say(...MOLD_VIEWER_TEXT.none)}</p>}
   {ordered.map(file=>file.kind==='pdf'?<PdfFile key={file.key} file={file}/>:file.kind==='image'?<ImageFile key={file.key} file={file}/>:<OtherFile key={file.key} file={file}/>)}
  </SharedContext.Provider>
 </div>;
}

function Heading({file,pages,icon}:{file:MoldViewerFile;pages?:number;icon:React.ReactNode}){
 const {say}=useShared();
 return <header className="mold-doc-head">{icon}<span className="mold-doc-title"><b>{viewerLabel(file.category,say)}:</b> <bdi>{file.name}</bdi>{!!pages&&<small> · {viewerPagesText(pages,say)}</small>}</span>
  {file.link&&<a className="btn small subtle mold-doc-open" href={file.link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true"/>{say(...MOLD_VIEWER_TEXT.open)}</a>}</header>;
}
/** A file that cannot be shown (its heading keeps «فتح» where the screen offers it). */
function Failed(){
 const {say}=useShared();
 return <p className="mold-doc-error" role="status"><TriangleAlert size={16} aria-hidden="true"/><span>{say(...MOLD_VIEWER_TEXT.failed)}<small>{say(...MOLD_VIEWER_TEXT.failedNote)}</small></span></p>;
}
const Loading=({text}:{text:string})=><p className="mold-doc-loading" role="status"><Loader2 className="spin" size={16} aria-hidden="true"/>{text}</p>;

type Opened={phase:'loading'}|{phase:'error'}|{phase:'ready';doc:PDFDocumentProxy;pages:number;ratio:number};
function PdfFile({file}:{file:MoldViewerFile}){
 const shared=useShared(),{say}=shared,[state,setState]=useState<Opened>({phase:'loading'});
 // The file as first given (a list made again with the same files keeps its document).
 const given=useRef(file);
 const {bytes,worker}=shared;
 useEffect(()=>{
  let live=true,task:ReturnType<Pdfjs['getDocument']>|null=null;
  (async()=>{
   const [{pdfjs,StandardFontDataFactory},blob]=await Promise.all([loadPdfjs(),bytes(given.current)]);
   if(!live)return;
   const data=new Uint8Array(await blob.arrayBuffer());
   if(!live)return;
   // No script from a PDF is ever run (isEvalSupported, no XFA forms); a font the PDF names without carrying it (Helvetica, Times…)
   // comes from the build (useSystemFonts off: a phone's substitute font draws such text with the wrong spacing).
   task=pdfjs.getDocument({data,worker:worker(pdfjs),isEvalSupported:false,enableXfa:false,StandardFontDataFactory,useWorkerFetch:false,useSystemFonts:false});
   const doc=await task.promise,first=await doc.getPage(1),view=first.getViewport({scale:1});
   first.cleanup();
   if(live)setState({phase:'ready',doc,pages:doc.numPages,ratio:view.height/Math.max(1,view.width)});
  })().catch(()=>{if(live)setState({phase:'error'});});
  return()=>{live=false;void task?.destroy().catch(()=>undefined);};
 },[bytes,worker]);
 return <article className="mold-doc-file" data-kind="pdf" data-category={file.category} data-state={state.phase}>
  <Heading file={file} pages={state.phase==='ready'?state.pages:undefined} icon={<FileText size={17} aria-hidden="true"/>}/>
  {state.phase==='loading'&&<Loading text={say(...MOLD_VIEWER_TEXT.loading)}/>}
  {state.phase==='error'&&<Failed/>}
  {state.phase==='ready'&&<div className="mold-doc-pages">{Array.from({length:state.pages},(_,index)=><PdfPage key={index} doc={state.doc} number={index+1} total={state.pages} ratio={state.ratio}/>)}</div>}
 </article>;
}

function PdfPage({doc,number,total,ratio}:{doc:PDFDocumentProxy;number:number;total:number;ratio:number}){
 const {watch,width,say}=useShared();
 const frame=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),drawnAt=useRef('');
 const [seen,setSeen]=useState({near:false,keep:false}),[aspect,setAspect]=useState(ratio),[zoom,setZoom]=useState(1),[phase,setPhase]=useState<'idle'|'drawing'|'drawn'|'error'>('idle');
 useEffect(()=>{const element=frame.current;return element?watch(element,(near,keep)=>setSeen(previous=>previous.near===near&&previous.keep===keep?previous:{near,keep})):undefined;},[watch]);
 const size=width*zoom,key=size+':'+number;
 useEffect(()=>{
  const element=canvas.current;
  if(!element)return;
  // Far from the screen: the canvas is given back (a placeholder of the page's shape stays).
  if(!seen.keep){if(drawnAt.current){element.width=0;element.height=0;drawnAt.current='';setPhase('idle');}return;}
  if(!seen.near||!size||drawnAt.current===key)return;
  let live=true,task:RenderTask|null=null,release:(()=>void)|null=null;
  setPhase('drawing');
  (async()=>{
   release=await drawSlot();
   if(!live)return;
   const page=await doc.getPage(number);
   if(!live)return;
   const base=page.getViewport({scale:1}),drawn=viewerRenderSize({cssWidth:size,pageWidth:base.width,pageHeight:base.height,density:window.devicePixelRatio||1});
   setAspect(base.height/Math.max(1,base.width));
   element.width=drawn.pixelWidth;element.height=drawn.pixelHeight;
   const context=element.getContext('2d');
   if(!context)throw new Error('no canvas');
   task=page.render({canvasContext:context,viewport:page.getViewport({scale:drawn.scale}),background:'#ffffff'});
   await task.promise;
   page.cleanup();
   if(live){drawnAt.current=key;setPhase('drawn');}
  })().catch((error:unknown)=>{if(live&&(error as {name?:string})?.name!=='RenderingCancelledException')setPhase('error');}).finally(()=>release?.());
  return()=>{live=false;task?.cancel();};
 },[seen.near,seen.keep,size,key,doc,number]);
 const cssWidth=size||undefined,cssHeight=size?Math.round(size*aspect):undefined;
 return <figure className="mold-doc-page" data-page={number} data-state={phase} data-zoom={zoom>1||undefined}>
  <figcaption className="mold-doc-page-bar"><small>{viewerPageText(number,total,say)}</small>
   <button type="button" className="btn small subtle" aria-pressed={zoom>1} onClick={()=>setZoom(zoom>1?1:2)}>{zoom>1?<ZoomOut size={14} aria-hidden="true"/>:<ZoomIn size={14} aria-hidden="true"/>}{say(...(zoom>1?MOLD_VIEWER_TEXT.zoomOut:MOLD_VIEWER_TEXT.zoomIn))}</button></figcaption>
  <div className="mold-doc-frame" ref={frame} style={cssHeight?{height:cssHeight}:{aspectRatio:String(1/Math.max(.05,aspect))}}>
   {/* Left to right: a canvas draws text in its element's direction, and pdf.js places each glyph from its left (in a right-to-left page
       every letter would be drawn its own width too far). */}
   <canvas ref={canvas} width={0} height={0} dir="ltr" role="img" aria-label={viewerPageText(number,total,say)} style={cssWidth?{width:cssWidth,height:cssHeight}:undefined}/>
   {phase==='drawing'&&<span className="mold-doc-page-wait"><Loader2 className="spin" size={18} aria-hidden="true"/>{say(...MOLD_VIEWER_TEXT.pageLoading)}</span>}
   {phase==='error'&&<span className="mold-doc-page-wait" data-error><TriangleAlert size={16} aria-hidden="true"/>{say(...MOLD_VIEWER_TEXT.pageFailed)}</span>}
  </div>
 </figure>;
}

function ImageFile({file}:{file:MoldViewerFile}){
 const {bytes,say}=useShared(),given=useRef(file),[url,setUrl]=useState(''),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let live=true,made='';
  bytes(given.current).then(blob=>{if(!live)return;made=URL.createObjectURL(blob);setUrl(made);}).catch(()=>{if(live)setFailed(true);});
  return()=>{live=false;if(made)URL.revokeObjectURL(made);};
 },[bytes]);
 return <article className="mold-doc-file" data-kind="image" data-category={file.category} data-state={failed?'error':url?'ready':'loading'}>
  <Heading file={file} icon={<ImageIcon size={17} aria-hidden="true"/>}/>
  {failed?<Failed/>:url?
   // eslint-disable-next-line @next/next/no-img-element -- the request's own picture, read from the device or the CRM as bytes
   <img className="mold-doc-image" src={url} alt={file.name} decoding="async" onError={()=>setFailed(true)}/>
   :<Loading text={say(...MOLD_VIEWER_TEXT.loading)}/>}
 </article>;
}

function OtherFile({file}:{file:MoldViewerFile}){
 const {say}=useShared();
 return <article className="mold-doc-file" data-kind="other" data-category={file.category}>
  <p className="mold-doc-other"><FileBox size={17} aria-hidden="true"/><span><b>{viewerLabel(file.category,say)}:</b> {viewerOtherText(file.name,say)}</span>
   {file.link&&<a className="btn small subtle" href={file.link} download={file.name}><Download size={14} aria-hidden="true"/>{say(...MOLD_VIEWER_TEXT.download)}</a>}</p>
 </article>;
}

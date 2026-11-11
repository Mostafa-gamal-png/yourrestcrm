'use client';
// The customer's signature on a mold request (the owner, 2026-11-04: «العميل بيوقع على طلب القالب ولازم علشان يعتمد»): before a sales role's
// request is sent, the form opens «توقيع العميل», a short read-only summary of what the customer signs, the name of who signs for the
// customer, and a pad the customer signs on with a finger, a stylus or a mouse (pointer events, so the Android app's WebView and a tablet in
// either orientation draw alike; the page does not scroll while drawing). A blank pad, a tap or a short tick is refused
// (moldSignatureDrawn). The drawing is sent as a PNG (white background, trimmed to what was drawn, at most 1200 pixels a side and 256 KiB),
// kept by the CRM as one of the request's design files and sent to production with them.
// Since 2026-11-10 the signing also composes the block stamped at the bottom of the last page of every PDF of the request (signatureBlockPng:
// the drawing, «توقيع العميل: <name>» and the moment in Riyadh, the canvas shaping the Arabic), the moment taken from the server's clock
// (noteServerTime, serverNow); and a sales role may choose «أرسل إلى العميل رابطًا يوقّع منه» instead of the pad.
// Since the owner's «يوقع داخل pdf» (2026-11-10, second release of the day) the customer reads the request's PDFs and pictures themselves
// on the screen (app/mold-document-viewer.tsx) and signs in the box after their last page. Since 2026-11-11 («ملف واحد موقّع») they are ONE
// document whose last page is the signature page (app/mold-signature-page.tsx); the page is composed as a PNG on signing and the CRM makes
// one signed PDF of every page.
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Eraser,Link2,Loader2,PenLine,Send,Undo2} from 'lucide-react';
import {direction,t} from '@/lib/i18n';
import {MOLD_SIGNATURE_TEXT,MOLD_SIGN_LINK_TEXT} from '@/lib/mold-requests';
import {MOLD_SIGNATURE_MAX_BYTES,MOLD_SIGNATURE_MAX_SIDE,MOLD_SIGNER_MAX,MOLD_SIGNER_MIN,moldSignatureDrawn,moldSigner} from '@/portable/mold-rules.mjs';
import {MOLD_VIEWER_TEXT,type MoldViewerFile} from '@/lib/mold-document-view';
import {MOLD_SIGN_PAGE_TEXT,docCategory,type SignedDocPart} from '@/lib/mold-signed-document';
import {drawTexts,fitSize,labelValueRow,ltrIsolate} from '@/lib/sign-page-canvas';
import type {MoldFileCategory} from '@/lib/mold-requests';
import MoldDocumentViewer,{type DocPlan} from './mold-document-viewer';
import {MoldSignaturePage,signaturePagePng} from './mold-signature-page';
import VoiceField from './voice-field';

type Say=(ar:string,en:string)=>string;
/** A point as a fraction of the pad's width (x and y alike), so a pad that changes width (a phone turned) redraws the same signature. */
export type SignaturePoint=[number,number];
export type SignatureStrokes=SignaturePoint[][];
/** The margin kept around the drawing in the PNG, and the line, in CSS pixels. */
const MARGIN=12,LINE=2.6,INK='#111';

/** What was drawn, in CSS pixels at a pad of this width: how many points and the box around them. */
export function signatureBox(strokes:SignatureStrokes,width:number){
 let points=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const stroke of strokes)for(const [x,y] of stroke){points++;minX=Math.min(minX,x*width);minY=Math.min(minY,y*width);maxX=Math.max(maxX,x*width);maxY=Math.max(maxY,y*width);}
 return points?{points,minX,minY,width:maxX-minX,height:maxY-minY}:{points:0,minX:0,minY:0,width:0,height:0};
}
function drawStrokes(g:CanvasRenderingContext2D,strokes:SignatureStrokes,width:number){
 g.strokeStyle=INK;g.fillStyle=INK;g.lineWidth=LINE;g.lineCap='round';g.lineJoin='round';
 for(const stroke of strokes){
  if(!stroke.length)continue;
  if(stroke.length===1){g.beginPath();g.arc(stroke[0][0]*width,stroke[0][1]*width,LINE/2,0,Math.PI*2);g.fill();continue;}
  g.beginPath();g.moveTo(stroke[0][0]*width,stroke[0][1]*width);
  for(const [x,y] of stroke.slice(1))g.lineTo(x*width,y*width);
  g.stroke();
 }
}
/** The signature as a PNG in base64 (no data: prefix): a white background, trimmed to the drawing with its margin, at twice the CSS size
 *  where it fits within 1200 pixels a side, smaller again should it exceed 256 KiB. null when nothing was drawn or it cannot be made. */
export function signaturePng(strokes:SignatureStrokes,width:number):string|null{
 const box=signatureBox(strokes,width);
 if(!box.points||typeof document==='undefined')return null;
 const w=box.width+2*MARGIN,h=box.height+2*MARGIN;
 for(const factor of [2,1.5,1,.7,.5]){
  const scale=Math.min(factor,MOLD_SIGNATURE_MAX_SIDE/w,MOLD_SIGNATURE_MAX_SIDE/h),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  const g=canvas.getContext('2d');
  if(!g)return null;
  g.fillStyle='#fff';g.fillRect(0,0,canvas.width,canvas.height);
  g.scale(scale,scale);g.translate(MARGIN-box.minX,MARGIN-box.minY);
  drawStrokes(g,strokes,width);
  const data=canvas.toDataURL('image/png').split(',')[1]||'';
  if(data&&Math.floor(data.length/4)*3<=MOLD_SIGNATURE_MAX_BYTES)return data;
 }
 return null;
}

/** The server's clock as the page last heard it (a list's generatedAt, the link page's now): the block's moment is the server's, whatever
 *  the device's own clock says (the server refuses a moment far from its own). */
let serverOffset=0;
export function noteServerTime(iso:string|null|undefined){const at=Date.parse(iso||'');if(Number.isFinite(at))serverOffset=at-Date.now();}
export const serverNow=()=>new Date(Date.now()+serverOffset);
/** The moment as the block prints it: day/month/year and the hour in Riyadh. */
export const blockMoment=(at:Date)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at).replace(',',' -');
/** The block's size in pixels (moldSignatureBlockCheck takes 600..1600 by 150..800). */
export const BLOCK_WIDTH=960,BLOCK_HEIGHT=300;
/** The block stamped in the request's PDFs as a PNG in base64 (no data: prefix): a white card with a thin frame, «توقيع العميل: <signer>»
 *  at the top (right to left, shaped by the canvas, smaller when long), the drawing scaled into the middle, and «التاريخ: <day> - <hour>
 *  (توقيت الرياض)» at the bottom. null when nothing was drawn or it cannot be made. */
export function signatureBlockPng(strokes:SignatureStrokes,width:number,signer:string,at:Date):string|null{
 const box=signatureBox(strokes,width);
 if(!box.points||typeof document==='undefined')return null;
 const canvas=document.createElement('canvas');canvas.width=BLOCK_WIDTH;canvas.height=BLOCK_HEIGHT;
 const g=canvas.getContext('2d');
 if(!g)return null;
 const W=BLOCK_WIDTH,H=BLOCK_HEIGHT,pad=26,family='"Segoe UI",Tahoma,"Noto Naskh Arabic","Noto Sans Arabic","DejaVu Sans",Arial,sans-serif';
 g.fillStyle='#fff';g.fillRect(0,0,W,H);
 g.strokeStyle='#5b6b62';g.lineWidth=2;g.strokeRect(5,5,W-10,H-10);
 g.textBaseline='alphabetic';
 // Two cells on the top line (lib/sign-page-canvas.ts): «توقيع العميل:» alone, the signer's name alone in its own direction; the moment one
 // line, its digits isolated left to right.
 drawTexts(g,labelValueRow(g,'توقيع العميل:',signer,{room:W-2*pad,start:W-pad,y:18,rtl:true,family,size:32,min:14,weight:'bold'}).texts);
 const when='التاريخ: '+ltrIsolate(blockMoment(at))+' (توقيت الرياض)',whenSize=fitSize(g,when,W-2*pad,size=>'normal '+size+'px '+family,22,12);
 drawTexts(g,[{text:when,x:W-pad,y:H-22,font:'normal '+whenSize+'px '+family,color:'#333',dir:'rtl',align:'right'}]);
 // The drawing, scaled into the space between the two lines and centred.
 const top=66,bottom=H-50,room={width:W-2*pad,height:bottom-top},scale=Math.min(room.width/Math.max(box.width,1),room.height/Math.max(box.height,1),3);
 g.save();g.translate(pad+(room.width-box.width*scale)/2,top+(room.height-box.height*scale)/2);g.scale(scale,scale);g.translate(-box.minX,-box.minY);
 drawStrokes(g,strokes,width);g.restore();
 return canvas.toDataURL('image/png').split(',')[1]||null;
}

/** The pad: a canvas that keeps its 2:1 shape at any width, drawn on with pointer events (touch-action none: no scroll, no zoom while
 *  drawing). One pointer at a time; coalesced events keep a fast stroke smooth. onWidth: the pad's width in CSS pixels, as it changes. */
export function SignaturePad({strokes,onChange,onWidth,disabled,say}:{strokes:SignatureStrokes;onChange:(next:SignatureStrokes)=>void;onWidth:(width:number)=>void;disabled:boolean;say:Say}){
 const canvas=useRef<HTMLCanvasElement>(null),drawing=useRef<{id:number;stroke:SignaturePoint[]}|null>(null),[width,setWidth]=useState(0);
 // The canvas's pixels follow its size on the screen (and the screen's density): redrawn whole each time.
 useEffect(()=>{
  const element=canvas.current;
  if(!element)return;
  const measure=()=>{const next=element.getBoundingClientRect().width;if(next>0)setWidth(previous=>Math.abs(previous-next)<.5?previous:next);};
  measure();
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
  observer?.observe(element);window.addEventListener('orientationchange',measure);
  return()=>{observer?.disconnect();window.removeEventListener('orientationchange',measure);};
 },[]);
 useEffect(()=>{if(width)onWidth(width);},[width,onWidth]);
 const paint=useCallback(()=>{
  const element=canvas.current,g=element?.getContext('2d');
  if(!element||!g||!width)return;
  const ratio=Math.min(3,window.devicePixelRatio||1),height=element.getBoundingClientRect().height||width/2;
  if(element.width!==Math.round(width*ratio)||element.height!==Math.round(height*ratio)){element.width=Math.round(width*ratio);element.height=Math.round(height*ratio);}
  g.setTransform(ratio,0,0,ratio,0,0);g.clearRect(0,0,width,height);
  drawStrokes(g,drawing.current?[...strokes,drawing.current.stroke]:strokes,width);
 },[strokes,width]);
 useEffect(()=>{paint();},[paint]);
 const at=(event:{clientX:number;clientY:number}):SignaturePoint=>{const box=canvas.current!.getBoundingClientRect(),w=box.width||1;return [Math.min(1,Math.max(0,(event.clientX-box.left)/w)),Math.min(box.height/w,Math.max(0,(event.clientY-box.top)/w))];};
 const finish=(event:React.PointerEvent<HTMLCanvasElement>)=>{
  const current=drawing.current;
  if(!current||current.id!==event.pointerId)return;
  drawing.current=null;
  onChange([...strokes,current.stroke]);
 };
 return <canvas ref={canvas} className="mold-signature-pad" data-disabled={disabled||undefined} role="img" aria-label={say('مكان توقيع العميل: يوقّع بإصبعه أو بالقلم','Signature pad: the customer signs with a finger or a stylus')}
  onPointerDown={event=>{
   if(disabled||drawing.current||event.button>0)return;
   event.preventDefault();
   try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* a pointer the browser no longer tracks: drawn without capture */}
   drawing.current={id:event.pointerId,stroke:[at(event)]};paint();
  }}
  onPointerMove={event=>{
   const current=drawing.current;
   if(!current||current.id!==event.pointerId)return;
   event.preventDefault();
   const events=typeof event.nativeEvent.getCoalescedEvents==='function'?event.nativeEvent.getCoalescedEvents():[];
   for(const item of events.length?events:[event.nativeEvent])current.stroke.push(at(item));
   paint();
  }}
  onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}/>;
}

/** The step «توقيع العميل»: the request's documents as ONE document (2026-11-11) whose last page is the signature page (what is signed for,
 *  the documents and their pages, the consent, the signer's name and the pad inside its box, the moment), then «تأكيد وإرسال» and «رجوع
 *  للطلب» under it. The server's refusals by field (fields.signer, fields.signature) are said beside each until that field changes; error:
 *  any other. The signature (the PNG, the block, the signature page and its documents) is made once per signing, on the first confirm, and
 *  sent again as it is by every later confirm (a retry after an answer that never came resends the very same body under the same
 *  identifier, however the pad was resized since); a new drawing, «امسح» or another name starts a new signing. The dialog shows the step
 *  from its top, so the customer reads the document from its first page. */
/** The signature as the step gives it: the drawing's PNG, the block (2026-11-10: the per-file copies, now the fallback) and its moment, and
 *  since 2026-11-11 the signature page as a PNG with the documents it lists (document). */
export type SigningResult={signer:string;png:string;block:string;blockAt:string;document:{page:string;parts:SignedDocPart[];category:MoldFileCategory}};
/** onLink (2026-11-10): offered (a sales role's new request, or an edit that changes what was signed), the step starts with a choice: the
 *  customer signs now (the document and its signature page), or a link is sent for the customer to sign from (the request is saved and
 *  kept until then; no document is shown). summary: what the request is, as text (the signature page prints it). title: the customer's
 *  name for the line above the document. */
export function MoldSigningStep({summary,title,documents=[],busy,error,fields,again=false,say,onBack,onConfirm,onLink}:{summary:[string,string][];title?:string;documents?:MoldViewerFile[];busy:boolean;error:string;fields:Record<string,string>;again?:boolean;say:Say;onBack:()=>void;onConfirm:(signature:SigningResult)=>void;onLink?:()=>void}){
 const [signer,setSigner]=useState(''),[strokes,setStrokes]=useState<SignatureStrokes>([]),[width,setWidth]=useState(0),[shown,setShown]=useState<{signer?:string;pad?:string}>({});
 const [frozen,setFrozen]=useState<SigningResult|null>(null),[dismissed,setDismissed]=useState<{signer?:boolean;signature?:boolean}>({}),[answered,setAnswered]=useState(fields);
 const [mode,setMode]=useState<'now'|'link'>('now'),[plan,setPlan]=useState<DocPlan|null>(null);
 // Each new refusal from the server is shown again (state adjusted while rendering, not in an effect).
 if(answered!==fields){setAnswered(fields);setDismissed({});}
 const signerError=shown.signer||(fields.signer&&!dismissed.signer?t(fields.signer):''),padError=shown.pad||(fields.signature&&!dismissed.signature?t(fields.signature):'');
 const top=useRef<HTMLElement>(null);
 useEffect(()=>{const dialog=top.current?.closest('.mold-dialog');if(dialog)dialog.scrollTop=0;},[]);
 const changeSigner=(value:string)=>{setSigner(value);setFrozen(null);setShown(previous=>({...previous,signer:undefined}));setDismissed(previous=>({...previous,signer:true}));};
 const changeStrokes=(next:SignatureStrokes)=>{setStrokes(next);setFrozen(null);setShown(previous=>({...previous,pad:undefined}));setDismissed(previous=>({...previous,signature:true}));};
 const ready=!!plan?.ready;
 const confirm=()=>{
  if(frozen){onConfirm(frozen);return;}
  if(!plan?.ready)return;
  const name=moldSigner(signer),length=name===undefined?0:[...name].length,box=signatureBox(strokes,width);
  const next:{signer?:string;pad?:string}={};
  if(name===undefined||length<MOLD_SIGNER_MIN||length>MOLD_SIGNER_MAX)next.signer=say(...MOLD_SIGNATURE_TEXT.signerRequired);
  const png=moldSignatureDrawn(box)?signaturePng(strokes,width):null,at=serverNow();
  const block=png&&name!==undefined?signatureBlockPng(strokes,width,name,at):null;
  const page=png&&block&&name!==undefined?signaturePagePng({plan,summary,signer:name,strokes,width,at,say,rtl:direction()==='rtl'}):null;
  if(!png||!block||!page)next.pad=say(...MOLD_SIGNATURE_TEXT.blank);
  setShown(next);
  if(next.signer||next.pad||!png||!block||!page||name===undefined)return;
  const signature:SigningResult={signer:name,png,block,blockAt:at.toISOString(),document:{page,parts:plan.parts,category:docCategory(plan.parts,plan.left)}};
  setFrozen(signature);onConfirm(signature);
 };
 const summaryList=<dl className="mold-facts mold-signing-summary">{summary.map(([key,value])=><div key={key}><dt>{key}</dt><dd><bdi dir="auto">{value}</bdi></dd></div>)}</dl>;
 const lead=<p className="mold-signing-lead">{say('يوقّع العميل على هذا الطلب قبل إرساله إلى الإنتاج:','The customer signs this request before it is sent to production:')}</p>;
 return <section className="mold-signing" ref={top} aria-label={say(...MOLD_SIGNATURE_TEXT.title)}>
  <h3 className="mold-subtitle"><PenLine size={16} aria-hidden="true"/>{say(...MOLD_SIGNATURE_TEXT.title)}</h3>
  {again&&<p className="mold-specs-note mold-signing-again" role="status">{say(...MOLD_SIGNATURE_TEXT.again)}</p>}
  {/* The pad or the link (2026-11-10): offered to the sales roles; the choice comes before the document. */}
  {onLink&&<fieldset className="mold-choice mold-signing-mode"><legend>{say('كيف سيوقّع العميل؟','How does the customer sign?')}</legend><div>
   {(['now','link'] as const).map(value=><label key={value} data-active={mode===value}><input type="radio" name="signing-mode" value={value} checked={mode===value} disabled={busy} onChange={()=>setMode(value)}/>{say(...(value==='now'?MOLD_SIGN_LINK_TEXT.now:MOLD_SIGN_LINK_TEXT.link))}</label>)}
  </div></fieldset>}
  {onLink&&mode==='link'?<>
   {lead}{summaryList}
   <p className="mold-specs-note mold-signing-link-note" role="note"><Link2 size={15} aria-hidden="true"/> {say(...MOLD_SIGN_LINK_TEXT.linkNote)}</p>
   {error&&<p className="form-error" role="alert">{t(error)}</p>}
   <div className="mold-actions">
    <button type="button" className="btn primary" disabled={busy} onClick={onLink}>{busy?<Loader2 className="spin" size={16}/>:<Link2 size={16}/>}{say(...MOLD_SIGN_LINK_TEXT.make)}</button>
    <button type="button" className="btn subtle" disabled={busy} onClick={onBack}><Undo2 size={16} aria-hidden="true"/>{say('العودة إلى الطلب','Back to the request')}</button>
   </div>
  </>:<>
  {/* The request's documents as one document (2026-11-11), its last page the signature page. */}
  <p className="mold-doc-title-line"><b>{say(...MOLD_VIEWER_TEXT.title)}</b>{title?<> — <bdi dir="auto">{title}</bdi></>:null}</p>
  <p className="mold-doc-lead">{say(...MOLD_VIEWER_TEXT.lead)}</p>
  <MoldDocumentViewer files={documents} say={say} onPlan={setPlan} signaturePage={current=><MoldSignaturePage plan={current} summary={summary} say={say} busy={busy} strokes={strokes} onStrokes={changeStrokes} onWidth={setWidth} signerError={signerError} padError={padError}
   name={<VoiceField label={say(...MOLD_SIGNATURE_TEXT.signer)} value={signer} full disabled={busy} onChange={changeSigner} inputProps={{name:'signer',dir:'auto',autoComplete:'off',maxLength:MOLD_SIGNER_MAX+20}}/>}
   clear={<button type="button" className="btn small subtle" disabled={busy||!strokes.length} onClick={()=>changeStrokes([])}><Eraser size={15} aria-hidden="true"/>{say(...MOLD_SIGNATURE_TEXT.clear)}</button>}/>}/>
  {!ready&&<p className="mold-doc-loading" role="status"><Loader2 className="spin" size={16} aria-hidden="true"/>{say(...MOLD_SIGN_PAGE_TEXT.preparing)}</p>}
  {error&&!fields.signer&&!fields.signature&&<p className="form-error" role="alert">{t(error)}</p>}
  <div className="mold-actions mold-sign-actions">
   <button type="button" className="btn primary" disabled={busy||!ready} onClick={confirm}>{busy?<Loader2 className="spin" size={16}/>:<Send size={16}/>}{say(...MOLD_SIGNATURE_TEXT.confirm)}</button>
   <button type="button" className="btn subtle" disabled={busy} onClick={onBack}><Undo2 size={16} aria-hidden="true"/>{say('العودة إلى الطلب','Back to the request')}</button>
  </div>
  </>}
 </section>;
}

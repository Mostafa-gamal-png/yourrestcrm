'use client';
// The signature page, the last page of the request's document (the owner, 2026-11-11: «وفى اخره خانة للتوقيع بحيث الموقع يكون عارف هو
// بيوقع على ايه كأنه بيوقع على ورق حقيقى»): «إقرار وتوقيع العميل», what the request is (the summary the signing screen shows), «المستندات
// في هذا الملف» with each document and its pages in the document, «ملفات مرفقة غير معروضة هنا» (named only, sent as they are), the consent
// sentence, and the signature box holding the signer's name field and the pad, with the moment in Riyadh. Drawn on the screen as a page of
// the document (MoldDocumentViewer's last sheet); on signing the browser composes the same words as a PNG of an A4 page (signaturePagePng:
// the canvas shapes the Arabic, which pdf-lib cannot), the drawing inside the box and the moment under it, which the server puts as the
// signed document's last page (moldSignaturePageCheck checks it).
import React,{useEffect,useState} from 'react';
import {PenLine} from 'lucide-react';
import {MOLD_SIGN_PAGE_TEXT,docLeftLines,docPageText,docPartLines,docTotal,signPageMoment} from '@/lib/mold-signed-document';
import {drawSignaturePage,firstStrongDir,ltrIsolate,type SignPageContent} from '@/lib/sign-page-canvas';
import type {DocPlan} from './mold-document-viewer';
import {SignaturePad,serverNow,signatureBox,type SignatureStrokes} from './mold-signature';

type Say=(ar:string,en:string)=>string;
/** Whether the page reads right to left, from its say(). */
const sayIsRtl=(say:Say)=>say('ar','en')==='ar';
/** A value's own direction (dir="auto"), and its alignment towards the label (the page's start side). */
const valueProps=(text:string,rtl:boolean)=>({dir:firstStrongDir(text,rtl?'rtl':'ltr'),style:{textAlign:rtl?'right' as const:'left' as const}});
/** The signature page on the screen, as cells (lib/sign-page-canvas.ts draws the PNG the same way): each fact a label cell and a value
 *  cell (its own direction), each document a row of kind | file name (its own direction) | pages (never wrapped, the numbers isolated).
 *  name: the signer's name field (the device's dictation field, or the link page's plain one); its error and the pad's below them. */
export function MoldSignaturePage({plan,summary,say,name,signerError,strokes,onStrokes,onWidth,busy,padError,clear}:{plan:DocPlan;summary:[string,string][];say:Say;name:React.ReactNode;signerError?:string;strokes:SignatureStrokes;onStrokes:(next:SignatureStrokes)=>void;onWidth:(width:number)=>void;busy:boolean;padError?:string;clear:React.ReactNode}){
 // The moment as the page will print it, from the server's clock, kept current while the page is open.
 const [now,setNow]=useState(()=>serverNow());
 useEffect(()=>{const timer=window.setInterval(()=>setNow(serverNow()),30_000);return()=>window.clearInterval(timer);},[]);
 const parts=docPartLines(plan.parts,say),left=docLeftLines(plan.left,say),rtl=sayIsRtl(say);
 return <section className="mold-sign-page" aria-label={say(...MOLD_SIGN_PAGE_TEXT.title)}>
  <h2 className="mold-sign-page-title">{say(...MOLD_SIGN_PAGE_TEXT.title)}</h2>
  <p className="mold-sign-page-heading">{say(...MOLD_SIGN_PAGE_TEXT.heading)}</p>
  <dl className="mold-facts mold-signing-summary mold-sign-page-facts">{summary.map(([key,value])=><div key={key}><dt>{key}</dt><dd {...valueProps(value,rtl)}>{value}</dd></div>)}</dl>
  <h3>{say(...MOLD_SIGN_PAGE_TEXT.documents)}</h3>
  {parts.length?<ul className="mold-sign-page-list">{parts.map((item,index)=><li key={index}><span className="mold-sign-page-kind">{item.label}</span><bdi className="mold-sign-page-name" {...valueProps(item.name,rtl)}>{item.name}</bdi><span className="mold-sign-page-range">{item.range}</span></li>)}</ul>:<p className="mold-sign-page-none">{say(...MOLD_SIGN_PAGE_TEXT.none)}</p>}
  {!!left.length&&<><h3>{say(...MOLD_SIGN_PAGE_TEXT.others)}</h3><ul className="mold-sign-page-list" data-kind="others">{left.map((item,index)=><li key={index}><span className="mold-sign-page-kind">{item.label}</span><bdi className="mold-sign-page-name" {...valueProps(item.name,rtl)}>{item.name}</bdi><span className="mold-sign-page-note">{item.note}</span></li>)}</ul></>}
  <p className="mold-sign-page-consent">{say(...MOLD_SIGN_PAGE_TEXT.consent)}</p>
  <div className="mold-sign-page-box" role="group" aria-label={say(...MOLD_SIGN_PAGE_TEXT.signature)}>
   <div className="mold-field mold-signer" aria-invalid={!!signerError}>{name}{signerError&&<small className="field-error">{signerError}</small>}</div>
   <div className="mold-signature-box" aria-invalid={!!padError}>
    <SignaturePad strokes={strokes} onChange={onStrokes} onWidth={onWidth} disabled={busy} say={say}/>
    <div className="mold-signature-tools"><small><PenLine size={14} aria-hidden="true"/> {say('وقّع هنا بإصبعك أو بالقلم','Sign here with a finger or a stylus')}</small>{clear}</div>
    {padError&&<small className="field-error" role="alert">{padError}</small>}
   </div>
   <p className="mold-sign-page-date">{say(...MOLD_SIGN_PAGE_TEXT.date)}: <bdi dir="ltr">{signPageMoment(now)}</bdi> ({say(...MOLD_SIGN_PAGE_TEXT.riyadh)})</p>
  </div>
 </section>;
}

/** The signature page's size in pixels: an A4 sheet 1240 pixels wide (150 dpi). moldSignaturePageCheck takes 1000..1800 wide, A4. */
export const SIGN_PAGE_WIDTH=1240,SIGN_PAGE_HEIGHT=Math.round(SIGN_PAGE_WIDTH*297/210);
const FAMILY='"Segoe UI",Tahoma,"Noto Naskh Arabic","Noto Sans Arabic","DejaVu Sans",Arial,sans-serif';
/** The signature page's words as cells (the same as the screen's). */
export function signPageContent({plan,summary,signer,at,say}:{plan:DocPlan;summary:[string,string][];signer:string;at:Date;say:Say}):SignPageContent{
 return {title:say(...MOLD_SIGN_PAGE_TEXT.title),heading:say(...MOLD_SIGN_PAGE_TEXT.heading),facts:summary.map(([key,value])=>[key+':',value]),
  documentsTitle:say(...MOLD_SIGN_PAGE_TEXT.documents),documents:docPartLines(plan.parts,say).map(line=>[line.label,line.name,line.range]),none:say(...MOLD_SIGN_PAGE_TEXT.none),
  othersTitle:say(...MOLD_SIGN_PAGE_TEXT.others),others:docLeftLines(plan.left,say).map(line=>[line.label,line.name,line.note]),consent:say(...MOLD_SIGN_PAGE_TEXT.consent),
  signerLabel:say(...MOLD_SIGN_PAGE_TEXT.signer)+':',signer,when:say(...MOLD_SIGN_PAGE_TEXT.date)+': '+ltrIsolate(signPageMoment(at))+' ('+say(...MOLD_SIGN_PAGE_TEXT.riyadh)+')',
  counter:docPageText(docTotal(plan.parts),docTotal(plan.parts),say)};
}
/**
 * The signature page as a PNG in base64 (no data: prefix): the same cells as the page on the screen (lib/sign-page-canvas.ts
 * drawSignaturePage), the box with the signer's row, the drawing scaled into it and the moment, and the page counter at the foot. rtl:
 * the page's direction (Arabic or English, as the customer read it). null when nothing was drawn or the canvas cannot make it.
 */
export function signaturePagePng({plan,summary,signer,strokes,width,at,say,rtl}:{plan:DocPlan;summary:[string,string][];signer:string;strokes:SignatureStrokes;width:number;at:Date;say:Say;rtl:boolean}):string|null{
 const box=signatureBox(strokes,width);
 if(!box.points||typeof document==='undefined')return null;
 const canvas=document.createElement('canvas');canvas.width=SIGN_PAGE_WIDTH;canvas.height=SIGN_PAGE_HEIGHT;
 const g=canvas.getContext('2d');
 if(!g)return null;
 drawSignaturePage(g,signPageContent({plan,summary,signer,at,say}),{width:SIGN_PAGE_WIDTH,height:SIGN_PAGE_HEIGHT,rtl,family:FAMILY,drawing:room=>{
  const drawScale=Math.min(room.width/Math.max(box.width,1),room.height/Math.max(box.height,1),3);
  g.save();g.translate(room.x+(room.width-box.width*drawScale)/2,room.y+(room.height-box.height*drawScale)/2);g.scale(drawScale,drawScale);g.translate(-box.minX,-box.minY);
  g.strokeStyle='#111';g.fillStyle='#111';g.lineWidth=2.6;g.lineCap='round';g.lineJoin='round';
  for(const stroke of strokes){
   if(!stroke.length)continue;
   if(stroke.length===1){g.beginPath();g.arc(stroke[0][0]*width,stroke[0][1]*width,1.3,0,Math.PI*2);g.fill();continue;}
   g.beginPath();g.moveTo(stroke[0][0]*width,stroke[0][1]*width);for(const [x,y] of stroke.slice(1))g.lineTo(x*width,y*width);g.stroke();
  }
  g.restore();
 }});
 return canvas.toDataURL('image/png').split(',')[1]||null;
}

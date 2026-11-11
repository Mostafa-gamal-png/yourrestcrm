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
import {canvasMeasure,drawBidiLine,layoutBidi,type BidiLine,type BidiSegment} from '@/lib/bidi-text';
import BidiText,{sayIsRtl} from './bidi-text';
import type {DocPlan} from './mold-document-viewer';
import {SignaturePad,serverNow,signatureBox,type SignatureStrokes} from './mold-signature';

type Say=(ar:string,en:string)=>string;
/** The signature page on the screen. name: the signer's name field (the device's dictation field, or the link page's plain one); its
 *  error and the pad's below them. */
export function MoldSignaturePage({plan,summary,say,name,signerError,strokes,onStrokes,onWidth,busy,padError,clear}:{plan:DocPlan;summary:[string,string][];say:Say;name:React.ReactNode;signerError?:string;strokes:SignatureStrokes;onStrokes:(next:SignatureStrokes)=>void;onWidth:(width:number)=>void;busy:boolean;padError?:string;clear:React.ReactNode}){
 // The moment as the page will print it, from the server's clock, kept current while the page is open.
 const [now,setNow]=useState(()=>serverNow());
 useEffect(()=>{const timer=window.setInterval(()=>setNow(serverNow()),30_000);return()=>window.clearInterval(timer);},[]);
 const parts=docPartLines(plan.parts,say),left=docLeftLines(plan.left,say),rtl=sayIsRtl(say);
 // Each line read in one order, whatever mixes Arabic and Latin in it (app/bidi-text.tsx): the same lines as the PNG (signPageLines).
 const line=(segments:BidiSegment[])=><BidiText segments={segments} rtl={rtl}/>;
 return <section className="mold-sign-page" aria-label={say(...MOLD_SIGN_PAGE_TEXT.title)}>
  <h2 className="mold-sign-page-title">{say(...MOLD_SIGN_PAGE_TEXT.title)}</h2>
  <p className="mold-sign-page-heading">{say(...MOLD_SIGN_PAGE_TEXT.heading)}</p>
  {/* Each fact one line of the page's own direction, the label and its value in one run of text (no isolate between them), so a label
      ending in Latin reads with its value as written («كود ERP: ERP-east1»), as the PNG draws it. */}
  <dl className="mold-facts mold-signing-summary mold-sign-page-facts">{summary.map(([key,value])=><div key={key}><dt>{key}</dt>{' '}<dd>{value}</dd></div>)}</dl>
  <h3>{say(...MOLD_SIGN_PAGE_TEXT.documents)}</h3>
  {parts.length?<ul className="mold-sign-page-list">{parts.map((item,index)=><li key={index}>{line(partSegments(item.label,item.name,item.range))}</li>)}</ul>:<p className="mold-sign-page-none">{say(...MOLD_SIGN_PAGE_TEXT.none)}</p>}
  {!!left.length&&<><h3>{say(...MOLD_SIGN_PAGE_TEXT.others)}</h3><ul className="mold-sign-page-list" data-kind="others">{left.map((item,index)=><li key={index}>{line(partSegments(item.label,item.name,item.note))}</li>)}</ul></>}
  <p className="mold-sign-page-consent">{say(...MOLD_SIGN_PAGE_TEXT.consent)}</p>
  <div className="mold-sign-page-box" role="group" aria-label={say(...MOLD_SIGN_PAGE_TEXT.signature)}>
   <div className="mold-field mold-signer" aria-invalid={!!signerError}>{name}{signerError&&<small className="field-error">{signerError}</small>}</div>
   <div className="mold-signature-box" aria-invalid={!!padError}>
    <SignaturePad strokes={strokes} onChange={onStrokes} onWidth={onWidth} disabled={busy} say={say}/>
    <div className="mold-signature-tools"><small><PenLine size={14} aria-hidden="true"/> {say('وقّع هنا بإصبعك أو بالقلم','Sign here with a finger or a stylus')}</small>{clear}</div>
    {padError&&<small className="field-error" role="alert">{padError}</small>}
   </div>
   <p className="mold-sign-page-date">{line(dateSegments(signPageMoment(now),say))}</p>
  </div>
 </section>;
}
/** A fact of the request: «<label>: <value>», the label bold. */
const factSegments=(key:string,value:string):BidiSegment[]=>[{text:key+':',bold:true},{text:' '+value}];
/** A document's line: «<label>: <name> — <pages or note>», the label bold. */
const partSegments=(label:string,name:string,rest:string):BidiSegment[]=>[{text:label+':',bold:true},{text:' '+name+' — '+rest}];
/** «التاريخ: <day> - <hour> (توقيت الرياض)». */
const dateSegments=(moment:string,say:Say):BidiSegment[]=>[{text:say(...MOLD_SIGN_PAGE_TEXT.date)+': '+moment+' ('+say(...MOLD_SIGN_PAGE_TEXT.riyadh)+')'}];

/** The signature page's size in pixels: an A4 sheet 1240 pixels wide (150 dpi). moldSignaturePageCheck takes 1000..1800 wide, A4. */
export const SIGN_PAGE_WIDTH=1240,SIGN_PAGE_HEIGHT=Math.round(SIGN_PAGE_WIDTH*297/210);
const FAMILY='"Segoe UI",Tahoma,"Noto Naskh Arabic","Noto Sans Arabic","DejaVu Sans",Arial,sans-serif';
/**
 * The signature page as a PNG in base64 (no data: prefix): the same words as the page on the screen (title, request, summary, the
 * documents with their pages, the files named only, the consent), then the box with «<signer label>: <name>», the drawing scaled into it
 * and «التاريخ: <day> - <hour> (توقيت الرياض)», and the page counter at the foot. rtl: the page's direction (Arabic or English, as the
 * customer read it). Smaller type when the words would not fit one page. null when nothing was drawn or the canvas cannot make it.
 */
export function signaturePagePng({plan,summary,signer,strokes,width,at,say,rtl}:{plan:DocPlan;summary:[string,string][];signer:string;strokes:SignatureStrokes;width:number;at:Date;say:Say;rtl:boolean}):string|null{
 const box=signatureBox(strokes,width);
 if(!box.points||typeof document==='undefined')return null;
 const canvas=document.createElement('canvas');canvas.width=SIGN_PAGE_WIDTH;canvas.height=SIGN_PAGE_HEIGHT;
 const g=canvas.getContext('2d');
 if(!g)return null;
 const W=SIGN_PAGE_WIDTH,H=SIGN_PAGE_HEIGHT,margin=90,inner=W-2*margin,total=docTotal(plan.parts);
 const parts=docPartLines(plan.parts,say),left=docLeftLines(plan.left,say);
 // Each block a line of segments (a bold label and its value), laid out run by run (lib/bidi-text.ts): a code, a file name, a number, a
 // date or a range is drawn whole in its own direction, and the line reads in one order whatever it mixes.
 type Block={segments:BidiSegment[];size:number;weight:string;color:string;gap:number;center?:boolean;indent?:number};
 const bullet=(segments:BidiSegment[]):BidiSegment[]=>[{text:'• '},...segments];
 const blocks=(s:number):Block[]=>[
  {segments:[{text:say(...MOLD_SIGN_PAGE_TEXT.title)}],size:44*s,weight:'bold',color:'#111',gap:10*s,center:true},
  {segments:[{text:say(...MOLD_SIGN_PAGE_TEXT.heading)}],size:26*s,weight:'normal',color:'#444',gap:28*s,center:true},
  ...summary.map(([key,value]):Block=>({segments:factSegments(key,value),size:23*s,weight:'normal',color:'#111',gap:6*s})),
  {segments:[{text:say(...MOLD_SIGN_PAGE_TEXT.documents)}],size:26*s,weight:'bold',color:'#111',gap:8*s},
  ...(parts.length?parts.map(item=>bullet(partSegments(item.label,item.name,item.range))):[bullet([{text:say(...MOLD_SIGN_PAGE_TEXT.none)}])]).map((segments):Block=>({segments,size:22*s,weight:'normal',color:'#111',gap:5*s,indent:14*s})),
  ...(left.length?[{segments:[{text:say(...MOLD_SIGN_PAGE_TEXT.others)}],size:26*s,weight:'bold',color:'#111',gap:8*s},...left.map((item):Block=>({segments:bullet(partSegments(item.label,item.name,item.note)),size:21*s,weight:'normal',color:'#333',gap:5*s,indent:14*s}))]:[]),
  {segments:[{text:say(...MOLD_SIGN_PAGE_TEXT.consent)}],size:24*s,weight:'bold',color:'#111',gap:18*s},
 ];
 // A block's fonts: its own weight, and bold for a bold segment.
 const fontsOf=(block:Block)=>block.segments.map(segment=>(segment.bold?'bold':block.weight)+' '+block.size+'px '+FAMILY);
 // The words laid out at a scale, with their lines; the box below them takes what is left (at least boxMin).
 const layout=(s:number)=>blocks(s).map((block,index)=>({block,fonts:fontsOf(block),lines:layoutBidi(block.segments,rtl,inner-(block.indent||0),canvasMeasure(g,fontsOf(block))),first:index===0}));
 const height=(laid:ReturnType<typeof layout>)=>laid.reduce((sum,item)=>sum+item.lines.length*item.block.size*1.5+item.block.gap,0);
 const top=margin,foot=70,boxMin=420;
 let scale=1,laid=layout(1);
 while(scale>0.55&&top+height(laid)+24+boxMin+foot>H){scale-=0.05;laid=layout(scale);}
 g.fillStyle='#fff';g.fillRect(0,0,W,H);
 g.textBaseline='alphabetic';
 let y=top;
 for(const item of laid){
  const {block}=item,colors=block.segments.map(()=>block.color);
  for(const line of item.lines){
   y+=block.size*1.25;
   if(block.center)drawBidiLine(g,line,{rtl,center:W/2,y,fonts:item.fonts,colors});
   else drawBidiLine(g,line,{rtl,start:rtl?W-margin-(block.indent||0):margin+(block.indent||0),y,fonts:item.fonts,colors});
   y+=block.size*0.25;
  }
  y+=block.gap;
  // A thin rule under the title, as a printed form.
  if(item.first){g.strokeStyle='#5b6b62';g.lineWidth=2;g.beginPath();g.moveTo(margin,y+2);g.lineTo(W-margin,y+2);g.stroke();}
 }
 // The signature box: the name at its top, the drawing in the middle, the moment at its foot; each line one line, smaller when long.
 const boxTop=y+24,boxBottom=H-foot,boxHeight=Math.max(260,boxBottom-boxTop),pad=26;
 g.strokeStyle='#1d2a22';g.lineWidth=3;g.strokeRect(margin,boxTop,inner,boxHeight);
 const nameLine:BidiSegment[]=[{text:say(...MOLD_SIGN_PAGE_TEXT.signer)+':',bold:true},{text:' '+signer,bold:true}],whenLine=dateSegments(signPageMoment(at),say);
 const fit=(segments:BidiSegment[],weight:string,size:number,min:number):{line:BidiLine;fonts:string[];size:number}=>{
  for(let next=size;;next-=1){
   const fonts=segments.map(segment=>(segment.bold?'bold':weight)+' '+next+'px '+FAMILY),line=layoutBidi(segments,rtl,Infinity,canvasMeasure(g,fonts))[0];
   if(line.width<=inner-2*pad||next<=min)return {line,fonts,size:next};
  }
 };
 const textX=rtl?W-margin-pad:margin+pad;
 const named=fit(nameLine,'bold',30,16),when=fit(whenLine,'normal',24,14);
 drawBidiLine(g,named.line,{rtl,start:textX,y:boxTop+pad+named.size,fonts:named.fonts,colors:['#111','#111']});
 drawBidiLine(g,when.line,{rtl,start:textX,y:boxTop+boxHeight-pad,fonts:when.fonts,colors:['#333']});
 const nameSize=named.size,whenSize=when.size;
 const roomTop=boxTop+pad+nameSize+18,roomBottom=boxTop+boxHeight-pad-whenSize-18,room={width:inner-2*pad,height:Math.max(40,roomBottom-roomTop)};
 const drawScale=Math.min(room.width/Math.max(box.width,1),room.height/Math.max(box.height,1),3);
 g.save();g.translate(margin+pad+(room.width-box.width*drawScale)/2,roomTop+(room.height-box.height*drawScale)/2);g.scale(drawScale,drawScale);g.translate(-box.minX,-box.minY);
 g.strokeStyle='#111';g.fillStyle='#111';g.lineWidth=2.6;g.lineCap='round';g.lineJoin='round';
 for(const stroke of strokes){
  if(!stroke.length)continue;
  if(stroke.length===1){g.beginPath();g.arc(stroke[0][0]*width,stroke[0][1]*width,1.3,0,Math.PI*2);g.fill();continue;}
  g.beginPath();g.moveTo(stroke[0][0]*width,stroke[0][1]*width);for(const [x,yy] of stroke.slice(1))g.lineTo(x*width,yy*width);g.stroke();
 }
 g.restore();
 // The whole document's counter, at the foot.
 const counterFont=['normal 22px '+FAMILY];
 drawBidiLine(g,layoutBidi([{text:docPageText(total,total,say)}],rtl,Infinity,canvasMeasure(g,counterFont))[0],{rtl,center:W/2,y:H-28,fonts:counterFont,colors:['#555']});
 return canvas.toDataURL('image/png').split(',')[1]||null;
}

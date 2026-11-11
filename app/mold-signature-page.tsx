'use client';
// The signature page, the last page of the request's document (the owner, 2026-11-11: «وفى اخره خانة للتوقيع بحيث الموقع يكون عارف هو
// بيوقع على ايه كأنه بيوقع على ورق حقيقى»): «إقرار وتوقيع العميل», what the request is (the summary the signing screen shows), «المستندات
// في هذا الملف» with each document and its pages in the document, «ملفات مرفقة مش معروضة هنا» (named only, sent as they are), the consent
// sentence, and the signature box holding the signer's name field and the pad, with the moment in Riyadh. Drawn on the screen as a page of
// the document (MoldDocumentViewer's last sheet); on signing the browser composes the same words as a PNG of an A4 page (signaturePagePng:
// the canvas shapes the Arabic, which pdf-lib cannot), the drawing inside the box and the moment under it, which the server puts as the
// signed document's last page (moldSignaturePageCheck checks it).
import React,{useEffect,useState} from 'react';
import {PenLine} from 'lucide-react';
import {MOLD_SIGN_PAGE_TEXT,docLeftLines,docPageText,docPartLines,docTotal,signPageMoment} from '@/lib/mold-signed-document';
import type {DocPlan} from './mold-document-viewer';
import {SignaturePad,serverNow,signatureBox,type SignatureStrokes} from './mold-signature';

type Say=(ar:string,en:string)=>string;
/** The signature page on the screen. name: the signer's name field (the device's dictation field, or the link page's plain one); its
 *  error and the pad's below them. */
export function MoldSignaturePage({plan,summary,say,name,signerError,strokes,onStrokes,onWidth,busy,padError,clear}:{plan:DocPlan;summary:[string,string][];say:Say;name:React.ReactNode;signerError?:string;strokes:SignatureStrokes;onStrokes:(next:SignatureStrokes)=>void;onWidth:(width:number)=>void;busy:boolean;padError?:string;clear:React.ReactNode}){
 // The moment as the page will print it, from the server's clock, kept current while the page is open.
 const [now,setNow]=useState(()=>serverNow());
 useEffect(()=>{const timer=window.setInterval(()=>setNow(serverNow()),30_000);return()=>window.clearInterval(timer);},[]);
 const parts=docPartLines(plan.parts,say),left=docLeftLines(plan.left,say);
 return <section className="mold-sign-page" aria-label={say(...MOLD_SIGN_PAGE_TEXT.title)}>
  <h2 className="mold-sign-page-title">{say(...MOLD_SIGN_PAGE_TEXT.title)}</h2>
  <p className="mold-sign-page-heading">{say(...MOLD_SIGN_PAGE_TEXT.heading)}</p>
  <dl className="mold-facts mold-signing-summary mold-sign-page-facts">{summary.map(([key,value])=><div key={key}><dt>{key}</dt><dd><bdi dir="auto">{value}</bdi></dd></div>)}</dl>
  <h3>{say(...MOLD_SIGN_PAGE_TEXT.documents)}</h3>
  {parts.length?<ul className="mold-sign-page-list">{parts.map((line,index)=><li key={index}><b>{line.label}:</b> <bdi>{line.name}</bdi> — <span className="mold-sign-page-range">{line.range}</span></li>)}</ul>:<p className="mold-sign-page-none">{say(...MOLD_SIGN_PAGE_TEXT.none)}</p>}
  {!!left.length&&<><h3>{say(...MOLD_SIGN_PAGE_TEXT.others)}</h3><ul className="mold-sign-page-list" data-kind="others">{left.map((line,index)=><li key={index}><b>{line.label}:</b> <bdi>{line.name}</bdi> — {line.note}</li>)}</ul></>}
  <p className="mold-sign-page-consent">{say(...MOLD_SIGN_PAGE_TEXT.consent)}</p>
  <div className="mold-sign-page-box" role="group" aria-label={say(...MOLD_SIGN_PAGE_TEXT.signature)}>
   <div className="mold-field mold-signer" aria-invalid={!!signerError}>{name}{signerError&&<small className="field-error">{signerError}</small>}</div>
   <div className="mold-signature-box" aria-invalid={!!padError}>
    <SignaturePad strokes={strokes} onChange={onStrokes} onWidth={onWidth} disabled={busy} say={say}/>
    <div className="mold-signature-tools"><small><PenLine size={14} aria-hidden="true"/> {say('وقّع هنا بصباعك أو بالقلم','Sign here with a finger or a stylus')}</small>{clear}</div>
    {padError&&<small className="field-error" role="alert">{padError}</small>}
   </div>
   <p className="mold-sign-page-date">{say(...MOLD_SIGN_PAGE_TEXT.date)}: <bdi dir="ltr">{signPageMoment(now)}</bdi> ({say(...MOLD_SIGN_PAGE_TEXT.riyadh)})</p>
  </div>
 </section>;
}

/** The signature page's size in pixels: an A4 sheet 1240 pixels wide (150 dpi). moldSignaturePageCheck takes 1000..1800 wide, A4. */
export const SIGN_PAGE_WIDTH=1240,SIGN_PAGE_HEIGHT=Math.round(SIGN_PAGE_WIDTH*297/210);
const FAMILY='"Segoe UI",Tahoma,"Noto Naskh Arabic","Noto Sans Arabic","DejaVu Sans",Arial,sans-serif';
/** A line's words broken to fit a width (a word longer than the width is cut by characters). */
function wrap(g:CanvasRenderingContext2D,text:string,max:number){
 const lines:string[]=[];let line='';
 for(const word of text.split(/\s+/).filter(Boolean)){
  const next=line?line+' '+word:word;
  if(g.measureText(next).width<=max){line=next;continue;}
  if(line)lines.push(line);
  if(g.measureText(word).width<=max){line=word;continue;}
  let piece='';
  for(const char of [...word]){if(g.measureText(piece+char).width>max&&piece){lines.push(piece);piece='';}piece+=char;}
  line=piece;
 }
 if(line)lines.push(line);
 return lines.length?lines:[''];
}
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
 // Each piece of a line its own isolate (a Latin name or code inside an Arabic line keeps its place, as on the screen).
 const iso=(text:string)=>'\u2068'+text+'\u2069';
 const parts=docPartLines(plan.parts,say).map(line=>line.label+': '+iso(line.name)+' — '+line.range),left=docLeftLines(plan.left,say).map(line=>line.label+': '+iso(line.name)+' — '+line.note);
 type Block={text:string;size:number;weight:string;color:string;gap:number;center?:boolean;indent?:number};
 const blocks=(s:number):Block[]=>[
  {text:say(...MOLD_SIGN_PAGE_TEXT.title),size:44*s,weight:'bold',color:'#111',gap:10*s,center:true},
  {text:say(...MOLD_SIGN_PAGE_TEXT.heading),size:26*s,weight:'normal',color:'#444',gap:28*s,center:true},
  ...summary.map(([key,value]):Block=>({text:iso(key)+': '+iso(value),size:23*s,weight:'normal',color:'#111',gap:6*s})),
  {text:say(...MOLD_SIGN_PAGE_TEXT.documents),size:26*s,weight:'bold',color:'#111',gap:8*s},
  ...(parts.length?parts:[say(...MOLD_SIGN_PAGE_TEXT.none)]).map((text):Block=>({text:'• '+text,size:22*s,weight:'normal',color:'#111',gap:5*s,indent:14*s})),
  ...(left.length?[{text:say(...MOLD_SIGN_PAGE_TEXT.others),size:26*s,weight:'bold',color:'#111',gap:8*s},...left.map((text):Block=>({text:'• '+text,size:21*s,weight:'normal',color:'#333',gap:5*s,indent:14*s}))]:[]),
  {text:say(...MOLD_SIGN_PAGE_TEXT.consent),size:24*s,weight:'bold',color:'#111',gap:18*s},
 ];
 // The words laid out at a scale, with their measured lines; the box below them takes what is left (at least boxMin).
 const layout=(s:number)=>blocks(s).map((block,index)=>{g.font=block.weight+' '+block.size+'px '+FAMILY;return {block,lines:wrap(g,block.text,inner-(block.indent||0)),first:index===0};});
 const height=(laid:ReturnType<typeof layout>)=>laid.reduce((sum,item)=>sum+item.lines.length*item.block.size*1.5+item.block.gap,0);
 const top=margin,foot=70,boxMin=420;
 let scale=1,laid=layout(1);
 while(scale>0.55&&top+height(laid)+24+boxMin+foot>H){scale-=0.05;laid=layout(scale);}
 g.fillStyle='#fff';g.fillRect(0,0,W,H);
 g.direction=rtl?'rtl':'ltr';g.textBaseline='alphabetic';
 let y=top;
 for(const item of laid){
  const {block}=item;
  g.font=block.weight+' '+block.size+'px '+FAMILY;g.fillStyle=block.color;
  for(const line of item.lines){
   y+=block.size*1.25;
   if(block.center){g.textAlign='center';g.fillText(line,W/2,y);}
   else{g.textAlign=rtl?'right':'left';g.fillText(line,rtl?W-margin-(block.indent||0):margin+(block.indent||0),y);}
   y+=block.size*0.25;
  }
  y+=block.gap;
  // A thin rule under the title, as a printed form.
  if(item.first){g.strokeStyle='#5b6b62';g.lineWidth=2;g.beginPath();g.moveTo(margin,y+2);g.lineTo(W-margin,y+2);g.stroke();}
 }
 // The signature box: the name at its top, the drawing in the middle, the moment at its foot.
 const boxTop=y+24,boxBottom=H-foot,boxHeight=Math.max(260,boxBottom-boxTop),pad=26;
 g.strokeStyle='#1d2a22';g.lineWidth=3;g.strokeRect(margin,boxTop,inner,boxHeight);
 const nameLine=say(...MOLD_SIGN_PAGE_TEXT.signer)+': '+iso(signer),whenLine=say(...MOLD_SIGN_PAGE_TEXT.date)+': ⁦'+signPageMoment(at)+'⁩ ('+say(...MOLD_SIGN_PAGE_TEXT.riyadh)+')';
 const fit=(text:string,weight:string,size:number,min:number)=>{let next=size;for(;next>min;next-=1){g.font=weight+' '+next+'px '+FAMILY;if(g.measureText(text).width<=inner-2*pad)break;}g.font=weight+' '+next+'px '+FAMILY;return next;};
 g.textAlign=rtl?'right':'left';const textX=rtl?W-margin-pad:margin+pad;
 g.fillStyle='#111';const nameSize=fit(nameLine,'bold',30,16);g.fillText(nameLine,textX,boxTop+pad+nameSize);
 g.fillStyle='#333';const whenSize=fit(whenLine,'normal',24,14);g.fillText(whenLine,textX,boxTop+boxHeight-pad);
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
 g.textAlign='center';g.fillStyle='#555';g.font='normal 22px '+FAMILY;g.fillText(docPageText(total,total,say),W/2,H-28);
 return canvas.toDataURL('image/png').split(',')[1]||null;
}

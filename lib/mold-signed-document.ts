// The request's documents as ONE document, signed at its end (the owner, 2026-11-11: «التوقيع يكون داخل pdf يعنى pdf يتفتح ويكون عبارة عن
// عرض السعر او po وبعدين التصميم وفى اخره خانة للتوقيع بحيث الموقع يكون عارف هو بيوقع على ايه كأنه بيوقع على ورق حقيقى»): the rules the
// signing screens (app/mold-document-viewer.tsx, app/mold-signature-page.tsx) and the server (lib/mold-signed-pdf.ts) share, pure.
// - What is in it: every PDF of the request's quotation, PO and design files that pdf-lib opens (all its pages, as they are), then every
//   PNG or JPEG picture (one A4 page each, the picture fitted inside it), in the signing's order (the quotation's, the PO's, the design's,
//   each in the order attached); then the signature page. A PDF pdf-lib cannot open (protected or damaged), a GIF or WEBP picture (pdf-lib
//   embeds PNG and JPEG only), a PNG too large to embed, and every other file (a drawing, a model, an archive) is NOT in it: named on the
//   signature page under «ملفات مرفقة غير معروضة هنا», sent to production as it is.
// - Why pdf-lib decides on both sides: the page ranges printed on the signature page must be the pages of the file the server builds. The
//   browser counts each PDF's pages with pdf-lib (the same library and version the server builds with, lazily loaded on the signing
//   screens only: lib/pdf-viewer-loader.ts loadPdfLib), and draws them with pdf.js; the server counts again while building and refuses a
//   count that differs (lib/mold-sign-server.ts makeSignedDocument).
import {moldImageSize} from '@/portable/mold-rules.mjs';
import type {MoldFileCategory} from './mold-requests';

type Say=(ar:string,en:string)=>string;
/** An A4 page in PDF points (the signature page and every picture's page). */
export const A4={width:595.28,height:841.89};
/** A picture's margin inside its page, in points. */
export const MOLD_DOC_IMAGE_MARGIN=28;
/** The most pixels a PNG may have to be put in the signed document: pdf-lib decodes a PNG to embed it (4 bytes a pixel, and copies), so a
 *  larger one is named only. A JPEG is embedded as it is. */
export const MOLD_DOC_PNG_MAX_PIXELS=20_000_000;

/** One document of the signed document, as the signing page lists it and the server builds it (moldSignedDocumentParts checks it). */
export type SignedDocPart={sha256:string;category:MoldFileCategory;kind:'pdf'|'image';name:string;pages:number};
/** Why a file of the request is not in the signed document: not a PDF nor a picture, a PDF that does not open, a picture of a format the
 *  PDF cannot hold, a picture too large, or one that could not be read on the device (not downloaded). */
export type SignedDocLeftReason='other'|'unopened'|'format'|'large'|'unread';
export type SignedDocLeft={name:string;category:MoldFileCategory;kind:'pdf'|'image'|'other';reason:SignedDocLeftReason};

/** Whether a picture (by its header: moldImageSize) can be one of the document's pages: null when it can, else why not. */
export function imageLeftReason(bytes:Uint8Array):SignedDocLeftReason|null{
 const size=moldImageSize(bytes);
 if(!size||!size.width||!size.height)return 'unopened';
 if(size.format!=='png'&&size.format!=='jpeg')return 'format';
 if(size.format==='png'&&size.width*size.height>MOLD_DOC_PNG_MAX_PIXELS)return 'large';
 return null;
}
/** A picture's page: A4 upright for an upright or square picture, on its side for a wide one; the picture fitted inside the margin and
 *  centred (shrunk or enlarged to fit, as a printed page shows it). In PDF points, y from the bottom. Also the share of the page each side takes, for the screen to draw it the same. */
export function imagePageLayout(width:number,height:number){
 const w=Math.max(1,width),h=Math.max(1,height),wide=w>h;
 const pageWidth=wide?A4.height:A4.width,pageHeight=wide?A4.width:A4.height,m=MOLD_DOC_IMAGE_MARGIN;
 const scale=Math.min((pageWidth-2*m)/w,(pageHeight-2*m)/h),drawnWidth=w*scale,drawnHeight=h*scale;
 const x=(pageWidth-drawnWidth)/2,y=(pageHeight-drawnHeight)/2;
 return {pageWidth,pageHeight,x,y,width:drawnWidth,height:drawnHeight,
  share:{left:x/pageWidth,top:(pageHeight-y-drawnHeight)/pageHeight,width:drawnWidth/pageWidth,height:drawnHeight/pageHeight}};
}

/** What the planning needs of pdf-lib (lib/pdf-viewer-loader.ts loadPdfLib on the device, the module itself on the server). */
export type PdfLibForPlan={PDFDocument:{load(bytes:Uint8Array,options?:{updateMetadata?:boolean}):Promise<{getPageCount():number;getPages():{getCropBox():{width:number;height:number};getRotation():{angle:number}}[]}>}};
/** A PDF's pages as pdf-lib counts them, or null when pdf-lib cannot open it (encrypted, damaged, or without a page). The same function on
 *  the device (pdf-lib loaded lazily) and on the server: its answer decides the page ranges. */
export async function pdfPageCount(pdfLib:PdfLibForPlan,bytes:Uint8Array):Promise<number|null>{
 return (await pdfPagePlan(pdfLib,bytes))?.pages??null;
}
/** The count and each page's shape as displayed (height / width of its crop box, turned by its /Rotate), so the screen gives each page its
 *  place before pdf.js draws it (nothing moves under the customer's finger while the pages are drawn). null as pdfPageCount. */
export async function pdfPagePlan(pdfLib:PdfLibForPlan,bytes:Uint8Array):Promise<{pages:number;aspects:number[]}|null>{
 try{
  const doc=await pdfLib.PDFDocument.load(bytes,{updateMetadata:false});
  const count=doc.getPageCount();
  if(!Number.isInteger(count)||count<1)return null;
  const aspects=doc.getPages().map(page=>{
   const box=page.getCropBox(),turned=((Math.round((page.getRotation().angle||0)/90)%4)+4)%2===1,width=Math.max(1,Math.abs(box.width)),height=Math.max(1,Math.abs(box.height));
   return turned?width/height:height/width;
  });
  return {pages:count,aspects:aspects.length===count?aspects:Array(count).fill(A4.height/A4.width)};
 }catch{return null;}
}

/** Each document's pages in the whole document (1-based, inclusive), in order. */
export function docRanges(parts:readonly Pick<SignedDocPart,'pages'>[]){
 let next=1;
 return parts.map(part=>{const first=next;next+=part.pages;return {first,last:next-1};});
}
/** The whole document's pages: every document's, and the signature page. */
export const docTotal=(parts:readonly Pick<SignedDocPart,'pages'>[])=>parts.reduce((sum,part)=>sum+part.pages,0)+1;
/** The signed document's category: the first document's (the quotation's, else the PO's, else the design's), among those in it, else among
 *  every file of the request; design when there is none. */
export function docCategory(parts:readonly {category:MoldFileCategory}[],others:readonly {category:MoldFileCategory}[]=[]):MoldFileCategory{
 const all=[...parts,...others];
 return all.some(item=>item.category==='quote')?'quote':all.some(item=>item.category==='po')?'po':'design';
}

/** The signature page's words (the screen's and the PNG's alike). */
export const MOLD_SIGN_PAGE_TEXT={
 title:['إقرار وتوقيع العميل','Customer acknowledgement and signature'] as [string,string],
 heading:['طلب تصنيع قالب','Mold manufacturing request'] as [string,string],
 documents:['المستندات في هذا الملف','The documents in this file'] as [string,string],
 none:['لا توجد مستندات معروضة في هذا الملف.','No document is shown in this file.'] as [string,string],
 others:['ملفات مرفقة غير معروضة هنا','Attached files not shown here'] as [string,string],
 consent:['أقر بأني اطلعت على عرض السعر والتصميم الموضحين في الصفحات السابقة وأوافق عليهم.','I confirm that I have reviewed the quotation and the design shown on the previous pages and that I agree to them.'] as [string,string],
 signer:['اسم الموقّع عن العميل','Name of the person signing for the customer'] as [string,string],
 signature:['توقيع العميل','Customer signature'] as [string,string],
 date:['التاريخ','Date'] as [string,string],riyadh:['توقيت الرياض','Riyadh time'] as [string,string],
 picture:['صورة','Picture'] as [string,string],
 preparing:['جاري تجهيز صفحة التوقيع…','Preparing the signature page…'] as [string,string],
};
const LABELS:Record<MoldFileCategory,[string,string]>={quote:['عرض السعر','Quotation'],po:['PO','PO'],design:['التصميم','Design']};
/** «صفحة 3» or «صفحات 3–5» (the range kept left to right inside the Arabic line: an isolate, so «3–5» never reads «5–3»). */
export const docRangeText=(range:{first:number;last:number},say:Say)=>range.first===range.last?say('صفحة '+range.first,'page '+range.first):say('صفحات \u2066'+range.first+'–'+range.last+'\u2069','pages '+range.first+'–'+range.last);
/** Each document's line on the signature page: «عرض السعر: Q-77.pdf — صفحات 1–2», «صورة: رسم.png — صفحة 6». */
export function docPartLines(parts:readonly SignedDocPart[],say:Say){
 const ranges=docRanges(parts);
 return parts.map((part,index)=>({label:say(...(part.kind==='image'?MOLD_SIGN_PAGE_TEXT.picture:LABELS[part.category])),name:part.name,range:docRangeText(ranges[index],say)}));
}
/** Why a file is named only, in the customer's words. */
export function docLeftText(item:SignedDocLeft,say:Say){
 const why=item.reason==='unopened'?say('تعذّر فتحه','could not be opened'):item.reason==='format'?say('صيغة صورة لا يقبلها الملف','a picture format the file cannot hold')
  :item.reason==='large'?say('صورة أكبر مما يتسع له الملف','a picture too large for the file'):item.reason==='unread'?say('تعذّر تحميله','could not be loaded'):'';
 return (why?why+' — ':'')+say('يُرسل إلى الإنتاج كما هو','it goes to production as it is');
}
/** Each named-only file's line: «التصميم: رسم.dwg — يُرسل إلى الإنتاج كما هو». */
export const docLeftLines=(left:readonly SignedDocLeft[],say:Say)=>left.map(item=>({label:say(...LABELS[item.category]),name:item.name,note:docLeftText(item,say)}));
/** The moment as the signature page prints it: day/month/year and the hour in Riyadh. */
export const signPageMoment=(at:Date)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at).replace(',',' -');
/** The page counter of the whole document. */
export const docPageText=(page:number,total:number|null,say:Say)=>total?say('صفحة '+page+' من '+total,'Page '+page+' of '+total):say('صفحة '+page,'Page '+page);

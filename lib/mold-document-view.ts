// The documents the customer reads on the signing screens (the owner, 2026-11-10: «ملف pdf يظهر على الشاشة فيه عرض السعر او po + التصميم
// وخانة فى الاخر العميل بيوقع داخلها»): the rules of the viewer (app/mold-document-viewer.tsx), pure so they are tested without a browser.
// - Which files: the request's own quotation, PO and design files (not the customer's signature, not a signed copy, not one deleted or
//   refused for good), the quotation's first, then the PO's, then the design's, each in the order it was attached.
// - How large a page is drawn: the viewer's width × the screen's density (at most 2), twice that when «تكبير» is pressed, and never more
//   than MOLD_VIEWER_MAX_PIXELS pixels nor MOLD_VIEWER_MAX_SIDE a side (a phone's memory: a page is a canvas of width × height × 4 bytes).
import type {MoldDesignFileView,MoldDesignKind,MoldFileCategory} from './mold-requests';

type Say=(ar:string,en:string)=>string;
/** One document of the viewer: the bytes from a local file (the representative's form, before the upload) or from an address (an uploaded
 *  file through the CRM, or the signing link's file route); link: where the screen lets it be opened or downloaded as it is (none for a
 *  local file, nor for a file the link does not serve). */
export type MoldViewerFile={key:string;name:string;category:MoldFileCategory;kind:MoldDesignKind;file?:Blob;href?:string;link?:string};

/** The quotation first, then the PO, then the design; each category in the order given (the order the files were attached). */
export const MOLD_VIEWER_ORDER:Record<MoldFileCategory,number>={quote:0,po:1,design:2};
export function orderViewerFiles<T extends {category:MoldFileCategory}>(files:readonly T[]):T[]{
 return files.map((file,index)=>({file,index})).sort((a,b)=>MOLD_VIEWER_ORDER[a.file.category]-MOLD_VIEWER_ORDER[b.file.category]||a.index-b.index).map(entry=>entry.file);
}

/** The request's uploaded files the customer reads on the device (the sheet's «يوقّع دلوقتي», or the edit of a request): the CRM's own
 *  quotation, PO and design files that will reach production, not the signature, not a signed copy (the files the server stamps). */
export function viewerFilesFromRequest(files:readonly MoldDesignFileView[]):MoldViewerFile[]{
 return orderViewerFiles(files.filter(file=>file.source==='crm'&&!file.signature&&!file.signedCopy&&!['rejected','locked','deleting'].includes(file.state))
  .map(file=>({key:'crm:'+file.key,name:file.name,category:file.category,kind:file.kind,...(file.kind==='other'?{}:{href:file.href}),link:file.href+(file.viewable?'&inline=1':'')})));
}

/** Each document's heading: «عرض السعر: <name>», «PO: <name>», «التصميم: <name>» (the label; the name is shown beside it as typed). */
export const MOLD_VIEWER_LABELS:Record<MoldFileCategory,[string,string]>={quote:['عرض السعر','Quotation'],po:['PO','PO'],design:['التصميم','Design']};
export const viewerLabel=(category:MoldFileCategory,say:Say)=>say(...MOLD_VIEWER_LABELS[category]);
export const viewerPageText=(page:number,pages:number,say:Say)=>say('صفحة '+page+' من '+pages,'Page '+page+' of '+pages);
export const MOLD_VIEWER_TEXT={
 lead:['راجع عرض السعر والـ PO والتصميم تحت، والتوقيع في آخرهم.','Review the quotation, the PO and the design below; the signature is at their end.'] as [string,string],
 failed:['ما قدرناش نعرض الملف ده','We could not show this file'] as [string,string],
 failedNote:['التوقيع ممكن برضه؛ الملف هيتبعت للإنتاج زي ما هو.','You can still sign; the file goes to production as it is.'] as [string,string],
 pageFailed:['ما قدرناش نعرض الصفحة دي','We could not show this page'] as [string,string],
 loading:['جاري تحميل الملف…','Loading the file…'] as [string,string],
 pageLoading:['جاري عرض الصفحة…','Drawing the page…'] as [string,string],
 zoomIn:['تكبير','Zoom in'] as [string,string],zoomOut:['تصغير','Zoom out'] as [string,string],
 open:['فتح','Open'] as [string,string],download:['تنزيل','Download'] as [string,string],
 none:['مفيش ملفات في الطلب.','The request has no files.'] as [string,string],
 documents:['ملفات الطلب','The request\'s files'] as [string,string],
};
/** A file that is neither a PDF nor a picture (a drawing, a model, an archive): named, never drawn. */
export const viewerOtherText=(name:string,say:Say)=>say('ملف '+name+' (مش PDF) — هيتبعت للإنتاج زي ما هو','File '+name+' (not a PDF) — it goes to production as it is');
export const viewerPagesText=(pages:number,say:Say)=>say(pages===1?'صفحة واحدة':pages===2?'صفحتين':pages+(pages<=10?' صفحات':' صفحة'),pages===1?'1 page':pages+' pages');

/** The most pixels a drawn page holds (24 MB of a phone's memory) and the longest side (beyond it some phones draw nothing). */
export const MOLD_VIEWER_MAX_PIXELS=6_000_000,MOLD_VIEWER_MAX_SIDE=4096,MOLD_VIEWER_MAX_DENSITY=2;
/** How a page is drawn at a width on the screen: the scale handed to pdf.js and the canvas's pixels. cssWidth: the page's width on the
 *  screen in CSS pixels (the viewer's width, × 2 zoomed); pageWidth/pageHeight: the page at scale 1 (PDF points, rotation applied). */
export function viewerRenderSize({cssWidth,pageWidth,pageHeight,density}:{cssWidth:number;pageWidth:number;pageHeight:number;density:number}){
 const width=Math.max(1,pageWidth),height=Math.max(1,pageHeight),dpr=Math.min(MOLD_VIEWER_MAX_DENSITY,Math.max(1,Number.isFinite(density)?density:1));
 let scale=Math.max(1,cssWidth)*dpr/width;
 scale=Math.min(scale,MOLD_VIEWER_MAX_SIDE/width,MOLD_VIEWER_MAX_SIDE/height,Math.sqrt(MOLD_VIEWER_MAX_PIXELS/(width*height)));
 // Whole pixels, never over the caps (the tiny epsilon keeps 671.9999… a 672).
 const pixelWidth=Math.max(1,Math.floor(width*scale+1e-6)),pixelHeight=Math.max(1,Math.floor(height*scale+1e-6));
 return {scale,pixelWidth,pixelHeight,cssHeight:Math.max(1,cssWidth)*height/width};
}
/** How far beyond the screen a page is drawn ahead (the next pages are ready when scrolled to), and how far before its canvas is given
 *  back (a long PDF holds a few drawn pages at a time). */
export const MOLD_VIEWER_NEAR_PX=900,MOLD_VIEWER_KEEP_PX=2400;

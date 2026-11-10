// The customer's signature inside a mold request's PDFs (the owner, 2026-11-10: «عايز توقيع العميل فى طلبات القوالب داخل pdf التصميم او
// عرض السعر او po»): a signed copy is the original PDF with one block stamped at the bottom of its LAST page, as that page is displayed
// (its /Rotate and its crop box taken into account), on the left, at about 37% of the page's width. The block is a PNG composed by the
// signing browser (the drawing, «توقيع العميل: <name>» and the moment in Riyadh: the browser's canvas shapes the Arabic, which pdf-lib
// cannot), checked by the server (moldSignatureBlockCheck) and drawn here as an image, so no font is embedded and no text is laid out
// on the server. The original is never changed: the copy is a new file. A PDF pdf-lib cannot open (encrypted: protected; anything else,
// or one without pages: damaged) gets no copy; the caller says so on the request. Server only (pdf-lib, MIT, pure JavaScript).
import {EncryptedPDFError,PDFContentStream,PDFDocument,degrees,popGraphicsState,pushGraphicsState} from 'pdf-lib';

/** A page's visible box (its crop box, else its media box) in user space, and how it is turned when displayed (/Rotate, clockwise). */
export type PageBox={x:number;y:number;width:number;height:number;rotation:number};
/** Where the block goes on the page, in user space: its lower-left anchor, its size as displayed, and the counter-clockwise rotation that
 *  makes it upright on the displayed page (pdf-lib's drawImage rotates about the anchor). */
export type BlockPlacement={x:number;y:number;width:number;height:number;rotate:number};
/** The block's share of the displayed page's width, its cap on the displayed height, and its margin from the edges. */
export const BLOCK_WIDTH_SHARE=0.37,BLOCK_HEIGHT_SHARE=0.3;
const margin=(width:number,height:number)=>Math.max(6,Math.min(24,0.03*Math.min(width,height)));
/** The rotation as one of 0, 90, 180, 270 (a /Rotate that is not a multiple of 90 is read as the nearest; negatives turned positive). */
export const normalRotation=(angle:number)=>((Math.round((Number.isFinite(angle)?angle:0)/90)*90)%360+360)%360;

/**
 * Where the block goes: at the bottom-left of the page as displayed, a margin from both edges, BLOCK_WIDTH_SHARE of the displayed width
 * (smaller when it would take more than BLOCK_HEIGHT_SHARE of the displayed height), upright when the page is displayed. A page rotated by
 * 90° shows its user-space right edge at the bottom, 180° its top, 270° its left: the anchor and the image's rotation follow.
 */
export function blockPlacement(box:PageBox,block:{width:number;height:number}):BlockPlacement{
 const rotation=normalRotation(box.rotation),sideways=rotation===90||rotation===270;
 const shownWidth=sideways?box.height:box.width,shownHeight=sideways?box.width:box.height,m=margin(shownWidth,shownHeight);
 let width=BLOCK_WIDTH_SHARE*shownWidth,height=width*block.height/block.width;
 if(height>BLOCK_HEIGHT_SHARE*shownHeight){height=BLOCK_HEIGHT_SHARE*shownHeight;width=height*block.width/block.height;}
 // The displayed point (left edge + m, bottom edge - m) in user space, for each rotation (the page turned clockwise when displayed).
 const {x,y,width:w,height:h}=box;
 if(rotation===90)return {x:x+w-m,y:y+m,width,height,rotate:90};
 if(rotation===180)return {x:x+w-m,y:y+h-m,width,height,rotate:180};
 if(rotation===270)return {x:x+m,y:y+h-m,width,height,rotate:270};
 return {x:x+m,y:y+m,width,height,rotate:0};
}

export type StampResult={ok:true;bytes:Uint8Array;placement:BlockPlacement;pages:number}|{ok:false;reason:'protected'|'damaged'};
/**
 * The original PDF with the block stamped on its last page. The page's existing content is wrapped in a saved and restored graphics state
 * first, so a transformation it leaves behind cannot move the block. The document's own metadata is kept as it was. protected: the PDF is
 * encrypted; damaged: pdf-lib cannot read it, it has no page, or the block cannot be embedded.
 */
export async function stampSignaturePdf(original:Uint8Array,block:Uint8Array):Promise<StampResult>{
 let doc:PDFDocument;
 try{doc=await PDFDocument.load(original,{updateMetadata:false});}
 // pdf-lib's errors are compiled to ES5 (instanceof does not hold for them): its encryption refusal is also known by its message.
 catch(error){return {ok:false,reason:error instanceof EncryptedPDFError||/\bis encrypted\b/i.test(String((error as Error)?.message??''))?'protected':'damaged'};}
 try{
  const pages=doc.getPages(),page=pages[pages.length-1];
  if(!page)return {ok:false,reason:'damaged'};
  const image=await doc.embedPng(block);
  const placement=blockPlacement({...page.getCropBox(),rotation:page.getRotation().angle},{width:image.width,height:image.height});
  const context=doc.context,stream=(operator:ReturnType<typeof pushGraphicsState>)=>context.register(PDFContentStream.of(context.obj({}),[operator]));
  page.node.normalize();
  page.node.wrapContentStreams(stream(pushGraphicsState()),stream(popGraphicsState()));
  page.drawImage(image,{x:placement.x,y:placement.y,width:placement.width,height:placement.height,rotate:degrees(placement.rotate)});
  return {ok:true,bytes:await doc.save(),placement,pages:pages.length};
 }catch{return {ok:false,reason:'damaged'};}
}

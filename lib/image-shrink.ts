// A photo is shrunk on the device before it is uploaded (the mold photos, 2026-11-19: the hosting disk filled up that day): its longest
// side to 1600 pixels at most, as a JPEG of quality 0.8, lowered step by step (and then the size) until it is 400 KB or less. Drawing it
// again also drops what the camera wrote inside the file (the place it was taken among it). The server still checks the bytes and the
// size (lib/mold-photos.ts). The arithmetic is pure and tested without a browser (tests/mold-photos.mjs).

export const SHRINK_LONG_SIDE=1600;
export const SHRINK_QUALITY=0.8;
export const SHRINK_TARGET_BYTES=400*1024;
/** The qualities tried at each size, in order. */
const QUALITIES=[SHRINK_QUALITY,0.7,0.6];
/** Each further try draws the photo this much smaller, down to SHRINK_MIN_SIDE on its longest side. */
const STEP_DOWN=0.8,SHRINK_MIN_SIDE=800;

/** The size to draw: the longest side at most longSide, the proportions kept, never enlarged, whole pixels, at least one. */
export function shrinkSize(width:number,height:number,longSide=SHRINK_LONG_SIDE){
 if(!(width>0)||!(height>0))throw new Error('Invalid image size');
 const scale=Math.min(1,longSide/Math.max(width,height));
 return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
/** Every try in order: the qualities at 1600 pixels, then at smaller sizes, until the longest side would be under SHRINK_MIN_SIDE (a photo
 *  already smaller is tried at its own size only). */
export function shrinkSteps(width:number,height:number){
 const steps:{width:number;height:number;quality:number}[]=[];
 let size=shrinkSize(width,height);
 for(;;){
  for(const quality of QUALITIES)steps.push({...size,quality});
  const longSide=Math.floor(Math.max(size.width,size.height)*STEP_DOWN);
  if(longSide<SHRINK_MIN_SIDE)break;
  size=shrinkSize(size.width,size.height,longSide);
 }
 return steps;
}

export class ShrinkError extends Error{constructor(public reason:'unreadable'|'too_large'){super(reason);this.name='ShrinkError';}}

type Decoded={source:CanvasImageSource;width:number;height:number;close():void};
async function decode(file:Blob):Promise<Decoded>{
 if(typeof createImageBitmap==='function'){
  try{const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});return {source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close()};}
  catch{/* an older engine: the image element below */}
 }
 const url=URL.createObjectURL(file),image=new Image();
 try{image.decoding='async';image.src=url;await image.decode();}
 catch{URL.revokeObjectURL(url);throw new ShrinkError('unreadable');}
 return {source:image,width:image.naturalWidth,height:image.naturalHeight,close:()=>URL.revokeObjectURL(url)};
}
const toBlob=(canvas:HTMLCanvasElement,quality:number)=>new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));

/** The photo as it is uploaded: a JPEG, its longest side at most 1600 pixels, 400 KB or less when a try reaches it, else the smallest try
 *  (refused when even that is over maxBytes). A file the device cannot read as an image is refused (ShrinkError 'unreadable'). */
export async function shrinkPhoto(file:Blob,{maxBytes=2*1024*1024,targetBytes=SHRINK_TARGET_BYTES}:{maxBytes?:number;targetBytes?:number}={}):Promise<{blob:Blob;width:number;height:number}>{
 let decoded:Decoded;
 try{decoded=await decode(file);}catch{throw new ShrinkError('unreadable');}
 try{
  if(!(decoded.width>0)||!(decoded.height>0))throw new ShrinkError('unreadable');
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
  if(!context)throw new ShrinkError('unreadable');
  let best:{blob:Blob;width:number;height:number}|null=null,drawn='';
  for(const step of shrinkSteps(decoded.width,decoded.height)){
   if(drawn!==step.width+'x'+step.height){
    canvas.width=step.width;canvas.height=step.height;
    // A transparent PNG becomes a JPEG on white, not on black.
    context.fillStyle='#ffffff';context.fillRect(0,0,step.width,step.height);
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.drawImage(decoded.source,0,0,step.width,step.height);
    drawn=step.width+'x'+step.height;
   }
   const blob=await toBlob(canvas,step.quality);
   if(!blob)throw new ShrinkError('unreadable');
   if(!best||blob.size<best.blob.size)best={blob,width:step.width,height:step.height};
   if(blob.size<=targetBytes)break;
  }
  canvas.width=canvas.height=0;
  if(!best)throw new ShrinkError('unreadable');
  if(best.blob.size>maxBytes)throw new ShrinkError('too_large');
  return best;
 }finally{decoded.close();}
}

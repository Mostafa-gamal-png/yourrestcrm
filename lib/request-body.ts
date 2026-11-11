/** Bound bytes before JSON/multipart parsing, including chunked requests. */
export class RequestBodyError extends Error {
 constructor(message:string,public status:number){super(message);}
}

// Existing form limits are in UTF-16 characters. Three UTF-8 bytes per code
// unit preserves Arabic inputs while placing a real bound on buffered bytes.
// /api/mold-requests: 16 000 for the request itself, plus the customer's signature (2026-11-04), a PNG of at most 256 KiB carried as
// base64 (MOLD_SIGNATURE_BASE64_MAX in portable/mold-rules.mjs, 349 528 characters): 380 000; since 2026-11-10 also the block stamped in the
// PDFs, a PNG of at most 384 KiB as base64 (MOLD_SIGNATURE_BLOCK_BASE64_MAX, 524 288 characters), and the SHA-256 of at most 20 PDFs seen
// (1 400): 910 000. /api/mold-sign (the customer signing from the link, 2026-11-10): the same signature and block, the token, the page's
// key and the name: 880 000. Since 2026-11-11 both also carry the signature page, a PNG of at most 1 MiB as base64
// (MOLD_SIGNATURE_PAGE_BASE64_MAX, 1 398 104 characters), and the documents it lists (20 at most, about 600 bytes each): 2 330 000 and
// 2 300 000.
// /api/trash (a restoration, 2026-11-09): an entry's id and a request id, under 300 bytes: 2 000.
// /api/reviews: the supervisor's «النتيجة» and «الإجراء المطلوب», 2 000 characters each (lib/supervisor-reviews.ts), 3 bytes a character
// plus the keys: 14 000. /api/review-inbox: «قرأت الكل» on at most 50 notes of kind, id (200) and version: 16 000.
const jsonLimits:Record<string,number>={
 '/api/crm':450_000,'/api/visits':270_000,'/api/followups':240_000,
 '/api/customer-followups':60_000,'/api/customer-service':54_000,'/api/support':24_000,'/api/complaints':32_000,'/api/mold-requests':2_330_000,'/api/mold-sign':2_300_000,'/api/mold-requests/design-files/delete':2_000,'/api/trash':2_000,'/api/service-kpi':32_000,
 '/api/journeys':90_000,'/api/mobile-route':120_000,'/api/targets':90_000,
 '/api/kpis':60_000,'/api/reviews':14_000,'/api/review-inbox':16_000,'/api/sales':300_000,'/api/sales/import':7_500_000,
 '/api/customers/import':1_200_000,'/api/machines/import':3_000,'/api/erp-customers':2_000_000,
};
export function jsonRequestLimit(request:Request){
 return jsonLimits[new URL(request.url).pathname.replace(/\/$/,'')]??450_000;
}
// File uploads: 11 MB and 120 seconds by default (visit files, 10 MB). A mold design file is up to 25 MiB (MOLD_DESIGN_MAX_BYTES in
// portable/mold-rules.mjs) plus its form fields, and may take five minutes from a phone on a slow line.
const formLimits:Record<string,{bytes:number;ms:number}>={'/api/mold-requests/design-files':{bytes:25*1024*1024+64*1024,ms:300_000}};
const formLimit=(request:Request)=>formLimits[new URL(request.url).pathname.replace(/\/$/,'')]??{bytes:11*1024*1024,ms:120_000};
export const formRequestLimit=(request:Request)=>formLimit(request).bytes;

export async function readRequestBytes(request:Request,maxBytes:number,timeoutMs=30_000):Promise<Uint8Array<ArrayBuffer>>{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('Invalid request byte limit');
 const encoding=request.headers.get('content-encoding');
 if(encoding&&encoding.trim().toLowerCase()!=='identity')throw new RequestBodyError('ترميز الطلب غير مدعوم.',415);
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))))throw new RequestBodyError('حجم الطلب غير صحيح.',400);
 if(declared!==null&&Number(declared)>maxBytes){
  void request.body?.cancel().catch(()=>{});
  throw new RequestBodyError('حجم الطلب أكبر من الحد المسموح.',413);
 }
 const reader=request.body?.getReader();
 if(!reader)return new Uint8Array(0);
 let bytes=new Uint8Array(Math.min(maxBytes,16_384)),total=0,timer:ReturnType<typeof setTimeout>|undefined;
 let timedOut=false;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
  timedOut=true;void reader.cancel().catch(()=>{});
  reject(new RequestBodyError('انتهت مهلة رفع البيانات. أعد المحاولة.',408));
 },timeoutMs);});
 const consume=async()=>{
  for(;;){
   const {value,done}=await reader.read();
   if(timedOut)throw new RequestBodyError('انتهت مهلة رفع البيانات. أعد المحاولة.',408);
   if(done)break;
   const nextTotal=total+value.byteLength;
   if(nextTotal>maxBytes){void reader.cancel().catch(()=>{});throw new RequestBodyError('حجم الطلب أكبر من الحد المسموح.',413);}
   if(nextTotal>bytes.byteLength){const grown=new Uint8Array(Math.min(maxBytes,Math.max(nextTotal,bytes.byteLength*2)));grown.set(bytes.subarray(0,total));bytes=grown;}
   bytes.set(value,total);total=nextTotal;
  }
  return bytes.slice(0,total);
 };
 try{
  // One timeout race per request: a race per chunk retains an unbounded
  // number of reactions when a sender deliberately fragments the body.
  return await Promise.race([consume(),deadline]);
 }catch(error){
  void reader.cancel().catch(()=>{});
  if(error instanceof RequestBodyError)throw error;
  throw new RequestBodyError('تعذر قراءة البيانات المرسلة. أعد المحاولة.',400);
 }finally{if(timer!==undefined)clearTimeout(timer);reader.releaseLock();}
}

export async function readRequestText(request:Request,maxBytes=jsonRequestLimit(request)){
 const bytes=await readRequestBytes(request,maxBytes);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{throw new RequestBodyError('ترميز البيانات غير صحيح.',400);}
}

export async function readRequestForm(request:Request,maxBytes=formRequestLimit(request),timeoutMs=formLimit(request).ms){
 const contentType=request.headers.get('content-type')||'';
 if(!/^multipart\/form-data\s*;/i.test(contentType))throw new RequestBodyError('صيغة رفع الملف غير صحيحة.',415);
 const bytes=await readRequestBytes(request,maxBytes,timeoutMs);
 try{return await new Response(bytes,{headers:{'Content-Type':contentType}}).formData();}
 catch{throw new RequestBodyError('تعذر قراءة الملف المرفوع.',400);}
}

/** Bound bytes before JSON/multipart parsing, including chunked requests. */
export class RequestBodyError extends Error {
 constructor(message:string,public status:number){super(message);}
}

// Existing form limits are in UTF-16 characters. Three UTF-8 bytes per code
// unit preserves Arabic inputs while placing a real bound on buffered bytes.
const jsonLimits:Record<string,number>={
 '/api/crm':450_000,'/api/visits':270_000,'/api/followups':240_000,
 '/api/customer-followups':60_000,'/api/customer-service':54_000,'/api/support':24_000,'/api/complaints':32_000,'/api/service-kpi':32_000,
 '/api/journeys':90_000,'/api/mobile-route':120_000,'/api/targets':90_000,
 '/api/kpis':60_000,'/api/sales':300_000,'/api/sales/import':7_500_000,
 '/api/customers/import':1_200_000,'/api/machines/import':3_000,
};
export function jsonRequestLimit(request:Request){
 return jsonLimits[new URL(request.url).pathname.replace(/\/$/,'')]??450_000;
}

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

export async function readRequestForm(request:Request,maxBytes=11*1024*1024){
 const contentType=request.headers.get('content-type')||'';
 if(!/^multipart\/form-data\s*;/i.test(contentType))throw new RequestBodyError('صيغة رفع الملف غير صحيحة.',415);
 const bytes=await readRequestBytes(request,maxBytes,120_000);
 try{return await new Response(bytes,{headers:{'Content-Type':contentType}}).formData();}
 catch{throw new RequestBodyError('تعذر قراءة الملف المرفوع.',400);}
}

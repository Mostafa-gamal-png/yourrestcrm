export type UploadProgress={phase:'uploading'|'processing';loaded:number;total:number|null;percent:number|null};
type SubmitOptions={language?:string;timeout?:number;onUploadProgress?:(progress:UploadProgress)=>void};
export class SubmitError extends Error{
 constructor(message:string,public status:number=0,public body:Record<string,unknown>|null=null){super(message);this.name='SubmitError';}
}
export const isJsonObject=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
/** Only a canonical API rejection proves that the submitted write was rejected. */
export function definiteSubmitRejection(error:unknown){
 return error instanceof SubmitError&&error.status>=400&&error.status<500&&typeof error.body?.error==='string'&&!!error.body.error.trim()&&!(error.status===409&&/تم حفظ.*بالفعل|العملية محفوظة/.test(error.body.error));
}
/** Bounded form requests keep ambiguous saves retryable with their original request key. */
export async function submitJson<T=Record<string,unknown>>(url:string,init:RequestInit,{language='ar',timeout=30000,onUploadProgress}:SubmitOptions={}):Promise<T>{
 const say=(ar:string,en:string)=>language==='en'?en:ar,controller=new AbortController();
 const canceled=()=>{const error=new Error('Request canceled');error.name='AbortError';return error;};
 let rejectBoundary:(error:Error)=>void=()=>{};
 const boundary=new Promise<never>((_,reject)=>{rejectBoundary=reject;});
 const cancel=()=>{controller.abort();rejectBoundary(canceled());};
 init.signal?.addEventListener('abort',cancel,{once:true});
 if(init.signal?.aborted){init.signal.removeEventListener('abort',cancel);throw canceled();}
 const timer=setTimeout(()=>{controller.abort();rejectBoundary(new SubmitError(say('انتهت مهلة الاتصال. البيانات موجودة في النموذج؛ أعد المحاولة بنفس البيانات للتأكد من الحفظ.','The request timed out. Your entries remain in the form; retry with the same entries to confirm the save.')));},timeout);
 const request=async()=>{
  try{
  const response=await (onUploadProgress&&typeof XMLHttpRequest!=='undefined'?uploadResponse(url,init,controller.signal,onUploadProgress):fetch(url,{...init,signal:controller.signal}));
  if(response.redirected&&response.url&&new URL(response.url,typeof window!=='undefined'?window.location?.origin:'https://crm.yourrest.org').pathname.startsWith('/login'))throw new SubmitError(say('انتهت جلسة الدخول. سجّل الدخول مرة أخرى ثم أعد المحاولة.','Your session ended. Sign in again and retry.'),401);
  let result:unknown;try{result=await response.json();}catch{
   if(response.status===401||response.status===403)throw new SubmitError(say('تعذر تأكيد جلسة الدخول أو الصلاحية. سجّل الدخول مرة أخرى ثم أعد المحاولة.','Your session or permission could not be confirmed. Sign in again and retry.'),response.status);
   throw new SubmitError(say('الخادم لم يرجع نتيجة صالحة. احتفظ بالبيانات وأعد المحاولة بعد التأكد من الاتصال.','The server returned an invalid response. Keep your entries and retry after checking connectivity.'),response.status);
  }
  const fields=isJsonObject(result)?result:null;
  if(!response.ok){const message=typeof fields?.error==='string'&&fields.error.trim()?fields.error:say('تعذر حفظ البيانات. أعد المحاولة.','The record could not be saved. Retry.');throw new SubmitError(message,response.status,fields);}
  if(!fields||fields.ok===false)throw new SubmitError(say('الخادم لم يؤكد الحفظ. احتفظ بالبيانات وأعد المحاولة.','The server did not confirm the save. Keep your entries and retry.'),response.status);
   return result as T;
 }catch(error){
  if(init.signal?.aborted)throw canceled();
  if(error instanceof TypeError)throw new SubmitError(say('تعذر الاتصال بالخادم. تأكد من الإنترنت ثم أعد المحاولة؛ البيانات ما زالت في النموذج.','The server could not be reached. Check your connection and retry; your entries remain in the form.'));
  throw error;
  }
 };
 try{return await Promise.race([boundary,request()]);}finally{clearTimeout(timer);init.signal?.removeEventListener('abort',cancel);}
}

/** Transport progress is separate from server processing and confirmed receipts. */
function uploadResponse(url:string,init:RequestInit,signal:AbortSignal,onProgress:(progress:UploadProgress)=>void):Promise<Pick<Response,'ok'|'status'|'url'|'redirected'|'json'>>{
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();let settled=false,loaded=0,total:number|null=null;
  const cleanup=()=>signal.removeEventListener('abort',cancel);
  const finish=(callback:()=>void)=>{if(settled)return;settled=true;cleanup();callback();};
  const cancel=()=>{finish(()=>{const error=new Error('Request canceled');error.name='AbortError';reject(error);});xhr.abort();};
  const processing=()=>{if(!settled)onProgress({phase:'processing',loaded,total,percent:null});};
  if(signal.aborted){cancel();return;}
  xhr.open(init.method||'POST',url,true);xhr.withCredentials=init.credentials==='include';
  new Headers(init.headers).forEach((value,key)=>xhr.setRequestHeader(key,value));
  xhr.upload.onprogress=event=>{if(settled)return;loaded=Math.max(0,event.loaded);total=event.lengthComputable&&event.total>0?event.total:null;onProgress({phase:'uploading',loaded,total,percent:total===null?null:Math.min(100,Math.max(0,loaded/total*100))});};
  xhr.upload.onload=processing;
  xhr.onerror=()=>finish(()=>reject(new TypeError('Failed to fetch')));
  xhr.onabort=()=>finish(()=>{const error=new Error('Request canceled');error.name='AbortError';reject(error);});
  xhr.onload=()=>{processing();finish(()=>resolve({ok:xhr.status>=200&&xhr.status<300,status:xhr.status,url:xhr.responseURL,redirected:!!xhr.responseURL&&new URL(xhr.responseURL,window.location.origin).pathname!==new URL(url,window.location.origin).pathname,json:async()=>JSON.parse(xhr.responseText)}));};
  signal.addEventListener('abort',cancel,{once:true});onProgress({phase:'uploading',loaded:0,total:null,percent:null});
  try{xhr.send((init.body||null) as XMLHttpRequestBodyInit|null);}catch(error){finish(()=>reject(error));}
 });
}

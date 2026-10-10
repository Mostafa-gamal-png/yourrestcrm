/** User-initiated dictation only. Native recognition is independent of GPS enrollment. */
import {isNativeTrackingApp,nativeTrackingGeneration,waitForNativeBridge} from './native-tracking';
export type SpeechAvailability='native'|'browser'|'upgrade'|'unavailable';
type SpeechBridge={speechProtocol?:number;speechSupported?:boolean;request:(method:string,payload:Record<string,unknown>)=>Promise<unknown>};
type SpeechCallbacks={language:'ar-SA'|'en-US';onText:(text:string)=>void;onError:(code:string)=>void;onEnd:()=>void};
export type SpeechTask={cancel:()=>void};
const MAX_TEXT=5000,TIMEOUT=80000;
let active:SpeechTask|null=null;
const engine=()=>typeof window==='undefined'?null:(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
const bridgeCast=(value:unknown)=>value as SpeechBridge;
export async function speechAvailability():Promise<SpeechAvailability>{
 if(isNativeTrackingApp()){
  try{const bridge=bridgeCast(await waitForNativeBridge());if(bridge.speechProtocol===1&&bridge.speechSupported===true)return 'native';if(typeof engine()==='function')return 'browser';return bridge.speechProtocol===1?'unavailable':'upgrade';}
  catch{return typeof engine()==='function'?'browser':'upgrade';}
 }
 return typeof engine()==='function'?'browser':'unavailable';
}
export function cleanSpeechText(value:unknown):string{
 if(typeof value!=='string'||!value.trim())throw Error('speech_no_match');
 if(value.length>MAX_TEXT)throw Error('speech_too_long');
 return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
}
/** All fields share one session; cancellation invalidates callbacks before closing a provider. */
export function startSpeech(callbacks:SpeechCallbacks):SpeechTask{
 active?.cancel();
 const generation=nativeTrackingGeneration(),scope=typeof window!=='undefined'?window.__yourrestNativeScope:undefined;
 const sessionId=globalThis.crypto.randomUUID();let finished=false,providerClosed=false,nativeBridge:SpeechBridge|null=null,recognition:any=null;const timers:{timeout?:ReturnType<typeof setTimeout>;identity?:ReturnType<typeof setInterval>}={};
 const sameSession=()=>!finished&&generation===nativeTrackingGeneration()&&scope===window.__yourrestNativeScope;
 const closeProvider=()=>{if(providerClosed)return;providerClosed=true;if(recognition){recognition.onresult=null;recognition.onerror=null;recognition.onend=null;try{recognition.abort();}catch{}}if(nativeBridge)void nativeBridge.request('speechCancel',{sessionId}).catch(()=>{});};
 const finish=(error?:string)=>{if(finished)return;finished=true;if(timers.timeout!==undefined)clearTimeout(timers.timeout);if(timers.identity!==undefined)clearInterval(timers.identity);if(active===task)active=null;window.removeEventListener('pagehide',cancel);window.removeEventListener('popstate',cancel);closeProvider();if(error)callbacks.onError(error);callbacks.onEnd();};
 const cancel=()=>{if(finished)return;finish();closeProvider();};
 const task:SpeechTask={cancel};active=task;
 window.addEventListener('pagehide',cancel);window.addEventListener('popstate',cancel);
 timers.timeout=setTimeout(()=>{finish('speech_timeout');closeProvider();},TIMEOUT);
 timers.identity=setInterval(()=>{if(!sameSession())cancel();},250);
 const deliver=(value:unknown)=>{if(!sameSession()){cancel();return;}try{const text=cleanSpeechText(value);if(!text)throw Error('speech_no_match');callbacks.onText(text);finish();closeProvider();}catch(error){finish(error instanceof Error?error.message:'speech_failed');}};
 void (async()=>{
  let mode:SpeechAvailability;
  try{mode=await speechAvailability();}catch{mode='unavailable';}
  if(!sameSession()){cancel();return;}
  if(mode==='native'){
   try{
    nativeBridge=bridgeCast(await waitForNativeBridge());if(!sameSession()){cancel();return;}
    const result=await nativeBridge.request('speechStart',{sessionId,language:callbacks.language});
    if(!sameSession()){cancel();return;}
    if(!result||typeof result!=='object'||Array.isArray(result))throw Error('speech_invalid');
    const value=result as Record<string,unknown>;
    if(value.sessionId!==sessionId||typeof value.cancelled!=='boolean')throw Error('speech_invalid');
    if(value.cancelled){finish();return;}deliver(value.text);
   }catch(error){if(sameSession())finish(error instanceof Error?error.message:'speech_failed');else cancel();}
   return;
  }
  if(mode!=='browser'){finish(mode==='upgrade'?'speech_upgrade':'speech_unsupported');return;}
  try{
   const Engine=engine();recognition=new Engine();recognition.lang=callbacks.language;recognition.interimResults=false;recognition.continuous=false;recognition.maxAlternatives=1;
   recognition.onresult=(event:any)=>{
    if(!sameSession()){cancel();return;}
    try{const texts:string[]=[];for(let index=event.resultIndex||0;index<Math.min(event.results.length,20);index++){const result=event.results[index];if(result.isFinal!==false&&typeof result[0]?.transcript==='string')texts.push(result[0].transcript);}if(texts.length)deliver(texts.join(' '));}
    catch{finish('speech_invalid');}
   };
   recognition.onerror=(event:any)=>{if(!sameSession()){cancel();return;}finish(event.error==='not-allowed'||event.error==='service-not-allowed'?'speech_permission':event.error==='network'?'speech_network':event.error==='no-speech'?'speech_no_match':event.error==='language-not-supported'?'speech_language':event.error==='aborted'?undefined:'speech_failed');};
   recognition.onend=()=>{if(sameSession())finish();else cancel();};recognition.start();
  }catch(error){finish(error instanceof Error&&error.name==='NotAllowedError'?'speech_permission':'speech_failed');}
 })();
 return task;
}
export function speechErrorMessage(code:string,language:'ar'|'en'){
 const messages:Record<string,[string,string]>={
  speech_permission:['اسمح لخدمة الإملاء باستخدام الميكروفون من إعدادات الجهاز، أو اكتب النص.','Allow microphone access for the speech service in device settings, or type the text.'],
  speech_upgrade:['حدّث تطبيق يورست لاستخدام الإملاء الصوتي، أو اكتب النص.','Update the Yourrest app to use dictation, or type the text.'],
  speech_unsupported:['الإملاء غير متاح على هذا الجهاز. استخدم ميكروفون لوحة المفاتيح أو اكتب النص.','Dictation is unavailable on this device. Use the keyboard microphone or type the text.'],
  speech_no_match:['لم يتم التقاط كلام واضح. حاول مرة أخرى أو اكتب النص.','No clear speech was detected. Try again or type the text.'],
  speech_network:['تعذر اتصال خدمة الإملاء. تحقق من الإنترنت أو اكتب النص.','The speech service could not connect. Check the internet or type the text.'],
  speech_language:['لغة الإملاء غير متاحة على الجهاز. اكتب النص أو راجع إعدادات خدمة الكلام.','This dictation language is unavailable. Type the text or check the speech service settings.'],
  speech_timeout:['انتهت مهلة الإملاء. اضغط الميكروفون للمحاولة مرة أخرى.','Dictation timed out. Tap the microphone to try again.'],
  speech_too_long:['النص الصوتي طويل جدًا. أعد الإملاء على أجزاء أقصر.','The dictated text is too long. Dictate shorter sections.'],
  speech_session_changed:['تغيرت جلسة الدخول. أعد فتح النموذج قبل الإملاء.','The sign-in session changed. Reopen the form before dictating.'],
  speech_busy:['توجد جلسة إملاء أخرى مفتوحة. أغلقها وحاول مجددًا.','Another dictation session is open. Close it and try again.'],
  speech_foreground:['افتح التطبيق لبدء الإملاء.','Open the app to start dictation.']
 };
 return (messages[code]||['تعذر بدء الإملاء. حاول مرة أخرى أو اكتب النص.','Could not start dictation. Try again or type the text.'])[language==='en'?1:0];
}

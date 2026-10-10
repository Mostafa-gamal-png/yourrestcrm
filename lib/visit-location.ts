export type DeviceVisitLocation={location:string;latitude:number;longitude:number;locationSource:'device';locationCapturedAt:string;locationAccuracy:number};
export const visitLocationTimeout=22000;
/** Capture a real device fix; a WebView that never calls back must not lock the form. */
export function captureVisitLocation(geo:Pick<Geolocation,'getCurrentPosition'>|undefined,signal?:AbortSignal):Promise<DeviceVisitLocation>{
 return new Promise((resolve,reject)=>{
  if(!geo){reject(new Error('تحديد الموقع غير متاح على هذا الجهاز. افتح التطبيق في متصفح يدعم الموقع وفعّل خدمة الموقع.'));return;}
  let settled=false;
  const finish=(error?:Error,result?:DeviceVisitLocation)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(error)reject(error);else resolve(result!);};
  const cancel=()=>finish(new Error('تم إلغاء تحديد الموقع.'));
  const timeoutMessage='انتهت مهلة تحديد الموقع. شغّل موقع الجهاز واسمح لتطبيق يورست بالموقع، ثم اضغط إعادة المحاولة.';
  const timer=setTimeout(()=>finish(new Error(timeoutMessage)),visitLocationTimeout);
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted){cancel();return;}
  try{geo.getCurrentPosition(position=>{
   if(settled)return;
   const {latitude,longitude,accuracy}=position.coords,stamp=position.timestamp;
   if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||!Number.isFinite(accuracy)||accuracy<0||!Number.isFinite(stamp)||stamp<=0||!Number.isFinite(new Date(stamp).getTime())){finish(new Error('تعذر قراءة موقع صحيح من الجهاز. حاول مرة أخرى.'));return;}
   finish(undefined,{location:`${latitude.toFixed(7)}, ${longitude.toFixed(7)}`,latitude,longitude,locationSource:'device',locationCapturedAt:new Date(stamp).toISOString(),locationAccuracy:Math.round(accuracy)});
  },error=>finish(new Error(error.code===1?'السماح بالموقع مقفول. فعّله من إعدادات تطبيق يورست أو المتصفح، ثم اضغط إعادة المحاولة.':error.code===3?timeoutMessage:'تعذر تحديد الموقع. تأكد من تشغيل خدمة الموقع والاتصال بالإنترنت ثم أعد المحاولة.')),{enableHighAccuracy:true,timeout:20000,maximumAge:0});}catch{finish(new Error('تعذر بدء تحديد الموقع. فعّل خدمة الموقع وأعد المحاولة.'));}
 });
}

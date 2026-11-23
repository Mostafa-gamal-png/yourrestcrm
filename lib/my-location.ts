/** «موقعي» on the customers' map (the owner, 2026-11-23: «عايز فى الخريطة اقدر اشوف انا واقف فين بالظبط»): the device's own position as a
 *  blue dot with its accuracy circle (app/my-location.tsx). Read on the device only: nothing of it is sent to the server. The rules here are
 *  pure (tests/my-location-unit.mjs). */
import {kingdomBounds} from './kingdom';

export type MyLocationFix={latitude:number;longitude:number;accuracy:number;at:number};
export type MyLocationProblem='denied'|'unavailable'|'timeout'|'unsupported'|'outside';
export type MyLocationState={status:'off'}|{status:'locating'}|{status:'shown';fix:MyLocationFix}|{status:'problem';problem:MyLocationProblem;fix?:MyLocationFix};

/** The watch's options: the GPS itself (not the network's guess), a fresh reading each time, and an answer within 20 seconds. */
export const MY_LOCATION_WATCH:PositionOptions={enableHighAccuracy:true,maximumAge:0,timeout:20000};
/** The most a reading may be off and still be drawn (a coarse guess from the network can be kilometres off: it is not «exactly»). */
export const MY_LOCATION_MAX_ACCURACY_M=5000;

/** A reading of the device, or null when it is not one: coordinates out of range, a missing or negative accuracy, no time. */
export function readMyLocation(position:{coords?:{latitude?:unknown;longitude?:unknown;accuracy?:unknown};timestamp?:unknown}|null|undefined):MyLocationFix|null{
 const coords=position?.coords,latitude=Number(coords?.latitude),longitude=Number(coords?.longitude),accuracy=Number(coords?.accuracy),at=Number(position?.timestamp);
 if(typeof coords?.latitude!=='number'||typeof coords?.longitude!=='number'||typeof coords?.accuracy!=='number'||typeof position?.timestamp!=='number')return null;
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
 if(!Number.isFinite(accuracy)||accuracy<0||accuracy>MY_LOCATION_MAX_ACCURACY_M||!Number.isFinite(at)||at<=0)return null;
 return {latitude,longitude,accuracy,at};
}
/** Whether the map, which keeps to the Kingdom (lib/kingdom.ts kingdomBounds), can show this place. */
export function myLocationOnMap(fix:Pick<MyLocationFix,'latitude'|'longitude'>):boolean{
 const [[south,west],[north,east]]=kingdomBounds;
 return fix.latitude>=south&&fix.latitude<=north&&fix.longitude>=west&&fix.longitude<=east;
}
/** The geolocation error's code as the screen names it: 1 permission, 3 time, anything else the device could not tell. */
export function myLocationProblemOf(code:unknown):MyLocationProblem{return code===1?'denied':code===3?'timeout':'unavailable';}
/** How close the map comes when it is centred on the dot: the finer the reading, the closer. */
export function myLocationZoom(accuracy:number):number{return accuracy<=50?17:accuracy<=200?16:accuracy<=1000?15:13;}

export const MY_LOCATION_TEXT={
 button:['موقعي','My location'],
 locating:['جارٍ تحديد موقعك…','Finding your location…'],
 denied:['إذن الموقع غير مفعّل. فعّله من إعدادات تطبيق يورست أو المتصفح، ثم اضغط «موقعي».','Location access is off. Allow it in the Yourrest app or browser settings, then tap «My location».'],
 unavailable:['تعذر تحديد موقعك. تأكد من تشغيل خدمة الموقع في الجهاز، ثم اضغط «موقعي».','Your location could not be found. Turn on the device location service, then tap «My location».'],
 timeout:['انتهت مهلة تحديد موقعك. انتقل إلى مكان مكشوف، ثم اضغط «موقعي».','Finding your location took too long. Move to an open place, then tap «My location».'],
 unsupported:['هذا الجهاز لا يتيح تحديد الموقع.','This device cannot share its location.'],
 outside:['موقعك خارج حدود الخريطة.','Your location is outside the map.'],
} as const satisfies Record<string,readonly [string,string]>;

/** «أنت هنا · الدقة ±12 م»: the accuracy in whole metres, or in kilometres with one decimal from 1000 m. */
export function myLocationAccuracyText(accuracy:number,language:string):string{
 const ar=language==='ar',value=Math.max(0,accuracy);
 const amount=value<1000?(ar?`±${Math.round(value)} م`:`±${Math.round(value)} m`):(ar?`±${(value/1000).toFixed(1)} كم`:`±${(value/1000).toFixed(1)} km`);
 return ar?`أنت هنا · الدقة ${amount}`:`You are here · accuracy ${amount}`;
}
/** The line under the map's buttons: nothing while off, else what is happening, in the screen's language. */
export function myLocationLine(state:MyLocationState,language:string):string{
 const say=(pair:readonly [string,string])=>language==='ar'?pair[0]:pair[1];
 if(state.status==='off')return '';
 if(state.status==='locating')return say(MY_LOCATION_TEXT.locating);
 if(state.status==='shown')return myLocationAccuracyText(state.fix.accuracy,language);
 return say(MY_LOCATION_TEXT[state.problem]);
}

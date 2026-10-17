import {distanceMeters} from './journeys';
import {customerCoordinates} from './customer-location';

/** A visit is recorded where the customer is: the phone's point may be this far from the customer's own point. */
export const VISIT_PLACE_METERS=300;
/** The phone's own accuracy widens the allowed distance by itself, up to this many metres. */
export const VISIT_PLACE_ACCURACY_ALLOWANCE=100;
/** A fix worse than this says too little to accept or refuse a visit, unless it is clearly far away anyway. */
export const VISIT_PLACE_MAX_ACCURACY=300;

export type VisitFix={latitude:number;longitude:number;accuracy:number};
type Located={latitude?:number|null;longitude?:number|null;location?:string};
export type VisitPlaceOk={ok:true;reason:'near'|'journey'|'no_customer_location';distance:number|null;allowed:number};
export type VisitPlaceRefused={ok:false;reason:'far'|'uncertain';distance:number;allowed:number;accuracy:number};
export type VisitPlaceCheck=VisitPlaceOk|VisitPlaceRefused;

/** How far from the customer's point a fix of this accuracy may be. */
export const visitPlaceAllowed=(accuracy:number)=>VISIT_PLACE_METERS+Math.min(Math.max(Number.isFinite(accuracy)?accuracy:0,0),VISIT_PLACE_ACCURACY_ALLOWANCE);

/** Whether a fix taken now is at the customer's place. Arrival the route tracking has already confirmed settles it whatever the fix
 * says, a customer with no point of their own has nothing to be far from, and a fix too weak to judge is neither accepted nor refused. */
export function visitPlaceCheck(customer:Located,fix:VisitFix,options:{journeyArrived?:boolean}={}):VisitPlaceCheck{
 const point=customerCoordinates(customer),allowed=visitPlaceAllowed(fix.accuracy),distance=point?distanceMeters(fix,point):null;
 if(options.journeyArrived)return {ok:true,reason:'journey',distance,allowed};
 if(!point||distance===null)return {ok:true,reason:'no_customer_location',distance:null,allowed};
 if(fix.accuracy>VISIT_PLACE_MAX_ACCURACY)return {ok:false,reason:distance-fix.accuracy>allowed?'far':'uncertain',distance,allowed,accuracy:fix.accuracy};
 return distance<=allowed?{ok:true,reason:'near',distance,allowed}:{ok:false,reason:'far',distance,allowed,accuracy:fix.accuracy};
}

/** What a refused visit tells the member. The Arabic text is also what the server sends: its numbers sit in the {0} {1} {2} patterns of the English dictionary. */
export function visitPlaceMessage(result:VisitPlaceRefused,customerName:string,language:'ar'|'en'='ar'){
 const meters=String(Math.round(result.distance)),accuracy=String(Math.round(result.accuracy)),name=customerName||(language==='en'?'the customer':'العميل');
 if(result.reason==='uncertain')return language==='en'
  ?`The location accuracy is weak (±${accuracy} meters), so it cannot be confirmed that you are at «${name}». Go outdoors or turn on GPS, then tap Refresh device location.`
  :`دقة الموقع ضعيفة (±${accuracy} متر) فلا يمكن التأكد أنك عند «${name}». اخرج إلى مكان مكشوف أو شغّل GPS ثم اضغط تحديث موقع الجهاز.`;
 return language==='en'
  ?`A visit can only be recorded at the customer's place. You are ${meters} meters from «${name}» (accuracy ±${accuracy} meters). Go to the customer's place, then tap Refresh device location.`
  :`لا يمكن تسجيل الزيارة إلا عند العميل. أنت على بعد ${meters} متر من موقع «${name}» (الدقة ±${accuracy} متر). انتقل إلى موقع العميل ثم اضغط تحديث موقع الجهاز.`;
}

/** The short line beside a saved visit for those who read it: how far from the customer it was recorded. */
export function visitPlaceNote(data:{placeDistance?:unknown;placeOutside?:unknown},language:'ar'|'en'='ar'){
 const distance=typeof data.placeDistance==='number'&&Number.isFinite(data.placeDistance)?Math.round(data.placeDistance):null;
 if(data.placeOutside===true)return language==='en'?`Recorded away from the customer${distance!==null?' · '+distance+' m':''}`:`سُجّلت بعيدًا عن العميل${distance!==null?' · '+distance+' م':''}`;
 if(distance!==null)return language==='en'?`${distance} m from the customer`:`على بعد ${distance} م من العميل`;
 return '';
}

export type VisitPlaceView={status:'idle'|'near'|'journey'|'adopt'|'far'|'uncertain';blocked:boolean;message:string;distance:number|null};
const idleView:VisitPlaceView={status:'idle',blocked:false,message:'',distance:null};
/** What a form says about the place of the visit it is about to save, and whether saving waits for a better point: a representative who
 * is away, or whose fix is too weak, cannot save; the others are told the visit will be marked. Calls and messages have no place. */
export function visitPlaceView(input:{customer:(Located&{name?:unknown})|undefined;data:{type?:unknown;latitude?:unknown;longitude?:unknown;locationAccuracy?:unknown};role:string;language:'ar'|'en';journeyArrived?:boolean}):VisitPlaceView{
 const {customer,data,role,language}=input,say=(ar:string,en:string)=>language==='en'?en:ar;
 const {latitude,longitude,locationAccuracy}=data;
 if(!customer||data.type!=='visit'||typeof latitude!=='number'||typeof longitude!=='number'||typeof locationAccuracy!=='number'||![latitude,longitude,locationAccuracy].every(Number.isFinite))return idleView;
 const result=visitPlaceCheck(customer,{latitude,longitude,accuracy:locationAccuracy},{journeyArrived:input.journeyArrived});
 if(result.ok){
  const meters=result.distance===null?'':String(Math.round(result.distance));
  if(result.reason==='journey')return {status:'journey',blocked:false,message:say('تم تأكيد وصولك إلى العميل.','Your arrival at the customer is confirmed.'),distance:result.distance};
  if(result.reason==='no_customer_location')return {status:'adopt',blocked:false,message:say('لا موقع مسجل لهذا العميل؛ يُعتمد موقعك الحالي موقعًا له عند الحفظ.','This customer has no recorded location; your current location becomes it when you save.'),distance:null};
  return {status:'near',blocked:false,message:say(`أنت عند العميل (على بعد ${meters} م).`,`You are at the customer (${meters} m away).`),distance:result.distance};
 }
 const name=String(customer.name||''),meters=String(Math.round(result.distance)),accuracy=String(Math.round(result.accuracy));
 if(role==='rep')return {status:result.reason,blocked:true,message:visitPlaceMessage(result,name,language),distance:result.distance};
 return {status:result.reason,blocked:false,distance:result.distance,message:result.reason==='far'
  ?say(`أنت على بعد ${meters} متر من موقع العميل؛ تُحفظ الزيارة وتُوسم «سُجّلت بعيدًا عن العميل».`,`You are ${meters} meters from the customer; the visit is saved and marked as recorded away from the customer.`)
  :say(`دقة الموقع ضعيفة (±${accuracy} متر)؛ تُحفظ الزيارة دون تأكيد قربك من العميل.`,`The location accuracy is weak (±${accuracy} meters); the visit is saved without confirming that you are at the customer.`)};
}

import {z} from 'zod';
import {coordinatesFromText,type LocationFields} from './customer-location';
import {insideKingdom} from './kingdom';

// Kept optional so existing customer imports and older installed clients remain compatible.
export const customerAddressFields={
 shortAddress:z.string().trim().transform(value=>value.replace(/\s+/g,'').toUpperCase()).pipe(z.string().regex(/^(?:[A-Z]{4}[0-9]{4})?$/,'العنوان المختصر يتكون من 4 حروف إنجليزية و4 أرقام')).default(''),
 location:z.string().trim().max(250).default(''),
 latitude:z.number().finite().min(-90).max(90).nullable().optional(),
 longitude:z.number().finite().min(-180).max(180).nullable().optional(),
 locationSource:z.literal('device').optional(),
 locationCapturedAt:z.union([z.string().datetime({offset:true}),z.literal('')]).optional(),
 locationAccuracy:z.number().finite().min(0).optional(),
};

/** Coordinates and capture metadata are one value; never relabel a manually changed point as an old GPS fix. */
export function prepareCustomerLocation(data:LocationFields,old?:LocationFields,now=Date.now()):string|null{
 const point=coordinatesFromText(data.location||'');
 if(data.location&&!point)return 'أدخل اللوكيشن كخط عرض، خط طول، أو رابط خرائط يحتوي الإحداثيات.';
 const previous=old?coordinatesFromText(old.location||''):null;
 const samePoint=!!point&&!!previous&&Math.abs(point.latitude-previous.latitude)<0.000001&&Math.abs(point.longitude-previous.longitude)<0.000001;
 // A customer's place is within the Kingdom (a few kilometres of the border allowed for the phone's fix); a point saved earlier is kept as it is.
 if(point&&!samePoint&&!insideKingdom(point.latitude,point.longitude))return 'موقع العميل خارج حدود المملكة العربية السعودية. اختر نقطة داخلها.';
 if(data.locationSource==='device'){
  if(!point||typeof data.latitude!=='number'||typeof data.longitude!=='number'||Math.abs(data.latitude-point.latitude)>0.000001||Math.abs(data.longitude-point.longitude)>0.000001)return 'تغيّر اللوكيشن بعد التقاطه. حدّث موقع الجهاز ثم حاول مرة أخرى.';
  const captured=Date.parse(data.locationCapturedAt||'');
  if(!Number.isFinite(captured)||captured>now+60000||!Number.isFinite(data.locationAccuracy))return 'بيانات التقاط الموقع غير مكتملة. حدّث موقع الجهاز ثم حاول مرة أخرى.';
  if(old?.locationSource==='device'&&!samePoint&&data.locationCapturedAt===old.locationCapturedAt)return 'تغيّر اللوكيشن بعد التقاطه. حدّث موقع الجهاز ثم حاول مرة أخرى.';
 }else if(samePoint&&old?.locationSource==='device'&&data.locationCapturedAt===undefined&&data.locationAccuracy===undefined){
  Object.assign(data,{locationSource:old.locationSource,locationCapturedAt:old.locationCapturedAt,locationAccuracy:old.locationAccuracy});
 }else{
  delete data.locationSource;delete data.locationCapturedAt;delete data.locationAccuracy;
 }
 data.latitude=point?.latitude??null;data.longitude=point?.longitude??null;
 return null;
}

/** What a form can check before a customer is saved or queued on the phone, so a wrong place is corrected at once and not at some
 * later sync. It applies the server's rules to a copy, except the clock: the capture time comes from the phone's positioning and may
 * differ from the phone's own clock, so only the server's clock may judge it. */
export function customerLocationProblem(data:LocationFields):string|null{return prepareCustomerLocation({...data},undefined,Number.POSITIVE_INFINITY);}

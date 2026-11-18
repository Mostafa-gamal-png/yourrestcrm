import type {Member,Row} from './crm';
import {customerCoordinates} from './customer-location';
import {memberCanAccessRegion} from './regions';

/** «تنبيه المصانع القريبة» (the owner, 2026-11-16, item 7 of the GSCO comparison list: «تنبيه بالمصانع القريبة اللي محتاجة زيارة، على
 * طريقة تنبيه المشاريع القريبة المجمّع في GSCO (أندرويد 1.4.8)»; approved: «تمام كمل كل البنود وارفع لما الفحص يخلص»). For the
 * representative only, in the Android app: one grouped notification when the phone is within 1 km of customers the representative is
 * responsible for that have not been visited for 60 days or more and have a saved location on the map; the same customer is not
 * notified more than once a day. The server says which customers qualify (GET /api/nearby-customers, lib/nearby-customers-server.ts);
 * the distance, the grouping and the once-a-day memory are the app's (mobile/android NearbyRules.java), as in GSCO.
 *
 * «Not visited for 60 days or more»: the latest visit (a «الزيارات» record whose type is «زيارة», by any member: the customer is what
 * needs the visit) is 60 days before today in Riyadh or earlier, or there is none. A visit exactly 60 days ago qualifies, 59 does not.
 * This is not «لم يشترِ منذ 60 يومًا» (lib/customer-last-purchase.ts: purchases, and 60 days still recent): Yourrest had no rule on
 * visits, so this one is the owner's approved wording. */
export const NEARBY_VISIT_DAYS=60;
/** The app's radius, said here for the documentation and the tests; the app decides it (NearbyRules.RADIUS_METRES). */
export const NEARBY_RADIUS_METERS=1000;
/** As GSCO's catalog (lib/crm/proximity-projects-server.ts): valid ten minutes, asked again after five, and never a cut list. */
export const NEARBY_CATALOG_TTL_SECONDS=600;
export const NEARBY_REFRESH_SECONDS=300;
export const NEARBY_CUSTOMER_LIMIT=2000;
export const NEARBY_REP_ONLY='تنبيه المصانع القريبة متاح لحساب المندوب فقط.';
export const NEARBY_ACCOUNT_CHANGED='تغيّرت صلاحيات حسابك. سجّل الدخول من جديد.';
export const NEARBY_TOO_MANY='تعذّر تحديث قائمة المصانع القريبة كاملة. حاول لاحقًا.';

const DAY_MS=86_400_000,DATE=/^\d{4}-\d{2}-\d{2}$/,ID=/^[A-Za-z0-9_-]{1,200}$/;
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
/** The day in Riyadh (UTC+3 all year) of an instant. */
export function riyadhDay(at:string|number|Date=Date.now()){return riyadh.format(new Date(at));}
/** A real calendar day written YYYY-MM-DD, else ''. */
export function calendarDay(value:unknown):string{
 if(typeof value!=='string'||!DATE.test(value))return '';
 const time=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?value:'';
}
/** Whole days from one calendar day to another (negative when `from` is later). */
export function daysBetween(from:string,to:string):number|null{
 const a=calendarDay(from),b=calendarDay(to);
 return a&&b?Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/DAY_MS):null;
}
/** No visit, or the latest one 60 days before today or earlier. A visit dated after today (a typing slip) is a recent one. */
export function needsVisit(lastVisit:string|null|undefined,today:string):boolean{
 if(!lastVisit)return true;
 const days=daysBetween(lastVisit,today);
 return days!==null&&days>=NEARBY_VISIT_DAYS;
}

export type NearbyCustomer={id:string;name:string;latitude:number;longitude:number;
 /** Whole days since the latest visit; null: never visited. */
 daysSinceVisit:number|null};
/** One customer of the catalog, or null: the customer is the reader's own (assigned to them, in their regions), has a name, an id the
 *  app accepts and a saved location on the map (customerCoordinates: what «خريطة المصانع» and the directions read), and needs a visit.
 *  Only what the notification needs leaves: no phone, contact, address, note or code. */
export function nearbyCustomer(customer:Pick<Row,'id'|'kind'|'assignedTo'|'data'>,me:Pick<Member,'id'|'regionScope'>,lastVisit:string|null|undefined,today:string):NearbyCustomer|null{
 if(customer.kind!=='customer'||customer.assignedTo!==me.id||!ID.test(customer.id)||!memberCanAccessRegion(me as Member,customer.data?.region))return null;
 const name=typeof customer.data?.name==='string'?customer.data.name.replace(/\s+/g,' ').trim():'';
 const point=customerCoordinates(customer.data||{}),last=calendarDay(lastVisit);
 if(!name||!point||!needsVisit(last,today))return null;
 return {id:customer.id,name:name.slice(0,200),latitude:point.latitude,longitude:point.longitude,daysSinceVisit:last?daysBetween(last,today):null};
}

/** memberRole: always 'rep', the field role the Android app checks (a marketing officer included: lib/roles.ts trackingRole). */
export type NearbyCatalog={schemaVersion:1;memberId:string;memberRole:'rep';regionScope:string;serverTime:string;expiresAt:string;refreshAfterSeconds:number;customers:NearbyCustomer[]};
/** The answer of GET /api/nearby-customers. `rows` are the reader's customers, each with the day of its latest visit. Ordered by id; a
 *  list longer than the limit is refused (the app would otherwise keep alerting on customers that left it). */
export function nearbyCatalog(me:Pick<Member,'id'|'regionScope'>,scope:string,rows:{customer:Pick<Row,'id'|'kind'|'assignedTo'|'data'>;lastVisit:string|null}[],now:string):NearbyCatalog{
 const today=riyadhDay(now),customers:NearbyCustomer[]=[];
 for(const row of rows){const entry=nearbyCustomer(row.customer,me,row.lastVisit,today);if(entry)customers.push(entry);}
 if(customers.length>NEARBY_CUSTOMER_LIMIT)throw new RangeError(NEARBY_TOO_MANY);
 customers.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return {schemaVersion:1,memberId:me.id,memberRole:'rep',regionScope:scope,serverTime:now,expiresAt:new Date(Date.parse(now)+NEARBY_CATALOG_TTL_SECONDS*1000).toISOString(),refreshAfterSeconds:NEARBY_REFRESH_SECONDS,customers};
}

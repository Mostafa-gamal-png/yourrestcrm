import {CRMError,type context} from './crm-server';
import {type Row} from './crm';
import type {JourneyStop} from './journeys';
import {visitPlaceCheck,visitPlaceMessage} from './visit-place';
type Context=Awaited<ReturnType<typeof context>>;
type PlaceData={type?:string;latitude?:unknown;longitude?:unknown;locationAccuracy?:unknown;[key:string]:unknown};
export type VisitPlaceDecision={
 /** How far from the customer the visit was recorded, when both points are known; kept on the visit for those who read it. */
 distance:number|null;
 /** Recorded away from the customer by someone the rule does not stop (a supervisor, a manager, an administrator). */
 outside:boolean;
 /** The customer has no place of their own: this visit's point becomes it. */
 adopt:boolean;
};
const none:VisitPlaceDecision={distance:null,outside:false,adopt:false};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

/** A new visit is recorded where the customer is. A representative who is elsewhere is refused with the distance; the others are not
 * stopped, their visit is marked instead. Arrival the route tracking has confirmed for this member and customer, and not yet ended by a
 * departure, settles it, and a
 * customer with no point of their own takes this visit's point as theirs. Only physical visits are judged: calls, e-mails and messages
 * have no place. The caller has already required a device fix on the visit. */
export async function enforceVisitPlace(c:Context,customer:Row,data:PlaceData,options:{stop:JourneyStop|null;now:string;memberId:string}):Promise<VisitPlaceDecision>{
 if(data.type!=='visit')return none;
 if(!finite(data.latitude)||!finite(data.longitude)||!finite(data.locationAccuracy))throw new CRMError('انتظر تحديد موقع الجهاز تلقائيًا، واسمح بالوصول للموقع قبل حفظ الزيارة.');
 const stop=options.stop,arrived=!!stop&&stop.customerId===customer.id&&stop.memberId===options.memberId&&!!stop.data.arrivalAt&&!stop.data.departureAt&&!stop.closedAt;
 const result=visitPlaceCheck(customer.data,{latitude:data.latitude,longitude:data.longitude,accuracy:data.locationAccuracy},{journeyArrived:arrived});
 if(result.ok)return {distance:result.distance,outside:false,adopt:result.reason==='no_customer_location'&&!String(customer.data.location||'').trim()};
 if(c.me.role!=='rep')return {distance:result.distance,outside:result.reason==='far',adopt:false};
 // The refusal is kept on the customer, once for every ten minutes of trying, for those who read that customer's history.
 const bucket=Math.floor(Date.parse(options.now)/600000);
 await c.db.prepare('INSERT OR IGNORE INTO crm_audit (id,record_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)').bind(`visit-place-${c.me.id}-${customer.id}-${bucket}`,customer.id,c.me.name,'محاولة تسجيل زيارة بعيدة عن العميل',`على بعد ${Math.round(result.distance)} متر والمسموح ${Math.round(result.allowed)} متر`,options.now).run();
 throw new CRMError(visitPlaceMessage(result,String(customer.data.name||''),'ar'));
}

/** The statements that give a customer with no place the point of the visit just saved; they run after that visit, in its batch. */
export function adoptCustomerPlace(c:Context,customer:Row,data:{location?:string;latitude?:unknown;longitude?:unknown;locationAccuracy?:unknown;locationCapturedAt?:unknown},visitId:string,now:string,gate:string,gateArgs:(string|number)[]){
 const note={visitId,by:c.me.id,byName:c.me.name,at:now};
 return [
  c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$.location',?,'$.latitude',?,'$.longitude',?,'$.locationSource','device','$.locationCapturedAt',?,'$.locationAccuracy',?,'$._locationFromVisit',json(?)),updated_at=?,version=version+1 WHERE id=? AND kind='customer' AND json_extract(data,'$.latitude') IS NULL AND COALESCE(json_extract(data,'$.location'),'')='' AND ${gate}`)
   .bind(data.location,data.latitude as number,data.longitude as number,data.locationCapturedAt as string,data.locationAccuracy as number,JSON.stringify(note),now,customer.id,...gateArgs),
  c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate} AND json_extract((SELECT data FROM crm_records WHERE id=?),'$._locationFromVisit.visitId')=?`)
   .bind(crypto.randomUUID(),customer.id,c.me.name,'تسجيل موقع العميل من زيارة','لم يكن للعميل موقع مسجل؛ اعتُمد موقع هذه الزيارة',now,...gateArgs,customer.id,visitId)
 ];
}

import {areaOutline,pinDisks,type Area,type LatLng} from './work-area-geometry';
import {customerMissingFields,qualityFields} from './kpis';
import {can} from './permissions';
import {isFieldRole} from './roles';
import type {Member} from './crm';

/** «خريطة المصانع»: the yellow pins, the representatives' work areas and the streets with no customer (the owner, 2026-11-19: the port of
 * GSCO 2.13.81 «خريطة المشاريع» and 2.13.82 «بيانات شوارع محلية»). What the page and the server share, with no server import:
 * - a customer whose record misses any of the seven fields of «دقة واكتمال البيانات» (lib/kpis.ts qualityFields, the evaluation's own
 *   test) is drawn with a yellow ring and its card names what is missing;
 * - a representative's work area: the one the sales manager drew (crm_work_areas, migration 0023), or else 500 m around each pin of the
 *   customers he is responsible for, «خامل» customers left out (lib/work-areas-server.ts);
 * - the pieces of the area's streets with no customer of the company within 50 m are purple, with «إخفاء علامات الشوارع»;
 * - drawing is «خريطة المصانع · تحرير» («رسم مناطق عمل المناديب», lib/permissions.ts): the administrator and the sales manager. */

export const mapColors={
 // An amber yellow with a dark brown edge: reads on OpenStreetMap's pale background and is never confused with the activity colours
 // (lib/customer-map-activity.ts), which stay at the pin's centre.
 incomplete:'#facc15',incompleteBorder:'#713f12',
 // Empty streets in purple; the work area as a thin dashed line.
 street:'#7e22ce',area:'#4c1d95',
} as const;

/** The seven fields by their names on the customer form (lib/kpis.ts qualityFields), in Arabic and English. */
export const QUALITY_FIELD_TEXT:Record<(typeof qualityFields)[number][0],readonly [string,string]>={
 name:['الاسم','Name'],region:['المنطقة','Region'],city:['المدينة','City'],phone:['الهاتف','Phone'],contact:['اسم المسؤول','Contact name'],
 customerKind:['نوع العميل','Customer type'],place:['الموقع','Location'],
};
/** What a customer's pin and card say is missing (empty: the record is complete). */
export const customerMissing=(data:Record<string,unknown>|null|undefined)=>customerMissingFields(data);
export const missingText=(keys:readonly (keyof typeof QUALITY_FIELD_TEXT)[],language:'ar'|'en')=>keys.map(key=>QUALITY_FIELD_TEXT[key][language==='ar'?0:1]).join(language==='ar'?'، ':', ');

/** A drawn area is its polygon (`rings`); the fallback is 500 m (`radius`) around each pin in `centers`. */
export type WorkAreaSource='drawn'|'fallback'|'none';
export type WorkAreaInfo={source:WorkAreaSource;rings:LatLng[][];centers:LatLng[];radius:number;clusters:number;area_km2:number|null;version:number|null;updated_at:string|null;updated_by_name:string|null;pins:number};
export type WorkAreaRep={id:string;name:string;drawn:boolean};
export type WorkAreaView={rep_id:string;rep_name:string;area:WorkAreaInfo;can_edit:boolean};
export type StreetSegment={name:string|null;name_en:string|null;points:LatLng[]};
export type StreetStatus='ready'|'stale'|'partial'|'unavailable'|'too_large'|'no_area';
export type WorkAreaStreets={rep_id:string;area:WorkAreaInfo;status:StreetStatus;fetched_at:string|null;segments:StreetSegment[];counts:{pieces:number;empty:number;returned:number};clusters:{total:number;shown:number;pending:number};truncated:boolean};

/** Drawing a work area: «خريطة المصانع · تحرير» on (its ceiling is the administrator and the sales manager), never a field member or customer
 *  service whatever is saved. The server decides with the same function (lib/work-areas-server.ts). */
export const mayDrawWorkAreas=(me:Pick<Member,'role'|'access'>|null|undefined)=>!!me&&!isFieldRole(me.role)&&!['customer_service','customer_service_manager'].includes(me.role)&&can(me,'map','edit');

const point=(p:unknown):p is LatLng=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v));
const ring=(r:unknown):r is LatLng[]=>Array.isArray(r)&&r.every(point);
const text=(v:unknown)=>v===null||typeof v==='string';
export function validWorkAreaInfo(a:Partial<WorkAreaInfo>|null|undefined):a is WorkAreaInfo{
 return !!a&&['drawn','fallback','none'].includes(a.source as string)&&Array.isArray(a.rings)&&a.rings.every(ring)&&ring(a.centers)&&typeof a.radius==='number'&&a.radius>=0&&a.radius<=5000&&typeof a.clusters==='number'&&(a.area_km2===null||typeof a.area_km2==='number')&&(a.version===null||Number.isInteger(a.version))&&typeof a.pins==='number';
}
export const validWorkAreaReps=(v:{reps?:unknown}|null|undefined):v is {reps:WorkAreaRep[]}=>!!v&&Array.isArray(v.reps)&&v.reps.every(r=>!!r&&typeof (r as WorkAreaRep).id==='string'&&typeof (r as WorkAreaRep).name==='string'&&typeof (r as WorkAreaRep).drawn==='boolean');
export const validWorkAreaView=(v:Partial<WorkAreaView>|null|undefined):v is WorkAreaView=>!!v&&typeof v.rep_id==='string'&&typeof v.can_edit==='boolean'&&validWorkAreaInfo(v.area);
export const validWorkAreaStreets=(v:Partial<WorkAreaStreets>|null|undefined):v is WorkAreaStreets=>!!v&&typeof v.rep_id==='string'&&validWorkAreaInfo(v.area)&&['ready','stale','partial','unavailable','too_large','no_area'].includes(v.status as string)&&!!v.clusters&&typeof v.clusters.total==='number'&&!!v.counts&&typeof v.counts.empty==='number'&&Array.isArray(v.segments)&&v.segments.every(s=>!!s&&text(s.name)&&text(s.name_en)&&ring(s.points)&&s.points.length>=2)&&typeof v.truncated==='boolean';

/** The area as a shape (the drawn polygon, or the disks around the pins) and the line drawn around it (the outline of the disks' union). */
export function workAreaShape(a:WorkAreaInfo):Area{return a.source==='drawn'?{rings:a.rings}:a.source==='fallback'?pinDisks(a.centers,a.radius):{rings:[]};}
export function workAreaOutline(a:WorkAreaInfo):LatLng[][]{const shape=workAreaShape(a);return shape.rings.length?areaOutline(shape):[];}

type Pair=readonly [string,string];
/** The words of the map's work-area parts, Arabic and English (the component says them with the page's language). */
export const WORK_AREA_TEXT={
 legend:['دليل ألوان الخريطة','Map legend'],incomplete:['بيانات ناقصة','Missing data'],street:['شارع بلا عملاء','Street with no customer'],area:['منطقة العمل','Work area'],
 hideStreets:['إخفاء علامات الشوارع','Hide street marks'],noCustomer:['لا يوجد عملاء مسجلون في هذا الشارع','No customer is registered on this street'],
 drawn:['منطقة عمل مرسومة','Drawn work area'],fallback:['منطقة تقديرية: 500 م حول عملاء المندوب','Estimated area: 500 m around the representative\'s customers'],
 km2:['كم²','km²'],pieces:['جزء شارع بلا عملاء','street pieces with no customer'],first3000:['عُرض أول 3000 جزء فقط.','Only the first 3,000 pieces are shown.'],
 biggest12:['عُرضت الشوارع حول أكبر 12 مجموعة من العملاء فقط.','Streets are shown around the 12 largest groups of customers only.'],
 section:['منطقة عمل المندوب','Representative\'s work area'],rep:['مندوب منطقة العمل','Work area representative'],chooseRep:['اختر المندوب','Choose the representative'],
 hint:['اختر مندوبًا لعرض منطقة عمله والشوارع الخالية من العملاء.','Choose a representative to show his work area and the streets with no customer.'],
 areaDrawn:['منطقة مرسومة','area drawn'],draw:['رسم منطقة العمل','Draw work area'],edit:['تعديل منطقة العمل','Edit work area'],remove:['حذف منطقة العمل','Delete work area'],
 confirmRemove:['تأكيد حذف منطقة العمل','Confirm deleting the work area'],save:['حفظ منطقة العمل','Save work area'],saving:['جارٍ حفظ منطقة العمل…','Saving the work area…'],
 undo:['تراجع عن آخر نقطة','Undo last point'],cancel:['إلغاء','Cancel'],deletePoint:['حذف النقطة','Delete point'],corners:['عدد النقاط','Corners'],tools:['أدوات منطقة العمل','Work area tools'],
 drawHelp:['اضغط على الخريطة لإضافة نقاط حدود المنطقة، ثم احفظ.','Tap the map to add the corners of the area, then save.'],
 editHelp:['اسحب النقطة لتحريكها، واضغطها لحذفها، واضغط على الخريطة لإضافة نقطة.','Drag a corner to move it, tap it to delete it, and tap the map to add a corner.'],
 saved:['تم حفظ منطقة العمل.','Work area saved.'],removed:['تم حذف منطقة العمل.','Work area deleted.'],
 failed:['تعذر إتمام الطلب. حاول مرة أخرى.','The request could not be completed. Try again.'],
} as const satisfies Record<string,Pair>;

/** What the street layer says under the legend, by its status (nothing when the streets show normally and some are empty). */
export function streetStatusText(status:StreetStatus|'offline'|'loading'|'failed',empty:number):Pair|null{
 switch(status){
  case 'offline':return ['الشوارع غير متاحة دون اتصال.','Streets are not available offline.'];
  case 'loading':return ['جارٍ تحميل الشوارع…','Loading streets…'];
  case 'failed':case 'unavailable':return ['تعذر تحميل الشوارع الآن.','Could not load the streets right now.'];
  case 'stale':return ['الشوارع من آخر نسخة محفوظة؛ تعذر تحديثها الآن.','Streets from the last saved copy; they could not be refreshed now.'];
  case 'partial':return ['حُمّل جزء من الشوارع فقط؛ افتح الخريطة بعد قليل لإكمالها.','Only part of the streets has loaded; open the map again shortly to complete them.'];
  case 'too_large':return ['منطقة العمل أوسع من أن تُعرض شوارعها (الحد 40 كم² و15 كم طولًا وعرضًا). يمكن لمدير المبيعات رسم منطقة أصغر.','The work area is too large to show its streets (limit 40 km² and 15 km each way). The sales manager can draw a smaller area.'];
  case 'no_area':return ['لا توجد منطقة عمل: لم تُرسم منطقة ولا يوجد عملاء للمندوب على الخريطة.','No work area: none was drawn and the representative has no customer on the map.'];
  default:return empty?null:['كل شوارع منطقة العمل فيها عملاء مسجلون.','Every street in the work area has a registered customer.'];
 }
}

/** The lines under the map's legend: the area, then the street count or why the streets do not show. */
export type WorkAreaState={active:boolean;area:WorkAreaInfo|null;streets:WorkAreaStreets|null;areaError:string;streetsFailed:boolean;loading:boolean};
export function workAreaLines(state:WorkAreaState,online:boolean,hidden:boolean,language:'ar'|'en'):string[]{
 const say=(pair:Pair)=>pair[language==='ar'?0:1],number=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:2});
 if(!online)return [say(streetStatusText('offline',0)!)];
 if(!state.active)return [];
 const lines:string[]=[],a=state.area;
 if(state.areaError)lines.push(state.areaError);
 if(a?.source==='drawn')lines.push(say(WORK_AREA_TEXT.drawn)+(a.area_km2!==null?' · '+number(a.area_km2)+' '+say(WORK_AREA_TEXT.km2):''));
 if(a?.source==='fallback')lines.push(say(WORK_AREA_TEXT.fallback)+' ('+number(a.pins)+')');
 if(state.loading){lines.push(say(streetStatusText('loading',0)!));return lines;}
 if(state.streetsFailed){lines.push(say(streetStatusText('failed',0)!));return lines;}
 const s=state.streets;if(!s)return lines;
 if(s.status==='ready'||s.status==='stale'||s.status==='partial'){
  if(s.status!=='ready')lines.push(say(streetStatusText(s.status,0)!));
  if(s.clusters.total>s.clusters.shown)lines.push(say(WORK_AREA_TEXT.biggest12));
  if(s.counts.empty&&!hidden)lines.push(number(s.counts.empty)+' '+say(WORK_AREA_TEXT.pieces));
  else if(!s.counts.empty)lines.push(say(streetStatusText('ready',0)!));
  if(s.truncated&&!hidden)lines.push(say(WORK_AREA_TEXT.first3000));
 }else lines.push(say(streetStatusText(s.status,0)!));
 return lines;
}

/** «إخفاء علامات الشوارع» is remembered on this device; a browser or WebView without storage simply forgets it. */
export const hideStreetsKey='yourrest.map.hideStreets';
export function readHideStreets(storage:Pick<Storage,'getItem'>|null|undefined=typeof localStorage==='undefined'?null:localStorage){
 try{return storage?.getItem(hideStreetsKey)==='1';}catch{return false;}
}
export function writeHideStreets(value:boolean,storage:Pick<Storage,'setItem'>|null|undefined=typeof localStorage==='undefined'?null:localStorage){
 try{storage?.setItem(hideStreetsKey,value?'1':'0');}catch{/* private mode or a WebView without storage: the choice lasts for this visit */}
}

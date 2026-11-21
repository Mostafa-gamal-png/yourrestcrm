import {areaOutline,pinDisks,type Area,type LatLng} from './work-area-geometry';
import {customerMissingFields,qualityFields} from './kpis';
import {can} from './permissions';
import {isFieldRole} from './roles';
import type {Member} from './crm';

/** «خريطة المصانع»: the yellow pins and the representatives' work areas (the owner, 2026-11-19: the port of GSCO 2.13.81 «خريطة المشاريع»).
 * What the page and the server share, with no server import:
 * - a customer whose record misses any of the seven fields of «دقة واكتمال البيانات» (lib/kpis.ts qualityFields, the evaluation's own
 *   test) is drawn with a yellow ring and its card names what is missing;
 * - a representative's work area: the one the sales manager drew (crm_work_areas, migration 0023), or else 500 m around each pin of the
 *   customers he is responsible for, «خامل» customers left out (lib/work-areas-server.ts);
 * - drawing is «خريطة المصانع · تحرير» («رسم مناطق عمل المناديب», lib/permissions.ts): the administrator and the sales manager.
 * The purple streets with no customer (GSCO 2.13.82) and the switch that hid them were removed on 2026-11-21: the owner, «جزء الشوارع
 * البنفسجية متعملوش هنا ملوش لازمة». */

export const mapColors={
 // An amber yellow with a dark brown edge: reads on OpenStreetMap's pale background and is never confused with the activity colours
 // (lib/customer-map-activity.ts), which stay at the pin's centre.
 incomplete:'#facc15',incompleteBorder:'#713f12',
 // The work area as a thin dashed line.
 area:'#4c1d95',
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

/** Drawing a work area: «خريطة المصانع · تحرير» on (its ceiling is the administrator and the sales manager), never a field member or customer
 *  service whatever is saved. The server decides with the same function (lib/work-areas-server.ts). */
export const mayDrawWorkAreas=(me:Pick<Member,'role'|'access'>|null|undefined)=>!!me&&!isFieldRole(me.role)&&!['customer_service','customer_service_manager'].includes(me.role)&&can(me,'map','edit');

const point=(p:unknown):p is LatLng=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v));
const ring=(r:unknown):r is LatLng[]=>Array.isArray(r)&&r.every(point);
export function validWorkAreaInfo(a:Partial<WorkAreaInfo>|null|undefined):a is WorkAreaInfo{
 return !!a&&['drawn','fallback','none'].includes(a.source as string)&&Array.isArray(a.rings)&&a.rings.every(ring)&&ring(a.centers)&&typeof a.radius==='number'&&a.radius>=0&&a.radius<=5000&&typeof a.clusters==='number'&&(a.area_km2===null||typeof a.area_km2==='number')&&(a.version===null||Number.isInteger(a.version))&&typeof a.pins==='number';
}
export const validWorkAreaReps=(v:{reps?:unknown}|null|undefined):v is {reps:WorkAreaRep[]}=>!!v&&Array.isArray(v.reps)&&v.reps.every(r=>!!r&&typeof (r as WorkAreaRep).id==='string'&&typeof (r as WorkAreaRep).name==='string'&&typeof (r as WorkAreaRep).drawn==='boolean');
export const validWorkAreaView=(v:Partial<WorkAreaView>|null|undefined):v is WorkAreaView=>!!v&&typeof v.rep_id==='string'&&typeof v.can_edit==='boolean'&&validWorkAreaInfo(v.area);

/** The area as a shape (the drawn polygon, or the disks around the pins) and the line drawn around it (the outline of the disks' union). */
export function workAreaShape(a:WorkAreaInfo):Area{return a.source==='drawn'?{rings:a.rings}:a.source==='fallback'?pinDisks(a.centers,a.radius):{rings:[]};}
export function workAreaOutline(a:WorkAreaInfo):LatLng[][]{const shape=workAreaShape(a);return shape.rings.length?areaOutline(shape):[];}

type Pair=readonly [string,string];
/** The words of the map's work-area parts, Arabic and English (the component says them with the page's language). */
export const WORK_AREA_TEXT={
 legend:['دليل ألوان الخريطة','Map legend'],incomplete:['بيانات ناقصة','Missing data'],area:['منطقة العمل','Work area'],
 drawn:['منطقة عمل مرسومة','Drawn work area'],fallback:['منطقة تقديرية: 500 م حول عملاء المندوب','Estimated area: 500 m around the representative\'s customers'],
 none:['لا توجد منطقة عمل: لم تُرسم منطقة ولا يوجد عملاء للمندوب على الخريطة.','No work area: none was drawn and the representative has no customer on the map.'],
 km2:['كم²','km²'],
 section:['منطقة عمل المندوب','Representative\'s work area'],rep:['مندوب منطقة العمل','Work area representative'],chooseRep:['اختر المندوب','Choose the representative'],
 hint:['اختر مندوبًا لعرض منطقة عمله.','Choose a representative to show his work area.'],
 areaDrawn:['منطقة مرسومة','area drawn'],draw:['رسم منطقة العمل','Draw work area'],edit:['تعديل منطقة العمل','Edit work area'],remove:['حذف منطقة العمل','Delete work area'],
 confirmRemove:['تأكيد حذف منطقة العمل','Confirm deleting the work area'],save:['حفظ منطقة العمل','Save work area'],saving:['جارٍ حفظ منطقة العمل…','Saving the work area…'],
 undo:['تراجع عن آخر نقطة','Undo last point'],cancel:['إلغاء','Cancel'],deletePoint:['حذف النقطة','Delete point'],corners:['عدد النقاط','Corners'],tools:['أدوات منطقة العمل','Work area tools'],
 drawHelp:['اضغط على الخريطة لإضافة نقاط حدود المنطقة، ثم احفظ.','Tap the map to add the corners of the area, then save.'],
 editHelp:['اسحب النقطة لتحريكها، واضغطها لحذفها، واضغط على الخريطة لإضافة نقطة.','Drag a corner to move it, tap it to delete it, and tap the map to add a corner.'],
 saved:['تم حفظ منطقة العمل.','Work area saved.'],removed:['تم حذف منطقة العمل.','Work area deleted.'],
 failed:['تعذر إتمام الطلب. حاول مرة أخرى.','The request could not be completed. Try again.'],
} as const satisfies Record<string,Pair>;

/** The lines under the map's legend: what the shown area is (or why there is none), or why it could not be read. Nothing without a
 *  connection or a representative (the area is not asked for then). */
export type WorkAreaState={active:boolean;area:WorkAreaInfo|null;areaError:string};
export function workAreaLines(state:WorkAreaState,online:boolean,language:'ar'|'en'):string[]{
 const say=(pair:Pair)=>pair[language==='ar'?0:1],number=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:2});
 if(!online||!state.active)return [];
 const lines:string[]=[],a=state.area;
 if(state.areaError)lines.push(state.areaError);
 if(a?.source==='drawn')lines.push(say(WORK_AREA_TEXT.drawn)+(a.area_km2!==null?' · '+number(a.area_km2)+' '+say(WORK_AREA_TEXT.km2):''));
 if(a?.source==='fallback')lines.push(say(WORK_AREA_TEXT.fallback)+' ('+number(a.pins)+')');
 if(a?.source==='none')lines.push(say(WORK_AREA_TEXT.none));
 return lines;
}

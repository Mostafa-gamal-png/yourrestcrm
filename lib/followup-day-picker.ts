// «شاشة اختيار موعد المتابعة» (the owner, through the GSCO session, 2026-11-19: GSCO 2.13.84, no migration). Where a representative picks
// the next follow-up date of a customer (the new visit, the follow-up executed, an opportunity's specifications), the bare date field
// becomes a picker: the 14 days from tomorrow (Asia/Riyadh), each with how many follow-ups the customer's representative already has that
// day, the weekly day off (Friday: lib/working-hours.ts) grey, a full day (more than 5) red, the follow-ups near this customer (2 km or
// less from its pin), the day's «areas» (a chain of its follow-ups each within 2 km of the next: single-linkage clustering), a scattered
// day (3 areas or more), a suggestion and what the chosen day means.
// - A follow-up is what Yourrest's follow-ups page lists (lib/customer-followups.ts customerFollowupPlans): a customer's latest plan that is
//   still followed (open, or lost with a re-contact date: lib/followup-recontact.ts planTracked), with its next action and a real date,
//   counted for the customer's representative (customer.assignedTo, the page's «المندوب المسؤول»). The customer being visited is left out
//   wherever its plan stands: the new date replaces it, so it is never counted twice.
// - A customer's place is its pin (lib/customer-location.ts customerCoordinates); a follow-up of a customer without one has no nearness and
//   no area; a customer being visited without one shows the counts only.
// - The district of GSCO is the customer's city here (Yourrest stores the city and the region, no district): the most common city of the
//   day's follow-ups, else its most common region.
// Pure, no clock of its own: the page passes today's Riyadh day (lib/crm.ts today), the tests any day.
import type {Row} from './crm';
import {customerFollowupPlans} from './customer-followups';
import {customerCoordinates,type Coordinates} from './customer-location';
import {calendarDay,isWorkingDay,riyadhDay} from './daily-target';

/** How many days the grid shows, from tomorrow. */
export const PICKER_DAYS=14;
/** A day with more follow-ups than this is full (a warning only: it can still be chosen). */
export const FULL_DAY_LIMIT=5;
/** Near: within this many kilometres of the customer's pin; also the link of an area. */
export const NEAR_KM=2;
/** Far: more than this many kilometres from the customer's pin. */
export const FAR_KM=5;
/** A day of this many areas or more is scattered. */
export const SCATTERED_AREAS=3;

export type PickerFollowup={customerId:string;date:string;point:Coordinates|null;city:string;region:string};
/** place: where the day's located follow-ups are (their most common city, else their most common region), with `placeKind`. */
export type PickerDay={date:string;offDay:boolean;count:number;full:boolean;near:number;areas:number;scattered:boolean;nearestKm:number|null;place:string;placeKind:'city'|'region'|''};
export type PickerView={today:string;here:Coordinates|null;days:PickerDay[];best:PickerDay|null;byDate:Map<string,PickerFollowup[]>};
export type DayVerdict={kind:'scattered';areas:number;near:number}|{kind:'near';near:number}|{kind:'far';km:number;place:string;placeKind:'city'|'region'|''}|{kind:'none'};

const DAY_MS=86400000;
/** The calendar day `days` after a day written YYYY-MM-DD (negative before it); '' for anything that is not a real day. */
export function addDays(date:string,days:number):string{
 const day=calendarDay(date);if(!day)return '';
 return new Date(Date.parse(day+'T00:00:00Z')+days*DAY_MS).toISOString().slice(0,10);
}
/** The grid's days: the 14 Riyadh days from tomorrow. `today` is a day (YYYY-MM-DD) or a moment (its Riyadh day). */
export function pickerDates(today:string|number|Date=new Date(),count=PICKER_DAYS):string[]{
 const day=typeof today==='string'&&calendarDay(today)?calendarDay(today):riyadhDay(today);
 return Array.from({length:count},(_,i)=>addDays(day,i+1));
}
/** The great-circle distance in kilometres (haversine, the Earth a sphere of 6371 km, as lib/journeys.ts distanceMeters). */
export function haversineKm(a:Coordinates,b:Coordinates):number{
 const rad=Math.PI/180,dlat=(b.latitude-a.latitude)*rad,dlon=(b.longitude-a.longitude)*rad;
 const h=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;
 return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
/** How many areas the points make: two points share an area when a chain of points, each within `linkKm` of the next, joins them
 *  (single-linkage clustering, by a union-find over every pair). */
export function areaCount(points:Coordinates[],linkKm=NEAR_KM):number{
 const parent=points.map((_,i)=>i);
 const root=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)if(haversineKm(points[i],points[j])<=linkKm){const a=root(i),b=root(j);if(a!==b)parent[b]=a;}
 return new Set(points.map((_,i)=>root(i))).size;
}
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
/** The follow-ups of one representative (customerFollowupPlans: open or kept for a re-contact, with a next action and a real date), the
 *  customer being visited left out. */
export function ownerFollowups(records:Row[],ownerId:string,excludeCustomerId?:string|readonly string[]):PickerFollowup[]{
 if(!ownerId)return [];
 const excluded=new Set(typeof excludeCustomerId==='string'?[excludeCustomerId]:excludeCustomerId||[]);
 return customerFollowupPlans(records).flatMap(plan=>{
  const date=calendarDay(plan.nextDate);
  if(plan.closed||plan.responsibleId!==ownerId||excluded.has(plan.customer.id)||!date||!plan.nextAction.trim())return [];
  const data=plan.customer.data||{};
  return [{customerId:plan.customer.id,date,point:customerCoordinates(data),city:text(data.city),region:text(data.region)}];
 });
}
/** The most common non-empty value (the first met wins a tie). */
function mostCommon(values:string[]):string{
 const counts=new Map<string,number>();let best='',most=0;
 for(const value of values){if(!value)continue;const n=(counts.get(value)||0)+1;counts.set(value,n);if(n>most){most=n;best=value;}}
 return best;
}
/** Where a day's follow-ups are: their most common city, else their most common region («الشرقية», as the data writes it). */
export function placeOf(items:PickerFollowup[]):{place:string;placeKind:'city'|'region'|''}{
 const city=mostCommon(items.map(item=>item.city));if(city)return {place:city,placeKind:'city'};
 const region=mostCommon(items.map(item=>item.region.replace(/^المنطقة\s+/,'')));
 return region?{place:region,placeKind:'region'}:{place:'',placeKind:''};
}
/** One day: its count, full or not, the weekly day off, and (only with the customer's pin) its near follow-ups, areas and nearest one. */
export function dayStats(date:string,items:PickerFollowup[],here:Coordinates|null):PickerDay{
 const count=items.length,located=here?items.filter(item=>item.point):[];
 const distances=here?located.map(item=>haversineKm(here,item.point!)):[];
 const areas=here?areaCount(located.map(item=>item.point!)):0;
 return {date,offDay:!isWorkingDay(date),count,full:count>FULL_DAY_LIMIT,near:distances.filter(km=>km<=NEAR_KM).length,areas,scattered:areas>=SCATTERED_AREAS,
  nearestKm:distances.length?Math.min(...distances):null,...(here?placeOf(located):{place:'',placeKind:''})};
}
/** «الأنسب»: among the days that are neither full nor the weekly day off, the most near follow-ups, then the fewest areas, then the earliest;
 *  when no day has a near one, the lightest (fewest follow-ups, then the earliest); none when every day is full or off. */
export function bestDay(days:PickerDay[]):PickerDay|null{
 const open=days.filter(day=>!day.full&&!day.offDay);
 const near=open.filter(day=>day.near>0);
 if(near.length)return [...near].sort((a,b)=>b.near-a.near||a.areas-b.areas||a.date.localeCompare(b.date))[0];
 return [...open].sort((a,b)=>a.count-b.count||a.date.localeCompare(b.date))[0]||null;
}
/** A distance as the words write it: one decimal under 10 km (5.4), whole kilometres from 10. */
export const kmText=(km:number)=>km<10?Math.round(km*10)/10:Math.round(km);
/** What the chosen day means for this customer: scattered (3 areas or more, with how many are near), near, far (the nearest more than
 *  5 km away, with where the day's follow-ups are), or nothing to say (no pin, no located follow-up, or between 2 and 5 km). */
export function dayVerdict(day:PickerDay):DayVerdict{
 if(day.nearestKm===null)return {kind:'none'};
 if(day.scattered)return {kind:'scattered',areas:day.areas,near:day.near};
 if(day.near>0)return {kind:'near',near:day.near};
 if(day.nearestKm>FAR_KM)return {kind:'far',km:kmText(day.nearestKm),place:day.place,placeKind:day.placeKind};
 return {kind:'none'};
}
/** Everything the picker draws for a customer of a representative: the 14 days, the suggestion and the follow-ups by day (for a day chosen
 *  outside the grid). `customer` absent (none chosen yet, or one being created): the counts of `ownerId` only. */
export function pickerView(records:Row[],{ownerId,customer,today,moving=[]}:{ownerId:string;customer?:Row;today:string;
 /** «ترحيل إلى تاريخ…» of «خطة الغد» (2026-11-22, GSCO 2.13.85): several follow-ups moved to one day together. Their customers are left out
  *  of every day (as the customer being visited), and a day is full, and never the suggestion, when they would make it full: more than 5
  *  with them all. */
 moving?:readonly string[]}):PickerView{
 const here=customer?customerCoordinates(customer.data||{}):null;
 const byDate=new Map<string,PickerFollowup[]>();
 for(const item of ownerFollowups(records,ownerId,[...(customer?[customer.id]:[]),...moving])){const list=byDate.get(item.date);if(list)list.push(item);else byDate.set(item.date,[item]);}
 const adding=moving.length>1?moving.length:0;
 const days=pickerDates(today).map(date=>{const day=dayStats(date,byDate.get(date)||[],here);return adding?{...day,full:day.count+adding>FULL_DAY_LIMIT}:day;});
 return {today,here,days,best:bestDay(days),byDate};
}
/** A day of the view, inside the grid or not ('' and a date that is not real: null). */
export function viewDay(view:PickerView,date:string):PickerDay|null{
 const day=calendarDay(date);if(!day)return null;
 return view.days.find(item=>item.date===day)||dayStats(day,view.byDate.get(day)||[],view.here);
}

// ---- Words (Modern Standard Arabic and English). `owner`: the representative's name when the reader is someone else (a supervisor
// editing a representative's customer), '' for the reader's own follow-ups.
export type PickerLanguage='ar'|'en';
const AR_DAYS=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'],AR_SHORT=['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
const EN_DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],EN_SHORT=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const AR_MONTHS=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const EN_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const weekday=(date:string)=>new Date(date+'T00:00:00Z').getUTCDay();
/** «الأحد 22 نوفمبر» / "Sunday 22 November", with the year when it is not today's. */
export function dayTitle(date:string,language:PickerLanguage,today=''):string{
 const [year,month,day]=date.split('-').map(Number),yearText=today&&today.slice(0,4)===date.slice(0,4)?'':' '+year;
 return language==='en'?`${EN_DAYS[weekday(date)]} ${day} ${EN_MONTHS[month-1]}${yearText}`:`${AR_DAYS[weekday(date)]} ${day} ${AR_MONTHS[month-1]}${yearText}`;
}
/** The grid's short weekday («أحد» / "Sun") and day and month («22/11»). */
export const weekdayShort=(date:string,language:PickerLanguage)=>(language==='en'?EN_SHORT:AR_SHORT)[weekday(date)];
export const dayMonth=(date:string)=>Number(date.slice(8,10))+'/'+Number(date.slice(5,7));
/** «لا متابعات»، «متابعة واحدة»، «متابعتان»، «3 متابعات»، «11 متابعة» / "no follow-ups", "1 follow-up", "3 follow-ups". */
export function countPhrase(n:number,language:PickerLanguage):string{
 if(language==='en')return n===0?'no follow-ups':n===1?'1 follow-up':n+' follow-ups';
 if(n===0)return 'لا متابعات';if(n===1)return 'متابعة واحدة';if(n===2)return 'متابعتان';
 return n%100>=3&&n%100<=10?n+' متابعات':n+' متابعة';
}
/** «متابعة واحدة قريبة»، «متابعتان قريبتان»، «3 متابعات قريبة» / "1 follow-up near", "3 follow-ups near". */
export function nearPhrase(n:number,language:PickerLanguage):string{
 if(language==='en')return n===1?'1 follow-up near':n+' follow-ups near';
 if(n===1)return 'متابعة واحدة قريبة';if(n===2)return 'متابعتان قريبتان';
 return n%100>=3&&n%100<=10?n+' متابعات قريبة':n+' متابعة قريبة';
}
function areasPhrase(n:number,language:PickerLanguage):string{
 if(language==='en')return n===1?'1 area':n+' areas';
 if(n===1)return 'منطقة واحدة';if(n===2)return 'منطقتين';
 return n%100>=3&&n%100<=10?n+' مناطق':n+' منطقة';
}
export function pickerWords(language:PickerLanguage,owner='',today=''){
 const en=language==='en',say=(ar:string,english:string)=>en?english:ar;
 const cap=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1);
 const yours=owner?say('متابعات '+owner,cap(owner)+'\'s follow-ups'):say('متابعاتك','Your follow-ups');
 return {
  gridLabel:say('الأيام الأربعة عشر القادمة','The next 14 days'),
  otherDate:say('تاريخ آخر','Another date'),
  choose:say('اختيار هذا اليوم','Choose this day'),
  offTag:say('إجازة','Day off'),fullTag:say('ممتلئ','Full'),scatteredTag:say('متفرق','Spread'),
  nearTag:(n:number)=>say('📍 '+n+' قريبة','📍 '+n+' near'),
  legend:(hasPin:boolean)=>say(`الرقم في كل يوم عدد ${owner?'متابعات '+owner:'متابعاتك'} فيه؛ ممتلئ: أكثر من ${FULL_DAY_LIMIT}.`,`The number on each day is ${owner?owner+'\'s':'your'} follow-ups that day; full: more than ${FULL_DAY_LIMIT}.`)
   +(hasPin?say(` 📍 قريبة: على بُعد ${NEAR_KM} كم أو أقل من هذا العميل.`,` 📍 near: within ${NEAR_KM} km of this customer.`):say(' لا موقع محفوظًا لهذا العميل، فلا تظهر المتابعات القريبة.',' This customer has no saved location, so nearness is not shown.')),
  /** The suggestion's banner. */
  best:(day:PickerDay)=>{
   const title=dayTitle(day.date,language,today);
   if(day.near>0)return say(`الأنسب: ${title} — ${nearPhrase(day.near,'ar')} من هذا العميل`,`Best: ${title} — ${nearPhrase(day.near,'en')} this customer`);
   if(!day.count)return owner?say(`الأنسب: ${title} — لا متابعات لدى ${owner} فيه`,`Best: ${title} — ${owner} has no follow-ups that day`):say(`الأنسب: ${title} — لا متابعات لديك فيه`,`Best: ${title} — you have no follow-ups that day`);
   return owner?say(`الأنسب: ${title} — أخف أيام ${owner}: ${countPhrase(day.count,'ar')}`,`Best: ${title} — ${owner}'s lightest day: ${countPhrase(day.count,'en')}`):say(`الأنسب: ${title} — أخف أيامك: ${countPhrase(day.count,'ar')}`,`Best: ${title} — your lightest day: ${countPhrase(day.count,'en')}`);
  },
  /** What a screen reader says of a day of the grid. */
  dayLabel:(day:PickerDay,best:boolean)=>[dayTitle(day.date,language,today)+(en?': ':': ')+countPhrase(day.count,language),
   ...(day.near?[say(nearPhrase(day.near,'ar')+' من هذا العميل',nearPhrase(day.near,'en')+' this customer')]:[]),
   ...(day.full?[say('ممتلئ','full')]:[]),...(day.scattered?[say('متفرق','spread out')]:[]),...(day.offDay?[say('إجازة','day off')]:[]),...(best?[say('الأنسب','best')]:[])].join(en?', ':'، '),
  chosen:(date:string)=>date?say('الموعد المختار: ','Chosen date: ')+dayTitle(date,language,today)+(date===today?say(' (اليوم)',' (today)'):''):say('لم يُحدَّد الموعد بعد.','No date chosen yet.'),
  full:(n:number)=>say(`هذا اليوم ممتلئ: ${countPhrase(n,'ar')} (الحد ${FULL_DAY_LIMIT}). يمكنك اختياره رغم ذلك.`,`This day is full: ${countPhrase(n,'en')} (the limit is ${FULL_DAY_LIMIT}). You can still choose it.`),
  off:(date:string)=>say(`هذا اليوم إجازة أسبوعية (${AR_DAYS[weekday(date)]}). يمكنك اختياره رغم ذلك.`,`This day is the weekly day off (${EN_DAYS[weekday(date)]}). You can still choose it.`),
  verdict:(verdict:DayVerdict)=>{
   if(verdict.kind==='near')return owner?say(`يوم مناسب: لدى ${owner} متابعات قريبة من هذا العميل.`,`A good day: ${owner} has follow-ups near this customer.`):say('يوم مناسب: لديك متابعات قريبة من هذا العميل.','A good day: you have follow-ups near this customer.');
   if(verdict.kind==='far')return verdict.place
    ?say(`${yours} في هذا اليوم في ${verdict.placeKind==='region'?'المنطقة '+verdict.place:verdict.place}، بعيدًا عن هذا العميل (${verdict.km} كم).`,`${yours} on this day are in ${verdict.placeKind==='region'?'the region '+verdict.place:verdict.place}, far from this customer (${verdict.km} km).`)
    :say(`${yours} في هذا اليوم بعيدة عن هذا العميل (${verdict.km} كم).`,`${yours} on this day are far from this customer (${verdict.km} km).`);
   if(verdict.kind==='scattered'){
    const ar=verdict.near===0?'، ولا واحدة منها قريبة من هذا العميل.':verdict.near===1?'، منها واحدة قريبة من هذا العميل.':verdict.near===2?'، منها اثنتان قريبتان من هذا العميل.':`، منها ${verdict.near} قريبة من هذا العميل.`;
    const english=verdict.near===0?'; none of them is near this customer.':verdict.near===1?'; 1 of them is near this customer.':`; ${verdict.near} of them are near this customer.`;
    return say(`${yours} في هذا اليوم متفرقة في ${areasPhrase(verdict.areas,'ar')}${ar}`,`${yours} on this day are spread across ${areasPhrase(verdict.areas,'en')}${english}`);
   }
   return '';
  },
 };
}

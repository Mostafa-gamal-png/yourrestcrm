import type {GateRequirement} from './tracking-gate';
import type {DeviceGate} from './device-status';
import {coverageProblem,type CoverageStatus,type TrackingCoverage} from './tracking-coverage';

type Say=(ar:string,en:string)=>string;
const sayFor=(language:string):Say=>(ar,en)=>language==='en'?en:ar;
/** Riyadh date and time of a stored instant, e.g. 2026-10-12 09:30. */
export function riyadhStamp(value:string|null|undefined){
 const at=Date.parse(value||'');if(!Number.isFinite(at))return '';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
const clockOf=(value:string|null|undefined)=>riyadhStamp(value).slice(11);

export function requirementName(item:GateRequirement,say:Say){
 switch(item){
  case 'consent':return say('الموافقة على التتبع','tracking consent');
  case 'fine_location':return say('الموقع الدقيق','precise location');
  case 'notifications':return say('الإشعارات','notifications');
  case 'background_location':return say('الموقع طوال الوقت','location all the time');
  case 'location_services':return say('خدمة الموقع (GPS)','phone location (GPS)');
  case 'enrollment':return say('تسجيل الهاتف على الحساب','phone enrolment');
 }
}
function gateName(gate:DeviceGate,say:Say){
 switch(gate){
  case 'ok':return say('التتبع يعمل','tracking is working');
  case 'browser':return say('يستخدم المتصفح','using a browser');
  case 'upgrade':return say('إصدار التطبيق قديم ويحتاج تحديثًا','the app version is outdated');
  case 'setup':return say('لم يكتمل تفعيل التتبع','tracking setup is not complete');
  case 'permission':return say('أذونات ناقصة','permissions are missing');
  case 'location_services':return say('خدمة الموقع في الهاتف مغلقة','phone location is off');
  case 'bridge':return say('تعذر الاتصال بخدمة التتبع في التطبيق','cannot reach the tracking service');
 }
}
const deviceName=(device:string,say:Say)=>device==='iphone'?say('آيفون','iPhone'):device==='android'?say('أندرويد','Android'):device==='desktop'?say('حاسوب','a computer'):say('جهاز غير معروف','an unknown device');

/** Short status for a table cell or badge. */
export function coverageLabel(status:CoverageStatus,language:string){
 const say=sayFor(language);
 switch(status){
  case 'tracked':return say('وصلت نقاط الموقع','GPS points arrived');
  case 'never_tracked':return say('لم يُفعَّل التتبع قط','Tracking never activated');
  case 'no_points_today':return say('لم يصل موقع في هذا اليوم','No location this day');
  case 'day_without_points':return say('فُتح يوم تتبع بلا نقاط','Tracking day opened without points');
  case 'rest_day':return say('يوم عطلة','Day off');
  case 'not_started':return say('لم تبدأ ساعات التتبع','Tracking hours have not started');
  case 'future':return say('لم يحن الموعد','Not yet');
 }
}
/** The full sentence a supervisor reads when a day has no GPS. */
export function coverageSentence(entry:TrackingCoverage,language:string){
 const say=sayFor(language);
 switch(entry.status){
  case 'never_tracked':return say('لم يُفعَّل تتبع المسار على هاتف المندوب قط؛ لم تصل منه أي نقطة موقع.','Route tracking has never been activated on this representative’s phone; no location point has ever arrived.');
  case 'no_points_today':return say(`لم يصل أي موقع من هاتف المندوب في هذا اليوم. آخر موقع وصل: ${riyadhStamp(entry.lastPointAt)}.`,`No location arrived from the representative’s phone on this day. The last location arrived: ${riyadhStamp(entry.lastPointAt)}.`);
  case 'day_without_points':return say(`فُتح يوم تتبع الساعة ${clockOf(entry.dayStartedAt)} لكن لم تصل نقاط موقع.`,`A tracking day opened at ${clockOf(entry.dayStartedAt)} but no location points arrived.`);
  case 'rest_day':return say('يوم عطلة (الجمعة)؛ لا يُتوقع تتبع.','Day off (Friday); no tracking is expected.');
  case 'not_started':return say('لم تبدأ ساعات التتبع بعد (من 6 صباحًا بتوقيت السعودية).','Tracking hours have not started yet (from 6 AM Saudi time).');
  case 'future':return say('تاريخ لم يحن بعد.','This date has not arrived.');
  case 'tracked':return say(`وصلت ${entry.pointsOnDate} نقطة موقع.`,`${entry.pointsOnDate} location points arrived.`);
 }
}
/** What the phone itself last said, or why there is nothing to say. */
export function phoneSentence(entry:TrackingCoverage,language:string){
 const say=sayFor(language),phone=entry.phone,browser=entry.browser;
 if(phone){
  const when=riyadhStamp(phone.reportedAt),version=phone.appVersion?say(` · الإصدار ${phone.appVersion}`,` · version ${phone.appVersion}`):'';
  const lead=say(`آخر تقرير من الهاتف ${when}${version}: `,`Last report from the phone ${when}${version}: `);
  if(phone.gate==='ok'){
   const queued=phone.pendingCount>0?say(` توجد ${phone.pendingCount} نقطة محفوظة على الهاتف لم تُرفع بعد.`,` ${phone.pendingCount} points are saved on the phone and not uploaded yet.`):'';
   return lead+gateName('ok',say)+'.'+queued;
  }
  const missing=phone.missing.length?say(' — الناقص: ',' — missing: ')+phone.missing.map(item=>requirementName(item,say)).join(say('، ',', ')):'';
  const detail=phone.error?` (${phone.error})`:'';
  return lead+gateName(phone.gate,say)+missing+detail+'.';
 }
 if(browser)return say(`فتح المندوب النظام من المتصفح (${deviceName(browser.deviceClass,say)}) آخر مرة ${riyadhStamp(browser.reportedAt)}؛ التتبع لا يعمل من المتصفح، ولن يتمكن من العمل إلا من تطبيق أندرويد.`,`The representative last opened the system from a browser (${deviceName(browser.deviceClass,say)}) at ${riyadhStamp(browser.reportedAt)}; tracking does not work from a browser, so they can only work from the Android app.`);
 return say('لم يصل أي تقرير من هاتف المندوب بعد؛ لم يفتح النظام منذ تفعيل إلزام التتبع.','No report has arrived from the representative’s phone yet; they have not opened the system since mandatory tracking was enabled.');
}
/** A reported app version older than the one the site serves; an unknown or malformed version is never judged. */
export function appVersionBehind(installed:string,required:string){
 const parse=(value:string)=>/^\d+\.\d+\.\d+$/.test(value)?value.split('.').map(Number):null,a=parse(installed),b=parse(required);
 if(!a||!b)return false;
 for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]<b[i];
 return false;
}
/** One short line about the phone for a table cell. The full sentence is `phoneSentence`. With `requiredVersion`, a phone
 * whose last report predates the served app is marked outdated even if that report still said tracking was working. */
export function phoneBrief(entry:TrackingCoverage,language:string,requiredVersion=''){
 const say=sayFor(language),phone=entry.phone;
 if(phone){
  const behind=!!requiredVersion&&appVersionBehind(phone.appVersion,requiredVersion);
  const state=behind&&phone.gate==='ok'?say('إصدار قديم؛ المطلوب '+requiredVersion,'outdated; '+requiredVersion+' required'):gateName(phone.gate,say);
  return `${phone.appVersion?say('التطبيق ','App ')+phone.appVersion+' · ':''}${state} · ${riyadhStamp(phone.reportedAt)}`;
 }
 if(entry.browser)return say(`متصفح (${deviceName(entry.browser.deviceClass,say)}) · ${riyadhStamp(entry.browser.reportedAt)}`,`Browser (${deviceName(entry.browser.deviceClass,say)}) · ${riyadhStamp(entry.browser.reportedAt)}`);
 return say('لا تقرير من الهاتف بعد','No phone report yet');
}
export {coverageProblem};

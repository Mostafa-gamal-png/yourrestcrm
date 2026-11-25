// «هاتف مندوب متوقف» (the owner, 2026-11-25: «اعمل التلاتة», item 3: an alert when a representative's phone stays stopped or blocked for more
// than half an hour, before the representative has to complain). Pure: the server keeps, with each phone report, since when the phone has
// been in the same problem (lib/device-status-server.ts saveDeviceReport), and the alert lists the representatives whose phone has been
// in a problem for STUCK_AFTER_MS during the working window (06:00 to 18:00 Riyadh, except Friday). Only what the phone itself reported.
import type {DeviceReport} from './device-status';
import {trackingWindowStatus} from './tracking-window';

/** Half an hour: shorter is a representative still tapping through the permissions, longer leaves them stopped too long. */
export const STUCK_AFTER_MS=30*60_000;

export type PhoneProblem='setup'|'permission'|'location_services'|'bridge'|'upgrade'|'paused';
type ProblemFields=Pick<DeviceReport,'platform'|'gate'|'tracking'|'windowActive'|'enrolled'>;

/** The phone's own problem, or null: the gate holds the app (not enabled, a permission, GPS off, the app not answering, too old), or the
 * enabled app is not recording inside the working window. A browser report is never a phone problem (it has no tracking of its own). */
export function phoneProblem(report:ProblemFields):PhoneProblem|null{
 if(report.platform!=='android-app')return null;
 if(report.gate==='setup'||report.gate==='permission'||report.gate==='location_services'||report.gate==='bridge'||report.gate==='upgrade')return report.gate;
 if(report.gate==='ok'&&report.windowActive&&report.enrolled&&!report.tracking)return 'paused';
 return null;
}

/** Since when the phone has been in its current problem: kept while the problem is the same, now when it starts or changes, empty when the
 * phone is fine. The previous report is the server's own row, never anything the phone sends. */
export function problemSince(previous:{report:ProblemFields;since:string}|null,current:ProblemFields,now:string):string{
 const problem=phoneProblem(current);if(!problem)return '';
 const before=previous?phoneProblem(previous.report):null,since=previous&&Number.isFinite(Date.parse(previous.since))?previous.since:'';
 return before===problem&&since&&since<=now?since:now;
}

export type StuckPhone={memberId:string;memberName:string;problem:PhoneProblem;since:string;minutes:number;reportedAt:string;appVersion:string;error:string};
type Entry={memberId:string;memberName:string;devices:(DeviceReport&{reportedAt:string;problemSince?:string})[]};

/** The representatives whose phone has been in a problem for half an hour or more, now, inside the working window. The newest report of the
 * Android app decides; a report from an earlier day is not news of today (the day's own coverage says a phone stayed silent). The time is
 * counted from the later of the problem's start and today's 06:00, so a phone blocked since yesterday is not «stopped for 15 hours». */
export function stuckPhones(entries:Entry[],now:string):StuckPhone[]{
 const window=trackingWindowStatus(now);if(!window.open)return [];
 const opened=Date.parse(window.startsAt),at=Date.parse(now),out:StuckPhone[]=[];
 for(const entry of entries){
  const phone=entry.devices.filter(d=>d.platform==='android-app').sort((a,b)=>Date.parse(b.reportedAt)-Date.parse(a.reportedAt))[0];
  if(!phone||!Number.isFinite(Date.parse(phone.reportedAt))||trackingWindowStatus(phone.reportedAt).date!==window.date)continue;
  const problem=phoneProblem(phone),since=Date.parse(phone.problemSince||'');
  if(!problem||!Number.isFinite(since))continue;
  const from=Math.max(since,opened);if(at-from<STUCK_AFTER_MS)continue;
  out.push({memberId:entry.memberId,memberName:entry.memberName,problem,since:new Date(from).toISOString(),minutes:Math.floor((at-from)/60_000),reportedAt:phone.reportedAt,appVersion:phone.appVersion,error:phone.error});
 }
 return out.sort((a,b)=>b.minutes-a.minutes||a.memberName.localeCompare(b.memberName,'ar'));
}

/** The problem in words, as the page shows it. */
export function phoneProblemText(problem:PhoneProblem,en:boolean):string{
 const text:Record<PhoneProblem,[string,string]>={
  setup:['تتبع خط السير غير مفعّل على الهاتف','Route tracking is not enabled on the phone'],
  permission:['أذونات الموقع أو الإشعارات ناقصة على الهاتف','Location or notification permissions are missing on the phone'],
  location_services:['خدمة الموقع (GPS) مغلقة على الهاتف','The phone location service (GPS) is off'],
  bridge:['التطبيق لا يستجيب لخدمة التتبع','The app does not answer the tracking service'],
  upgrade:['تطبيق الهاتف قديم ويحتاج إلى تحديث','The phone app is outdated and needs updating'],
  paused:['التتبع مفعّل لكن التسجيل متوقف على الهاتف','Tracking is enabled but recording is stopped on the phone']
 };
 return text[problem][en?1:0];
}

/** «فريقي النهارده» (the owner, 2026-11-10, item 4: «ملخص يومي للمشرف: شاشة فيها مين من فريقه زار النهارده وكام زيارة، ومين ما بدأش يومه،
 * ومين ما قراش ملاحظاته»). One row per member of the reader's «تقرير يوم المندوب» for today (Asia/Riyadh): every active representative
 * the report lists, and another sales member (a supervisor who visits) only when they did something today; never the reader. The words
 * come from the day report itself:
 * - «زيارات النهارده» and «تواصل آخر»: the day report's «زيارات مسجلة» and «تواصل آخر مسجل» (an activity of today, by type: a visit,
 *   or any other contact; follow-ups count by their type like there).
 * - «بدأ يومه»: the earlier of the day report's «أول حركة مرصودة» (lib/daily-report.ts, from the GPS points) and the first visit or
 *   contact recorded today (its recording time, as the day report orders them). Neither: «لسه ما بدأش». The phone's tracking day is
 *   not used: the Android app opens it at 6:00 whenever the phone is on, so it does not say the representative started working.
 * - «ملاحظات مش مقروءة»: the supervisors' notes on that member's work not marked «قرأت», over the inbox window (30 days), exactly as
 *   the member's own card counts them (lib/supervisor-reviews*.ts).
 * Shared by the server (lib/team-today-server.ts) and the page (app/team-today.tsx); names, counts and times only. */
export type TeamTodayStartSource='movement'|'record';
export type TeamTodayRow={memberId:string;name:string;role:string;visits:number;contacts:number;startedAt:string|null;startedBy:TeamTodayStartSource|null;unreadNotes:number};
export type TeamTodayTotals={members:number;started:number;visits:number;contacts:number;unreadNotes:number};
export type TeamToday={ok:true;date:string;serverTime:string;workingDay:boolean;windowStartsAt:string;rows:TeamTodayRow[];totals:TeamTodayTotals};
/** The card asks again every 5 minutes while the page is in front, and when it comes back to the front at most once a minute. */
export const TEAM_TODAY_INTERVAL_MS=5*60_000,TEAM_TODAY_FOCUS_MS=60_000;

const at=(value:string|null|undefined)=>{const time=Date.parse(value||'');return Number.isFinite(time)?time:Infinity;};
/** The start of the day: the earlier of the first observed movement and the first recorded visit or contact. */
export function dayStart(movementAt:string|null|undefined,firstRecordAt:string|null|undefined):{startedAt:string|null;startedBy:TeamTodayStartSource|null}{
 const movement=at(movementAt),record=at(firstRecordAt);
 if(movement===Infinity&&record===Infinity)return{startedAt:null,startedBy:null};
 return movement<=record?{startedAt:new Date(movement).toISOString(),startedBy:'movement'}:{startedAt:new Date(record).toISOString(),startedBy:'record'};
}
/** Those who have not started first, then the fewest visits, then the fewest other contacts, then by name. */
export function sortTeamToday(rows:readonly TeamTodayRow[]):TeamTodayRow[]{
 return [...rows].sort((a,b)=>Number(!!a.startedAt)-Number(!!b.startedAt)||a.visits-b.visits||a.contacts-b.contacts||a.name.localeCompare(b.name,'ar')||a.memberId.localeCompare(b.memberId));
}
export function teamTodayTotals(rows:readonly TeamTodayRow[]):TeamTodayTotals{
 return rows.reduce((sum,row)=>({members:sum.members+1,started:sum.started+(row.startedAt?1:0),visits:sum.visits+row.visits,contacts:sum.contacts+row.contacts,unreadNotes:sum.unreadNotes+row.unreadNotes}),{members:0,started:0,visits:0,contacts:0,unreadNotes:0});
}

const text=(value:unknown)=>typeof value==='string';
const count=(value:unknown)=>Number.isInteger(value)&&(value as number)>=0;
const validRow=(value:unknown):value is TeamTodayRow=>{
 if(!value||typeof value!=='object')return false;
 const row=value as Record<string,unknown>;
 return ['memberId','name','role'].every(key=>text(row[key]))&&['visits','contacts','unreadNotes'].every(key=>count(row[key]))&&(row.startedAt===null&&row.startedBy===null||text(row.startedAt)&&(row.startedBy==='movement'||row.startedBy==='record'));
};
/** What the page accepts from GET /api/team-today. */
export const validTeamToday=(value:unknown):value is TeamToday=>{
 if(!value||typeof value!=='object')return false;
 const body=value as Record<string,unknown>,totals=body.totals as Record<string,unknown>|undefined;
 return body.ok===true&&text(body.date)&&text(body.serverTime)&&typeof body.workingDay==='boolean'&&text(body.windowStartsAt)&&Array.isArray(body.rows)&&body.rows.every(validRow)&&!!totals&&['members','started','visits','contacts','unreadNotes'].every(key=>count(totals[key]));
};

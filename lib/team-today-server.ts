import type {Member,Row} from './crm';
import {salesScopeMemberIds,recordAuthorId} from './access';
import {visitCustomer} from './customer-visits';
import {buildDailyReport} from './daily-report';
import {trackingMembers} from './device-status-server';
import {journeyDate,projectJourneyWindow,type JourneyPoint,type JourneyReportStop} from './journeys';
import {journeyColumns,decodeJourney,canReadJourney,type JourneyContext,type JourneyRow} from './journeys-server';
import {mobileReportDays} from './mobile-route-server';
import {REVIEW_INBOX_DAYS,entryReadIdSql,dayReadIdSql} from './supervisor-reviews';
import {trackingWindowStart,trackingWorkingDay} from './tracking-window';
import {dayStart,sortTeamToday,teamTodayTotals,type TeamToday,type TeamTodayRow} from './team-today';

/** GET /api/team-today (lib/team-today.ts): today's row for each member of the reader's «تقرير يوم المندوب», read with the day report's
 * own rules and scope (salesScopeMemberIds {read}, the regions, canReadJourney, canReadMobileDay), so a row never says more than the
 * reader's day report of that member would. Names, counts and times only: no customer, place or note text. */
const SALES_ROLES=['admin','manager','supervisor','rep'];
/** When an activity was recorded: the device's time for one saved offline (offlineRecordedAt), else when the server stored it. */
const recordedAt=(row:Row)=>typeof row.data.offlineRecordedAt==='string'&&Number.isFinite(Date.parse(row.data.offlineRecordedAt))?row.data.offlineRecordedAt:row.createdAt;

export async function readTeamToday(c:JourneyContext,now=new Date().toISOString()):Promise<TeamToday>{
 const date=journeyDate(now),nowMs=Date.parse(now),scope=salesScopeMemberIds(c.members,c.me,{read:true});
 // Today's visits and other contacts, as the day report lists them (GET /api/journeys: an activity dated today, by a member of the
 // scope, with its customer), and the first one recorded today.
 const tally=new Map<string,{visits:number;contacts:number;first:string|null}>();
 for(const row of c.visible){
  if(row.kind!=='activity'||(row.data.date||journeyDate(row.createdAt))!==date)continue;
  const author=recordAuthorId(row,c.members);
  if(!author||!scope.has(author)||!visitCustomer(row,c.visible))continue;
  const entry=tally.get(author)||{visits:0,contacts:0,first:null};
  if(row.data.type==='visit')entry.visits++;else entry.contacts++;
  const recorded=recordedAt(row),time=Date.parse(recorded);
  if(Number.isFinite(time)&&time<=nowMs&&journeyDate(recorded)===date&&(!entry.first||time<Date.parse(entry.first)))entry.first=new Date(time).toISOString();
  tally.set(author,entry);
 }
 // The GPS evidence of today the reader may read: the phones' tracking days and the customers selected on the route, with their points.
 const days=await mobileReportDays(c,date,'all',now);
 const stored=(await c.db.prepare('SELECT '+journeyColumns+' FROM crm_journey_stops WHERE date=? ORDER BY selected_at,id').bind(date).all<JourneyRow>()).results.map(decodeJourney).filter(stop=>canReadJourney(stop,c));
 const points=new Map<string,JourneyPoint[]>();
 if(stored.length){
  const rows=(await c.db.prepare('SELECT stop_id AS stopId,point_id AS id,captured_at AS capturedAt,received_at AS receivedAt,latitude,longitude,accuracy FROM crm_journey_points WHERE stop_id IN (SELECT value FROM json_each(?)) ORDER BY captured_at,point_id').bind(JSON.stringify(stored.map(stop=>stop.id))).all<JourneyPoint&{stopId:string}>()).results;
  for(const {stopId,...point} of rows)points.set(stopId,[...(points.get(stopId)||[]),point]);
 }
 const stops:JourneyReportStop[]=stored.map(stop=>({...projectJourneyWindow(stop,now),memberName:'',points:points.get(stop.id)||[],segments:[],results:[]}));
 // «أول حركة مرصودة» of one member: the day report's own summary, built from that member's days and stops only.
 const firstMovement=(memberId:string)=>buildDailyReport({date,memberId,members:[],stops,communications:[],mobileDays:days,serverTime:now},[],[],[]).summary.firstMovementAt;
 // Who has a row: every active representative the day report lists for the reader (trackingMembers: the same people, regions and
 // hierarchy), and another active sales member of the scope only on a day they did something; never the reader.
 const tracked=new Set([...days.map(day=>day.memberId),...stops.map(stop=>stop.memberId)]);
 const people:Member[]=trackingMembers(c).filter(member=>member.id!==c.me.id);
 for(const member of c.members)if(member.id!==c.me.id&&member.role!=='rep'&&SALES_ROLES.includes(member.role)&&!!member.active&&scope.has(member.id)&&(tally.has(member.id)||tracked.has(member.id)))people.push(member);
 const rows:TeamTodayRow[]=[];
 for(const member of people){
  const entry=tally.get(member.id),movement=tracked.has(member.id)?firstMovement(member.id):null;
  if(member.role!=='rep'&&!entry&&!movement)continue;
  rows.push({memberId:member.id,name:member.name,role:member.role,visits:entry?.visits||0,contacts:entry?.contacts||0,...dayStart(movement,entry?.first),unreadNotes:0});
 }
 // The notes on each one's work not marked «قرأت», over the window their own card shows (lib/supervisor-reviews-server.ts reviewInbox).
 if(rows.length){
  const ids=JSON.stringify(rows.map(row=>row.memberId)),since=new Date(nowMs-REVIEW_INBOX_DAYS*86_400_000).toISOString();
  const unread=(await c.db.prepare(`SELECT memberId,COUNT(*) AS n FROM (
   SELECT r.member_id AS memberId FROM crm_daily_entry_reviews r WHERE r.member_id IN (SELECT value FROM json_each(?)) AND r.updated_at>=? AND NOT EXISTS (SELECT 1 FROM crm_audit ra WHERE ra.id=${entryReadIdSql})
   UNION ALL SELECT r.member_id AS memberId FROM crm_daily_report_reviews r WHERE r.member_id IN (SELECT value FROM json_each(?)) AND r.updated_at>=? AND NOT EXISTS (SELECT 1 FROM crm_audit ra WHERE ra.id=${dayReadIdSql})
  ) GROUP BY memberId`).bind(ids,since,ids,since).all<{memberId:string;n:number}>()).results;
  const counts=new Map(unread.map(row=>[row.memberId,Number(row.n)||0]));
  for(const row of rows)row.unreadNotes=counts.get(row.memberId)||0;
 }
 const sorted=sortTeamToday(rows);
 return{ok:true,date,serverTime:now,workingDay:trackingWorkingDay(date),windowStartsAt:trackingWindowStart(date),rows:sorted,totals:teamTodayTotals(sorted)};
}

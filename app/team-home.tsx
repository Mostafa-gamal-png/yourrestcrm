'use client';
import {useMemo} from 'react';
import {today,type Member,type Row} from '@/lib/crm';
import {canUseSalesWorkspace} from '@/lib/access';
import {pageAllowed} from '@/lib/permissions';
import {inactiveAlertMode,teamInactiveBreakdown} from '@/lib/inactive-customers';
import {OwnInactiveCard,TeamInactiveCard} from './inactive-customers';
import {TeamTodayCard} from './team-today';
import {ReviewPendingCard} from './review-pending';
import {reviewPendingRole} from '@/lib/supervisor-reviews';
import {CustomerEditInbox} from './customer-edit-requests';
import './team-home.css';

/** The top of the member's first screen (the dashboard; a representative, who has none, their «الزيارات»): for a supervisor or a sales
 * manager first the red card «زيارات ومتابعات بلا نتيجة أو إجراء» (app/review-pending.tsx; never the administrator), then «عملاء واقفين» (lib/
 * inactive-customers.ts) and, for those who read «تقرير يوم المندوب», «فريقي اليوم» (lib/team-today.ts). The red card and «فريقي اليوم» need
 * «تقرير يوم المندوب» not hidden from the member. onDayReport opens the day report on a member, and on a day when one is given (today
 * otherwise). Right under the red card (alone when the member has no other card, customer service included), «طلبات تعديل بيانات
 * العملاء» (app/customer-edit-requests.tsx): what the member may decide and their own requests, nothing when there is none; onCustomer
 * opens a customer's details, onChanged reloads the data after a decision. */
export default function TeamHome({me,members,customers,ownInactive,offline,onCustomers,onDayReport,onCustomer,onChanged,planCard}:{me:Member;members:Member[];customers:Row[];ownInactive:number;offline:boolean;onCustomers:(memberId:string)=>void;onDayReport:(memberId:string,date?:string)=>void;onCustomer?:(customerId:string)=>void;onChanged?:()=>void;/** «خطة اليوم» of a field member (app/my-plan.tsx TodayPlanCard, 2026-11-22): opens «خطتي». */planCard?:React.ReactNode}){
 const mode=inactiveAlertMode(me);
 const team=useMemo(()=>mode==='team'?teamInactiveBreakdown(me,members,customers,today()):null,[mode,me,members,customers]);
 const teamToday=canUseSalesWorkspace(me.role)&&pageAllowed(me,'journeys');
 const pendingCard=reviewPendingRole(me.role)&&pageAllowed(me,'journeys');
 const own=mode==='own'?ownInactive:0;
 const edits=<CustomerEditInbox key={me.id+':'+(me.authVersion||0)} offline={offline} onOpenCustomer={onCustomer} onChanged={onChanged}/>;
 if(!own&&!team?.total&&!teamToday&&!pendingCard)return planCard?<>{planCard}{edits}</>:edits;
 return <div className="team-home no-print">
  {planCard}
  {pendingCard&&<ReviewPendingCard key={me.id+':'+(me.authVersion||0)} me={me} offline={offline} onDayReport={onDayReport}/>}
  {edits}
  {own>0&&<OwnInactiveCard count={own} onOpen={()=>onCustomers(me.id)}/>}
  {!!team?.total&&<TeamInactiveCard data={team} onOpen={onCustomers}/>}
  {teamToday&&<TeamTodayCard key={me.id+':'+(me.authVersion||0)} me={me} offline={offline} onDayReport={memberId=>onDayReport(memberId)}/>}
 </div>;
}

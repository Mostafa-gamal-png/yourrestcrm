'use client';
import {useMemo} from 'react';
import {today,type Member,type Row} from '@/lib/crm';
import {canUseSalesWorkspace} from '@/lib/access';
import {pageAllowed} from '@/lib/permissions';
import {inactiveAlertMode,teamInactiveBreakdown} from '@/lib/inactive-customers';
import {OwnInactiveCard,TeamInactiveCard} from './inactive-customers';
import {TeamTodayCard} from './team-today';
import './team-home.css';

/** The top of the member's first screen (the dashboard; a representative, who has none, their «الزيارات»): «عملاء واقفين» (lib/
 * inactive-customers.ts) and, for those who read «تقرير يوم المندوب», «فريقي النهارده» (lib/team-today.ts). Nothing for customer service. */
export default function TeamHome({me,members,customers,ownInactive,offline,onCustomers,onDayReport}:{me:Member;members:Member[];customers:Row[];ownInactive:number;offline:boolean;onCustomers:(memberId:string)=>void;onDayReport:(memberId:string)=>void}){
 const mode=inactiveAlertMode(me);
 const team=useMemo(()=>mode==='team'?teamInactiveBreakdown(me,members,customers,today()):null,[mode,me,members,customers]);
 const teamToday=canUseSalesWorkspace(me.role)&&pageAllowed(me,'journeys');
 const own=mode==='own'?ownInactive:0;
 if(!own&&!team?.total&&!teamToday)return null;
 return <div className="team-home no-print">
  {own>0&&<OwnInactiveCard count={own} onOpen={()=>onCustomers(me.id)}/>}
  {!!team?.total&&<TeamInactiveCard data={team} onOpen={onCustomers}/>}
  {teamToday&&<TeamTodayCard key={me.id+':'+(me.authVersion||0)} me={me} offline={offline} onDayReport={onDayReport}/>}
 </div>;
}

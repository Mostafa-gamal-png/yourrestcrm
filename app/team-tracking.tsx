'use client';
import React,{createContext,useContext,useEffect,useState} from 'react';
import type {Member} from '@/lib/crm';
import {canUseSalesWorkspace} from '@/lib/access';
import {useLanguage} from '@/lib/i18n';
import {buildTrackingCoverage,type TrackingCoverage,type TrackingOverview} from '@/lib/tracking-coverage';
import {coverageLabel,phoneBrief,riyadhStamp} from '@/lib/tracking-coverage-text';
import './team-tracking.css';

type State={status:'loading'|'ready'|'error';byMember:Map<string,TrackingCoverage>};
const Data=createContext<State>({status:'loading',byMember:new Map()});
/** Only the roles that already read the daily route report may see where each representative's GPS stands. */
export const canSeeTeamTracking=(me:Member|null)=>!!me&&canUseSalesWorkspace(me.role);

/** Loads, once, the same tracking state the daily report uses. Mount it with `enabled` false to skip the request. */
export function TeamTrackingData({enabled,children}:{enabled:boolean;children:React.ReactNode}){
 const [state,setState]=useState<State>({status:'loading',byMember:new Map()});
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();
  void fetch('/api/device-status',{cache:'no-store',credentials:'same-origin',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error(String(response.status));
   const body=await response.json() as {date:string;serverTime:string;members:TrackingOverview[]};
   if(!controller.signal.aborted)setState({status:'ready',byMember:new Map(buildTrackingCoverage(body.members,body.date,body.serverTime).map(entry=>[entry.memberId,entry]))});
  }).catch(()=>{if(!controller.signal.aborted)setState({status:'error',byMember:new Map()});});
  return()=>controller.abort();
 },[enabled]);
 return <Data.Provider value={state}>{children}</Data.Provider>;
}

export function TeamTrackingCell({member}:{member:Member}){
 const {language}=useLanguage(),state=useContext(Data),entry=state.byMember.get(member.id);
 if(member.role!=='rep'||!member.active)return <span className="team-tracking-none">—</span>;
 if(state.status==='loading')return <span className="team-tracking-none" aria-busy="true">…</span>;
 if(!entry)return <span className="team-tracking-none">—</span>;
 return <div className="team-tracking" data-status={entry.status} data-member={member.id}>
  <span className="team-tracking-badge">{coverageLabel(entry.status,language)}</span>
  {entry.lastPointAt&&entry.status!=='tracked'&&<small>{language==='en'?'Last location: ':'آخر موقع: '}{riyadhStamp(entry.lastPointAt)}</small>}
  {entry.status==='tracked'&&<small>{language==='en'?`${entry.pointsOnDate} points today`:`${entry.pointsOnDate} نقطة اليوم`}</small>}
  <small>{phoneBrief(entry,language)}</small>
 </div>;
}

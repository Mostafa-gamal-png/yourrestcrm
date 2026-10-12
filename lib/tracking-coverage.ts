import {trackingWindowStart,trackingWindowStatus,trackingWorkingDay} from './tracking-window';
import type {DeviceStatusPublic} from './device-status';

/** What reached the server for one representative, as read from the tracking tables and the phone's own reports. */
export type TrackingOverview={memberId:string;memberName:string;devices:DeviceStatusPublic[];lastPointAt:string|null;dayStartedAt:string|null;pointsOnDate:number;tripsOnDate:number};
/** `tracked`: GPS points arrived that day. The next three explain a missing day; the last three mean none were expected. */
export type CoverageStatus='tracked'|'day_without_points'|'no_points_today'|'never_tracked'|'rest_day'|'not_started'|'future';
export type TrackingCoverage={
 memberId:string;memberName:string;status:CoverageStatus;
 pointsOnDate:number;tripsOnDate:number;dayStartedAt:string|null;lastPointAt:string|null;
 /** Newest report from the installed Android app, and from a browser the representative tried to use. */
 phone:DeviceStatusPublic|null;browser:DeviceStatusPublic|null;
};
/** A day that should have had tracking but has no GPS points. */
export const COVERAGE_PROBLEMS:readonly CoverageStatus[]=['day_without_points','no_points_today','never_tracked'];
export const coverageProblem=(status:CoverageStatus)=>COVERAGE_PROBLEMS.includes(status);

export function coverageStatus(entry:Pick<TrackingOverview,'pointsOnDate'|'dayStartedAt'|'lastPointAt'>,date:string,serverTime:string):CoverageStatus{
 if(entry.pointsOnDate>0)return 'tracked';
 const now=Date.parse(serverTime),today=trackingWindowStatus(serverTime).date;
 if(date>today)return 'future';
 if(!trackingWorkingDay(date))return 'rest_day';
 if(date===today&&now<Date.parse(trackingWindowStart(date)))return 'not_started';
 if(entry.dayStartedAt)return 'day_without_points';
 return entry.lastPointAt?'no_points_today':'never_tracked';
}

const newest=(devices:DeviceStatusPublic[],platform:DeviceStatusPublic['platform'])=>devices.filter(d=>d.platform===platform).sort((a,b)=>Date.parse(b.reportedAt)-Date.parse(a.reportedAt))[0]??null;

export function buildTrackingCoverage(overview:TrackingOverview[],date:string,serverTime:string):TrackingCoverage[]{
 return overview.map(entry=>({
  memberId:entry.memberId,memberName:entry.memberName,status:coverageStatus(entry,date,serverTime),
  pointsOnDate:entry.pointsOnDate,tripsOnDate:entry.tripsOnDate,dayStartedAt:entry.dayStartedAt,lastPointAt:entry.lastPointAt,
  phone:newest(entry.devices,'android-app'),browser:newest(entry.devices,'browser')
 }));
}

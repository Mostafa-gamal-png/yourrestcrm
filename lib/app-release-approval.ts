// «اعتماد التحديث للجميع» (item 2 of the three the owner approved on 2026-11-25 with «اعمل التلاتة»: a new Android release is tried on a real
// phone for ten minutes before every phone must have it). An Android release published since then is a pilot: lib/app-update-pilots.json
// lists it and its file is on the site, but
// /api/app-update keeps serving the newest approved release as the mandatory one (lib/app-update-release.json is the base, approved when it
// was published). The owner installs the pilot on a real phone, tries it, and approves it from the workspace; from then the newest pilot at
// or below the approved version code is served, and every phone older than it must update (lib/app-update.ts, unchanged). Pure apart from
// the settings row (crm_settings, id APP_RELEASE_APPROVAL, the JSON in owner_id, like the other states: no migration).
import base from './app-update-release.json';
import pilots from './app-update-pilots.json';
import {parseAppRelease,type AppRelease} from './app-update';

export const APP_RELEASE_APPROVAL='android-release-approval';
export type ReleaseApproval={versionCode:number;approvedBy:string;approvedAt:string};
type Manifest=typeof base;

/** The published manifests: the base and every pilot that parses as a release of this app (a broken entry is never served or offered). */
export function publishedReleases(baseManifest:unknown=base,pilotManifests:unknown=pilots):{base:Manifest;pilots:Manifest[]}{
 const valid=(value:unknown)=>{try{parseAppRelease(value);return true;}catch{return false;}};
 const list=Array.isArray(pilotManifests)?pilotManifests.filter(valid) as Manifest[]:[];
 return {base:baseManifest as Manifest,pilots:list.filter(item=>item.versionCode>(baseManifest as Manifest).versionCode).sort((a,b)=>a.versionCode-b.versionCode)};
}
/** What /api/app-update serves: the newest of the base and the approved pilots. Nothing approved, or an approval of an unknown version,
 * serves the base; an approval never lowers what is served. */
export function servedRelease(approvedCode:number|null,published=publishedReleases()):Manifest{
 const approved=published.pilots.filter(item=>approvedCode!==null&&item.versionCode<=approvedCode);
 return approved.at(-1)||published.base;
}
/** The newest pilot not yet approved, for the owner to try: null when there is none. */
export function pendingPilot(approvedCode:number|null,published=publishedReleases()):Manifest|null{
 return published.pilots.filter(item=>approvedCode===null||item.versionCode>approvedCode).at(-1)||null;
}
export function parseApproval(raw:string|null|undefined):ReleaseApproval|null{
 if(!raw)return null;
 try{const value=JSON.parse(raw) as Partial<ReleaseApproval>;return Number.isSafeInteger(value.versionCode)&&(value.versionCode as number)>0&&typeof value.approvedBy==='string'&&typeof value.approvedAt==='string'&&Number.isFinite(Date.parse(value.approvedAt))?{versionCode:value.versionCode as number,approvedBy:value.approvedBy,approvedAt:value.approvedAt}:null;}catch{return null;}
}
export async function readReleaseApproval(db:D1Database):Promise<ReleaseApproval|null>{
 const row=await db.prepare('SELECT owner_id AS raw FROM crm_settings WHERE id=?').bind(APP_RELEASE_APPROVAL).first<{raw:string}>();
 return parseApproval(row?.raw);
}
/** Approving a pilot approves every older one too; an approval is never moved back (a lower version than the approved one is refused). The
 * statement keeps the row only if it is still the one read, so two approvals at once cannot lower it. */
export async function approveRelease(db:D1Database,versionCode:number,memberId:string,now:string,published=publishedReleases()):Promise<'approved'|'unknown'|'older'|'changed'>{
 if(!published.pilots.some(item=>item.versionCode===versionCode))return 'unknown';
 const row=await db.prepare('SELECT owner_id AS raw FROM crm_settings WHERE id=?').bind(APP_RELEASE_APPROVAL).first<{raw:string}>(),current=parseApproval(row?.raw);
 if(current&&current.versionCode>=versionCode)return 'older';
 const next=JSON.stringify({versionCode,approvedBy:memberId,approvedAt:now} satisfies ReleaseApproval);
 const result=row
  ?await db.prepare('UPDATE crm_settings SET owner_id=? WHERE id=? AND owner_id=?').bind(next,APP_RELEASE_APPROVAL,row.raw).run()
  :await db.prepare('INSERT INTO crm_settings(id,owner_id) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM crm_settings WHERE id=?)').bind(APP_RELEASE_APPROVAL,next,APP_RELEASE_APPROVAL).run();
 return Number(result.meta?.changes??0)===1?'approved':'changed';
}
/** The pilot as the owner's card shows it: what is needed to try it, never anything from the database. */
export function pilotView(pilot:Manifest|null):{versionName:string;versionCode:number;apkPath:string;sizeBytes:number;notes:AppRelease['releaseNotes']}|null{
 if(!pilot)return null;
 const release=parseAppRelease(pilot);
 return {versionName:release.versionName,versionCode:release.versionCode,apkPath:new URL(release.apkUrl).pathname,sizeBytes:release.sizeBytes,notes:release.releaseNotes};
}

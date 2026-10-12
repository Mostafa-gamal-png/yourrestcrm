import {z} from 'zod';
import {cleanTrackerText} from './tracker-text';
import type {GateDecision,GateRequirement,GateSource} from './tracking-gate';

/** What a representative's phone last told the server about route tracking. It is
 * diagnostic only: it never counts as movement, a visit, a target or an evaluation. */
export const DEVICE_PLATFORMS=['android-app','browser'] as const;
export const DEVICE_CLASSES=['android','iphone','desktop','other'] as const;
export const DEVICE_GATES=['ok','browser','upgrade','setup','permission','location_services','bridge'] as const;
export type DevicePlatform=typeof DEVICE_PLATFORMS[number];
export type DeviceClass=typeof DEVICE_CLASSES[number];
export type DeviceGate=typeof DEVICE_GATES[number];

const REQUIREMENTS:readonly GateRequirement[]=['consent','enrollment','fine_location','notifications','background_location','location_services'];
const permission=z.enum(['granted','denied','prompt']).nullable();
const count=z.number().int().min(0).max(10_000_000);
export const deviceReportSchema=z.object({
 platform:z.enum(DEVICE_PLATFORMS),
 deviceClass:z.enum(DEVICE_CLASSES),
 gate:z.enum(DEVICE_GATES),
 missing:z.array(z.enum(REQUIREMENTS as [GateRequirement,...GateRequirement[]])).max(8),
 appVersion:z.string().max(32).regex(/^[0-9A-Za-z._-]*$/),
 tracking:z.boolean(),
 windowActive:z.boolean(),
 enrolled:z.boolean(),
 consent:z.boolean().nullable(),
 foreground:permission,
 fineLocation:permission,
 notifications:permission,
 background:permission,
 locationServices:z.boolean().nullable(),
 lastFixAt:z.union([z.literal(''),z.string().datetime({offset:true})]),
 accuracy:z.number().finite().min(0).max(100000).nullable(),
 pendingCount:count,
 pendingGapCount:count.nullable(),
 quarantinedCount:count,
 error:z.string().max(400),
 syncError:z.string().max(400)
}).strict();
export type DeviceReport=z.infer<typeof deviceReportSchema>;
export type DeviceStatusPublic=DeviceReport&{reportedAt:string};

/** Bidirectional overrides and control characters can make a status line read as something it is not. */
const CONTROL=/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
export function cleanStatusText(value:unknown,max=240):string{return cleanTrackerText(value,'',max).replace(CONTROL,'').trim();}

export function detectDeviceClass(userAgent:string,platform='',touchPoints=0):DeviceClass{
 if(/Android/i.test(userAgent))return 'android';
 if(/iPad|iPhone|iPod/.test(userAgent)||platform==='MacIntel'&&touchPoints>1)return 'iphone';
 if(/Windows|Macintosh|Linux|CrOS/i.test(userAgent))return 'desktop';
 return 'other';
}

/** Snapshot of the current gate decision for the server. `checking` is transient and is never reported. */
export function buildDeviceReport(decision:GateDecision,source:GateSource,deviceClass:DeviceClass):DeviceReport|null{
 if(decision.status==='checking')return null;
 const d=source.device,native=source.native;
 return {
  platform:native?'android-app':'browser',
  deviceClass:native?'android':deviceClass,
  gate:decision.status==='allowed'?'ok':decision.reason,
  missing:decision.status==='blocked'?[...decision.missing]:[],
  appVersion:d&&/^[0-9A-Za-z._-]{0,32}$/.test(d.appVersion)?d.appVersion:'',
  tracking:d?.tracking===true,
  windowActive:d?.windowActive===true,
  enrolled:d?.enrolled===true&&d.ownerMatches,
  consent:d?.consent??null,
  foreground:d?.foreground??null,
  fineLocation:d?.fineLocation??null,
  notifications:d?.notifications??null,
  background:d?.background??null,
  locationServices:d?.locationServices??null,
  lastFixAt:d&&Number.isFinite(Date.parse(d.lastFixAt))?new Date(d.lastFixAt).toISOString():'',
  accuracy:d?.accuracy!=null&&Number.isFinite(d.accuracy)&&d.accuracy>=0&&d.accuracy<=100000?d.accuracy:null,
  pendingCount:Math.min(10_000_000,d?.pendingCount??0),
  pendingGapCount:d?.pendingGapCount==null?null:Math.min(10_000_000,d.pendingGapCount),
  quarantinedCount:Math.min(10_000_000,d?.quarantinedCount??0),
  error:cleanStatusText(d?.error,240),
  syncError:cleanStatusText(d?.syncError,240)
 };
}

/** Fields that justify an immediate report when they change. Fix time, accuracy and queue size change constantly and travel with the next report. */
export function reportSignature(report:DeviceReport):string{
 return JSON.stringify([report.platform,report.deviceClass,report.gate,report.missing,report.appVersion,report.tracking,report.windowActive,report.enrolled,report.consent,report.foreground,report.fineLocation,report.notifications,report.background,report.locationServices,report.pendingCount>0,(report.pendingGapCount??0)>0,report.error,report.syncError]);
}

export type SendResult='ok'|'throttled'|'rejected'|'failed';
export type ReporterOptions={
 send:(report:DeviceReport)=>Promise<SendResult>;
 now?:()=>number;
 setTimer?:(callback:()=>void,delay:number)=>unknown;
 clearTimer?:(handle:unknown)=>void;
 /** Minimum spacing between two reports. Must exceed the server's own limit. */
 minIntervalMs?:number;
 /** An unchanged phone still reports this often, so the server can tell a silent phone from a healthy one. */
 heartbeatMs?:number;
 retryMs?:number;
 maxRetryMs?:number;
};
export type DeviceReporter={submit:(report:DeviceReport)=>void;nudge:(force?:boolean)=>void;dispose:()=>void};

export function createDeviceReporter(options:ReporterOptions):DeviceReporter{
 const now=options.now??Date.now,setTimer=options.setTimer??((callback:()=>void,delay:number)=>setTimeout(callback,delay)),clearTimer=options.clearTimer??((handle:unknown)=>clearTimeout(handle as ReturnType<typeof setTimeout>));
 const minInterval=options.minIntervalMs??60_000,heartbeat=options.heartbeatMs??15*60_000,retry=options.retryMs??60_000,maxRetry=options.maxRetryMs??15*60_000;
 let latest:DeviceReport|null=null,sentSignature='',rejectedSignature='',lastSentAt=-Infinity,blockedUntil=0,timer:unknown=null,inFlight=false,disposed=false,failures=0;
 const clear=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
 const arm=(delay:number)=>{if(disposed)return;clear();timer=setTimer(()=>{timer=null;void attempt();},Math.max(0,delay));};
 /** Milliseconds until the next report is due, or null when nothing should be sent. */
 const due=()=>{
  if(!latest)return null;
  const signature=reportSignature(latest);
  if(signature===rejectedSignature)return null;
  const at=signature!==sentSignature?lastSentAt+minInterval:lastSentAt+heartbeat;
  return Math.max(0,at-now(),blockedUntil-now());
 };
 const plan=()=>{const delay=due();if(delay===null)clear();else if(!inFlight)arm(delay);};
 async function attempt(){
  if(disposed||inFlight||!latest)return;
  const report=latest,signature=reportSignature(report);
  inFlight=true;
  let result:SendResult;
  try{result=await options.send(report);}catch{result='failed';}
  inFlight=false;
  if(disposed)return;
  if(result==='ok'){sentSignature=signature;rejectedSignature='';lastSentAt=now();blockedUntil=0;failures=0;}
  else if(result==='rejected'){rejectedSignature=signature;}
  else if(result==='throttled'){blockedUntil=now()+retry;}
  else{failures++;blockedUntil=now()+Math.min(maxRetry,retry*2**Math.min(failures-1,10));}
  plan();
 }
 return {
  submit(report){latest=report;plan();},
  nudge(force=false){if(force)blockedUntil=0;plan();},
  dispose(){disposed=true;clear();}
 };
}

/** Browser transport. Every failure is silent: a status report must never disturb work. */
export async function postDeviceStatus(report:DeviceReport):Promise<SendResult>{
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch('/api/device-status',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(report),signal:controller.signal});
  if(response.ok)return 'ok';
  if(response.status===429)return 'throttled';
  if(response.status>=400&&response.status<500)return 'rejected';
  return 'failed';
 }catch{return 'failed';}
 finally{clearTimeout(timeout);}
}

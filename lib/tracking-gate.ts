import {nativeScheduleSupported,type NativeTrackingState} from './native-tracking';

/** A representative may use the CRM only while route tracking is active on the
 * installed Android app. This module decides that from facts the app already
 * reports; it never reads GPS and never touches the network. */
export type GatePermission='granted'|'denied'|'prompt';
export type GateDevice={
 appVersion:string;
 continuousSupported:boolean;
 scheduleSupported:boolean;
 gapCountKnown:boolean;
 consent:boolean|null;
 enrolled:boolean;
 ownerMatches:boolean;
 /** General foreground permission as the Android service reports it. */
 foreground:GatePermission;
 fineLocation:GatePermission|null;
 notifications:GatePermission|null;
 background:GatePermission;
 locationServices:boolean|null;
};
/** What the tracker knows before any decision is made. `failed` means the
 * Android bridge could not be read at all; it is not a permission problem. */
export type GateSource={native:boolean;loading:boolean;failed:boolean;upgradeRequired:boolean;device:GateDevice|null};
export type GateRequirement='consent'|'enrollment'|'fine_location'|'notifications'|'background_location'|'location_services';
export type GateReason='browser'|'upgrade'|'setup'|'permission'|'location_services'|'bridge';
export type GateDecision={status:'allowed'}|{status:'checking'}|{status:'blocked';reason:GateReason;missing:GateRequirement[]};
export type GateInput=GateSource&{role?:string;active?:number;checkingExpired?:boolean};

export const REQUIREMENT_ORDER:readonly GateRequirement[]=['consent','fine_location','notifications','background_location','location_services','enrollment'];

/** Normalized native state -> the few facts the gate needs. */
export function gateDeviceFrom(state:NativeTrackingState,memberId:string|undefined):GateDevice{
 return {
  appVersion:state.appVersion,
  continuousSupported:state.continuousSupported,
  scheduleSupported:nativeScheduleSupported(state),
  gapCountKnown:state.pendingGapCount!==null,
  consent:state.continuousConsent,
  enrolled:state.enrolled,
  ownerMatches:!!memberId&&state.memberId===memberId,
  foreground:state.permission,
  fineLocation:state.fineLocationPermission,
  notifications:state.notificationPermission,
  background:state.backgroundPermission,
  locationServices:state.locationServicesEnabled
 };
}

/** Everything that still stands between this phone and working tracking. */
export function missingRequirements(device:GateDevice):GateRequirement[]{
 const missing:GateRequirement[]=[];
 if(device.consent===false)missing.push('consent');
 // Older apps do not report the fine-location field; the general permission then decides.
 if(device.fineLocation==='denied'||device.fineLocation===null&&device.foreground!=='granted')missing.push('fine_location');
 if(device.notifications==='denied')missing.push('notifications');
 if(device.background!=='granted')missing.push('background_location');
 if(device.locationServices===false)missing.push('location_services');
 if(!device.enrolled||!device.ownerMatches)missing.push('enrollment');
 return REQUIREMENT_ORDER.filter(item=>missing.includes(item));
}

export function trackingGateDecision(input:GateInput):GateDecision{
 // Only an active representative is subject to the gate. Every other role, and
 // an unknown member (the CRM is still loading), is unaffected.
 if(input.role!=='rep'||input.active!==1)return {status:'allowed'};
 if(!input.native)return {status:'blocked',reason:'browser',missing:[]};
 const device=input.device;
 if(!device){
  if(input.failed||input.checkingExpired)return {status:'blocked',reason:'bridge',missing:[]};
  return {status:'checking'};
 }
 if(input.upgradeRequired||!device.continuousSupported||!device.scheduleSupported||!device.gapCountKnown)return {status:'blocked',reason:'upgrade',missing:[]};
 const missing=missingRequirements(device);
 if(!missing.length)return {status:'allowed'};
 // A first activation has not been consented to yet; afterwards, a denied
 // permission needs different guidance because Android may not ask again.
 const reason:GateReason=missing.includes('consent')?'setup':missing.some(item=>item==='fine_location'||item==='notifications'||item==='background_location')?'permission':missing.includes('location_services')?'location_services':'setup';
 return {status:'blocked',reason,missing};
}

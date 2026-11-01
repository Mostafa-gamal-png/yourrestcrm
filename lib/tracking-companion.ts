/** A representative may carry two devices (a tablet beside the work phone). One of them records the route; the other is a
 * companion that may use the CRM without recording, as long as the route is being recorded by the other device. This module
 * decides that from what the server reports for today's route day and what this device reports about itself; it never reads
 * GPS and never touches the network. */

/** Outside working hours nothing is recorded; a device that was a companion within this time stays one until hours resume. */
export const COMPANION_MEMORY_MS=7*24*60*60_000;

/** Today's route day as the server reports it to this representative (`GET /api/mobile-route`). An open day whose collector
 * has gone quiet is not reported at all, so a reported day without an end is one that is being recorded right now. */
export type CompanionServerDay={id:string;endedAt:string|null}|null;
export type CompanionInput={
 role:string|undefined;
 native:boolean;
 /** The route day this device itself records today, if any. */
 ownDayId:string|null;
 serverDay:CompanionServerDay;
 /** False until the server has answered once. */
 serverKnown:boolean;
 windowOpen:boolean;
 rememberedAt:number|null;
 now:number;
};
export type CompanionDecision={companion:boolean;remember:boolean};

export function companionDecision(input:CompanionInput):CompanionDecision{
 if(input.role!=='rep'||!input.native||!input.serverKnown)return {companion:false,remember:false};
 const other=!!input.serverDay&&input.serverDay.id!==input.ownDayId;
 if(input.windowOpen){
  // During working hours only a day being recorded right now by another device makes this one a companion.
  const recording=other&&!input.serverDay!.endedAt;
  return {companion:recording,remember:recording};
 }
 // Outside working hours: another device recorded today, or this device was a companion recently.
 if(other)return {companion:true,remember:true};
 const recent=input.rememberedAt!==null&&Number.isFinite(input.rememberedAt)&&input.now-input.rememberedAt>=0&&input.now-input.rememberedAt<COMPANION_MEMORY_MS;
 return {companion:recent,remember:false};
}

const key=(memberId:string)=>'yourrest-companion:'+memberId;
/** Per-device memory; storage may be unavailable (private mode, blocked), which only means no memory. */
export function readCompanionMemory(memberId:string):number|null{
 try{const value=Number(window.localStorage.getItem(key(memberId)));return Number.isFinite(value)&&value>0?value:null;}catch{return null;}
}
export function writeCompanionMemory(memberId:string,at:number){
 try{window.localStorage.setItem(key(memberId),String(at));}catch{/* No memory: outside hours the device is then gated as before. */}
}

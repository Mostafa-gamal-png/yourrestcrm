import {CRMError,isRecord} from './crm-server';
import type {Row} from './crm';
import {OFFLINE_REFUSAL,ownFollowupOn,recordDay} from './offline-review';

/** Client event time is retained separately from the server's receipt/audit time. */
export function offlineCapture(body:Record<string,unknown>,memberId:string,receivedAt:string){
 if(body.offline===undefined)return null;
 const value=body.offline;
 if(!isRecord(value)||typeof value.memberId!=='string'||value.memberId!==memberId)throw new CRMError('البيانات المحفوظة على الجهاز تخص حسابًا آخر. ادخل بالحساب الذي سجّلها.',403);
 if(typeof value.capturedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.capturedAt)||!Number.isFinite(Date.parse(value.capturedAt))||Date.parse(value.capturedAt)>Date.parse(receivedAt)+60000)throw new CRMError('وقت التسجيل على الجهاز غير صحيح. اضبط ساعة الجهاز وراجع الإدخال المحفوظ.');
 const capturedAt=new Date(value.capturedAt).toISOString();
 if(capturedAt.slice(0,19)!==value.capturedAt.slice(0,19))throw new CRMError('وقت التسجيل على الجهاز غير صحيح.');
 return {capturedAt,receivedAt};
}

export function offlineEvidence(capture:ReturnType<typeof offlineCapture>,previous?:{offlineRecordedAt?:string;receivedAt?:string;recordingTimeSource?:string}){
 return capture?{offlineRecordedAt:capture.capturedAt,receivedAt:capture.receivedAt,recordingTimeSource:'device'}:previous?.offlineRecordedAt?{offlineRecordedAt:previous.offlineRecordedAt,receivedAt:previous.receivedAt,recordingTimeSource:previous.recordingTimeSource}:{};
}

/** The record an entry kept on the device needs is no longer the member's (closed, moved or deleted): the route's own words and status, with
 *  the code the device reads (lib/offline-review.ts) to say so and offer to delete the entry (app/offline-status.tsx). */
export function unavailableRefusal(message:string,status:number,target:'customer'|'opportunity'){return new CRMError(message,status,{code:target==='customer'?OFFLINE_REFUSAL.customerUnavailable:OFFLINE_REFUSAL.opportunityUnavailable});}
/** A follow-up saved twice (GSCO 2.13.84: the representative could not get rid of the second one): the route's own 409, with the code and,
 *  when it is known, the member's own record it repeats: its id and its day. Nothing of another member: the record is one the member can
 *  see and recorded (ownFollowupOnSource), or the follow-up of this very request key. */
export function duplicateRefusal(message:string,record?:Pick<Row,'id'|'data'|'createdAt'>){return new CRMError(message,409,{code:OFFLINE_REFUSAL.duplicate,...(record?{duplicate:{id:record.id,date:recordDay(record)}}:{})});}
/** The member's own follow-up already recorded on the same opportunity of this customer (the visit or contact `sourceId` names), other
 *  than the follow-up `except`: the newest, among what the member sees. */
export function ownFollowupOnSource(c:{me:{id:string};visible:Row[]},customerId:string,sourceId:unknown,except:string){return ownFollowupOn(c.visible,customerId,sourceId,c.me.id,except);}

import {CRMError} from './crm-server';

/** Client event time is retained separately from the server's receipt/audit time. */
export function offlineCapture(body:any,memberId:string,receivedAt:string){
 if(body.offline===undefined)return null;
 const value=body.offline;
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.memberId!=='string'||value.memberId!==memberId)throw new CRMError('البيانات المحفوظة على الجهاز تخص حسابًا آخر. ادخل بالحساب الذي سجّلها.',403);
 if(typeof value.capturedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.capturedAt)||!Number.isFinite(Date.parse(value.capturedAt))||Date.parse(value.capturedAt)>Date.parse(receivedAt)+60000)throw new CRMError('وقت التسجيل على الجهاز غير صحيح. اضبط ساعة الجهاز وراجع الإدخال المحفوظ.');
 const capturedAt=new Date(value.capturedAt).toISOString();
 if(capturedAt.slice(0,19)!==value.capturedAt.slice(0,19))throw new CRMError('وقت التسجيل على الجهاز غير صحيح.');
 return {capturedAt,receivedAt};
}

export function offlineEvidence(capture:ReturnType<typeof offlineCapture>,previous?:any){
 return capture?{offlineRecordedAt:capture.capturedAt,receivedAt:capture.receivedAt,recordingTimeSource:'device'}:previous?.offlineRecordedAt?{offlineRecordedAt:previous.offlineRecordedAt,receivedAt:previous.receivedAt,recordingTimeSource:previous.recordingTimeSource}:{};
}

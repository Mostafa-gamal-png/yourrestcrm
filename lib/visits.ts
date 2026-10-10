export const visitPurposes=['تعريف بمنتجات الشركة','متابعة عرض السعر','تحصيل','حل مشكلة'];
export const visitResults=['تم الشراء','متابعة العميل','تم أخذ موعد','سلبية'];
export const contactTypes:Record<string,string>={visit:'زيارة',call:'اتصال',email:'بريد إلكتروني',whatsapp:'واتساب',website:'عن طريق الويبسايت',social:'عن طريق مواقع التواصل الاجتماعي',quote:'عرض سعر',meeting:'اجتماع',followup:'متابعة'};
export const visitOutcomes:Record<string,string>={pending:'غير مصنفة',effective:'فعالة',followup:'متابعة العميل',noresponse:'لم يتم التواصل'};
export function visitResult(data:{result?:string;outcome?:string}){return data.result||((data.outcome&&data.outcome!=='pending')?visitOutcomes[data.outcome]:'')||'';}
export function durationSeconds(start?:string,end?:string){if(!start||!end)return null;const value=Date.parse(end)-Date.parse(start);return Number.isFinite(value)&&value>=0?Math.floor(value/1000):null;}
type VisitTiming={startedAt?:string;endedAt?:string;durationSeconds?:number|null;durationReview?:boolean;timingSource?:string;journeyDurationUncertain?:boolean};
function observedJourneySeconds(data:VisitTiming){return typeof data.durationSeconds==='number'&&Number.isFinite(data.durationSeconds)&&data.durationSeconds>=0?data.durationSeconds:null;}
export function durationLabel(data:VisitTiming,language='ar'){
 const say=(ar:string,en:string)=>language==='en'?en:ar;
 const journey=data.timingSource==='journey';
 // Endpoint elapsed time is useful, but a gap cannot establish continuous presence.
 // Keep estimates display-only: verified seconds and KPI eligibility are unchanged.
 const estimated=journey&&!!data.journeyDurationUncertain;
 const seconds=estimated?durationSeconds(data.startedAt,data.endedAt):journey?observedJourneySeconds(data):durationSeconds(data.startedAt,data.endedAt);
 if(seconds===null){
  if(journey&&data.startedAt&&!data.endedAt&&!data.journeyDurationUncertain)return say('جارية','In progress');
  return journey?say('غير مكتملة','Incomplete'):data.startedAt&&!data.endedAt?say('جارية','In progress'):say('غير مسجلة','Not recorded');
 }
 const label=seconds<60?say(`${seconds} ثانية`,`${seconds} sec`):say(`${Number((seconds/60).toFixed(1)).toLocaleString('en-US')} دقيقة`,`${Number((seconds/60).toFixed(1)).toLocaleString('en-US')} min`);
 return estimated?`${label} · ${say('تقديرية','Estimated')}`:label;
}
export function durationNeedsReview(data:VisitTiming){if(data.timingSource==='journey'&&data.startedAt&&!data.endedAt&&!data.journeyDurationUncertain)return false;return data.timingSource==='journey'?!!data.journeyDurationUncertain||!!data.durationReview||(observedJourneySeconds(data)??0)>86400:(durationSeconds(data.startedAt,data.endedAt)??0)>86400;}
export function riyadhDate(value:string){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
export function formatVisitTime(value?:string){return value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)):'—';}
export function toRiyadhInput(value?:string){if(!value)return '';const n=Date.parse(value);return Number.isFinite(n)?new Date(n+3*3600000).toISOString().slice(0,19):'';}
export function fromRiyadhInput(value:string){if(!value)return '';const n=Date.parse(value+(value.length===16?':00':'')+'+03:00');return Number.isFinite(n)?new Date(n).toISOString():'';}

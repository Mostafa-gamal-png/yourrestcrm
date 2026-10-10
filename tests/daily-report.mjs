// Deterministic read-only report projections; these checks do not exercise a physical device.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let checks=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,label);checks++;};
function load(file,require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,console,Date,Intl,structuredClone});return exports;}
const policy=load('lib/tracking-window.ts',()=>({}));
const journeys=load('lib/journeys.ts',()=>policy);
const location=load('lib/customer-location.ts',()=>({}));
const detection=load('lib/mobile-route-stops.ts',()=>journeys);
const {buildDailyReport}=load('lib/daily-report.ts',name=>({'./journeys':journeys,'./customer-location':location,'./mobile-route-stops':detection}[name]));
const base=Date.parse('2026-10-01T09:00:00.000Z'),date='2026-10-01',at=seconds=>new Date(base+seconds*1000).toISOString();
const latitude=26.437341,longitude=50.034499;
const point=(seconds,meters=0,accuracy=10,id='p'+seconds)=>({id,capturedAt:at(seconds),latitude:latitude+meters/111194.9266,longitude,accuracy,stopId:null});
const points=(from=0,to=300,meters=0)=>Array.from({length:Math.floor((to-from)/60)+1},(_,i)=>point(from+i*60,meters));
const customer=(id='factory',meters=0,extra={})=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'',data:{name:id,latitude:latitude+meters/111194.9266,longitude},createdAt:at(-86400),updatedAt:at(-86400),version:1,...extra});
const day=(id='day',samples=points(),extra={})=>({id,memberId:'rep',memberName:'Representative',date,regionScope:'eastern',startedAt:at(0),endedAt:null,expiresAt:at(21600),lastPointAt:samples.at(-1)?.capturedAt||null,version:1,gaps:[],points:samples,segments:[samples],...extra});
const result=(id='visit',seconds=150,extra={})=>({id,date,createdAt:at(seconds),type:'visit',summary:'summary',result:'done',nextAction:'',nextDate:'',...extra});
const contact=(id='visit',seconds=150,extra={})=>({...result(id,seconds),memberId:'rep',memberName:'Representative',customerId:'factory',customerName:'factory',...extra});
const stop=(id='selected',from=0,to=300,extra={})=>({id,memberId:'rep',memberName:'Representative',date,customerId:'factory',regionScope:'eastern',snapshot:{customerName:'factory',region:'eastern',latitude,longitude},selectedAt:at(from),closedAt:at(to),state:'completed',data:{...journeys.initialJourneyData(at(from)),arrivalAt:at(from),departureAt:at(to),durationSeconds:to-from,lastPoint:point(to),durationUncertain:false},version:1,points:points(from,to),segments:[],results:[result()],...extra});
const report=(extra={})=>({date,memberId:'rep',members:[],stops:[],mobileDays:[],communications:[],serverTime:at(3600),...extra});
const build=(value=report(),customers=[customer()],contacts=[],followups=[])=>buildDailyReport(value,customers,contacts,followups);

let actual=build();
eq(actual.summary,{firstMovementAt:null,lastActivityAt:null,recordedVisits:0,recordedCommunications:0,confirmedVisitSeconds:0,observedMovementSeconds:0,matchedCustomers:0,missingResults:0,gapCount:0},'An empty day contains no inferred work');
actual=build(report({mobileDays:[day()]}));
eq(actual.automaticStations.length,1);eq(actual.automaticStations[0].customerId,'factory');eq(actual.automaticStations[0].matchStatus,'matched');eq(actual.summary.recordedVisits,0,'Proximity is not a recorded business visit');eq(actual.summary.missingResults,1);eq(actual.summary.confirmedVisitSeconds,0);eq(actual.summary.firstMovementAt,null);eq(actual.summary.lastActivityAt,at(300));
eq(build(report({mobileDays:[day()]}),[]).automaticStations[0].matchStatus,'unmatched','Unauthorized customers never enter matching');
eq(build(report({mobileDays:[day()]}),[customer(),customer('next',140)]).automaticStations[0].matchStatus,'ambiguous','Another possible nearby factory prevents selection');
eq(build(report({mobileDays:[day()]}),[customer(),customer('next',159)]).automaticStations[0].matchStatus,'ambiguous','Even a second possible but not confident match blocks attribution');
eq(build(report({mobileDays:[day()]}),[customer(),customer('next',170)]).automaticStations[0].customerId,'factory');
eq(build(report({mobileDays:[day()]}),[customer('factory',145)]).automaticStations[0].matchStatus,'unmatched','Accuracy must fit wholly within the 150m entry radius');
eq(build(report({mobileDays:[day()]}),[customer('missing',0,{data:{name:'missing',location:'Dammam'}})]).automaticStations[0].matchStatus,'unmatched','A city name cannot imply coordinates');
eq(build(report({mobileDays:[day()]}),[customer('factory',0,{updatedAt:at(600)})]).automaticStations[0].matchStatus,'unmatched','A later card edit does not establish a historical location');
actual=build(report({mobileDays:[day()],stops:[stop()]}),[customer('factory',5000,{updatedAt:at(600)})]);
eq(actual.automaticStations[0].linkedStopId,'selected','Selected snapshot evidence remains valid after card GPS changes');eq(actual.summary.recordedVisits,1);eq(actual.summary.missingResults,0);eq(actual.summary.confirmedVisitSeconds,300);
actual=build(report({mobileDays:[day()],stops:[stop('intent',0,300,{data:journeys.initialJourneyData(at(0)),state:'en_route',closedAt:null,results:[]})]}));
eq(actual.automaticStations[0].linkedStopId,undefined,'Intent without arrival does not swallow automatic evidence');eq(actual.summary.missingResults,1);
actual=build(report({mobileDays:[day()]}),[customer()],[contact()]);
eq(actual.automaticStations[0].results.map(r=>r.id),['visit']);eq(actual.summary.recordedVisits,1);eq(actual.summary.missingResults,0);eq(actual.summary.confirmedVisitSeconds,0,'A recorded activity plus dwell still does not supply a confirmed geofence duration');
actual=build(report({mobileDays:[day()]}),[customer()],[contact('wrong-member',150,{memberId:'other'}),contact('wrong-customer',150,{customerId:'hidden'}),contact('outside',301),contact('call',150,{type:'call'})]);
eq(actual.automaticStations[0].results,[],'Member, customer, time and physical contact type must all agree');eq(actual.summary.recordedVisits,1);eq(actual.summary.recordedCommunications,1);
actual=build(report({mobileDays:[day()],communications:[contact()]}),[customer()],[contact(),contact('call',150,{type:'call'}),contact('call',150,{type:'call'})]);
eq(actual.summary.recordedVisits,1,'Duplicate contact inputs count once');eq(actual.summary.recordedCommunications,1);eq(actual.automaticStations[0].results.length,1);
actual=build(report({mobileDays:[day()]}),[customer()],[contact('offline',86400,{recordedAt:at(150)})]);
eq(actual.automaticStations[0].results.map(r=>r.id),['offline'],'Offline results use captured recording time, not later upload time');eq(actual.summary.lastActivityAt,at(300));
actual=build(report(),[customer()],[contact('offline',86400,{recordedAt:at(150)})]);eq(actual.summary.lastActivityAt,at(150));
actual=build(report({mobileDays:[day('one'),day('duplicate')]}),[customer()],[contact()]);
eq(actual.automaticStations.length,1,'Duplicate mobile sessions form one automatic station');eq(actual.automaticStations[0].observedDurationSeconds,300);eq(actual.automaticStations[0].results.length,1);eq(actual.summary.recordedVisits,1);
actual=build(report({mobileDays:[day('one',points(0,360)),day('overlap',points(60,420))]}));
eq(actual.automaticStations.length,1);eq(actual.automaticStations[0].observedDurationSeconds,420,'Overlapping observed station intervals union, never sum');
actual=build(report({mobileDays:[day('one'),day('return',points(600,900))]}),[customer()],[contact('first',150)]);
eq(actual.automaticStations.length,2,'Separate return stops remain separate');eq(actual.automaticStations.map(s=>s.results.length),[1,0]);eq(actual.summary.missingResults,1);eq(actual.summary.matchedCustomers,1);
actual=build(report({memberId:'all',mobileDays:[day('one'),day('another',points(),{memberId:'other'})]}));
eq(actual.automaticStations.length,2,'Different representatives are not merged');eq(actual.summary.missingResults,2);
actual=build(report({mobileDays:[day('north',points(0,300,70)),day('south',points(0,300,-70))]}),[customer()],[contact()]);eq(actual.automaticStations.length,2,'Overlapping conflicting-location recordings are not merged');eq(actual.automaticStations.map(s=>s.results.length),[0,0],'A single visit result cannot choose or populate two competing station candidates');eq(actual.summary.recordedVisits,1);

const moving=[point(0,0),point(60,100),point(120,200)];
actual=build(report({mobileDays:[day('moving',moving)]}));eq(actual.summary.observedMovementSeconds,120);eq(actual.summary.firstMovementAt,at(60),'Movement is first confirmed at the later GPS fix');
actual=build(report({memberId:'all',mobileDays:[day('moving',moving),day('copy',moving),day('other',moving,{memberId:'other'})]}));eq(actual.summary.observedMovementSeconds,240,'Intervals union per member but different members contribute separately');
actual=build(report({mobileDays:[day('moving',moving,{gaps:[{from:at(0),to:at(60),reason:'offline'}]})]}));eq(actual.summary.observedMovementSeconds,60);eq(actual.summary.firstMovementAt,at(120));eq(actual.summary.gapCount,1);
const instant={from:at(60),to:at(60),reason:'gps_unavailable'};
actual=build(report({mobileDays:[day('instant',moving,{gaps:[instant,instant]})]}));eq(actual.summary.observedMovementSeconds,60,'An instantaneous interruption at the later sample breaks movement evidence');eq(actual.summary.firstMovementAt,at(120));eq(actual.summary.gapCount,1,'Instantaneous interruption events count once');
for(const [samples,label] of [
 [[point(0),point(60,15)],'Jitter within accuracy radii'],
 [[point(0),point(180,100)],'Long missing interval'],
 [[point(0),point(60,100,80)],'Low accuracy'],
 [[point(0),point(60,30000)],'Implausible jump'],
 [[point(0),point(60,100),point(60,200)],'Conflicting duplicate timestamp'],
 [[point(0),point(60,100,NaN)],'Invalid accuracy'],
 ])eq(build(report({mobileDays:[day('motion',samples)]})).summary.observedMovementSeconds,0,label+' is not verified movement');
actual=build(report({mobileDays:[day('motion',[...moving,point(120,200)])]}));eq(actual.summary.observedMovementSeconds,120,'Exact duplicate samples do not inflate motion');
actual=build(report({mobileDays:[day('future',[point(0),point(4000,100)])]}));eq(actual.summary.lastActivityAt,at(0));eq(actual.summary.observedMovementSeconds,0);
actual=build(report({stops:[stop('first',0,300),stop('duplicate',0,300),stop('overlap',120,420,{results:[result('second')]})]}));
eq(actual.summary.recordedVisits,2,'Counts actual unique physical visit records, not selected rows');eq(actual.summary.confirmedVisitSeconds,420,'Confirmed customer time unions overlapping intervals per representative');
actual=build(report({stops:[stop('uncertain',0,300,{data:{...stop().data,durationUncertain:true,durationSeconds:null}})]}));eq(actual.summary.confirmedVisitSeconds,0,'Uncertain visits have no confirmed duration total');
actual=build(report({stops:[stop('unrecorded',0,300,{results:[]})]}));eq(actual.summary.recordedVisits,0);eq(actual.summary.confirmedVisitSeconds,0);eq(actual.summary.missingResults,1);
actual=build(report({stops:[stop('blank-result',0,300,{results:[result('blank',150,{result:' \n '})]})]}));eq(actual.summary.recordedVisits,1);eq(actual.summary.missingResults,1,'A visit with an empty result still needs a result');eq(actual.summary.confirmedVisitSeconds,300,'A recorded physical visit can have observed duration while its outcome remains incomplete');
actual=build(report({mobileDays:[day()]}),[customer()],[contact('blank-auto',150,{result:'   '})]);eq(actual.summary.missingResults,1,'An attributed record with only a goal/summary still lacks an outcome');
const gap={from:at(0),to:at(120),reason:'gps_unavailable'};
actual=build(report({mobileDays:[day('one',[],{gaps:[gap]}),day('two',[],{gaps:[gap]})]}));eq(actual.summary.gapCount,1,'Duplicate intervals do not double-count gaps');
actual=build(report({mobileDays:[day('gps-gap',[...points(0,240),...points(420,660)])]}));eq(actual.automaticStations.length,0,'GPS gaps cannot fabricate qualifying dwell');
eq(actual.summary.gapCount,1,'Missing sample intervals are counted without requiring a saved explicit gap');
actual=build(report({mobileDays:[day('low-quality',[point(0),point(60,10,80),point(120)])]}));eq(actual.summary.gapCount,1,'Low-quality evidence forms one unavailable interval through GPS recovery');
actual=build(report({mobileDays:[day('jump',[point(0),point(60,30000)])]}));eq(actual.summary.gapCount,1,'An outlier is an evidence interruption');
actual=build(report({mobileDays:[day('jump-back',[point(0),point(60,30000),point(120)])]}));eq(actual.summary.gapCount,1,'Touching unavailable intervals form one continuous interruption');
actual=build(report({mobileDays:[day('long-gap',[point(0),point(180,100)],{gaps:[{from:at(0),to:at(180),reason:'tracking_gap'}]})]}));eq(actual.summary.gapCount,1,'Inferred and explicit versions of the same interval are deduplicated');
const followup=(id='due',extra={})=>({id,customerId:'factory',customerName:'factory',memberId:'rep',memberName:'Representative',nextDate:date,nextAction:'Call',...extra});
actual=build(report(),[customer()],[],[followup(),followup(),followup('late',{nextDate:'2026-09-29'}),followup('future',{nextDate:'2026-10-02'}),followup('hidden',{customerId:'hidden'}),followup('other',{memberId:'other'})]);
eq(actual.pendingFollowups.map(f=>f.id),['late','due'],'Due follow-ups are authorized, scoped, deduplicated and ordered');
const payload=report({mobileDays:[day()],stops:[stop()]});const before=JSON.stringify(payload);build(payload);eq(JSON.stringify(payload),before,'The helper does not mutate supplied report evidence');
console.log(JSON.stringify({ok:true,checks,type:'daily summary, conservative station attribution, offline times, duplicate sessions and evidence limits',realDevice:false}));

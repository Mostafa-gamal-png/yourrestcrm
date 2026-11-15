// Leave and absence in the evaluation (the owner, 2026-11-15, item 5 of the GSCO list: «الإجازات تتحسب في التقييم (GSCO 2.13.50): الأيام اللي
// المندوب كان فيها في إجازة ما تتحسبش ضده»), read from the data as GSCO 2.13.50 and 2.13.51 do (lib/kpi-baseline.ts), without a build:
// 1. The pure rule: the months worked (an activity, a customer added by hand on its Riyadh day, a sales document; Arabic and Persian digits;
//    Riyadh month boundaries), the out-of-evaluation mark (a representative, a closed month, sales complete, no work), the customers'
//    comparison over the last three worked months (a leave in the middle, two leave months, a new representative from their second month
//    and recovered customers after four, a month not covered stays missing data, twelve months at most, no work at all).
// 2. lib/kpis.ts calculateKpis with the real coverage of lib/sales-coverage.ts: retention and recovered with a leave month (and what they were
//    before), the sentence and its English, the leave month itself out of the evaluation, a visit-only month a real zero, a supervisor's and a
//    sales manager's roll-ups never marked and their team never skipped while someone worked, the manual confirmation of «بيانات المؤشرات»
//    (its three months; a leave reaching past them needs an upload, the sentence without the manual option), growth after a leave.
// 3. The real routes (GET /api/sales?kpis=1 and GET /api/targets, compiled as the build does) on a migrated in-memory SQLite: the manager's
//    view, the supervisor's, the representative's own page (the mark, only theirs, a yes or a no; a manual confirmation counted as the
//    manager's view counts it, a stale one or unknown customer codes not), 401 and 403.
// 4. One definition: the evaluation and the representative's page decide with lib/kpi-baseline.ts only. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'kpi-leave-months-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email,provider:'email-otp'};}`);
fs.writeFileSync(path.join(out,'parser.mjs'),`export class ErpWorkbookError extends Error{};export function parseErpWorkbook(){throw Error('KPI reads cannot invoke the workbook parser');}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(imp==='./erp-sales')return 'from '+JSON.stringify(path.join(out,'parser.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const file of ['app/api/sales/route.ts','app/api/targets/route.ts','app/api/kpi-evidence/route.ts','lib/kpis.ts','lib/kpi-baseline.ts','lib/sales-coverage.ts','lib/targets.ts','lib/targets-export.ts','lib/i18n.ts'])compile(file);
const load=file=>import(pathToFileURL(path.join(out,file)));
const B=await load('lib/kpi-baseline.mjs'),K=await load('lib/kpis.mjs'),C=await load('lib/sales-coverage.mjs'),{quantityAttainment,targetProducts}=await load('lib/targets.mjs'),{performanceCsvRows}=await load('lib/targets-export.mjs'),i18n=await load('lib/i18n.mjs'),{today}=await load('lib/crm.mjs');
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));i18n.installEnglish(dictionary);
const english=value=>i18n.translateText(value,'en'),ARABIC=/[؀-ۿ]/;
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const counts={};const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};
const monthsBetween=(from,to)=>{const list=[];for(let m=from;m<=to;m=C.addMonths(m,1))list.push(m);return list;};
const SENTENCE=(compared,skipped)=>'قورن بآخر ثلاثة أشهر عمل فيها: '+compared+'. أشهر بلا نشاط لم تُحتسب: '+skipped+'.';

// ---- 1. The pure rule (lib/kpi-baseline.ts).
await counted('pure rule',async()=>{
 const activity=(id,by,date,extra={})=>({id,kind:'activity',parentId:'c',assignedTo:by,branch:'HQ',data:{type:'visit',date,performedBy:by,responsibleId:by,...extra},createdAt:'2025-01-01T00:00:00Z',updatedAt:'2025-01-01T00:00:00Z',version:1});
 const customer=(id,createdAt,data)=>({id,kind:'customer',parentId:null,assignedTo:'x',branch:'HQ',data:{name:id,...data},createdAt,updatedAt:createdAt,version:1});
 const records=[
  activity('a1','rep1','2025-08-10'),
  {...activity('a2','','2025-07-05'),data:{type:'call',date:'2025-07-05',responsibleId:'rep2'}},
  activity('a3','rep1','٢٠٢٥-٠٦-١٥'),activity('a4','rep1','۲۰۲۵-۰۵-۱۵'),activity('a5','rep1',' 2025-04-15 '),
  activity('bad1','rep1','yesterday'),activity('bad2','rep1','2025-13-01'),activity('bad3','rep1',''),activity('later','rep1','2025-12-01'),
  customer('h1','2025-07-31T21:30:00.000Z',{_createdBy:'rep3'}),customer('h2','2025-07-31T20:59:59.000Z',{_createdBy:'rep4'}),
  customer('file','2025-03-10T08:00:00.000Z',{_createdBy:'rep5',sourceFile:'customers.xlsx'}),
  customer('crm-rep5-erp-0b0d2c1e-1a2b-4c3d-8e9f-001122334455-7','2025-03-10T08:00:00.000Z',{_createdBy:'rep5'}),
  customer('nobody','2025-03-10T08:00:00.000Z',{}),customer('broken','not a moment',{_createdBy:'rep5'})
 ];
 const work=B.workMonthsByMember(records,'2025-11-30');
 eq([...work.get('rep1')].sort(),['2025-04','2025-05','2025-06','2025-08'],'an activity counts on its day; Arabic-Indic and Persian digits and spaces read; a day that is not one, or after the cutoff, does not');
 eq([...work.get('rep2')],['2025-07'],'an activity with no performedBy is its responsible\'s');
 eq([work.get('rep3'),work.get('rep4')].map(set=>[...set]),[['2025-08'],['2025-07']],'a customer added by hand is work of its Riyadh day: 31 July 21:30 UTC is 1 August in Riyadh, 20:59 is still July');
 ok(!work.has('rep5')&&!work.has(''),'a customer a file or the ERP import made, one with no creator, one with no valid moment: no work');
 eq(B.recordDay('٢٠٢٥-٠٨-٣١'),'2025-08-31','recordDay: Arabic-Indic digits');eq([B.recordDay('2025-02-30x'),B.recordDay(null),B.recordDay(20250801)],['','',''],'recordDay: anything else is no day');
 const worked=B.workedMonths(work,['rep1','rep2'],['2025-09-03','٢٠٢٥-١٠-٠١','2025-12-02','not a day'],'2025-11-30');
 eq([...worked].sort(),['2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10'],'workedMonths: the people\'s work and their sales documents up to the cutoff');

 // outOfEvaluation: a representative, a closed month, its sales complete, no work.
 const w=new Set(['2025-07']);
 eq(B.outOfEvaluation('rep','2025-08','2025-08-31','2025-11-15',true,w),true,'a representative with no work in a closed, complete month: out');
 eq(['supervisor','manager','admin','customer_service'].map(role=>B.outOfEvaluation(role,'2025-08','2025-08-31','2025-11-15',true,w)),[false,false,false,false],'a supervisor, the sales manager, the administrator: never marked');
 eq(B.outOfEvaluation('rep','2025-11','2025-11-15','2025-11-15',true,w),false,'the month in progress (its cutoff is today): never marked');
 eq(B.outOfEvaluation('rep','2025-08','2025-08-31','2025-11-15',false,w),false,'sales not known complete: never marked');
 eq(B.outOfEvaluation('rep','2025-07','2025-07-31','2025-11-15',true,w),false,'a month with work: evaluated');

 // customerBaseline: the last three worked months, twelve months back at most.
 const all=new Set(monthsBetween('2024-01','2025-12'));
 const base=(month,{worked,documents=worked,covered=all,firstWhole='2024-01',touched=covered})=>B.customerBaseline({month,worked:new Set(worked),documents:new Set(documents),covered:m=>covered.has(m),olderCovered:earliest=>firstWhole!==null&&firstWhole<earliest,touched:m=>touched.has(m)});
 const working=monthsBetween('2025-01','2025-11'),without=(...months)=>working.filter(m=>!months.includes(m));
 eq(base('2025-11',{worked:without('2025-08')}),{status:'ready',months:['2025-07','2025-09','2025-10'],skipped:['2025-08'],missing:[],earliest:'2025-07',history:'ready'},'a full month of leave in the middle (August): November compares with July, September and October');
 eq(base('2025-11',{worked:without('2025-08','2025-09')}),{status:'ready',months:['2025-06','2025-07','2025-10'],skipped:['2025-08','2025-09'],missing:[],earliest:'2025-06',history:'ready'},'two leave months: June, July and October');
 eq(base('2025-11',{worked:working}),{status:'ready',months:['2025-08','2025-09','2025-10'],skipped:[],missing:[],earliest:'2025-08',history:'ready'},'no leave: the three calendar months, as before');
 // 2.13.51: a new representative (first work in September, a first sale in October).
 const fresh=['2025-09','2025-10','2025-11','2025-12','2026-01'];
 eq(base('2025-10',{worked:fresh,documents:['2025-10']}),{status:'ready',months:['2025-07','2025-08','2025-09'],skipped:[],missing:[],earliest:'2025-07',history:'new'},'the second month: compared with the first and two ordinary months before it');
 eq(base('2025-11',{worked:fresh,documents:['2025-10']}),{status:'ready',months:['2025-08','2025-09','2025-10'],skipped:[],missing:[],earliest:'2025-08',history:'new'},'GSCO\'s example: started in September, November compares with August to October; nobody to recover yet');
 eq(base('2025-12',{worked:fresh,documents:['2025-10']}).history,'new','December: no worked month before September');
 eq(base('2026-01',{worked:fresh,documents:['2025-10']}).history,'ready','January, four months after September: recovered customers start');
 eq(base('2025-09',{worked:fresh,documents:[]}),{status:'ready',months:['2025-06','2025-07','2025-08'],skipped:[],missing:[],earliest:'2025-06',history:'new'},'the first month itself: ordinary months only (its own work does not make the months before it a leave)');
 eq(base('2025-11',{worked:[]}),{status:'ready',months:['2025-08','2025-09','2025-10'],skipped:[],missing:[],earliest:'2025-08',history:'new'},'no work at all: ordinary months, never all skipped');
 // A month the complete sales do not cover stays missing data, even beside a leave.
 eq(base('2025-11',{worked:without('2025-08'),covered:new Set([...all].filter(m=>m!=='2025-09'))}),{status:'missing',months:['2025-07','2025-10'],skipped:['2025-08'],missing:['2025-09'],earliest:null,history:'missing'},'September not covered: missing, named');
 eq(base('2025-11',{worked:without('2025-08'),covered:new Set(monthsBetween('2025-08','2025-11'))}).missing,['2025-07'],'the leave reaches July, which no complete import covers: July is needed');
 eq(base('2025-11',{worked:working,covered:new Set()}),{status:'missing',months:[],skipped:[],missing:['2025-08','2025-09','2025-10'],earliest:null,history:'missing'},'nothing covered: the three months named');
 // Twelve months back at most.
 eq(base('2025-11',{worked:['2024-09','2024-10','2025-10']}),{status:'none',months:['2025-10'],skipped:monthsBetween('2024-11','2025-09'),missing:[],earliest:null,history:'missing'},'one worked month in the twelve: nothing to compare with (October 2024 is thirteen months back)');
 eq(base('2025-11',{worked:['2024-09','2024-11','2024-12','2025-10']}),{status:'ready',months:['2024-11','2024-12','2025-10'],skipped:monthsBetween('2025-01','2025-09'),missing:[],earliest:'2024-11',history:'ready'},'the twelfth month back still counts');
 eq(base('2025-11',{worked:without('2025-08'),firstWhole:'2025-07'}).history,'missing','no whole complete month before July: recovered waits');
 eq(base('2025-11',{worked:without('2025-08'),documents:[],touched:new Set(['2025-07','2025-09','2025-10'])}).history,'new','work before July that no complete import touches, and no document: nothing proves earlier customers');
 eq(base('2025-11',{worked:without('2025-08'),documents:['2025-02'],touched:new Set()}).history,'ready','a sales document before July proves them');
 // The sentence, both languages.
 eq(B.baselineSentence({months:['2025-07','2025-09','2025-10'],skipped:['2025-08']}),SENTENCE('يوليو 2025، سبتمبر 2025 وأكتوبر 2025','أغسطس 2025'),'the sentence in Arabic');
 const en=B.baselineSentence({months:['2025-06','2025-07','2025-10'],skipped:['2025-08','2025-09']},'en');
 eq(en,'Compared with the last three months worked: June 2025, July 2025 and October 2025. Months without activity not counted: August 2025 and September 2025.','and in English');ok(!ARABIC.test(en),'no Arabic in the English sentence');
 eq(B.CUSTOMER_LOOKBACK_MONTHS,12,'twelve months back');
});

// ---- 2. lib/kpis.ts calculateKpis with the real coverage of lib/sales-coverage.ts.
await counted('calculateKpis',async()=>{
 const member=(id,role='rep',supervisorId='sup')=>({id,name:id,email:id+'@test.invalid',role,branch:'HQ',regionScope:'eastern',supervisorId,active:1,target:0,authVersion:1});
 const state=month=>({month,branches:[],sets:[]});
 const performance=(id,month,ids=[id],role='rep')=>({member:member(id,role),sourceMemberIds:role==='supervisor'?[id]:ids,salesSourceMemberIds:ids,teamRollup:ids.length>1,activityTeamRollup:role==='manager',activityTargetsKnown:true,activityTargets:{newCustomers:5,recoveredCustomers:2,visits:10},attainment:quantityAttainment(id,state(month),[])});
 const visit=(by,date)=>({id:'v-'+by+'-'+date,kind:'activity',parentId:'c-'+by,assignedTo:by,branch:'HQ',data:{type:'visit',date,performedBy:by,responsibleId:by,summary:'زيارة'},createdAt:date+'T08:00:00Z',updatedAt:date+'T08:00:00Z',version:1});
 const visits=(by,months)=>months.map(m=>visit(by,m+'-10'));
 const purchase=(rep,customerKey,month,netCents=10000,hasSale=true)=>({rep,customerKey,date:month+'-01',netCents,hasSale});
 const entry=(from,to,repIds=[],allReps=true)=>({complete:true,from,to,months:[],partialMonths:[],repIds,allReps,importerId:'owner',importer:'مدير النظام',at:'2025-12-01T00:00:00Z',importId:'erp-import-x'});
 const covered=[entry('2025-01-01','2025-11-30')];
 const context=(month,ids,facts,{entries=covered,historyComplete=false,identitiesKnown=true}={})=>({historyComplete,coverage:C.salesCoverageStatus(entries,ids,month,K.kpiPeriod(month)),identitiesKnown,collection:null,purchases:facts.filter(f=>ids.includes(f.rep)).map(({customerKey,date,netCents,hasSale})=>({customerKey,date,netCents,hasSale})),quotationsKnown:true,quotations:[],recoveryTarget:2});
 const run=(id,month,records,facts,options={},ids=[id],role='rep')=>K.calculateKpis(performance(id,month,ids,role),month,records,[],null,undefined,context(month,ids,facts,options));
 const get=(result,id)=>result.metrics.find(m=>m.id===id),shape=m=>[m.numerator,m.denominator,m.score,m.status];
 // rep1: on leave all of August 2025; customers A (July), B (September), C (October), D (May); in November A, B and D buy.
 const working=monthsBetween('2025-01','2025-11'),leave=working.filter(m=>m!=='2025-08');
 const facts=[purchase('rep1','A','2025-07'),purchase('rep1','B','2025-09'),purchase('rep1','C','2025-10'),purchase('rep1','D','2025-05'),purchase('rep1','A','2025-11'),purchase('rep1','B','2025-11'),purchase('rep1','D','2025-11')];
 let result=run('rep1','2025-11',visits('rep1',leave),facts);
 eq(shape(get(result,'retention')),[2,3,66.67,'scored'],'retention: of July, September and October\'s buyers (A, B, C), A and B bought again');
 eq(shape(get(result,'recovered')),[1,2,50,'scored'],'recovered: D (May, nothing in the compared months); A bought in July, so A is not recovered');
 eq(get(result,'retention').baseline,{months:['2025-07','2025-09','2025-10'],skipped:['2025-08']},'the compared and skipped months travel with the indicator');
 ok(get(result,'retention').reason.endsWith(' '+SENTENCE('يوليو 2025، سبتمبر 2025 وأكتوبر 2025','أغسطس 2025')),'the Arabic reason names them');
 ok(get(result,'retention').reason.startsWith('المشترون هذا الشهر من عملاء الأشهر الثلاثة السابقة ÷ جميع عملاء تلك الأشهر.'),'after the indicator\'s own sentence');
 const reasonEn=K.kpiMetricReason(get(result,'retention'),english,'en');
 ok(reasonEn.startsWith("Customers buying this month who also bought in the preceding three months")&&reasonEn.endsWith('Months without activity not counted: August 2025.'),'in English: the dictionary\'s sentence, then the months');ok(!ARABIC.test(reasonEn),'no Arabic left in the English reason: '+reasonEn);
 eq(K.kpiMetricReason(get(result,'retention'),v=>v,'ar'),get(result,'retention').reason,'Arabic: the reason as it is');
 const csv=performanceCsvRows([result],'2025-11',english,'en').find(row=>row[2]==='Customer retention');
 ok(csv[6].endsWith('Months without activity not counted: August 2025.')&&!ARABIC.test(csv[6]),'«تصدير التقييم» in English carries the months');
 // Before this change (the three calendar months, the leave counted): what the same data gave.
 const noLeave=run('rep1','2025-11',visits('rep1',working),facts);
 eq([shape(get(noLeave,'retention')),shape(get(noLeave,'recovered')),get(noLeave,'retention').baseline],[[1,2,50,'scored'],[2,2,100,'scored'],undefined],'the same buyers with August worked: August to October, A counted as recovered, no sentence');
 // The leave month itself: out of the evaluation, no total.
 const august=run('rep1','2025-08',visits('rep1',leave),facts);
 eq([august.inactive,august.summary.inactive,august.summary.total],[true,true,null],'August: «بلا نشاط في هذا الشهر – خارج التقييم»');
 // Two leave months (August and September).
 const two=run('rep1','2025-11',visits('rep1',working.filter(m=>!['2025-08','2025-09'].includes(m))),facts.filter(f=>f.customerKey!=='B'||f.date>'2025-10'));
 eq(get(two,'retention').baseline,{months:['2025-06','2025-07','2025-10'],skipped:['2025-08','2025-09']},'two leave months: June, July and October');
 eq(shape(get(two,'retention')),[1,2,50,'scored'],'A and C were the buyers then; A bought again');
 ok(get(two,'recovered').reason.endsWith(SENTENCE('يونيو 2025، يوليو 2025 وأكتوبر 2025','أغسطس 2025 وسبتمبر 2025')),'recovered names the same months');
 // A covered month with visits and no sale: worked (a real zero), not a leave; as the evaluated month: zero sales, evaluated.
 const visitOnly=run('rep1','2025-10',visits('rep1',['2025-10']),[]);
 eq([visitOnly.inactive,visitOnly.attainment.rows[0].actual],[false,0],'a visit-only month: evaluated with zero sales, not «غير متاح»');
 const quietOctober=run('rep1','2025-10',[],[]);
 eq([quietOctober.inactive,quietOctober.attainment.rows[0].actual],[true,0],'the same month without the visit: out of the evaluation');
 // A new representative (rep4: first work in September 2025).
 const newRep=[...visits('rep4',['2025-09','2025-10','2025-11','2025-12'])],newFacts=[purchase('rep4','N1','2025-10'),purchase('rep4','N1','2025-11'),purchase('rep4','N2','2025-11')];
 const decCovered=[entry('2025-01-01','2026-01-31')];
 result=run('rep4','2025-11',newRep,newFacts);
 eq([shape(get(result,'retention')),get(result,'retention').baseline],[[1,1,100,'scored'],undefined],'November: compared with August to October (August ordinary, no sentence): N1 kept');
 eq([get(result,'recovered').status,get(result,'recovered').reason],['not_applicable',B.NEW_HISTORY_REASON],'recovered: not applicable yet, with its reason');
 eq(english(B.NEW_HISTORY_REASON),'Before the compared months there is no month the representative worked and no earlier purchase of their customers, so no reactivated customer can be established. The indicator starts four months after the first month they worked.','its English');
 result=K.calculateKpis(performance('rep4','2026-01'),'2026-01',[...newRep,...visits('rep4',['2026-01'])],[],null,undefined,context('2026-01',['rep4'],[...newFacts,purchase('rep4','N1','2026-01')],{entries:decCovered}));
 eq(get(result,'recovered').status,'scored','January 2026: recovered starts (a worked month, September, before October to December)');
 // Twelve months back at most: rep5 worked only October 2025 since September 2024.
 result=run('rep5','2025-11',visits('rep5',['2024-09','2024-10','2025-10']),[],{entries:[entry('2024-01-01','2025-11-30')]});
 eq([get(result,'retention').status,get(result,'retention').reason,get(result,'recovered').status],['not_applicable',B.NO_BASELINE_REASON,'not_applicable'],'no three worked months in twelve: not applicable, with the reason');
 ok(!ARABIC.test(english(B.NO_BASELINE_REASON)),'its English');
 // A month the files do not cover stays missing data.
 result=run('rep1','2025-11',visits('rep1',leave),facts,{entries:[entry('2025-01-01','2025-08-31'),entry('2025-10-01','2025-11-30')]});
 eq([get(result,'retention').status,get(result,'retention').missing],['missing',{months:['2025-09'],olderThan:null,uploadOnly:true}],'September not covered: missing, named; the leave makes it an upload only');
 ok(get(result,'retention').reason.startsWith('يلزم رفع مبيعات ERP كاملة لشهر سبتمبر 2025.')&&!get(result,'retention').reason.includes('أكّد اكتمال السجل يدويًا'),'the sentence names September and does not offer the manual confirmation');
 eq(K.kpiMetricReason(get(result,'retention'),english,'en'),'Upload complete ERP sales for September 2025. Tick “The file includes all reps’ sales for the period it covers” when importing.','and in English');
 // The supervisor's and the sales manager's roll-ups: never marked; the team is not skipped while someone in it worked.
 const team=[...visits('rep1',leave),...visits('rep2',working)],teamFacts=[...facts,purchase('rep2','E','2025-08'),purchase('rep2','E','2025-11')];
 const sup=run('sup','2025-11',team,teamFacts,{},['rep1','rep2'],'supervisor'),mgr=run('mgr','2025-11',team,teamFacts,{},['rep1','rep2'],'manager');
 eq([get(sup,'retention').baseline,get(mgr,'retention').baseline],[undefined,undefined],'August, when rep2 worked, is not skipped for the team');
 eq([shape(get(sup,'retention')),shape(get(mgr,'retention'))],[[2,3,66.67,'scored'],[2,3,66.67,'scored']],'the team compares August to October (B, C, E; B and E again)');
 const supAugust=run('sup','2025-08',[],[],{},['rep1','rep3'],'supervisor'),mgrAugust=run('mgr','2025-08',[],[],{},['rep1','rep3'],'manager');
 eq([supAugust.inactive,mgrAugust.inactive,supAugust.summary.inactive],[false,false,false],'a supervisor and a sales manager are never marked, even with nothing in the month');
 // The current month is never marked.
 const now=today().slice(0,7);
 result=K.calculateKpis(performance('rep1',now),now,[],[],null,undefined,context(now,['rep1'],[],{entries:[entry(C.addMonths(now,-6)+'-01',today())]}));
 eq(result.inactive,false,'the month in progress is never marked');
 // The manual confirmation of «بيانات المؤشرات»: its three months; a leave reaching past them needs an upload.
 result=run('rep1','2025-11',visits('rep1',working),facts,{entries:[],historyComplete:true});
 eq([shape(get(result,'retention')),shape(get(result,'recovered'))],[[1,2,50,'scored'],[2,2,100,'scored']],'no leave: the manual confirmation completes both, as before');
 result=run('rep1','2025-11',visits('rep1',leave),facts,{entries:[],historyComplete:true});
 eq([get(result,'retention').status,get(result,'retention').missing],['missing',{months:['2025-07'],olderThan:null,uploadOnly:true}],'a leave in August: July is past what the confirmation covers, so it is asked for');
 result=run('rep1','2025-11',visits('rep1',leave),facts,{entries:[entry('2025-07-01','2025-07-31'),entry('2025-01-01','2025-03-31')],historyComplete:true});
 eq([shape(get(result,'retention')),get(result,'retention').baseline.skipped],[[2,3,66.67,'scored'],['2025-08']],'July uploaded complete: the confirmation and the import together');
 // Growth after a leave month: the previous month has no purchases, so no product has a baseline: «لا ينطبق», never counted against.
 const product=targetProducts[0].id,septemberSale={id:'s',repId:'rep1',customerId:'x',date:'2025-09-05',status:'confirmed',documentType:'sale',items:[{product,quantity:4,unitPrice:1}],totalCents:400};
 const weighted={month:'2025-09',branches:[],sets:[{kind:'sales',scopeId:'rep1',month:'2025-01',data:{products:targetProducts.map(p=>({product:p.id,quantity:10}))}},{kind:'weights',scopeId:'company',month:'2025-01',data:{products:targetProducts.map((p,i)=>({product:p.id,weight:i?0:100}))}}]};
 result=K.calculateKpis({...performance('rep1','2025-09'),attainment:quantityAttainment('rep1',weighted,[septemberSale])},'2025-09',visits('rep1',leave),[septemberSale],null,undefined,context('2025-09',['rep1'],facts));
 eq(get(result,'growth').status,'not_applicable','growth after the leave month: not applicable, its weight left out');
 // An older coverage shape (no lookback) keeps its three calendar months.
 const old={...context('2025-11',['rep1'],facts),coverage:{current:true,through:'2025-11-30',growth:true,retention:true,recovered:true,missing:{growth:{months:[],olderThan:null},retention:{months:[],olderThan:null},recovered:{months:[],olderThan:null}}}};
 result=K.calculateKpis(performance('rep1','2025-11'),'2025-11',visits('rep1',working),[],null,undefined,old);
 eq(shape(get(result,'retention')),[1,2,50,'scored'],'a coverage without lookback: August to October, as before');
});

// ---- 3. The real routes on a migrated in-memory SQLite.
await counted('routes',async()=>{
 const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
 eq([migrations.length,migrations.at(-1)],[21,'0020_member_permissions.sql'],'no new migration');
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
 const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
 const stamp='2025-01-01T00:00:00.000Z';
 const member=(id,role,supervisor=null,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,stamp);
 member('owner','admin',null,'all');member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
 for(const id of ['rep1','rep2','rep3','rep4'])member(id,'rep','sup');member('rep6','rep','sup2');member('cs','customer_service','mgr');
 sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
 const record=(id,kind,parent,assigned,data,created=stamp)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),created,created);
 for(const id of ['rep1','rep2','rep3','rep4','rep6'])record('c-'+id,'customer',null,id,{name:'مصنع '+id,region:'الشرقية',city:'الدمام'});
 const visit=(by,date)=>record('v-'+by+'-'+date,'activity','c-'+by,by,{type:'visit',date,summary:'تعريف',result:'العميل مهتم',performedBy:by,responsibleId:by,recordedByEmail:by+'@yourrest.org',salesStage:'specs'});
 const working=monthsBetween('2025-01','2025-11');
 for(const m of working){if(m!=='2025-08')visit('rep1',m+'-10');visit('rep2',m+'-12');if(!['2025-08','2025-09'].includes(m))visit('rep3',m+'-14');if(m>='2025-09')visit('rep4',m+'-16');if(m!=='2025-08')visit('rep6',m+'-18');}
 // A customer rep2 added by hand on 1 August in Riyadh (31 July 21:30 UTC) and nothing else that month would still be work; rep2 also visits.
 record('hand-rep2','customer',null,'rep2',{name:'عميل أضافه المندوب',region:'الشرقية',_createdBy:'rep2'},'2025-07-31T21:30:00.000Z');
 const cover=(id,from,to,repIds)=>sql.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES(?,?,?,?,?,?)').run(id,'owner','fp-'+id,'synthetic.xlsx',JSON.stringify({coverage:{complete:true,from,to,months:[],partialMonths:[],repIds,allReps:false,importerId:'owner',importer:'مدير النظام',at:stamp,importId:id}}),stamp);
 cover('erp-import-1','2025-01-01','2025-11-30',['rep1','rep2','rep3','rep4']);
 let n=0;const erp=(rep,code,date,cents=10000,type='sale')=>{n++;sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,?,?,'E',?,'الرئيسي','eastern',?,'عميل اصطناعي',?,?,'erp-import-1','owner',?)").run('erp-'+n,'doc-'+n,'INV-'+n,type,date,rep,code,JSON.stringify({items:[{product:'قوالب',quantity:1,unitPrice:100}],discount:0}),cents,stamp);};
 for(const [code,date] of [['A','2025-07-05'],['B','2025-09-05'],['C','2025-10-05'],['D','2025-05-05'],['A','2025-11-05'],['B','2025-11-06'],['D','2025-11-07']])erp('rep1',code,date);
 for(const [code,date] of [['E','2025-07-05'],['E','2025-11-05'],['F','2025-06-05']])erp('rep2',code,date);
 erp('rep4','N1','2025-10-05');erp('rep4','N1','2025-11-05');
 erp('rep6','G','2025-06-05');erp('rep6','G','2025-11-05');
 const salesApi=await load('app/api/sales/route.mjs'),targetsApi=await load('app/api/targets/route.mjs'),evidenceApi=await load('app/api/kpi-evidence/route.mjs');
 const read=async(who,month,status=200)=>{globalThis.testIdentity=who;const response=await salesApi.GET(new Request('https://test.invalid/api/sales?month='+month+'&kpis=1'));const data=await response.json();eq(response.status,status,who+' reads the KPIs of '+month+': '+JSON.stringify(data).slice(0,200));return data;};
 const own=async(who,query,status=200)=>{globalThis.testIdentity=who;const response=await targetsApi.GET(new Request('https://test.invalid/api/targets'+query));const data=await response.json();eq(response.status,status,who+' reads their own page '+query+': '+JSON.stringify(data).slice(0,200));return data;};
 const person=(data,id)=>data.kpis.people.find(p=>p.member.id===id),metricOf=(data,id,kpi)=>person(data,id).metrics.find(m=>m.id===kpi);
 // The sales manager's view of November 2025.
 let data=await read('mgr','2025-11');
 eq([metricOf(data,'rep1','retention').numerator,metricOf(data,'rep1','retention').denominator,metricOf(data,'rep1','retention').baseline],[2,3,{months:['2025-07','2025-09','2025-10'],skipped:['2025-08']}],'rep1 (August on leave): July, September and October');
 eq([metricOf(data,'rep1','recovered').numerator,metricOf(data,'rep1','recovered').status],[1,'scored'],'D recovered, A not');
 eq(metricOf(data,'rep3','retention').baseline,{months:['2025-06','2025-07','2025-10'],skipped:['2025-08','2025-09']},'rep3 (August and September): June, July and October');
 eq([metricOf(data,'rep4','retention').baseline,metricOf(data,'rep4','recovered').status],[undefined,'not_applicable'],'rep4 (new in September): August ordinary, recovered not yet');
 eq([metricOf(data,'rep2','retention').baseline,metricOf(data,'sup','retention').baseline,metricOf(data,'mgr','retention').baseline],[undefined,undefined,undefined],'rep2, the supervisor\'s and the manager\'s roll-ups: no month skipped');
 // August 2025.
 data=await read('mgr','2025-08');
 eq(['rep1','rep2','rep3','rep4','sup','mgr'].map(id=>person(data,id)?.inactive),[true,false,true,true,false,false],'August: rep1, rep3 and rep4 (not started yet) out of the evaluation; rep2 (a visit, and a customer added by hand), the supervisor and the manager not');
 eq(['rep1','rep3'].map(id=>person(data,id).summary.total),[null,null],'no score for those out');
 data=await read('sup','2025-08');
 eq(data.kpis.people.map(p=>p.member.id).sort(),['rep1','rep2','rep3','rep4','sup'],'the supervisor reads their team only');eq(person(data,'rep1').inactive,true,'and sees the same mark');
 // Who reads the team's evaluation.
 await read('rep1','2025-08',403);await read('cs','2025-08',403);await read(null,'2025-08',401);
 // The representative's own page («أهدافي»): the mark, only theirs.
 eq((await own('rep1','?month=2025-08')).inactive,true,'rep1 sees «بلا نشاط في هذا الشهر – خارج التقييم» on August');
 eq((await own('rep1','?month=2025-07')).inactive,false,'and not on July');
 eq((await own('rep2','?month=2025-08')).inactive,false,'rep2 worked in August');
 eq((await own('rep1','?month='+today().slice(0,7))).inactive,false,'the month in progress is never marked');
 const page=await own('rep1','?month=2025-08');
 eq(Object.keys(page).sort(),['activity','inactive','member','month','sales'],'a yes or a no, nothing of the data behind it');eq(page.member.id,'rep1','their own');
 for(const query of ['?month=2025-08&memberId=rep2','?month=2025-08&repId=rep2','?month=٢٠٢٥-٠٨'])await own('rep1',query,400);
 await own('mgr','?month=2025-08',403);await own(null,'?month=2025-08',401);
 // A customer added by hand in August (Riyadh) is August work, on both views.
 sql.prepare("DELETE FROM crm_records WHERE id='v-rep2-2025-08-12'").run();
 eq([(await own('rep2','?month=2025-08')).inactive,person(await read('mgr','2025-08'),'rep2').inactive],[false,false],'rep2 with only the customer added on 1 August (Riyadh): worked');
 sql.prepare("UPDATE crm_records SET created_at='2025-07-31T20:59:59.000Z',updated_at='2025-07-31T20:59:59.000Z' WHERE id='hand-rep2'").run();
 eq([(await own('rep2','?month=2025-08')).inactive,person(await read('mgr','2025-08'),'rep2').inactive],[true,true],'added on 31 July (Riyadh): August has nothing, on both views');
 // rep6: no complete import covers them; «بيانات المؤشرات» confirms August.
 eq([(await own('rep6','?month=2025-08')).inactive,person(await read('mgr','2025-08'),'rep6').inactive],[false,false],'August not known complete for rep6: never marked');
 globalThis.testIdentity='owner';
 const options=await (await evidenceApi.GET(new Request('https://test.invalid/api/kpi-evidence?memberId=rep6&month=2025-08'))).json();
 const save=await evidenceApi.POST(new Request('https://test.invalid/api/kpi-evidence',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify({memberId:'rep6',month:'2025-08',version:0,requestId:crypto.randomUUID(),salesRevision:options.salesRevision,evidenceRevision:options.evidenceRevision,input:{collection:{dueCents:null,collectedCents:null,reference:''},history:{complete:true,reference:'مراجعة سجل اصطناعي'},quotationsComplete:false,quotations:[]}})}));
 eq(save.status,200,'the owner confirms rep6\'s August history');
 eq([(await own('rep6','?month=2025-08')).inactive,person(await read('mgr','2025-08'),'rep6').inactive],[true,true],'confirmed by hand: rep6 is out on both views');
 sql.prepare("UPDATE crm_erp_sales SET customer_code='' WHERE rep_id='rep6' AND date='2025-06-05'").run();
 eq([(await own('rep6','?month=2025-08')).inactive,person(await read('mgr','2025-08'),'rep6').inactive],[false,false],'an invoice of theirs without a customer code: the confirmation does not count, on both views');
 sql.prepare("UPDATE crm_erp_sales SET customer_code='G' WHERE rep_id='rep6' AND date='2025-06-05'").run();
 sql.prepare("UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries'").run();
 eq([(await own('rep6','?month=2025-08')).inactive,person(await read('mgr','2025-08'),'rep6').inactive],[false,false],'a confirmation older than the sales data: not counted, on both views');
 sql.close();
});

// ---- 4. One definition.
await counted('one definition',async()=>{
 const kpis=fs.readFileSync(path.join(root,'lib/kpis.ts'),'utf8'),own=fs.readFileSync(path.join(root,'lib/own-targets-server.ts'),'utf8'),page=fs.readFileSync(path.join(root,'app/my-targets.tsx'),'utf8');
 ok(/outOfEvaluation\(p\.member\.role,month,period\.cutoff,today\(\),zeroFill,worked\)/.test(kpis),'the evaluation decides the mark with lib/kpi-baseline.ts outOfEvaluation');
 ok((own.match(/outOfEvaluation\(me\.role,month,period\.cutoff,now,true,worked\)/g)||[]).length===2&&/workMonthsByMember\(records,period\.cutoff\)/.test(own),'and so does the representative\'s page, with the same months worked');
 ok(!/r\.kind==='activity'&&ids\.has\(r\.data\.performedBy\|\|r\.data\.responsibleId\)&&r\.data\.date>=period\.first/.test(kpis),'the earlier activity test of the mark is gone');
 eq(page.match(/const INACTIVE_TEXT='([^']+)'/)?.[1],K.INACTIVE_TEXT,'«أهدافي» writes the evaluation\'s own words');
 ok(/handAddedDay\(customer\)/.test(fs.readFileSync(path.join(root,'lib/new-customers.ts'),'utf8')),'«العملاء الجدد» and the months worked read a hand-added customer the same way');
});
console.log(JSON.stringify({ok:true,checks,counts,scope:'Leave and absence in the evaluation (GSCO 2.13.50/2.13.51): the months worked, the mark, the customers\' comparison over the last three worked months, the real routes on SQLite, one definition'}));

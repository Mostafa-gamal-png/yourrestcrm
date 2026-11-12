import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

// «اكتمال سجل المبيعات» from the complete ERP sales imports (lib/sales-coverage.ts) and what it does to «نمو مبيعات الأصناف»,
// «العملاء المستردون» and «الحفاظ على العملاء الحاليين» (lib/kpis.ts), with the default activity targets (lib/targets.ts). Pure functions,
// synthetic data only.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'sales-coverage-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){if(seen.has(relative))return;seen.add(relative);const source=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,quote,imp)=>{if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(source),imp));if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
for(const file of ['lib/sales-coverage.ts','lib/kpis.ts','lib/targets.ts','lib/targets-export.ts'])compile(file);
const cov=await import(path.join(out,'lib/sales-coverage.mjs')),{calculateKpis,kpiPeriod,kpiMetricReason}=await import(path.join(out,'lib/kpis.mjs')),{quantityAttainment,targetProducts,defaultActivityTargets,effectiveSet,withManagerTargets,targetMonthClosed,canEditTargetMonth}=await import(path.join(out,'lib/targets.mjs')),{performanceCsvRows}=await import(path.join(out,'lib/targets-export.mjs'));
let checks=0;const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;},ok=(value,label)=>{assert.ok(value,label);checks++;};

// ---- The period of a file and the months it covers.
const file=cov.filePeriod(['2026-08-15','2026-10-28','2026-09-03'],'2026-11-12');
eq(file,{first:'2026-08-15',last:'2026-10-28',minFrom:'2026-08-01',maxTo:'2026-10-31'},'a file speaks for its first to its last invoice and may widen to its months');
eq(cov.filePeriod([],'2026-11-12'),null,'a file with no dates has no period');
eq(cov.filePeriod(['2026-11-02','2026-11-10'],'2026-11-12').maxTo,'2026-11-12','never beyond today');
eq(cov.coveragePeriod(file,undefined,undefined),{from:'2026-08-15',to:'2026-10-28'},'by default the file\'s own dates');
eq(cov.coveragePeriod(file,'2026-08-01','2026-10-31'),{from:'2026-08-01',to:'2026-10-31'},'widened to whole months');
ok('error' in cov.coveragePeriod(file,'2026-07-31','2026-10-31'),'not before the first month');
ok('error' in cov.coveragePeriod(file,'2026-08-01','2026-11-01'),'not after the last month');
ok('error' in cov.coveragePeriod(file,'2026-08-16','2026-10-28'),'never leaving out a date of the file');
ok('error' in cov.coveragePeriod(file,'2026-08-15','2026-10-27'),'never leaving out the last date of the file');
ok('error' in cov.coveragePeriod(file,'15/08/2026','2026-10-28'),'a malformed day is refused');
eq(cov.periodMonths('2026-08-15','2026-10-28'),{full:['2026-09'],partial:['2026-08','2026-10']},'the first and last months are partial');
eq(cov.periodMonths('2026-08-01','2026-10-31'),{full:['2026-08','2026-09','2026-10'],partial:[]});
eq(cov.periodMonths('2024-02-01','2024-02-29'),{full:['2024-02'],partial:[]},'a leap February');

// ---- Entries, merged per representative.
const entry=(from,to,extra={})=>({complete:true,from,to,...cov.periodMonths(from,to),months:cov.periodMonths(from,to).full,partialMonths:cov.periodMonths(from,to).partial,repIds:['rep'],allReps:false,importerId:'admin',importer:'Admin',at:'2026-11-01T00:00:00Z',importId:'erp-import-x',...extra});
const valid=e=>cov.salesCoverageEntrySchema.safeParse(e).success;
ok(valid(entry('2026-08-01','2026-08-31')),'a coverage entry is valid');ok(!valid({...entry('2026-08-01','2026-08-31'),from:'2026-09-01'}),'from after to is refused');ok(!valid({...entry('2026-08-01','2026-08-31'),complete:false}),'only complete entries count');
eq(cov.coveredRanges([entry('2026-08-01','2026-08-14'),entry('2026-08-15','2026-08-31'),entry('2026-10-01','2026-10-31')],'rep'),[{from:'2026-08-01',to:'2026-08-31'},{from:'2026-10-01',to:'2026-10-31'}],'touching ranges join; a gap stays');
eq(cov.coveredRanges([entry('2026-08-01','2026-08-31',{repIds:['other']})],'rep'),[],'an entry for other reps covers nobody else');
eq(cov.coveredRanges([entry('2026-08-01','2026-08-31',{repIds:[],allReps:true})],'new-rep'),[{from:'2026-08-01',to:'2026-08-31'}],'an entry for every rep covers a rep added later');

// ---- Status by KPI for a finished month (2026-09: window 06-08, older one before 06).
const period=m=>({first:m+'-01',cutoff:cov.monthEnd(m),previousFirst:cov.addMonths(m,-1)+'-01',previousEnd:cov.monthEnd(cov.addMonths(m,-1))});
const whole=(from,to)=>entry(from+'-01',cov.monthEnd(to));
let status=cov.salesCoverageStatus([whole('2026-05','2026-09')],['rep'],'2026-09',period('2026-09'));
eq([status.current,status.growth,status.retention,status.recovered,status.through],[true,true,true,true,'2026-09-30'],'May to September complete: all three automatic');
status=cov.salesCoverageStatus([whole('2026-06','2026-09')],['rep'],'2026-09',period('2026-09'));
eq([status.growth,status.retention,status.recovered,status.missing.recovered],[true,true,false,{months:[],olderThan:'2026-06'}],'no older month: recovered waits for one month before June');
status=cov.salesCoverageStatus([whole('2026-08','2026-09')],['rep'],'2026-09',period('2026-09'));
eq([status.growth,status.retention,status.missing.retention.months],[true,false,['2026-06','2026-07']],'growth needs only August; retention names June and July');
status=cov.salesCoverageStatus([whole('2026-05','2026-07'),whole('2026-09','2026-09')],['rep'],'2026-09',period('2026-09'));
eq([status.current,status.growth,status.retention,status.missing.growth.months,status.missing.retention.months],[true,false,false,['2026-08'],['2026-08']],'a gap in August is named');
status=cov.salesCoverageStatus([entry('2026-05-01','2026-09-29')],['rep'],'2026-09',period('2026-09'));
eq([status.current,status.missing.growth.months],[false,['2026-09']],'a finished month covered to the 29th is not complete');
status=cov.salesCoverageStatus([entry('2026-05-01','2026-09-29'),entry('2026-09-29','2026-09-30')],['rep'],'2026-09',period('2026-09'));
eq(status.recovered,true,'a later complete import extends coverage (overlap allowed)');
status=cov.salesCoverageStatus([entry('2026-05-15','2026-09-30'),entry('2026-04-01','2026-05-14')],['rep'],'2026-09',period('2026-09'));
eq(status.recovered,true,'a partial first month completed by an earlier import: April counts as the older month');
status=cov.salesCoverageStatus([entry('2026-05-15','2026-09-30')],['rep'],'2026-09',period('2026-09'));
eq([status.retention,status.recovered],[true,false],'a month only partly in the file (May from the 15th) is not an older complete month');
status=cov.salesCoverageStatus([whole('2026-05','2026-09')],['rep','rep2'],'2026-09',period('2026-09'));
eq([status.current,status.missing.growth.months],[false,['2026-08','2026-09']],'a team is covered only when every representative is');
status=cov.salesCoverageStatus([whole('2026-05','2026-09'),whole('2026-05','2026-09')].map((e,i)=>({...e,repIds:[i?'rep2':'rep']})),['rep','rep2'],'2026-09',period('2026-09'));
eq(status.recovered,true,'two imports, one rep each, cover the team');
status=cov.salesCoverageStatus([],['rep'],'2026-09',period('2026-09'));
eq([status.current,status.growth,status.retention,status.recovered,status.missing.recovered],[false,false,false,false,{months:['2026-06','2026-07','2026-08','2026-09'],olderThan:'2026-06'}],'nothing imported complete: everything named');
// The month in progress (2026-11 on the 12th): from its first day, the comparison days of October, the last uploaded day.
const progress={first:'2026-11-01',cutoff:'2026-11-12',previousFirst:'2026-10-01',previousEnd:'2026-10-12'};
status=cov.salesCoverageStatus([entry('2026-07-01','2026-11-05')],['rep'],'2026-11',progress);
eq([status.current,status.growth,status.retention,status.recovered,status.through],[true,true,true,true,'2026-11-05'],'the month in progress counts from its first day, through the last uploaded day');
status=cov.salesCoverageStatus([entry('2026-07-01','2026-10-31'),entry('2026-11-02','2026-11-10')],['rep'],'2026-11',progress);
eq([status.current,status.missing.growth.months],[false,['2026-11']],'the month in progress needs its first day');
status=cov.salesCoverageStatus([entry('2026-07-01','2026-10-10'),entry('2026-11-01','2026-11-11')],['rep'],'2026-11',progress);
eq([status.current,status.growth,status.missing.growth.months],[true,false,['2026-10']],'growth compares with October 1 to 12');

// ---- The sentence, in Arabic (the owner's example) and in English.
eq(cov.coverageReason({months:['2026-08'],olderThan:null}).startsWith('يلزم رفع مبيعات ERP كاملة لشهر أغسطس 2026.'),true,'one month, named');
eq(cov.coverageReason({months:['2026-07','2026-08','2026-09'],olderThan:null}).startsWith('يلزم رفع مبيعات ERP كاملة لأشهر يوليو 2026، أغسطس 2026 وسبتمبر 2026.'),true,'several months');
ok(cov.coverageReason({months:[],olderThan:'2026-06'}).includes('لشهر واحد على الأقل قبل يونيو 2026'),'the older month');
const english=cov.coverageReason({months:['2026-07','2026-08'],olderThan:'2026-05'},'en');
ok(english.startsWith('Upload complete ERP sales for July 2026 and August 2026.')&&english.includes('before May 2026'),'English');ok(!/[؀-ۿ]/.test(english),'no Arabic in the English sentence');

// ---- The KPIs (a finished month: 2025-09), against the same data as tests/kpi-complete-domain.mjs.
const month='2025-09',member={id:'rep',name:'Rep',email:'rep@test.invalid',role:'rep',branch:'HQ',regionScope:'eastern',supervisorId:'sup',active:1,target:0,authVersion:1};
const targetState=(quantities=targetProducts.map(()=>10),weights=targetProducts.map((_,i)=>i===0?60:i===1?40:0))=>({month,branches:[],sets:[{kind:'sales',scopeId:'rep',month:'2025-01',data:{products:targetProducts.map((p,i)=>({product:p.id,quantity:quantities[i]}))}},{kind:'weights',scopeId:'company',month:'2025-01',data:{products:targetProducts.map((p,i)=>({product:p.id,weight:weights[i]}))}}]});
const sale=(id,date,quantity,product=targetProducts[0].id)=>({id,repId:'rep',customerId:'factory',customerName:'Factory',date,status:'confirmed',documentType:'sale',items:[{product,quantity,unitPrice:100}],totalCents:quantity*10000});
const sales=[sale('prior','2025-08-05',2),sale('now','2025-09-05',5)];
const performance=(items=sales)=>({member,sourceMemberIds:['rep'],salesSourceMemberIds:['rep'],teamRollup:false,activityTeamRollup:false,activityTargetsKnown:true,activityTargets:defaultActivityTargets,attainment:quantityAttainment('rep',targetState(),items)});
const purchase=(customerKey,date)=>({customerKey,date,netCents:1000,hasSale:true});
const purchases=[purchase('recovered','2025-04-01'),purchase('recovered','2025-09-01'),purchase('retained','2025-06-01'),purchase('retained','2025-09-01'),purchase('lapsed','2025-08-01')];
const context=(extra={})=>({historyComplete:false,collection:null,purchases,quotationsKnown:true,quotations:[],recoveryTarget:defaultActivityTargets.recoveredCustomers,invalidHistoryReason:'أكّد اكتمال سجل المبيعات لثلاثة أشهر سابقة وفترة التقييم.',...extra});
const calc=(extra,p=performance(),items=sales)=>calculateKpis(p,month,[],items,null,undefined,context(extra)),get=(result,id)=>result.metrics.find(m=>m.id===id);
const statusFor=entries=>cov.salesCoverageStatus(entries,['rep'],month,kpiPeriod(month));
// Covered: April to September, all three automatic with no manual confirmation.
let result=calc({coverage:statusFor([whole('2025-04','2025-09')])});
eq([get(result,'retention').numerator,get(result,'retention').denominator,get(result,'retention').source],[1,2,'automatic'],'retention computes by itself');
eq([get(result,'recovered').numerator,get(result,'recovered').denominator,get(result,'recovered').score],[1,5,20],'recovered computes against the default target 5');
ok(get(result,'retention').reason.includes('سجل المبيعات مكتمل تلقائيًا'),'the reason says the history is complete from the imports');ok(!('missing' in get(result,'retention')),'no missing months once covered');
// Zero-fill: product 2 (40% weight) has no sale in either month: a real zero in a covered month, dropped from growth's weight
// (baseline 0) and rescaled, as before.
eq(result.attainment.rows[1].actual,0,'a covered month makes a product without sales a real zero');
eq(get(result,'growth').score,100,'growth: product 1 grew 150% (capped at 100); product 2, with a zero baseline, leaves the weight and the rest is rescaled');
eq(result.growthRows[1].previous,0,'the comparison month is a zero too');
// Not covered: null with the months named, and the English built from them.
result=calc({coverage:statusFor([whole('2025-07','2025-09')])});
eq([get(result,'retention').score,get(result,'retention').source,get(result,'retention').missing],[null,'required',{months:['2025-06'],olderThan:null}],'retention waits for June 2025');
ok(get(result,'retention').reason.startsWith('يلزم رفع مبيعات ERP كاملة لشهر يونيو 2025.'),'the Arabic reason names June 2025');
eq(get(result,'recovered').missing,{months:['2025-06'],olderThan:'2025-06'},'recovered also needs an older month');
eq(get(result,'growth').source,'automatic','growth only needs August: covered');ok(get(result,'growth').score!==null);
ok(kpiMetricReason(get(result,'retention'),v=>v,'en').startsWith('Upload complete ERP sales for June 2025.'),'the page writes it in English');
eq(kpiMetricReason(get(result,'variety'),v=>'T:'+v,'en').startsWith('T:'),true,'other reasons go through the dictionary');
eq(performanceCsvRows([result],month,v=>v,'en').find(row=>row[2]==='الحفاظ على العملاء الحاليين')[6].startsWith('Upload complete ERP sales for June 2025.'),true,'and the export');
result=calc({coverage:statusFor([])},performance([sale('now','2025-09-05',5)]),[sale('now','2025-09-05',5)]);
eq([get(result,'growth').score,get(result,'growth').missing],[null,{months:['2025-08','2025-09'],olderThan:null}],'growth with no baseline and no coverage waits, naming both months');
eq(result.attainment.rows[1].actual,null,'not covered: a product without sales stays unknown');
// The manual confirmation is still a fallback, and wins.
result=calc({historyComplete:true,coverage:statusFor([])});
eq([get(result,'retention').score,get(result,'recovered').numerator,'missing' in get(result,'retention')],[50,1,false],'the manual confirmation still completes everything');
ok(!get(result,'retention').reason.includes('تلقائيًا'),'and its reason does not claim the imports');
// Covered, but the customers' codes are not known: retention and recovered keep the identity reason; growth does not need codes.
result=calc({coverage:statusFor([whole('2025-04','2025-09')]),identitiesKnown:false,invalidHistoryReason:'توجد فواتير بدون رقم عميل أو أرقام عملاء مكررة بين مصادر المبيعات؛ راجع هوية العملاء أولًا.'});
eq([get(result,'retention').score,get(result,'recovered').score,get(result,'growth').source],[null,null,'automatic'],'unknown customer codes keep retention and recovered waiting');
ok(get(result,'retention').reason.startsWith('توجد فواتير بدون رقم عميل'),'with the identity reason');
// No coverage information at all (older callers): exactly as before.
result=calc({});eq([get(result,'retention').reason,'missing' in get(result,'retention')],['أكّد اكتمال سجل المبيعات لثلاثة أشهر سابقة وفترة التقييم.',false],'without coverage the reason is the old one');
// An empty team: no coverage, no history.
result=calculateKpis({...performance(),salesSourceMemberIds:[]},month,[],sales,null,undefined,context({coverage:statusFor([whole('2025-04','2025-09')])}));
eq([get(result,'retention').status,get(result,'growth').missing],['missing',undefined],'an empty sales team keeps waiting without coverage');

// ---- Default activity targets: applied, overridden, carried forward, rolled up; finished months keep their lock rules.
const activity=(scopeId,m,data)=>({kind:'activity',scopeId,month:m,version:1,updatedAt:'',data});
let state={month:'2026-11',branches:[],sets:[]};
eq(effectiveSet(state,'activity','rep')?.data||defaultActivityTargets,{newCustomers:10,recoveredCustomers:5,visits:320},'no target saved: the defaults');
state={month:'2026-11',branches:[],sets:[activity('rep','2026-09',{newCustomers:3,recoveredCustomers:2,visits:40})]};
eq(effectiveSet(state,'activity','rep').data,{newCustomers:3,recoveredCustomers:2,visits:40},'a saved earlier month is carried forward over the defaults');
state={month:'2026-08',branches:[],sets:[activity('rep','2026-09',{newCustomers:3,recoveredCustomers:2,visits:40})]};
eq(effectiveSet(state,'activity','rep'),undefined,'a later month never reaches back: the defaults apply before it');
const members=[{id:'sm',role:'manager',active:1,branch:'HQ'},{id:'r1',role:'rep',active:1,branch:'HQ',supervisorId:'sm'},{id:'r2',role:'rep',active:1,branch:'HQ',supervisorId:'sm'}];
state=withManagerTargets({month:'2026-11',branches:[],sets:[activity('r1','2026-11',{newCustomers:3,recoveredCustomers:2,visits:40})]},members);
eq(effectiveSet(state,'activity','sm').data,{newCustomers:13,recoveredCustomers:7,visits:360},'a manager\'s roll-up adds the defaults of a member with no target');
const kpis=calculateKpis({...performance(),activityTargets:defaultActivityTargets},month,[],sales,null,undefined,context({coverage:statusFor([whole('2025-04','2025-09')])}));
eq([get(kpis,'new_customers').denominator,get(kpis,'visits').denominator,get(kpis,'recovered').denominator],[10,320,5],'the defaults are the denominators of the three activity KPIs');
eq([targetMonthClosed('2026-10',new Date('2026-11-12T10:00:00Z')),canEditTargetMonth('manager','2026-10',new Date('2026-11-12T10:00:00Z')),canEditTargetMonth('admin','2026-10',new Date('2026-11-12T10:00:00Z'))],[true,false,true],'finished months stay locked to the administrator');

console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false,scope:'ERP sales coverage: file period, partial months, gaps, extension, teams, the month in progress, KPI automation and reasons, manual fallback, zero-fill, default activity targets'}));

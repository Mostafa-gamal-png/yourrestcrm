// The targets numbers, unit by unit (the owner's unit-test plan, 2026-11-22), on the real modules compiled into .sites-runtime (so the
// coverage measure sees them), without a build: lib/kpi-gaps.ts (what completes the evaluation: the missing indicators and their weights,
// each case of each indicator, the summary over people, the sentences in both languages), lib/targets-export.ts (the columns and rows of
// «تصدير كل المستهدفات» and «تصدير التقييم», and the CSV writer of the page with a cell that starts like a formula), lib/targets-overview.ts
// (the gauges of the company and the branches: the people of a branch, one branch from the people or a complete saved target, what keeps a
// gauge blank and its one line, two branches), lib/targets-performance-summary.ts (the remaining quantity, the shown achievement, the
// displayed score) and lib/own-targets.ts (types only: it loads). Made-up people, products and quantities; no network, no database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'targets-numbers-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{fileName:relative,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(/\.json$/.test(source)){const target=path.join(out,source);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,source),target);return 'from '+JSON.stringify(target)+' with {type:"json"}';}
  if(/\.(mjs|js)$/.test(source))return 'from '+JSON.stringify(pathToFileURL(path.join(root,source)).href);
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
const load=async relative=>{compile(relative);return import(pathToFileURL(path.join(out,relative.replace(/\.tsx?$/,'.mjs'))));};
const G=await load('lib/kpi-gaps.ts'),E=await load('lib/targets-export.ts'),O=await load('lib/targets-overview.ts'),P=await load('lib/targets-performance-summary.ts');
const own=await load('lib/own-targets.ts'),K=await load('lib/kpis.ts'),T=await load('lib/targets.ts');
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const ARABIC=/[؀-ۿ]/;
const ar=value=>value,en=value=>'EN:'+value;

eq(Object.keys(own),[],'lib/own-targets.ts is types only: it loads and exports nothing at run time');

// ---------------------------------------------------------------------------------------------------- lib/kpi-gaps.ts
const ids=K.operationalIndicators.map(i=>i.id),weightOf=id=>K.operationalIndicators.find(i=>i.id===id).weight;
const conduct=[...K.conductKeys];
eq(K.operationalIndicators.reduce((n,i)=>n+i.weight,0),100,'the eighteen indicators weigh 100 together');
const none=G.kpiMissing();
eq(none.map(r=>r.id),[...ids.filter(id=>!conduct.includes(id)),'conduct'],'nothing at all: every indicator missing, the five conduct ones as one line, last');
eq([none.at(-1).name,none.at(-1).weight,none.reduce((n,r)=>n+r.weight,0)],[G.CONDUCT_GAP_NAME,10,100],'the conduct line carries the five weights (10%), and the missing weights add up to 100');
const scored=(id,score=80,extra={})=>({...K.metric(id,score,'سبب '+id),...extra});
const complete=ids.map(id=>scored(id));
eq(G.kpiMissing(complete),[],'every indicator scored: nothing missing');
eq(G.kpiMissing(complete.map(m=>m.id==='collection'?K.metric('collection',null,'x','automatic',null,null,'not_applicable'):m)),[],'«لا ينطبق» is never missing');
for(const bad of [NaN,Infinity,-Infinity,null,undefined,'80'])
 eq(G.kpiMissing(complete.map(m=>m.id==='growth'?{...m,score:bad}:m)).map(r=>r.id),['growth'],'a score that is not a finite number is missing: '+String(bad));
eq(G.kpiMissing(complete.filter(m=>m.id!=='honesty')).map(r=>[r.id,r.weight]),[['honesty',2]],'one conduct indicator missing is named alone, not as the conduct line');
eq(G.kpiMissing(complete.filter(m=>!conduct.includes(m.id))).map(r=>[r.id,r.weight]),[['conduct',10]],'all five conduct indicators missing: one line of 10%');

const missingMetric=(id,reason='',extra={})=>({...K.metric(id,null,reason),...extra});
const person=(metrics,extra={})=>({metrics:ids.map(id=>metrics.find(m=>m.id===id)||scored(id)),...extra});
const gapOf=(p,id)=>G.kpiGaps(p).find(g=>g.id===id);
const keys=gap=>gap?gap.actions.map(a=>a.key):null;
// [target, actual, weight] of the first products (null kept as null); the others: target 5, sold 0, weight 0.
const rows=(spec)=>T.targetProducts.map((p,i)=>{const [target,actual,weight]=spec[i]||[5,0,0];return {...p,actual,target,weight};});
const attainment=(status,specRows)=>({status,rows:specRows||rows([]),score:null});
// attainment
eq(keys(gapOf(person([missingMetric('attainment')],{teamRollup:true,salesSourceMemberIds:[]}),'attainment')),['teamLink'],'a team with no linked representative: link the team');
eq(keys(gapOf(person([missingMetric('attainment','سبب خاص')]),'attainment')),['reason:attainment:سبب خاص'],'no attainment read: the indicator\'s own reason');
eq(keys(gapOf(person([missingMetric('attainment')]),'attainment')),[],'no attainment and no reason: no action');
eq(keys(gapOf(person([missingMetric('attainment')],{attainment:attainment('weights_missing')}),'attainment')),['weights'],'no weights: set the weights');
eq(keys(gapOf(person([missingMetric('attainment')],{attainment:attainment('missing_inputs',rows([[null,0,60],[5,null,40]]))}),'attainment')),['target','salesMonth'],'a weighted product without a target and one targeted without sales: both actions');
eq(keys(gapOf(person([missingMetric('attainment')],{teamRollup:true,salesSourceMemberIds:['a'],attainment:attainment('missing_inputs',rows([[null,0,60]]))}),'attainment')),['teamTargets'],'a team: complete the team\'s targets');
eq(keys(gapOf(person([missingMetric('attainment','r')],{attainment:attainment('missing_inputs',rows([[null,0,0],[0,null,100]]))}),'attainment')),['reason:attainment:r'],'a product of weight 0 without a target, and a target of 0 without sales, ask nothing: the own reason');
// collection
eq([[{},'collection'],[{teamRollup:true,salesSourceMemberIds:['a']},'teamCollection'],[{teamRollup:true,salesSourceMemberIds:[]},'teamLink']].map(([extra])=>keys(gapOf(person([missingMetric('collection')],extra),'collection'))[0]),['collection','teamCollection','teamLink'],'collection: the person, the team, the team without a link');
// growth
const coverageMissing={months:['2026-09','2026-10'],olderThan:null};
const growthCoverage=gapOf(person([missingMetric('growth','',{missing:coverageMissing})]),'growth').actions[0];
eq(growthCoverage.key,'coverage:'+JSON.stringify([['2026-09','2026-10'],null,false]),'a growth waiting for ERP months: the coverage action keyed by its months');
ok(growthCoverage.text[0].includes('سبتمبر 2026')&&growthCoverage.text[1].includes('September 2026 and October 2026'),'its text names the months in each language');
eq(keys(gapOf(person([missingMetric('growth')],{growthRows:[{product:'x',weight:null}]}),'growth')),['weights'],'growth rows without a weight: set the weights');
eq(keys(gapOf(person([missingMetric('growth')],{teamRollup:true,salesSourceMemberIds:[]}),'growth')),['teamLink'],'growth of a team with no link');
eq(keys(gapOf(person([missingMetric('growth')]),'growth')),['salesGrowth'],'growth otherwise: upload this month and the previous one');
// recovered and retention
for(const id of ['recovered','retention']){
 eq(keys(gapOf(person([missingMetric(id,'',{missing:{months:['2026-08'],olderThan:'2026-08',uploadOnly:true}})]),id)),['coverage:'+JSON.stringify([['2026-08'],'2026-08',true])],id+': the coverage action, upload only');
 for(const reason of G.NO_TEAM_REASONS)eq(keys(gapOf(person([missingMetric(id,reason)]),id)),['teamLink'],id+': no team: '+reason);
 for(const reason of G.HISTORY_REASONS)eq(keys(gapOf(person([missingMetric(id,reason)]),id)),['salesCustomers'],id+': history not confirmed: '+reason);
 eq(keys(gapOf(person([missingMetric(id,'سبب آخر')]),id)),['reason:'+id+':سبب آخر'],id+': another case keeps its own reason');
 eq(keys(gapOf(person([missingMetric(id,G.NO_TEAM_REASONS[0]+' ')]),id)),['reason:'+id+':'+G.NO_TEAM_REASONS[0]+' '],id+': the reasons are matched exactly (a trailing space is another reason)');
}
// new customers
const unknownStart=G.NEW_CUSTOMERS_UNKNOWN_START+': 3';
eq(keys(gapOf(person([missingMetric('new_customers',unknownStart)]),'new_customers')),['newCustomers'],'new customers without a creator: upload the ERP customers with their date');
eq(keys(gapOf(person([missingMetric('new_customers',unknownStart)],{activityTargetsKnown:false}),'new_customers')),['reason:new_customers:'+unknownStart],'targets not known: the own reason');
// positive
const positive=gapOf(person([missingMetric('positive','لم يقيّم',{waiting:7})]),'positive');
eq([positive.actions[0].key,positive.actions[0].waiting],['rateVisits',7],'visits waiting for the supervisor\'s rating, with how many');
eq(gapOf(person([missingMetric('positive')]),'positive').actions[0].waiting,0,'none waiting: 0, never undefined');
// orders and the rest
eq(keys(gapOf(person([missingMetric('orders',G.NO_TEAM_REASONS[1])]),'orders')),['teamLink'],'orders without a team');
eq(keys(gapOf(person([missingMetric('orders','أخرى')]),'orders')),['reason:orders:أخرى'],'orders otherwise: its own reason');
eq(keys(gapOf(person([missingMetric('variety','تعدد')]),'variety')),['reason:variety:تعدد'],'an indicator with no case listed keeps its own reason');
eq(keys(gapOf(person([missingMetric('variety')]),'variety')),[],'and with no reason, no action');
eq(G.kpiGaps(person(conduct.map(id=>missingMetric(id)))).map(g=>[g.id,g.weight,keys(g)]),[['conduct',10,['conduct']]],'the five conduct indicators: one gap, entered by the management');
eq(keys(G.kpiGaps(person([missingMetric('teamwork')]))[0]),['conduct'],'one conduct indicator alone: the same action');

// The summary over people
const pa={...person([missingMetric('collection'),missingMetric('positive','',{waiting:2}),...conduct.map(id=>missingMetric(id))]),member:{id:'a',name:'أ'}};
const pb={...person([missingMetric('collection'),missingMetric('positive','',{waiting:3}),missingMetric('growth')]),member:{id:'b',name:'ب'}};
const pc={...person([missingMetric('attainment')],{attainment:attainment('weights_missing')}),member:{id:'c',name:'ج'},summary:{inactive:false}};
const pd={...person([missingMetric('collection')]),member:{id:'d',name:'د'},summary:{inactive:true}};
const summary=G.kpiGapSummary([pa,pb,pc,pd]);
eq(summary.people,3,'a person out of the month\'s evaluation is left out of the count');
eq(summary.lines.map(l=>[l.action.key,l.weight,l.people.map(p=>p.id),l.waiting]),[
 ['weights',25,['c'],0],['collection',20,['a','b'],0],['conduct',10,['a'],0],['salesGrowth',5,['b'],0],['rateVisits',2,['a','b'],5]
],'one line per action, the most weight first (each indicator once; the conduct line its five), the people it concerns, the visits waiting summed');
eq(summary.lines.every(l=>l.action.waiting===undefined),true,'a line\'s action carries no waiting of its own');
eq(G.kpiGapSummary([]),{people:0,lines:[]},'nobody: nothing');
const tie=G.kpiGapSummary([{...person([missingMetric('quality','q'),missingMetric('documentation','d')]),member:{id:'x',name:'x'}}]);
eq(tie.lines.map(l=>[l.action.key,l.weight]),[['reason:documentation:d',5],['reason:quality:q',5]],'equal weight and people: by the key');

// The sentences
eq(G.gapActionText({key:'collection',text:G.KPI_GAP_TEXT.collection},'ar',ar),G.KPI_GAP_TEXT.collection[0],'an action in Arabic');
eq(G.gapActionText({key:'collection',text:G.KPI_GAP_TEXT.collection},'en',ar),G.KPI_GAP_TEXT.collection[1],'and in English');
eq(G.gapActionText({key:'teamLink',text:G.KPI_GAP_TEXT.teamLink},'en',ar),'No team is linked. Assign a manager or supervisor to each sales rep in Team and permissions','the closing full stop is removed so actions can be joined');
eq(G.gapActionText({key:'rateVisits',text:G.KPI_GAP_TEXT.rateVisits,waiting:4},'ar',ar),G.KPI_GAP_TEXT.rateVisits[0]+' (زيارات بانتظار التقييم: 4)','the visits waiting after it');
eq(G.gapActionText({key:'rateVisits',text:G.KPI_GAP_TEXT.rateVisits,waiting:4},'en',ar,0),G.KPI_GAP_TEXT.rateVisits[1],'a waiting given as 0 hides it');
eq(G.gapActionText({key:'r',reasonOf:{reason:'سبب المؤشر.'}},'en',en),'EN:سبب المؤشر','an own reason goes through the dictionary');
eq(G.gapActionText({key:'r',reasonOf:{reason:'x',missing:{months:['2026-01'],olderThan:null}}},'en',en).startsWith('Upload complete ERP sales for January 2026'),true,'an own reason waiting for months is written in English with the months');
eq(G.gapActionText({key:'empty'},'ar',ar),'','an action with no words: empty');
eq(G.missingLine(complete,'ar',ar),'','nothing missing: no line');
eq(G.missingLine(undefined,'en',en).startsWith('Missing data: EN:'+K.operationalIndicators[0].name+' (25%), '),true,'no metrics: every indicator, translated, joined with commas');
eq(G.missingLine(complete.filter(m=>!['collection','recovered'].includes(m.id)),'ar',ar),'بيانات ناقصة: التحصيل (20%)، العملاء المستردون (5%)','in Arabic, joined with «، »');
for(const words of [...Object.values(G.KPI_GAP_TEXT),...Object.values(G.KPI_GAP_WORDS)])ok(ARABIC.test(words[0])&&!ARABIC.test(words[1]),'each text has its Arabic and an English with no Arabic: '+words[1].slice(0,40));

// ---------------------------------------------------------------------------------------------------- lib/targets-export.ts
const M='2026-10',P8=T.targetProducts.map(p=>p.id);
const members=[
 {id:'owner',name:'مدير النظام',role:'admin',active:1,branch:'الرئيسي'},
 {id:'sm',name:'مدير المبيعات',role:'manager',active:1,branch:'الرئيسي'},
 {id:'sup',name:'المشرف',role:'supervisor',active:1,branch:'الرئيسي'},
 {id:'a',name:'=HYPERLINK("http://x.invalid","مندوب")',role:'rep',active:1,branch:'الرئيسي'},
 {id:'b',name:'مندوب "باء", الثاني',role:'rep',active:1,branch:'الرئيسي'},
 {id:'old',name:'مندوب سابق',role:'rep',active:0,branch:'الرئيسي'},
 {id:'gone',name:'مندوب غادر',role:'rep',active:0,branch:'الرئيسي'},
 {id:'ro',name:'للقراءة',role:'rep',active:1,branch:'الرئيسي',readOnly:true},
];
eq(E.targetsCsvHeaders,['الشهر','المندوب / الفرع','نوع المستهدف','الصنف / المؤشر','الكمية / الوزن','ساري من'],'the six columns of the targets file');
eq(E.performanceCsvHeaders,['الشهر','المندوب','المؤشر','الوزن %','الدرجة من 100','النقاط المحتسبة','البيانات المطلوبة / طريقة الحساب'],'the seven columns of the evaluation file');
eq([E.targetScopeName('company',members,en),E.targetScopeName('branch:جدة',members,ar),E.targetScopeName('branch:',members,ar),E.targetScopeName('b',members,ar),E.targetScopeName('nobody',members,ar)],['EN:كل المناديب','الفرع بالكامل · جدة','الفرع بالكامل · ','مندوب "باء", الثاني','nobody'],'the scope as the page names it; an unknown id as it is');
const qty=values=>({products:P8.map((product,i)=>({product,quantity:values[i]??null}))});
const set=(kind,scopeId,data,extra={})=>({kind,scopeId,month:M,data,version:1,updatedAt:'',...extra});
const tstate={month:M,branches:['الرئيسي'],sets:[
 set('weights','company',{products:P8.map((product,i)=>({product,weight:i===0?100:0}))}),
 set('sales','a',qty([12.5]),{month:'2026-09'}),
 set('activity','a',{newCustomers:3,recoveredCustomers:2,visits:100}),
 set('activity','sm',{newCustomers:9,recoveredCustomers:9,visits:9}),
 set('sales','sup',qty([20,5]),{computed:true,teamMemberIds:['a','b']}),
 set('activity','sup',{newCustomers:1,recoveredCustomers:1,visits:1},{incomplete:true}),
 set('sales','branch:الرئيسي',qty([50])),
 set('sales','gone',qty([1])),
]};
const csvRows=E.targetsCsvRows(tstate,members,M,ar,['owner']);
const byScope=scope=>csvRows.filter(r=>r[1]===scope);
eq(byScope('مدير النظام'),[],'an administrator the page hides is left out of the file');
eq(byScope('للقراءة'),[],'a read-only member is left out');
eq(byScope('مندوب سابق'),[],'an inactive member with no set of their own is left out');
eq(byScope('مندوب غادر').map(r=>r[2]),[...P8.map(()=>'مستهدفات الأصناف'),...T.activityFields.map(()=>'مستهدفات العملاء والزيارات')],'an inactive member with a set this month: the set, and the default activity targets');
eq(byScope('كل المناديب').map(r=>[r[2],r[4]]),P8.map((p,i)=>['أوزان التقييم',i===0?100:0]),'the company weights, a row a product');
eq(byScope('الفرع بالكامل · الرئيسي').slice(0,2).map(r=>[r[3],r[4],r[5]]),[[P8[0],50,M],[P8[1],'',M]],'the branch\'s own target; a product without a quantity is empty');
eq(byScope(members[3].name).slice(0,1).map(r=>[r[0],r[2],r[4],r[5]]),[[M,'مستهدفات الأصناف',12.5,'2026-09']],'a set carried from an earlier month says the month it is effective from');
eq(byScope(members[3].name).filter(r=>r[2]==='مستهدفات العملاء والزيارات').map(r=>[r[3],r[4]]),[['العملاء الجدد',3],['العملاء المستردون',2],['الزيارات الفعلية',100]],'the saved activity targets');
eq(byScope('مدير المبيعات').length,P8.length,'the sales manager: product targets «غير محدد», and no activity rows (out of the evaluation), even a saved set');
eq(byScope('مدير المبيعات').every(r=>r[5]==='غير محدد'&&r[4]===''),true,'«غير محدد» with an empty quantity');
eq(byScope('المشرف').map(r=>[r[2],r[4],r[5]]).slice(0,P8.length+3).filter((r,i)=>i<2||i>=P8.length),[['مستهدفات الأصناف',20,'محسوب من الفريق'],['مستهدفات الأصناف',5,'محسوب من الفريق'],['مستهدفات العملاء والزيارات','',M],['مستهدفات العملاء والزيارات','',M],['مستهدفات العملاء والزيارات','',M]],'a team set: «محسوب من الفريق»; an incomplete activity set: empty values');
eq(byScope('مندوب "باء", الثاني').filter(r=>r[2]==='مستهدفات العملاء والزيارات').map(r=>[r[4],r[5]]),T.activityFields.map(([key])=>[T.defaultActivityTargets[key],'المستهدفات الافتراضية']),'a representative with nothing saved: the default customer and visit targets');
eq(csvRows.every(r=>r.length===6),true,'every row has the six columns');
eq(E.targetsCsvRows(tstate,members,M,ar).some(r=>r[1]==='مدير النظام'),true,'without the hidden list the administrator is in the file');
eq(E.targetsCsvRows({month:M,branches:[],sets:[]},[],M,ar),[],'no set and nobody: an empty file');

// The page's CSV writer (app/sales-workspace.tsx csv, not exported): its escaping, read from the source and run on these rows.
const workspace=fs.readFileSync(path.join(root,'app/sales-workspace.tsx'),'utf8');
const escSource=workspace.match(/const esc=(\(value:unknown\)=>\{[^}]*\})/);
ok(escSource,'the page writes its CSV through one escaping function');
const esc=new Function('return '+escSource[1].replace('(value:unknown)','(value)'))();
const line=row=>row.map(esc).join(',');
ok(line(byScope(members[3].name)[0]).startsWith('"2026-10","\'=HYPERLINK('),'the row as the file holds it');
eq(esc(byScope(members[3].name)[0][1]),'"\'=HYPERLINK(""http://x.invalid"",""مندوب"")"','a name that starts like a formula is written as text (a leading apostrophe) and its quotes doubled');
eq([esc('+1'),esc('-1'),esc('@SUM(1)'),esc('\tx'),esc('\rx'),esc(' =x'),esc(12.5),esc(''),esc(null),esc(undefined),esc(0)],['"\'+1"','"\'-1"','"\'@SUM(1)"','"\'\tx"','"\'\rx"','" =x"','"12.5"','""','""','""','"0"'],'+, -, @, a tab and a return are neutralised; a space before = is not a formula; numbers and empty cells');
eq(esc('مندوب "باء", الثاني'),'"مندوب ""باء"", الثاني"','a comma stays inside the quoted cell');

// The evaluation file
const kperson=(id,name,metrics,inactive=false)=>({member:{id,name},metrics,summary:K.kpiSummary(metrics,inactive)});
const all=ids.map(id=>K.metric(id,50,'طريقة '+id));
const perf=E.performanceCsvRows([
 kperson('a','كامل',all),
 kperson('b','ناقص',all.map(m=>m.id==='collection'?K.metric('collection',null,'ارفع الكشف'):m)),
 kperson('c','خارج',all,true),
 kperson('d','لا ينطبق',ids.map(id=>K.metric(id,null,'r','automatic',null,null,'not_applicable'))),
 kperson('e','بلا بيانات',ids.map(id=>K.metric(id,null,'r'))),
],M,ar);
eq(perf.length,5*(ids.length+1),'each indicator of each person, then the person\'s overall line');
const overall=name=>perf.find(r=>r[1]===name&&r[2]==='درجة التقييم الكلية');
eq(overall('كامل').slice(3),[100,50,50,'الوزن الذي تم تقييمه: 100 / 100%'],'complete: the score, the points and the weight evaluated');
eq(overall('ناقص').slice(3,6),[100,50,40],'incomplete: the score from the data there is');
eq(overall('ناقص')[6],'غير مكتمل · الدرجة محسوبة من البيانات الموجودة فقط: 80% من الوزن · بيانات ناقصة: التحصيل (20%) · الوزن الذي تم تقييمه: 80 / 100%','incomplete: the warning, the share, the missing indicators with their weights, the weight evaluated');
eq(overall('خارج').slice(3),[100,'','','بلا نشاط في هذا الشهر – خارج التقييم'],'out of the evaluation: no score, no points, only the sentence');
eq(overall('لا ينطبق').slice(3),[0,'',0,'لا ينطبق · الوزن الذي تم تقييمه: 0 / 0%'],'nothing applies: «لا ينطبق»');
ok(overall('بلا بيانات')[6].startsWith('غير مكتمل · بيانات ناقصة: '),'no data at all: incomplete, no partial share, every missing indicator');
const indicatorRow=perf.find(r=>r[1]==='ناقص'&&r[2]==='التحصيل');
eq(indicatorRow,[M,'ناقص','التحصيل',20,'','','ارفع الكشف'],'an indicator without a score: empty score and points, its reason');
const perfEn=E.performanceCsvRows([kperson('b','ناقص',all.map(m=>m.id==='collection'?K.metric('collection',null,'ارفع الكشف'):m))],M,en,'en');
eq(perfEn.at(-1)[6],'EN:غير مكتمل · The score is calculated from the available data only: 80% of the weight · Missing data: EN:التحصيل (20%) · EN:الوزن الذي تم تقييمه: 80 / 100%','the English file: the sentences in English, the names through the dictionary');

// ---------------------------------------------------------------------------------------------------- lib/targets-performance-summary.ts
eq([P.remainingTarget(10,4),P.remainingTarget(10,12),P.remainingTarget(10,-2),P.remainingTarget(0,0),P.remainingTarget(0.3,0.1),P.remainingTarget(1e9,0.000001)],[6,0,12,0,0.2,999999999.999999],'the remaining quantity: never below zero, a return raises it, six decimals (0.3 − 0.1 is 0.2)');
eq([P.remainingTarget(null,1),P.remainingTarget(5,null),P.remainingTarget(undefined,1),P.remainingTarget(NaN,1),P.remainingTarget(5,Infinity),P.remainingTarget(-1,0),P.remainingTarget('5',1)],[null,null,null,null,null,null,null],'unknown input never becomes a zero');
eq([P.shownAchievement(54.545455),P.shownAchievement(1.005),P.shownAchievement(100),P.shownAchievement(-20),P.shownAchievement(0)],[54.55,1.01,100,-20,0],'two decimals, half up (1.005 is 1.01)');
eq([P.shownAchievement(null),P.shownAchievement(undefined),P.shownAchievement(NaN),P.shownAchievement(Infinity),P.shownAchievement('5')],[null,null,null,null,null],'unknown stays unknown');
eq(P.missingIndicators(complete.filter(m=>!conduct.includes(m.id))).map(i=>i.id),conduct,'the missing indicators one by one (the card does not join the conduct ones)');
eq(P.missingIndicators().length,ids.length,'no metrics: all of them');
eq([P.displayedKpiScore({summary:{total:72.5}}),P.displayedKpiScore({summary:{total:72.5,inactive:true}}),P.displayedKpiScore({summary:{total:null}}),P.displayedKpiScore({summary:{total:NaN}}),P.displayedKpiScore({})],[72.5,null,null,null,null],'the score shown: none out of the evaluation, none without data');
eq([P.outOfEvaluation({summary:{inactive:true}}),P.outOfEvaluation({summary:{inactive:false}}),P.outOfEvaluation({})],[true,false,false],'out of the evaluation');

// ---------------------------------------------------------------------------------------------------- lib/targets-overview.ts
eq([1,2,3,10,11,100].map(O.repsCount),['مندوب واحد','مندوبان','3 مناديب','10 مناديب','11 مندوبًا','100 مندوبًا'],'the Arabic counted noun');
const pname=id=>'«'+id+'»';
const ml=(missing,status='missing_inputs',lang='ar')=>O.missingLine({people:0,products:[],noPeople:false,...missing},status,lang,pname);
eq([ml({},'weights_missing'),ml({},'weights_missing','en'),ml({},'not_applicable'),ml({},'not_applicable','en')],['لم تُحدد أوزان الأصناف','No product weights set','لا ينطبق','Not applicable'],'the status first');
eq([ml({noPeople:true}),ml({noPeople:true},'missing_inputs','en')],['لا يوجد مندوبون في هذا الشهر','No representatives this month'],'nobody');
eq([ml({people:1}),ml({people:1},'x','en'),ml({people:2},'x','en')],['مندوب واحد بلا مستهدف لهذا الشهر','1 representative without a target this month','2 representatives without a target this month'],'people without a target');
eq([ml({products:['p']}),ml({products:['p','q']}),ml({products:['p','q'],people:3})],['لم يُحدَّد مستهدف لصنف: «p»','لم يُحدَّد مستهدف لصنفين: «p»، «q»','3 مناديب بلا مستهدف لهذا الشهر؛ لم يُحدَّد مستهدف لصنفين: «p»، «q»'],'one product, two, and with people (joined by «؛ »)');
eq([ml({products:['a','b','c']}),ml({products:Array.from({length:11},(_,i)=>'p'+i)}),ml({products:['a','b','c'],people:2},'x','en')],['لم يُحدَّد مستهدف لـ 3 أصناف (انظر «تفاصيل الفئات»)','لم يُحدَّد مستهدف لـ 11 صنفًا (انظر «تفاصيل الفئات»)','2 representatives without a target this month; No target set for 3 products (see Category details)'],'three products or more: counted');
eq([ml({}),ml({},'missing_inputs','en')],['لم يكتمل المستهدف','Target incomplete'],'nothing named: the status');

const weights=(values)=>set('weights','company',{products:P8.map((product,i)=>({product,weight:values[i]??0}))});
const sale=(repId,items,status='confirmed',date=M+'-05')=>({repId,status,date,items:items.map(([i,quantity])=>({product:P8[i],quantity}))});
const people=[{id:'r1',role:'rep',branch:'الرئيسي',active:1},{id:'r2',role:'rep',branch:'الرئيسي',active:1},{id:'r3',role:'rep',branch:'الرئيسي',active:0},{id:'sup',role:'supervisor',branch:'الرئيسي',active:1},{id:'ro',role:'rep',branch:'الرئيسي',active:1,readOnly:true}];
const ostate=(sets,branches=['الرئيسي'])=>({month:M,branches,sets});
// branchPeople
const bp=O.branchPeople(ostate([set('sales','r3',qty([1])),set('sales','sup',qty([1]),{computed:true,teamMemberIds:['r1']})]),people,'الرئيسي',['r2']);
eq(bp.map(m=>m.id),['r1','r3'],'a branch\'s people: active or with a target this month; never hidden, read-only or a team roll-up');
eq(O.branchPeople(ostate([set('sales','r3',qty([1]),{month:'2026-08'})]),people,'الرئيسي').map(m=>m.id),['r1','r2','sup'],'an inactive member whose target is carried from an earlier month is not counted (a supervisor with no team roll-up of the month is a person like any other)');
eq(O.branchPeople(ostate([set('sales','sup',qty([1]),{computed:true,teamMemberIds:['r3']})]),people,'الرئيسي').map(m=>m.id),['r1','r2','r3'],'an inactive member kept in a team roll-up of the month is counted');
eq(O.branchPeople(ostate([]),people,'جدة'),[],'another branch: nobody');
// One branch, from the people (the representatives: a supervisor's computed roll-up is never one of them, as the page computes it)
const reps=people.filter(m=>m.id!=='sup');
const w2=weights([60,40]);
const s1=O.targetsOverview(ostate([w2,set('sales','r1',qty([10,10,0,0,0,0,0,0])),set('sales','r2',qty([10,10,0,0,0,0,0,0]))]),reps,[sale('r1',[[0,10],[1,4]]),sale('r2',[[0,5],[1,-2]]),sale('r1',[[0,100]],'void'),sale('r2',[[0,100]],'confirmed','2026-09-30'),sale('r9',[[0,100]])],[],P8);
eq([s1.single,s1.branches,s1.company.source,s1.company.peopleIds],[true,[],'people',['r1','r2']],'one branch: one gauge, from its people');
eq(s1.company.attainment.rows.slice(0,2).map(r=>[r.target,r.actual]),[[20,15],[20,2]],'the sum of the people\'s targets; achieved their confirmed sales of the month, a return deducted (void, another month and someone else left out)');
eq([s1.company.attainment.status,s1.company.attainment.score,s1.company.missing],['ready',Math.round((0.75*60+0.1*40)/100*10000)/100,{people:0,products:[],noPeople:false}],'complete: the weighted score, nothing missing');
eq(s1.company.coverage[P8[0]],{set:2,of:2},'how many of the people have a number for a product');
const s2=O.targetsOverview(ostate([w2,set('sales','r1',qty([10,10,0,0,0,0,0,0])),set('sales','r2',qty([10,null,0,0,0,0,0,0]))]),reps,[],[],P8);
eq([s2.company.attainment.status,s2.company.attainment.score,s2.company.missing.products,s2.company.coverage[P8[1]]],['missing_inputs',null,[P8[1]],{set:1,of:2}],'a weighted product only some people have a number for: blank, the product named');
eq(s2.company.attainment.rows[1].achievement,null,'and its own percentage is not shown (part of the target against everybody\'s sales)');
const s3=O.targetsOverview(ostate([w2,set('sales','r1',qty([10,10,0,0,0,0,0,0]))]),reps,[sale('r3',[[0,1]])],[],P8);
eq([s3.company.peopleIds,s3.company.missing.people,s3.company.attainment.score],[['r1','r2'],1,null],'an active person without any target: one person missing, the gauge blank');
const s4=O.targetsOverview(ostate([w2]),[],[],[],P8);
eq([s4.company.missing.noPeople,s4.company.peopleIds,s4.company.attainment.score],[true,[],null],'nobody at all');
const s5=O.targetsOverview(ostate([set('sales','r1',qty([1,1,1,1,1,1,1,1])),set('sales','r2',qty([1,1,1,1,1,1,1,1]))]),reps,[],[],P8);
eq(s5.company.attainment.status,'weights_missing','no weights: «weights_missing» stays');
// A saved branch target: complete wins, incomplete is ignored and named
const s6=O.targetsOverview(ostate([w2,set('sales','branch:الرئيسي',qty([30,10]),{month:'2026-08'}),set('sales','r1',qty([1,1,0,0,0,0,0,0]))]),reps,[sale('r1',[[0,15],[1,10]])],[],P8);
eq([s6.company.source,s6.company.savedMonth,s6.company.attainment.rows.slice(0,2).map(r=>[r.target,r.actual]),s6.company.attainment.score],['saved','2026-08',[[30,15],[10,10]],Math.round((0.5*60+1*40)/100*10000)/100],'a complete saved branch target (its weighted products numbered) wins over the people');
const s7=O.targetsOverview(ostate([w2,set('sales','branch:الرئيسي',qty([30,null])),set('sales','r1',qty([1,1,0,0,0,0,0,0])),set('sales','r2',qty([1,1,0,0,0,0,0,0]))]),reps,[],[],P8);
eq([s7.company.source,s7.company.ignoredSaved,s7.company.attainment.rows[0].target],['people',M,2],'an incomplete saved branch target is ignored (and its month named): the people\'s sum');
const s8=O.targetsOverview(ostate([w2,set('sales','r1',qty([5,5,0,0,0,0,0,0])),set('sales','r2',qty([5,5,0,0,0,0,0,0]))]),reps,[sale('r1',[[0,10],[1,10]])],[],P8);
eq(s8.company.attainment.score,100,'over 100% counts as 100%');
// Two branches
const people2=[...reps,{id:'j1',role:'rep',branch:'جدة',active:1},{id:'j2',role:'rep',branch:'جدة',active:1}];
const t2=O.targetsOverview(ostate([w2,set('sales','r1',qty([10,10])),set('sales','r2',qty([10])),set('sales','j1',qty([4,4])),set('sales','branch:جدة',qty([8,8]))],['الرئيسي','جدة','مكة']),people2,[sale('r1',[[0,10]]),sale('j2',[[0,4],[1,8]])],[],P8);
eq([t2.single,t2.branches.map(b=>[b.name,b.source,b.peopleIds])],[false,[['الرئيسي','people',['r1','r2']],['جدة','saved',['j1','j2']]]],'two branches: a gauge each (a branch with nobody and no saved target has none); a saved branch target wins');
eq(t2.branches.map(b=>b.attainment.rows.slice(0,2).map(r=>[r.target,r.actual])),[[[20,10],[10,0]],[[8,4],[8,8]]],'each branch: its target and its people\'s sales; a product nobody sold is a real zero');
eq([t2.company.source,t2.company.peopleIds,t2.company.attainment.rows.slice(0,2).map(r=>[r.target,r.actual])],['branches',['r1','r2','j1','j2'],[[28,14],[18,8]]],'the company: the sum of the branches');
eq(t2.branches[0].attainment.rows[2].target,null,'a product nobody of the branch has a target for stays not set');

console.log(JSON.stringify({ok:true,checks}));

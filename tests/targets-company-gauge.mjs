// «تحقيق المستهدف — الشركة» (the owner, 2026-11-12: «مفيش فروع للشركة»; every member is in «الرئيسي»): lib/targets-overview.ts.
// A company of one branch has ONE gauge, the company's: the sum of its people's own targets, a saved «الفرع بالكامل» target only when it
// is complete; a blank gauge says exactly what is missing (people without a target, products without one). Two branches or more: as
// before (tests/erp-collections.mjs keeps those numbers). SYNTHETIC fixtures only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';

const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map();
let checks=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
function load(relative){
 const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file).exports;
 const mod={exports:{}};cache.set(file,mod);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(name=>{
  if(name.startsWith('.')||name.startsWith('@/')){const base=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(file),name);return load(path.relative(root,base+(fs.existsSync(base+'.ts')?'.ts':'.tsx')));}
  return nativeRequire(name);
 },mod,mod.exports);
 return mod.exports;
}
const O=load('lib/targets-overview.ts'),T=load('lib/targets.ts');
const P=T.targetProducts.map(p=>p.id),M='2026-11',MAIN='الرئيسي';
// weights: product 0 60%, product 1 40%, the rest 0 (a product of weight zero never needs a target)
const weights={products:P.map((product,i)=>({product,weight:i===0?60:i===1?40:0}))};
const qty=values=>({products:P.map((product,i)=>({product,quantity:values[i]??null}))});
const set=(kind,scopeId,data,extra={})=>({kind,scopeId,month:M,data,version:1,updatedAt:'',...extra});
const sale=(repId,items,status='confirmed',date=M+'-05')=>({repId,status,date,items:items.map(([product,quantity])=>({product:P[product],quantity}))});
// the owner's company: a manager and a supervisor (computed team roll-ups) and three representatives, all in «الرئيسي»
const people=[{id:'sm',role:'manager',branch:MAIN,active:1},{id:'sup',role:'supervisor',branch:MAIN,active:1},{id:'a',role:'rep',branch:MAIN,active:1},{id:'b',role:'rep',branch:MAIN,active:1},{id:'c',role:'rep',branch:MAIN,active:1},{id:'boss',role:'admin',branch:MAIN,active:1}];
const rollups=[set('sales','sm',qty([]),{computed:true,teamMemberIds:['a','b','c']}),set('sales','sup',qty([]),{computed:true,teamMemberIds:['a','b']})];
const base={month:M,branches:[MAIN],sets:[set('weights','company',weights),...rollups,set('sales','a',qty([10,5,1])),set('sales','b',qty([10,5])),set('sales','c',qty([20,10,0,0]))]};
const sales=[sale('a',[[0,10],[1,5]]),sale('b',[[0,5]]),sale('c',[[0,20],[1,-2]]),sale('a',[[0,100]],'void'),sale('a',[[0,100]],'confirmed','2026-10-31'),sale('sm',[[0,500]]),sale('boss',[[1,50]])];
const overview=(state,list=people,hidden=['boss'])=>O.targetsOverview(state,list,sales,hidden,P);
const row=(scope,i)=>{const r=scope.attainment.rows[i];return [r.target,r.actual,r.achievement===null?null:Math.round(r.achievement*100)/100];};
const line=(scope,language='ar')=>O.missingLine(scope.missing,scope.attainment.status,language,id=>id);
const score=(...parts)=>Math.round(parts.reduce((n,[ratio,w])=>n+Math.min(1,Math.max(0,ratio))*w,0)/100*10000)/100;

// ---- one branch: one gauge, from the people
let view=overview(base);
eq([view.single,view.branches],[true,[]],'one branch: the company\'s gauge only, no branch gauge');
eq([view.company.kind,view.company.source,view.company.peopleIds],['company','people',['a','b','c']],'its people are the representatives (not the manager\'s or the supervisor\'s roll-up, not the administrator the month leaves out)');
eq([row(view.company,0),row(view.company,1)],[[40,35,87.5],[20,3,15]],'the sum of the people\'s own targets; achieved is their confirmed sales of the month, a return deducted, a void sale and last month\'s left out, the manager\'s own sale not theirs');
eq(view.company.attainment.score,score([35/40,60],[3/20,40]),'the same weighted formula: each product capped at 100%, weighted');
eq(view.company.attainment.status,'ready','ready');
eq(view.company.missing,{people:0,products:[],noPeople:false},'nothing missing');
eq(row(view.company,2),[1,0,0],'a product of weight zero still shows what is set');
eq(view.company.coverage[P[0]],{set:3,of:3},'«تفاصيل الفئات»: every product says for how many people it is set');
eq(view.company.coverage[P[2]],{set:2,of:3},'(a product of weight zero set for two of three)');

// ---- the cause of the owner's blank gauges: an incomplete saved «الفرع بالكامل» target (carried from an earlier month)
const stale=set('sales','branch:'+MAIN,qty([100]),{month:'2026-09'});
let before=overview({...base,sets:[...base.sets,stale]});
eq([before.company.source,before.company.ignoredSaved,before.company.attainment.score],['people','2026-09',view.company.attainment.score],'an incomplete saved branch target is ignored (and named), the gauge is the people\'s');
// …which the rule of two branches (unchanged) takes whole, blanking that branch (and the company, when it is the only one of the sum):
const twoBranches=O.targetsOverview({...base,branches:[MAIN,'جدة'],sets:[...base.sets,stale,set('sales','d',qty([5,5]))]},[...people,{id:'d',role:'rep',branch:'جدة',active:1}],sales,['boss'],P);
const main=twoBranches.branches.find(b=>b.name===MAIN);
eq([twoBranches.single,main.source,main.attainment.status,twoBranches.company.attainment.status],[false,'saved','missing_inputs','ready'],'two branches: the saved branch target still wins, as before (the company sums what each branch has)');
eq(line(main),'لم يُحدَّد مستهدف لصنف: '+P[1],'and its blank gauge now says which product');

// ---- a complete saved «الفرع بالكامل» target is the company's
const complete=set('sales','branch:'+MAIN,qty([50,null,null]),{month:'2026-10'});
view=overview({...base,sets:[...base.sets,complete]});
eq([view.company.source,view.company.ignoredSaved,view.company.attainment.status],['people','2026-10','ready'],'a saved target missing a weighted product is not complete: the people\'s sum is used');
const full=set('sales','branch:'+MAIN,qty([50,30]),{month:'2026-10'});
view=overview({...base,sets:[...base.sets,full]});
eq([view.company.source,view.company.savedMonth,view.company.ignoredSaved],['saved','2026-10',undefined],'complete (a number for every product of a non-zero weight): used, with the month it is effective from');
eq([row(view.company,0),row(view.company,1)],[[50,35,70],[30,3,10]],'its target against the people\'s sales');
eq(view.company.attainment.score,score([35/50,60],[3/30,40]),'weighted');
eq(view.company.coverage,undefined,'no per-person coverage for a saved target');
const reps=[...people.filter(m=>m.role!=='rep'),{id:'a',role:'rep',branch:MAIN,active:1}];
eq(overview({...base,sets:[...base.sets,full]},reps).company.attainment.status,'ready','a complete saved target does not need every person\'s');

// ---- what is really missing, said in one line
view=overview({...base,sets:base.sets.filter(s=>s.scopeId!=='c')});
eq([view.company.attainment.score,view.company.attainment.status],[null,'missing_inputs'],'an active representative without a target this month: the gauge is blank');
eq(view.company.missing,{people:1,products:[],noPeople:false},'one person');
eq(line(view.company),'مندوب واحد بلا مستهدف لهذا الشهر','«مندوب واحد بلا مستهدف لهذا الشهر»');
eq(line(view.company,'en'),'1 representative without a target this month','in English');
eq(view.company.coverage[P[0]],{set:2,of:3},'«محدَّد لـ 2 من 3»');
eq(row(view.company,0),[20,35,null],'a product set for only part of the people shows its sum and its sales, never a percentage');
view=overview({...base,sets:base.sets.filter(s=>!['a','b','c'].includes(s.scopeId))});
eq(line(view.company),'3 مناديب بلا مستهدف لهذا الشهر','«3 مناديب بلا مستهدف لهذا الشهر»');
eq(view.company.missing.products,[],'and no product list repeating it');
view=overview({...base,sets:[...base.sets.filter(s=>s.scopeId!=='b'),set('sales','b',qty([10,null,5]))]});
eq([view.company.missing,line(view.company)],[{people:0,products:[P[1]],noPeople:false},'لم يُحدَّد مستهدف لصنف: '+P[1]],'a person\'s target without a weighted product: «لم يُحدَّد مستهدف لصنف: …»');
eq(row(view.company,1),[15,3,null],'its row: what is set, no percentage');
view=overview({...base,sets:[...base.sets.filter(s=>!['b','c'].includes(s.scopeId)),set('sales','b',qty([null,null,5]))]});
eq(line(view.company),'مندوب واحد بلا مستهدف لهذا الشهر؛ لم يُحدَّد مستهدف لصنفين: '+P[0]+'، '+P[1],'both, in one line');
eq(line(view.company,'en'),'1 representative without a target this month; No target set for: '+P[0]+', '+P[1],'in English');
eq(overview({...base,sets:[...base.sets.filter(s=>s.scopeId!=='c'),set('sales','c',qty([20,10]))]}).company.attainment.status,'ready','a product of weight zero left empty is not missing');
eq(overview({...base,sets:[...base.sets.filter(s=>s.scopeId!=='c'),set('sales','c',qty([0,0]))]}).company.attainment.status,'ready','a target of zero is a target (the way to leave a person out)');
eq(overview({...base,sets:base.sets.filter(s=>s.kind!=='weights')}).company.attainment.status,'weights_missing','no weights: no score');
eq(O.missingLine({people:2,products:[],noPeople:false},'weights_missing','ar',id=>id),'لم تُحدد أوزان الأصناف','the weights first');

// ---- who is counted
const retired={id:'old',role:'rep',branch:MAIN,active:0},retainedState={...base,sets:base.sets.map(s=>s.scopeId==='sm'?{...s,teamMemberIds:['a','b','c','old']}:s)};
view=overview(retainedState,[...people,retired]);
eq([view.company.peopleIds.includes('old'),view.company.attainment.status],[true,'ready'],'an inactive person kept in a team, without a target and without a sale this month, is not missing');
view=O.targetsOverview(retainedState,[...people,retired],[...sales,sale('old',[[0,4]])],['boss'],P);
eq([view.company.missing.people,row(view.company,0)[1]],[1,39],'with a confirmed sale this month they are (their sales count)');
view=overview({...base,sets:[...base.sets,set('sales','boss',qty([5,5]))]},people,[]);
eq([view.company.peopleIds,row(view.company,1)],[['a','b','c','boss'],[25,53,212]],'an administrator with a target of their own is one of the people');
view=overview({...base,branches:[MAIN,'مكة'],sets:[...base.sets,set('sales','branch:مكة',qty([7,7]))]});
eq([view.single,view.branches,view.company.attainment.score],[true,[],overview(base).company.attainment.score],'a branch with nobody (only a saved target, or customers) does not make a second branch');

// ---- nobody, and the counted nouns
view=overview({...base,branches:[]},people.filter(m=>m.role!=='rep'));
eq([view.single,view.company.missing.noPeople,line(view.company)],[true,true,'لا يوجد مندوبون في هذا الشهر'],'nobody: said so');
eq([1,2,3,10,11,25].map(O.repsCount),['مندوب واحد','مندوبان','3 مناديب','10 مناديب','11 مندوبًا','25 مندوبًا'],'MSA agreement of «مندوب»');
eq(O.missingLine({people:0,products:P.slice(0,4),noPeople:false},'missing_inputs','ar',id=>id),'لم يُحدَّد مستهدف لـ 4 أصناف (انظر «تفاصيل الفئات»)','more than two products: their number, the names are in «تفاصيل الفئات»');
eq(O.missingLine({people:0,products:[],noPeople:false},'missing_inputs','ar',id=>id),'لم يكتمل المستهدف','nothing named: the general line');
eq(O.missingLine({people:0,products:[],noPeople:false},'not_applicable','en',id=>id),'Not applicable','every weighted target zero');

// ---- two branches: the same numbers as before (tests/erp-collections.mjs), one gauge each
view=O.targetsOverview({...base,branches:['الدمام',MAIN]},[...people,{id:'d',role:'rep',branch:'الدمام',active:1}],sales,['boss'],P);
eq([view.single,view.branches.map(b=>b.name),view.company.source],[false,['الدمام',MAIN],'branches'],'two branches with people: the company and each branch');
ok(view.branches.every(b=>b.missing&&b.missing.people===0),'(the people rule is the one-branch company\'s only)');
console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));

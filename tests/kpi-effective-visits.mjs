// «نسبة الزيارات الفعالة» from the supervisor's evaluation (the owner, 2026-11-15: «موافق تمام», relayed from the GSCO conversation; it
// replaces the rule of 2026-11-14 that read the customer's stage). Each visit of the month counts by its evaluation, read as the notes read
// it (lib/supervisor-reviews.ts entryRatingOf and saleEntry, the choice kept in the note's audit row): «فعالة» or «إيجابية» (the visit that
// records the sale, even with no note) effective, «سلبية» not, none yet left out and counted as waiting; score = effective ÷ evaluated; with
// none evaluated the indicator is missing (left out of the score from the data there is, never a zero).
// 1. The pure rule (lib/kpis.ts): GSCO's four cases (nothing evaluated: missing with 3 waiting; one «فعالة» and one «سلبية»: 50%; a sale with
//    no note: 2 of 3; all evaluated: 2 of 4), and a supervisor of another team, an evaluation changed later, an old note without one, a
//    stored «إيجابية» on what is no longer a sale, a lost visit evaluated «فعالة», calls and other months left out, no visits at all.
// 2. Its readers: the overall score (missing leaves its weight out), the export (lib/targets-export.ts) in Arabic and English.
// 3. The real routes (GET /api/sales?kpis=1 and POST /api/reviews, compiled as the build does) on a migrated in-memory SQLite: the same
//    cases saved by real notes, a supervisor of another team refused, a member moved to another team keeping the evaluations, a closed month
//    recomputed live. 4. One definition only: lib/kpis*.ts read the evaluation through lib/supervisor-reviews*.ts. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'kpi-effective-visits-')),seen=new Set();
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
for(const file of ['app/api/sales/route.ts','app/api/reviews/route.ts','lib/kpis.ts','lib/targets.ts','lib/targets-export.ts','lib/i18n.ts'])compile(file);
const load=file=>import(pathToFileURL(path.join(out,file)));
const K=await load('lib/kpis.mjs'),{quantityAttainment}=await load('lib/targets.mjs'),{performanceCsvRows}=await load('lib/targets-export.mjs'),i18n=await load('lib/i18n.mjs');
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const counts={};const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};

const UNRATED=n=>'لم يقيّم المشرف زيارات هذا الشهر بعد. زيارات بانتظار تقييم المشرف: '+n+'.';
const RATED=n=>'الزيارات التي قيّمها المشرف «فعالة» أو «إيجابية» (تم البيع) ÷ الزيارات التي قيّمها. زيارات بانتظار تقييم المشرف: '+n+'.';
const shape=m=>({score:m.score,numerator:m.numerator,denominator:m.denominator,status:m.status,source:m.source,waiting:m.waiting,reason:m.reason});

// ---- 1. The pure rule.
await counted('pure rule',async()=>{
 const month='2025-09';
 const member=(id,role='rep',supervisorId='sup')=>({id,name:id,email:id+'@test.invalid',role,branch:'HQ',regionScope:'eastern',supervisorId,active:1,target:0,authVersion:1});
 const state={month,branches:[],sets:[]};
 const performance=(id='rep1',ids=[id],role='rep')=>({member:member(id,role),sourceMemberIds:ids,salesSourceMemberIds:ids,teamRollup:ids.length>1,activityTeamRollup:ids.length>1,activityTargetsKnown:true,activityTargets:{newCustomers:10,recoveredCustomers:2,visits:10},attainment:quantityAttainment(id,state,[])});
 const customer=(id,assignedTo)=>({id,kind:'customer',parentId:null,assignedTo,branch:'HQ',data:{name:'Factory '+id},createdAt:'2025-01-01T00:00:00Z',updatedAt:'2025-01-01T00:00:00Z',version:1});
 const visit=(id,by,customerId,extra={},date='2025-09-10')=>({id,kind:'activity',parentId:customerId,assignedTo:by,branch:'HQ',data:{type:'visit',date,performedBy:by,responsibleId:by,salesStage:'specs',summary:'s',...extra},createdAt:date+'T08:00:00Z',updatedAt:date+'T08:00:00Z',version:1});
 const base=[customer('c1','rep1'),customer('c2','rep2'),visit('v1','rep1','c1',{salesStage:'quoted'}),visit('v2','rep1','c1'),visit('v3','rep1','c1',{salesStage:'new'})];
 const positive=(records,ratings,p=performance())=>K.calculateKpis(p,month,records,[],null,K.prepareKpiRecords(records,month,undefined,new Map(Object.entries(ratings)))).metrics.find(m=>m.id==='positive');
 const person=(records,ratings,p=performance())=>K.calculateKpis(p,month,records,[],null,K.prepareKpiRecords(records,month,undefined,new Map(Object.entries(ratings))));
 // GSCO's four cases.
 eq(shape(positive(base,{})),{score:null,numerator:null,denominator:null,status:'missing',source:'required',waiting:3,reason:UNRATED(3)},'1. nothing evaluated: missing (not zero), 3 waiting');
 eq(shape(positive(base,{v1:'effective',v2:'negative'})),{score:50,numerator:1,denominator:2,status:'scored',source:'automatic',waiting:1,reason:RATED(1)},'2. one «فعالة» and one «سلبية»: 50%, 1 waiting');
 const withSale=[...base,visit('v4','rep1','c1',{salesStage:'won'})];
 eq(shape(positive(withSale,{v1:'effective',v2:'negative'})),{score:66.67,numerator:2,denominator:3,status:'scored',source:'automatic',waiting:1,reason:RATED(1)},'3. the sale visit is «إيجابية» with no note: 2 of 3');
 eq(shape(positive(withSale,{v1:'effective',v2:'negative',v3:'negative'})),{score:50,numerator:2,denominator:4,status:'scored',source:'automatic',waiting:0,reason:RATED(0)},'4. all evaluated: 2 of 4');
 // A rating changed later counts as it is now.
 eq([positive(withSale,{v1:'effective',v2:'effective',v3:'negative'}).score,positive(withSale,{v1:'negative',v2:'negative',v3:'negative'}).score],[75,25],'an evaluation changed later: the last one counts');
 // An old note without an evaluation, or anything that is not a choice, is waiting.
 for(const old of [null,undefined,'','great',0])eq([positive(withSale,{v1:'effective',v2:old}).waiting,positive(withSale,{v1:'effective',v2:old}).denominator],[2,2],'an old note without an evaluation ('+JSON.stringify(old)+'): waiting');
 // The sale: «تم الفوز», or a follow-up recorded as a visit that turned into an invoice; never a lost one; a choice saved on it is ignored.
 const followup=visit('f1','rep1','c1',{visitWorkflow:'followup-v1',salesStage:'quoted',invoiceOutcome:'invoiced'});
 eq(shape(positive([...base,followup],{})),{score:100,numerator:1,denominator:1,status:'scored',source:'automatic',waiting:3,reason:RATED(3)},'a follow-up of type visit that turned into an invoice is «إيجابية» by itself');
 eq(positive(withSale,{v4:'negative'}).numerator,1,'a «سلبية» saved on the sale visit does not hold: it is «إيجابية»');
 const noLongerSale=[...base,visit('v4','rep1','c1',{salesStage:'lost',invoiceOutcome:'invoiced'})];
 eq([positive(noLongerSale,{v4:'positive'}).status,positive(noLongerSale,{v4:'positive'}).waiting],['missing',4],'a stored «إيجابية» on a visit that is no longer a sale is no evaluation');
 eq([positive(noLongerSale,{v4:'effective'}).score,positive(noLongerSale,{v4:'effective'}).denominator],[100,1],'the customer\'s stage no longer decides: a lost visit evaluated «فعالة» is effective');
 eq(positive([...base,visit('lost','rep1','c1',{salesStage:'lost'})],{v1:'effective',lost:'negative'}).score,50,'and one evaluated «سلبية» is not');
 // A supervisor of another team: the evaluations of rep2's visits (another team) never enter rep1's ratio, and rep2's count only rep2's.
 const teams=[...base,visit('w1','rep2','c2'),visit('w2','rep2','c2')],ratings={v1:'effective',v2:'negative',w1:'negative',w2:'negative'};
 eq([positive(teams,ratings).score,positive(teams,ratings).denominator,positive(teams,ratings).waiting],[50,2,1],'rep1: only rep1\'s visits');
 eq([positive(teams,ratings,performance('rep2')).score,positive(teams,ratings,performance('rep2')).denominator],[0,2],'rep2 (another team): only rep2\'s visits, a real zero');
 eq([positive(teams,ratings,performance('mgr',['rep1','rep2'],'manager')).score,positive(teams,ratings,performance('mgr',['rep1','rep2'],'manager')).denominator,positive(teams,ratings,performance('mgr',['rep1','rep2'],'manager')).waiting],[25,4,1],'a manager\'s roll-up: both teams\' visits');
 // The set of visits is unchanged: visits (and follow-ups recorded as visits) of the month by the person; calls and other months are not.
 const others=[...base,visit('call','rep1','c1',{type:'call'}),visit('meet','rep1','c1',{type:'meeting'}),visit('august','rep1','c1',{},'2025-08-31'),visit('october','rep1','c1',{},'2025-10-01')];
 eq([positive(others,{call:'effective',meet:'effective',august:'effective',october:'effective'}).status,positive(others,{call:'effective'}).waiting],['missing',3],'calls, meetings and visits of other months are not in the set, evaluated or not');
 eq(K.kpiVisits(others,K.kpiPeriod(month)).map(r=>r.id),['v1','v2','v3'],'kpiVisits: the same set «الزيارات الفعلية» counts');
 eq(person(others,{}).metrics.find(m=>m.id==='visits').numerator,3,'«الزيارات الفعلية» counts the same three');
 // No visit at all: «لا ينطبق», nothing waiting.
 eq(shape(positive([customer('c1','rep1')],{})),{score:null,numerator:0,denominator:0,status:'not_applicable',source:'automatic',waiting:0,reason:RATED(0)},'no visit: not applicable');
 // Without ratings (an old caller): every visit that is not a sale is waiting.
 eq(K.calculateKpis(performance(),month,withSale,[],null).metrics.find(m=>m.id==='positive').numerator,1,'no evaluations handed over: only the sale counts');
 // The overall score: missing leaves its 2% out (as missing data does since 2026-11-14), scored counts it.
 const missing=person(base,{}).summary,scored=person(base,{v1:'effective'}).summary;
 ok(missing.missing.includes('positive')&&!scored.missing.includes('positive'),'missing is named among the indicators without data, scored is not');
 eq(scored.scoredWeight-missing.scoredWeight,2,'its 2% of weight counts only once evaluated');
 eq(K.visitEvaluations(withSale.filter(r=>r.kind==='activity'),new Map([['v1','effective'],['v2','negative']])),{effective:2,negative:1,rated:3,waiting:1},'visitEvaluations: the counts');
});

// ---- 2. The readers: the export, in Arabic and English.
await counted('export and English',async()=>{
 const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));i18n.installEnglish(dictionary);
 const english=value=>i18n.translateText(value,'en');
 eq(english(UNRATED(3)),"The supervisor has not rated any visit this month yet. Visits awaiting the supervisor's rating: 3.",'the unrated reason in English');
 eq(english(RATED(12)),"Visits the supervisor rated «Effective» or «Positive» (sold) ÷ the visits they rated. Visits awaiting the supervisor's rating: 12.",'the rated reason in English');
 eq(english('نسبة الزيارات الفعالة'),'Effective visit rate','the name in English');
 const metric={...K.metric('positive',null,UNRATED(3),'required'),waiting:3},person={member:{id:'rep1',name:'Rep One'},metrics:[metric],summary:K.kpiSummary([metric])};
 eq(performanceCsvRows([person],'2025-09',value=>value,'ar')[0],['2025-09','Rep One','نسبة الزيارات الفعالة',2,'','',UNRATED(3)],'the export: no score, the reason with the waiting visits');
 const rated={...K.metric('positive',50,RATED(1),'automatic',1,2),waiting:1};
 eq(performanceCsvRows([{...person,metrics:[rated],summary:K.kpiSummary([rated])}],'2025-09',english,'en')[0],['2025-09','Rep One','Effective visit rate',2,50,1,"Visits the supervisor rated «Effective» or «Positive» (sold) ÷ the visits they rated. Visits awaiting the supervisor's rating: 1."],'the export in English: score, points and reason');
 ok(!/[؀-ۿ]/.test(english(UNRATED(0))+english(RATED(0))),'no Arabic left in the English reasons');
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
 const stamp=new Date().toISOString(),riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
 const day=riyadh.format(new Date()),month=day.slice(0,7),previous=(()=>{const d=new Date(month+'-15T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);})();
 const member=(id,role,supervisor=null,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,stamp);
 member('owner','admin',null,'all');member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');member('rep1','rep','sup');member('rep2','rep','sup2');
 sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
 const record=(id,kind,parent,assigned,data)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),stamp,stamp);
 record('c1','customer',null,'rep1',{name:'مصنع الشرق',region:'الشرقية',city:'الدمام'});record('c2','customer',null,'rep2',{name:'مصنع الخبر',region:'الشرقية',city:'الخبر'});
 const activity=(id,by,customer,extra={},date=day)=>record(id,'activity',customer,by,{type:'visit',date,summary:'تعريف',result:'نتيجة '+id,performedBy:by,responsibleId:by,recordedByEmail:by+'@yourrest.org',salesStage:'specs',...extra});
 activity('v1','rep1','c1',{salesStage:'quoted'});activity('v2','rep1','c1');activity('v3','rep1','c1',{salesStage:'new'});activity('w1','rep2','c2');activity('call1','rep1','c1',{type:'call'});
 const salesApi=await load('app/api/sales/route.mjs'),reviewsApi=await load('app/api/reviews/route.mjs');
 const read=async(who='mgr',m=month)=>{globalThis.testIdentity=who;const response=await salesApi.GET(new Request('https://test.invalid/api/sales?month='+m+'&kpis=1'));const data=await response.json();eq(response.status,200,who+' reads the KPIs: '+JSON.stringify(data).slice(0,300));return data;};
 const positive=(data,id='rep1')=>shape(data.kpis.people.find(p=>p.member.id===id).metrics.find(m=>m.id==='positive'));
 const versions={};
 const rate=async(who,activityId,rating,status=200)=>{
  globalThis.testIdentity=who;
  const response=await reviewsApi.POST(new Request('https://test.invalid/api/reviews',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify({kind:'entry',requestId:crypto.randomUUID(),activityId,version:versions[activityId]??null,result:'زيارة جيدة',action:'جهّز عرض السعر',...(rating?{rating}:{})})}));
  const data=await response.json();eq(response.status,status,who+' evaluates '+activityId+' '+rating+' -> '+JSON.stringify(data).slice(0,300));
  if(status===200)versions[activityId]=data.review.version;return data;
 };
 // GSCO's four cases through the real routes.
 let data=await read();
 eq(positive(data),{score:null,numerator:null,denominator:null,status:'missing',source:'required',waiting:3,reason:UNRATED(3)},'1. nothing evaluated: missing, 3 waiting (the call is not a visit)');
 ok(data.kpis.people.find(p=>p.member.id==='rep1').summary.missing.includes('positive'),'named among the indicators without data');
 await rate('sup','v1','effective');await rate('sup','v2','negative');
 eq(positive(await read()),{score:50,numerator:1,denominator:2,status:'scored',source:'automatic',waiting:1,reason:RATED(1)},'2. «فعالة» and «سلبية»: 50%');
 activity('v4','rep1','c1',{salesStage:'won'});
 eq(positive(await read()),{score:66.67,numerator:2,denominator:3,status:'scored',source:'automatic',waiting:1,reason:RATED(1)},'3. a sale visit with no note: 2 of 3');
 await rate('sup','v3','negative');
 eq(positive(await read()),{score:50,numerator:2,denominator:4,status:'scored',source:'automatic',waiting:0,reason:RATED(0)},'4. all evaluated: 2 of 4');
 eq((await rate('sup','v4',null)).review.rating,'positive','the sale\'s note is «إيجابية» by itself');
 eq(positive(await read()).score,50,'and it is counted once');
 // An evaluation changed later: the note's last save counts.
 eq((await rate('sup','v2','effective')).review.version,2,'v2 edited');
 eq([positive(await read()).numerator,positive(await read()).score],[3,75],'«سلبية» changed to «فعالة»: 3 of 4');
 // An old note saved before the evaluation existed: waiting.
 activity('v5','rep1','c1');
 const oldId='review-entry:sup:'+crypto.randomUUID();
 sql.prepare('INSERT INTO crm_daily_entry_reviews(activity_id,member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?)').run('v5','rep1',day,'ملاحظة قديمة','إجراء قديم','sup',oldId,stamp,stamp);
 sql.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').run(oldId,'v5','اسم sup','مراجعة المشرف لزيارة أو متابعة',JSON.stringify({before:null,after:{activityId:'v5',memberId:'rep1',date:day,result:'ملاحظة قديمة',action:'إجراء قديم',reviewedBy:'sup',version:1}}),stamp);
 versions.v5=1;
 eq(positive(await read()),{score:75,numerator:3,denominator:4,status:'scored',source:'automatic',waiting:1,reason:RATED(1)},'an old note without an evaluation: waiting');
 // A supervisor of another team cannot evaluate rep1's visit, and nothing of theirs counts for rep1.
 await rate('sup2','v5','negative',403);
 await rate('sup2','w1','negative');
 data=await read();
 eq([positive(data).score,positive(data).waiting],[75,1],'rep1 unchanged by the other team\'s supervisor');
 eq([positive(data,'rep2').score,positive(data,'rep2').denominator],[0,1],'rep2: the evaluation of their own supervisor, a real zero');
 eq([positive(data,'mgr').numerator,positive(data,'mgr').denominator,positive(data,'mgr').waiting],[3,5,1],'the sales manager\'s roll-up: both teams');
 eq([positive(data,'sup').status,positive(data,'sup2').status],['not_applicable','not_applicable'],'a supervisor\'s activity indicators are personal: no visits of their own');
 // A call evaluated «فعالة» does not count: it is not a visit.
 await rate('owner','call1','effective');
 eq(positive(await read()).denominator,4,'a call is not in the set, even evaluated');
 // A member moved to another team keeps the evaluations of their visits: they belong to the visit, whoever wrote them.
 sql.prepare("UPDATE crm_members SET supervisor_id='sup2' WHERE id='rep1'").run();
 eq([positive(await read()).score,positive(await read()).waiting],[75,1],'rep1 moved to sup2\'s team: the same evaluations count');
 // The administrator's evaluation counts like a supervisor's.
 await rate('owner','v5','effective');
 eq([positive(await read()).numerator,positive(await read()).denominator,positive(await read()).waiting],[4,5,0],'the administrator evaluates the last visit');
 // A closed month is recomputed live (KPI results are never stored): its visits are waiting until evaluated.
 activity('old1','rep2','c2',{},previous+'-15');activity('old2','rep2','c2',{},previous+'-16');
 eq([positive(await read('mgr',previous),'rep2').status,positive(await read('mgr',previous),'rep2').waiting],['missing',2],'last month: missing while nothing is evaluated');
 await rate('mgr','old1','effective');
 eq([positive(await read('mgr',previous),'rep2').score,positive(await read('mgr',previous),'rep2').waiting],[100,1],'evaluating a visit of last month changes last month\'s result');
 eq(positive(await read(),'rep2').denominator,1,'and not this month\'s');
 // The reading itself: the evaluation the note's last save carries.
 const {chosenEntryRatings}=await load('lib/supervisor-reviews-server.mjs');
 eq(Object.fromEntries([...(await chosenEntryRatings(DB,['v1','v2','v3','v4','v5','w1','old1','none']))].sort()),{old1:'effective',v1:'effective',v2:'effective',v3:'negative',v4:'positive',v5:'effective',w1:'negative'},'chosenEntryRatings: the stored choice of each note, nothing for a visit without one');
 eq((await chosenEntryRatings(DB,[])).size,0,'no visits: no query');
 sql.close();
});

// ---- 4. One definition: the KPI reads the evaluation through lib/supervisor-reviews*.ts only.
await counted('one definition',async()=>{
 const kpis=fs.readFileSync(path.join(root,'lib/kpis.ts'),'utf8'),server=fs.readFileSync(path.join(root,'lib/kpis-server.ts'),'utf8');
 ok(/import \{entryRatingOf,saleEntry\} from '\.\/supervisor-reviews';/.test(kpis),'lib/kpis.ts takes entryRatingOf and saleEntry from lib/supervisor-reviews.ts');
 ok(/import \{chosenEntryRatings\} from '\.\/supervisor-reviews-server';/.test(server),'lib/kpis-server.ts reads the evaluations with chosenEntryRatings');
 ok(!/crm_daily_entry_reviews|\$\.after\.rating|invoiceOutcome|salesStage==='won'/.test(kpis+server),'no second reading of the evaluation or of the sale in the KPI files');
 ok(!/POSITIVE_REASON|مرحلتهم الحالية ليست/.test(kpis),'yesterday\'s rule (the customer\'s stage) is gone');
});
console.log(JSON.stringify({ok:true,checks,counts,scope:'«نسبة الزيارات الفعالة» from the supervisor\'s evaluation: the pure rule, its readers, the real routes on SQLite, one definition'}));

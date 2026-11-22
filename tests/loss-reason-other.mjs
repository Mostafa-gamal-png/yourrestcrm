// «أخرى» as a loss reason (the owner of GSCO, 2026-11-21, ported 2026-11-22 with GSCO 2.13.85; lib/loss-reason-other.ts), without a build.
// What Yourrest had already (the list's «أخرى», «تفاصيل سبب الفقد» kept apart and required with it, the reports grouping by the reason) is
// checked to be unchanged; what was added: the text names the reason in 3 to 200 characters under «اذكر سبب الخسارة» (no text, 2, 3, 200 and
// 201 characters), on the follow-up form, the route POST /api/customer-followups (saved and read back with its text, an entry the device kept
// before the update accepted as it was, one kept after refused), the record import, an opportunity's free-text reason («أخرى» alone and
// «أخرى: ab» refused, «أخرى: …» saved), the customer-service report grouping every «أخرى: …» under «أخرى», and the field's words in Arabic and
// English. Synthetic people and factories only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

// Monday 23 November 2026, 09:00 Riyadh: the server starts after the release day (lib/release-gate.ts).
const NativeDate=Date;let clock=NativeDate.parse('2026-11-23T06:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'loss-reason-other-')),seen=new Set();
process.on('exit',()=>{globalThis.Date=NativeDate;fs.rmSync(out,{recursive:true,force:true});});
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email,provider:'email-otp'};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const file of ['app/api/customer-followups/route.ts','lib/loss-reason-other.ts','lib/customer-followups.ts','lib/crm.ts','lib/service-report.ts'])compile(file);
const load=file=>import(pathToFileURL(path.join(out,file)));
const L=await load('lib/loss-reason-other.mjs'),F=await load('lib/customer-followups.mjs'),C=await load('lib/crm.mjs');
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};

// ---- 1. The rule.
eq(F.followupLossReasons.includes(L.LOSS_OTHER),true,'«أخرى» is one of the follow-up\'s reasons (as before)');
eq([L.lossDetailProblem('أخرى',''),L.lossDetailProblem('أخرى','  '),L.lossDetailProblem('أخرى','ab'),L.lossDetailProblem('أخرى','abc'),L.lossDetailProblem('أخرى','س'.repeat(200)),L.lossDetailProblem('أخرى','س'.repeat(201)),L.lossDetailProblem(' أخرى ','  عرض أرخص  ')],
 [L.LOSS_MESSAGES.required,L.LOSS_MESSAGES.required,L.LOSS_MESSAGES.range,'','',L.LOSS_MESSAGES.range,''],'«أخرى»: no text, 2 and 201 characters refused; 3 and 200 accepted; spaces trimmed');
eq([L.lossDetailProblem('السعر أعلى من المنافس',''),L.lossDetailProblem('السعر أعلى من المنافس','ab'),L.lossDetailProblem('',''),L.lossDetailProblem(undefined,undefined)],['','','',''],'any other reason asks nothing here (its details stay optional)');
eq(['أخرى','أخرى:','أخرى: ab','أخرى: سبب','أخرى - المنتج متوقف','أخرى، تأخر الدفع','السعر','',null].map(L.freeLossReasonProblem),[L.LOSS_MESSAGES.required,L.LOSS_MESSAGES.required,L.LOSS_MESSAGES.range,'','','','','',''],'an opportunity\'s free text: «أخرى» alone refused, «أخرى: …» needs 3 characters');
eq(['أخرى: تأخر الدفع','أخرى','السعر أعلى من المنافس',' أخرى: x ',''].map(L.lossReasonGroup),['أخرى','أخرى','السعر أعلى من المنافس','أخرى',''],'reports group every «أخرى: …» under «أخرى»');
// The schemas: the follow-up keeps the earlier rule for stored records (something written); an opportunity's «أخرى» needs its text.
const followup=(reason,details)=>F.customerFollowupSchema.safeParse({type:'call',date:'2026-11-23',result:'تحدثت مع العميل',salesStage:'lost',invoiceOutcome:'pending',lossReason:reason,lossDetails:details}).success;
eq([followup('أخرى',''),followup('أخرى','ab'),followup('أخرى','سبب واضح')],[false,true,true],'the follow-up schema as before: «أخرى» needs details (the length is the route\'s, so stored records stay valid)');
const opportunity=reason=>C.schemas.opportunity.safeParse({hasRequest:true,moldType:'ق',product:'ب',dimensions:'1',quantity:1,stage:'lost',lossReason:reason,closedAt:'2026-11-23'});
eq([opportunity('أخرى').success,opportunity('أخرى: ab').success,opportunity('أخرى: المصنع أغلق').success,opportunity('السعر').success],[false,false,true,true],'an opportunity: «أخرى» alone and «أخرى: ab» refused');
eq(opportunity('أخرى').error.issues.map(issue=>issue.message),[L.LOSS_MESSAGES.required],'with its words');
// The English of the words (lib/locales/en.json).
const en=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
eq([en[L.LOSS_MESSAGES.label],en[L.LOSS_MESSAGES.required],en[L.LOSS_MESSAGES.range]],['State the loss reason','Write the loss reason when choosing “Other”.','Write the loss reason in 3 to 200 characters.'],'the words in English');
// The form: «أخرى» opens «اذكر سبب الخسارة», required, at most 200, and the form checks it before saving (an entry kept on the device is never refused later).
const form=fs.readFileSync(path.join(root,'app/customer-followups.tsx'),'utf8');
ok(form.includes('data.lossReason===LOSS_OTHER?<div data-loss-other><VoiceField label={LOSS_MESSAGES.label}')&&form.includes('required multiline inputProps={{maxLength:LOSS_DETAIL_MAX}}'),'the form: «أخرى» opens «اذكر سبب الخسارة», required, 200 at most');
ok(form.includes("lossDetailProblem(data.lossReason,data.lossDetails)")&&form.includes('setError(t(lossProblem))'),'and checks it before saving');

// ---- 2. The route.
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const iso=()=>new Date().toISOString(),member=(id,role,supervisor=null)=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,role==='admin'?'all':'eastern',iso());
member('owner','admin');member('sup','supervisor');member('rep','rep','sup');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const insert=(id,kind,parent,data,created=iso())=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').run(id,kind,parent,'rep','الرئيسي',JSON.stringify(kind==='customer'?{name:'عميل '+id,region:'الشرقية',...data}:{performedBy:'rep',recordedByEmail:'rep@yourrest.org',responsibleId:'rep',...data}),created,created,'fixture');
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const route=await load('app/api/customer-followups/route.mjs');
async function post(payload,status=200){globalThis.testIdentity='rep';const response=await route.POST(new Request('https://test.invalid/api/customer-followups',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(payload)}));const result=await response.json();eq(response.status,status,JSON.stringify(result).slice(0,300));return result;}
const open=id=>{insert(id,'customer',null,{});insert(id+'-v','activity',id,{visitWorkflow:'customer-v1',type:'visit',date:'2026-11-20',summary:'زيارة',result:'العميل مهتم',salesStage:'specs',nextAction:'اتصال',nextDate:'2026-11-22'},'2026-11-20T07:00:00.000Z');return id+'-v';};
const body=(customerId,sourceId,details,extra={})=>({createKey:crypto.randomUUID(),customerId,customerVersion:raw(customerId).version,sourceId,sourceVersion:raw(sourceId).version,data:{type:'call',date:'2026-11-23',result:'تحدثت مع العميل',salesStage:'lost',invoiceOutcome:'pending',nextAction:'',nextDate:'',lossReason:'أخرى',lossDetails:details},...extra});
let source=open('c1');
eq((await post(body('c1',source,''),400)).error,'حدد سبب الفقد، واكتب التفاصيل عند اختيار أخرى','no text: refused (the earlier words of the schema)');
eq((await post(body('c1',source,'ab'),400)).error,L.LOSS_MESSAGES.range,'two characters: refused');
eq((await post(body('c1',source,'س'.repeat(201)),400)).error,L.LOSS_MESSAGES.range,'201 characters: refused');
let saved=await post(body('c1',source,'  المصنع أغلق خط الإنتاج  '));
let stored=JSON.parse(raw(saved.id).data);
eq([stored.salesStage,stored.lossReason,stored.lossDetails],['lost','أخرى','المصنع أغلق خط الإنتاج'],'saved and read back: «أخرى» and its text');
source=open('c2');
saved=await post(body('c2',source,'س'.repeat(200)));
eq(JSON.parse(raw(saved.id).data).lossDetails.length,200,'200 characters accepted');
// An entry the device kept before the update (its moment before the release day): accepted as it was; one kept after: refused.
source=open('c3');
clock=NativeDate.parse('2026-11-23T06:30:00.000Z');
await post(body('c3',source,'ab',{offline:{memberId:'rep',capturedAt:'2026-11-23T06:10:00.000Z'}}),400);
const queued=body('c3',source,'ab',{offline:{memberId:'rep',capturedAt:'2026-11-21T18:00:00.000Z'}});queued.data.date='2026-11-21';
saved=await post(queued);
eq(JSON.parse(raw(saved.id).data).lossDetails,'ab','kept on the device before the update: accepted with the earlier rule, so it never sticks');

// ---- 3. The customer-service report groups every «أخرى: …» under «أخرى».
const report=fs.readFileSync(path.join(root,'lib/service-report.ts'),'utf8');
ok(report.includes('lossReasonGroup(serviceLossReason(item,c.all))'),'the customer-service report groups by lossReasonGroup');

console.log(JSON.stringify({ok:true,checks}));

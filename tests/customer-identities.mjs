// Real handlers + SQLite: retained ERP aliases and explicit, scoped identity resolution.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'security-customer-code-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),'export async function getApplicationUser(){return globalThis.testUser;}');
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('app/api/crm/route.ts');compile('lib/kpi-history-server.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
let beforeBatch,auditFailure=false;
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 async run(){if(auditFailure&&this.query.startsWith('INSERT INTO crm_audit'))throw Error('synthetic-identity-audit-failure');return{meta:{changes:Number(sql.prepare(this.query).run(...this.args).changes)}};}
 async all(){return{results:sql.prepare(this.query).all(...this.args)};}
 async first(){return sql.prepare(this.query).get(...this.args)||null;}
}
const DB={prepare:query=>new Statement(query),batch:async statements=>{
 if(beforeBatch){const race=beforeBatch;beforeBatch=undefined;await race();}
 sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}
}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString();
sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,1,0,?)').run('rep','rep@yourrest.org','Test rep','rep','HQ','eastern',now);
globalThis.testUser={provider:'email-otp',memberId:'rep',memberVersion:sql.prepare("SELECT auth_version FROM crm_members WHERE id='rep'").get().auth_version,userId:'test-rep',email:'rep@yourrest.org',fullName:'Test rep'};
const crm=await import(path.join(out,'app/api/crm/route.mjs'));
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const data=id=>JSON.parse(raw(id).data);
const post=async(body,status=200)=>{
 const response=await crm.POST(new Request('https://test.invalid/api/crm',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)}));
 const payload=await response.json();check(response.status,status,JSON.stringify(payload));return payload;
};
const create=code=>({action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'Test factory',region:'الشرقية',location:'',code}});
const edit=(id,changes)=>({action:'save',kind:'customer',id,version:raw(id).version,data:{...data(id),...changes}});
const number=id=>sql.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(id)?.number;
const auditCount=id=>sql.prepare('SELECT COUNT(*) n FROM crm_audit WHERE record_id=?').get(id).n;

const first=(await post(create('ERP-OLD'))).id;
sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,1,0,?)').run('owner','owner@yourrest.org','Test admin','admin','HQ','all',now);
const login=id=>{const member=sql.prepare('SELECT * FROM crm_members WHERE id=?').get(id);globalThis.testUser={provider:'email-otp',memberId:id,memberVersion:member.auth_version,userId:'test-'+id,email:member.email,fullName:member.name};};
sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at) VALUES('quote','quote',?,'rep','HQ',?,?,?)").run(first,JSON.stringify({number:'Synthetic quote',date:'2025-01-01',status:'sent',performedBy:'rep'}),now,now);
sql.prepare("INSERT INTO crm_erp_imports VALUES('fixture','owner','synthetic','synthetic.xlsx','{}',?)").run(now);
sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES('erp-old','key','hash','mapped','INV-1','sale','2025-01-15','e1','rep','HQ','eastern','ERP-OLD','Synthetic factory','{}',10000,'fixture','owner',?)").run(now);
const {context}=await import(path.join(out,'lib/crm-server.mjs'));
const {isValidKpiConversion,readKpiPurchaseHistory}=await import(path.join(out,'lib/kpi-history-server.mjs'));
const sale={id:'erp-old',customerId:'erp-customer:ERP-OLD',repId:'rep',source:'erp',date:'2025-01-15',status:'confirmed',totalCents:10000,documentType:'sale'};
check(isValidKpiConversion(await context(),'quote','erp-old','rep','2025-01',[sale]),true);
await post(edit(first,{code:'ERP-NEW'}));
check(isValidKpiConversion(await context(),'quote','erp-old','rep','2025-01',[sale]),true,'A source-code edit must preserve prior ERP invoice/quote identity');
// A second source reference and manual sales still represent one actual factory.
const oldErp=sql.prepare('SELECT * FROM crm_erp_sales WHERE id=?').get('erp-old');
const erpColumns=Object.keys(oldErp),insertErp=sql.prepare('INSERT INTO crm_erp_sales('+erpColumns.join(',')+') VALUES('+erpColumns.map(()=>'?').join(',')+')');
for(const extra of [{id:'erp-new',document_key:'new-key',reference:'INV-2',customer_code:'ERP-NEW'},{id:'erp-prior',document_key:'prior-key',reference:'INV-PRIOR',date:'2024-12-15'}]){const row={...oldErp,...extra};insertErp.run(...erpColumns.map(column=>row[column]));}
sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES('manual',?,'rep','HQ','2025-01-16','MANUAL','MANUAL','{}',5000,'confirmed','',1,'test','test','owner',?,?)").run(first,now,now);
sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,1,0,?)').run('peer','peer@yourrest.org','ERP-only rep','rep','HQ','eastern',now);
for(const [id,date] of [['peer-prior','2024-12-15'],['peer-current','2025-01-15']]){const row={...oldErp,id,document_key:id,reference:id,date,rep_id:'peer',employee_id:'e2'};insertErp.run(...erpColumns.map(column=>row[column]));}
sql.exec("UPDATE crm_sales SET data=json_set(data,'$.items',json('[]'));UPDATE crm_erp_sales SET data=json_set(data,'$.items',json('[]'));");
const beforeMoney=sql.prepare('SELECT SUM(total_cents) n FROM crm_erp_sales').get().n;
const facts=(await readKpiPurchaseHistory(await context(),'2025-01')).facts;
check(facts[0].customerKey,'crm:'+first,'Old and new aliases identify the same persisted factory');
check(new Set(facts.map(row=>row.customerKey)).size,1,'Two ERP aliases and a manual invoice have one customer identity');
const {calculateKpis}=await import(path.join(out,'lib/kpis.mjs'));
const performance={member:{id:'rep'},sourceMemberIds:['rep'],salesSourceMemberIds:['rep'],activityTargetsKnown:true,activityTargets:{newCustomers:1,recoveredCustomers:1,visits:1},attainment:{rows:[],score:null}};
const scored=calculateKpis(performance,'2025-01',[],[],null,undefined,{historyComplete:true,purchases:facts,collection:null,quotationsComplete:false,quotations:[],recoveryTarget:1});
const retention=scored.metrics.find(row=>row.id==='retention');check([retention.numerator,retention.denominator],[1,1],'Customer retention counts the aliased factory once');


login('owner');
const second=(await post({action:'save',kind:'customer',data:{name:'Synthetic western factory',code:'ｅｒｐ-old',region:'الغربية',location:'',assignedTo:'owner',branch:'HQ'}})).id;
const ambiguousHistory=await readKpiPurchaseHistory(await context(),'2025-01');
check(ambiguousHistory.unresolved.has('peer'),true,'ERP-only shared references also need review before customer KPIs');
check(ambiguousHistory.facts.some(row=>row.repId==='peer'),false,'Ambiguous factory identity cannot fabricate ERP-only customer cohorts');
login('rep');
check(isValidKpiConversion(await context(),'quote','erp-old','rep','2025-01',[sale]),false,'A hidden western duplicate remains globally ambiguous');

compile('app/api/customer-identities/route.ts');compile('app/api/customers/import/route.ts');
const identities=await import(path.join(out,'app/api/customer-identities/route.mjs')),imports=await import(path.join(out,'app/api/customers/import/route.mjs'));
const call=async(route,body,status=200,origin='https://test.invalid')=>{const response=body===undefined?await route.GET():await route.POST(new Request('https://test.invalid/api/test',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));const json=await response.json();check(response.status,status,JSON.stringify(json));return json;};
await call(identities,undefined,403);
login('owner');
let options=await call(identities),identity=options.identities.find(row=>row.codeKey==='ERP-OLD');
check(identity.status,'ambiguous');check(identity.customerIds.slice().sort(),[first,second].sort());
check(options.customers.every(row=>/^YR-C-\d{6,}$/.test(row.internalCode)),true);
const mapping=(state,target=first)=>{const identity=state.identities.find(row=>row.codeKey==='ERP-OLD');return{codeKey:'ｅｒｐ-old',customerId:target,version:identity.mappingVersion,revision:state.revision,customerVersion:state.customers.find(row=>row.id===target)?.version||0,requestId:crypto.randomUUID()};};
let body=mapping(options);
await call(identities,{...body,customerId:'unknown'},409);
await call(identities,body,403,'https://other.invalid');
const earlierRevision=sql.prepare("SELECT revision FROM crm_erp_import_state WHERE id='yourrest-industries'").get().revision;
await call(identities,body);
check(sql.prepare("SELECT revision FROM crm_erp_import_state WHERE id='yourrest-industries'").get().revision,earlierRevision+1,'Explicit resolution invalidates prior KPI completeness');
options=await call(identities);check(options.identities.find(row=>row.codeKey==='ERP-OLD').status,'mapped');
check((await call(identities,body)).alreadySaved,true,'Response-loss replay uses the original receipt');
check((await readKpiPurchaseHistory(await context(),'2025-01')).unresolved.has('peer'),false,'One saved mapping resolves future and historical ERP-only customer identity');
await call(identities,{...body,customerId:second},409);
// Two requests that passed replay before either commit must not reuse the
// winning receipt as authority for a second write.
let raceState=await call(identities),raceBody=mapping(raceState),raceVersion=raceState.identities.find(row=>row.codeKey==='ERP-OLD').mappingVersion;
beforeBatch=async()=>{await call(identities,raceBody);};
check((await call(identities,raceBody)).alreadySaved,true);
check(sql.prepare('SELECT version FROM crm_customer_code_mappings WHERE code_key=?').get('ERP-OLD').version,raceVersion+1,'Identical concurrent replay increments mapping once');
raceState=await call(identities);raceBody=mapping(raceState);raceVersion=raceState.identities.find(row=>row.codeKey==='ERP-OLD').mappingVersion;
beforeBatch=async()=>{await call(identities,raceBody);};
await call(identities,{...raceBody,customerId:second,customerVersion:raceState.customers.find(row=>row.id===second).version},409);
check({...sql.prepare('SELECT customer_id,version FROM crm_customer_code_mappings WHERE code_key=?').get('ERP-OLD')},{customer_id:first,version:raceVersion+1},'Conflicting replay cannot overwrite the winner');
login('rep');check(isValidKpiConversion(await context(),'quote','erp-old','rep','2025-01',[sale]),true);
await call(identities,mapping(options),403);
login('owner');
// A racing ordinary customer edit cannot bind a now stale reviewed choice.
body=mapping(await call(identities));
beforeBatch=()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.notes','edited'),version=version+1 WHERE id=?").run(first);
await call(identities,body,409);
check(sql.prepare('SELECT version FROM crm_customer_code_mappings WHERE code_key=?').get('ERP-OLD').version,raceVersion+1);
// Revocation at commit preserves the role but must still block the mutation.
body=mapping(await call(identities));beforeBatch=()=>sql.prepare("UPDATE crm_members SET auth_version=auth_version+1 WHERE id='owner'").run();
await call(identities,body,409);login('owner');
const auditBefore=sql.prepare('SELECT COUNT(*) n FROM crm_audit').get().n;
body=mapping(await call(identities));auditFailure=true;await call(identities,body,500);auditFailure=false;
check(sql.prepare('SELECT COUNT(*) n FROM crm_audit').get().n,auditBefore);check(sql.prepare('SELECT version FROM crm_customer_code_mappings WHERE code_key=?').get('ERP-OLD').version,raceVersion+1);
// A reviewed change can select the other factory; an eastern rep must not get
// that western identity through quotation evidence as a consequence.
options=await call(identities);await call(identities,mapping(options,second));
login('rep');check(isValidKpiConversion(await context(),'quote','erp-old','rep','2025-01',[sale]),false);
login('owner');options=await call(identities);await call(identities,mapping(options,''));
check((await call(identities)).identities.find(row=>row.codeKey==='ERP-OLD').status,'ambiguous');
// Mapping state belongs to the same snapshot as KPI evidence, not an earlier
// context captured before the current sales/evidence revisions were read.
compile('lib/kpi-evidence-server.ts');compile('lib/kpis-server.ts');
const {getKpiEvidenceOptions,saveKpiEvidence}=await import(path.join(out,'lib/kpi-evidence-server.mjs'));
const {kpiData}=await import(path.join(out,'lib/kpis-server.mjs'));
await call(identities,mapping(await call(identities),first));
const staleContext=await context();
await call(identities,mapping(await call(identities),second));
const live=await context(),liveOptions=await getKpiEvidenceOptions(live,'rep','2025-01');
const proposal={memberId:'rep',month:'2025-01',version:0,requestId:crypto.randomUUID(),salesRevision:liveOptions.salesRevision,evidenceRevision:liveOptions.evidenceRevision,input:{collection:{dueCents:null,collectedCents:null,reference:''},history:{complete:true,reference:'Synthetic reconciled ERP history'},quotationsComplete:true,quotations:[]}};
await assert.rejects(()=>getKpiEvidenceOptions(staleContext,'rep','2025-01'),error=>error.status===409);checks++;
await assert.rejects(()=>saveKpiEvidence(staleContext,proposal),error=>error.status===409);checks++;
check(sql.prepare('SELECT COUNT(*) n FROM crm_kpi_evidence').get().n,0,'Stale identity snapshot cannot save modern evidence');
await saveKpiEvidence(live,proposal);
await assert.rejects(()=>kpiData(staleContext,'2025-01',[performance]),error=>error.status===409);checks++;
check((await kpiData(await context(),'2025-01',[performance])).people.length,1,'Fresh identity/evidence snapshot remains usable');

// New master imports retain valid shared ERP refs, stable IDs and CRM numbers.
const sourceHash='a'.repeat(64),keys=['b'.repeat(64),'c'.repeat(64)];
const batch={sourceHash,sourceFile:'synthetic.csv',rows:keys.map((sourceKey,index)=>({id:'yr-import-'+sourceKey.slice(0,32),data:{name:'Imported factory '+index,code:index?'IMPORT-SHARED':'ｉｍｐｏｒｔ-shared',region:'الشرقية',location:'26.4,50.0',sourceKey,sourceRow:index+1}}))};
check((await call(imports,batch)).inserted,2);
const numbers=sql.prepare('SELECT customer_id,number FROM crm_customer_numbers ORDER BY number').all();
check((await call(imports,batch)).inserted,0);check(sql.prepare('SELECT customer_id,number FROM crm_customer_numbers ORDER BY number').all(),numbers);
check((await call(identities)).identities.find(row=>row.codeKey==='IMPORT-SHARED').status,'ambiguous');
// Global administrators can resolve legacy factories whose territory was never
// entered, without turning a null/omitted region into a permanent false conflict.
sql.prepare("INSERT INTO crm_records(id,kind,assigned_to,branch,data,created_at,updated_at) VALUES('legacy-unknown','customer','owner','HQ',?,?,?)").run(JSON.stringify({name:'Legacy unknown territory',code:'LEGACY-UNKNOWN'}),now,now);
const legacyOptions=await call(identities),legacyCustomer=legacyOptions.customers.find(row=>row.id==='legacy-unknown');
check(legacyCustomer.region,'');
await call(identities,{codeKey:'LEGACY-UNKNOWN',customerId:legacyCustomer.id,version:0,revision:legacyOptions.revision,customerVersion:legacyCustomer.version,requestId:crypto.randomUUID()});
check(sql.prepare('SELECT SUM(total_cents) n FROM crm_erp_sales').get().n,beforeMoney,'Resolving identities never changes booked money');
check(sql.prepare('PRAGMA foreign_key_check').all(),[]);check(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
console.log(JSON.stringify({customerIdentities:'passed',checks,scope:'Real CRUD/import/mapping routes, old aliases, hidden-region ambiguity, admin authorization, CAS, revocation, audit rollback, source replay and unchanged money'}));

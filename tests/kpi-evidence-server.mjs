import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

// Actual authenticated evidence routes, migrations and transactional SQLite. No production access.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'kpi-evidence-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
fs.writeFileSync(path.join(out,'parser.mjs'),`export class ErpWorkbookError extends Error{}; export function parseErpWorkbook(){throw Error('Evidence endpoints must not invoke the upload parser');}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(imp==='./erp-sales')return 'from '+JSON.stringify(path.join(out,'parser.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
compile('app/api/kpi-evidence/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
let race=null,auditFailure=false;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){if(auditFailure&&this.q.startsWith('INSERT INTO crm_audit'))throw Error('simulated evidence audit failure');const result=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const now='2025-01-01T00:00:00.000Z',month='2025-02';
function member(id,role='rep',region='eastern',supervisor='sup',active=1){sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'HQ',supervisor,region,active,now);}
member('admin','admin','all','');member('manager','manager','eastern','');member('sup','supervisor','eastern','manager');member('rep');member('rep2');member('other','rep','eastern','other-sup');member('west','rep','western','sup');member('inactive','rep','eastern','sup',0);member('service','customer_service');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
function record(id,kind,parent,author,data,assigned='rep'){sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,kind,parent,assigned,'HQ',JSON.stringify({...data,...(author?{performedBy:author,recordedByEmail:author+'@yourrest.org'}:{})}),now,now);}
record('customer','customer',null,null,{name:'Factory',code:'C1',region:'الشرقية'});record('customer2','customer',null,null,{name:'Other factory',code:'C2',region:'الشرقية'});record('west-customer','customer',null,null,{name:'Private west customer',code:'CW',region:'الغربية'},'west');
record('machine','factory','customer',null,{name:'Machine'});record('admin-request','opportunity','machine','admin',{responsibleId:'rep',technicalStatus:'approved',hasRequest:true,stage:'quoted'});
function quote(id,{parent='admin-request',author='sup',date='2025-02-05',status='sent'}={}){record(id,'quote',parent,author,{number:'QUOTE-'+id,date,validUntil:'2025-12-31',status,items:[{description:'Mold',quantity:1,price:100}],discount:0,taxRate:15,total:115});}
quote('quote-manual');quote('quote-erp');quote('quote-unconverted');quote('quote-second');quote('quote-draft',{status:'draft'});quote('quote-prior',{date:'2025-01-15'});quote('quote-future',{date:'2025-03-01'});quote('quote-manager',{author:'manager'});quote('quote-west',{parent:'west-customer',author:'west'});quote('quote-other',{author:'other'});
record('quoted-visit','activity','customer','rep',{type:'visit',date:'2025-02-08',salesStage:'quoted',summary:'Issued quote during visit'});record('legacy-quote-visit','activity','customer','rep',{type:'quote',date:'2025-02-09',summary:'Legacy quote'});record('ordinary-visit','activity','customer','rep',{type:'visit',date:'2025-02-09',salesStage:'specs',summary:'Specifications only'});
const product='قوالب البلوك المتحركة',items=[{product,quantity:1,unitPrice:100,description:'Mold'}];
function manual(id,{date='2025-02-12',rep='rep',customer='customer',status='confirmed'}={}){sql.prepare('INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,?,\'HQ\',?,?,?,?,?,?,\'\',1,\'fixture\',\'fixture\',\'admin\',?,?)').run(id,customer,rep,date,id,id,JSON.stringify({items,discount:0,notes:''}),10000,status,now,now);}
manual('manual');manual('manual-second');manual('wrong-customer',{customer:'customer2'});manual('too-early',{date:'2025-02-01'});manual('void',{status:'void'});manual('prior',{date:'2025-01-10'});manual('after-cutoff',{date:'2025-03-01'});manual('rep2-sale',{rep:'rep2'});manual('private-other-sale',{rep:'other'});manual('private-west-sale',{rep:'west',customer:'west-customer'});manual('inactive-sale',{rep:'inactive'});manual('zero-manual');sql.prepare("UPDATE crm_sales SET total_cents=0 WHERE id='zero-manual'").run();
sql.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('fixture','admin','fixture','fixture.xlsx','{}',?)").run(now);
function erp(id,{date='2025-02-13',rep='rep',region='eastern',code='C1',type='sale'}={}){const sign=type==='return'?-1:1;sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'hash','mapped',?,?,?,'E1',?,'HQ',?,?,'ERP factory',?,?,'fixture','admin',?)").run(id,id,id,type,date,rep,region,code,JSON.stringify({items:items.map(item=>({...item,quantity:sign})),discount:0}),10000*sign,now);}
erp('erp-sale');erp('erp-return',{type:'return'});erp('erp-wrong-customer',{code:'C2'});erp('erp-empty-code',{code:''});erp('erp-hidden',{rep:'west',region:'western',code:'CW'});erp('zero-erp');sql.prepare("UPDATE crm_erp_sales SET total_cents=0 WHERE id='zero-erp'").run();
const api=await import(path.join(out,'app/api/kpi-evidence/route.mjs'));
let checks=0;const check=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};const user=id=>{globalThis.testIdentity=id;};
const blank=()=>({collection:{dueCents:null,collectedCents:null,reference:''},history:{complete:false,reference:''},quotationsComplete:false,quotations:[]});
const evidenceRow=(id='rep',period=month)=>sql.prepare('SELECT * FROM crm_kpi_evidence WHERE member_id=? AND month=?').get(id,period);
const revision=()=>sql.prepare("SELECT revision FROM crm_kpi_evidence_state WHERE id='company'").get().revision;
const auditCount=()=>sql.prepare('SELECT count(*) AS n FROM crm_audit').get().n;
function assertStatus(actual,expected,data){assert.ok((Array.isArray(expected)?expected:[expected]).includes(actual),`Expected HTTP ${expected}; received ${actual}: ${JSON.stringify(data)}`);checks++;}
async function read(id='rep',period=month,status=200){const response=await api.GET(new Request('https://test.invalid/api/kpi-evidence?'+new URLSearchParams({memberId:id,month:period}))),data=await response.json();assertStatus(response.status,status,data);return data;}
async function post(body,status=200,origin='https://test.invalid'){const response=await api.POST(new Request('https://test.invalid/api/kpi-evidence',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})),data=await response.json();assertStatus(response.status,status,data);return data;}
async function draft(input=blank(),id='rep',period=month){const s=await read(id,period);return {memberId:id,month:period,version:s.evidence?.version||0,requestId:crypto.randomUUID(),salesRevision:s.salesRevision,evidenceRevision:s.evidenceRevision,input};}
const idOf=entry=>entry.id||entry.quoteId||entry.saleId;

// Existing installations remain readable and GET does not create evidence or audit records.
user('admin');let s=await read();check(s.memberId,'rep');check(s.month,month);check(s.evidence,null);check(s.canEdit,true);check(typeof s.scopeKey,'string');check(typeof s.salesRevision,'number');check(typeof s.evidenceRevision,'number');check(evidenceRow(),undefined);check(revision(),0);check(auditCount(),0);
let quoteIds=s.quotes.map(idOf),invoiceIds=s.invoices.map(idOf);
for(const id of ['quote-manual','quote-erp','quote-unconverted','quoted-visit','legacy-quote-visit'])check(quoteIds.includes(id),true,'Eligible issued quote '+id);
for(const id of ['quote-draft','quote-prior','quote-future','ordinary-visit','quote-west'])check(quoteIds.includes(id),false,'Ineligible quote or quote outside the selected rep region '+id);
for(const id of ['manual','manual-second','erp-sale'])check(invoiceIds.includes(id),true,'Own confirmed invoice '+id);
for(const id of ['void','erp-return','prior','after-cutoff','rep2-sale','private-other-sale','private-west-sale','erp-hidden','zero-erp','zero-manual'])check(invoiceIds.includes(id),false,'Ineligible or private invoice '+id);

// Customer identity changes invalidate history completeness; ordinary edits do not.
const salesRevision=()=>sql.prepare("SELECT revision FROM crm_erp_import_state WHERE id='yourrest-industries'").get().revision;
let priorSalesRevision=salesRevision();record('freshness-coded','customer',null,null,{name:'Identity fixture',code:'FRESHNESS',region:'الشرقية'});check(salesRevision(),priorSalesRevision+1,'A coded customer insertion changes sales identity');
priorSalesRevision=salesRevision();sql.prepare("UPDATE crm_records SET data=json_set(data,'$.code','FRESHNESS-NEW'),version=version+1 WHERE id='freshness-coded'").run();check(salesRevision(),priorSalesRevision+1,'Customer code mutation invalidates completeness');
priorSalesRevision=salesRevision();sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الغربية'),version=version+1 WHERE id='freshness-coded'").run();check(salesRevision(),priorSalesRevision+1,'Customer territory mutation invalidates completeness');
priorSalesRevision=salesRevision();sql.prepare("UPDATE crm_records SET data=json_set(data,'$.notes','Unrelated note'),version=version+1 WHERE id='freshness-coded'").run();check(salesRevision(),priorSalesRevision,'Notes and optimistic version changes do not invalidate completeness');
priorSalesRevision=salesRevision();sql.prepare("DELETE FROM crm_records WHERE id='freshness-coded'").run();check(salesRevision(),priorSalesRevision+1,'Deleting a coded customer changes sales identity');
priorSalesRevision=salesRevision();record('freshness-blank','customer',null,null,{name:'No ERP identity',code:'',region:'الشرقية'});check(salesRevision(),priorSalesRevision,'A blank customer code does not change ERP identity');sql.prepare("DELETE FROM crm_records WHERE id='freshness-blank'").run();check(salesRevision(),priorSalesRevision,'Deleting a blank-code customer does not change ERP identity');

// Issued quotation membership/identity changes invalidate confirmations; prose edits do not.
function expectSalesRevision(delta,mutation,message){const before=salesRevision();mutation();check(salesRevision(),before+delta,message);}
expectSalesRevision(0,()=>quote('freshness-quote',{status:'draft'}),'A draft quote is not issued evidence');
expectSalesRevision(1,()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.status','sent'),version=version+1 WHERE id='freshness-quote'").run(),'Issuing a draft changes the quote cohort');
for(const [field,value] of [['status','accepted'],['date','2025-02-06'],['performedBy','manager'],['recordedByEmail','manager@yourrest.org'],['responsibleId','rep2']])expectSalesRevision(1,()=>sql.prepare('UPDATE crm_records SET data=json_set(data,?,?),version=version+1 WHERE id=?').run('$.'+field,value,'freshness-quote'),'Issued quotation '+field+' changes invalidate the confirmation');
expectSalesRevision(1,()=>sql.prepare("UPDATE crm_records SET parent_id='customer2',version=version+1 WHERE id='freshness-quote'").run(),'Issued quotation ancestry changes invalidate the confirmation');
expectSalesRevision(0,()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.terms','Updated wording','$.number','New display label'),version=version+1 WHERE id='freshness-quote'").run(),'Terms, display labels and version-only edits do not change quote identity');
expectSalesRevision(1,()=>sql.prepare("DELETE FROM crm_records WHERE id='freshness-quote'").run(),'Deleting an issued standalone quote invalidates the confirmation');
expectSalesRevision(1,()=>record('freshness-quote-activity','activity','customer','rep',{type:'quote',date:'2025-02-05',summary:'Legacy quotation'}),'A legacy quote activity enters the cohort');
expectSalesRevision(0,()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.summary','Updated description'),version=version+1 WHERE id='freshness-quote-activity'").run(),'Quote activity text edits do not alter the cohort');
expectSalesRevision(1,()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.type','call'),version=version+1 WHERE id='freshness-quote-activity'").run(),'Removing quote type invalidates the confirmation');
expectSalesRevision(0,()=>sql.prepare("DELETE FROM crm_records WHERE id='freshness-quote-activity'").run(),'Deleting an ordinary call does not alter quotations');
expectSalesRevision(1,()=>record('freshness-quoted-visit','activity','customer','rep',{type:'visit',salesStage:'quoted',date:'2025-02-05',summary:'Quotation visit'}),'A visit in quoted stage enters the cohort');
expectSalesRevision(1,()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.salesStage','specs'),version=version+1 WHERE id='freshness-quoted-visit'").run(),'Leaving quoted stage invalidates the confirmation');
expectSalesRevision(0,()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.summary','Routine visit wording','$.date','2025-02-07'),version=version+1 WHERE id='freshness-quoted-visit'").run(),'Ordinary visit text and date changes do not alter the quotation cohort');
expectSalesRevision(1,()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.salesStage','quoted'),version=version+1 WHERE id='freshness-quoted-visit'").run(),'Returning to quoted stage invalidates the confirmation');
expectSalesRevision(1,()=>sql.prepare("DELETE FROM crm_records WHERE id='freshness-quoted-visit'").run(),'Deleting a quoted-stage activity invalidates the confirmation');

// Saving preserves real zero, exact cents, invoice identity and unconverted quotation evidence.
const full={collection:{dueCents:10000,collectedCents:0,reference:'Verified ledger February'},history:{complete:true,reference:'ERP and manual purchase history reconciled'},quotationsComplete:true,quotations:[{quoteId:'quote-manual',saleId:'manual'},{quoteId:'quote-erp',saleId:'erp-sale'},{quoteId:'quote-unconverted',saleId:null}]};
let body=await draft(full);await post(body);s=await read();check(s.evidence.input,full);check(s.evidence.version,1);check(revision(),1);check(auditCount(),1);const initialSnapshot=JSON.stringify(evidenceRow());
await post(body);check(JSON.stringify(evidenceRow()),initialSnapshot,'Identical response-loss retry does not rewrite evidence');check(revision(),1);check(auditCount(),1);
await post({...body,input:{...full,collection:{...full.collection,collectedCents:1}}},409);await post({...body,requestId:crypto.randomUUID()},409);
const updated={...full,collection:{dueCents:10000,collectedCents:7500,reference:'Verified cash receipt 123'}};body=await draft(updated);await post(body);check((await read()).evidence.input.collection.collectedCents,7500);check(evidenceRow().version,2);

// Evidence proposals are globally serialized; another member's save invalidates an open proposal.
const stale=await draft(updated);const sibling=await draft(blank(),'rep2');await post(sibling);await post(stale,409);await post(sibling);check(evidenceRow('rep2').version,1,'Replay succeeds despite the now advanced evidence revision');
const existing=JSON.stringify(evidenceRow());
for(const invalid of [
 {...updated,collection:{dueCents:0,collectedCents:1,reference:'Collection without any amount due'}},
 {...updated,collection:{dueCents:-1,collectedCents:0,reference:'Negative due'}},
 {...updated,collection:{dueCents:100.5,collectedCents:0,reference:'Fractional cents'}},
 {...updated,collection:{dueCents:100,collectedCents:null,reference:'Partial figures'}},
 {...updated,collection:{dueCents:100,collectedCents:0,reference:''}},
 {...updated,history:{complete:true,reference:''}},
 {...updated,quotations:[{quoteId:'quote-manual',saleId:'manual'},{quoteId:'quote-manual',saleId:null}]},
 {...updated,quotations:[{quoteId:'quote-manual',saleId:'manual'},{quoteId:'quote-second',saleId:'manual'}]},
])await post(await draft(invalid),[400,409]);
check(JSON.stringify(evidenceRow()),existing,'Invalid evidence cannot partially replace an accepted assessment');

// The server must verify both ends: quote cohort, seller, customer, chronology and document type.
for(const [quoteId,saleId] of [
 ['quote-draft','manual'],['quote-prior','manual'],['quote-future','manual'],['ordinary-visit','manual'],['missing-quote','manual'],
 ['quote-manual','wrong-customer'],['quote-manual','too-early'],['quote-manual','void'],['quote-manual','erp-return'],['quote-manual','erp-wrong-customer'],['quote-manual','erp-empty-code'],
 ['quote-manual','rep2-sale'],['quote-manual','private-west-sale'],['quote-manual','after-cutoff'],['quote-manual','missing-invoice'],['quote-manual','zero-erp'],['quote-manual','zero-manual'],
])await post(await draft({...updated,quotations:[{quoteId,saleId}]}),[400,403,404,409]);
check(JSON.stringify(evidenceRow()),existing);
// Exact customer codes are useful only if unique; a namesake must never establish identity.
record('duplicate-code','customer',null,null,{name:'A different customer',code:'C1',region:'الشرقية'});await post(await draft({...updated,quotations:[{quoteId:'quote-erp',saleId:'erp-sale'}]}),[400,409]);sql.prepare("DELETE FROM crm_records WHERE id='duplicate-code'").run();
await post(await draft({...blank(),quotationsComplete:true,quotations:[{quoteId:'quote-manual',saleId:'rep2-sale'}]},'rep2'),409);

// Management access does not confer a different region; supervisors can inspect but cannot attest.
user('manager');await read('west',month,[403,404]);const forgedWest={...await draft(blank()),memberId:'west'};await post(forgedWest,[403,404]);
await post(await draft({...updated,quotations:[{quoteId:'quote-west',saleId:null}]}),[400,403,404]);
user('sup');s=await read();check(s.canEdit,false);check(s.quotes.some(q=>idOf(q)==='quote-manual'),true,'Own quote remains accessible when its opportunity parent is hidden');check(JSON.stringify(s).includes('QUOTE-quote-manager'),false);check(JSON.stringify(s).includes('private-west'),false);await read('other',month,[403,404]);await post(body,403);
for(const actor of ['rep','service']){user(actor);await read('rep',month,403);await post(body,403);}user(null);await read('rep',month,401);await post(body,401);
user('admin');s=await read('inactive');check(s.canEdit,true);await post(await draft(blank(),'inactive'));check(sql.prepare("SELECT active FROM crm_members WHERE id='inactive'").get().active,0,'Historical evidence can be corrected without reactivating a rep');s=await read('inactive','2099-01');check(s.canEdit,false);await post(await draft(blank(),'inactive','2099-01'),400);
for(const target of ['manager','sup','admin'])await post({...await draft(blank()),memberId:target},[400,403,404]);
await post(await draft(blank()),403,'https://evil.invalid');

// A sales change after review invalidates the submitted snapshot.
body=await draft(updated);sql.prepare("UPDATE crm_sales SET version=version+1 WHERE id='manual'").run();await post(body,409);
// Snapshot checks must also run inside the write transaction, before evidence and audit are committed.
user('manager');
for(const change of [
 ()=>sql.prepare("UPDATE crm_sales SET version=version+1 WHERE id='manual'").run(),
 ()=>sql.prepare("UPDATE crm_kpi_evidence_state SET revision=revision+1 WHERE id='company'").run(),
 ()=>sql.prepare("UPDATE crm_members SET role='rep' WHERE id='manager'").run(),
 ()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='manager'").run(),
 ()=>sql.prepare("UPDATE crm_members SET auth_version=auth_version+1 WHERE id='manager'").run(),
 ()=>sql.prepare("UPDATE crm_members SET active=0 WHERE id='rep'").run(),
 ()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run(),
 ()=>sql.prepare("UPDATE crm_members SET supervisor_id='another-supervisor' WHERE id='rep'").run(),
 ()=>sql.prepare("UPDATE crm_members SET auth_version=auth_version+1 WHERE id='rep'").run(),
 ()=>sql.prepare("UPDATE crm_members SET auth_version=auth_version+1 WHERE id='sup'").run(),
 ()=>sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='quote-manual'").run(),
 ()=>sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='admin-request'").run(),
 ()=>sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='machine'").run(),
 ()=>sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='customer'").run(),
]){
 body=await draft(updated);const before=JSON.stringify(evidenceRow()),audits=auditCount();race=change;await post(body,409);check(JSON.stringify(evidenceRow()),before,'Racing state change leaves evidence untouched');check(auditCount(),audits,'Racing state change adds no success audit');
 sql.prepare("UPDATE crm_members SET role='manager',region_scope='eastern' WHERE id='manager'").run();sql.prepare("UPDATE crm_members SET active=1,region_scope='eastern',supervisor_id='sup' WHERE id='rep'").run();
}
body=await draft(updated);const beforeDuplicate=JSON.stringify(evidenceRow()),beforeDuplicateAudits=auditCount();race=()=>record('racing-code-duplicate','customer',null,null,{name:'Concurrent duplicate customer',code:'C1',region:'الشرقية'});await post(body,409);check(JSON.stringify(evidenceRow()),beforeDuplicate,'A racing ERP customer-code collision cannot establish a conversion');check(auditCount(),beforeDuplicateAudits);sql.prepare("DELETE FROM crm_records WHERE id='racing-code-duplicate'").run();
body=await draft(updated);const beforeFailure=JSON.stringify(evidenceRow()),beforeRevision=revision(),beforeAudits=auditCount();auditFailure=true;const logger=console.error;console.error=()=>{};try{await post(body,500);}finally{console.error=logger;auditFailure=false;}check(JSON.stringify(evidenceRow()),beforeFailure,'Audit failure rolls back evidence');check(revision(),beforeRevision,'Audit failure rolls back global revision');check(auditCount(),beforeAudits);await post(body);
// Managers can correct historical evidence after deactivation without reactivating the rep.
sql.prepare("UPDATE crm_members SET active=0 WHERE id='rep'").run();s=await read();check(s.evidence.input,updated);check(s.canEdit,true);await post(await draft(updated));check(sql.prepare("SELECT active FROM crm_members WHERE id='rep'").get().active,0);sql.prepare("UPDATE crm_members SET active=1 WHERE id='rep'").run();

// Even an all-region administrator cannot assign a quote outside the selected rep's region.
user('admin');await post(await draft({...updated,quotations:[{quoteId:'quote-west',saleId:null}]}),400);
s=await read('west');check(s.quotes.some(q=>idOf(q)==='quote-west'),true);check(s.quotes.some(q=>idOf(q)==='quote-manual'),false);await post(await draft({...blank(),quotations:[{quoteId:'quote-second',saleId:null}]},'west'),400);

// A saved assignment grants report labels and preservation, never arbitrary hidden-quote access.
quote('quote-hidden-existing',{author:'admin'});quote('quote-hidden-fresh',{author:'admin'});
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.terms','PRIVATE-QUOTE-BODY','$.attachmentKey','PRIVATE-QUOTE-ATTACHMENT'),version=version+1 WHERE id='quote-hidden-existing'").run();
const hiddenInput={...updated,quotations:[{quoteId:'quote-hidden-existing',saleId:'manual'}]};await post(await draft(hiddenInput));
user('manager');s=await read();const projectedHidden=s.quotes.find(q=>idOf(q)==='quote-hidden-existing');check(!!projectedHidden,true,'The saved hidden assignment retains its narrow report label');check(Object.keys(projectedHidden).sort(),['customerId','customerName','date','id','kind','reference'],'Projection contains only report metadata');check(JSON.stringify(s).includes('PRIVATE-QUOTE-'),false,'Hidden terms and attachment paths are never projected');check(s.quotes.some(q=>idOf(q)==='quote-hidden-fresh'),false,'A fresh hidden quote is not offered');check(s.evidence.input,hiddenInput,'Saved stable IDs remain available for explicit repair');
const hiddenEdited={...hiddenInput,collection:{dueCents:10000,collectedCents:8000,reference:'Collection amended without changing the assigned quote'}};await post(await draft(hiddenEdited));check((await read()).evidence.input,hiddenEdited,'Collection changes preserve an unchanged hidden quotation link');
const hiddenSnapshot=JSON.stringify(evidenceRow());
for(const quotations of [[{quoteId:'quote-hidden-fresh',saleId:'manual'}],[{quoteId:'quote-hidden-existing',saleId:'manual-second'}],[{quoteId:'quote-hidden-existing',saleId:null}]])await post(await draft({...hiddenEdited,quotations}),400);
check(JSON.stringify(evidenceRow()),hiddenSnapshot,'A saved assignment cannot launder a new hidden quote or a changed invoice link');

// Retained links still require a current issued quote, a current permitted root and a valid invoice.
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.status','draft'),version=version+1 WHERE id='quote-hidden-existing'").run();await post(await draft(hiddenEdited),400);sql.prepare("UPDATE crm_records SET data=json_set(data,'$.status','sent'),version=version+1 WHERE id='quote-hidden-existing'").run();
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الغربية'),version=version+1 WHERE id='customer'").run();s=await read();check(s.quotes.some(q=>idOf(q)==='quote-hidden-existing'),false);check(s.evidence.input.quotations,hiddenEdited.quotations,'An inaccessible saved ID is retained without source metadata for explicit repair');await post(await draft(hiddenEdited),400);sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الشرقية'),version=version+1 WHERE id='customer'").run();
sql.prepare("UPDATE crm_sales SET status='void',version=version+1 WHERE id='manual'").run();await post(await draft(hiddenEdited),400);sql.prepare("UPDATE crm_sales SET status='confirmed',version=version+1 WHERE id='manual'").run();
// The narrow preservation path uses the same atomic quote/ancestor/source-author locks.
for(const change of [()=>sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='quote-hidden-existing'").run(),()=>sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='customer'").run(),()=>sql.prepare("UPDATE crm_members SET auth_version=auth_version+1 WHERE id='admin'").run()]){
 body=await draft(hiddenEdited);const before=JSON.stringify(evidenceRow()),audits=auditCount();race=change;await post(body,409);check(JSON.stringify(evidenceRow()),before,'A retained hidden quote cannot bypass the commit guard');check(auditCount(),audits);
}
await post(await draft(hiddenEdited));
check(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');check(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({ok:true,checks,scope:'Real SQLite evidence API: explicit quote links, ERP/manual customer identity, immutable periods, role/team/region boundaries, idempotence, sales/evidence revisions and atomic rollback'}));

// «استيراد عروض الأسعار من ERP» on the server, unit by unit (the owner's unit-test plan, 2026-11-22): lib/erp-quotes-server.ts called
// directly (no build, no HTTP: tests/erp-quotes-http.mjs covers the routes) on an in-memory SQLite with every migration and the real
// context (lib/crm-server.ts), compiled into .sites-runtime so the coverage measure sees it, the clock fixed. Who may import (a
// representative, customer service, a supervisor with «إضافة» on «عروض الأسعار» switched off or the screen hidden), the configuration
// (the representatives in reach, the saved mappings and office marks), the request (base64, size, the file's extension, unknown fields),
// the service's secret, the preview (each status and reason, the employees and how each is mapped: saved, chosen, by a unique full name,
// a namesake, another region, «مبيعات مكتب»; the customers the CRM lacks; a code two customers carry, with its customers to the
// administrator only), the choices (repeated with Arabic-Indic digits, a saved mapping changed here, a representative out of reach, an
// office mark), the signed preview token (missing, malformed, tampered, another file, expired, the data changed), the import (records,
// history lines, the import line, the mappings saved), the replay (same answer; another person; another body), the same file again, a
// newer export (an update and its line with the amounts), a quote edited by hand (left alone), a change inside the transaction (nothing
// written), and an employee marked «مبيعات مكتب (مستبعد)» here. Synthetic quotations (scripts/lib/erp-quotes-fixture.mjs), made-up
// customers, employees and prices.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {quotation,erpQuotesXls,ERP_QUOTE_COLUMNS} from '../scripts/lib/erp-quotes-fixture.mjs';

const NativeDate=Date;let clock=NativeDate.parse('2026-11-16T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-quotes-server-unit-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=new Proxy({},{get:(_,key)=>globalThis.testEnv?.[key]});');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{fileName:relative,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
const load=relative=>{compile(relative);return import(path.join(out,relative.replace(/\.tsx?$/,'.mjs')));};
const S=await load('lib/erp-quotes-server.ts'),server=await load('lib/crm-server.ts'),Q=await load('lib/erp-quotes.ts'),O=await load('lib/erp-office-employees.ts');
let checks=0;
// Rows of node:sqlite have no prototype: values are compared as plain data.
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v));
const eq=(a,b,m)=>{assert.deepEqual(plain(a),plain(b),m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const result=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const SECRET='ab'.repeat(32);// a made-up secret of this test only
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:SECRET};
const member=(id,name,role,supervisor,scope='central')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@example.invalid',name,role,'الرئيسي',supervisor,scope,'2025-01-01');
member('admin','مدير النظام','admin','','all');member('manager','مدير المبيعات','manager','');member('sup','المشرف','supervisor','manager');member('sup2','مشرف ثان','supervisor','manager');
member('rep','أحمد المندوب','rep','sup');member('rep2','سالم المندوب','rep','sup2');member('repx','سالم المندوب','rep','sup','western');member('repw','وليد الغربي','rep','sup','western');member('cs','خدمة العملاء','customer_service','');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
const insert=(id,kind,parent,assigned,data,branch='الرئيسي')=>sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,'2026-01-01','2026-01-01',1,'fixture')").run(id,kind,parent,assigned,branch,JSON.stringify(data));
const customer=(id,code,region='الوسطى',name='مصنع '+id)=>insert(id,'customer',null,'rep',{name,code,region,city:'الرياض',branch:'الرئيسي',assignedTo:'rep'});
customer('c1','101');customer('c2','202');customer('c3','303');customer('c4','303');customer('cw','404','الغربية');
sql.prepare("INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) VALUES('8000','rep2','admin','2026-01-01')").run();
const as=async id=>{globalThis.testIdentity=id;return server.context();};
const count=(table,where='1=1')=>sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE '+where).get().n;
const revision=()=>sql.prepare("SELECT revision FROM crm_erp_import_state WHERE id='yourrest-industries'").get().revision;
const refusal=async(promise,status,pattern,message)=>{let error;try{await promise;}catch(e){error=e;}ok(error instanceof server.CRMError&&error.status===status&&pattern.test(error.message),message+' ('+(error?.status??'none')+': '+(error?.message||'no error')+')');};

const line=(name,qty,price,extra={})=>({name,qty,price,...extra});
const quotes=[
 quotation({code:'Qut-1',customerCode:'101',empCode:'7001',empName:'أحمد المندوب',lines:[line('قالب بلوك',1,1000)]}),
 quotation({code:'Qut-2',customerCode:'202',empCode:'٧٠٠١',empName:'أحمد المندوب',lines:[line('قالب',2,250.5),line('خلاط',1,99.99)]}),
 quotation({code:'Qut-3',customerCode:'999',empCode:'7001',empName:'أحمد المندوب',customerName:'مصنع غير مسجل',lines:[line('قالب',1,10)]}),
 quotation({code:'Qut-4',customerCode:'303',empCode:'7001',empName:'أحمد المندوب',lines:[line('قالب',1,10)]}),
 quotation({code:'Qut-5',customerCode:'404',empCode:'7001',empName:'أحمد المندوب',lines:[line('قالب',1,10)]}),
 quotation({code:'Qut-6',customerCode:'101',empCode:'7002',empName:'سالم المندوب',lines:[line('قالب',1,10)]}),
 quotation({code:'Qut-7',customerCode:'101',empCode:'6000',empName:'مبيعات مكتب',lines:[line('قالب',1,10)]}),
 quotation({code:'Qut-8',customerCode:'101',empCode:'7003',empName:'وليد الغربي',lines:[line('قالب',1,10)]}),
 quotation({code:'Qut-9',customerCode:'101',empCode:'8000',empName:'اسم في ERP',lines:[line('قالب',3,100)]}),
];
const file=(list=quotes)=>erpQuotesXls(list.flat()).toString('base64');
const body=(extra={})=>({action:'preview',fileName:'quotations.xls',base64:file(),...extra});

// Who
await refusal(as('rep').then(c=>S.importErpQuotes(c,body())),403,/متاحة للمشرف ومدير المبيعات فقط/,'a representative: refused');
await refusal(as('cs').then(c=>S.importErpQuotes(c,body())),403,/./,'customer service: refused');
const permissions=(id,cells,hidden=[])=>sql.prepare('INSERT OR REPLACE INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES(?,?,?,1,?,?)').run(id,JSON.stringify(cells),JSON.stringify(hidden),'2026-01-01','admin');
permissions('sup',{'quote:add':false});
await refusal(as('sup').then(c=>S.importErpQuotes(c,body())),403,/./,'a supervisor whose «إضافة» on «عروض الأسعار» is switched off: refused');
permissions('sup',{'sales:import':false});
await refusal(as('sup').then(c=>S.erpQuotesConfiguration(c)),403,/./,'or «استيراد» on «المبيعات»: the configuration too');
permissions('sup',{},['quote']);
await refusal(as('sup').then(c=>S.importErpQuotes(c,body())),404,/./,'«عروض الأسعار» hidden: 404');
sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='sup'").run();
const cfg=await S.erpQuotesConfiguration(await as('manager'));
eq([cfg.members.map(m=>m.id).sort(),cfg.employeeMappings],[['rep','rep2'],[{employeeId:'8000',repId:'rep2'}]],'the configuration: the active representatives in reach and the saved mappings to them');
eq((await S.erpQuotesConfiguration(await as('admin'))).members.map(m=>m.id).sort(),['rep','rep2','repw','repx'],'the administrator reaches every region');

// The request
let manager=await as('manager');
await refusal(S.importErpQuotes(manager,body({base64:'ab$='})),400,/ترميز ملف عروض الأسعار غير صحيح/,'base64 with another character');
await refusal(S.importErpQuotes(manager,body({base64:'abcde'})),400,/ترميز ملف عروض الأسعار غير صحيح/,'base64 of a wrong length');
await refusal(S.importErpQuotes(manager,body({base64:'A'.repeat(Math.ceil(Q.ERP_QUOTES_MAX_BYTES/3)*4)})),413,/5 ميجابايت/,'one byte over 5 MB: 413');
for(const name of ['quotations.csv','quotations','quotes.xls.exe'])await refusal(S.importErpQuotes(manager,body({fileName:name})),400,/بصيغة .xls أو .xlsx/,'a file that is not .xls, .xlsx or .html: '+name);
for(const extra of [{unknown:true},{action:'apply'},{previewToken:'x'.repeat(1025)},{requestId:'1'},{employeeMappings:[{employeeId:'',repId:'rep'}]}]){
 let error;try{await S.importErpQuotes(manager,body(extra));}catch(e){error=e;}ok(error?.name==='ZodError','refused by the request\'s schema: '+JSON.stringify(extra).slice(0,60));
}
await refusal(S.importErpQuotes(manager,body({base64:Buffer.from('not a report').toString('base64')})),400,/./,'a file that is not the report: 400 with the reader\'s words');
globalThis.testEnv={...globalThis.testEnv,YR_AUTH_SECRET:'short'};
await refusal(S.importErpQuotes(manager,body()),503,/غير مهيأة/,'without a proper secret the preview cannot be signed: 503');
globalThis.testEnv={...globalThis.testEnv,YR_AUTH_SECRET:SECRET};

// The preview
const preview=await S.importErpQuotes(manager,body());
const status=Object.fromEntries(preview.quotations.map(q=>[q.code,[q.status,q.reason,q.repName,q.customerName,q.recordId?'id':'']]));
eq(status,{
 'Qut-1':['new',Q.ERP_QUOTE_REASONS.new,'أحمد المندوب','مصنع c1',''],
 'Qut-2':['new',Q.ERP_QUOTE_REASONS.new,'أحمد المندوب','مصنع c2',''],
 'Qut-3':['refused',Q.ERP_QUOTE_REASONS.noCustomer,'','مصنع غير مسجل',''],
 'Qut-4':['refused',Q.ERP_QUOTE_REASONS.ambiguousCustomer,'','مصنع تجريبي',''],
 'Qut-5':['refused',Q.ERP_QUOTE_REASONS.customerOutside,'','مصنع cw',''],
 'Qut-6':['refused',Q.ERP_QUOTE_REASONS.unmapped,'','مصنع c1',''],
 'Qut-7':['excluded',Q.ERP_QUOTE_REASONS.office,'','مصنع تجريبي',''],
 'Qut-8':['refused',Q.ERP_QUOTE_REASONS.unmapped,'','مصنع c1',''],
 'Qut-9':['new',Q.ERP_QUOTE_REASONS.new,'سالم المندوب','مصنع c1',''],
},'each quotation with its status and reason: new; no customer; a code two customers carry; a customer of another region; an employee a namesake leaves unmapped; «مبيعات مكتب»; an employee of another region; a saved mapping');
eq(preview.quotations.find(q=>q.code==='Qut-2').totalCents,Math.round((2*250.5+99.99)*115),'the ERP total with the tax, in halalas');
eq(preview.employees.map(e=>[e.employeeId,e.employeeName,e.quotations,e.repId,e.mappingSource,e.savedOutside]),[
 ['7001','أحمد المندوب',5,'rep','name',false],['7002','سالم المندوب',1,'','unmapped',false],['7003','وليد الغربي',1,'','unmapped',false],['8000','اسم في ERP',1,'rep2','saved',false]
],'the employees (Arabic-Indic digits read as one code; «مبيعات مكتب» not listed): by a unique full name, a namesake and another region unmapped, the saved mapping');
eq(preview.missingCustomers,[{customerCode:'999',customerName:'مصنع غير مسجل',quotations:1}],'the customer the CRM does not have');
eq(preview.sharedCodes,{canMap:false,revision:0,codes:[{codeKey:'303',customerCode:'303',quotations:1,status:'ambiguous'}]},'a sales manager sees the shared code and its count, never the customers');
eq(preview.summary,{quotations:9,lines:10,newCount:3,updateCount:0,unchangedCount:0,editedCount:0,excludedCount:1,refusedCount:5,rowProblems:0,deletedRows:0,totalsDiffer:0},'the counts');
const token=preview.previewToken.split('.');
eq([token.length,token[0],Number(token[1])-clock,token.slice(2).every(v=>/^[a-f0-9]{64}$/.test(v))],[5,'1',15*60_000,true],'a signed token: version, fifteen minutes, the fingerprint, the snapshot, the signature');
eq([count('crm_records',"kind='quote'"),count('crm_erp_imports'),count('crm_audit')],[0,0,0],'a preview writes nothing');
const adminPreview=await S.importErpQuotes(await as('admin'),body());
eq(adminPreview.sharedCodes.canMap,true,'the administrator may map it');
eq(adminPreview.sharedCodes.codes[0].candidates.map(c=>c.id),['c3','c4'],'with exactly the customers that carry the code');
eq(adminPreview.quotations.find(q=>q.code==='Qut-5').status,'new','and imports the other region\'s customer');
eq(adminPreview.quotations.find(q=>q.code==='Qut-8').repName,'وليد الغربي','and maps its representative by name');

// The choices
await refusal(S.importErpQuotes(manager,body({employeeMappings:[{employeeId:'7002',repId:'rep'},{employeeId:'٧٠٠٢',repId:'rep'}]})),400,/تكرار في اختيارات الربط/,'the same employee chosen twice (once in Arabic-Indic digits)');
await refusal(S.importErpQuotes(manager,body({employeeMappings:[{employeeId:'8000',repId:'rep'}]})),409,/يُعدَّل من شاشة استيراد المبيعات/,'a saved mapping changed here: refused, it is the sales import\'s');
eq((await S.importErpQuotes(manager,body({employeeMappings:[{employeeId:'8000',repId:'rep2'}]}))).employees.find(e=>e.employeeId==='8000').mappingSource,'saved','the same saved mapping sent back: kept as saved');
await refusal(S.importErpQuotes(manager,body({employeeMappings:[{employeeId:'7002',repId:'repw'}]})),403,/خارج نطاق فريقك أو منطقتك/,'a representative out of reach');
const choices=[{employeeId:'7002',repId:'rep2'},{employeeId:'9999',repId:'repw'}];
const chosen=await S.importErpQuotes(manager,body({employeeMappings:choices}));
eq([chosen.quotations.find(q=>q.code==='Qut-6').status,chosen.employees.find(e=>e.employeeId==='7002').mappingSource,chosen.summary.newCount],['new','selected',4],'chosen here: imported (a choice for an employee not in the file is ignored, whoever it names)');

// The token
const requestId=crypto.randomUUID(),commit=(extra={})=>S.importErpQuotes(manager,body({employeeMappings:choices,action:'commit',requestId,previewToken:chosen.previewToken,...extra}));
await refusal(commit({previewToken:undefined}),400,/اعرض الملف أولًا/,'a commit without a token');
await refusal(commit({requestId:undefined}),400,/اعرض الملف أولًا/,'or without a request id');
for(const bad of ['1.2.3',chosen.previewToken.replace(/^1\./,'2.'),chosen.previewToken.replace(/\.(\d{13})\./,'.123.'),chosen.previewToken.toUpperCase()])await refusal(commit({previewToken:bad}),409,/معاينة الملف غير صحيحة/,'a malformed token: '+bad.slice(0,20));
const pieces=chosen.previewToken.split('.');
await refusal(commit({previewToken:[...pieces.slice(0,4),pieces[4].replace(/.$/,c=>c==='0'?'1':'0')].join('.')}),409,/تغيّر الملف أو اختيارات الربط/,'a tampered signature');
await refusal(commit({previewToken:[pieces[0],String(clock+60*60_000),...pieces.slice(2)].join('.')}),409,/تغيّر الملف أو اختيارات الربط/,'a later expiry written by hand breaks the signature');
await refusal(commit({employeeMappings:[{employeeId:'7002',repId:'rep2'}]}),409,/تغيّر الملف أو اختيارات الربط/,'the token of other choices');
await refusal(commit({previewToken:preview.previewToken}),409,/تغيّر الملف أو اختيارات الربط/,'the token of the preview without the choices');
clock+=16*60_000;
await refusal(commit(),409,/انتهت المعاينة/,'sixteen minutes later: expired');
clock-=16*60_000;
sql.prepare("UPDATE crm_members SET branch='فرع آخر' WHERE id='rep2'").run();
manager=await as('manager');
await refusal(commit(),409,/انتهت المعاينة أو تغيّرت البيانات/,'a representative moved since the preview: refused');
sql.prepare("UPDATE crm_members SET branch='الرئيسي' WHERE id='rep2'").run();
manager=await as('manager');
await refusal(commit(),409,/انتهت المعاينة أو تغيّرت البيانات/,'moved back: still refused (the member\'s auth version moved with the change)');
// A change inside the transaction: the gate refuses it and nothing is written
const beforeRace=await S.importErpQuotes(manager,body({employeeMappings:choices}));
race=()=>{sql.prepare("UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries'").run();};
const before=revision();
await refusal(commit({previewToken:beforeRace.previewToken}),409,/تغيّرت البيانات أو الصلاحيات أثناء الحفظ/,'the ERP mappings changed while saving: refused');
eq([count('crm_records',"kind='quote'"),count('crm_erp_imports'),count('crm_erp_employee_mappings'),revision()],[0,0,1,before+1],'nothing written');
manager=await as('manager');
const fresh=await S.importErpQuotes(manager,body({employeeMappings:choices}));
race=()=>{throw new Error('the connection was lost');};
let lost;try{await S.importErpQuotes(manager,body({employeeMappings:choices,action:'commit',requestId:crypto.randomUUID(),previewToken:fresh.previewToken}));}catch(e){lost=e;}
eq([lost?.message,count('crm_records',"kind='quote'"),count('crm_erp_imports')],['the connection was lost',0,0],'a database that fails while saving: its error, nothing written');
const result=await S.importErpQuotes(manager,body({employeeMappings:choices,action:'commit',requestId,previewToken:fresh.previewToken}));
eq(result,{ok:true,importId:'erp-quotes-import-'+requestId,addedCount:4,updatedCount:0,unchangedCount:0,editedCount:0,excludedCount:1,refusedCount:4,mappingsSaved:2},'the import: four quotes added, two mappings saved');
const saved=sql.prepare("SELECT id,parent_id,assigned_to,branch,data,version FROM crm_records WHERE kind='quote' ORDER BY json_extract(data,'$.number')").all().map(r=>({...r,data:JSON.parse(r.data)}));
eq(saved.map(r=>[r.data.number,r.parent_id,r.assigned_to,r.branch,r.data.status,r.data.performedBy,r.data._erp.source,r.version]),[
 ['Qut-1','c1','rep','الرئيسي','sent','rep','erp',1],['Qut-2','c2','rep','الرئيسي','sent','rep','erp',1],['Qut-6','c1','rep2','الرئيسي','sent','rep2','erp',1],['Qut-9','c1','rep2','الرئيسي','sent','rep2','erp',1]
],'each quotation one quote under its customer, assigned to the mapped representative, «مرسل», marked as the ERP\'s');
eq(saved.find(r=>r.data.number==='Qut-2').data.items.map(i=>[i.description,i.quantity,i.price]),[['قالب',2,250.5],['خلاط',1,99.99]],'its lines');
eq(sql.prepare("SELECT employee_id,rep_id,updated_by FROM crm_erp_employee_mappings ORDER BY employee_id").all().map(r=>[r.employee_id,r.rep_id,r.updated_by]),[['7001','rep','manager'],['7002','rep2','manager'],['8000','rep2','admin']],'the mappings matched by name and chosen are saved; the saved one is left as it was');
eq(revision(),before+1+1+4,'the shared revision moved: once for the mappings saved, once for each issued quote added (the KPI trigger)');
eq(sql.prepare("SELECT action,detail FROM crm_audit WHERE record_id IN (SELECT id FROM crm_records WHERE kind='quote') ORDER BY detail").all().map(r=>[r.action,r.detail]),[['إضافة','Qut-1 • إضافة عرض سعر من ملف ERP'],['إضافة','Qut-2 • إضافة عرض سعر من ملف ERP'],['إضافة','Qut-6 • إضافة عرض سعر من ملف ERP'],['إضافة','Qut-9 • إضافة عرض سعر من ملف ERP']],'one «إضافة» history line each');
const importLine=JSON.parse(sql.prepare('SELECT detail FROM crm_audit WHERE id=?').get('erp-quotes-import-'+requestId).detail);
eq([importLine.fileName,importLine.addedCount,importLine.quotations,importLine.lines,importLine.changes],['quotations.xls',4,9,10,[]],'one import line with its counts');
// The replay
const auditCount=count('crm_audit');
eq(await S.importErpQuotes(manager,body({employeeMappings:choices,action:'commit',requestId,previewToken:fresh.previewToken})),{...result,alreadySaved:true},'the same request again: its first answer');
eq(count('crm_audit'),auditCount,'nothing written twice');
await refusal(S.importErpQuotes(await as('admin'),body({employeeMappings:choices,action:'commit',requestId,previewToken:fresh.previewToken})),404,/طلب الاستيراد غير متاح/,'another person with the same request id: not theirs');
manager=await as('manager');
await refusal(S.importErpQuotes(manager,body({employeeMappings:[],action:'commit',requestId,previewToken:fresh.previewToken})),409,/حُفظ الطلب ببيانات مختلفة/,'the same request id with other choices');

// The same file again: nothing changes
const again=await S.importErpQuotes(manager,body());
eq(again.quotations.filter(q=>q.status==='unchanged').map(q=>q.code),['Qut-1','Qut-2','Qut-6','Qut-9'],'the same file again: every imported quote unchanged (the saved mappings used)');
eq(again.employees.find(e=>e.employeeId==='7002').mappingSource,'saved','the mapping chosen before is now saved');
const nothing=await S.importErpQuotes(manager,body({action:'commit',requestId:crypto.randomUUID(),previewToken:again.previewToken}));
eq([nothing.addedCount,nothing.updatedCount,nothing.unchangedCount,nothing.mappingsSaved],[0,0,4,0],'and its import adds and updates nothing');
eq(sql.prepare("SELECT max(version) AS v FROM crm_records WHERE kind='quote'").get().v,1,'every version kept');

// A newer export updates the same record; a quote edited by hand is left alone
const newer=quotes.map(q=>q[0][ERP_INDEX('Code')]==='Qut-1'?quotation({code:'Qut-1',customerCode:'101',empCode:'7001',empName:'أحمد المندوب',lines:[line('قالب بلوك',1,1000),line('خلاط',2,500)]}):q[0][ERP_INDEX('Code')]==='Qut-2'?quotation({code:'Qut-2',customerCode:'202',empCode:'٧٠٠١',empName:'أحمد المندوب',lines:[line('قالب',2,999)]}):q);
function ERP_INDEX(name){return ERP_QUOTE_COLUMNS.indexOf(name);}
const q2=saved.find(r=>r.data.number==='Qut-2');
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.terms','عدّله المندوب'),version=version+1 WHERE id=?").run(q2.id);
manager=await as('manager');
const update=await S.importErpQuotes(manager,body({base64:file(newer)}));
eq(['Qut-1','Qut-2'].map(code=>(({status,reason,recordId})=>[status,reason,!!recordId])(update.quotations.find(q=>q.code===code))),[['update',Q.ERP_QUOTE_REASONS.update,true],['edited',Q.ERP_QUOTE_REASONS.edited,true]],'a newer export: an update; a quote edited by hand in the CRM: left as it is');
const updated=await S.importErpQuotes(manager,body({base64:file(newer),action:'commit',requestId:crypto.randomUUID(),previewToken:update.previewToken}));
eq([updated.updatedCount,updated.editedCount],[1,1],'imported: one updated, one left');
const q1=sql.prepare("SELECT version,data FROM crm_records WHERE json_extract(data,'$.number')='Qut-1'").get();
eq([q1.version,JSON.parse(q1.data).items.length],[2,2],'the same record, its version moved, its lines updated');
eq(sql.prepare("SELECT detail FROM crm_audit WHERE action='تعديل' AND record_id=(SELECT id FROM crm_records WHERE json_extract(data,'$.number')='Qut-1')").get().detail,'Qut-1 • تحديث من ملف ERP: الإجمالي 1,150.00 ← 2,300.00 ر.س، البنود 1 ← 2','its «تعديل» line: the totals with two decimals and thousands, the lines');
eq(JSON.parse(sql.prepare("SELECT version,data FROM crm_records WHERE id=?").get(q2.id).data).terms,'عدّله المندوب','the edited quote kept what was typed');
const updateLine=JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE record_id=?").get(updated.importId).detail);
eq([updateLine.changes.length,updateLine.changes[0].number,updateLine.changes[0].before.total,updateLine.changes[0].after.total,updateLine.changes[0].after.repId],[1,'Qut-1',1150,2300,'rep'],'and the import line keeps the before and after');

// «مبيعات مكتب (مستبعد)» chosen for an employee here (the administrator, who reaches «وليد الغربي»)
const admin=await as('admin');
const officeChoice=[{employeeId:'7003',repId:O.ERP_OFFICE_CHOICE}];
const marked=await S.importErpQuotes(admin,body({base64:file(newer),employeeMappings:officeChoice}));
eq((({status,reason})=>[status,reason])(marked.quotations.find(q=>q.code==='Qut-8')),['excluded',Q.ERP_QUOTE_REASONS.officeMarked],'marked here: its quotations excluded');
eq((({repId,mappingSource,office})=>[repId,mappingSource,office])(marked.employees.find(e=>e.employeeId==='7003')),[O.ERP_OFFICE_CHOICE,'selected',true],'the employee listed with the choice');
eq(marked.summary.officeMarks,1,'one mark to save');
const markedDone=await S.importErpQuotes(admin,body({base64:file(newer),employeeMappings:officeChoice,action:'commit',requestId:crypto.randomUUID(),previewToken:marked.previewToken}));
eq(markedDone.officeMarked,1,'saved with the import');
eq(O.parseOfficeList(sql.prepare('SELECT owner_id FROM crm_settings WHERE id=?').get(O.ERP_OFFICE_SETTING).owner_id).employees.map(e=>[e.employeeId,e.employeeName,e.by]),[['7003','وليد الغربي','admin']],'the mark: the number, the name, who');
eq(count('crm_audit',"record_id='"+O.ERP_OFFICE_SETTING+"'"),1,'its audit line');
const afterMark=await S.importErpQuotes(admin,body({base64:file(newer)}));
eq((({mappingSource,office})=>[mappingSource,office])(afterMark.employees.find(e=>e.employeeId==='7003')),['saved',true],'read as saved next time');
await refusal(S.importErpQuotes(admin,body({base64:file(newer),employeeMappings:[{employeeId:'7003',repId:'repw'}]})),409,/يُعدَّل من شاشة استيراد المبيعات/,'a saved mark is changed from the sales import only');
eq((await S.erpQuotesConfiguration(admin)).employeeMappings.find(m=>m.employeeId==='7003').repId,O.ERP_OFFICE_CHOICE,'the configuration lists the mark');
// A name marked office in the collection statement suggests the mark for an unmapped employee of that name
sql.prepare('UPDATE crm_settings SET owner_id=? WHERE id=?').run(O.serializeOfficeList(O.applyOfficeChanges(O.parseOfficeList(sql.prepare('SELECT owner_id FROM crm_settings WHERE id=?').get(O.ERP_OFFICE_SETTING).owner_id),{markNames:['اسم بالاسم فقط']},'admin','2026-11-16')),O.ERP_OFFICE_SETTING);
const byName=await S.importErpQuotes(admin,body({base64:file([...newer,quotation({code:'Qut-10',customerCode:'101',empCode:'7100',empName:'اسم بالاسم فقط',lines:[line('قالب',1,10)]})])}));
eq([byName.quotations.find(q=>q.code==='Qut-10').status,byName.employees.find(e=>e.employeeId==='7100').mappingSource],['excluded','name'],'an unmapped employee whose name is marked office: suggested as office');

console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));

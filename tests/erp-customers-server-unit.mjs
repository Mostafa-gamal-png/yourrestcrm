// «استيراد من ERP» of customers on the server, unit by unit (the owner's unit-test plan, 2026-11-22): lib/erp-customers-server.ts and
// lib/erp-customer-extras-server.ts called directly (no build, no HTTP: tests/erp-customers*-http.mjs cover the routes) on an in-memory
// SQLite with every migration and the real context (lib/crm-server.ts), compiled into .sites-runtime so the coverage measure sees them,
// the clock fixed. Who may import (a representative, a supervisor, customer service refused; the sales manager in their regions; the
// administrator), the request (base64, one byte over 1 MB, the schema, a choice or a region twice), the preview (each row's outcome:
// auto by phone, the same code, out of the region, a new customer; a code another customer carries and loses; the customers the file
// does not name, to clear; «التاريخ» and the representative's columns, an impossible day counted), the apply's doors (a screen without
// `adds`, another count of new customers, a stale snapshot, a stale clear list, a region that is not a value, out of the member's scope or
// given to a row that is not new), the apply (codes changed, a duplicate holder and a customer not in the file cleared, a customer added
// with the importer responsible and its Yourrest number, the ERP date and representative written, one audit entry each, the receipt), the
// replay (the same answer with the numbers; another body refused), nothing left to change, and a change inside the transaction (nothing
// written). Synthetic workbooks and made-up customers only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {zipSync,strToU8} from 'fflate';

const NativeDate=Date,clock=NativeDate.parse('2026-11-16T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-customers-server-unit-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
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
const S=await load('lib/erp-customers-server.ts'),X=await load('lib/erp-customer-extras-server.ts'),server=await load('lib/crm-server.ts');
let checks=0;
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v));
const eq=(a,b,m)=>{assert.deepEqual(plain(a),plain(b),m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const result=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const member=(id,name,role,supervisor,scope='central')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@example.invalid',name,role,'الرئيسي',supervisor,scope,'2025-01-01');
member('admin','مدير النظام','admin','','all');member('manager','مدير المبيعات','manager','');member('sup','المشرف','supervisor','manager');member('rep','المندوب','rep','sup');member('cs','خدمة العملاء','customer_service','');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
const customer=(id,name,code,phone,region='الوسطى')=>sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,'2026-01-01','2026-01-01',1,'fixture')").run(id,JSON.stringify({name,code,phone,region,city:'الرياض',branch:'الرئيسي',assignedTo:'rep'}));
customer('k1','مصنع النور','','0551112222');// the file's row 3 by phone: gets E100
customer('k2','مصنع الفجر','E200','0553334444');// the same code: unchanged
customer('k3','مصنع قديم','E900','0550000001');// not in the file: its code may be cleared
customer('kw','مصنع غربي','','0557778888','الغربية');// found by phone, outside the manager's region
customer('k5','مصنع مكرر','E300','0550000002');// carries E300, which the file gives to k6
customer('k6','مصنع السلام','','0556667777');
const as=async id=>{globalThis.testIdentity=id;return server.context();};
const count=(table,where='1=1')=>sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE '+where).get().n;
const data=id=>JSON.parse(sql.prepare('SELECT data FROM crm_records WHERE id=?').get(id).data);
const version=id=>sql.prepare('SELECT version FROM crm_records WHERE id=?').get(id).version;
const refusal=async(promise,status,pattern,message)=>{let error;try{await promise;}catch(e){error=e;}ok(error instanceof server.CRMError&&error.status===status&&pattern.test(error.message),message+' ('+(error?.status??'none')+': '+(error?.message||'no error')+')');};

const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;');
const book=rows=>zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types/>'),'xl/workbook.xml':strToU8('<workbook xmlns:r="r"><sheets><sheet name="Customer" sheetId="1" r:id="rId1"/></sheets></workbook>'),'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData>'+rows.map((cells,r)=>'<row r="'+(r+1)+'">'+cells.map(v=>'<c t="inlineStr"><is><t>'+esc(v)+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>')});
const HEADER=['رقم العميل','الاسم بالعربي','رقم الجوال','البريد الالكتروني','العنوان','التاريخ','المندوب','رقم الموظف'];
const rows=[
 HEADER,
 ['E100','النور للبلوك','٠٥٥١١١٢٢٢٢','','','03/11/2026','أحمد','7001'],// row 2 → k1 by its phone alone (Arabic-Indic digits; another name)
 ['E200','مصنع الفجر','0553334444','','','2026-02-30','',''],// row 3 → k2, same code; an impossible day
 ['E500','مصنع غربي','0557778888','','','','',''],// row 4 → kw: out of the manager's region
 ['E300','مصنع السلام','+966 55 666 7777','','','46329','سالم',''],// row 5 → k6 by phone; k5 loses E300; an Excel serial day
 ['E400','مصنع جديد كليا','0559990000','new@example.invalid','حي الصناعة','2026/11/01','',''],// row 6: a new customer
];
const b64=bytes=>Buffer.from(bytes).toString('base64');
const file=(list=rows)=>b64(book(list));
const body=(extra={})=>({action:'preview',fileName:'Customer.xlsx',base64:file(),...extra});

// Who
for(const id of ['rep','sup','cs'])await refusal(as(id).then(c=>S.importErpCustomers(c,body())),403,/لمدير النظام ومدير المبيعات فقط/,'refused: '+id);
eq([S.requireErpCustomersRole({role:'admin'}),S.requireErpCustomersRole({role:'manager'})],[undefined,undefined],'the administrator and the sales manager may');
let manager=await as('manager');
// The request
await refusal(S.importErpCustomers(manager,body({base64:'####'})),400,/ترميز ملف العملاء غير صحيح/,'base64 with another character');
await refusal(S.importErpCustomers(manager,body({base64:'A'.repeat(Math.ceil(1024*1024/3)*4)})),413,/1 ميجابايت/,'one byte over 1 MB: 413');
for(const extra of [{unknown:1},{action:'commit'},{choices:[{row:0,customerId:'k1'}]},{snapshot:'xyz'},{regions:[{row:2,region:'x'.repeat(41)}]}]){
 let error;try{await S.importErpCustomers(manager,body(extra));}catch(e){error=e;}ok(error?.name==='ZodError','refused by the request\'s schema: '+JSON.stringify(extra));
}
await refusal(S.importErpCustomers(manager,body({choices:[{row:2,customerId:'k1'},{row:2,customerId:'k2'}]})),400,/تكرار في اختيارات العملاء/,'a row chosen twice');
await refusal(S.importErpCustomers(manager,body({base64:b64(book([['أ','ب'],['1','2']]))})),400,/هذا ليس ملف عملاء ERP/,'a workbook of other columns: 400 with the reader\'s words');
await refusal(S.importErpCustomers(manager,body({base64:b64(strToU8('not a workbook'))})),400,/./,'bytes that are not a workbook: 400');

// The preview
const preview=await S.importErpCustomers(manager,body());
eq(preview.rows.map(r=>[r.row,r.status,r.customerId,r.matchedBy,r.change,r.add]),[[2,'auto','k1','phone',true,false],[3,'same','k2','both',false,false],[4,'out-of-region','','',false,false],[5,'auto','k6','both',true,false],[6,'new','','',false,true]],'each row: auto by phone (Arabic-Indic digits read), the same code, out of the region, a new customer');
eq(preview.duplicates.map(d=>[d.customerId,d.code,d.row,d.ownerId]),[['k5','E300',5,'k6']],'the other customer that carries a row\'s number loses it');
eq(preview.clears.map(c=>[c.customerId,c.code]),[['k3','E900']],'the customers of the manager\'s regions the file does not name, with a code: to clear (k5 loses its code anyway, the western one is out of reach)');
eq(preview.erpDates,{dateColumn:true,dates:3,invalidDates:1,repColumn:true,reps:2,updates:2},'«التاريخ» (three days read: day first, year first with slashes and an Excel serial; one impossible) and the representative\'s columns; two customers to write them on');
eq([preview.newRegions,preview.newRegion,preview.sheet],[['الوسطى'],'الوسطى','Customer'],'a new customer gets one of the manager\'s regions');
ok(/^[a-f0-9]{64}$/.test(preview.snapshot)&&/^[a-f0-9]{64}$/.test(preview.clearSnapshot),'the snapshots the apply must send back');
eq([count('crm_records',"kind='customer'"),count('crm_audit')],[6,0],'a preview writes nothing');
eq((await S.importErpCustomers(manager,body())).snapshot,preview.snapshot,'the same file again: the same snapshot');
const adminPreview=await S.importErpCustomers(await as('admin'),body());
eq([adminPreview.rows.find(r=>r.row===4).status,adminPreview.newRegions,adminPreview.newRegion],['auto',['','الوسطى','الشرقية','الغربية','الشمالية','الجنوبية'],''],'the administrator reaches the western customer, and a new customer may have any region (none by default)');

// The apply's doors
const requestId=crypto.randomUUID(),apply=(extra={})=>S.importErpCustomers(manager,body({action:'apply',requestId,snapshot:preview.snapshot,adds:1,...extra}));
await refusal(apply({requestId:undefined}),400,/اعرض الملف أولًا/,'without a request id');
await refusal(apply({snapshot:undefined}),400,/اعرض الملف أولًا/,'without the snapshot');
await refusal(apply({adds:undefined}),409,new RegExp(S.ERP_SCREEN_OUTDATED.slice(0,30)),'a screen opened before additions existed (no `adds`): refused before anything is read');
await refusal(apply({adds:0}),409,new RegExp(S.ERP_ADDS_UNCONFIRMED.slice(0,30)),'another number of new customers than the file adds');
await refusal(apply({snapshot:'0'.repeat(64)}),409,/تغيّرت بيانات العملاء منذ المعاينة/,'a stale snapshot');
await refusal(apply({clearCodes:true,clearSnapshot:'0'.repeat(64)}),409,/تغيّرت بيانات العملاء منذ المعاينة/,'a clear with another list than the preview\'s');
await refusal(apply({regions:[{row:2,region:'الوسطى'}]}),400,/السطر 2 ليس عميلًا جديدًا/,'a region given to a row that is not new');
await refusal(apply({regions:[{row:6,region:'الوسطى'},{row:6,region:'الوسطى'}]}),400,/تكرار في مناطق العملاء الجدد/,'a region twice for one row');
await refusal(apply({region:'نجد'}),400,/اختر منطقة صحيحة/,'a region that is not one of the form\'s values');
await refusal(apply({regions:[{row:6,region:'الغربية'}]}),403,/خارج منطقتك المسموح بها/,'a region outside the manager\'s');
await refusal(apply({region:''}),403,/خارج منطقتك المسموح بها/,'«غير محددة» is not the manager\'s either');
eq([count('crm_audit'),data('k1').code],[0,''],'no refusal wrote anything');
// A change inside the transaction (an identity change landed): the receipt's gate refuses, nothing is written
race=()=>{sql.prepare("UPDATE crm_customer_identity_state SET revision=revision+1 WHERE id='company'").run();};
await refusal(apply({requestId:crypto.randomUUID()}),409,/تغيّرت بيانات العملاء منذ المعاينة/,'the codes changed while the apply was on its way: refused');
eq([count('crm_audit'),data('k1').code,count('crm_records',"kind='customer'")],[0,'',6],'nothing written');
manager=await as('manager');
const fresh=await S.importErpCustomers(manager,body());
// A row given a customer that is not one of its candidates: refused before anything is written
await refusal(S.importErpCustomers(manager,body({action:'apply',requestId:crypto.randomUUID(),snapshot:fresh.snapshot,adds:1,choices:[{row:5,customerId:'k1'}]})),400,/العميل المختار للسطر 5 ليس من المرشحين/,'a customer that is not among the row\'s candidates');
// A database that fails while saving: the error as it is, nothing written
race=()=>{throw new Error('the connection was lost');};
let lost;try{await S.importErpCustomers(manager,body({action:'apply',requestId:crypto.randomUUID(),snapshot:fresh.snapshot,adds:1}));}catch(e){lost=e;}
eq([lost?.message,count('crm_audit'),data('k1').code],['the connection was lost',0,''],'a failed save: its error, nothing written');

// The apply
const result=await S.importErpCustomers(manager,body({action:'apply',requestId,snapshot:fresh.snapshot,adds:1,clearCodes:true,clearSnapshot:fresh.clearSnapshot,regions:[{row:6,region:'الوسطى'}]}));
const added='crm-manager-erp-'+requestId+'-6';
eq([result.ok,result.updated,result.changed,result.added,result.unchanged,result.cleared,result.duplicatesCleared,result.erpDatesUpdated,result.outOfRegion],[true,2,2,1,1,1,1,2,1],'applied: two codes changed, one added, one unchanged, one cleared, one duplicate holder cleared, two customers\' ERP fields written, one row out of the region');
eq(result.changes.map(c=>[c.row,c.customerId,c.from,c.to]),[[2,'k1','','E100'],[5,'k6','','E300']],'the code changes');
eq(result.additions,[{row:6,customerId:added,code:'E400',name:'مصنع جديد كليا',region:'الوسطى',internalCode:result.additions[0].internalCode}],'the customer added, with the region chosen');
ok(/^YR-C-\d{6}$/.test(result.additions[0].internalCode),'and its Yourrest number from the identity trigger: '+result.additions[0].internalCode);
eq([data('k1').code,data('k6').code,data('k5').code,data('k3').code,data('k2').code,data('kw').code],['E100','E300','','','E200',''],'k1 and k6 got their numbers, k5 and k3 lost theirs, k2 and the western customer untouched');
eq([version('k1'),version('k6'),version('k5'),version('k3'),version('k2')],[2,2,2,2,1],'each changed customer\'s version moved once (k1 and k6 got their code and their ERP fields: one move); k2 unchanged (its day is impossible, no representative)');
eq([data('k1').erpCreatedAt,data('k1').erpRep,data('k2').erpCreatedAt,data('k2').erpRep],['2026-11-03',{employeeId:'7001',name:'أحمد'},undefined,undefined],'the ERP date (day first) and representative written on the customer the row ends on; an impossible day is never written');
const newCustomer=data(added);
eq([newCustomer.name,newCustomer.code,newCustomer.region,newCustomer.email,newCustomer.address,newCustomer.assignedTo,newCustomer._createdBy,newCustomer.erpCreatedAt],['مصنع جديد كليا','E400','الوسطى','new@example.invalid','حي الصناعة','manager','manager','2026-11-01'],'the new customer as the form builds it, the importer responsible, the date it has');
eq(sql.prepare('SELECT assigned_to,branch FROM crm_records WHERE id=?').get(added),{assigned_to:'manager',branch:'الرئيسي'},'in the importer\'s branch');
const audit=sql.prepare("SELECT record_id,action,detail FROM crm_audit WHERE action<>'erp-customers-receipt' ORDER BY record_id,action").all().map(r=>[r.record_id,r.action,JSON.parse(r.action==='إضافة'?'{}':r.detail).label||r.detail]);
eq(audit,[[added,'إضافة','مصنع جديد كليا • '+S.ERP_ADD_AUDIT_LABEL],['k1','erp-customer-code','تحديث كود ERP من ملف ERP'],['k1','erp-customer-fields',X.ERP_EXTRA_AUDIT_LABEL],['k3','erp-customer-code',S.ERP_CLEAR_AUDIT_LABEL],['k5','erp-customer-code',S.ERP_DUPLICATE_AUDIT_LABEL],['k6','erp-customer-code','تحديث كود ERP من ملف ERP'],['k6','erp-customer-fields',X.ERP_EXTRA_AUDIT_LABEL]],'one audit entry for each change, clear, duplicate, ERP fields and addition');
const fields=JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE record_id='k6' AND action='erp-customer-fields'").get().detail);
eq([fields.row,fields.from,fields.to],[5,{},{erpCreatedAt:'2026-11-03',erpRep:{name:'سالم'}}],'the ERP fields\' entry: the row, before and after (46329 is 2026-11-03)');
const duplicate=JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE record_id='k5'").get().detail);
eq([duplicate.from,duplicate.to,duplicate.cleared,duplicate.reason,duplicate.keptBy],['E300','',true,'duplicate','k6'],'the duplicate holder\'s entry says who keeps the number');
eq(count('crm_audit',"id='erp-customers:manager:"+requestId+"' AND action='erp-customers-receipt'"),1,'and one receipt');
// The replay
const auditCount=count('crm_audit');
eq(await S.importErpCustomers(manager,body({action:'apply',requestId,snapshot:fresh.snapshot,adds:1,clearCodes:true,clearSnapshot:fresh.clearSnapshot,regions:[{row:6,region:'الوسطى'}]})),{...result,alreadySaved:true},'the same request again: its answer (with the number read again), nothing written twice');
eq(count('crm_audit'),auditCount,'nothing written');
await refusal(S.importErpCustomers(manager,body({action:'apply',requestId,snapshot:fresh.snapshot,adds:1,regions:[{row:6,region:'الوسطى'}]})),409,/الطلب محفوظ ببيانات مختلفة/,'the same request id without the clear: another body, refused');
// Nothing left to change
manager=await as('manager');
const after=await S.importErpCustomers(manager,body());
eq(after.rows.map(r=>[r.row,r.status,r.change,r.add]),[[2,'same',false,false],[3,'same',false,false],[4,'out-of-region',false,false],[5,'same',false,false],[6,'same',false,false]],'the same file after its apply: every row on its customer');
eq(after.erpDates.updates,0,'the ERP fields already written');
await refusal(S.importErpCustomers(manager,body({action:'apply',requestId:crypto.randomUUID(),snapshot:after.snapshot,adds:0})),400,/لا توجد أكواد تتغير ولا عملاء جدد/,'its apply: nothing to change');
// A newer export changes the representative only: the ERP fields alone are written
const newer=rows.map((r,i)=>i===2?['E200','مصنع الفجر','0553334444','','','2026-02-01','خالد','']:r);
const repOnly=await S.importErpCustomers(manager,body({base64:file(newer)}));
eq(repOnly.erpDates.updates,1,'a new date and representative for k2: one update');
const repDone=await S.importErpCustomers(manager,body({base64:file(newer),action:'apply',requestId:crypto.randomUUID(),snapshot:repOnly.snapshot,adds:0}));
eq([repDone.changed,repDone.erpDatesUpdated,data('k2').erpCreatedAt,data('k2').erpRep,version('k2')],[0,1,'2026-02-01',{name:'خالد'},2],'written alone, its version moved once');

// lib/erp-customer-extras-server.ts directly
eq(X.erpDatesView({rows:new Map(),dateColumn:false,repColumn:true,dates:0,invalidDates:0,reps:4},[{},{},{}]),{dateColumn:false,dates:0,invalidDates:0,repColumn:true,reps:4,updates:3},'the view of the two columns');
const made=[];const fakeDb={prepare:q=>({bind:(...args)=>{made.push([q,args]);return {q,args};}})};
const statements=X.erpExtraStatements(fakeDb,[{row:2,customerId:'a',version:1,set:{},from:{}},{row:3,customerId:'b',version:4,set:{erpCreatedAt:'2026-01-02'},from:{}},{row:4,customerId:'c',version:2,set:{erpCreatedAt:'2026-01-03',erpRep:{name:'"=1+1"'}},from:{erpCreatedAt:'2025-01-01'}}],'المدير','2026-11-16T09:00:00.000Z','attempt-1','EXISTS(1)',['r','a']);
eq(statements.length,4,'an update that sets nothing makes no statement; each other one its update and its audit entry');
ok(made[0][0].includes("json_set(data,'$.erpCreatedAt',?)")&&!made[0][0].includes('erpRep')&&made[2][0].includes("'$.erpRep',json(?)"),'only the fields set are written, the representative as JSON');
eq(made[2][1].slice(0,2),['2026-01-03',JSON.stringify({name:'"=1+1"'})],'their values are bound, never written into the SQL');
ok(made[0][0].includes('version=CASE WHEN mutation_id=? THEN version ELSE version+1 END')&&made[0][1].slice(-2).join()==='r,a','the version moves once for an attempt, every statement under the receipt');
eq(JSON.parse(made[3][1][4]),{label:X.ERP_EXTRA_AUDIT_LABEL,row:4,from:{erpCreatedAt:'2025-01-01'},to:{erpCreatedAt:'2026-01-03',erpRep:{name:'"=1+1"'}}},'the audit entry: the label, the row, from and to');

console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));

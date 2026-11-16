// «استيراد المستهدفات والمتابعات من قوالب Excel» (the owner, 2026-11-16, item 8 of the GSCO comparison list: «واستيراد المستهدفات والمتابعات
// من قوالب Excel»; lib/record-import*.ts, lib/xlsx-write.ts, app/api/record-import) without a build, on a migrated in-memory SQLite with the real
// routes compiled as the build does. Synthetic data only.
// 1. Reading cells: months and days (Arabic-Indic and Persian digits, slashes, Excel day numbers, impossible days), numbers (Arabic separators),
//    headers in Arabic and in English (a product without its unit), the template's sheet, the note row, empty rows, missing and repeated
//    columns, the row limit; the .xlsx writer read back by the real reader.
// 2. The targets: who may download and import (401, 403 by role and by the «تحرير» cell, 404 when the page is hidden), the template filled
//    with the reader's team, preview writes nothing, an import writes in one transaction with the history rows of each person, a second run
//    changes nothing, the same request again answers its first answer, a changed plan after the preview is refused (409), a change between
//    the plan and the write leaves everything as it was (the gate), rows outside the team or region, a finished month (the administrator
//    only), a computed roll-up, partial activity, duplicates, empty rows, bad numbers.
// 3. The follow-ups: a representative's own, another's refused; a supervisor's for their representative; customers outside the scope, no open
//    follow-up line, a visit, a future day, a day before the last contact, two rows for one customer, a lost one with a re-contact date; a
//    second run is «سبق استيراده»; the plan and the audit; customer service refused.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

// The clock is fixed (a Monday, 16 November 2026, 12:00 in Riyadh): no check depends on the day the test runs.
const NativeDate=Date,clock=NativeDate.parse('2026-11-16T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'record-import-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
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
for(const file of ['app/api/record-import/route.ts','app/api/targets/history/route.ts','lib/record-import.ts','lib/xlsx-write.ts','lib/erp-sales.ts','lib/crm.ts','lib/customer-followups.ts'])compile(file);
const load=file=>import(pathToFileURL(path.join(out,file)));
const R=await load('lib/record-import.mjs'),X=await load('lib/xlsx-write.mjs'),E=await load('lib/erp-sales.mjs'),{today}=await load('lib/crm.mjs'),F=await load('lib/customer-followups.mjs');
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const counts={};const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};
const addDays=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const TODAY=today(),MONTH=TODAY.slice(0,7),prevMonth=(()=>{const [y,m]=MONTH.split('-').map(Number);return m===1?(y-1)+'-12':y+'-'+String(m-1).padStart(2,'0');})(),nextMonth=(()=>{const [y,m]=MONTH.split('-').map(Number);return m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0');})();
const book=(name,rows)=>X.xlsxWorkbook({name,rows,headerRow:0});
const sheetsOf=bytes=>E.readWorkbookSheets(bytes,{maxRows:1200,maxColumns:60});

// ---- 1. Reading cells and files.
await counted('reading',async()=>{
 eq(['2026-12','٢٠٢٦-١٢','۲۰۲۶/۱۲',' 2026/7 ','7/2026','2026-12-31','46022',''].map(R.importMonth),['2026-12','2026-12','2026-12','2026-07','2026-07','2026-12','2025-12',''],'a month in every accepted form, Arabic and Persian digits, a day of it, an Excel day number');
 eq(['2026-13','13/2026','abc','1999-01','2026-02-30'].map(R.importMonth),[null,null,null,null,null],'not a month');
 eq(['2026-11-16','٢٠٢٦/١١/١٦','2026.11.16','46342','2026-2-3',''].map(R.importDay),['2026-11-16','2026-11-16','2026-11-16','2026-11-16','2026-02-03',''],'a day: hyphens, slashes, points, Excel\'s number (46342 = 2026-11-16)');
 eq(['2026-02-29','2025-02-29x','16/11/2026','tomorrow'].map(R.importDay),[null,null,null,null],'an impossible day or a day first: refused (a day is written year first)');
 eq(['12','١٢٫٥','1,250','١٬٢٥٠','0','',' ','-3','1e3','abc'].map(R.importNumber),[12,12.5,1250,1250,0,null,null,-3,undefined,undefined],'numbers with Arabic digits and separators; empty is null; not a number is undefined');
 eq(R.importText('‏مرحبا   ‪بكم‬ '),'مرحبا بكم','invisible direction marks and runs of spaces');
 eq([R.columnOf('targets','الشهر'),R.columnOf('targets','Month'),R.columnOf('targets','  البريد الإلكتروني للعضو *'),R.columnOf('targets','قوالب البلوك المتحركة'),R.columnOf('targets','Molds for mobile block machines (Mold)'),R.columnOf('targets','actual visits'),R.columnOf('targets','شيء آخر')],['month','month','email','p:قوالب البلوك المتحركة','p:قوالب البلوك المتحركة','visits',null],'headers in Arabic and English, a product with or without its unit, case and stars ignored');
 eq([R.importFollowupType('اتصال'),R.importFollowupType('WhatsApp'),R.importFollowupType('meeting'),R.importFollowupType('زيارة'),R.importFollowupType('بريد'),R.importFollowupType('')],['call','whatsapp','meeting','visit',null,''],'follow-up types by Arabic, English or key');
 eq([R.importStage('تم الفقد'),R.importStage('Negotiation'),R.importStage('specs'),R.importStage('مفقودة')],['lost','negotiation','specs',null],'stages');
 eq([R.importLossReason('السعر أعلى من المنافس'),R.importLossReason('Other'),R.importLossReason('سبب آخر')],['السعر أعلى من المنافس','أخرى',null],'loss reasons of the list only');
 // The writer, read back by the real reader (the same as the ERP imports).
 const header=R.TARGET_COLUMNS.map(c=>c.ar),notes=R.TARGET_COLUMNS.map(c=>c.note.ar);
 const bytes=X.xlsxWorkbook({name:'المستهدفات',rows:[header,notes,[MONTH,'rep1@yourrest.org','اسم <rep1> & "x"','5'],[],['','','',''],[MONTH,'rep2@yourrest.org']],widths:R.TARGET_COLUMNS.map(c=>c.width),rightToLeft:true,headerRow:0,noteRow:1});
 const sheets=sheetsOf(bytes);eq(sheets[0].name,'المستهدفات','the sheet\'s name');eq(sheets[0].rows[0].cells,header,'the header row read back');eq(sheets[0].rows[2].cells.slice(0,4),[MONTH,'rep1@yourrest.org','اسم <rep1> & "x"','5'],'text with markup characters kept as text');
 const read=R.readImportRows('targets',sheets);eq(read.rows.map(r=>r.row),[3,6],'the note row and the empty rows skipped; rows keep their Excel numbers');eq(read.empty,2,'two empty rows counted');eq(read.rows[0].cells['p:قوالب البلوك المتحركة'],'5','cells by column key');
 // English headers, another order, an extra column, a sheet of another name.
 const en=R.FOLLOWUP_COLUMNS.map(c=>c.en);
 const reordered=R.readImportRows('followups',sheetsOf(book('Sheet1',[['note on top'],['Remarks',...[...en].reverse()],[...R.FOLLOWUP_COLUMNS.map(c=>c.note.en)].reverse().map((v,i)=>i===0?v:v),['x',...[...en].reverse().map((_,i,a)=>a[i]==='Customer code'?'YR-C-000001':'')]])));
 eq([reordered.rows.length,reordered.rows[0].cells.customerCode,reordered.ignoredColumns],[1,'YR-C-000001',['Remarks']],'English headers in any order under a first line, an unknown column ignored and named');
 assert.throws(()=>R.readImportRows('targets',sheetsOf(book('x',[['الشهر','اسم العضو'],['2026-11','x']]))),/أعمدة ناقصة في الملف: البريد الإلكتروني للعضو/);checks++;
 assert.throws(()=>R.readImportRows('targets',sheetsOf(book('x',[['الشهر','البريد الإلكتروني للعضو','Month'],['2026-11','a','b']]))),/مكرر/);checks++;
 assert.throws(()=>R.readImportRows('targets',sheetsOf(book('x',[['الشهر','البريد الإلكتروني للعضو'],[],[]]))),/لا يحتوي على صفوف بيانات/);checks++;
 assert.throws(()=>R.readImportRows('followups',sheetsOf(book('x',[['a','b'],['1','2']]))),/لم أجد أعمدة قالب/);checks++;
 const many=[['الشهر','البريد الإلكتروني للعضو'],...Array.from({length:1001},(_,i)=>[MONTH,'m'+i+'@x'])];
 assert.throws(()=>R.readImportRows('targets',sheetsOf(book('x',many))),/الحد الأقصى 1000 صف/);checks++;
 eq(R.readImportRows('targets',sheetsOf(book('x',many.slice(0,1001)))).rows.length,1000,'1000 rows are read');
});

// ---- The database and the routes.
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
let beforeBatch=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(beforeBatch){const f=beforeBatch;beforeBatch=null;f();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const stamp='2025-01-01T00:00:00.000Z';
const member=(id,role,supervisor=null,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,stamp);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('mgrE','manager',null,'eastern');member('sup','supervisor','mgr');member('sup2','supervisor','mgr','western');
member('rep1','rep','sup');member('rep2','rep','sup');member('rep3','rep','sup2','western');member('cs','customer_service','mgr');member('off','rep','sup');sql.prepare("UPDATE crm_members SET active=0 WHERE id='off'").run();
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const record=(id,kind,parent,assigned,data,created=stamp)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),created,created);
const api=await load('app/api/record-import/route.mjs');
const as=id=>{globalThis.testIdentity=id;};
const template=async(who,query)=>{as(who);const response=await api.GET(new Request('https://test.invalid/api/record-import'+query));return response;};
const post=async(who,body,status=200)=>{as(who);const response=await api.POST(new Request('https://test.invalid/api/record-import',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://test.invalid'},body:JSON.stringify(body)}));const data=await response.json();eq(response.status,status,who+' '+body.action+' '+body.kind+': '+JSON.stringify(data).slice(0,300));return data;};
const b64=bytes=>Buffer.from(bytes).toString('base64');
const file=(kind,rows,lang='ar')=>{const cols=R.recordImportColumns(kind);const header=cols.map(c=>lang==='en'?c.en:c.ar);return b64(X.xlsxWorkbook({name:R.recordImportSheet(kind,lang),rows:[header,cols.map(c=>c.note[lang]),...rows.map(row=>cols.map(c=>row[c.key]??''))],headerRow:0,noteRow:1}));};
const P=R.TARGET_COLUMNS.filter(c=>c.key.startsWith('p:')).map(c=>c.key);
const sets=()=>sql.prepare("SELECT kind,scope_id,month,data,version FROM crm_target_sets ORDER BY kind,scope_id,month").all().map(r=>({...r,data:JSON.parse(r.data)}));
const audits=prefix=>sql.prepare("SELECT id,record_id,actor,action,detail FROM crm_audit WHERE id LIKE ? ORDER BY rowid").all(prefix+'%');

// ---- 2. Targets.
await counted('targets',async()=>{
 // rep1 had a target from the month before; rep2 none.
 sql.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,?,1,?,?,?)').run('sales','rep1',prevMonth,JSON.stringify({products:P.map((k,i)=>({product:k.slice(2),quantity:i===0?8:null}))}),'seed','owner',stamp);
 // Who may download the template.
 eq((await template(null,'?kind=targets')).status,401,'no session: 401');
 for(const who of ['rep1','sup','cs'])eq((await template(who,'?kind=targets')).status,403,who+' may not import targets: 403');
 eq((await template('mgr','?kind=nothing')).status,400,'an unknown kind: 400');
 let response=await template('mgr','?kind=targets&month='+MONTH);eq([response.status,response.headers.get('content-type'),response.headers.get('cache-control')],[200,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','private, no-store'],'the sales manager downloads the template');
 let sheet=sheetsOf(new Uint8Array(await response.arrayBuffer()))[0];
 eq(sheet.rows[0].cells.slice(0,3),['الشهر','البريد الإلكتروني للعضو','اسم العضو'],'Arabic headers');ok(sheet.rows[1].cells[0].startsWith('إلزامي.'),'the note row');
 const emails=sheet.rows.slice(2).map(r=>r.cells[1]);eq(emails.sort(),['rep1@yourrest.org','rep2@yourrest.org','rep3@yourrest.org','sup2@yourrest.org','sup@yourrest.org'].sort(),'the sales manager\'s team: representatives and supervisors, active, no administrator, manager, customer service or inactive account');
 const rep1Row=sheet.rows.slice(2).find(r=>r.cells[1]==='rep1@yourrest.org');eq([rep1Row.cells[0],rep1Row.cells[3],rep1Row.cells[4]??''],[MONTH,'8',''],'filled with the target in force (carried from the month before), an unset product empty');
 response=await template('mgrE','?kind=targets&lang=en');sheet=sheetsOf(new Uint8Array(await response.arrayBuffer()))[0];
 eq([sheet.name,sheet.rows[0].cells[0]],['Targets','Month'],'the English template');eq(sheet.rows.slice(2).map(r=>r.cells[1]).sort(),['rep1@yourrest.org','rep2@yourrest.org','sup@yourrest.org'],'a manager of the eastern region: their region only');
 // The «تحرير» cell switched off, and the page hidden.
 sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('mgr',?,?,1,'owner',?)").run(JSON.stringify({'targets:edit':false}),'[]',stamp);
 eq((await template('mgr','?kind=targets')).status,403,'«تحرير» off: 403');
 sql.prepare("UPDATE crm_member_permissions SET permissions='{}',hidden='[\"targets\"]',version=2 WHERE member_id='mgr'").run();
 eq((await template('mgr','?kind=targets')).status,404,'the page hidden: 404');
 sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='mgr'").run();

 const row=(email,month,products={},activity={})=>({month,email,...Object.fromEntries(P.map(k=>[k,products[k.slice(2)]??''])),...activity});
 const p1=R.TARGET_COLUMNS[3].key.slice(2),p2=R.TARGET_COLUMNS[4].key.slice(2);
 const rows=[
  row('rep1@yourrest.org',MONTH,{[p1]:'١٢',[p2]:'0'},{newCustomers:'4',recoveredCustomers:'2',visits:'150'}), // 3: changed (sales carried) + new activity
  row('REP2@yourrest.org ',MONTH,{[p1]:'7.5'}), // 4: new sales
  {month:MONTH,email:'rep2@yourrest.org',[P[0]]:'1'}, // 5: duplicate of 4
  row('rep3@yourrest.org',MONTH,{[p1]:'3'}), // 6: new (manager over all regions)
  row('sup@yourrest.org',MONTH,{[p1]:'3'}), // 7: supervisor sales refused
  row('sup@yourrest.org',nextMonth,{},{newCustomers:'5',recoveredCustomers:'5',visits:'100'}), // 8: supervisor activity allowed (next month)
  row('mgr@yourrest.org',MONTH,{},{newCustomers:'1',recoveredCustomers:'1',visits:'1'}), // 9: manager activity refused
  row('rep1@yourrest.org',nextMonth,{},{newCustomers:'4',recoveredCustomers:'',visits:'150'}), // 10: partial activity
  row('rep1@yourrest.org',nextMonth,{[p1]:'-1'}), // 11: negative
  row('rep1@yourrest.org',nextMonth,{[p1]:'abc'}), // 12: not a number
  row('nobody@yourrest.org',MONTH,{[p1]:'1'}), // 13: unknown email
  row('off@yourrest.org',MONTH,{[p1]:'1'}), // 14: inactive
  row('cs@yourrest.org',MONTH,{[p1]:'1'}), // 15: customer service
  row('rep2@yourrest.org',prevMonth,{[p1]:'1'}), // 16: finished month, a manager
  row('rep2@yourrest.org','2026-13',{[p1]:'1'}), // 17: bad month
  row('rep2@yourrest.org',nextMonth), // 18: no values
  row('rep1@yourrest.org',nextMonth,{[p1]:'1.1234567'}), // 19: seven decimals
 ];
 const base64=file('targets',rows),body={kind:'targets',action:'preview',fileName:'targets.xlsx',base64};
 await post(null,body,401);await post('rep1',body,403);await post('sup',body,403);await post('cs',body,403);
 const before=JSON.stringify(sets());
 let preview=await post('mgr',body);
 eq(JSON.stringify(sets()),before,'a preview writes nothing');
 const status=Object.fromEntries(preview.rows.map(r=>[r.row,r.status]));
 eq(status,{3:'changed',4:'new',5:'refused',6:'new',7:'refused',8:'new',9:'refused',10:'refused',11:'refused',12:'refused',13:'refused',14:'refused',15:'refused',16:'refused',17:'refused',18:'empty',19:'refused'},'each row\'s status');
 const why=n=>preview.rows.find(r=>r.row===n).message;
 eq([why(5),why(7),why(9),why(10),why(13),why(14),why(15),why(16),why(17)],['مكرر: العضو نفسه والشهر نفسه في الصف 4.','مستهدف المبيعات للمدير والمشرف يُحسب تلقائيًا من إجمالي مستهدفات الفريق.','مدير المبيعات خارج التقييم، فلا تُحدَّد له مستهدفات العملاء والزيارات.','اكتب العملاء الجدد والعملاء المستردين والزيارات الفعلية معًا، أو اتركها فارغة.','لا يوجد عضو بهذا البريد في الفريق: nobody@yourrest.org','حساب العضو معطل.','العضو خارج نطاق فريقك أو منطقتك.','انتهى هذا الشهر؛ تعديل مستهدفاته لمدير النظام فقط','الشهر غير صحيح؛ اكتبه مثل 2026-12.'],'the reasons, by row');
ok(why(11).startsWith('كمية غير صحيحة في «')&&why(12).startsWith('كمية غير صحيحة في «')&&why(19).startsWith('كمية غير صحيحة في «'),'a negative, a word, seven decimals: refused');
 eq([preview.counts.rows,preview.counts.write,preview.counts.refused,preview.counts.empty],[17,4,12,1],'the counts');
 // The regional manager: rep3 (western) is outside their region.
 const regional=await post('mgrE',body);eq(regional.rows.find(r=>r.row===6).status,'refused','a region outside the manager\'s: refused');
 // Commit without a preview, with another digest.
 await post('mgr',{...body,action:'commit',requestId:'00000000-0000-4000-8000-000000000001'},400);
 await post('mgr',{...body,action:'commit',requestId:'00000000-0000-4000-8000-000000000001',planDigest:'0'.repeat(64)},409);
 eq(JSON.stringify(sets()),before,'refused commits write nothing');
 // A change between the plan and the write: the gate keeps everything as it was.
 const requestId='00000000-0000-4000-8000-0000000000aa';
 beforeBatch=()=>sql.prepare("INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES('sales','rep2',?,?,1,'race','owner',?)").run(MONTH,JSON.stringify({products:P.map(k=>({product:k.slice(2),quantity:2}))}),stamp);
 await post('mgr',{...body,action:'commit',requestId,planDigest:preview.planDigest},409);
 eq(sets().filter(s=>s.scope_id!=='rep2').map(s=>[s.kind,s.scope_id,s.month,s.version]),[['sales','rep1',prevMonth,1]],'a set written meanwhile: nothing of the import was written');
 eq(audits('record-import:').length,0,'and no audit line');
 sql.prepare("DELETE FROM crm_target_sets WHERE mutation_id='race'").run();
 // The import.
 const result=await post('mgr',{...body,action:'commit',requestId,planDigest:preview.planDigest});
 eq([result.written,result.counts.write],[4,4],'four rows saved');
 const now=sets();
 const rep1=now.find(s=>s.kind==='sales'&&s.scope_id==='rep1'&&s.month===MONTH);eq([rep1.version,rep1.data.products.find(p=>p.product===p1).quantity,rep1.data.products.find(p=>p.product===p2).quantity,rep1.data.products.filter(p=>p.quantity===null).length],[1,12,0,P.length-2],'rep1: Arabic digits read, 0 kept as zero, blanks «غير محدد»');
 eq(now.find(s=>s.kind==='activity'&&s.scope_id==='rep1').data,{newCustomers:4,recoveredCustomers:2,visits:150},'rep1\'s customers and visits');
 eq(now.find(s=>s.kind==='sales'&&s.scope_id==='rep2').data.products.find(p=>p.product===p1).quantity,7.5,'rep2 by an email in capitals with a space');
 eq(now.find(s=>s.kind==='activity'&&s.scope_id==='sup').month,nextMonth,'the supervisor\'s activity targets of next month');
 eq(now.find(s=>s.scope_id==='rep1'&&s.month===prevMonth).version,1,'the month before is untouched');
 const lines=audits('target-set:');eq(lines.length,5,'one history line for each set written');
 const history=JSON.parse(lines.find(l=>l.record_id==='target-rep1'&&l.action==='تعديل مستهدفات الأصناف').detail);eq([history.month,history.before.month,history.source,history.importId],[MONTH,prevMonth,'excel-import','record-import:targets:mgr:'+requestId],'the history line says what it replaced and that it came from the import');
 const importLine=audits('record-import:targets:mgr:');eq([importLine.length,importLine[0].action,importLine[0].record_id],[1,'استيراد المستهدفات من Excel','record-import-targets'],'one audit line for the import');
 const detail=JSON.parse(importLine[0].detail);eq([detail.fileName,detail.counts.write,detail.rows.length,typeof detail.fileSha256],['targets.xlsx',4,17,'string'],'with the file, its hash, the counts and each row\'s status');
 // The history route shows it.
 const historyApi=await load('app/api/targets/history/route.mjs');as('mgr');const page=await (await historyApi.GET(new Request('https://test.invalid/api/targets/history?scopeId=rep1'))).json();
 ok(page.entries.some(e=>e.month===MONTH&&e.kind==='sales'&&e.changes.some(c=>c.field===p1&&c.before===8&&c.after===12)),'«سجل التعديلات» of rep1: 8 → 12');
 // The same request again: its first answer, nothing written twice.
 const again=await post('mgr',{...body,action:'commit',requestId,planDigest:preview.planDigest});eq([again.alreadySaved,again.written],[true,4],'the same request: the first answer');
 await post('mgr',{...body,base64:file('targets',rows.slice(0,2)),action:'commit',requestId,planDigest:preview.planDigest},409);
 // The same file again: nothing changes.
 preview=await post('mgr',body);eq(Object.fromEntries(preview.rows.filter(r=>[3,4,6,8].includes(r.row)).map(r=>[r.row,r.status])),{3:'unchanged',4:'unchanged',6:'unchanged',8:'unchanged'},'a second run: every saved row unchanged');eq(preview.counts.write,0,'nothing to write');
 const second=await post('mgr',{...body,action:'commit',requestId:'00000000-0000-4000-8000-0000000000ab',planDigest:preview.planDigest});eq(second.written,0,'and nothing written');eq(audits('record-import:targets:').length,1,'no second audit line');
 // A finished month: the administrator only, and the answer names it.
 const closed=file('targets',[row('rep2@yourrest.org',prevMonth,{[p1]:'9'})]);
 const ownerPreview=await post('owner',{kind:'targets',action:'preview',fileName:'closed.xlsx',base64:closed});eq([ownerPreview.rows[0].status,ownerPreview.closedMonths],['new',[prevMonth]],'the administrator may import a finished month');
 await post('owner',{kind:'targets',action:'commit',fileName:'closed.xlsx',base64:closed,requestId:'00000000-0000-4000-8000-0000000000ac',planDigest:ownerPreview.planDigest});
 ok(JSON.parse(audits('target-set:owner:').at(-1).detail).closedMonth===true,'the history line marks the finished month');
 // English headers, a template the sales manager downloaded and changed.
 const enFile=file('targets',[{month:MONTH,email:'rep2@yourrest.org',[P[0]]:'7.5',[P[1]]:'2'}],'en');
 const enPreview=await post('mgr',{kind:'targets',action:'preview',fileName:'en.xlsx',base64:enFile});eq([enPreview.rows[0].status,enPreview.sheet],['changed','Targets'],'an English file');
 // Not an xlsx, too large, broken base64.
 await post('mgr',{kind:'targets',action:'preview',fileName:'x.xlsx',base64:Buffer.from('not a workbook').toString('base64')},400);
 await post('mgr',{kind:'targets',action:'preview',fileName:'x.xlsx',base64:'@@@@'},400);
 await post('mgr',{kind:'targets',action:'preview',fileName:'x.xlsx',base64,extra:1},400);
});

// ---- 3. Follow-ups.
await counted('followups',async()=>{
 const customer=(id,rep,region,code,extra={})=>record(id,'customer',null,rep,{name:'عميل '+id,region,city:'المدينة',code,...extra});
 customer('c1','rep1','الشرقية','ERP-1');customer('c2','rep2','الشرقية','ERP-2');customer('c3','rep3','الغربية','ERP-3');customer('c4','rep1','الشرقية','ERP-4');customer('c5','rep1','الشرقية','DUP');customer('c6','rep2','الشرقية','DUP');customer('c7','rep1','الشرقية','ERP-7');customer('c8','rep1','الشرقية','ERP-8');
 const code=id=>'YR-C-'+String(sql.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(id).number).padStart(6,'0');
 const visitOn=(id,customerId,by,date,extra={})=>record(id,'activity',customerId,by,{visitWorkflow:'customer-v1',type:'visit',date,summary:'زيارة',result:'العميل مهتم',performedBy:by,responsibleId:by,recordedByEmail:by+'@yourrest.org',salesStage:'specs',nextAction:'اتصال للتأكيد',nextDate:addDays(TODAY,-1),...extra},date+'T08:00:00.000Z');
 const d=n=>addDays(TODAY,n);
 visitOn('v1','c1','rep1',d(-5));visitOn('v2','c2','rep2',d(-5));visitOn('v3','c3','rep3',d(-5));visitOn('v5','c5','rep1',d(-5));visitOn('v7','c7','rep1',d(-5));visitOn('v8','c8','rep1',d(-2));
 // c4 has a visit that is lost (no open line).
 visitOn('v4','c4','rep1',d(-5),{salesStage:'lost'});
 eq((await template(null,'?kind=followups')).status,401,'no session: 401');eq((await template('cs','?kind=followups')).status,403,'customer service: 403');
 let response=await template('rep1','?kind=followups');eq(response.status,200,'a representative downloads the follow-ups template');
 let sheet=sheetsOf(new Uint8Array(await response.arrayBuffer()))[0];
 eq(sheet.rows.slice(2).map(r=>r.cells[0]).sort(),[code('c1'),code('c5'),code('c7'),code('c8')].sort(),'their customers with an open follow-up line (not the lost one, not another representative\'s)');
 response=await template('sup','?kind=followups');sheet=sheetsOf(new Uint8Array(await response.arrayBuffer()))[0];
 eq(sheet.rows.slice(2).find(r=>r.cells[0]===code('c2')).cells[2],'rep2@yourrest.org','the supervisor\'s template names the representative of each line');
 const row=(cells)=>({date:d(0),type:'اتصال',result:'تم الاتصال بالعميل',stage:'',nextAction:'زيارة',nextDate:d(3),...cells});
 const rows=[
  row({customerCode:code('c1'),date:'٢٠'+d(0).slice(2).replace(/\d/g,x=>'٠١٢٣٤٥٦٧٨٩'[x])}), // 3: ok, Arabic digits
  row({customerCode:code('c2')}), // 4: another representative's customer (rep1 sees? same region: visible but customer of rep2)
  row({customerCode:code('c3')}), // 5: other region
  row({customerCode:code('c4')}), // 6: no open line
  row({customerCode:'DUP'}), // 7: ERP code of two customers
  row({customerCode:'ERP-7',type:'زيارة'}), // 8: a visit
  row({customerCode:code('c8'),date:d(1)}), // 9: future
  row({customerCode:code('c8'),date:d(-3)}), // 10: before the last contact (c8 visited d(-2))
  row({customerCode:'erp-7',stage:'تم الفقد',lossReason:'السعر أعلى من المنافس',nextAction:'',nextDate:'',recontactAction:'اتصال بعد العرض الجديد',recontactDate:d(30)}), // 11: lost with re-contact
  row({customerCode:code('c1')}), // 12: the same customer again
  row({customerCode:code('c5'),email:'rep2@yourrest.org'}), // 13: another representative named by a representative
  row({customerCode:code('c5'),result:'لا'}), // 14 (c5 again) : already used? no: c5 first appears in 13 refused -> this is the first counted
  row({customerCode:'',result:'x'}), // 15: no code
 ];
 const body={kind:'followups',action:'preview',fileName:'followups.xlsx',base64:file('followups',rows)};
 await post('cs',body,403);
 let preview=await post('rep1',body);
const status=Object.fromEntries(preview.rows.map(r=>[r.row,r.status])),why=n=>preview.rows.find(r=>r.row===n).message;
 eq(status,{3:'new',4:'refused',5:'refused',6:'refused',7:'refused',8:'refused',9:'refused',10:'refused',11:'new',12:'refused',13:'refused',14:'refused',15:'refused'},'each row\'s status');
 eq([why(6),why(7),why(8),why(12),why(13),why(15)],['لا توجد متابعة مفتوحة لهذا العميل؛ تحتاج زيارة سابقة فيها إجراء قادم وموعد متابعة.','كود ERP هذا لأكثر من عميل؛ اكتب كود يورست (YR-C-…).','المتابعة بزيارة تُسجَّل من التطبيق لأنها تحتاج موقع الجهاز؛ اختر نوعًا آخر.','للعميل نفسه متابعة أخرى في الملف (الصف 3)؛ استورد المتابعة التالية بعد حفظ هذا الملف.','لا يمكنك تسجيل متابعة باسم عضو آخر.','كود العميل مطلوب.'],'the reasons');
 ok(why(5).startsWith('لا يوجد عميل بهذا الكود ضمن عملائك')&&why(4)!=='','another region\'s customer is not one of theirs');
 ok(why(9).includes('لا يمكن أن يكون في المستقبل'),'a future day: '+why(9));ok(why(10).startsWith('تاريخ المتابعة يسبق آخر تواصل مسجل للعميل'),'a day before the last contact: '+why(10));
 ok(why(14).includes('3 أحرف'),'a result of one word: '+why(14));
 eq(sql.prepare("SELECT COUNT(*) n FROM crm_records WHERE json_extract(data,'$.visitWorkflow')='followup-v1'").get().n,0,'the preview writes nothing');
 const requestId='00000000-0000-4000-8000-0000000000f1';
 const result=await post('rep1',{...body,action:'commit',requestId,planDigest:preview.planDigest});eq(result.written,2,'two follow-ups saved');
 const saved=sql.prepare("SELECT id,parent_id,data FROM crm_records WHERE json_extract(data,'$.visitWorkflow')='followup-v1' ORDER BY parent_id").all().map(r=>({id:r.id,parent:r.parent_id,data:JSON.parse(r.data)}));
 eq(saved.map(r=>[r.parent,r.data.performedBy,r.data.type,r.data.date,r.data.sourceId,r.data.importedBy]),[['c1','rep1','call',d(0),'v1','rep1'],['c7','rep1','call',d(0),'v7','rep1']],'recorded as the representative, on their customers, executing the open line');
 const lost=saved.find(r=>r.parent==='c7').data;eq([lost.salesStage,lost.recontact,lost.nextDate,lost.nextAction,lost.lossReason],['lost',true,d(30),'اتصال بعد العرض الجديد','السعر أعلى من المنافس'],'the lost one keeps its re-contact');
 eq(JSON.parse(sql.prepare("SELECT data FROM crm_records WHERE id='c1'").get().data)._visitPlan.visitId,saved[0].id,'the customer\'s plan points at the new follow-up');
 // The plans: c1's line moved on, c7's is a re-contact.
 const all=sql.prepare('SELECT id,kind,parent_id AS parentId,assigned_to AS assignedTo,branch,data,created_at AS createdAt,updated_at AS updatedAt,version FROM crm_records').all().map(r=>({...r,data:JSON.parse(r.data)}));
 const plans=F.customerFollowupPlans(all);eq(plans.filter(p=>['c1','c7'].includes(p.customer.id)).map(p=>[p.customer.id,p.closed,!!p.recontact,p.nextDate]),[['c1',false,false,d(3)],['c7',false,true,d(30)]],'c1 open with its next step, c7 kept for the re-contact');
 eq(audits('record-import:followups:rep1:').length,1,'one audit line for the import');eq(sql.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='تسجيل متابعة'").get().n,2,'and «تسجيل متابعة» for each');
 // A second run of the same file: already imported.
 preview=await post('rep1',body);eq([preview.rows.find(r=>r.row===3).status,preview.rows.find(r=>r.row===11).status,preview.counts.write],['duplicate','duplicate',0],'the same rows again: already imported, nothing to write');
 // A supervisor for their representative; a representative outside their team.
 const supRows=[row({customerCode:code('c2'),email:'rep2@yourrest.org',type:'WhatsApp'}),row({customerCode:code('c3'),email:'rep3@yourrest.org'}),row({customerCode:code('c1'),email:'rep3@yourrest.org'})];
 const supBody={kind:'followups',action:'preview',fileName:'sup.xlsx',base64:file('followups',supRows,'en')};
 preview=await post('sup',supBody);eq(preview.rows.map(r=>r.status),['new','refused','refused'],'the supervisor records for rep2; rep3\'s customer and rep3 are not their team');
 eq([preview.rows[1].message,preview.rows[2].message],['لا يوجد عميل بهذا الكود ضمن عملائك: '+code('c3'),'العضو خارج نطاق فريقك أو حسابه معطل.'],'the reasons');
 // A change between the plan and the write (rep2 records a follow-up meanwhile): nothing is written.
 beforeBatch=()=>sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='v2'").run();
 await post('sup',{...supBody,action:'commit',requestId:'00000000-0000-4000-8000-0000000000f2',planDigest:preview.planDigest},409);
 eq(sql.prepare("SELECT COUNT(*) n FROM crm_records WHERE parent_id='c2' AND json_extract(data,'$.visitWorkflow')='followup-v1'").get().n,0,'the gate: nothing written');
 preview=await post('sup',supBody);const supResult=await post('sup',{...supBody,action:'commit',requestId:'00000000-0000-4000-8000-0000000000f3',planDigest:preview.planDigest});eq(supResult.written,1,'after a fresh preview it is saved');
 const supSaved=JSON.parse(sql.prepare("SELECT data FROM crm_records WHERE parent_id='c2' AND json_extract(data,'$.visitWorkflow')='followup-v1'").get().data);eq([supSaved.performedBy,supSaved.recordedByEmail,supSaved.importedBy,supSaved.type],['rep2','rep2@yourrest.org','sup','whatsapp'],'performed by rep2, imported by the supervisor');
 // A re-contact in the past, or on a stage that is not lost.
 const bad=[row({customerCode:code('c8'),date:d(-1),stage:'تم الفقد',lossReason:'أخرى',lossDetails:'تفاصيل',recontactAction:'اتصال',recontactDate:d(-1),nextAction:'',nextDate:''}),row({customerCode:code('c5'),stage:'تفاوض',recontactAction:'اتصال',recontactDate:d(5)})];
 preview=await post('rep1',{kind:'followups',action:'preview',fileName:'bad.xlsx',base64:file('followups',bad)});
 eq(preview.rows.map(r=>r.message),['موعد إعادة التواصل لا يكون في الماضي.','موعد إعادة التواصل للمتابعة المفقودة فقط (مرحلة «تم الفقد»).'],'a past re-contact, a re-contact on an open stage: refused');
 // «إضافة» on «المتابعات» switched off.
 sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('rep1',?,?,1,'owner',?)").run(JSON.stringify({'followup:add':false}),'[]',stamp);
 await post('rep1',body,403);eq((await template('rep1','?kind=followups')).status,403,'and the template');
 sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='rep1'").run();
});

const migrationsNow=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name));
eq(migrationsNow.filter(name=>name<='0020_member_permissions.sql').length,21,'no new migration (21; a later release\'s 0021, 2026-11-16, is left out of the count)');
console.log(JSON.stringify({ok:true,checks,parts:counts}));

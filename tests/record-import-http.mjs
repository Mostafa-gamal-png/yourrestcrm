// «استيراد المستهدفات والمتابعات من قوالب Excel» (the owner, 2026-11-16, GSCO list item 8; lib/record-import*.ts) over real HTTP against the
// BUILT release (run the build first): GET /api/record-import (the template) and POST /api/record-import (preview, import). 401 without a
// session for both, 403 from another site, 403 for a role without the right (a representative, a supervisor or customer service on the
// targets; customer service on the follow-ups), 400 for an unknown kind; the sales manager's template of their team, a preview that writes
// nothing, an import in one transaction with its audit line, a second run that changes nothing and the same request answered again; the
// representative's own follow-ups (another member's refused), a supervisor's for their representative; nothing cached. Synthetic data only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members=[
 {id:'owner',role:'admin',name:'مدير النظام'},{id:'mgr',role:'manager',name:'مدير المبيعات'},{id:'sup',role:'supervisor',sup:'mgr',name:'المشرف سالم'},
 {id:'rep1',role:'rep',sup:'sup',name:'المندوب أحمد'},{id:'rep2',role:'rep',sup:'sup',name:'المندوب خالد'},{id:'cs',role:'customer_service',sup:'mgr',name:'خدمة العملاء'}
];
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
// The template writer and the column list, compiled from the source the build used (no network, no test data from outside).
const root=process.cwd();fs.mkdirSync(path.join(root,'.sites-runtime'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'.sites-runtime','record-import-http-'));process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
for(const file of ['lib/xlsx-write.ts']){fs.writeFileSync(path.join(out,path.basename(file,'.ts')+'.mjs'),ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
const X=await import(pathToFileURL(path.join(out,'xlsx-write.mjs')));
const TARGETS=['الشهر','البريد الإلكتروني للعضو','اسم العضو','قوالب البلوك المتحركة (قالب)'],FOLLOWUPS=['كود العميل','البريد الإلكتروني للمندوب','تاريخ المتابعة المنفذة','نوع المتابعة','نتيجة المتابعة','الإجراء القادم','موعد المتابعة القادمة'];
const workbook=(sheet,rows)=>Buffer.from(X.xlsxWorkbook({name:sheet,rows,headerRow:0})).toString('base64');
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}),TODAY=riyadh.format(new Date()),MONTH=TODAY.slice(0,7);
const addDays=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const app=await bootBuiltApp({members});
try{
 const stamp='2025-01-01T00:00:00.000Z',insert=(id,kind,parent,assigned,data,created=stamp)=>app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),created,created).run();
 for(const [id,rep] of [['c1','rep1'],['c2','rep2']]){await insert(id,'customer',null,rep,{name:'مصنع '+id,region:'الشرقية',code:'ERP-'+id});await insert('v-'+id,'activity',id,rep,{visitWorkflow:'customer-v1',type:'visit',date:addDays(TODAY,-3),summary:'زيارة',result:'العميل مهتم',performedBy:rep,responsibleId:rep,recordedByEmail:rep+'@yourrest.org',salesStage:'specs',nextAction:'اتصال',nextDate:addDays(TODAY,-1)},addDays(TODAY,-3)+'T08:00:00.000Z');}
 const code=async id=>'YR-C-'+String((await app.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number).padStart(6,'0');
 const session={};for(const m of members)session[m.id]=app.as(await app.login(m.id));const anonymous=app.as(null);
 const post=async(who,body,status,label)=>{const response=await (who?session[who]:anonymous)('/api/record-import',{method:'POST',body});eq(response.status,status,label+' -> '+response.text.slice(0,300));if(status===200)eq(response.headers['cache-control'],'private, no-store',label+': never cached');return status===200?response.json():null;};
 // GET: the template.
 const get=async(who,query)=>(who?session[who]:anonymous)('/api/record-import'+query);
 for(const query of ['?kind=targets','?kind=followups'])eq((await get(null,query)).status,401,'no session '+query+': 401');
 for(const who of ['rep1','sup','cs'])eq((await get(who,'?kind=targets')).status,403,who+' and the targets template: 403');
 eq((await get('cs','?kind=followups')).status,403,'customer service and the follow-ups template: 403');
 eq((await get('mgr','?kind=other')).status,400,'an unknown kind: 400');
 let response=await get('mgr','?kind=targets&month='+MONTH);
 eq([response.status,response.headers['content-type'],response.headers['cache-control'],response.headers['x-content-type-options']],[200,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','private, no-store','nosniff'],'the sales manager\'s targets template');
 ok(/attachment; filename="Yourrest-targets-template-\d{4}-\d{2}\.xlsx"/.test(response.headers['content-disposition']),'downloaded as a file');
 ok(response.bytes.subarray(0,2).toString()==='PK','an .xlsx (a zip)');
 const text=response.bytes.toString('utf8');ok(text.includes('rep1@yourrest.org')&&text.includes('sup@yourrest.org')&&!text.includes('cs@yourrest.org')&&!text.includes('owner@yourrest.org'),'the team, not customer service or the administrator');
 response=await get('rep1','?kind=followups&lang=en');eq(response.status,200,'a representative\'s follow-ups template');ok(response.bytes.toString('utf8').includes('Customer code')&&response.bytes.toString('utf8').includes(await code('c1'))&&!response.bytes.toString('utf8').includes(await code('c2')),'English headers; their own customer with an open line, not rep2\'s');
 // POST: rights.
 const targetsFile=workbook('المستهدفات',[TARGETS,[MONTH,'rep1@yourrest.org','','١٢'],[MONTH,'rep2@yourrest.org','','5'],[MONTH,'cs@yourrest.org','','1']]);
 const body={kind:'targets',action:'preview',fileName:'targets.xlsx',base64:targetsFile};
 await post(null,body,401,'no session');
 const cross=await session.mgr('/api/record-import',{method:'POST',headers:{Origin:'https://evil.example'},body});eq(cross.status,403,'from another site: 403');
 for(const who of ['rep1','sup','cs'])await post(who,body,403,who+' imports targets');
 await post('mgr',{...body,kind:'nothing'},400,'an unknown kind');
 await post('mgr',{...body,base64:'%%%%'},400,'broken base64');
 await post('mgr',{...body,base64:Buffer.from('plain text').toString('base64')},400,'not an xlsx');
 const before=await app.db.prepare('SELECT COUNT(*) n FROM crm_target_sets').first();
 const preview=await post('mgr',body,200,'the sales manager previews');
 eq(preview.rows.map(r=>r.status),['new','new','refused'],'two new rows, customer service refused');eq((await app.db.prepare('SELECT COUNT(*) n FROM crm_target_sets').first()).n,before.n,'a preview writes nothing');
 const english=await post('mgr',{...body,language:'en'},200,'an English preview');ok(english.rows.every(r=>!/[؀-ۿ]/.test(r.message)),'the preview\'s words in English');
 const requestId=randomUUID();
 const saved=await post('mgr',{...body,action:'commit',requestId,planDigest:preview.planDigest},200,'the import');eq(saved.written,2,'two rows saved');
 const rep1=JSON.parse((await app.db.prepare("SELECT data FROM crm_target_sets WHERE kind='sales' AND scope_id='rep1' AND month=?").bind(MONTH).first()).data);eq(rep1.products[0].quantity,12,'Arabic digits read');
 eq((await app.db.prepare("SELECT COUNT(*) n FROM crm_audit WHERE record_id='record-import-targets'").first()).n,1,'one audit line for the import');
 eq((await app.db.prepare("SELECT COUNT(*) n FROM crm_audit WHERE id LIKE 'target-set:mgr:%'").first()).n,2,'and one history line for each set');
 const again=await post('mgr',{...body,action:'commit',requestId,planDigest:preview.planDigest},200,'the same request again');eq([again.alreadySaved,again.written],[true,2],'its first answer');
 const second=await post('mgr',body,200,'the same file again');eq(second.rows.map(r=>r.status),['unchanged','unchanged','refused'],'a second run changes nothing');
 await post('mgr',{...body,action:'commit',requestId:randomUUID(),planDigest:'0'.repeat(64)},409,'a plan that changed');
 // Follow-ups.
 const followups=rows=>({kind:'followups',action:'preview',fileName:'f.xlsx',base64:workbook('المتابعات',[FOLLOWUPS,...rows])});
 const f1=followups([[await code('c1'),'',TODAY,'اتصال','تحدثت مع العميل','زيارة',addDays(TODAY,2)],[await code('c2'),'rep2@yourrest.org',TODAY,'اتصال','تحدثت مع العميل','زيارة',addDays(TODAY,2)]]);
 await post(null,f1,401,'follow-ups without a session');await post('cs',f1,403,'customer service imports follow-ups');
 let fp=await post('rep1',f1,200,'the representative previews');eq(fp.rows.map(r=>r.status),['new','refused'],'their own customer; another member\'s refused');
 eq(fp.rows[1].message,'لا يمكنك تسجيل متابعة باسم عضو آخر.','a representative cannot record a follow-up for another member');
 const fr=await post('rep1',{...f1,action:'commit',requestId:randomUUID(),planDigest:fp.planDigest},200,'the representative imports');eq(fr.written,1,'one follow-up saved');
 const row=await app.db.prepare("SELECT data FROM crm_records WHERE parent_id='c1' AND json_extract(data,'$.visitWorkflow')='followup-v1'").first();ok(row&&JSON.parse(row.data).performedBy==='rep1','recorded as theirs');
 fp=await post('rep1',f1,200,'the same file again');eq(fp.rows[0].status,'duplicate','already imported');
 // The supervisor's file names each line's representative: rep1's row is the one already imported (the same follow-up), rep2's is new.
 const f2=followups([[await code('c1'),'rep1@yourrest.org',TODAY,'اتصال','تحدثت مع العميل','زيارة',addDays(TODAY,2)],[await code('c2'),'rep2@yourrest.org',TODAY,'اتصال','تحدثت مع العميل','زيارة',addDays(TODAY,2)]]);
 fp=await post('sup',f2,200,'the supervisor previews');eq(fp.rows.map(r=>r.status),['duplicate','new'],'rep1\'s follow-up already imported; the supervisor records for rep2');
 await post('sup',{...f2,action:'commit',requestId:randomUUID(),planDigest:fp.planDigest},200,'the supervisor imports');
 const sup=JSON.parse((await app.db.prepare("SELECT data FROM crm_records WHERE parent_id='c2' AND json_extract(data,'$.visitWorkflow')='followup-v1'").first()).data);eq([sup.performedBy,sup.importedBy],['rep2','sup'],'performed by rep2, imported by the supervisor');
 console.log(JSON.stringify({ok:true,checks}));
}finally{await app.stop();}

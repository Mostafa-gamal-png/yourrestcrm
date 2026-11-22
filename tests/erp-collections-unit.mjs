// «استيراد كشف التحصيل من ERP», unit by unit (the owner's unit-test plan, 2026-11-22), on the real modules compiled into .sites-runtime (so
// the coverage measure sees them), without a build:
// - lib/erp-collections.ts: an amount in whole halalas (Arabic-Indic and Persian digits, «٬» «٫», thousands commas, hidden marks of
//   direction, spaces, the third decimal rounded half up, the limit, every malformed or negative amount refused with its row), the
//   encodings (UTF-16LE/BE with a byte-order mark, UTF-8 with one, a broken file), the cells (numeric references, comments, an unknown
//   entity, decoded once), the headers (hamza and tatweel, the twenty first rows, sixty columns), the rows (an account twice after its
//   digits are read, a totals row in English, an overlong account number, 5000 accounts), the grouping and the rate.
// - lib/erp-collections-server.ts on an in-memory SQLite with every migration and the real context (lib/crm-server.ts): who may import
//   (a representative and a supervisor refused, a sales manager within their regions, the administrator), the configuration, the month
//   (a future month, a finished month for the manager and for the administrator, Riyadh's midnight with the clock fixed), the reading of
//   the request (base64, unknown fields), the names mapped (by full name, chosen here, from the ERP sales, from the previous import, out of
//   scope, unmapped, the office), the preview (statuses, warnings, totals, a digest), the commit (the digest, a replacement confirmed,
//   the evidence written with the history kept or cleared for a stale scope, the audit lines), the replay of the same request (same
//   answer, nothing written twice; another body refused), the same file again (nothing written), a change between the preview and the
//   commit (refused, nothing written), and «مبيعات مكتب (مستبعد)» chosen for a name (saved with the import, then read as saved).
// SYNTHETIC statements built here with the structure of the ERP's file; made-up names and amounts; no owner data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {zipSync,strToU8} from 'fflate';

// The clock is fixed (Riyadh is UTC+3): 2026-11-16 12:00 in Riyadh, month 2026-11.
const NativeDate=Date;let clock=NativeDate.parse('2026-11-16T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-collections-unit-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
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
const C=await load('lib/erp-collections.ts'),S=await load('lib/erp-collections-server.ts'),server=await load('lib/crm-server.ts'),O=await load('lib/erp-office-employees.ts'),EV=await load('lib/kpi-evidence.ts');
let checks=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};

// ======================================================================================== lib/erp-collections.ts
const cents=(value)=>C.collectionCents(value,'المبلغ',7);
eq([['',0],['-',0],['  ',0],['0',0],['1',100],['1.5',150],['1.50',150],['0.01',1],['1.004',100],['1.005',101],['1.0049',100],['1.995',200],['0.999',100],['9999999999.99',999999999999],['10000000000',1e12]].map(([v])=>cents(v)),[0,0,0,0,100,150,150,1,100,101,100,200,100,999999999999,1e12],'whole halalas: empty is zero, the third decimal rounds half up, up to the limit');
eq([cents('1,234,567.89'),cents('١٬٢٣٤٫٥٦'),cents('۱۲۳'),cents('‏1,000‎'),cents('1 000'),cents('1 000.5'),cents('١٢٣٫٤٥٦٧٨٩'.slice(0,8))],[123456789,123456,12300,100000,100000,100050,12346],'thousands commas, Arabic-Indic and Persian digits, «٬» «٫», marks of direction and spaces');
const refusedCents=(value,pattern)=>{assert.throws(()=>cents(value),e=>e instanceof C.CollectionStatementError&&pattern.test(e.message)&&e.message.startsWith('السطر 7: المبلغ'),'refused: '+JSON.stringify(value));checks++;};
for(const value of ['-5','-0.01','(5)','(1,000.00)','−5'.replace('−','-')])refusedCents(value,/قيمة سالبة/);
for(const value of ['abc','1,23','12,3456','1.1234567','+5','5-','1e3','0x10','1.2.3',',100','100,','1,000,00','٥ ريال','12.'])refusedCents(value,/ليس رقمًا صالحًا/);
for(const value of ['10000000000.01','12345678901234','99999999999999','1000000000000'])refusedCents(value,/يتجاوز الحد المسموح/);

const HEADERS=Object.values(C.COLLECTION_COLUMNS);
const html=(rows,{headers=HEADERS,title='كشف حساب  لـ 1 _ 9',before=[]}={})=>"<html><body><TABLE><TR><TD colspan='9'>"+title+'</TD></TR>'+before.map(r=>'<TR>'+r.map(v=>'<TD>'+v+'</TD>').join('')+'</TR>').join('')+'<TR>'+headers.map(h=>'<Th>'+h+'</Th>').join('')+'</TR>'+rows.map(r=>'<TR>'+r.map(v=>'<TD>'+v+'</TD>').join('')+'</TR>').join('')+'</TABLE></body></html>';
const utf8=(text,bom=false)=>new Uint8Array(Buffer.concat([bom?Buffer.from([0xef,0xbb,0xbf]):Buffer.alloc(0),Buffer.from(text,'utf8')]));
const utf16=(text,{be=false,bom=true}={})=>{const le=Buffer.from(text,'utf16le');if(be)for(let i=0;i<le.length;i+=2){const t=le[i];le[i]=le[i+1];le[i+1]=t;}return new Uint8Array(Buffer.concat([bom?Buffer.from(be?[0xfe,0xff]:[0xff,0xfe]):Buffer.alloc(0),le]));};
const row=(no,name,rep,collector,pd,pc,d,c,cd,cc)=>[no,name,rep,collector,pd,pc,d,c,cd,cc];
const base=[row('1101','مصنع ألف','مندوب ألف','','100','0','50','30','120','0'),row('1102','مصنع باء','مندوب باء','','0','40','100','100','0','40')];
const parsed=C.parseCollectionStatement(utf8(html(base)));
eq(parsed.title,'كشف حساب لـ 1 _ 9','the title, its spaces normalised');
eq(C.parseCollectionStatement(utf16(html(base),{be:true})).rows,parsed.rows,'UTF-16BE with its byte-order mark');
eq(C.parseCollectionStatement(utf8(html(base),true)).rows,parsed.rows,'UTF-8 with its byte-order mark');
eq(C.parseCollectionStatement(utf16(html(base))).rows,parsed.rows,'UTF-16LE with its byte-order mark');
const refuses=(bytes,pattern,message)=>{assert.throws(()=>C.parseCollectionStatement(bytes),e=>e instanceof C.CollectionStatementError&&pattern.test(e.message),message);checks++;};
refuses(new Uint8Array([0x3c,0x74,0xff,0xfe,0xc3,0x28]),/ترميز ملف كشف الحساب غير صالح/,'bytes that are not UTF-8: refused');
refuses(new Uint8Array([0xff,0xfe,0x3c,0x00,0x74]),/ترميز ملف كشف الحساب غير صالح/,'a UTF-16 file cut in the middle of a character: refused');
refuses(new Uint8Array(Buffer.from('<TABLE>')).buffer,/فارغ/,'an ArrayBuffer (not bytes): refused as empty');
refuses('<TABLE>',/فارغ/,'a string: refused as empty');
// Cells
const cell=value=>C.parseCollectionStatement(utf8(html([row('1',value,'م','','','','','','','')]))).rows[0].accountName;
eq([cell('&#1605;&#x635;&#X646;&#1593;'),cell('a<!-- تعليق -->b'),cell('&unknown; &AMP; &Lt;'),cell('&amp;lt;b&amp;gt;'),cell('x&#0;y&#xD800;z&#x110000;w'),cell('<font color=red>مصنع</font> <b>كبير</b>')],['مصنع','ab','&unknown; & <','&lt;b&gt;','xyzw','مصنع كبير'],'numeric references, comments, case-insensitive entities, decoded once; a null, a surrogate and a point beyond Unicode are dropped; inner markup removed');
eq(cell('&#x627;&#x200f;&#x644;'),'ال','a mark of direction made by a reference is removed too');
// Headers
const hamza=HEADERS.map(h=>h==='اسم الحساب'?'إسم الحساب':h==='الرصيد الحالي مدين'?'الرصيد الحالـي مدين':h==='رقم الحساب'?' رقم  الحساب ':h);
eq(C.parseCollectionStatement(utf8(html(base,{headers:hamza}))).rows,parsed.rows,'a header written with hamza, a tatweel or extra spaces is the same column');
eq(C.parseCollectionStatement(utf8(html(base,{before:Array.from({length:18},()=>['سطر'])}))).rows.length,2,'the header is found within the twenty first rows');
refuses(utf8(html(base,{before:Array.from({length:19},()=>['سطر'])})),/لم تُعثر على عناوين الأعمدة/,'a header after the twenty first rows is not looked for');
refuses(utf8(html([[...base[0],...Array.from({length:51},()=>'x')]])),/عدد أعمدة كشف الحساب/,'more than sixty cells in a row: refused');
eq(C.parseCollectionStatement(utf8(html(base,{title:'تقرير آخر'}))).title,'','a title that is not «كشف حساب»: none');
eq(C.parseCollectionStatement(utf8('<table><tr><th>'+HEADERS.join('<th>')+'<tr><td>'+base[0].join('<td>'))).rows.length,1,'lower-case tags, nothing closed, not even the table');
// Rows
refuses(utf8(html([base[0],row('١١٠١','نفسه','مندوب ألف','','0','0','0','0','0','0')])),/رقم الحساب مكرر في الكشف \(السطر 3\)/,'the same account written in Arabic-Indic digits is the same account');
eq(C.parseCollectionStatement(utf8(html([...base,row('','Grand Total','','','100','40','150','130','120','40'),row('','TOTAL of all','','','1','1','1','1','1','1'),row('','المجموع','','','1','1','1','1','1','1')]))).rows.length,2,'a totals row in English or Arabic is skipped');
refuses(utf8(html([row('','مصنع بلا رقم','مندوب','','1','0','0','0','1','0')])),/السطر 3: رقم الحساب مطلوب/,'a named account without its number: refused');
refuses(utf8(html([row('1'.repeat(101),'مصنع','مندوب','','0','0','0','0','0','0')])),/السطر 3: قيمة أطول من المسموح/,'an account number over 100 characters');
refuses(utf8(html([row('1','مصنع','م'.repeat(201),'','0','0','0','0','0','0')])),/قيمة أطول من المسموح/,'a representative over 200 characters');
refuses(utf8(html([row('1','مصنع','مندوب','','0','0','abc','0','0','0')])),/السطر 3: حركة الفترة مدين ليس رقمًا صالحًا/,'the column of the bad amount is named');
const many=Array.from({length:5000},(_,i)=>row(String(10000+i),'م'+i,'مندوب','','0','0','1','1','0','0'));
eq(C.parseCollectionStatement(utf8(html(many))).rows.length,5000,'5000 accounts are read');
refuses(utf8(html([...many,row('99999','زائد','مندوب','','0','0','1','1','0','0')])),/الحد الأقصى لكشف الحساب 5000 حساب/,'5001 accounts: refused');
// The .xlsx form: one sheet only
const sheetXml=rows=>'<worksheet><sheetData>'+rows.map(r=>'<row>'+r.map(v=>'<c t="inlineStr"><is><t>'+v+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>';
const xlsx=sheets=>zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types/>'),'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((s,i)=>'<sheet name="S'+i+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>'),'xl/_rels/workbook.xml.rels':strToU8('<Relationships>'+sheets.map((s,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'</Relationships>'),...Object.fromEntries(sheets.map((s,i)=>['xl/worksheets/sheet'+(i+1)+'.xml',strToU8(sheetXml(s))]))});
eq(C.parseCollectionStatement(xlsx([[HEADERS,...base]])).rows.map(r=>[r.accountNo,r.periodDebit]),[['1101',5000],['1102',10000]],'the .xlsx form');
refuses(xlsx([[HEADERS,...base],[HEADERS]]),/ورقة Excel واحدة/,'two sheets: refused');
// The rest of the reader's refusals and tolerances
eq(C.parseCollectionStatement(utf16(html(base),{bom:false})).rows,parsed.rows,'UTF-16LE without a byte-order mark (the ERP\'s «<» and a zero byte)');
refuses(utf8(html([row('1','x'.repeat(1001),'م','','0','0','0','0','0','0')])),/قيمة خلية في كشف الحساب أطول من المسموح/,'a cell over 1000 characters');
refuses(utf8('<TABLE><TR><TD><script>x</script></TD></TR></TABLE>'),/محتوى غير مسموح/,'a script in the file');
refuses(utf8('<TABLE>'+'<TR><TD>x</TD></TR>'.repeat(5011)+'</TABLE>'),/الحد الأقصى لكشف الحساب 5000 حساب/,'more rows than a statement can have: refused before they are read');
refuses(utf8(html(base,{headers:HEADERS.filter(h=>h!=='المحصل')})),/ينقصه عمود مطلوب: المحصل/,'a missing column is named');
refuses(utf8(html(base,{headers:[...HEADERS,'حركة الفترة مدين']})),/عمود مكرر في كشف الحساب: حركة الفترة مدين/,'a duplicated column');
refuses(new Uint8Array(C.COLLECTION_FILE_MAX_BYTES+1).fill(0x20),/2 ميجابايت/,'over 2 MB');
refuses(new Uint8Array([0x50,0x4b,0x03,0x04,1,2,3,4,5,6]),/./,'«PK» bytes that are not a workbook: the workbook reader\'s refusal, as the statement\'s');
eq(C.parseCollectionStatement(utf8(html([base[0],['','','','','','','','','',''],HEADERS,base[1]]))).rows.map(r=>r.accountNo),['1101','1102'],'an empty row and a header repeated on a printed page are skipped');
refuses(utf8(html([['','','','','','','','','','']])),/لا يحتوي حسابات قابلة للقراءة/,'nothing but empty rows: no account');
// Grouping and the rate
const acc=(no,rep,collector,[pd,pc,d,c,cd,cc])=>({rowNumber:Number(no),accountNo:no,accountName:'حساب '+no,rep,collector,previousDebit:pd,previousCredit:pc,periodDebit:d,periodCredit:c,currentDebit:cd,currentCredit:cc});
const accounts=[acc('1','Ahmed Ali','',[0,0,100,50,50,0]),acc('2','AHMED  ALI','',[0,0,100,100,0,0]),acc('3','‏مندوب ألف‎','',[0,0,10,0,10,0]),acc('4','','مندوب ألف',[0,500,100,0,0,400]),acc('5','مبيعات المكتب','',[0,0,7,7,0,0]),acc('6','مندوب ألف','',[0,0,10,0,5,0])];
const grouped=C.summarizeCollections(accounts);
eq(grouped.groups.map(g=>[g.key,g.name,g.accounts,g.dueCents,g.collectedCents,g.mismatches,g.fromCollector]),[['مندوب ألف','مندوب ألف',3,120,0,1,1],['ahmed ali','Ahmed Ali',2,200,150,0,0]],'names compare whole whatever their case, spaces and marks (the first spelling shown); the collector when there is no representative; a previous credit is not due; sorted in Arabic order');
eq([grouped.officeRows,grouped.officeDueCents,grouped.noRepRows,grouped.mismatchRows,grouped.rows],[1,7,0,1,6],'«مبيعات المكتب» is the office too');
eq([C.rowAddsUp(acc('7','x','',[0,50,100,0,50,0])),C.rowAddsUp(acc('8','x','',[10,0,0,30,0,20])),C.rowAddsUp(acc('9','x','',[10,0,0,30,0,21]))],[true,true,false],'a row adds up to the halala, credits on either side');
eq([C.collectionPercent(3,1),C.collectionPercent(3,2),C.collectionPercent(1,0),C.collectionPercent(0,5),C.collectionPercent(-5,5),C.collectionPercent(7,7)],[33.33,66.67,0,null,null,100],'the rate: two decimals; none when nothing (or less than nothing) is due');

// ======================================================================================== lib/erp-collections-server.ts
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null,batches=0;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const result=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{batches++;if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const member=(id,name,role,supervisor,scope='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@example.invalid',name,role,'الرئيسي',supervisor,scope,'2025-01-01');
member('admin','مدير النظام','admin','','all');member('manager','مدير المبيعات','manager','','eastern');member('sup','المشرف','supervisor','manager');
member('rep1','مندوب ألف','rep','sup');member('rep2','مندوب باء','rep','sup');member('rep3','أحمد الغربي','rep','sup','western');member('rep4','سعيد جيم','rep','sup');member('rep5','مندوب دال','rep','sup');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
const as=async id=>{globalThis.testIdentity=id;return server.context();};
const count=(table,where='1=1')=>sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE '+where).get().n;
const evidence=(id,month='2026-11')=>{const r=sql.prepare('SELECT * FROM crm_kpi_evidence WHERE member_id=? AND month=?').get(id,month);return r?{...r,input:JSON.parse(r.input)}:null;};
const refusal=async(promise,status,pattern,message)=>{let error;try{await promise;}catch(e){error=e;}ok(error instanceof server.CRMError&&error.status===status&&pattern.test(error.message),message+' ('+(error?.status??'none')+': '+(error?.message||'no error')+')');};
const b64=bytes=>Buffer.from(bytes).toString('base64');

// Who
await refusal(as('rep1').then(c=>S.importErpCollections(c,{})),403,/متاحة للمشرف ومدير المبيعات فقط/,'a representative: refused before the body is read');
await refusal(as('sup').then(c=>S.importErpCollections(c,{})),403,/لمدير النظام ومدير المبيعات فقط/,'a supervisor: refused');
await refusal(as('sup').then(c=>S.collectionImportConfiguration(c)),403,/لمدير النظام ومدير المبيعات فقط/,'and so is the configuration');
let cfg=await S.collectionImportConfiguration(await as('manager'));
eq([cfg.members.map(m=>m.id).sort(),cfg.currentMonth,cfg.admin,cfg.meaning],[['rep1','rep2','rep4','rep5'],'2026-11',false,S.COLLECTION_MEANING],'the sales manager: the representatives of their regions, the month in Riyadh');
cfg=await S.collectionImportConfiguration(await as('admin'));
eq([cfg.members.map(m=>m.id).sort(),cfg.admin],[['rep1','rep2','rep3','rep4','rep5'],true],'the administrator: every representative');

// The ERP sales already imported name «سعيد» as rep4's employee (a mapping by the ERP).
sql.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('erp-1','admin','f','sales.xlsx','{}','2026-11-01')").run();
sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES('s1','k1','h','m','INV-1','sale','2026-11-02','E-77','rep4','الرئيسي','eastern','C1','عميل',?,100,'erp-1','admin','2026-11-02')").run(JSON.stringify({employeeName:'سعيد',items:[]}));

const statementRows=[
 row('1101','مصنع ١','مندوب ألف','','1000','0','500','700','800','0'),// rep1 by name: due 1500, collected 700
 row('1102','مصنع ٢','‏مندوب  ألف','','0','200','300','50','50','0'),// rep1 again (spaces, a mark): due 300, collected 50
 row('1103','مصنع ٣','مندوب باء','','0','0','1,200.00','1200','0','0'),// rep2
 row('1104','مصنع ٤','أحمد الغربي','','0','0','100','100','0','0'),// rep3: another region
 row('1105','مصنع ٥','مجهول','','0','0','300','100','200','0'),// nobody of that name
 row('1106','مصنع ٦','مبيعات مكتب','','0','0','999','999','0','0'),// the office
 row('1107','مصنع ٧','','','50','0','0','0','50','0'),// nobody
 row('1108','مصنع ٨','سعيد','','0','0','100','0','90','0'),// rep4 from the ERP sales; does not add up
 row('1109','مصنع ٩','مندوب دال','','0','0','0','25','0','25'),// rep5: nothing due, something collected
];
const file=(rows=statementRows)=>b64(utf16(html(rows)));
const body=(extra={})=>({action:'preview',month:'2026-11',fileName:'Account_Balance_Sheet.xls',base64:file(),...extra});
let manager=await as('manager');
// Reading the request
await refusal(S.importErpCollections(manager,body({base64:'@@@@'})),400,/ترميز ملف كشف الحساب غير صحيح/,'base64 with other characters');
await refusal(S.importErpCollections(manager,body({base64:'QUJD='})),400,/ترميز ملف كشف الحساب غير صحيح/,'base64 whose length is not a multiple of four');
for(const extra of [{month:'2026-13'},{month:'2026-1'},{unknown:1},{fileName:'  '},{mappings:[{name:'x',repId:'rep1',extra:1}]},{planDigest:'ABC'},{requestId:'not-a-uuid'}]){
 let error;try{await S.importErpCollections(manager,body(extra));}catch(e){error=e;}ok(error&&!(error instanceof server.CRMError)&&error.name==='ZodError','refused by the request\'s schema: '+JSON.stringify(extra));
}
await refusal(S.importErpCollections(manager,body({base64:b64(utf8('<html>no table</html>'))})),400,/لا يحتوي جدولًا/,'a statement refusal becomes a 400 with its words');
// The month
await refusal(S.importErpCollections(manager,body({month:'2026-12'})),400,/شهر قادم/,'a month to come');
await refusal(S.importErpCollections(manager,body({month:'2026-10'})),403,new RegExp(S.COLLECTION_CLOSED_MESSAGE),'a finished month: the administrator\'s only');
clock=NativeDate.parse('2026-11-30T20:59:59.000Z');
eq((await S.importErpCollections(await as('manager'),body())).closedMonth,false,'23:59:59 of the month\'s last day in Riyadh: still open');
clock=NativeDate.parse('2026-11-30T21:00:00.000Z');
await refusal(S.importErpCollections(await as('manager'),body()),403,new RegExp(S.COLLECTION_CLOSED_MESSAGE),'midnight in Riyadh (21:00 UTC): the month has finished');
const adminLate=await S.importErpCollections(await as('admin'),body());
eq([adminLate.closedMonth,adminLate.reference],[true,'كشف حساب ERP · Account_Balance_Sheet.xls · 2026-12-01'],'the administrator may, and the reference carries Riyadh\'s day');
clock=NativeDate.parse('2026-11-16T09:00:00.000Z');
manager=await as('manager');

// The preview
const preview=await S.importErpCollections(manager,body());
const names=Object.fromEntries(preview.names.map(n=>[n.name,[n.status,n.repId,n.mappingSource,n.accounts,n.dueCents,n.collectedCents]]));
eq(names,{
 'مندوب ألف':['mapped','rep1','name',2,180000,75000],
 'مندوب باء':['mapped','rep2','name',1,120000,120000],
 'أحمد الغربي':['out_of_scope','','name',1,10000,10000],
 'مجهول':['unmapped','','none',1,30000,10000],
 'سعيد':['mapped','rep4','erp',1,10000,0],
 'مندوب دال':['mapped','rep5','name',1,0,2500],
},'each name: by its full name (spaces and marks ignored), from the ERP sales, out of the manager\'s regions, unmapped');
eq(preview.reps.map(r=>[r.repId,r.status,r.dueCents,r.collectedCents,r.percent,r.mismatches,r.current]),[
 ['rep4','new',10000,0,0,1,null],['rep1','new',180000,75000,41.67,0,null],['rep2','new',120000,120000,100,0,null],['rep5','invalid',0,2500,null,0,null]
],'a representative each, sorted by name in Arabic order: due, collected, the rate; nothing due but something collected is not a collection');
eq(preview.reps.find(r=>r.repId==='rep5').reason,'لا يوجد مبلغ مستحق والمحصل أكبر من صفر؛ لا يُعتمد كتحصيل','its reason');
eq(preview.summary,{rows:9,officeRows:1,noRepRows:1,mismatchRows:1,names:6,unmappedNames:1,outOfScopeNames:1,reps:4,newCount:3,replaceCount:0,unchangedCount:0,invalidCount:1,dueCents:310000,collectedCents:195000},'the totals: only what will be written is summed');
eq(preview.warnings,['حسابات «مبيعات مكتب» المستبعدة: 1','حسابات بلا مندوب ولا محصل لا تُنسب لأحد: 1','حسابات لا يساوي رصيدها الحالي الرصيد السابق مع حركة الفترة: 1','أسماء غير مربوطة بمندوب لن تُكتب: 1','أسماء مربوطة بمندوب خارج نطاق فريقك أو منطقتك لن تُكتب: 1'],'the warnings, each counted');
ok(/^[a-f0-9]{64}$/.test(preview.planDigest)&&preview.reference==='كشف حساب ERP · Account_Balance_Sheet.xls · 2026-11-16','a digest of the plan and the reference with the day');
eq([count('crm_kpi_evidence'),count('crm_audit')],[0,0],'a preview writes nothing');
const again=await S.importErpCollections(manager,body());
eq(again.planDigest,preview.planDigest,'the same file previewed again: the same digest');
// Mappings chosen
await refusal(S.importErpCollections(manager,body({mappings:[{name:'مجهول',repId:'rep3'}]})),403,/خارج نطاق فريقك أو منطقتك/,'a name mapped to a representative of another region: refused');
await refusal(S.importErpCollections(manager,body({mappings:[{name:'مجهول',repId:'rep1'},{name:' مجهول ',repId:'rep2'}]})),400,/تكرار في اختيارات الربط/,'the same name mapped twice to two people');
const chosen=await S.importErpCollections(manager,body({mappings:[{name:'مجهول',repId:'rep1'},{name:'مجهول',repId:'rep1'},{name:'ليس في الكشف',repId:'rep3'}]}));
eq((({status,mappingSource})=>[status,mappingSource])(chosen.names.find(n=>n.name==='مجهول')),['mapped','selected'],'chosen here (the same choice twice is one; a name not in the statement is ignored, whoever it names)');
eq(chosen.reps.find(r=>r.repId==='rep1').names,['مجهول','مندوب ألف'],'its accounts join that representative');
ok(chosen.planDigest!==preview.planDigest,'and the plan, so the digest, differs');

// The commit
const requestId=crypto.randomUUID();
await refusal(S.importErpCollections(manager,body({action:'commit'})),400,/اعرض الملف أولًا/,'a commit without a request id or a digest');
await refusal(S.importErpCollections(manager,body({action:'commit',requestId,planDigest:'0'.repeat(64)})),409,/اعرض الملف مرة أخرى/,'a commit of another plan');
const committed=await S.importErpCollections(manager,body({action:'commit',requestId,planDigest:preview.planDigest}));
eq(committed,{ok:true,month:'2026-11',writtenCount:3,newCount:3,replaceCount:0,unchangedCount:0,invalidCount:1,skippedNames:2,officeRows:1,mismatchRows:1,closedMonth:false},'committed: three representatives written');
eq(['rep1','rep2','rep4','rep5'].map(id=>evidence(id)?.input.collection??null),[{dueCents:180000,collectedCents:75000,reference:preview.reference},{dueCents:120000,collectedCents:120000,reference:preview.reference},{dueCents:10000,collectedCents:0,reference:preview.reference},null],'each one\'s collection, nothing for the invalid one');
eq([evidence('rep1').version,evidence('rep1').updated_by,evidence('rep1').scope_key,evidence('rep1').cutoff],[1,'manager',EV.evidenceScopeKey(manager.members.find(m=>m.id==='rep1')),'2026-11-16'],'its version, who, its scope and the cut-off day');
eq(sql.prepare("SELECT revision FROM crm_kpi_evidence_state WHERE id='company'").get().revision,1,'the evidence revision moved once');
const importLine=sql.prepare("SELECT * FROM crm_audit WHERE record_id='kpi-collection-import'").get(),detail=JSON.parse(importLine.detail);
eq([importLine.id,importLine.action,importLine.actor,detail.fileName,detail.month,detail.reps.map(r=>r.memberId),detail.mappings.map(m=>[m.name,m.repId,m.source])],['kpi-collection-import:manager:'+requestId,S.COLLECTION_IMPORT_ACTION,'مدير المبيعات','Account_Balance_Sheet.xls','2026-11',['rep4','rep1','rep2'],[['سعيد','rep4','erp'],['مندوب ألف','rep1','name'],['مندوب باء','rep2','name'],['مندوب دال','rep5','name']]],'one import line: the file, the month, the representatives written, the names mapped and how');
ok(/^[a-f0-9]{64}$/.test(detail.fileSha256)&&/^[a-f0-9]{64}$/.test(detail.fingerprint),'with the file\'s hash and the request\'s fingerprint');
eq(sql.prepare("SELECT record_id FROM crm_audit WHERE record_id LIKE 'kpi-evidence-%' ORDER BY record_id").all().map(r=>r.record_id),['kpi-evidence-rep1','kpi-evidence-rep2','kpi-evidence-rep4'],'and each representative\'s own history line');
// The replay
const auditBefore=count('crm_audit'),batchesBefore=batches;
eq(await S.importErpCollections(manager,body({action:'commit',requestId,planDigest:preview.planDigest})),{...committed,alreadySaved:true},'the same request again: the first answer');
eq([count('crm_audit'),batches,evidence('rep1').version],[auditBefore,batchesBefore,1],'and nothing written twice');
await refusal(S.importErpCollections(manager,body({action:'commit',requestId,planDigest:preview.planDigest,replaceConfirmed:true})),409,/تم حفظ الطلب ببيانات مختلفة/,'the same request id with another body: refused');
await refusal(S.importErpCollections(await as('admin'),body({action:'commit',requestId,planDigest:preview.planDigest})).then(r=>{if(r.alreadySaved)throw new Error('replayed for another person');return r;}),409,/./,'another person\'s request id is not their receipt');
// The same file again
const same=await S.importErpCollections(manager,body());
eq(same.reps.map(r=>[r.repId,r.status,r.reason]),[['rep4','unchanged','القيمة نفسها محفوظة؛ لن تتغير'],['rep1','unchanged','القيمة نفسها محفوظة؛ لن تتغير'],['rep2','unchanged','القيمة نفسها محفوظة؛ لن تتغير'],['rep5','invalid',preview.reps.find(r=>r.repId==='rep5').reason]],'the same file again: every representative unchanged');
const auditAfter=count('crm_audit');
eq(await S.importErpCollections(manager,body({action:'commit',requestId:crypto.randomUUID(),planDigest:same.planDigest})),{ok:true,month:'2026-11',writtenCount:0,newCount:0,replaceCount:0,unchangedCount:3,invalidCount:1,skippedNames:2,officeRows:1,mismatchRows:1,closedMonth:false},'its commit writes nothing');
eq(count('crm_audit'),auditAfter,'not even an audit line');
// A replacement: rep1 collected more; another account of rep2 now due
const changed=statementRows.map(r=>r[0]==='1101'?row('1101','مصنع ١','مندوب ألف','','1000','0','500','900','600','0'):r);
const replace=await S.importErpCollections(manager,body({base64:file(changed)}));
eq(replace.reps.filter(r=>r.repId==='rep1').map(r=>[r.status,r.reason,r.current,r.collectedCents]),[['replace','سيستبدل القيمة الحالية',{dueCents:180000,collectedCents:75000,reference:preview.reference},95000]],'a value already saved: to replace, with what is there now');
await refusal(S.importErpCollections(manager,body({base64:file(changed),action:'commit',requestId:crypto.randomUUID(),planDigest:replace.planDigest})),409,/أكّد استبدال قيم التحصيل المحفوظة/,'a replacement must be confirmed');
// A change between the preview and the commit (an ERP sales import landed): the commit's gate refuses it and nothing is written.
race=()=>{sql.prepare("UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries'").run();};
const raceAudit=count('crm_audit');
await refusal(S.importErpCollections(manager,body({base64:file(changed),action:'commit',requestId:crypto.randomUUID(),planDigest:replace.planDigest,replaceConfirmed:true})),409,/تغيّرت بيانات المؤشرات أو الصلاحيات أثناء الاعتماد/,'the ERP sales changed while the commit was on its way: refused');
eq(count('crm_audit'),raceAudit,'no audit line either');
eq([evidence('rep1').version,evidence('rep1').input.collection.collectedCents],[1,75000],'nothing written');
manager=await as('manager');
const fresh=await S.importErpCollections(manager,body({base64:file(changed)}));
const replaced=await S.importErpCollections(manager,body({base64:file(changed),action:'commit',requestId:crypto.randomUUID(),planDigest:fresh.planDigest,replaceConfirmed:true}));
eq([replaced.replaceCount,replaced.writtenCount,evidence('rep1').version,evidence('rep1').input.collection.collectedCents],[1,1,2,95000],'confirmed: the one replaced, its version moved');
const line=JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE record_id='kpi-evidence-rep1' ORDER BY created_at DESC,rowid DESC").get().detail);
eq([line.before.collectedCents,line.after.collectedCents],[75000,95000],'its history line: before and after');
// The previous import's choice is suggested next time
await S.importErpCollections(manager,body({action:'commit',requestId:crypto.randomUUID(),planDigest:(await S.importErpCollections(manager,body({base64:file(changed),mappings:[{name:'مجهول',repId:'rep5'}]}))).planDigest,base64:file(changed),mappings:[{name:'مجهول',repId:'rep5'}]}));
const suggested=await S.importErpCollections(manager,body({base64:file(changed)}));
eq((({status,repId,mappingSource})=>[status,repId,mappingSource])(suggested.names.find(n=>n.name==='مجهول')),['mapped','rep5','previous'],'a name chosen in an earlier import: suggested from it');
eq(evidence('rep5').input.collection,{dueCents:30000,collectedCents:12500,reference:suggested.reference},'and «مجهول»\'s accounts made rep5\'s collection valid');

// A stale reporting scope: the history and quotations confirmations made for another scope are cleared, the collection written
const stale={...EV.emptyKpiEvidenceInput(),history:{complete:true,reference:'مؤكد'},quotationsComplete:true};
sql.prepare("INSERT INTO crm_kpi_evidence(member_id,month,input,version,mutation_id,updated_by,updated_at,sales_revision,scope_key,cutoff) VALUES('rep2','2026-10',?,1,'m','admin','2026-10-31','0','[\"old scope\"]','2026-10-31')").run(JSON.stringify(stale));
sql.prepare("INSERT INTO crm_kpi_evidence(member_id,month,input,version,mutation_id,updated_by,updated_at,sales_revision,scope_key,cutoff) VALUES('rep1','2026-10',?,1,'m','admin','2026-10-31','0',?,'2026-10-31')").run(JSON.stringify(stale),EV.evidenceScopeKey(manager.members.find(m=>m.id==='rep1')));
const admin=await as('admin'),october=await S.importErpCollections(admin,body({month:'2026-10'}));
eq([october.closedMonth,october.reps.find(r=>r.repId==='rep3').status],[true,'new'],'the administrator imports a finished month, every representative in reach');
const octoberDone=await S.importErpCollections(admin,body({month:'2026-10',action:'commit',requestId:crypto.randomUUID(),planDigest:october.planDigest}));
eq(octoberDone.closedMonth,true,'and the answer says so');
eq([evidence('rep2','2026-10').input.history,evidence('rep2','2026-10').input.quotationsComplete,evidence('rep2','2026-10').input.collection.dueCents],[{complete:false,reference:'مؤكد'},false,120000],'another scope\'s confirmations are cleared (they counted for nothing), the collection written');
eq([evidence('rep1','2026-10').input.history.complete,evidence('rep1','2026-10').input.quotationsComplete],[true,true],'the member\'s own scope: the confirmations are kept');
ok(JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE record_id='kpi-collection-import' ORDER BY created_at DESC,rowid DESC").get().detail).closedMonth,'the import line of a finished month says so');

// The size limit of the request, an unreadable earlier import line, an ERP mapping by employee number, an amount over the limit
await refusal(S.importErpCollections(manager,body({base64:'A'.repeat(Math.ceil(C.COLLECTION_FILE_MAX_BYTES/3)*4)})),413,/2 ميجابايت/,'one byte over 2 MB once decoded: 413');
sql.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('broken-line','kpi-collection-import','x','x','not json','2026-11-16T09:00:00.000Z')").run();
sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES('s2','k2','h','m','INV-2','sale','2026-11-03','E-55','rep1','الرئيسي','eastern','C1','عميل',?,100,'erp-1','admin','2026-11-03')").run(JSON.stringify({employeeName:'خالد',items:[]}));
sql.prepare("INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) VALUES('E-55','rep1','admin','2026-11-03')").run();
const big=[row('2001','كبير ١','خالد','','0','0','9999999999.99','0','9999999999.99','0'),row('2002','كبير ٢','خالد','','0','0','9999999999.99','0','9999999999.99','0')];
const extra=await S.importErpCollections(manager,body({base64:file([...changed,...big])}));
eq((({status,repId,mappingSource})=>[status,repId,mappingSource])(extra.names.find(n=>n.name==='خالد')),['mapped','rep1','erp'],'a name of the ERP sales whose employee number is mapped: that representative (an unreadable earlier line suggests nothing)');
eq((({status,reason})=>[status,reason])(extra.reps.find(r=>r.repId==='rep1')),['invalid','المبلغ يتجاوز الحد المسموح'],'two accounts that together pass the limit: not written');
// A database that fails while saving: the error, and nothing written
const changed2=changed.map(r=>r[0]==='1101'?row('1101','مصنع ١','مندوب ألف','','1000','0','500','960','540','0'):r);
const lostPreview=await S.importErpCollections(manager,body({base64:file(changed2)}));
race=()=>{throw new Error('the connection was lost');};
let lost;try{await S.importErpCollections(manager,body({base64:file(changed2),action:'commit',requestId:crypto.randomUUID(),planDigest:lostPreview.planDigest,replaceConfirmed:true}));}catch(e){lost=e;}
eq([lost?.message,evidence('rep1').version],['the connection was lost',2],'the failure is thrown as it is (no answer of a request never saved), nothing written');

// «مبيعات مكتب (مستبعد)» chosen for a name
const OFFICE=O.ERP_OFFICE_CHOICE,officeRow=()=>sql.prepare("SELECT owner_id FROM crm_settings WHERE id=?").get(O.ERP_OFFICE_SETTING)?.owner_id??null;
await refusal(S.importErpCollections(manager,body({base64:file(changed),mappings:[{name:'أحمد الغربي',repId:OFFICE}]})),403,/خارج نطاق فريقك أو منطقتك/,'marking a name that belongs to a representative out of the manager\'s regions: refused, as remapping it would be');
const markPreview=await S.importErpCollections(manager,body({base64:file(changed),mappings:[{name:'مجهول',repId:OFFICE}]}));
eq((({status,officeSource,repId})=>[status,officeSource,repId])(markPreview.names.find(n=>n.name==='مجهول')),['office','selected',OFFICE],'a name marked office here: listed as office, chosen in this preview');
eq([markPreview.summary.officeRows,markPreview.summary.officeChanges,markPreview.summary.officeNames,markPreview.warnings.includes('أسماء محددة «مبيعات مكتب (مستبعد)»: 1')],[2,1,1,true],'counted with the office, said in the notes');
eq(markPreview.reps.find(r=>r.repId==='rep5').status,'invalid','its accounts no longer count for the representative it was mapped to');
eq(officeRow(),null,'a preview saves no mark');
const marked=await S.importErpCollections(manager,body({base64:file(changed),mappings:[{name:'مجهول',repId:OFFICE}],action:'commit',requestId:crypto.randomUUID(),planDigest:markPreview.planDigest}));
eq([marked.writtenCount,marked.officeMarked,marked.officeUnmarked],[0,1,0],'only the mark changes: saved, no evidence written');
eq(O.parseOfficeList(officeRow()).employees.map(e=>[e.employeeId,e.employeeName,e.by]),[['','مجهول','manager']],'the mark: by name, who');
eq(count('crm_audit',"record_id='"+O.ERP_OFFICE_SETTING+"'"),1,'with its audit line');
eq(evidence('rep5').input.collection.collectedCents,12500,'and the saved evidence is not touched');
const afterMark=await S.importErpCollections(manager,body({base64:file(changed)}));
eq((({status,officeSource})=>[status,officeSource])(afterMark.names.find(n=>n.name==='مجهول')),['office','saved'],'read as saved next time');
// Mapped back to a representative here (a mark by name only)
const unmarkPreview=await S.importErpCollections(manager,body({base64:file(changed),mappings:[{name:'مجهول',repId:'rep5'}]}));
eq([unmarkPreview.names.find(n=>n.name==='مجهول').status,unmarkPreview.summary.officeChanges,unmarkPreview.reps.find(r=>r.repId==='rep5').status],['mapped',1,'unchanged'],'mapped back: its accounts are rep5\'s again, as saved');
const unmarked=await S.importErpCollections(manager,body({base64:file(changed),mappings:[{name:'مجهول',repId:'rep5'}],action:'commit',requestId:crypto.randomUUID(),planDigest:unmarkPreview.planDigest}));
eq([unmarked.writtenCount,unmarked.officeMarked,unmarked.officeUnmarked,O.parseOfficeList(officeRow()).employees],[0,0,1,[]],'the mark lifted, nothing else written');
// A mark changed between the preview and the commit: refused
const markAgain=await S.importErpCollections(manager,body({base64:file(changed),mappings:[{name:'مجهول',repId:OFFICE}]}));
race=()=>{sql.prepare("UPDATE crm_settings SET owner_id=? WHERE id=?").run(O.serializeOfficeList({employees:[{employeeId:'',employeeName:'آخر',by:'admin',at:'t'}]}),O.ERP_OFFICE_SETTING);};
await refusal(S.importErpCollections(manager,body({base64:file(changed),mappings:[{name:'مجهول',repId:OFFICE}],action:'commit',requestId:crypto.randomUUID(),planDigest:markAgain.planDigest})),409,/تغيّرت بيانات المؤشرات أو الصلاحيات أثناء الاعتماد/,'the marks changed after the preview: refused');
eq(O.parseOfficeList(officeRow()).employees.map(e=>e.employeeName),['آخر'],'and the other change is kept as it is');
// A mark saved together with evidence written: one transaction
const both=changed.map(r=>r[0]==='1103'?row('1103','مصنع ٣','مندوب باء','','0','0','1,300.00','1300','0','0'):r);
const bothPreview=await S.importErpCollections(manager,body({base64:file(both),mappings:[{name:'مجهول',repId:OFFICE}]}));
const bothDone=await S.importErpCollections(manager,body({base64:file(both),mappings:[{name:'مجهول',repId:OFFICE}],action:'commit',requestId:crypto.randomUUID(),planDigest:bothPreview.planDigest,replaceConfirmed:true}));
eq([bothDone.writtenCount,bothDone.officeMarked,evidence('rep2').input.collection.collectedCents,O.parseOfficeList(officeRow()).employees.map(e=>e.employeeName).sort()],[1,1,130000,['آخر','مجهول'].sort()],'the mark and rep2\'s new collection saved together');
// A name marked by employee number in the ERP sales import is changed there only
const list=O.applyOfficeChanges(O.parseOfficeList(officeRow()),{markIds:[{employeeId:'E-77',employeeName:'سعيد'}]},'admin','2026-11-16');
sql.prepare("UPDATE crm_settings SET owner_id=? WHERE id=?").run(O.serializeOfficeList(list),O.ERP_OFFICE_SETTING);
await refusal(S.importErpCollections(manager,body({base64:file(changed),mappings:[{name:'سعيد',repId:'rep4'}]})),409,new RegExp(S.COLLECTION_OFFICE_ELSEWHERE.slice(0,20)),'a name marked by number in the ERP sales import cannot be mapped here');
eq((({status,officeSource})=>[status,officeSource])((await S.importErpCollections(manager,body({base64:file(changed)}))).names.find(n=>n.name==='سعيد')),['office','sales'],'and is shown as marked there');

console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));

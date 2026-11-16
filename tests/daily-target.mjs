// «مبيعات اليوم قصاد مستهدف اليوم» (the owner, 2026-11-16, item 8 of the GSCO comparison list; lib/daily-target.ts) without a build:
// 1. The rule: Riyadh days at a month's edges, months of 28, 29, 30 and 31 days, Fridays the weekly day off, the day's share as GSCO divides
//    it (the month's target over the month's working days: lib/crm/shared.ts reportRows `dailyTarget`), a zero and an unknown target, the
//    day the card opens on (today, the last day of an ended month, the first of one not begun), the day sold (confirmed, of these people,
//    returns deducted), the rows and their percentages, team targets added up.
// 2. The representative's own page (GET /api/targets, compiled as the build does, on a migrated in-memory SQLite): the quantities sold each
//    day of the month (their own CRM and ERP sales, returns deducted, another representative's never), nothing for a month not begun, only
//    quantities (no invoice, customer or price), 401 and 403 as before.
// 3. The page's panel drawn by React in Arabic and English (the hub card and «أهدافي»), no Arabic left in English but product-free names.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

// The clock is fixed (a Monday, 16 November 2026, 12:00 in Riyadh): no check depends on the day the test runs.
const NativeDate=Date,clock=NativeDate.parse('2026-11-16T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'daily-target-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email,provider:'email-otp'};}`);
fs.writeFileSync(path.join(out,'stub.css.mjs'),'export default {};');
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/^import ['"][^'"]+\.css['"];?$/gm,'');
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const file of ['lib/daily-target.ts','app/api/targets/route.ts','lib/crm.ts','lib/targets.ts','lib/i18n.ts','app/today-sales.tsx'])compile(file);
const load=file=>import(pathToFileURL(path.join(out,file)));
const D=await load('lib/daily-target.mjs'),{today}=await load('lib/crm.mjs'),{targetProducts}=await load('lib/targets.mjs');
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const counts={};const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};

// ---- 1. The rule.
await counted('rule',async()=>{
 eq([D.riyadhDay('2025-01-31T20:59:59.000Z'),D.riyadhDay('2025-01-31T21:00:00.000Z'),D.riyadhDay('2025-12-31T21:30:00.000Z'),D.riyadhDay('2026-11-16T00:00:00.000Z')],['2025-01-31','2025-02-01','2026-01-01','2026-11-16'],'Riyadh days: 21:00 UTC is midnight in Riyadh, a month and a year turn there');
 eq([D.monthDays('2025-02').length,D.monthDays('2024-02').length,D.monthDays('2026-04').length,D.monthDays('2026-01').length,D.monthDays('2026-13').length],[28,29,30,31,0],'28, 29, 30 and 31 days; not a month: none');
 eq([D.monthDays('2026-11')[0],D.monthDays('2026-11').at(-1)],['2026-11-01','2026-11-30'],'first and last day');
 eq(['2026-11-20','2026-11-21','2026-11-19','2026-11-22'].map(D.isWorkingDay),[false,true,true,true],'Friday 20 November 2026 is the day off; Saturday, Thursday and Sunday work');
 eq([D.workingDaysOf('2026-11'),D.workingDaysOf('2025-02'),D.workingDaysOf('2024-02'),D.workingDaysOf('2026-01'),D.workingDaysOf('2026-04')],[26,24,25,26,26],'working days: November 2026 has four Fridays (26), February 2025 four (24), February 2024 four of 29 (25), January 2026 five of 31 (26), April 2026 four of 30 (26)');
 // GSCO: dailyTarget = target / workingDays(month, weekend). The same numbers here.
 const gsco=(target,month)=>target/D.workingDaysOf(month);
 eq(D.dailyTargetShare(260,'2026-11-16'),10,'260 over 26 working days: 10 a day');eq(D.dailyTargetShare(100,'2026-11-16'),Math.round(gsco(100,'2026-11')*1e6)/1e6,'as GSCO divides it (3.846154)');
 eq([D.dailyTargetShare(260,'2026-11-20'),D.dailyTargetShare(0,'2026-11-16'),D.dailyTargetShare(null,'2026-11-16'),D.dailyTargetShare(undefined,'2026-11-16'),D.dailyTargetShare(260,'2026-11-31'),D.dailyTargetShare(Number.NaN,'2026-11-16')],[0,0,null,null,null,null],'Friday: zero; a zero target: zero; unknown: unknown; not a day: unknown');
 eq([D.dailyTargetShare(24,'2025-02-01'),D.dailyTargetShare(24,'2025-02-28')],[1,0],'the first day of February 2025 and its last (a Friday)');
 eq([D.calendarDay('٢٠٢٦-١١-١٦'),D.calendarDay('۲۰۲۶-۱۱-۱۶'),D.calendarDay(' 2026-11-16 '),D.calendarDay('2026-02-30'),D.calendarDay('16/11/2026'),D.calendarDay(20261116)],['2026-11-16','2026-11-16','2026-11-16','','',''],'a calendar day: Arabic and Persian digits, spaces; impossible or another order: none');
 eq([D.defaultReportDay('2026-11','2026-11-16'),D.defaultReportDay('2026-10','2026-11-16'),D.defaultReportDay('2026-12','2026-11-16'),D.defaultReportDay('2026-11','2026-11-01'),D.defaultReportDay('2026-11','2026-11-30')],['2026-11-16','2026-10-31','2026-12-01','2026-11-01','2026-11-30'],'the day the card opens on: today, an ended month\'s last day, a coming month\'s first, today on the first and last day');
 eq([D.reportDayAllowed('2026-11','2026-11-16','2026-11-16'),D.reportDayAllowed('2026-11','2026-11-17','2026-11-16'),D.reportDayAllowed('2026-11','2026-10-31','2026-11-16'),D.reportDayAllowed('2026-11','٢٠٢٦-١١-١٥','2026-11-16')],[true,false,false,false],'a day may be picked inside the month up to today (the field gives Latin digits)');
 const p=targetProducts.map(x=>x.id);
 const sales=[
  {repId:'a',status:'confirmed',date:'2026-11-16',items:[{product:p[0],quantity:3},{product:p[1],quantity:1}]},
  {repId:'a',status:'confirmed',date:'2026-11-16',items:[{product:p[0],quantity:-1}]},// a return
  {repId:'a',status:'void',date:'2026-11-16',items:[{product:p[0],quantity:50}]},
  {repId:'a',status:'confirmed',date:'2026-11-15',items:[{product:p[0],quantity:7}]},
  {repId:'b',status:'confirmed',date:'2026-11-16',items:[{product:p[0],quantity:4}]},
  {repId:'c',status:'confirmed',date:'2026-11-16',items:[{product:p[0],quantity:100}]},
 ];
 let sold=D.daySold(sales,new Set(['a','b']),'2026-11-16');
 eq([sold.quantities.get(p[0]),sold.quantities.get(p[1]),sold.documents],[6,1,3],'the day sold by a and b: a return deducted, a void sale and another day and person left out');
 sold=D.daySold(sales,new Set(['a']),'2026-11-14');eq([sold.quantities.size,sold.documents],[0,0],'a day without documents');
 const targets=D.addTargets([[{product:p[0],quantity:130},{product:p[1],quantity:null}],[{product:p[0],quantity:130}],undefined],p);
 eq([targets.get(p[0]),targets.get(p[1]),targets.get(p[2])],[260,null,null],'targets added up; a product nobody has a number for stays unknown');
 const rows=D.dayRows(targetProducts,targets,D.daySold(sales,new Set(['a','b']),'2026-11-16').quantities,'2026-11-16');
 eq([rows[0].sold,rows[0].dayTarget,rows[0].achievement,rows[1].dayTarget,rows[1].achievement,rows[0].unit],[6,10,60,null,null,targetProducts[0].unit],'6 of a day\'s 10: 60%; a product without a target: no percentage');
 eq(D.dayRows(targetProducts,targets,new Map(),'2026-11-20')[0].achievement,null,'a Friday: no percentage');
});

// ---- 2. The representative's own page.
await counted('own page',async()=>{
 const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
 globalThis.testEnv={DB:{prepare:q=>new Statement(q)},YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
 const stamp='2025-01-01T00:00:00.000Z',member=(id,role,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',null,region,stamp);
 member('owner','admin','all');member('rep1','rep');member('rep2','rep');member('mgr','manager','all');
 sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
 const p=targetProducts.map(x=>x.id),day=today(),month=day.slice(0,7),first=month+'-01';
 sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run('c1','customer',null,'rep1','الرئيسي',JSON.stringify({name:'مصنع',region:'الشرقية'}),stamp,stamp);
 sql.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('erp-import-x','owner','fp-x','synthetic.xlsx','{}',?)").run(stamp);
 let n=0;const sale=(rep,date,items,status='confirmed')=>{n++;sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'',1,?,?,?,?,?)").run('s'+n,'c1',rep,'الرئيسي',date,'REF-'+n,'ref-'+n,JSON.stringify({items:items.map(([product,quantity])=>({product,quantity,unitPrice:10,description:''})),discount:0}),1000,status,'m'+n,'f'+n,'owner',stamp,stamp);};
 const erp=(rep,date,items,type='sale')=>{n++;sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,?,?,'E',?,'الرئيسي','eastern','K','عميل',?,1000,'erp-import-x','owner',?)").run('e'+n,'d'+n,'INV-'+n,type,date,rep,JSON.stringify({items:items.map(([product,quantity])=>({product,quantity,unitPrice:10})),discount:0}),stamp);};
 sale('rep1',day,[[p[0],2],[p[1],1]]);erp('rep1',day,[[p[0],3]]);erp('rep1',day,[[p[0],-1]],'return');sale('rep1',day,[[p[0],40]],'void');sale('rep1',first,[[p[2],5]]);sale('rep2',day,[[p[0],99]]);erp('rep2',day,[[p[0],77]]);
 const api=await load('app/api/targets/route.mjs');
 const get=async(who,query,status=200)=>{globalThis.testIdentity=who;const response=await api.GET(new Request('https://test.invalid/api/targets'+query));const data=await response.json();eq(response.status,status,who+' '+query+': '+JSON.stringify(data).slice(0,200));return data;};
 const page=await get('rep1','?month='+month);
 eq(page.sales.soldByDay[day][p[0]],4,'today: 2 (CRM) + 3 (ERP) − 1 (ERP return); the void sale and rep2\'s sales left out');
 eq(page.sales.soldByDay[day][p[1]],1,'another product of the same day');
 if(first!==day)eq(page.sales.soldByDay[first],{[p[2]]:5},'the first of the month');
 eq(Object.keys(page.sales).sort(),['actualsAvailable','products','soldByDay','sourceMonth'],'quantities only beside the products: no invoice, customer or price');
 ok(Object.values(page.sales.soldByDay).every(entry=>Object.values(entry).every(v=>typeof v==='number')),'numbers only');
 eq((await get('rep2','?month='+month)).sales.soldByDay[day][p[0]],176,'rep2 sees their own');
 const next=month.slice(5)==='12'?(Number(month.slice(0,4))+1)+'-01':month.slice(0,5)+String(Number(month.slice(5))+1).padStart(2,'0');
 eq((await get('rep1','?month='+next)).sales.soldByDay,undefined,'a month not begun: no days');
 await get(null,'?month='+month,401);await get('mgr','?month='+month,403);await get('rep1','?month='+month+'&memberId=rep2',400);
});

// ---- 3. The panel drawn in Arabic and English.
await counted('panel',async()=>{
 const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const i18n=await load('lib/i18n.mjs'),{DaySalesPanel}=await load('app/today-sales.mjs');
 const p=targetProducts.map(x=>x.id),day=today(),month=day.slice(0,7);
 const targets=new Map(p.map((id,i)=>[id,i===0?D.workingDaysOf(month)*10:i===1?0:null]));
 const props={month,targets,headingId:'h',scope:'الفريق بالكامل',soldOn:date=>({quantities:new Map(date===day?[[p[0],15]]:[]),documents:date===day?2:0})};
 let html=renderToStaticMarkup(React.createElement(DaySalesPanel,props));
 ok(html.includes('مبيعات اليوم قصاد مستهدف اليوم')&&html.includes('مستهدف اليوم')&&html.includes('مبيعات اليوم'),'the Arabic panel');
 ok(html.includes('data-day-sales="'+day+'"'),'opens on today');
 if(D.isWorkingDay(day)){ok(html.includes('>15<')&&html.includes('>10<')&&html.includes('150%'),'15 sold against 10: 150%');}
 else ok(html.includes('الجمعة يوم الإجازة الأسبوعية'),'today is a Friday: the day off');
 ok(html.includes('غير محدد'),'a product without a target');
 html=renderToStaticMarkup(React.createElement(DaySalesPanel,{...props,soldOn:()=>({quantities:new Map(),documents:0})}));
 ok(html.includes('لا توجد مبيعات مسجلة في هذا اليوم بعد'),'no sales on the day: said so');
 // The words the panel takes from the dictionary (the rest are written in both languages beside each other in the component).
 i18n.installEnglish(JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8')));
 const ARABIC=/[\u0600-\u06ff]/;
 for(const text of ['غير محدد',...targetProducts.map(x=>x.name),...targetProducts.map(x=>x.unit)])ok(!ARABIC.test(i18n.translateText(text,'en')),'English for «'+text+'»: '+i18n.translateText(text,'en'));
});

console.log(JSON.stringify({ok:true,checks,parts:counts}));

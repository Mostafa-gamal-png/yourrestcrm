// «تصدير Excel» from every page that shows a list (the owner, 2026-11-19, through the GSCO session: GSCO 2.13.80), pure and without a
// build: the writer's date cells (lib/xlsx-write.ts excelSerial, a real day or moment as a date cell, anything else as the text it is);
// the registry (lib/list-export.ts: every list, its screen and the screen's «تصدير» cell, unique file names); who may export what
// (mayExportList: never a representative or a marketing officer, the screen shown, its tab shown, its cell on; every role of the seven,
// with cells switched off and screens hidden), the new «تصدير» cells of «الصلاحيات» (their ceilings, on by default, restrict-only); and the
// columns and rows of every list from made-up records, in Arabic and in English (no Arabic left in an English header), read back with the
// project's own strict workbook reader: numbers as number cells, days and moments as date cells in Riyadh time, text that looks like a
// formula kept as text, right to left in Arabic only, a list over the cap cut with a note. The same compiled modules as production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'list-export-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),plain=/\.m?js$/.test(relative),dest=path.join(out,plain?relative:relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=plain?fs.readFileSync(src,'utf8'):ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let child=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.(tsx?|m?js)$/.test(child))child+=fs.existsSync(path.join(root,child+'.ts'))?'.ts':'.tsx';
  compile(child);return 'from '+JSON.stringify(path.join(out,/\.m?js$/.test(child)?child:child.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
for(const file of ['lib/list-export.ts','lib/list-export-columns.ts','lib/list-export-mold.ts','lib/list-export-service.ts','lib/list-export-sales.ts','lib/xlsx-write.ts','lib/permissions.ts','lib/erp-sales.ts','lib/customer-followups.ts','lib/competitors.ts','lib/journeys.ts'])compile(file);
const load=file=>import(path.join(out,file));
const L=await load('lib/list-export.mjs'),C=await load('lib/list-export-columns.mjs'),M=await load('lib/list-export-mold.mjs'),S=await load('lib/list-export-service.mjs'),H=await load('lib/list-export-sales.mjs');
const J=await load('lib/journeys.mjs'),X=await load('lib/xlsx-write.mjs'),P=await load('lib/permissions.mjs'),E=await load('lib/erp-sales.mjs'),F=await load('lib/customer-followups.mjs'),K=await load('lib/competitors.mjs');
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const ARABIC=/[؀-ۿ]/;

// ---- the parts of a stored workbook (the writer stores, never compresses), and its sheets read back by the project's reader
function parts(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files={};let at=0;
 while(at+30<=bytes.length&&view.getUint32(at,true)===0x04034b50){const size=view.getUint32(at+18,true),nameLength=view.getUint16(at+26,true),name=new TextDecoder().decode(bytes.subarray(at+30,at+30+nameLength));files[name]=new TextDecoder().decode(bytes.subarray(at+30+nameLength,at+30+nameLength+size));at+=30+nameLength+size;}
 return files;
}
const sheets=bytes=>E.readWorkbookSheets(bytes).map(sheet=>({name:sheet.name,rows:sheet.rows.map(row=>row.cells)}));
/** The cell at a reference of a sheet's XML: its type and style attributes and its value. */
function cellAt(xml,ref){const match=new RegExp('<c r="'+ref+'"([^>]*)>(.*?)</c>').exec(xml);if(!match)return null;return {inline:/t="inlineStr"/.test(match[1]),style:/s="(\d+)"/.exec(match[1])?.[1],value:/<v>([^<]*)<\/v>/.exec(match[2])?.[1]??/<t[^>]*>([^<]*)<\/t>/.exec(match[2])?.[1]};}

// ---- 1. the writer: date cells
eq(X.excelSerial('2026-11-19'),{serial:46345,time:false},'a day is its serial number (2026-11-19 is 46345)');
eq(X.excelSerial('2026-11-19 13:30'),{serial:46345.5625,time:true},'a moment on the wall clock adds its fraction of the day');
eq(X.excelSerial('2026-11-19T06:00:59'),{serial:Math.round((46345+(6*3600+59)/86400)*1e8)/1e8,time:true},'with seconds, and a T between');
for(const bad of ['2026-02-30','2026-13-01','1899-12-31','2026-11-19 24:00','2026-11-19 10:60','19/11/2026','2026-11','','٢٠٢٦-١١-١٩'])eq(X.excelSerial(bad),null,'not a real day: '+JSON.stringify(bad));
{
 const bytes=X.xlsxBook([{name:'ورقة',rows:[['تاريخ','وقت','نص','رقم','ليس يومًا'],[{date:'2026-11-19'},{date:'2026-11-19 08:05'},'=1+1',12.5,{date:'2026-02-30'}]],headerRows:[0],rightToLeft:true}]);
 const files=parts(bytes),xml=files['xl/worksheets/sheet1.xml'];
 eq([cellAt(xml,'A2'),cellAt(xml,'B2'),cellAt(xml,'C2'),cellAt(xml,'D2'),cellAt(xml,'E2')],[{inline:false,style:'5',value:'46345'},{inline:false,style:'6',value:String(Math.round((46345+(8*3600+5*60)/86400)*1e8)/1e8)},{inline:true,style:'0',value:'=1+1'},{inline:false,style:'3',value:'12.5'},{inline:true,style:'0',value:'2026-02-30'}],'a day and a moment are date cells (styles 5 and 6), a formula is text, a number a number, a day that is not one its text');
 ok(files['xl/styles.xml'].includes('<numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>')&&files['xl/styles.xml'].includes('<numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/>')&&files['xl/styles.xml'].includes('<cellXfs count="7">'),'the two date formats in the styles');
 ok(!xml.includes('<f>')&&!/<c [^>]*t="str"/.test(xml),'no formula cell anywhere');
 eq(sheets(bytes),[{name:'ورقة',rows:[['تاريخ','وقت','نص','رقم','ليس يومًا'],['46345',String(Math.round((46345+(8*3600+5*60)/86400)*1e8)/1e8),'=1+1','12.5','2026-02-30']]}],'read back by the project\'s reader');
}

// ---- 2. the registry
const matrixCells=new Set(P.PERMISSION_CELLS);
for(const page of L.LIST_EXPORT_PAGES){const entry=L.LIST_EXPORTS[page];ok(matrixCells.has(entry.cell+':export')&&P.PERMISSION_SCREENS.includes(entry.screen),'«'+page+'» is shown on a screen and decided by an export cell that exists: '+entry.cell+':export');ok(ARABIC.test(entry.ar)&&!ARABIC.test(entry.en)&&/^[a-z-]+$/.test(entry.file),'its names: '+page);}
eq(new Set(L.LIST_EXPORT_PAGES.map(page=>L.LIST_EXPORTS[page].file)).size,L.LIST_EXPORT_PAGES.length,'every file name is its own');
eq(L.SERVER_LIST_EXPORTS,['support','service-leads','complaints'],'the server builds the three lists the page holds only part of');
eq([L.listExportFileName('followups','2026-11-19'),L.listExportFileName('sales','2026-11'),L.listExportFileName('team','x')],['Yourrest-followups-2026-11-19.xlsx','Yourrest-sales-2026-11.xlsx','Yourrest-team-export.xlsx'],'the file names');
ok(L.isListExportPage('visits')&&!L.isListExportPage('trash')&&!L.isListExportPage('dashboard')&&!L.isListExportPage('map')&&!L.isListExportPage('constructor')&&!L.isListExportPage('__proto__'),'no export of «المحذوفات»، «لوحة المتابعة» or the map (as GSCO: the bin, the overview, the map), nothing inherited');

// ---- 3. the cells of «الصلاحيات»
const NEW_CELLS={'followup:export':['admin','manager','supervisor'],'complaints:export':['admin','customer_service','customer_service_manager'],'service-kpi:export':['admin','customer_service_manager'],'mold-requests:export':['admin','manager','supervisor','customer_service','customer_service_manager'],'journeys:export':['admin','manager','supervisor'],'competitors:export':['admin','manager','supervisor'],'team:export':['admin']};
const ROLES=['admin','manager','supervisor','rep','marketing','customer_service','customer_service_manager'];
for(const [key,roles] of Object.entries(NEW_CELLS)){
 const [screen,action]=key.split(':');
 eq(ROLES.filter(role=>P.cellCeiling(role,screen,action)),roles,'the ceiling of «'+key+'»: the roles that open the screen, never a field role');
 ok(!P.cellGrantable(screen,action)&&roles.every(role=>P.cellDefault(role,screen,action)),'restrict-only and on by default: '+key);
 for(const role of roles){const off={role,access:{version:1,off:[key],hidden:[],viewAll:false}};ok(P.can({role},screen,action)&&!P.can(off,screen,action),'«'+key+'» on for '+role+' unless switched off');}
 ok(!P.cellFixed('admin',key),'never fixed: the administrator may close it for another administrator: '+key);
}
for(const role of ROLES)eq(Object.keys(P.normalizePermissions(role,{cells:{'followup:export':true,'team:export':true}}).cells).filter(key=>key.endsWith(':export')&&!Object.hasOwn(NEW_CELLS,key)?false:key.endsWith(':export')).sort(),Object.keys(NEW_CELLS).filter(key=>NEW_CELLS[key].includes(role)).sort(),'a saved true never grants a cell beyond the ceiling: '+role);
for(const key of ['customer:export','activity:export','sales:export','targets:export']){const cell=P.permissionRow(key.split(':')[0]).cells.export;ok(cell.ar.includes('Excel')&&cell.ar.includes('CSV')&&cell.en.includes('Excel'),'the existing cell now names Excel beside CSV: '+key);}

// ---- 4. who may export what
const who=(role,access)=>({role,access});
const EXPECT={
 admin:['customers','visits','support','service-board','service-leads','complaints','service-kpi','followups','mold-requests','journeys','plans','sales','kpis','collection','quotations','targets','competitors','team'],
 manager:['customers','visits','support','service-board','service-leads','complaints','followups','mold-requests','journeys','plans','sales','kpis','collection','quotations','targets','competitors'],
 supervisor:['customers','visits','support','service-board','service-leads','complaints','followups','mold-requests','journeys','plans','sales','kpis','collection','quotations','targets','competitors'],
 rep:[],marketing:[],
 customer_service:['visits','support','service-board','service-leads','complaints','mold-requests'],
 customer_service_manager:['visits','support','service-board','service-leads','complaints','service-kpi','mold-requests'],
};
for(const role of ROLES)eq(L.LIST_EXPORT_PAGES.filter(page=>L.mayExportList(who(role),page)),EXPECT[role],'with nothing saved, '+role+' exports what the screens it opens show (a representative and a marketing officer nothing)');
eq([L.listExportPlace('admin','complaints'),L.listExportPlace('customer_service','complaints'),L.listExportPlace('manager','complaints'),L.listExportPlace('supervisor','complaints')],[{screen:'complaints',cell:'complaints'},{screen:'complaints',cell:'complaints'},{screen:'activity',cell:'activity'},{screen:'activity',cell:'activity'}],'the complaints follow «الشكاوى» for the roles with that page, «الزيارات» for the sales members who meet them there');
const access=(off=[],hidden=[])=>({version:3,off,hidden,viewAll:false});
eq(L.LIST_EXPORT_PAGES.filter(page=>L.mayExportList(who('manager',access(['activity:export'])),page)),['customers','followups','mold-requests','journeys','plans','sales','kpis','collection','quotations','targets','competitors'],'«الزيارات · تصدير» closed: every list of the visits page goes, the complaints a sales manager meets there too');
eq(L.LIST_EXPORT_PAGES.filter(page=>L.mayExportList(who('manager',access(['customer:export'])),page)).includes('customers'),false,'«العملاء · تصدير» closed: the customers\' list');
eq(L.LIST_EXPORT_PAGES.filter(page=>L.mayExportList(who('supervisor',access([],['targets.collection','targets.quotes'])),page)).filter(page=>['kpis','collection','quotations','targets'].includes(page)),['kpis','targets'],'a hidden tab of the targets hub exports nothing');
eq(L.LIST_EXPORT_PAGES.filter(page=>L.mayExportList(who('supervisor',access([],['followup','competitors'])),page)).filter(page=>['followups','competitors'].includes(page)),[],'a hidden screen exports nothing');
eq(L.mayExportList(who('manager',access([],['sales'])),'sales'),false,'«المبيعات» hidden: neither its page nor the hub\'s sales tab exports');
eq(L.LIST_EXPORT_PAGES.filter(page=>L.mayExportList(who('admin',access(['team:export','complaints:export'],['team','complaints'])),page)).filter(page=>['team','complaints'].includes(page)),[],'the administrator\'s cells switched off by another administrator: nothing (nothing is hidden from an administrator, the cell decides)');
eq(L.LIST_EXPORT_PAGES.filter(page=>L.mayExportList(who('customer_service_manager',access(['service-kpi:export','mold-requests:export'])),page)),['visits','support','service-board','service-leads','complaints'],'a customer-service manager with two cells off');
ok(!L.mayExportList(null,'visits')&&!L.mayExportList(who('rep',access()),'followups')&&!L.mayExportList(who('marketing',{version:1,off:[],hidden:[],viewAll:true}),'customers'),'nobody signed in, a representative, a marketing officer: never');

// ---- made-up records
const m=(id,role,supervisorId,branch='الرئيسي')=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:'عضو '+id,role,branch,supervisorId,regionScope:'all',active:1,target:0});
const members=[m('owner','admin'),m('mgr','manager'),m('sup','supervisor','mgr'),m('rep','rep','sup')];
const row=(id,kind,parentId,assignedTo,data,createdAt='2026-11-10T07:00:00.000Z')=>({id,kind,parentId,assignedTo,branch:'الرئيسي',data,createdAt,updatedAt:createdAt,version:1});
const records=[
 row('c1','customer',null,'rep',{name:'مصنع النور',code:'ERP-1',region:'الشرقية',city:'الدمام',phone:'0500000001'}),
 row('c2','customer',null,'rep',{name:'=HYPERLINK("http://example.invalid","x")',code:'00042',region:'الوسطى',city:'الرياض',phone:'0500000002'}),
 row('f1','activity','c1','rep',{visitWorkflow:'followup-v1',type:'call',date:'2026-11-10',result:'طلب العميل عرضًا',salesStage:'negotiation',nextDate:'2026-11-12',nextAction:'إرسال العرض',performedBy:'rep',hasCompetitor:true,competitorName:'منافس الشرق',competitorNotes:'سعره أقل',requestedProducts:['خلاطات البلوك']}),
 row('v2','activity','c2','rep',{type:'visit',date:'2026-11-11',summary:'زيارة',result:'إيجابية',salesStage:'won',nextDate:'',nextAction:'',performedBy:'rep',hasCompetitor:true,competitorName:'منافس الشرق',competitorNotes:'+966 عرض شفهي'},'2026-11-11T09:00:00.000Z'),
];

// ---- 5. «المتابعات»
const english=new Map([['تفاوض','Negotiation'],['تم الفوز','Won'],['اتصال','Call'],['الشرقية','Eastern'],['الوسطى','Central'],['خلاطات البلوك','Block mixers'],['زيارة','Visit']]);
const tr=text=>english.get(text)||text;
const plans=F.customerFollowupPlans(records),history=records.filter(r=>F.isCustomerFollowup(r));
{
 const [open]=C.followupTables({tab:'open',plans:plans.filter(p=>!p.closed),history,records,members,day:'2026-11-12'},'ar');
 eq(open.header,['العميل','كود ERP','المنطقة','المدينة','آخر نتيجة','تاريخ آخر نتيجة','مرحلة البيع','إعادة تواصل','الإجراء القادم','موعد المتابعة القادمة','الحالة','المندوب المسؤول'],'«المتابعات المفتوحة»: the columns of the page');
 eq(open.rows,[['مصنع النور','ERP-1','الشرقية','الدمام','طلب العميل عرضًا',{date:'2026-11-10'},'تفاوض','','إرسال العرض',{date:'2026-11-12'},'اليوم','عضو rep']],'one row per open plan, the page\'s chip «اليوم» on its day, the days as dates');
 const [shownEn]=C.followupTables({tab:'open',plans:plans.filter(p=>!p.closed),history,records,members,day:'2026-11-13'},'en',tr);
 ok(!shownEn.header.some(text=>ARABIC.test(text))&&shownEn.rows[0][6]==='Negotiation'&&shownEn.rows[0][10]==='Overdue'&&shownEn.rows[0][2]==='Eastern','in English: the headers and the page\'s words, «Overdue» the day after');
 const [log]=C.followupTables({tab:'history',plans,history,records,members},'ar');
 eq([log.name,log.header.length,log.rows],[['سجل المتابعات','Follow-up history'],9,[['مصنع النور',{date:'2026-11-10'},'اتصال','طلب العميل عرضًا','تفاوض','إرسال العرض',{date:'2026-11-12'},'','عضو rep']]],'«سجل المتابعات»: one row per follow-up done');
 eq(C.followupTables({tab:'closed',plans:plans.filter(p=>p.closed),history,records,members},'ar')[0].rows.map(row=>row[0]),['=HYPERLINK("http://example.invalid","x")'],'the closed tab holds the customer won');
}

// ---- 6. «المنافسون»
{
 const entries=K.buildCompetitors(records,members),[list,log]=C.competitorTables(entries,'ar');
 eq(list.rows,[['منافس الشرق',2,2,0,{date:'2026-11-11'}]],'one row per competitor: customers, contacts, quotations, last recorded');
 eq(log.rows.map(row=>[row[0],row[1],row[6],row[9]]),[['منافس الشرق','=HYPERLINK("http://example.invalid","x")','زيارة','+966 عرض شفهي'],['منافس الشرق','مصنع النور','اتصال','سعره أقل']],'«سجل التواصل»: every contact, the newest first, the notes as written');
 const [,logEn]=C.competitorTables(entries,'en',tr);
 ok(logEn.header.every(text=>!ARABIC.test(text))&&logEn.rows[1][8]==='Block mixers'&&logEn.rows[1][6]==='Call','in English');
}

// ---- 7. «طلبات تصنيع القوالب»
{
 const remote={crmRequestId:'mr-1',orderNo:117,requestRef:'ref-1',status:'in_production',editable:false,moldSerial:'049 / 050',productionDate:'2026-11-15',stages:{},stagesDone:2,stagesTotal:7,delivered:false,deliveryDate:null,updatedAt:'2026-11-15T08:00:00.000Z',revision:1,waitingStep:'manufacturing',waitingSince:'2026-11-15T08:00:00.000Z',approvals:null};
 const crm={id:'mr-1',memberId:'rep',memberName:'عضو rep',customerName:'مصنع النور',customerErpCode:'ERP-1',customerCity:'الدمام',crmNumber:14,requestedAt:'2026-11-12T21:30:00.000Z',legacyOrderNo:null,specs:{description:'200*400*27.5TH MM OPEN',moldNo:'YR-14',quantity:2},cancelled:false,remote,returned:null,sending:{state:'sent'},can:{approve:false}};
 const order={id:'order:ref-2',source:'manual',requestRef:'ref-2',memberId:'',memberName:'مندوب الإنتاج',customerName:'عميل خارج الـCRM',customerErpCode:'',customerCity:'جدة',crmNumber:null,requestedAt:'2026-11-01T06:00:00.000Z',specs:{description:'قالب',moldNo:'',quantity:null},cancelled:false,remote:{...remote,orderNo:98,status:'delivered',delivered:true,deliveryDate:'2026-11-14',moldSerial:null,productionDate:null},returned:null,sending:{state:'sent'},can:{approve:false}};
 const [table]=M.moldTables([crm,order],true,'ar');
 eq(table.rows[0].slice(0,12),[117,'ref-1','الـCRM',{date:'2026-11-13 00:30'},'عضو rep','مصنع النور',14,'ERP-1','الدمام','200*400*27.5TH MM OPEN','YR-14',2],'a CRM request: its order number, source, the moment in Riyadh, the customer and the specifications');
 eq([table.rows[0][16],table.rows[0][17],table.rows[1][2],table.rows[1][0],table.rows[1][18],table.rows[1][6]],['049 / 050',{date:'2026-11-15'},'تطبيق المنتجات',98,{date:'2026-11-14'},''],'its serial and production day; a request of the products application with its source and delivery day');
 ok(table.rows.every(row=>typeof row[12]==='string'&&row[12].length>0),'the status in the card\'s words');
 ok(M.moldTables([crm],true,'en')[0].header.every(text=>!ARABIC.test(text)),'in English');
}

// ---- 8. «تقرير يوم المندوب»
{
 const stop={id:'s1',memberId:'rep',memberName:'عضو rep',date:'2026-11-18',customerId:'c1',regionScope:'all',snapshot:{customerName:'مصنع النور',region:'الشرقية',latitude:26.4,longitude:50.1},selectedAt:'2026-11-18T05:00:00.000Z',closedAt:null,state:'onsite',data:{arrivalAt:'2026-11-18T05:30:00.000Z',departureAt:null,durationSeconds:null,durationUncertain:true,observedSeconds:0,gaps:[{from:'a',to:'b',reason:'x'}],events:[]},version:1,points:[],segments:[],results:[{id:'r1',date:'2026-11-18',createdAt:'2026-11-18T06:00:00.000Z',type:'visit',summary:'زيارة',result:'تم الاتفاق',nextAction:'التسليم',nextDate:'2026-11-25'}]};
 const call={id:'k1',date:'2026-11-18',createdAt:'2026-11-18T09:15:00.000Z',type:'call',summary:'متابعة',result:'لم يرد',nextAction:'',nextDate:'',memberId:'rep',memberName:'عضو rep',customerId:'c2',customerName:'مصنع الريان'};
 const [stops,contacts]=C.journeyTables({date:'2026-11-18',stops:[stop],communications:[call]},'ar','2026-11-19');
 eq(stops.rows,[[{date:'2026-11-18'},'عضو rep','مصنع النور','الشرقية','سجل غير مكتمل',{date:'2026-11-18 08:00'},{date:'2026-11-18 08:30'},'','','نعم',1,'تم الاتفاق','التسليم',{date:'2026-11-25'}]],'a stop of an earlier day never closed is an incomplete record (as the card), its times in Riyadh');
 eq(contacts.rows,[[{date:'2026-11-18 12:15'},'عضو rep','مصنع الريان','اتصال','متابعة','لم يرد','','']],'a contact by the screen\'s name of its type («اتصال», never the stored key)');
 eq(C.journeyTables({date:'2026-11-18',stops:[],communications:[call,{...call,id:'k2',type:'quote'}]},'en','2026-11-18')[1].rows.map(row=>row[3]),['Call','Quotation'],'in English, the screen\'s English names (GSCO 2.13.80 fixed the stored keys there)');
 eq(J.journeyStopState({state:'onsite',date:'2026-11-19',closedAt:null},'2026-11-19'),'onsite','today\'s stop keeps its state');
}

// ---- 9. the customer-service lists
const say=ar=>ar;
{
 const complaint={id:'cm1',customerId:'c1',customerName:'مصنع النور',customerPhone:'0500000001',customerCity:'الدمام',customerRegion:'الشرقية',status:'assigned',stage:'first_contact',stageSince:'2026-11-18T06:00:00.000Z',stageHours:5.25,targetHours:4,late:true,awaiting:'contact',channel:'call',category:'product_quality',severity:'high',description:'PRIVATE-DESCRIPTION',demand:'PRIVATE-DEMAND',complaintNumber:12,registrarName:'خدمة',serviceManagerName:'مدير الخدمة',salesManagerName:'مدير المبيعات',supervisorName:'المشرف',assigneeName:'المندوب',createdAt:'2026-11-17T06:00:00.000Z',updatedAt:'2026-11-18T06:00:00.000Z',resolution:null,closure:{outcome:'satisfied',note:'PRIVATE-NOTE',at:'2026-11-19T06:00:00.000Z',by:'x',byName:'y',rating:5}};
 const table=S.complaintsTable([complaint],'ar');
 eq(table.rows[0].slice(0,13),[12,'مصنع النور','0500000001','الدمام','الشرقية','جودة المنتج أو القالب','اتصال','عالية','بانتظار أول تواصل من المندوب','تسجيل التواصل','نعم',5.3,4],'a complaint: its number, customer, category, channel, severity, the card\'s state and what waits, late, the hours');
 eq(table.rows[0].slice(18),[{date:'2026-11-17 09:00'},{date:'2026-11-18 09:00'},'','','العميل راضٍ',{date:'2026-11-19 09:00'},5],'its moments in Riyadh, its closure and rating');
 ok(!JSON.stringify(table.rows).includes('PRIVATE'),'never what was written in it (its description, the demand, a note)');
 eq(S.complaintStateText({status:'closed',stage:'closed'},(ar,en)=>en),'Closed','the state in English');
 ok(S.complaintsTable([complaint],'en').header.every(text=>!ARABIC.test(text)),'English headers');
 const request={id:'support-ab12cd34ef',customerName:'مصنع الريان',customerPhone:'0500',customerCity:'جدة',customerRegion:'الغربية',origin:'rep',opportunity:{id:'case',number:51,products:[]},requestedByName:'المندوب',repName:'المندوب',channel:'whatsapp',state:'assigned',stage:'delegation',late:false,stageHours:1,targetHours:4,handlerName:'خدمة',serviceManagerName:'م',salesManagerName:'س',assigneeName:'',createdAt:'2026-11-18T06:00:00.000Z',result:{outcome:'wants_visit',note:'PRIVATE',nextDate:'2026-11-20',by:'x',byName:'y',at:'z'},resolution:null,closure:null,note:'PRIVATE-NOTE'};
 const missed={id:'support-missed-1',customerName:'مصنع القمة',customerPhone:'0501',customerCity:'أبها',customerRegion:'الجنوبية',repName:'المندوب',plan:{visitId:'v',visitDate:'2026-11-01',result:'إيجابية',nextAction:'زيارة',nextDate:'2026-11-05'},overdueDays:14,routedToName:'خدمة'};
 const [asked,unanswered]=S.supportTables([request],[missed],'ar');
 eq([asked.rows[0][0],asked.rows[0][5],asked.rows[0][6],asked.rows[0][9],asked.rows[0][10],asked.rows[0][19],asked.rows[0][20]],['AB12CD34','طلب مندوب',51,'واتساب','لدى مشرف المبيعات','العميل يطلب زيارة في موعد',{date:'2026-11-20'}],'an assistance request: its reference, origin, opportunity, channel, the card\'s state and the contact\'s result');
 ok(!JSON.stringify(asked.rows).includes('PRIVATE'),'never its note or a result\'s note');
 eq(unanswered.rows,[['مصنع القمة','0501','أبها','الجنوبية','المندوب',{date:'2026-11-05'},14,'زيارة','إيجابية','خدمة']],'a missed visit');
 const item={key:'complaint:cm1',kind:'complaint',id:'cm1',customerName:'مصنع النور',products:[],category:'delivery_delay',complaintNumber:12,severity:'normal',registeredAt:'2026-11-17T06:00:00.000Z',registrarName:'خدمة',stage:'closure',stageSince:'2026-11-18T06:00:00.000Z',stageHours:2,late:false,side:'service',holder:{name:'خدمة',role:'registrar'},finishedAt:'',outcome:''};
 const done={...item,key:'opportunity:o1',kind:'opportunity',complaintNumber:null,products:['خلاطات البلوك'],finishedAt:'2026-11-19T06:00:00.000Z',outcome:'won',side:'done',holder:null};
 const board=S.trackingTable([item,done],'ar');
 eq(board.rows.map(row=>[row[0],row[3],row[7],row[8],row[9]]),[['شكوى','التأخر في التسليم','بانتظار تأكيد الإغلاق مع العميل','خدمة العملاء','خدمة (خدمة العملاء)'],['فرصة','خلاطات البلوك','تم الفوز','منتهية','']],'the board: kind, subject, the stage or how it ended, the side, who holds it');
 eq(S.trackingOutcomeText({kind:'support',outcome:'no_answer'},say),'لم يرد العميل','how an assistance request ended, in the board\'s words');
 const lost=S.leadsTable('lost',[{id:'case',number:7,customerName:'مصنع',lossReason:'السعر أعلى من المنافس',lostAt:'2026-11-02T10:00:00.000Z',holderName:'المندوب',registrarName:'خدمة'}],'ar');
 eq(lost.rows,[[7,'مصنع',{date:'2026-11-02 13:00'},'السعر أعلى من المنافس','المندوب','خدمة']],'«الفرص المفقودة»');
 const dormant=S.leadsTable('dormant',[{id:'c9',name:'مصنع',code:'00042',city:'الرياض',phone:'0555',repName:'المندوب',lastPurchase:'',neverBought:true}],'en');
 eq(dormant.rows,[['مصنع','00042','الرياض','0555','المندوب','','Yes']],'«عملاء منقطعون عن الشراء»: an ERP code with its zeros stays text, never bought');
 const kpi={month:'2026-11',groups:[{managerId:'csm',managerName:'مدير الخدمة',closed:true,manager:{memberId:'csm',role:'manager',name:'مدير الخدمة',score:88.5,measuredWeight:100,metrics:[{key:'team_average',kind:'average',target:80,weight:50,min:0,numerator:3,denominator:4,actual:75.04,enough:true,measured:true,empty:false,achieved:0,points:41.666,items:[],itemCount:0}]},reps:[{memberId:'cs',role:'rep',name:'ممثلة',score:null,measuredWeight:0,metrics:[]}]}],audits:[{id:'a',repName:'ممثلة',date:'2026-11-05',reference:{type:'complaint',id:'x',customerName:'مصنع'},total:85,result:'pass',verification:{called:true,rating:4},note:'ملاحظة التدقيق',auditorName:'مدير الخدمة'}]};
 const [cards,metrics,audits]=S.serviceKpiTables(kpi,'ar');
 eq(cards.rows,[['مدير الخدمة','مدير الخدمة','مدير خدمة العملاء','2026-11',88.5,100,'نعم'],['مدير الخدمة','ممثلة','ممثل خدمة العملاء','2026-11','',0,'نعم']],'the cards of the month');
 eq(metrics.rows,[['مدير الخدمة','مدير الخدمة','متوسط الفريق',75,80,50,3,4,41.67,'نعم']],'a row per indicator');
 eq(audits.rows,[[{date:'2026-11-05'},'ممثلة','مدير الخدمة','شكوى','مصنع',85,'ناجح','نعم',4,'ملاحظة التدقيق']],'the quality audits');
}

// ---- 10. the tabs of «المستهدفات وتقييم الأداء»
{
 const person=(id,role,metrics,quotations=[])=>({member:{id,name:'عضو '+id,role,branch:'الرئيسي'},metrics,quotations});
 const people=[person('rep','rep',[{id:'collection',numerator:750000,denominator:1000000,score:75,points:15,status:'scored'},{id:'quotes',numerator:2,denominator:4,score:50,points:1.5},{id:'orders',numerator:1,denominator:2,score:50,points:1.5}],[{quoteId:'q1',number:'Q-7',customerName:'مصنع',converted:true,invoices:['INV-1','INV-2'],via:['description']},{quoteId:'q2',number:'',customerName:'',converted:false,invoices:[],via:[]}]),
  person('sup','supervisor',[{id:'collection',numerator:null,denominator:null,score:null,points:null,status:'not_applicable'},{id:'quotes',numerator:null,denominator:null,score:null,points:null}])];
 const roleName=role=>({rep:'مندوب المبيعات',supervisor:'مشرف المبيعات'})[role];
 const [collection]=H.evidenceTables('collection',people,'ar',roleName);
 eq(collection.rows,[['عضو rep','مندوب المبيعات','الرئيسي',10000,7500,75,15],['عضو sup','مشرف المبيعات','الرئيسي','لا ينطبق','لا ينطبق','لا ينطبق','لا ينطبق']],'«التحصيل»: the amounts in riyals and the share as numbers, «لا ينطبق» where the page says so');
 const [quotes,converted]=H.evidenceTables('quotes',people,'en',roleName);
 eq([quotes.rows[0].slice(3),quotes.rows[1].slice(3,6)],[[4,2,50,2,1,50,1.5,1.5],['','','Incomplete']],'«عروض الأسعار»: each indicator, «Incomplete» where it is');
 eq(converted.rows,[['عضو rep','Q-7','مصنع','INV-1, INV-2','From the invoice description']],'the converted quotations with their invoices');
 ok(quotes.header.every(text=>!ARABIC.test(text)),'in English');
 const rows=L.rowsTable(['المستهدفات والأوزان','Targets and weights'],['الشهر','المندوب','الكمية'],[['2026-11','عضو rep',120],['2026-11','=SUM(A1)','']]);
 eq(rows.rows,[['2026-11','عضو rep',120],['2026-11','=SUM(A1)','']],'the CSV rows of the targets: numbers stay numbers, a month and a formula-looking name stay text');
}

// ---- 11. the workbook: languages, direction, the cap
{
 const columns=[['الاسم','Name',r=>r.name],['اليوم','Day',r=>L.dayCell(r.day)],['المبلغ','Amount',r=>L.centsCell(r.cents)],['الوقت','Time',r=>L.momentCell(r.at)]];
 const items=[{name:'@cmd',day:'2026-11-19',cents:123456,at:'2026-11-19T21:30:00.000Z'},{name:'-1+2',day:'bad',cents:null,at:'not a moment'}];
 const ar=L.listWorkbook([L.exportTable(['القائمة','The list'],columns,items,'ar')],'ar'),en=L.listWorkbook([L.exportTable(['القائمة','The list'],columns,items,'en')],'en');
 eq([ar.rows,ar.total,ar.capped],[2,2,false],'the counts the message reports');
 const arXml=parts(ar.bytes)['xl/worksheets/sheet1.xml'],enXml=parts(en.bytes)['xl/worksheets/sheet1.xml'];
 ok(arXml.includes('rightToLeft="1"')&&!enXml.includes('rightToLeft')&&arXml.includes('state="frozen"'),'right to left in Arabic only, the header frozen');
 eq(sheets(ar.bytes),[{name:'القائمة',rows:[['الاسم','اليوم','المبلغ','الوقت'],['@cmd','46345','1234.56',String(Math.round((46346+30/1440)*1e8)/1e8)],['-1+2','bad','','not a moment']]}],'Arabic: a day, an amount, a moment of the next Riyadh day; what is not one as it is');
 eq(sheets(en.bytes)[0].name+'|'+sheets(en.bytes)[0].rows[0].join(','),'The list|Name,Day,Amount,Time','English: the sheet and the headers');
 eq([cellAt(arXml,'A2').inline,cellAt(arXml,'A3').inline],[true,true],'text that starts like a formula is an inline string');
 const many=Array.from({length:L.EXPORT_ROW_CAP+5},(_,i)=>({name:'n'+i,day:'2026-11-19',cents:0,at:''}));
 const capped=L.listWorkbook([L.exportTable(['القائمة','The list'],columns,many,'ar')],'ar');
 eq([capped.rows,capped.total,capped.capped],[L.EXPORT_ROW_CAP,L.EXPORT_ROW_CAP+5,true],'a list over the cap: the first rows, and it says so');
 const last=sheets(capped.bytes)[0].rows.at(-1)[0];
 ok(last.includes(String(L.EXPORT_ROW_CAP))&&last.includes(String(L.EXPORT_ROW_CAP+5)),'the file\'s last line says how many were left out');
 eq(L.typedCell('٠٥٠٠','number'),'٠٥٠٠','a number column with Arabic digits keeps the text as written');
 eq([L.typedCell('0500','number'),L.typedCell(' 12 ','number'),L.typedCell(7,'number'),L.typedCell('2026-11-19','day'),L.typedCell('2026-11-19T21:00:00.000Z','moment'),L.typedCell(undefined),L.typedCell(null,'day')],[500,12,7,{date:'2026-11-19'},{date:'2026-11-20 00:00'},'',''],'typed cells');
 const visits=L.columnsTable(['الزيارات','Visits'],[['رقم الزيارة',r=>r.n,'number'],['بداية الزيارة',r=>r.at,'moment'],['موعد المتابعة',r=>r.next,'day'],['الملاحظات',r=>r.notes]],[{n:'',at:'',next:'',notes:'=cmd|"/c calc"!A0'}]);
 eq(visits.rows,[['','','','=cmd|"/c calc"!A0']],'the visits\' columns (the CSV\'s, typed for Excel): empty stays empty, a formula-looking note stays text');
}

// ---- 12. the words the panels read from here are the panels' (no copy of them is left in the page)
for(const [file,gone] of [['app/support-panel.tsx',"waiting:['بانتظار التولّي'"],['app/complaints-panel.tsx',"say('قيد الحل مع المندوب'"],['app/journey-report.tsx',"en_route:['في الطريق'"],['app/journey-report.tsx',"website:['عن طريق الويبسايت'"],['app/service-tracking.tsx',"if(item.outcome==='cancelled')"]]){
 ok(!fs.readFileSync(path.join(root,file),'utf8').includes(gone),file+' reads its words from lib/list-export-*.ts');
}
console.log('list-export:',checks,'checks');

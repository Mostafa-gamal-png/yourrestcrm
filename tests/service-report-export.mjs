// The customer-service reports of 2026-11-16 (the owner's item 3 of the GSCO list, «أ» and «ب»), pure and without a build: the requests
// report by «نوع التواصل» with old requests counted (the type their registration carries, else «غير محدد»); «تصدير Excel» of the requests
// and the complaints reports: three sheets («الملخص»، «زمن المراحل»، «التفاصيل») in Arabic and English, the figures of the screen, one row
// per record the reader may already read and nothing else, numbers as numbers, read back with the project's own strict reader; and the new
// cell «تقارير خدمة العملاء · تصدير» of «الصلاحيات»: on by default for the administrator, the sales manager and the customer-service
// manager only, restrict-only, never fixed (the administrator may close it for any account, another administrator's too). The same compiled
// modules as production; made-up members, customers and records only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'service-report-export-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let child=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(child))child+=fs.existsSync(path.join(root,child+'.ts'))?'.ts':'.tsx';
  compile(child);return 'from '+JSON.stringify(path.join(out,child.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
for(const file of ['lib/service-report-export.ts','lib/permissions.ts','lib/erp-sales.ts'])compile(file);
const load=file=>import(path.join(out,file));
const X=await load('lib/service-report-export.mjs'),V=await load('lib/service-report-view.mjs'),S=await load('lib/service-report.mjs'),P=await load('lib/permissions.mjs'),E=await load('lib/erp-sales.mjs');
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const ARABIC=/[؀-ۿ]/;

// ---- made-up company (Riyadh is UTC+3; 2026-09-06 is a Sunday)
const m=(id,role,supervisorId,branch='الرئيسي')=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:'عضو '+id,role,branch,supervisorId,regionScope:'all',active:1,target:0});
const members=[m('owner','admin'),m('admin2','admin'),m('sm','manager'),m('sm2','manager'),m('sup','supervisor','sm'),m('rep','rep','sup'),m('rep2','rep','sm2'),m('csm','customer_service_manager','sm'),m('cs','customer_service','csm'),m('csm2','customer_service_manager','sm2'),m('cs2','customer_service','csm2'),m('csm_b','customer_service_manager','sm2','فرع آخر'),m('cs_b','customer_service','csm_b','فرع آخر')];
const customer=(id,assignedTo,branch='الرئيسي')=>({id,kind:'customer',parentId:null,assignedTo,branch,data:{name:'مصنع '+id,region:'الشرقية',phone:'0500000000',city:'الدمام'},createdAt:'2026-08-01T05:00:00.000Z',updatedAt:'2026-08-01T05:00:00.000Z',version:1});
const contact=(id,caseId,customerId,createdAt,data)=>({id,kind:'activity',parentId:customerId,assignedTo:'rep',branch:'الرئيسي',data:{type:'call',date:createdAt.slice(0,10),result:'تم',salesStage:'new',serviceCaseId:caseId,performedBy:'rep',responsibleId:'rep',recordedByEmail:'rep@yourrest.org',...data},createdAt,updatedAt:createdAt,version:1});
const kase=(id,customerId,status,fields,data,createdAt)=>({id,customerId,status,creatorId:'cs',serviceManagerId:'csm',salesManagerId:'sm',assignedTo:null,supervisorId:null,...fields,data:{products:['خدمات صيانة'],strength:'strong',needs:'PRIVATE-NEEDS',nextAction:'y',nextDate:'2026-10-20',participants:['cs','csm'],...data},createdAt,updatedAt:createdAt,version:2});
const T=(day,hour)=>'2026-09-'+String(day).padStart(2,'0')+'T'+String(hour).padStart(2,'0')+':00:00.000Z';
const cases=[
 // A: «اتصال», approved after an hour, assigned two hours later, first contact an hour later, won; request number 41
 kase('A','c-A','assigned',{assignedTo:'rep',supervisorId:'sup'},{source:'call',approvedAt:T(6,6),assignedAt:T(6,8),registration:{type:'call',visitNumber:41}},T(6,5)),
 // B: «واتساب», approval took six working hours (late), lost
 kase('B','c-B','assigned',{assignedTo:'rep',supervisorId:'sup'},{source:'whatsapp',approvedAt:T(7,11),assignedAt:T(7,12),registration:{type:'whatsapp',visitNumber:42}},T(7,5)),
 // C: an OLD request: no `source` stored, only its registration's type («بريد إلكتروني»); still waiting for the sales manager
 kase('C','c-C','pending_assignment',{},{source:undefined,approvedAt:T(8,6),registration:{type:'email'}},T(8,5)),
 // D: older still: neither a source nor a registration: «غير محدد»; waiting for approval
 kase('D','c-D','pending_approval',{salesManagerId:null},{source:undefined},T(9,5)),
 // E: another sales manager's team: neither sm nor csm reads it
 kase('E','c-E','pending_assignment',{creatorId:'cs2',serviceManagerId:'csm2',salesManagerId:'sm2'},{source:'social',approvedAt:T(9,6),participants:['cs2','csm2']},T(9,5)),
 // F: August: another month
 kase('F','c-F','pending_approval',{salesManagerId:null},{source:'visit'},'2026-08-31T05:00:00.000Z'),
 // G: assigned to the supervisor on Thursday 10:00, not delegated since (late at the delegation in October)
 kase('G','c-G','assigned',{assignedTo:'sup',supervisorId:'sup'},{source:'call',approvedAt:T(10,6),assignedAt:T(10,7)},T(10,5))
];
const all=[...['A','B','C','D','E','F','G'].map(x=>customer('c-'+x,x==='E'?'rep2':'rep')),
 contact('a1','A','c-A',T(6,9),{salesStage:'new'}),contact('a2','A','c-A',T(10,7),{salesStage:'won'}),
 contact('b1','B','c-B',T(9,5),{salesStage:'lost',lossReason:'السعر أعلى من المنافس'})];
const now='2026-10-12T12:00:00.000Z';
const ctx=id=>({me:members.find(x=>x.id===id),members,all,serviceCases:cases});

// ---- «أ»: the requests report by «نوع التواصل», old requests counted
eq(S.serviceContactType({data:{source:'call',registration:{type:'email'}}}),'call','the case\'s own type first');
eq(S.serviceContactType({data:{registration:{type:'email'}}}),'email','an old request without one: its registration\'s type');
eq(S.serviceContactType({data:{source:'  ',registration:{type:' '}}}),'unknown','neither: «غير محدد» (unknown)');
let r=S.serviceReport(ctx('owner'),'2026-09',now);
eq([r.total,r.open,r.won,r.lost],[6,4,1,1],'September for the administrator: six requests (August\'s left out)');
eq(r.byContactType.map(row=>[row.type,row.total,row.won,row.lost,row.open,row.winRate]),[['call',2,1,0,1,100],['email',1,0,0,1,null],['social',1,0,0,1,null],['unknown',1,0,0,1,null],['whatsapp',1,0,1,0,0]],'by contact type, the old request under its registration\'s type and the oldest under «غير محدد»: nothing falls in one line');
ok(!('bySource' in r),'the old «by source» breakdown is gone');
eq(S.serviceReport(ctx('sm'),'2026-09',now).byContactType.map(row=>row.type),['call','email','whatsapp'],'the sales manager: what reached him (not the other team\'s «social», not D still waiting for approval)');
const say=V.sayIn('ar'),sayEn=V.sayIn('en');
eq(['call','email','website','social','visit','whatsapp','unknown','legacy-x'].map(type=>V.contactTypeText(type,say)),['اتصال','بريد إلكتروني','عن طريق الويبسايت','عن طريق مواقع التواصل الاجتماعي','زيارة','واتساب','غير محدد','legacy-x'],'the types in words as the registration form names them; an unknown stored value as stored');
eq(['call','website','unknown'].map(type=>V.contactTypeText(type,sayEn)),['Phone call','Website','Unspecified'],'and in English');

// ---- «ب»: the requests workbook
const sheetsOf=bytes=>E.readWorkbookSheets(bytes).map(sheet=>({name:sheet.name,rows:sheet.rows.map(row=>row.cells)}));
const zipText=(bytes,name)=>{const text=Buffer.from(bytes).toString('latin1'),at=text.indexOf(name);return at<0?'':Buffer.from(bytes).subarray(at,at+400000).toString('utf8');};
let file=X.requestsReportWorkbook(ctx('owner'),'2026-09',now,'ar');
eq(file.fileName,'Yourrest-service-report-requests-2026-09.xlsx','the file is named by its report and month');
let book=sheetsOf(file.bytes);
eq(book.map(sheet=>sheet.name),['الملخص','زمن المراحل','التفاصيل'],'three sheets: «الملخص»، «زمن المراحل»، «التفاصيل»');
let summary=book[0].rows;
eq(summary[0],['البند','القيمة'],'the summary\'s head');
eq(summary[1],['التقرير الشهري لطلبات خدمة العملاء','2026-09'],'the report and its month');
eq(summary.slice(2,8),[['الطلبات','6'],['مفتوحة','4'],['فاز','1'],['فُقد','1'],['نسبة الفوز','50%'],['مفتوحة وتجاوزت هدفها',String(r.openOverTarget)]],'the tiles of the screen, with the same figures');
eq(V.serviceReportTiles(r,say).map(([label,value])=>[label,String(value)]),summary.slice(2,8),'the screen\'s own tile list is what the file writes');
const at=title=>summary.findIndex(row=>row[0]===title);
ok(at('بحسب نوع التواصل')>0,'the breakdown «بحسب نوع التواصل»');
eq(summary.slice(at('بحسب نوع التواصل')+1,at('بحسب نوع التواصل')+7),[['نوع التواصل','الطلبات','فاز','فُقد','مفتوح','نسبة الفوز'],['اتصال','2','1','0','1','100%'],['بريد إلكتروني','1','0','0','1','—'],['عن طريق مواقع التواصل الاجتماعي','1','0','0','1','—'],['غير محدد','1','0','0','1','—'],['واتساب','1','0','1','0','0%']],'its rows, as on screen');
ok(at('الحالة الحالية')>at('بحسب نوع التواصل')&&at('أسباب الفقد')>at('الحالة الحالية'),'then the current state and the loss reasons');
eq(summary[at('أسباب الفقد')+2],['السعر أعلى من المنافس','1'],'the loss reason as the representative wrote it');
ok(summary.at(-1)[0].startsWith('ساعات العمل من السبت إلى الخميس'),'the screen\'s note closes the summary');
eq(book[1].rows[0],['المرحلة','الطلبات','الوسيط (ساعات عمل)','المتوسط (ساعات عمل)','الهدف (ساعات عمل)','تجاوزت الهدف'],'«زمن المراحل»: its head');
eq(book[1].rows.slice(1).map(row=>row[0]),['الاعتماد','التكليف','أول تواصل بعد التكليف','من التسجيل إلى أول تواصل'],'the screen\'s four stages');
eq(book[1].rows[1],['الاعتماد',String(r.timing.approval.n),String(r.timing.approval.median),String(r.timing.approval.average),'4',String(r.timing.approval.overTarget)],'the approval row: the report\'s own figures');
eq(book[1].rows[4].slice(4),['—','—'],'the whole wait to first contact has no target');
const details=book[2].rows;
eq(details[0],['رقم الطلب','العميل','المدينة','المنطقة','نوع التواصل','الأصناف','سجّله','المسؤول الحالي','الحالة','التسجيل','الاعتماد','متأخر: الاعتماد','التكليف','متأخر: التكليف','التفويض','متأخر: التفويض','أول تواصل بعد التكليف','متأخر: أول تواصل','النتيجة','سبب الفقد'],'«التفاصيل»: one column per stage with its late mark');
eq(details.length-1,r.total,'one row per request of the month the report counts');
eq(details.slice(1).map(row=>row[1]),['مصنع c-A','مصنع c-B','مصنع c-C','مصنع c-D','مصنع c-E','مصنع c-G'],'oldest first');
eq(details[1],['41','مصنع c-A','الدمام','الشرقية','اتصال','خدمات صيانة','عضو cs','','تم الفوز','2026-09-06 08:00','2026-09-06 09:00','لا','2026-09-06 11:00','لا','','','2026-09-06 12:00','لا','فاز'],'A: its number, customer, type, the Riyadh time of each stage and none late, won (nobody holds a finished request; the empty last cell is not written)');
eq([details[2][4],details[2][11],details[2][18],details[2][19]],['واتساب','نعم','فُقد','السعر أعلى من المنافس'],'B: the approval was late; lost, with its reason');
eq([details[3][0],details[3][4],details[3][7],details[3][8],details[3][13]],['','بريد إلكتروني','عضو sm','بانتظار تكليف المبيعات','نعم'],'C (old): no number, its registration\'s type, waiting for the sales manager, late now');
eq([details[4][4],details[4][7],details[4][11]],['غير محدد','عضو csm','نعم'],'D (oldest): «غير محدد», with the customer-service manager, late');
eq([details[6][7],details[6][8],details[6][14],details[6][15]],['عضو sup','لدى مشرف المبيعات','','نعم'],'G: with the supervisor, not delegated, late at the delegation');
ok(!JSON.stringify(book).includes('PRIVATE-NEEDS'),'the registration text never leaves');
const xml=zipText(file.bytes,'xl/worksheets/sheet3.xml');
ok(/<c r="A2" s="3"><v>41<\/v><\/c>/.test(xml),'a number is a number cell (a spreadsheet sums it)');
ok(zipText(file.bytes,'xl/worksheets/sheet1.xml').includes('rightToLeft="1"')&&zipText(file.bytes,'xl/worksheets/sheet1.xml').includes('state="frozen"'),'right to left, the head frozen');
// The reader's scope: the sales manager, the customer-service manager of the other team, another branch.
eq(sheetsOf(X.requestsReportWorkbook(ctx('sm'),'2026-09',now,'ar').bytes)[2].rows.slice(1).map(row=>row[1]),['مصنع c-A','مصنع c-B','مصنع c-C','مصنع c-G'],'the sales manager exports only what he reads (not the other team\'s E, not D before approval)');
eq(sheetsOf(X.requestsReportWorkbook(ctx('csm2'),'2026-09',now,'ar').bytes)[2].rows.slice(1).map(row=>row[1]),['مصنع c-E'],'the other customer-service manager: his team\'s request only');
const empty=sheetsOf(X.requestsReportWorkbook(ctx('csm_b'),'2026-09',now,'ar').bytes);
eq([empty[2].rows.length,empty[0].rows[2]],[1,['الطلبات','0']],'another branch: the head only, and zero');
eq(sheetsOf(X.requestsReportWorkbook(ctx('owner'),'2026-08',now,'ar').bytes)[2].rows.slice(1).map(row=>row[1]),['مصنع c-F'],'another month: its own requests');
// English.
book=sheetsOf(X.requestsReportWorkbook(ctx('owner'),'2026-09',now,'en').bytes);
eq(book.map(sheet=>sheet.name),['Summary','Stage times','Details'],'in English: the sheets');
ok(!ARABIC.test(JSON.stringify(book[1].rows))&&!ARABIC.test(JSON.stringify(book[2].rows[0]))&&!ARABIC.test(JSON.stringify(book[0].rows.filter(row=>row[0]!=='السعر أعلى من المنافس'))),'no Arabic left but what people wrote (the loss reason, names, cities)');
eq(book[2].rows[1].slice(3,9),['Eastern','Phone call','Maintenance services','عضو cs','','Won'],'the region, type, products and state in English; the names as written');
eq(book[0].rows[2],['Requests','6'],'the tiles in English');
ok(!zipText(X.requestsReportWorkbook(ctx('owner'),'2026-09',now,'en').bytes,'xl/worksheets/sheet1.xml').includes('rightToLeft'),'left to right in English');

// ---- «ب»: the complaints workbook
const base={kind:'complaint',status:'submitted',registrarId:'cs',serviceManagerId:'csm',salesManagerId:'',supervisorId:'',assigneeId:'',channel:'call',category:'product_quality',severity:'normal',description:'PRIVATE-DESCRIPTION',demand:'PRIVATE-DEMAND',reference:'INV-1',contactName:'PRIVATE-CONTACT',contactPhone:'0500000000',
 submittedAt:'',forwardedAt:'',returnedAt:'',assignedAt:'',delegatedAt:'',reassignedAt:'',rejectedAt:'',reopenedAt:'',resolvedAt:'',closedAt:'',cancelledAt:'',seenAt:'',returnNote:'',assignmentNote:'',rejectReason:'',cancelReason:'',previousAssignees:[],updates:[],notes:[],events:[]};
const update=at=>({id:'u-'+at,at,by:'rep',channel:'call',date:at.slice(0,10),text:'PRIVATE-UPDATE'});
const customers=[customer('k1','rep'),customer('k2','rep'),customer('k3','rep2'),customer('k4','rep','فرع آخر')];
const complaint=(id,createdAt,data)=>{const merged={...base,submittedAt:createdAt,...data};return {id:'complaint-'+id,branch:customers.find(c=>c.id===merged.customerId).branch,assignedTo:merged.registrarId,data:merged,createdAt,updatedAt:createdAt,version:3};};
const sales={salesManagerId:'sm',supervisorId:'sup',assigneeId:'rep'};
const complaints=[
 complaint('A',T(6,5),{complaintNumber:7,customerId:'k1',status:'closed',...sales,forwardedAt:T(6,6),assignedAt:T(6,8),updates:[update(T(6,9))],resolvedAt:T(7,5),resolution:{outcome:'solved',note:'PRIVATE',by:'rep',at:T(7,5)},closedAt:T(7,7),closure:{outcome:'satisfied',note:'PRIVATE',by:'cs',at:T(7,7),rating:5}}),
 complaint('B',T(7,5),{complaintNumber:8,customerId:'k2',status:'pending_assignment',severity:'high',channel:'whatsapp',category:'delivery_delay',salesManagerId:'sm',forwardedAt:T(7,6)}),
 complaint('C',T(8,5),{complaintNumber:9,customerId:'k3',status:'submitted',registrarId:'cs2',serviceManagerId:'csm2',channel:'email'}),
 complaint('D',T(9,5),{complaintNumber:10,customerId:'k4',status:'submitted',registrarId:'cs_b',serviceManagerId:'csm_b'}),
 complaint('E','2026-08-30T05:00:00.000Z',{complaintNumber:6,customerId:'k1',status:'cancelled',cancelledAt:'2026-08-30T06:00:00.000Z'})
];
const cctx=id=>({me:members.find(x=>x.id===id),members,all:customers,complaints});
file=X.complaintsReportWorkbook(cctx('owner'),'2026-09',now,'ar');
book=sheetsOf(file.bytes);
eq([file.fileName,book.map(sheet=>sheet.name)],['Yourrest-service-report-complaints-2026-09.xlsx',['الملخص','زمن المراحل','التفاصيل']],'the complaints file: three sheets');
eq(book[0].rows.slice(1,4),[['التقرير الشهري للشكاوى','2026-09'],['الشكاوى','4'],['مفتوحة','3']],'its tiles');
ok(['بحسب التصنيف','بحسب وسيلة الوصول','بحسب المنطقة','بحسب الأهمية','الحالة الحالية','ما عاد خطوة إلى الوراء','نتائج الحل','نتائج الإغلاق'].every(title=>book[0].rows.some(row=>row[0]===title)),'the screen\'s breakdowns');
eq(book[1].rows.slice(1).map(row=>row[0]),['المراجعة','التكليف','أول تواصل بعد التكليف','الحل من التكليف','تأكيد الإغلاق','من التسجيل إلى الإغلاق'],'its six stages');
eq(book[2].rows.slice(1).map(row=>row[0]),['7','8','9','10'],'one row per complaint of the month, by number');
eq(book[2].rows[1],['7','مصنع k1','الدمام','الشرقية','جودة المنتج أو القالب','اتصال','عادية','عضو cs','','مغلقة','2026-09-06 08:00','2026-09-06 09:00','لا','2026-09-06 11:00','لا','2026-09-06 12:00','لا','2026-09-07 08:00','لا','2026-09-07 10:00','لا','حُلّت','العميل راضٍ','5'],'A: every stage on time, the outcomes and the rating (a number)');
eq([book[2].rows[2][6],book[2].rows[2][8],book[2].rows[2][14]],['عالية','عضو sm','نعم'],'B: high, with the sales manager, the assignment late now');
ok(!JSON.stringify(book).includes('PRIVATE'),'no description, demand, contact, note or update text leaves');
eq(sheetsOf(X.complaintsReportWorkbook(cctx('csm'),'2026-09',now,'ar').bytes)[2].rows.slice(1).map(row=>row[0]),['7','8'],'the customer-service manager: his team\'s complaints only');
eq(sheetsOf(X.complaintsReportWorkbook(cctx('sm'),'2026-09',now,'ar').bytes)[2].rows.slice(1).map(row=>row[0]),['7','8'],'the sales manager: those handed to him or held by his team');
eq(sheetsOf(X.complaintsReportWorkbook(cctx('csm_b'),'2026-09',now,'ar').bytes)[2].rows.slice(1).map(row=>row[0]),['10'],'the other branch: its own');
book=sheetsOf(X.complaintsReportWorkbook(cctx('owner'),'2026-09',now,'en').bytes);
ok(!ARABIC.test(JSON.stringify([book[1].rows,book[2].rows[0],book[2].rows.map(row=>row.slice(4,7)),book[2].rows.map(row=>row.slice(9,10)),book[2].rows.map(row=>row.slice(21,23))]))&&book.map(sheet=>sheet.name).join()==='Summary,Stage times,Details','English: the labels, categories, channels, severities, states and outcomes');
eq(book[2].rows[1].slice(4,7),['Product or mold quality','Phone call','Normal'],'A in English');

// ---- the cell «تقارير خدمة العملاء · تصدير»
const key='service-reports:export';
ok(P.PERMISSION_CELLS.includes(key),'a new cell');
const row=P.permissionRow('service-reports');
eq([row.ar,row.en,Object.keys(row.cells)],['تقارير خدمة العملاء','Customer-service reports',['export']],'its row: «تصدير» only');
ok(row.part&&row.part.ar.includes('«الزيارات»')&&row.part.ar.includes('«الشكاوى»'),'it says the reports are part of «الزيارات» and «الشكاوى» (no «استعراض» of its own)');
eq(['admin','manager','customer_service_manager','supervisor','rep','customer_service'].map(role=>P.cellCeiling(role,'service-reports','export')),[true,true,true,false,false,false],'the roles the reports open for, and only those');
eq(['admin','manager','customer_service_manager'].map(role=>P.can({role,access:P.memberAccess(role,null)},'service-reports','export')),[true,true,true],'on by default for them (no saved row)');
eq(['admin','manager','customer_service_manager'].map(role=>P.can({role},'service-reports','export')),[true,true,true],'and without any access read (an old offline snapshot)');
eq(['supervisor','rep','customer_service'].map(role=>P.can({role,access:P.memberAccess(role,null)},'service-reports','export')),[false,false,false],'nobody else, whatever is saved');
eq(P.can({role:'rep',access:P.memberAccess('rep',{permissions:JSON.stringify({[key]:true}),hidden:'[]',version:2})},'service-reports','export'),false,'restrict-only: saving it on for a representative grants nothing');
for(const role of ['admin','manager','customer_service_manager']){
 const access=P.memberAccess(role,{permissions:JSON.stringify({[key]:false}),hidden:'[]',version:3});
 eq([access.off.includes(key),P.can({role,access},'service-reports','export'),P.cellRefused({role,access},'service-reports','export')],[true,false,true],role+': the administrator may switch it off');
}
ok(!P.cellFixed('admin',key),'never fixed: another administrator\'s export can be closed too');
eq(P.memberAccess('manager',{permissions:JSON.stringify({'customer:export':false}),hidden:'[]',version:5}).off.includes(key),false,'an account saved before this release (the key never written) keeps it on: no migration');
eq(P.normalizePermissions('supervisor',{cells:{[key]:true}}).cells[key],undefined,'a role without it has no such cell');
eq(P.normalizePermissions('manager',{hidden:['service-reports']}).hidden,[],'it can never be «hidden» (it is not a screen)');
let copied=P.copyPermissions({role:'manager',stored:P.normalizePermissions('manager',{cells:{[key]:false}})},'customer_service_manager');
eq(copied.stored.cells[key],false,'«انسخ الصلاحيات من»: the manager\'s closed export closes the customer-service manager\'s');
copied=P.copyPermissions({role:'manager',stored:P.normalizePermissions('manager',null)},'supervisor');
ok(copied.skipped.includes(key)&&!(key in copied.stored.cells),'copied to a supervisor: skipped and named');
eq(P.permissionKeyText(key,'ar'),'تقارير خدمة العملاء · تصدير','its words in the copy note');
eq(P.cellRefusalText('service-reports','export'),'غير مسموح لك بالتصدير في تقارير خدمة العملاء. راجع مدير النظام.','the refusal\'s words');
eq(P.pageAllowed({role:'manager',access:P.memberAccess('manager',null)},'service-reports'),false,'it is no page in the menu');
eq(P.pagesBlocked({role:'manager',access:P.memberAccess('manager',{permissions:'{}',hidden:JSON.stringify(['activity']),version:1})},['activity']),true,'hiding «الزيارات» still blocks its requests (the export of the requests report answers 404)');

console.log(JSON.stringify({ok:true,checks,pureFunctions:true,productionDataUsed:false}));

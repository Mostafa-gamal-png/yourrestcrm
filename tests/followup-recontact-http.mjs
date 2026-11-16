// «ميعاد إعادة تواصل مع الفرصة الخسرانة» (the owner, 2026-11-16, GSCO list item 8; lib/followup-recontact.ts) and «مبيعات اليوم قصاد مستهدف
// اليوم» (lib/daily-target.ts) over real HTTP against the BUILT release (run the build first):
// - POST /api/customer-followups: 401 without a session, 403 from another site and for customer service; a lost follow-up saved with a
//   re-contact date and its action (Arabic digits read), the line then open; a past date, another stage or half of it refused with 400; a
//   follow-up of before (no re-contact fields) closes the line as before.
// - GET /api/targets (the representative's «أهدافي»): the quantities sold each day of the month (their own CRM and ERP sales, a void sale and
//   another representative's left out), quantities only; 401 and 403 as before; never cached.
// Synthetic data only: temporary SQLite, mocked mail.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members=[{id:'owner',role:'admin',name:'مدير النظام'},{id:'mgr',role:'manager',name:'مدير المبيعات'},{id:'sup',role:'supervisor',sup:'mgr',name:'المشرف'},{id:'rep1',role:'rep',sup:'sup',name:'المندوب أحمد',region:'eastern'},{id:'rep2',role:'rep',sup:'sup',name:'المندوب خالد',region:'eastern'},{id:'cs',role:'customer_service',sup:'mgr',name:'خدمة العملاء'}];
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const TODAY=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date()),MONTH=TODAY.slice(0,7);
const addDays=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const arabic=value=>value.replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[d]);
const app=await bootBuiltApp({members});
try{
 const stamp='2025-01-01T00:00:00.000Z',insert=(id,kind,parent,assigned,data,created=stamp)=>app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),created,created).run();
 const open=async id=>{await insert(id,'customer',null,'rep1',{name:'مصنع '+id,region:'الشرقية'});await insert(id+'-v','activity',id,'rep1',{visitWorkflow:'customer-v1',type:'visit',date:addDays(TODAY,-3),summary:'زيارة',result:'العميل مهتم',performedBy:'rep1',responsibleId:'rep1',recordedByEmail:'rep1@yourrest.org',salesStage:'specs',nextAction:'اتصال',nextDate:addDays(TODAY,-1)},addDays(TODAY,-3)+'T08:00:00.000Z');return id+'-v';};
 const version=async id=>(await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first()).version;
 const session={};for(const m of members)session[m.id]=app.as(await app.login(m.id));const anonymous=app.as(null);
 const body=async(customerId,sourceId,data)=>({createKey:randomUUID(),customerId,customerVersion:await version(customerId),sourceId,sourceVersion:await version(sourceId),data:{type:'call',date:TODAY,result:'تحدثت مع العميل',salesStage:'lost',invoiceOutcome:'pending',nextAction:'',nextDate:'',lossReason:'السعر أعلى من المنافس',lossDetails:'',...data}});
 const post=async(who,payload,status,label)=>{const response=await (who?session[who]:anonymous)('/api/customer-followups',{method:'POST',body:payload});eq(response.status,status,label+' -> '+response.text.slice(0,300));return response.json();};
 const source=await open('c1');
 const recontact={recontactDate:arabic(addDays(TODAY,14)),recontactAction:'اتصال بعد العرض الجديد'};
 await post(null,await body('c1',source,recontact),401,'no session');
 const cross=await session.rep1('/api/customer-followups',{method:'POST',headers:{Origin:'https://evil.example'},body:await body('c1',source,recontact)});eq(cross.status,403,'from another site: 403');
 await post('cs',await body('c1',source,recontact),403,'customer service');
 for(const [fields,error] of [[{date:addDays(TODAY,-1),recontactDate:addDays(TODAY,-1),recontactAction:'اتصال'},'موعد إعادة التواصل لا يكون في الماضي.'],[{recontactDate:addDays(TODAY,5),recontactAction:''},'اكتب الإجراء عند إعادة التواصل وموعده معًا، أو اتركهما فارغين.'],[{recontactDate:addDays(TODAY,5),recontactAction:'اتصال',salesStage:'negotiation',lossReason:'',nextAction:'متابعة',nextDate:addDays(TODAY,2)},'موعد إعادة التواصل للمتابعة المفقودة فقط (مرحلة «تم الفقد»).']]){
  const result=await post('rep1',await body('c1',source,fields),400,'refused: '+JSON.stringify(fields));eq(result.error,error,'the reason');
 }
 const saved=await post('rep1',await body('c1',source,recontact),200,'a lost follow-up with a re-contact');
 const data=JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(saved.id).first()).data);
 eq([data.salesStage,data.recontact,data.nextDate,data.nextAction],['lost',true,addDays(TODAY,14),'اتصال بعد العرض الجديد'],'saved with its re-contact (Arabic digits read)');
 // The representative's records (GET /api/crm) carry it as the customer's open line.
 const crm=await session.rep1('/api/crm');eq(crm.status,200,'the records');const record=crm.json().records.find(r=>r.id===saved.id);ok(record&&record.data.recontact===true&&record.data.nextDate===addDays(TODAY,14),'the follow-up as the page reads it');
 // A follow-up of before: closed as before.
 const old=await open('c2'),legacy=await body('c2',old,{nextAction:'زيارة',nextDate:addDays(TODAY,2)});
 const closed=await post('rep1',legacy,200,'a follow-up without the re-contact fields');const cd=JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(closed.id).first()).data);eq([cd.nextDate,cd.nextAction,cd.recontact],['','',undefined],'closed, its next step cleared');
 // «أهدافي»: the quantities of each day.
 await app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind('c9','customer',null,'rep1','الرئيسي',JSON.stringify({name:'مصنع',region:'الشرقية'}),stamp,stamp).run();
 await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('erp-import-x','owner','fp-x','synthetic.xlsx','{}',?)").bind(stamp).run();
 let n=0;const sale=async(rep,date,qty,status='confirmed')=>{n++;await app.db.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'',1,?,?,?,?,?)").bind('s'+n,'c9',rep,'الرئيسي',date,'REF-'+n,'ref-'+n,JSON.stringify({items:[{product:'قوالب البلوك المتحركة',quantity:qty,unitPrice:10,description:''}],discount:0}),1000,status,'m'+n,'f'+n,'owner',stamp,stamp).run();};
 const erp=async(rep,date,qty,type='sale')=>{n++;await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,?,?,'E',?,'الرئيسي','eastern','K','عميل',?,1000,'erp-import-x','owner',?)").bind('e'+n,'d'+n,'INV-'+n,type,date,rep,JSON.stringify({items:[{product:'قوالب البلوك المتحركة',quantity:qty,unitPrice:10}],discount:0}),stamp).run();};
 await sale('rep1',TODAY,2);await erp('rep1',TODAY,3);await erp('rep1',TODAY,-1,'return');await sale('rep1',TODAY,50,'void');await sale('rep2',TODAY,9);
 const targets=async(who,query,status)=>{const response=await (who?session[who]:anonymous)('/api/targets'+query);eq(response.status,status,who+' '+query+' -> '+response.text.slice(0,200));if(status===200)eq(response.headers['cache-control'],'private, no-store','never cached');return status===200?response.json():null;};
 const own=await targets('rep1','?month='+MONTH,200);
 eq(own.sales.soldByDay[TODAY],{'قوالب البلوك المتحركة':4},'today: 2 + 3 − 1; the void sale and rep2\'s left out');
 eq(Object.keys(own.sales).sort(),['actualsAvailable','products','soldByDay','sourceMonth'],'quantities only');
 eq((await targets('rep2','?month='+MONTH,200)).sales.soldByDay[TODAY],{'قوالب البلوك المتحركة':9},'rep2 sees their own');
 await targets(null,'?month='+MONTH,401);await targets('mgr','?month='+MONTH,403);
 // The hub reads its sales and targets from GET /api/sales as before: the supervisor sees their team's sales of today.
 const hub=await session.sup('/api/sales?month='+MONTH);eq(hub.status,200,'the hub');ok(hub.json().sales.some(s=>s.date===TODAY&&s.repId==='rep2'),'today\'s sales of the team reach the hub card');
 eq((await anonymous('/api/sales?month='+MONTH)).status,401,'the hub without a session: 401');eq((await session.rep1('/api/sales?month='+MONTH)).status,403,'a representative: 403');
 console.log(JSON.stringify({ok:true,checks}));
}finally{await app.stop();}

import {z} from 'zod';
import {context,accessGuard,checkOrigin,requireSession,readJsonBody,CRMError,replyError} from '@/lib/crm-server';
import type {Member} from '@/lib/crm';
import {memberCanAccessRegion,regionScope} from '@/lib/regions';
import {AUDIT_CRITERIA,AUDIT_DELETE_DAYS,AUDIT_NOTE_MAX,KPI_MONTH,MANAGER_METRICS,REP_METRICS,SERVICE_AUDIT_KIND,SERVICE_KPI_MONTH_KIND,SERVICE_KPI_SETTINGS_ID,SERVICE_KPI_SETTINGS_KIND,auditResult,auditTotal,closedMonthFor,kpiActions,kpiManagerOf,kpiMonthOf,monthCertificate,monthCloseProblem,monthRowId,normalizeSettings,serviceKpiAllowed,serviceKpiMonth,serviceKpiView,settingsProblem,type ServiceAuditData,type ServiceKpiMonthData} from '@/lib/service-kpi';
import {loadAuditRow,loadMonthRows,loadServiceKpiInput,loadSettings} from '@/lib/service-kpi-rows';
import {loadComplaint} from '@/lib/complaint-rows';
import {loadSupportRow} from '@/lib/support-rows';
export const dynamic='force-dynamic';

/** Re-checks at commit that a member named in the change is still who they were when it was decided. */
function memberGate(m:Member){return{sql:"EXISTS(SELECT 1 FROM crm_members WHERE id=? AND role=? AND active=? AND branch=? AND COALESCE(supervisor_id,'')=? AND region_scope=?)",args:[m.id,m.role,m.active,m.branch,m.supervisorId||'',regionScope(m)]};}
/** The month is not closed for this representative, as it stands at commit: no certificate of their manager's team, none that names them. */
const openMonthGuard="NOT EXISTS(SELECT 1 FROM crm_records WHERE kind='service_kpi_month' AND json_extract(data,'$.month')=? AND json_extract(data,'$.reopened') IS NULL AND (json_extract(data,'$.managerId')=? OR EXISTS(SELECT 1 FROM json_each(json_extract(data,'$.team')) WHERE value=?)))";

const monthSchema=z.string().regex(KPI_MONTH,'اختر شهرًا صحيحًا');
/** The evaluation of a month: administrators see every group, a customer-service manager their team and himself, a representative only
 * their own card. The cases behind a figure travel only for the card asked for (a representative's own always). Read-only, never cached. */
export async function GET(req:Request){try{
 const probe=await context({load:'identity'});
 if(!serviceKpiAllowed(probe.me.role))throw new CRMError('تقييم خدمة العملاء لمدير النظام ومدير خدمة العملاء وممثليها فقط',403);
 const c=await context({load:'customers'});
 const now=new Date().toISOString(),current=kpiMonthOf(now),url=new URL(req.url);
 const month=monthSchema.parse(url.searchParams.get('month')||current);
 if(month>current)throw new CRMError('هذا الشهر لم يبدأ بعد',400);
 const detail=(url.searchParams.get('member')||'').slice(0,200);
 const customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row]));
 // A customer's name is shown only to a reader who may see that customer: their region, and their branch unless they are an administrator.
 const customerName=(id:string)=>{const customer=customers.get(id);return customer&&memberCanAccessRegion(c.me,customer.data.region)&&(c.me.role==='admin'||customer.branch===c.me.branch)?String(customer.data.name||''):'';};
 const {input,settingsVersion}=await loadServiceKpiInput(c.db,c.members);
 return Response.json(serviceKpiView(input,month,now,c.me,{customerName,detail,settingsVersion}),{headers:{'Cache-Control':'no-store'}});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400});return replyError(e);}}

const requestId=z.string().uuid(),idText=z.string().min(1).max(200),finite=z.number().finite('أدخل أرقامًا صحيحة');
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'اختر تاريخًا صحيحًا').refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'التاريخ غير صالح');
const marks=z.object(Object.fromEntries(AUDIT_CRITERIA.map(key=>[key,z.number().int('درجة كل معيار عدد صحيح')]))).strict();
const metricShape=z.object({target:finite,weight:finite,min:finite}).strict();
const settingsShape=z.object({
 hours:z.object({support:finite,missed:finite,closure:finite,review:finite}).strict(),
 life:z.object({normal:finite,high:finite}).strict(),
 rep:z.object(Object.fromEntries(REP_METRICS.map(key=>[key,metricShape]))).strict(),
 manager:z.object(Object.fromEntries(MANAGER_METRICS.map(key=>[key,metricShape]))).strict(),
 audit:z.object({criteria:z.object(Object.fromEntries(AUDIT_CRITERIA.map(key=>[key,finite]))).strict(),pass:finite,coach:finite,sample:finite}).strict(),
 closeGraceDays:finite
}).strict();
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('audit'),requestId,repId:idText,month:monthSchema,date:z.union([day,z.literal('')]).default(''),refType:z.enum(['complaint','support','service','']).default(''),refId:z.string().max(200).default(''),scores:marks,
  verification:z.object({called:z.boolean(),rating:z.number().int().min(1).max(5).nullable()}).strict().default({called:false,rating:null}),note:z.string().trim().max(AUDIT_NOTE_MAX).default('')}).strict(),
 z.object({action:z.literal('audit_delete'),requestId,id:idText}).strict(),
 z.object({action:z.literal('settings'),requestId,version:z.number().int().min(0),settings:settingsShape}).strict(),
 z.object({action:z.literal('close_month'),requestId,month:monthSchema,managerId:z.string().max(200)}).strict(),
 z.object({action:z.literal('reopen_month'),requestId,month:monthSchema,managerId:z.string().max(200)}).strict()
]);

/** Whether the work an audit points at is the representative's own: they registered or handled it. Empty when it is, otherwise why not. */
async function referenceProblem(db:D1Database,type:string,id:string,repId:string){
 if(type==='complaint'){
  const row=await loadComplaint(db,id);
  if(!row)return 'الشكوى المرجعية غير موجودة';
  return row.data.registrarId===repId||(row.data.events||[]).some(event=>event.by===repId)?'':'الشكوى المرجعية لا تخص هذا الممثل';
 }
 if(type==='support'){
  const row=await loadSupportRow(db,id);
  if(!row)return 'طلب المساندة المرجعي غير موجود';
  return row.data.handlerId===repId||row.data.result?.by===repId?'':'طلب المساندة المرجعي لا يخص هذا الممثل';
 }
 const found=await db.prepare('SELECT creator_id AS creatorId FROM crm_service_cases WHERE id=?').bind(id).first<{creatorId:string}>();
 if(!found)return 'طلب الخدمة المرجعي غير موجود';
 return found.creatorId===repId?'':'طلب الخدمة المرجعي لا يخص هذا الممثل';
}

export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const input=schema.parse(await readJsonBody(req));
 const c=await context({load:'identity'}),me=c.me;
 if(!serviceKpiAllowed(me.role))throw new CRMError('تقييم خدمة العملاء لمدير النظام ومدير خدمة العملاء وممثليها فقط',403);
 const admin=me.role==='admin',lead=me.role==='customer_service_manager';
 if(!admin&&!lead)throw new CRMError('هذا الإجراء لمدير خدمة العملاء ومدير النظام فقط',403);
 const now=new Date().toISOString(),mutation=crypto.randomUUID(),current=kpiMonthOf(now);
 const canonical=JSON.stringify(input),receiptId='service-kpi-receipt:'+me.id+':'+input.requestId;
 const replay=async()=>{
  const saved=await c.db.prepare('SELECT record_id,detail FROM crm_audit WHERE id=?').bind(receiptId).first<{record_id:string;detail:string}>();
  if(!saved)return null;
  if(saved.detail!==canonical)throw new CRMError('العملية محفوظة ببيانات مختلفة. حدّث الصفحة.',409);
  return Response.json({ok:true,id:saved.record_id,alreadySaved:true});
 };
 const repeated=await replay();if(repeated)return repeated;
 const permission=accessGuard(c),guards=[permission.sql],args:(string|number)[]=[...permission.args];
 const requireMember=(member:Member)=>{const gate=memberGate(member);guards.push(gate.sql);args.push(...gate.args);};
 const requireOpenMonth=(repId:string,managerId:string,month:string)=>{guards.push(openMonthGuard);args.push(month,managerId,repId);};
 const statements=[];let id='',revision=1,note='',targetName='',state='';const extra:Record<string,unknown>={};

 if(input.action==='audit'){
  const rep=c.members.find(member=>member.id===input.repId);
  if(!rep||rep.role!=='customer_service')throw new CRMError('اختر ممثلًا لخدمة العملاء',400);
  if(lead&&rep.supervisorId!==me.id)throw new CRMError('التدقيق لممثلي فريقك',403);
  if(input.month>current)throw new CRMError('هذا الشهر لم يبدأ بعد',400);
  const [saved,months]=await Promise.all([loadSettings(c.db),loadMonthRows(c.db)]);
  const managerId=kpiManagerOf(rep,c.members);
  if(closedMonthFor(rep.id,managerId,input.month,months))throw new CRMError('هذا الشهر مقفل لفريق الممثل',409);
  const total=auditTotal(input.scores,saved.settings);if(!total.ok)throw new CRMError(total.error,400);
  if(!input.verification.called&&input.verification.rating!==null)throw new CRMError('تقييم العميل المؤكَّد يلزمه اتصال بالعميل',400);
  if(!!input.refType!==!!input.refId)throw new CRMError('حدد نوع المرجع ومعرّفه معًا أو اترك الاثنين فارغين',400);
  if(input.refType){const problem=await referenceProblem(c.db,input.refType,input.refId,rep.id);if(problem)throw new CRMError(problem,400);}
  const data:ServiceAuditData={kind:'service_audit',repId:rep.id,month:input.month,date:input.date,reference:{type:input.refType,id:input.refId},scores:input.scores as ServiceAuditData['scores'],total:total.total,result:auditResult(total.total,saved.settings),verification:input.verification,note:input.note,auditorId:me.id,at:now};
  id='service-audit-'+input.requestId;note=input.note;targetName=rep.name;state=data.result;extra.total=data.total;extra.result=data.result;
  requireMember(rep);requireOpenMonth(rep.id,managerId,input.month);
  statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'${SERVICE_AUDIT_KIND}',NULL,?,?,?,?,?,1,? WHERE ${guards.join(' AND ')}`).bind(id,me.id,rep.branch,JSON.stringify(data),now,now,mutation,...args));
 }else if(input.action==='audit_delete'){
  const found=await loadAuditRow(c.db,input.id);
  if(!found||found.data.deleted)throw new CRMError('التدقيق غير موجود',404);
  if(!admin&&found.data.auditorId!==me.id)throw new CRMError('حذف التدقيق لمن سجّله أو لمدير النظام',403);
  if(!admin&&Date.parse(now)-Date.parse(found.data.at)>AUDIT_DELETE_DAYS*86400000)throw new CRMError(`لا يُحذف التدقيق بعد ${AUDIT_DELETE_DAYS} أيام من تسجيله`,403);
  const rep=c.members.find(member=>member.id===found.data.repId),managerId=rep?kpiManagerOf(rep,c.members):'';
  if(closedMonthFor(found.data.repId,managerId,found.data.month,await loadMonthRows(c.db)))throw new CRMError('هذا الشهر مقفل لفريق الممثل',409);
  const data:ServiceAuditData={...found.data,deleted:{at:now,by:me.id}};
  id=found.id;revision=found.version+1;targetName=rep?.name||'';state='deleted';
  requireOpenMonth(found.data.repId,managerId,found.data.month);
  statements.push(c.db.prepare(`UPDATE crm_records SET data=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND kind='${SERVICE_AUDIT_KIND}' AND ${guards.join(' AND ')}`).bind(JSON.stringify(data),now,mutation,id,found.version,...args));
 }else if(input.action==='settings'){
  if(!admin)throw new CRMError('تعديل الإعدادات لمدير النظام فقط',403);
  const settings=normalizeSettings(input.settings),problem=settingsProblem(settings);
  if(problem)throw new CRMError(problem,400);
  id=SERVICE_KPI_SETTINGS_ID;extra.version=input.version+1;
  if(input.version===0){
   statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'${SERVICE_KPI_SETTINGS_KIND}',NULL,?,?,?,?,?,1,? WHERE ${guards.join(' AND ')}`).bind(id,me.id,me.branch,JSON.stringify(settings),now,now,mutation,...args));
  }else{
   revision=input.version+1;
   statements.push(c.db.prepare(`UPDATE crm_records SET data=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND kind='${SERVICE_KPI_SETTINGS_KIND}' AND ${guards.join(' AND ')}`).bind(JSON.stringify(settings),now,mutation,id,input.version,...args));
  }
 }else if(input.action==='close_month'){
  if(input.managerId===''&&!admin)throw new CRMError('إقفال شهر الممثلين الذين بلا مدير لمدير النظام',403);
  if(lead&&input.managerId!==me.id)throw new CRMError('تُقفل أشهر فريقك فقط',403);
  const {input:kpi,settingsVersion}=await loadServiceKpiInput(c.db,c.members);
  const problem=monthCloseProblem(input.month,now,kpi.settings);
  if(problem)throw new CRMError(problem,400);
  const group=serviceKpiMonth(kpi,input.month,now).groups.find(one=>one.managerId===input.managerId);
  if(!group)throw new CRMError('لا فريق مقيَّم في هذا الشهر',404);
  if(group.closed)throw new CRMError('هذا الشهر مقفل لهذا الفريق',409);
  // What the certificate records must be what the page showed: the same settings and the same audits, the same people.
  guards.push("COALESCE((SELECT version FROM crm_records WHERE id=? AND kind='service_kpi_settings'),0)=?");args.push(SERVICE_KPI_SETTINGS_ID,settingsVersion);
  guards.push("(SELECT count(*) FROM crm_records WHERE kind='service_audit' AND json_extract(data,'$.month')=? AND json_extract(data,'$.deleted') IS NULL)=?");args.push(input.month,kpi.audits.filter(row=>!row.data.deleted&&row.data.month===input.month).length);
  const manager=group.managerId?c.members.find(member=>member.id===group.managerId):undefined;if(manager)requireMember(manager);
  for(const card of group.reps){const rep=c.members.find(member=>member.id===card.memberId);if(rep)requireMember(rep);}
  const data=monthCertificate(group,input.month,me.id,now);
  id=monthRowId(group.managerId,input.month);targetName=group.managerName;state='closed';note=input.month;
  const existing=kpi.closed.find(row=>row.id===id);
  if(existing){
   revision=existing.version+1;
   statements.push(c.db.prepare(`UPDATE crm_records SET data=?,assigned_to=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND kind='${SERVICE_KPI_MONTH_KIND}' AND ${guards.join(' AND ')}`).bind(JSON.stringify(data),me.id,now,mutation,id,existing.version,...args));
  }else{
   statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'${SERVICE_KPI_MONTH_KIND}',NULL,?,?,?,?,?,1,? WHERE ${guards.join(' AND ')}`).bind(id,me.id,manager?.branch||me.branch,JSON.stringify(data),now,now,mutation,...args));
  }
 }else{
  if(!admin)throw new CRMError('إعادة فتح الشهر لمدير النظام فقط',403);
  id=monthRowId(input.managerId,input.month);
  const found=(await loadMonthRows(c.db)).find(row=>row.id===id&&!row.data.reopened);
  if(!found)throw new CRMError('هذا الشهر غير مقفل لهذا الفريق',404);
  const data:ServiceKpiMonthData={...found.data,reopened:{at:now,by:me.id}};
  revision=found.version+1;targetName=c.members.find(member=>member.id===input.managerId)?.name||'';state='reopened';note=input.month;
  statements.push(c.db.prepare(`UPDATE crm_records SET data=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND kind='${SERVICE_KPI_MONTH_KIND}' AND ${guards.join(' AND ')}`).bind(JSON.stringify(data),now,mutation,id,found.version,...args));
 }
 const gate='EXISTS(SELECT 1 FROM crm_records WHERE id=? AND version=? AND mutation_id=?)',ga=[id,revision,mutation];
 statements.push(c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,id,me.name,'service-kpi-receipt',canonical,now,...ga));
 statements.push(c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),id,me.name,'service-kpi:'+input.action,JSON.stringify({label:kpiActions[input.action],note,targetName,state}),now,...ga));
 let result;try{result=await c.db.batch(statements);}catch(e){const again=await replay();if(again)return again;throw e;}
 if(result[0].meta.changes!==1){
  const again=await replay();if(again)return again;
  throw new CRMError(input.action==='settings'?'تغيّرت الإعدادات. حدّث الصفحة وأعد المحاولة.':input.action==='close_month'?'تغيّرت بيانات الفريق أو الإعدادات أو التدقيقات أثناء الإقفال. حدّث الصفحة وأعد المحاولة.':'تغيّرت البيانات أو الصلاحيات أثناء الحفظ. حدّث الصفحة.',409);
 }
 return Response.json({ok:true,id,...extra});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(issue=>issue.message).join(' • ')},{status:400});return replyError(e);}}

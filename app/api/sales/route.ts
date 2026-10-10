import {readJsonBody} from '@/lib/crm-server';
import {canonicalInvoiceReference} from '@/lib/invoice-reference';
import {erpInvoiceKey,readErpSales} from '@/lib/erp-sales-server';
import {requireSalesWorkspace} from '@/lib/crm-server';
import {regionScope,memberCanAccessRegion} from '@/lib/regions';
import {kpiData} from '@/lib/kpis-server';
import {targetState} from '@/lib/targets-server';
import {effectiveSet,quantityAttainment,defaultActivityTargets,type ActivityTargets} from '@/lib/targets';
import { z } from 'zod';
import { context, CRMError, replyError, checkOrigin, accessGuard } from '@/lib/crm-server';
import { today } from '@/lib/crm';
import { monthSchema, saleSchema, salesTotals, salesMemberIds, salesReadMemberIds, salesReportingRecords, repPerformance, type Sale } from '@/lib/sales';
export const dynamic = 'force-dynamic';
const selectSales = `SELECT s.*,c.data AS customer_data FROM crm_sales s JOIN crm_records c ON c.id=s.customer_id`;
function saleRow(r: any): Sale { return { ...JSON.parse(r.data), id:r.id, customerId:r.customer_id, customerName:JSON.parse(r.customer_data).name, repId:r.rep_id, branch:r.branch, date:r.date, reference:r.reference, totalCents:r.total_cents, status:r.status, voidReason:r.void_reason, version:r.version, createdBy:r.created_by, createdAt:r.created_at, updatedAt:r.updated_at }; }
function errorResponse(e: unknown) { if(e instanceof z.ZodError) return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400}); if(String(e).includes('crm_sales.customer_id, crm_sales.reference_key')) return Response.json({error:'مرجع البيع مسجل بالفعل لهذا العميل'},{status:409}); return replyError(e); }
export async function GET(req:Request){try{
 const c=await context(), month=monthSchema.parse(new URL(req.url).searchParams.get('month') || today().slice(0,7));
 requireSalesWorkspace(c.me);const allowed=salesReadMemberIds(c.members,c.me);
 const raw=(await c.db.prepare(selectSales+' WHERE s.date>=? AND s.date<=? ORDER BY s.date DESC,s.created_at DESC,s.id').bind(month+'-01',month+'-31').all<any>()).results;
 const salesForPerformance=[...raw.filter(r=>allowed.has(r.rep_id)&&c.regionCustomerIds.has(r.customer_id)).map(saleRow),...await readErpSales(c,month)].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
 const sales=salesForPerformance;
 const targets=await targetState(c,month,salesForPerformance),reportRecords=salesReportingRecords(c.visible,c.members);
 const regionalIds=new Set(c.regionalMembers.map(m=>m.id)),factIds=new Set([...salesForPerformance.map(s=>s.repId),...reportRecords.filter(r=>r.kind==='activity').map(r=>r.data.performedBy||r.data.responsibleId),...targets.sets.flatMap(s=>s.teamMemberIds||[])]);
 const members=c.members.filter(m=>allowed.has(m.id)&&(regionalIds.has(m.id)||factIds.has(m.id))).map(m=>regionalIds.has(m.id)?({...m,userId:undefined}):({...m,email:'',branch:'',supervisorId:undefined,target:0,userId:undefined,readOnly:true}));
 // Aggregate by the authenticated recorder, independently of subsequent customer reassignment.
 const individualPerformance=members.map(m=>repPerformance(m,month,reportRecords,salesForPerformance));
 const performance=members.map(m=>{const activity=effectiveSet<ActivityTargets>(targets,'activity',m.id),quantity=effectiveSet(targets,'sales',m.id),sourceMemberIds=activity?.computed?activity.teamMemberIds||[]:[m.id],salesSourceMemberIds=quantity?.computed?quantity.teamMemberIds||[]:[m.id];return {...repPerformance(m,month,reportRecords,salesForPerformance,sourceMemberIds,salesSourceMemberIds),sourceMemberIds,salesSourceMemberIds,teamRollup:!!quantity?.computed,activityTeamRollup:!!activity?.computed,activityTargetsKnown:!m.readOnly&&!activity?.incomplete,activityTargets:activity?.data||defaultActivityTargets,activitySource:activity?.computed?null:activity?.month||null,attainment:quantityAttainment(m.id,targets,salesForPerformance)};}).filter(p=>['rep','manager','supervisor'].includes(p.member.role)||p.contacts||p.invoices||targets.sets.some(s=>s.scopeId===p.member.id));
 const kpis=new URL(req.url).searchParams.get('kpis')==='1'?await kpiData(c,month,performance,targets):null;
 return Response.json({sales,targets,performance,individualPerformance,members,kpis},{headers:{'Cache-Control':'no-store'}});
}catch(e){return errorResponse(e);}}
export async function POST(req:Request){try{
 checkOrigin(req);const body:any=await readJsonBody(req);if(JSON.stringify(body).length>100000)throw new CRMError('حجم الطلب كبير');
 const c=await context(), now=new Date().toISOString(), mutation=crypto.randomUUID(), allowed=salesMemberIds(c.members,c.me), manage=['admin','manager'].includes(c.me.role);
 requireSalesWorkspace(c.me);const version=z.number().int().min(0).parse(body.version ?? 0);
 if(!['save','void'].includes(body.action))throw new CRMError('عملية غير صحيحة');
 const raw=body.id?await c.db.prepare(selectSales+' WHERE s.id=?').bind(String(body.id)).first<any>():null;
 const old=raw?saleRow(raw):undefined;
 if(body.id&&(!old||!c.regionCustomerIds.has(old.customerId)||!allowed.has(old.repId)))throw new CRMError('سجل المبيعات غير متاح',404);
 if(body.action==='void'){
  if(!old)throw new CRMError('حدد سجل المبيعات');
  const reason=z.string().trim().min(1,'اكتب سبب الإلغاء').max(500).parse(body.reason);
  if(old.status==='void'&&old.voidReason===reason)return Response.json({ok:true});
  if(old.status==='void')throw new CRMError('هذا البيع ملغى بالفعل');
  const owner=c.members.find(m=>m.id===old.repId)!,permission=accessGuard(c,c.all.find(r=>r.id===old.customerId));
  const result=await c.db.batch([c.db.prepare("UPDATE crm_sales SET status='void',void_reason=?,version=version+1,updated_at=?,mutation_id=? WHERE id=? AND version=? AND status='confirmed' AND EXISTS(SELECT 1 FROM crm_members WHERE id=? AND role=? AND branch=? AND active=? AND COALESCE(supervisor_id,'')=?) AND "+permission.sql).bind(reason,now,mutation,old.id,version,owner.id,owner.role,owner.branch,owner.active,owner.supervisorId||'',...permission.args),c.db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_sales WHERE id=? AND mutation_id=?)").bind(crypto.randomUUID(),old.customerId,c.me.name,'إلغاء بيع',old.reference+' · '+reason,now,old.id,mutation)]);
  if(result[0].meta.changes!==1)throw new CRMError('تغيّر سجل المبيعات. حدّث الصفحة وأعد المحاولة.',409);
  return Response.json({ok:true});
 }
 if(old&&(old.version!==version||old.status==='void'))throw new CRMError('تغيّر سجل المبيعات أو تم إلغاؤه. حدّث الصفحة.',409);
 const data=saleSchema.parse(body.data);
 if(data.date>today())throw new CRMError('تاريخ البيع لا يمكن أن يكون في المستقبل');
 if(old&&data.customerId!==old.customerId)throw new CRMError('لا يمكن تغيير عميل فاتورة محفوظة');
 const customer=c.visible.find(r=>r.id===data.customerId&&r.kind==='customer');
 if(!customer)throw new CRMError('العميل غير متاح',404);
 const rep=c.members.find(m=>m.id===data.repId);
 if(!rep||!allowed.has(rep.id)||(!rep.active&&(!old||old.repId!==rep.id)))throw new CRMError('حدد مندوبًا متاحًا');
 if(!memberCanAccessRegion(rep,customer.data.region))throw new CRMError('منطقة العميل لا تطابق صلاحية مندوب البيع',403);
 if(!['admin','manager'].includes(rep.role)&&rep.branch!==customer.branch)throw new CRMError('المندوب يجب أن يكون في فرع العميل');
 if(!manage&&data.repId!==c.me.id&&c.me.role!=='supervisor')throw new CRMError('لا يمكنك تسجيل مبيعات لمستخدم آخر',403);
 const fingerprint=JSON.stringify(data), id=old?.id||'sale-'+z.string().uuid().parse(body.createKey), refKey=canonicalInvoiceReference(data.reference);
 if(!refKey)throw new CRMError('أدخل رقم الفاتورة أو مرجع البيع');
 if(!old){const replay=await c.db.prepare('SELECT id,create_fingerprint,created_by FROM crm_sales WHERE id=?').bind(id).first<any>();if(replay){if(replay.created_by!==c.me.id)throw new CRMError('سجل المبيعات غير متاح',404);if(replay.create_fingerprint!==fingerprint)throw new CRMError('البيع محفوظ بالفعل ببيانات مختلفة. حدّث الصفحة.',409);return Response.json({ok:true,id,alreadySaved:true});}}
 // Old rows may predate reference normalization. Check their display references
 // without rewriting/deleting history, and bind this read to the atomic write.
 const revision=await c.db.prepare("SELECT revision FROM crm_erp_import_state WHERE id='yourrest-industries'").first<{revision:number}>();
 if(!revision)throw new CRMError('تحديث قاعدة بيانات المبيعات غير مكتمل.',503);
 const references=(await c.db.prepare('SELECT reference FROM crm_sales WHERE customer_id=? AND id<>?').bind(customer.id,id).all<{reference:string}>()).results;
 const duplicate=references.some(row=>canonicalInvoiceReference(row.reference)===refKey);
 if(duplicate)throw new CRMError('مرجع البيع مسجل بالفعل لهذا العميل',409);
 const erpKey=await erpInvoiceKey(data.reference,data.date);
 if(await c.db.prepare('SELECT 1 FROM crm_erp_sales WHERE document_key=?').bind(erpKey).first())throw new CRMError('هذه الفاتورة مستوردة من ERP بالفعل؛ لا يمكن تسجيلها مرة أخرى يدويًا',409);
 const totals=salesTotals(data.items,data.discount);
 // Recheck customer version in the write to prevent a concurrent reassignment/deletion.
 const permission=accessGuard(c,customer);
 const priorRep=old?c.members.find(m=>m.id===old.repId):undefined;
 const priorRepGate=priorRep?" AND EXISTS(SELECT 1 FROM crm_members WHERE id=? AND role=? AND COALESCE(supervisor_id,'')=?)":'',priorRepArgs=priorRep?[priorRep.id,priorRep.role,priorRep.supervisorId||'']:[];
 const customerGate='EXISTS(SELECT 1 FROM crm_records WHERE id=? AND kind=\'customer\' AND version=?) AND '+permission.sql+priorRepGate;
 const repGate="EXISTS(SELECT 1 FROM crm_members WHERE id=? AND role=? AND branch=? AND active=? AND COALESCE(supervisor_id,'')=? AND region_scope=?) AND NOT EXISTS(SELECT 1 FROM crm_erp_sales WHERE document_key=?) AND EXISTS(SELECT 1 FROM crm_erp_import_state WHERE id='yourrest-industries' AND revision=?)";
 const write=old?c.db.prepare(`UPDATE crm_sales SET rep_id=?,branch=?,date=?,reference=?,reference_key=?,data=?,total_cents=?,version=version+1,updated_at=?,mutation_id=? WHERE id=? AND version=? AND ${customerGate} AND ${repGate}`).bind(rep.id,customer.branch,data.date,data.reference,refKey,JSON.stringify(data),totals.totalCents,now,mutation,id,version,customer.id,customer.version,...permission.args,...priorRepArgs,rep.id,rep.role,rep.branch,rep.active,rep.supervisorId||'',regionScope(rep),erpKey,revision.revision):c.db.prepare(`INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,'confirmed','',1,?,?,?,?,? WHERE ${customerGate} AND ${repGate} ON CONFLICT(id) DO NOTHING`).bind(id,customer.id,rep.id,customer.branch,data.date,data.reference,refKey,JSON.stringify(data),totals.totalCents,mutation,fingerprint,c.me.id,now,now,customer.id,customer.version,...permission.args,...priorRepArgs,rep.id,rep.role,rep.branch,rep.active,rep.supervisorId||'',regionScope(rep),erpKey,revision.revision);
 const result=await c.db.batch([write,c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_sales WHERE id=? AND mutation_id=?)').bind(crypto.randomUUID(),customer.id,c.me.name,old?'تعديل بيع':'تسجيل بيع',data.reference+' · '+String(totals.totalCents/100)+' ر.س',now,id,mutation)]);
 if(result[0].meta.changes!==1){if(!old){const replay=await c.db.prepare('SELECT id,create_fingerprint,created_by FROM crm_sales WHERE id=?').bind(id).first<any>();if(replay?.create_fingerprint===fingerprint&&replay.created_by===c.me.id)return Response.json({ok:true,id,alreadySaved:true});}throw new CRMError('تغيّر العميل أو سجل المبيعات. حدّث الصفحة وأعد المحاولة.',409);}
 return Response.json({ok:true,id});
}catch(e){return errorResponse(e);}}

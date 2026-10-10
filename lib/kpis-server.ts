import {z} from 'zod';
import {regionScope} from './regions';
import {context,CRMError,accessGuard} from './crm-server';
import {today} from './crm';
import {type Sale,monthSchema,salesReadMemberIds,salesReportingRecords} from './sales';
import {calculateKpis,prepareKpiRecords,kpiPeriod,kpiInputSchema,type KpiAssessment,type KpiData,type KpiPerformance} from './kpis';
import {readErpSales} from './erp-sales-server';
import {readKpiEvidenceRows,readSalesRevision} from './kpi-evidence-server';
import {evidenceScopeKey,type KpiEvidenceContext} from './kpi-evidence';
import {readKpiPurchaseHistory,isKpiIssuedQuote,isValidKpiConversion} from './kpi-history-server';
import {effectiveSet,defaultActivityTargets,type ActivityTargets,type TargetState} from './targets';
type Context=Awaited<ReturnType<typeof context>>;
export async function kpiData(c:Context,month:string,performance:KpiPerformance[],targets?:TargetState):Promise<KpiData>{
 const period=kpiPeriod(month),allowed=salesReadMemberIds(c.members,c.me);
 const salesRevision=await readSalesRevision(c);
 const evidenceRevision=(await c.db.prepare("SELECT revision FROM crm_kpi_evidence_state WHERE id='company'").first<{revision:number}>())?.revision||0;
 const [assessmentRows,saleRows,currentErp,previousErp,evidenceRows]=await Promise.all([
  c.db.prepare('SELECT a.*,m.name AS author FROM crm_kpi_assessments a LEFT JOIN crm_members m ON m.id=a.updated_by WHERE a.month=?').bind(month).all<any>(),
  c.db.prepare("SELECT * FROM crm_sales WHERE date>=? AND date<=? AND status='confirmed'").bind(period.previousFirst,period.cutoff).all<any>(),
  readErpSales(c,month),readErpSales(c,period.previousFirst.slice(0,7)),readKpiEvidenceRows(c,month)
 ]);
 const sales:Sale[]=[...saleRows.results.filter(r=>allowed.has(r.rep_id)&&c.regionCustomerIds.has(r.customer_id)).map(r=>({...JSON.parse(r.data),id:r.id,repId:r.rep_id,customerId:r.customer_id,totalCents:r.total_cents,status:r.status,date:r.date})),...currentErp,...previousErp].filter(s=>s.date>=period.previousFirst&&s.date<=period.cutoff);
 const evidenceByMember=new Map(evidenceRows.map(row=>[row.memberId,row]));
 const history=evidenceRows.some(row=>row.input.history.complete)?await readKpiPurchaseHistory(c,month):{facts:[],unresolved:new Set<string>()};
 const records=salesReportingRecords(c.visible,c.members),prepared=prepareKpiRecords(records,month);
 const people=performance.filter(p=>allowed.has(p.member.id)).map(p=>{
  const r=assessmentRows.results.find(row=>row.member_id===p.member.id&&c.regionalMembers.some(m=>m.id===p.member.id));
  const assessment:KpiAssessment|null=r?{memberId:r.member_id,month:r.month,input:kpiInputSchema.parse(JSON.parse(r.input)),version:r.version,updatedBy:r.author||'',updatedAt:r.updated_at}:null;
  const ids=[...new Set(p.salesSourceMemberIds)].filter(id=>allowed.has(id)),idSet=new Set(ids);
  const sources=ids.map(id=>({id,member:c.members.find(m=>m.id===id),row:evidenceByMember.get(id)}));
  const scoped=sources.length>0&&sources.every(source=>source.row&&source.member&&source.row.scopeKey===evidenceScopeKey(source.member));
  const current=scoped&&sources.every(source=>source.row!.salesRevision===salesRevision&&source.row!.cutoff===period.cutoff);
  const identitiesKnown=ids.every(id=>!history.unresolved.has(id));
  const historyComplete=!!current&&identitiesKnown&&sources.every(source=>source.row!.input.history.complete);
  const collectionsKnown=scoped&&sources.every(source=>source.row!.input.collection.dueCents!==null&&source.row!.input.collection.collectedCents!==null);
  const collection=collectionsKnown?sources.reduce((sum,source)=>({dueCents:sum.dueCents+source.row!.input.collection.dueCents!,collectedCents:sum.collectedCents+source.row!.input.collection.collectedCents!}),{dueCents:0,collectedCents:0}):null;
  const selectedQuotes=sources.flatMap(source=>(source.row?.input.quotations||[]).map(link=>({...link,repId:source.id})));
  const quotationsValid=selectedQuotes.every(link=>{
   const quote=c.regionalRecords.find(row=>row.id===link.quoteId);
   return !!quote&&isKpiIssuedQuote(quote,month)&&(!link.saleId||isValidKpiConversion(c,link.quoteId,link.saleId,link.repId,month,sales));
  })&&new Set(selectedQuotes.map(link=>link.quoteId)).size===selectedQuotes.length;
  const recoveryTarget=targets&&ids.length?ids.reduce((sum,id)=>sum+(effectiveSet<ActivityTargets>(targets,'activity',id)?.data||defaultActivityTargets).recoveredCustomers,0):p.activityTargetsKnown===false?null:p.activityTargets.recoveredCustomers;
  const evidence:KpiEvidenceContext={historyComplete,collection:collection&&Number.isSafeInteger(collection.dueCents)&&Number.isSafeInteger(collection.collectedCents)?collection:null,
   purchases:history.facts.filter(fact=>idSet.has(fact.repId)).map(({customerKey,date,netCents,hasSale})=>({customerKey,date,netCents,hasSale})),
   quotationsComplete:!!current&&quotationsValid&&sources.every(source=>source.row!.input.quotationsComplete),
   quotations:selectedQuotes.map(link=>({quoteId:link.quoteId,converted:!!link.saleId&&isValidKpiConversion(c,link.quoteId,link.saleId,link.repId,month,sales)})),recoveryTarget,
   invalidHistoryReason:!identitiesKnown?'توجد فواتير بدون رقم عميل أو أرقام عملاء مكررة بين مصادر المبيعات؛ راجع هوية العملاء أولًا.':!current?'أكّد اكتمال سجل المبيعات للفترة بعد آخر تحديث للبيانات.':'أكّد اكتمال سجل المبيعات لثلاثة أشهر سابقة وفترة التقييم.'};
  return calculateKpis(p,month,records,sales,assessment,prepared,evidence);
 });
 // Reject mixed snapshots or a response captured before access was revoked.
 const guard=accessGuard(c);
 const memberSnapshot=JSON.stringify(c.members.map(m=>[m.id,m.role,m.branch,m.supervisorId||'',regionScope(m),m.active,m.authVersion||0]));
 const membersGate=`(SELECT COUNT(*) FROM crm_members)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN crm_members actual ON actual.id=json_extract(expected.value,'$[0]') WHERE actual.id IS NULL OR actual.role IS NOT json_extract(expected.value,'$[1]') OR actual.branch IS NOT json_extract(expected.value,'$[2]') OR COALESCE(actual.supervisor_id,'') IS NOT json_extract(expected.value,'$[3]') OR actual.region_scope IS NOT json_extract(expected.value,'$[4]') OR actual.active IS NOT json_extract(expected.value,'$[5]') OR actual.auth_version IS NOT json_extract(expected.value,'$[6]'))`;
 const [currentSales,currentEvidence,access]=await Promise.all([readSalesRevision(c),c.db.prepare("SELECT revision FROM crm_kpi_evidence_state WHERE id='company'").first<{revision:number}>(),c.db.prepare("SELECT EXISTS(SELECT 1 FROM crm_customer_identity_state WHERE id='company' AND revision=?) AS identityCurrent WHERE "+guard.sql+' AND '+membersGate).bind(c.customerIdentityState.revision,...guard.args,c.members.length,memberSnapshot).first<{identityCurrent:number}>()]);
 if(!access)throw new CRMError('تغيّرت صلاحيات حسابك. أعد تسجيل الدخول.',403);
 if(!access.identityCurrent)throw new CRMError('تغيّر ربط أكواد العملاء. حدّث الصفحة وأعد المراجعة.',409);
 if(currentSales!==salesRevision||(currentEvidence?.revision||0)!==evidenceRevision)throw new CRMError('تغيّرت بيانات التقييم أثناء التحميل. حدّث الصفحة.',409);
 return{month,period,people,canManage:['admin','manager'].includes(c.me.role)};
}
const saveSchema=z.object({memberId:z.string().min(1).max(200),month:monthSchema,version:z.number().int().min(0),requestId:z.string().uuid(),input:kpiInputSchema}).strict();
export async function saveKpi(c:Context,body:unknown){
 if(!['admin','manager'].includes(c.me.role))throw new CRMError('تقييم الإدارة متاح لمدير النظام ومدير المبيعات فقط',403);
 const p=saveSchema.parse(body);if(p.month>today().slice(0,7))throw new CRMError('لا يمكن تقييم شهر قادم');
 if(!salesReadMemberIds(c.members,c.me).has(p.memberId)||!c.regionalMembers.some(m=>m.id===p.memberId&&['admin','manager','supervisor','rep'].includes(m.role)))throw new CRMError('حدد عضوًا متاحًا ضمن صلاحيتك للتقييم',404);
 const mutation='kpi:'+c.me.id+':'+p.requestId,canonical=JSON.stringify({...p,requestId:undefined}),replay=async()=>{const r=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(mutation).first<{detail:string}>();if(!r)return false;if(r.detail!==canonical)throw new CRMError('طلب التقييم محفوظ ببيانات مختلفة. أعد فتح التقييم.',409);return true;};
 if(await replay())return{ok:true};
 const old=await c.db.prepare('SELECT version FROM crm_kpi_assessments WHERE member_id=? AND month=?').bind(p.memberId,p.month).first<{version:number}>();
 const conflict=()=>new CRMError('تغيّر التقييم. حدّث البيانات وأعد فتحه قبل الحفظ.',409);if((old?.version||0)!==p.version){if(await replay())return{ok:true};throw conflict();}
 const permission=accessGuard(c),target=c.members.find(m=>m.id===p.memberId)!,gate=permission.sql+" AND EXISTS(SELECT 1 FROM crm_members WHERE id=? AND active=? AND region_scope=? AND role=? AND COALESCE(supervisor_id,'')=?)",args=[...permission.args,p.memberId,target.active,regionScope(target),target.role,target.supervisorId||''],now=new Date().toISOString(),json=JSON.stringify(p.input);
 const claim=old?c.db.prepare('UPDATE crm_kpi_assessments SET input=?,version=version+1,mutation_id=?,updated_by=?,updated_at=? WHERE member_id=? AND month=? AND version=? AND '+gate).bind(json,mutation,c.me.id,now,p.memberId,p.month,p.version,...args):c.db.prepare('INSERT INTO crm_kpi_assessments(member_id,month,input,version,mutation_id,updated_by,updated_at) SELECT ?,?,?,1,?,?,? WHERE '+gate+' ON CONFLICT(member_id,month) DO NOTHING').bind(p.memberId,p.month,json,mutation,c.me.id,now,...args);
 let result;try{result=await c.db.batch([claim,c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1').bind(mutation,'kpi-'+p.memberId,c.me.name,'تسجيل تقييم الأداء',canonical,now)]);}catch(e){if(await replay())return{ok:true};throw e;}
 if(result[0].meta.changes!==1){if(await replay())return{ok:true};throw conflict();}return{ok:true};
}

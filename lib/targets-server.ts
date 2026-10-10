import {regionScope} from './regions';
import {kpiPeriod} from './kpis';
import {context,CRMError,accessGuard} from './crm-server';
import {salesReadMemberIds,salesReportingRecords,type Sale} from './sales';
import {type TargetSet,type TargetState,type TargetKind,targetSaveSchema,quantityTargetsSchema,productWeightsSchema,activityTargetsSchema,withManagerTargets} from './targets';
import {readErpSales} from './erp-sales-server';
type Context=Awaited<ReturnType<typeof context>>;
export async function targetState(c:Context,month:string,sales:Sale[]=[]):Promise<TargetState>{
 const roleAllowed=salesReadMemberIds(c.members,c.me),allowed=new Set(c.regionalMembers.filter(m=>roleAllowed.has(m.id)).map(m=>m.id)),global=regionScope(c.me)==='all',manage=['admin','manager'].includes(c.me.role);
 const raw=(await c.db.prepare('SELECT * FROM crm_target_sets WHERE month<=? ORDER BY month DESC').bind(month).all<any>()).results;
 const branches=Array.from(new Set([...c.regionalMembers.map(m=>m.branch),...c.visible.filter(r=>r.kind==='customer').map(r=>r.branch)])).filter(Boolean).filter(b=>manage||b===c.me.branch).sort();
 const seen=new Set<string>();const sets:TargetSet[]=[];
 for(const r of raw){if(r.kind!=='weights'&&!allowed.has(r.scope_id)&&!(manage&&global&&r.kind==='sales'&&branches.some(b=>'branch:'+b===r.scope_id)))continue;const key=r.kind+':'+r.scope_id;if(seen.has(key))continue;seen.add(key);sets.push({kind:r.kind,scopeId:r.scope_id,month:r.month,data:JSON.parse(r.data),version:r.version,updatedAt:r.updated_at});}
 const period=kpiPeriod(month),formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
 const priorSales=(await c.db.prepare("SELECT rep_id,customer_id FROM crm_sales WHERE status='confirmed' AND date>=? AND date<=?").bind(period.previousFirst,period.previousEnd).all<{rep_id:string;customer_id:string}>()).results;
 const priorErp=await readErpSales(c,period.previousFirst.slice(0,7));
 const creators=c.visible.filter(r=>{if(r.kind!=='customer'||r.data.sourceFile||!r.data._createdBy||!r.createdAt)return false;const date=formatter.format(new Date(r.createdAt));return date>=period.first&&date<=period.cutoff;}).map(r=>String(r.data._createdBy));
 // Keep comparison-period sellers and customer creators in the team's KPI sources,
 // even when they have no visit or invoice in the selected month.
 const recordedMemberIds=[...sales.filter(s=>s.status==='confirmed'&&s.date.startsWith(month)).map(s=>s.repId),...priorSales.filter(s=>roleAllowed.has(s.rep_id)&&c.regionCustomerIds.has(s.customer_id)).map(s=>s.rep_id),...priorErp.filter(s=>s.date<=period.previousEnd).map(s=>s.repId),...creators.filter(id=>roleAllowed.has(id)),...salesReportingRecords(c.visible,c.members).filter(r=>r.kind==='activity'&&String(r.data.date||'').startsWith(month)).map(r=>String(r.data.performedBy||r.data.responsibleId||''))];
 const result=withManagerTargets({month,sets,branches},c.members.filter(m=>roleAllowed.has(m.id)),recordedMemberIds,global?undefined:allowed);return{...result,sets:result.sets.filter(s=>s.kind==='weights'||allowed.has(s.scopeId)||global&&s.scopeId.startsWith('branch:'))};
}
export async function saveTargetSet(c:Context,body:unknown){
 if(!['admin','manager'].includes(c.me.role))throw new CRMError('تعديل المستهدفات متاح للإدارة فقط',403);
 const p=targetSaveSchema.parse(body);if(p.kind!=='weights'&&!p.scopeId.startsWith('branch:')&&!salesReadMemberIds(c.members,c.me).has(p.scopeId))throw new CRMError('المستهدف خارج نطاق فريقك',403);if(regionScope(c.me)!=='all'&&(p.kind==='weights'||p.scopeId.startsWith('branch:')||!c.regionalMembers.some(m=>m.id===p.scopeId)))throw new CRMError('المستهدف خارج نطاق منطقتك',403);const data=p.kind==='sales'?quantityTargetsSchema.parse(p.data):p.kind==='weights'?productWeightsSchema.parse(p.data):activityTargetsSchema.parse(p.data);
 if(p.kind==='weights'&&p.scopeId!=='company')throw new CRMError('نطاق الأوزان غير صحيح');
 if(p.kind!=='weights'){
  if(p.kind==='sales'&&p.scopeId.startsWith('branch:')){const branch=p.scopeId.slice(7);if(!c.members.some(m=>m.branch===branch)&&!c.all.some(r=>r.kind==='customer'&&r.branch===branch))throw new CRMError('الفرع غير موجود',404);}
  else if(!c.members.some(m=>m.id===p.scopeId&&m.active&&['admin','manager','supervisor','rep'].includes(m.role)))throw new CRMError('حدد مستخدمًا مفعّلًا',400);
  else if(c.members.some(m=>m.id===p.scopeId&&(m.role==='manager'||p.kind==='sales'&&m.role==='supervisor')))throw new CRMError('مستهدف المبيعات للمدير والمشرف يُحسب تلقائيًا من إجمالي مستهدفات الفريق.');
 }
 const canonical=JSON.stringify({...p,data,requestId:undefined}),mutation='target-set:'+c.me.id+':'+p.requestId;
 const replay=async()=>{const row=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(mutation).first<{detail:string}>();if(!row)return false;if(row.detail!==canonical)throw new CRMError('طلب المستهدف محفوظ ببيانات مختلفة. حدّث الصفحة.',409);return true;};
 if(await replay())return{ok:true};
 const old=await c.db.prepare('SELECT version FROM crm_target_sets WHERE kind=? AND scope_id=? AND month=?').bind(p.kind,p.scopeId,p.month).first<{version:number}>();
 const conflict=()=>new CRMError('تغيّرت المستهدفات أو مصدرها. حدّث الصفحة وأعد المحاولة.',409);
 if((old?.version||0)!==p.version){if(await replay())return{ok:true};throw conflict();}
 const inherited=p.inheritedFrom,sourceGuard=inherited?'EXISTS(SELECT 1 FROM crm_target_sets WHERE kind=? AND scope_id=? AND month=? AND version=?) AND NOT EXISTS(SELECT 1 FROM crm_target_sets WHERE kind=? AND scope_id=? AND month>? AND month<?)':'NOT EXISTS(SELECT 1 FROM crm_target_sets WHERE kind=? AND scope_id=? AND month<?)';
 const sourceArgs=inherited?[p.kind,p.scopeId,inherited.month,inherited.version,p.kind,p.scopeId,inherited.month,p.month]:[p.kind,p.scopeId,p.month];
 const permission=accessGuard(c),actorGate=permission.sql;
 const memberScope=p.kind!=='weights'&&!p.scopeId.startsWith('branch:');
 const scopeGate=memberScope?(p.kind==='sales'?" AND EXISTS(SELECT 1 FROM crm_members WHERE id=? AND active=1 AND role IN ('admin','rep') AND region_scope=? AND role=? AND COALESCE(supervisor_id,'')=?)":" AND EXISTS(SELECT 1 FROM crm_members WHERE id=? AND active=1 AND role IN ('admin','supervisor','rep') AND region_scope=? AND role=? AND COALESCE(supervisor_id,'')=?)"):'';
 const member=c.members.find(m=>m.id===p.scopeId);const gateArgs=memberScope?[...permission.args,p.scopeId,regionScope(member!),member!.role,member!.supervisorId||'']:permission.args;
 const now=new Date().toISOString(),json=JSON.stringify(data);
 const write=old?c.db.prepare('UPDATE crm_target_sets SET data=?,version=version+1,mutation_id=?,updated_by=?,updated_at=? WHERE kind=? AND scope_id=? AND month=? AND version=? AND '+actorGate+scopeGate).bind(json,mutation,c.me.id,now,p.kind,p.scopeId,p.month,p.version,...gateArgs):c.db.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) SELECT ?,?,?,?,1,?,?,? WHERE '+sourceGuard+' AND '+actorGate+scopeGate+' ON CONFLICT(kind,scope_id,month) DO NOTHING').bind(p.kind,p.scopeId,p.month,json,mutation,c.me.id,now,...sourceArgs,...gateArgs);
 const audit=c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1').bind(mutation,'target-'+p.scopeId,c.me.name,p.kind==='weights'?'تعديل أوزان الأصناف':p.kind==='activity'?'تعديل مستهدفات العملاء والزيارات':'تعديل مستهدفات الأصناف',canonical,now);
 let result;try{result=await c.db.batch([write,audit]);}catch(e){if(await replay())return{ok:true};throw e;}
 if(result[0].meta.changes!==1){if(await replay())return{ok:true};throw conflict();}
 return{ok:true};
}

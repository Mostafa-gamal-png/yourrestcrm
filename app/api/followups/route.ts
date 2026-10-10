import {recordAuthorId} from '@/lib/access';
import {readJsonBody,isRecord} from '@/lib/crm-server';
import {requireSalesRole} from '@/lib/crm-server';
import {z} from 'zod';
import {accessGuard,recordEditGuard,requireRecordEdit,context,CRMError,checkOrigin,requireSession,replyError} from '@/lib/crm-server';
import {schemas,type Row} from '@/lib/crm';
import {riyadhDate} from '@/lib/visits';
import {validateFollowup,prepareNewContact,requireLegacyVisit,preserveRequestResponsible,type OpportunityData,type ContactData} from '@/lib/followups-server';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();const body=await readJsonBody(req);if(JSON.stringify(body).length>80000)throw new CRMError('حجم الطلب كبير');
 const key=z.string().uuid().parse(body.createKey);const c=await context();requireSalesRole(c.me);const now=new Date().toISOString(),mutation=crypto.randomUUID();
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([body.id||'',body.parentId,body.adoptId||'',body.data,body.contact||null,body.clockAction||'']))))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const id=body.id|| (body.adoptId?'followup-'+body.adoptId:'followup-'+key);
 const existing=c.all.find(r=>r.id===id);
 if(existing&&!c.visible.some(r=>r.id===id))throw new CRMError('السجل غير متاح',404);
 const replay=(r:Row)=>r.data._followupRequest===fingerprint?Response.json({ok:true,id:r.id,alreadySaved:true}):Response.json({error:'حُفظت المتابعة بالفعل. أعد فتحها لمراجعة أحدث بياناتها قبل حفظ تعديلات إضافية.',existingId:r.id},{status:409});
 // Audit receipts retain retry identity even after later edits.
 const receipt=await c.db.prepare("SELECT detail FROM crm_audit WHERE id=? AND record_id=?").bind('followup-save-'+c.me.id+':'+key,id).first<{detail:string}>();
 if(receipt){if(!existing)throw new CRMError('السجل غير متاح',404);return receipt.detail===fingerprint?Response.json({ok:true,id,alreadySaved:true}):replay({...existing,data:{...existing.data,_followupRequest:''}});}
 if(!body.id&&existing)return replay(existing);
 const old=body.id&&c.visible.some(r=>r.id===body.id)?c.all.find(r=>r.id===body.id&&r.kind==='opportunity'):undefined;
 if(body.id&&!old)throw new CRMError('السجل غير متاح',404);
 if(old)requireRecordEdit(c.me);
 if(old&&body.version!==old.version)throw new CRMError('تغيّرت المتابعة. حدّث البيانات ثم راجع التعديلات.',409);
 const parent=c.visible.find(r=>r.id===body.parentId&&['customer','factory'].includes(r.kind));if(!parent)throw new CRMError('حدد المصنع والماكينة التابعة له');
 const customerId=(r:Row)=>r.kind==='customer'?r.id:r.kind==='factory'?r.parentId:c.visible.find(p=>p.id===r.parentId)?.kind==='customer'?r.parentId:c.visible.find(p=>p.id===r.parentId)?.parentId;
 if(old&&customerId(old)!==customerId(parent))throw new CRMError('لا يمكن نقل المتابعة إلى مصنع آخر');
 if(old&&old.parentId!==parent.id&&(c.all.some(r=>r.kind==='quote'&&r.parentId===old.id)||['won','lost'].includes(old.data.stage)))throw new CRMError('لا يمكن تغيير ماكينة طلب مغلق أو مرتبط بعرض سعر');
 const adopted=body.adoptId&&c.visible.some(r=>r.id===body.adoptId)?c.all.find(r=>r.id===body.adoptId&&r.kind==='activity'):undefined;
 if(body.adoptId&&(!adopted||old||adopted.parentId!==customerId(parent)||adopted.version!==body.adoptVersion))throw new CRMError('تغيّرت الزيارة أو ارتباطها. أعد تحميل البيانات.',409);
 if(adopted)requireRecordEdit(c.me);
 requireLegacyVisit(body.contact,adopted);
 const clockAction=body.clockAction?z.enum(['start','finish']).parse(body.clockAction):undefined;
 const rawData:Record<string,unknown>={...(isRecord(body.data)?body.data:{})};if(clockAction==='start'){if(!rawData.nextAction)rawData.nextAction='إنهاء الزيارة وتسجيل النتيجة';if(!rawData.nextDate)rawData.nextDate=riyadhDate(now);}
 const data:OpportunityData=schemas.opportunity.parse(rawData);if(old){preserveRequestResponsible(data,old);data.responsibleId=recordAuthorId(old,c.members)||'';}else data.responsibleId=c.me.id;data.performedBy=data.responsibleId;data._createdBy=old?old.data._createdBy||recordAuthorId(old,c.members)||'':c.me.id;validateFollowup(data,old,parent,c,now);data._followupRequest=fingerprint;
 const contact:ContactData|null=body.contact?schemas.activity.parse(body.contact):null;
 if(!old&&!adopted&&!contact)throw new CRMError('سجّل التواصل الأول لبدء المتابعة');
 if(clockAction&&!contact)throw new CRMError('حدد التواصل المراد توقيته');
 if(contact){contact.nextAction=data.nextAction;contact.nextDate=data.nextDate;prepareNewContact(contact,c,now,clockAction);contact._creationRequest=fingerprint;}
 const visitId='followup-visit-'+key;
 // The first write locks every dependency; all subsequent writes share its gate.
 const moving=!!old&&old.parentId!==parent.id;
 let locks='EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND assigned_to=? AND branch=?)'+(adopted?' AND EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND parent_id=?)':'')+(moving?" AND NOT EXISTS (SELECT 1 FROM crm_records WHERE parent_id=? AND kind='quote')":'');
 const lockArgs:(string|number|null)[]=[parent.id,parent.version,parent.assignedTo,parent.branch,...(adopted?[adopted.id,adopted.version,adopted.parentId]:[]),...(moving?[old!.id]:[])];
 for(const dependency of [parent,old,adopted].filter((r):r is Row=>!!r)){const permission=dependency===old||dependency===adopted?recordEditGuard(c,dependency):accessGuard(c,dependency);locks+=' AND '+permission.sql;lockArgs.push(...permission.args);}
 const stmts=[];
 if(old)stmts.push(c.db.prepare(`UPDATE crm_records SET parent_id=?,data=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND ${locks}`).bind(parent.id,JSON.stringify(data),now,mutation,id,old.version,...lockArgs));
 else stmts.push(c.db.prepare(`INSERT OR IGNORE INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'opportunity',?,?,?,?,?,?,1,? WHERE ${locks}`).bind(id,parent.id,parent.assignedTo,parent.branch,JSON.stringify(data),now,now,mutation,...lockArgs));
 const revision=old?old.version+1:1,gate='EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND mutation_id=?)',gateArgs=[id,revision,mutation];
 if(adopted)stmts.push(c.db.prepare(`UPDATE crm_records SET parent_id=?,updated_at=?,version=version+1 WHERE id=? AND ${gate}`).bind(id,now,adopted.id,...gateArgs));
 if(contact){
  stmts.push(c.db.prepare(`INSERT INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'activity',?,?,?,?,?,?,1,? WHERE ${gate}`).bind(visitId,id,parent.assignedTo,parent.branch,JSON.stringify(contact),now,now,mutation,...gateArgs));
  stmts.push(c.db.prepare(`INSERT INTO crm_visit_numbers (record_id) SELECT ? WHERE ${gate}`).bind(visitId,...gateArgs));
  stmts.push(c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$.visitNumber',(SELECT number FROM crm_visit_numbers WHERE record_id=?)) WHERE id=? AND ${gate}`).bind(visitId,visitId,...gateArgs));
 }
 stmts.push(c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind('followup-save-'+c.me.id+':'+key,id,c.me.name,'حفظ متابعة',fingerprint,now,...gateArgs));
 for(const [recordId,action,detail] of [[id,old?'تحديث متابعة':'بدء متابعة',data.followupTitle||data.moldType],...(adopted?[[adopted.id,'ربط بالمتابعة',data.followupTitle||data.moldType]]:[]),...(contact?[[visitId,'تواصل جديد',contact.summary]]:[])])stmts.push(c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),recordId,c.me.name,action,detail,now,...gateArgs));
 const result=await c.db.batch(stmts);
 if(result[0].meta.changes!==1){const current=await c.db.prepare('SELECT id,data FROM crm_records WHERE id=?').bind(id).first<{id:string;data:string}>();if(current&&JSON.parse(current.data)._followupRequest===fingerprint&&(await context()).visible.some(r=>r.id===id))return Response.json({ok:true,id,alreadySaved:true});throw new CRMError('تم تحديث البيانات بالتزامن. أعد تحميلها.',409);}
 return Response.json({ok:true,id,visitId:contact?visitId:undefined});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(x=>x.message).join(' • ')},{status:400});return replyError(e);}}

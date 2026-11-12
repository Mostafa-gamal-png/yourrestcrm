// «استيراد كشف التحصيل من ERP» (the owner, 2026-11-11): the ERP's «كشف حساب» becomes the month's collection evidence of each
// representative, the same {dueCents, collectedCents, reference} that «بيانات المؤشرات» keeps by hand (lib/kpi-evidence.ts), so the
// evaluation's «التحصيل» axis reads it unchanged. Only the collection part of a representative's evidence is written: the sales-history
// and quotations confirmations stay as they were (and a confirmation already stale for a changed reporting scope is cleared, as it
// counted for nothing). The rights are those of saving the evidence by hand (app/api/kpi-evidence: «تحرير» on «المستهدفات وتقييم
// الأداء», the administrator or a sales manager, their team and regions); a finished month follows the targets' rule (lib/targets.ts):
// refused but to the administrator, whose import says so in the audit.
// «مبيعات مكتب (مستبعد)» for a name (lib/erp-office-employees.ts, 2026-11-12): a name of the statement may be marked office instead of
// mapped to a representative; its accounts are then counted with «مبيعات مكتب» (left out). A name the sales or quotations import marked
// by its employee number is office here by that name, and is changed from the sales import only; a name marked here (by name only) may be
// mapped back to a representative here. The mark is saved with the approval (with the evidence when any is written, else alone, with the
// import's audit line as its claim), only while the marks' row is as the preview read it.
import {z} from 'zod';
import {context,CRMError,accessGuard,requireSalesWorkspace} from './crm-server';
import {type Member} from './crm';
import {monthSchema,salesReadMemberIds} from './sales';
import {kpiEvidenceInputSchema,evidenceScopeKey,emptyKpiEvidenceInput,type KpiEvidenceInput} from './kpi-evidence';
import {kpiPeriod} from './kpis';
import {readSalesRevision,readEvidenceRevision,memberSnapshot,memberSnapshotsGate} from './kpi-evidence-server';
import {riyadhMonth,targetMonthClosed} from './targets';
import {parseCollectionStatement,summarizeCollections,collectionNameKey,collectionPercent,CollectionStatementError,COLLECTION_FILE_MAX_BYTES,type CollectionGroup} from './erp-collections';
import {ERP_OFFICE_CHOICE,ERP_OFFICE_SETTING,ERP_OFFICE_AUDIT_ACTION,officeByName,applyOfficeChanges,readOfficeRow,officeUnchanged,writeOfficeList,type OfficeEmployeeList} from './erp-office-employees';

type Context=Awaited<ReturnType<typeof context>>;
export const COLLECTION_IMPORT_ACTION='استيراد كشف تحصيل ERP';
export const COLLECTION_CLOSED_MESSAGE='انتهى هذا الشهر؛ استيراد تحصيله لمدير النظام فقط';
/** What the preview states (the owner can change it later). */
export const COLLECTION_MEANING='المحصل = «حركة الفترة دائن»؛ المستحق = الرصيد السابق المدين بعد خصم الدائن (إن كان موجبًا) + «حركة الفترة مدين». يُنسب كل حساب إلى «المندوب»، وإلى «المحصل» إن خلا اسم المندوب. «مبيعات مكتب» مستبعدة. الكشف لا يحمل تاريخًا، فيُحسب للشهر المختار.';
const mappingSchema=z.object({name:z.string().trim().min(1).max(200),repId:z.string().trim().min(1).max(200)}).strict();
const inputSchema=z.object({action:z.enum(['preview','commit']),month:monthSchema,fileName:z.string().trim().min(1).max(255),base64:z.string().min(1).max(Math.ceil(COLLECTION_FILE_MAX_BYTES/3)*4),mappings:z.array(mappingSchema).max(500).default([]),replaceConfirmed:z.boolean().default(false),planDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),requestId:z.string().uuid().optional()}).strict();
type Input=z.infer<typeof inputSchema>;
export type CollectionMappingSource='selected'|'name'|'erp'|'previous'|'none';
export type CollectionNamePreview={key:string;name:string;accounts:number;dueCents:number;collectedCents:number;mismatches:number;fromCollector:number;repId:string;repName:string;mappingSource:CollectionMappingSource;status:'mapped'|'unmapped'|'out_of_scope'|'office';
 /** For a name marked «مبيعات مكتب (مستبعد)»: saved here, chosen in this preview, or marked by employee number in the ERP sales or
  *  quotations import ('sales': changed there only). */
 officeSource?:'saved'|'selected'|'sales'};
export const COLLECTION_OFFICE_ELSEWHERE='هذا الاسم محدد «مبيعات مكتب» برقم موظفه من استيراد مبيعات ERP؛ يُعدَّل من شاشة استيراد المبيعات';
export type CollectionRepStatus='new'|'replace'|'unchanged'|'invalid';
export type CollectionRepPreview={repId:string;repName:string;branch:string;names:string[];accounts:number;dueCents:number;collectedCents:number;percent:number|null;mismatches:number;status:CollectionRepStatus;reason:string;current:{dueCents:number;collectedCents:number;reference:string}|null};
type EvidenceRow={member_id:string;version:number;input:string;scope_key:string};
type Planned=CollectionRepPreview&{member:Member;old:EvidenceRow|null;input:KpiEvidenceInput|null};

async function sha256(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
const riyadhDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
/** The representatives whose evidence this account may write (the same as saving it by hand: lib/kpi-evidence-server.ts). */
function eligible(c:Context){const ids=salesReadMemberIds(c.members,c.me);return c.regionalMembers.filter(m=>m.role==='rep'&&ids.has(m.id));}
function permitted(c:Context){
 requireSalesWorkspace(c.me);
 if(!['admin','manager'].includes(c.me.role))throw new CRMError('بيانات المؤشرات متاحة للتعديل لمدير النظام ومدير المبيعات فقط.',403);
}
export async function collectionImportConfiguration(c:Context){
 permitted(c);
 return {members:eligible(c).map(m=>({id:m.id,name:m.name,branch:m.branch,active:!!m.active})),currentMonth:riyadhMonth(),admin:c.me.role==='admin',meaning:COLLECTION_MEANING};
}
function parseInput(body:unknown){
 const input=inputSchema.parse(body);
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw new CRMError('ترميز ملف كشف الحساب غير صحيح');
 const raw=atob(input.base64);if(raw.length>COLLECTION_FILE_MAX_BYTES)throw new CRMError('أقصى حجم لملف كشف الحساب 2 ميجابايت',413);
 return {input,bytes:Uint8Array.from(raw,ch=>ch.charCodeAt(0))};
}
function checkMonth(c:Context,month:string){
 if(month>riyadhMonth())throw new CRMError('لا يمكن اعتماد تحصيل شهر قادم.',400);
 const closed=targetMonthClosed(month);
 if(closed&&c.me.role!=='admin')throw new CRMError(COLLECTION_CLOSED_MESSAGE,403);
 return closed;
}

/** Names → members. Chosen in this preview first; then a representative of the very same full name (unique among all representatives);
 *  then the ERP sales already imported under that name (their member, or the saved mapping of their employee number), when they agree
 *  on one; then the choice of an earlier collection import. A member outside this account's team or regions is never written. */
async function nameMappings(c:Context,input:Input,keys:Set<string>){
 const result=new Map<string,{repId:string;source:CollectionMappingSource}>(),eligibleIds=new Set(eligible(c).map(m=>m.id));
 const chosen=new Map<string,string>();
 for(const mapping of input.mappings){const key=collectionNameKey(mapping.name);if(!keys.has(key))continue;if(chosen.has(key)&&chosen.get(key)!==mapping.repId)throw new CRMError('تكرار في اختيارات الربط؛ حدّث المعاينة');if(!eligibleIds.has(mapping.repId))throw new CRMError('ربط المندوب خارج نطاق فريقك أو منطقتك',403);chosen.set(key,mapping.repId);}
 const byName=new Map<string,Member[]>();for(const m of c.members.filter(m=>m.role==='rep')){const key=collectionNameKey(m.name);if(key)byName.set(key,[...(byName.get(key)||[]),m]);}
 const [erpRows,employeeRows,previous]=await Promise.all([
  c.db.prepare("SELECT DISTINCT json_extract(data,'$.employeeName') AS employee_name,employee_id,rep_id FROM crm_erp_sales").all<{employee_name:string;employee_id:string;rep_id:string}>(),
  c.db.prepare('SELECT employee_id,rep_id FROM crm_erp_employee_mappings').all<{employee_id:string;rep_id:string}>(),
  c.db.prepare('SELECT detail FROM crm_audit WHERE record_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50').bind('kpi-collection-import').all<{detail:string}>()
 ]);
 const employees=new Map(employeeRows.results.map(r=>[collectionNameKey(r.employee_id),r.rep_id])),erp=new Map<string,Set<string>>();
 for(const row of erpRows.results){const key=collectionNameKey(row.employee_name);if(!key||!keys.has(key))continue;const reps=erp.get(key)||new Set<string>();reps.add(row.rep_id);const mapped=employees.get(collectionNameKey(row.employee_id));if(mapped)reps.add(mapped);erp.set(key,reps);}
 const earlier=new Map<string,string>();
 for(const row of previous.results){try{const detail=JSON.parse(row.detail) as {mappings?:{name:string;repId:string}[]};for(const m of detail.mappings||[]){const key=collectionNameKey(m.name);if(keys.has(key)&&!earlier.has(key)&&typeof m.repId==='string')earlier.set(key,m.repId);}}catch{/* an unreadable audit row suggests nothing */}}
 for(const key of keys){
  const named=byName.get(key)||[],history=erp.get(key);
  if(chosen.has(key))result.set(key,{repId:chosen.get(key)!,source:'selected'});
  else if(named.length===1)result.set(key,{repId:named[0].id,source:'name'});
  else if(history?.size===1)result.set(key,{repId:[...history][0],source:'erp'});
  else if(earlier.has(key))result.set(key,{repId:earlier.get(key)!,source:'previous'});
 }
 return result;
}

async function prepare(c:Context,input:Input,bytes:Uint8Array){
 let statement:ReturnType<typeof parseCollectionStatement>;
 try{statement=parseCollectionStatement(bytes);}catch(error){if(error instanceof CollectionStatementError)throw new CRMError(error.message);throw error;}
 // The revisions and the office marks are read before the rows: a save in between changes them, and the commit's gate refuses it.
 const [evidenceRevision,salesRevision,office]=await Promise.all([readEvidenceRevision(c),readSalesRevision(c),readOfficeRow(c.db)]);
 // «مبيعات مكتب (مستبعد)»: the saved marks by name, then this preview's choices (a mark, or a name mark mapped back to a representative).
 const savedOffice=officeByName(office.list),first=summarizeCollections(statement.rows,new Set(savedOffice.keys()));
 const candidates=new Map<string,CollectionGroup>([...first.groups,...first.officeGroups].map(g=>[g.key,g]));
 const markNames=new Map<string,string>(),unmarkNames=new Map<string,string>();
 for(const mapping of input.mappings){
  const key=collectionNameKey(mapping.name),group=candidates.get(key),saved=savedOffice.get(key);if(!group)continue;
  if(mapping.repId===ERP_OFFICE_CHOICE){if(!saved)markNames.set(key,group.name);continue;}
  if(saved==='id')throw new CRMError(COLLECTION_OFFICE_ELSEWHERE,409);
  if(saved==='name')unmarkNames.set(key,group.name);
 }
 const officeKeys=new Set([...savedOffice.keys()].filter(key=>!unmarkNames.has(key)));for(const key of markNames.keys())officeKeys.add(key);
 const summary=summarizeCollections(statement.rows,officeKeys);
 // Every name of the statement is read (a marked one too), so a mark of a name mapped to a representative outside this account's team or
 // regions is refused as remapping it would be.
 const [mappings,evidence]=await Promise.all([nameMappings(c,{...input,mappings:input.mappings.filter(m=>m.repId!==ERP_OFFICE_CHOICE)},new Set(candidates.keys())),c.db.prepare('SELECT member_id,version,input,scope_key FROM crm_kpi_evidence WHERE month=?').bind(input.month).all<EvidenceRow>()]);
 const allowed=new Map(eligible(c).map(m=>[m.id,m])),rows=new Map(evidence.results.map(r=>[r.member_id,r]));
 for(const key of markNames.keys()){const prior=mappings.get(key);if(prior&&!allowed.has(prior.repId))throw new CRMError('ربط المندوب خارج نطاق فريقك أو منطقتك',403);}
 const names:CollectionNamePreview[]=[...summary.groups.map(group=>{
  const mapping=mappings.get(group.key),member=mapping?allowed.get(mapping.repId):undefined;
  return {...group,repId:member?.id||'',repName:member?.name||'',mappingSource:mapping?.source||'none' as CollectionMappingSource,status:!mapping?'unmapped' as const:member?'mapped' as const:'out_of_scope' as const};
 }),...summary.officeGroups.map(group=>({...group,repId:ERP_OFFICE_CHOICE,repName:'',mappingSource:'none' as CollectionMappingSource,status:'office' as const,
  officeSource:savedOffice.get(group.key)==='id'?'sales' as const:savedOffice.has(group.key)?'saved' as const:'selected' as const}))].sort((a,b)=>a.name.localeCompare(b.name,'ar'));
 const byRep=new Map<string,CollectionNamePreview[]>();for(const name of names)if(name.status==='mapped')byRep.set(name.repId,[...(byRep.get(name.repId)||[]),name]);
 const day=riyadhDay.format(new Date()),reference=('كشف حساب ERP · '+input.fileName+' · '+day).slice(0,2000);
 const planned:Planned[]=[...byRep.entries()].map(([repId,group])=>{
  const member=allowed.get(repId)!,old=rows.get(repId)||null,dueCents=group.reduce((n,g)=>n+g.dueCents,0),collectedCents=group.reduce((n,g)=>n+g.collectedCents,0);
  const oldInput=old?kpiEvidenceInputSchema.parse(JSON.parse(old.input)):null,current=oldInput&&oldInput.collection.dueCents!==null&&oldInput.collection.collectedCents!==null?{dueCents:oldInput.collection.dueCents,collectedCents:oldInput.collection.collectedCents,reference:oldInput.collection.reference}:null;
  const base={repId,repName:member.name,branch:member.branch,names:group.map(g=>g.name),accounts:group.reduce((n,g)=>n+g.accounts,0),dueCents,collectedCents,percent:collectionPercent(dueCents,collectedCents),mismatches:group.reduce((n,g)=>n+g.mismatches,0),current,member,old};
  if(dueCents===0&&collectedCents>0)return {...base,status:'invalid' as const,reason:'لا يوجد مبلغ مستحق والمحصل أكبر من صفر؛ لا يُعتمد كتحصيل',input:null};
  if(dueCents>1_000_000_000_000||collectedCents>1_000_000_000_000)return {...base,status:'invalid' as const,reason:'المبلغ يتجاوز الحد المسموح',input:null};
  if(current&&current.dueCents===dueCents&&current.collectedCents===collectedCents)return {...base,status:'unchanged' as const,reason:'القيمة نفسها محفوظة؛ لن تتغير',input:null};
  // Only the collection changes. A history or quotations confirmation made for another reporting scope counted for nothing (lib/kpis-server.ts
  // reads a row only while its scope key is the member's), so it is cleared rather than revived by the new scope key.
  const keep=oldInput||emptyKpiEvidenceInput(),stale=!!old&&old.scope_key!==evidenceScopeKey(member);
  const next=kpiEvidenceInputSchema.parse({...keep,history:stale?{...keep.history,complete:false}:keep.history,quotationsComplete:stale?false:keep.quotationsComplete,collection:{dueCents,collectedCents,reference}});
  return {...base,status:current?'replace' as const:'new' as const,reason:current?'سيستبدل القيمة الحالية':'',input:next};
 }).sort((a,b)=>a.repName.localeCompare(b.repName,'ar'));
 const warnings:string[]=[];
 if(summary.officeRows)warnings.push('حسابات «مبيعات مكتب» المستبعدة: '+summary.officeRows);
 if(summary.officeGroups.length)warnings.push('أسماء محددة «مبيعات مكتب (مستبعد)»: '+summary.officeGroups.length);
 if(summary.noRepRows)warnings.push('حسابات بلا مندوب ولا محصل لا تُنسب لأحد: '+summary.noRepRows);
 if(summary.mismatchRows)warnings.push('حسابات لا يساوي رصيدها الحالي الرصيد السابق مع حركة الفترة: '+summary.mismatchRows);
 const unmapped=names.filter(n=>n.status==='unmapped').length,outOfScope=names.filter(n=>n.status==='out_of_scope').length;
 if(unmapped)warnings.push('أسماء غير مربوطة بمندوب لن تُكتب: '+unmapped);
 if(outOfScope)warnings.push('أسماء مربوطة بمندوب خارج نطاق فريقك أو منطقتك لن تُكتب: '+outOfScope);
 const count=(status:CollectionRepStatus)=>planned.filter(p=>p.status===status).length;
 const writes=planned.filter(p=>p.status==='new'||p.status==='replace');
 const officeChanges={marked:[...markNames.values()].sort(),unmarked:[...unmarkNames.values()].sort()};
 const planDigest=await sha256(JSON.stringify({month:input.month,writes:writes.map(p=>[p.repId,p.dueCents,p.collectedCents,p.old?.version||0,p.current?[p.current.dueCents,p.current.collectedCents]:null]),statuses:planned.map(p=>[p.repId,p.status]),
  // Only when the marks change anything, so a plan without them is the one it always was.
  ...(officeChanges.marked.length||officeChanges.unmarked.length?{office:officeChanges}:{})}));
 return {statement,summary,names,planned,writes,warnings,reference,evidenceRevision,salesRevision,planDigest,office,officeChanges,
  totals:{...(officeChanges.marked.length+officeChanges.unmarked.length?{officeChanges:officeChanges.marked.length+officeChanges.unmarked.length}:{}),...(summary.officeGroups.length?{officeNames:summary.officeGroups.length}:{}),rows:summary.rows,officeRows:summary.officeRows,noRepRows:summary.noRepRows,mismatchRows:summary.mismatchRows,names:names.length,unmappedNames:unmapped,outOfScopeNames:outOfScope,reps:planned.length,newCount:count('new'),replaceCount:count('replace'),unchangedCount:count('unchanged'),invalidCount:count('invalid'),dueCents:writes.reduce((n,p)=>n+p.dueCents,0),collectedCents:writes.reduce((n,p)=>n+p.collectedCents,0)}};
}
const repView=(p:Planned):CollectionRepPreview=>({repId:p.repId,repName:p.repName,branch:p.branch,names:p.names,accounts:p.accounts,dueCents:p.dueCents,collectedCents:p.collectedCents,percent:p.percent,mismatches:p.mismatches,status:p.status,reason:p.reason,current:p.current});

/** Preview: reads the file, writes nothing. Commit: the same reading, refused unless it equals the preview (planDigest), and unless a
 *  replacement of an existing value was confirmed; one transaction for every representative, all or nothing; a repeat of the same request
 *  (requestId) returns the first answer and writes nothing again. */
export async function importErpCollections(c:Context,body:unknown){
 permitted(c);
 const {input,bytes}=parseInput(body);
 const fileHash=await sha256(input.base64),fingerprint=await sha256(JSON.stringify([c.me.id,input.month,input.fileName,fileHash,[...input.mappings].map(m=>[collectionNameKey(m.name),m.repId]).sort(),input.replaceConfirmed]));
 const mutation=input.requestId?'kpi-collection-import:'+c.me.id+':'+input.requestId:'';
 const replay=async()=>{if(input.action!=='commit'||!mutation)return null;const row=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(mutation).first<{detail:string}>();if(!row)return null;const detail=JSON.parse(row.detail) as {fingerprint:string;result:Record<string,unknown>};if(detail.fingerprint!==fingerprint)throw new CRMError('تم حفظ الطلب ببيانات مختلفة؛ ارفع الملف للمعاينة من جديد',409);return {...detail.result,alreadySaved:true};};
 const prior=await replay();if(prior)return prior;
 const closedMonth=checkMonth(c,input.month),p=await prepare(c,input,bytes);
 if(input.action==='preview')return {month:input.month,fileName:input.fileName,title:p.statement.title,closedMonth,meaning:COLLECTION_MEANING,reference:p.reference,planDigest:p.planDigest,summary:p.totals,names:p.names,reps:p.planned.map(repView),warnings:p.warnings};
 if(!mutation||!input.planDigest)throw new CRMError('اعرض الملف أولًا قبل تأكيد الاعتماد');
 if(input.planDigest!==p.planDigest)throw new CRMError('تغيّرت بيانات المؤشرات أو الربط بعد المعاينة؛ اعرض الملف مرة أخرى',409);
 if(p.writes.some(w=>w.status==='replace')&&!input.replaceConfirmed)throw new CRMError('أكّد استبدال قيم التحصيل المحفوظة قبل الاعتماد',409);
 const officeChanged=p.officeChanges.marked.length+p.officeChanges.unmarked.length>0;
 const result={ok:true,month:input.month,writtenCount:p.writes.length,newCount:p.totals.newCount,replaceCount:p.totals.replaceCount,unchangedCount:p.totals.unchangedCount,invalidCount:p.totals.invalidCount,skippedNames:p.totals.unmappedNames+p.totals.outOfScopeNames,officeRows:p.totals.officeRows,mismatchRows:p.totals.mismatchRows,closedMonth,...(officeChanged?{officeMarked:p.officeChanges.marked.length,officeUnmarked:p.officeChanges.unmarked.length}:{})};
 // The same file twice: every representative unchanged, nothing written, no audit line.
 if(!p.writes.length&&!officeChanged)return result;
 const now=new Date().toISOString(),cutoff=kpiPeriod(input.month).cutoff,guard=accessGuard(c),officeGate=officeUnchanged(p.office.raw);
 const gate="(SELECT revision FROM crm_kpi_evidence_state WHERE id='company')=? AND EXISTS(SELECT 1 FROM crm_erp_import_state WHERE id='yourrest-industries' AND revision=?) AND "+officeGate.sql+' AND '+guard.sql+' AND '+memberSnapshotsGate;
 const gateArgs=[p.evidenceRevision,p.salesRevision,...officeGate.args,...guard.args,JSON.stringify(p.writes.map(w=>memberSnapshot(w.member)))];
 const mappingsLine=()=>p.names.filter(n=>n.status==='mapped').map(n=>({name:n.name,repId:n.repId,source:n.mappingSource}));
 const officeList=():OfficeEmployeeList=>applyOfficeChanges(p.office.list,{markNames:p.officeChanges.marked,unmarkNames:p.officeChanges.unmarked},c.me.id,now);
 const officeAudit=(condition:string,args:unknown[])=>c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+condition).bind(mutation+':office',ERP_OFFICE_SETTING,c.me.name,ERP_OFFICE_AUDIT_ACTION,JSON.stringify({source:'erp-collections-import',importId:mutation,fileName:input.fileName,month:input.month,markedNames:p.officeChanges.marked,unmarkedNames:p.officeChanges.unmarked}),now,...args);
 // Only the marks change (no representative's collection is written): the import's audit line is the claim, under the same gate.
 if(!p.writes.length){
  const claim='EXISTS(SELECT 1 FROM crm_audit WHERE id=?) AND '+officeGate.sql,claimArgs=[mutation,...officeGate.args];
  const statements=[
   c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+gate).bind(mutation,'kpi-collection-import',c.me.name,COLLECTION_IMPORT_ACTION,JSON.stringify({fingerprint,fileName:input.fileName,fileSha256:fileHash,month:input.month,...(closedMonth?{closedMonth:true}:{}),counts:p.totals,reps:[],mappings:mappingsLine(),office:p.officeChanges,result}),now,...gateArgs),
   officeAudit(claim,claimArgs),
   writeOfficeList(c.db,officeList(),claim,claimArgs),
  ];
  let done;try{done=await c.db.batch(statements);}catch(error){const saved=await replay();if(saved)return saved;throw error;}
  if(done[0].meta.changes!==1){const saved=await replay();if(saved)return saved;throw new CRMError('تغيّرت بيانات المؤشرات أو الصلاحيات أثناء الاعتماد؛ اعرض الملف مرة أخرى',409);}
  return result;
 }
 // With marks: their audit line first, under the gate, is their claim (its id is this request's, new: replay() found none), so the list
 // written last is written only when the gate held at the start of this transaction.
 const statements:D1PreparedStatement[]=officeChanged?[officeAudit(gate,gateArgs)]:[],writeStart=statements.length;
 statements.push(...p.writes.map(w=>{
  const json=JSON.stringify(w.input),scopeKey=evidenceScopeKey(w.member);
  return w.old
   ?c.db.prepare('UPDATE crm_kpi_evidence SET input=?,version=version+1,mutation_id=?,updated_by=?,updated_at=?,scope_key=? WHERE member_id=? AND month=? AND version=? AND '+gate).bind(json,mutation,c.me.id,now,scopeKey,w.repId,input.month,w.old.version,...gateArgs)
   :c.db.prepare('INSERT INTO crm_kpi_evidence(member_id,month,input,version,mutation_id,updated_by,updated_at,sales_revision,scope_key,cutoff) SELECT ?,?,?,1,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM crm_kpi_evidence WHERE member_id=? AND month=?) AND '+gate).bind(w.repId,input.month,json,mutation,c.me.id,now,p.salesRevision,scopeKey,cutoff,w.repId,input.month,...gateArgs);
 }));
 const stateIndex=statements.length;
 statements.push(c.db.prepare("UPDATE crm_kpi_evidence_state SET revision=revision+1 WHERE id='company' AND "+gate).bind(...gateArgs));
 const claimed="EXISTS(SELECT 1 FROM crm_kpi_evidence_state WHERE id='company' AND revision=?)",claimArgs=[p.evidenceRevision+1];
 const reps=p.writes.map(w=>({memberId:w.repId,names:w.names,before:w.current,after:{dueCents:w.dueCents,collectedCents:w.collectedCents,reference:p.reference}}));
 const mappings=mappingsLine();
 statements.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(mutation,'kpi-collection-import',c.me.name,COLLECTION_IMPORT_ACTION,JSON.stringify({fingerprint,fileName:input.fileName,fileSha256:fileHash,month:input.month,...(closedMonth?{closedMonth:true}:{}),counts:p.totals,reps,mappings,...(officeChanged?{office:p.officeChanges}:{}),result}),now,...claimArgs));
 // Each representative's own history line (record kpi-evidence-<id>, as a save by hand), with what the import replaced.
 for(const rep of reps)statements.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(mutation+':'+rep.memberId,'kpi-evidence-'+rep.memberId,c.me.name,'اعتماد التحصيل من كشف حساب ERP',JSON.stringify({importId:mutation,month:input.month,before:rep.before,after:rep.after,...(closedMonth?{closedMonth:true}:{})}),now,...claimArgs));
 if(officeChanged)statements.push(writeOfficeList(c.db,officeList(),'EXISTS(SELECT 1 FROM crm_audit WHERE id=?)',[mutation+':office']));
 let committed;try{committed=await c.db.batch(statements);}catch(error){const saved=await replay();if(saved)return saved;throw error;}
 const stateWrite=committed[stateIndex];
 if(stateWrite.meta.changes!==1||committed.slice(writeStart,writeStart+p.writes.length).some(r=>r.meta.changes!==1)){const saved=await replay();if(saved)return saved;throw new CRMError('تغيّرت بيانات المؤشرات أو الصلاحيات أثناء الاعتماد؛ اعرض الملف مرة أخرى',409);}
 return result;
}

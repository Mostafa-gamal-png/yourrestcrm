import {z} from 'zod';
import {context,CRMError,accessGuard,requireSalesWorkspace} from './crm-server';
import {type Member,type Row,today} from './crm';
import {recordAuthorId} from './access';
import {regionScope,memberCanAccessRegion} from './regions';
import {monthSchema,salesReadMemberIds,type Sale,type SaleRow} from './sales';
import {visitCustomer} from './customer-visits';
import {targetState} from './targets-server';
import {effectiveSet} from './targets';
import {readErpSales,type ErpSaleRow} from './erp-sales-server';
import {uniqueCustomerCodes,customerCodeKey,isKpiIssuedQuote} from './kpi-history-server';
import {kpiEvidenceInputSchema,evidenceScopeKey,type KpiEvidence,type KpiEvidenceOptions,type QuoteOption,type InvoiceOption} from './kpi-evidence';

type Context=Awaited<ReturnType<typeof context>>;
type EvidenceRow={member_id:string;month:string;input:string;version:number;updated_at:string;updated_by:string;author?:string;sales_revision:number;scope_key:string;cutoff:string};
type InvoiceRecord=InvoiceOption&{version:number;regionScope:string;customerCode:string;documentType:string;status:string};
const decode=(row:EvidenceRow):KpiEvidence=>({memberId:row.member_id,month:row.month,input:kpiEvidenceInputSchema.parse(JSON.parse(row.input)),version:row.version,updatedAt:row.updated_at,updatedBy:row.author||row.updated_by,salesRevision:row.sales_revision,scopeKey:row.scope_key,cutoff:row.cutoff});
function target(c:Context,memberId:string){
 requireSalesWorkspace(c.me);
 const member=c.regionalMembers.find(m=>m.id===memberId&&salesReadMemberIds(c.members,c.me).has(m.id)&&['rep','manager','supervisor'].includes(m.role));
 if(!member)throw new CRMError('عضو الفريق غير متاح ضمن صلاحيتك.',404);
 return member;
}
function periodFor(month:string){const first=new Date(month+'-01T12:00:00Z');first.setUTCMonth(first.getUTCMonth()-3);const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);return{from:first.toISOString().slice(0,10),through:end<today()?end:today()};}
export async function readSalesRevision(c:Context){
 const row=await c.db.prepare("SELECT revision FROM crm_erp_import_state WHERE id='yourrest-industries'").first<{revision:number}>();
 if(!row)throw new CRMError('تحديث قاعدة بيانات المبيعات غير مكتمل.',503);
 return row.revision;
}
async function readEvidenceRevision(c:Context){const row=await c.db.prepare("SELECT revision FROM crm_kpi_evidence_state WHERE id='company'").first<{revision:number}>();if(!row)throw new CRMError('تحديث قاعدة بيانات المؤشرات غير مكتمل.',503);return row.revision;}
export async function readKpiEvidenceRows(c:Context,month:string):Promise<KpiEvidence[]>{
 requireSalesWorkspace(c.me);const selected=monthSchema.parse(month),allowed=salesReadMemberIds(c.members,c.me),regional=new Set(c.regionalMembers.filter(m=>m.role==='rep').map(m=>m.id));
 const rows=(await c.db.prepare('SELECT e.*,m.name AS author FROM crm_kpi_evidence e LEFT JOIN crm_members m ON m.id=e.updated_by WHERE e.month=?').bind(selected).all<EvidenceRow>()).results;
 return rows.filter(row=>allowed.has(row.member_id)&&regional.has(row.member_id)).map(decode);
}

/** Customer identity is a persisted CRM ID; ERP codes are accepted only when globally unique. */
async function invoiceRecords(c:Context,memberIds:Set<string>,month:string,through:string):Promise<InvoiceRecord[]>{
 const codes=uniqueCustomerCodes(c.all,c.customerIdentityState?.mappings);
 const [manual,erp]=await Promise.all([
  c.db.prepare("SELECT s.*,c.data AS customer_data FROM crm_sales s JOIN crm_records c ON c.id=s.customer_id AND c.kind='customer' WHERE s.date>=? AND s.date<=? AND s.status='confirmed' AND s.total_cents>0").bind(month+'-01',through).all<SaleRow&{customer_data:string}>(),
  c.db.prepare("SELECT * FROM crm_erp_sales WHERE date>=? AND date<=? AND document_type='sale' AND total_cents>0 AND (?='all' OR region_scope=?)").bind(month+'-01',through,regionScope(c.me),regionScope(c.me)).all<ErpSaleRow>()
 ]);
 const result:InvoiceRecord[]=manual.results.filter(row=>memberIds.has(row.rep_id)&&c.regionCustomerIds.has(row.customer_id)).map(row=>({id:row.id,reference:row.reference,customerId:row.customer_id,customerName:JSON.parse(row.customer_data).name||'',date:row.date,repId:row.rep_id,source:'crm',version:row.version,regionScope:'',customerCode:'',documentType:'sale',status:row.status}));
 for(const row of erp.results){
  if(!memberIds.has(row.rep_id))continue;
  const code=customerCodeKey(row.customer_code),matches=code?codes.get(code)||[]:[],customer=matches.length===1?matches[0]:null;
  if(!customer||!c.regionCustomerIds.has(customer.id))continue;
  result.push({id:row.id,reference:row.reference,customerId:customer.id,customerName:row.customer_name||customer.data.name||'',date:row.date,repId:row.rep_id,source:'erp',version:1,regionScope:row.region_scope,customerCode:row.customer_code,documentType:row.document_type,status:'confirmed'});
 }
 return result.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
}
function quotationRecords(c:Context,member:Member,month:string){
 const visible=new Set(c.visible.map(row=>row.id));
 return c.all.filter(row=>{
  if(!visible.has(row.id))return false;
  const customer=visitCustomer(row,c.all);
  return isKpiIssuedQuote(row,month)&&!!customer&&memberCanAccessRegion(member,customer.data.region);
 });
}
function quoteOption(row:Row,c:Context):QuoteOption{const customer=visitCustomer(row,c.all)!;return{id:row.id,reference:String(row.kind==='quote'?row.data.number||row.id:row.data.visitNumber||row.id),customerId:customer.id,customerName:String(customer.data.name||''),date:String(row.data.date),kind:row.kind as 'quote'|'activity'};}
function invoiceOption(row:InvoiceRecord):InvoiceOption{const{id,reference,customerId,customerName,date,repId,source}=row;return{id,reference,customerId,customerName,date,repId,source};}
function memberSnapshot(member:Member){return[member.id,member.role,member.branch,member.supervisorId||'',regionScope(member),member.active,member.authVersion||0];}
const memberSnapshotsGate=`NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN crm_members actual ON actual.id=json_extract(expected.value,'$[0]') WHERE actual.id IS NULL OR actual.role IS NOT json_extract(expected.value,'$[1]') OR actual.branch IS NOT json_extract(expected.value,'$[2]') OR COALESCE(actual.supervisor_id,'') IS NOT json_extract(expected.value,'$[3]') OR actual.region_scope IS NOT json_extract(expected.value,'$[4]') OR actual.active IS NOT json_extract(expected.value,'$[5]') OR actual.auth_version IS NOT json_extract(expected.value,'$[6]'))`;
const recordSnapshotsGate=`NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN crm_records actual ON actual.id=json_extract(expected.value,'$[0]') WHERE actual.id IS NULL OR actual.version IS NOT json_extract(expected.value,'$[1]'))`;

export async function getKpiEvidenceOptions(c:Context,memberId:string,month:string):Promise<KpiEvidenceOptions>{
 const selected=monthSchema.parse(month),member=target(c,memberId),period=periodFor(selected),computed=member.role!=='rep';
 const [salesRevision,evidenceRevision,rows]=await Promise.all([readSalesRevision(c),readEvidenceRevision(c),readKpiEvidenceRows(c,selected)]);
 let sourceMemberIds=[member.id];
 if(computed){
  const [manual,erp]=await Promise.all([c.db.prepare("SELECT rep_id,customer_id,date FROM crm_sales WHERE status='confirmed' AND date>=? AND date<=?").bind(selected+'-01',period.through).all<{rep_id:string;customer_id:string;date:string}>(),readErpSales(c,selected)]);
  const allowed=salesReadMemberIds(c.members,c.me),sales=[...manual.results.filter(row=>allowed.has(row.rep_id)&&c.regionCustomerIds.has(row.customer_id)).map(row=>({repId:row.rep_id,date:row.date,status:'confirmed'} as Sale)),...erp];
  const states=await targetState(c,selected,sales);sourceMemberIds=effectiveSet(states,'sales',member.id)?.teamMemberIds||[];
 }
 const evidence=computed?null:rows.find(row=>row.memberId===member.id)||null;
 const quotations=computed?[]:quotationRecords(c,member,selected),invoices=computed?[]:await invoiceRecords(c,new Set(sourceMemberIds),selected,period.through);
 // An explicit saved assignment grants only these report labels, never the
 // hidden quotation body or its attachments. New assignments still require c.visible.
 const assigned=new Set(evidence?.input.quotations.map(link=>link.quoteId)||[]),available=new Set(quotations.map(row=>row.id));
 for(const row of c.regionalRecords){const customer=visitCustomer(row,c.all);if(assigned.has(row.id)&&!available.has(row.id)&&isKpiIssuedQuote(row,selected)&&customer&&memberCanAccessRegion(member,customer.data.region))quotations.push(row);}
 const quoteCustomers=new Set(quotations.map(row=>visitCustomer(row,c.all)!.id));
 const guard=accessGuard(c),fresh=await c.db.prepare("SELECT EXISTS(SELECT 1 FROM crm_customer_identity_state WHERE id='company' AND revision=?) AS identityCurrent WHERE "+guard.sql+' AND '+memberSnapshotsGate).bind(c.customerIdentityState.revision,...guard.args,JSON.stringify([memberSnapshot(member)])).first<{identityCurrent:number}>();
 if(!fresh)throw new CRMError('تغيّرت الصلاحيات. حدّث الصفحة.',403);
 if(!fresh.identityCurrent)throw new CRMError('تغيّر ربط أكواد العملاء. حدّث الصفحة وأعد المراجعة.',409);
 return{memberId:member.id,month:selected,evidence,salesRevision,evidenceRevision,scopeKey:evidenceScopeKey(member),period,computed,sourceMemberIds,canEdit:!computed&&['admin','manager'].includes(c.me.role)&&selected<=today().slice(0,7),quotes:quotations.map(row=>quoteOption(row,c)),invoices:invoices.filter(row=>quoteCustomers.has(row.customerId)).map(invoiceOption)};
}

const saveSchema=z.object({memberId:z.string().min(1).max(200),month:monthSchema,version:z.number().int().min(0),requestId:z.string().uuid(),salesRevision:z.number().int().nonnegative(),evidenceRevision:z.number().int().nonnegative(),input:kpiEvidenceInputSchema}).strict();
export async function saveKpiEvidence(c:Context,body:unknown){
 if(!['admin','manager'].includes(c.me.role))throw new CRMError('بيانات المؤشرات متاحة للتعديل لمدير النظام ومدير المبيعات فقط.',403);
 const p=saveSchema.parse(body),member=target(c,p.memberId);
 if(member.role!=='rep')throw new CRMError('اختر مندوبًا؛ بيانات المدير والمشرف محسوبة من الفريق.',400);
 if(p.month>today().slice(0,7))throw new CRMError('لا يمكن اعتماد بيانات شهر قادم.',400);
 const mutation='kpi-evidence:'+c.me.id+':'+p.requestId,canonical=JSON.stringify({...p,requestId:undefined});
 const replay=async()=>{const row=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(mutation).first<{detail:string}>();if(!row)return false;if(row.detail!==canonical)throw new CRMError('الطلب محفوظ ببيانات مختلفة. حدّث الصفحة.',409);return true;};
 if(await replay())return{ok:true};
 const conflict=()=>new CRMError('تغيّرت المبيعات أو بيانات المؤشرات أو الصلاحيات. حدّث الصفحة وأعد المراجعة.',409);
 const [salesRevision,evidenceRevision,old,allRows]=await Promise.all([
  readSalesRevision(c),readEvidenceRevision(c),c.db.prepare('SELECT version,input FROM crm_kpi_evidence WHERE member_id=? AND month=?').bind(member.id,p.month).first<{version:number;input:string}>(),
  c.db.prepare('SELECT member_id,month,input FROM crm_kpi_evidence').all<{member_id:string;month:string;input:string}>()
 ]);
 if(salesRevision!==p.salesRevision||evidenceRevision!==p.evidenceRevision||(old?.version||0)!==p.version){if(await replay())return{ok:true};throw conflict();}
 const selectedQuoteIds=new Set(p.input.quotations.map(row=>row.quoteId)),selectedSaleIds=new Set(p.input.quotations.flatMap(row=>row.saleId?[row.saleId]:[]));
 for(const row of allRows.results){if(row.member_id===member.id&&row.month===p.month)continue;const input=kpiEvidenceInputSchema.parse(JSON.parse(row.input));if(input.quotations.some(link=>selectedQuoteIds.has(link.quoteId)||!!link.saleId&&selectedSaleIds.has(link.saleId)))throw new CRMError('عرض السعر أو الفاتورة مرتبط ببيانات مؤشرات محفوظة أخرى. صحّح الربط السابق أولًا.',409);}
 const period=periodFor(p.month),quotes=new Map(quotationRecords(c,member,p.month).map(row=>[row.id,row])),invoices=new Map((await invoiceRecords(c,new Set([member.id]),p.month,period.through)).map(row=>[row.id,row]));
 const priorLinks=new Map((old?kpiEvidenceInputSchema.parse(JSON.parse(old.input)).quotations:[]).map(link=>[link.quoteId,link.saleId]));
 const records=new Map<string,Row>(),actors=new Map<string,Member>([[member.id,member]]);let usesErp=false;
 for(const link of p.input.quotations){
  let quote=quotes.get(link.quoteId);const visible=!!quote;
  // Existing explicit assignments may retain their narrow reporting evidence
  // without granting access to the hidden quote or allowing its link to change.
  if(!quote&&priorLinks.has(link.quoteId)&&priorLinks.get(link.quoteId)===link.saleId){const saved=c.regionalRecords.find(row=>row.id===link.quoteId),customer=visitCustomer(saved,c.all);if(saved&&isKpiIssuedQuote(saved,p.month)&&customer&&memberCanAccessRegion(member,customer.data.region))quote=c.all.find(row=>row.id===saved.id);}
  if(!quote)throw new CRMError('عرض السعر غير متاح أو ليس عرضًا صادرًا خلال شهر التقييم. راجع الربط.',400);
  // Explicit assignment is the attribution; customer ownership never chooses a salesperson.
  if(visible)accessGuard(c,quote);let ancestor:Row|undefined=quote;const seen=new Set<string>();while(ancestor&&!seen.has(ancestor.id)){seen.add(ancestor.id);records.set(ancestor.id,ancestor);if(ancestor.kind==='customer')break;ancestor=c.all.find(row=>row.id===ancestor!.parentId);}
  const author=c.members.find(m=>m.id===recordAuthorId(quote,c.members));if(author)actors.set(author.id,author);
  if(!link.saleId)continue;
  const invoice=invoices.get(link.saleId),customer=visitCustomer(quote,c.all)!;
  if(!invoice||invoice.customerId!==customer.id||invoice.date<String(quote.data.date))throw new CRMError('اختر فاتورة بيع مؤكدة لنفس المندوب والعميل، بتاريخ العرض أو بعده وضمن فترة التقييم.',400);
  usesErp ||= invoice.source==='erp';
 }
 const guard=accessGuard(c),args:(string|number)[]=[p.evidenceRevision,p.salesRevision,c.customerIdentityState.revision,...guard.args,JSON.stringify([...actors.values()].map(memberSnapshot)),JSON.stringify([...records.values()].map(row=>[row.id,row.version]))];
 let gate="id='company' AND revision=? AND EXISTS(SELECT 1 FROM crm_erp_import_state WHERE id='yourrest-industries' AND revision=?) AND EXISTS(SELECT 1 FROM crm_customer_identity_state WHERE id='company' AND revision=?) AND "+guard.sql+' AND '+memberSnapshotsGate+' AND '+recordSnapshotsGate;
 if(old){gate+=' AND EXISTS(SELECT 1 FROM crm_kpi_evidence WHERE member_id=? AND month=? AND version=?)';args.push(member.id,p.month,p.version);}else{gate+=' AND NOT EXISTS(SELECT 1 FROM crm_kpi_evidence WHERE member_id=? AND month=?)';args.push(member.id,p.month);}
 if(usesErp){const customers=c.all.filter(row=>row.kind==='customer');gate+=" AND (SELECT COUNT(*) FROM crm_records WHERE kind='customer')=? AND "+recordSnapshotsGate;args.push(customers.length,JSON.stringify(customers.map(row=>[row.id,row.version])));}
 const now=new Date().toISOString(),input=JSON.stringify(p.input),scopeKey=evidenceScopeKey(member);
 const claim=c.db.prepare('UPDATE crm_kpi_evidence_state SET revision=revision+1 WHERE '+gate).bind(...args);
 const write=old?c.db.prepare('UPDATE crm_kpi_evidence SET input=?,version=version+1,mutation_id=?,updated_by=?,updated_at=?,sales_revision=?,scope_key=?,cutoff=? WHERE member_id=? AND month=? AND version=? AND changes()=1').bind(input,mutation,c.me.id,now,p.salesRevision,scopeKey,period.through,member.id,p.month,p.version):c.db.prepare('INSERT INTO crm_kpi_evidence(member_id,month,input,version,mutation_id,updated_by,updated_at,sales_revision,scope_key,cutoff) SELECT ?,?,?,1,?,?,?,?,?,? WHERE changes()=1').bind(member.id,p.month,input,mutation,c.me.id,now,p.salesRevision,scopeKey,period.through);
 const audit=c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1').bind(mutation,'kpi-evidence-'+member.id,c.me.name,'اعتماد بيانات المؤشرات',canonical,now);
 let result;try{result=await c.db.batch([claim,write,audit]);}catch(error){if(await replay())return{ok:true};throw error;}
 if(result[0].meta.changes!==1||result[1].meta.changes!==1){if(await replay())return{ok:true};throw conflict();}
 return{ok:true};
}

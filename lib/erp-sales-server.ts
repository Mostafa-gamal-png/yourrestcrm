import {env} from 'cloudflare:workers';
import {canonicalInvoiceReference} from './invoice-reference';
import {z} from 'zod';
import {context,CRMError,requireSalesWorkspace,accessGuard} from './crm-server';
import {salesMemberIds,salesReadMemberIds,salesProducts,type Sale,type SaleItem} from './sales';
import {regionScope} from './regions';
import {today,type Member} from './crm';
import {parseErpWorkbook,ErpWorkbookError,type ErpRow} from './erp-sales';
import {omit} from './omit';

type Context=Awaited<ReturnType<typeof context>>;
const namespace='yourrest-industries';
const normalize=(value:string)=>value.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').replace(/\s+/g,' ').trim();
// Full names only: do not guess from partial names, spelling similarity or team size.
const employeeNameKey=(value:string)=>normalize(value).toLowerCase();
const office=(value:string)=>['مبيعات مكتب','مبيعات المكتب'].includes(normalize(value));
const maxFileBytes=5*1024*1024;
const mappingSchema=z.object({employeeId:z.string().trim().min(1).max(100),repId:z.string().trim().min(1).max(200)});
const categorySchema=z.object({category:z.string().trim().min(1).max(300),product:z.string().refine(s=>s==='exclude'||salesProducts.includes(s),'اختر صنفًا صحيحًا')});
const inputSchema=z.object({action:z.enum(['preview','commit']),fileName:z.string().trim().min(1).max(255),base64:z.string().min(1).max(Math.ceil(maxFileBytes/3)*4),employeeMappings:z.array(mappingSchema).max(5000).default([]),categoryMappings:z.array(categorySchema).max(500).default([]),allowSkipped:z.boolean().default(false),previewToken:z.string().max(1024).optional(),requestId:z.string().uuid().optional()});
type Input=z.infer<typeof inputSchema>;
export type ErpDocumentPreview={key:string;reference:string;date:string;documentType:'sale'|'return';customerName:string;employeeId:string;employeeName:string;repId:string;repName:string;lineCount:number;totalCents:number;status:'new'|'duplicate'|'conflict'|'excluded'|'unassigned'|'unmapped'|'out_of_scope';reason:string};
type PreparedDocument={preview:ErpDocumentPreview;rows:ErpRow[];items:SaleItem[];contentHash:string;mappedHash:string;rep?:Member};
function missingEmployee(row:ErpRow){return !normalize(row.employeeName)||!normalize(row.employeeId);}
function mixedDocument(rows:ErpRow[]){const first=rows[0];return rows.some(r=>r.date!==first.date||normalize(r.employeeId)!==normalize(first.employeeId)||normalize(r.employeeName)!==normalize(first.employeeName)||normalize(r.customerCode)!==normalize(first.customerCode)||normalize(r.customerName)!==normalize(first.customerName));}
function sorted<T>(items:T[],key:(item:T)=>string){return [...items].sort((a,b)=>key(a).localeCompare(key(b),'en'));}
async function hash(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export async function erpInvoiceKey(reference:string,date:string){return hash(JSON.stringify([namespace,'invoice','sale',date.slice(0,4),canonicalInvoiceReference(reference)]));}
async function signature(value:string){if(!/^[a-f0-9]{64,}$/i.test(env.YR_AUTH_SECRET||''))throw new CRMError('خدمة الاستيراد غير مهيأة. تواصل مع مدير النظام.',503);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.YR_AUTH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('yourrest-erp-preview:'+value))),b=>b.toString(16).padStart(2,'0')).join('');}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let difference=0;for(let n=0;n<a.length;n++)difference|=a.charCodeAt(n)^b.charCodeAt(n);return difference===0;}
function eligible(c:Context){const ids=salesMemberIds(c.members,c.me);return c.regionalMembers.filter(m=>m.role==='rep'&&ids.has(m.id));}
function snapshot(m:Member){return [m.id,m.role,m.branch,m.supervisorId||'',regionScope(m),m.active,m.authVersion||0,m.name];}
async function state(c:Context){const revision=await c.db.prepare('SELECT revision FROM crm_erp_import_state WHERE id=?').bind(namespace).first<{revision:number}>();if(!revision)throw new CRMError('تحديث قاعدة بيانات استيراد المبيعات غير مكتمل.',503);const employees=(await c.db.prepare('SELECT employee_id AS employeeId,rep_id AS repId FROM crm_erp_employee_mappings ORDER BY employee_id').all<{employeeId:string;repId:string}>()).results;const categories=(await c.db.prepare('SELECT category,product FROM crm_erp_category_mappings ORDER BY category').all<{category:string;product:string}>()).results;return {revision:revision.revision,employees,categories};}
export async function erpSalesConfiguration(c:Context){requireSalesWorkspace(c.me);const members=eligible(c),ids=new Set(members.map(m=>m.id)),saved=await state(c);return {members:members.map(m=>({id:m.id,name:m.name,branch:m.branch})),employeeMappings:saved.employees.filter(m=>ids.has(m.repId)),categoryMappings:saved.categories,products:salesProducts,canEditCategoryMappings:c.me.role!=='supervisor'};}
function parseInput(body:unknown){const input=inputSchema.parse(body);if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw new CRMError('ترميز ملف المبيعات غير صحيح');const raw=atob(input.base64);if(raw.length>maxFileBytes)throw new CRMError('أقصى حجم لملف المبيعات 5 ميجابايت',413);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));return {input,bytes};}
function canonicalInput(input:Input){return JSON.stringify({fileName:input.fileName,base64:input.base64,allowSkipped:input.allowSkipped,employeeMappings:sorted(input.employeeMappings,m=>m.employeeId),categoryMappings:sorted(input.categoryMappings,m=>m.category)});}
function uniqueMappings<T>(rows:T[],key:(row:T)=>string){const values=new Map<string,T>();for(const row of rows){const id=key(row);if(values.has(id))throw new CRMError('تكرار في اختيارات الربط؛ حدّث المعاينة');values.set(id,row);}return values;}
async function prepare(c:Context,input:Input,bytes:Uint8Array){
 let parsed:Awaited<ReturnType<typeof parseErpWorkbook>>;try{parsed=await parseErpWorkbook(bytes);}catch(error){if(error instanceof ErpWorkbookError)throw new CRMError(error.message);throw error;}if(!parsed.rows.length||parsed.rows.length>5000)throw new CRMError('ارفع ملفًا يحتوي من 1 إلى 5000 بند');
 const saved=await state(c),members=eligible(c),allowed=new Map(members.map(m=>[m.id,m]));
 const employeeChanges=uniqueMappings(input.employeeMappings,m=>normalize(m.employeeId)),categoryChanges=uniqueMappings(input.categoryMappings,m=>normalize(m.category));
 const employeeMap=new Map(saved.employees.map(m=>[normalize(m.employeeId),m.repId])),categoryMap=new Map(saved.categories.map(m=>[normalize(m.category),m.product]));
 const mappingSources=new Map<string,'saved'|'selected'|'name'|'unmapped'>(saved.employees.map(m=>[normalize(m.employeeId),'saved']));
 const groups=new Map<string,ErpRow[]>();for(const row of parsed.rows){const key=JSON.stringify([namespace,office(row.employeeName)?'excluded-office':'invoice',row.documentType,row.date.slice(0,4),canonicalInvoiceReference(row.reference)]);const group=groups.get(key)||[];group.push(row);groups.set(key,group);}
 // Keep mixed invoices in review. Only coherent documents lacking employee
 // identity are omitted automatically, along with their exclusive mapping fields.
 const relevantRows=[...groups.values()].filter(rows=>!office(rows[0].employeeName)&&(mixedDocument(rows)||!missingEmployee(rows[0]))).flat();
 const employeeIds=new Set(relevantRows.map(r=>normalize(r.employeeId))),categoryIds=new Set(relevantRows.map(r=>normalize(r.category)));
 for(const [id,m] of employeeChanges){if(!employeeIds.has(id))continue;const prior=employeeMap.get(id);if(prior&&!allowed.has(prior)||!allowed.has(m.repId))throw new CRMError('ربط الموظف خارج نطاق فريقك أو منطقتك',403);employeeMap.set(id,m.repId);mappingSources.set(id,prior===m.repId?'saved':'selected');}
 // Include every rep when checking uniqueness. A hidden or inactive namesake must
 // not make an ambiguous identity look unique inside the uploader's team.
 const nameRoster=c.members.filter(m=>m.role==='rep'),nameCandidates=new Map<string,Member[]>(),erpNames=new Map<string,Set<string>>();
 for(const member of nameRoster){const key=employeeNameKey(member.name);if(key)nameCandidates.set(key,[...(nameCandidates.get(key)||[]),member]);}
 // All rows participate, even office/blank rows sharing an employee ID. A mixed
 // ERP identity needs explicit review rather than an inferred assignment.
 for(const row of parsed.rows){const id=normalize(row.employeeId),names=erpNames.get(id)||new Set<string>();names.add(employeeNameKey(row.employeeName));erpNames.set(id,names);}
 let nameInferenceUsed=false;
 for(const [id,names] of erpNames){
  if(!id||employeeMap.has(id)||names.size!==1)continue;
  const name=[...names][0];if(!name||office(name))continue;
  nameInferenceUsed=true;
  const matches=nameCandidates.get(name)||[];
  if(matches.length===1&&allowed.has(matches[0].id)){employeeMap.set(id,matches[0].id);mappingSources.set(id,'name');}
 }
 const nameRosterSnapshot=nameInferenceUsed?sorted(nameRoster,m=>m.id).map(snapshot):null;
 for(const [id,m] of categoryChanges)if(categoryIds.has(id)){if(c.me.role==='supervisor'&&categoryMap.has(id)&&categoryMap.get(id)!==m.product)throw new CRMError('تعديل ربط فئة محفوظة متاح لمدير المبيعات أو مدير النظام فقط',403);categoryMap.set(id,m.product);}
 for(const category of categoryIds)if(!categoryMap.has(category)&&salesProducts.includes(category))categoryMap.set(category,category);
 const existing=(await c.db.prepare('SELECT document_key,content_hash,mapped_hash,rep_id,region_scope FROM crm_erp_sales').all<any>()).results;const stored=new Map(existing.map(r=>[r.document_key,r]));
 const manual=(await c.db.prepare("SELECT reference,date FROM crm_sales WHERE status='confirmed'").all<{reference:string;date:string}>()).results;
 const manualKeys=new Set(manual.map(r=>JSON.stringify([r.date.slice(0,4),canonicalInvoiceReference(r.reference)])));
 const documents:PreparedDocument[]=[];
 for(const [identity,rows] of groups){
  const first=rows[0],key=await hash(identity),repId=employeeMap.get(normalize(first.employeeId))||'',rep=allowed.get(repId),p:ErpDocumentPreview={key,reference:first.reference,date:first.date,documentType:first.documentType,customerName:first.customerName,employeeId:first.employeeId,employeeName:first.employeeName,repId,repName:rep?.name||'',lineCount:rows.length,totalCents:0,status:'new',reason:''};
  const contentHash=await hash(JSON.stringify(rows.map(row=>JSON.stringify(omit(row,'rowNumber'))).sort()));
  const items:SaleItem[]=[];let unmappedCategory=false;
  for(const row of rows){const product=categoryMap.get(normalize(row.category));if(!product){unmappedCategory=true;continue;}if(product==='exclude')continue;const sign=row.documentType==='return'?-1:1,quantity=Math.abs(row.quantity)*sign,totalCents=Math.abs(row.totalCents)*sign;p.totalCents+=totalCents;items.push({product,description:row.itemName,quantity,unitPrice:quantity?Math.abs(totalCents/100/quantity):Math.abs(row.unitPrice)});}
  const mappedHash=await hash(JSON.stringify({repId,items:items.map(i=>JSON.stringify(i)).sort(),totalCents:p.totalCents}));
  const old=stored.get(key);
  const mixed=mixedDocument(rows);
  if(office(first.employeeName)){p.status='excluded';p.reason='مبيعات مكتب: مبيعات شركة أخرى مستبعدة تلقائيًا';p.repId='';p.repName='';p.totalCents=0;}
  else if(mixed){p.status='conflict';p.reason='نفس رقم المستند يحتوي موظفين أو عملاء أو تواريخ مختلفة؛ راجع التقرير';}
  else if(missingEmployee(first)){p.status='unassigned';p.reason='بدون بيانات موظف كاملة في ERP؛ تُتجاوز تلقائيًا ولا تُحتسب لأي مندوب';p.repId='';p.repName='';p.totalCents=rows.reduce((total,row)=>total+row.totalCents,0);}
  else if(!repId){p.status='unmapped';p.reason='اربط رقم الموظف بالمندوب لأول مرة';}
  else if(!rep){p.status='out_of_scope';p.reason='المندوب المرتبط خارج نطاق فريقك أو منطقتك';p.repId='';}
  else if(first.date>today()){p.status='conflict';p.reason='تاريخ المستند في المستقبل';}
  else if(unmappedCategory){p.status='unmapped';p.reason='حدد صنف المستهدف المقابل لكل فئة في الفاتورة';}
  else if(!items.length){p.status='excluded';p.reason='كل فئات هذا المستند مستبعدة من اختيارك';}
  else if(first.documentType==='sale'&&manualKeys.has(JSON.stringify([first.date.slice(0,4),canonicalInvoiceReference(first.reference)]))){p.status='conflict';p.reason='رقم الفاتورة موجود في المبيعات اليدوية في نفس السنة؛ راجع السجل قبل الاستيراد لمنع التكرار';}
  else if(old){if(old.rep_id!==repId||(regionScope(c.me)!=='all'&&old.region_scope!==regionScope(c.me))){p.status='out_of_scope';p.reason='المستند محفوظ لمندوب أو منطقة أخرى';}else if(old.content_hash===contentHash&&old.mapped_hash===mappedHash){p.status='duplicate';p.reason='مستند مطابق محفوظ سابقًا؛ لن يُضاف مرة أخرى';}else{p.status='conflict';p.reason='رقم المستند محفوظ بمحتوى أو ربط مختلف؛ لن يتم استبداله';}}
  documents.push({preview:p,rows,items,contentHash,mappedHash,rep:p.status==='unassigned'?undefined:rep});
 }
 const summary={newCount:0,duplicateCount:0,conflictCount:0,excludedCount:0,unassignedCount:0,unassignedTotalCents:0,unmappedCount:0,outOfScopeCount:0,officeExcludedCount:0,skippedCount:0,autoMatchedCount:[...mappingSources.values()].filter(source=>source==='name').length,totalCents:0,months:[...new Set(documents.filter(d=>d.preview.status==='new'||d.preview.status==='duplicate').map(d=>d.preview.date.slice(0,7)))].sort()};
 for(const {preview:p} of documents){const field={new:'newCount',duplicate:'duplicateCount',conflict:'conflictCount',excluded:'excludedCount',unassigned:'unassignedCount',unmapped:'unmappedCount',out_of_scope:'outOfScopeCount'}[p.status] as 'newCount';summary[field]++;if(p.status==='new')summary.totalCents+=p.totalCents;if(p.status==='unassigned')summary.unassignedTotalCents+=p.totalCents;if(p.status==='excluded'&&office(p.employeeName))summary.officeExcludedCount++;}
 summary.skippedCount=summary.unmappedCount+summary.outOfScopeCount;
 const memberSnapshot=sorted([c.me,...members.filter(m=>m.id!==c.me.id)],m=>m.id).map(snapshot);
 const snapshotHash=await hash(JSON.stringify({revision:saved.revision,members:memberSnapshot,nameRoster:nameRosterSnapshot,employees:saved.employees,categories:saved.categories}));
 const relevantEmployees=new Set(relevantRows.map(r=>JSON.stringify([normalize(r.employeeId),normalize(r.employeeName)])));
 const employees=parsed.employees.filter(e=>relevantEmployees.has(JSON.stringify([normalize(e.employeeId),normalize(e.employeeName)]))).map(employee=>{const id=normalize(employee.employeeId),repId=employeeMap.get(id)||'',visibleRep=allowed.has(repId);return {...employee,repId:visibleRep?repId:'',mappingSource:visibleRep?(mappingSources.get(id)||'unmapped'):'unmapped'};});
 const warnings=parsed.warnings.filter(warning=>warning!=='توجد بنود بدون رقم أو اسم موظف؛ يلزم مراجعة الربط قبل الاعتماد'||documents.some(d=>d.preview.status==='conflict'&&d.rows.some(missingEmployee)));
 return {documents,summary,saved,employeeMap,categoryMap,employeeIds,categoryIds,members,snapshotHash,nameRosterSnapshot,employees,categories:[...categoryIds].sort(),warnings:[...warnings,'مبيعات مكتب مستبعدة تلقائيًا حسب اسم الموظف. المرتجعات تخصم من المبيعات والمستهدف في شهر تاريخها.']};
}

/** Preview is stateless and authenticated; no uploaded bytes or sales are saved here. */
export async function importErpSales(c:Context,body:unknown){
 requireSalesWorkspace(c.me);
 const {input,bytes}=parseInput(body),fingerprint=await hash(c.me.id+':'+canonicalInput(input));
 const replay=async()=>{if(input.action!=='commit'||!input.requestId)return null;const row=await c.db.prepare('SELECT actor_id,fingerprint,result FROM crm_erp_imports WHERE id=?').bind('erp-import-'+input.requestId).first<any>();if(!row)return null;if(row.actor_id!==c.me.id)throw new CRMError('طلب الاستيراد غير متاح',404);if(row.fingerprint!==fingerprint)throw new CRMError('تم حفظ الطلب ببيانات مختلفة؛ ارفع الملف للمعاينة من جديد',409);return {...JSON.parse(row.result),alreadySaved:true};};
 const prior=await replay();if(prior)return prior;
 const prepared=await prepare(c,input,bytes);
 if(input.action==='preview'){
  const payload=['1',String(Date.now()+15*60_000),fingerprint,prepared.snapshotHash].join('.');
  return {previewToken:payload+'.'+await signature(payload),documents:prepared.documents.map(d=>d.preview),employees:prepared.employees,categories:prepared.categories,summary:prepared.summary,warnings:prepared.warnings};
 }
 if(!input.requestId||!input.previewToken)throw new CRMError('اعرض الملف أولًا قبل تأكيد الاستيراد');
 const pieces=input.previewToken.split('.');
 if(pieces.length!==5||pieces[0]!=='1'||!/^\d{13}$/.test(pieces[1])||!pieces.slice(2).every(v=>/^[a-f0-9]{64}$/.test(v)))throw new CRMError('معاينة الملف غير صحيحة؛ اعرضه مرة أخرى',409);
 const payload=pieces.slice(0,4).join('.');
 if(!safeEqual(await signature(payload),pieces[4])||pieces[2]!==fingerprint)throw new CRMError('تغير الملف أو اختيارات الربط؛ اعرضه مرة أخرى',409);
 if(Number(pieces[1])<Date.now()||Number(pieces[1])>Date.now()+16*60_000||pieces[3]!==prepared.snapshotHash)throw new CRMError('انتهت المعاينة أو تغيّرت الصلاحيات أو الربط؛ اعرض الملف مرة أخرى',409);
 if(prepared.summary.conflictCount)throw new CRMError('يوجد تعارض في مستندات التقرير؛ صححه قبل الاستيراد',409);
 if(prepared.summary.skippedCount&&!input.allowSkipped)throw new CRMError('راجع المستندات غير المربوطة أو خارج الصلاحية ووافق صراحة على تخطيها',409);
 const fresh=prepared.documents.filter(d=>d.preview.status==='new');
 const now=new Date().toISOString(),id='erp-import-'+input.requestId;
 const result={ok:true,importedCount:fresh.length,duplicateCount:prepared.summary.duplicateCount,excludedCount:prepared.summary.excludedCount,officeExcludedCount:prepared.summary.officeExcludedCount,unassignedCount:prepared.summary.unassignedCount,unassignedTotalCents:prepared.summary.unassignedTotalCents,skippedCount:prepared.summary.skippedCount,totalCents:prepared.summary.totalCents,months:prepared.summary.months};
 const guard=accessGuard(c),usedReps=new Map<string,Member>();
 const mappingDocuments=prepared.documents.filter(d=>['new','duplicate','excluded'].includes(d.preview.status)&&d.rep&&!office(d.preview.employeeName));
 for(const document of mappingDocuments)if(document.rep)usedReps.set(document.rep.id,document.rep);
 const mappingEmployeeIds=new Set(mappingDocuments.map(d=>normalize(d.preview.employeeId)));
 for(const priorMapping of prepared.saved.employees){const employeeId=normalize(priorMapping.employeeId);if(mappingEmployeeIds.has(employeeId)&&prepared.employeeMap.get(employeeId)!==priorMapping.repId){const priorMember=c.members.find(m=>m.id===priorMapping.repId);if(priorMember)usedReps.set(priorMember.id,priorMember);}}
 // The claim is the transaction gate: every subsequent write requires it.
 // A racing role/region/team/mapping change makes the complete batch a no-op.
 let gate=guard.sql+' AND EXISTS(SELECT 1 FROM crm_erp_import_state WHERE id=? AND revision=?)';
 const args:(string|number)[]=[...guard.args,namespace,prepared.saved.revision];
 for(const member of usedReps.values()){gate+=" AND EXISTS(SELECT 1 FROM crm_members WHERE id=? AND role=? AND branch=? AND COALESCE(supervisor_id,'')=? AND region_scope=? AND active=? AND auth_version=? AND name=?)";args.push(...snapshot(member));}
 if(prepared.nameRosterSnapshot){
  // Recheck the complete name-matching roster at the same atomic claim as sales.
  // One JSON parameter avoids SQLite's bind limit; indexed IDs check old rows,
  // while the count also catches newly inserted/promoted duplicate-name reps.
  gate+=` AND (SELECT COUNT(*) FROM crm_members WHERE role='rep')=? AND NOT EXISTS(
   SELECT 1 FROM json_each(?) AS expected LEFT JOIN crm_members AS actual ON actual.id=json_extract(expected.value,'$[0]')
   WHERE actual.id IS NULL OR actual.role IS NOT json_extract(expected.value,'$[1]')
    OR actual.branch IS NOT json_extract(expected.value,'$[2]') OR COALESCE(actual.supervisor_id,'') IS NOT json_extract(expected.value,'$[3]')
    OR actual.region_scope IS NOT json_extract(expected.value,'$[4]') OR actual.active IS NOT json_extract(expected.value,'$[5]')
    OR actual.auth_version IS NOT json_extract(expected.value,'$[6]') OR actual.name IS NOT json_extract(expected.value,'$[7]'))`;
  args.push(prepared.nameRosterSnapshot.length,JSON.stringify(prepared.nameRosterSnapshot));
 }
 const claim=c.db.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) SELECT ?,?,?,?,?,? WHERE '+gate).bind(id,c.me.id,fingerprint,input.fileName,JSON.stringify(result),now,...args);
 const claimed='EXISTS(SELECT 1 FROM crm_erp_imports WHERE id=? AND actor_id=? AND fingerprint=?)',claimArgs=[id,c.me.id,fingerprint];
 const batch:D1PreparedStatement[]=[claim];
 for(const document of fresh){const p=document.preview,first=document.rows[0],member=document.rep!;const data={items:document.items,discount:0,notes:'',employeeId:first.employeeId,employeeName:first.employeeName,sourceLineCount:document.rows.length};batch.push(c.db.prepare('INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE '+claimed).bind('erp-sale-'+p.key,p.key,document.contentHash,document.mappedHash,p.reference,p.documentType,p.date,first.employeeId,member.id,member.branch,regionScope(member),first.customerCode,first.customerName,JSON.stringify(data),p.totalCents,id,c.me.id,now,...claimArgs));}
 const usedEmployees=new Set(mappingDocuments.map(d=>normalize(d.preview.employeeId))),usedCategories=new Set(mappingDocuments.flatMap(d=>d.rows.map(r=>normalize(r.category))));
 for(const employeeId of usedEmployees){const repId=prepared.employeeMap.get(employeeId)!;batch.push(c.db.prepare('INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) SELECT ?,?,?,? WHERE '+claimed+' ON CONFLICT(employee_id) DO UPDATE SET rep_id=excluded.rep_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(employeeId,repId,c.me.id,now,...claimArgs));}
 for(const category of usedCategories){const product=prepared.categoryMap.get(category)!;batch.push(c.db.prepare('INSERT INTO crm_erp_category_mappings(category,product,updated_by,updated_at) SELECT ?,?,?,? WHERE '+claimed+' ON CONFLICT(category) DO UPDATE SET product=excluded.product,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(category,product,c.me.id,now,...claimArgs));}
 batch.push(c.db.prepare('UPDATE crm_erp_import_state SET revision=revision+1 WHERE id=? AND '+claimed).bind(namespace,...claimArgs));
 batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(id,id,c.me.name,'استيراد مبيعات ERP',JSON.stringify({fileName:input.fileName,...result}),now,...claimArgs));
 let committed;try{committed=await c.db.batch(batch);}catch(error){const saved=await replay();if(saved)return saved;throw error;}
 if(committed[0].meta.changes!==1){const saved=await replay();if(saved)return saved;throw new CRMError('تغيّرت الصلاحيات أو الربط أثناء الحفظ؛ اعرض الملف مرة أخرى',409);}
 return result;
}

/** Financial projections always require the same region and author-team boundary as CRM sales. */
export async function readErpSales(c:Context,month:string):Promise<Sale[]>{
 requireSalesWorkspace(c.me);const allowed=salesReadMemberIds(c.members,c.me);
 const rows=(await c.db.prepare('SELECT * FROM crm_erp_sales WHERE date>=? AND date<=? AND (?=\'all\' OR region_scope=?) ORDER BY date DESC,created_at DESC,id').bind(month+'-01',month+'-31',regionScope(c.me),regionScope(c.me)).all<any>()).results;
 return rows.filter(r=>allowed.has(r.rep_id)).map(r=>({...JSON.parse(r.data),id:r.id,customerId:'erp-customer:'+r.customer_code,customerName:r.customer_name,repId:r.rep_id,branch:r.branch,date:r.date,reference:r.reference,totalCents:r.total_cents,status:'confirmed',voidReason:'',version:1,createdBy:r.created_by,createdAt:r.created_at,updatedAt:r.created_at,source:'erp',documentType:r.document_type}));
}
/** Reps receive only their product quantities; no invoice, customer, price or colleague data. */
export async function readOwnErpSales(c:Context,month:string):Promise<{items:{product:string;quantity:number}[]}[]>{
 if(c.me.role!=='rep')throw new CRMError('هذا العرض خاص بالمندوب',403);
 const rows=(await c.db.prepare('SELECT data FROM crm_erp_sales WHERE rep_id=? AND date>=? AND date<=? AND (?=\'all\' OR region_scope=?)').bind(c.me.id,month+'-01',month+'-31',regionScope(c.me),regionScope(c.me)).all<{data:string}>()).results;
 return rows.map(row=>({items:(JSON.parse(row.data).items as SaleItem[]).map(item=>({product:item.product,quantity:item.quantity}))}));
}

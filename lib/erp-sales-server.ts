import {env} from 'cloudflare:workers';
import {canonicalInvoiceReference} from './invoice-reference';
import {z} from 'zod';
import {context,CRMError,requireSalesWorkspace,accessGuard} from './crm-server';
import {salesMemberIds,salesReadMemberIds,salesProducts,type Sale,type SaleItem} from './sales';
import {regionScope,regionScopeAdmits,regionScopeSql} from './regions';
import {today,type Member} from './crm';
import {parseErpWorkbook,ErpWorkbookError,type ErpRow} from './erp-sales';
import {omit} from './omit';
import {quotationRefs,storedQuotationRefs,MAX_QUOTATION_REFS} from './quotation-refs';
import {coveragePeriod,filePeriod,periodMonths,salesCoverageEntrySchema,type SalesCoverageEntry} from './sales-coverage';
import {ERP_OFFICE_CHOICE,ERP_OFFICE_SETTING,ERP_OFFICE_AUDIT_ACTION,officeById,officeNameOnly,officeIdKey,applyOfficeChanges,readOfficeRow,officeUnchanged,writeOfficeList} from './erp-office-employees';

type Context=Awaited<ReturnType<typeof context>>;
const namespace='yourrest-industries';
const normalize=(value:string)=>value.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').replace(/\s+/g,' ').trim();
// Full names only: do not guess from partial names, spelling similarity or team size.
const employeeNameKey=(value:string)=>normalize(value).toLowerCase();
const office=(value:string)=>['مبيعات مكتب','مبيعات المكتب'].includes(normalize(value));
// «مبيعات مكتب (مستبعد)» chosen for an employee number (lib/erp-office-employees.ts): the same exclusion as the name above.
export const ERP_OFFICE_REASON='مبيعات مكتب (تحديد الموظف): مستبعدة ولا تُحتسب لأي مندوب';
export const ERP_OFFICE_SAVED_REASON='مبيعات مكتب (تحديد الموظف): مستبعدة من هذا الاستيراد؛ النسخة المحفوظة سابقًا للمندوب تبقى كما هي';
export const ERP_OFFICE_LOCKED='تعديل موظف محدد «مبيعات مكتب» متاح لمدير المبيعات أو مدير النظام فقط';
const maxFileBytes=5*1024*1024;
const mappingSchema=z.object({employeeId:z.string().trim().min(1).max(100),repId:z.string().trim().min(1).max(200)});
const categorySchema=z.object({category:z.string().trim().min(1).max(300),product:z.string().refine(s=>s==='exclude'||salesProducts.includes(s),'اختر صنفًا صحيحًا')});
const inputSchema=z.object({action:z.enum(['preview','commit']),fileName:z.string().trim().min(1).max(255),base64:z.string().min(1).max(Math.ceil(maxFileBytes/3)*4),employeeMappings:z.array(mappingSchema).max(5000).default([]),categoryMappings:z.array(categorySchema).max(500).default([]),allowSkipped:z.boolean().default(false),previewToken:z.string().max(1024).optional(),requestId:z.string().uuid().optional(),
 // «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها» (lib/sales-coverage.ts): ticked at the commit, with the period it speaks for
 // (by default the file's first and last invoice date). Not part of the preview: ticking it never needs a new preview.
 completeSnapshot:z.boolean().default(false),coverageFrom:z.string().max(10).optional(),coverageTo:z.string().max(10).optional()});
type Input=z.infer<typeof inputSchema>;
export type ErpDocumentPreview={key:string;reference:string;date:string;documentType:'sale'|'return';customerName:string;employeeId:string;employeeName:string;repId:string;repName:string;lineCount:number;totalCents:number;status:'new'|'duplicate'|'conflict'|'excluded'|'unassigned'|'unmapped'|'out_of_scope';reason:string};
export type ErpSaleRow={id:string;rep_id:string;branch:string;date:string;reference:string;document_type:'sale'|'return';customer_code:string;customer_name:string;data:string;total_cents:number;created_by:string;created_at:string;region_scope:string};
// quotationRefs: the quotations the document's «الوصف» names (null: the report has no description column, so nothing is read or written
// about them). backfill: an identical document already saved whose stored references differ: the import writes the file's references
// into its data (lib/quotation-refs.ts), which is neither a new document nor a change of its content.
type PreparedDocument={preview:ErpDocumentPreview;rows:ErpRow[];items:SaleItem[];contentHash:string;mappedHash:string;rep?:Member;quotationRefs:string[]|null;backfill?:{prior:string};
 /** Excluded as office sales: by the employee's name (the ERP's «مبيعات مكتب») or by the employee's «مبيعات مكتب (مستبعد)» mark. */
 office?:'name'|'mark';officeSaved?:boolean};
/** The references saved on a document (none when never read). */
function savedRefs(text:string){if(!text)return [];try{return storedQuotationRefs(JSON.parse(text));}catch{return [];}}
/** The references of a document's lines, each once, in line order. */
function documentQuotationRefs(rows:ErpRow[]){const refs:string[]=[];for(const row of rows)for(const ref of quotationRefs(row.description))if(!refs.includes(ref)&&refs.length<MAX_QUOTATION_REFS)refs.push(ref);return refs;}
function missingEmployee(row:ErpRow){return !normalize(row.employeeName)||!normalize(row.employeeId);}
function mixedDocument(rows:ErpRow[]){const first=rows[0];return rows.some(r=>r.date!==first.date||normalize(r.employeeId)!==normalize(first.employeeId)||normalize(r.employeeName)!==normalize(first.employeeName)||normalize(r.customerCode)!==normalize(first.customerCode)||normalize(r.customerName)!==normalize(first.customerName));}
function sorted<T>(items:T[],key:(item:T)=>string){return [...items].sort((a,b)=>key(a).localeCompare(key(b),'en'));}
async function hash(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export async function erpInvoiceKey(reference:string,date:string){return hash(JSON.stringify([namespace,'invoice','sale',date.slice(0,4),canonicalInvoiceReference(reference)]));}
async function signature(value:string){if(!/^[a-f0-9]{64,}$/i.test(env.YR_AUTH_SECRET||''))throw new CRMError('خدمة الاستيراد غير مهيأة. تواصل مع مدير النظام.',503);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.YR_AUTH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('yourrest-erp-preview:'+value))),b=>b.toString(16).padStart(2,'0')).join('');}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let difference=0;for(let n=0;n<a.length;n++)difference|=a.charCodeAt(n)^b.charCodeAt(n);return difference===0;}
function eligible(c:Context){const ids=salesMemberIds(c.members,c.me);return c.regionalMembers.filter(m=>m.role==='rep'&&ids.has(m.id));}
function snapshot(m:Member){return [m.id,m.role,m.branch,m.supervisorId||'',regionScope(m),m.active,m.authVersion||0,m.name];}
async function state(c:Context){const revision=await c.db.prepare('SELECT revision FROM crm_erp_import_state WHERE id=?').bind(namespace).first<{revision:number}>();if(!revision)throw new CRMError('تحديث قاعدة بيانات استيراد المبيعات غير مكتمل.',503);const employees=(await c.db.prepare('SELECT employee_id AS employeeId,rep_id AS repId FROM crm_erp_employee_mappings ORDER BY employee_id').all<{employeeId:string;repId:string}>()).results;const categories=(await c.db.prepare('SELECT category,product FROM crm_erp_category_mappings ORDER BY category').all<{category:string;product:string}>()).results;const office=await readOfficeRow(c.db);return {revision:revision.revision,employees,categories,office};}
export async function erpSalesConfiguration(c:Context){requireSalesWorkspace(c.me);const members=eligible(c),ids=new Set(members.map(m=>m.id)),saved=await state(c);// The employees marked «مبيعات مكتب (مستبعد)» come as mappings to ERP_OFFICE_CHOICE, to every importer (an ERP number and the name the
 // file showed: no representative, sale or customer); a supervisor reads them and cannot change them (canChangeOffice).
 const office=[...officeById(saved.office.list).values()].map(e=>({employeeId:e.employeeId,repId:ERP_OFFICE_CHOICE}));
 return {members:members.map(m=>({id:m.id,name:m.name,branch:m.branch})),employeeMappings:[...saved.employees.filter(m=>ids.has(m.repId)&&!officeById(saved.office.list).has(officeIdKey(m.employeeId))),...office],categoryMappings:saved.categories,products:salesProducts,canEditCategoryMappings:c.me.role!=='supervisor',canChangeOffice:c.me.role!=='supervisor'};}
function parseInput(body:unknown){const input=inputSchema.parse(body);if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw new CRMError('ترميز ملف المبيعات غير صحيح');const raw=atob(input.base64);if(raw.length>maxFileBytes)throw new CRMError('أقصى حجم لملف المبيعات 5 ميجابايت',413);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));return {input,bytes};}
/** The request a preview is signed for; with coverage, the commit's own (a retry with another completeness choice is another request).
 *  Without the tick both are exactly what they were before it existed. */
function canonicalInput(input:Input,coverage=false){return JSON.stringify({fileName:input.fileName,base64:input.base64,allowSkipped:input.allowSkipped,employeeMappings:sorted(input.employeeMappings,m=>m.employeeId),categoryMappings:sorted(input.categoryMappings,m=>m.category),...(coverage&&input.completeSnapshot?{completeSnapshot:true,coverageFrom:input.coverageFrom||'',coverageTo:input.coverageTo||''}:{})});}
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
 const employeeIds=new Set(relevantRows.map(r=>normalize(r.employeeId)));
 // «مبيعات مكتب (مستبعد)» by employee number: saved, chosen here, or suggested by a name mark of the collection statement. A saved one
 // wins over a saved representative mapping (marking deletes that mapping, so both exist only if written around this import).
 const savedOffice=officeById(saved.office.list),officeNames=officeNameOnly(saved.office.list);
 const officeSources=new Map<string,'saved'|'selected'|'name'>([...savedOffice.keys()].map(key=>[key,'saved']));
 const isOffice=(employeeId:string)=>officeSources.has(officeIdKey(employeeId));
 const officeMarks=new Map<string,{employeeId:string;priorRepId:string}>(),officeUnmarks=new Map<string,{employeeId:string;repId:string}>();
 for(const [id,m] of employeeChanges){
  if(!employeeIds.has(id))continue;
  const key=officeIdKey(id),prior=employeeMap.get(id),wasOffice=savedOffice.has(key);
  if(m.repId===ERP_OFFICE_CHOICE){
   if(wasOffice)continue;
   // Marking is a change of the employee's mapping: the same people may make it (the former representative within the importer's reach).
   if(prior&&!allowed.has(prior))throw new CRMError('ربط الموظف خارج نطاق فريقك أو منطقتك',403);
   officeSources.set(key,'selected');officeMarks.set(key,{employeeId:id,priorRepId:prior||''});employeeMap.delete(id);mappingSources.delete(id);continue;
  }
  if(wasOffice){
   // Back to a representative: a saved office mark is company-wide, so a supervisor (whose reach is a team) may not lift it.
   if(c.me.role==='supervisor')throw new CRMError(ERP_OFFICE_LOCKED,403);
   if(!allowed.has(m.repId))throw new CRMError('ربط الموظف خارج نطاق فريقك أو منطقتك',403);
   officeSources.delete(key);officeUnmarks.set(key,{employeeId:id,repId:m.repId});employeeMap.set(id,m.repId);mappingSources.set(id,'selected');continue;
  }
  if(prior&&!allowed.has(prior)||!allowed.has(m.repId))throw new CRMError('ربط الموظف خارج نطاق فريقك أو منطقتك',403);employeeMap.set(id,m.repId);mappingSources.set(id,prior===m.repId?'saved':'selected');
 }
 for(const key of officeSources.keys())for(const id of [...employeeMap.keys()])if(officeIdKey(id)===key){employeeMap.delete(id);mappingSources.delete(id);}
 // Include every rep when checking uniqueness. A hidden or inactive namesake must
 // not make an ambiguous identity look unique inside the uploader's team.
 const nameRoster=c.members.filter(m=>m.role==='rep'),nameCandidates=new Map<string,Member[]>(),erpNames=new Map<string,Set<string>>();
 for(const member of nameRoster){const key=employeeNameKey(member.name);if(key)nameCandidates.set(key,[...(nameCandidates.get(key)||[]),member]);}
 // All rows participate, even office/blank rows sharing an employee ID. A mixed
 // ERP identity needs explicit review rather than an inferred assignment.
 for(const row of parsed.rows){const id=normalize(row.employeeId),names=erpNames.get(id)||new Set<string>();names.add(employeeNameKey(row.employeeName));erpNames.set(id,names);}
 let nameInferenceUsed=false;
 for(const [id,names] of erpNames){
  if(!id||employeeMap.has(id)||names.size!==1||isOffice(id))continue;
  const name=[...names][0];if(!name||office(name))continue;
  // A name marked «مبيعات مكتب» in the collection statement: suggested for this number (saved as its mark with the import).
  if(officeNames.has(name)&&employeeIds.has(id)){officeSources.set(officeIdKey(id),'name');officeMarks.set(officeIdKey(id),{employeeId:id,priorRepId:''});continue;}
  nameInferenceUsed=true;
  const matches=nameCandidates.get(name)||[];
  if(matches.length===1&&allowed.has(matches[0].id)){employeeMap.set(id,matches[0].id);mappingSources.set(id,'name');}
 }
 const nameRosterSnapshot=nameInferenceUsed?sorted(nameRoster,m=>m.id).map(snapshot):null;
 // The categories to map: those of the documents a representative may receive (an office employee's are excluded whole).
 const categoryIds=new Set(relevantRows.filter(r=>!isOffice(r.employeeId)).map(r=>normalize(r.category)));
 for(const [id,m] of categoryChanges)if(categoryIds.has(id)){if(c.me.role==='supervisor'&&categoryMap.has(id)&&categoryMap.get(id)!==m.product)throw new CRMError('تعديل ربط فئة محفوظة متاح لمدير المبيعات أو مدير النظام فقط',403);categoryMap.set(id,m.product);}
 for(const category of categoryIds)if(!categoryMap.has(category)&&salesProducts.includes(category))categoryMap.set(category,category);
 const existing=(await c.db.prepare("SELECT document_key,content_hash,mapped_hash,rep_id,region_scope,COALESCE(json_extract(data,'$.quotationRefs'),'') AS quotation_refs FROM crm_erp_sales").all<{document_key:string;content_hash:string;mapped_hash:string;rep_id:string;region_scope:string;quotation_refs:string}>()).results;const stored=new Map(existing.map(r=>[r.document_key,r]));
 const manual=(await c.db.prepare("SELECT reference,date FROM crm_sales WHERE status='confirmed'").all<{reference:string;date:string}>()).results;
 const manualKeys=new Set(manual.map(r=>JSON.stringify([r.date.slice(0,4),canonicalInvoiceReference(r.reference)])));
 const documents:PreparedDocument[]=[],hasDescription=parsed.hasDescription===true;
 for(const [identity,rows] of groups){
  const first=rows[0],key=await hash(identity),repId=employeeMap.get(normalize(first.employeeId))||'',rep=allowed.get(repId),p:ErpDocumentPreview={key,reference:first.reference,date:first.date,documentType:first.documentType,customerName:first.customerName,employeeId:first.employeeId,employeeName:first.employeeName,repId,repName:rep?.name||'',lineCount:rows.length,totalCents:0,status:'new',reason:''};
  // The description stays out of the content hash: a document saved before it was read (or whose description alone changed) is the same document.
  const contentHash=await hash(JSON.stringify(rows.map(row=>JSON.stringify(omit(row,'rowNumber','description'))).sort()));
  const refs=hasDescription?documentQuotationRefs(rows):null;let backfill:PreparedDocument['backfill'];
  const items:SaleItem[]=[];let unmappedCategory=false;
  for(const row of rows){const product=categoryMap.get(normalize(row.category));if(!product){unmappedCategory=true;continue;}if(product==='exclude')continue;const sign=row.documentType==='return'?-1:1,quantity=Math.abs(row.quantity)*sign,totalCents=Math.abs(row.totalCents)*sign;p.totalCents+=totalCents;items.push({product,description:row.itemName,quantity,unitPrice:quantity?Math.abs(totalCents/100/quantity):Math.abs(row.unitPrice)});}
  const mappedHash=await hash(JSON.stringify({repId,items:items.map(i=>JSON.stringify(i)).sort(),totalCents:p.totalCents}));
  const old=stored.get(key);
  const mixed=mixedDocument(rows);
  if(office(first.employeeName)){p.status='excluded';p.reason='مبيعات مكتب: مبيعات شركة أخرى مستبعدة تلقائيًا';p.repId='';p.repName='';p.totalCents=0;}
  else if(mixed){p.status='conflict';p.reason='نفس رقم المستند يحتوي موظفين أو عملاء أو تواريخ مختلفة؛ راجع التقرير';}
  else if(missingEmployee(first)){p.status='unassigned';p.reason='بدون بيانات موظف كاملة في ERP؛ تُتجاوز تلقائيًا ولا تُحتسب لأي مندوب';p.repId='';p.repName='';p.totalCents=rows.reduce((total,row)=>total+row.totalCents,0);}
  // An employee marked «مبيعات مكتب (مستبعد)»: excluded as the ERP's «مبيعات مكتب». A document already saved for a representative under
  // an earlier mapping is never deleted nor rewritten (as with any changed mapping): it is excluded from this import and said so.
  else if(isOffice(first.employeeId)){p.status='excluded';p.reason=old?ERP_OFFICE_SAVED_REASON:ERP_OFFICE_REASON;p.repId='';p.repName='';p.totalCents=0;}
  else if(!repId){p.status='unmapped';p.reason='اربط رقم الموظف بالمندوب لأول مرة';}
  else if(!rep){p.status='out_of_scope';p.reason='المندوب المرتبط خارج نطاق فريقك أو منطقتك';p.repId='';}
  else if(first.date>today()){p.status='conflict';p.reason='تاريخ المستند في المستقبل';}
  else if(unmappedCategory){p.status='unmapped';p.reason='حدد صنف المستهدف المقابل لكل فئة في الفاتورة';}
  else if(!items.length){p.status='excluded';p.reason='كل فئات هذا المستند مستبعدة من اختيارك';}
  else if(first.documentType==='sale'&&manualKeys.has(JSON.stringify([first.date.slice(0,4),canonicalInvoiceReference(first.reference)]))){p.status='conflict';p.reason='رقم الفاتورة موجود في المبيعات اليدوية في نفس السنة؛ راجع السجل قبل الاستيراد لمنع التكرار';}
  else if(old){if(old.rep_id!==repId||!regionScopeAdmits(regionScope(c.me),old.region_scope)){p.status='out_of_scope';p.reason='المستند محفوظ لمندوب أو منطقة أخرى';}else if(old.content_hash===contentHash&&old.mapped_hash===mappedHash){p.status='duplicate';p.reason='مستند مطابق محفوظ سابقًا؛ لن يُضاف مرة أخرى';if(refs&&JSON.stringify(savedRefs(old.quotation_refs))!==JSON.stringify(refs))backfill={prior:old.quotation_refs};}else{p.status='conflict';p.reason='رقم المستند محفوظ بمحتوى أو ربط مختلف؛ لن يتم استبداله';}}
  const officeDoc=office(first.employeeName)?'name' as const:p.reason===ERP_OFFICE_REASON||p.reason===ERP_OFFICE_SAVED_REASON?'mark' as const:undefined;
  documents.push({preview:p,rows,items,contentHash,mappedHash,rep:p.status==='unassigned'||officeDoc?undefined:rep,quotationRefs:refs,backfill,office:officeDoc,officeSaved:p.reason===ERP_OFFICE_SAVED_REASON});
 }
 const summary={newCount:0,duplicateCount:0,conflictCount:0,excludedCount:0,unassignedCount:0,unassignedTotalCents:0,unmappedCount:0,outOfScopeCount:0,officeExcludedCount:0,skippedCount:0,autoMatchedCount:[...mappingSources.values()].filter(source=>source==='name').length,totalCents:0,months:[...new Set(documents.filter(d=>d.preview.status==='new'||d.preview.status==='duplicate').map(d=>d.preview.date.slice(0,7)))].sort()};
 for(const {preview:p} of documents){const field={new:'newCount',duplicate:'duplicateCount',conflict:'conflictCount',excluded:'excludedCount',unassigned:'unassignedCount',unmapped:'unmappedCount',out_of_scope:'outOfScopeCount'}[p.status] as 'newCount';summary[field]++;if(p.status==='new')summary.totalCents+=p.totalCents;if(p.status==='unassigned')summary.unassignedTotalCents+=p.totalCents;}
 // The marks' counts are given only when there is one (a file without a marked employee answers exactly as before).
 const officeCounts:{officeMarkedCount?:number;officeSavedCount?:number}={};
 for(const d of documents){if(d.office)summary.officeExcludedCount++;if(d.office==='mark')officeCounts.officeMarkedCount=(officeCounts.officeMarkedCount||0)+1;if(d.officeSaved)officeCounts.officeSavedCount=(officeCounts.officeSavedCount||0)+1;}
 summary.skippedCount=summary.unmappedCount+summary.outOfScopeCount;
 // Only a report with a description column says anything about quotations: one without it answers exactly as before.
 const quotationSummary=hasDescription?{quotationLinkedCount:documents.filter(d=>['new','duplicate'].includes(d.preview.status)&&d.preview.documentType==='sale'&&!!d.quotationRefs?.length).length,quotationRefsBackfillCount:documents.filter(d=>d.backfill).length}:null;
 const memberSnapshot=sorted([c.me,...members.filter(m=>m.id!==c.me.id)],m=>m.id).map(snapshot);
 const snapshotHash=await hash(JSON.stringify({revision:saved.revision,members:memberSnapshot,nameRoster:nameRosterSnapshot,employees:saved.employees,categories:saved.categories,office:saved.office.raw}));
 const relevantEmployees=new Set(relevantRows.map(r=>JSON.stringify([normalize(r.employeeId),normalize(r.employeeName)])));
 const employees=parsed.employees.filter(e=>relevantEmployees.has(JSON.stringify([normalize(e.employeeId),normalize(e.employeeName)]))).map(employee=>{
  const id=normalize(employee.employeeId),officeSource=officeSources.get(officeIdKey(employee.employeeId));
  // An office employee: the select shows «مبيعات مكتب (مستبعد)»; a saved mark is locked for a supervisor (ERP_OFFICE_LOCKED).
  if(officeSource)return {...employee,repId:ERP_OFFICE_CHOICE,mappingSource:officeSource,office:true,officeLocked:officeSource==='saved'&&c.me.role==='supervisor'};
  const repId=employeeMap.get(id)||'',visibleRep=allowed.has(repId);return {...employee,repId:visibleRep?repId:'',mappingSource:visibleRep?(mappingSources.get(id)||'unmapped'):'unmapped'};});
 // The marks this import saves (chosen or suggested by name, for an employee of the file) and lifts (back to a representative, saved
 // with that representative's mapping only).
 const listed=new Set(employees.map(e=>officeIdKey(e.employeeId)));
 const officeMarksToSave=[...officeMarks].filter(([key])=>listed.has(key)&&officeSources.has(key)).map(([key,m])=>({key,employeeId:m.employeeId,employeeName:parsed.employees.find(e=>officeIdKey(e.employeeId)===key)?.employeeName||'',priorRepId:m.priorRepId}));
 const warnings=parsed.warnings.filter(warning=>warning!=='توجد بنود بدون رقم أو اسم موظف؛ يلزم مراجعة الربط قبل الاعتماد'||documents.some(d=>d.preview.status==='conflict'&&d.rows.some(missingEmployee)));
 // The period a complete file speaks for, and who: the representatives the uploader may import for, less those of a document skipped as
 // outside the uploader's access; allReps when that was every active representative and nothing was skipped (lib/sales-coverage.ts).
 const period=filePeriod(parsed.rows.map(row=>row.date),today());
 const skippedReps=new Set(documents.filter(d=>d.preview.status==='out_of_scope'&&d.preview.repId).map(d=>d.preview.repId));
 const coveredReps=members.filter(m=>!skippedReps.has(m.id)).map(m=>m.id).sort();
 const activeReps=c.members.filter(m=>m.role==='rep'&&m.active).map(m=>m.id);
 const allReps=summary.outOfScopeCount===0&&activeReps.every(id=>allowed.has(id));
 const coverage=period?{...period,months:periodMonths(period.first,period.last),repCount:coveredReps.length,allReps,
  blocker:summary.unmappedCount?'لا يمكن تأكيد اكتمال الملف وفيه مستندات تحتاج ربطًا؛ أكمل الربط أولًا.':!coveredReps.length?'لا يوجد مناديب ضمن صلاحيتك يشملهم تأكيد الاكتمال.':''}:null;
 const officeWarnings=[...officeCounts.officeMarkedCount?['مستندات الموظفين المحددين «مبيعات مكتب (مستبعد)» مستبعدة ولا تُحتسب لأي مندوب.']:[],...officeCounts.officeSavedCount?['مستندات حُفظت سابقًا لمندوب ثم حُدد موظفها «مبيعات مكتب»: تبقى محفوظة لمندوبها كما هي، ولا يحذف الاستيراد أي مبيعات محفوظة.']:[]];
 return {documents,summary:{...summary,...officeCounts,...quotationSummary},quotationSummary,coverage,coveredReps,activeReps,saved,employeeMap,categoryMap,employeeIds,categoryIds,members,snapshotHash,nameRosterSnapshot,employees,officeMarksToSave,officeUnmarks,categories:[...categoryIds].sort(),warnings:[...warnings,...officeWarnings,'مبيعات مكتب مستبعدة تلقائيًا حسب اسم الموظف. المرتجعات تخصم من المبيعات والمستهدف في شهر تاريخها.']};
}

/** Preview is stateless and authenticated; no uploaded bytes or sales are saved here. */
export async function importErpSales(c:Context,body:unknown){
 requireSalesWorkspace(c.me);
 const {input,bytes}=parseInput(body),previewFingerprint=await hash(c.me.id+':'+canonicalInput(input)),fingerprint=input.completeSnapshot?await hash(c.me.id+':'+canonicalInput(input,true)):previewFingerprint;
 const replay=async()=>{if(input.action!=='commit'||!input.requestId)return null;const row=await c.db.prepare('SELECT actor_id,fingerprint,result FROM crm_erp_imports WHERE id=?').bind('erp-import-'+input.requestId).first<{actor_id:string;fingerprint:string;result:string}>();if(!row)return null;if(row.actor_id!==c.me.id)throw new CRMError('طلب الاستيراد غير متاح',404);if(row.fingerprint!==fingerprint)throw new CRMError('تم حفظ الطلب ببيانات مختلفة؛ ارفع الملف للمعاينة من جديد',409);return {...JSON.parse(row.result),alreadySaved:true};};
 const prior=await replay();if(prior)return prior;
 const prepared=await prepare(c,input,bytes);
 if(input.action==='preview'){
  const payload=['1',String(Date.now()+15*60_000),previewFingerprint,prepared.snapshotHash].join('.');
  return {previewToken:payload+'.'+await signature(payload),documents:prepared.documents.map(d=>d.preview),employees:prepared.employees,categories:prepared.categories,summary:prepared.summary,warnings:prepared.warnings,coverage:prepared.coverage};
 }
 if(!input.requestId||!input.previewToken)throw new CRMError('اعرض الملف أولًا قبل تأكيد الاستيراد');
 const pieces=input.previewToken.split('.');
 if(pieces.length!==5||pieces[0]!=='1'||!/^\d{13}$/.test(pieces[1])||!pieces.slice(2).every(v=>/^[a-f0-9]{64}$/.test(v)))throw new CRMError('معاينة الملف غير صحيحة؛ اعرضه مرة أخرى',409);
 const payload=pieces.slice(0,4).join('.');
 if(!safeEqual(await signature(payload),pieces[4])||pieces[2]!==previewFingerprint)throw new CRMError('تغير الملف أو اختيارات الربط؛ اعرضه مرة أخرى',409);
 if(Number(pieces[1])<Date.now()||Number(pieces[1])>Date.now()+16*60_000||pieces[3]!==prepared.snapshotHash)throw new CRMError('انتهت المعاينة أو تغيّرت الصلاحيات أو الربط؛ اعرض الملف مرة أخرى',409);
 if(prepared.summary.conflictCount)throw new CRMError('يوجد تعارض في مستندات التقرير؛ صححه قبل الاستيراد',409);
 if(prepared.summary.skippedCount&&!input.allowSkipped)throw new CRMError('راجع المستندات غير المربوطة أو خارج الصلاحية ووافق صراحة على تخطيها',409);
 const fresh=prepared.documents.filter(d=>d.preview.status==='new');
 const now=new Date().toISOString(),id='erp-import-'+input.requestId;
 // «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها»: one coverage entry in this import's own row, audited with it (lib/sales-coverage.ts).
 let coverage:SalesCoverageEntry|undefined;
 if(input.completeSnapshot){
  if(!prepared.coverage)throw new CRMError('الملف بلا تواريخ فواتير؛ لا يمكن تأكيد اكتماله.');
  if(prepared.coverage.blocker)throw new CRMError(prepared.coverage.blocker,409);
  const checked=coveragePeriod(prepared.coverage,input.coverageFrom,input.coverageTo);
  if('error' in checked)throw new CRMError(checked.error);
  const months=periodMonths(checked.from,checked.to);
  coverage={complete:true,from:checked.from,to:checked.to,months:months.full,partialMonths:months.partial,repIds:prepared.coveredReps,allReps:prepared.coverage.allReps,importerId:c.me.id,importer:c.me.name,at:now,importId:id};
 }
 const backfills=prepared.documents.filter(d=>d.backfill);
 // «مبيعات مكتب (مستبعد)»: the marks chosen (or suggested by name) are saved; a mark is lifted only together with the representative
 // mapping that replaces it (an employee whose documents are not taken by this import keeps the mark).
 const savedMappingEmployees=new Set(prepared.documents.filter(d=>['new','duplicate','excluded'].includes(d.preview.status)&&d.rep&&!d.office).map(d=>normalize(d.preview.employeeId)));
 const officeMarked=prepared.officeMarksToSave,officeUnmarked=[...prepared.officeUnmarks.values()].filter(u=>savedMappingEmployees.has(normalize(u.employeeId)));
 const result={ok:true,...(officeMarked.length||officeUnmarked.length?{officeMarkedCount:officeMarked.length,officeUnmarkedCount:officeUnmarked.length}:{}),...prepared.quotationSummary,importedCount:fresh.length,duplicateCount:prepared.summary.duplicateCount,excludedCount:prepared.summary.excludedCount,officeExcludedCount:prepared.summary.officeExcludedCount,unassignedCount:prepared.summary.unassignedCount,unassignedTotalCents:prepared.summary.unassignedTotalCents,skippedCount:prepared.summary.skippedCount,totalCents:prepared.summary.totalCents,months:prepared.summary.months,...(coverage?{coverage}:{})};
 const guard=accessGuard(c),usedReps=new Map<string,Member>();
 const mappingDocuments=prepared.documents.filter(d=>['new','duplicate','excluded'].includes(d.preview.status)&&d.rep&&!office(d.preview.employeeName));
 for(const document of mappingDocuments)if(document.rep)usedReps.set(document.rep.id,document.rep);
 const mappingEmployeeIds=new Set(mappingDocuments.map(d=>normalize(d.preview.employeeId)));
 for(const priorMapping of prepared.saved.employees){const employeeId=normalize(priorMapping.employeeId);if(mappingEmployeeIds.has(employeeId)&&prepared.employeeMap.get(employeeId)!==priorMapping.repId){const priorMember=c.members.find(m=>m.id===priorMapping.repId);if(priorMember)usedReps.set(priorMember.id,priorMember);}}
 // Marking an employee mapped to a representative: that representative is checked at the commit as a remapping checks it.
 for(const mark of officeMarked){const priorMember=mark.priorRepId?c.members.find(m=>m.id===mark.priorRepId):undefined;if(priorMember)usedReps.set(priorMember.id,priorMember);}
 // The claim is the transaction gate: every subsequent write requires it.
 // A racing role/region/team/mapping change makes the complete batch a no-op.
 // The office marks the preview read (lib/erp-office-employees.ts): their row is its own token (the collection statement changes it without
 // moving the import state's revision).
 const officeGate=officeUnchanged(prepared.saved.office.raw);
 let gate=guard.sql+' AND EXISTS(SELECT 1 FROM crm_erp_import_state WHERE id=? AND revision=?) AND '+officeGate.sql;
 const args:(string|number|null)[]=[...guard.args,namespace,prepared.saved.revision,...officeGate.args];
 for(const member of usedReps.values()){gate+=" AND EXISTS(SELECT 1 FROM crm_members WHERE id=? AND role=? AND branch=? AND COALESCE(supervisor_id,'')=? AND region_scope=? AND active=? AND auth_version=? AND name=?)";args.push(...snapshot(member));}
 // A coverage that speaks for every representative holds only while the active representatives are those the preview read.
 if(coverage?.allReps){gate+=" AND (SELECT COUNT(*) FROM crm_members WHERE role='rep' AND active=1)=? AND NOT EXISTS(SELECT 1 FROM crm_members WHERE role='rep' AND active=1 AND id NOT IN (SELECT value FROM json_each(?)))";args.push(prepared.activeReps.length,JSON.stringify(prepared.activeReps));}
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
 for(const document of fresh){const p=document.preview,first=document.rows[0],member=document.rep!;const data={items:document.items,discount:0,notes:'',employeeId:first.employeeId,employeeName:first.employeeName,sourceLineCount:document.rows.length,...(document.quotationRefs?{quotationRefs:document.quotationRefs}:{})};batch.push(c.db.prepare('INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE '+claimed).bind('erp-sale-'+p.key,p.key,document.contentHash,document.mappedHash,p.reference,p.documentType,p.date,first.employeeId,member.id,member.branch,regionScope(member),first.customerCode,first.customerName,JSON.stringify(data),p.totalCents,id,c.me.id,now,...claimArgs));}
 // An identical saved document takes the references its description names now: only data.quotationRefs is written, only while the
 // document and its stored references are as the preview read them. Counted once in the import's audit line, never a change of its own.
 for(const document of backfills)batch.push(c.db.prepare("UPDATE crm_erp_sales SET data=json_set(data,'$.quotationRefs',json(?)) WHERE document_key=? AND content_hash=? AND mapped_hash=? AND COALESCE(json_extract(data,'$.quotationRefs'),'')=? AND "+claimed).bind(JSON.stringify(document.quotationRefs),document.preview.key,document.contentHash,document.mappedHash,document.backfill!.prior,...claimArgs));
 const usedEmployees=new Set(mappingDocuments.map(d=>normalize(d.preview.employeeId))),usedCategories=new Set(mappingDocuments.flatMap(d=>d.rows.map(r=>normalize(r.category))));
 for(const employeeId of usedEmployees){const repId=prepared.employeeMap.get(employeeId)!;batch.push(c.db.prepare('INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) SELECT ?,?,?,? WHERE '+claimed+' ON CONFLICT(employee_id) DO UPDATE SET rep_id=excluded.rep_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(employeeId,repId,c.me.id,now,...claimArgs));}
 if(officeMarked.length||officeUnmarked.length){
  // The representative mapping of a marked employee is removed (its number is the office's now); the new list is written whole.
  const markedKeys=new Set(officeMarked.map(m=>m.key));
  for(const mapping of prepared.saved.employees)if(markedKeys.has(officeIdKey(mapping.employeeId)))batch.push(c.db.prepare('DELETE FROM crm_erp_employee_mappings WHERE employee_id=? AND '+claimed).bind(mapping.employeeId,...claimArgs));
  const next=applyOfficeChanges(prepared.saved.office.list,{markIds:officeMarked,unmarkIds:officeUnmarked.map(u=>u.employeeId)},c.me.id,now);
  batch.push(writeOfficeList(c.db,next,claimed,claimArgs));
  const nameOf=(employeeId:string)=>prepared.employees.find(e=>normalize(e.employeeId)===normalize(employeeId))?.employeeName||'';
  batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(id+':office',ERP_OFFICE_SETTING,c.me.name,ERP_OFFICE_AUDIT_ACTION,JSON.stringify({source:'erp-sales-import',importId:id,fileName:input.fileName,marked:officeMarked.map(m=>({employeeId:m.employeeId,employeeName:m.employeeName,priorRepId:m.priorRepId})),unmarked:officeUnmarked.map(u=>({employeeId:u.employeeId,employeeName:nameOf(u.employeeId),repId:u.repId}))}),now,...claimArgs));
 }
 for(const category of usedCategories){const product=prepared.categoryMap.get(category)!;batch.push(c.db.prepare('INSERT INTO crm_erp_category_mappings(category,product,updated_by,updated_at) SELECT ?,?,?,? WHERE '+claimed+' ON CONFLICT(category) DO UPDATE SET product=excluded.product,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(category,product,c.me.id,now,...claimArgs));}
 batch.push(c.db.prepare('UPDATE crm_erp_import_state SET revision=revision+1 WHERE id=? AND '+claimed).bind(namespace,...claimArgs));
 batch.push(c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed).bind(id,id,c.me.name,'استيراد مبيعات ERP',JSON.stringify({fileName:input.fileName,...result}),now,...claimArgs));
 let committed;try{committed=await c.db.batch(batch);}catch(error){const saved=await replay();if(saved)return saved;throw error;}
 if(committed[0].meta.changes!==1){const saved=await replay();if(saved)return saved;throw new CRMError('تغيّرت الصلاحيات أو الربط أثناء الحفظ؛ اعرض الملف مرة أخرى',409);}
 return result;
}

/** The coverage entries of the complete ERP sales imports (lib/sales-coverage.ts), in the order they were saved; a malformed one is left
 *  out. Only ids of representatives and days: no sale, customer or amount. */
export async function readSalesCoverage(c:Context):Promise<SalesCoverageEntry[]>{
 const rows=(await c.db.prepare("SELECT json_extract(result,'$.coverage') AS coverage FROM crm_erp_imports WHERE id LIKE 'erp-import-%' AND json_extract(result,'$.coverage.complete')=1 ORDER BY created_at,id").all<{coverage:string}>()).results;
 return rows.flatMap(row=>{try{const parsed=salesCoverageEntrySchema.safeParse(JSON.parse(row.coverage));return parsed.success?[parsed.data]:[];}catch{return [];}});
}
/** Financial projections always require the same region and author-team boundary as CRM sales. */
export async function readErpSales(c:Context,month:string):Promise<Sale[]>{
 requireSalesWorkspace(c.me);const allowed=salesReadMemberIds(c.members,c.me,true);
 const scope=regionScopeSql('region_scope',c.me),rows=(await c.db.prepare('SELECT * FROM crm_erp_sales WHERE date>=? AND date<=? AND '+scope.sql+' ORDER BY date DESC,created_at DESC,id').bind(month+'-01',month+'-31',...scope.args).all<ErpSaleRow>()).results;
 return rows.filter(r=>allowed.has(r.rep_id)).map(r=>({...JSON.parse(r.data),id:r.id,customerId:'erp-customer:'+r.customer_code,customerName:r.customer_name,repId:r.rep_id,branch:r.branch,date:r.date,reference:r.reference,totalCents:r.total_cents,status:'confirmed',voidReason:'',version:1,createdBy:r.created_by,createdAt:r.created_at,updatedAt:r.created_at,source:'erp',documentType:r.document_type}));
}
/** Reps receive only their product quantities; no invoice, customer, price or colleague data. */
export async function readOwnErpSales(c:Context,month:string):Promise<{items:{product:string;quantity:number}[]}[]>{
 if(c.me.role!=='rep')throw new CRMError('هذا العرض خاص بالمندوب',403);
 const scope=regionScopeSql('region_scope',c.me),rows=(await c.db.prepare('SELECT data FROM crm_erp_sales WHERE rep_id=? AND date>=? AND date<=? AND '+scope.sql).bind(c.me.id,month+'-01',month+'-31',...scope.args).all<{data:string}>()).results;
 return rows.map(row=>({items:(JSON.parse(row.data).items as SaleItem[]).map(item=>({product:item.product,quantity:item.quantity}))}));
}

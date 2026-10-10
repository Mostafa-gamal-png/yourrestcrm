import {readRequestText} from '@/lib/request-body';
import {parseJsonBody} from '@/lib/crm-server';
import {regionScope} from '@/lib/regions';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {database,context,accessGuard,checkOrigin,CRMError,replyError} from '@/lib/crm-server';
import {schemas} from '@/lib/crm';
import {coordinatesFromText} from '@/lib/customer-location';
export const dynamic='force-dynamic';
// The one-time service path imports only the explicitly configured source hash.
// Without both environment values, only a signed-in CRM administrator can use it.
async function importAccess(req:Request,sourceHash:string){
 const config=env as unknown as Record<string,string|undefined>;
 const expected=config.CUSTOMER_IMPORT_TOKEN;
 const submitted=req.headers.get('x-customer-import-token')||'';
 if(expected&&config.CUSTOMER_IMPORT_SOURCE_HASH===sourceHash&&submitted.length===expected.length){
  let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^submitted.charCodeAt(i);
  if(mismatch===0){const db=database();const owner=await db.prepare("SELECT id,name,branch FROM crm_members WHERE id='owner' AND active=1 AND role='admin' AND region_scope='all'").first<{id:string;name:string;branch:string}>();if(!owner)throw new CRMError('يلزم تهيئة مدير النظام قبل الاستيراد',409);return{db,owner,permission:{sql:"EXISTS (SELECT 1 FROM crm_members WHERE id=? AND active=1 AND role='admin' AND region_scope='all')",args:[owner.id]}};}
 }
 const c=await context({load:'identity'});if(c.me.role!=='admin'||regionScope(c.me)!=='all')throw new CRMError('استيراد العملاء متاح لمدير النظام فقط',403);return{db:c.db,owner:c.me,permission:accessGuard(c)};
}
const batchSchema=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),sourceFile:z.string().max(250),rows:z.array(z.object({id:z.string().regex(/^yr-import-[a-f0-9]{32}$/),data:z.record(z.unknown())})).min(1).max(50)});
export async function POST(req:Request){try{
 checkOrigin(req);const text=await readRequestText(req,1200000);if(text.length>400000)throw new CRMError('دفعة الاستيراد كبيرة');
 const input=batchSchema.parse(parseJsonBody(text));const {db,owner,permission}=await importAccess(req,input.sourceHash);
 const now=new Date().toISOString(),mutation=crypto.randomUUID();const statements=[];
 for(const source of input.rows){
  const parsed=schemas.customer.safeParse({...source.data,assignedTo:owner.id,branch:owner.branch,sourceFile:input.sourceFile,sourceHash:input.sourceHash});
  if(!parsed.success)throw new CRMError(`الصف ${source.data.sourceRow}: ${parsed.error.issues.map(i=>i.message).join(' • ')}`);
  const data=parsed.data;const point=coordinatesFromText(data.location);if(!point)throw new CRMError(`إحداثيات الصف ${data.sourceRow} غير صالحة`);
  data.latitude=point.latitude;data.longitude=point.longitude;
  if(!data.sourceKey||source.id!=='yr-import-'+data.sourceKey.slice(0,32)||!/^[a-f0-9]{64}$/.test(data.sourceKey))throw new CRMError('بصمة السجل غير صحيحة');
  statements.push(db.prepare("INSERT OR IGNORE INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'customer',NULL,?,?,?,?,?,1,? WHERE "+permission.sql).bind(source.id,owner.id,owner.branch,JSON.stringify(data),now,now,mutation,...permission.args));
 }
 // The attempt marker selects only this batch's fresh rows. Audit failure must
 // roll back the import, and a replay with no fresh rows must not add an audit.
 statements.push(db.prepare("INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,MIN(id),?,?,CAST(COUNT(*) AS TEXT)||?,? FROM crm_records WHERE kind='customer' AND mutation_id=? HAVING COUNT(*)>0").bind(crypto.randomUUID(),owner.name,'استيراد',` مصنع من ${input.sourceFile}`,now,mutation));
 const results=await db.batch(statements);const inserted=results.slice(0,-1).reduce((s,r)=>s+Number(r.meta.changes||0),0);
 if(!inserted&&!await db.prepare('SELECT 1 AS allowed WHERE '+permission.sql).bind(...permission.args).first())throw new CRMError('تغيّرت صلاحياتك أثناء الاستيراد. سجّل الدخول مجددًا.',409);
 const counts=await db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN json_type(data,'$.latitude') IN ('real','integer') AND json_type(data,'$.longitude') IN ('real','integer') THEN 1 ELSE 0 END) AS mapped FROM crm_records WHERE kind='customer' AND json_extract(data,'$.sourceHash')=?").bind(input.sourceHash).first<{total:number;mapped:number}>();
 return Response.json({ok:true,inserted,skipped:input.rows.length-inserted,sourceTotal:counts?.total||0,mapped:counts?.mapped||0});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400});return replyError(e);}}

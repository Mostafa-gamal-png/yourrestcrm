import {readRequestText} from '@/lib/request-body';
import {parseJsonBody} from '@/lib/crm-server';
import {regionScope} from '@/lib/regions';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {database,context,accessGuard,checkOrigin,requireSession,CRMError,replyError} from '@/lib/crm-server';
import {schemas,type Row} from '@/lib/crm';
import {machineSourceData,hasMachineSource} from '@/lib/machines';
export const dynamic='force-dynamic';
async function access(req:Request,sourceHash:string){
 const settings=env as unknown as Record<string,string|undefined>;
 const expected=settings.MACHINE_IMPORT_TOKEN,token=req.headers.get('x-machine-import-token')||'';
 if(expected&&settings.MACHINE_IMPORT_SOURCE_HASH===sourceHash&&expected.length===token.length){
  let mismatch=0;for(let i=0;i<token.length;i++)mismatch|=token.charCodeAt(i)^expected.charCodeAt(i);
  if(!mismatch){const db=database();const owner=await db.prepare("SELECT id,name FROM crm_members WHERE id='owner' AND role='admin' AND active=1 AND region_scope='all'").first<{id:string;name:string}>();if(!owner)throw new CRMError('مدير النظام غير مهيأ',409);return{db,actor:owner.name,permission:{sql:"EXISTS (SELECT 1 FROM crm_members WHERE id=? AND active=1 AND role='admin' AND region_scope='all')",args:[owner.id]}};}
 }
 const c=await context({load:'identity'});if(c.me.role!=='admin'||regionScope(c.me)!=='all')throw new CRMError('الاستيراد متاح لمدير النظام فقط',403);return{db:c.db,actor:c.me.name,permission:accessGuard(c)};
}
export async function POST(req:Request){try{
 checkOrigin(req);if(!req.headers.get('x-machine-import-token'))await requireSession();const text=await readRequestText(req,3000);if(text.length>1000)throw new CRMError('الطلب كبير');
 const input=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),afterId:z.string().max(150).default('')}).strict().parse(parseJsonBody(text));
 const {db,actor,permission}=await access(req,input.sourceHash);
 // Read only the authorized stored source. No customer fields are accepted from the caller.
 const rows=(await db.prepare("SELECT id,kind,parent_id AS parentId,assigned_to AS assignedTo,branch,data,created_at AS createdAt,updated_at AS updatedAt,version FROM crm_records WHERE kind='customer' AND json_extract(data,'$.sourceHash')=? AND id>? AND (COALESCE(json_extract(data,'$.machineCount'),0)>0 OR LENGTH(TRIM(COALESCE(json_extract(data,'$.machineTypes'),'')))>0) ORDER BY id LIMIT 51").bind(input.sourceHash,input.afterId).all<Omit<Row,'data'>&{data:string}>()).results;
 const selected=rows.slice(0,50);const statements=[];const now=new Date().toISOString(),mutation=crypto.randomUUID();
 for(const raw of selected){const parent:Row={...raw,data:JSON.parse(raw.data)};if(!hasMachineSource(parent.data))continue;
  const id=parent.id+':source-machines-v1';const data=schemas.factory.parse(machineSourceData(parent));
  statements.push(db.prepare("INSERT OR IGNORE INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'factory',?,?,?,?,?,?,1,? WHERE EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND kind='customer') AND "+permission.sql).bind(id,parent.id,parent.assignedTo,parent.branch,JSON.stringify(data),now,now,mutation,parent.id,parent.version,...permission.args));
 }
 // Keep the audit and the source-machine rows in the same transaction.
 if(statements.length)statements.push(db.prepare("INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,MIN(parent_id),?,?,'ربط بيانات الماكينات بـ '||CAST(COUNT(*) AS TEXT)||' مصنع من شيت العملاء',? FROM crm_records WHERE kind='factory' AND mutation_id=? HAVING COUNT(*)>0").bind(crypto.randomUUID(),actor,'استيراد الماكينات',now,mutation));
 const result=statements.length?await db.batch(statements):[];const inserted=result.slice(0,-1).reduce((sum,r)=>sum+Number(r.meta.changes||0),0);
 if(!inserted&&!await db.prepare('SELECT 1 AS allowed WHERE '+permission.sql).bind(...permission.args).first())throw new CRMError('تغيّرت صلاحياتك أثناء الاستيراد. سجّل الدخول مجددًا.',409);
 const totals=await db.prepare("SELECT COUNT(*) AS groups,COUNT(DISTINCT parent_id) AS customers,SUM(COALESCE(json_extract(data,'$.quantity'),0)) AS recordedUnits FROM crm_records WHERE kind='factory' AND json_extract(data,'$.sourceHash')=? AND id=parent_id||':source-machines-v1'").bind(input.sourceHash).first<{groups:number;customers:number;recordedUnits:number}>();
 const expected=await db.prepare("SELECT COUNT(*) AS customers FROM crm_records WHERE kind='customer' AND json_extract(data,'$.sourceHash')=? AND (COALESCE(json_extract(data,'$.machineCount'),0)>0 OR LENGTH(TRIM(COALESCE(json_extract(data,'$.machineTypes'),'')))>0)").bind(input.sourceHash).first<{customers:number}>();
 return Response.json({ok:true,inserted,skipped:selected.length-inserted,nextAfterId:rows.length>50?selected[selected.length-1].id:null,totalGroups:totals?.groups||0,linkedCustomers:totals?.customers||0,recordedUnits:totals?.recordedUnits||0,expectedCustomers:expected?.customers||0});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400});return replyError(e);}}

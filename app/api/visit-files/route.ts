import {readRequestForm} from '@/lib/request-body';
import {canAccessVisitFile} from '@/lib/followups-server';
import {isServiceRole} from '@/lib/customer-service';
import {env} from 'cloudflare:workers';
import {context,accessGuard,checkOrigin,CRMError,replyError} from '@/lib/crm-server';
import {z} from 'zod';
export const dynamic='force-dynamic';
// Keep multipart parsing, hashing and durable object writes bounded together.
// This is per Node process; rejected offline uploads retain their retry key.
const maxConcurrentUploads=2;
let activeUploads=0;
export async function POST(req:Request){let objectKey='',admitted=false;try{
 checkOrigin(req);const c=await context();if(!env.FILES)throw new CRMError('رفع الملفات غير متاح مؤقتًا.',503);
 if(activeUploads>=maxConcurrentUploads){void req.body?.cancel().catch(()=>{});return Response.json({error:'رفع الملفات مشغول مؤقتًا. أعد المحاولة بعد لحظات.'},{status:429,headers:{'Retry-After':'2','Cache-Control':'private, no-store'}});}
 activeUploads++;admitted=true;
 const form=await readRequestForm(req),file=form.get('file'),customerId=String(form.get('customerId')||'');
 const uploadKey=form.has('uploadKey')?z.string().uuid().parse(form.get('uploadKey')):null;
 if(uploadKey&&form.get('memberId')!==c.me.id)throw new CRMError('الملف المحفوظ يخص حسابًا آخر. ادخل بالحساب الذي سجّله.',403);
 const customer=c.visible.find(r=>r.id===customerId&&r.kind==='customer')||(isServiceRole(c.me.role)?c.regionalRecords.find(r=>r.id===customerId&&r.kind==='customer'&&r.branch===c.me.branch):undefined);
 if(!customer)throw new CRMError('العميل غير متاح',403);
 if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new CRMError('اختر PDF أو صورة بحجم حتى 10 ميجابايت');
 const bytes=new Uint8Array(await file.arrayBuffer());let mime='';
 if(bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70&&bytes[4]===45)mime='application/pdf';
 else if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)mime='image/png';
 else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
 else if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')mime='image/webp';
 if(!mime)throw new CRMError('الصيغ المتاحة: PDF، JPG، PNG، WEBP');
 const hash=async(value:Uint8Array|string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const name=file.name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,200)||'عرض المنافس';
 const fingerprint=uploadKey?await hash(JSON.stringify([customerId,name,mime,file.size,await hash(bytes)])):'';
 const id=uploadKey?'queued-file-'+await hash(c.me.id+':'+uploadKey):crypto.randomUUID();
 const replay=async()=>{if(!uploadKey)return null;const existing=await c.db.prepare('SELECT id,object_key,customer_id,name,size,uploaded_by FROM crm_visit_files WHERE id=?').bind(id).first<{id:string;object_key:string;customer_id:string;name:string;size:number;uploaded_by:string}>();if(!existing)return null;const fresh=await context();if(existing.uploaded_by!==fresh.me.id||existing.customer_id!==customerId||!canAccessVisitFile(fresh,existing))throw new CRMError('الملف غير متاح',403);if(!existing.object_key.endsWith('-'+fingerprint))throw new CRMError('تم رفع هذا الملف ببيانات مختلفة. أعد اختيار المرفق.',409);return Response.json({id:existing.id,name:existing.name,size:existing.size,alreadySaved:true});};
 const prior=await replay();if(prior)return prior;
 // Every attempt owns a separate object. A losing concurrent retry can clean up
 // only its own object, never the winner's committed attachment.
 objectKey='competitor/'+crypto.randomUUID()+(uploadKey?'-'+fingerprint:'');
 await env.FILES.put(objectKey,bytes,{httpMetadata:{contentType:mime}});
 const permission=accessGuard(c,customer);
 const saved=await c.db.prepare('INSERT OR IGNORE INTO crm_visit_files (id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) SELECT ?,?,?,?,?,?,?,? WHERE '+permission.sql).bind(id,objectKey,customerId,name,mime,file.size,c.me.id,new Date().toISOString(),...permission.args).run();if(saved.meta.changes!==1){const duplicate=await replay();if(duplicate){await env.FILES.delete(objectKey).catch(()=>{});objectKey='';return duplicate;}throw new CRMError('تغيّرت صلاحياتك أو بيانات العميل. أعد المحاولة.',409);}
 objectKey='';
 return Response.json({id,name,size:file.size});
 }catch(e){if(objectKey&&env.FILES)await env.FILES.delete(objectKey).catch(()=>{});if(e instanceof z.ZodError)return Response.json({error:'بيانات رفع الملف غير صحيحة.'},{status:400});return replyError(e);}finally{if(admitted)activeUploads--;}}
export async function GET(req:Request){try{const c=await context();const id=new URL(req.url).searchParams.get('id');if(!id)throw new CRMError('حدد الملف');const file=await c.db.prepare('SELECT * FROM crm_visit_files WHERE id=?').bind(id).first<{id:string;object_key:string;customer_id:string;name:string;content_type:string;size:number;uploaded_by:string;created_at:string}>();if(!file||!canAccessVisitFile(c,file))throw new CRMError('الملف غير متاح',404);if(!env.FILES)throw new CRMError('الملفات غير متاحة مؤقتًا',503);const object=await env.FILES.get(file.object_key);if(!object)throw new CRMError('الملف غير موجود',404);return new Response(object.body,{headers:{'Content-Type':file.content_type,'Content-Length':String(file.size),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(e){return replyError(e);}}

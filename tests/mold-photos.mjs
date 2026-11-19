// «صور القالب» (lib/mold-photos.ts, lib/mold-photos-server.ts, app/api/mold-photos/**, lib/image-shrink.ts) without a build: the real
// handlers over every drizzle migration in an in-memory SQLite and an object store in memory. The bytes decide the type (JPEG, PNG, WEBP;
// a PDF, markup or an empty file refused), 2 MB at most, 20 a customer (the 21st refused, also when two arrive together); who sees (the
// customer's readers, customer service its branch's) and who adds (as for the customer's machines: a representative and a marketing
// officer their own customers, a marketing officer of their branch only, a supervisor and a sales manager their team's, the administrator
// all; never customer service; «تعديل» of «العملاء» switched off refuses) and who deletes (whoever added it and the administrator); a
// retry with the same key stores one photo, a late retry after a delete stores none, the same key with other bytes is refused; the
// history lines and their counts; a write raced by an edit of the customer is refused and leaves no object; the bytes go with a delete;
// a mold photo is never a competitor's offer (/api/visit-files). The shrinking arithmetic of lib/image-shrink.ts. Synthetic data only.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'mold-photos-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),'export async function getApplicationUser(){return globalThis.testUser;}');
fs.writeFileSync(path.join(out,'mold-hook.mjs'),'export function nudgeMoldCustomers(){}export function wakeMoldRetries(){}');
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(imp==='@/lib/mold-customers-hook')return 'from '+JSON.stringify(path.join(out,'mold-hook.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
for(const file of ['app/api/mold-photos/route.ts','app/api/mold-photos/delete/route.ts','app/api/crm/route.ts','app/api/visit-files/route.ts','lib/mold-photos.ts','lib/image-shrink.ts','lib/request-body.ts','lib/visit-file-access.ts'])compile(file);
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 async run(){return{meta:{changes:Number(sql.prepare(this.query).run(...this.args).changes)}};}
 async all(){return{results:sql.prepare(this.query).all(...this.args)};}
 async first(column){const row=sql.prepare(this.query).get(...this.args);return row?(column===undefined?row:row[column]??null):null;}
}
// beforeBatch: a write by someone else between a request's reads and its commit (the commit race); beforePut: during the object write.
const DB={prepare:query=>new Statement(query),batch:async statements=>{const race=globalThis.beforeBatch;globalThis.beforeBatch=null;race?.();sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const objects=new Map();
const FILES={async put(key,value){const race=globalThis.beforePut;globalThis.beforePut=null;await race?.();objects.set(key,new Uint8Array(value));return{key};},async get(key){const bytes=objects.get(key);return bytes?{body:bytes,size:bytes.length}:null;},async delete(key){for(const k of Array.isArray(key)?key:[key])objects.delete(k);}};
const ORIGIN='https://test.invalid';
globalThis.testEnv={DB,FILES,YR_APP_ORIGIN:ORIGIN};
const now=new Date().toISOString();
const member=(id,name,role,{region='all',supervisor=null,branch='HQ'}={})=>sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,1,0,?)').run(id,id+'@yourrest.org',name,role,branch,supervisor,region,now);
member('owner','مدير النظام','admin');member('mgr','مدير المبيعات','manager');member('sup','المشرف','supervisor',{supervisor:'mgr'});member('sup2','المشرف الثاني','supervisor',{supervisor:'mgr'});
member('rep1','المندوب الأول','rep',{region:'eastern',supervisor:'sup'});member('rep2','المندوب الثاني','rep',{region:'eastern',supervisor:'sup2'});member('repw','مندوب الغربية','rep',{region:'western',supervisor:'sup2'});
member('mkt','مسؤول التسويق','marketing',{region:'eastern',supervisor:'sup'});member('csm','مدير خدمة العملاء','customer_service_manager',{supervisor:'mgr'});member('cs','ممثل خدمة العملاء','customer_service',{supervisor:'csm'});
member('cso','خدمة عملاء فرع آخر','customer_service',{supervisor:'csm',branch:'جدة'});
const customer=(id,name,assignedTo,{region='الشرقية',branch='HQ'}={})=>sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,?,?,?,?,1)").run(id,assignedTo,branch,JSON.stringify({name,region,city:'الدمام',branch,assignedTo}),now,now);
customer('c1','مصنع المندوب الأول','rep1');customer('c2','مصنع المندوب الثاني','rep2');customer('cw','مصنع الغربية','repw',{region:'الغربية'});
customer('cm','مصنع مسؤول التسويق','mkt');customer('cmj','مصنع التسويق في جدة','mkt',{branch:'جدة'});customer('co','مصنع المدير','owner');
const login=id=>{const m=sql.prepare('SELECT * FROM crm_members WHERE id=?').get(id);globalThis.testUser={provider:'email-otp',memberId:id,memberVersion:m.auth_version,userId:'test-'+id,email:m.email,fullName:m.name};};
const photos=await import(path.join(out,'app/api/mold-photos/route.mjs')),photoDelete=await import(path.join(out,'app/api/mold-photos/delete/route.mjs'));
const crm=await import(path.join(out,'app/api/crm/route.mjs')),visitFiles=await import(path.join(out,'app/api/visit-files/route.mjs'));
const rules=await import(path.join(out,'lib/mold-photos.mjs')),shrink=await import(path.join(out,'lib/image-shrink.mjs'));
const {jsonRequestLimit,formRequestLimit}=await import(path.join(out,'lib/request-body.mjs'));
const {loadAuthorizedVisitAttachment}=await import(path.join(out,'lib/visit-file-access.mjs'));
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

// ---- the bytes decide the type
const JPEG=n=>{const bytes=new Uint8Array(Math.max(n,4));bytes.set([0xff,0xd8,0xff,0xe0]);for(let i=4;i<bytes.length;i++)bytes[i]=(i*31)%251;return bytes;};
const PNG=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13]),WEBP=new TextEncoder().encode('RIFF\u0004\u0000\u0000\u0000WEBPVP8 ');
check([rules.moldPhotoMime(JPEG(20)),rules.moldPhotoMime(PNG),rules.moldPhotoMime(WEBP)],['image/jpeg','image/png','image/webp'],'JPEG, PNG and WEBP by their bytes');
check([new TextEncoder().encode('%PDF-1.4'),new TextEncoder().encode('<svg onload=x>'),new TextEncoder().encode('GIF89a......'),new TextEncoder().encode('RIFF....WAVE'),Uint8Array.from([0xff,0xd8]),new Uint8Array(0),Uint8Array.from([0x89,0x50,0x4e,0x47])].map(rules.moldPhotoMime),[null,null,null,null,null,null,null],'a PDF, markup, a GIF, another RIFF, a cut header and nothing are refused');
check([rules.isMoldPhotoId('mold-photo-'+'a'.repeat(64)),rules.isMoldPhotoId('queued-file-abc'),rules.MOLD_PHOTO_ID.test('mold-photo-'+'A'.repeat(64)),rules.MOLD_PHOTO_ID.test('mold-photo-'+'a'.repeat(63))],[true,false,false,false],'the id prefix and its exact form');
check([rules.MOLD_PHOTO_MAX_COUNT,rules.MOLD_PHOTO_MAX_BYTES,formRequestLimit(new Request(ORIGIN+'/api/mold-photos?customerId=x')),jsonRequestLimit(new Request(ORIGIN+'/api/mold-photos/delete'))],[20,2*1024*1024,2*1024*1024+64*1024,2000],'20 a customer, 2 MB a photo; the upload body and the delete body are bounded');

// ---- shrinking, without a browser
check([shrink.shrinkSize(4000,3000),shrink.shrinkSize(3000,4000),shrink.shrinkSize(1200,900),shrink.shrinkSize(1600,1600),shrink.shrinkSize(10000,10)],[{width:1600,height:1200},{width:1200,height:1600},{width:1200,height:900},{width:1600,height:1600},{width:1600,height:2}],'the longest side to 1600, never enlarged, proportions kept, at least a pixel');
const steps=shrink.shrinkSteps(4032,3024);
check([steps[0],steps[1],steps[2]],[{width:1600,height:1200,quality:0.8},{width:1600,height:1200,quality:0.7},{width:1600,height:1200,quality:0.6}],'first 0.8 at 1600, then 0.7 and 0.6');
ok(steps.every(step=>Math.max(step.width,step.height)<=1600&&Math.max(step.width,step.height)>=800)&&steps.length%3===0&&steps.length<=12,'then smaller, never under 800 pixels, a bounded number of tries: '+steps.length);
check(shrink.shrinkSteps(640,480),[{width:640,height:480,quality:0.8},{width:640,height:480,quality:0.7},{width:640,height:480,quality:0.6}],'a small photo is tried at its own size');
check([shrink.SHRINK_LONG_SIDE,shrink.SHRINK_QUALITY,shrink.SHRINK_TARGET_BYTES],[1600,0.8,400*1024],'the aim: 1600 pixels, quality 0.8, 400 KB');
assert.throws(()=>shrink.shrinkSize(0,10));checks++;

// ---- who adds (the rule alone)
const people=Object.fromEntries(sql.prepare('SELECT id,role,branch,supervisor_id AS supervisorId,region_scope AS regionScope,active FROM crm_members').all().map(m=>[m.id,{...m,email:m.id+'@yourrest.org',name:m.id,target:0}]));
const members=Object.values(people);
const row=id=>{const r=sql.prepare('SELECT id,kind,assigned_to AS assignedTo,branch FROM crm_records WHERE id=?').get(id);return r;};
const addRule=(who,customerId,access)=>!rules.moldPhotoAddRefusal(row(customerId),members,{...people[who],...(access?{access}:{})});
check(['owner','mgr','sup','sup2','rep1','rep2','mkt','csm','cs'].map(who=>addRule(who,'c1')),[true,true,true,false,true,false,false,false,false],'on rep1\'s customer: the administrator, the sales manager, rep1\'s supervisor and rep1; not another supervisor, rep or marketing officer, never customer service');
check([addRule('mkt','cm'),addRule('mkt','cmj'),addRule('rep1','cm'),addRule('sup','cm'),addRule('sup2','cm')],[true,false,false,true,false],'a marketing officer: their own customers of their branch (as their machines)');
check([addRule('rep1','c1',{version:2,off:['customer:edit'],hidden:[],viewAll:false}),addRule('owner','c1',{version:2,off:['customer:edit'],hidden:[],viewAll:false})],[false,false],'«تعديل» of «العملاء» switched off refuses, the administrator too');
check([addRule('sup','c1',{version:2,off:[],hidden:[],viewAll:true}),addRule('sup','c2',{version:2,off:[],hidden:[],viewAll:true})],[true,false],'«عرض بيانات الفريق بالكامل» never widens adding');
check([rules.moldPhotoDeleteRefusal({uploadedBy:'rep1'},people.rep1),rules.moldPhotoDeleteRefusal({uploadedBy:'rep1'},people.owner),!!rules.moldPhotoDeleteRefusal({uploadedBy:'rep1'},people.sup),!!rules.moldPhotoDeleteRefusal({uploadedBy:'rep1'},people.mgr),!!rules.moldPhotoDeleteRefusal({uploadedBy:'rep1'},{...people.rep1,access:{version:2,off:['customer:edit'],hidden:[],viewAll:false}})],['','',true,true,true],'deleting: whoever added it and the administrator, while «تعديل» is on');

// ---- over the routes
const request=(url,init={})=>new Request(ORIGIN+url,{...init,headers:{origin:ORIGIN,...(init.headers||{})}});
const call=async(handler,req,status,message)=>{const response=await handler(req);const text=await response.text();if(status!==undefined&&status!==null)check(response.status,status,(message||req.url)+': '+text.slice(0,300));let json=null;try{json=JSON.parse(text);}catch{}return {status:response.status,json,headers:response.headers,text};};
const list=(who,customerId,status=200)=>{login(who);return call(photos.GET,request('/api/mold-photos?customerId='+encodeURIComponent(customerId)),status,'list as '+who);};
const upload=(who,customerId,bytes,{key=crypto.randomUUID(),status,name='IMG_0001.jpg'}={})=>{login(who);const form=new FormData();if(bytes)form.set('file',new File([bytes],name,{type:'image/jpeg'}));return call(photos.POST,request('/api/mold-photos?customerId='+encodeURIComponent(customerId)+'&key='+key,{method:'POST',body:form}),status,'upload as '+who);};
const remove=(who,id,status)=>{login(who);return call(photoDelete.POST,request('/api/mold-photos/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})}),status,'delete as '+who);};
const file=(who,id,status)=>{if(who)login(who);else globalThis.testUser=null;return call(photos.GET,request('/api/mold-photos?id='+encodeURIComponent(id)),status,'file as '+who);};
const rows=customerId=>sql.prepare("SELECT * FROM crm_visit_files WHERE customer_id=? AND substr(id,1,11)='mold-photo-' ORDER BY created_at,id").all(customerId);
const audits=customerId=>sql.prepare("SELECT id,actor,action,detail FROM crm_audit WHERE record_id=? AND id LIKE 'mold-photo-%' ORDER BY created_at,rowid").all(customerId);

// anonymous and from another site
globalThis.testUser=null;
check((await call(photos.GET,request('/api/mold-photos?customerId=c1'))).status,401,'anonymous list');
check((await call(photos.POST,request('/api/mold-photos?customerId=c1&key='+crypto.randomUUID(),{method:'POST',body:new FormData()}))).status,401,'anonymous upload');
check((await call(photoDelete.POST,request('/api/mold-photos/delete',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))).status,401,'anonymous delete');
login('rep1');check((await call(photos.POST,new Request(ORIGIN+'/api/mold-photos?customerId=c1&key='+crypto.randomUUID(),{method:'POST',headers:{origin:'https://evil.example'},body:new FormData()}))).status,403,'another site');

// who sees the list (empty for now) and who may add
const empty=await list('rep1','c1');
check([empty.json.ok,empty.json.customerId,empty.json.photos,empty.json.max,empty.json.canAdd],[true,'c1',[],20,true],'rep1 sees an empty list and may add');
check(empty.headers.get('cache-control'),'private, no-store','the list is never kept');
const seesAndAdds={};
for(const who of ['owner','mgr','sup','sup2','rep1','rep2','repw','mkt','csm','cs','cso']){const answer=await list(who,'c1',null);seesAndAdds[who]=answer.status===200?answer.json.canAdd?'add':'see':answer.status;}
check(seesAndAdds,{owner:'add',mgr:'add',sup:'add',sup2:'see',rep1:'add',rep2:'see',repw:404,mkt:'see',csm:'see',cs:'see',cso:404},'every role on rep1\'s customer: who sees, who adds (customer service of its branch reads it); another region and another branch\'s customer service see nothing');
check([(await list('rep1','cw',404)).json.error,(await list('rep1','missing',404)).json.error,(await list('rep1','',404)).status],['العميل غير متاح','العميل غير متاح',404],'a customer out of reach or unknown: 404');

// adding
const first=await upload('rep1','c1',JPEG(5000),{status:200});
const firstId=first.json.photo.id;
ok(rules.MOLD_PHOTO_ID.test(firstId),'the id: '+firstId);
check([first.json.count,first.json.photo.contentType,first.json.photo.size,first.json.photo.mine,first.json.photo.canDelete,first.json.photo.uploadedBy],[1,'image/jpeg',5000,true,true,'المندوب الأول'],'saved with its type from the bytes, its size and its uploader');
const stored=rows('c1')[0];
check([stored.uploaded_by,stored.content_type,stored.size,stored.name.startsWith('mold-photo-')&&stored.name.endsWith('.jpg'),stored.object_key.startsWith('mold-photo/'),stored.name.includes('IMG_0001')],['rep1','image/jpeg',5000,true,true,false],'the row keeps its own name and key, never the browser\'s name');
check([...objects.get(stored.object_key)].slice(0,4),[0xff,0xd8,0xff,0xe0],'the bytes are in the store under the row\'s key');
check(audits('c1').map(a=>[a.id,a.actor,a.action,a.detail]),[['mold-photo-add:'+firstId,'المندوب الأول','إضافة صورة للقالب','عدد صور القالب: 1']],'one history line on the customer, with the count');
for(const [who,bytes] of [['sup',PNG],['mgr',WEBP],['owner',JPEG(100)]])check((await upload(who,'c1',bytes)).status,200,who+' adds to rep1\'s customer');
check(rows('c1').map(r=>[r.uploaded_by,r.content_type]),[['rep1','image/jpeg'],['sup','image/png'],['mgr','image/webp'],['owner','image/jpeg']],'four photos, oldest first');
for(const who of ['sup2','rep2','mkt','cs'])check((await upload(who,'c1',JPEG(10),{status:403})).json.error,who==='cs'?'إضافة صور القالب متاحة لمن يسجّل ماكينات هذا العميل.':'إضافة صور القالب متاحة لمن يسجّل ماكينات هذا العميل.',who+' may not add');
check((await upload('repw','c1',JPEG(10),{status:404})).json.error,'العميل غير متاح','another region: not even seen');
check([(await upload('mkt','cm',JPEG(10))).status,(await upload('mkt','cmj',JPEG(10))).status],[200,403],'a marketing officer: their own customer of their branch, not the one of another branch');
check(rows('c1').length,4,'refused uploads stored nothing');

// the bytes and the size
const before=objects.size;
check((await upload('rep1','c1',new TextEncoder().encode('%PDF-1.4 x'),{status:415})).json.error,'الصور المقبولة: JPG، PNG، WEBP.','a PDF named .jpg is refused');
check((await upload('rep1','c1',new TextEncoder().encode('<script>alert(1)</script>'),{status:415})).status,415,'markup is refused');
check((await upload('rep1','c1',new Uint8Array(0),{status:400})).json.error,'اختر صورة للقالب.','an empty file is refused');
check((await upload('rep1','c1',null,{status:400})).json.error,'اختر صورة للقالب.','no file is refused');
check((await upload('rep1','c1',JPEG(2*1024*1024+1),{status:413})).json.error,'حجم الصورة أكبر من 2 ميجابايت بعد تصغيرها. اختر صورة أصغر.','over 2 MB is refused');
check((await upload('rep1','c1',JPEG(2*1024*1024))).status,200,'exactly 2 MB is taken');
login('rep1');check((await call(photos.POST,request('/api/mold-photos?customerId=c1&key=not-a-uuid',{method:'POST',body:new FormData()}))).json.error,'بيانات رفع الصورة غير صحيحة.','a key that is not a UUID');
check(objects.size,before+1,'only the accepted photo left an object');

// a retry with the same key
const key=crypto.randomUUID(),bytes=JPEG(3000);
const once=await upload('rep1','c1',bytes,{key,status:200}),twice=await upload('rep1','c1',bytes,{key,status:200});
check([twice.json.alreadySaved,twice.json.photo.id,rows('c1').length],[true,once.json.photo.id,6],'the same key again: the saved photo, stored once');
check((await upload('rep1','c1',JPEG(3001),{key,status:409})).json.error,'رُفعت هذه الصورة من قبل ببيانات مختلفة. اختر الصورة مرة أخرى.','the same key with other bytes is refused');
check((await upload('sup','c1',bytes,{key,status:200})).json.alreadySaved,undefined,'another member\'s key never meets it (a new photo)');
check(audits('c1').filter(a=>a.action==='إضافة صورة للقالب').length,7,'one history line a photo');

// the limit: 20 a customer, the 21st refused, two arriving together
while(rows('c1').length<19)await upload('owner','c1',JPEG(50),{status:200});
let raced=false;
globalThis.beforePut=async()=>{raced=true;await upload('owner','c1',JPEG(60),{status:200});};
const late=await upload('mgr','c1',JPEG(70),{status:409});
check([raced,late.json.error,rows('c1').length],[true,'الحد 20 صورة للقالب لكل عميل. احذف صورة أولًا.',20],'two at once for the twentieth place: one is saved, the other refused at the commit');
check((await upload('rep1','c1',JPEG(80),{status:409})).json.error,'الحد 20 صورة للقالب لكل عميل. احذف صورة أولًا.','the 21st is refused');
const fullList=await list('rep1','c1');
check([fullList.json.photos.length,fullList.json.canAdd],[20,true],'the list says 20 (the page shows the limit)');
check(new Set(sql.prepare("SELECT object_key FROM crm_visit_files WHERE substr(id,1,11)='mold-photo-'").all().map(r=>r.object_key)).size,objects.size,'every object belongs to a row: refused and raced writes removed theirs');

// a write raced by an edit of the customer
await remove('owner',rows('c1').at(-1).id,200);
globalThis.beforeBatch=()=>sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='c1'").run();
const objectsBefore=objects.size;
check((await upload('rep1','c1',JPEG(90),{status:409})).json.error,'تغيّرت صلاحياتك أو بيانات العميل. أعد المحاولة.','the customer changed between the reads and the commit');
check([rows('c1').length,objects.size],[19,objectsBefore],'nothing stored, its object removed');

// the file
const shown=await file('cs',firstId,200);
check([shown.headers.get('content-type'),shown.headers.get('x-content-type-options'),shown.headers.get('content-length'),shown.headers.get('cache-control'),/^inline;/.test(shown.headers.get('content-disposition'))],['image/jpeg','nosniff','5000','private, max-age=86400',true],'shown in the page, its type from the bytes, never sniffed, kept a day by the reader\'s browser only');
for(const who of ['owner','mgr','sup','sup2','rep1','rep2','mkt'])check((await file(who,firstId)).status,200,who+' sees the photo');
for(const who of ['repw','cso'])check((await file(who,firstId)).status,404,who+' does not');
check((await file('csm',firstId)).status,200,'customer service\'s manager of its branch sees it');
check([(await file(null,firstId)).status,(await file('rep1','mold-photo-'+'0'.repeat(64))).status,(await file('rep1','../etc')).status],[401,404,404],'anonymous 401; unknown and malformed 404');

// a mold photo is never a competitor's offer
check((await (async()=>{login('rep1');return call(visitFiles.GET,request('/api/visit-files?id='+firstId));})()).status,404,'/api/visit-files refuses a mold photo');
login('rep1');
const {context}=await import(path.join(out,'lib/crm-server.mjs'));
await assert.rejects(async()=>loadAuthorizedVisitAttachment(await context(),'c1',firstId),/ملف المنافس لا يتبع هذا العميل/);checks++;

// deleting
const victim=rows('c1').find(r=>r.uploaded_by==='sup');
check((await remove('rep1',victim.id,403)).json.error,'حذف الصورة متاح لمن أضافها ولمدير النظام.','rep1 may not delete the supervisor\'s photo');
check((await remove('mgr',victim.id,403)).status,403,'nor the sales manager');
check((await remove('repw',victim.id,404)).status,404,'another region: not seen');
const gone=await remove('sup',victim.id,200);
check([gone.json.count,!!rows('c1').find(r=>r.id===victim.id),objects.has(victim.object_key)],[18,false,false],'the supervisor deletes their own: the row and its bytes go');
check(audits('c1').filter(a=>a.id==='mold-photo-delete:'+victim.id).map(a=>[a.actor,a.action,a.detail]),[['المشرف','حذف صورة من صور القالب','عدد صور القالب: 18']],'the history line of the delete, with the count after it');
check((await remove('sup',victim.id,200)).json.alreadyDeleted,true,'a repeated delete answers alreadyDeleted');
const ownersTarget=rows('c1').find(r=>r.uploaded_by==='rep1');
check((await remove('owner',ownersTarget.id,200)).json.ok,true,'the administrator deletes anyone\'s');
check((await remove('rep1','mold-photo-'+'f'.repeat(64),404)).json.error,'الصورة غير متاحة','an unknown photo');
check((await remove('rep1','x',400)).json.error,'بيانات رفع الصورة غير صحيحة.','a malformed id');
// a late retry of an upload whose photo was deleted since stores nothing
const deletedKey=crypto.randomUUID(),deletedBytes=JPEG(4444);
const brief=await upload('rep1','c1',deletedBytes,{key:deletedKey,status:200});
await remove('rep1',brief.json.photo.id,200);
const lateRetry=await upload('rep1','c1',deletedBytes,{key:deletedKey,status:200});
check([lateRetry.json.alreadySaved,lateRetry.json.deleted,lateRetry.json.photo,rows('c1').some(r=>r.id===brief.json.photo.id)],[true,true,null,false],'a late retry after the delete: answered, not stored again');

// «تعديل» of «العملاء» switched off for rep1: neither adding nor deleting
const own=rows('c1').find(r=>r.uploaded_by==='rep1');
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('rep1',?,'[]',2,'owner',?)").run(JSON.stringify({'customer:edit':false}),now);
check([(await upload('rep1','c1',JPEG(10),{status:403})).json.error,(await remove('rep1',own.id,403)).status,(await list('rep1','c1')).json.canAdd,(await list('rep1','c1')).json.photos.every(p=>!p.canDelete)],['غير مسموح لك بالتعديل في العملاء. راجع مدير النظام.',403,false,true],'the cell off: no add, no delete, the page offers neither');
sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='rep1'").run();

// the names on the photos: as GET /api/crm lists members
const named=Object.fromEntries((await list('rep2','c1')).json.photos.map(p=>[p.id,p.uploadedBy]));
ok(Object.values(named).every(name=>name===''),'a representative reads no other member\'s name');
const managerNames=new Set((await list('mgr','c1')).json.photos.map(p=>p.uploadedBy));
ok(managerNames.has('المندوب الأول')&&managerNames.has('مدير المبيعات'),'the sales manager reads their team\'s names');

// «سجل التغييرات»: the lines reach the customer's history as any customer change (not for a representative, as before)
login('mgr');
const history=(await (await crm.GET()).json()).audits.filter(a=>a.recordId==='c1').map(a=>a.action);
ok(history.includes('إضافة صورة للقالب')&&history.includes('حذف صورة من صور القالب'),'the sales manager sees both kinds of lines in the customer\'s history');

// customer service sees, never adds; another customer's photos never leak into a list
check([(await list('cs','c1')).json.canAdd,(await list('cs','c1')).json.photos.length===rows('c1').length,(await list('owner','c2')).json.photos.length],[false,true,0],'customer service reads the list; another customer has none');

console.log(JSON.stringify({ok:true,checks,builtRelease:false,syntheticFixtures:true,productionDataUsed:false}));

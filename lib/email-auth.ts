/** Runtime-neutral email OTP. No email provider, network or platform identity trust here. */
import {readRequestBytes} from './request-body';
export type EmailIdentity = {provider:'email-otp';memberId:string;memberVersion:number;userId:string;email:string;displayName:string;fullName:string};
export type EmailAuthConfig = {
 origin:string; secret:string;
 send:(message:{to:string;code:string;expiresInMinutes:number;signal:AbortSignal})=>Promise<void>;
 clientKey?:(request:Request)=>string|null;
 deliveryReady?:boolean;
 deliveryDeadlineMs?:number;
 now?:()=>number;
};
export const authCookie='__Host-yourrest_session';
const challengeCookie='__Host-yourrest_challenge';
const minute=60_000, hour=60*minute;
// Browser cookies have a finite retention window; the authenticated app renews
// this cookie. A zero database expiry means the verified device stays signed in
// until logout or a member access change revokes it.
const deviceCookieSeconds=400*24*60*60;
const invalidCode='رمز الدخول غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.';
const noStore={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{...noStore,...headers}});
function milliseconds(c:EmailAuthConfig){return c.now?.()??Date.now();}
function validConfig(c:EmailAuthConfig){
 let origin:URL;try{origin=new URL(c.origin);}catch{return false;}
 return origin.protocol==='https:'&&origin.origin===c.origin&&/^[a-f0-9]{64,}$/i.test(c.secret);
}
export function sameOriginMutation(request:Request,origin:string){
 return request.headers.get('origin')===origin&&!['cross-site','none'].includes(request.headers.get('sec-fetch-site')||'');
}
/** Return targets are deliberately ignored: everyone lands on '/', which closes every open-redirect path. */
export function safeAuthReturn(){return '/';}
function cookie(name:string,value:string,seconds:number){return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;}
function readCookie(headers:Headers,name:string){
 const values=(headers.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
 if(values.length!==1)return null;
 const value=values[0].slice(name.length+1);return /^[a-f0-9]{64}$/.test(value)?value:null;
}
function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}
function randomCode(){
 const values=new Uint32Array(1);let value:number;
 // Rejection sampling avoids modulo bias.
 do{crypto.getRandomValues(values);value=values[0];}while(value>=4_294_000_000);
 return String(value%1_000_000).padStart(6,'0');
}
async function digest(c:EmailAuthConfig,value:string){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(c.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
function event(db:D1Database,userId:string|null,name:string,stamp:number){return db.prepare('INSERT INTO auth_events (id,user_id,event,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),userId,name,stamp);}
async function permit(db:D1Database,key:string,stamp:number,window:number,max:number){
 const start=Math.floor(stamp/window)*window;
 const result=await db.prepare('INSERT INTO auth_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN auth_limits.window_start=excluded.window_start THEN auth_limits.count+1 ELSE 1 END WHERE auth_limits.window_start<>excluded.window_start OR auth_limits.count<? RETURNING count').bind(key,start,max).first();
 return !!result;
}
async function body(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))return null;
 // Anonymous bodies need both a byte limit and a deadline before rate limiting.
 // The shared reader never waits for a sender's cancellation acknowledgement.
 try{const bytes=await readRequestBytes(request,2048,10_000);
 const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;
 }catch{return null;}
}
export async function emailSession(headers:Headers,db:D1Database,c:EmailAuthConfig):Promise<EmailIdentity|null>{
 if(!validConfig(c))return null;
 const token=readCookie(headers,authCookie);if(!token)return null;
 const hash=await digest(c,'session:'+token);
 const user=await db.prepare('SELECT u.id,u.user_id,u.email,u.name,u.auth_version FROM auth_sessions s JOIN crm_members u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND (s.expires_at=0 OR s.expires_at>?) AND u.active=1 AND u.auth_version=s.user_version AND u.email=s.email').bind(hash,milliseconds(c)).first<{id:string;user_id:string|null;email:string;name:string;auth_version:number}>();
 return user?{provider:'email-otp',memberId:user.id,memberVersion:user.auth_version,userId:user.user_id||'email-otp:'+user.id,email:user.email,displayName:user.name,fullName:user.name}:null;
}
export async function handleEmailAuth(request:Request,action:string,db:D1Database,c:EmailAuthConfig):Promise<Response>{
 if(!validConfig(c))return json({error:'خدمة الدخول غير مهيأة. تواصل مع الإدارة.'},503);
 if(request.method!=='POST')return json({error:'الطلب غير مسموح.'},405,{Allow:'POST'});
 if(!sameOriginMutation(request,c.origin))return json({error:'الطلب غير مسموح.'},403);
 if(!['request','verify','logout','refresh'].includes(action))return json({error:'غير موجود.'},404);
 const stamp=milliseconds(c);
 try{
  if(action==='logout'){
   const token=readCookie(request.headers,authCookie);
   if(token){const hash=await digest(c,'session:'+token);await db.batch([
    db.prepare('INSERT INTO auth_events (id,user_id,event,created_at) SELECT ?,user_id,?,? FROM auth_sessions WHERE token_hash=? AND revoked_at IS NULL').bind(crypto.randomUUID(),'logout',stamp,hash),
    db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(stamp,hash)
   ]);}
   return json({ok:true},200,{'Set-Cookie':cookie(authCookie,'',0)});
  }
  if(action==='refresh'){
   const token=readCookie(request.headers,authCookie);
   if(token){
    const hash=await digest(c,'session:'+token);
    // One guarded write upgrades still-valid legacy sessions without reviving
    // expired sessions or bypassing concurrent logout/member revocation.
    const session=await db.prepare('UPDATE auth_sessions SET expires_at=0 WHERE token_hash=? AND revoked_at IS NULL AND (expires_at=0 OR expires_at>?) AND EXISTS (SELECT 1 FROM crm_members u WHERE u.id=auth_sessions.user_id AND u.active=1 AND u.auth_version=auth_sessions.user_version AND u.email=auth_sessions.email) RETURNING token_hash').bind(hash,stamp).first();
    if(session)return json({ok:true},200,{'Set-Cookie':cookie(authCookie,token,deviceCookieSeconds)});
   }
   return json({error:'انتهت جلسة الدخول. سجّل الدخول مجددًا.'},401,{'Set-Cookie':cookie(authCookie,'',0)});
  }
  const input=await body(request);if(!input)return json({error:'بيانات الطلب غير صحيحة.'},400);
  const client=c.clientKey?.(request);
  if(!client||c.deliveryReady===false)return json({error:'خدمة الدخول غير مهيأة. تواصل مع الإدارة.'},503);
  const clientHash=await digest(c,'client:'+client);
  if(!await permit(db,action+':client:'+clientHash,stamp,minute,action==='request'?10:30)||!await permit(db,action+':global',stamp,minute,1000))return json({error:'محاولات كثيرة. حاول بعد دقيقة.'},429,{'Retry-After':'60'});
  if(action==='request'){
   const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
   if(email.length>254||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@yourrest\.org$/.test(email))return json({error:'اكتب بريد الشركة الصحيح المنتهي بـ @yourrest.org.'},400);
   const subject=await digest(c,'subject:'+email);
   const permitted=await permit(db,'send-minute:'+subject,stamp,minute,1)&&await permit(db,'send-hour:'+subject,stamp,hour,5);
   const cid=randomToken();
   // Bound delivery and pad valid-address requests to the same deadline, including
   // unknown/inactive/throttled users, so mail-provider latency is not an oracle.
   const deadline=Math.max(0,c.deliveryDeadlineMs??5000),started=Date.now();
   // Unknown, blocked and rate-limited addresses have the same response and cookie shape.
   if(permitted){
    const user=await db.prepare('SELECT id,auth_version,email FROM crm_members WHERE email=? AND active=1').bind(email).first<{id:string;auth_version:number;email:string}>();
    const code=randomCode(),codeHash=await digest(c,'code:'+cid+':'+code);
    await db.prepare('INSERT INTO auth_challenges (id,subject_hash,code_hash,user_id,user_version,email,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(subject_hash) DO UPDATE SET id=excluded.id,code_hash=excluded.code_hash,user_id=excluded.user_id,user_version=excluded.user_version,email=excluded.email,created_at=excluded.created_at,expires_at=excluded.expires_at,ready=0,attempts=0,attempt_id=NULL,consumed=0').bind(cid,subject,codeHash,user?.id??null,user?.auth_version??null,email,stamp,stamp+10*minute).run();
    if(user){
     const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
     try{await Promise.race([c.send({to:email,code,expiresInMinutes:10,signal:controller.signal}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Delivery timeout'));},deadline);})]);
      await db.batch([db.prepare('UPDATE auth_challenges SET ready=1 WHERE id=? AND expires_at>?').bind(cid,milliseconds(c)),event(db,user.id,'otp_sent',stamp)]);
     }catch{controller.abort();await db.batch([db.prepare('UPDATE auth_challenges SET consumed=1 WHERE id=?').bind(cid),event(db,user.id,'otp_delivery_failed',stamp)]);}
     finally{if(timer!==undefined)clearTimeout(timer);}
    }else await event(db,null,'otp_request_rejected',stamp).run();
   }else await event(db,null,'otp_request_throttled',stamp).run();
   const previous=readCookie(request.headers,challengeCookie);
   const preserve=!permitted&&previous&&await db.prepare('SELECT id FROM auth_challenges WHERE id=? AND subject_hash=?').bind(previous,subject).first();
   const remaining=deadline-(Date.now()-started);if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
   // A throttled retry must not destroy the already delivered browser challenge.
   return json({ok:true,message:'إذا كان البريد مسجلًا ومفعّلًا، سيصلك رمز الدخول. يمكنك إعادة الطلب بعد دقيقة.'},200,permitted?{'Set-Cookie':cookie(challengeCookie,cid,600)}:preserve?{}:{'Set-Cookie':cookie(challengeCookie,'',0)});
  }
  const cid=readCookie(request.headers,challengeCookie);
  if(!cid||typeof input.code!=='string'||!/^\d{6}$/.test(input.code))return json({error:invalidCode},400);
  const codeHash=await digest(c,'code:'+cid+':'+input.code),attempt=randomToken(),token=randomToken(),hash=await digest(c,'session:'+token);
  await db.batch([
   db.prepare('UPDATE auth_challenges SET attempts=attempts+1,attempt_id=? WHERE id=? AND ready=1 AND consumed=0 AND expires_at>? AND attempts<5').bind(attempt,cid,stamp),
   db.prepare('INSERT INTO auth_sessions (token_hash,user_id,user_version,email,challenge_id,created_at,expires_at) SELECT ?,u.id,u.auth_version,u.email,c.id,?,0 FROM auth_challenges c JOIN crm_members u ON u.id=c.user_id WHERE c.id=? AND c.attempt_id=? AND c.code_hash=? AND u.active=1 AND u.auth_version=c.user_version AND u.email=c.email').bind(hash,stamp,cid,attempt,codeHash),
   db.prepare('UPDATE auth_challenges SET consumed=1 WHERE id=? AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash=?)').bind(cid,hash),
   db.prepare("INSERT INTO auth_events (id,user_id,event,created_at) SELECT ?,user_id,'login_success',? FROM auth_sessions WHERE token_hash=?").bind(crypto.randomUUID(),stamp,hash)
  ]);
  const session=await db.prepare('SELECT token_hash FROM auth_sessions WHERE token_hash=?').bind(hash).first();
  if(!session){await event(db,null,'login_failed',stamp).run();return json({error:invalidCode},400);}
  return json({ok:true,return_to:safeAuthReturn()},200,{'Set-Cookie':cookie(authCookie,token,deviceCookieSeconds)});
 }catch{
  const requestId=crypto.randomUUID();console.error(JSON.stringify({event:'auth_failure',request_id:requestId,action}));
  return json({error:'تعذر إتمام الدخول. حاول مجددًا.',request_id:requestId},503);
 }
}

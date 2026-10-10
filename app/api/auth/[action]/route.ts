import {authDatabase,emailAuthConfig} from '@/lib/auth-environment';
import {handleEmailAuth} from '@/lib/email-auth';
export const dynamic='force-dynamic';
async function route(request:Request,{params}:{params:Promise<{action:string}>}){
 try{return await handleEmailAuth(request,(await params).action,authDatabase(),emailAuthConfig());}
 catch{const requestId=crypto.randomUUID();console.error(JSON.stringify({event:'auth_unavailable',request_id:requestId}));
 return Response.json({error:'خدمة الدخول غير متاحة. تواصل مع الإدارة.',request_id:requestId},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export {route as GET,route as POST};

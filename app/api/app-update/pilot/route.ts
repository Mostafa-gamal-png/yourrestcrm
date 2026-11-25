import {z} from 'zod';
import {context,checkOrigin,replyError,readJsonBody,CRMError} from '@/lib/crm-server';
import {regionScope} from '@/lib/regions';
import {approveRelease,pendingPilot,pilotView,readReleaseApproval,servedRelease} from '@/lib/app-release-approval';
export const dynamic='force-dynamic';
/** «اعتماد التحديث للجميع» (lib/app-release-approval.ts): only the owner's account kind (an administrator over every region) reads the pilot
 * waiting to be tried and approves it. */
function requireOwner(c:Awaited<ReturnType<typeof context>>){if(c.me.role!=='admin'||regionScope(c.me)!=='all')throw new CRMError('اعتماد تحديث التطبيق متاح لمدير النظام فقط',403);}
export async function GET(){try{
 const c=await context({load:'identity'});requireOwner(c);
 const approval=await readReleaseApproval(c.db),approved=approval?.versionCode??null,served=servedRelease(approved);
 return Response.json({pilot:pilotView(pendingPilot(approved)),served:{versionName:served.versionName,versionCode:served.versionCode},approval},{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}
export async function POST(req:Request){try{
 checkOrigin(req);const body=await readJsonBody(req);
 const c=await context({load:'identity'});requireOwner(c);
 if(body.action!=='approve')throw new CRMError('طلب غير معروف',400);
 const versionCode=z.number().int().positive().max(1_000_000).parse(body.versionCode),now=new Date().toISOString();
 const outcome=await approveRelease(c.db,versionCode,c.me.id,now);
 if(outcome==='unknown')throw new CRMError('هذه النسخة غير منشورة للتجربة',404);
 if(outcome==='older')throw new CRMError('اعتُمدت هذه النسخة أو نسخة أحدث منها من قبل',409);
 if(outcome==='changed')throw new CRMError('تغيّر اعتماد التحديث للتو. حدّث الصفحة وراجع قبل الاعتماد.',409);
 const served=servedRelease(versionCode);
 return Response.json({ok:true,served:{versionName:served.versionName,versionCode:served.versionCode}},{headers:{'Cache-Control':'no-store'}});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:'رقم النسخة غير صحيح'},{status:400});return replyError(e);}}

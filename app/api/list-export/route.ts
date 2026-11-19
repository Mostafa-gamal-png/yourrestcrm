import {context,CRMError,replyError,requireCell,requirePages} from '@/lib/crm-server';
import {canViewPage} from '@/lib/access';
import {isFieldRole} from '@/lib/roles';
import {complaintQueue} from '@/lib/complaints';
import {loadComplaints} from '@/lib/complaint-rows';
import {missedVisits,supportQueue} from '@/lib/support';
import {loadSupport} from '@/lib/support-rows';
import {leadReader} from '@/lib/service-sales';
import {leadList} from '@/lib/service-sales-server';
import {LIST_EXPORTS,listExportFileName,listExportPlace,listWorkbook,mayExportList,type ExportLanguage,type ListExportPage} from '@/lib/list-export';
import {complaintsTable,leadsTable,supportTables} from '@/lib/list-export-service';
import {riyadhDate} from '@/lib/visits';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'private, no-store'};
const SERVER_PAGES:readonly ListExportPage[]=['complaints','support','service-leads'];
function errorResponse(error:unknown){const response=replyError(error);response.headers.set('cache-control','private, no-store');return response;}

/** «تصدير Excel» of a list the server builds (the owner, 2026-11-19, GSCO 2.13.80; lib/list-export.ts): the page holds only the first 300
 *  of the complaints and of «التواصل مع العملاء», and one page of «مصادر الفرص», so the file is made here with the page's own reading and
 *  scope (complaintQueue, supportQueue and missedVisits, leadList: what the member may read, every row of it).
 *  GET ?page=complaints|support|service-leads&lang=ar|en (service-leads also &list=lost|dormant&q=). In order: no session 401; a list that
 *  is not one of these 400; a representative or a marketing officer 403 (they never export); «مصادر الفرص» to a role it is not for 403
 *  (its own words); the screen that shows the list hidden from the member 404 (as any hidden screen's request: «الشكاوى» for the roles that
 *  have that page, else «الزيارات»); its «تصدير» cell switched off 403; a «مصادر الفرص» list that is not one 400. Reads only; never cached. */
export async function GET(request:Request){try{
 const params=new URL(request.url).searchParams;
 const probe=await context({load:'identity'}),me=probe.me,page=params.get('page');
 if(!page||!(SERVER_PAGES as readonly string[]).includes(page))throw new CRMError('اختر القائمة المطلوب تصديرها.',400);
 const list=page as ListExportPage;
 if(isFieldRole(me.role))throw new CRMError('تصدير القوائم غير متاح لحسابك.',403);
 if(list==='service-leads'&&!leadReader(me.role))throw new CRMError('مصادر الفرص متاحة لخدمة العملاء ومدير النظام.',403);
 const place=listExportPlace(me.role,list);
 if(!canViewPage(me.role,place.screen))throw new CRMError('تصدير القوائم غير متاح لحسابك.',403);
 requirePages(me,place.screen);
 requireCell(me,place.cell,'export');
 // Whatever the steps above let through, the page's own rule (the button shows by it) must hold.
 if(!mayExportList(me,list))throw new CRMError('تصدير القوائم غير متاح لحسابك.',403);
 const language:ExportLanguage=params.get('lang')==='en'?'en':'ar',now=new Date().toISOString();
 let tables;
 if(list==='service-leads'){
  const which=params.get('list');
  if(which!=='lost'&&which!=='dormant')throw new CRMError('اختر القائمة المطلوبة.',400);
  const answer=await leadList(await context(),which,(params.get('q')||'').slice(0,60),1,Infinity);
  tables=[leadsTable(which,answer.rows,language)];
 }else{
  // As the page's own GET: customer service and the administrator read from the full context, the sales members from the directory.
  const c=['admin','customer_service','customer_service_manager'].includes(me.role)?await context():await context({load:'directory'});
  if(list==='complaints')tables=[complaintsTable(complaintQueue({me:c.me,members:c.members,all:c.all,complaints:await loadComplaints(c.db,now)},now,Infinity),language)];
  else{
   const scope={me:c.me,members:c.members,all:c.all,visible:c.visible,support:await loadSupport(c.db,now)};
   tables=supportTables(supportQueue(scope,now,Infinity),missedVisits(scope,now,Infinity),language);
  }
 }
 const file=listWorkbook(tables,language),name=listExportFileName(list,riyadhDate(now));
 return new Response(file.bytes,{headers:{...noStore,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+name+'"','X-Content-Type-Options':'nosniff',
  'X-Export-Page':LIST_EXPORTS[list].file,'X-Export-Rows':String(file.rows),'X-Export-Total':String(file.total),'X-Export-Capped':file.capped?'1':'0'}});
}catch(error){return errorResponse(error);}}

import {context,replyError,CRMError} from '@/lib/crm-server';
import {listCustomerEdits} from '@/lib/customer-edit-requests-server';
export const dynamic='force-dynamic';
/** «طلبات تعديل بيانات العميل» (lib/customer-edit-requests*.ts): GET only, read-only, never cached; 401 without a session. Without
 *  `customerId`, the first screen's list (what the reader may decide now and their own requests); with it, that customer's requests the
 *  reader may read. Every member reads only what lib/customer-edit-requests-server.ts listCustomerEdits gives their role and scope.
 *  The decisions (approve, reject, cancel) are POST /api/crm {action:'customer-edit'}, beside the customer save they run. */
export async function GET(req:Request){try{
 const raw=new URL(req.url).searchParams.get('customerId');
 if(raw!==null&&(!raw||raw.length>200))throw new CRMError('حدد العميل.',400);
 // No records: the list reads only the customers its requests name (lib/customer-edit-requests-server.ts listCustomerEdits).
 const c=await context({load:'identity'});
 return Response.json(await listCustomerEdits(c,raw),{headers:{'Cache-Control':'no-store'}});
}catch(error){const response=replyError(error);response.headers.set('Cache-Control','no-store');return response;}}

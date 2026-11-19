// «صور القالب» of a customer (lib/mold-photos.ts, lib/mold-photos-server.ts):
// - GET ?customerId=<id>: the photos (oldest first) and whether the reader may add; 404 for a customer the reader does not see.
// - GET ?id=<photo>: the photo itself, to whoever sees its customer; 404 otherwise.
// - POST ?customerId=<id>&key=<uuid>, multipart `file`: one photo, shrunk on the device first (lib/image-shrink.ts); the key is the
//   upload's own, kept through retries, so a repeat after a network cut stores nothing twice.
// Every answer is decided as the signed-in member, before the body is read (anonymous: 401).
import {z} from 'zod';
import {context,checkOrigin,requireSession,CRMError,replyError,database} from '@/lib/crm-server';
import {readRequestForm} from '@/lib/request-body';
import {MOLD_PHOTO_ID,MOLD_PHOTO_TEXT,moldPhotoAddRefusal} from '@/lib/mold-photos';
import {addMoldPhoto,listMoldPhotos,moldPhotoResponse,moldPhotoRow,seenCustomer} from '@/lib/mold-photos-server';
export const dynamic='force-dynamic';

// Multipart parsing, hashing and the object write stay bounded together (per Node process, as for visit files); the page waits and retries.
const maxConcurrentUploads=2;
let activeUploads=0;
const customerIdInput=z.string().min(1).max(200);

export async function GET(req:Request){try{
 await requireSession();
 const params=new URL(req.url).searchParams,photoId=params.get('id');
 if(photoId!==null){
  const row=MOLD_PHOTO_ID.test(photoId)?await moldPhotoRow(database(),photoId):null;
  if(!row)throw new CRMError(MOLD_PHOTO_TEXT.photoGone,404);
  const c=await context({load:'customer-graph',customerId:row.customer_id});
  if(!seenCustomer(c,row.customer_id))throw new CRMError(MOLD_PHOTO_TEXT.photoGone,404);
  return await moldPhotoResponse(row);
 }
 const customerId=customerIdInput.safeParse(params.get('customerId'));
 if(!customerId.success)throw new CRMError(MOLD_PHOTO_TEXT.customerGone,404);
 const c=await context({load:'customer-graph',customerId:customerId.data}),customer=seenCustomer(c,customerId.data);
 if(!customer)throw new CRMError(MOLD_PHOTO_TEXT.customerGone,404);
 return Response.json(await listMoldPhotos(c,customer),{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return replyError(e);}}

export async function POST(req:Request){let admitted=false;try{
 checkOrigin(req);await requireSession();
 const params=new URL(req.url).searchParams,customerId=customerIdInput.parse(params.get('customerId')),key=z.string().uuid().parse(params.get('key'));
 const c=await context({load:'customer-graph',customerId}),customer=seenCustomer(c,customerId);
 if(!customer)throw new CRMError(MOLD_PHOTO_TEXT.customerGone,404);
 const refusal=moldPhotoAddRefusal(customer,c.members,c.me);
 if(refusal)throw new CRMError(refusal,403);
 if(activeUploads>=maxConcurrentUploads){void req.body?.cancel().catch(()=>{});return Response.json({error:MOLD_PHOTO_TEXT.busy},{status:429,headers:{'Retry-After':'2','Cache-Control':'private, no-store'}});}
 activeUploads++;admitted=true;
 const form=await readRequestForm(req);
 return await addMoldPhoto(c,customer,key,form.get('file'));
}catch(e){if(e instanceof z.ZodError)return Response.json({error:MOLD_PHOTO_TEXT.badRequest},{status:400});return replyError(e);}finally{if(admitted)activeUploads--;}}

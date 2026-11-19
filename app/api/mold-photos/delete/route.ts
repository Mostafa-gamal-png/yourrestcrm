// Deleting one of «صور القالب» (lib/mold-photos-server.ts deleteMoldPhoto): POST {id}, by whoever added the photo or the administrator,
// of a customer they see; asked for confirmation on the page. A photo already deleted answers alreadyDeleted (a repeated tap).
import {z} from 'zod';
import {context,checkOrigin,requireSession,readJsonBody,CRMError,replyError,database} from '@/lib/crm-server';
import {MOLD_PHOTO_ID,MOLD_PHOTO_TEXT,moldPhotoDeleteReceipt} from '@/lib/mold-photos';
import {deleteMoldPhoto,moldPhotoRow,seenCustomer} from '@/lib/mold-photos-server';
export const dynamic='force-dynamic';

export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const body=await readJsonBody(req),id=z.string().regex(MOLD_PHOTO_ID).parse(body.id),db=database();
 const row=await moldPhotoRow(db,id);
 if(!row){
  if(await db.prepare('SELECT id FROM crm_audit WHERE id=?').bind(moldPhotoDeleteReceipt(id)).first())return Response.json({ok:true,alreadyDeleted:true});
  throw new CRMError(MOLD_PHOTO_TEXT.photoGone,404);
 }
 const c=await context({load:'customer-graph',customerId:row.customer_id}),customer=seenCustomer(c,row.customer_id);
 if(!customer)throw new CRMError(MOLD_PHOTO_TEXT.photoGone,404);
 return await deleteMoldPhoto(c,customer,row);
}catch(e){if(e instanceof z.ZodError)return Response.json({error:MOLD_PHOTO_TEXT.badRequest},{status:400});return replyError(e);}}

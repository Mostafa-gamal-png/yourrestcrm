// The page the customer opens from the representative's link to sign a mold request (the owner, 2026-11-10): public (no session), not
// indexed, no CRM navigation; the token in the address is the only thing that names the request, looked up by its hash
// (lib/mold-sign-server.ts loadSignLinkPage). Every refusal (too many tries from the address, a token of another shape, unknown, expired,
// used, the request cancelled, changed hands or sent) is the same neutral page.
import type {Metadata} from 'next';
import {headers} from 'next/headers';
import {database} from '@/lib/crm-server';
import {loadSignLinkPage} from '@/lib/mold-sign-server';
import MoldSignPage from '@/app/mold-sign-page';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'توقيع طلب تصنيع قالب | يورست للصناعات',robots:{index:false,follow:false,nocache:true,googleBot:{index:false,follow:false}},referrer:'no-referrer'};

export default async function SignLinkPage({params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 const page=await loadSignLinkPage(database(),token,new Headers(await headers())).catch(()=>null);
 return <MoldSignPage token={page?token:''} page={page}/>;
}

import {env} from 'cloudflare:workers';
import {context,replyError,requireSalesRole,requirePages} from '@/lib/crm-server';
import {configureOverpass,workAreaStreetsGet} from '@/lib/work-areas-server';
export const dynamic='force-dynamic';
/** The streets of a representative's work area with no customer within 50 m (lib/work-areas-server.ts): GET ?member=<id>, as GET
 * /api/work-areas?member= decides who may ask. The streets come from the local data, else from OpenStreetMap's Overpass API on the server only
 * (YR_OVERPASS_URL in settings.cjs may name other services; without it the public ones). The answer may wait up to 45 seconds for Overpass.
 * Never cached. */
export async function GET(req:Request){try{
 const c=await context({load:'identity'});requireSalesRole(c.me);requirePages(c.me,'map');
 configureOverpass({url:env.YR_OVERPASS_URL??null});
 return Response.json(await workAreaStreetsGet(c,new URL(req.url)),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}

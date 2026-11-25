import {database} from '@/lib/crm-server';
import {readReleaseApproval,servedRelease} from '@/lib/app-release-approval';

// Public software metadata only. Do not tie updates to session expiry or cache
// an older APK announcement in a browser, proxy or service worker.
// Since 2026-11-25 (lib/app-release-approval.ts) the newest release the owner approved after trying it on a phone: the base release, or
// a later pilot once approved. A database that cannot be read serves the base, never a pilot.
export const dynamic = 'force-dynamic';
export async function GET() {
  let approved: number | null = null;
  try { approved = (await readReleaseApproval(database()))?.versionCode ?? null; } catch { approved = null; }
  return Response.json(servedRelease(approved), {headers: {
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  }});
}

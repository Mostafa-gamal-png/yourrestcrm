import release from '@/lib/app-update-release.json';

// Public software metadata only. Do not tie updates to session expiry or cache
// an older APK announcement in a browser, proxy or service worker.
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(release, {headers: {
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  }});
}

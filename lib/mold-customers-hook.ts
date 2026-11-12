// Starts or nudges the mold requests' background work from the routes that every page loads or that change customers or members: the
// products application's customer list (lib/mold-customers-server.ts), its salesmen list (lib/mold-salesmen-server.ts, 2026-11-12: the
// same nudge, so a member saved through POST /api/crm goes a few seconds later; a check with nothing changed sends nothing) and the
// retry timer of requests waiting to be sent (lib/mold-requests-server.ts, so a request saved before a restart goes without anyone
// opening the mold requests page). All are loaded on first use, so those routes carry none of their weight or their imports, and none
// ever throws into them: a failure here waits for the next check.
export function nudgeMoldCustomers(options:{soon?:boolean}={}){
 void import('./mold-customers-server').then(sync=>sync.nudgeMoldCustomers(options)).catch(()=>{});
 void import('./mold-salesmen-server').then(sync=>sync.nudgeMoldSalesmen(options)).catch(()=>{});
}
export function wakeMoldRetries(){
 void import('./mold-requests-server').then(sending=>sending.keepMoldRetrying()).catch(()=>{});
}

// Starts or nudges the mold requests' background work from the routes that every page loads or that change customers: the products
// application's customer list (lib/mold-customers-server.ts) and the retry timer of requests waiting to be sent (lib/mold-requests-server.ts,
// so a request saved before a restart goes without anyone opening the mold requests page). Both are loaded on first use, so those
// routes carry none of their weight or their imports, and neither ever throws into them: a failure here waits for the next check.
export function nudgeMoldCustomers(options:{soon?:boolean}={}){
 void import('./mold-customers-server').then(sync=>sync.nudgeMoldCustomers(options)).catch(()=>{});
}
export function wakeMoldRetries(){
 void import('./mold-requests-server').then(sending=>sending.keepMoldRetrying()).catch(()=>{});
}

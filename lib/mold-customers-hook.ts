// Starts or nudges the products application's customer list (lib/mold-customers-server.ts) from the routes that every page loads or that
// change customers. The sync is loaded on first use, so those routes carry none of its weight or its imports, and it never throws into
// them: a failure here waits for the next check.
export function nudgeMoldCustomers(options:{soon?:boolean}={}){
 void import('./mold-customers-server').then(sync=>sync.nudgeMoldCustomers(options)).catch(()=>{});
}

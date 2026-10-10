// cPanel Passenger startup. Persistent storage lives outside both this replaceable release and public_html.
process.env.TZ='Asia/Riyadh';
process.umask(0o077);
const path=require('node:path');
const fs=require('node:fs');
const [major,minor]=process.versions.node.split('.').map(Number);
function stop(message){console.error(message);process.exit(1);}
if(major<22||(major===22&&minor<16))stop('Yourrest requires Node.js >=22.16.');
if(!process.env.YR_APP_ORIGIN||!process.env.YR_DATABASE_PATH||!process.env.YR_OBJECTS_PATH||!process.env.YR_AUTH_SECRET)stop('Yourrest startup blocked: independent hosting configuration is incomplete.');
try{
 const origin=new URL(process.env.YR_APP_ORIGIN);
 if(origin.protocol!=='https:'||origin.origin!==process.env.YR_APP_ORIGIN||origin.username||origin.password||!/^[a-f0-9]{64,}$/i.test(process.env.YR_AUTH_SECRET))throw Error();
 const release=fs.realpathSync(__dirname);
 for(const location of [process.env.YR_DATABASE_PATH,process.env.YR_OBJECTS_PATH]){
  if(!path.isAbsolute(location))throw Error();
  const canonical=fs.realpathSync(location),relative=path.relative(release,canonical);
  if(!relative.startsWith('..'+path.sep)||canonical.split(path.sep).includes('public_html'))throw Error();
  for(let current=path.resolve(location);current!==path.dirname(current);current=path.dirname(current))if(fs.lstatSync(current).isSymbolicLink())throw Error();
  if(fs.lstatSync(canonical).mode&0o077)throw Error();
 }
 if(!fs.statSync(process.env.YR_DATABASE_PATH).isFile()||!fs.statSync(process.env.YR_OBJECTS_PATH).isDirectory())throw Error();
 process.env.VINEXT_TRUSTED_HOSTS=origin.host;
 // Check the original Host before vinext consumes any forwarded headers. Do not allow
 // public callers to select another origin through Host or X-Forwarded-Host.
 const http=require('node:http'),emit=http.Server.prototype.emit,expectedHost=origin.host.toLowerCase();
 http.Server.prototype.emit=function(event,req,res,...args){
  if(event==='request'){
   // Apply to documents, API errors and public assets, including Host rejection.
   // These directives isolate the app from framing without changing React's
   // script/style loading, map tiles, workers or the native WebView flow.
   res.setHeader('Content-Security-Policy',"frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
   res.setHeader('X-Frame-Options','DENY');
   res.setHeader('X-Content-Type-Options','nosniff');
   res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
   const host=req.headers.host,forwarded=req.headers['x-forwarded-host'];
   if(typeof host!=='string'||host.toLowerCase()!==expectedHost||(forwarded!==undefined&&(typeof forwarded!=='string'||forwarded.toLowerCase()!==expectedHost))){
    res.writeHead(421,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end('Unrecognized application host');return true;
   }
  }
  return emit.apply(this,arguments);
 };
 // Passenger intercepts the first listen call and selects its own Unix socket.
 // Its socket pathname must never be parsed as a TCP port by the standalone server.
 if(globalThis.PhusionPassenger&&process.env.PORT&&!/^\d+$/.test(process.env.PORT))delete process.env.PORT;
}catch{stop('Yourrest startup blocked: HTTPS origin, private data paths or auth secret is invalid.');}
import('./operations/upgrade.mjs').then(async({upgradeExistingDatabase})=>{
 await upgradeExistingDatabase({filename:process.env.YR_DATABASE_PATH,migrations:path.join(__dirname,'drizzle'),appRoot:path.resolve(__dirname,'..')});
 return import('./server.js');
}).catch(error=>{console.error('Yourrest startup error:',error instanceof Error?error.message:'Unknown startup error');stop('Yourrest startup failed. Check the deployment logs, database migration history and configuration.');});

// Temporary cPanel startup file. No CRM data, secrets, sessions or email access.
const http=require('node:http');
let origin;
try{origin=new URL(process.env.YR_APP_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==process.env.YR_APP_ORIGIN||origin.username||origin.password)throw Error();}
catch{console.error('Set YR_APP_ORIGIN to the dedicated HTTPS application origin.');process.exit(1);}
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','application/json; charset=utf-8');
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 if(req.url!=='/'||req.headers.host!==origin.host){res.writeHead(404);res.end();return;}
 res.writeHead(200);res.end(JSON.stringify({ok:true,check:'yourrest-hosting-check-v1',message:'الخادم يعمل. لم يُفعّل التطبيق بعد.',https_verified:false,login_enabled:false}));
}).listen(globalThis.PhusionPassenger?3000:process.env.PORT||3000);

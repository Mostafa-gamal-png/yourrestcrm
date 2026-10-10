import {isIP} from 'node:net';

export function passengerClient(headers){
 let origin;
 try{origin=new URL(process.env.YR_APP_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==process.env.YR_APP_ORIGIN||origin.username||origin.password)return null;}catch{return null;}
 // Only explicitly verified Passenger secure headers may partition the global limiter by IP.
 if(process.env.YR_PASSENGER_HEADERS_VERIFIED==='yes'&&typeof globalThis.PhusionPassenger?.configure==='function'&&headers.get('!~passenger-proto')==='https'){
  const value=headers.get('!~passenger-client-address');
  if(value&&!value.includes('%')&&isIP(value)){
   const normalized=isIP(value)===6?new URL('http://['+value+']/').hostname.slice(1,-1):value;
   return 'passenger:'+normalized;
  }
 }
 // LiteSpeed/Passenger Unix sockets may expose no client address. A shared bucket is
 // conservative: missing or spoofed headers cannot mint fresh limits. Never invent an IP.
 // Per-account limits still apply, and the auth routes separately validate the exact HTTPS origin.
 return 'independent:shared';
}

import {env} from 'cloudflare:workers';

export type CustomerAddressResult={status:'found'|'not_configured'|'not_found'|'unavailable'|'ambiguous';shortAddress?:string;address?:string;city?:string};
type Point={latitude:number;longitude:number};
const providerUrl='https://apina.address.gov.sa/NationalAddress/v3.1/address/address-geocode';
const calls=new Map<string,{started:number;count:number}>();

/** A bounded process-local quota protects the optional provider without storing location history. */
export function allowCustomerAddressLookup(memberId:string,now=Date.now()){
 for(const [id,value] of calls)if(now-value.started>=60_000)calls.delete(id);
 const current=calls.get(memberId);
 if(current){if(current.count>=10)return false;current.count++;return true;}
 if(calls.size>=5000)return false;
 calls.set(memberId,{started:now,count:1});return true;
}

const clean=(value:unknown)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,250):'';
const code=(value:unknown)=>{const normalized=clean(value).replace(/\s+/g,'').toUpperCase();return /^[A-Z]{4}[0-9]{4}$/.test(normalized)?normalized:'';};

/** A postcode/building number is never converted into a national short address. */
export function parseCustomerAddressResponse(payload:unknown):CustomerAddressResult{
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return{status:'unavailable'};
 const response=payload as Record<string,unknown>;
 if(response.success!==true&&response.success!=='true')return{status:'unavailable'};
 if(Number(response.totalSearchResults)>1)return{status:'ambiguous'};
 if(!Array.isArray(response.Addresses))return{status:'not_found'};
 const addresses=response.Addresses.filter((value):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value));
 if(!addresses.length)return{status:'not_found'};
 // The GPS point can overlap nearby buildings. Never pick an arbitrary candidate.
 if(addresses.length!==1)return{status:'ambiguous'};
 const match=addresses[0],shortAddress=code(match.ShortAddress),address=clean(match.Address1),city=clean(match.City);
 if(!shortAddress&&!address&&!city)return{status:'not_found'};
 return{status:'found',...(shortAddress?{shortAddress}:{}),...(address?{address}:{}),...(city?{city}:{})};
}

async function readProviderJson(response:Response){
 if(Number(response.headers.get('content-length'))>512_000)throw Error('Provider response too large');
 const reader=response.body?.getReader();if(!reader)throw Error('Provider response empty');
 const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>512_000)throw Error('Provider response too large');chunks.push(value);}}
 catch(error){void reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

export async function lookupCustomerAddress(point:Point,language:'ar'|'en'='ar'):Promise<CustomerAddressResult>{
 const key=env.YR_NATIONAL_ADDRESS_API_KEY?.trim();
 if(!key)return{status:'not_configured'};
 const url=new URL(providerUrl);
 url.search=new URLSearchParams({lat:String(point.latitude),long:String(point.longitude),language:language==='en'?'E':'A',format:'JSON',encode:'utf8',api_key:key}).toString();
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Provider timed out'));},8000);});
 try{
  return await Promise.race([(async()=>{
   const response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal,redirect:'error'});
   if(!response.ok)return{status:'unavailable' as const};
   return parseCustomerAddressResponse(await readProviderJson(response));
  })(),deadline]);
 }catch{return{status:'unavailable'};}
 finally{if(timer!==undefined)clearTimeout(timer);controller.abort();}
}

/** Browser-side buffer only. Positions are never persisted in web storage. */
export type JourneyClientPoint={id:string;capturedAt:string;latitude:number;longitude:number;accuracy:number};
export type QueuedJourneyPoint=JourneyClientPoint&{stopId:string};
export const JOURNEY_BUFFER_MS=15*60*1000;
export const JOURNEY_BUFFER_LIMIT=500;
export function journeyDay(at=Date.now()){return new Date(at+3*60*60*1000).toISOString().slice(0,10);}
export function positionSample(position:Pick<GeolocationPosition,'timestamp'|'coords'>,now=Date.now(),id=crypto.randomUUID()):JourneyClientPoint|null{
 const {latitude,longitude,accuracy}=position.coords,timestamp=position.timestamp;
 if(![latitude,longitude,accuracy,timestamp].every(Number.isFinite)||Math.abs(latitude)>90||Math.abs(longitude)>180||latitude===0&&longitude===0||accuracy<0||accuracy>10000||timestamp>now+5000||timestamp<now-JOURNEY_BUFFER_MS)return null;
 return {id,capturedAt:new Date(timestamp).toISOString(),latitude,longitude,accuracy};
}
export function trimJourneyBuffer(points:QueuedJourneyPoint[],now=Date.now()){
 const kept=points.filter(point=>Date.parse(point.capturedAt)>=now-JOURNEY_BUFFER_MS).slice(-JOURNEY_BUFFER_LIMIT);
 return {points:kept,dropped:points.length-kept.length};
}
export function shouldStartJourney(input:{enabled:boolean;customerId:string;type:string;date?:string},day=journeyDay()){
 return input.enabled&&!!input.customerId&&input.type==='visit'&&(!input.date||input.date===day);
}

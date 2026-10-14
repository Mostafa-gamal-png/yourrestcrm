export type Coordinates={latitude:number;longitude:number};
export type LocationFields={location?:string;latitude?:number|null;longitude?:number|null;locationSource?:'device';locationCapturedAt?:string;locationAccuracy?:number};
export function coordinatesFromText(text?:string):Coordinates|null{
 const raw=(text||'').trim().replace(/،/g,',');
 // Only extract explicit coordinates, never infer a location from a city name.
 const pair=raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)||raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)||raw.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i);
 if(!pair)return null;const latitude=Number(pair[1]),longitude=Number(pair[2]);
 return Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180&&!(latitude===0&&longitude===0)?{latitude,longitude}:null;
}
const plainPair=/^\s*-?\d+(?:\.\d+)?\s*[,،]\s*-?\d+(?:\.\d+)?\s*$/;
/** A pasted maps link is long (the field holds 250 characters) and says little: keep the place it points to as plain coordinates.
 * Text that already is a pair, or is not coordinates at all, stays as typed. */
export function tidyLocationText(text:string):string{
 const point=coordinatesFromText(text);
 return point&&!plainPair.test(text)?`${point.latitude.toFixed(7)}, ${point.longitude.toFixed(7)}`:text;
}
type LocatedData=Pick<LocationFields,'latitude'|'longitude'|'location'>;
export function customerCoordinates(data:LocatedData):Coordinates|null{
 if(typeof data.latitude==='number'&&typeof data.longitude==='number'&&Number.isFinite(data.latitude)&&Number.isFinite(data.longitude)&&Math.abs(data.latitude)<=90&&Math.abs(data.longitude)<=180&&!(data.latitude===0&&data.longitude===0))return {latitude:data.latitude,longitude:data.longitude};
 return coordinatesFromText(data.location||'');
}
export function mapsLink(data:LocatedData){const point=customerCoordinates(data);return point?'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(`${point.latitude},${point.longitude}`)+'&travelmode=driving&dir_action=navigate':null;}

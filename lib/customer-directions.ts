import {mapsLink} from './customer-location';

/** External navigation accepts only the explicitly stored coordinate pair.
 * Customer names, addresses and third-party URLs never become an intent. */
export function customerDirectionsLink(data:unknown):string|null{
 return data&&typeof data==='object'?mapsLink(data):null;
}

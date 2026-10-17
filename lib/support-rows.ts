import type {SupportRow} from './support';

/** Reading assistance rows out of `crm_records`: the route that works on them and the customer-service evaluation share these.
 * A row whose data is damaged or is not a support request is left out, never shown. */
type Raw={id:string;branch:string;assignedTo:string;data:string;createdAt:string;updatedAt:string;version:number};
const columns='id,branch,assigned_to AS assignedTo,data,created_at AS createdAt,updated_at AS updatedAt,version';
export function decodeSupport(rows:Raw[]):SupportRow[]{
 const found:SupportRow[]=[];
 for(const row of rows){
  try{const data=JSON.parse(row.data);if(data&&data.kind==='support'&&typeof data.customerId==='string')found.push({...row,data});}catch{/* a damaged row is left out, never shown */}
 }
 return found;
}
/** Open requests and whatever changed in the last 45 days: enough for every list and for "this visit was already handled". */
export async function loadSupport(db:D1Database,now:string){
 const since=new Date(Date.parse(now)-45*86400000).toISOString();
 return decodeSupport((await db.prepare(`SELECT ${columns} FROM crm_records WHERE kind='support' AND (updated_at>=? OR json_extract(data,'$.status')='open') ORDER BY created_at DESC,id DESC`).bind(since).all<Raw>()).results);
}
export async function loadSupportRow(db:D1Database,id:string){return decodeSupport((await db.prepare(`SELECT ${columns} FROM crm_records WHERE kind='support' AND id=?`).bind(id).all<Raw>()).results)[0];}
/** Every request there is, oldest first: the evaluation of a month counts requests answered however long ago they were made. */
export async function loadAllSupport(db:D1Database){return decodeSupport((await db.prepare(`SELECT ${columns} FROM crm_records WHERE kind='support' ORDER BY created_at,id`).all<Raw>()).results);}

import type {ComplaintRow} from './complaints';

/** Reading complaint rows out of `crm_records`: the route that works on them and the monthly report share these. A row whose
 * data is damaged or is not a complaint is left out, never shown. */
type Raw={id:string;branch:string;assignedTo:string;data:string;createdAt:string;updatedAt:string;version:number};
const columns='id,branch,assigned_to AS assignedTo,data,created_at AS createdAt,updated_at AS updatedAt,version';
export function decodeComplaints(rows:Raw[]):ComplaintRow[]{
 const found:ComplaintRow[]=[];
 for(const row of rows){
  try{const data=JSON.parse(row.data);if(data&&data.kind==='complaint'&&typeof data.customerId==='string')found.push({...row,data});}catch{/* a damaged row is left out, never shown */}
 }
 return found;
}
/** Open complaints and whatever changed in the last 45 days: enough for every list, the reopening window and the recent history. */
export async function loadComplaints(db:D1Database,now:string){
 const since=new Date(Date.parse(now)-45*86400000).toISOString();
 return decodeComplaints((await db.prepare(`SELECT ${columns} FROM crm_records WHERE kind='complaint' AND (updated_at>=? OR json_extract(data,'$.status') NOT IN ('closed','cancelled')) ORDER BY created_at DESC,id DESC`).bind(since).all<Raw>()).results);
}
export async function loadComplaint(db:D1Database,id:string){return decodeComplaints((await db.prepare(`SELECT ${columns} FROM crm_records WHERE kind='complaint' AND id=?`).bind(id).all<Raw>()).results)[0];}
/** Every complaint there is, oldest first: the monthly report counts closed ones however old they are. */
export async function loadAllComplaints(db:D1Database){return decodeComplaints((await db.prepare(`SELECT ${columns} FROM crm_records WHERE kind='complaint' ORDER BY created_at,id`).all<Raw>()).results);}

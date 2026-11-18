import type {Member,Row} from './crm';
import {CRMError} from './crm-server';
import {regionScope} from './regions';
import {FIELD_ROLES_SQL,isFieldRole} from './roles';
import {nearbyCatalog,NEARBY_ACCOUNT_CHANGED,NEARBY_REP_ONLY,NEARBY_TOO_MANY,type NearbyCatalog} from './nearby-customers';

/** GET /api/nearby-customers (lib/nearby-customers.ts says what it is): read-only; it creates no visit, route or record.
 *  One statement reads, in one SQLite snapshot, the reader's account (still active, a representative, the same sign-in version and
 *  regions: the «actor» row, as GSCO's sentinel, so a revoked account is told apart from an empty list) and the customers assigned to
 *  them with the day of each one's latest visit. A visit is an activity of type «زيارة» under the customer (directly, or under its
 *  request or machine: up to four levels, as lib/customer-visits.ts walks them), dated by its own day (else the Riyadh day it was stored);
 *  every member's visit counts. Deleted customers and visits are not in crm_records (they are in «المحذوفات»), so they never count. */
const CATALOG_SQL=`WITH RECURSIVE actor AS (
 SELECT id FROM crm_members WHERE id=? AND active=1 AND role IN ${FIELD_ROLES_SQL} AND auth_version=? AND region_scope=?
), mine AS (
 SELECT c.id,c.kind,c.assigned_to,c.data FROM actor JOIN crm_records c ON c.kind='customer' AND c.assigned_to=actor.id
), tree(id,customer_id,depth) AS (
 SELECT id,id,0 FROM mine
 UNION ALL SELECT child.id,tree.customer_id,tree.depth+1 FROM tree JOIN crm_records child ON child.parent_id=tree.id WHERE child.kind<>'customer' AND tree.depth<4
), visits AS (
 SELECT tree.customer_id,MAX(CASE WHEN date(json_extract(r.data,'$.date'))=json_extract(r.data,'$.date') THEN json_extract(r.data,'$.date') ELSE date(r.created_at,'+3 hours') END) AS last_visit
 FROM tree JOIN crm_records r ON r.id=tree.id WHERE tree.depth>0 AND r.kind='activity' AND json_extract(r.data,'$.type')='visit' GROUP BY tree.customer_id
) SELECT actor.id AS actorId,mine.id,mine.kind,mine.assigned_to AS assignedTo,mine.data,visits.last_visit AS lastVisit
 FROM actor LEFT JOIN mine ON 1=1 LEFT JOIN visits ON visits.customer_id=mine.id ORDER BY mine.id`;
type CatalogRow={actorId:string;id:string|null;kind:string|null;assignedTo:string|null;data:string|null;lastVisit:string|null};

export async function readNearbyCustomers(c:{db:D1Database;me:Member},now:string=new Date().toISOString()):Promise<NearbyCatalog>{
 if(!isFieldRole(c.me.role))throw new CRMError(NEARBY_REP_ONLY,403);
 const scope=regionScope(c.me);
 const rows=(await c.db.prepare(CATALOG_SQL).bind(c.me.id,c.me.authVersion||0,scope).all<CatalogRow>()).results;
 if(!rows.length)throw new CRMError(NEARBY_ACCOUNT_CHANGED,403);
 const customers:{customer:Pick<Row,'id'|'kind'|'assignedTo'|'data'>;lastVisit:string|null}[]=[];
 for(const row of rows){
  if(row.id===null||row.data===null)continue;
  let data:unknown;try{data=JSON.parse(row.data);}catch{continue;}
  customers.push({customer:{id:row.id,kind:row.kind as Row['kind'],assignedTo:row.assignedTo||'',data},lastVisit:row.lastVisit});
 }
 try{return nearbyCatalog(c.me,scope,customers,now);}
 catch(error){if(error instanceof RangeError)throw new CRMError(NEARBY_TOO_MANY,503);throw error;}
}

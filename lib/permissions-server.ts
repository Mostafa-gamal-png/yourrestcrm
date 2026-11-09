// «الصلاحيات» on the server (lib/permissions.ts): the cell of a save or a delete of /api/crm, the saved rows the administrator's team
// page edits, and the save itself (POST /api/crm {action:'permissions'}): the administrator only, a whole-row replace with its version (a
// stale version is 409), re-checked at commit, written with a «صلاحيات» history entry holding before and after (kept out of the recent
// changes of GET /api/crm).
import {z} from 'zod';
import type {Member,Row} from './crm';
import {accessGuard,CRMError,requireCell} from './crm-server';
import {regionScope} from './regions';
import {decodePermissions,normalizePermissions,recordCell,PERMISSIONS_AUDIT_ACTION,type StoredPermissions} from './permissions';
export {PERMISSIONS_AUDIT_ACTION};

/** The screen and action of a /api/crm save or delete (lib/permissions.ts recordCell, shared with the page). */
export const crmCell=recordCell;

export type SavedPermissions=StoredPermissions&{version:number};
type PermissionRow={member_id:string;permissions:string;hidden:string;version:number};
/** What is saved for each member, normalised to the member's role (a member never saved: version 0, every cell of the role on). */
export async function readMemberPermissions(db:D1Database,members:Member[]):Promise<Map<string,SavedPermissions>>{
 const rows=new Map((await db.prepare('SELECT member_id,permissions,hidden,version FROM crm_member_permissions').all<PermissionRow>()).results.map(row=>[row.member_id,row]));
 return new Map(members.map(member=>{const row=rows.get(member.id);return[member.id,{version:row?Number(row.version):0,...normalizePermissions(member.role,row?decodePermissions(row):null)}];}));
}

const input=z.object({
 action:z.literal('permissions'),memberId:z.string().min(1).max(200),version:z.number().int().min(0),requestId:z.string().uuid().optional(),
 cells:z.record(z.string().max(60),z.boolean()).refine(value=>Object.keys(value).length<=200,'صيغة البيانات غير صحيحة. أعد المحاولة.'),
 hidden:z.array(z.string().max(40)).max(30),viewAll:z.boolean().default(false),
}).strict();
type SaveContext={db:D1Database;me:Member;members:Member[];all:Row[]};
const CONFLICT='تغيّرت صلاحيات هذا المستخدم أو دوره. حمّل أحدث البيانات وراجعها قبل الحفظ.';
const same=(a:StoredPermissions,b:StoredPermissions)=>JSON.stringify([a.cells,a.hidden,a.viewAll])===JSON.stringify([b.cells,b.hidden,b.viewAll]);

export async function savePermissions(c:SaveContext,body:unknown,now:string){
 if(c.me.role!=='admin'||regionScope(c.me)!=='all')throw new CRMError('إدارة المستخدمين والصلاحيات متاحة لمدير النظام فقط',403);
 requireCell(c.me,'team','edit');
 const p=input.parse(body),member=c.members.find(m=>m.id===p.memberId);
 if(!member)throw new CRMError('المستخدم غير موجود',404);
 // Within the member's role only (restrict-only): cells beyond it, hidden screens the role does not have, viewAll where it does not exist,
 // and anything that would lock an administrator out are dropped here whatever the page sent.
 const after=normalizePermissions(member.role,p);
 const row=await c.db.prepare('SELECT member_id,permissions,hidden,version FROM crm_member_permissions WHERE member_id=?').bind(member.id).first<PermissionRow>();
 const before:SavedPermissions={version:row?Number(row.version):0,...normalizePermissions(member.role,row?decodePermissions(row):null)};
 const receiptId=p.requestId?'permissions:'+c.me.id+':'+p.requestId:'';
 const conflict=async()=>{
  // A retry of a save that went through answers as it did.
  if(receiptId){const receipt=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receiptId).first<{detail:string}>();if(receipt){const saved=JSON.parse(receipt.detail) as {memberId:string;after:SavedPermissions};if(saved.memberId===member.id&&same(saved.after,after))return Response.json({ok:true,alreadySaved:true,permissions:saved.after});}}
  return Response.json({error:CONFLICT,code:'PERMISSIONS_CONFLICT'},{status:409});
 };
 if(before.version!==p.version)return conflict();
 const version=before.version+1,encoded={permissions:JSON.stringify({...after.cells,...(after.viewAll?{viewAll:true}:{})}),hidden:JSON.stringify(after.hidden)};
 const guard=accessGuard(c),memberGate="EXISTS (SELECT 1 FROM crm_members WHERE id=? AND role=?)";
 const write=before.version===0
  ?c.db.prepare(`INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) SELECT ?,?,?,1,?,? WHERE NOT EXISTS (SELECT 1 FROM crm_member_permissions WHERE member_id=?) AND ${memberGate} AND ${guard.sql}`).bind(member.id,encoded.permissions,encoded.hidden,c.me.id,now,member.id,member.id,member.role,...guard.args)
  :c.db.prepare(`UPDATE crm_member_permissions SET permissions=?,hidden=?,version=version+1,updated_by=?,updated_at=? WHERE member_id=? AND version=? AND ${memberGate} AND ${guard.sql}`).bind(encoded.permissions,encoded.hidden,c.me.id,now,member.id,before.version,member.id,member.role,...guard.args);
 const saved:SavedPermissions={version,...after};
 const detail=JSON.stringify({memberId:member.id,memberName:member.name,role:member.role,before,after:saved});
 const gate='EXISTS (SELECT 1 FROM crm_member_permissions WHERE member_id=? AND version=? AND updated_by=? AND updated_at=?)';
 const result=await c.db.batch([write,c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId||crypto.randomUUID(),member.id,c.me.name,PERMISSIONS_AUDIT_ACTION,detail,now,member.id,version,c.me.id,now)]);
 if(result[0].meta.changes!==1)return conflict();
 return Response.json({ok:true,permissions:saved});
}

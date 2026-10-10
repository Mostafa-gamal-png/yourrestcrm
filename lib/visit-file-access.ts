import {salesScopeMemberIds} from './access';
import {accessGuard,CRMError,type context} from './crm-server';
import {canAccessVisitFile} from './followups-server';

type Context=Awaited<ReturnType<typeof context>>;
export type VisitAttachment={id:string;customer_id:string;name:string;uploaded_by:string};

/** Validate the selected file and use stored metadata, never the browser's filename. */
export async function loadAuthorizedVisitAttachment(c:Context,customerId:string,fileId:string):Promise<VisitAttachment>{
 const file=await c.db.prepare('SELECT id,customer_id,name,uploaded_by FROM crm_visit_files WHERE id=?').bind(fileId).first<VisitAttachment>();
 if(!file||file.customer_id!==customerId||!canAccessVisitFile(c,file))throw new CRMError('ملف المنافس لا يتبع هذا العميل',403);
 return file;
}

/**
 * Freeze the attachment's authorization dependencies in the contact's transaction.
 * Callers combine this with their existing customer, session and mutation guards.
 * A visible activity can grant access independently of the uploader's team.
 */
export function visitAttachmentWriteGuard(c:Context,file:VisitAttachment){
 let sql='EXISTS (SELECT 1 FROM crm_visit_files WHERE id=? AND customer_id=? AND uploaded_by=?)';
 const args:(string|number)[]=[file.id,file.customer_id,file.uploaded_by];
 const uploader=c.members.find(member=>member.id===file.uploaded_by);
 if(c.me.role!=='admin'&&uploader&&salesScopeMemberIds(c.members,c.me).has(uploader.id)){
  sql+=" AND EXISTS (SELECT 1 FROM crm_members WHERE id=? AND role=? AND COALESCE(supervisor_id,'')=?)";
  args.push(uploader.id,uploader.role,uploader.supervisorId||'');
 }else if(c.me.role!=='admin'){
  const linked=c.visible.find(record=>record.kind==='activity'&&record.data.competitorFileId===file.id);
  const original=linked?c.all.find(record=>record.id===linked.id):undefined;
  if(!original)throw new CRMError('الملف غير متاح',403);
  const permission=accessGuard(c,original);
  sql+=' AND '+permission.sql;args.push(...permission.args);
 }
 return {sql,args};
}

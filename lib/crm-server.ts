import {readCustomerIdentityState} from './customer-identity-store';
import type {CustomerIdentityState} from './customer-identity';
import {RequestBodyError,readRequestText} from './request-body';
import {isServiceRole} from './customer-service';
import { env } from 'cloudflare:workers';
import {getApplicationUser} from '@/app/application-auth';
import {regionRecords,regionMembers,regionScope,memberCanAccessRegion} from './regions';
import {canReadSalesRecord,canUseSalesWorkspace,recordAuthorId,canManageMasterRecord,canEditCustomerDetails} from './access';
import { scopeRecords, type Row, type Member } from './crm';
import {loadContextRecords,type ContextLoad} from './crm-context-records';
export class CRMError extends Error { constructor(message:string,public status=400){super(message);} }
export function database(){if(!env.DB)throw new CRMError('تعذر الاتصال بقاعدة البيانات. أعد المحاولة.',503);return env.DB;}
export async function context(options:ContextLoad={}){
 const user=await getApplicationUser();if(!user)throw new CRMError('سجّل الدخول للوصول إلى التطبيق.',401);
 const db=database();
 const members=(await db.prepare('SELECT id,user_id AS userId,email,name,role,branch,supervisor_id AS supervisorId,region_scope AS regionScope,auth_version AS authVersion,active,target FROM crm_members').all<Member>()).results;
 const me=members.find(m=>m.id===user.memberId);
 if(!me||!me.active||me.authVersion!==user.memberVersion)throw new CRMError('حسابك غير مضاف إلى فريق يورست. تواصل مع مدير النظام.',403);
 let customerIdentityState:CustomerIdentityState={revision:0,mappings:[]};
 if(!['identity','mobile','customer-graph','directory'].includes(options.load||'')){const state=await readCustomerIdentityState(db);if(!state)throw new CRMError('تحديث أكواد العملاء غير مكتمل.',503);customerIdentityState=state;}
 const {all,serviceCases}=await loadContextRecords(db,me,options,members),regionalRecords=regionRecords(all,me),regionalMembers=regionMembers(members,me),regionCustomerIds=new Set(regionalRecords.filter(r=>r.kind==='customer').map(r=>r.id));return{db,user,me,members,all,serviceCases,customerIdentityState,regionalRecords,regionalMembers,regionCustomerIds,visible:scopeRecords(regionalRecords,members,me)};
}
export function replyError(error:unknown){if(error instanceof CRMError||error instanceof RequestBodyError)return Response.json({error:error.message},{status:error.status,...(error instanceof RequestBodyError?{headers:{'Cache-Control':'no-store','Connection':'close'}}:{})});console.error('CRM request failed',error);return Response.json({error:'تعذر إتمام العملية. بياناتك المدخلة لم تُمسح؛ حاول مرة أخرى.'},{status:500});}
export function checkOrigin(req:Request){const origin=req.headers.get('origin');if(!env.YR_APP_ORIGIN||origin!==env.YR_APP_ORIGIN||req.headers.get('sec-fetch-site')==='cross-site')throw new CRMError('طلب غير مسموح',403);}
/** Reject anonymous callers before any request body is read or validated, so they always receive 401 rather than a validation error. */
export async function requireSession(){if(!await getApplicationUser())throw new CRMError('سجّل الدخول للوصول إلى التطبيق.',401);}

type GuardContext={me:Member;members:Member[];all:Row[]};
function recordCustomer(c:GuardContext,record:Row){const indexed=new Map(c.all.map(r=>[r.id,r])),seen=new Set<string>();let root:Row|undefined=record;while(root&&root.kind!=='customer'&&!seen.has(root.id)){seen.add(root.id);root=root.parentId?indexed.get(root.parentId):undefined;}return root?.kind==='customer'?root:undefined;}
export function assertRecordMutation(c:GuardContext,record:Row){
 const root=recordCustomer(c,record);
 const serviceCustomer=record.kind==='customer'&&isServiceRole(c.me.role)&&record.branch===c.me.branch;
 if(!root||!memberCanAccessRegion(c.me,root.data.region)||!serviceCustomer&&!canReadSalesRecord(record,c.members,c.me))throw new CRMError('السجل خارج نطاق صلاحيتك',403);
}
/** Appending a contact is allowed for reps; rewriting/deleting saved records is not. */
export function requireRecordEdit(me:Member){if(me.role==='rep')throw new CRMError('تعديل السجلات وحذفها متاح للإدارة فقط. يمكنك تسجيل زيارة أو متابعة جديدة.',403);}
/** accessGuard also rechecks the same role/auth version at commit, preventing a racing demotion. */
export function recordEditGuard(c:GuardContext,record:Row){requireRecordEdit(c.me);return accessGuard(c,record);}
/** Master edits need team ownership in addition to the regional visit-selection scope. */
export function masterMutationGuard(c:GuardContext,record:Row){
 if(!canManageMasterRecord(record,c.members,c.me))throw new CRMError('تعديل بيانات العميل متاح للمسؤول وفريقه فقط',403);
 if(c.me.role==='rep'&&record.kind==='customer')return accessGuard(c,record);
 const permission=recordEditGuard(c,record);
 if(c.me.role!=='admin'&&record.assignedTo!==c.me.id){
  if(c.me.role==='supervisor'){permission.sql+=" AND EXISTS (SELECT 1 FROM crm_members WHERE id=? AND role='rep' AND supervisor_id=?)";permission.args.push(record.assignedTo,c.me.id);}
  else{permission.sql+=" AND EXISTS (SELECT 1 FROM crm_members WHERE id=? AND role IN ('rep','supervisor'))";permission.args.push(record.assignedTo);}
 }
 return permission;
}
/** Unchanged customer routing can be retained even when its old assignee is no longer eligible. */
export function customerDetailMutationGuard(c:GuardContext,record:Row){
 if(!canEditCustomerDetails(record,c.members,c.me))throw new CRMError('تعديل بيانات العميل متاح للمسؤول وفريقه فقط',403);
 return c.me.role==='manager'?accessGuard(c,record):masterMutationGuard(c,record);
}
/** Recheck identity, region-bearing root, and source-author reporting line at commit. */
export function accessGuard(c:GuardContext,record?:Row|null){
 let sql="EXISTS (SELECT 1 FROM crm_members WHERE id=? AND active=1 AND role=? AND branch=? AND COALESCE(supervisor_id,'')=? AND region_scope=? AND auth_version=?)";
 const args:(string|number)[]=[c.me.id,c.me.role,c.me.branch,c.me.supervisorId||'',regionScope(c.me),c.me.authVersion||0];
 if(record){
  assertRecordMutation(c,record);const root=recordCustomer(c,record)!;
  sql+=" AND EXISTS (SELECT 1 FROM crm_records WHERE id=? AND kind='customer' AND version=?)";args.push(root.id,root.version);
  if(record.id!==root.id){sql+=' AND EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=?)';args.push(record.id,record.version);}
  if(!['customer','factory'].includes(record.kind)&&c.me.role!=='admin'){
   const author=recordAuthorId(record,c.members)!;
   if(author!==c.me.id){
    if(c.me.role==='supervisor'){sql+=" AND EXISTS (SELECT 1 FROM crm_members WHERE id=? AND role='rep' AND supervisor_id=?)";args.push(author,c.me.id);}
    else if(c.me.role==='manager'){sql+=" AND EXISTS (SELECT 1 FROM crm_members WHERE id=? AND role IN ('supervisor','rep'))";args.push(author);}
   }
  }
 }
 return{sql,args};
}
export function requireSalesWorkspace(me:Member){if(!canUseSalesWorkspace(me.role))throw new CRMError('هذه الصفحة متاحة للمشرف ومدير المبيعات فقط',403);}

export function requireSalesRole(me:Member){if(isServiceRole(me.role))throw new CRMError('هذا الإجراء متاح لفريق المبيعات فقط',403);}

/** Reject broken or non-object JSON before route handlers read its fields. */
export function parseJsonBody(text:string):Record<string,any>{let body:any;try{body=JSON.parse(text);}catch{throw new CRMError('صيغة البيانات غير صحيحة. أعد المحاولة.');}if(!body||typeof body!=='object'||Array.isArray(body))throw new CRMError('صيغة البيانات غير صحيحة. أعد المحاولة.');return body;}
export async function readJsonBody(req:Request){return parseJsonBody(await readRequestText(req));}

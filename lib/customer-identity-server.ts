import {z} from 'zod';
import {accessGuard,CRMError,type context} from './crm-server';
import {regionScope} from './regions';
import {customerCodeKey,customerCodeCandidates,customerErpCodes} from './customer-identity';

type Context=Awaited<ReturnType<typeof context>>;
export function requireIdentityAdmin(c:Context){if(c.me.role!=='admin'||regionScope(c.me)!=='all')throw new CRMError('ربط أكواد العملاء متاح لمدير النظام فقط.',403);}
export async function customerIdentityOptions(c:Context){
 requireIdentityAdmin(c);
 const state=c.customerIdentityState,candidates=customerCodeCandidates(c.all),raw=new Map<string,Set<string>>();
 for(const customer of c.all.filter(row=>row.kind==='customer'))for(const code of customerErpCodes(customer)){const key=customerCodeKey(code),values=raw.get(key)||new Set<string>();values.add(code);raw.set(key,values);}
 const external=await c.db.prepare('SELECT DISTINCT customer_code FROM crm_erp_sales').all<{customer_code:string}>();
 for(const row of external.results){const key=customerCodeKey(row.customer_code);if(!key)continue;const values=raw.get(key)||new Set<string>();values.add(row.customer_code);raw.set(key,values);}
 const mappings=new Map(state.mappings.map(mapping=>[mapping.codeKey,mapping]));
 const identities=[...raw.keys()].sort().map(codeKey=>{const customerIds=(candidates.get(codeKey)||[]).map(row=>row.id),mapping=mappings.get(codeKey);return{codeKey,sourceCodes:[...raw.get(codeKey)!].sort(),customerIds,mappedCustomerId:mapping?.customerId||'',mappingVersion:mapping?.version||0,status:mapping?'mapped':customerIds.length===1?'unique':customerIds.length?'ambiguous':'unmatched'};});
 const guard=accessGuard(c),fresh=await c.db.prepare("SELECT 1 AS allowed WHERE EXISTS(SELECT 1 FROM crm_customer_identity_state WHERE id='company' AND revision=?) AND "+guard.sql).bind(state.revision,...guard.args).first();
 if(!fresh)throw new CRMError('تغيّرت بيانات الربط أو الصلاحيات. حدّث الصفحة.',409);
 return{revision:state.revision,customers:c.all.filter(row=>row.kind==='customer').map(row=>({id:row.id,name:String(row.data.name||''),internalCode:String(row.data.internalCode||''),erpCode:String(row.data.code||''),region:String(row.data.region||''),version:row.version})),identities};
}
const inputSchema=z.object({codeKey:z.string().min(1).max(6000),customerId:z.string().max(200),version:z.number().int().nonnegative(),revision:z.number().int().nonnegative(),customerVersion:z.number().int().nonnegative(),requestId:z.string().uuid()}).strict();
export async function saveCustomerIdentity(c:Context,body:unknown){
 requireIdentityAdmin(c);const input=inputSchema.parse(body),codeKey=customerCodeKey(input.codeKey);if(!codeKey)throw new CRMError('حدد كود العميل في ERP.');
 const canonical=JSON.stringify({...input,codeKey,requestId:undefined}),receipt='customer-identity:'+c.me.id+':'+input.requestId;
 const replay=async()=>{const row=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receipt).first<{detail:string}>();if(!row)return false;if(row.detail!==canonical)throw new CRMError('الطلب محفوظ ببيانات مختلفة. حدّث الصفحة.',409);return true;};
 if(await replay())return{ok:true,alreadySaved:true};
 const state=c.customerIdentityState,old=state.mappings.find(row=>row.codeKey===codeKey),customer=c.all.find(row=>row.kind==='customer'&&row.id===input.customerId);
 const conflict=()=>new CRMError('تغيّرت بيانات العميل أو الربط أو الصلاحيات. حدّث الصفحة.',409);
 if(state.revision!==input.revision||(old?.version||0)!==input.version)throw conflict();
 if(input.customerId&&(!customer||customer.version!==input.customerVersion))throw conflict();
 if(input.customerId&&!(customerCodeCandidates(c.all).get(codeKey)||[]).some(row=>row.id===input.customerId))throw new CRMError('اختر مصنعًا مرتبطًا بهذا الكود في المصدر؛ لا يمكن تخمين صاحب الفاتورة.');
 if(!input.customerId&&!old)throw new CRMError('لا يوجد ربط محفوظ لإزالته.');
 const permission=accessGuard(c),args:(string|number)[]=[state.revision,...permission.args];
 let gate="EXISTS(SELECT 1 FROM crm_customer_identity_state WHERE id='company' AND revision=?) AND "+permission.sql;
 if(customer){gate+=" AND EXISTS(SELECT 1 FROM crm_records WHERE id=? AND kind='customer' AND version=? AND CAST(COALESCE(json_extract(data,'$.region'),'') AS TEXT)=?)";args.push(customer.id,customer.version,String(customer.data.region||''));}
 if(old){gate+=' AND EXISTS(SELECT 1 FROM crm_customer_code_mappings WHERE code_key=? AND version=?)';args.push(codeKey,old.version);}else{gate+=' AND NOT EXISTS(SELECT 1 FROM crm_customer_code_mappings WHERE code_key=?)';args.push(codeKey);}
 const now=new Date().toISOString(),claim=c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+gate).bind(receipt,customer?.id||old!.customerId,c.me.name,'ربط كود عميل ERP',canonical,now,...args);
 // Only this attempt's newly claimed receipt may authorize the following write.
 const claimed='changes()=1';
 const write=!input.customerId?c.db.prepare('DELETE FROM crm_customer_code_mappings WHERE code_key=? AND '+claimed).bind(codeKey):old?c.db.prepare('UPDATE crm_customer_code_mappings SET customer_id=?,version=version+1,updated_by=?,updated_at=? WHERE code_key=? AND '+claimed).bind(customer!.id,c.me.id,now,codeKey):c.db.prepare('INSERT INTO crm_customer_code_mappings(code_key,customer_id,version,updated_by,updated_at) SELECT ?,?,1,?,? WHERE '+claimed).bind(codeKey,customer!.id,c.me.id,now);
 const result=await c.db.batch([claim,write]);if(result[0].meta.changes!==1){if(await replay())return{ok:true,alreadySaved:true};throw conflict();}
 return{ok:true};
}

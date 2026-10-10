import type {CustomerIdentityState} from './customer-identity';

/** One SQL snapshot: a mapping change cannot sit between revision and row reads. */
export async function readCustomerIdentityState(db:D1Database):Promise<CustomerIdentityState|null>{
 const {results}=await db.prepare(`SELECT state.revision,mapping.code_key AS codeKey,mapping.customer_id AS customerId,mapping.version
  FROM crm_customer_identity_state state LEFT JOIN crm_customer_code_mappings mapping ON 1=1
  WHERE state.id='company' ORDER BY mapping.code_key`).all<{revision:number;codeKey:string|null;customerId:string|null;version:number|null}>();
 if(!results.length)return null;
 return{revision:results[0].revision,mappings:results.filter(row=>row.codeKey!==null).map(row=>({codeKey:row.codeKey!,customerId:row.customerId!,version:row.version!}))};
}

import {context,CRMError,accessGuard} from './crm-server';
import {monthSchema} from './sales';
import {activityTargetsSchema,defaultActivityTargets,quantityTargetsSchema,targetProducts} from './targets';
import {type OwnTargets} from './own-targets';
import {riyadhDate} from './visits';
import {memberCanAccessRegion} from './regions';
import {readOwnErpSales} from './erp-sales-server';

type Context=Awaited<ReturnType<typeof context>>;
type TargetRow={kind:'sales'|'activity';month:string;data:string};
type OwnQuantityRow={product:string;quantity:number;region:unknown};
const roundQuantity=(value:number)=>Math.round(value*1000000)/1000000;

async function ownManualQuantities(c:Context,month:string){
 const [year,number]=month.split('-').map(Number);
 const next=number===12?`${year+1}-01`:`${year}-${String(number+1).padStart(2,'0')}`;
 // The identity-only context deliberately has no customer directory. Join just the
 // caller's confirmed monthly rows and select quantities + the territory check.
 const rows=(await c.db.prepare(`SELECT json_extract(i.value,'$.product') AS product,
  json_extract(i.value,'$.quantity') AS quantity,json_extract(c.data,'$.region') AS region
  FROM crm_sales s JOIN crm_records c ON c.id=s.customer_id AND c.kind='customer',json_each(s.data,'$.items') i
  WHERE s.rep_id=? AND s.date>=? AND s.date<? AND s.status='confirmed'`)
  .bind(c.me.id,month+'-01',next+'-01').all<OwnQuantityRow>()).results;
 return rows.filter(row=>memberCanAccessRegion(c.me,row.region));
}

export function ownTargetsMonth(req:Request){
 const params=new URL(req.url).searchParams;
 if(Array.from(params.keys()).some(key=>key!=='month')||params.getAll('month').length>1)throw new CRMError('حدد الشهر فقط لعرض مستهدفك.',400);
 return monthSchema.parse(params.get('month')??riyadhDate(new Date().toISOString()).slice(0,7));
}

export async function ownTargets(c:Context,month:string):Promise<OwnTargets>{
 if(c.me.role!=='rep')throw new CRMError('عرض المستهدف الشخصي متاح للمندوب فقط.',403);
 const selectedMonth=monthSchema.parse(month);
 // Bind identity from the authenticated context. Never load company, branch or team rows.
 const rows=(await c.db.prepare("SELECT kind,month,data FROM crm_target_sets WHERE scope_id=? AND kind IN ('sales','activity') AND month<=? ORDER BY month DESC")
  .bind(c.me.id,selectedMonth).all<TargetRow>()).results;
 const salesRow=rows.find(row=>row.kind==='sales'),activityRow=rows.find(row=>row.kind==='activity');
 const sales=salesRow?quantityTargetsSchema.parse(JSON.parse(salesRow.data)):null;
 const activity=activityRow?activityTargetsSchema.parse(JSON.parse(activityRow.data)):defaultActivityTargets;
 const actualsAvailable=selectedMonth<=riyadhDate(new Date().toISOString()).slice(0,7);
 const quantities=new Map<string,number>();
 if(actualsAvailable){
  const [manual,imported]=await Promise.all([ownManualQuantities(c,selectedMonth),readOwnErpSales(c,selectedMonth)]);
  for(const row of [...manual,...imported.flatMap(sale=>sale.items)]){
   if(targetProducts.some(product=>product.id===row.product)&&Number.isFinite(row.quantity))quantities.set(row.product,(quantities.get(row.product)||0)+row.quantity);
  }
 }
 // Do not deliver a read captured before an account, region or role was revoked.
 const guard=accessGuard(c);
 const current=await c.db.prepare('SELECT 1 AS allowed WHERE '+guard.sql).bind(...guard.args).first<{allowed:number}>();
 if(!current)throw new CRMError('تغيّرت صلاحيات حسابك. أعد تسجيل الدخول.',403);
 return{
  month:selectedMonth,
  member:{id:c.me.id,name:c.me.name},
  sales:{products:targetProducts.map(product=>{
   const quantity=sales?.products.find(row=>row.product===product.id)?.quantity??null;
   const actualQuantity=actualsAvailable?roundQuantity(quantities.get(product.id)||0):null;
   return{product:product.id,quantity,actualQuantity,
    remainingQuantity:quantity!==null&&actualQuantity!==null?roundQuantity(Math.max(0,quantity-actualQuantity)):null,
    achievement:quantity!==null&&quantity>0&&actualQuantity!==null?Math.round(actualQuantity/quantity*10000)/100:null};
  }),sourceMonth:salesRow?.month??null,actualsAvailable},
  activity:{newCustomers:activity.newCustomers,recoveredCustomers:activity.recoveredCustomers,visits:activity.visits,sourceMonth:activityRow?.month??null,isDefault:!activityRow},
 };
}

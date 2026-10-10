import type {Row} from './crm';

export type MapActivityKey = 'active' | 'partial' | 'inactive' | 'unknown';
export type MapActivityCategory = Readonly<{
 key:MapActivityKey;
 labelAr:string;
 labelEn:string;
 color:string;
}>;

/** Customer dealing/activity status, as recorded on the customer card.
 * This is independent of visit strength, sales stage, and time since last contact.
 */
export const activityOptions:readonly MapActivityCategory[] = [
 {key:'active',labelAr:'نشط',labelEn:'Active',color:'#16815d'},
 {key:'partial',labelAr:'نصف نشط',labelEn:'Semi-active',color:'#c48019'},
 {key:'inactive',labelAr:'خامل',labelEn:'Inactive',color:'#b65555'},
 {key:'unknown',labelAr:'غير محدد',labelEn:'Unspecified',color:'#697586'},
];
export const activityCategories = activityOptions;

const keys:Record<string,MapActivityKey> = {
 'نشط':'active','نصف نشط':'partial','خامل':'inactive',
 'active':'active','semi-active':'partial','semi active':'partial','inactive':'inactive',
};
const categories = new Map(activityOptions.map(category=>[category.key,category]));

/** Accept only the already authorized customer row. Unknown nonempty labels are
 * preserved for display and share the Unspecified filter; they are never guessed.
 */
export function mapActivity(customer:Pick<Row,'data'>):MapActivityCategory & {rawLabel:string} {
 const status=customer.data?.customerStatus;
 const rawLabel=typeof status==='string'?status.trim():'';
 const normalized=rawLabel.normalize('NFC').replace(/\s+/g,' ').toLowerCase();
 const key=Object.hasOwn(keys,normalized)?keys[normalized]:'unknown';
 return {...categories.get(key)!,rawLabel};
}
export const customerMapActivity = mapActivity;

/** Summarize only the supplied colocated, authorized customers in one pass.
 * Keep the per-category counts so a mixed marker can show every status color.
 */
export function groupMapActivities(customers:readonly Pick<Row,'data'>[]) {
 const values=new Map<MapActivityKey,number>();
 for(const customer of customers){const {key}=mapActivity(customer);values.set(key,(values.get(key)||0)+1);}
 const counts=activityOptions.filter(category=>values.has(category.key)).map(category=>({...category,count:values.get(category.key)!}));
 const key:MapActivityKey|'mixed'=counts.length>1?'mixed':counts[0]?.key||'unknown';
 return {key,color:key==='mixed'?'#6554a4':categories.get(key)!.color,counts,total:customers.length};
}

import type {ErpCustomerExtras,ErpExtraUpdate} from './erp-customer-extras';

/** The audit label of a customer whose ERP creation date or representative the ERP customers import wrote. */
export const ERP_EXTRA_AUDIT_LABEL='تحديث تاريخ الإنشاء أو المندوب في ERP من ملف ERP';
/** What the preview and the apply say about «التاريخ» and the representative's column (app/erp-customer-dates-note.tsx shows it). */
export type ErpDatesView={dateColumn:boolean;dates:number;invalidDates:number;repColumn:boolean;reps:number;updates:number};
export const erpDatesView=(extras:ErpCustomerExtras,updates:ErpExtraUpdate[]):ErpDatesView=>({dateColumn:extras.dateColumn,dates:extras.dates,invalidDates:extras.invalidDates,repColumn:extras.repColumn,reps:extras.reps,updates:updates.length});
/** The statements of the apply's transaction (lib/erp-customers-server.ts) for these updates, each under the attempt's receipt (`claimed`):
 * the fields set with json_set, the record's version moved once (not again when the code change of the same attempt already moved it),
 * and one 'erp-customer-fields' audit entry {label, row, from, to}. The gate of the receipt already holds each customer's version. */
export function erpExtraStatements(db:D1Database,updates:ErpExtraUpdate[],actor:string,now:string,attempt:string,claimed:string,claimArgs:string[]):D1PreparedStatement[]{
 const statements:D1PreparedStatement[]=[];
 for(const update of updates){
  const paths:string[]=[],args:string[]=[];
  if(update.set.erpCreatedAt){paths.push("'$.erpCreatedAt',?");args.push(update.set.erpCreatedAt);}
  if(update.set.erpRep){paths.push("'$.erpRep',json(?)");args.push(JSON.stringify(update.set.erpRep));}
  if(!paths.length)continue;
  statements.push(db.prepare(`UPDATE crm_records SET data=json_set(data,${paths.join(',')}),updated_at=?,version=CASE WHEN mutation_id=? THEN version ELSE version+1 END,mutation_id=? WHERE id=? AND kind='customer' AND (version=? OR mutation_id=?) AND `+claimed)
   .bind(...args,now,attempt,attempt,update.customerId,update.version,attempt,...claimArgs));
  statements.push(db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE '+claimed)
   .bind(crypto.randomUUID(),update.customerId,actor,'erp-customer-fields',JSON.stringify({label:ERP_EXTRA_AUDIT_LABEL,row:update.row,from:update.from,to:update.set}),now,...claimArgs));
 }
 return statements;
}

import {z} from 'zod';

/** «اكتمال سجل المبيعات» from the ERP sales imports (the owner, 2026-11-12: «اعمل الاتنين», after the reference CRM's complete_snapshot).
 *
 *  An import whose uploader ticks «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها» records one coverage entry in its own row of
 *  crm_erp_imports (result.coverage: no migration): the days it covers (from its first to its last invoice date, which the uploader may
 *  widen to the first day of the file's first month and the last day of its last month, never beyond today), the representatives it
 *  speaks for (those the uploader may import for, less any whose document was skipped as outside the uploader's access; allReps when the
 *  uploader's scope held every active representative and nothing was skipped, so a representative added later is covered too), who, when
 *  and which import. Entries are never changed or deleted: a later complete import adds its days, so coverage only grows.
 *
 *  A day is covered for a representative when an entry for them includes it; a month is covered when every one of its days is (the
 *  month in progress: from its first day on, the indicators reading what was imported «حتى» the last covered day). A month only partly
 *  in a file (it starts on the 15th, or ends on the 28th) is covered only when another complete import covers the rest: the file says
 *  nothing about the days outside it. Within a covered month a representative or a product with no sale sold nothing (a real zero).
 *
 *  Pure: lib/erp-sales-server.ts writes the entries, lib/kpis-server.ts and lib/kpi-evidence-server.ts read them, lib/kpis.ts decides. */

const day=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const monthText=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const salesCoverageEntrySchema=z.object({
 complete:z.literal(true),from:day,to:day,months:z.array(monthText).max(240),partialMonths:z.array(monthText).max(240),
 repIds:z.array(z.string().min(1).max(200)).max(5000),allReps:z.boolean(),importerId:z.string().max(200),importer:z.string().max(300),at:z.string().max(40),importId:z.string().max(300)
}).refine(entry=>entry.from<=entry.to);
export type SalesCoverageEntry=z.infer<typeof salesCoverageEntrySchema>;
/** The months a KPI still needs, and the month before which one older complete month is needed (recovered customers). uploadOnly: only an
 *  ERP upload can give them (the customers' comparison reaches past the three months «بيانات المؤشرات» confirms, lib/kpi-baseline.ts), so
 *  the sentence does not offer the manual confirmation. */
export type CoverageMissing={months:string[];olderThan:string|null;uploadOnly?:true};
/** How far back the customers' comparison looks (lib/kpi-baseline.ts CUSTOMER_LOOKBACK_MONTHS) and the months before it read for an earlier
 *  worked month (recovered customers): the lookback window of SalesCoverageStatus. */
export const COVERAGE_LOOKBACK_MONTHS=16;
export type SalesCoverageStatus={
 /** The evaluation month: whole (a finished month), or from its first day (the month in progress). */
 current:boolean;
 /** The last covered day of the evaluation month for every representative of the scope (null: not covered). */
 through:string|null;
 /** «نمو مبيعات الأصناف»: the month and the comparison days of the month before. */
 growth:boolean;
 /** «الحفاظ على العملاء الحاليين»: the month and the three months before it. */
 retention:boolean;
 /** «العملاء المستردون»: as retention, and one whole complete month before those three. */
 recovered:boolean;
 missing:{growth:CoverageMissing;retention:CoverageMissing;recovered:CoverageMissing};
 /** For the customers' comparison over the months worked (lib/kpi-baseline.ts, GSCO 2.13.50): of the COVERAGE_LOOKBACK_MONTHS months before
  *  the evaluation month, those every representative of the scope has wholly covered (whole) and those each has at least one covered day
  *  of (touched), oldest first; firstWhole: the month from which every representative has a whole covered month (each one's first whole
  *  covered month, the latest of them), null when one has none. */
 lookback:{whole:string[];touched:string[];firstWhole:string|null};
};

const pad=(n:number)=>String(n).padStart(2,'0');
export function monthEnd(month:string){const days=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();return month+'-'+pad(days);}
export function addMonths(month:string,count:number){const d=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1+count,1));return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1);}
export function nextDay(date:string){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}

/** The days a file speaks for by default (its first and last invoice), and how far the uploader may widen them. */
export function filePeriod(dates:string[],todayDay:string){
 const sorted=dates.filter(date=>day.safeParse(date).success).sort();
 if(!sorted.length)return null;
 const first=sorted[0],last=sorted[sorted.length-1],end=monthEnd(last.slice(0,7));
 return {first,last,minFrom:first.slice(0,7)+'-01',maxTo:end<todayDay?end:todayDay};
}
/** The checked period of a complete import, or the reason it is refused. */
export function coveragePeriod(file:NonNullable<ReturnType<typeof filePeriod>>,from:string|undefined,to:string|undefined):{from:string;to:string}|{error:string}{
 const start=from||file.first,end=to||file.last;
 if(!day.safeParse(start).success||!day.safeParse(end).success)return {error:'اكتب تاريخي بداية فترة الاكتمال ونهايتها بصيغة صحيحة.'};
 if(start>file.first||end<file.last)return {error:'فترة الاكتمال يجب أن تشمل كل تواريخ فواتير الملف.'};
 if(start<file.minFrom||end>file.maxTo)return {error:'فترة الاكتمال لا تتجاوز أول يوم في الشهر الأول للملف، ولا آخر يوم في شهره الأخير، ولا تاريخ اليوم.'};
 return {from:start,to:end};
}
/** The calendar months a period covers whole, and those it covers only in part. */
export function periodMonths(from:string,to:string){
 const full:string[]=[],partial:string[]=[];
 for(let month=from.slice(0,7);month<=to.slice(0,7)&&full.length+partial.length<240;month=addMonths(month,1))(from<=month+'-01'&&to>=monthEnd(month)?full:partial).push(month);
 return {full,partial};
}
/** One representative's covered days, merged (touching ranges joined). */
export function coveredRanges(entries:SalesCoverageEntry[],repId:string){
 const ranges=entries.filter(entry=>entry.allReps||entry.repIds.includes(repId)).map(entry=>({from:entry.from,to:entry.to})).sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
 const merged:{from:string;to:string}[]=[];
 for(const range of ranges){const last=merged[merged.length-1];if(last&&range.from<=nextDay(last.to)){if(range.to>last.to)last.to=range.to;}else merged.push({...range});}
 return merged;
}
const covers=(ranges:{from:string;to:string}[],from:string,to:string)=>ranges.some(range=>range.from<=from&&range.to>=to);

/** What the sales-history coverage gives the KPIs of a scope (a representative, or a team: every member must be covered) for a month.
 *  period: lib/kpis.ts kpiPeriod(month) (first day, cutoff, and the comparison days of the month before). */
export function salesCoverageStatus(entries:SalesCoverageEntry[],repIds:string[],month:string,period:{first:string;cutoff:string;previousFirst:string;previousEnd:string}):SalesCoverageStatus{
 const end=monthEnd(month),inProgress=period.cutoff<end,windowFirst=addMonths(month,-3),growthMonths=new Set<string>(),retentionMonths=new Set<string>();
 let current=repIds.length>0,growth=current,retention=current,older=current,through:string|null=current?period.cutoff:null,needOlder=false;
 const lookbackMonths=Array.from({length:COVERAGE_LOOKBACK_MONTHS},(_,n)=>addMonths(month,-(n+1)));
 let whole=null as Set<string>|null,touched=null as Set<string>|null,firstWhole=null as string|null,someWithout=!repIds.length;
 for(const repId of repIds){
  const ranges=coveredRanges(entries,repId);
  const repWhole=new Set(lookbackMonths.filter(m=>covers(ranges,m+'-01',monthEnd(m)))),repTouched=new Set(lookbackMonths.filter(m=>ranges.some(range=>range.from<=monthEnd(m)&&range.to>=m+'-01')));
  const keep=(set:Set<string>|null,rep:Set<string>)=>set?new Set([...set].filter(m=>rep.has(m))):rep;
  whole=keep(whole,repWhole);touched=keep(touched,repTouched);
  const repFirst=ranges.map(range=>range.from.endsWith('-01')?range.from.slice(0,7):addMonths(range.from.slice(0,7),1)).filter((startMonth,i)=>monthEnd(startMonth)<=ranges[i].to).sort()[0];
  if(!repFirst)someWithout=true;else if(!firstWhole||repFirst>firstWhole)firstWhole=repFirst;
  const now=inProgress?ranges.find(range=>range.from<=period.first&&range.to>=period.first):ranges.find(range=>range.from<=period.first&&range.to>=period.cutoff);
  if(!now){current=false;growthMonths.add(month);retentionMonths.add(month);through=null;}
  else if(through!==null){const last=now.to<period.cutoff?now.to:period.cutoff;if(last<through)through=last;}
  if(!covers(ranges,period.previousFirst,period.previousEnd)){growth=false;growthMonths.add(period.previousFirst.slice(0,7));}
  for(let n=3;n>=1;n--){const m=addMonths(month,-n);if(!covers(ranges,m+'-01',monthEnd(m))){retention=false;retentionMonths.add(m);}}
  // One whole complete month before the three months: the old purchase that makes a returning customer «مستردًا».
  const hasOlder=ranges.some(range=>{const startMonth=range.from.endsWith('-01')?range.from.slice(0,7):addMonths(range.from.slice(0,7),1);return startMonth<windowFirst&&monthEnd(startMonth)<=range.to;});
  if(!hasOlder){older=false;needOlder=true;}
 }
 growth=growth&&current;retention=retention&&current;
 const sorted=(set:Set<string>)=>[...set].sort();
 return {current,through:current?through:null,growth,retention,recovered:retention&&older,
  missing:{growth:{months:sorted(growthMonths),olderThan:null},retention:{months:sorted(retentionMonths),olderThan:null},recovered:{months:sorted(retentionMonths),olderThan:needOlder||!repIds.length?windowFirst:null}},
  lookback:{whole:sorted(whole||new Set()),touched:sorted(touched||new Set()),firstWhole:someWithout?null:firstWhole}};
}

const arabicMonths=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const englishMonths=['January','February','March','April','May','June','July','August','September','October','November','December'];
export function monthLabel(month:string,language:'ar'|'en'='ar'){return (language==='en'?englishMonths:arabicMonths)[Number(month.slice(5,7))-1]+' '+month.slice(0,4);}
function list(items:string[],language:'ar'|'en'){if(items.length<2)return items.join('');return language==='en'?items.slice(0,-1).join(', ')+' and '+items[items.length-1]:items.slice(0,-1).join('، ')+' و'+items[items.length-1];}
/** Months named in a sentence of the reader's language: «يونيو 2026، يوليو 2026 وسبتمبر 2026», "June 2026, July 2026 and September 2026". */
export const monthList=(months:string[],language:'ar'|'en'='ar')=>list(months.map(month=>monthLabel(month,language)),language);
/** The sentence a KPI shows while the sales history is not covered: the months to upload, named (the owner's example: «يلزم رفع مبيعات
 *  ERP كاملة لشهر أغسطس 2026»), then the two ways to complete it. The English is built here too (the dictionary cannot translate names). */
export function coverageReason(missing:CoverageMissing,language:'ar'|'en'='ar'){
 const months=missing.months.map(month=>monthLabel(month,language)),parts:string[]=[];
 if(language==='en'){
  if(months.length)parts.push('Upload complete ERP sales for '+list(months,language)+'.');
  if(missing.olderThan)parts.push('Upload complete ERP sales for at least one month before '+monthLabel(missing.olderThan,language)+' to show earlier purchases.');
  parts.push(missing.uploadOnly?'Tick “The file includes all reps’ sales for the period it covers” when importing.':'Tick “The file includes all reps’ sales for the period it covers” when importing, or confirm the sales history manually in the KPI evidence.');
 }else{
  if(months.length)parts.push('يلزم رفع مبيعات ERP كاملة '+(months.length===1?'لشهر ':'لأشهر ')+list(months,language)+'.');
  if(missing.olderThan)parts.push('يلزم رفع مبيعات ERP كاملة لشهر واحد على الأقل قبل '+monthLabel(missing.olderThan,language)+' لإثبات الشراء القديم.');
  parts.push(missing.uploadOnly?'حدّد «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها» عند الرفع.':'حدّد «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها» عند الرفع، أو أكّد اكتمال السجل يدويًا في «بيانات المؤشرات».');
 }
 return parts.join(' ');
}

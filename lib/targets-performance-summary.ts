import {operationalIndicators,type KpiPerson,type KpiMetric} from './kpis';

export type SummaryPerson=Pick<KpiPerson,'member'|'attainment'|'teamRollup'> & Partial<Pick<KpiPerson,'metrics'|'summary'>>;

/** Quantities remain separate by product. Unknown input never becomes a zero. */
export function remainingTarget(target:number|null|undefined,actual:number|null|undefined):number|null{
 if(typeof target!=='number'||typeof actual!=='number'||!Number.isFinite(target)||!Number.isFinite(actual)||target<0)return null;
 // Returns can make net actuals negative and increase the remaining quantity.
 return Math.round((Math.max(target-actual,0)+Number.EPSILON)*1_000_000)/1_000_000;
}
/** A product's achievement as the card writes it beside the gauge: two decimals (54.55, not 54.545455), unknown stays unknown. */
export function shownAchievement(value:number|null|undefined):number|null{
 return typeof value==='number'&&Number.isFinite(value)?Math.round((value+Number.EPSILON)*100)/100:null;
}
export function missingIndicators(metrics:KpiMetric[]=[]){
 return operationalIndicators.filter(indicator=>{const metric=metrics.find(value=>value.id===indicator.id);return metric?.status!=='not_applicable'&&(typeof metric?.score!=='number'||!Number.isFinite(metric.score));});
}
/** The server's overall score as the card writes it: the score from the data there is (lib/kpis.ts kpiSummary), shown with its
 *  warning while incomplete; none for a person out of the evaluation («بلا نشاط في هذا الشهر») or when no weight has data. */
export function displayedKpiScore(person:SummaryPerson):number|null{
 const score=person.summary?.total;
 return !person.summary?.inactive&&typeof score==='number'&&Number.isFinite(score)?score:null;
}
/** A person out of the evaluation this month (lib/kpis.ts calculateKpis). */
export const outOfEvaluation=(person:SummaryPerson)=>!!person.summary?.inactive;

import {operationalIndicators,type KpiPerson,type KpiMetric} from './kpis';

export type SummaryPerson=Pick<KpiPerson,'member'|'attainment'|'teamRollup'> & Partial<Pick<KpiPerson,'metrics'|'summary'>>;

/** Quantities remain separate by product. Unknown input never becomes a zero. */
export function remainingTarget(target:number|null|undefined,actual:number|null|undefined):number|null{
 if(typeof target!=='number'||typeof actual!=='number'||!Number.isFinite(target)||!Number.isFinite(actual)||target<0)return null;
 // Returns can make net actuals negative and increase the remaining quantity.
 return Math.round((Math.max(target-actual,0)+Number.EPSILON)*1_000_000)/1_000_000;
}
export function missingIndicators(metrics:KpiMetric[]=[]){
 return operationalIndicators.filter(indicator=>{const metric=metrics.find(value=>value.id===indicator.id);return metric?.status!=='not_applicable'&&(typeof metric?.score!=='number'||!Number.isFinite(metric.score));});
}
/** Display the server's final score without normalizing partial results. */
export function displayedKpiScore(person:SummaryPerson):number|null{
 const score=person.summary?.total;
 return person.summary?.complete!==false&&missingIndicators(person.metrics).length===0&&typeof score==='number'&&Number.isFinite(score)?score:null;
}

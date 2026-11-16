import {type ActivityTargets} from './targets';

/** Quantity-only projection: no invoice, customer, monetary or team fields. */
export type OwnProductTarget = {
 product:string;
 quantity:number|null;
 actualQuantity:number|null;
 remainingQuantity:number|null;
 achievement:number|null;
};

/** A representative's read-only target projection, without team or financial data. inactive: the month is out of their evaluation
 *  («بلا نشاط في هذا الشهر – خارج التقييم», GSCO 2.13.50: the representative sees the mark on their own page), decided on the server as the
 *  evaluation decides it (lib/kpi-baseline.ts); only this yes or no, never the data behind it. */
export type OwnTargets = {
 month:string;
 inactive:boolean;
 member:{id:string;name:string};
 sales:{products:OwnProductTarget[];sourceMonth:string|null;actualsAvailable:boolean;
  /** «مبيعات اليوم قصاد مستهدف اليوم» (lib/daily-target.ts): the quantities sold each day of the month (only the days with a confirmed
   *  document of theirs, CRM or ERP, returns deducted), by product; present while the month's actuals are. Quantities only. */
  soldByDay?:Record<string,Record<string,number>>};
 activity:ActivityTargets & {sourceMonth:string|null;isDefault:boolean};
};

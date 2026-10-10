import {type ActivityTargets} from './targets';

/** Quantity-only projection: no invoice, customer, monetary or team fields. */
export type OwnProductTarget = {
 product:string;
 quantity:number|null;
 actualQuantity:number|null;
 remainingQuantity:number|null;
 achievement:number|null;
};

/** A representative's read-only target projection, without team or financial data. */
export type OwnTargets = {
 month:string;
 member:{id:string;name:string};
 sales:{products:OwnProductTarget[];sourceMonth:string|null;actualsAvailable:boolean};
 activity:ActivityTargets & {sourceMonth:string|null;isDefault:boolean};
};

/** «أخرى» as a loss reason (the owner of GSCO, 2026-11-21, ported 2026-11-22 with GSCO 2.13.85: «لو تم فقد فرصة واختار المندوب سبب الخسارة
 * اخرى مبيتفتحش خانة يسجل ايه السبب»). What Yourrest already had: the follow-up form (app/customer-followups.tsx) lists «أخرى» among its
 * reasons (lib/customer-followups.ts followupLossReasons) and asks for «تفاصيل سبب الفقد» (lossDetails, kept apart from the reason) when it is
 * chosen; the server refused «أخرى» without them; every report groups by the reason, so «أخرى» is one group by itself; the record import
 * asks the same. What was missing, and is added here: GSCO's bound and words: the text names the reason in 3 to 200 characters, labelled
 * «اذكر سبب الخسارة» (lossDetailProblem, checked by the server for a follow-up recorded from now on, the device's entries kept from before the
 * update accepted as they were); and an opportunity's free-text «سبب فقد الفرصة» written «أخرى» alone, or «أخرى: » with too short a text, is
 * refused (freeLossReasonProblem), with every «أخرى: …» grouped under «أخرى» (lossReasonGroup). Pure, no import: lib/crm.ts, the routes, the
 * form and the reports share it. */
export const LOSS_OTHER='أخرى',LOSS_DETAIL_MIN=3,LOSS_DETAIL_MAX=200;
export const LOSS_MESSAGES={label:'اذكر سبب الخسارة',required:'اكتب سبب الخسارة عند اختيار «أخرى».',range:'اكتب سبب الخسارة من 3 إلى 200 حرف.'} as const;
/** Why the details of «أخرى» cannot be saved ('' when they can): written, 3 to 200 characters. Any other reason asks nothing here. */
export function lossDetailProblem(reason:unknown,details:unknown):string{
 if(String(reason??'').trim()!==LOSS_OTHER)return '';
 const text=String(details??'').trim();
 return !text?LOSS_MESSAGES.required:text.length<LOSS_DETAIL_MIN||text.length>LOSS_DETAIL_MAX?LOSS_MESSAGES.range:'';
}
/** A free-text reason that starts with «أخرى»: «أخرى: نص» needs its text, 3 to 200 characters; «أخرى» alone is refused. '' when it can be saved. */
export function freeLossReasonProblem(value:unknown):string{
 const reason=String(value??'').trim();if(!reason.startsWith(LOSS_OTHER))return '';
 return lossDetailProblem(LOSS_OTHER,reason.slice(LOSS_OTHER.length).replace(/^\s*[:：،,-]\s*/,''));
}
/** A reason as the reports group it: every «أخرى: …» is «أخرى». */
export const lossReasonGroup=(value:unknown)=>{const reason=String(value??'').trim();return reason.startsWith(LOSS_OTHER)?LOSS_OTHER:reason;};

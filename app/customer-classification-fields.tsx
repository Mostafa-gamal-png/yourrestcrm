'use client';
// «حجم المصنع» (computed) and «اهتمام العميل» (entered by hand) on a customer (lib/customer-classification.ts, the owner, 2026-11-18): the
// section of the customer's form, what its sheet shows and the small marks of its row and card. «تصنيف الفرصة» is the opportunity's own
// «قوة الفرصة» (lib/opportunity-strength.ts), on each visit. Who may set the interest is the server's decision (lib/access.ts
// canClassifyCustomer, POST /api/crm); the page draws it read only for everyone else.
import {useLanguage} from '@/lib/i18n';
import {CLASSIFICATION_TEXT,COMPUTED_SIZE_TEXT,CUSTOMER_INTERESTS,classificationHelp,classificationHidden,classificationLabel,classificationValue,computedFactorySize,type ComputedFactorySize,type MachineCount} from '@/lib/customer-classification';
import './customer-classification.css';

type Data=Record<string,unknown>;
type Say=(ar:string,en:string)=>string;
/** «ماكينتان مسجلتان», «3 ماكينات في الشيت» …: the number with where it comes from (the machines registered one by one, or the sheet). */
function machineText(machines:MachineCount,say:Say){
 const n=machines.count,registered=machines.source==='machines';
 if(machines.source==='entered')return say('عدد الماكينات المُدخل: '+n,'Entered machine count: '+n);
 if(n===1)return registered?say('ماكينة واحدة مسجلة','1 registered machine'):say('ماكينة واحدة في الشيت','1 machine in the sheet');
 if(n===2)return registered?say('ماكينتان مسجلتان','2 registered machines'):say('ماكينتان في الشيت','2 machines in the sheet');
 const noun=n>=3&&n<=10?'ماكينات':'ماكينة';
 return registered?say(n+' '+noun+' مسجلة',n+' registered machines'):say(n+' '+noun+' في الشيت',n+' machines in the sheet');
}
/** Why the size is what it is: the status «خامل», the machines counted, or nothing to count. */
function sizeReason(size:ComputedFactorySize,machines:MachineCount,say:Say){
 if(size.from==='status')return say('حالة العميل «خامل»','Customer status «Inactive»');
 if(size.from==='machines')return machineText(machines,say);
 return say('لا توجد ماكينات مسجلة ولا عدد في الشيت','No registered machines and no sheet count');
}

/** «حجم المصنع (محسوب من الماكينات)»: the value and why, never a choice. */
function ComputedSize({data,machines}:{data:Data;machines:MachineCount}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar,size=computedFactorySize(data,machines);
 return <div data-classification-value="factorySize" data-computed-size={size.value||'none'} data-size-from={size.from}><dt>{say(...COMPUTED_SIZE_TEXT)}</dt><dd>{size.value?<strong>{classificationLabel('factorySize',size.value,language)}</strong>:<span className="muted">{say('غير محدد','Not set')}</span>}<small>{sizeReason(size,machines,say)}</small></dd></div>;
}

/** The section of the customer's form: the computed size, read only, and the interest, chosen where editable (else shown read only). */
export function CustomerClassificationEditor({data,machines,editable,disabled=false,onChange}:{data:Data;machines:MachineCount;editable:boolean;disabled?:boolean;onChange:(key:string,value:string)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 if(!editable)return <section className="classification-section full" data-classification-readonly><h3>{say('تصنيفات التسويق','Marketing classifications')}</h3><CustomerClassificationSummary data={data} machines={machines} bare/><p className="form-note">{say('يحدد اهتمام العميل مسؤول التسويق لعملاء فرعه، والمشرف لعملاء فريقه، ومدير المبيعات، ومدير النظام. ويُحسب حجم المصنع من ماكيناته.','The customer interest is set by the marketing officer for their branch’s customers, the supervisor for their team’s customers, the sales manager and the administrator. The factory size is computed from its machines.')}</p></section>;
 const value=classificationValue(data,'customerInterest'),[ar,en]=CLASSIFICATION_TEXT.customerInterest;
 return <section className="classification-section full" data-classification-editor><h3>{say('تصنيفات التسويق','Marketing classifications')}</h3>
  <dl className="classification-summary classification-computed"><ComputedSize data={data} machines={machines}/></dl>
  <fieldset className="customer-choice-field classification-choice full" disabled={disabled} data-classification="customerInterest"><legend>{say(ar,en)}</legend><div className="classification-grid">
   <label className="customer-choice"><input type="radio" name="classification-customerInterest" value="" checked={!value} onChange={event=>{if(event.target.checked)onChange('customerInterest','');}}/><span><b>{say('غير محدد','Not set')}</b></span></label>
   {CUSTOMER_INTERESTS.map(item=><label className="customer-choice" key={item.value}><input type="radio" name="classification-customerInterest" value={item.value} checked={value===item.value} onChange={event=>{if(event.target.checked)onChange('customerInterest',item.value);}}/><span><b>{say(item.ar,item.en)}</b><small>{say(item.helpAr,item.helpEn)}</small></span></label>)}
  </div></fieldset>
 </section>;
}

/** What the customer's sheet shows: the computed size with why, and the interest with its help (not for a reader who may not read it). bare:
 *  no heading (inside the form). */
export function CustomerClassificationSummary({data,machines,bare=false}:{data:Data;machines:MachineCount;bare?:boolean}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar,interest=classificationValue(data,'customerInterest');
 return <section className={bare?'classification-summary':'classification-summary classification-sheet'} data-classification-summary>{!bare&&<h3>{say('تصنيفات التسويق','Marketing classifications')}</h3>}<dl>
  <ComputedSize data={data} machines={machines}/>
  {!classificationHidden(data)&&<div data-classification-value="customerInterest"><dt>{say(...CLASSIFICATION_TEXT.customerInterest)}</dt><dd>{interest?<><strong>{classificationLabel('customerInterest',interest,language)}</strong><small>{classificationHelp('customerInterest',interest,language)}</small></>:<span className="muted">{say('غير محدد','Not set')}</span>}</dd></div>}
 </dl></section>;
}

/** The small marks on a customer's row and card: the computed size and the interest, when there is one. */
export function CustomerClassificationBadges({data,machines}:{data:Data;machines:MachineCount}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const size=computedFactorySize(data,machines),interest=classificationHidden(data)?'':classificationValue(data,'customerInterest');
 if(!size.value&&!interest)return null;
 return <span className="classification-badges" data-classification-badges>
  {size.value&&<span className={'badge classification-size size-'+size.value} data-size-from={size.from}>{say('الحجم: ','Size: ')}{classificationLabel('factorySize',size.value,language)}</span>}
  {interest&&<span className="badge classification-interest">{say('الاهتمام: ','Interest: ')}{classificationLabel('customerInterest',interest,language)}</span>}
 </span>;
}

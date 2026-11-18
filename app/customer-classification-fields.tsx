'use client';
// «تصنيف الفرصة» and its notes, «حجم المصنع» and «اهتمام العميل» on a customer (lib/customer-classification.ts, the owner, 2026-11-18): the
// fields of the customer's form, what its sheet shows and the small marks of its row and card. Who may set them is the server's decision
// (lib/access.ts canClassifyCustomer, POST /api/crm); the page draws the fields read only for everyone else.
import {useLanguage} from '@/lib/i18n';
import {CLASSIFICATION_TEXT,CUSTOMER_INTERESTS,FACTORY_SIZES,GRADE_NOTES_MAX,OPPORTUNITY_GRADES,classificationHelp,classificationHidden,classificationLabel,classificationValue,effectiveFactorySize,suggestedFactorySize,type ClassificationChoiceField,type MachineCount} from '@/lib/customer-classification';
import VoiceField from './voice-field';
import './customer-classification.css';

type Data=Record<string,unknown>;
type Say=(ar:string,en:string)=>string;
const CHOICES={opportunityGrade:OPPORTUNITY_GRADES,factorySize:FACTORY_SIZES,customerInterest:CUSTOMER_INTERESTS};
/** «ماكينتان مسجلتان», «3 ماكينات في الشيت» …: the number with where it comes from (the machines registered one by one, or the sheet). */
function machineText(machines:MachineCount,say:Say){
 const n=machines.count,registered=machines.source==='machines';
 if(n===1)return registered?say('ماكينة واحدة مسجلة','1 registered machine'):say('ماكينة واحدة في الشيت','1 machine in the sheet');
 if(n===2)return registered?say('ماكينتان مسجلتان','2 registered machines'):say('ماكينتان في الشيت','2 machines in the sheet');
 const noun=n>=3&&n<=10?'ماكينات':'ماكينة';
 return registered?say(n+' '+noun+' مسجلة',n+' registered machines'):say(n+' '+noun+' في الشيت',n+' machines in the sheet');
}

function ChoiceGroup({field,value,disabled,onChange}:{field:ClassificationChoiceField;value:string;disabled:boolean;onChange:(value:string)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar,[ar,en]=CLASSIFICATION_TEXT[field];
 return <fieldset className="customer-choice-field classification-choice full" disabled={disabled} data-classification={field}><legend>{say(ar,en)}</legend><div className="classification-grid">
  <label className="customer-choice"><input type="radio" name={'classification-'+field} value="" checked={!value} onChange={event=>{if(event.target.checked)onChange('');}}/><span><b>{say('غير محدد','Not set')}</b></span></label>
  {CHOICES[field].map(item=><label className="customer-choice" key={item.value}><input type="radio" name={'classification-'+field} value={item.value} checked={value===item.value} onChange={event=>{if(event.target.checked)onChange(item.value);}}/><span><b>{field==='customerInterest'?say(item.ar,item.en):<><bdi dir="ltr">{item.value}</bdi> · {say(item.ar,item.en)}</>}</b><small>{say(item.helpAr,item.helpEn)}</small></span></label>)}
 </div></fieldset>;
}

/** The fields of the customer's form. editable: the member may set them for this customer (else they are shown, read only, when there is
 *  anything to show). machines: the customer's registered machines, for the suggested size. */
export function CustomerClassificationEditor({data,machines,editable,disabled=false,contextKey='',onChange}:{data:Data;machines:MachineCount;editable:boolean;disabled?:boolean;contextKey?:string;onChange:(key:string,value:string)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 if(!editable)return <section className="classification-section full" data-classification-readonly><h3>{say('تصنيفات التسويق','Marketing classifications')}</h3><CustomerClassificationSummary data={data} machines={machines} bare/><p className="form-note">{say('يحدد التصنيفات مسؤول التسويق لعملاء فرعه، والمشرف لعملاء فريقه، ومدير المبيعات، ومدير النظام.','The classifications are set by the marketing officer for their branch’s customers, the supervisor for their team’s customers, the sales manager and the administrator.')}</p></section>;
 const size=classificationValue(data,'factorySize'),suggestion=suggestedFactorySize(machines.count);
 return <section className="classification-section full" data-classification-editor><h3>{say('تصنيفات التسويق','Marketing classifications')}</h3><div className="form-grid">
  <ChoiceGroup field="opportunityGrade" value={classificationValue(data,'opportunityGrade')} disabled={disabled} onChange={value=>onChange('opportunityGrade',value)}/>
  <VoiceField label={say('ملاحظات التصنيف','Classification notes')} value={classificationValue(data,'gradeNotes')} onChange={value=>onChange('gradeNotes',value)} multiline full rows={2} disabled={disabled} contextKey={contextKey+':gradeNotes'} inputProps={{maxLength:GRADE_NOTES_MAX}}/>
  <ChoiceGroup field="factorySize" value={size} disabled={disabled} onChange={value=>onChange('factorySize',value)}/>
  <div className="classification-suggestion full" data-size-suggestion={suggestion||'none'}>
   {suggestion?<><span>{say('المقترح من عدد الماكينات (','Suggested from the machine count (')+machineText(machines,say)+say('): ','): ')}<strong>{classificationLabel('factorySize',suggestion,language)}</strong></span>{size!==suggestion&&<button type="button" className="btn subtle small" disabled={disabled} onClick={()=>onChange('factorySize',suggestion)}>{say('اعتماد المقترح','Confirm the suggestion')}</button>}</>
    :<span>{say('لا توجد ماكينات مسجلة ولا عدد في الشيت لاقتراح الحجم؛ اختره يدويًا.','No registered machines and no sheet count to suggest a size; choose it by hand.')}</span>}
   {!size&&suggestion&&<small>{say('يظهر الحجم المقترح للعميل حتى يُعتمد أو يُختار غيره.','The suggested size shows for the customer until it is confirmed or another is chosen.')}</small>}
   <small>{say('«متوقف» يُختار يدويًا فقط.','«Stopped» is chosen by hand only.')}</small>
  </div>
  <ChoiceGroup field="customerInterest" value={classificationValue(data,'customerInterest')} disabled={disabled} onChange={value=>onChange('customerInterest',value)}/>
 </div></section>;
}

/** What the customer's sheet shows: each classification with its words and help, the size marked when it is only suggested. bare: no
 *  heading (inside the form). */
export function CustomerClassificationSummary({data,machines,bare=false}:{data:Data;machines:MachineCount;bare?:boolean}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 // The reader may not read this customer's classifications: nothing, not even a suggested size.
 if(classificationHidden(data))return null;
 const size=effectiveFactorySize(data.factorySize,machines.count),notes=classificationValue(data,'gradeNotes');
 const row=(field:ClassificationChoiceField,value:string,extra='')=><div key={field} data-classification-value={field}><dt>{say(...CLASSIFICATION_TEXT[field])}</dt><dd>{value?<><strong>{classificationLabel(field,value,language)}{extra}</strong><small>{classificationHelp(field,value,language)}</small></>:<span className="muted">{say('غير محدد','Not set')}</span>}</dd></div>;
 return <section className={bare?'classification-summary':'classification-summary classification-sheet'} data-classification-summary>{!bare&&<h3>{say('تصنيفات التسويق','Marketing classifications')}</h3>}<dl>
  {row('opportunityGrade',classificationValue(data,'opportunityGrade'))}
  {notes&&<div data-classification-value="gradeNotes"><dt>{say('ملاحظات التصنيف','Classification notes')}</dt><dd className="classification-notes">{notes}</dd></div>}
  {row('factorySize',size.value,size.suggested?say(' (مقترح من '+machineText(machines,say)+')',' (suggested from '+machineText(machines,say)+')'):'')}
  {row('customerInterest',classificationValue(data,'customerInterest'))}
 </dl></section>;
}

/** The small marks on a customer's row and card: the grade, the size (suggested ones marked) and the interest, when set. */
export function CustomerClassificationBadges({data,machines}:{data:Data;machines:MachineCount}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 if(classificationHidden(data))return null;
 const grade=classificationValue(data,'opportunityGrade'),size=effectiveFactorySize(data.factorySize,machines.count),interest=classificationValue(data,'customerInterest');
 if(!grade&&!size.value&&!interest)return null;
 return <span className="classification-badges" data-classification-badges>
  {grade&&<span className={'badge classification-grade grade-'+grade}>{say('الفرصة: ','Opportunity: ')}{classificationLabel('opportunityGrade',grade,language)}</span>}
  {size.value&&<span className={'badge classification-size'+(size.suggested?' suggested':'')}>{say('الحجم: ','Size: ')}{classificationLabel('factorySize',size.value,language)}{size.suggested?say(' (مقترح)',' (suggested)'):''}</span>}
  {interest&&<span className="badge classification-interest">{say('الاهتمام: ','Interest: ')}{classificationLabel('customerInterest',interest,language)}</span>}
 </span>;
}

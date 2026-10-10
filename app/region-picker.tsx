'use client';
import {t,useLanguage} from '@/lib/i18n';
import {regionOptions,regionScope,regionLabel} from '@/lib/regions';
import type {Member} from '@/lib/crm';
export function MemberRegionField({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){useLanguage();return <label className="field"><span>{t('منطقة البيانات المسموح بها')} *</span><select required value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}><option value="" disabled>{t('اختر المنطقة')}</option><option value="all">{t('كل المناطق')}</option>{regionOptions.map(([id,label])=><option key={id} value={id}>{t(label)}</option>)}</select></label>;}
export function CustomerRegionField({value,onChange,me,disabled=false}:{value:string;onChange:(value:string)=>void;me:Member;disabled?:boolean}){
 useLanguage();
 const order=['northern','southern','western','eastern','central'];
 const choices=order.map(id=>regionOptions.find(option=>option[0]===id)![1]) as string[];
 const restricted=regionScope(me)!=='all';
 if(value&&!choices.includes(value))choices.push(value);
 if(restricted&&!value)choices.push('');
 return <fieldset className="customer-choice-field customer-region-field full" disabled={disabled||restricted}><legend>{t('المنطقة')}</legend><div className="customer-choice-grid">{choices.map(name=><label className="customer-choice" key={name}><input type="radio" name="customer-region" value={name} checked={value===name} onChange={event=>{if(event.target.checked)onChange(name);}}/><span>{t(name||'المنطقة غير محددة')}</span></label>)}</div>{restricted&&<small>{t('محدد حسب صلاحية المستخدم')}: {t(regionLabel(regionScope(me)))}</small>}</fieldset>;
}

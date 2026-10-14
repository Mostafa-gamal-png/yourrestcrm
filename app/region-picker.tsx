'use client';
import {t,useLanguage} from '@/lib/i18n';
import {canonicalRegionScope,regionLabels,regionOptions,regionScope,scopeRegions} from '@/lib/regions';
import type {Member} from '@/lib/crm';
/** The regions a member may work in: all of them, or any set from the catalogue. The value is the canonical scope text. */
export function MemberRegionField({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){
 useLanguage();
 const all=value==='all',chosen=new Set(scopeRegions(value));
 const toggle=(id:string,checked:boolean)=>{
  if(id==='all'){onChange(checked?'all':'');return;}
  const next=new Set(chosen);if(checked)next.add(id);else next.delete(id);
  onChange(canonicalRegionScope([...next]));
 };
 return <fieldset className="customer-choice-field member-region-field full" disabled={disabled}><legend>{t('منطقة البيانات المسموح بها')} *</legend><div className="customer-choice-grid">
  <label className="customer-choice"><input type="checkbox" name="member-region" value="all" checked={all} onChange={event=>toggle('all',event.target.checked)}/><span>{t('كل المناطق')}</span></label>
  {regionOptions.map(([id,label])=><label className="customer-choice" key={id}><input type="checkbox" name="member-region" value={id} checked={!all&&chosen.has(id)} disabled={all} onChange={event=>toggle(id,event.target.checked)}/><span>{t(label)}</span></label>)}
 </div><small>{all?t('يرى كل المناطق'):chosen.size?t('المناطق المختارة')+': '+regionLabels(value).map(label=>t(label)).join('، '):t('اختر منطقة واحدة على الأقل')}</small></fieldset>;
}
/** A customer's region: free for a member who sees every region, fixed for one with a single region, and a choice among them for one with several. */
export function CustomerRegionField({value,onChange,me,disabled=false}:{value:string;onChange:(value:string)=>void;me:Member;disabled?:boolean}){
 useLanguage();
 const order=['northern','southern','western','eastern','central'];
 const restricted=regionScope(me)!=='all',allowed=scopeRegions(regionScope(me));
 const ids=restricted?order.filter(id=>allowed.includes(id)):order;
 const choices=ids.map(id=>regionOptions.find(option=>option[0]===id)![1]) as string[];
 const locked=restricted&&allowed.length<=1;
 if(value&&!choices.includes(value))choices.push(value);
 if(locked&&!value)choices.push('');
 return <fieldset className="customer-choice-field customer-region-field full" disabled={disabled||locked}><legend>{t('المنطقة')}</legend><div className="customer-choice-grid">{choices.map(name=><label className="customer-choice" key={name}><input type="radio" name="customer-region" value={name} checked={value===name} onChange={event=>{if(event.target.checked)onChange(name);}}/><span>{t(name||'المنطقة غير محددة')}</span></label>)}</div>{restricted&&<small>{t('محدد حسب صلاحية المستخدم')}: {regionLabels(regionScope(me)).map(label=>t(label)).join('، ')}</small>}</fieldset>;
}

'use client';
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {ChevronDown,Check,Paperclip} from 'lucide-react';
import {type Row,type Member} from '@/lib/crm';
import {buildCompetitors,normalizeCompetitorName} from '@/lib/competitors';
import {useLanguage} from '@/lib/i18n';
import {Switch} from '@/components/ui/switch';
import VoiceField from './voice-field';
import UploadStatus,{type UploadState} from './upload-status';
import './competitor-fields.css';

export type CompetitorInput={hasCompetitor:boolean;competitorName:string;competitorNotes:string;competitorFileId:string;competitorFileName:string};
export const emptyCompetitorInput=():CompetitorInput=>({hasCompetitor:false,competitorName:'',competitorNotes:'',competitorFileId:'',competitorFileName:''});
/** Caller supplies only its server-authorized records, never the full database. */
export function competitorNameSuggestions(records:Row[],members:Member[],customerId:string){return buildCompetitors(records,members).map(entry=>({key:entry.key,name:entry.name,atCustomer:entry.contacts.some(contact=>contact.customer.id===customerId)})).sort((a,b)=>Number(b.atCustomer)-Number(a.atCustomer));}
type Props={value:CompetitorInput;records:Row[];members?:Member[];customerId:string;identityKey?:string;onChange:(patch:Partial<CompetitorInput>)=>void;onUpload?:(file:File)=>void;disabled?:boolean;readOnly?:boolean;uploading?:boolean;uploadState?:UploadState|null;onUploadRetry?:()=>void;toggleLabel?:string};
export default function CompetitorFields({value,records,members=[],customerId,identityKey='',onChange,onUpload,disabled=false,readOnly=false,uploading=false,uploadState=null,onUploadRetry,toggleLabel}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar,id=useId(),inputId=id+'-name',listId=id+'-options';
 const [open,setOpen]=useState(false),[browse,setBrowse]=useState(true),[active,setActive]=useState(-1),input=useRef<HTMLInputElement>(null);
 const locked=disabled||readOnly||uploading,context=identityKey+'\n'+customerId+'\n'+value.competitorName,latest=useRef({locked,context,onChange});latest.current={locked,context,onChange};
 const suggestions=useMemo(()=>competitorNameSuggestions(records,members,customerId),[records,members,customerId]);
 const query=normalizeCompetitorName(value.competitorName||''),matches=(browse?suggestions:suggestions.filter(option=>option.key.includes(query))).slice(0,12),expanded=open&&!locked&&value.hasCompetitor;
 useEffect(()=>{if(expanded&&active>=0)document.getElementById(id+'-option-'+active)?.scrollIntoView({block:'nearest'});},[expanded,active,id]);
 function change(patch:Partial<CompetitorInput>){if(!latest.current.locked)latest.current.onChange(patch);}
 function choose(name:string){if(locked)return;change({competitorName:name});setOpen(false);setActive(-1);input.current?.focus();}
 function keyDown(event:React.KeyboardEvent<HTMLInputElement>){
  if(locked)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);if(!open)setBrowse(true);setActive(index=>event.key==='ArrowDown'?Math.min(index+1,matches.length-1):index<0?matches.length-1:Math.max(0,index-1));}
  else if(event.key==='Enter'&&expanded){event.preventDefault();if(active>=0&&matches[active])choose(matches[active].name);else{setOpen(false);setActive(-1);}}
  else if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();setOpen(false);setActive(-1);}
  else if(event.key==='Tab'){setOpen(false);setActive(-1);}
 }
 return <section className="competitor-fields full" aria-label={say('بيانات المنافس','Competitor observation')}>
  <div className="competitor-presence"><label htmlFor={id+'-present'}>{toggleLabel||say('يوجد منافس','Competitor present')}</label><Switch id={id+'-present'} dir="ltr" checked={!!value.hasCompetitor} disabled={locked} onCheckedChange={checked=>{change({hasCompetitor:checked});setOpen(false);setActive(-1);}}/></div>
  {value.hasCompetitor&&<div className="competitor-entry">
   <div className="field competitor-name" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){setOpen(false);setActive(-1);}}}>
    <label htmlFor={inputId}>{say('اسم المنافس','Competitor name')} <b aria-hidden="true">*</b></label>
    <div className="competitor-name-control"><input ref={input} id={inputId} type="text" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded?listId:undefined} aria-activedescendant={expanded&&active>=0&&matches[active]?id+'-option-'+active:undefined} autoComplete="off" maxLength={250} required disabled={locked} value={value.competitorName||''} placeholder={say('اختر اسمًا سابقًا أو اكتب اسمًا جديدًا','Choose a previous name or type a new one')} onFocus={()=>{if(!locked){setBrowse(true);setOpen(true);setActive(-1);}}} onChange={event=>{change({competitorName:event.target.value});setBrowse(false);setOpen(true);setActive(-1);}} onKeyDown={keyDown}/><button type="button" disabled={locked||!suggestions.length} aria-label={say('اختيار منافس مسجل سابقًا','Choose a previously recorded competitor')} aria-expanded={expanded} aria-controls={expanded?listId:undefined} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(locked)return;setBrowse(true);setOpen(!expanded);setActive(-1);input.current?.focus();}}><ChevronDown size={18}/></button></div>
    {expanded&&<div className="competitor-suggestions"><ul id={listId} role="listbox" aria-label={say('أسماء المنافسين السابقة','Previously recorded competitor names')}>{matches.map((option,index)=><li key={option.key} id={id+'-option-'+index} role="option" aria-selected={active===index} className={active===index?'is-active':undefined} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(option.name)}><span><strong>{option.name}</strong><small>{option.atCustomer?say('مسجل لدى هذا العميل','Recorded at this customer'):say('مسجل سابقًا','Previously recorded')}</small></span>{normalizeCompetitorName(value.competitorName)===option.key&&<Check size={17} aria-hidden="true"/>}</li>)}</ul>{!matches.length&&<p role="status">{query?say('سيُحفظ هذا الاسم مع الزيارة.','This name will be saved with the contact.'):say('اكتب اسم المنافس.','Type the competitor name.')}</p>}</div>}
   </div>
   {readOnly?<div className="field full"><span>{say('ملاحظات المنافس','Competitor notes')}</span><p className="competitor-recorded-notes">{value.competitorNotes||'—'}</p></div>:<fieldset disabled={locked} className="competitor-notes-field"><VoiceField key={context+':'+String(locked)} contextKey={context} disabled={locked} label={say('ملاحظات المنافس (اختياري)','Competitor notes (optional)')} value={value.competitorNotes||''} multiline onChange={notes=>{if(latest.current.context===context&&!latest.current.locked)latest.current.onChange({competitorNotes:notes});}}/></fieldset>}
   <div className="competitor-attachment"><span><Paperclip size={16} aria-hidden="true"/>{say('عرض المنافس (اختياري)','Competitor quotation (optional)')}</span>{!readOnly&&<label className="competitor-file-input"><span>{say('PDF أو صورة · حتى 10 ميجابايت','PDF or image · up to 10 MB')}</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={locked||!customerId||!onUpload} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file&&!latest.current.locked&&customerId)onUpload?.(file);}}/></label>}{!readOnly&&!customerId&&<small>{say('اختر العميل لإرفاق الملف.','Choose the customer to attach a file.')}</small>}{!readOnly&&<UploadStatus state={uploadState||(uploading?{phase:'reading'}:null)} fileName={value.competitorFileName} onRetry={onUploadRetry} disabled={locked}/>}{value.competitorFileId&&<div className="competitor-file-current">{value.competitorFileId.startsWith('local-file:')?<span role="status">{value.competitorFileName||say('عرض المنافس','Competitor quotation')} · {say('محفوظ على الجهاز','Saved on this device')}</span>:<a href={'/api/visit-files?id='+encodeURIComponent(value.competitorFileId)} target="_blank" rel="noopener noreferrer">{value.competitorFileName||say('عرض المنافس','Competitor quotation')}</a>}{!readOnly&&<button type="button" className="text-button" disabled={locked} onClick={()=>change({competitorFileId:'',competitorFileName:''})}>{say('إزالة المرفق','Remove attachment')}</button>}</div>}</div>
  </div>}
 </section>;
}

'use client';
import {ArrowUp,Check,CircleAlert,HardDrive,Loader2,RefreshCw} from 'lucide-react';
import {useLanguage} from '@/lib/i18n';
import type {UploadProgress} from '@/lib/client-submit';
import './upload-status.css';
export type UploadState=UploadProgress|{phase:'reading'|'complete'|'error'|'queued';message?:string};
type Props={state:UploadState|null;fileName?:string;completeLabel?:string;onRetry?:()=>void;disabled?:boolean};
/** Percent is transport-only; processing has no invented percentage. */
export default function UploadStatus({state,fileName,completeLabel,onRetry,disabled}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;if(!state)return null;
 const phase=state.phase,active=phase==='reading'||phase==='uploading'||phase==='processing';
 const label=phase==='reading'?say('جارٍ قراءة الملف','Reading file'):phase==='uploading'?say('جارٍ الرفع','Uploading'):phase==='processing'?say('جارٍ المعالجة','Processing'):phase==='complete'?(completeLabel||say('اكتمل رفع الملف','File upload complete')):phase==='queued'?say('محفوظ على الجهاز — بانتظار الرفع','Saved on this device — awaiting upload'):say('تعذر إكمال الرفع','Upload could not complete');
 const percentage=phase==='uploading'&&state.percent!==null?Math.min(100,Math.max(0,state.percent)):null;
 const Icon=phase==='complete'?Check:phase==='error'?CircleAlert:phase==='queued'?HardDrive:phase==='uploading'?ArrowUp:Loader2;
 return <div className={'upload-status is-'+phase} aria-busy={active}><div className="upload-status-top"><span className={'upload-status-icon'+(phase==='processing'||phase==='reading'?' is-working':'')}><Icon size={19} aria-hidden="true"/></span><div className="upload-status-copy"><strong role="status" aria-live="polite">{label}</strong>{fileName&&<bdi className="upload-status-name">{fileName}</bdi>}</div>{percentage!==null&&<bdi className="upload-status-percent">{Math.floor(percentage)}%</bdi>}</div>
 {active&&<div className={'upload-status-track'+(percentage===null?' is-indeterminate':'')} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage===null?undefined:Math.floor(percentage)} aria-valuetext={percentage===null?label:Math.floor(percentage)+'%'}><span style={percentage===null?undefined:{width:percentage+'%'}}/></div>}
 {'message'in state&&state.message&&<p className="upload-status-message" role={phase==='error'?'alert':undefined}>{state.message}</p>}{phase==='error'&&onRetry&&<button type="button" className="text-button upload-status-retry" disabled={disabled} onClick={onRetry}><RefreshCw size={14} aria-hidden="true"/>{say('إعادة المحاولة','Retry')}</button>}</div>;
}

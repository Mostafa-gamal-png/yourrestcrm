'use client';
import {t,useLanguage,getLanguage} from '@/lib/i18n';
import {useEffect,useRef,useState} from 'react';
import type {InputHTMLAttributes,Ref,TextareaHTMLAttributes} from 'react';
import {Mic,Square} from 'lucide-react';
import {speechAvailability,speechErrorMessage,startSpeech,type SpeechAvailability,type SpeechTask} from '@/lib/native-speech';

type DictationOptions={disabled?:boolean;contextKey?:string;/** Receives what was said; the caller decides where it goes. */onText:(text:string)=>void};

/** One dictation session for one control. Cancelled when the control unmounts, is disabled, or its context or the language changes. */
export function useDictation({disabled=false,contextKey='',onText}:DictationOptions){
 useLanguage();const language:'ar'|'en'=getLanguage()==='en'?'en':'ar';
 const [listening,setListening]=useState(false),[error,setError]=useState(''),[availability,setAvailability]=useState<SpeechAvailability|null>(null);
 const task=useRef<SpeechTask|null>(null),alive=useRef(false),revision=useRef(0),latest=useRef({onText,disabled,contextKey,language});
 // Render-time snapshot closes the gap before effect cleanup after a context/disabled change.
 latest.current={onText,disabled,contextKey,language};
 useEffect(()=>{alive.current=true;let cancelled=false;const refresh=()=>{void speechAvailability().then(mode=>{if(!cancelled)setAvailability(mode);});};refresh();window.addEventListener('yourrest:native-ready',refresh);return()=>{cancelled=true;alive.current=false;revision.current++;task.current?.cancel();task.current=null;window.removeEventListener('yourrest:native-ready',refresh);};},[]);
 useEffect(()=>{revision.current++;task.current?.cancel();task.current=null;setListening(false);setError('');},[contextKey,disabled,language]);
 function speak(){
  if(disabled)return;
  if(listening){task.current?.cancel();task.current=null;setListening(false);return;}
  if(availability!=='native'&&availability!=='browser'){setError(availability==='upgrade'?'speech_upgrade':'speech_unsupported');return;}
  const expected=++revision.current,capturedContext=contextKey,capturedLanguage=language;
  const current=()=>alive.current&&revision.current===expected&&!latest.current.disabled&&latest.current.contextKey===capturedContext&&latest.current.language===capturedLanguage;
  setError('');setListening(true);
  task.current=startSpeech({language:language==='ar'?'ar-SA':'en-US',onText:text=>{if(current())latest.current.onText(text);},onError:code=>{if(current())setError(code);},onEnd:()=>{if(alive.current&&revision.current===expected){task.current=null;setListening(false);}}});
 }
 return {listening,error,availability,language,speak,ready:availability==='native'||availability==='browser'};
}
type Dictation=ReturnType<typeof useDictation>;

/** The microphone button, as an element rather than a component so that a field renders it in its own tree. */
function micButton(dictation:Dictation,label:string,disabled:boolean){
 const {listening,language}=dictation;
 return <button type="button" disabled={disabled||dictation.availability===null} className={'voice-button '+(listening?'listening':'')} onClick={dictation.speak} aria-pressed={listening} aria-label={listening?(language==='ar'?'إلغاء الإملاء':'Cancel dictation'):(language==='ar'?'إدخال صوتي: ':'Dictate: ')+t(label)}>{listening?<Square size={17}/>:<Mic size={18}/>}</button>;
}
function micNotes(dictation:Dictation){
 const {listening,error,language}=dictation;
 return <>{error&&<small role="alert">{speechErrorMessage(error,language)}</small>}{listening&&<small role="status">{language==='ar'?'تحدث الآن؛ سيُضاف الكلام كنص يمكنك تعديله.':'Speak now; your words will be added as editable text.'}</small>}</>;
}
/** What was said is added after what is already written, and never past the field's own length limit. */
export const appendDictation=(value:string,text:string,maxLength?:number)=>{
 const next=[value.trim(),text].filter(Boolean).join(' ');
 return typeof maxLength==='number'&&maxLength>0&&next.length>maxLength?next.slice(0,maxLength):next;
};

type FieldAttributes=Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'required'|'disabled'|'className'|'ref'|'type'|'children'|'size'>;

/** The standard free-text field of the forms: a labelled text input or text area with a dictation button beside it. */
export default function VoiceField({label,value,onChange,required=false,marked=false,multiline=false,full=false,disabled=false,contextKey='',rows=3,className='',inputRef,inputProps}:{
 label:string;value:string;onChange:(value:string)=>void;required?:boolean;/** Shows the required mark without the browser's own validation. */marked?:boolean;multiline?:boolean;full?:boolean;disabled?:boolean;contextKey?:string;rows?:number;className?:string;inputRef?:Ref<HTMLInputElement|HTMLTextAreaElement>;/** Passed to the input or text area: placeholder, maxLength, autoComplete, id, dir, aria-*, onBlur, onKeyDown, autoFocus and the like. */inputProps?:FieldAttributes;
}){
 const maxLength=typeof inputProps?.maxLength==='number'?inputProps.maxLength:undefined;
 const dictation=useDictation({disabled,contextKey,onText:text=>onChange(appendDictation(value,text,maxLength))});
 return <label className={['field','voice-field',multiline||full?'full':'',dictation.ready?'has-voice-input':'keyboard-input',className].filter(Boolean).join(' ')}>
  <span>{t(label)}{(required||marked)&&<b> *</b>}</span><div>
   {multiline?<textarea {...(inputProps as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>)} ref={inputRef as Ref<HTMLTextAreaElement>} rows={rows} required={required} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>:<input {...inputProps} ref={inputRef as Ref<HTMLInputElement>} required={required} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>}
   {micButton(dictation,label,disabled)}
  </div>{micNotes(dictation)}
 </label>;
}

/** The dictation button alone, for a control that keeps its own markup (one nested in another label, or a combobox). Put it right after the
 * control, inside a `dictation-row`; `onText` receives what was said and adds it to the value as the caller sees fit (see appendDictation). */
export function DictationButton({label,onText,disabled=false,contextKey=''}:{label:string;onText:(text:string)=>void;disabled?:boolean;contextKey?:string}){
 const dictation=useDictation({disabled,contextKey,onText});
 return <>{micButton(dictation,label,disabled)}{micNotes(dictation)}</>;
}

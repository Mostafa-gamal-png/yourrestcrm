'use client';
import {t,useLanguage,getLanguage} from '@/lib/i18n';
import {useEffect,useRef,useState} from 'react';
import {Mic,Square} from 'lucide-react';
import {speechAvailability,speechErrorMessage,startSpeech,type SpeechAvailability,type SpeechTask} from '@/lib/native-speech';
export default function VoiceField({label,value,onChange,required=false,multiline=false,disabled=false,contextKey=''}:{
 label:string;value:string;onChange:(value:string)=>void;required?:boolean;multiline?:boolean;disabled?:boolean;contextKey?:string;
}){
 useLanguage();const language=getLanguage()==='en'?'en':'ar';
 const [listening,setListening]=useState(false),[error,setError]=useState(''),[availability,setAvailability]=useState<SpeechAvailability|null>(null);
 const task=useRef<SpeechTask|null>(null),alive=useRef(false),revision=useRef(0),latest=useRef({value,onChange,disabled,contextKey,language});
 // Render-time snapshot closes the gap before effect cleanup after a context/disabled change.
 latest.current={value,onChange,disabled,contextKey,language};
 useEffect(()=>{alive.current=true;let cancelled=false;const refresh=()=>{void speechAvailability().then(mode=>{if(!cancelled)setAvailability(mode);});};refresh();window.addEventListener('yourrest:native-ready',refresh);return()=>{cancelled=true;alive.current=false;revision.current++;task.current?.cancel();task.current=null;window.removeEventListener('yourrest:native-ready',refresh);};},[]);
 useEffect(()=>{revision.current++;task.current?.cancel();task.current=null;setListening(false);setError('');},[contextKey,disabled,language]);
 function speak(){
  if(disabled)return;
  if(listening){task.current?.cancel();task.current=null;setListening(false);return;}
  if(availability!=='native'&&availability!=='browser'){setError(availability==='upgrade'?'speech_upgrade':'speech_unsupported');return;}
  const expected=++revision.current,capturedContext=contextKey,capturedLanguage=language;
  const current=()=>alive.current&&revision.current===expected&&!latest.current.disabled&&latest.current.contextKey===capturedContext&&latest.current.language===capturedLanguage;
  setError('');setListening(true);
  task.current=startSpeech({language:language==='ar'?'ar-SA':'en-US',onText:text=>{if(current())latest.current.onChange([latest.current.value.trim(),text].filter(Boolean).join(' '));},onError:code=>{if(current())setError(code);},onEnd:()=>{if(alive.current&&revision.current===expected){task.current=null;setListening(false);}}});
 }
 const help=error;
 return <label className={'field voice-field '+(multiline?'full ':'')+((availability==='native'||availability==='browser')?'has-voice-input':'keyboard-input')}>
  <span>{t(label)}{required&&<b> *</b>}</span><div>
   {multiline?<textarea rows={3} required={required} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>:<input required={required} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>}
   <button type="button" disabled={disabled||availability===null} className={'voice-button '+(listening?'listening':'')} onClick={speak} aria-pressed={listening} aria-label={listening?(language==='ar'?'إلغاء الإملاء':'Cancel dictation'):(language==='ar'?'إدخال صوتي: ':'Dictate: ')+t(label)}>{listening?<Square size={17}/>:<Mic size={18}/>}</button>
  </div>{help&&<small role="alert">{speechErrorMessage(help,language)}</small>}{listening&&<small role="status">{language==='ar'?'تحدث الآن؛ سيُضاف الكلام كنص يمكنك تعديله.':'Speak now; your words will be added as editable text.'}</small>}
 </label>;
}

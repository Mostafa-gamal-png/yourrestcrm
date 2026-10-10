'use client';
import {Languages} from 'lucide-react';
import {useLanguage} from '@/lib/i18n';
export default function LanguageSwitch(){
 const {language,setLanguage}=useLanguage();
 return <button type="button" className="btn subtle small language-switch" onClick={()=>setLanguage(language==='ar'?'en':'ar')} aria-label={language==='ar'?'Switch to English':'التبديل إلى العربية'} lang={language==='ar'?'en':'ar'} dir={language==='ar'?'ltr':'rtl'}><Languages size={16}/>{language==='ar'?'English':'العربية'}</button>;
}

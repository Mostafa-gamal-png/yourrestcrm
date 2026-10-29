'use client';
import {useEffect,useSyncExternalStore} from 'react';
export type Language='ar'|'en';
type Pattern={pattern:RegExp;value:string;indexes:number[]};
// The English dictionary is downloaded only when English is chosen (2026-10-29): it was about 94 KB of every opening, in Arabic too.
let dictionary:Record<string,string>={},patterns:Pattern[]=[],englishReady=false,english:Promise<void>|null=null;
const listeners=new Set<()=>void>();
let language:Language='ar',requested:Language='ar';
let initialized=false;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const getLanguage=():Language=>language;
export const direction=() => language==='ar'?'rtl' as const:'ltr' as const;
/** Installs the English dictionary; loadEnglish() fetches it, and a test may hand it over directly. */
export function installEnglish(entries:Record<string,string>){dictionary=entries;patterns=buildPatterns(entries);englishReady=true;}
export function loadEnglish():Promise<void>{
 if(englishReady)return Promise.resolve();
 return english??=import('./locales/en.json').then(module=>installEnglish((module as {default:Record<string,string>}).default),error=>{english=null;throw error;});
}
// A saved English choice starts the download with the page, not after the first drawing.
if(typeof window!=='undefined'){try{if(localStorage.getItem('yr-language')==='en')void loadEnglish().catch(()=>{});}catch{}}
/** Switches the page's language. English waits for its dictionary (a moment, once); until then the page stays in Arabic. */
export function setLanguage(next:Language){
 if(typeof window==='undefined')return;
 requested=next;
 try{localStorage.setItem('yr-language',next);}catch{}
 if(next==='en'&&!englishReady){void loadEnglish().then(()=>{if(requested==='en')applyLanguage('en');},()=>{/* stays in Arabic; choosing English again retries */});return;}
 applyLanguage(next);
}
function applyLanguage(next:Language){
 language=next;
 document.documentElement.lang=next;
 document.documentElement.dir=direction();
 document.title=next==='ar'?'يورست للصناعات | إدارة علاقات العملاء':'Yourrest Industries | CRM';
 for(const listener of listeners)listener();
}
export function useLanguage(){
 const selected=useSyncExternalStore(subscribe,getLanguage,()=> 'ar' as Language);
 useEffect(()=>{if(!initialized){initialized=true;let saved:Language='ar';try{if(localStorage.getItem('yr-language')==='en')saved='en';}catch{}setLanguage(saved);}},[]);
 return {language:selected,setLanguage};
}
function buildPatterns(entries:Record<string,string>):Pattern[]{return Object.entries(entries).filter(([key])=>/\{\d+\}/.test(key)).map(([key,value])=>{
 const indexes:number[]=[];let last=0,source='';
 for(const match of key.matchAll(/\{(\d+)\}/g)){source+=key.slice(last,match.index).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(.+?)';indexes.push(Number(match[1]));last=match.index!+match[0].length;}
 source+=key.slice(last).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return {pattern:new RegExp('^'+source+'$'),value,indexes};
});}
/** Translate presentation text only. Record IDs, stored values and input values stay untouched. */
export function translateText(value:string,selected:Language):string{
 if(selected==='ar'||!/[\u0600-\u06ff]/.test(value))return value;
 const text=value.replace(/\s+/g,' ').trim();
 let translated=dictionary[text];
 if(translated===undefined){for(const entry of patterns){const match=text.match(entry.pattern);if(match){translated=entry.value.replace(/\{(\d+)\}/g,(_,i)=>match[entry.indexes.indexOf(Number(i))+1]||'');break;}}}
 if(translated===undefined&&text.includes(' • '))translated=text.split(' • ').map(part=>translateText(part,selected)).join(' • ');
 if(translated===undefined)return value;
 return (value.match(/^\s*/)?.[0]||'')+translated+(value.match(/\s*$/)?.[0]||'');
}
export function t<T>(value:T):T{return (typeof value==='string'?translateText(value,language):value) as T;}

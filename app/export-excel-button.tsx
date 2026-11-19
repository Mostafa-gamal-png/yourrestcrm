'use client';
// «تصدير Excel» on a page that shows a list (the owner, 2026-11-19, GSCO 2.13.80; lib/list-export.ts says which lists, who and how). Shown
// only while the member may export the list (mayExportList: the screen shows for them, its tab too, and the screen's «تصدير» cell is on);
// nothing for a representative or a marketing officer. A list the page holds is written here, in the browser, from the rows the page
// already shows after its filters (`build`); the two lists the server cuts on the screen (the complaints, «التواصل مع العملاء») are asked
// of GET /api/list-export, which checks the same rule and builds them with the page's own scope. The file is in the page's language.
import {createContext,useContext,useRef,useState,type ReactNode} from 'react';
import {FileSpreadsheet,Loader2} from 'lucide-react';
import {toast} from 'sonner';
import {t,useLanguage} from '@/lib/i18n';
import {today} from '@/lib/crm';
import type {MemberAccess} from '@/lib/permissions';
import {EXPORT_TEXT,LIST_EXPORTS,listExportFileName,listWorkbook,mayExportList,type ExportLanguage,type ExportTable,type ListExportPage} from '@/lib/list-export';
import './export-excel-button.css';

type Who={role:string;access?:MemberAccess|null};
/** The signed-in member, for the buttons of pages that are not handed one (app/crm-app.tsx provides it once). */
export const ListExportMember=createContext<Who|null>(null);
export function ListExportProvider({me,children}:{me:Who|null;children?:ReactNode}){return <ListExportMember.Provider value={me}>{children}</ListExportMember.Provider>;}

function save(bytes:BlobPart,name:string){
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');
 link.href=url;link.download=name;link.rel='noopener';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const messageOf=(error:unknown)=>error instanceof Error?error.message:'';

type Props={page:ListExportPage;me?:Who|null;
 /** The tables of a list the page holds, from what it shows now (its filters and search), in the page's language. Left out for a list
  *  the server builds. */
 build?:(language:ExportLanguage)=>ExportTable[]|Promise<ExportTable[]>;
 /** Asked of the server with the list (GET /api/list-export?page=…&…): the page's own choice of list and search, for a list it builds. */
 params?:Record<string,string>;
 /** The day in the file's name (a report of one day names that day; else today). */
 day?:string;
 disabled?:boolean;small?:boolean;className?:string;
 /** On a line of its own above a list (nothing at all, not an empty line, when the member may not export). */
 row?:boolean};
export function ExportExcelButton({page,me,build,params,day,disabled=false,small=false,className='',row=false}:Props){
 const context=useContext(ListExportMember),who=me===undefined?context:me;
 const {language}=useLanguage(),lang:ExportLanguage=language==='en'?'en':'ar',say=(pair:readonly [string,string])=>lang==='en'?pair[1]:pair[0];
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
 if(!mayExportList(who,page))return null;
 const entry=LIST_EXPORTS[page],server=entry.via==='server'||!build;
 async function run(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   let rows:number,total:number,capped:boolean;
   if(server){
    const query=new URLSearchParams({...params,page,lang});
    const response=await fetch('/api/list-export?'+query.toString(),{cache:'no-store'});
    if(!response.ok){let text='';try{text=((await response.json()) as {error?:string}).error||'';}catch{text='';}throw new Error(text);}
    const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||listExportFileName(page,day||today());
    rows=Number(response.headers.get('x-export-rows'))||0;total=Number(response.headers.get('x-export-total'))||rows;capped=response.headers.get('x-export-capped')==='1';
    save(await response.arrayBuffer(),name);
   }else{
    const file=listWorkbook(await build!(lang),lang);
    ({rows,total,capped}=file);
    save(file.bytes,listExportFileName(page,day||today()));
   }
   if(capped)toast.warning(say(EXPORT_TEXT.capped)+' ('+rows+' / '+total+')');
   else toast.success(say(EXPORT_TEXT.done)+' ('+rows+')');
  }catch(failure){setError(messageOf(failure)||say(EXPORT_TEXT.failed));}
  finally{lock.current=false;setBusy(false);}
 }
 const button=<span className={'list-export no-print '+className} data-list-export={page}>
  <button type="button" className={'btn subtle list-export-action'+(small?' small':'')} disabled={disabled||busy} aria-busy={busy} title={say([entry.ar,entry.en])} onClick={()=>void run()}>
   {busy?<Loader2 size={16} className="spin" aria-hidden="true"/>:<FileSpreadsheet size={16} aria-hidden="true"/>}<span>{busy?say(EXPORT_TEXT.busy):say(EXPORT_TEXT.button)}</span>
  </button>
  {error&&<span className="form-error list-export-error" role="alert">{t(error)}</span>}
 </span>;
 return row?<div className="list-export-row">{button}</div>:button;
}

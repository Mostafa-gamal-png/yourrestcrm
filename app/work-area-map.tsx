'use client';
import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import type * as Leaflet from 'leaflet';
import {Loader2,Pencil,PenLine,Save,Trash2,Undo2,X} from 'lucide-react';
import {t} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import {checkWorkAreaPolygon,ringToGeoJson,type LatLng} from '@/lib/work-area-geometry';
import {createAreaEditor,type AreaEditor} from '@/lib/work-area-editor';
import {mapColors,validWorkAreaReps,validWorkAreaView,WORK_AREA_TEXT,type WorkAreaRep,type WorkAreaState,type WorkAreaView} from '@/lib/work-areas';

/** «خريطة المصانع» (the owner, 2026-11-19: the port of GSCO 2.13.81): the representative's work area (dashed) on the factory map, the
 * manager's choice of representative and the drawing tools. The rules are lib/work-areas.ts; the routes GET and POST /api/work-areas. Kept
 * apart from customer-map.tsx, which only places them. (The purple streets with no customer were removed on 2026-11-21.) */
type Language='ar'|'en';
type Pair=readonly [string,string];
export type MapRefs={map:RefObject<Leaflet.Map|null>;leaflet:RefObject<typeof Leaflet|null>;ready:boolean};

async function readJson<T>(url:string,signal:AbortSignal,valid:(value:never)=>boolean):Promise<T>{
 const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal});
 let body:unknown=null;try{body=await response.json();}catch{/* not JSON: a proxy's page */}
 if(!response.ok){const error=body&&typeof body==='object'&&typeof (body as {error?:unknown}).error==='string'?(body as {error:string}).error:'';throw new Error(error||WORK_AREA_TEXT.failed[0]);}
 if(!valid(body as never))throw new Error(WORK_AREA_TEXT.failed[0]);
 return body as T;
}

/** The representatives a manager may look at (any of their team, also one with no customer yet); nothing for a field member. */
export function useWorkAreaReps(enabled:boolean,key:string){
 const [loaded,setLoaded]=useState<{key:string;reps:WorkAreaRep[]}>({key:'',reps:[]});
 useEffect(()=>{
  if(!enabled)return;
  const ctl=new AbortController();
  readJson<{reps:WorkAreaRep[]}>('/api/work-areas?list=1',ctl.signal,validWorkAreaReps).then(r=>{if(!ctl.signal.aborted)setLoaded({key,reps:r.reps});}).catch(()=>{/* the map works without the list */});
  return()=>ctl.abort();
 },[enabled,key]);
 return enabled&&loaded.key===key?loaded.reps:[];
}

type Loaded={key:string;view?:WorkAreaView;areaError?:string};
/** The area of one representative (GET /api/work-areas?member=); nothing without a connection. Leaving the map aborts the request. */
export function useWorkArea(repId:string,online:boolean,reload:number):WorkAreaState&{view:WorkAreaView|null}{
 const key=repId&&online?repId+'#'+reload:'';
 const [loaded,setLoaded]=useState<Loaded>({key:''});
 useEffect(()=>{
  if(!key)return;
  const ctl=new AbortController(),keep=(patch:Omit<Loaded,'key'>)=>{if(!ctl.signal.aborted)setLoaded({key,...patch});};
  readJson<WorkAreaView>('/api/work-areas?member='+encodeURIComponent(repId),ctl.signal,validWorkAreaView).then(view=>keep({view})).catch(e=>keep({areaError:e instanceof Error&&e.message?e.message:WORK_AREA_TEXT.failed[0]}));
  return()=>ctl.abort();
 },[key,repId]);
 const current=loaded.key===key?loaded:{key} as Loaded;
 return {active:!!key,view:current.view??null,area:current.view?.area??null,areaError:current.areaError??''};
}

/** Draws the outline (the drawn polygon, or the outer edge of the disks around the pins) under the pins (raise puts the pins back on top
 * after every redraw: one canvas, what is drawn last answers a tap first). */
export function useWorkAreaLayers(refs:MapRefs,outline:LatLng[][]|null,showOutline:boolean,raise:()=>void){
 const {map,leaflet,ready}=refs;
 useEffect(()=>{
  const m=map.current,L=leaflet.current;if(!ready||!m||!L||!showOutline||!outline?.length)return;
  const group=L.layerGroup(outline.map(line=>L.polyline(line,{color:mapColors.area,weight:2,opacity:.9,dashArray:'6 6',interactive:false}))).addTo(m);raise();
  return()=>{group.remove();};
 },[ready,map,leaflet,outline,showOutline,raise]);
}

export type EditorMode='view'|'draw'|'edit';
export type AreaEditorState={mode:EditorMode;points:LatLng[];error:string;busy:boolean;confirm:boolean;start:(mode:'draw'|'edit')=>void;save:()=>void;remove:()=>void;askRemove:(on:boolean)=>void;undo:()=>void;cancel:()=>void};
/** The sales manager's drawing for the chosen representative: draw, edit (move, delete or add corners), save, delete (in two steps). The same
 * request is sent again after a lost answer, so the server saves it once. Leaving the map or choosing another representative drops it. */
export function useAreaEditor(refs:MapRefs,repId:string,view:WorkAreaView|null,language:Language,onSaved:(message:Pair)=>void,onEditing:(editing:boolean)=>void):AreaEditorState{
 const [mode,setMode]=useState<EditorMode>('view'),[points,setPoints]=useState<LatLng[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 const editor=useRef<AreaEditor|null>(null),request=useRef<{id:string;body:string}|null>(null),say=(pair:Pair)=>pair[language==='ar'?0:1];
 const area=view?.area??null;
 const stop=useCallback(()=>{try{editor.current?.destroy();}finally{editor.current=null;setMode('view');setPoints([]);onEditing(false);}},[onEditing]);
 useEffect(()=>()=>{if(editor.current){editor.current.destroy();editor.current=null;onEditing(false);}},[repId,onEditing]);
 const start=(next:'draw'|'edit')=>{
  const m=refs.map.current,L=refs.leaflet.current;if(!m||!L||!view?.can_edit)return;
  setError('');setConfirm(false);editor.current?.destroy();
  const initial=next==='edit'&&area?.source==='drawn'?area.rings[0]:[];
  editor.current=createAreaEditor(L,m,{points:initial,mode:next,color:mapColors.area,deleteLabel:say(WORK_AREA_TEXT.deletePoint),cornerLabel:say(WORK_AREA_TEXT.corners),onChange:setPoints});
  setPoints(initial);setMode(next);onEditing(true);
 };
 const send=async(body:Record<string,unknown>,done:Pair)=>{
  const text=JSON.stringify(body);if(request.current?.body!==text)request.current={id:crypto.randomUUID(),body:text};
  setBusy(true);setError('');
  try{await submitJson('/api/work-areas',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,request_id:request.current.id})},{language});request.current=null;stop();setConfirm(false);onSaved(done);}
  catch(e){setError(e instanceof Error&&e.message?t(e.message):say(WORK_AREA_TEXT.failed));}
  finally{setBusy(false);}
 };
 return {mode,points,error,busy,confirm,start,undo:()=>editor.current?.undo(),askRemove:setConfirm,
  cancel:()=>{request.current=null;setError('');stop();},
  save:()=>{const polygon=ringToGeoJson(points),check=checkWorkAreaPolygon(polygon);if(!check.ok){setError(t(check.error));return;}void send({action:'save',rep_id:repId,polygon,version:area?.version??null},WORK_AREA_TEXT.saved);},
  remove:()=>{if(area?.source==='drawn'&&area.version!==null)void send({action:'delete',rep_id:repId,version:area.version},WORK_AREA_TEXT.removed);}};
}

/** In the map's «فلترة» panel, for a manager: the representative whose area shows, the area's lines, and the drawing tools. */
export function WorkAreaSection({reps,value,onChange,view,editor,lines,language,disabled}:{reps:WorkAreaRep[];value:string;onChange:(id:string)=>void;view:WorkAreaView|null;editor:AreaEditorState;lines:string[];language:Language;disabled:boolean}){
 const say=(pair:Pair)=>pair[language==='ar'?0:1],drawn=view?.area.source==='drawn',canEdit=!!view?.can_edit&&view.rep_id===value;
 return <section className="cm-area-section" data-work-area-section aria-label={say(WORK_AREA_TEXT.section)}>
  <h3>{say(WORK_AREA_TEXT.section)}</h3>
  {reps.length>0?<label className="cm-area-field" data-work-area-rep><span>{say(WORK_AREA_TEXT.rep)}</span><select value={reps.some(r=>r.id===value)?value:''} onChange={e=>onChange(e.target.value)} aria-label={say(WORK_AREA_TEXT.rep)} disabled={disabled}>
   <option value="">{say(WORK_AREA_TEXT.chooseRep)}</option>
   {reps.map(r=><option key={r.id} value={r.id}>{r.name+(r.drawn?' · '+say(WORK_AREA_TEXT.areaDrawn):'')}</option>)}
  </select></label>:null}
  {!value&&<p className="cm-hint">{say(WORK_AREA_TEXT.hint)}</p>}
  {!!value&&lines.map((line,i)=><p key={i} className="cm-area-line" role="status">{line}</p>)}
  {canEdit&&editor.mode==='view'&&<div className="cm-area-actions" role="group" aria-label={say(WORK_AREA_TEXT.tools)} data-work-area-tools="view">
   {drawn?<button type="button" className="btn subtle" onClick={()=>editor.start('edit')} disabled={editor.busy||disabled}><Pencil size={16}/>{say(WORK_AREA_TEXT.edit)}</button>
    :<button type="button" className="btn subtle" onClick={()=>editor.start('draw')} disabled={editor.busy||disabled} data-work-area-draw><PenLine size={16}/>{say(WORK_AREA_TEXT.draw)}</button>}
   {drawn&&(editor.confirm?<button type="button" className="btn danger" disabled={editor.busy} onClick={editor.remove} data-work-area-confirm-delete>{editor.busy?<Loader2 size={16} className="spin"/>:<Trash2 size={16}/>}{say(WORK_AREA_TEXT.confirmRemove)}</button>
    :<button type="button" className="btn subtle" disabled={editor.busy||disabled} onClick={()=>editor.askRemove(true)} data-work-area-delete><Trash2 size={16}/>{say(WORK_AREA_TEXT.remove)}</button>)}
  </div>}
  {editor.mode==='view'&&editor.error&&<p className="cm-directions-error" role="alert">{editor.error}</p>}
 </section>;
}

/** Over the map while a work area is drawn: what to do, the corners, save, undo and cancel. */
export function WorkAreaDrawBar({editor,language}:{editor:AreaEditorState;language:Language}){
 const say=(pair:Pair)=>pair[language==='ar'?0:1];
 if(editor.mode==='view')return null;
 return <section className="cm-area-bar" role="group" aria-label={say(WORK_AREA_TEXT.tools)} data-work-area-tools={editor.mode}>
  <p>{say(editor.mode==='draw'?WORK_AREA_TEXT.drawHelp:WORK_AREA_TEXT.editHelp)} <span data-work-area-corners>{say(WORK_AREA_TEXT.corners)}: {editor.points.length}</span></p>
  <div className="cm-area-actions">
   <button type="button" className="btn primary" onClick={editor.save} disabled={editor.busy||editor.points.length<3} data-work-area-save>{editor.busy?<Loader2 size={16} className="spin"/>:<Save size={16}/>}{say(editor.busy?WORK_AREA_TEXT.saving:WORK_AREA_TEXT.save)}</button>
   <button type="button" className="btn subtle" onClick={editor.undo} disabled={editor.busy||!editor.points.length}><Undo2 size={16}/>{say(WORK_AREA_TEXT.undo)}</button>
   <button type="button" className="btn subtle" onClick={editor.cancel} disabled={editor.busy}><X size={16}/>{say(WORK_AREA_TEXT.cancel)}</button>
  </div>
  {editor.error&&<p className="cm-directions-error" role="alert">{editor.error}</p>}
 </section>;
}

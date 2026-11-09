'use client';
// «الصلاحيات» in the member form of «الفريق والصلاحيات» (the owner, 2026-11-09, after GSCO 2.13.61 components/crm/permission-matrix.tsx and
// «انسخ الصلاحيات من» of components/crm/forms.tsx): one row per screen, one column per action (استعراض/إضافة/تحرير/حذف/تصدير/استيراد) and
// «الكل» per row; «—» where the action is not on the screen or not the role's. Restrict-only (lib/permissions.ts): a switch takes away what
// the role does today, never more. Under the table «صلاحيات عامة»: «عرض بيانات الفريق بالكامل». The administrator only; saved on its own
// («حفظ الصلاحيات», POST /api/crm {action:'permissions'}) with its version, so the member form's own save is unchanged.
import {useMemo,useRef,useState} from 'react';
import {Loader2,ShieldCheck,Copy,RefreshCw} from 'lucide-react';
import {toast} from 'sonner';
import {submitJson,SubmitError} from '@/lib/client-submit';
import {useLanguage,getLanguage} from '@/lib/i18n';
import {roles,type Member} from '@/lib/crm';
import {canViewPage} from '@/lib/access';
import {GENERAL_PERMISSIONS,MATRIX_COLUMNS,PERMISSION_ACTIONS,PERMISSION_MATRIX,cellCeiling,cellFixed,cellKey,copyPermissions,normalizePermissions,permissionKeyText,viewAllAvailable,type MatrixRow,type StoredPermissions} from '@/lib/permissions';
import './member-permissions.css';

type Saved=StoredPermissions&{version:number};
const draftOf=(member:Member):Saved=>{const saved=member.permissions;return{version:saved?.version||0,...normalizePermissions(member.role,saved||null)};};
const sameDraft=(a:StoredPermissions,b:StoredPermissions)=>JSON.stringify([a.cells,[...a.hidden].sort(),a.viewAll])===JSON.stringify([b.cells,[...b.hidden].sort(),b.viewAll]);

export function MemberPermissionsEditor({member,members,roleChanged,onSaved}:{member:Member;members:Member[];roleChanged:boolean;onSaved:()=>Promise<unknown>}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en,lang=language==='en'?'en':'ar';
 const start=useMemo(()=>draftOf(member),[member]);
 const [draft,setDraft]=useState<StoredPermissions>(start),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
 const [copyFrom,setCopyFrom]=useState(''),[skipped,setSkipped]=useState<string[]>([]);
 const attempt=useRef<{body:string;requestId:string}|null>(null);
 const role=member.role,admin=role==='admin',dirty=!sameDraft(draft,start);
 const rows=PERMISSION_MATRIX.filter(row=>canViewPage(role,row.screen)||PERMISSION_ACTIONS.some(action=>cellCeiling(role,row.screen,action)));
 const browsable=(row:MatrixRow)=>!admin&&canViewPage(role,row.screen);
 const changeable=(row:MatrixRow)=>PERMISSION_ACTIONS.filter(action=>cellCeiling(role,row.screen,action)&&!cellFixed(role,cellKey(row.screen,action)));
 const shown=(row:MatrixRow)=>!draft.hidden.includes(row.screen);
 const allOn=(row:MatrixRow)=>(!browsable(row)||shown(row))&&changeable(row).every(action=>draft.cells[cellKey(row.screen,action)]);
 const setCell=(key:string,on:boolean)=>setDraft(current=>({...current,cells:{...current.cells,[key]:on}}));
 const setShown=(row:MatrixRow,on:boolean)=>setDraft(current=>({...current,hidden:on?current.hidden.filter(screen=>screen!==row.screen):[...current.hidden.filter(screen=>screen!==row.screen),row.screen]}));
 const setRow=(row:MatrixRow,on:boolean)=>setDraft(current=>{const cells={...current.cells};for(const action of changeable(row))cells[cellKey(row.screen,action)]=on;const hidden=browsable(row)?on?current.hidden.filter(screen=>screen!==row.screen):[...current.hidden.filter(screen=>screen!==row.screen),row.screen]:current.hidden;return{...current,cells,hidden};});
 const sources=members.filter(other=>other.id!==member.id&&!other.readOnly&&!!other.permissions);
 function copy(id:string){
  setCopyFrom(id);const source=sources.find(other=>other.id===id);if(!source?.permissions)return;
  const result=copyPermissions({role:source.role,stored:normalizePermissions(source.role,source.permissions)},role);
  setDraft(result.stored);setSkipped(result.skipped);
 }
 async function save(){
  if(busy||!dirty||roleChanged)return;setBusy(true);setError('');
  const body=JSON.stringify({action:'permissions',memberId:member.id,version:start.version,cells:draft.cells,hidden:draft.hidden,viewAll:draft.viewAll});
  // A retry of the same save (an answer lost on the way) carries the same request id and is answered as it was.
  if(attempt.current?.body!==body)attempt.current={body,requestId:crypto.randomUUID()};
  try{
   await submitJson('/api/crm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(body),requestId:attempt.current.requestId})},{language:getLanguage()});
   attempt.current=null;setSkipped([]);setCopyFrom('');
   toast.success(say('تم حفظ الصلاحيات. بتطبق على المستخدم من أول تحديث للصفحة عنده.','Permissions saved. They apply to the member from their next page refresh.'));
   await onSaved();
  }catch(failure){
   const status=failure instanceof SubmitError?failure.status:0;
   if(status===409)setConflict(true);
   setError(failure instanceof Error?failure.message:say('تعذر حفظ الصلاحيات.','The permissions were not saved.'));
  }finally{setBusy(false);}
 }
 async function reload(){setBusy(true);try{await onSaved();}finally{setBusy(false);}}
 const box=(checked:boolean,disabled:boolean,label:string,onChange:(on:boolean)=>void)=><input type="checkbox" className="permission-box" aria-label={label} checked={checked} disabled={disabled||busy} onChange={event=>onChange(event.target.checked)}/>;
 const none=(title:string)=><span className="permission-none" title={title} aria-label={title}>—</span>;
 return <section className="member-permissions full" aria-labelledby="member-permissions-heading" data-member-permissions={member.id}>
  <header className="member-permissions-head"><ShieldCheck size={19} aria-hidden="true"/><div><h3 id="member-permissions-heading">{say('الصلاحيات','Permissions')}</h3><p>{say('لـ','For ')}<strong>{member.name}</strong> · {say(roles[role]||role,role)}</p></div></header>
  {admin&&<p className="member-permissions-note">{say('مدير النظام بيشوف كل الشاشات دايمًا، و«الفريق والصلاحيات» مفتوحة له دايمًا علشان محدش يتقفل برّه.','An administrator always sees every screen, and «Team and permissions» stays open so nobody is locked out.')}</p>}
  {roleChanged&&<p className="member-permissions-note warn" role="status">{say('غيّرت الدور: احفظ المستخدم الأول، وبعدها الصلاحيات بتتظبط على الدور الجديد.','You changed the role: save the member first; the permissions then follow the new role.')}</p>}
  <div className="member-permissions-copy">
   <label className="field"><span><Copy size={14} aria-hidden="true"/> {say('انسخ الصلاحيات من','Copy permissions from')}</span>
    <select value={copyFrom} disabled={busy||roleChanged} onChange={event=>copy(event.target.value)} aria-label={say('انسخ الصلاحيات من','Copy permissions from')}>
     <option value="">—</option>
     {sources.map(other=><option key={other.id} value={other.id}>{other.name} · {say(roles[other.role]||other.role,other.role)}</option>)}
    </select>
   </label>
   {skipped.length>0&&<p className="member-permissions-note" role="status" data-permissions-skipped>{say('ما اتنسخش (مش من شغل دوره): ','Not copied (not this role\'s): ')}{skipped.map(key=>permissionKeyText(key,lang)).join('، ')}</p>}
  </div>
  <div className="member-permissions-scroll">
   <table className="permission-matrix" data-permission-matrix>
    <thead><tr><th scope="col">{say('الشاشة','Screen')}</th><th scope="col">{say('الكل','All')}</th>{MATRIX_COLUMNS.map(column=><th scope="col" key={column.key}>{column[lang]}</th>)}</tr></thead>
    <tbody>{rows.map(row=>{const free=changeable(row).length>0||browsable(row);return <tr key={row.screen} data-matrix-row={row.screen}>
     <th scope="row">{row[lang]}</th>
     <td>{free?box(allOn(row),roleChanged,say('الكل · ','All · ')+row[lang],on=>setRow(row,on)):none(say('مفيش حاجة تتغير هنا','Nothing to change here'))}</td>
     {MATRIX_COLUMNS.map(column=>{
      if(column.key==='browse')return <td key="browse" data-cell={'browse:'+row.screen}>{browsable(row)?box(shown(row),roleChanged,column[lang]+' · '+row[lang],on=>setShown(row,on)):none(admin?say('مدير النظام بيشوف كل الشاشات','An administrator sees every screen'):say('الشاشة مش من شغل الدور','Not this role\'s screen'))}</td>;
      const cell=row.cells[column.key],key=cellKey(row.screen,column.key);
      if(!cell||!cellCeiling(role,row.screen,column.key))return <td key={column.key} data-cell={key}>{none(cell?say('مش من شغل الدور','Not this role\'s'):say('الإجراء ده مش موجود في الشاشة','No such action on this screen'))}</td>;
      return <td key={column.key} data-cell={key} title={cell[lang]+(cell.note?' — '+cell.note[lang]:'')}>{box(!!draft.cells[key],cellFixed(role,key)||roleChanged,column[lang]+' · '+row[lang],on=>setCell(key,on))}{cell.note&&<span className="permission-star" aria-hidden="true">*</span>}</td>;
     })}
    </tr>;})}</tbody>
   </table>
  </div>
  <p className="member-permissions-foot">{say('«—» يعني الإجراء مش موجود في الشاشة أو مش من شغل الدور. الصلاحيات بتقفل حاجة الدور بيعملها النهارده بس، ومبتزوّدش عليه. «*» فيه ملاحظة: وقّف الماوس على الخانة. التصدير بيتقفل من زرار الصفحة (الملف بيتعمل على الجهاز).','«—» means the action is not on the screen or not the role\'s. Permissions only take away what the role does today; they never add to it. «*» has a note: hover the cell. Export is closed by hiding the page\'s button (the file is made on the device).')}</p>
  <h4 className="member-permissions-general">{say('صلاحيات عامة','General permissions')}</h4>
  {viewAllAvailable(role)?<label className="member-permissions-switch" data-permission="viewAll"><input type="checkbox" checked={draft.viewAll} disabled={busy||roleChanged} onChange={event=>setDraft(current=>({...current,viewAll:event.target.checked}))}/><span><strong>{GENERAL_PERMISSIONS.viewAll[lang]}</strong><small>{GENERAL_PERMISSIONS.viewAll.note[lang]}</small></span></label>
   :<p className="member-permissions-note">{say('مفيش صلاحيات عامة لدور ','No general permissions for the role ')}{say(roles[role]||role,role)}{say(' (عرض بيانات الفريق بالكامل للمشرف ومدير المبيعات).',' («View the whole team\'s data» is for a supervisor or a sales manager).')}</p>}
  {error&&<div className="form-error" role="alert">{error}</div>}
  <div className="member-permissions-actions">
   {conflict&&<button type="button" className="btn subtle" disabled={busy} onClick={()=>{setConflict(false);setError('');void reload();}}><RefreshCw size={16}/>{say('تحميل أحدث الصلاحيات','Load the latest permissions')}</button>}
   {dirty&&<button type="button" className="btn subtle" disabled={busy} onClick={()=>{setDraft(start);setSkipped([]);setCopyFrom('');setError('');}}>{say('تراجع عن التغييرات','Undo changes')}</button>}
   <button type="button" className="btn primary" data-save-permissions disabled={busy||!dirty||roleChanged||conflict} onClick={()=>void save()}>{busy?<Loader2 className="spin" size={17}/>:<ShieldCheck size={17}/>}{say('حفظ الصلاحيات','Save permissions')}</button>
  </div>
 </section>;
}

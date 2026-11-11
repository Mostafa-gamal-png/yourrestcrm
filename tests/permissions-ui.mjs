// «الصلاحيات» in the member form (app/member-permissions.tsx) rendered from the source, Arabic and English: one row per screen the role has
// (or acts on), «الكل» per row, «—» where the action is not on the screen or not the role's, the administrator's team cells always on and
// nothing to hide from an administrator, «عرض بيانات الفريق بالكامل» for a supervisor and a sales manager only, «انسخ الصلاحيات من» listing
// the other members, and a copied draft (lib/permissions.ts copyPermissions) shown with what was skipped. «حذف» (2026-11-09): a cell for every
// role that has the screen (not customer service: «—»), unticked by default for everyone but the administrator, with its scope note.
// «المحذوفات» (2026-11-10): a row for the supervisor and the representative too («استعراض» and «تحرير», restrict-only) with the note «لمن
// عنده «حذف»: اللي حذفه هو بس». No browser or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map(),compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let checks=0,language='ar';const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
function library(filename){if(cache.has(filename))return cache.get(filename);const holder={exports:{}};cache.set(filename,holder.exports);const require=name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):nativeRequire(name);vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports:holder.exports,module:holder,require,JSON,Object,Array,Set,Map,Number,String,Boolean,Error});cache.set(filename,holder.exports);return holder.exports;}
const P=library('lib/permissions.ts'),access=library('lib/access.ts');
const roles={admin:'مدير النظام',manager:'مدير المبيعات',supervisor:'مشرف المبيعات',rep:'مندوب المبيعات',customer_service_manager:'مدير خدمة العملاء',customer_service:'ممثل خدمة العملاء'};
const icons=new Proxy({},{get:()=>()=>null});
const modules={react:React,'react/jsx-runtime':jsx,'lucide-react':icons,sonner:{toast:{success(){},error(){}}},'@/lib/client-submit':{submitJson:async()=>({}),SubmitError:class extends Error{}},'@/lib/i18n':{useLanguage:()=>({language}),getLanguage:()=>language},'@/lib/crm':{roles},'@/lib/access':access,'@/lib/permissions':P};
const source=ts.transpileModule(fs.readFileSync(path.join(root,'app/member-permissions.tsx'),'utf8'),{compilerOptions:compiler}).outputText;
const exportsOf={};vm.runInNewContext(source,{exports:exportsOf,require:name=>name.endsWith('.css')?{}:modules[name]??nativeRequire(name),crypto,JSON,Object,Array,Set,Map});
const {MemberPermissionsEditor}=exportsOf;
const person=(id,role,permissions)=>({id,role,name:'اسم '+id,email:id+'@yourrest.org',branch:'الرئيسي',active:1,target:0,permissions});
const saved=(role,input={},version=1)=>({version,...P.normalizePermissions(role,input)});
const render=(member,members=[member],roleChanged=false)=>renderToStaticMarkup(React.createElement(MemberPermissionsEditor,{member,members,roleChanged,onSaved:async()=>{}}));
const rows=html=>[...html.matchAll(/data-matrix-row="([^"]+)"/g)].map(match=>match[1]);
const cell=(html,key)=>{const start=html.indexOf('data-cell="'+key+'"');assert.ok(start>0,'cell '+key);return html.slice(start,html.indexOf('</td>',start));};
const isBox=(html,key)=>/type="checkbox"/.test(cell(html,key)),isNone=(html,key)=>cell(html,key).includes('>—<'),isChecked=(html,key)=>/checked=""/.test(cell(html,key)),isDisabled=(html,key)=>/disabled=""/.test(cell(html,key));

// A supervisor never saved: every cell of the role on but «حذف»; the rows are the screens the role has or acts on, in the navigation's order.
let sup=person('sup','supervisor',saved('supervisor',{},0)),html=render(sup);
eq(rows(html),['dashboard','customer','map','activity','followup','mold-requests','journeys','quote','sales','competitors','targets','trash'],'the supervisor\'s screens («المحذوفات» since 2026-11-10: it comes with «حذف»)');
const rowNote=(html,screen)=>{const start=html.indexOf('data-matrix-row="'+screen+'"'),row=html.slice(start,html.indexOf('</tr>',start));return (/data-row-note="true">([^<]*)</.exec(row)||[])[1]||'';};
eq([isBox(html,'browse:trash'),isChecked(html,'browse:trash'),isBox(html,'trash:edit'),isChecked(html,'trash:edit'),rowNote(html,'trash')],[true,true,true,true,'لمن لديه «حذف»: ما حذفه هو فقط'],'«المحذوفات» for a supervisor: «استعراض» and «تحرير» on (restrict-only), and the note');
ok(cell(html,'trash:edit').includes('ما دام «حذف» في شاشة السجل مفتوحًا له'),'«تحرير» says restoring needs the record\'s «حذف»');
eq(rowNote(html,'sales'),'','no note on other rows');
for(const head of ['الشاشة','الكل','استعراض','إضافة','تحرير','حذف','تصدير','استيراد'])ok(html.includes('>'+head+'</th>'),'column «'+head+'»');
eq([isBox(html,'browse:sales'),isChecked(html,'browse:sales'),isBox(html,'sales:import'),isChecked(html,'sales:import')],[true,true,true,true],'«المبيعات»: shown, import on');
eq([isNone(html,'customer:import'),isNone(html,'dashboard:add'),isNone(html,'targets:edit')],[true,true,true],'«—» where the supervisor\'s role has no such action (or the screen none)');
ok(cell(html,'customer:import').includes('title="ليس من عمل الدور"'),'and why, on the dash');
// «حذف»: shown for every screen the role has, unticked by default, free to tick; «الكل» includes it.
for(const key of ['customer:delete','activity:delete','followup:delete','quote:delete','sales:delete'])eq([isBox(html,key),isChecked(html,key),isDisabled(html,key)],[true,false,false],'supervisor never saved: '+key+' shown, unticked, free');
ok(cell(html,'customer:delete').includes('مغلقة افتراضيًا لكل الأدوار عدا مدير النظام')&&cell(html,'customer:delete').includes('*'),'with its note: off by default, grantable, within what they may edit');
ok(!/checked=""/.test(allBox0(html,'sales')),'«الكل» of «المبيعات» unchecked while «إلغاء بيع» is off');
ok(!html.includes('زرار الحذف في الصفحة لمدير النظام بس'),'the old «administrator only button» note is gone');
ok(html.includes('عدا «حذف»: مغلق افتراضيًا لكل الأدوار عدا مدير النظام'),'the footer says «حذف» is the exception');
function allBox0(html,screen){const start=html.indexOf('data-matrix-row="'+screen+'"'),row=html.slice(start,html.indexOf('</tr>',start));return row.split('<td>')[1].split('</td>')[0];}
ok(html.includes('data-permission="viewAll"')&&html.includes('عرض بيانات الفريق بالكامل'),'«صلاحيات عامة»: «عرض بيانات الفريق بالكامل» for a supervisor');
ok(/data-permission="viewAll"><input type="checkbox"(?![^>]*checked)/.test(html),'off by default');
ok(html.includes('data-save-permissions')&&/data-save-permissions="true" disabled=""|disabled=""[^>]*data-save-permissions/.test(html),'«حفظ الصلاحيات» waits for a change');
ok(cell(html,'activity:delete').includes('*'),'a cell with a note carries «*»');
// «الكل» of a row: checked when the screen shows and every changeable cell is on.
const allBox=(html,screen)=>{const start=html.indexOf('data-matrix-row="'+screen+'"'),row=html.slice(start,html.indexOf('</tr>',start));return row.split('<td>')[1].split('</td>')[0];};
ok(/type="checkbox"[^>]*checked=""/.test(allBox(html,'competitors')),'«الكل» of «المنافسين» checked');
html=render(person('sup','supervisor',saved('supervisor',{cells:{'sales:delete':true}})));
ok(/type="checkbox"[^>]*checked=""/.test(allBox(html,'sales'))&&isChecked(html,'sales:delete'),'granted «إلغاء بيع»: ticked, and «الكل» of «المبيعات» checked');
sup=person('sup','supervisor',saved('supervisor',{cells:{'sales:import':false},hidden:['competitors'],viewAll:true}));html=render(sup);
eq([isChecked(html,'sales:import'),isChecked(html,'sales:add'),isChecked(html,'browse:competitors')],[false,true,false],'saved values shown');
ok(!/checked=""/.test(allBox(html,'sales'))&&!/checked=""/.test(allBox(html,'competitors')),'«الكل» unchecked when one cell of the row is off or the screen hidden');
ok(/data-permission="viewAll"><input type="checkbox" checked=""/.test(html),'viewAll saved on');
// The administrator: nothing to hide (browse «—»), team cells on and fixed, other cells may be switched off.
const owner=person('owner','admin',saved('admin',{cells:{'customer:delete':false}}));html=render(owner,[owner,sup]);
eq(rows(html),[...P.PERMISSION_SCREENS],'the administrator: every screen');
eq([isNone(html,'browse:team'),isNone(html,'browse:dashboard'),isChecked(html,'team:edit'),isDisabled(html,'team:edit'),isDisabled(html,'team:add'),isChecked(html,'customer:delete'),isDisabled(html,'customer:delete')],[true,true,true,true,true,false,false],'never locked out, other cells free');
eq(['activity:delete','followup:delete','quote:delete','sales:delete'].map(key=>isChecked(html,key)),[true,true,true,true],'the administrator\'s «حذف» ticked by default');
ok(html.includes('يرى مدير النظام كل الشاشات دائمًا'),'and told why');
ok(!html.includes('data-permission="viewAll"'),'no viewAll switch for an administrator (they see everything)');
// A representative and customer service: only their screens; no general switch.
html=render(person('rep1','rep',saved('rep',{},0)));
eq(rows(html),['customer','map','activity','followup','mold-requests','targets','trash'],'the representative\'s screens («المحذوفات» with «حذف»)');
eq([isBox(html,'browse:trash'),isBox(html,'trash:edit'),rowNote(html,'trash')],[true,true,'لمن لديه «حذف»: ما حذفه هو فقط'],'the representative: «المحذوفات» switches and the note');
eq([isBox(html,'customer:add'),isNone(html,'customer:export'),isNone(html,'activity:edit'),isNone(html,'targets:edit')],[true,true,true,true],'a representative adds customers, never exports them nor edits a saved visit');
eq(['customer:delete','activity:delete','followup:delete'].map(key=>[isBox(html,key),isChecked(html,key)]),[[true,false],[true,false],[true,false]],'a representative: «حذف» grantable on customers, visits and follow-ups, unticked');
ok(cell(html,'activity:delete').includes('للمندوب: زياراته ومتابعاته هو فقط'),'with the representative\'s scope');
ok(!html.includes('data-permission="viewAll"')&&html.includes('لا توجد صلاحيات عامة لدور'),'no «عرض بيانات الفريق بالكامل» for a representative');
html=render(person('cs','customer_service',saved('customer_service',{},0)));
eq(rows(html),['customer','activity','complaints','mold-requests'],'customer service: «العملاء» for its edit (not a screen of its own: «استعراض» «—»)');
eq([isNone(html,'browse:customer'),isBox(html,'customer:edit'),isBox(html,'browse:complaints')],[true,true,true],'customer service: the customer row is only its edit');
eq([isNone(html,'customer:delete'),isNone(html,'activity:delete')],[true,true],'customer service: «—» for deleting (no customers screen; their service requests are never deleted)');
eq(isNone(render(person('csm','customer_service_manager',saved('customer_service_manager',{cells:{'activity:delete':true}},1))),'activity:delete'),true,'the customer-service manager too, whatever was sent');
// «انسخ الصلاحيات من»: the other members (not the edited one), each with their role.
const mgr=person('mgr','manager',saved('manager',{cells:{'quote:delete':false,'activity:delete':true},hidden:['trash','competitors'],viewAll:true}));
html=render(sup,[sup,mgr,owner,{...person('old','rep',undefined),readOnly:true}]);
eq([...html.matchAll(/<option value="([^"]*)"/g)].map(match=>match[1]),['','mgr','owner'],'copy from: the others with saved permissions (none from a read-only row)');
ok(html.includes('اسم mgr · مدير المبيعات'),'named with their role');
// A copied draft, as the component sets it: the values within the supervisor's role, what was skipped listed.
const copied=P.copyPermissions({role:'manager',stored:P.normalizePermissions('manager',mgr.permissions)},'supervisor');
html=render({...sup,permissions:{version:sup.permissions.version,...copied.stored}},[sup,mgr]);
eq([isChecked(html,'quote:delete'),isChecked(html,'activity:delete'),isChecked(html,'browse:competitors'),isChecked(html,'sales:import')],[false,true,false,true],'the copy: quote delete off, the granted visit delete copied, competitors hidden, the rest as the manager');
eq([...copied.skipped],['customer:import','targets:edit'],'skipped: what the supervisor cannot hold (a delete cell is copied: the supervisor has the screen; «المحذوفات» too since 2026-11-10)');
eq(isChecked(html,'browse:trash'),false,'the manager\'s hidden «المحذوفات» copied');
// A role changed in the form and not yet saved: every switch waits.
html=render(sup,[sup],true);
ok(html.includes('احفظ المستخدم أولًا')&&isDisabled(html,'sales:add'),'a changed role: save the member first');
// English.
language='en';html=render(sup,[sup,mgr]);
for(const text of ['Permissions','Screen','All','View','Add','Edit','Delete','Export','Import','Copy permissions from','General permissions','View the whole team','Save permissions','Customers','Daily route'])ok(html.includes(text),'English: '+text);
ok(!/[؀-ۿ]{3,}/.test(html.replace(/اسم [a-z0-9]+|مدير المبيعات|مشرف المبيعات/g,'')),'no Arabic left in the English matrix but the members\' names');
console.log(JSON.stringify({ok:true,checks}));

// «دايمًا كامل» on the import screen, without a browser (the real component with controlled hooks and network, as
// tests/erp-sales-auto-mapping-ui.mjs): every preview and commit sends wholeCompany; a preview that replaces saved invoices shows the
// period, the replaced, moved and removed counts, the period's saved net before and after and a row for each representative who ends at
// zero, marks those documents with their own notice (never the red problem mark), and asks for an explicit agreement that the commit
// carries; a supervisor's preview (no replacement) looks as before; the receipt says what was replaced; English shows no Arabic but names.
// The real browser at 360 px: tests/erp-sales-replace-browser.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync('app/erp-sales-import.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=(tree,p)=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(n=>nodes(n,p)):[...(p(tree)?[tree]:[]),...nodes(tree.props?.children,p)];
const text=tree=>tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);
const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&text(n).trim()===label)[0];
const footer=tree=>nodes(tree,n=>n.type==='footer')[0];
const byClass=(tree,name)=>nodes(tree,n=>String(n.props?.className||'').split(' ').includes(name));
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(a,m)=>{assert.ok(a,m);checks++;};
const options={members:[{id:'rep1',name:'Rep One',branch:'Jeddah'},{id:'rep2',name:'Rep Two',branch:'Jeddah'},{id:'rep3',name:'Rep Three',branch:'Jeddah'}],employeeMappings:[],categoryMappings:[],products:[]};
const document=(reference,status,extra={})=>({key:'k-'+reference,reference,date:'2026-08-05',documentType:'sale',customerName:'Factory',employeeId:'E1',employeeName:'Employee',repId:'rep1',repName:'Rep One',lineCount:1,totalCents:100000,status,reason:'',...extra});
const replacing=()=>({previewToken:'token-1',employees:[],categories:[],warnings:[],
 documents:[document('A-1','duplicate'),document('A-2','moved',{repId:'rep2',repName:'Rep Two',reason:'الفاتورة محفوظة لمندوب آخر؛ تُنقل إلى المندوب المرتبط في الملف بمحتوى الملف',saved:{repId:'rep1',repName:'Rep One',totalCents:100000}}),
  document('B-1','replaced',{repId:'rep2',repName:'Rep Two',totalCents:70000,reason:'الفاتورة محفوظة بمحتوى مختلف؛ يحل محتوى الملف محل المحفوظ',saved:{repId:'rep2',repName:'Rep Two',totalCents:80000}}),
  document('D-1','removed',{repId:'rep3',repName:'Rep Three',totalCents:0,reason:'محفوظة سابقًا في فترة الملف وليست فيه (أُلغيت أو صُححت في ERP)؛ تُحذف',saved:{repId:'rep3',repName:'Rep Three',totalCents:600000}}),
  document('N-1','new')],
 summary:{newCount:1,duplicateCount:1,conflictCount:0,excludedCount:0,unmappedCount:0,totalCents:100000,months:['2026-08'],replacedCount:1,movedCount:1,removedCount:1},
 replacement:{from:'2026-08-03',to:'2026-08-15',replacedCount:1,movedCount:1,removedCount:1,keptOutsideCount:2,periodBeforeCents:1580000,periodAfterCents:1070000,zeroReps:[{repId:'rep3',repName:'Rep Three',beforeCount:1,beforeCents:600000}]}});
const supervisor=()=>{const data=replacing();delete data.replacement;for(const key of ['replacedCount','movedCount','removedCount'])delete data.summary[key];data.documents=[document('A-1','duplicate'),document('B-1','conflict',{reason:'رقم المستند محفوظ بمحتوى أو ربط مختلف؛ لن يتم استبداله'})];Object.assign(data.summary,{newCount:0,conflictCount:1});return data;};
function harness(language='en'){
 const slots=[],effects=[],responses=[],requests=[];let cursor=0;
 const hooks={useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>slots[i].value=typeof next==='function'?next(slots[i].value):next];},useRef(initial){const i=cursor++;return slots[i]||(slots[i]={current:initial});},useMemo:callback=>callback(),useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps?.some((value,j)=>!Object.is(value,old.deps?.[j]))){slots[i]={deps};effects.push(effect);}}};
 const submit={SubmitError:class extends Error{},definiteSubmitRejection:()=>false,submitJson:async(url,request)=>{requests.push({url,...request});if(!request.method)return options;const response=responses.shift();assert(response,'Unexpected import request');if(response instanceof Error)throw response;return response;}};
 const pass=({children})=>children||null,ui=new Proxy({},{get:()=>pass}),exports={};
 const require=name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:name==='@/lib/client-submit'?submit:name==='@/lib/i18n'?{t:x=>x,useLanguage:()=>({language})}:ui;
 class FileReader{readAsDataURL(){this.result='data:application/octet-stream;base64,dGVzdA==';queueMicrotask(()=>this.onload());}}
 vm.runInNewContext(source,{exports,require,FileReader,queueMicrotask,AbortController,crypto:{randomUUID:()=> 'test-request-id'},requestAnimationFrame:callback=>callback()});
 return{requests,language,respond:value=>responses.push(value),render(){cursor=0;const tree=exports.default({onClose:()=>{},onImported:()=>{}});for(const effect of effects.splice(0))effect();return tree;}};
}
async function readPreview(h,result){h.render();await settle();let tree=h.render();const file=nodes(tree,n=>n.type==='input'&&n.props.type==='file')[0];file.props.onChange({target:{files:[{name:'sales.xlsx',size:4}],value:'sales.xlsx'}});await settle();tree=h.render();h.respond(result);await button(tree,h.language==='ar'?'قراءة التقرير ومعاينته':'Read and preview report').props.onClick();return h.render();}
const names=['Rep One','Rep Two','Rep Three','Factory','Employee','ERP'];
const arabicLeft=value=>value.split(/[\n·:→←—()]/).map(part=>part.trim()).filter(part=>/[؀-ۿ]/.test(part)&&!names.includes(part));

for(const language of ['ar','en']){
 const say=(ar,en)=>language==='ar'?ar:en,confirmLabel=say('تأكيد الاستيراد','Confirm import');
 const h=harness(language);let tree=await readPreview(h,replacing());
 eq(JSON.parse(h.requests.at(-1).body).wholeCompany,true,language+': the preview asks for the whole-company replacement');
 const section=byClass(tree,'erp-import-replace')[0];ok(section,language+': the replacement section is shown');
 const sectionText=text(section);
 ok(sectionText.includes('2026-08-03 — 2026-08-15'),language+': with the period');
 eq(Array.from(byClass(section,'erp-import-replace-counts')[0].props.children,cell=>text(cell.props.children[1])),['1','1','1'],language+': replaced, moved and removed counted');
 ok(sectionText.includes(say('15,800.00 ← 10,700.00','15,800.00 → 10,700.00')),language+': the period\'s saved net before and after');
 const zero=byClass(section,'erp-import-zero-reps')[0];ok(text(zero).includes('Rep Three')&&text(zero).includes(say('6,000.00 ← 0.00','6,000.00 → 0.00')),language+': the representative who ends at zero, from his saved net to zero');
 ok(sectionText.includes(say('حسب الأشهر','by month'))&&!sectionText.includes(say('حسب المندوب','by rep')),language+': splitting is by months, never by rep');
 if(language==='en')eq(arabicLeft(sectionText),[],'en: no Arabic left in the replacement section');
 // Not a problem: no red mark, no problem box; its own mark on the rows.
 eq(byClass(tree,'erp-import-problems').length,0,language+': replacing is not a problem');
 const rows=nodes(tree,n=>n.type==='tr'&&n.props['data-replace']==='true');
 eq([rows.length,rows.every(r=>r.props['data-problem']===undefined)],[3,true],language+': three rows with the notice mark, none red');
 const cards=nodes(tree,n=>n.type==='article'&&n.props['data-replace']==='true');eq(cards.length,3,language+': and three cards on a phone');
 ok(text(nodes(tree,n=>n.type==='tr'&&n.key==='k-A-2')[0]).includes(say('Rep One ← Rep Two','Rep One → Rep Two')),language+': the moved invoice says from whom to whom');
 ok(text(nodes(tree,n=>n.type==='tr'&&n.key==='k-B-1')[0]).includes(say('المحفوظ','Saved')+' 800.00'),language+': the replaced invoice shows its saved net');
 if(language==='en'){const reasons=nodes(tree,n=>n.type==='tr'&&n.props['data-replace']==='true').map(text).join('\n');eq(arabicLeft(reasons),[],'en: the reasons are translated');}
 // The agreement: the commit waits for it and carries it.
 const confirm=nodes(section,n=>n.type==='input'&&n.props.type==='checkbox')[0];eq(confirm.props.checked,false,language+': the agreement starts unticked');
 eq(button(footer(tree),confirmLabel).props.disabled,true,language+': no commit before the agreement');
 ok(text(footer(tree)).includes(say('وافق على الاستبدال','Agree to the replacement')),language+': the footer says why');
 confirm.props.onChange({target:{checked:true}});tree=h.render();
 eq(button(footer(tree),confirmLabel).props.disabled,false,language+': the agreement enables the commit');
 h.respond({importedCount:1,duplicateCount:1,excludedCount:0,months:['2026-08'],replacement:replacing().replacement});await button(footer(tree),confirmLabel).props.onClick();tree=h.render();
 const sent=JSON.parse(h.requests.at(-1).body);eq([sent.action,sent.wholeCompany,sent.replaceExisting,sent.previewToken],['commit',true,true,'token-1'],language+': the commit carries the flag, the agreement and its preview');
 const receipt=byClass(footer(tree),'erp-import-replace-receipt')[0];ok(receipt&&text(receipt).includes('2026-08-03 — 2026-08-15'),language+': the receipt says what was replaced');
 if(language==='en')eq(arabicLeft(text(receipt)),[],'en: no Arabic left in the receipt');
 // A supervisor's preview: as before.
 const s=harness(language);tree=await readPreview(s,supervisor());
 eq([byClass(tree,'erp-import-replace').length,nodes(tree,n=>n.props?.['data-replace']==='true').length],[0,0],language+': a supervisor sees no replacement');
 ok(text(tree).includes(say('لن تُستبدل أي فاتورة سابقة تلقائيًا','Existing invoices are never overwritten automatically')),language+': and the old notice');
 eq(nodes(tree,n=>n.type==='tr'&&n.props['data-problem']==='true').length,1,language+': the conflict is still red');
}
// The size message points to months, never to reps.
const page=fs.readFileSync('app/erp-sales-import.tsx','utf8'),server=fs.readFileSync('lib/erp-sales-server.ts','utf8'),parser=fs.readFileSync('lib/erp-sales.ts','utf8');
for(const [name,body] of [['page',page],['server',server],['parser',parser]])ok(!/حسب المندوب|لكل مندوب ملف|by rep\b/.test(body.replace(/\/\/.*$/gm,'')),name+': nothing asks to split a report by representative');
ok(page.includes('عدة ملفات حسب الأشهر')&&server.includes('عدة ملفات حسب الأشهر')&&parser.includes('عدة ملفات حسب الأشهر'),'the limits say: by months');
console.log(JSON.stringify({ok:true,checks,realBrowser:false}));

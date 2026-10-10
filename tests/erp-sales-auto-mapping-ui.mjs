// Exercise the real import component with controlled hooks/network, without a browser.
// Inferred selections must not silently change the captured preview or retry payload.
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
const select=tree=>nodes(tree,n=>n.type==='select'&&String(n.props['aria-label']||'').includes('employee'))[0];
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(a,m)=>{assert.ok(a,m);checks++;};
const options={members:[{id:'rep1',name:'Same Employee',branch:'West'},{id:'rep2',name:'Another Rep',branch:'West'}],employeeMappings:[],categoryMappings:[],products:[]};
const preview=(repId='rep1',mappingSource='name')=>({previewToken:'captured-preview-token',employees:[{employeeId:'7018',employeeName:'Same Employee',repId,mappingSource}],categories:[],documents:[{key:'invoice',reference:'INV-1',date:'2026-10-01',documentType:'sale',customerName:'Factory',employeeId:'7018',employeeName:'Same Employee',repId,repName:options.members.find(m=>m.id===repId)?.name||'',lineCount:1,totalCents:10000,status:repId?'new':'unmapped',reason:''}],summary:{newCount:repId?1:0,duplicateCount:0,conflictCount:0,excludedCount:0,unmappedCount:repId?0:1,totalCents:10000,months:['2026-10']},warnings:[]});
function harness(config=options,language='en'){
 const slots=[],effects=[],responses=[],requests=[];let cursor=0,tree,refreshes=0;
 const hooks={useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>slots[i].value=typeof next==='function'?next(slots[i].value):next];},useRef(initial){const i=cursor++;return slots[i]||(slots[i]={current:initial});},useMemo:callback=>callback(),useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps?.some((value,j)=>!Object.is(value,old.deps?.[j]))){slots[i]={deps};effects.push(effect);}}};
 const submit={SubmitError:class extends Error{},definiteSubmitRejection:()=>false,submitJson:async(url,request,options)=>{requests.push({url,...request,onUploadProgress:options?.onUploadProgress});if(!request.method)return config;const response=responses.shift();assert(response,'Unexpected import request');if(response instanceof Error)throw response;return response;}};
 const pass=({children})=>children||null,ui=new Proxy({},{get:()=>pass}),exports={};
 const require=name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:name==='@/lib/client-submit'?submit:name==='@/lib/i18n'?{t:x=>x,useLanguage:()=>({language})}:ui;
 class FileReader{readAsDataURL(){this.result='data:application/octet-stream;base64,dGVzdA==';queueMicrotask(()=>this.onload());}}
 vm.runInNewContext(source,{exports,require,FileReader,queueMicrotask,AbortController,crypto:{randomUUID:()=> 'test-request-id'},requestAnimationFrame:callback=>callback()});
 return{requests,language,respond:value=>responses.push(value),refreshes:()=>refreshes,render(){cursor=0;tree=exports.default({onClose:()=>{},onImported:()=>{refreshes++;}});for(const effect of effects.splice(0))effect();return tree;}};
}
async function uploaded(h){h.render();await settle();let tree=h.render();const file=nodes(tree,n=>n.type==='input'&&n.props.type==='file')[0];file.props.onChange({target:{files:[{name:'sales.xlsx',size:4}],value:'sales.xlsx'}});await settle();return h.render();}
async function readPreview(h,result=preview()){let tree=await uploaded(h);h.respond(result);await button(tree,h.language==='ar'?'قراءة التقرير ومعاينته':'Read and preview report').props.onClick();return h.render();}
let h=harness(),tree=await readPreview(h);
eq(select(tree).props.value,'rep1','Server-inferred rep is selected without a manual mapping');
ok(text(tree).includes('Automatic name match'),'Automatic mapping is explained');
eq(nodes(select(tree),n=>n.type==='option'&&n.props.value==='')[0].props.disabled,true,'Automatic selection cannot be replaced with a misleading empty placeholder');
eq(JSON.parse(h.requests.at(-1).body).employeeMappings,[],'Preview request did not acquire an inferred mapping');
eq(button(tree,'Confirm import').props.disabled,false,'Valid inferred preview can be confirmed');
h.respond(new Error('Connection lost'));await button(tree,'Confirm import').props.onClick();tree=h.render();
const originalCommit=h.requests.at(-1).body,commit=JSON.parse(originalCommit);
eq(commit.employeeMappings,[],'Commit uses precisely the originally previewed mapping input');
eq(commit.previewToken,'captured-preview-token');eq(select(tree).props.disabled,true,'Unacknowledged commit locks inferred mapping');
h.respond({importedCount:1,duplicateCount:0,excludedCount:0,months:['2026-10']});await button(tree,'Confirm save').props.onClick();
eq(h.requests.at(-1).body,originalCommit,'Retry preserves exact serialized input, token and request ID');eq(h.refreshes(),1,'Acknowledgement performs one read refresh');
h=harness();tree=await readPreview(h);select(tree).props.onChange({target:{value:'rep2'}});tree=h.render();
eq(select(tree).props.value,'rep2','An explicit valid rep overrides the inferred selection');
eq(text(tree).includes('Automatic name match'),false,'Edited selection is not labelled as automatic');
eq(button(footer(tree),'Confirm import'),undefined,'A dirty preview cannot be confirmed');
eq(button(footer(tree),'Refresh preview').props.disabled,false,'Required refresh is available in the fixed footer');
h.respond(preview('rep2','selected'));await button(footer(tree),'Refresh preview').props.onClick();tree=h.render();
eq(JSON.parse(h.requests.at(-1).body).employeeMappings,[{employeeId:'7018',repId:'rep2'}],'Refreshed preview receives the explicit override');
eq(button(tree,'Confirm import').props.disabled,false,'Reviewed override becomes confirmable');
h=harness({...options,employeeMappings:[{employeeId:'7018',repId:'rep2'}]});tree=await readPreview(h,preview('rep2','saved'));
eq(select(tree).props.value,'rep2','Saved mapping remains selected');ok(text(tree).includes('Saved mapping'));
eq(text(tree).includes('Automatic name match'),false,'Saved mapping is not relabelled as inferred');
h=harness();tree=await readPreview(h,preview('','unmapped'));eq(select(tree).props.value,'','Unresolved names stay unselected');
eq(button(tree,'Confirm import').props.disabled,true,'Unresolved mapping still blocks import');
const withUnassigned=(amount=35720000)=>{const data=preview();data.documents.push({...data.documents[0],key:'unassigned-invoice',reference:'INV-270',employeeId:'',employeeName:'',repId:'',repName:'',totalCents:amount,status:'unassigned',reason:'بدون بيانات موظف كاملة في ERP؛ تُتجاوز تلقائيًا ولا تُحتسب لأي مندوب'});Object.assign(data.summary,{unassignedCount:1,unassignedTotalCents:amount});return data;};
for(const [language,amount] of [['en',35720000],['ar',-5000]]){
 h=harness(options,language);tree=await readPreview(h,withUnassigned(amount));
 const notice=nodes(tree,n=>n.props?.className==='erp-import-unassigned')[0],amountText=amount===35720000?'357,200.00':'-50.00',confirmLabel=language==='ar'?'تأكيد الاستيراد':'Confirm import';
 ok(text(notice).includes(amountText),'Unassigned net stays visible with its sign: '+language);
 ok(text(notice).includes(language==='ar'?'تُستبعد قيمتها من إجمالي الاستيراد وأداء المناديب':'excluded from import totals and rep performance'),'Excluded amount has an explicit scope explanation: '+language);
 eq(nodes(tree,n=>n.type==='input'&&n.props.type==='checkbox').length,0,'Missing employee rows require no skip approval');
 eq(nodes(tree,n=>n.type==='select'&&n.props['aria-label']).length,1,'No unusable empty-employee dropdown appears');
 eq(button(footer(tree),confirmLabel).props.disabled,false,'Incomplete ERP employee data does not block ready invoices');
 h.respond({importedCount:1,duplicateCount:0,excludedCount:0,unassignedCount:1,unassignedTotalCents:amount,months:['2026-10']});await button(footer(tree),confirmLabel).props.onClick();tree=h.render();
 eq(JSON.parse(h.requests.at(-1).body).allowSkipped,false,'Automatic unassigned skip does not silently grant broader skip consent');
 ok(text(footer(tree)).includes(language==='ar'?'تُجاوزت بدون مندوب ولم تُستورد':'Skipped without a rep; not imported'),'Receipt distinguishes unassigned from imported documents');
 ok(text(footer(tree)).includes(amountText),'Receipt retains actual signed unassigned net');
}
const unknownCategory=withUnassigned();unknownCategory.categories=['Unclassified ERP category'];unknownCategory.documents[0]={...unknownCategory.documents[0],status:'unmapped',reason:'حدد صنف المستهدف المقابل لكل فئة في الفاتورة'};Object.assign(unknownCategory.summary,{newCount:0,unmappedCount:1,totalCents:0});
h=harness({...options,products:['Mold']});tree=await readPreview(h,unknownCategory);
eq(button(footer(tree),'Confirm import').props.disabled,true,'Genuine category ambiguity remains blocking');
const category=nodes(tree,n=>n.type==='select'&&String(n.props['aria-label']||'').startsWith('Target product for '))[0];
eq(category.props.value,'','Questionable category is not guessed');category.props.onChange({target:{value:'Mold'}});tree=h.render();
eq(button(footer(tree),'Refresh preview').props.disabled,false,'Category changes expose the footer refresh action');
const resolvedCategory=withUnassigned();resolvedCategory.categories=['Unclassified ERP category'];h.respond(resolvedCategory);await button(footer(tree),'Refresh preview').props.onClick();tree=h.render();
eq(JSON.parse(h.requests.at(-1).body).categoryMappings,[{category:'Unclassified ERP category',product:'Mold'}],'Footer refresh sends only the explicit category mapping');
eq(button(footer(tree),'Confirm import').props.disabled,false,'Refreshed ready documents can be confirmed despite unassigned documents');
// Upload bytes and processing are not an import receipt, even when transport reaches 100%.
for(const locale of ['ar','en']){
 const h=harness(options,locale);let tree=await readPreview(h),release;
 h.respond(new Promise(resolve=>release=resolve));const saveLabel=locale==='ar'?'تأكيد الاستيراد':'Confirm import',retryLabel=locale==='ar'?'تأكيد الحفظ':'Confirm save';
 const before=h.requests.length,commit=button(tree,saveLabel).props.onClick();await button(tree,saveLabel).props.onClick();eq(h.requests.length,before+1,'Synchronous duplicate commit is blocked');
 const request=h.requests.at(-1),upload=()=>nodes(h.render(),node=>node.props?.completeLabel)[0].props.state;
 request.onUploadProgress({phase:'uploading',loaded:500,total:1000,percent:50});eq(upload().percent,50,'ERP displays measured request bytes '+locale);
 request.onUploadProgress({phase:'processing',loaded:1000,total:1000,percent:null});eq(upload().phase,'processing');eq(button(h.render(),retryLabel),undefined,'No retry/success while processing');
 release({});await commit;tree=h.render();eq(upload().phase,'error','Malformed 2xx response does not confirm import');eq(h.refreshes(),0,'Malformed receipt never triggers success refresh');ok(button(tree,retryLabel),'Ambiguous receipt can retry exact frozen request');
 h.respond({importedCount:1,duplicateCount:0,excludedCount:0,months:['2026-10']});await button(tree,retryLabel).props.onClick();eq(h.requests.at(-1).body,request.body,'Retry preserves token, mappings and idempotency key');eq(upload().phase,'complete');eq(h.refreshes(),1,'Valid server receipt completes once');
}
console.log(JSON.stringify({ok:true,checks,coverage:'actual import component automatic and explicit rep mapping, exact retry payload, nonblocking unassigned count/net/receipt in both languages, required category choice, fixed-footer refresh',realBrowser:false}));

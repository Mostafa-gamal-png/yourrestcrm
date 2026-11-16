// «طلب مساندة» inside an opportunity (the owner, 2026-11-16, item 3 of the GSCO list, «د»; lib/support-opportunity.ts), pure and without a
// build: who may ask from an opportunity (the administrator and the sales team, never customer service), which opportunity (one the reader
// may read, open), the customer not in the list (said, never a request), the customer's open request (said, with whether the reader may
// open it), what the request keeps of the opportunity, and the words. The same compiled modules as production; made-up records only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'support-opportunity-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let child=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(child))child+=fs.existsSync(path.join(root,child+'.ts'))?'.ts':'.tsx';
  compile(child);return 'from '+JSON.stringify(path.join(out,child.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('lib/support-opportunity.ts');
const O=await import(path.join(out,'lib/support-opportunity.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

const m=(id,role,supervisorId,regionScope='all')=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:'عضو '+id,role,branch:'الرئيسي',supervisorId,regionScope,active:1,target:0});
const members=[m('owner','admin'),m('sm','manager'),m('sup','supervisor','sm'),m('rep','rep','sup'),m('rep2','rep','sm'),m('repw','rep','sm','western'),m('csm','customer_service_manager','sm'),m('cs','customer_service','csm')];
const customer=(id,assignedTo)=>({id,kind:'customer',parentId:null,assignedTo,branch:'الرئيسي',data:{name:'مصنع '+id,region:'الشرقية',phone:'0500000000'},createdAt:'2026-10-01T05:00:00.000Z',updatedAt:'2026-10-01T05:00:00.000Z',version:4});
const contact=(id,caseId,customerId,stage)=>({id,kind:'activity',parentId:customerId,assignedTo:'rep',branch:'الرئيسي',data:{type:'call',date:'2026-11-12',result:'تم',salesStage:stage,serviceCaseId:caseId,performedBy:'rep',responsibleId:'rep',recordedByEmail:'rep@yourrest.org'},createdAt:'2026-11-12T06:00:00.000Z',updatedAt:'2026-11-12T06:00:00.000Z',version:1});
const kase=(id,customerId,assignedTo,data={})=>({id,customerId,status:'assigned',creatorId:'cs',serviceManagerId:'csm',salesManagerId:'sm',assignedTo,supervisorId:'sup',data:{source:'call',products:['خدمات صيانة','قوالب البلوك المتحركة'],strength:'strong',needs:'x',nextAction:'y',nextDate:'2026-11-20',approvedAt:'2026-11-10T06:00:00.000Z',assignedAt:'2026-11-10T07:00:00.000Z',registration:{type:'call',visitNumber:77},...data},createdAt:'2026-11-10T05:00:00.000Z',updatedAt:'2026-11-10T07:00:00.000Z',version:3});
const all=[customer('c-open','rep'),customer('c-won','rep'),customer('c-busy','rep'),customer('c-other','rep2'),contact('w1','case-won','c-won','won'),contact('l1','case-lost','c-won','lost')];
const serviceCases=[kase('case-open','c-open','rep'),kase('case-won','c-won','rep'),kase('case-lost','c-won','rep',{registration:{type:'call'}}),kase('case-busy','c-busy','rep'),kase('case-other','c-other','rep2'),kase('case-orphan','c-gone','rep')];
const supportRow=(id,customerId,status,requestedBy)=>({id,branch:'الرئيسي',assignedTo:requestedBy,data:{kind:'support',customerId,origin:'rep',status,requestedBy,requestedAt:'2026-11-12T05:00:00.000Z',repId:'rep',note:'x',channel:'any',handlerId:'',handlerAt:'',handlerBy:''},createdAt:'2026-11-12T05:00:00.000Z',updatedAt:'2026-11-12T05:00:00.000Z',version:1});
const support=[supportRow('support-open','c-busy','open','rep'),supportRow('support-done','c-open','done','rep')];
const check=(id,caseId)=>O.opportunitySupport({me:members.find(x=>x.id===id),members,all,serviceCases,support},caseId);

// ---- who may ask
eq(['admin','manager','supervisor','rep','customer_service','customer_service_manager'].map(O.mayAskFromOpportunity),[true,true,true,true,false,false],'the administrator and the sales team ask; customer service is the one asked');
eq(check('cs','case-open'),{status:403,error:O.SUPPORT_OPPORTUNITY_ROLES},'customer service: 403');
eq(check('csm','case-open'),{status:403,error:O.SUPPORT_OPPORTUNITY_ROLES},'its manager too');
// ---- which opportunity
eq(check('rep','nothing'),{status:404,error:'الفرصة غير متاحة.'},'an unknown opportunity: 404');
eq(check('rep2','case-open'),{status:404,error:'الفرصة غير متاحة.'},'another representative\'s opportunity: the same 404');
eq(check('repw','case-open'),{status:404,error:'الفرصة غير متاحة.'},'a representative of another region: the same 404');
// ---- an open opportunity of the holder: the form may be offered
let found=check('rep','case-open');
eq(found,{opportunity:{id:'case-open',number:77,products:['خدمات صيانة','قوالب البلوك المتحركة'],open:true},customer:{id:'c-open',name:'مصنع c-open',version:4},openRequest:null,canAsk:true},'the holder\'s open opportunity: its number, its products, its customer; a finished request does not count');
eq([O.opportunitySupportProblemKey(found),O.opportunitySupportProblem(found)],[null,''],'nothing stands in the way');
for(const who of ['sup','sm','owner'])eq(check(who,'case-open').canAsk,true,who+' (who reads it) may ask too');
// ---- a closed opportunity
found=check('rep','case-won');
eq([found.opportunity.open,found.canAsk,O.opportunitySupportProblemKey(found),O.opportunitySupportProblem(found)],[false,false,'closed','طلب المساندة متاح للفرص المفتوحة فقط.'],'a won opportunity: refused with its reason');
eq([check('rep','case-lost').opportunity.open,check('rep','case-lost').opportunity.number],[false,null],'a lost one too (and one without a request number)');
// ---- the customer's open request
found=check('rep','case-busy');
eq([found.canAsk,found.openRequest,O.opportunitySupportProblemKey(found)],[false,{id:'support-open',readable:true},'open-request'],'the customer has an open request: said, and it can be opened');
ok(O.opportunitySupportProblem(found).includes('«التواصل مع العملاء»'),'its words name «التواصل مع العملاء»');
// ---- the customer not in the list (only damaged data: Yourrest keeps a customer while it has a case)
found=check('rep','case-orphan');
eq([found.customer,found.canAsk,O.opportunitySupportProblemKey(found)],[null,false,'unlinked'],'the holder is told the customer is not in the list');
ok(O.opportunitySupportProblem(found).startsWith('عميل هذه الفرصة غير مربوط بقائمة العملاء'),'in words that say how to put it right');
eq(check('rep2','case-orphan'),{status:404,error:'الفرصة غير متاحة.'},'anyone outside the holder\'s chain: 404');
eq(check('owner','case-orphan').canAsk,false,'the administrator is told too');
// ---- the words, both languages
for(const key of ['closed','unlinked','open-request']){const [ar,en]=O.OPPORTUNITY_SUPPORT_PROBLEMS[key];ok(/[؀-ۿ]/.test(ar)&&!/[؀-ۿ]/.test(en),key+': Arabic and English');}
ok(!/[؀-ۿ]/.test(O.OPPORTUNITY_SUPPORT_PROBLEMS.unlinked[1])&&O.SUPPORT_ASSIST_RETIRED_MESSAGE.includes('«طلب مساندة»'),'the retired internal help says where new requests go');
// ---- what a request keeps of its opportunity
eq(O.supportOpportunityOf(kase('x','c','rep',{products:Array.from({length:12},(_,i)=>'p'+i)})).products.length,8,'eight products at most');
eq(O.supportOpportunityOf(kase('x','c','rep',{registration:{visitNumber:'12'}})).number,null,'a number only when it is one');

console.log(JSON.stringify({ok:true,checks,pureFunctions:true,productionDataUsed:false}));

// Read-only competitor projection over the real role/region scopers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map();
function load(filename){
 if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 const require=name=>name.startsWith('.')?load(path.join(path.dirname(filename),name)+'.ts'):nativeRequire(name);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,Intl,console});
 return exports;
}
const {buildCompetitors,filterCompetitors,normalizeCompetitorName}=load('lib/competitors.ts');
const {scopeRecords}=load('lib/crm.ts'),{canViewPage,resolveCRMPage}=load('lib/access.ts');
let checks=0;
const eq=(a,b,message)=>{assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const member=(id,role='rep',supervisorId='sup',regionScope='eastern')=>({id,email:id+'@yourrest.org',name:'Name '+id,role,supervisorId,regionScope,branch:'HQ',active:1,target:0});
const members=[member('admin','admin','','all'),member('manager','manager',''),member('sup','supervisor','manager'),member('rep'),member('peer'),member('other','rep','other-sup'),member('west','rep','sup','western')];
const row=(id,kind,parentId,data={},createdAt='2026-10-03T06:00:00.000Z')=>({id,kind,parentId,assignedTo:'other',branch:'HQ',data,createdAt,updatedAt:createdAt,version:1});
const customer=(id,region='الشرقية',data={})=>row(id,'customer',null,{name:'Factory '+id,code:'CODE-'+id,city:'الدمام',region,...data});
const contact=(id,parentId='east',author='rep',data={})=>row(id,'activity',parentId,{hasCompetitor:true,competitorName:'Alpha',date:'2026-10-03',performedBy:author,requestedProducts:['قوالب البلوك الثابتة'],salesStage:'quoted',...data});
const east=customer('east'),second=customer('second'),west=customer('west','الغربية');
eq(normalizeCompetitorName('  شَــرِكَة  إتقان  '),'شركة اتقان','Arabic diacritics, tatweel, hamza and spaces group spelling variants');
eq(normalizeCompetitorName('  CAFÉ\tCo  '),'cafe co','Unicode and case spelling variants');
ok(normalizeCompetitorName('Alpha LLC')!==normalizeCompetitorName('Alpha Ltd'),'Different legal suffixes remain distinct');
ok(normalizeCompetitorName('Alpha-Co')!==normalizeCompetitorName('Alpha Co'),'Distinct punctuation is not silently merged');
const older=contact('older','east','rep',{competitorName:'  أَلْفا  ',date:'2026-09-01',competitorNotes:'Earlier quote',competitorFileId:'quote-1'});
const newer=contact('newer','second','peer',{competitorName:'الفا',date:'2026-10-02',competitorNotes:'New offer',competitorFileId:'quote-1'});
const latest=contact('latest','east','rep',{competitorName:'إلفا',date:'2026-10-03',competitorFileId:'quote-2',salesStage:'lost'});
const inputs=[east,second,older,newer,latest,contact('legal','east','rep',{competitorName:'Alpha LLC',date:'2026-08-01'}),contact('invalid','east','rep',{competitorName:'Ignored false',hasCompetitor:false}),contact('blank','east','rep',{competitorName:' \t '}),contact('zero-width-name','east','rep',{competitorName:'ـَ'}),contact('orphan','missing','rep',{competitorName:'Orphan secret'}),contact('flag-string','east','rep',{hasCompetitor:'true',competitorName:'Invalid flag'})];
const before=JSON.stringify(inputs),entries=buildCompetitors(inputs,members),alpha=entries[0];
eq(entries.length,2,'Only actual named competitor contacts are included');
eq(alpha.name,'إلفا','Latest spelling is displayed without altering historical contacts');
eq(alpha.contacts.map(value=>value.id),['latest','newer','older'],'History sorted newest first');
eq(alpha.contactCount,3,'Contacts counted once');eq(alpha.customerCount,2,'Customer count uses distinct customers');eq(alpha.quoteCount,2,'Repeated link to the same quote counts once');
eq(alpha.lastDate,'2026-10-03','Latest contact date shown');
eq(alpha.contacts[0].stage,'lost','Latest stage available');eq(alpha.contacts[0].products,['قوالب البلوك الثابتة'],'Requested products retained');
eq(alpha.contacts[0].authorId,'rep','Recorder identity comes from stored authorship');eq(alpha.contacts[0].authorName,'Name rep','Recorder name is resolved from scoped member projection');
eq(alpha.contacts[2].activity.data.competitorNotes,'Earlier quote','Earlier observation remains intact');
eq(alpha.contacts[2].activity.data.competitorFileId,'quote-1','Attachment stays an opaque ID, not a storage URL');
eq(JSON.stringify(inputs),before,'Source rows are never modified');
eq(buildCompetitors([...inputs,latest],members)[0].contactCount,3,'Duplicate input IDs do not inflate counts');
eq(filterCompetitors(entries,' إِلــفا ')[0].key,alpha.key,'Search uses the same spelling normalization');
eq(filterCompetitors(entries,'CODE-second')[0].contacts.length,3,'Customer search retains full authorized history');
eq(filterCompetitors(entries,'Name peer')[0].key,alpha.key,'Search by recorder name');
eq(filterCompetitors(entries,'الدمام الشرقية').length,2,'Search supports city and region together');
eq(filterCompetitors(entries,'قوالب الثابتة').length,2,'Search supports known product information');
eq(filterCompetitors(entries,'missing competitor'),[],'Unknown search has no entries');
eq(filterCompetitors(entries,'  '),entries,'Empty search retains all authorized competitors');
const nested=[east,row('machine','factory','east',{}),row('request','opportunity','machine',{}),contact('nested','request')];
eq(buildCompetitors(nested,members)[0].contacts[0].customer.id,'east','Factory and request ancestry resolves to authorized customer');
eq(buildCompetitors(nested.filter(value=>value.id!=='machine'),members),[],'Missing ancestor cannot invent customer access');
eq(buildCompetitors([row('cycle-a','factory','cycle-b',{}),row('cycle-b','opportunity','cycle-a',{}),contact('cycle','cycle-a')],members),[],'Cycle never resolves to a visible customer');
eq(buildCompetitors([east,contact('readonly','east','rep',{_readOnly:true})],members),[],'Read-only service projections are omitted');
eq(buildCompetitors([customer('service','الشرقية',{_readOnly:true}),contact('service-contact','service')],members),[],'Read-only service customer is not used as independent competitor master');
const withMasterReadonly=customer('east','الشرقية',{_masterReadOnly:true});
eq(buildCompetitors([withMasterReadonly,contact('valid')],members).length,1,'Read-only master editing does not remove authorized visit evidence');
const email=contact('email','east','rep',{performedBy:'',recordedByEmail:'peer@yourrest.org',responsibleId:'rep'});
eq(buildCompetitors([east,email],members)[0].contacts[0].authorId,'peer','Email author evidence precedes responsible person');
eq(buildCompetitors([east,contact('unknown','east','missing')],members)[0].contacts[0].authorName,'','Missing scoped member never exposes a recorder email as a substitute');
const inputScoped=[east,west,
 contact('own','east','rep',{competitorName:'Own',competitorNotes:'own-note'}),
 contact('peer','east','peer',{competitorName:'Peer'}),
 contact('sup','east','sup',{competitorName:'Supervisor'}),
 contact('other','east','other',{competitorName:'Outside team',competitorNotes:'outside-note',competitorFileId:'secret-file'}),
 contact('west-contact','west','rep',{competitorName:'Outside region',competitorNotes:'western-note'}),
 contact('admin','east','admin',{competitorName:'Admin-only'})];
const project=id=>buildCompetitors(scopeRecords(inputScoped,members,members.find(value=>value.id===id)),members);
eq(project('rep').map(value=>value.name),['Own'],'Own-entry projection never includes same-customer peer notes');
eq(project('sup').map(value=>value.name).sort(),['Own','Peer','Supervisor'],'Supervisor competitors are limited to own/team observations');
eq(project('manager').map(value=>value.name).sort(),['Outside team','Own','Peer','Supervisor'],'Manager sees sales teams in permitted region only');
eq(project('admin').length,6,'Global admin can read every authorized observation');
for(const secret of ['outside-note','secret-file','western-note','Admin-only'])ok(!JSON.stringify(project('sup')).includes(secret),'Supervisor projection excludes '+secret);
const scoped=scopeRecords(inputScoped,members,members.find(value=>value.id==='rep'));
eq(buildCompetitors(scoped.filter(value=>value.kind!=='customer'),members),[],'Visible contact alone cannot expose an orphan competitor context');
// Recorded visit timing takes precedence and is displayed in Riyadh date.
const midnight=contact('midnight','east','rep',{date:'2026-10-03',startedAt:'2026-10-02T22:30:00.000Z'});
eq(buildCompetitors([east,midnight],members)[0].lastDate,'2026-10-03','Cross-midnight UTC visit uses Saudi local date');
const noDate=contact('no-date','east','rep',{date:'',startedAt:'',requestedProducts:null});noDate.createdAt='invalid';
eq(buildCompetitors([east,noDate],members)[0].lastDate,'','Malformed imported date is safely blank');
eq(buildCompetitors([east,noDate],members)[0].contacts[0].products,[],'Malformed imported products do not break the page');
for(const role of ['admin','manager','supervisor']){eq(canViewPage(role,'competitors'),true,role+' competitor access');eq(resolveCRMPage(role,'competitors'),'competitors',role+' competitor bookmark');}
for(const role of ['rep','customer_service','customer_service_manager','unknown']){eq(canViewPage(role,'competitors'),false,role+' has no management page access');eq(resolveCRMPage(role,'competitors'),'activity',role+' cannot bypass page access via bookmark');}
console.log(JSON.stringify({ok:true,checks,type:'competitor history projection, normalization, scoped privacy and page permissions'}));

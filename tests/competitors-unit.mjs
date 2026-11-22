// The competitor projection (lib/competitors.ts) on the real module and the real role/region helpers it imports, transpiled into
// .sites-runtime. Made-up customers, contacts and members only; the dates are fixed in the records.
// 1. Spelling normalisation groups variants (Arabic diacritics, tatweel, hamza forms, case, spaces) and nothing else.
// 2. buildCompetitors: only contacts that name a competitor, on a reachable customer, once each; newest first; the parent chain, read-only
//    rows, a cycle, a missing date, the author's name.
// 3. filterCompetitors / scopeCompetitors: the words (every word, any field), the region, the dates (both ends included), the empty cases.
// 4. competitorRegions and buildCompetitorProfile: customers, quotes (opaque file ids), regions with shares, products, notes, aliases, and the
//    coverage that can never pass 100%.
import assert from 'node:assert/strict';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const {load}=createLoader('competitors-unit');
const K=await load('lib/competitors.ts');
const {eq,ok,report}=makeChecks(assert);

// ---- 1. normalisation
for(const [input,expected] of [['  شَــرِكَة  إتقان  ','شركة اتقان'],['  CAFÉ\tCo  ','cafe co'],['أحمد آل إبراهيم','احمد ال ابراهيم'],['','' ],['   ',''],['ـــ',''],['Alpha','alpha'],['ALPHA  Co','alpha co'],['١٢٣','١٢٣'],['a‏b','a‏b']])eq(K.normalizeCompetitorName(input),expected,'normalised '+JSON.stringify(input));
ok(K.normalizeCompetitorName('Alpha LLC')!==K.normalizeCompetitorName('Alpha Ltd'),'legal suffixes stay distinct');ok(K.normalizeCompetitorName('Alpha-Co')!==K.normalizeCompetitorName('Alpha Co'),'punctuation is not merged');
eq(K.normalizeCompetitorName('x'.repeat(100000)).length,100000,'a very long name');

// ---- records
const member=(id,name)=>({id,email:id+'@example.test',name,role:'rep',supervisorId:'sup',regionScope:'eastern',branch:'HQ',active:1,target:0});
const members=[member('rep','Rep One'),member('peer','Peer Two')];
const row=(id,kind,parentId,data={},createdAt='2026-10-03T06:00:00.000Z')=>({id,kind,parentId,assignedTo:'other',branch:'HQ',data,createdAt,updatedAt:createdAt,version:1});
const customer=(id,region='الشرقية',data={})=>row(id,'customer',null,{name:'Factory '+id,code:'CODE-'+id,city:'الدمام',region,...data});
const contact=(id,parentId='east',author='rep',data={},createdAt)=>row(id,'activity',parentId,{hasCompetitor:true,competitorName:'Alpha',date:'2026-10-03',performedBy:author,requestedProducts:['قوالب ثابتة'],salesStage:'quoted',...data},createdAt);
const east=customer('east'),second=customer('second'),west=customer('west','الغربية'),noRegion=customer('nr','');
const older=contact('older','east','rep',{competitorName:'  أَلْفا  ',date:'2026-09-01',competitorNotes:'Earlier quote',competitorFileId:'quote-1',competitorFileName:'q1.pdf'},'2026-09-01T06:00:00.000Z');
const newer=contact('newer','second','peer',{competitorName:'الفا',date:'2026-10-02',competitorNotes:'New offer',competitorFileId:'quote-1',requestedProducts:['قوالب ثابتة','قوالب متحركة',5,'  ',null]},'2026-10-02T06:00:00.000Z');
const latest=contact('latest','east','rep',{competitorName:'إلفا',date:'2026-10-03',competitorFileId:'quote-2',salesStage:'lost'},'2026-10-03T06:00:00.000Z');
const inputs=[east,second,west,noRegion,older,newer,latest,
 contact('legal','east','rep',{competitorName:'Alpha LLC',date:'2026-08-01'},'2026-08-01T06:00:00.000Z'),
 contact('invalid','east','rep',{competitorName:'Ignored',hasCompetitor:false}),contact('truthy','east','rep',{competitorName:'Ignored2',hasCompetitor:'true'}),contact('blank','east','rep',{competitorName:' \t '}),contact('tatweel','east','rep',{competitorName:'ـَ'}),contact('numeric','east','rep',{competitorName:5}),
 contact('orphan','missing','rep',{competitorName:'Orphan'}),
 {...contact('readonly-activity','east','rep',{competitorName:'RO',_readOnly:true})},
 contact('on-readonly-customer','ro','rep',{competitorName:'RO2'}),customer('ro','الشرقية',{_readOnly:true}),
 row('visit-1','visit','east',{summary:'v'}),contact('nested','visit-1','peer',{competitorName:'Nested',date:'2026-10-04'},'2026-10-04T06:00:00.000Z'),
 contact('west-1','west','rep',{competitorName:'Beta',date:'2026-10-01'},'2026-10-01T06:00:00.000Z'),
 contact('nr-1','nr','rep',{competitorName:'Beta',date:'2026-10-05',requestedProducts:'not a list'},'2026-10-05T06:00:00.000Z')];
const undated=contact('undated','east','rep',{competitorName:'Gamma',date:undefined},'not a date');
const frozen=JSON.stringify(inputs);
const entries=K.buildCompetitors(inputs,members);
eq(JSON.stringify(inputs),frozen,'the input records are never changed');
eq(entries.map(e=>e.key),['beta','nested','الفا','alpha llc'],'one entry for each normalised name, the latest contact first');
const alpha=entries.find(e=>e.key==='الفا');
eq([alpha.name,alpha.contactCount,alpha.customerCount,alpha.quoteCount,alpha.lastDate],['إلفا',3,2,2,'2026-10-03'],'spelling variants group; the latest spelling shows; the same quote counts once');
eq(alpha.contacts.map(c=>c.id),['latest','newer','older'],'history newest first');
eq(alpha.contacts[2].authorName,'Rep One','the author\'s name from the members');eq(alpha.contacts[1].authorId,'peer','the author id');eq(alpha.contacts[0].order.split('|')[2],'latest','the order key ends with the id');
eq(alpha.contacts[1].products,['قوالب ثابتة','قوالب متحركة'],'only non-blank text products');eq(entries.find(e=>e.key==='beta').contacts.find(c=>c.id==='nr-1').products,[],'a products field that is not a list');
eq(alpha.contacts[2].date,'2026-09-01','the Riyadh day of the contact');
for(const excluded of ['invalid','truthy','blank','tatweel','numeric','orphan','readonly-activity','on-readonly-customer'])ok(!entries.some(e=>e.contacts.some(c=>c.id===excluded)),'left out: '+excluded);
eq(entries.find(e=>e.key==='nested').contacts[0].customer.id,'east','a contact under a visit reaches its customer through the chain');
eq(entries.find(e=>e.key==='beta').customerCount,2,'two customers');
{const a=row('cyc-a','activity','cyc-b',{hasCompetitor:true,competitorName:'Loop'}),b=row('cyc-b','visit','cyc-a',{});eq(K.buildCompetitors([a,b],members),[],'a parent cycle ends and finds no customer');}
{const dup=contact('dup','east');eq(K.buildCompetitors([east,dup,{...dup,data:{...dup.data,competitorName:'Other'}}],members).length,1,'the first row of an id counts, a repeat is ignored');}
{const r=K.buildCompetitors([east,undated],members);eq([r[0].contacts[0].date,r[0].lastDate],['',''],'a contact with no usable date is kept, with no day');}
eq(K.buildCompetitors([],members),[],'no records');eq(K.buildCompetitors([east,contact('u','east','nobody',{performedBy:'nobody'})],members)[0].contacts[0].authorName,'','an author who is not a member has no name');

// ---- 3. words, region, dates
const names=list=>list.map(e=>e.key);
eq(names(K.filterCompetitors(entries,'')),names(entries),'no words: all');eq(names(K.filterCompetitors(entries,'   ')),names(entries),'blank words: all');
eq(names(K.filterCompetitors(entries,'الفا')),['الفا'],'by name');eq(names(K.filterCompetitors(entries,'إلفا')),['الفا'],'a hamza variant of the word');eq(names(K.filterCompetitors(entries,'FACTORY second')),['الفا'],'by a customer, every word in any field');eq(names(K.filterCompetitors(entries,'code-west')),['beta'],'by a customer code');eq(names(K.filterCompetitors(entries,'الدمام')),names(entries),'by a customer city');
eq(names(K.filterCompetitors(entries,'rep one')),['beta','الفا','alpha llc'],'by an author (the contacts of Rep One)');
eq(names(K.filterCompetitors(entries,'earlier quote')),['الفا'],'by a note');eq(names(K.filterCompetitors(entries,'q1.pdf')),['الفا'],'by a file name');eq(names(K.filterCompetitors(entries,'متحركة')),['الفا'],'by a product');eq(names(K.filterCompetitors(entries,'zzz')),[],'no match');eq(names(K.filterCompetitors(entries,'alpha zzz')),[],'every word must match');
{const scoped=K.scopeCompetitors(entries);eq(names(scoped),names(entries),'no scope: all');
 eq(names(K.scopeCompetitors(entries,{region:'western'})),['beta'],'a region');eq(K.scopeCompetitors(entries,{region:'western'})[0].contactCount,1,'counts are rebuilt inside the region');eq(names(K.scopeCompetitors(entries,{region:'all'})),names(entries),'"all" is every region');eq(names(K.scopeCompetitors(entries,{region:'unassigned'})),['beta'],'customers with no region are "unassigned"');eq(names(K.scopeCompetitors(entries,{region:'northern'})),[],'a region with no contact');
 eq(K.scopeCompetitors(entries,{from:'2026-10-02'}).find(e=>e.key==='الفا').contactCount,2,'from a day (included)');eq(K.scopeCompetitors(entries,{through:'2026-10-02'}).find(e=>e.key==='الفا').contactCount,2,'through a day (included)');eq(K.scopeCompetitors(entries,{from:'2026-10-02',through:'2026-10-02'}).find(e=>e.key==='الفا').contacts.map(c=>c.id),['newer'],'one day');
 eq(names(K.scopeCompetitors(entries,{from:'2030-01-01'})),[],'a range with nothing');eq(names(K.scopeCompetitors([K.buildCompetitors([east,undated],members)[0]],{from:'2000-01-01'})),[],'a contact with no day never passes a date filter');eq(names(K.scopeCompetitors([K.buildCompetitors([east,undated],members)[0]],{})),['gamma'],'but passes no filter');
 eq(names(K.scopeCompetitors(entries,{region:' western ',from:' ',through:''})),['beta'],'blank dates and spaces around words are ignored');
 for(const bad of [{region:5},{from:7},{through:{}}])eq(names(K.scopeCompetitors(entries,bad)),names(entries),'a scope of the wrong type is ignored: '+JSON.stringify(bad));}
eq(K.competitorRegions(entries).map(r=>r.key),['eastern','western','unassigned'],'regions in Arabic order, unassigned last');eq(K.competitorRegions(entries).find(r=>r.key==='eastern').region,'الشرقية','the label');eq(K.competitorRegions([]),[],'no regions');

// ---- 4. the profile
const universe=K.scopeCompetitors(entries);
{const p=K.buildCompetitorProfile(alpha,universe);
 eq(p.customers.map(c=>[c.customer.id,c.contactCount,c.quoteCount,c.lastDate]),[['east',2,2,'2026-10-03'],['second',1,1,'2026-10-02']],'customers with their counts');eq([p.customers[0].latestNote.id,p.customers[1].latestNote.id],['older','newer'],'the latest contact that has a note');eq(p.customers[0].contacts.map(c=>c.id),['latest','older'],'contacts of a customer');
 eq(p.customers[0].lastOrder.split('|')[2],'latest','the order of the latest');
 eq(p.quotes.map(q=>[q.fileId,q.fileName,q.contacts.length,q.customers.map(c=>c.id),q.lastDate]),[['quote-2','',1,['east'],'2026-10-03'],['quote-1','q1.pdf',2,['second','east'],'2026-10-02']],'quotes grouped by their opaque file id, the file name where one has it');
 eq(p.notes.map(c=>c.id),['newer','older'],'contacts with a note');eq(p.aliases,['إلفا','الفا','أَلْفا'],'every spelling used');
 eq(p.regions.map(r=>[r.key,r.customerCount,r.contactCount,r.percentage]),[['eastern',2,3,100]],'regions with their share');eq(p.products.map(x=>[x.product,x.customerCount,x.contactCount]),[['قوالب ثابتة',2,3],['قوالب متحركة',1,1]],'products by customers, then contacts');
 eq(p.coverage,{customerCount:2,observedCustomerCount:4,percentage:50},'coverage: customers with this competitor among every customer observed in the scope');eq(p.entry===alpha,true,'the entry is carried');}
{const beta=entries.find(e=>e.key==='beta'),p=K.buildCompetitorProfile(beta,universe);eq(p.regions.map(r=>[r.key,r.percentage]).sort(),[['unassigned',50],['western',50]],'two regions with half each');eq(p.coverage.percentage,50,'half of the observed customers');}
{const p=K.buildCompetitorProfile(alpha,[]);eq(p.coverage,{customerCount:2,observedCustomerCount:0,percentage:null},'no universe: no percentage');const q=K.buildCompetitorProfile(alpha,K.scopeCompetitors(entries,{region:'western'}));eq(q.coverage.percentage,null,'a universe that does not hold these customers can never give more than 100%');}
{const only=entries.find(e=>e.key==='alpha llc');const p=K.buildCompetitorProfile(only,universe);eq([p.quotes,p.notes,p.products.map(x=>x.product)],[[],[],['قوالب ثابتة']],'an entry with no quote or note');}
{const e=K.buildCompetitors([east,contact('n1','east','rep',{competitorName:'Zed',competitorNotes:'  '}),contact('n2','east','rep',{competitorName:'Zed',competitorNotes:'real',date:'2026-10-04'},'2026-10-04T06:00:00.000Z')],members);const p=K.buildCompetitorProfile(e[0],e);eq([p.customers[0].latestNote.id,p.notes.length],['n2',1],'the latest note of a customer, blank notes ignored');}
report();

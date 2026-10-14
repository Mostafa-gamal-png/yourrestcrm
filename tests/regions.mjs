// Region scopes as sets: the canonical stored text, what a scope grants, who sees whom, the SQL that admits rows of an
// overlapping scope (checked on real SQLite), and the records a member sees. Pure functions on the compiled module; no
// network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true};
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:compiler}).outputText,{exports,require:()=>({}),console});return exports;}
const R=load('lib/regions.ts');
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const member=(regionScope,id='m')=>({id,userId:'u',email:id+'@yourrest.org',name:id,role:'rep',branch:'Main',regionScope,active:1,target:0});

// ---- the canonical text
eq(R.canonicalRegionScope('all'),'all','all stays all');
eq(R.canonicalRegionScope(['eastern','central']),'central,eastern','a set is stored in the catalogue order');
eq(R.canonicalRegionScope('eastern,central'),'central,eastern','a string in another order is normalised');
eq(R.canonicalRegionScope(['central','central','eastern']),'central,eastern','repeats collapse');
eq(R.canonicalRegionScope(['central','all']),'all','all with anything is all');
eq(R.canonicalRegionScope(['central','mars']),'central','an unknown region is dropped');
eq(R.canonicalRegionScope(['mars']),'','nothing known chosen is empty');
eq(R.canonicalRegionScope(''),'','empty is empty');
eq(R.canonicalRegionScope(undefined),'','undefined is empty');
eq(['all','central','central,eastern','unassigned','eastern,central','','mars','central,','all,central'].map(R.isRegionScope),[true,true,true,true,false,false,false,false,false],'only canonical texts are scopes');
eq(R.scopeRegions('all'),[],'all grants nothing by name');
eq(R.scopeRegions('central,eastern'),['central','eastern'],'the regions of a set');
eq(R.scopeRegions('central, eastern'),['central','eastern'],'spaces are tolerated when reading');
eq(R.scopeRegions('mars'),[],'an unknown scope grants nothing');

// ---- labels and the new-customer default
eq([R.regionLabel('all'),R.regionLabel('eastern'),R.regionLabel('central,eastern'),R.regionLabel('unassigned'),R.regionLabel('mars')],['كل المناطق','الشرقية','الوسطى، الشرقية','المنطقة غير محددة','المنطقة غير محددة'],'labels, a set joined by an Arabic comma');
eq([R.regionLabels('all'),R.regionLabels('central,eastern'),R.regionLabels('')],[['كل المناطق'],['الوسطى','الشرقية'],[]],'labels one by one');
eq([R.regionValue(member('all')),R.regionValue(member('eastern')),R.regionValue(member('central,eastern')),R.regionValue(member('unassigned'))],['','الشرقية','',''],'a new customer is filled with the only region; several or all leave the choice open');

// ---- what a scope grants
const eastern={region:'الشرقية'},central={region:'الوسطى'},western={region:'الغربية'},blank={region:''};
eq([eastern,central,western,blank].map(c=>R.memberCanAccessRegion(member('central,eastern'),c.region)),[true,true,false,false],'a member of two regions reaches customers of both and nobody else\'s');
eq([eastern,central,western,blank].map(c=>R.memberCanAccessRegion(member('all'),c.region)),[true,true,true,true],'all reaches every customer');
eq([eastern,western].map(c=>R.memberCanAccessRegion(member('eastern'),c.region)),[true,false],'one region as before');
eq([R.memberCanAccessRegion(member('central,eastern'),'eastern'),R.memberCanAccessRegion(member('central,eastern'),'المنطقة الشرقية'),R.memberCanAccessRegion(member('unassigned'),'')],[true,true,true],'by id, by label with the prefix, and the unassigned bucket');
eq([['all','western'],['western','all'],['central,eastern','eastern'],['central,eastern','western'],['central,eastern','eastern,western'],['mars','mars'],['central','central']].map(([a,b])=>R.regionScopesOverlap(a,b)),[true,true,true,false,true,false,true],'overlap: all with anything, otherwise a shared region');

// ---- who sees whom
const team=[member('all','owner'),member('eastern','east'),member('central,eastern','two'),member('western','west'),member('unassigned','none')];
eq(R.regionMembers(team,member('central,eastern','me')).map(m=>m.id),['owner','east','two'],'a member of two regions sees the global members and those sharing a region');
eq(R.regionMembers(team,member('western','me')).map(m=>m.id),['owner','west'],'one region as before');
eq(R.regionMembers(team,member('all','me')).map(m=>m.id),['owner','east','two','west','none'],'all sees everyone');
eq(R.regionMembers(team,team[3]).map(m=>m.id),['owner','west'],'and always themself');

// ---- the SQL that admits rows of an overlapping scope, on real SQLite
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE rows(id TEXT PRIMARY KEY, region_scope TEXT NOT NULL)");
for(const [id,scope] of [['a','all'],['b','eastern'],['c','central,eastern'],['d','western'],['e','central'],['f','unassigned']])db.prepare('INSERT INTO rows VALUES(?,?)').run(id,scope);
const admitted=me=>{const scope=R.regionScopeSql('region_scope',member(me));return db.prepare('SELECT id FROM rows WHERE '+scope.sql+' ORDER BY id').all(...scope.args).map(row=>row.id);};
eq(R.regionScopeSql('region_scope',member('all')),{sql:'1=1',args:[]},'all needs no filter');
eq(admitted('all'),['a','b','c','d','e','f'],'all admits every row');
eq(admitted('eastern'),['a','b','c'],'one region admits global rows, its own and the sets holding it');
eq(admitted('central,eastern'),['a','b','c','e'],'two regions admit the rows of either');
eq(admitted('western'),['a','d'],'another region');
eq(admitted('unassigned'),['a','f'],'the unassigned bucket');
eq(R.regionScopeSql('region_scope',member('central,eastern')).args,['%,central,%','%,eastern,%'],'the patterns match whole ids only');
db.exec("INSERT INTO rows VALUES('g','northeastern')");
eq(admitted('eastern').includes('g'),false,'a region id inside another word is not a match');

// ---- the records a member sees
const rows=[
 {id:'c-east',kind:'customer',parentId:null,data:eastern},{id:'c-central',kind:'customer',parentId:null,data:central},{id:'c-west',kind:'customer',parentId:null,data:western},
 {id:'f-east',kind:'factory',parentId:'c-east',data:{}},{id:'v-east',kind:'activity',parentId:'f-east',data:{}},{id:'v-west',kind:'activity',parentId:'c-west',data:{}}
];
eq(R.regionRecords(rows,member('central,eastern')).map(r=>r.id),['c-east','c-central','f-east','v-east'],'the customers of both regions with their trees, nothing of the third');
eq(R.regionRecords(rows,member('all')).map(r=>r.id),rows.map(r=>r.id),'all sees everything');
console.log(JSON.stringify({ok:true,checks,pureFunctions:true,realSqlite:true,productionDataUsed:false}));

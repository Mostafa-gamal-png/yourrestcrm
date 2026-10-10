import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync('lib/customer-map-activity.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {mapActivity,customerMapActivity,activityOptions,activityCategories,groupMapActivities}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const row=customerStatus=>({data:{customerStatus}});

eq(customerMapActivity,mapActivity);
eq(activityCategories,activityOptions);
eq(activityOptions.map(option=>option.key),['active','partial','inactive','unknown']);
eq(new Set(activityOptions.map(option=>option.color)).size,4,'Each status has a distinct color');
for(const [value,key] of [
 ['نشط','active'],['نصف نشط','partial'],['خامل','inactive'],
 ['  نشط  ','active'],['نصف\n\tنشط','partial'],['نصف\u00a0نشط','partial'],
 ['Active','active'],[' Semi-active ','partial'],['SEMI ACTIVE','partial'],['Inactive','inactive'],
]){
 const actual=mapActivity(row(value));
 eq(actual.key,key,value);
 eq(actual.rawLabel,value.trim(),'Original label stays available');
 eq(actual.color,activityOptions.find(option=>option.key===key).color);
}
for(const value of ['',undefined,null,4,{},[],false]){
 const actual=mapActivity(row(value));eq(actual.key,'unknown');eq(actual.rawLabel,'');
}
eq(mapActivity({data:null}).key,'unknown');
for(const value of ['غير نشط','نشط جديد','نصف خامل','inactive customer','strong','weak','medium','toString','__proto__','constructor']){
 const actual=mapActivity(row(value));eq(actual.key,'unknown','Never substring-match or guess '+value);eq(actual.rawLabel,value);
}
const protectedData={customerStatus:'نصف نشط'};
for(const field of ['strength','salesStage','_visitPlan','lastVisit','performedBy'])Object.defineProperty(protectedData,field,{get(){throw new Error('Activity must not inspect '+field);}});
eq(mapActivity({data:protectedData}).key,'partial','Only the customer card status is read');
eq(mapActivity({data:{customerStatus:'',strength:'strong',salesStage:'won'}}).key,'unknown','Visit strength and sales outcome never create an activity status');

let group=groupMapActivities([row('نشط'),row('نشط')]);
eq(group.key,'active');eq(group.total,2);eq(group.counts.map(({key,count})=>({key,count})),[{key:'active',count:2}]);eq(group.color,mapActivity(row('نشط')).color);
group=groupMapActivities([row('خامل'),row('نشط'),row('خامل'),row('نصف نشط'),row('غير نشط'),row('')]);
eq(group.key,'mixed');eq(group.total,6);
eq(group.counts.map(({key,count})=>({key,count})),[{key:'active',count:1},{key:'partial',count:1},{key:'inactive',count:2},{key:'unknown',count:2}]);
eq(group.counts.reduce((sum,item)=>sum+item.count,0),group.total);
eq(group.color,'#6554a4');
eq(groupMapActivities([row('نشط'),row('خامل')]),groupMapActivities([row('خامل'),row('نشط')]),'Mixed status never depends on the first customer');
eq(groupMapActivities([]),{key:'unknown',color:mapActivity(row('')).color,counts:[],total:0});
const frozen=Object.freeze([Object.freeze({data:Object.freeze({customerStatus:'نشط'})})]);
eq(groupMapActivities(frozen).key,'active','Input is not mutated');
eq(groupMapActivities([row('نشط')]).counts.length,1,'Only supplied visible records contribute');

console.log(JSON.stringify({result:'PASS',checks}));

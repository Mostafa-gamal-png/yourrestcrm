// The permanent Yourrest code and the ERP code are both searchable in the map and the customer directory. The administrative
// «ربط عملاء ERP» dialog these checks also covered was replaced on 2026-11-02 by «استيراد من ERP» (tests/erp-customers-ui.mjs).
// No claim of real browser or layout coverage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
function module(file,require,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:compiler}).outputText,{exports,require,console,crypto:globalThis.crypto,Error,TypeError,AbortController,setTimeout,clearTimeout,...globals});return exports;}
const search=module('lib/customer-map-search.ts').searchMapCustomers;
const customer={id:'one',kind:'customer',data:{name:'مصنع الاختبار',code:'ERP-42',internalCode:'YR-C-000001'}};
eq(Array.from(search([customer],'YR-C-000001'),r=>r.id),['one'],'Map and customer directory find the new internal code');
eq(Array.from(search([customer],'ERP-42'),r=>r.id),['one'],'Existing ERP code remains searchable');
console.log(JSON.stringify({ok:true,checks,coverage:'internal Yourrest code and ERP code search in the map and the customer directory',realBrowser:false}));

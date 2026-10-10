import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Execute the actual domain modules and sales editor. No database/network/fixtures.
const root=process.cwd(),require=createRequire(import.meta.url),cache=new Map();
const container=({children})=>React.createElement('div',null,children);
function load(relative){
 const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 let source=fs.readFileSync(file,'utf8');
 if(relative==='app/sales-workspace.tsx')source+='\nexport {SaleEditor};';
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)(specifier=>{
  if(relative==='app/sales-workspace.tsx'){
   if(specifier==='@/lib/i18n')return {t:value=>value,useLanguage:()=>({language:'ar'}),getLanguage:()=> 'ar',direction:()=> 'rtl'};
   if(specifier.startsWith('@/components/'))return new Proxy({},{get:()=>container});
   if(specifier.startsWith('./')||specifier==='@/lib/client-submit'||specifier==='sonner')return {default:container};
  }
  if(specifier.endsWith('.css'))return {};
  if(specifier.startsWith('.')||specifier.startsWith('@/')){
   const resolved=specifier.startsWith('@/')?path.join(root,specifier.slice(2)):path.resolve(path.dirname(file),specifier);
   return load(path.relative(root,resolved+(fs.existsSync(resolved+'.ts')?'.ts':'.tsx')));
  }
  return require(specifier);
 },module,module.exports);
 return module.exports;
}
const {salesTotals,saleSchema,salesProducts}=load('lib/sales.ts');
const {quoteTotals,schemas}=load('lib/crm.ts');
let checks=0;const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const item=(quantity,unitPrice)=>({product:salesProducts[0],quantity,unitPrice,description:'test'});
const sale=items=>({customerId:'test-customer',repId:'test-rep',date:'2026-01-01',reference:'TEST-1',items,discount:0});

equal(saleSchema.safeParse(sale([item(.02,7.25)])).success,true,'Normal values allowed by the editor and schema');
equal(salesTotals([item(.02,7.25)],0),{subtotalCents:15,totalCents:15},'0.02 × 7.25 rounds 0.145 SAR to 15 halala');
equal(salesTotals([item(.018,7.5)],0).totalCents,14,'Another binary multiplication below a half-halala boundary');
equal(salesTotals([item(1,10)],1.005).totalCents,899,'Discount uses the same decimal half-up rounding');
equal(quoteTotals([{quantity:.02,price:7.25}],0,15),{subtotal:.15,tax:.02,total:.17},'Quote line and VAT share exact rounding');
equal(quoteTotals([{quantity:1,price:10}],1.005,15),{subtotal:10,tax:1.35,total:10.34},'Quote discount rounds before VAT');
const quote={date:'2026-01-01',validUntil:'2026-01-02',status:'draft',items:[{description:'test',quantity:1,price:1.004}],discount:1.005,taxRate:15};
equal(schemas.quote.safeParse(quote).success,false,'Discount exceeding the rounded subtotal cannot be accepted');
equal(salesTotals([item(.004,1),item(.004,1)],0).subtotalCents,0,'Preserve per-line rounding instead of rounding summed raw values');
equal(quoteTotals([{quantity:2,price:100}],10,15),{subtotal:200,tax:28.5,total:218.5},'Ordinary quote retains existing result');
equal(salesTotals([item(1e-7,5e4)],0).totalCents,1,'Scientific notation is rounded as a decimal');
equal(salesTotals([item(Number.MIN_VALUE,1)],0).totalCents,0,'Very small finite input is bounded and does not throw');
equal(salesTotals([item(1,1e9)],0).totalCents,1e11,'Maximum valid invoice remains exact');
equal(saleSchema.safeParse(sale([item(1,1e9)])).success,true,'Maximum valid total stays accepted');
equal(saleSchema.safeParse(sale([item(100000,1e9)])).success,false,'Overflow-sized invoice stays rejected');
equal(saleSchema.safeParse(sale([item(100001,1)])).success,false,'Quantity limit stays enforced');
equal(saleSchema.safeParse(sale([item(1,Number.POSITIVE_INFINITY)])).success,false,'Nonfinite prices stay rejected');
equal(salesTotals(Array.from({length:50},()=>item(.02,7.25)),0).totalCents,750,'Every line contributes its correctly rounded cents');

// Independent integer oracle: editor quantity has three decimals, price two.
for(const milliQuantity of [11,18,20,25,145,999,1005,2515]){
 for(const priceCents of [5,125,140,725,750,999,1135]){
  const expected=Number((BigInt(milliQuantity)*BigInt(priceCents)+500n)/1000n);
  equal(salesTotals([item(milliQuantity/1000,priceCents/100)],0).totalCents,expected);
 }
}

const {SaleEditor}=load('app/sales-workspace.tsx');
const html=renderToStaticMarkup(React.createElement(SaleEditor,{
 initial:{...sale([item(.02,7.25)]),id:'test-sale',status:'confirmed'},
 me:{id:'test-rep',role:'admin'},members:[],records:[],onCustomerCreated:async()=>{},onClose(){},onSaved(){}
}));
equal(/class="sale-line-total"[^]*?<strong>0\.15<\/strong>/.test(html),true,'Rendered line matches server total, not a duplicate floating calculation');
equal(/class="sale-total"[^]*?<strong>0\.15/.test(html),true,'Rendered invoice total matches the line');
console.log(JSON.stringify({ok:true,checks,scope:'Actual money domain, schema bounds and rendered sales editor; no external fixtures'}));

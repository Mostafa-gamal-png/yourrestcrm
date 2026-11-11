// «استيراد كشف التحصيل من ERP» (2026-11-11), the pure parts: the ERP's «كشف حساب» (UTF-16LE HTML with an .xls name, as the owner's
// «Account_Balance_Sheet_F_T.xls»; also UTF-8 HTML and .xlsx), the due/collected of each account, the grouping by representative, the
// office left out, rows that do not add up; the company and branch gauges of the targets hub (lib/targets-overview.ts); the tab a reload
// returns to (lib/targets-hub.ts). SYNTHETIC fixtures only, built here with the structure of the ERP's file; no owner data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {zipSync,strToU8} from 'fflate';

const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map();
let checks=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
/** CommonJS in this realm (a Buffer must stay a Uint8Array of the same realm), relative and @/ imports resolved to the sources. */
function load(relative){
 const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file).exports;
 const mod={exports:{}};cache.set(file,mod);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(name=>{
  if(name.startsWith('.')||name.startsWith('@/')){const base=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(file),name);return load(path.relative(root,base+(fs.existsSync(base+'.ts')?'.ts':'.tsx')));}
  return nativeRequire(name);
 },mod,mod.exports);
 return mod.exports;
}
const C=load('lib/erp-collections.ts'),O=load('lib/targets-overview.ts'),T=load('lib/targets.ts'),H=load('lib/targets-hub.ts');

const HEADERS=['رقم الحساب','اسم الحساب','المندوب','المحصل','الرصيد السابق مدين','الرصيد السابق دائن','حركة الفترة مدين','حركة الفترة دائن','الرصيد الحالي مدين','الرصيد الحالي دائن'];
/** The ERP's layout: one <TABLE>, a title row of one cell (colspan 9), <Th> headers, <TD> rows; UTF-16LE with its byte-order mark. */
function statement(rows,{title='كشف حساب  لـ 1100 _ 1199',headers=HEADERS,encoding='utf16le',bom=true,closeTags=true}={}){
 const cell=(tag,value)=>'<'+tag+'>'+value+(closeTags?'</'+tag+'>':'');
 const html="<TABLE><TR><TD colspan='9'><center><b>"+title+'</b></center></TD></TR><TR>'+headers.map(h=>cell('Th',h)).join('')+'</TR>'+rows.map(r=>'<TR>'+r.map(v=>cell('TD',v)).join('')+(closeTags?'</TR>':'')).join('')+'</TABLE>';
 if(encoding==='utf8')return new Uint8Array(Buffer.from(html,'utf8'));
 return new Uint8Array(Buffer.concat([bom?Buffer.from([0xff,0xfe]):Buffer.alloc(0),Buffer.from(html,'utf16le')]));
}
// account, name, rep, collector, previous debit/credit, period debit/credit, current debit/credit
const rows=[
 ['1101','مصنع الأول','مندوب ألف','مندوب ألف','1000','0','500.50','700','800.50','0'],// due 1500.50, collected 700
 ['1102','مصنع الثاني','مندوب ألف','مندوب ألف','0','200','300','50','50','0'],// previous credit: due 300 (max(0,-200)+300); 0-200+300-50=50
 ['1103','مصنع الثالث','مندوب باء','مندوب باء','0','0','1,200.00','1200','0','0'],
 ['1104','مصنع الرابع','مبيعات مكتب','مبيعات مكتب','0','0','999','999','0','0'],// the office
 ['1105','مصنع الخامس','','مندوب باء','100','0','0','100','0','0'],// no representative: the collector
 ['1106','مصنع السادس','','','50','0','0','0','50','0'],// nobody
 ['1107','مصنع السابع','مندوب باء','مندوب باء','0','0','100','0','90','0'],// does not add up (100 expected)
];
const parsed=C.parseCollectionStatement(statement(rows));
eq(parsed.rows.length,7,'every account row read; the title and header rows are not accounts');
ok(parsed.title.startsWith('كشف حساب'),'the title «كشف حساب لـ <from> _ <to>» is kept (an account range, no dates)');
eq(parsed.rows[0],{rowNumber:3,accountNo:'1101',accountName:'مصنع الأول',rep:'مندوب ألف',collector:'مندوب ألف',previousDebit:100000,previousCredit:0,periodDebit:50050,periodCredit:70000,currentDebit:80050,currentCredit:0},'amounts in whole halalas, the row number of the file');
eq(parsed.rows[2].periodDebit,120000,'thousands commas are read');
eq(parsed.rows.map(C.accountDueCents),[150050,30000,120000,99900,10000,5000,10000],'due = max(0, previous debit − previous credit) + period debit');
eq(parsed.rows.map(C.accountCollectedCents),[70000,5000,120000,99900,10000,0,0],'collected = the period\'s credit');
eq(parsed.rows.map(C.rowAddsUp),[true,true,true,true,true,true,false],'current = previous + period (debit − credit), to the halala');
const summary=C.summarizeCollections(parsed.rows);
eq(summary.groups.map(g=>[g.name,g.accounts,g.dueCents,g.collectedCents,g.mismatches,g.fromCollector]),[['مندوب ألف',2,180050,75000,0,0],['مندوب باء',3,140000,130000,1,1]],'grouped by «المندوب», «المحصل» when it is empty');
eq([summary.officeRows,summary.officeDueCents,summary.noRepRows,summary.noRepDueCents,summary.mismatchRows,summary.rows],[1,99900,1,5000,1,7],'«مبيعات مكتب» and the accounts of nobody are counted apart, never in a group');
eq([C.collectionPercent(180050,75000),C.collectionPercent(0,0),C.collectionPercent(100,150)],[41.66,null,150],'the rate, two decimals; none when nothing is due; over 100 is shown as it is');

// Encodings and the ERP's loose markup
eq(C.parseCollectionStatement(statement(rows,{encoding:'utf8'})).rows,parsed.rows,'the same report saved as UTF-8 HTML');
eq(C.parseCollectionStatement(statement(rows,{bom:false})).rows,parsed.rows,'UTF-16LE without a byte-order mark');
eq(C.parseCollectionStatement(statement(rows,{closeTags:false})).rows,parsed.rows,'cells and rows the ERP leaves unclosed');
const arabic=C.parseCollectionStatement(statement([['١١٠١','مصنع','مندوب ألف','','١٬٠٠٠٫٥٠','٠','٠','٢٠٠','٨٠٠٫٥٠','٠']])).rows[0];
eq([arabic.accountNo,arabic.previousDebit,arabic.periodCredit,arabic.currentDebit],['1101',100050,20000,80050],'Arabic digits, «٬» and «٫» are read');
eq(C.parseCollectionStatement(statement([['1101','&amp; مصنع&nbsp;<b>كبير</b>','‏مندوب ألف‏','','','','','','','']])).rows[0],{rowNumber:3,accountNo:'1101',accountName:'& مصنع كبير',rep:'مندوب ألف',collector:'',previousDebit:0,previousCredit:0,periodDebit:0,periodCredit:0,currentDebit:0,currentCredit:0},'entities and inner markup decoded once, direction marks removed, empty balances are zero');
eq(C.parseCollectionStatement(statement([...rows.slice(0,2),HEADERS,['','الإجمالي','','','1000','200','800.50','750','850.50','0'],['','','','','','','','','','']])).rows.length,2,'a repeated header, a totals row and an empty row are skipped');
eq(C.parseCollectionStatement(statement(rows,{headers:[HEADERS[1],HEADERS[0],...HEADERS.slice(2)]})).rows[0].accountNo,'مصنع الأول','columns are found by their names, in any order');
eq(C.collectionNameKey(' مندوب  ألف '),C.collectionNameKey('مندوب ألف'),'names compare whole, spaces normalised');

// Refusals, each with its reason
const refuses=(bytes,pattern,message)=>{assert.throws(()=>C.parseCollectionStatement(bytes),error=>error instanceof C.CollectionStatementError&&pattern.test(error.message),message);checks++;};
refuses(statement(rows,{headers:['رقم الفاتورة','التاريخ','النوع','رقم الصنف']}),/ليس كشف حساب ERP المتوقع/,'a file of other columns (an invoices report) is refused');
refuses(statement(rows,{headers:HEADERS.filter(h=>h!=='حركة الفترة دائن')}),/ينقصه عمود مطلوب: حركة الفترة دائن/,'a missing column is named');
refuses(statement(rows,{headers:HEADERS.filter(h=>!h.startsWith('الرصيد الحالي'))}),/الرصيد الحالي مدين، الرصيد الحالي دائن/,'every missing column is named');
refuses(statement(rows,{headers:[...HEADERS,'المندوب']}),/عمود مكرر في كشف الحساب: المندوب/,'a duplicated column');
refuses(new Uint8Array(Buffer.from('<html><body>لا جدول</body></html>')),/لا يحتوي جدولًا/,'no table at all');
refuses(statement([rows[0],rows[0]]),/رقم الحساب مكرر في الكشف \(السطر 3\)/,'an account twice would count twice: refused');
refuses(statement([['1101','مصنع','مندوب','','-50','0','0','0','0','50']]),/السطر 3: الرصيد السابق مدين قيمة سالبة/,'a negative balance');
refuses(statement([['1101','مصنع','مندوب','','abc','0','0','0','0','0']]),/السطر 3: الرصيد السابق مدين ليس رقمًا صالحًا/,'text in an amount');
refuses(statement([['','مصنع','مندوب','','1','0','0','0','1','0']]),/السطر 3: رقم الحساب مطلوب/,'an account without its number');
refuses(statement([]),/لا يحتوي حسابات/,'no account');
refuses(new Uint8Array(0),/فارغ/,'an empty file');
refuses(new Uint8Array(C.COLLECTION_FILE_MAX_BYTES+1),/2 ميجابايت/,'over 2 MB');
refuses(statement([['1101','x'.repeat(1200),'مندوب','','0','0','0','0','0','0']]),/أطول من المسموح/,'an overlong cell');
refuses(new Uint8Array(Buffer.from('<TABLE><TR><TD><script>alert(1)</script></TD></TR></TABLE>')),/غير مسموح/,'script in the file');

// The same statement as .xlsx: the sales report's strict reader
const escape=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;');
const rowXml=cells=>'<row>'+cells.map(v=>'<c t="inlineStr"><is><t>'+escape(v)+'</t></is></c>').join('')+'</row>';
const xlsx=(sheetRows)=>zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types/>'),'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData>'+sheetRows.map(rowXml).join('')+'</sheetData></worksheet>')});
const fromXlsx=C.parseCollectionStatement(xlsx([['كشف حساب  لـ 1100 _ 1199'],HEADERS,...rows]));
eq(fromXlsx.rows.map(r=>[r.accountNo,r.rep,r.periodDebit,r.periodCredit]),parsed.rows.map(r=>[r.accountNo,r.rep,r.periodDebit,r.periodCredit]),'the same rows from an .xlsx');
refuses(xlsx([HEADERS.slice(0,4),rows[0]]),/ينقصه عمود مطلوب/,'and the same header check');

// «تحقيق المستهدف — الشركة والفروع» (lib/targets-overview.ts)
const P=T.targetProducts.map(p=>p.id),M='2026-10';
const people=[{id:'a',role:'rep',branch:'جدة',active:1},{id:'b',role:'rep',branch:'جدة',active:1},{id:'c',role:'rep',branch:'الدمام',active:1},{id:'sup',role:'supervisor',branch:'جدة',active:1},{id:'boss',role:'admin',branch:'جدة',active:1},{id:'old',role:'rep',branch:'الدمام',active:0},{id:'x',role:'rep',branch:'',active:1,readOnly:true}];
const qty=values=>({products:P.map((product,i)=>({product,quantity:values[i]??null}))});
const weights={products:P.map((product,i)=>({product,weight:i===0?60:i===1?40:0}))};
const set=(kind,scopeId,data,extra={})=>({kind,scopeId,month:M,data,version:1,updatedAt:'',...extra});
const state={month:M,branches:['الدمام','جدة'],sets:[set('weights','company',weights),set('sales','a',qty([10,5])),set('sales','b',qty([10,null])),set('sales','c',qty([20,10])),set('sales','sup',qty([20,5]),{computed:true,teamMemberIds:['a','b']}),set('sales','boss',qty([100,100]))]};
const sale=(repId,items,status='confirmed',date=M+'-05')=>({repId,status,date,items:items.map(([product,quantity])=>({product:P[product],quantity}))});
const sales=[sale('a',[[0,10],[1,5]]),sale('b',[[0,5]]),sale('c',[[0,30]]),sale('c',[[1,-2]]),sale('a',[[0,100]],'void'),sale('a',[[0,100]],'confirmed','2026-09-30'),sale('sup',[[0,50]]),sale('boss',[[0,40]])];
let view=O.targetsOverview(state,people,sales,['boss'],P);
const row=(scope,i)=>{const r=scope.attainment.rows[i];return [r.target,r.actual,r.achievement===null?null:Math.round(r.achievement*100)/100];};
const jeddah=view.branches.find(b=>b.name==='جدة'),dammam=view.branches.find(b=>b.name==='الدمام');
eq(jeddah.peopleIds,['a','b'],'a branch is its people of the distribution: not the supervisor (a team roll-up) and not the administrator the month leaves out');
eq([row(jeddah,0),row(jeddah,1)],[[20,15,75],[5,5,100]],'a branch\'s target is the sum of its people\'s, a person without one for a product adds nothing; achieved is their confirmed sales of the month');
eq(dammam.peopleIds,['c'],'an inactive person without a target this month is not counted');
eq(row(dammam,1),[10,-2,-20],'a return deducts');
eq(jeddah.attainment.score,Math.round((0.75*60+1*40)/100*10000)/100,'the gauge is the weighted achievement of the products, each capped at 100%');
eq(dammam.attainment.score,Math.round((1*60+0*40)/100*10000)/100,'over 100% counts as 100%, a negative as 0');
eq([row(view.company,0),row(view.company,1)],[[40,45,112.5],[15,3,20]],'the company\'s target is the sum of the branches, its achieved the sum of their people');
eq(row(jeddah,2),[null,0,null],'a product nobody has a target for stays not set, and nobody sold it: a real zero');
eq(view.branches.map(b=>b.source),['people','people'],'from the people');
view=O.targetsOverview({...state,sets:[...state.sets,set('sales','branch:جدة',qty([30,10]))]},people,sales,['boss'],P);
eq([view.branches.find(b=>b.name==='جدة').source,row(view.branches.find(b=>b.name==='جدة'),0)],['saved',[30,15,50]],'a target saved for the branch itself wins over the sum of its people');
eq(row(view.company,0),[50,45,90],'and the company adds that one');
eq(O.targetsOverview({...state,sets:state.sets.filter(s=>s.kind!=='weights')},people,sales,['boss'],P).company.attainment.status,'weights_missing','no weights: no score');
view=O.targetsOverview(state,people,sales,[],P);
eq(view.branches.find(b=>b.name==='جدة').peopleIds,['a','b','boss'],'an administrator with a target of their own this month is one of the people');
eq(O.targetsOverview({...state,branches:['مكة']},people,sales,[],P).branches,[],'a branch with nobody and no saved target has no gauge');

// The tab a reload returns to (lib/targets-hub.ts)
const store=new Map(),calls=[];
globalThis.window={location:{search:'?tab=collection',pathname:'/',hash:'#targets'},history:{replaceState:(a,b,url)=>calls.push(url)},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)}};
eq(H.initialHubTab('m1'),'collection','the address\'s tab first');
window.location.search='?tab=nonsense';store.set('yr-targets-tab:m1','targets');
eq(H.initialHubTab('m1'),'targets','an unknown tab in the address: the one this browser remembers for the person');
eq(H.initialHubTab('m2'),'results','another person: «نتائج الأداء»');
H.rememberHubTab('m2','quotes');eq([calls.at(-1),store.get('yr-targets-tab:m2')],['/?tab=quotes#targets','quotes'],'choosing a tab puts it in the address (beside #targets) and remembers it');
window.location.search='?x=1&tab=quotes';H.forgetHubTab();eq(calls.at(-1),'/?x=1#targets','leaving the page takes it out of the address only');
globalThis.window={location:{search:''},localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}};
eq(H.initialHubTab('m1'),'results','blocked storage: the first tab');H.rememberHubTab('m1','sales');checks++;
delete globalThis.window;eq(H.initialHubTab('m1'),'results','and on the server');
eq([...H.HUB_TABS],['results','sales','collection','quotes','targets'],'the five tabs in the owner\'s order');
console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));

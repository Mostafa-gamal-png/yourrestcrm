// «استيراد عروض الأسعار من ERP» as pure functions (lib/erp-quotes.ts), on synthetic reports written as the ERP writes them
// (scripts/lib/erp-quotes-fixture.mjs: the 197 columns, UTF-16LE HTML «.xls» closed by a second <TABLE>, and the same as .xlsx):
// the reader (UTF-16LE/BE/UTF-8, the ERP's ending, elements outside the allow-list, a table in a table, text outside cells), the columns
// (missing, duplicated), a file that is not quotations refused whole, grouping by Code (case and Arabic digits), the figures (line and
// document discounts become the quote's discount, the stored totals are the ERP's, the CRM's sums compared, a quotation that does not
// add up refused), dates (yyyy/mm/dd, dd/mm/yyyy, Arabic digits, a missing or earlier validity), deleted lines, header fields that differ
// between lines, more than 50 lines, the terms; and the plan: a customer not in the CRM, an ambiguous code, a customer outside the region,
// an unmapped employee, a representative outside the team, new, the same file again unchanged, a newer export updating, a quote edited
// by hand left alone (status, items, the CRM's edit route keeping the items' extra fields), the customer changed, a CRM quote with the same
// number, the record id stable; a shared code decided by a mapping to one of its customers (and not by one to another customer), the
// mapping changed later without moving the quote, and «مبيعات مكتب» excluded before anything else. Synthetic data only: no database, no
// network, never the owner's file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {quotation, erpQuotesXls, erpQuotesXlsx, ERP_QUOTE_COLUMNS} from '../scripts/lib/erp-quotes-fixture.mjs';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-quotes-')),seen=new Set();
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
compile('lib/erp-quotes.ts');
const Q=await import(path.join(out,'lib/erp-quotes.mjs')),I=await import(path.join(out,'lib/customer-identity.mjs')),C=await import(path.join(out,'lib/crm.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const throws=(run,pattern,message)=>{assert.throws(run,error=>error instanceof Q.ErpQuotesError&&pattern.test(error.message),message);checks++;};
const read=bytes=>Q.parseErpQuotes(Q.readErpQuotesTable(new Uint8Array(bytes)));

// ---- The reader -------------------------------------------------------------------------------------------------------------------
const one=quotation({code:'Qut-501',lines:[{name:'قالب بلوك 20',qty:2,price:1500.5,code:'10010001',description:'مع جلبة'},{name:'قالب انترلوك',qty:1,price:9000,discount:500,code:'10010002-1',unit:'قطعة / PC'}]});
const parsed=read(erpQuotesXls(one));
eq(parsed.quotations.length,1,'one quotation from two lines');
eq(parsed.rowCount,2,'two line rows');
eq(parsed.columns.length,197,'the 197 columns of the ERP export');
const q=parsed.quotations[0];
eq([q.code,q.key,q.date,q.validUntil,q.customerCode,q.employeeCode,q.vatRate,q.lines.length,q.problem],['Qut-501','QUT-501','2026-11-03','2026-11-18','101','7001',15,2,''],'header fields');
eq(q.rows,[2,3],'the table rows of its lines');
eq([q.netCents,q.taxCents,q.totalCents],[1150100,172515,1322615],'Subtotal (net), VAT_AmountM and NewSubtotal in halalas');
eq(q.lines.map(l=>[l.itemCode,l.unit,l.quantity,l.price,l.discountCents,l.totalCents]),[['10010001','حبة / PC',2,1500.5,0,300100],['10010002-1','قطعة / PC',1,9000,50000,850000]],'the lines');
eq(read(erpQuotesXlsx(one)).quotations[0].totalCents,1322615,'the same columns as .xlsx (197 columns past the sheet reader\'s usual 100)');
eq(read(erpQuotesXls(one,{ending:'</TABLE>'})).quotations.length,1,'a table closed properly reads the same');
const utf8=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(erpQuotesXls(one).subarray(2).toString('utf16le'),'utf8')]);
eq(read(utf8).quotations[0].code,'Qut-501','UTF-8 with a byte-order mark');
const be=Buffer.from(erpQuotesXls(one).subarray(2));be.swap16();
eq(read(Buffer.concat([Buffer.from([0xfe,0xff]),be])).quotations[0].code,'Qut-501','UTF-16BE');
eq(read(erpQuotesXls(one).subarray(2)).quotations[0].code,'Qut-501','UTF-16LE without a byte-order mark');
const htmlOf=text=>Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(text,'utf16le')]);
const header='<TR>'+ERP_QUOTE_COLUMNS.map(c=>'<TD>'+c+'</TD>').join('')+'</TR>';
throws(()=>read(htmlOf('<TABLE>'+header+'<TR><TD><script>x</script></TD></TR></TABLE>')),/عنصرًا غير مسموح: <script>/,'a script refuses the file');
throws(()=>read(htmlOf('<TABLE>'+header+'<TR><TD><img src=x onerror=y></TD></TR></TABLE>')),/<img>/,'an image refuses the file');
throws(()=>read(htmlOf('<TABLE>'+header+'<TR><TD><TABLE><TR><TD>x</TD></TR></TABLE></TD></TR></TABLE>')),/جدولًا داخل جدول/,'a table inside the table');
throws(()=>read(htmlOf('<TABLE>'+header+'<TR>stray<TD>x</TD></TR></TABLE>')),/نص خارج الخلايا/,'text outside the cells');
throws(()=>read(htmlOf('<p>no table</p>')),/لا يحتوي جدول/,'no table');
throws(()=>read(Buffer.from([0xff,0xfe,0x00,0xd8,0x41,0x00])),/ترميز/,'broken UTF-16');
eq(read(htmlOf('<html><head><meta charset="utf-16"><style>td{color:red}</style><title>x</title></head><body><!-- ERP --><TABLE border="1">'+header+one.map(r=>'<TR>'+r.map(c=>'<TD class="a&gt;b">'+c.replaceAll('&','&amp;')+'</TD>').join('')+'</TR>').join('')+'</TABLE></body></html>')).quotations.length,1,'a head, a style, a comment and attributes (one holding «>») are passed over');
throws(()=>Q.readErpQuotesTable(new Uint8Array(5*1024*1024+1)),/5 ميجابايت/,'over 5 MB');
throws(()=>Q.readErpQuotesTable(new Uint8Array(0)),/فارغ/,'an empty file');

// ---- The file ---------------------------------------------------------------------------------------------------------------------
const without=column=>{const index=ERP_QUOTE_COLUMNS.indexOf(column);return erpQuotesXls(one.map(r=>r.filter((_,i)=>i!==index)),{columns:ERP_QUOTE_COLUMNS.filter((_,i)=>i!==index)});};
throws(()=>read(without('NewSubtotal')),/عمود مطلوب غير موجود.*NewSubtotal/,'a required column missing');
throws(()=>read(without('Trans_Type_Code')),/لم يُعثر على عناوين تقرير عروض الأسعار/,'without Trans_Type_Code it is not the quotations report');
eq(read(without('Payment_Terms_Name')).quotations[0].problem,'','an optional column may be missing');
throws(()=>read(erpQuotesXls(one,{columns:ERP_QUOTE_COLUMNS.map(c=>c==='No'?'Code':c)})),/عمود مكرر.*Code/,'a duplicated column');
const sales=[...one,...quotation({code:'INV-9',type:'Inv',lines:[{name:'x',qty:1,price:1}]})];
throws(()=>read(erpQuotesXls(sales)),/ليس تقرير عروض أسعار.*السطر 4.*«Inv»/,'a file that is not quotations is refused whole, naming the row');
const grouped=read(erpQuotesXls([...quotation({code:'Qut-7',lines:[{name:'أ',qty:1,price:10,override:{Code:'Qut-٧'}},{name:'ب',qty:1,price:10,override:{Code:'qut-7 '}}]}),...quotation({code:'Qut-8',lines:[{name:'ج',qty:1,price:10}]})]));
eq(grouped.quotations.map(x=>[x.key,x.rows.length]),[['QUT-7',2],['QUT-8',1]],'grouped by Code: case, spaces and Arabic digits are the same number');
const mixedHeader=[...quotation({code:'Qut-9',customerCode:'101',lines:[{name:'أ',qty:1,price:10}]}),...quotation({code:'Qut-9',customerCode:'102',lines:[{name:'ب',qty:1,price:10}]})];
eq(read(erpQuotesXls(mixedHeader)).quotations[0].problem.includes('CustomerCode'),true,'lines of one quotation with different header fields: refused, naming the field');
const deleted=read(erpQuotesXls(quotation({code:'Qut-10',lines:[{name:'أ',qty:1,price:10},{name:'محذوف',qty:1,price:0,deleted:true}]})));
eq([deleted.deletedRows,deleted.quotations[0].lines.length],[1,1],'a line deleted in ERP is left out and counted');
const big=read(erpQuotesXls(quotation({code:'Qut-11',lines:Array.from({length:51},(_,i)=>({name:'بند '+i,qty:1,price:1}))})));
eq(big.quotations[0].problem,'العرض يحتوي 51 بندًا والحد 50 بندًا للعرض الواحد','more than 50 lines: refused with the reason');
eq(read(erpQuotesXls(quotation({code:'Qut-12',lines:Array.from({length:50},(_,i)=>({name:'بند '+i,qty:1,price:1}))}))).quotations[0].problem,'','50 lines are read');
const arabicDigits=read(erpQuotesXls(quotation({code:'Qut-13',date:'٢٠٢٦/١١/٠٥',expiration:'05/12/2026',lines:[{name:'أ',qty:1,price:10,override:{Qty:'٣',Price:'١٬٢٥٠٫٥',Total:'3751.5'}}]}).map(r=>r.map((v,i)=>ERP_QUOTE_COLUMNS[i]==='Subtotal'?'3751.5':ERP_QUOTE_COLUMNS[i]==='VAT_AmountM'?'562.73':ERP_QUOTE_COLUMNS[i]==='NewSubtotal'?'4314.23':v))));
const ad=arabicDigits.quotations[0];
eq([ad.problem,ad.date,ad.validUntil,ad.lines[0].quantity,ad.lines[0].price,ad.netCents],['','2026-11-05','2026-12-05',3,1250.5,375150],'Arabic digits and separators, dd/mm/yyyy');
const badDate=read(erpQuotesXls(quotation({code:'Qut-14',date:'2026/02/30',lines:[{name:'أ',qty:1,price:10}]})));
eq(badDate.quotations[0].problem,'السطر 2: تاريخ العرض (Date1) غير صالح','an impossible date refuses the quotation');
const noRate=read(erpQuotesXls(quotation({code:'Qut-15',lines:[{name:'أ',qty:0,price:10}]})));
eq(noRate.quotations[0].problem,'السطر 2: الكمية يجب أن تكون أكبر من صفر','a zero quantity');
const wrongTotal=read(erpQuotesXls(quotation({code:'Qut-16',lines:[{name:'أ',qty:2,price:10}]}).map(r=>r.map((v,i)=>ERP_QUOTE_COLUMNS[i]==='NewSubtotal'?'99':v))));
eq(wrongTotal.quotations[0].problem,'إجمالي العرض (NewSubtotal) لا يساوي الصافي + الضريبة','a quotation that does not add up is refused, nothing guessed');
const usd=read(erpQuotesXls(quotation({code:'Qut-17',lines:[{name:'أ',qty:1,price:10,override:{CurrencyCode:'USD'}}]})));
eq(usd.quotations[0].problem,'عملة العرض ليست الريال السعودي (SAR)','another currency');
const noCode=read(erpQuotesXls([...one,...quotation({code:'',lines:[{name:'أ',qty:1,price:1}]})]));
eq(noCode.problems,[{row:4,reason:'سطر بلا رقم عرض (Code)'}],'a line without a number is reported by its row');

// ---- The quote's fields -----------------------------------------------------------------------------------------------------------
const disc=read(erpQuotesXls(quotation({code:'Qut-20',documentDiscount:100,payment:'دفعة 50%',delivery:'45 يوم',note:'سعر خاص',lines:[{name:'قالب',qty:2,price:1000,discount:50,description:'وصف ERP'},{name:'جلبة',qty:3,price:200.25}]}))).quotations[0];
const made=Q.erpQuoteFields(disc);
eq(made.fields.items,[{description:'قالب — وصف ERP',quantity:2,price:1000,code:'10010001',category:'Normal Mold /قوالب',unit:'حبة / PC'},{description:'جلبة',quantity:3,price:200.25,code:'10010001',category:'Normal Mold /قوالب',unit:'حبة / PC'}],'items: the name with the ERP description, quantity, price, code, category, unit');
eq([made.fields.discount,made.fields.subtotal,made.fields.tax,made.fields.total,made.fields.taxRate,made.fields.status],[150,2600.75,367.61,2818.36,15,'sent'],'line and document discounts become the discount; subtotal is the gross; tax and total are the ERP\'s');
eq(C.quoteTotals(made.fields.items,made.fields.discount,made.fields.taxRate),{subtotal:2600.75,tax:367.61,total:2818.36},'the CRM\'s own sums agree');
eq(made.differ,false,'not marked');
eq(made.fields.terms,'شروط الدفع: دفعة 50%\nمدة التوريد: 45 يوم\nملاحظات: سعر خاص','the terms from payment terms, delivery term and note');
eq(C.schemas.quote.safeParse(made.fields).success,true,'a valid CRM quote');
const earlier=Q.erpQuoteFields(read(erpQuotesXls(quotation({code:'Qut-21',date:'2026/11/05',expiration:'2026/11/01',lines:[{name:'أ',qty:1,price:10}]}))).quotations[0]);
eq([earlier.fields.validUntil,earlier.validUntilAdjusted],['2026-11-05',true],'a validity before the date is the date');
eq(Q.erpQuoteFields(read(erpQuotesXls(quotation({code:'Qut-22',expiration:'',lines:[{name:'أ',qty:1,price:10}]}))).quotations[0]).fields.validUntil,'2026-11-03','a missing validity is the date');
// Lines whose Total the ERP rounded a halala away from Qty × Price (within the reader's tolerance): the CRM's gross differs by 3 halalas.
const rounded=quotation({code:'Qut-23',lines:[1,2,3].map(n=>({name:'بند '+n,qty:3,price:3.335}))}).map(r=>r.map((v,i)=>({Total:'10.00',Subtotal:'30.00',VAT_AmountM:'4.50',NewSubtotal:'34.50'})[ERP_QUOTE_COLUMNS[i]]??v));
const roundedMade=Q.erpQuoteFields(read(erpQuotesXls(rounded)).quotations[0]);
eq([roundedMade.differ,roundedMade.fields.subtotal,roundedMade.fields.total,roundedMade.crm.subtotal],[true,30,34.5,30.03],'the CRM\'s sums differ by more than a halala: marked, the ERP\'s figures stored');
eq(Q.erpQuoteTerms({paymentTerms:'',deliveryTerm:'',note:''}),'','no terms');
const longName=Q.erpQuoteFields(read(erpQuotesXls(quotation({code:'Qut-24',lines:[{name:'ق'.repeat(200),description:'و'.repeat(100),qty:1,price:1}]}))).quotations[0]);
eq([longName.fields.items[0].description.length,longName.fields.items[0].description.endsWith('…')],[250,true],'a description over 250 characters is cut');

// ---- The plan ---------------------------------------------------------------------------------------------------------------------
const customer=(id,code,extra={})=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'الرئيسي',version:1,createdAt:'',updatedAt:'',data:{name:'عميل '+id,code,region:'الوسطى'},...extra});
const rep={id:'rep',name:'مندوب الوسطى',role:'rep',branch:'الرئيسي',email:'rep@yourrest.org',active:1,target:0};
const records=[customer('c1','101'),customer('c2','102'),customer('dupA','201'),customer('dupB','201'),customer('far','301',{data:{name:'بعيد',code:'301',region:'الشرقية'}})];
const fileOf=(...quotes)=>read(erpQuotesXls(quotes.flat()));
const base=fileOf(quotation({code:'Qut-1',customerCode:'101',lines:[{name:'قالب',qty:1,price:1000}]}),quotation({code:'Qut-2',customerCode:'999',lines:[{name:'قالب',qty:1,price:1000}]}),
 quotation({code:'Qut-3',customerCode:'201',lines:[{name:'قالب',qty:1,price:1000}]}),quotation({code:'Qut-4',customerCode:'301',lines:[{name:'قالب',qty:1,price:1000}]}),
 quotation({code:'Qut-5',customerCode:'102',empCode:'7999',lines:[{name:'قالب',qty:1,price:1000}]}),quotation({code:'Qut-6',customerCode:'102',empCode:'7002',lines:[{name:'قالب',qty:1,price:1000}]}));
const reps=new Map([['7001','rep'],['7002','other']]);
const plan=async(file,rows,extra={})=>Q.planErpQuotes({file,records:rows,visibleIds:new Set(rows.map(r=>r.id)),codes:I.uniqueCustomerCodes(rows),employeeReps:reps,eligible:new Map([['rep',rep]]),customerInRegion:c=>c.data.region==='الوسطى',importer:{id:'owner',name:'المدير'},now:'2026-11-11T08:00:00.000Z',importId:'erp-quotes-import-1',fileName:'quotes.xls',...extra});
const first=await plan(base,records);
eq(first.map(p=>[p.code,p.status,p.reason]),[
 ['Qut-1','new',Q.ERP_QUOTE_REASONS.new],['Qut-2','refused',Q.ERP_QUOTE_REASONS.noCustomer],['Qut-3','refused',Q.ERP_QUOTE_REASONS.ambiguousCustomer],
 ['Qut-4','refused',Q.ERP_QUOTE_REASONS.customerOutside],['Qut-5','refused',Q.ERP_QUOTE_REASONS.unmapped],['Qut-6','refused',Q.ERP_QUOTE_REASONS.repOutside]],
 'new; not in the CRM; an ambiguous code; outside the region; an unmapped employee; a rep outside the team');
const added=first[0];
eq([added.customerId,added.repId,added.branch,added.recordId,added.recordId===await Q.erpQuoteRecordId('QUT-1')],['c1','rep','الرئيسي',added.recordId,true],'under its customer, the mapped rep, the customer\'s branch, a stable id');
eq([added.data.number,added.data.status,added.data.performedBy,added.data._erp.code,added.data._erp.importedBy,added.data._erp.importId,added.data._erp.customerCode],['Qut-1','sent','rep','Qut-1','owner','erp-quotes-import-1','101'],'the record\'s data and its ERP marker');
const mapped=await plan(base,records,{employeeReps:new Map([['7001','rep'],['7999','rep'],['7002','rep']])});
eq(mapped.filter(p=>p.status==='new').map(p=>p.code),['Qut-1','Qut-5','Qut-6'],'with the employees mapped the quotations are taken');
const saved=row=>({id:row.recordId,kind:'quote',parentId:row.customerId,assignedTo:row.repId,branch:row.branch,version:1,createdAt:'',updatedAt:'',data:row.data});
const stored=[...records,saved(added)];
const again=await plan(base,stored);
eq([again[0].status,again[0].reason,again[0].recordId],['unchanged',Q.ERP_QUOTE_REASONS.unchanged,added.recordId],'the same file again: unchanged');
const newer=fileOf(quotation({code:'QUT-1',customerCode:'101',lines:[{name:'قالب',qty:2,price:1100},{name:'جلبة',qty:1,price:50}]}));
const updated=(await plan(newer,stored))[0];
eq([updated.status,updated.recordId,updated.version,updated.data.items.length,updated.data.total,updated.before.total,updated.data._erp.importedAt,updated.data._erp.importedBy],['update',added.recordId,1,2,2587.5,1150,'2026-11-11T08:00:00.000Z','owner'],'a newer export: the same record updated, its first import kept, the before recorded');
const byHand=async change=>(await plan(newer,[...records,{...saved(added),version:2,data:change(structuredClone(added.data))}]))[0];
eq([(await byHand(d=>({...d,status:'accepted'}))).status,(await byHand(d=>({...d,status:'accepted'}))).reason],['edited','عُدِّل في الـCRM، تُرك كما هو'],'edited by hand (status): left as it is');
eq((await byHand(d=>({...d,items:[{...d.items[0],price:999}]}))).status,'edited','edited by hand (a price): left as it is');
// The CRM's edit route parses the quote with schemas.quote (keeping the items' code, category and unit) and recomputes the totals: a save
// that changes nothing is no edit.
const resaved={...added.data,...C.schemas.quote.parse(structuredClone(added.data)),...C.quoteTotals(added.data.items,added.data.discount,added.data.taxRate)};
eq((await plan(base,[...records,{...saved(added),version:2,data:resaved}]))[0].status,'unchanged','saved from the form without a change: still the import\'s');
eq(C.schemas.quote.parse(added.data).items[0].code,'10010001','the quote schema keeps an item\'s ERP code');
const moved=fileOf(quotation({code:'Qut-1',customerCode:'102',lines:[{name:'قالب',qty:1,price:1000}]}));
eq((await plan(moved,stored))[0].reason,Q.ERP_QUOTE_REASONS.customerChanged,'the customer changed in ERP: not moved');
eq((await plan(base,[...records,{id:'crm-q',kind:'quote',parentId:'opp',assignedTo:'rep',branch:'الرئيسي',version:1,createdAt:'',updatedAt:'',data:{number:'qut-1',status:'draft'}}]))[0].reason,Q.ERP_QUOTE_REASONS.numberTaken,'a CRM quote with the same number is never replaced');
eq((await plan(base,stored,{visibleIds:new Set(records.map(r=>r.id))}))[0].reason,Q.ERP_QUOTE_REASONS.recordOutside,'an imported quote outside the importer\'s scope is not touched');
const remapped=(await plan(base,stored,{employeeReps:new Map([['7001','rep2']]),eligible:new Map([['rep',rep],['rep2',{...rep,id:'rep2',name:'مندوب آخر'}]])}))[0];
eq([remapped.status,remapped.repId],['update','rep2'],'the employee mapped to another rep: the quote follows');
eq(Q.canonicalQuoteFields(added.data)===Q.canonicalQuoteFields({...added.data,_erp:{x:1},performedBy:'x'}),true,'the comparison reads the quote\'s own fields only');
const invalid=fileOf(quotation({code:'Qut-30',customerCode:'101',lines:[{name:'قالب',qty:1,price:10}],documentDiscount:20}).map(r=>r.map((v,i)=>({Subtotal:'0.00',VAT_AmountM:'0.00',NewSubtotal:'0.00'})[ERP_QUOTE_COLUMNS[i]]??v)));
eq((await plan(invalid,records))[0].status,'refused','a quotation whose discount exceeds its lines is refused');
eq(Q.employeeKey(' ٧٠٠١ '),'7001','an employee code with Arabic digits and spaces');
// A customer code two CRM customers carry: refused until a «ربط كود عميل ERP» chooses one of them (the mapping KPI invoices and the last
// purchase read too); a mapping to a customer that does not carry the code decides nothing.
const sharedFile=fileOf(quotation({code:'Qut-40',customerCode:'201',lines:[{name:'قالب',qty:1,price:1000}]}));
eq((await plan(sharedFile,records))[0].reason,Q.ERP_QUOTE_REASONS.ambiguousCustomer,'a shared code: refused');
const mappedPlan=(await plan(sharedFile,records,{codes:I.uniqueCustomerCodes(records,[{codeKey:'201',customerId:'dupB',version:1}])}))[0];
eq([mappedPlan.status,mappedPlan.customerId,mappedPlan.data?.performedBy],['new','dupB','rep'],'mapped to one of its customers: new, under that customer');
eq((await plan(sharedFile,records,{codes:I.uniqueCustomerCodes(records,[{codeKey:'201',customerId:'c1',version:1}])}))[0].reason,Q.ERP_QUOTE_REASONS.ambiguousCustomer,'a mapping to a customer that does not carry the code decides nothing');
eq([...I.customerCodeCandidates(records).get('201')].map(r=>r.id),['dupA','dupB'],'the candidates of the code: exactly the customers that carry it');
const importedShared={...saved(mappedPlan),version:1};
eq((await plan(sharedFile,[...records,importedShared],{codes:I.uniqueCustomerCodes(records,[{codeKey:'201',customerId:'dupB',version:1}])}))[0].status,'unchanged','imported, then the same file again: unchanged');
eq((await plan(sharedFile,[...records,importedShared],{codes:I.uniqueCustomerCodes(records,[{codeKey:'201',customerId:'dupA',version:2}])}))[0].reason,Q.ERP_QUOTE_REASONS.customerChanged,'the mapping changed later: the imported quote is not moved to the other customer');
// «مبيعات مكتب»: excluded before anything else (no customer, no mapping, a quotation the reader refused: still only excluded).
const officeFile=fileOf(quotation({code:'Qut-41',customerCode:'999',empCode:'7999',empName:'مبيعات مكتب',lines:[{name:'قالب',qty:1,price:1000}]}),
 quotation({code:'Qut-42',customerCode:'201',empCode:'7999',empName:' مبيعات  المكتب ',lines:[{name:'قالب',qty:1,price:1000}]}),
 quotation({code:'Qut-43',customerCode:'101',empCode:'7999',empName:'مبيعات مكتب',lines:[{name:'قالب',qty:0,price:1000}]}),
 quotation({code:'Qut-44',customerCode:'101',empCode:'7001',empName:'مبيعات مكتب الرياض',lines:[{name:'قالب',qty:1,price:1000}]}));
const officePlan=await plan(officeFile,records);
eq(officePlan.map(p=>[p.code,p.status,p.reason,p.data===undefined]),[
 ['Qut-41','excluded',Q.ERP_QUOTE_REASONS.office,true],['Qut-42','excluded',Q.ERP_QUOTE_REASONS.office,true],['Qut-43','excluded',Q.ERP_QUOTE_REASONS.office,true],
 ['Qut-44','new',Q.ERP_QUOTE_REASONS.new,false]],'«مبيعات مكتب» (and «مبيعات المكتب»): excluded with its reason, never written; another name that merely contains it is not');
eq(Q.ERP_QUOTE_REASONS.office,'مبيعات مكتب: عروض شركة أخرى مستبعدة تلقائيًا','the reason, as the ERP sales import words it');
console.log(`erp-quotes: ${checks} checks passed`);

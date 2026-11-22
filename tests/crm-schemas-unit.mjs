// The record schemas of lib/crm.ts (what /api/crm and the forms accept), unit by unit on the real module compiled into .sites-runtime
// (scripts/lib/load-ts.mjs), for the limits an independent mutation review (2026-11-22) found no test held. Made-up records only.
import assert from 'node:assert/strict';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const {load}=createLoader('crm-schemas-unit');
const C=await load('lib/crm.ts');
const {eq,report}=makeChecks(assert);
const accepts=(kind,value)=>C.schemas[kind].safeParse(value).success;

// ---- A customer: a required field is not spaces; a short field is at most 250 characters.
const customer={name:'مصنع الريان',branch:'الرئيسي',assignedTo:'rep-1'};
eq([accepts('customer',customer),accepts('customer',{...customer,name:'   '}),accepts('customer',{...customer,branch:' \t '})],[true,false,false],'a required field of spaces is empty');
eq([accepts('customer',{...customer,city:'م'.repeat(250)}),accepts('customer',{...customer,city:'م'.repeat(251)})],[true,false],'a short field: 250 characters, not 251');

// ---- An opportunity: a positive quantity.
const opportunity={moldType:'بلوك',product:'بلوك 20',dimensions:'20×40',quantity:1,stage:'new',nextAction:'اتصال',nextDate:'2026-12-01'};
eq([accepts('opportunity',opportunity),accepts('opportunity',{...opportunity,quantity:0}),accepts('opportunity',{...opportunity,quantity:-1})],[true,false,false],'a quantity of zero or less is refused');
eq([accepts('opportunity',{...opportunity,quantity:1000000}),accepts('opportunity',{...opportunity,quantity:1000001})],[true,false],'a quantity up to a million');
eq([accepts('opportunity',{...opportunity,value:1000000000}),accepts('opportunity',{...opportunity,value:1000000001})],[true,false],'a value up to a billion');
eq([accepts('opportunity',{...opportunity,product:''}),accepts('opportunity',{...opportunity,dimensions:''}),accepts('opportunity',{...opportunity,moldType:''})],[false,false,false],'a request names its mold type, product and dimensions');
eq([accepts('opportunity',{...opportunity,nextDate:''}),accepts('opportunity',{...opportunity,nextAction:''})],[false,false],'an open opportunity needs its next action and its date');
const won={...opportunity,stage:'won',orderRef:'PO-1',value:5000,closedAt:'2026-11-20'};
eq([accepts('opportunity',won),accepts('opportunity',{...won,value:null}),accepts('opportunity',{...won,closedAt:''}),accepts('opportunity',{...won,orderRef:''})],[true,false,false,false],'won: its order, its final value and its closing day');
const lost={...opportunity,stage:'lost',lossReason:'السعر',closedAt:'2026-11-20'};
eq([accepts('opportunity',lost),accepts('opportunity',{...lost,closedAt:''}),accepts('opportunity',{...lost,lossReason:''})],[true,false,false],'lost: its reason and its closing day');
eq([accepts('opportunity',{...opportunity,technicalStatus:'approved',technicalNotes:'مطابق'}),accepts('opportunity',{...opportunity,technicalStatus:'approved'})],[true,false],'a technical approval needs its notes');
const thread={hasRequest:false,followupTitle:'متابعة',quantity:1,stage:'new',nextAction:'اتصال',nextDate:'2026-12-01'};
eq(accepts('opportunity',thread),true,'a follow-up thread without a request needs no mold');

// ---- An activity: its types, and at most 30 requested products.
const visit={type:'visit',date:'2026-11-20',summary:'زيارة'};
eq(['visit','call','email','whatsapp'].map(type=>accepts('activity',{...visit,type})),[true,true,true,true],'a visit, a call, an email, a WhatsApp');
eq([accepts('activity',{...visit,requestedProducts:Array.from({length:30},(_,i)=>'منتج '+i)}),accepts('activity',{...visit,requestedProducts:Array.from({length:31},(_,i)=>'منتج '+i)})],[true,false],'30 requested products, not 31');

// ---- A machine: its maker and its model (or whether the model is new or old).
const machine={name:'ماكينة',recordType:'machine',machineBrand:'هس',machineModel:'X1'};
eq([accepts('factory',machine),accepts('factory',{...machine,machineModel:'',modelCondition:'new'}),accepts('factory',{...machine,machineModel:''})],[true,true,false],'a machine without a model or its condition is refused');

// ---- A quotation: its validity from its own day, a discount up to its lines, 1 to 50 lines, a tax rate up to 100%, and its totals.
const quote={number:'Q-1',date:'2026-11-01',validUntil:'2026-11-01',status:'draft',items:[{description:'قالب',quantity:2,price:100}],taxRate:15};
eq([accepts('quote',quote),accepts('quote',{...quote,validUntil:'2026-10-31'})],[true,false],'valid from its own day, not before it');
eq([accepts('quote',{...quote,discount:200}),accepts('quote',{...quote,discount:200.01})],[true,false],'a discount up to the lines\' value');
const line={description:'قالب',quantity:1,price:1};
eq([accepts('quote',{...quote,items:[]}),accepts('quote',{...quote,items:Array(50).fill(line)}),accepts('quote',{...quote,items:Array(51).fill(line)})],[false,true,false],'one to fifty lines');
eq([accepts('quote',{...quote,taxRate:100}),accepts('quote',{...quote,taxRate:100.5})],[true,false],'a tax rate up to 100%');
eq(C.quoteTotals([{quantity:2,price:100}],50,15),{subtotal:200,tax:22.5,total:172.5},'the tax on the lines less the discount, the total of both');

// ---- isOpen and isSalesRequest.
const opp=data=>({id:'o',kind:'opportunity',parentId:'c',assignedTo:'r',branch:'b',data,createdAt:'',updatedAt:'',version:1});
eq([C.isOpen(opp({stage:'won'})),C.isOpen(opp({stage:'lost'})),C.isOpen(opp({stage:'quoted'})),C.isOpen(opp({hasRequest:false,followupStatus:'closed'}))],[false,false,true,false],'won and lost requests are closed, a closed thread too');
eq([C.isSalesRequest(opp({stage:'new'})),C.isSalesRequest(opp({hasRequest:true})),C.isSalesRequest(opp({hasRequest:false}))],[true,true,false],'an opportunity is a request unless it says it has none');

// ---- scopeRecords: customer service reads no sales record, the administrator no complaint, a supervisor marks what they may not edit,
// and a reference to a record the reader cannot see is dropped.
const person=(id,role,extra={})=>({id,role,email:id+'@example.invalid',name:id,branch:'الرئيسي',active:1,target:0,regionScope:'all',...extra});
const members=[person('admin','admin'),person('sup','supervisor'),person('sup2','supervisor'),person('rep1','rep',{supervisorId:'sup'}),person('rep2','rep',{supervisorId:'sup2'}),person('cs','customer_service')];
const record=(id,kind,parentId,assignedTo,data)=>({id,kind,parentId,assignedTo,branch:'الرئيسي',data,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',version:1});
const all=[record('c1','customer',null,'rep1',{name:'مصنع',region:'الشرقية'}),record('c2','customer',null,'rep2',{name:'مصنع آخر',region:'الشرقية'}),
 record('v2','activity','c2','rep2',{type:'visit',performedBy:'rep2'}),record('v1','activity','c1','rep1',{type:'visit',performedBy:'rep1',requestId:'v2',requestSnapshot:{stage:'new'}}),
 record('k1','complaint','c1','rep1',{subject:'شكوى'})];
const [admin,sup,,rep1,,cs]=[members[0],members[1],members[2],members[3],members[4],members[5]];
eq(C.scopeRecords(all,members,cs),[],'customer service: none');
eq(C.scopeRecords(all,members,admin).map(r=>r.id).sort(),['c1','c2','v1','v2'],'the administrator: every sales record, no complaint');
const forSup=Object.fromEntries(C.scopeRecords(all,members,sup).map(r=>[r.id,r]));
eq([!!forSup.c1.data._masterReadOnly,!!forSup.c2.data._masterReadOnly],[false,true],'a supervisor: another team\'s customer is read only');
const forRep=Object.fromEntries(C.scopeRecords(all,members,rep1).map(r=>[r.id,r]));
eq([forRep.v1.data.requestId,forRep.v1.data.requestSnapshot],[undefined,undefined],'a request the representative cannot see is not named in their visit, nor its snapshot');
const wide={...sup,access:{version:1,off:[],hidden:[],viewAll:true}};
const forWide=Object.fromEntries(C.scopeRecords(all,members,wide).map(r=>[r.id,r]));
eq([!!forWide.v2?.data._teamReadOnly,!!forWide.v1?.data._teamReadOnly],[true,false],'read through «عرض بيانات الفريق بالكامل»: another team\'s visit is marked read only');

report();

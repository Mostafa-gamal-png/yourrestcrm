// The rules of «الصلاحيات» and the reach they feed (lib/permissions.ts, lib/access.ts), unit by unit on the real modules compiled into
// .sites-runtime (scripts/lib/load-ts.mjs), for the cases an independent mutation review (2026-11-22) found no test held: the cell a
// restoration needs for a record kind no «حذف» cell names, «عرض بيانات الفريق بالكامل» kept through the saved row and read back, who edits
// a customer's details (a supervisor their team's, customer service their branch's), a quotation never among a representative's records,
// and another team's customer marked for a supervisor as one whose routing they cannot change.
// Made-up members only; no database, no network.
import assert from 'node:assert/strict';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const {load}=createLoader('permissions-rules-unit');
const P=await load('lib/permissions.ts'),A=await load('lib/access.ts'),C=await load('lib/crm.ts');
const {eq,ok,report}=makeChecks(assert);

// ---- trashRestoreCellOff: a record of a kind recordCell does not name is restored under «العملاء · حذف» (lib/trash-server.ts refuses
// anything else as a customer's).
const rep={role:'rep'},repWithDelete={role:'rep',access:{version:2,off:['followup:delete'],hidden:[],viewAll:false}};
eq(P.trashRestoreCellOff(rep,{kind:'mystery',data:{}}),['customer','delete'],'An unknown kind, «حذف» off by default for a representative: the customers\' delete cell is named');
eq(P.trashRestoreCellOff(repWithDelete,{kind:'mystery',data:{}}),null,'An unknown kind, the representative granted «العملاء · حذف»: restored');
eq(P.trashRestoreCellOff(repWithDelete,{kind:'opportunity',data:{hasRequest:false}}),['followup','delete'],'An old follow-up thread needs «المتابعات · حذف», switched off here');

// ---- «عرض بيانات الفريق بالكامل» through the saved row (encodePermissions → the database → memberAccess).
const stored=P.normalizePermissions('supervisor',{viewAll:true});
eq(stored.viewAll,true,'A supervisor may hold viewAll');
const row=P.encodePermissions(stored);
eq(JSON.parse(row.permissions).viewAll,true,'The saved cells carry viewAll');
eq([P.memberAccess('supervisor',{...row,version:4}).version,P.memberAccess('supervisor',{...row,version:4}).viewAll],[4,true],'Read back: viewAll still on');
eq(P.memberAccess('supervisor',{...P.encodePermissions(P.normalizePermissions('supervisor',{})),version:5}).viewAll,false,'Saved without it: off');
ok(!('viewAll' in JSON.parse(P.encodePermissions(P.normalizePermissions('supervisor',{})).permissions)),'Off is not written at all');

// ---- Who edits a customer's details (lib/access.ts canEditCustomerDetails): a supervisor their team's, customer service their branch's.
const person=(id,role,extra={})=>({id,role,email:id+'@example.invalid',name:id,branch:'الرئيسي',active:1,target:0,regionScope:'all',...extra});
const members=[person('sup','supervisor'),person('sup2','supervisor'),person('rep1','rep',{supervisorId:'sup'}),person('rep2','rep',{supervisorId:'sup2'}),person('cs','customer_service')];
const [sup,,rep1,,cs]=members,customerOf=(assignedTo,branch='الرئيسي')=>({kind:'customer',assignedTo,branch});
eq([A.canEditCustomerDetails(customerOf('rep1'),members,sup),A.canEditCustomerDetails(customerOf('rep2'),members,sup)],[true,false],'a supervisor: their own team\'s customer, not another team\'s');
eq([A.canEditCustomerDetails(customerOf('rep2'),members,cs),A.canEditCustomerDetails(customerOf('rep2','جدة'),members,cs)],[true,false],'customer service: their branch\'s customer, not another branch\'s');

// ---- scopeRecords: a quotation recorded for a representative never reaches their records; a supervisor reads another team's customer as
// one whose routing they cannot change.
const record=(id,kind,parentId,assignedTo,data)=>({id,kind,parentId,assignedTo,branch:'الرئيسي',data,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',version:1});
const all=[record('c1','customer',null,'rep1',{name:'مصنع',region:'الشرقية'}),record('c2','customer',null,'rep2',{name:'مصنع آخر',region:'الشرقية'}),record('q1','quote','c1','rep1',{number:'Qut-1',responsibleId:'rep1',performedBy:'rep1'}),record('v1','activity','c1','rep1',{type:'visit',performedBy:'rep1'})];
eq(C.scopeRecords(all,members,rep1).map(r=>r.id).sort(),['c1','c2','v1'],'the representative: the customers and their own visit, never a quotation');
const routing=Object.fromEntries(C.scopeRecords(all,members,sup).filter(r=>r.kind==='customer').map(r=>[r.id,!!r.data._masterRoutingReadOnly]));
eq(routing,{c1:false,c2:true},'the supervisor routes their team\'s customer only');

report();

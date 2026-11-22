// The rules of «الصلاحيات» and the reach they feed (lib/permissions.ts, lib/access.ts), unit by unit on the real modules compiled into
// .sites-runtime (scripts/lib/load-ts.mjs), for the cases an independent mutation review (2026-11-22) found no test held: the cell a
// restoration needs for a record kind no «حذف» cell names, and «عرض بيانات الفريق بالكامل» kept through the saved row and read back.
// Made-up members only; no database, no network.
import assert from 'node:assert/strict';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const {load}=createLoader('permissions-rules-unit');
const P=await load('lib/permissions.ts');
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

report();

import type {Member,Row} from './crm';
import {salesScopeMemberIds} from './access';
import {pageAllowed} from './permissions';
import {isServiceRole} from './customer-service';
import {inactiveCustomer} from './customer-last-purchase';

/** «عملاء واقفين» (the owner, 2026-11-10, item 3: «فلتر «لم يشترِ منذ 60 يومًا» يتحول لتنبيه يوصل لكل مندوب بعملائه اللي وقفوا، ومشرفه يشوف
 * العدد»). A customer is «واقف» exactly as the customers page's filter «لم يشترِ منذ 60 يومًا» lists it (inactiveCustomer: status «نشط»
 * and no purchase in the last 60 days, data._lastPurchase from GET /api/crm). Worked out on the page from the rows it already holds; no
 * route of its own. A representative counts the customers assigned to them (a card on their first screen and a badge on «العملاء»); the
 * administrator, a sales manager or a supervisor count per member of their team («عرض بيانات الفريق بالكامل» widens it, read only, as
 * everywhere: salesScopeMemberIds {read}); customer service, or anyone whose «العملاء» screen is hidden, gets nothing. */
export type InactiveAlertMode='own'|'team'|null;
const SALES_ROLES=['admin','manager','supervisor','rep'];
const TEAM_ROLES=['admin','manager','supervisor'];

export function inactiveAlertMode(me:Pick<Member,'role'|'access'>|null|undefined):InactiveAlertMode{
 if(!me||isServiceRole(me.role)||!pageAllowed(me,'customer'))return null;
 if(me.role==='rep')return 'own';
 return TEAM_ROLES.includes(me.role)?'team':null;
}

/** The representative's own: customers assigned to them that the customers page would list with the filter on. */
export function ownInactiveCount(me:Pick<Member,'id'>,customers:readonly Row[],today:string){
 let count=0;
 for(const row of customers)if(row.kind==='customer'&&row.assignedTo===me.id&&inactiveCustomer(row,today))count++;
 return count;
}

export type TeamInactiveRow={memberId:string;name:string;role:string;active:boolean;count:number};
export type TeamInactive={total:number;rows:TeamInactiveRow[]};
/** Per member of the reader's team (the reader included when customers are assigned to them), most first; a customer assigned to
 * someone outside the team, or to nobody the page knows, is not counted. Each row opens the customers page filtered to that member. */
export function teamInactiveBreakdown(me:Member,members:readonly Member[],customers:readonly Row[],today:string):TeamInactive{
 const scope=salesScopeMemberIds([...members],me,{read:true}),team=new Map(members.filter(member=>scope.has(member.id)&&SALES_ROLES.includes(member.role)).map(member=>[member.id,member]));
 const counts=new Map<string,number>();
 for(const row of customers)if(row.kind==='customer'&&team.has(row.assignedTo)&&inactiveCustomer(row,today))counts.set(row.assignedTo,(counts.get(row.assignedTo)||0)+1);
 const rows=[...counts].map(([memberId,count])=>{const member=team.get(memberId)!;return{memberId,name:member.name,role:member.role,active:!!member.active,count};})
  .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ar')||a.memberId.localeCompare(b.memberId));
 return{total:rows.reduce((sum,row)=>sum+row.count,0),rows};
}

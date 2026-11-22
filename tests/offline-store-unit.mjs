// What the device keeps for a signed-in member (lib/offline-store.ts) and the sign-out that waits for the network (lib/offline-auth.ts), on
// the real modules transpiled as the build does, over stand-ins of IndexedDB, localStorage and BroadcastChannel that keep the browser's
// contract (scripts/lib/fake-browser-storage.mjs). The clock is fixed; every member and record is made up. Several "tabs" are fresh copies of
// the same modules over the same storage.
// 1. The owner's stamp: what changes it (email, role, branch, region, supervisor, access version, active, read-only) and what does not.
// 2. Storage that is missing, fails to open, is blocked, fails a request or a commit, or is replaced by a newer version.
// 3. The device session: an authorized snapshot only, the session epoch shared by the tabs, the generation that refuses a save begun before a
//    sign-out, a pending sign-out and a localStorage that refuses: one member's data is never served while another's session or a sign-out
//    is current.
// 4. The queue as listed, archived and deleted (with what goes with it), refused while a sync holds its lease or sends one of them.
// 5. Projections of queued entries into the snapshot (the Riyadh day at midnight), receipts, the acknowledgement that removes an entry and
//    keeps its receipt in one transaction, and the notices to listeners and other tabs.
// 6. lib/offline-auth.ts: the pending sign-out flag (absent window, blocked storage), preparing it (nothing claimed when it cannot be kept),
//    confirming a sign-in, and finishing it on the server once, shared by concurrent callers, with its 20 s abort.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {createFakeIndexedDB,createFakeLocalStorage,createFakeBroadcast} from '../scripts/lib/fake-browser-storage.mjs';

const NativeDate=Date;let clock=NativeDate.parse('2026-11-22T06:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const made=[];process.on('exit',()=>{globalThis.Date=NativeDate;for(const dir of made)fs.rmSync(dir,{recursive:true,force:true});});
const base=fs.mkdtempSync(path.join(runtime,'offline-store-unit-'));made.push(base);
const written=new Map(),seen=new Set();
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),target=relative.replace(/\.tsx?$/,'.mjs'),dest=path.join(base,target);
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(base,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);written.set(target,code);
}
for(const file of ['lib/offline-store.ts','lib/offline-auth.ts','lib/offline-review.ts'])compile(file);
/** A tab: the same modules loaded afresh (their own connection, channel, lock and generation) over the same storage. */
async function tab(first=false){
 let dir=base;
 if(!first){dir=fs.mkdtempSync(path.join(runtime,'offline-store-unit-'));made.push(dir);for(const [rel,code] of written){const dest=path.join(dir,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,code.split(base).join(dir));}}
 const load=rel=>import(pathToFileURL(path.join(dir,rel)));
 return {S:await load('lib/offline-store.mjs'),A:await load('lib/offline-auth.mjs'),R:await load('lib/offline-review.mjs')};
}

const idb=createFakeIndexedDB(),storage=createFakeLocalStorage(),broadcast=createFakeBroadcast();
const timers=new Map();let timerId=0;
const fakeSetTimeout=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},fakeClearTimeout=id=>{timers.delete(id);};
const window=new EventTarget();Object.assign(window,{localStorage:storage.localStorage,location:{origin:'https://crm.yourrest.org'},setTimeout:fakeSetTimeout,clearTimeout:fakeClearTimeout});
globalThis.window=window;globalThis.indexedDB=idb.indexedDB;globalThis.BroadcastChannel=broadcast.BroadcastChannel;
const DB='yourrest-offline-v1',EPOCH='yr-offline-session-epoch-v1',LOGOUT='yr-offline-pending-logout-v1';
const settle=async(turns=3)=>{for(let i=0;i<turns;i++)await new Promise(resolve=>setImmediate(resolve));};
const until=async(predicate,message)=>{for(let i=0;i<5000;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}throw new Error('Never reached: '+message);};
let events=0;window.addEventListener('yourrest:offline-change',()=>{events++;});

let checks=0;const counts={};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const rejects=async(promise,test,message)=>{await assert.rejects(promise,test,message);checks++;};
const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};
const ARABIC=/[؀-ۿ]/;

const rep={id:'rep-1',userId:'u-rep-1',email:'Rep.One@YourRest.org',name:'مندوب الرياض',role:'rep',branch:'الرئيسي',regionScope:'central',supervisorId:'sup-1',authVersion:3,active:1,target:0};
const peer={id:'rep-2',userId:'u-rep-2',email:'rep.two@yourrest.org',name:'مندوب جدة',role:'rep',branch:'جدة',regionScope:'western',supervisorId:'sup-1',authVersion:1,active:1,target:0};
const snapshotOf=(me,records=[])=>({me,records,members:[me],audits:[]});
const row=(id,kind='customer',extra={})=>({id,kind,parentId:null,assignedTo:'rep-1',branch:'الرئيسي',data:{name:id},createdAt:'2026-11-20T08:00:00.000Z',updatedAt:'2026-11-20T08:00:00.000Z',version:1,...extra});
let order=0;
function entry(S,me,kind,key,patch={}){
 const at=new NativeDate(NativeDate.parse('2026-11-21T06:00:00.000Z')+(order++)*60000).toISOString();
 const localId=kind==='customer'?`crm-${me.id}-${key}`:kind==='visit'?`customer-visit-${key}`:kind==='followup'?`customer-followup-${key}`:kind==='file'?'local-file:'+key:kind==='plan'?'daily-plan-'+key:'service-'+key;
 const url={customer:'/api/crm',visit:'/api/visits',followup:'/api/customer-followups',service:'/api/customer-service',file:'/api/visit-files',plan:'/api/daily-plans'}[kind];
 return {id:me.id+':'+kind+':'+key,ownerId:me.id,owner:S.offlineOwner(me),kind,label:kind+' '+key,status:'pending',message:'',createdAt:at,capturedAt:at,localId,url,fingerprint:'fp-'+key,language:'ar',attempts:0,...patch};
}
const outbox=()=>idb.all(DB,'outbox'),meta=key=>idb.get(DB,'meta',key);
const reset=()=>{idb.clear(DB);storage.map.clear();storage.refuse(false);storage.refuseWrites(false);};

const {S,A,R}=await tab(true);

await counted('owner stamp',async()=>{
 const owner=S.offlineOwner(rep);
 eq(owner.id,'rep-1','the owner is the member id');
 eq(JSON.parse(owner.stamp),['rep-1','rep.one@yourrest.org','rep','الرئيسي','central','sup-1',3,1,false],'the stamp: id, email in small letters, role, branch, region, supervisor, access version, active, read-only');
 for(const patch of [{name:'اسم آخر'},{target:900},{userId:'u-other'},{editToken:'token'},{permissions:{version:2,cells:{},hidden:[],viewAll:true}},{email:'REP.ONE@yourrest.org'}])eq(S.offlineOwner({...rep,...patch}).stamp,owner.stamp,'not an access change: '+Object.keys(patch)[0]);
 for(const patch of [{email:'rep.three@yourrest.org'},{role:'supervisor'},{branch:'جدة'},{regionScope:'eastern'},{supervisorId:'sup-2'},{authVersion:4},{active:0},{readOnly:true}])ok(S.offlineOwner({...rep,...patch}).stamp!==owner.stamp,'an access change: '+JSON.stringify(patch));
 eq(JSON.parse(S.offlineOwner({...rep,regionScope:undefined,supervisorId:undefined,authVersion:undefined,readOnly:undefined}).stamp).slice(4),['all','',0,1,false],'what is missing reads as all regions, no supervisor, version 0, writable');
 eq([S.offlineOwner({...rep,regionScope:''}).stamp,S.offlineOwner({...rep,regionScope:'all'}).stamp].every(stamp=>stamp===S.offlineOwner({...rep,regionScope:undefined}).stamp),true,'an empty region is all regions');
});

await counted('storage faults',async()=>{
 const t=await tab();
 delete globalThis.indexedDB;
 await rejects(t.S.offlineDB(),error=>error instanceof t.S.OfflineStorageError&&error.name==='OfflineStorageError'&&ARABIC.test(error.message),'no IndexedDB: the storage error in Arabic');
 await rejects(t.S.loadOfflineSnapshot(),t.S.OfflineStorageError,'reading fails with it too');
 globalThis.indexedDB=idb.indexedDB;
 const opens=idb.stats.opens;
 idb.faults.open='error';await rejects(t.S.offlineDB(),t.S.OfflineStorageError,'an open that fails');
 idb.faults.open='blocked';await rejects(t.S.offlineDB(),t.S.OfflineStorageError,'an open blocked by another tab');
 const db=await t.S.offlineDB();
 eq([idb.stats.opens-opens,db.objectStoreNames.length,['meta','snapshots','outbox','receipts'].every(name=>db.objectStoreNames.contains(name))],[3,4,true],'a failed or blocked open is not kept: the next call opens again and creates the four stores');
 eq([await t.S.offlineDB()===db,idb.stats.opens-opens],[true,3],'an open connection is reused');
 idb.versionChange(DB);
 const again=await t.S.offlineDB();
 eq([again!==db,db.closed,idb.stats.opens-opens],[true,true,4],'a newer version elsewhere closes this connection and the next call opens a new one');
 idb.faults.request=1;await rejects(t.S.readOfflineStore('outbox'),t.S.OfflineStorageError,'a request that fails is the storage error');
 eq(await t.S.readOfflineStore('outbox'),[],'and the next read works');
 reset();
});

await counted('device session',async()=>{
 reset();events=0;
 eq([await S.unlockedOfflineOwner(),await S.loadOfflineSnapshot(),await S.listOutbox(rep),await S.listOfflineArchive(rep),S.offlineSessionGeneration()],[null,null,[],[],'0:initial'],'a new device: no session, nothing listed');
 await rejects(S.requireOfflineOwner(rep),error=>error.message.startsWith('افتح التطبيق مرة واحدة أثناء الاتصال'),'recording offline needs one authorized opening first');
 for(const bad of [null,{},{me:{}},{...snapshotOf(rep),me:{...rep,active:0}},{...snapshotOf(rep),records:'x'},{...snapshotOf(rep),members:null},{me:rep,records:[],members:{}}])
  await rejects(S.saveOfflineSnapshot(bad),/Invalid authorized offline snapshot/,'refused: '+JSON.stringify(bad)?.slice(0,60));
 eq([idb.all(DB,'meta'),idb.all(DB,'snapshots'),events],[[],[],0],'nothing written and nobody told');
 const records=[row('crm-rep-1-a'),row('crm-rep-1-b')];
 await S.saveOfflineSnapshot(snapshotOf(rep,records));
 eq(await S.loadOfflineSnapshot(),snapshotOf(rep,records),'the snapshot saved is the one served');
 eq(meta('session'),{key:'session',ownerId:'rep-1',stamp:S.offlineOwner(rep).stamp,epoch:'initial'},'the session names the owner, its stamp and the epoch');
 eq(idb.get(DB,'snapshots','rep-1').savedAt,'2026-11-22T06:00:00.000Z','saved at the device time');
 eq([events,broadcast.posted.at(-1)],[1,{name:DB,data:'changed'}],'the page and the other tabs are told');
 eq(await S.requireOfflineOwner(rep),S.offlineOwner(rep),'the same member may record offline');
 await rejects(S.requireOfflineOwner({...rep,role:'supervisor'}),/افتح التطبيق/,'not once its access changed');
 await rejects(S.requireOfflineOwner(peer),/افتح التطبيق/,'and never another member');

 // Another tab signs out: this tab is told, refuses a save it began before, and serves nothing.
 const other=await tab();
 const before=S.offlineSessionGeneration();
 await other.S.lockOfflineSession();await settle();
 const epoch=storage.map.get(EPOCH);
 ok(/^[0-9a-f-]{36}$/.test(epoch)&&meta('session-epoch').epoch===epoch,'the sign-out writes a new epoch in both places');
 eq([meta('session'),S.offlineSessionGeneration()!==before,S.offlineSessionGeneration().endsWith(':'+epoch)],[undefined,true,true],'the session is removed and this tab counts a new generation');
 eq(broadcast.posted.slice(-2).map(item=>item.data),['locked','changed'],'the tabs hear «locked» first');
 await rejects(S.saveOfflineSnapshot(snapshotOf(rep,records),before),/Offline session changed/,'a save begun before the sign-out is refused');
 eq([await S.loadOfflineSnapshot(),await S.listOutbox(rep)],[null,[]],'this tab serves nothing after another tab signed out');
 // Signing in again in this tab: a save of the current generation is accepted and opens the snapshot again.
 await S.saveOfflineSnapshot(snapshotOf(rep,records));
 eq([(await S.loadOfflineSnapshot())?.me.id,meta('session').epoch],['rep-1',epoch],'the next authorized save is kept under the new epoch');
 eq(await other.S.loadOfflineSnapshot(),null,'the tab that signed out stays locked until it saves an authorized snapshot itself');
 eq((await (await tab()).S.loadOfflineSnapshot())?.me.id,'rep-1','a tab opened afterwards sees the session');

 // The epoch of this browser differs from the one the database keeps: nothing is served and nothing is saved.
 storage.map.set(EPOCH,'another-epoch');
 eq(await S.loadOfflineSnapshot(),null,'an epoch the session was not saved under serves nothing');
 await rejects(S.saveOfflineSnapshot(snapshotOf(rep,records)),S.OfflineStorageError,'a save under another epoch is aborted');
 storage.map.set(EPOCH,epoch);
 eq((await S.loadOfflineSnapshot())?.me.id,'rep-1','the right epoch serves it again');

 // A sign-out waiting for the network, then a localStorage that refuses everything: fail closed.
 storage.map.set(LOGOUT,'1');
 eq([await S.loadOfflineSnapshot(),await S.unlockedOfflineOwner(),await S.listOutbox(rep)],[null,null,[]],'a pending sign-out serves nothing');
 await rejects(S.saveOfflineSnapshot(snapshotOf(rep,records)),/Offline session changed/,'and saves nothing');
 await rejects(S.requireOfflineOwner(rep),/افتح التطبيق/,'and records nothing');
 storage.map.delete(LOGOUT);
 storage.refuseRead(key=>key===LOGOUT);
 eq(await S.loadOfflineSnapshot(),null,'a sign-out flag that cannot be read counts as pending');
 await rejects(S.saveOfflineSnapshot(snapshotOf(rep,records)),/Offline session changed/,'and nothing is saved under it');
 storage.refuseRead(null);
 // «locked» from another tab closes this tab at once, before anything reaches the database or localStorage.
 const elsewhere=new broadcast.BroadcastChannel(DB),generation=S.offlineSessionGeneration();
 elsewhere.postMessage('locked');await settle();elsewhere.close();
 eq([!!meta('session'),storage.map.get(EPOCH)],[true,epoch],'(nothing changed in storage)');
 eq([await S.loadOfflineSnapshot(),await S.listOutbox(rep),S.offlineSessionGeneration()!==generation],[null,[],true],'the message alone locks this tab and counts a new generation');
 await rejects(S.saveOfflineSnapshot(snapshotOf(rep,records),generation),/Offline session changed/,'a save begun before the message is refused');
 await S.saveOfflineSnapshot(snapshotOf(rep,records));
 eq((await S.loadOfflineSnapshot())?.me.id,'rep-1','an authorized save afterwards opens it again');
 storage.refuse(true);
 eq([await S.loadOfflineSnapshot(),S.offlineSessionGeneration().endsWith(':null')],[null,true],'a blocked localStorage serves nothing');
 await rejects(S.saveOfflineSnapshot(snapshotOf(rep,records)),/Offline session changed/,'and saves nothing');
 await S.lockOfflineSession();
 eq([meta('session'),typeof meta('session-epoch').epoch],[undefined,'string'],'a sign-out still closes the device session in the database');
 storage.refuse(false);
 await S.lockOfflineSession();
 await S.saveOfflineSnapshot(snapshotOf(rep,records));
 eq((await S.loadOfflineSnapshot())?.me.id,'rep-1','once localStorage works, a sign-out and an authorized save open it again');

 // Receipts: a projection the server's snapshot now holds is dropped, another member's is not touched.
 const receipt=(id,ownerId,projectionId)=>({id,ownerId,ownerStamp:'stamp',fingerprint:'f',localId:projectionId,result:{id:projectionId},projection:row(projectionId),createdAt:'2026-11-21T06:00:00.000Z'});
 idb.put(DB,'receipts',receipt('r1','rep-1','crm-rep-1-a'));idb.put(DB,'receipts',receipt('r2','rep-1','crm-rep-1-z'));idb.put(DB,'receipts',receipt('r3','rep-2','crm-rep-1-b'));
 await S.saveOfflineSnapshot(snapshotOf(rep,records));
 eq(['r1','r2','r3'].map(id=>!!idb.get(DB,'receipts',id).projection),[false,true,true],'the projection the server now has is dropped; one it lacks and another member\'s are kept');
 eq(idb.all(DB,'receipts').length,3,'no receipt is deleted');
});

await counted('one member never sees another',async()=>{
 reset();
 const t=await tab();
 await t.S.saveOfflineSnapshot(snapshotOf(rep,[row('crm-rep-1-a')]));
 const mine=entry(t.S,rep,'customer','k1',{body:JSON.stringify({action:'save',kind:'customer',createKey:'k1',data:{name:'مصنع الريان',branch:'الرئيسي'}})});
 idb.put(DB,'outbox',mine);
 eq((await t.S.listOutbox(rep)).map(job=>job.id),[mine.id],'the member\'s own entry');
 storage.map.set(LOGOUT,'1');await t.S.lockOfflineSession();
 eq([await t.S.loadOfflineSnapshot(),await t.S.listOutbox(rep)],[null,[]],'signed out on the device: nothing of the member is shown');
 storage.map.delete(LOGOUT);
 await t.S.saveOfflineSnapshot(snapshotOf(peer,[row('crm-rep-2-a',undefined,{assignedTo:'rep-2'})]));
 const served=await t.S.loadOfflineSnapshot();
 eq([served.me.id,served.records.map(item=>item.id)],['rep-2',['crm-rep-2-a']],'the next member sees only their snapshot');
 eq([await t.S.listOutbox(peer),await t.S.listOutbox(rep),await t.S.listOfflineArchive(rep)],[[],[],[]],'and none of the first member\'s entries, under either name');
 eq((await t.S.augmentOfflineSnapshot(served)).records.map(item=>item.id),['crm-rep-2-a'],'nor their projections');
 const asFirst=snapshotOf(rep,[]);eq(await t.S.augmentOfflineSnapshot(asFirst),asFirst,'a snapshot of the first member is returned untouched');
 await rejects(t.S.requireOfflineOwner(rep),/افتح التطبيق/,'the first member cannot record under the second\'s session');
 eq([outbox().map(job=>job.id),!!idb.get(DB,'snapshots','rep-1')],[[mine.id],true],'the first member\'s captured entry and snapshot stay on the device, never deleted');
});

await counted('queue lists, archive and deletion',async()=>{
 reset();
 await S.saveOfflineSnapshot(snapshotOf(rep));
 const late=entry(S,rep,'visit','v-late',{createdAt:'2026-11-21T09:00:00.000Z'}),early=entry(S,rep,'visit','v-early',{createdAt:'2026-11-21T07:00:00.000Z'}),tieB=entry(S,rep,'visit','tie-b',{createdAt:'2026-11-21T08:00:00.000Z'}),tieA=entry(S,rep,'visit','tie-a',{createdAt:'2026-11-21T08:00:00.000Z'});
 const blocked=entry(S,rep,'visit','v-blocked',{status:'blocked',message:'اختر العميل',httpStatus:400}),archivedOld=entry(S,rep,'visit','arch-old',{status:'blocked',archivedAt:'2026-11-21T10:00:00.000Z'}),archivedNew=entry(S,rep,'visit','arch-new',{status:'blocked',archivedAt:'2026-11-21T11:00:00.000Z'});
 const theirs=entry(S,peer,'visit','theirs',{status:'blocked'});
 for(const job of [late,early,tieB,tieA,blocked,archivedOld,archivedNew,theirs])idb.put(DB,'outbox',job);
 eq((await S.listOutbox(rep)).map(job=>job.id),[early,blocked,tieA,tieB,late].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).map(job=>job.id),'the list: oldest first, then by id; no archived entry, nobody else\'s');
 eq((await S.listOfflineArchive(rep)).map(job=>job.id),[archivedNew.id,archivedOld.id],'the archive: newest first');
 await settle();events=0;await S.archiveOfflineJob(blocked.id,rep);
 eq([idb.get(DB,'outbox',blocked.id).archivedAt,events,(await S.listOutbox(rep)).some(job=>job.id===blocked.id)],['2026-11-22T06:00:00.000Z',1,false],'an entry that needs review is set aside with its moment, never deleted');
 for(const id of [late.id,theirs.id,'rep-1:visit:missing'])await rejects(S.archiveOfflineJob(id,rep),/يمكن أرشفة الإدخالات التي تحتاج إلى مراجعة فقط/,'not archived: '+id);
 eq(idb.get(DB,'outbox',late.id).archivedAt,undefined,'an entry waiting to be sent is never archived');
 await rejects(S.archiveOfflineJob(blocked.id,{...rep,authVersion:4}),/افتح التطبيق/,'nor by a member whose access changed');

 // Deletion with what goes with it: a new customer, a visit on it, its attachment and a visit naming that attachment.
 reset();await S.saveOfflineSnapshot(snapshotOf(rep));
 const customer=entry(S,rep,'customer','c1',{status:'blocked',message:'موقع العميل خارج حدود المملكة العربية السعودية. اختر نقطة داخلها.',httpStatus:400,body:JSON.stringify({action:'save',kind:'customer',createKey:'c1',data:{name:'مصنع جديد'}})});
 const onCustomer=entry(S,rep,'visit','v1',{body:JSON.stringify({createKey:'v1',customerId:customer.localId,data:{result:'زيارة'}})});
 const photo=entry(S,rep,'file','p1',{customerId:customer.localId,fileName:'عرض.pdf'});
 const naming=entry(S,rep,'visit','v2',{status:'blocked',body:JSON.stringify({createKey:'v2',customerId:'server-customer',data:{competitorFileId:photo.localId}})});
 const unrelated=entry(S,rep,'visit','v3',{status:'blocked',body:JSON.stringify({createKey:'v3',customerId:'server-customer',data:{}})});
 const othersOnSame=entry(S,peer,'visit','pv',{body:JSON.stringify({createKey:'pv',customerId:customer.localId,data:{}})});
 for(const job of [customer,onCustomer,photo,naming,unrelated,othersOnSame])idb.put(DB,'outbox',job);
 const plan=R.offlineDeletion(customer.id,outbox().filter(job=>job.ownerId==='rep-1'));
 const ids=[plan.root.id,...plan.also.map(item=>item.job.id)];
 eq([...ids].sort(),[customer.id,onCustomer.id,photo.id,naming.id].sort(),'what goes with the customer: the visit on it, its attachment and the visit that names the attachment');
 const refused=async(promise,reason,message)=>{await assert.rejects(promise,error=>error instanceof S.OfflineDeletionError&&error.name==='OfflineDeletionError'&&error.reason===reason&&error.message===R.offlineDeletionRefusalText(reason),message);checks++;};
 await refused(S.deleteOfflineEntry(customer.id,rep,ids.slice(0,3)),'changed','the member was shown less than would go');
 await refused(S.deleteOfflineEntry(customer.id,rep,[...ids,unrelated.id]),'changed','or more');
 await refused(S.deleteOfflineEntry(onCustomer.id,rep,[onCustomer.id]),'not-review','an entry waiting to be sent is never deleted');
 await refused(S.deleteOfflineEntry('rep-1:visit:missing',rep,[]),'not-review','nor one that is not there');
 idb.put(DB,'meta',{key:S.SYNC_LEASE_KEY,token:'another-tab',expires:clock+1});
 await refused(S.deleteOfflineEntry(customer.id,rep,ids),'syncing','not while a sync holds its lease');
 idb.put(DB,'meta',{key:S.SYNC_LEASE_KEY,token:'another-tab',expires:clock});
 idb.put(DB,'outbox',{...photo,status:'syncing'});
 await refused(S.deleteOfflineEntry(customer.id,rep,ids),'syncing','nor while one of them is being sent (an expired lease does not count)');
 idb.put(DB,'outbox',photo);
 eq(outbox().length,6,'a refusal deletes nothing');
 await settle();events=0;
 eq(await S.deleteOfflineEntry(customer.id,rep,[...ids].reverse()),ids,'deleted when it is exactly what the member was shown (in any order)');
 eq([outbox().map(job=>job.id).sort(),events],[[othersOnSame.id,unrelated.id].sort(),1],'the rest stays: the unrelated entry and the other member\'s entry on the same local customer');
 const archived=entry(S,rep,'visit','v4',{status:'pending',archivedAt:'2026-11-21T10:00:00.000Z',body:JSON.stringify({createKey:'v4',customerId:'server-customer',data:{}})});idb.put(DB,'outbox',archived);
 eq(await S.deleteOfflineEntry(archived.id,rep,[archived.id]),[archived.id],'an archived entry may be deleted');
 storage.map.set(LOGOUT,'1');await rejects(S.deleteOfflineEntry(unrelated.id,rep,[unrelated.id]),/افتح التطبيق/,'nothing is deleted while a sign-out waits');storage.map.delete(LOGOUT);
 eq(idb.all(DB,'receipts'),[],'no receipt is touched');
});

await counted('projections, receipts and acknowledgement',async()=>{
 reset();await S.saveOfflineSnapshot(snapshotOf(rep,[row('crm-rep-1-existing')]));
 const at=(job,capturedAt)=>({...job,capturedAt,createdAt:capturedAt});
 const customer=at(entry(S,rep,'customer','c1',{body:JSON.stringify({action:'save',kind:'customer',createKey:'c1',data:{name:'مصنع النخيل'}})}),'2026-11-21T21:30:00.000Z');
 const p=S.offlineProjection(customer,rep);
 eq([p.id,p.kind,p.parentId,p.assignedTo,p.branch,p.version,p.createdAt],['crm-rep-1-c1','customer',null,'rep-1','الرئيسي',1,'2026-11-21T21:30:00.000Z'],'a new customer: its local id, the member and the member\'s branch');
 eq([p.data._createdBy,p.data._offlineState,p.data._offlineQueueId,'_readOnly' in p.data,'date' in p.data],['rep-1','pending',customer.id,false,false],'marked as kept on the device, editable');
 eq(S.offlineProjection({...customer,body:JSON.stringify({createKey:'c1',data:{name:'x',assignedTo:'rep-9',branch:'جدة'}})},rep).assignedTo,'rep-9','a customer assigned to another member keeps it');
 const visit=at(entry(S,rep,'visit','v1',{body:JSON.stringify({createKey:'v1',customerId:'crm-rep-1-c1',data:{result:'تم',date:'2020-01-01'}})}),'2026-11-21T21:30:00.000Z');
 const v=S.offlineProjection(visit,rep);
 eq([v.id,v.kind,v.parentId,v.assignedTo,v.data.date,v.data.visitWorkflow,v.data.performedBy,v.data.recordedByEmail,v.data._readOnly,v.data._masterReadOnly],['customer-visit-v1','activity','crm-rep-1-c1','rep-1','2026-11-22','customer-v1','rep-1','Rep.One@YourRest.org',true,true],'a visit is dated by its Riyadh day (00:30 is the next day), never by the day it carries');
 eq(S.offlineProjection(at(visit,'2026-11-21T20:59:59.999Z'),rep).data.date,'2026-11-21','23:59:59 in Riyadh is still the same day');
 const followup=at(entry(S,rep,'followup','f1',{body:JSON.stringify({createKey:'f1',customerId:'crm-x',sourceId:'customer-visit-v0',data:{date:'2026-11-25'}})}),'2026-11-21T21:30:00.000Z');
 const f=S.offlineProjection(followup,rep);
 eq([f.id,f.data.date,f.data.visitWorkflow,f.data.summary,f.data.sourceId],['customer-followup-f1','2026-11-25','followup-v1','متابعة العميل','customer-visit-v0'],'a follow-up keeps the day it was planned for and its source');
 eq(S.offlineProjection({...followup,body:JSON.stringify({createKey:'f1',customerId:'crm-x',data:{}})},rep).data.date,'2026-11-22','a follow-up without its day takes the Riyadh day');
 const service=at(entry(S,rep,'service','s1',{body:JSON.stringify({requestId:'s1',customerId:'crm-x',registration:{subject:'صيانة'}})}),'2026-11-21T06:00:00.000Z');
 const s=S.offlineProjection(service,rep);
 eq([s.id,s.data.subject,s.data.serviceIntakeId,s.data.visitWorkflow],['intake-service-s1','صيانة','service-s1','service-intake-v1'],'a customer-service registration');
 eq([S.offlineProjection(entry(S,rep,'file','p1'),rep),S.offlineProjection(entry(S,rep,'plan','d1',{body:'{}'}),rep),S.offlineProjection({...visit,body:undefined},rep)],[undefined,undefined,undefined],'an attachment, a plan and an entry without body project nothing');

 // The snapshot as the screen reads it: the server's rows, then receipts and queued entries it does not have yet.
 const existing=at(entry(S,rep,'customer','existing',{body:JSON.stringify({createKey:'existing',data:{name:'x'}})}),'2026-11-21T06:00:00.000Z');
 const stale=entry(S,{...rep,authVersion:2},'visit','stale',{body:JSON.stringify({createKey:'stale',customerId:'crm-x',data:{}})});
 const archived=entry(S,rep,'visit','archived',{status:'blocked',archivedAt:'2026-11-21T07:00:00.000Z',body:JSON.stringify({createKey:'archived',customerId:'crm-x',data:{}})});
 for(const job of [customer,visit,existing,stale,archived])idb.put(DB,'outbox',job);
 const stamp=S.offlineOwner(rep).stamp,receipt=(id,ownerId,ownerStamp,projectionId)=>({id,ownerId,ownerStamp,fingerprint:'f',localId:'l',result:{id:projectionId},projection:projectionId?row(projectionId):undefined,createdAt:'2026-11-21T06:00:00.000Z'});
 for(const item of [receipt('r1','rep-1',stamp,'crm-rep-1-acked'),receipt('r2','rep-1',stamp,'crm-rep-1-existing'),receipt('r3','rep-2',stamp,'crm-rep-2-acked'),receipt('r4','rep-1','older-stamp','crm-rep-1-old'),receipt('r5','rep-1',stamp,undefined)])idb.put(DB,'receipts',item);
 const snapshot=snapshotOf(rep,[row('crm-rep-1-existing')]);
 const augmented=await S.augmentOfflineSnapshot(snapshot);
 eq(augmented.records.map(item=>item.id),['crm-rep-1-existing','crm-rep-1-acked','crm-rep-1-c1','customer-visit-v1'],'the server\'s rows first, a receipt it lacks, then the queued entries; no duplicate, nothing of another stamp, nobody else\'s, nothing archived');
 eq(snapshot.records.length,1,'the snapshot given is not changed');

 // The acknowledgement: the receipt and the removal commit together.
 await settle();events=0;
 await S.acknowledgeOffline(visit,{ok:true,id:'srv-visit-1'},rep);
 const kept=idb.get(DB,'receipts',visit.id);
 eq([idb.get(DB,'outbox',visit.id),kept.result,kept.fingerprint,kept.localId,kept.ownerStamp,kept.projection.id,kept.projection.data._offlineAcknowledged,'_offlineState' in kept.projection.data,'_offlineQueueId' in kept.projection.data,events],[undefined,{ok:true,id:'srv-visit-1'},visit.fingerprint,'customer-visit-v1',stamp,'srv-visit-1',true,false,false,1],'the entry leaves the queue and its receipt keeps the server\'s answer and the record under the server\'s id');
 await S.acknowledgeOffline({...service,id:'rep-1:service:s1'},{ok:true,id:'77'},rep);
 eq(idb.get(DB,'receipts','rep-1:service:s1').projection.id,'intake-77','a service registration is projected as its intake');
 const file=entry(S,rep,'file','p9',{blob:new Blob(['%PDF-1.4'])});idb.put(DB,'outbox',file);
 await S.acknowledgeOffline(file,{id:'file-9',name:'عرض.pdf'},rep);
 eq(idb.get(DB,'receipts',file.id).projection,undefined,'an attachment has no projection');
 idb.faults.commit=1;
 await rejects(S.acknowledgeOffline(customer,{ok:true,id:'srv-c1'},rep),S.OfflineStorageError,'a commit that fails');
 eq([!!idb.get(DB,'outbox',customer.id),idb.get(DB,'receipts',customer.id)],[true,undefined],'leaves the entry in the queue and no receipt: an entry is never lost before it is acknowledged');

 // An update writes an entry that is there, and never brings back one that left.
 await S.updateOfflineJob({...customer,message:'محفوظ على الجهاز'});
 eq(idb.get(DB,'outbox',customer.id).message,'محفوظ على الجهاز','an entry is updated');
 await S.updateOfflineJob({...visit,status:'pending'});
 eq(idb.get(DB,'outbox',visit.id),undefined,'an acknowledged entry is not written back');
});

await counted('notices',async()=>{
 reset();
 const listener=[];const stop=S.subscribeOffline(()=>listener.push('called'));
 const before=events;S.offlineChanged();
 eq([listener.length,events-before,broadcast.posted.at(-1).data],[1,1,'changed'],'a change tells the listeners, the page and the other tabs');
 const other=await tab();other.S.offlineChanged('changed');await settle();
 eq(listener.length,2,'a change in another tab reaches this tab\'s listeners');
 stop();S.offlineChanged();await settle();
 eq(listener.length,2,'an unsubscribed listener hears nothing');
 const openBefore=broadcast.open.size;const lazy=await tab();await lazy.S.loadOfflineSnapshot();
 eq(broadcast.open.size,openBefore,'a tab that only reads opens no channel');
 lazy.S.subscribeOffline(()=>{});eq(broadcast.open.size,openBefore+1,'a subscriber opens one');lazy.S.offlineChanged();eq(broadcast.open.size,openBefore+1,'and only one');
});

await counted('offline sign-out',async()=>{
 reset();
 const fetches=[];let respond=async()=>new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});
 globalThis.fetch=async(url,init)=>{fetches.push({url,init});return respond(url,init);};
 const saved=globalThis.window;delete globalThis.window;
 eq(A.isOfflineLogoutPending(),false,'without a window (the server): never pending');
 globalThis.window=saved;
 eq(A.isOfflineLogoutPending(),false,'a fresh browser');
 storage.map.set(LOGOUT,'');eq(A.isOfflineLogoutPending(),true,'present, whatever its value');storage.map.delete(LOGOUT);
 storage.refuse(true);eq(A.isOfflineLogoutPending(),true,'a blocked localStorage counts as signed out');storage.refuse(false);
 eq([await A.finishPendingOfflineLogout(),fetches.length],[false,0],'nothing pending: no request');

 const t=await tab();await t.S.saveOfflineSnapshot(snapshotOf(rep));
 const lockedPosts=broadcast.posted.filter(item=>item.data==='locked').length;storage.refuseWrites(true);
 await rejects(t.A.prepareOfflineLogout(),error=>error.name==='QuotaExceededError','a flag that cannot be kept fails the sign-out');
 eq([meta('session')?.ownerId,broadcast.posted.filter(item=>item.data==='locked').length],['rep-1',lockedPosts],'and the device session is not closed, no tab told (nothing claimed)');
 storage.refuseWrites(false);
 const posted=broadcast.posted.length;
 await t.A.prepareOfflineLogout();
 eq([storage.map.get(LOGOUT),meta('session'),broadcast.posted.slice(posted).map(item=>item.data)[0]],['1',undefined,'locked'],'the flag first, then the device session closed and the tabs told');
 eq(await t.S.loadOfflineSnapshot(),null,'nothing is served');

 // Finishing it on the server.
 respond=async()=>{throw new TypeError('Failed to fetch');};
 await rejects(t.A.finishPendingOfflineLogout(),TypeError,'no network: it stays pending');
 eq(t.A.isOfflineLogoutPending(),true,'still pending');
 for(const [status,body] of [[500,'{"ok":true}'],[200,'{"ok":false}'],[200,'[]'],[200,'null'],[200,'"ok"'],[200,'<html>sign in</html>']]){
  respond=async()=>new Response(body,{status,headers:{'Content-Type':'application/json'}});
  await rejects(t.A.finishPendingOfflineLogout(),Error,'not confirmed: '+status+' '+body);
 }
 timers.clear();fetches.length=0;
 let release;respond=()=>new Promise(resolve=>{release=()=>resolve(new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}}));});
 const first=t.A.finishPendingOfflineLogout(),second=t.A.finishPendingOfflineLogout();
 await until(()=>fetches.length>0,'the sign-out request');await settle(3);
 eq(fetches.length,1,'two callers share one request');
 const call=fetches[0];
 eq([call.url,call.init.method,call.init.credentials,call.init.cache,call.init.headers['Content-Type'],call.init.body,call.init.signal instanceof AbortSignal],['/api/auth/logout','POST','same-origin','no-store','application/json','{}',true],'the server sign-out request');
 eq([...timers.values()].map(item=>item.delay),[20000],'bounded by 20 seconds');
 release();
 eq([await first,await second,timers.size],[true,true,0],'both learn it succeeded and the timer is cleared');
 eq(t.A.isOfflineLogoutPending(),true,'the flag stays until an explicit sign-in');
 fetches.length=0;respond=(url,init)=>new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));});
 const hanging=t.A.finishPendingOfflineLogout();await until(()=>fetches.length>0,'the hanging sign-out');
 for(const item of [...timers.values()])item.callback();
 await rejects(hanging,error=>error.name==='AbortError','after 20 seconds the request is aborted');
 respond=async()=>new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});
 fetches.length=0;eq([await t.A.finishPendingOfflineLogout(),fetches.length],[true,1],'a later call makes a new request (a repeated sign-out is harmless)');
 storage.refuseWrites(true);assert.throws(()=>t.A.confirmOfflineSignIn());checks++;eq(t.A.isOfflineLogoutPending(),true,'a sign-in that cannot clear the flag leaves it');storage.refuseWrites(false);
 t.A.confirmOfflineSignIn();eq(t.A.isOfflineLogoutPending(),false,'only a confirmed sign-in clears it');
 await t.S.lockOfflineSession();await t.S.saveOfflineSnapshot(snapshotOf(peer));
 eq((await t.S.loadOfflineSnapshot()).me.id,'rep-2','after it, the next member\'s authorized save opens the device');
});

eq(idb.stats.callbackErrors,[],'no storage callback threw');
console.log(JSON.stringify({ok:true,checks,counts,realBrowser:false,storage:'IndexedDB, localStorage and BroadcastChannel stand-ins (scripts/lib/fake-browser-storage.mjs)',clock:'fixed'}));

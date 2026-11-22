// Stand-ins for the browser storage the offline modules use (lib/offline-store.ts, lib/offline-submit.ts, lib/offline-auth.ts), for the
// unit tests that run those modules in Node (tests/offline-store-unit.mjs, tests/offline-submit-unit.mjs). They keep the contract the
// modules rely on, not more:
// - IndexedDB: `open` with `onupgradeneeded`, object stores with an inline key path, `get`, `getAll` (key order), `put`, `add` (ConstraintError
//   on an existing key), `delete`; readonly and readwrite transactions that run one after another when their stores overlap (two readonly ones
//   together), a working copy committed when no request is left after the last callback, `abort()` that throws the copy away and fails the
//   requests still queued, a request error that aborts its transaction unless its handler calls preventDefault, a request made on a
//   transaction that is no longer active refused (TransactionInactiveError), values copied on the way in and out (a Blob or File is kept as
//   it is, as a browser keeps it), and `onversionchange` on the open connections.
// - localStorage (one origin, shared by every tab of a test) that can refuse every call or only writes, as a blocked or full browser does.
// - BroadcastChannel: a message reaches the other channels of the same name, never the sender, on a later turn.
// Events are delivered with setImmediate, never with the global timers a test may replace. Faults are injected through `faults`.
const later=globalThis.setImmediate.bind(globalThis);
const domError=(name,message=name)=>new DOMException(message,name);

function copy(value){
 if(value===null||typeof value!=='object')return value;
 if(value instanceof Blob)return value;
 if(value instanceof Date)return new Date(value.getTime());
 if(Array.isArray(value))return value.map(copy);
 const out={};for(const [key,item] of Object.entries(value))out[key]=copy(item);return out;
}
function keyText(key){
 if(typeof key==='string')return 's'+key;
 if(typeof key==='number'&&!Number.isNaN(key))return 'n'+String(key).padStart(24,'0');
 throw domError('DataError','The parameter is not a valid key.');
}
const keyOrder=(a,b)=>typeof a.key===typeof b.key?(a.key<b.key?-1:a.key>b.key?1:0):typeof a.key==='number'?-1:1;

export function createFakeIndexedDB(){
 const databases=new Map();
 /** open: 'error' or 'blocked' for the next open; commit: how many readwrite commits fail (QuotaExceededError); request: how many requests
  *  fail (UnknownError). */
 const faults={open:null,commit:0,request:0};
 const stats={opens:0,transactions:0,commits:0,writes:0,aborts:0,callbackErrors:[]};

 class FakeRequest{
  constructor(transaction){this.transaction=transaction;this.readyState='pending';this.result=undefined;this.error=null;this.onsuccess=null;this.onerror=null;this.onblocked=null;this.onupgradeneeded=null;}
 }
 function fire(transaction,handler,event){
  if(typeof handler!=='function')return true;
  try{handler.call(event.target,event);return true;}catch(error){stats.callbackErrors.push(error);if(transaction)transaction._finish(domError('AbortError','An event handler threw.'));return false;}
 }
 function pump(database){
  for(let index=0;index<database.transactions.length;index++){
   const transaction=database.transactions[index];
   if(transaction._state!=='waiting')continue;
   const blocked=database.transactions.slice(0,index).some(earlier=>earlier._state!=='done'&&(earlier.mode==='readwrite'||transaction.mode==='readwrite')&&earlier._names.some(name=>transaction._names.includes(name)));
   if(blocked)continue;
   transaction._state='running';
   transaction._work=new Map(transaction._names.map(name=>[name,new Map(database.stores.get(name).records)]));
   later(()=>transaction._step());
  }
 }
 class FakeObjectStore{
  constructor(transaction,name){this._transaction=transaction;this.name=name;this.keyPath=transaction._database.stores.get(name).keyPath;}
  _request(operation){
   const transaction=this._transaction;
   if(transaction._state==='done'||!transaction._active)throw domError('TransactionInactiveError','The transaction is not active.');
   const request=new FakeRequest(transaction);
   if(faults.request>0){faults.request--;request._operation=()=>{throw domError('UnknownError','Injected storage failure.');};}
   else request._operation=operation;
   transaction._requests.push(request);return request;
  }
  _writable(){if(this._transaction.mode!=='readwrite')throw domError('ReadOnlyError','The transaction is read-only.');}
  get(key){const text=keyText(key);return this._request(work=>copy(work.get(this.name).get(text)?.value));}
  getAll(){return this._request(work=>[...work.get(this.name).values()].sort(keyOrder).map(entry=>copy(entry.value)));}
  count(){return this._request(work=>work.get(this.name).size);}
  put(value){this._writable();const key=value?.[this.keyPath],text=keyText(key),stored=copy(value);return this._request(work=>{work.get(this.name).set(text,{key,value:stored});return key;});}
  add(value){this._writable();const key=value?.[this.keyPath],text=keyText(key),stored=copy(value);return this._request(work=>{const records=work.get(this.name);if(records.has(text))throw domError('ConstraintError','A record with this key already exists.');records.set(text,{key,value:stored});return key;});}
  delete(key){this._writable();const text=keyText(key);return this._request(work=>{work.get(this.name).delete(text);return undefined;});}
  clear(){this._writable();return this._request(work=>{work.get(this.name).clear();return undefined;});}
 }
 class FakeTransaction{
  constructor(connection,names,mode){
   this.db=connection;this.mode=mode;this.objectStoreNames=names;this._names=names;this._database=connection._database;this._requests=[];this._state='waiting';
   this._active=true;this.error=null;this.oncomplete=null;this.onabort=null;this.onerror=null;stats.transactions++;
   later(()=>{this._active=false;});
  }
  objectStore(name){
   if(this._state==='done')throw domError('InvalidStateError','The transaction has finished.');
   if(!this._names.includes(name))throw domError('NotFoundError','The object store is not in this transaction.');
   return new FakeObjectStore(this,name);
  }
  abort(){if(this._state==='done')throw domError('InvalidStateError','The transaction has finished.');this._finish(domError('AbortError','The transaction was aborted.'));}
  _step(){
   if(this._state!=='running')return;
   const request=this._requests.shift();
   if(!request){
    if(this.mode==='readwrite'&&faults.commit>0){faults.commit--;this._finish(domError('QuotaExceededError','The quota has been exceeded.'));return;}
    if(this.mode==='readwrite'){for(const [name,records] of this._work)this._database.stores.get(name).records=records;stats.writes++;}
    this._state='done';this._active=false;stats.commits++;
    this._database.transactions=this._database.transactions.filter(item=>item!==this);pump(this._database);
    fire(null,this.oncomplete,{target:this,type:'complete'});return;
   }
   let result,error=null;
   try{result=request._operation(this._work);}catch(caught){error=caught;}
   request.readyState='done';
   this._active=true;
   try{
    if(error){
     request.error=error;let prevented=false;
     if(!fire(this,request.onerror,{target:request,type:'error',preventDefault(){prevented=true;},stopPropagation(){}}))return;
     if(!prevented){this.error=error;fire(null,this.onerror,{target:request,type:'error',preventDefault(){},stopPropagation(){}});this._finish(error);return;}
    }else{request.result=result;if(!fire(this,request.onsuccess,{target:request,type:'success'}))return;}
   }finally{this._active=false;}
   later(()=>this._step());
  }
  _finish(error){
   if(this._state==='done')return;
   this._state='done';this._active=false;this.error=error;stats.aborts++;
   const pending=this._requests.splice(0);
   this._database.transactions=this._database.transactions.filter(item=>item!==this);pump(this._database);
   later(()=>{
    for(const request of pending){request.readyState='done';request.error=domError('AbortError','The transaction was aborted.');fire(null,request.onerror,{target:request,type:'error',preventDefault(){},stopPropagation(){}});}
    fire(null,this.onabort,{target:this,type:'abort'});
   });
  }
 }
 class FakeConnection{
  constructor(name,database,version){this.name=name;this._database=database;this.version=version;this.closed=false;this.onversionchange=null;this._upgrading=false;}
  get objectStoreNames(){const names=[...this._database.stores.keys()];return {length:names.length,contains:name=>names.includes(name),item:index=>names[index]??null};}
  createObjectStore(name,options={}){
   if(!this._upgrading)throw domError('InvalidStateError','Not in a version change.');
   if(this._database.stores.has(name))throw domError('ConstraintError','The object store already exists.');
   this._database.stores.set(name,{keyPath:options.keyPath,records:new Map()});return {name};
  }
  transaction(names,mode='readonly'){
   if(this.closed)throw domError('InvalidStateError','The database connection is closing.');
   const list=typeof names==='string'?[names]:[...names];
   if(!list.length)throw domError('InvalidAccessError','No object store named.');
   for(const name of list)if(!this._database.stores.has(name))throw domError('NotFoundError','No such object store: '+name);
   if(mode!=='readonly'&&mode!=='readwrite')throw new TypeError('Invalid transaction mode');
   const transaction=new FakeTransaction(this,list,mode);this._database.transactions.push(transaction);pump(this._database);return transaction;
  }
  close(){this.closed=true;this._database.connections.delete(this);}
 }
 const indexedDB={
  open(name,version=1){
   const request=new FakeRequest(null);stats.opens++;
   later(()=>{
    if(faults.open==='error'){faults.open=null;request.readyState='done';request.error=domError('UnknownError','Injected open failure.');fire(null,request.onerror,{target:request,type:'error',preventDefault(){}});return;}
    if(faults.open==='blocked'){faults.open=null;fire(null,request.onblocked,{target:request,type:'blocked'});return;}
    let database=databases.get(name);
    if(!database){database={version:0,stores:new Map(),connections:new Set(),transactions:[]};databases.set(name,database);}
    if(version<database.version){request.readyState='done';request.error=domError('VersionError','The requested version is older.');fire(null,request.onerror,{target:request,type:'error',preventDefault(){}});return;}
    const connection=new FakeConnection(name,database,version);request.result=connection;request.readyState='done';
    if(version>database.version){const oldVersion=database.version;database.version=version;connection._upgrading=true;fire(null,request.onupgradeneeded,{target:request,type:'upgradeneeded',oldVersion,newVersion:version});connection._upgrading=false;}
    database.connections.add(connection);
    fire(null,request.onsuccess,{target:request,type:'success'});
   });
   return request;
  }
 };
 const store=(name,storeName)=>{const database=databases.get(name);if(!database?.stores.has(storeName))return null;return database.stores.get(storeName);};
 return {
  indexedDB,faults,stats,
  /** Every record of a store, in key order (copies). */
  all(name,storeName){const records=store(name,storeName);return records?[...records.records.values()].sort(keyOrder).map(entry=>copy(entry.value)):[];},
  get(name,storeName,key){return copy(store(name,storeName)?.records.get(keyText(key))?.value);},
  /** Writes outside any transaction: what another tab, an older release or a crash left on the device. */
  put(name,storeName,value){const records=store(name,storeName);const key=value[records.keyPath];records.records=new Map(records.records).set(keyText(key),{key,value:copy(value)});},
  delete(name,storeName,key){const records=store(name,storeName);records.records=new Map(records.records);records.records.delete(keyText(key));},
  clear(name){const database=databases.get(name);if(database)for(const item of database.stores.values())item.records=new Map();},
  /** Another tab opened a newer version: every open connection is told. */
  versionChange(name){const database=databases.get(name);for(const connection of [...(database?.connections||[])])fire(null,connection.onversionchange,{target:connection,type:'versionchange'});},
  connections(name){return databases.get(name)?.connections.size||0;},
  busy(name){return (databases.get(name)?.transactions||[]).length;}
 };
}

export function createFakeLocalStorage(){
 const map=new Map();let refuse=false,refuseWrites=false,refuseRead=()=>false;
 const localStorage={
  getItem(key){if(refuse||refuseRead(String(key)))throw domError('SecurityError','Storage is blocked.');return map.has(String(key))?map.get(String(key)):null;},
  setItem(key,value){if(refuse||refuseWrites)throw domError(refuse?'SecurityError':'QuotaExceededError','Storage refused the write.');map.set(String(key),String(value));},
  removeItem(key){if(refuse||refuseWrites)throw domError(refuse?'SecurityError':'QuotaExceededError','Storage refused the write.');map.delete(String(key));},
  clear(){if(refuse||refuseWrites)throw domError('SecurityError','Storage is blocked.');map.clear();},
  key(index){return [...map.keys()][index]??null;},
  get length(){return map.size;}
 };
 return {localStorage,map,refuse(value=true){refuse=value;},refuseWrites(value=true){refuseWrites=value;},
  /** Only the reads of the keys `test` names fail (null: none). */
  refuseRead(test){refuseRead=test||(()=>false);}};
}

export function createFakeBroadcast(){
 const open=new Set(),posted=[];
 class FakeBroadcastChannel{
  constructor(name){this.name=String(name);this.onmessage=null;this.closed=false;open.add(this);}
  postMessage(data){
   if(this.closed)throw domError('InvalidStateError','The channel is closed.');
   posted.push({name:this.name,data});
   for(const other of open)if(other!==this&&other.name===this.name)later(()=>{if(!other.closed)other.onmessage?.({data,type:'message'});});
  }
  close(){this.closed=true;open.delete(this);}
 }
 return {BroadcastChannel:FakeBroadcastChannel,posted,open};
}

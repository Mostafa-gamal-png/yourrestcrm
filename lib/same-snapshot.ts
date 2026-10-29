import type {OfflineSnapshot} from './offline-store';

// Whether two snapshots would draw the same screen. Opening the app shows the device's copy at once and the server's answer a moment
// later, and saving that answer on the device announces it once more; when nothing changed in between (the usual case) neither may
// redraw every page. Records are compared one by one, the cheap fields first and then in full (the server adds fields of its own, such
// as an open service intake, without changing a record's version); everything else in the snapshot is compared as JSON.
export function sameSnapshot(a:OfflineSnapshot,b:OfflineSnapshot):boolean{
 if(a===b)return true;
 const keys=Object.keys(a);
 if(keys.length!==Object.keys(b).length||keys.some(key=>!Object.prototype.hasOwnProperty.call(b,key)))return false;
 if(!Array.isArray(a.records)||!Array.isArray(b.records)||a.records.length!==b.records.length)return false;
 for(let i=0;i<a.records.length;i++){
  const x=a.records[i],y=b.records[i];
  if(x===y)continue;
  if(x.id!==y.id||x.version!==y.version||x.updatedAt!==y.updatedAt||x.kind!==y.kind||x.parentId!==y.parentId||x.assignedTo!==y.assignedTo)return false;
  if(JSON.stringify(x)!==JSON.stringify(y))return false;
 }
 for(const key of keys)if(key!=='records'&&JSON.stringify(a[key])!==JSON.stringify(b[key]))return false;
 return true;
}

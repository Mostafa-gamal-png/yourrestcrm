import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,chmod,symlink,stat,readlink,open,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {sqliteDatabase,privateObjects} from '../portable/storage.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(path.join(os.tmpdir(),'yourrest-storage-'));
let db,restored,checks=0;
try{
 const filename=path.join(work,'database.sqlite'),objectsPath=path.join(work,'objects');
 assert.throws(()=>sqliteDatabase(filename));checks++;
 db=sqliteDatabase(filename,{create:true});
 const migrations=(await readdir(path.join(root,'drizzle'))).filter(name=>name.endsWith('.sql')).sort();
 for(const name of migrations)await db.exec(await readFile(path.join(root,'drizzle',name),'utf8'));
 await db.prepare("INSERT INTO crm_members(id,email,name,role,branch,created_at) VALUES(?,?,?,?,?,?)").bind('owner','owner@example.test','Owner','admin','الدمام','2026-09-30').run();
 const result=await db.batch([db.prepare("UPDATE crm_members SET name='Changed' WHERE id='owner'"),db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT 'receipt','owner','owner','test','{}','2026-09-30' WHERE changes()=1")]);
 assert.equal(result[0].meta.changes,1);assert.equal(result[1].meta.changes,1);checks++;
 await assert.rejects(db.batch([db.prepare("UPDATE crm_members SET name='MUST ROLLBACK' WHERE id='owner'"),db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('receipt','owner','owner','test','{}','2026-09-30')")]));
 assert.equal(await db.prepare("SELECT name FROM crm_members WHERE id='owner'").first('name'),'Changed');checks++;
 const zero=await db.batch([db.prepare("UPDATE crm_members SET name='bad' WHERE id='missing'"),db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT 'must-not-exist','owner','owner','test','{}','2026-09-30' WHERE changes()=1")]);assert.equal(zero[1].meta.changes,0);checks++;
 const responses=await Promise.all(Array.from({length:10},(_,i)=>db.batch([db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)").bind('parallel-'+i,'owner','owner','test','{}','2026-09-30')])));assert.equal(responses.length,10);checks++;
 assert.equal((await db.prepare('SELECT * FROM crm_audit').all()).results.length,11);checks++;
 assert.equal(await db.prepare('SELECT id FROM crm_members WHERE id=?').bind('missing').first(),null);checks++;
 assert.deepEqual(await db.prepare('SELECT id FROM crm_members').raw(),[['owner']]);checks++;
 assert.equal(await db.prepare("SELECT json_extract(?, '$.value') AS n").bind('{"value":42}').first('n'),42);checks++;
 assert.equal((await stat(filename)).mode&0o777,0o600);checks++;
 const snapshot=path.join(work,'snapshot.sqlite');await db.snapshot(snapshot);restored=sqliteDatabase(snapshot);assert.equal(await restored.prepare('SELECT name FROM crm_members').first('name'),'Changed');checks++;
 await assert.rejects(db.batch([restored.prepare('SELECT 1')]));checks++;
 await assert.rejects(db.snapshot(snapshot));checks++;
 const objects=privateObjects(objectsPath),bytes=Buffer.from('stored-image-bytes'),key='../../secret?.png';
 assert.equal(await objects.get('missing'),null);checks++;
 await objects.put(key,bytes,{httpMetadata:{contentType:'image/png'}});assert.deepEqual((await objects.get(key)).body,bytes);checks++;
 assert.deepEqual(Buffer.from(await (await objects.get(key)).arrayBuffer()),bytes);checks++;
 assert.equal((await stat(objectsPath)).mode&0o777,0o700);checks++;
 assert.equal((await stat(path.join(objectsPath,createHash('sha256').update(key).digest('hex')))).mode&0o777,0o600);checks++;
 await objects.put(key,new Uint8Array([1,2,3]).buffer);assert.deepEqual((await objects.get(key)).body,Buffer.from([1,2,3]));checks++;
 await objects.put(key,'replacement');assert.equal((await objects.get(key)).body.toString(),'replacement');checks++;
 await objects.put('second',bytes);await objects.delete([key,'second']);assert.equal(await objects.get(key),null);assert.equal(await objects.get('second'),null);checks++;
 await objects.delete('missing');checks++;
 for(const bad of ['',null,'\0',123]){await assert.rejects(objects.get(bad));await assert.rejects(objects.put(bad,bytes));await assert.rejects(objects.delete(bad));checks++;}
 await assert.rejects(objects.put('bad',{}));checks++;
 const outside=path.join(work,'outside');await writeFile(outside,'private',{mode:0o600});
 const linkKey='symlink',linkFile=path.join(objectsPath,createHash('sha256').update(linkKey).digest('hex'));await symlink(outside,linkFile);await assert.rejects(objects.get(linkKey));checks++;
 await objects.put(linkKey,'safe replacement');assert.equal(await readFile(outside,'utf8'),'private');checks++;
 const alias=path.join(work,'alias');await symlink(objectsPath,alias);assert.throws(()=>privateObjects(alias));assert.throws(()=>sqliteDatabase(path.join(alias,'sqlite'),{create:true}));checks++;
 const publicPath=path.join(work,'public_html');await mkdir(publicPath,{mode:0o700});assert.throws(()=>privateObjects(path.join(publicPath,'objects')));assert.throws(()=>sqliteDatabase(path.join(publicPath,'sqlite'),{create:true}));checks++;
 const broad=path.join(work,'broad');await mkdir(broad,{mode:0o755});await chmod(broad,0o755);assert.throws(()=>privateObjects(broad));checks++;
 await chmod(snapshot,0o644);assert.throws(()=>sqliteDatabase(snapshot));await chmod(snapshot,0o600);checks++;
 // Observe real fsync and rollback of temp uploads on disk error; never consume production files.
 const probe=await open(work,'r'),prototype=Object.getPrototypeOf(probe),original=prototype.sync,observed=[];await probe.close();
 prototype.sync=async function(){observed.push(await readlink('/proc/self/fd/'+this.fd));return original.call(this);};
 try{await objects.put('durable',bytes);assert(observed.at(-1)===objectsPath);assert(observed.some(p=>p.includes('.upload-')));checks++;}finally{prototype.sync=original;}
 prototype.sync=async function(){throw Object.assign(Error('Injected write failure'),{code:'EIO'});};
 try{await assert.rejects(objects.put('failed',bytes));assert.equal(await objects.get('failed'),null);assert(!(await readdir(objectsPath)).some(p=>p.startsWith('.upload-')));checks++;}finally{prototype.sync=original;}
 console.log(JSON.stringify({ok:true,checks,migrations:migrations.length,actual_storage:'isolated temporary SQLite and files',production_data_used:false}));
}finally{restored?.close();db?.close();await rm(work,{recursive:true,force:true});}

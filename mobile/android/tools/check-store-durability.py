#!/usr/bin/env python3
"""Run the production Java stores against real SQLite through small Android API adapters.

This verifies the Java queue methods/SQL, not Android filesystem encryption, OS life cycle,
physical-device background behavior, or the production HTTP API.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--jdk', type=Path, required=True)
parser.add_argument('--framework', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]

SQLITE_BRIDGE = r'''
import sys,json,sqlite3
con=sqlite3.connect(sys.argv[1],isolation_level=None)
for line in sys.stdin:
 try:
  request=json.loads(line)
  cur=con.execute(request['sql'],request.get('params',[]))
  result={'rows':cur.fetchall() if cur.description else [],'changes':cur.rowcount,'id':cur.lastrowid}
 except Exception as error: result={'error':str(error)}
 print(json.dumps(result),flush=True)
'''
STUBS = {
'android/content/Context.java': '''package android.content;
public class Context { public final String root; public Context(String root){this.root=root;} }
''',
'android/content/ContentValues.java': '''package android.content;
public class ContentValues extends java.util.LinkedHashMap<String,Object> {
 public void put(String k,String v){super.put(k,v);} public void put(String k,Integer v){super.put(k,v);} public void put(String k,Long v){super.put(k,v);}
}
''',
'android/database/Cursor.java': '''package android.database;
import org.json.*;
public class Cursor implements AutoCloseable {
 private final JSONArray rows; private int at=-1; public Cursor(JSONArray rows){this.rows=rows;}
 public boolean moveToFirst(){at=0;return rows.length()>0;} public boolean moveToNext(){return ++at<rows.length();}
 public String getString(int i){try{return rows.getJSONArray(at).isNull(i)?null:rows.getJSONArray(at).getString(i);}catch(Exception e){throw new RuntimeException(e);}}
 public long getLong(int i){try{return rows.getJSONArray(at).getLong(i);}catch(Exception e){throw new RuntimeException(e);}}
 public int getInt(int i){return (int)getLong(i);} public boolean isNull(int i){try{return rows.getJSONArray(at).isNull(i);}catch(Exception e){throw new RuntimeException(e);}}
 public void close(){}
}
''',
'android/database/sqlite/SQLiteDatabase.java': r'''package android.database.sqlite;
import android.content.*;import android.database.*;import org.json.*;import java.io.*;import java.util.*;
public class SQLiteDatabase {
 public static final int CONFLICT_REPLACE=5,CONFLICT_IGNORE=4;
 private final Process process;private final BufferedReader out;private final BufferedWriter in;private boolean success=false;
 SQLiteDatabase(String path){try{process=new ProcessBuilder("python3",System.getProperty("sqlite.bridge"),path).redirectError(ProcessBuilder.Redirect.INHERIT).start();out=new BufferedReader(new InputStreamReader(process.getInputStream()));in=new BufferedWriter(new OutputStreamWriter(process.getOutputStream()));}catch(Exception e){throw new RuntimeException(e);}}
 private JSONObject run(String sql,Object[] params){try{JSONObject request=new JSONObject().put("sql",sql).put("params",new JSONArray(params==null?new Object[0]:params));in.write(request.toString());in.newLine();in.flush();JSONObject response=new JSONObject(out.readLine());if(response.has("error"))throw new RuntimeException(response.getString("error"));return response;}catch(Exception e){throw new RuntimeException(e);}}
 public void execSQL(String sql){run(sql,null);}public void execSQL(String sql,Object[] params){run(sql,params);}
 public Cursor rawQuery(String sql,String[] params){try{return new Cursor(run(sql,params).getJSONArray("rows"));}catch(Exception e){throw new RuntimeException(e);}}
 public long insertWithOnConflict(String table,String unused,ContentValues values,int conflict){String sql="INSERT "+(conflict==CONFLICT_REPLACE?"OR REPLACE ":conflict==CONFLICT_IGNORE?"OR IGNORE ":"")+"INTO "+table+"("+String.join(",",values.keySet())+") VALUES ("+String.join(",",Collections.nCopies(values.size(),"?"))+")";try{return run(sql,values.values().toArray()).getLong("id");}catch(Exception e){throw new RuntimeException(e);}}
 public long insertOrThrow(String table,String unused,ContentValues values){return insertWithOnConflict(table,unused,values,0);}public long insert(String table,String unused,ContentValues values){return insertOrThrow(table,unused,values);}
 public int delete(String table,String where,String[] params){try{return run("DELETE FROM "+table+(where==null?"":" WHERE "+where),params).getInt("changes");}catch(Exception e){throw new RuntimeException(e);}}
 public int update(String table,ContentValues values,String where,String[] params){ArrayList<Object> all=new ArrayList<>(values.values());if(params!=null)Collections.addAll(all,params);StringJoiner set=new StringJoiner(",");for(String key:values.keySet())set.add(key+"=?");try{return run("UPDATE "+table+" SET "+set+(where==null?"":" WHERE "+where),all.toArray()).getInt("changes");}catch(Exception e){throw new RuntimeException(e);}}
 public void beginTransaction(){success=false;execSQL("BEGIN IMMEDIATE");}public void setTransactionSuccessful(){success=true;}public void endTransaction(){execSQL(success?"COMMIT":"ROLLBACK");success=false;}
 public void close(){try{in.close();process.waitFor();}catch(Exception e){throw new RuntimeException(e);}}
}
''',
'android/database/sqlite/SQLiteOpenHelper.java': '''package android.database.sqlite;
import android.content.Context;
public abstract class SQLiteOpenHelper {
 private final Context context;private final String name;private SQLiteDatabase db;
 protected SQLiteOpenHelper(Context context,String name,Object factory,int version){this.context=context;this.name=name;}
 public abstract void onCreate(SQLiteDatabase db);public abstract void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion);
 public synchronized SQLiteDatabase getWritableDatabase(){if(db==null){boolean exists=new java.io.File(context.root,name).exists();db=new SQLiteDatabase(new java.io.File(context.root,name).getPath());if(!exists)onCreate(db);}return db;}
 public SQLiteDatabase getReadableDatabase(){return getWritableDatabase();}public void close(){if(db!=null){db.close();db=null;}}
}
''',
'org/yourrest/crm/StoreDurabilityCheck.java': r'''package org.yourrest.crm;
import android.content.*;import android.database.*;import android.database.sqlite.*;import org.json.*;
public class StoreDurabilityCheck {
 static int checks=0;static void ok(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
 interface Call{void run()throws Exception;}static void fails(Call action,String label)throws Exception{try{action.run();throw new AssertionError(label);}catch(IllegalStateException expected){checks++;}}
 static long at=RouteRules.millis("2026-08-01T07:00:00.000Z");
 static JSONObject point(String id,long captured,String stop)throws Exception{return new JSONObject().put("id",id).put("capturedAt",RouteRules.iso(captured)).put("stopId",stop==null?JSONObject.NULL:stop).put("latitude",24.7).put("longitude",46.7).put("accuracy",10);}
 static long scalar(SQLiteDatabase db,String sql){try(Cursor c=db.rawQuery(sql,null)){c.moveToFirst();return c.getLong(0);}}
 static String body(SQLiteDatabase db,String id){try(Cursor c=db.rawQuery("SELECT body FROM points WHERE id=?",new String[]{id})){return c.moveToFirst()?c.getString(0):null;}}
 public static void main(String[] args)throws Exception{
  Context context=new Context(args[0]);
  ContinuousRouteStore s=new ContinuousRouteStore(context);s.put("memberId","owner-A");s.put("regionScope","east");s.put("stopId","stop-A");s.put("selectedAt",Long.toString(at));
  JSONObject old=point("old",at,"stop-A");s.point(old,at);s.gap("gps_unavailable",at+1000);String oldBody=body(s.getReadableDatabase(),"old");
  s.day(new JSONObject().put("date","2026-08-01").put("id","day-A"));s.day(new JSONObject().put("date","2026-07-01").put("id","empty-old-day"));
  ok(s.prune()==0&&s.count()==1&&s.gapCount()==1,"Continuous old pending evidence survives prune");ok(s.day("2026-08-01")!=null&&s.day("2026-07-01")==null,"Only empty historical day metadata pruned");
  fails(s::clear,"Continuous clear cannot discard evidence");ok(!s.resetEmptyContext()&&s.get("memberId").equals("owner-A"),"Pending queue owner retained");
  s.put("enabled","0");s.put("stopId","");s.close();s=new ContinuousRouteStore(context);ok(s.count()==1&&s.gapCount()==1&&!s.enabled()&&s.get("memberId").equals("owner-A"),"Logout metadata plus process reopen preserves owned evidence");
  ok(body(s.getReadableDatabase(),"old").equals(oldBody),"Original capture time and stop preserved after reopen");
  JSONArray sent=new JSONArray().put(old);ok(s.ack(sent,new JSONArray().put("unrelated"))==0&&s.count()==1,"Unexpected acknowledgment cannot delete evidence");
  SQLiteDatabase db=s.getWritableDatabase();db.execSQL("WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<?) INSERT INTO points(id,captured,date,body,binding_known) SELECT 'fill-'||n,?+n,'2026-08-01','{}',1 FROM x",new Object[]{ContinuousRouteStore.MAX_POINTS-1,at});
  ok(s.count()==100000,"Continuous capacity fixture full");final ContinuousRouteStore full=s;fails(()->full.point(point("new-blocked",at+200000,"stop-B"),at+200000),"Full queue blocks new point");ok(s.count()==100000&&body(db,"old").equals(oldBody)&&body(db,"new-blocked")==null,"Capacity never evicts oldest or inserts new");
  int gaps=s.gapCount();s.point(old,at);ok(s.count()==100000&&s.gapCount()==gaps,"Duplicate replay remains idempotent at capacity");
  fails(()->full.point(point("another-blocked",at+210000,"stop-B"),at+210000),"Capacity stays blocked");ok(s.gapCount()==gaps,"Repeated storage full records one gap until capture resumes");
  ok(s.ack(sent,new JSONArray().put("old"))==1,"Only sent acknowledged ID removed");s.point(point("new-after-ack",at+220000,"stop-B"),at+220000);ok(s.count()==100000,"Capture resumes when ack frees capacity");
  ok(s.firstGap("2026-08-01").getString("stopId").equals("stop-A"),"Original gap binding immutable after stop cleared");
  for(int i=0;i<250;i++)s.gap(i%2==0?"gps_unavailable":"service_stopped",at+300000+i);ok(s.gapCount()>=252,"More than previous gap cap preserved");
  s.close();
  RouteStore r=new RouteStore(context);r.day(new JSONObject().put("memberId","owner-A").put("regionScope","east"));r.put("stopId","stop-A");r.put("bindAt",Long.toString(at));r.addPoint(old,at);r.gap("gps_unavailable",RouteRules.iso(at+1000));
  ok(r.pruneExpired()==0&&r.count()==1&&r.gapCount()==1,"Legacy old pending evidence survives prune");fails(()->r.clearDay(),"Legacy clear cannot discard evidence");ok(!r.resetEmptyContext()&&r.day().getString("memberId").equals("owner-A"),"Legacy owner retained while pending");
  db=r.getWritableDatabase();db.execSQL("WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<?) INSERT INTO points(id,captured,body,binding_known) SELECT 'fill-'||n,?+n,'{}',1 FROM x",new Object[]{RouteStore.MAX_POINTS-1,at});
  fails(()->r.addPoint(point("blocked",at+200000,"stop-A"),at+200000),"Legacy full blocksnew");ok(r.count()==100000&&body(db,"old").equals(oldBody)&&body(db,"blocked")==null,"Legacy full preserves all old evidence");r.addPoint(old,at);ok(r.count()==100000,"Legacy duplicate full no-op");
  r.acknowledge(sent,new JSONArray().put("unrelated"));ok(r.count()==100000,"Legacy ack rejects unsent ID");r.acknowledge(sent,new JSONArray().put("old"));ok(r.count()==99999,"Legacy explicit sent ack deletes one");
  r.addPoint(point("resumed",at+210000,"stop-A"),at+210000);ok(r.count()==100000,"Legacy capture resumes after ack");for(int i=0;i<100;i++)r.gap(i%2==0?"gps_unavailable":"service_stopped",RouteRules.iso(at+300000+i));ok(r.gapCount()>=102,"Legacy gaps not truncated at64");r.close();
  java.io.File diskDir=new java.io.File(args[0],"diskfull");diskDir.mkdir();Context diskContext=new Context(diskDir.getPath());
  ContinuousRouteStore disk=new ContinuousRouteStore(diskContext);disk.put("memberId","owner-A");disk.point(old,at);SQLiteDatabase diskDb=disk.getWritableDatabase();long pages=scalar(diskDb,"PRAGMA page_count");diskDb.execSQL("PRAGMA max_page_count="+pages);
  boolean rejected=false;String diagnostic="";try{disk.point(point("too-large",at+1000,null).put("diagnosticPadding","x".repeat(2000000)),at+1000);}catch(RuntimeException expected){rejected=true;diagnostic=expected.getMessage();ok(expected.getCause()!=null,"Continuous storage diagnostic retains cause");}
  ok(diagnostic.equals("تعذر حفظ الموقع الجديد على الجهاز؛ الموقع الجديد لم يُحفظ، والنقاط السابقة محفوظة. راجع مساحة تخزين الجهاز"),"Actual continuous disk-full error distinguishes unsaved new fix from saved queue");
  ok(rejected&&disk.count()==1&&body(diskDb,"old").equals(oldBody)&&body(diskDb,"too-large")==null,"Real SQLite disk-full rollback preserves continuous evidence");ok(disk.number("lastCaptured")==at,"Disk failure does not advance last capture marker");diskDb.execSQL("PRAGMA max_page_count=1000000");disk.point(point("after-disk-space",at+2000,null),at+2000);ok(disk.count()==2,"Capture recovers after storage available");disk.close();
  RouteStore legacyDisk=new RouteStore(diskContext);legacyDisk.addPoint(old,at);diskDb=legacyDisk.getWritableDatabase();pages=scalar(diskDb,"PRAGMA page_count");diskDb.execSQL("PRAGMA max_page_count="+pages);rejected=false;
  try{legacyDisk.addPoint(point("too-large",at+1000,null).put("diagnosticPadding","x".repeat(2000000)),at+1000);}catch(RuntimeException expected){rejected=true;diagnostic=expected.getMessage();ok(expected.getCause()!=null,"Legacy storage diagnostic retains cause");}
  ok(diagnostic.equals("تعذر حفظ الموقع الجديد على الجهاز؛ الموقع الجديد لم يُحفظ، والنقاط السابقة محفوظة. راجع مساحة تخزين الجهاز"),"Actual legacy disk-full error distinguishes unsaved new fix from saved queue");
  ok(rejected&&legacyDisk.count()==1&&body(diskDb,"old").equals(oldBody)&&body(diskDb,"too-large")==null,"Real SQLite disk-full rollback preserves legacy evidence");ok(legacyDisk.lastCaptured()==at,"Legacy disk failure does not advance capture marker");diskDb.execSQL("PRAGMA max_page_count=1000000");legacyDisk.addPoint(point("after-disk-space",at+2000,null),at+2000);ok(legacyDisk.count()==2,"Legacy capture recovers after storage available");legacyDisk.close();
  // 1.0.16: a changed scope or role moves queued evidence, unchanged, to the held tables under the outbox day it belongs to (its create key),
  // the scope and the owner it was captured with.
  java.io.File heldDir=new java.io.File(args[0],"held");heldDir.mkdir();ContinuousRouteStore h=new ContinuousRouteStore(new Context(heldDir.getPath()));
  ok(!h.holdForChangedAccount(),"Evidence without an identity is never held");
  h.put("memberId","owner-A");h.put("regionScope","all");h.put("memberRole","rep");h.put("enabled","1");h.put("checkedExit","42");
  long d1=RouteRules.millis("2026-11-19T08:00:00.000Z"),d2=RouteRules.millis("2026-11-21T08:00:00.000Z"),fri=RouteRules.millis("2026-11-20T08:00:00.000Z");
  JSONObject p1=point("p1",d1,"stop-A"),p2=point("p2",d1+60000,null),p3=point("p3",d2,"stop-B");h.point(p1,d1);h.point(p2,d1+60000);h.point(p3,d2);h.point(point("pf",fri,null),fri);h.gap("gps_unavailable",d1+120000);
  String key1=h.key("2026-11-19");h.day(new JSONObject().put("date","2026-11-19").put("id","day-1"));h.key("2026-11-18");
  String b1=body(h.getReadableDatabase(),"p1");
  ok(h.holdForChangedAccount(),"Evidence of a known owner and scope is held");
  ok(h.count()==0&&h.gapCount()==0&&h.get("memberId").isEmpty()&&h.get("regionScope").isEmpty()&&!h.enabled()&&h.day("2026-11-19")==null,"The outbox and its account data are empty after holding");
  ok(h.get("checkedExit").equals("42"),"The last handled system stop is kept, so it is not reported again");
  ok(h.resetEmptyContext(),"The empty outbox can enroll the new scope");
  ok(h.heldCount()==3&&h.heldGapCount()==1&&h.heldQuarantinedCount()==1&&h.heldQuarantinedGapCount()==0,"Every point and gap is held; a Friday point is held as quarantined, not as on its way");
  try(Cursor c=h.getReadableDatabase().rawQuery("SELECT p.body,d.scope,d.member,p.captured,p.date,p.create_key,p.binding_known FROM held_points p JOIN held_days d ON d.create_key=p.create_key WHERE p.id='p1'",null)){c.moveToFirst();ok(c.getString(0).equals(b1)&&c.getString(1).equals("all")&&c.getString(2).equals("owner-A")&&c.getLong(3)==d1&&c.getString(4).equals("2026-11-19")&&c.getString(5).equals(key1)&&c.getLong(6)==1,"A held point keeps its exact payload, capture time, date, binding, day key, scope and owner");}
  ok(scalar(h.getReadableDatabase(),"SELECT count(*) FROM held_days")==3,"Only the days with evidence are held, each with a key (the empty day is not)");
  long now=RouteRules.millis("2026-11-25T08:00:00.000Z");
  String[] first=h.firstHeld("owner-A",now);ok(first!=null&&first[0].equals(key1)&&first[1].equals("all")&&first[2].equals("2026-11-19"),"The oldest held group comes first, by its day key");
  ok(h.firstHeld("owner-B",now)==null,"Another account never sees the held evidence");
  ok(h.heldDay(key1).getString("id").equals("day-1"),"A held group keeps the server day it had");
  long[] span=h.heldSpan(key1);ok(span[0]==d1&&span[1]==d1+120000,"A held group spans its first and last capture, gaps included");
  JSONArray hb=h.heldBatch(key1,Long.MAX_VALUE);ok(hb.length()==2&&hb.getJSONObject(0).getString("id").equals("p1")&&hb.getJSONObject(0).isNull("stopId")&&hb.getJSONObject(1).getString("id").equals("p2"),"A held batch is in capture order without the customer binding");
  try(Cursor c=h.getReadableDatabase().rawQuery("SELECT body FROM held_points WHERE id='p1'",null)){c.moveToFirst();ok(c.getString(0).equals(b1),"Reading a batch changes nothing stored");}
  JSONObject hg=h.heldFirstGap(key1);ok(hg!=null&&hg.getString("reason").equals("gps_unavailable")&&hg.getLong("at")==d1+120000,"The held gap keeps its reason and time");
  ok(h.heldBatch(key1,d1+30000).length()==1,"A batch stops before the group's first gap time");
  ok(h.heldAck(hb,new JSONArray().put("unrelated"))==0&&h.heldCount()==3,"An unrelated acknowledgment deletes nothing");
  ok(h.heldAck(new JSONArray().put(hb.getJSONObject(0)),new JSONArray().put("p1").put("p2"))==1&&h.heldCount()==2,"Only a sent and acknowledged point is deleted");
  h.heldRefused(key1,now);first=h.firstHeld("owner-A",now+1000);ok(first!=null&&first[2].equals("2026-11-21"),"A refused group waits and the next one comes (the Friday group is skipped)");
  first=h.firstHeld("owner-A",now+ContinuousRouteStore.HELD_RETRY_MS+1000);ok(first!=null&&first[0].equals(key1),"A refused group is asked again after a day");
  h.heldDay(key1,new JSONObject().put("date","2026-11-19").put("id","day-1"));ok(h.firstHeld("owner-A",now+1000)[0].equals(key1),"A server day clears the refusal");
  h.heldConflict(key1,now);h.heldConflict(key1,now);ok(h.firstHeld("owner-A",now+1000)[0].equals(key1),"Two conflicts are asked again");
  h.heldConflict(key1,now);ok(!h.firstHeld("owner-A",now+1000)[0].equals(key1),"The third conflict in a row waits a day");
  h.heldDay(key1,new JSONObject().put("date","2026-11-19").put("id","day-1"));
  h.heldDeleteGap(hg.getLong("id"));h.heldAck(hb,new JSONArray().put("p2"));h.heldPrune();
  ok(h.heldCount()==1&&h.heldGapCount()==0&&scalar(h.getReadableDatabase(),"SELECT count(*) FROM held_days")==2&&h.heldDay(key1)==null,"An emptied group loses its day; the others keep theirs");
  // The same scope and date held twice (the scope went away, came back and went away again): two groups, each with its own server day.
  h.put("memberId","owner-A");h.put("regionScope","all");String keyAgain=h.key("2026-11-21");h.point(point("p4",d2+60000,null),d2+60000);
  ok(h.holdForChangedAccount()&&h.count()==0,"A second hold of the same scope and date");
  try(Cursor c=h.getReadableDatabase().rawQuery("SELECT count(DISTINCT create_key) FROM held_points WHERE date='2026-11-21'",null)){c.moveToFirst();ok(c.getInt(0)==2,"Each hold keeps its own day key, never merged into the other's day");}
  ok(h.heldSpan(keyAgain)[0]==d2+60000&&h.heldSpan(keyAgain)[1]==d2+60000,"The second group spans only its own evidence");
  // Two accounts on one phone, same scope and date: separate groups, separate owners.
  h.put("memberId","owner-B");h.put("regionScope","all");h.point(point("pb",d2+90000,null),d2+90000);ok(h.holdForChangedAccount(),"Another owner's evidence is held");
  ok(h.firstHeld("owner-B",now)!=null&&!h.firstHeld("owner-B",now)[0].equals(h.firstHeld("owner-A",now)[0]),"Two owners never share a held group");
  // The scope came back while the day was open and the server handed the same day to the outbox: that group returns before any new point.
  h.put("memberId","owner-A");h.put("regionScope","all");String back=h.firstHeld("owner-A",now)[0];h.heldDay(back,new JSONObject().put("date",h.firstHeld("owner-A",now)[2]).put("id","day-open"));
  String backDate=h.firstHeld("owner-A",now)[2];int before=h.heldCount();
  ok(h.unholdInto("owner-A","central",backDate,"day-open")==0&&h.unholdInto("owner-B","all",backDate,"day-open")==0&&h.unholdInto("owner-A","all",backDate,"another-day")==0,"Another scope, owner or server day takes nothing back");
  int moved=h.unholdInto("owner-A","all",backDate,"day-open");ok(moved>0&&h.heldCount()==before-moved&&h.count()==moved&&h.heldDay(back)==null,"The group returns, whole, to the outbox");
  ok(h.firstDate().equals(backDate)&&h.batch(backDate,Long.MAX_VALUE).length()==moved,"It uploads first, in capture order, through the outbox");
  // A group whose begin answer was lost (no stored body) is found by the id its create key makes on the server ("mobile-<member>-<key>").
  h.resetDay(backDate);h.put("memberId","owner-A");h.put("regionScope","south");String lostKey=h.key("2026-11-23");h.point(point("pl",RouteRules.millis("2026-11-23T08:00:00.000Z"),null),RouteRules.millis("2026-11-23T08:00:00.000Z"));
  int outboxBefore=h.count();ok(h.holdForChangedAccount()&&h.heldDay(lostKey)==null,"A group held without a server day");
  ok(h.unholdInto("owner-A","south","2026-11-23","mobile-owner-B-"+lostKey)==0,"Another member's day id takes nothing back");
  ok(h.unholdInto("owner-A","south","2026-11-23","mobile-owner-A-"+lostKey)==1&&h.count()==1,"The group returns to the outbox by the day id its key makes");
  h.put("memberId","owner-A");h.put("regionScope","west");h.point(point("p5",d2+120000,null),d2+120000);ok(h.count()==2,"Collection continues in the outbox after holding");
  h.close();h=new ContinuousRouteStore(new Context(heldDir.getPath()));ok(h.heldCount()+h.heldQuarantinedCount()>0&&h.count()==2,"Held evidence survives a process restart");h.close();
  System.out.println("Production Java stores + real SQLite: "+checks+" checks passed (Android APIs adapted; no device claim)");
 }
}
'''
}
with tempfile.TemporaryDirectory(prefix='yourrest-store-sqlite-') as temporary:
    work=Path(temporary)
    (work/'sqlite_bridge.py').write_text(SQLITE_BRIDGE)
    javafiles=[]
    for name,source in STUBS.items():
        target=work/name
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(source)
        javafiles.append(str(target))
    source=root/'app/src/main/java/org/yourrest/crm'
    javafiles += [str(source/name) for name in ['RouteStore.java','ContinuousRouteStore.java','RouteRules.java','ContinuousPolicy.java']]
    classes=work/'classes'
    classes.mkdir()
    databases=work/'databases'
    databases.mkdir()
    subprocess.run([str(args.jdk/'bin/javac'),'--release','17','-encoding','UTF-8','-cp',str(args.framework),'-d',str(classes),*javafiles],check=True)
    subprocess.run([str(args.jdk/'bin/java'),'-Dsqlite.bridge='+str(work/'sqlite_bridge.py'),'-cp',str(classes)+os.pathsep+str(args.framework),'org.yourrest.crm.StoreDurabilityCheck',str(databases)],check=True)

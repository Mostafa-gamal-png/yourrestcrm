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

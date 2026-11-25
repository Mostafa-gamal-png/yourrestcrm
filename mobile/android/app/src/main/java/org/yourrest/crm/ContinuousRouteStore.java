package org.yourrest.crm;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

/** Account-bound raw outbox across Riyadh dates; no cookie or credential is stored here. */
final class ContinuousRouteStore extends SQLiteOpenHelper {
    static final int MAX_POINTS=100000;
    ContinuousRouteStore(Context context){super(context,"continuous-route-outbox.db",null,3);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE days(date TEXT PRIMARY KEY,create_key TEXT NOT NULL,body TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE TABLE points(id TEXT PRIMARY KEY,captured INTEGER NOT NULL,date TEXT NOT NULL,body TEXT NOT NULL,binding_known INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX point_order ON points(date,captured,id)");
        db.execSQL("CREATE TABLE gaps(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,date TEXT NOT NULL,reason TEXT NOT NULL,stop_id TEXT,binding_known INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX gap_order ON gaps(date,at,id)");
        createHeld(db);
    }
    /** Version 3 (app 1.0.16): evidence held from an earlier region scope or role, kept apart from the outbox so the representative goes on
     * recording. A held group is one outbox day: its create key (so the server finds the day it already made), its owner, scope and date. */
    static void createHeld(SQLiteDatabase db){
        db.execSQL("CREATE TABLE held_days(create_key TEXT PRIMARY KEY,member TEXT NOT NULL,scope TEXT NOT NULL,date TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',refused_at INTEGER NOT NULL DEFAULT 0,conflicts INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE TABLE held_points(id TEXT PRIMARY KEY,create_key TEXT NOT NULL,captured INTEGER NOT NULL,date TEXT NOT NULL,body TEXT NOT NULL,binding_known INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX held_point_order ON held_points(create_key,captured,id)");
        db.execSQL("CREATE TABLE held_gaps(id INTEGER PRIMARY KEY AUTOINCREMENT,create_key TEXT NOT NULL,at INTEGER NOT NULL,date TEXT NOT NULL,reason TEXT NOT NULL,stop_id TEXT,binding_known INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX held_gap_order ON held_gaps(create_key,at,id)");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){
        if(newVersion!=3||oldVersion<1||oldVersion>2)throw new IllegalStateException("Unsupported continuous outbox version");
        if(oldVersion==1){db.execSQL("ALTER TABLE points ADD COLUMN binding_known INTEGER NOT NULL DEFAULT 0");db.execSQL("UPDATE points SET binding_known=1 WHERE INSTR(body,'\"stopId\":')>0");db.execSQL("ALTER TABLE gaps ADD COLUMN stop_id TEXT");db.execSQL("ALTER TABLE gaps ADD COLUMN binding_known INTEGER NOT NULL DEFAULT 0");}
        createHeld(db);
    }
    synchronized String get(String key){try(Cursor c=getReadableDatabase().rawQuery("SELECT value FROM meta WHERE key=?",new String[]{key})){return c.moveToFirst()?c.getString(0):"";}}
    synchronized void put(String key,String value){ContentValues v=new ContentValues();v.put("key",key);v.put("value",value==null?"":value);if(getWritableDatabase().insertWithOnConflict("meta",null,v,SQLiteDatabase.CONFLICT_REPLACE)<0)throw new IllegalStateException("تعذر حفظ بيانات حساب خط السير؛ النقاط السابقة محفوظة");}
    synchronized long number(String key){try{return Long.parseLong(get(key));}catch(NumberFormatException e){return 0;}}
    synchronized boolean enabled(){return "1".equals(get("enabled"));}
    synchronized int count(){try(Cursor c=getReadableDatabase().rawQuery("SELECT count(*) FROM points",null)){c.moveToFirst();return c.getInt(0);}}
    synchronized int gapCount(){try(Cursor c=getReadableDatabase().rawQuery("SELECT count(*) FROM gaps",null)){c.moveToFirst();return c.getInt(0);}}
    /** Quarantine does not change raw evidence or total counts used for account/capacity protection. */
    private int uploadableCount(String table){int count=0;try(Cursor c=getReadableDatabase().rawQuery("SELECT date,count(*) FROM "+table+" GROUP BY date",null)){while(c.moveToNext())if(ContinuousPolicy.uploadDateAllowed(c.getString(0)))count+=c.getInt(1);}return count;}
    synchronized int pendingCount(){return uploadableCount("points");}
    synchronized int pendingGapCount(){return uploadableCount("gaps");}
    synchronized int quarantinedCount(){return count()-pendingCount();}
    synchronized int quarantinedGapCount(){return gapCount()-pendingGapCount();}
    synchronized String key(String date){try(Cursor c=getReadableDatabase().rawQuery("SELECT create_key FROM days WHERE date=?",new String[]{date})){if(c.moveToFirst())return c.getString(0);}String key=UUID.randomUUID().toString();ContentValues v=new ContentValues();v.put("date",date);v.put("create_key",key);getWritableDatabase().insertOrThrow("days",null,v);return key;}
    synchronized JSONObject day(String date){try(Cursor c=getReadableDatabase().rawQuery("SELECT body FROM days WHERE date=?",new String[]{date})){if(c.moveToFirst())return new JSONObject(c.getString(0));}catch(Exception ignored){}return null;}
    synchronized void resetDay(String date){getWritableDatabase().delete("days","date=?",new String[]{date});}
    synchronized boolean hasQueued(String date){try(Cursor c=getReadableDatabase().rawQuery("SELECT 1 FROM points WHERE date=? UNION SELECT 1 FROM gaps WHERE date=? LIMIT 1",new String[]{date,date})){return c.moveToFirst();}}
    synchronized void day(JSONObject day)throws Exception{String date=day.getString("date");key(date);ContentValues v=new ContentValues();v.put("body",day.toString());getWritableDatabase().update("days",v,"date=?",new String[]{date});}
    /** Never overwrite unacknowledged evidence to admit a newer fix. */
    synchronized void point(JSONObject point,long captured)throws Exception{
        boolean full=false;
        try {
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{
            String id=point.getString("id");
            boolean duplicate;try(Cursor c=db.rawQuery("SELECT 1 FROM points WHERE id=?",new String[]{id})){duplicate=c.moveToFirst();}
            if(!duplicate&&count()>=MAX_POINTS){gapBound("buffer_full",captured,point.isNull("stopId")?null:point.optString("stopId"),point.has("stopId"));full=true;}
            else if(!duplicate){
                ContentValues v=new ContentValues();v.put("id",id);v.put("captured",captured);v.put("date",ContinuousPolicy.date(captured));v.put("body",point.toString());v.put("binding_known",point.has("stopId")?1:0);db.insertOrThrow("points",null,v);put("lastCaptured",Long.toString(Math.max(captured,number("lastCaptured"))));
            }
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
        } catch(RuntimeException storageFailure){
            throw new IllegalStateException("تعذر حفظ الموقع الجديد على الجهاز؛ الموقع الجديد لم يُحفظ، والنقاط السابقة محفوظة. راجع مساحة تخزين الجهاز",storageFailure);
        }
        if(full)throw new IllegalStateException("امتلأت مساحة نقاط خط السير؛ النقاط السابقة محفوظة. اتصل بالإنترنت لرفعها واستئناف حفظ المواقع الجديدة");
    }
    synchronized boolean immutableBindings(){try(Cursor c=getReadableDatabase().rawQuery("SELECT date FROM points WHERE binding_known=0 UNION SELECT date FROM gaps WHERE binding_known=0",null)){while(c.moveToNext())if(ContinuousPolicy.uploadDateAllowed(c.getString(0)))return false;return true;}}
    synchronized void gap(String reason,long at){gapBound(reason,at,ContinuousPolicy.stopIdAt(get("stopId"),number("selectedAt"),at),true);}
    /** Migrated gaps retain an unknown binding rather than inheriting today's selected customer. */
    synchronized void gapLegacy(String reason,long at){gapBound(reason,at,null,false);}
    synchronized void gapBoundMigration(String reason,long at,String capturedStopId){gapBound(reason,at,capturedStopId,true);}
    private void gapBound(String reason,long at,String capturedStopId,boolean known){
        String date=ContinuousPolicy.date(at);try(Cursor c=getReadableDatabase().rawQuery("SELECT reason,date,at,stop_id,binding_known FROM gaps ORDER BY at DESC,id DESC LIMIT 1",null)){
            if(c.moveToFirst()&&reason.equals(c.getString(0))&&date.equals(c.getString(1))&&number("lastCaptured")<=c.getLong(2)&&known==(c.getInt(4)==1)&&java.util.Objects.equals(capturedStopId,c.isNull(3)?null:c.getString(3)))return;
        }
        ContentValues v=new ContentValues();v.put("reason",reason);v.put("at",at);v.put("date",date);v.put("stop_id",capturedStopId);v.put("binding_known",known?1:0);getWritableDatabase().insertOrThrow("gaps",null,v);
    }
    /** Skipped Friday rows remain quarantined; neither logout nor time alone removes evidence. */
    synchronized String firstDate(){try(Cursor c=getReadableDatabase().rawQuery("SELECT date FROM (SELECT date FROM points UNION SELECT date FROM gaps) ORDER BY date",null)){while(c.moveToNext()){String date=c.getString(0);if(ContinuousPolicy.uploadDateAllowed(date))return date;}return null;}}
    synchronized JSONObject firstGap(String date)throws Exception{if(!ContinuousPolicy.uploadDateAllowed(date))return null;try(Cursor c=getReadableDatabase().rawQuery("SELECT id,at,reason,stop_id,binding_known FROM gaps WHERE date=? ORDER BY at,id LIMIT 1",new String[]{date})){if(!c.moveToFirst())return null;JSONObject gap=new JSONObject().put("id",c.getLong(0)).put("at",c.getLong(1)).put("reason",c.getString(2));if(c.getInt(4)==1)gap.put("stopId",c.isNull(3)?JSONObject.NULL:c.getString(3));return gap;}}
    synchronized JSONArray batch(String date,long cutoff)throws Exception{JSONArray batch=new JSONArray();if(!ContinuousPolicy.uploadDateAllowed(date))return batch;try(Cursor c=getReadableDatabase().rawQuery("SELECT body FROM points WHERE date=? AND captured<=? ORDER BY captured,id LIMIT 50",new String[]{date,Long.toString(cutoff)})){while(c.moveToNext())batch.put(new JSONObject(c.getString(0)));}return batch;}
    synchronized int ack(JSONArray sent,JSONArray ack){if(ack==null)return 0;int deleted=0;SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{for(int i=0;i<ack.length();i++)for(int j=0;j<sent.length();j++)if(ack.optString(i).equals(sent.optJSONObject(j).optString("id"))){deleted+=db.delete("points","id=?",new String[]{ack.optString(i)});break;}db.setTransactionSuccessful();}finally{db.endTransaction();}return deleted;}
    synchronized void deleteGap(long id){getWritableDatabase().delete("gaps","id=?",new String[]{Long.toString(id)});}
    /** Prune empty historical day metadata only; pending raw evidence has no age expiry. */
    synchronized int prune(){getWritableDatabase().delete("days","date<? AND date NOT IN (SELECT date FROM points UNION SELECT date FROM gaps)",new String[]{ContinuousPolicy.date(System.currentTimeMillis())});return 0;}
    /** Only obsolete metadata is reset; this method never deletes pending evidence. */
    synchronized boolean resetEmptyContext(){if(count()!=0||gapCount()!=0)return false;SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{db.delete("days",null,null);db.delete("meta",null,null);db.setTransactionSuccessful();}finally{db.endTransaction();}return true;}
    /** Guard every context reset: only server acknowledgments may remove pending evidence. */
    synchronized void clear(){if(!resetEmptyContext())throw new IllegalStateException("خط السير غير المرفوع محفوظ لحسابه؛ لا يمكن مسحه عند تسجيل الخروج");}

    /** The server changed this account's region scope or role while evidence waited here. Rather than stopping the representative (1.0.15),
     * every queued point, gap and day moves, unchanged and in one transaction, to the held tables under the outbox day it belongs to (its
     * create key: a day the server already made is found again) and the scope and owner it was captured with; the outbox and its account
     * metadata are then empty, so tracking enrolls the new scope. Held evidence is uploaded to days of its own scope (never relabeled) and
     * deleted only by a server acknowledgment, like the outbox. False when the identity is unknown. */
    synchronized boolean holdForChangedAccount(){
        String scope=get("regionScope"),member=get("memberId");
        if(scope.isEmpty()||member.isEmpty())return false;
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{
            java.util.List<String> dates=new java.util.ArrayList<>();
            try(Cursor c=db.rawQuery("SELECT date FROM points UNION SELECT date FROM gaps",null)){while(c.moveToNext())dates.add(c.getString(0));}
            for(String date:dates)key(date);
            db.execSQL("INSERT INTO held_days(create_key,member,scope,date,body) SELECT create_key,?,?,date,body FROM days WHERE date IN (SELECT date FROM points UNION SELECT date FROM gaps)",new Object[]{member,scope});
            db.execSQL("INSERT OR IGNORE INTO held_points(id,create_key,captured,date,body,binding_known) SELECT p.id,d.create_key,p.captured,p.date,p.body,p.binding_known FROM points p JOIN days d ON d.date=p.date");
            db.execSQL("INSERT INTO held_gaps(create_key,at,date,reason,stop_id,binding_known) SELECT d.create_key,g.at,g.date,g.reason,g.stop_id,g.binding_known FROM gaps g JOIN days d ON d.date=g.date ORDER BY g.at,g.id");
            db.delete("points",null,null);db.delete("gaps",null,null);db.delete("days",null,null);db.delete("meta","key<>?",new String[]{"checkedExit"});
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
        return true;
    }
    /** Held points of a date the server takes (not a Friday), which the page announces as on their way; the others stay held, like the outbox's. */
    private int heldUploadable(String table){int count=0;try(Cursor c=getReadableDatabase().rawQuery("SELECT date,count(*) FROM "+table+" GROUP BY date",null)){while(c.moveToNext())if(ContinuousPolicy.uploadDateAllowed(c.getString(0)))count+=c.getInt(1);}return count;}
    synchronized int heldCount(){return heldUploadable("held_points");}
    synchronized int heldGapCount(){return heldUploadable("held_gaps");}
    synchronized int heldQuarantinedCount(){try(Cursor c=getReadableDatabase().rawQuery("SELECT count(*) FROM held_points",null)){c.moveToFirst();return c.getInt(0)-heldCount();}}
    synchronized int heldQuarantinedGapCount(){try(Cursor c=getReadableDatabase().rawQuery("SELECT count(*) FROM held_gaps",null)){c.moveToFirst();return c.getInt(0)-heldGapCount();}}
    /** Held evidence the server refused stays here; a refused group is asked again after a day. */
    static final long HELD_RETRY_MS=24L*60*60*1000;
    /** Three conflicts in a row (the day changed while asking) count as one refusal. */
    static final int HELD_CONFLICTS=3;
    /** The oldest held group of this owner on a date the server takes, not waiting after a refusal: {create key, scope, date}, or null. */
    synchronized String[] firstHeld(String member,long now){
        try(Cursor c=getReadableDatabase().rawQuery("SELECT d.create_key,d.scope,d.date FROM held_days d WHERE d.member=? AND d.refused_at<=CAST(? AS INTEGER) AND (EXISTS (SELECT 1 FROM held_points p WHERE p.create_key=d.create_key) OR EXISTS (SELECT 1 FROM held_gaps g WHERE g.create_key=d.create_key)) ORDER BY d.date,d.rowid",new String[]{member,Long.toString(now-HELD_RETRY_MS)})){
            while(c.moveToNext())if(ContinuousPolicy.uploadDateAllowed(c.getString(2)))return new String[]{c.getString(0),c.getString(1),c.getString(2)};
        }
        return null;
    }
    synchronized JSONObject heldDay(String key){try(Cursor c=getReadableDatabase().rawQuery("SELECT body FROM held_days WHERE create_key=?",new String[]{key})){if(c.moveToFirst()&&!c.getString(0).isEmpty())return new JSONObject(c.getString(0));}catch(Exception ignored){}return null;}
    synchronized void heldDay(String key,JSONObject day){ContentValues v=new ContentValues();v.put("body",day.toString());v.put("refused_at",0);v.put("conflicts",0);getWritableDatabase().update("held_days",v,"create_key=?",new String[]{key});}
    synchronized void heldRefused(String key,long now){ContentValues v=new ContentValues();v.put("refused_at",now);v.put("conflicts",0);getWritableDatabase().update("held_days",v,"create_key=?",new String[]{key});}
    /** A conflict (409: the day changed while asking) is asked again on the next pass; the third in a row waits a day. */
    synchronized void heldConflict(String key,long now){
        long conflicts=0;try(Cursor c=getReadableDatabase().rawQuery("SELECT conflicts FROM held_days WHERE create_key=?",new String[]{key})){if(c.moveToFirst())conflicts=c.getLong(0)+1;}
        if(conflicts>=HELD_CONFLICTS){heldRefused(key,now);return;}
        ContentValues v=new ContentValues();v.put("conflicts",conflicts);getWritableDatabase().update("held_days",v,"create_key=?",new String[]{key});
    }
    /** The first and last capture time of a held group (its points and gaps): a held day the server makes spans only them. */
    synchronized long[] heldSpan(String key){try(Cursor c=getReadableDatabase().rawQuery("SELECT min(t),max(t) FROM (SELECT captured AS t FROM held_points WHERE create_key=? UNION ALL SELECT at AS t FROM held_gaps WHERE create_key=?)",new String[]{key,key})){c.moveToFirst();return c.isNull(0)?null:new long[]{c.getLong(0),c.getLong(1)};}}
    /** Up to 50 held points of a group in capture order, before the group's first held gap. Their customer binding is not sent: a held day
     * is evidence of the route only (the visit it was bound to belongs to the earlier scope's journey, which the server no longer opens). */
    synchronized JSONArray heldBatch(String key,long cutoff)throws Exception{
        JSONArray batch=new JSONArray();
        try(Cursor c=getReadableDatabase().rawQuery("SELECT body FROM held_points WHERE create_key=? AND captured<=? ORDER BY captured,id LIMIT 50",new String[]{key,Long.toString(cutoff)})){while(c.moveToNext())batch.put(new JSONObject(c.getString(0)).put("stopId",JSONObject.NULL));}
        return batch;
    }
    synchronized JSONObject heldFirstGap(String key)throws Exception{try(Cursor c=getReadableDatabase().rawQuery("SELECT id,at,reason FROM held_gaps WHERE create_key=? ORDER BY at,id LIMIT 1",new String[]{key})){if(!c.moveToFirst())return null;return new JSONObject().put("id",c.getLong(0)).put("at",c.getLong(1)).put("reason",c.getString(2));}}
    synchronized int heldAck(JSONArray sent,JSONArray ack){if(ack==null)return 0;int deleted=0;SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{for(int i=0;i<ack.length();i++)for(int j=0;j<sent.length();j++)if(ack.optString(i).equals(sent.optJSONObject(j).optString("id"))){deleted+=db.delete("held_points","id=?",new String[]{ack.optString(i)});break;}db.setTransactionSuccessful();}finally{db.endTransaction();}return deleted;}
    synchronized void heldDeleteGap(long id){getWritableDatabase().delete("held_gaps","id=?",new String[]{Long.toString(id)});}
    /** Only a group with no held point or gap left loses its day; held evidence itself has no age expiry. */
    synchronized void heldPrune(){getWritableDatabase().delete("held_days","NOT EXISTS (SELECT 1 FROM held_points p WHERE p.create_key=held_days.create_key) AND NOT EXISTS (SELECT 1 FROM held_gaps g WHERE g.create_key=held_days.create_key)",null);}
    /** The outbox now records into a server day a held group of the same owner and scope belongs to (the account came back to that scope or
     * role while the day was open, and the server handed this phone the same day): the group returns, unchanged, to the outbox before any new
     * point, so the day receives its evidence in capture order. Returns how many points and gaps returned. */
    synchronized int unholdInto(String member,String scope,String date,String dayId){
        if(member.isEmpty()||scope.isEmpty()||dayId==null||dayId.isEmpty())return 0;
        java.util.List<String> keys=new java.util.ArrayList<>();
        // The server names a day "mobile-<member>-<create key>": a group whose begin answer was lost (no stored body) is found by its key too.
        try(Cursor c=getReadableDatabase().rawQuery("SELECT create_key,body FROM held_days WHERE member=? AND scope=? AND date=?",new String[]{member,scope,date})){while(c.moveToNext()){String id="";try{id=new JSONObject(c.getString(1)).optString("id");}catch(Exception unknown){}if(dayId.equals(id)||dayId.equals("mobile-"+member+"-"+c.getString(0)))keys.add(c.getString(0));}}
        int moved=0;SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{for(String key:keys){
            db.execSQL("INSERT OR IGNORE INTO points(id,captured,date,body,binding_known) SELECT id,captured,date,body,binding_known FROM held_points WHERE create_key=?",new Object[]{key});
            db.execSQL("INSERT INTO gaps(at,date,reason,stop_id,binding_known) SELECT at,date,reason,stop_id,binding_known FROM held_gaps WHERE create_key=? ORDER BY at,id",new Object[]{key});
            moved+=db.delete("held_points","create_key=?",new String[]{key})+db.delete("held_gaps","create_key=?",new String[]{key});
            db.delete("held_days","create_key=?",new String[]{key});
        }db.setTransactionSuccessful();}finally{db.endTransaction();}
        return moved;
    }
}

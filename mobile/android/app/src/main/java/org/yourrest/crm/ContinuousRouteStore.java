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
    /** Version 3 (app 1.0.16): evidence held from an earlier region scope or role, kept apart from the outbox so the representative goes on recording. */
    static void createHeld(SQLiteDatabase db){
        db.execSQL("CREATE TABLE held_days(scope TEXT NOT NULL,date TEXT NOT NULL,member TEXT NOT NULL,create_key TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',refused_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,date))");
        db.execSQL("CREATE TABLE held_points(id TEXT PRIMARY KEY,scope TEXT NOT NULL,member TEXT NOT NULL,captured INTEGER NOT NULL,date TEXT NOT NULL,body TEXT NOT NULL)");
        db.execSQL("CREATE INDEX held_point_order ON held_points(scope,date,captured,id)");
        db.execSQL("CREATE TABLE held_gaps(id INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,member TEXT NOT NULL,at INTEGER NOT NULL,date TEXT NOT NULL,reason TEXT NOT NULL)");
        db.execSQL("CREATE INDEX held_gap_order ON held_gaps(scope,date,at,id)");
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
     * every queued point, gap and day moves, unchanged and in one transaction, to the held tables under the scope and owner it was captured
     * with; the outbox and its account metadata are then empty, so tracking enrolls again under the new scope. Held evidence is uploaded to
     * days of its own scope (never relabeled) and deleted only by a server acknowledgment, like the outbox. False when the identity is unknown. */
    synchronized boolean holdForChangedAccount(){
        String scope=get("regionScope"),member=get("memberId");
        if(scope.isEmpty()||member.isEmpty())return false;
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{
            db.execSQL("INSERT OR IGNORE INTO held_days(scope,date,member,create_key,body) SELECT ?,date,?,create_key,body FROM days WHERE date IN (SELECT date FROM points UNION SELECT date FROM gaps)",new Object[]{scope,member});
            db.execSQL("INSERT OR IGNORE INTO held_points(id,scope,member,captured,date,body) SELECT id,?,?,captured,date,body FROM points",new Object[]{scope,member});
            db.execSQL("INSERT INTO held_gaps(scope,member,at,date,reason) SELECT ?,?,at,date,reason FROM gaps ORDER BY at,id",new Object[]{scope,member});
            db.delete("points",null,null);db.delete("gaps",null,null);db.delete("days",null,null);db.delete("meta",null,null);
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
        return true;
    }
    synchronized int heldCount(){try(Cursor c=getReadableDatabase().rawQuery("SELECT count(*) FROM held_points",null)){c.moveToFirst();return c.getInt(0);}}
    synchronized int heldGapCount(){try(Cursor c=getReadableDatabase().rawQuery("SELECT count(*) FROM held_gaps",null)){c.moveToFirst();return c.getInt(0);}}
    /** Held evidence the server refused stays here; a refused group is asked again after a day. */
    static final long HELD_RETRY_MS=24L*60*60*1000;
    /** The oldest held group (scope and Riyadh date) of this owner that is not waiting after a refusal, or null. */
    synchronized String[] firstHeld(String member,long now){
        try(Cursor c=getReadableDatabase().rawQuery("SELECT g.scope,g.date FROM (SELECT scope,date FROM held_points WHERE member=? UNION SELECT scope,date FROM held_gaps WHERE member=?) g LEFT JOIN held_days d ON d.scope=g.scope AND d.date=g.date WHERE COALESCE(d.refused_at,0)<=CAST(? AS INTEGER) ORDER BY g.date,g.scope LIMIT 1",new String[]{member,member,Long.toString(now-HELD_RETRY_MS)})){
            return c.moveToFirst()?new String[]{c.getString(0),c.getString(1)}:null;
        }
    }
    synchronized String heldKey(String scope,String date,String member){
        try(Cursor c=getReadableDatabase().rawQuery("SELECT create_key FROM held_days WHERE scope=? AND date=?",new String[]{scope,date})){if(c.moveToFirst())return c.getString(0);}
        String key=UUID.randomUUID().toString();ContentValues v=new ContentValues();v.put("scope",scope);v.put("date",date);v.put("member",member);v.put("create_key",key);getWritableDatabase().insertOrThrow("held_days",null,v);return key;
    }
    synchronized JSONObject heldDay(String scope,String date){try(Cursor c=getReadableDatabase().rawQuery("SELECT body FROM held_days WHERE scope=? AND date=?",new String[]{scope,date})){if(c.moveToFirst()&&!c.getString(0).isEmpty())return new JSONObject(c.getString(0));}catch(Exception ignored){}return null;}
    synchronized void heldDay(String scope,JSONObject day)throws Exception{ContentValues v=new ContentValues();v.put("body",day.toString());v.put("refused_at",0);getWritableDatabase().update("held_days",v,"scope=? AND date=?",new String[]{scope,day.getString("date")});}
    synchronized void heldRefused(String scope,String date,String member,long now){heldKey(scope,date,member);ContentValues v=new ContentValues();v.put("refused_at",now);getWritableDatabase().update("held_days",v,"scope=? AND date=?",new String[]{scope,date});}
    /** Up to 50 held points of a group in capture order, before the group's first held gap. Their customer binding is not sent: a held day
     * is evidence of the route only (the visit it was bound to belongs to the earlier scope's journey, which the server no longer opens). */
    synchronized JSONArray heldBatch(String scope,String date,long cutoff)throws Exception{
        JSONArray batch=new JSONArray();
        try(Cursor c=getReadableDatabase().rawQuery("SELECT body FROM held_points WHERE scope=? AND date=? AND captured<=? ORDER BY captured,id LIMIT 50",new String[]{scope,date,Long.toString(cutoff)})){while(c.moveToNext())batch.put(new JSONObject(c.getString(0)).put("stopId",JSONObject.NULL));}
        return batch;
    }
    synchronized JSONObject heldFirstGap(String scope,String date)throws Exception{try(Cursor c=getReadableDatabase().rawQuery("SELECT id,at,reason FROM held_gaps WHERE scope=? AND date=? ORDER BY at,id LIMIT 1",new String[]{scope,date})){if(!c.moveToFirst())return null;return new JSONObject().put("id",c.getLong(0)).put("at",c.getLong(1)).put("reason",c.getString(2));}}
    synchronized int heldAck(JSONArray sent,JSONArray ack){if(ack==null)return 0;int deleted=0;SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{for(int i=0;i<ack.length();i++)for(int j=0;j<sent.length();j++)if(ack.optString(i).equals(sent.optJSONObject(j).optString("id"))){deleted+=db.delete("held_points","id=?",new String[]{ack.optString(i)});break;}db.setTransactionSuccessful();}finally{db.endTransaction();}return deleted;}
    synchronized void heldDeleteGap(long id){getWritableDatabase().delete("held_gaps","id=?",new String[]{Long.toString(id)});}
    /** Only a group with no held point or gap left loses its day; held evidence itself has no age expiry. */
    synchronized void heldPrune(){getWritableDatabase().delete("held_days","NOT EXISTS (SELECT 1 FROM held_points p WHERE p.scope=held_days.scope AND p.date=held_days.date) AND NOT EXISTS (SELECT 1 FROM held_gaps g WHERE g.scope=held_days.scope AND g.date=held_days.date)",null);}
}

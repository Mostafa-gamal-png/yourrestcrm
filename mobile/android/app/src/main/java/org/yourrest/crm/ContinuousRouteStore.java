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
    ContinuousRouteStore(Context context){super(context,"continuous-route-outbox.db",null,2);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE days(date TEXT PRIMARY KEY,create_key TEXT NOT NULL,body TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE TABLE points(id TEXT PRIMARY KEY,captured INTEGER NOT NULL,date TEXT NOT NULL,body TEXT NOT NULL,binding_known INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX point_order ON points(date,captured,id)");
        db.execSQL("CREATE TABLE gaps(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,date TEXT NOT NULL,reason TEXT NOT NULL,stop_id TEXT,binding_known INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX gap_order ON gaps(date,at,id)");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){if(oldVersion==1&&newVersion==2){db.execSQL("ALTER TABLE points ADD COLUMN binding_known INTEGER NOT NULL DEFAULT 0");db.execSQL("UPDATE points SET binding_known=1 WHERE INSTR(body,'\"stopId\":')>0");db.execSQL("ALTER TABLE gaps ADD COLUMN stop_id TEXT");db.execSQL("ALTER TABLE gaps ADD COLUMN binding_known INTEGER NOT NULL DEFAULT 0");return;}throw new IllegalStateException("Unsupported continuous outbox version");}
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
}

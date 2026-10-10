package org.yourrest.crm;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.UUID;

/** App-private durable outbox. Capacity blocks new fixes; pending evidence is never evicted. */
final class RouteStore extends SQLiteOpenHelper {
    static final int MAX_POINTS = 100000;
    RouteStore(Context context) { super(context, "route-outbox.db", null, 2); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE points (id TEXT PRIMARY KEY, captured INTEGER NOT NULL, body TEXT NOT NULL, binding_known INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX point_order ON points(captured,id)");
        db.execSQL("CREATE TABLE gaps (id INTEGER PRIMARY KEY AUTOINCREMENT, reason TEXT NOT NULL, at TEXT NOT NULL, stop_id TEXT, binding_known INTEGER NOT NULL DEFAULT 0)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { if(oldVersion==1&&newVersion==2){db.execSQL("ALTER TABLE points ADD COLUMN binding_known INTEGER NOT NULL DEFAULT 0");db.execSQL("UPDATE points SET binding_known=1 WHERE INSTR(body,'\"stopId\":')>0");db.execSQL("ALTER TABLE gaps ADD COLUMN stop_id TEXT");db.execSQL("ALTER TABLE gaps ADD COLUMN binding_known INTEGER NOT NULL DEFAULT 0");return;}throw new IllegalStateException("Unsupported route store version"); }
    synchronized String get(String key) {
        try(Cursor c = getReadableDatabase().rawQuery("SELECT value FROM meta WHERE key=?", new String[]{key})) { return c.moveToFirst() ? c.getString(0) : ""; }
    }
    synchronized void put(String key, String value) {
        ContentValues v = new ContentValues(); v.put("key", key); v.put("value", value == null ? "" : value);
        if(getWritableDatabase().insertWithOnConflict("meta", null, v, SQLiteDatabase.CONFLICT_REPLACE)<0)throw new IllegalStateException("تعذر حفظ بيانات حساب خط السير؛ النقاط السابقة محفوظة");
    }
    synchronized String deviceId() { String id = get("deviceId"); if(!RouteRules.uuid(id)) { id=UUID.randomUUID().toString(); put("deviceId",id); } return id; }
    synchronized JSONObject day() { try { return new JSONObject(get("day")); } catch(JSONException e) { return null; } }
    synchronized void day(JSONObject day) { put("day", day == null ? "" : day.toString()); }
    synchronized int count() { try(Cursor c=getReadableDatabase().rawQuery("SELECT count(*) FROM points",null)){c.moveToFirst();return c.getInt(0);} }
    synchronized int gapCount() { try(Cursor c=getReadableDatabase().rawQuery("SELECT count(*) FROM gaps",null)){c.moveToFirst();return c.getInt(0);} }
    synchronized long lastCaptured() { try { return Long.parseLong(get("lastCaptured")); } catch(NumberFormatException e) { return 0; } }
    synchronized void addPoint(JSONObject point, long captured) {
        boolean full=false;
        try {
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try {
            String id=point.optString("id");
            boolean duplicate;try(Cursor c=db.rawQuery("SELECT 1 FROM points WHERE id=?",new String[]{id})){duplicate=c.moveToFirst();}
            if(!duplicate&&count()>=MAX_POINTS){gapBound("buffer_full",RouteRules.iso(captured),point.isNull("stopId")?null:point.optString("stopId"),point.has("stopId"));full=true;}
            else if(!duplicate){
                ContentValues v=new ContentValues();v.put("id",id);v.put("captured",captured);v.put("body",point.toString());v.put("binding_known",point.has("stopId")?1:0);
                db.insertOrThrow("points",null,v);put("lastCaptured",Long.toString(Math.max(captured,lastCaptured())));
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        } catch(RuntimeException storageFailure){
            throw new IllegalStateException("تعذر حفظ الموقع الجديد على الجهاز؛ الموقع الجديد لم يُحفظ، والنقاط السابقة محفوظة. راجع مساحة تخزين الجهاز",storageFailure);
        }
        if(full)throw new IllegalStateException("امتلأت مساحة نقاط خط السير؛ النقاط السابقة محفوظة. اتصل بالإنترنت لرفعها واستئناف حفظ المواقع الجديدة");
    }
    synchronized JSONArray batch(long cutoff) throws JSONException {
        JSONArray a=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT body FROM points WHERE captured<=? ORDER BY captured,id LIMIT 50",new String[]{Long.toString(cutoff)})){while(c.moveToNext())a.put(new JSONObject(c.getString(0)));}return a;
    }
    /** Compatibility hook: an unacknowledged sample never expires because of its age. */
    synchronized int pruneExpired(){return 0;}
    synchronized void acknowledge(JSONArray sent, JSONArray acknowledged) {
        // Delete only IDs actually sent in this request and explicitly acknowledged.
        if(acknowledged==null)return;
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{
            for(int i=0;i<acknowledged.length();i++){String id=acknowledged.optString(i);for(int j=0;j<sent.length();j++)if(id.equals(sent.optJSONObject(j).optString("id"))){db.delete("points","id=?",new String[]{id});break;}}
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    synchronized boolean immutableBindings(){try(Cursor c=getReadableDatabase().rawQuery("SELECT 1 FROM points WHERE binding_known=0 UNION SELECT 1 FROM gaps WHERE binding_known=0 LIMIT 1",null)){return !c.moveToFirst();}}
    synchronized void gap(String reason,String at){
        String bound=get("stopId");long bindAt;try{bindAt=Long.parseLong(get("bindAt"));}catch(NumberFormatException missing){bindAt=Long.MAX_VALUE;}if(!RouteRules.identifier(bound)||RouteRules.millis(at)<bindAt)bound=null;
        gapBound(reason,at,bound,true);
    }
    private void gapBound(String reason,String at,String bound,boolean known){
        try(Cursor c=getReadableDatabase().rawQuery("SELECT reason,stop_id,binding_known,at FROM gaps ORDER BY id DESC LIMIT 1",null)){if(c.moveToFirst()&&reason.equals(c.getString(0))&&known==(c.getInt(2)==1)&&lastCaptured()<=RouteRules.millis(c.getString(3))&&java.util.Objects.equals(bound,c.isNull(1)?null:c.getString(1)))return;}
        ContentValues v=new ContentValues();v.put("reason",reason);v.put("at",at);v.put("stop_id",bound);v.put("binding_known",known?1:0);getWritableDatabase().insertOrThrow("gaps",null,v);
    }
    synchronized JSONObject firstGap() throws JSONException {
        try(Cursor c=getReadableDatabase().rawQuery("SELECT id,reason,at,stop_id,binding_known FROM gaps ORDER BY at,id LIMIT 1",null)) { if(!c.moveToFirst())return null;JSONObject gap=new JSONObject().put("id",c.getLong(0)).put("reason",c.getString(1)).put("at",c.getString(2));if(c.getInt(4)==1)gap.put("stopId",c.isNull(3)?JSONObject.NULL:c.getString(3));return gap; }
    }
    synchronized void deleteGap(long id){getWritableDatabase().delete("gaps","id=?",new String[]{Long.toString(id)});}
    synchronized boolean resetEmptyContext(){if(count()!=0||gapCount()!=0)return false;getWritableDatabase().delete("meta","key<>?",new String[]{"deviceId"});return true;}
    synchronized void clearDay() {
        if(!resetEmptyContext())throw new IllegalStateException("خط السير غير المرفوع محفوظ لحسابه؛ لا يمكن بدء سياق جديد قبل رفعه");
    }
}

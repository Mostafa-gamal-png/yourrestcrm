package org.yourrest.crm;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** All durable and HTTP operations run on a single queue, including binding changes. */
final class RouteTracker {
    interface Reply { void complete(JSONObject state,String error); }
    interface Listener { void changed(JSONObject state); }
    private static RouteTracker instance;
    static synchronized RouteTracker get(Context context){if(instance==null)instance=new RouteTracker(context.getApplicationContext());return instance;}
    private final Context context;
    private final RouteStore store;
    private final RouteApi api=new RouteApi();
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private final CopyOnWriteArrayList<Listener> listeners=new CopyOnWriteArrayList<>();
    private volatile boolean tracking=false;
    private volatile String error="";
    private volatile long lastFlush=0;
    private Reply startReply;
    private String pendingMember="";
    private boolean starting=false;
    private volatile long generation=0;

    private RouteTracker(Context context){
        this.context=context;store=new RouteStore(context);
        if("1".equals(store.get("collecting"))){store.put("collecting","0");if(ContinuousPolicy.inWindow(System.currentTimeMillis())){recordGap("service_stopped");error="توقف تسجيل الموقع؛ افتح زيارة لاستئناف التسجيل";}}
    }
    void addListener(Listener listener){listeners.add(listener);listener.changed(state());}
    void removeListener(Listener listener){listeners.remove(listener);}
    boolean permission(){
        return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED
                && (Build.VERSION.SDK_INT<33||context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED);
    }
    JSONObject state(){
        ContinuousRouteTracker continuous=ContinuousRouteTracker.get(context);if(continuous.hasState())return continuous.state();
        JSONObject state=new JSONObject(),day=store.day();
        try{
            state.put("tracking",tracking).put("permission",permission()?"granted":(context.getSharedPreferences("native",0).getBoolean("asked",false)?"denied":"prompt"))
                    .put("pendingCount",store.count()).put("pendingGapCount",store.gapCount()).put("lastFixAt",nullable(store.get("lastFixAt")))
                    .put("accuracy",store.get("accuracy").isEmpty()?JSONObject.NULL:Double.parseDouble(store.get("accuracy")))
                    .put("error",error.isEmpty()?JSONObject.NULL:error).put("dayId",day==null?JSONObject.NULL:day.opt("id"))
                    .put("memberId",day==null?JSONObject.NULL:day.opt("memberId")).put("regionScope",day==null?JSONObject.NULL:day.opt("regionScope")).put("enrolledRole",nullable(store.get("memberRole"))).put("date",day==null?JSONObject.NULL:day.opt("date"))
                    .put("stopId",nullable(store.get("stopId"))).put("directionsSupported",true);
        }catch(Exception ignored){ }
        continuous.addCapabilities(state);NativeAppInfo.add(context,state);try{state.put("immutableBindingSupported",store.immutableBindings());}catch(Exception ignored){}return state;
    }
    private static Object nullable(String text){return text==null||text.isEmpty()?JSONObject.NULL:text;}
    private void recordGap(String reason){JSONObject day=store.day();if(day!=null)store.gap(reason,RouteRules.iso(Math.max(RouteRules.millis(day.optString("startedAt")),Math.min(System.currentTimeMillis(),RouteRules.millis(day.optString("expiresAt"))))));}
    void changed(){JSONObject snapshot=state();main.post(()->{for(Listener listener:listeners)listener.changed(snapshot);RouteLocationService service=RouteLocationService.current;if(service!=null)service.updateNotification();});}
    private void finish(Reply reply,String problem){changed();if(reply!=null){JSONObject snapshot=state();main.post(()->reply.complete(snapshot,problem));}}
    private JSONObject request(String action)throws Exception{JSONObject day=store.day();if(day==null)throw new Exception("لا يوجد يوم عمل مفتوح");return new JSONObject().put("action",action).put("dayId",day.getString("id")).put("deviceId",store.deviceId());}
    private boolean live(JSONObject day){return day!=null&&day.isNull("endedAt")&&RouteRules.millis(day.optString("expiresAt"))>System.currentTimeMillis()&&day.optString("date").equals(RouteRules.date(System.currentTimeMillis()));}
    private void checkIdentity(JSONObject day,String member)throws Exception{
        if(day==null||!member.equals(day.optString("memberId"))||!store.deviceId().equals(day.optString("deviceId")))throw new RouteApi.Failure(403,"حساب يوم العمل لا يطابق المستخدم الحالي");
    }
    /** Call only from the resumed Activity after the explicit prepare flow. */
    void start(String memberId,String stopId,Reply reply){
        if(ContinuousRouteTracker.get(context).hasState()){ContinuousRouteTracker.get(context).bind(memberId,stopId,reply);return;}
        if(!ContinuousPolicy.inWindow(System.currentTimeMillis())){finish(reply,"جمع الموقع متوقف خارج 6 صباحًا إلى 6 مساءً بتوقيت المملكة، ويوم الجمعة");return;}
        if(memberId==null||!RouteRules.identifier(memberId)||(stopId!=null&&!stopId.trim().isEmpty()&&!RouteRules.identifier(stopId))){finish(reply,"بيانات الزيارة غير صالحة");return;}
        if(!context.getSharedPreferences("native",0).getBoolean("consent",false)){finish(reply,"راجع توضيح تسجيل الموقع ووافق عليه أولًا");return;}
        if(!permission()){finish(reply,"اسمح بالموقع الدقيق والإشعارات قبل بدء التسجيل");return;}
        final long expectedGeneration=generation;
        worker.execute(()->{
            if(expectedGeneration!=generation){finish(reply,"تم إلغاء بدء التسجيل");return;}
            if(starting){finish(reply,"يجري بدء تسجيل خط السير؛ حاول مجددًا");return;}
            starting=true;
            try{
                JSONObject previous=store.day();
                if(previous!=null&&!memberId.equals(previous.optString("memberId"))){
                    halt();if(!store.resetEmptyContext())throw new RouteApi.Failure(403,"يوجد خط سير محفوظ لحساب سابق؛ سجّل الدخول بالحساب نفسه لرفعه أو راجع الإدارة");previous=null;
                }
                if(previous!=null){flushInternal();previous=store.day();}
                if(previous!=null&&!live(previous)){
                    halt();store.put("endAt",RouteRules.endTimeForRestart(!previous.isNull("endedAt"),store.get("endAt"),System.currentTimeMillis(),RouteRules.millis(previous.optString("expiresAt"))));
                    flushInternal();if(store.count()>0||store.gapCount()>0||!store.get("endAt").isEmpty())throw new Exception("اتصل بالإنترنت لرفع يوم العمل السابق أولًا");
                    store.clearDay();previous=null;
                }
                JSONObject activeStop;
                if(previous==null){
                    String key=store.get("createKey");if(!RouteRules.uuid(key)){key=UUID.randomUUID().toString();store.put("createKey",key);}
                    JSONObject response=api.call(new JSONObject().put("action","begin").put("createKey",key).put("deviceId",store.deviceId()));
                    JSONObject day=response.optJSONObject("day");checkIdentity(day,memberId);if(!live(day))throw new Exception("انتهى يوم العمل؛ يبدأ يوم جديد حسب توقيت المملكة");
                    store.day(day);store.put("memberRole",response.optString("memberRole"));store.put("createKey","");activeStop=response.optJSONObject("activeStop");
                }else{
                    JSONObject response=api.call(null),day=response.optJSONObject("day");checkIdentity(day,memberId);
                    if(!day.optString("id").equals(previous.optString("id"))||!live(day))throw new Exception("يوم العمل غير متاح؛ أعد فتح التطبيق");store.day(day);store.put("memberRole",response.optString("memberRole"));activeStop=response.optJSONObject("activeStop");
                }
                if(expectedGeneration!=generation)throw new Exception("تم إلغاء بدء التسجيل");
                // The outbox is flushed before changing binding. Each queued point retains its own stopId.
                synchronized(store){store.put("stopId",stopId==null?"":stopId);store.put("bindAt",Long.toString(System.currentTimeMillis()));store.put("destination",boundDestination(activeStop,memberId,stopId));}pendingMember=memberId;error="";
                if(tracking){starting=false;finish(reply,null);return;}
                startReply=reply;
                main.post(()->{
                    try{
                        if(!MainActivity.resumed||expectedGeneration!=generation)throw new IllegalStateException("افتح التطبيق لبدء تسجيل الموقع");
                        context.startForegroundService(new Intent(context,RouteLocationService.class).setAction(RouteLocationService.START));
                    }catch(Exception failure){worker.execute(()->serviceFailed("تعذر بدء خدمة الموقع؛ افتح التطبيق وراجع الأذونات"));}
                });
            }catch(Exception failure){starting=false;handleFailure(failure);finish(reply,message(failure));}
        });
    }
    void startAfterMaps(String memberId,String stopId,ForegroundMapsHandoff handoff,Reply reply){
        ContinuousRouteTracker continuous=ContinuousRouteTracker.get(context);
        if(!continuous.canResume()){finish(reply,"افتح التطبيق وفعّل تسجيل الموقع أولًا");return;}
        continuous.bindAfterMaps(memberId,stopId,handoff,reply);
    }
    private String boundDestination(JSONObject activeStop,String memberId,String stopId)throws Exception{
        if(activeStop==null||stopId==null||!stopId.equals(activeStop.optString("id"))||!memberId.equals(activeStop.optString("memberId"))||!activeStop.isNull("closedAt"))return "";
        JSONObject snapshot=activeStop.optJSONObject("snapshot");if(snapshot==null||!(snapshot.opt("latitude") instanceof Number)||!(snapshot.opt("longitude") instanceof Number))return "";
        double latitude=snapshot.getDouble("latitude"),longitude=snapshot.getDouble("longitude");if(!RouteRules.validCoordinates(latitude,longitude))return "";
        return new JSONObject().put("stopId",stopId).put("memberId",memberId).put("latitude",latitude).put("longitude",longitude).toString();
    }
    String directions(String memberId,String stopId,double latitude,double longitude)throws Exception{
        if(ContinuousRouteTracker.get(context).enabled())return ContinuousRouteTracker.get(context).directions(memberId,stopId,latitude,longitude);
        synchronized(store){
            JSONObject day=store.day();JSONObject destination;
            try{destination=new JSONObject(store.get("destination"));}catch(Exception missing){throw new IllegalArgumentException("لوكيشن هذا العميل غير متاح للاتجاهات؛ اختر العميل مجددًا");}
            if(!stopId.equals(destination.optString("stopId"))||!memberId.equals(destination.optString("memberId")))throw new IllegalArgumentException("تغير العميل أو الحساب؛ اختر العميل مجددًا");
            return RouteRules.directionsUrl(tracking&&permission()&&live(day),memberId,day==null?"":day.optString("memberId"),stopId,store.get("stopId"),latitude,longitude,destination.getDouble("latitude"),destination.getDouble("longitude"));
        }
    }
    void serviceReady(){worker.execute(()->{
        if(!ContinuousPolicy.inWindow(System.currentTimeMillis())){windowPaused();return;}
        JSONObject day=store.day();
        if(!permission()||!live(day)||!pendingMember.equals(day.optString("memberId"))){serviceFailed("تعذر بدء يوم العمل");return;}
        tracking=true;store.put("collecting","1");starting=false;error="";Reply reply=startReply;startReply=null;finish(reply,null);
    });}
    void windowPaused(){worker.execute(()->{tracking=false;store.put("collecting","0");starting=false;error="";Reply reply=startReply;startReply=null;finish(reply,null);});}
    private void serviceFailed(String problem){tracking=false;starting=false;store.put("collecting","0");error=problem;Reply reply=startReply;startReply=null;halt();finish(reply,problem);}
    void startupFailed(){worker.execute(()->serviceFailed("تعذر بدء خدمة الموقع؛ فعّل الموقع وراجع الأذونات ثم أعد بدء الزيارة"));}
    void onFix(Location location){
        // Copy before enqueueing: provider objects are not owned by this executor.
        final Location fix=new Location(location);
        final long callbackAt=System.currentTimeMillis();
        if(!ContinuousPolicy.canCapture(fix.getTime(),callbackAt))return;
        final String capturedStopId;
        synchronized(store){long bindAt;try{bindAt=Long.parseLong(store.get("bindAt"));}catch(NumberFormatException e){bindAt=Long.MAX_VALUE;}capturedStopId=fix.getTime()>=bindAt?store.get("stopId"):"";}
        final JSONObject capturedDay=store.day();
        worker.execute(()->{
            if(!tracking)return;
            JSONObject day=store.day();
            if(capturedDay==null||!capturedDay.optString("id").equals(day.optString("id")))return;
            long now=System.currentTimeMillis(),captured=fix.getTime();
            if(captured>=RouteRules.millis(day.optString("expiresAt"))||!day.isNull("endedAt")){endInternal(null,false);return;}
            if(!RouteRules.validFix(fix.getLatitude(),fix.getLongitude(),fix.getAccuracy(),captured,callbackAt,store.lastCaptured()))return;
            if(captured<RouteRules.millis(day.optString("startedAt")))return;
            try{
                JSONObject point=new JSONObject().put("id",UUID.randomUUID().toString()).put("capturedAt",RouteRules.iso(captured))
                        .put("latitude",fix.getLatitude()).put("longitude",fix.getLongitude()).put("accuracy",fix.getAccuracy()).put("stopId",nullable(capturedStopId));
                store.addPoint(point,captured);store.put("lastFixAt",RouteRules.iso(captured));store.put("accuracy",Float.toString(fix.getAccuracy()));
                if(error.startsWith("امتلأت مساحة")||error.startsWith("تعذر حفظ الموقع الجديد"))error="";
                if(error.startsWith("خدمة الموقع")||error.startsWith("بانتظار موقع"))error="";
                if(now-lastFlush>=15000){flushInternal();lastFlush=now;}
                changed();
            }catch(Exception failure){handleFailure(failure);changed();}
        });
    }
    /** No client role/scope is accepted: this decision uses the authenticated server response. */
    void refreshAccount(String member,Reply reply){
        ContinuousRouteTracker continuous=ContinuousRouteTracker.get(context);
        if(continuous.hasState()){continuous.refreshAccount(member,reply);return;}
        worker.execute(()->{try{
            JSONObject day=store.day();if(day==null){finish(reply,null);return;}
            JSONObject response=api.call(null);
            if(!RouteRules.identifier(member)||!member.equals(response.optString("memberId")))throw new RouteApi.Failure(403,"الحساب الحالي لا يطابق مراجعة أذونات خط السير");
            String oldRole=store.get("memberRole"),role=response.optString("memberRole");if(oldRole.isEmpty())oldRole=role;
            AccountRecoveryPolicy.Decision decision=AccountRecoveryPolicy.decide(day.optString("memberId"),member,day.optString("regionScope"),response.optString("regionScope"),oldRole,role,store.count(),store.gapCount());
            if(decision==AccountRecoveryPolicy.Decision.WRONG_OWNER)throw new RouteApi.Failure(403,"النقاط المحفوظة تخص حسابًا سابقًا؛ راجع الإدارة أو سجّل الدخول بحسابها لرفعها");
            if(decision==AccountRecoveryPolicy.Decision.PRESERVE_BLOCKED){halt();throw new RouteApi.Failure(403,"تغيرت أذونات الحساب؛ محفوظ على الجهاز "+store.count()+" نقطة و"+store.gapCount()+" انقطاع من المنطقة السابقة. راجع الإدارة؛ الزيارات والخرائط متاحة");}
            if(decision==AccountRecoveryPolicy.Decision.RESET_EMPTY){generation++;halt();if(!store.resetEmptyContext())throw new Exception("ظهرت نقاط جديدة قبل مراجعة الأذونات؛ البيانات محفوظة");}
            error="";finish(reply,null);
        }catch(Exception failure){handleFailure(failure);finish(reply,message(failure));}});
    }
    void enroll(String memberId,Reply reply){ContinuousRouteTracker.get(context).enroll(memberId,reply);}
    void migrateForContinuous(String memberId,String regionScope,ContinuousRouteStore target)throws Exception{
        generation++;halt();
        worker.submit(()->{
            JSONObject old=store.day();if(old==null){if(!store.resetEmptyContext())throw new RouteApi.Failure(409,"النقاط القديمة محفوظة لكن بيانات حساب يوم العمل غير متاحة؛ راجع الإدارة");return null;}
            if(!memberId.equals(old.optString("memberId"))){if(store.resetEmptyContext())return null;throw new RouteApi.Failure(403,"خط السير القديم محفوظ لحساب آخر ولا يمكن نقله إلى الحساب الحالي");}
            if(!regionScope.equals(old.optString("regionScope"))){if(store.resetEmptyContext())return null;throw new RouteApi.Failure(403,"خط السير القديم محفوظ لمنطقة سابقة؛ راجع الإدارة قبل تفعيل منطقة جديدة");}
            // Claim the destination before copying the first row, including retry after a partial migration.
            String targetOwner=target.get("memberId"),targetScope=target.get("regionScope");
            if(!targetOwner.isEmpty()&&!memberId.equals(targetOwner))throw new RouteApi.Failure(403,"النقاط المحفوظة تخص حسابًا آخر");
            if(!targetScope.isEmpty()&&!regionScope.equals(targetScope))throw new RouteApi.Failure(403,"النقاط المحفوظة تخص منطقة أخرى");
            if(targetOwner.isEmpty()&&(target.count()>0||target.gapCount()>0))throw new RouteApi.Failure(403,"توجد نقاط قديمة بدون حساب موثق؛ محفوظة للمراجعة ولا تُنقل تلقائيًا");
            target.put("memberId",memberId);target.put("regionScope",regionScope);target.day(old);
            for(int round=0;round<RouteStore.MAX_POINTS/50+1;round++){JSONArray points=store.batch(Long.MAX_VALUE);if(points.length()==0)break;JSONArray ids=new JSONArray();for(int i=0;i<points.length();i++){JSONObject point=points.getJSONObject(i);target.point(point,RouteRules.millis(point.getString("capturedAt")));ids.put(point.getString("id"));}store.acknowledge(points,ids);}
            JSONObject gap;while((gap=store.firstGap())!=null){if(gap.has("stopId"))target.gapBoundMigration(gap.getString("reason"),RouteRules.millis(gap.getString("at")),gap.isNull("stopId")?null:gap.getString("stopId"));else target.gapLegacy(gap.getString("reason"),RouteRules.millis(gap.getString("at")));store.deleteGap(gap.getLong("id"));}
            store.clearDay();return null;
        }).get();
    }
    void flush(Reply reply){if(ContinuousRouteTracker.get(context).hasState()){ContinuousRouteTracker.get(context).flush(reply);return;}worker.execute(()->{try{flushInternal();finish(reply,null);}catch(Exception failure){handleFailure(failure);finish(reply,message(failure));}});}
    void tick(){
        worker.execute(()->{
            if(!ContinuousPolicy.inWindow(System.currentTimeMillis())){tracking=false;store.put("collecting","0");try{flushInternal();}catch(Exception failure){handleFailure(failure);}changed();return;}
            if(tracking&&!permission()){recordGap("permission_denied");halt();error="توقف التسجيل لأن إذن الموقع أو الإشعارات غير متاح";}
            if(tracking&&!live(store.day())){endInternal(null,false);return;}
            long lastFix=store.lastCaptured();JSONObject day=store.day();if(lastFix==0&&day!=null)lastFix=RouteRules.millis(day.optString("startedAt"));
            if(tracking&&lastFix>0&&System.currentTimeMillis()-lastFix>120000){recordGap("gps_unavailable");error="بانتظار موقع حديث؛ الفترة غير المؤكدة ستظهر في التقرير";}
            try{flushInternal();}catch(Exception failure){handleFailure(failure);}changed();
        });
    }
    private void flushInternal()throws Exception{
        JSONObject day=store.day();if(day==null)return;
        String member=day.optString("memberId");
        JSONObject auth=api.call(null);checkIdentity(day,member);
        if(!member.equals(auth.optString("memberId"))||!day.optString("regionScope").equals(auth.optString("regionScope")))throw new RouteApi.Failure(403,"خط السير المحفوظ لا يطابق الحساب والمنطقة الحاليين؛ البيانات محفوظة للمراجعة");
        // Merge fixes and gap events by actual capture time. Never upload newer fixes ahead of an older gap.
        int batches=store.get("endAt").isEmpty()?10:(RouteStore.MAX_POINTS/50+129);
        OutboxDrain.run(new OutboxDrain.Source(){
            public long earliestGapTime()throws Exception{JSONObject gap=store.firstGap();return gap==null?Long.MAX_VALUE:RouteRules.millis(gap.optString("at"));}
            public boolean uploadPointsThrough(long cutoff)throws Exception{
                JSONArray batch=store.batch(cutoff);if(batch.length()==0)return false;
                JSONObject response=api.call(request("samples").put("points",batch)),returned=response.optJSONObject("day");checkIdentity(returned,member);
                if(!day.optString("id").equals(returned.optString("id")))throw new RouteApi.Failure(409,"تغير يوم العمل");
                int before=store.count();store.acknowledge(batch,response.optJSONArray("acknowledgedIds"));store.day(returned);
                synchronizeStop(response);if(store.count()==before)throw new Exception("لم يؤكد الخادم حفظ النقاط؛ ستتم إعادة المحاولة");
                return true;
            }
            public boolean uploadEarliestGap()throws Exception{
                JSONObject gap=store.firstGap();if(gap==null)return false;
                JSONObject gapRequest=request("gap").put("reason",gap.getString("reason")).put("at",gap.getString("at"));if(gap.has("stopId"))gapRequest.put("stopId",gap.opt("stopId"));
                JSONObject response=api.call(gapRequest);
                checkIdentity(response.optJSONObject("day"),member);store.day(response.optJSONObject("day"));store.deleteGap(gap.getLong("id"));
                return true;
            }
        },batches);
        if(!store.get("endAt").isEmpty()&&store.count()==0&&store.firstGap()==null){
            JSONObject response=api.call(request("end").put("endedAt",store.get("endAt")));checkIdentity(response.optJSONObject("day"),member);
            store.day(response.getJSONObject("day"));store.put("endAt","");store.put("stopId","");
        }else if(tracking&&store.count()==0){
            JSONObject response=api.call(null),current=response.optJSONObject("day");
            if(!member.equals(response.optString("memberId")))throw new RouteApi.Failure(403,"تغير المستخدم الحالي");
            if(current!=null&&current.optString("id").equals(day.optString("id"))){checkIdentity(current,member);store.day(current);synchronizeStop(response);if(!live(current))halt();}
            else if(current!=null){throw new RouteApi.Failure(409,"يوم العمل المفتوح تغير");}
        }
        if(error.startsWith("تعذر الاتصال")||error.startsWith("تعذر مزامنة"))error="";
    }
    private void synchronizeStop(JSONObject response){
        JSONObject active=response.optJSONObject("activeStop");String current=store.get("stopId");
        // Never bind automatically to a new visit: only an explicit web start may do that.
        if(!current.isEmpty()&&(active==null||!current.equals(active.optString("id"))))store.put("stopId","");
    }
    private void requestEnd(){generation++;halt();JSONObject day=store.day();if(day!=null&&day.isNull("endedAt")&&store.get("endAt").isEmpty())store.put("endAt",RouteRules.iso(Math.min(System.currentTimeMillis(),RouteRules.millis(day.optString("expiresAt")))));}
    void stop(Reply reply){if(ContinuousRouteTracker.get(context).enabled()){ContinuousRouteTracker.get(context).internalStop(reply);return;}requestEnd();worker.execute(()->endInternal(reply,false));}
    void logout(Reply reply){ContinuousRouteTracker.get(context).logout((state,problem)->{requestEnd();worker.execute(()->endInternal(reply,true));});}
    private void endInternal(Reply reply,boolean clear){
        starting=false;Reply waiting=startReply;startReply=null;if(waiting!=null)finish(waiting,"توقف بدء التسجيل");
        halt();JSONObject day=store.day();
        if(day!=null&&day.isNull("endedAt")&&store.get("endAt").isEmpty())store.put("endAt",RouteRules.iso(Math.min(System.currentTimeMillis(),RouteRules.millis(day.optString("expiresAt")))));
        String problem=null;
        try{flushInternal();error="";}catch(Exception failure){handleFailure(failure);problem=message(failure);}
        if(clear){
            // Logout revokes collection/binding, not unsent evidence or its owner identity.
            store.put("stopId","");store.put("bindAt","");store.put("destination","");pendingMember="";
            if(store.count()==0&&store.gapCount()==0)store.resetEmptyContext();
            error="";problem=null;
        }
        else if(problem!=null)error="توقف التسجيل؛ النقاط محفوظة على الجهاز لحين الاتصال بالإنترنت";
        finish(reply,clear?null:problem);
    }
    private void halt(){tracking=false;store.put("collecting","0");main.post(()->context.stopService(new Intent(context,RouteLocationService.class)));}
    void providerUnavailable(){worker.execute(()->{if(tracking&&ContinuousPolicy.inWindow(System.currentTimeMillis())){recordGap("gps_unavailable");error="خدمة الموقع غير متاحة؛ فعّل الموقع من إعدادات الجهاز";changed();}});}
    void serviceDestroyed(){worker.execute(()->{if(tracking){tracking=false;store.put("collecting","0");if(ContinuousPolicy.inWindow(System.currentTimeMillis())){recordGap("service_stopped");error="توقف تسجيل الموقع؛ افتح التطبيق لاستئنافه";}changed();}});}
    private void handleFailure(Exception failure){
        error=message(failure);
        if(failure instanceof RouteApi.Failure){int status=((RouteApi.Failure)failure).status;
            if(status==401||status==403){halt();error="توقف التسجيل؛ راجع تسجيل الدخول وصلاحيات الحساب. النقاط غير المرفوعة محفوظة لحسابها";}
            else if(status==404){halt();error="توقف التسجيل؛ يلزم رفع تحديث CRM الخاص بتطبيق الموبايل. النقاط محفوظة على الجهاز";}
            else if(status==400){halt();error="توقف التسجيل لأن الخادم رفض بيانات الموقع؛ راجع وقت الجهاز والإدارة. النقاط محفوظة للمراجعة";}
            else if(status==409){halt();try{JSONObject response=api.call(null),remote=response.optJSONObject("day"),local=store.day();
                if(remote!=null&&local!=null&&remote.optString("id").equals(local.optString("id"))&&remote.optString("memberId").equals(local.optString("memberId")))store.day(remote);
            }catch(Exception ignored){ }error="توقف التسجيل بسبب تعارض يوم العمل؛ البيانات محفوظة، افتح التطبيق للمراجعة";}
        }
    }
    private String message(Exception failure){return failure instanceof RouteApi.Failure?failure.getMessage():(failure.getMessage()!=null&&failure.getMessage().matches(".*[\u0600-\u06ff].*")?failure.getMessage():"تعذر الاتصال بالخادم؛ البيانات محفوظة وستتم إعادة المحاولة");}
}

package org.yourrest.crm;

import android.Manifest;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Explicit enrollment: collect from 06:00 to 18:00 Saudi time, excluding Friday. */
final class ContinuousRouteTracker {
    private static ContinuousRouteTracker instance;
    static synchronized ContinuousRouteTracker get(Context context){if(instance==null)instance=new ContinuousRouteTracker(context.getApplicationContext());return instance;}
    private final Context context;
    private final ContinuousRouteStore store;
    private final RouteApi api=new RouteApi();
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile Thread workerThread;
    private final ExecutorService worker=Executors.newSingleThreadExecutor(task->{Thread thread=new Thread(task,"YourrestContinuousSync");workerThread=thread;return thread;});
    private final AtomicBoolean syncQueued=new AtomicBoolean(),authorizationQueued=new AtomicBoolean();
    private final String deviceId;
    private volatile boolean tracking=false;
    private volatile long generation=0;
    private volatile String error="",syncError="";
    private volatile boolean starting=false;
    private RouteTracker.Reply startReply;
    private long lastFlush;
    private ContinuousRouteTracker(Context context){
        this.context=context;store=new ContinuousRouteStore(context);RouteStore legacy=new RouteStore(context);deviceId=legacy.deviceId();legacy.close();
        detectSystemStop();
        if("1".equals(store.get("collecting"))){store.put("collecting","0");if(ContinuousPolicy.inWindow(System.currentTimeMillis())){store.gap("service_stopped",System.currentTimeMillis());error="انقطع تسجيل الموقع؛ يظهر الانقطاع في التقرير";}}
    }
    private void detectSystemStop(){
        if(Build.VERSION.SDK_INT<30)return;
        try{for(ApplicationExitInfo exit:context.getSystemService(ActivityManager.class).getHistoricalProcessExitReasons(null,0,3)){
            if(exit.getTimestamp()<=store.number("checkedExit"))continue;
            store.put("checkedExit",Long.toString(exit.getTimestamp()));
            if(exit.getReason()==ApplicationExitInfo.REASON_USER_REQUESTED&&exit.getTimestamp()>=store.number("enrolledAt")){
                store.put("enabled","0");store.put("userStopped","1");error="أوقف النظام التطبيق بطلب المستخدم؛ افتحه لإعادة تفعيل التسجيل";
            }
            break;
        }}catch(RuntimeException ignored){ }
    }
    boolean enabled(){return store.enabled();}
    boolean hasState(){return enabled()||!store.get("memberId").isEmpty();}
    static boolean backgroundGranted(Context context){return Build.VERSION.SDK_INT<29||context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)==PackageManager.PERMISSION_GRANTED;}
    private boolean consent(){return context.getSharedPreferences("native",0).getBoolean("continuousConsentV1",false);}
    boolean canResume(){return ContinuousPolicy.canResume(enabled(),consent(),context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED,backgroundGranted(context),Build.VERSION.SDK_INT<33||context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED,"1".equals(store.get("userStopped")));}
    /** Current OS grants and consent are always required in addition to the bounded server lease. */
    boolean collectionAuthorized(){synchronized(store){
        if(!canResume()||"1".equals(store.get("loggedOut")))return false;
        try{JSONObject lease=new JSONObject(store.get("offlineAuthorization"));long now=System.currentTimeMillis();
            return OfflineRouteAuthorization.valid(store.get("memberId"),store.get("regionScope"),store.get("memberRole"),lease.optString("memberId"),lease.optString("regionScope"),lease.optString("memberRole"),lease.optLong("verifiedAt"),Math.max(lease.optLong("verifiedAt"),store.number("authorizationObservedAt")),now);
        }catch(Exception missing){return false;}
    }}
    private void rememberAuthorization(JSONObject response,long expected,String member)throws Exception{synchronized(store){
        checkCurrent(expected,member);verify(response,member);long now=System.currentTimeMillis();
        store.put("offlineAuthorization",new JSONObject().put("memberId",member).put("regionScope",response.getString("regionScope")).put("memberRole",response.getString("memberRole")).put("verifiedAt",now).toString());
        store.put("authorizationObservedAt",Long.toString(now));
    }}
    private void forgetAuthorization(){store.put("offlineAuthorization","");store.put("authorizationObservedAt","");}
    private boolean offlineFallback(Exception failure){
        boolean retryable=failure instanceof RouteApi.Failure?OfflineRouteAuthorization.transientStatus(((RouteApi.Failure)failure).status):failure instanceof java.io.IOException&&!(failure instanceof javax.net.ssl.SSLException);
        return retryable&&collectionAuthorized();
    }
    private void pauseForAuthorization(){tracking=false;store.put("collecting","0");error="يلزم الاتصال بالإنترنت لتجديد صلاحية تسجيل الموقع؛ النقاط السابقة محفوظة";main.post(()->{RouteLocationService service=RouteLocationService.current;if(service!=null)service.refreshWindow();});}
    JSONObject state(){
        JSONObject s=new JSONObject(),day=store.day(ContinuousPolicy.date(System.currentTimeMillis()));
        try{s.put("tracking",tracking).put("permission",RouteTracker.get(context).permission()?"granted":"denied")
                .put("pendingCount",store.pendingCount()).put("pendingGapCount",store.pendingGapCount()).put("quarantinedCount",store.quarantinedCount()).put("quarantinedGapCount",store.quarantinedGapCount()).put("lastFixAt",optional(store.get("lastFixAt"))).put("accuracy",store.get("accuracy").isEmpty()?JSONObject.NULL:Double.parseDouble(store.get("accuracy")))
                .put("error",error.isEmpty()?JSONObject.NULL:error).put("syncError",syncError.isEmpty()?JSONObject.NULL:syncError).put("quarantineNotice",optional(quarantineNotice())).put("dayId",day==null?JSONObject.NULL:day.opt("id"))
                .put("date",ContinuousPolicy.date(System.currentTimeMillis())).put("memberId",optional(store.get("memberId"))).put("regionScope",optional(store.get("regionScope"))).put("enrolledRole",optional(store.get("memberRole"))).put("stopId",optional(currentStopId()))
                .put("workHoursSupported",true).put("trackingWindowActive",ContinuousPolicy.inWindow(System.currentTimeMillis())).put("trackingWindowStart","06:00").put("trackingWindowEnd","18:00").put("trackingTimeZone","Asia/Riyadh").put("nextTrackingWindowAt",RouteRules.iso(ContinuousPolicy.nextStart(System.currentTimeMillis())))
                .put("directionsSupported",true).put("continuousSupported",true).put("enrolled",enabled()).put("backgroundPermission",backgroundGranted(context)?"granted":(context.getSharedPreferences("native",0).getBoolean("backgroundAsked",false)?"denied":"prompt"));
        }catch(Exception ignored){}NativeAppInfo.add(context,s);try{s.put("immutableBindingSupported",store.immutableBindings());}catch(Exception ignored){}return s;
    }
    void addCapabilities(JSONObject state){try{state.put("workHoursSupported",true).put("trackingWindowActive",ContinuousPolicy.inWindow(System.currentTimeMillis())).put("trackingWindowStart","06:00").put("trackingWindowEnd","18:00").put("trackingTimeZone","Asia/Riyadh").put("nextTrackingWindowAt",RouteRules.iso(ContinuousPolicy.nextStart(System.currentTimeMillis()))).put("continuousSupported",true).put("enrolled",enabled()).put("backgroundPermission",backgroundGranted(context)?"granted":(context.getSharedPreferences("native",0).getBoolean("backgroundAsked",false)?"denied":"prompt"));}catch(Exception ignored){}}
    /** Informational only: quarantine never sets the collection/control error or stops enrollment. */
    private String quarantineNotice(){int points=store.quarantinedCount(),gaps=store.quarantinedGapCount();if(points+gaps==0)return "";return "بيانات قديمة ليوم الجمعة محفوظة على الجهاز ولا تُرفع: "+points+" نقطة و"+gaps+" انقطاع؛ تبقى محفوظة للمراجعة. تسجيل أيام العمل مستمر";}
    private static Object optional(String value){return value==null||value.isEmpty()?JSONObject.NULL:value;}
    private void changed(){RouteTracker.get(context).changed();}
    private void finish(RouteTracker.Reply reply,String problem){changed();if(reply!=null){JSONObject snapshot=state();main.post(()->reply.complete(snapshot,problem));}}
    private void verify(JSONObject response,String member)throws Exception{
        if(!member.equals(response.optString("memberId"))||!"rep".equals(response.optString("memberRole")))throw new RouteApi.Failure(403,"الحساب الحالي لا يطابق مندوب التسجيل");
        String scope=store.get("regionScope");if(!scope.isEmpty()&&!scope.equals(response.optString("regionScope")))throw new RouteApi.Failure(403,"تغير نطاق صلاحية المندوب");
        JSONObject day=response.optJSONObject("day");if(day!=null&&(!member.equals(day.optString("memberId"))||!deviceId.equals(day.optString("deviceId"))))throw new RouteApi.Failure(409,"التسجيل مرتبط بجهاز آخر");
    }
    /** Only an authenticated account switch may clear already-empty metadata. Pending evidence never changes owner. */
    private boolean resetEmptyOwnerForAccount(JSONObject response,String member,long expected)throws Exception{synchronized(store){
        if(expected!=generation)throw new Exception("تم تغيير حالة التسجيل");
        if(!RouteRules.identifier(member)||!member.equals(response.optString("memberId")))throw new RouteApi.Failure(403,"الحساب الحالي لا يطابق مراجعة بيانات الجهاز");
        String owner=store.get("memberId");int points=store.count(),gaps=store.gapCount();
        if(owner.isEmpty()){
            if(points!=0||gaps!=0)throw new RouteApi.Failure(403,"خط سير محفوظ بدون هوية مكتملة؛ البيانات محفوظة للمراجعة ولا يمكن نقلها للحساب الحالي");
            return false;
        }
        if(owner.equals(member))return false;
        if(!OfflineRouteAuthorization.canResetEmptyOwner(owner,member,points,gaps))throw new RouteApi.Failure(403,"النقاط المحفوظة تخص حسابًا سابقًا؛ سجّل الدخول بحسابها لرفعها قبل تغيير الحساب");
        store.put("enabled","0");forgetAuthorization();RouteWindowSchedule.cancel(context);halt();
        if(!store.resetEmptyContext())throw new RouteApi.Failure(403,"ظهرت نقاط جديدة؛ بيانات الحساب السابق محفوظة ولم تتغير");
        return true;
    }}
    void refreshAccount(String member,RouteTracker.Reply reply){
        final long expected=generation;
        worker.execute(()->{try{
            JSONObject response=api.call(null);
            if(!RouteRules.identifier(member)||!member.equals(response.optString("memberId")))throw new RouteApi.Failure(403,"الحساب الحالي لا يطابق مراجعة أذونات خط السير");
            JSONObject currentDay=response.optJSONObject("day");if(currentDay!=null&&!deviceId.equals(currentDay.optString("deviceId")))throw new RouteApi.Failure(409,"التتبع الحالي مرتبط بجهاز آخر؛ راجع الإدارة");
            if(expected!=generation)throw new Exception("تم تغيير حالة التسجيل");
            if(resetEmptyOwnerForAccount(response,member,expected)){error="";syncError="";finish(reply,null);return;}
            String oldRole=store.get("memberRole");if(oldRole.isEmpty())oldRole="rep";
            AccountRecoveryPolicy.Decision decision=AccountRecoveryPolicy.decide(store.get("memberId"),member,store.get("regionScope"),response.optString("regionScope"),oldRole,response.optString("memberRole"),store.count(),store.gapCount());
            if(decision==AccountRecoveryPolicy.Decision.WRONG_OWNER)throw new RouteApi.Failure(403,"النقاط المحفوظة تخص حسابًا سابقًا؛ راجع الإدارة أو سجّل الدخول بحسابها لرفعها");
            if(decision==AccountRecoveryPolicy.Decision.PRESERVE_BLOCKED){disable(false);error="تغيرت أذونات الحساب؛ محفوظ على الجهاز "+store.count()+" نقطة و"+store.gapCount()+" انقطاع من المنطقة السابقة. راجع الإدارة؛ الزيارات والخرائط متاحة";finish(reply,error);return;}
            if(decision==AccountRecoveryPolicy.Decision.RESET_EMPTY){disable(false);if(!store.resetEmptyContext())throw new Exception("ظهرت نقاط جديدة قبل مراجعة الأذونات؛ البيانات محفوظة");syncError="";}
            else {synchronized(store){checkCurrent(expected,member);store.put("memberRole",response.optString("memberRole"));
                if("rep".equals(response.optString("memberRole")))rememberAuthorization(response,expected,member);
                store.put("loggedOut","0");
            }}
            error="";finish(reply,null);
        }catch(Exception failure){handle(failure);finish(reply,message(failure));}});
    }
    private void recoverEmptyScopeForEnrollment(JSONObject response,String member)throws Exception{
        if(!member.equals(response.optString("memberId"))||!"rep".equals(response.optString("memberRole")))return;
        String scope=store.get("regionScope");if(scope.isEmpty()||scope.equals(response.optString("regionScope")))return;
        halt();store.put("enabled","0");
        if(!store.resetEmptyContext())throw new RouteApi.Failure(403,"تغيرت منطقة الحساب؛ محفوظ "+store.count()+" نقطة و"+store.gapCount()+" انقطاع. راجع الإدارة قبل تفعيل منطقة جديدة؛ الزيارات والخرائط متاحة");
    }
    void enroll(String member,RouteTracker.Reply reply){
        if(!RouteRules.identifier(member)||!consent()||!RouteTracker.get(context).permission()||!backgroundGranted(context)){finish(reply,"يلزم الموافقة على تسجيل الموقع من 6 صباحًا إلى 6 مساءً بتوقيت المملكة، ما عدا الجمعة والسماح بالموقع طوال الوقت");return;}
        final long expected=generation;
        worker.execute(()->{
            if(starting){finish(reply,"يجري تفعيل تسجيل الموقع؛ راجع الحالة بعد لحظات");return;}starting=true;
            try{
                JSONObject response=api.call(null);
                resetEmptyOwnerForAccount(response,member,expected);
                recoverEmptyScopeForEnrollment(response,member);verify(response,member);
                if(expected!=generation)throw new Exception("تم إلغاء تفعيل التسجيل");
                RouteTracker.get(context).migrateForContinuous(member,response.getString("regionScope"),store);
                if(store.get("enrolledAt").isEmpty()){
                    store.put("memberId",member);store.put("regionScope",response.getString("regionScope"));store.put("enrolledAt",Long.toString(System.currentTimeMillis()));store.put("enrolledServerAt",response.getString("serverTime"));
                }
                store.put("memberRole",response.optString("memberRole"));
                JSONObject current=response.optJSONObject("day");if(current!=null&&current.isNull("endedAt"))store.day(current);
                // Authorize foreground activation independently of historical uploads.
                // The outbox keeps captured dates/bindings and is drained in bounded sync passes.
                ensureCurrentWhenReady();
                if(expected!=generation||!MainActivity.resumed)throw new Exception("افتح التطبيق لإتمام تفعيل تسجيل الموقع في ساعات العمل");
                synchronized(store){rememberAuthorization(response,expected,member);store.put("loggedOut","0");
                    store.put("userStopped","0");store.put("enabled","1");}error="";
                // Send one ordered start command after any queued stop from account/scope reset.
                // Reusing a worker-observed service reference can race with its pending destruction.
                startReply=reply;
                main.post(()->{try{if(expected!=generation||!MainActivity.resumed)throw new IllegalStateException();context.startForegroundService(new Intent(context,RouteLocationService.class).setAction(RouteLocationService.CONTINUOUS));}catch(RuntimeException denied){startupFailed();}});
            }catch(Exception failure){starting=false;handle(failure);finish(reply,message(failure));}
        });
    }
    /** Called by a foreground service already showing its notification, including a permitted boot restart. */
    void authorizeService(){
        if(!authorizationQueued.compareAndSet(false,true))return;
        final long expected=generation;
        worker.execute(()->{
            if(!canResume()){authorizationQueued.set(false);halt();starting=false;finish(startReply,"التسجيل متوقف؛ راجع إذن الموقع طوال الوقت");startReply=null;return;}
            try{
                JSONObject response=api.call(null);verify(response,store.get("memberId"));checkCurrent(expected,store.get("memberId"));rememberAuthorization(response,expected,store.get("memberId"));
                // A rejected historical record cannot block current authorized collection.
                ensureCurrentWhenReady();
                if(expected!=generation||!canResume())throw new Exception("تم إيقاف التسجيل");
                main.post(()->{RouteLocationService service=RouteLocationService.current;if(service!=null&&expected==generation&&canResume())service.continuousAuthorized();});
            }catch(Exception failure){
                if(expected==generation&&offlineFallback(failure)){
                    syncError="لا يوجد اتصال بالخادم؛ يجري حفظ الموقع على الجهاز لحين عودة الشبكة";
                    main.post(()->{RouteLocationService service=RouteLocationService.current;if(service!=null&&expected==generation&&collectionAuthorized())service.continuousAuthorized();});
                }else{starting=false;handle(failure);RouteTracker.Reply reply=startReply;startReply=null;finish(reply,message(failure));}
            }finally{authorizationQueued.set(false);}
        });
    }
    void serviceReady(){if(!canResume()){halt();return;}if(!collectionAuthorized()){pauseForAuthorization();return;}if(!ContinuousPolicy.inWindow(System.currentTimeMillis())){windowPaused();return;}tracking=true;store.put("collecting","1");starting=false;error="";RouteTracker.Reply reply=startReply;startReply=null;finish(reply,null);}
    /** Scheduled pauses retain enrollment/outbox and do not invent a gap, visit exit or day end. */
    void windowPaused(){tracking=false;store.put("collecting","0");starting=false;error="";RouteTracker.Reply reply=startReply;startReply=null;finish(reply,null);}
    void resumeFromActivity(){if(canResume()&&RouteLocationService.current==null&&MainActivity.resumed){try{context.startForegroundService(new Intent(context,RouteLocationService.class).setAction(RouteLocationService.CONTINUOUS));}catch(RuntimeException denied){backgroundStartDenied();}}}
    void startupFailed(){worker.execute(()->{starting=false;halt();error="تعذر بدء تسجيل الخلفية؛ افتح التطبيق وراجع أذونات الموقع";RouteTracker.Reply reply=startReply;startReply=null;finish(reply,error);});}
    void backgroundStartDenied(){error="لم يسمح النظام ببدء التسجيل في الخلفية؛ افتح التطبيق لاستئنافه";changed();}
    void bind(String member,String stop,RouteTracker.Reply reply){bindInternal(member,stop,null,reply);}
    void bindAfterMaps(String member,String stop,ForegroundMapsHandoff handoff,RouteTracker.Reply reply){bindInternal(member,stop,handoff,reply);}
    private void bindInternal(String member,String stop,ForegroundMapsHandoff handoff,RouteTracker.Reply reply){
        final long expected=generation;
        worker.execute(()->{try{
            if(!canResume()||!member.equals(store.get("memberId"))||(ContinuousPolicy.inWindow(System.currentTimeMillis())&&!tracking))throw new Exception("فعّل تسجيل الموقع أولًا");
            // The server has already selected this stop. Bind after one authenticated status
            // check; queued observations retain their original binding and sync separately.
            JSONObject response=api.call(null);verify(response,member);JSONObject active=response.optJSONObject("activeStop");
            if(active==null||!stop.equals(active.optString("id"))||!member.equals(active.optString("memberId"))||!active.isNull("closedAt"))throw new Exception("الزيارة الحالية غير متاحة؛ اختر العميل مجددًا");
            if(expected!=generation)throw new Exception("تم تغيير حالة التسجيل");
            if(handoff!=null){JSONObject snapshot=active.optJSONObject("snapshot");if(snapshot==null||!(snapshot.opt("latitude") instanceof Number)||!(snapshot.opt("longitude") instanceof Number)||!handoff.matches(snapshot.getDouble("latitude"),snapshot.getDouble("longitude"),SystemClock.elapsedRealtime()))throw new Exception("انتهت مهلة التوجه أو تغيرت الوجهة؛ عد للتطبيق واختر العميل مجددًا");}
            synchronized(store){store.put("stopId",stop);store.put("selectedAt",Long.toString(RouteRules.millis(active.optString("selectedAt"))));store.put("bindAt",Long.toString(System.currentTimeMillis()));store.put("destination",active.optJSONObject("snapshot")==null?"":active.getJSONObject("snapshot").toString());}
            error="";finish(reply,null);
        }catch(Exception failure){handle(failure);finish(reply,message(failure));}});
    }
    private String currentStopId(){return ContinuousPolicy.stopIdAt(store.get("stopId"),store.number("selectedAt"),System.currentTimeMillis());}
    String directions(String member,String stop,double latitude,double longitude)throws Exception{
        synchronized(store){JSONObject destination;try{destination=new JSONObject(store.get("destination"));}catch(Exception absent){throw new IllegalArgumentException("لوكيشن العميل غير متاح؛ اختر العميل مجددًا");}
            return RouteRules.directionsUrl(canResume()&&(tracking||!ContinuousPolicy.inWindow(System.currentTimeMillis())),member,store.get("memberId"),stop,currentStopId(),latitude,longitude,destination.optDouble("latitude",Double.NaN),destination.optDouble("longitude",Double.NaN));}
    }
    void onFix(Location value){
        final Location fix=new Location(value);final long callback=System.currentTimeMillis();
        try{synchronized(store){if(!ContinuousPolicy.canCapture(fix.getTime(),callback)){main.post(()->{RouteLocationService service=RouteLocationService.current;if(service!=null)service.refreshWindow();});return;}if(!tracking||!enabled())return;
            if(!canResume()){store.gap("permission_denied",callback);halt();error="توقف التسجيل بسبب تغيير أذونات النظام";changed();return;}
            if(!collectionAuthorized()){pauseForAuthorization();changed();return;}
            store.put("authorizationObservedAt",Long.toString(Math.max(callback,store.number("authorizationObservedAt"))));
            long captured=fix.getTime();if(captured<store.number("enrolledAt")||!ContinuousPolicy.validFix(fix.getLatitude(),fix.getLongitude(),fix.getAccuracy(),captured,callback,store.number("lastCaptured")))return;
            String bound=fix.getTime()>=store.number("bindAt")?ContinuousPolicy.stopIdAt(store.get("stopId"),store.number("selectedAt"),fix.getTime()):null;
            // Persist each real callback before network work; a slow/offline upload cannot leave fixes only in RAM.
            store.point(new JSONObject().put("id",UUID.randomUUID().toString()).put("capturedAt",RouteRules.iso(captured)).put("latitude",fix.getLatitude()).put("longitude",fix.getLongitude()).put("accuracy",fix.getAccuracy()).put("stopId",optional(bound)),captured);
            store.put("lastFixAt",RouteRules.iso(captured));store.put("accuracy",Float.toString(fix.getAccuracy()));
            if(error.startsWith("خدمة الموقع")||error.startsWith("بانتظار")||error.contains("مساحة نقاط خط السير")||error.startsWith("تعذر حفظ الموقع الجديد"))error="";
        }if(System.currentTimeMillis()-lastFlush>=15000)scheduleSync();changed();}
        catch(Exception failure){error=message(failure);changed();}
    }
    private JSONObject ensureDay(String date)throws Exception{
        JSONObject day=store.day(date);
        if(day!=null&&!day.isNull("endedAt")&&date.equals(ContinuousPolicy.date(System.currentTimeMillis()))&&!store.hasQueued(date)){store.put("startFloor:"+date,day.optString("endedAt"));store.resetDay(date);day=null;}
        if(day!=null)return day;
        long windowStart=ContinuousPolicy.windowStart(RouteRules.millis(date+"T12:00:00.000Z"));
        long first=ContinuousPolicy.startTime(windowStart,RouteRules.millis(store.get("enrolledServerAt")),RouteRules.millis(store.get("startFloor:"+date)));
        final long expected=generation;final String owner=store.get("memberId");
        JSONObject response=api.call(new JSONObject().put("action","begin").put("createKey",store.key(date)).put("deviceId",deviceId).put("continuous",true).put("regionScope",store.get("regionScope")).put("date",date).put("startedAt",RouteRules.iso(first)));
        verify(response,owner);checkCurrent(expected,owner);day=response.getJSONObject("day");if(!date.equals(day.optString("date")))throw new RouteApi.Failure(409,"تاريخ التسجيل غير مطابق");store.day(day);return day;
    }
    private void ensureCurrentWhenReady()throws Exception{if(!ContinuousPolicy.inWindow(System.currentTimeMillis()))return;String current=ContinuousPolicy.date(System.currentTimeMillis()),queued=store.firstDate();if(ContinuousPolicy.canCreateCurrentDay(queued,current))ensureDay(current);}
    private JSONObject request(String action,JSONObject day)throws Exception{return new JSONObject().put("action",action).put("dayId",day.getString("id")).put("deviceId",deviceId);}
    private void flushInternal()throws Exception{flushInternal(1);}
    private void flushInternal(int maxOperations)throws Exception{
        if(store.get("memberId").isEmpty()||"1".equals(store.get("loggedOut")))return;
        final long expected=generation;final String owner=store.get("memberId");
        JSONObject auth=api.call(null);verify(auth,owner);checkCurrent(expected,owner);rememberAuthorization(auth,expected,owner);
        int expired=store.prune();if(expired>0)syncError="انتهت مهلة رفع بعض النقاط القديمة؛ الفترات غير المسجلة لا تُحسب كحركة مؤكدة";
        for(int operations=0;operations<maxOperations;operations++){
            String date=store.firstDate();if(date==null)break;JSONObject day=ensureDay(date),gap;JSONArray batch;
            synchronized(store){gap=store.firstGap(date);batch=store.batch(date,gap==null?Long.MAX_VALUE:gap.getLong("at"));}
            if(batch.length()>0){JSONObject result=api.call(request("samples",day).put("points",batch));verify(result,owner);checkCurrent(expected,owner);verifyDay(result,day);int deleted=store.ack(batch,result.optJSONArray("acknowledgedIds"));store.day(result.getJSONObject("day"));synchronizeStop(result);if(deleted==0)throw new Exception("لم يؤكد الخادم حفظ النقاط؛ ستتم إعادة المحاولة");}
            else if(gap!=null){JSONObject gapRequest=request("gap",day).put("reason",gap.getString("reason")).put("at",RouteRules.iso(gap.getLong("at")));if(gap.has("stopId"))gapRequest.put("stopId",gap.opt("stopId"));JSONObject result=api.call(gapRequest);verify(result,owner);checkCurrent(expected,owner);verifyDay(result,day);store.day(result.getJSONObject("day"));store.deleteGap(gap.getLong("id"));}
            else break;
        }
        synchronizeStop(auth);
        if(enabled())ensureCurrentWhenReady();
        store.put("conflicts","0");
        if(expired==0)syncError="";
    }
    private void checkCurrent(long expected,String member)throws Exception{if(expected!=generation||!member.equals(store.get("memberId")))throw new Exception("تغير الحساب أو حالة التسجيل");}
    private void verifyDay(JSONObject response,JSONObject sent)throws Exception{JSONObject day=response.optJSONObject("day");if(day==null||!sent.optString("id").equals(day.optString("id"))||!sent.optString("date").equals(day.optString("date")))throw new RouteApi.Failure(409,"استجابة التسجيل لا تطابق اليوم المطلوب");}
    private void scheduleSync(){if(!syncQueued.compareAndSet(false,true))return;worker.execute(()->{try{flushInternal(1);}catch(Exception failure){handleSync(failure);}finally{lastFlush=System.currentTimeMillis();syncQueued.set(false);changed();}});}
    private void synchronizeStop(JSONObject response){JSONObject active=response.optJSONObject("activeStop");String stop=store.get("stopId");if(!stop.isEmpty()&&(currentStopId()==null||active==null||!stop.equals(active.optString("id")))){synchronized(store){store.put("stopId","");store.put("destination","");}}}
    void flush(RouteTracker.Reply reply){worker.execute(()->{try{flushInternal(1);finish(reply,null);}catch(Exception failure){handleSync(failure);finish(reply,message(failure));}});}
    void tick(){
        if(!ContinuousPolicy.inWindow(System.currentTimeMillis())){if(tracking)windowPaused();if(canResume()&&store.firstDate()!=null)scheduleSync();return;}
        if(!canResume()){if(tracking){store.gap("permission_denied",System.currentTimeMillis());halt();error="توقف التسجيل بسبب تغيير أذونات النظام";changed();}return;}
        if(!collectionAuthorized()){if(tracking)pauseForAuthorization();authorizeService();return;}
        if(!tracking){authorizeService();return;}
        long last=Math.max(ContinuousPolicy.windowStart(System.currentTimeMillis()),store.number("lastCaptured"));if(last==0)last=store.number("enrolledAt");if(System.currentTimeMillis()-last>120000){store.gap("gps_unavailable",System.currentTimeMillis());error="بانتظار موقع حديث؛ الفترة غير المؤكدة تظهر في التقرير";}scheduleSync();
    }
    void providerUnavailable(){if(tracking&&ContinuousPolicy.inWindow(System.currentTimeMillis())){store.gap("gps_unavailable",System.currentTimeMillis());error="خدمة الموقع غير متاحة؛ فعّلها من إعدادات الجهاز";changed();}}
    void serviceDestroyed(){if(tracking){tracking=false;store.put("collecting","0");if(ContinuousPolicy.inWindow(System.currentTimeMillis())){store.gap("service_stopped",System.currentTimeMillis());error="انقطع تسجيل الموقع؛ الفترة غير المسجلة تظهر في التقرير";}changed();}}
    private void halt(){tracking=false;store.put("collecting","0");main.post(()->context.stopService(new Intent(context,RouteLocationService.class)));}
    private void disable(boolean clear){synchronized(store){generation++;store.put("enabled","0");forgetAuthorization();}RouteWindowSchedule.cancel(context);halt();}
    void logout(RouteTracker.Reply reply){synchronized(store){store.put("loggedOut","1");disable(false);store.put("stopId","");store.put("selectedAt","");store.put("bindAt","");store.put("destination","");}
        final long expected=generation;
        worker.execute(()->{synchronized(store){
            if(expected==generation&&"1".equals(store.get("loggedOut"))&&store.count()==0&&store.gapCount()==0)store.resetEmptyContext();
        }error="";starting=false;RouteTracker.Reply waiting=startReply;startReply=null;if(waiting!=null)finish(waiting,"تم تسجيل الخروج");finish(reply,null);});}

    void internalStop(RouteTracker.Reply reply){finish(reply,"التسجيل المستمر مفعّل؛ تتم إدارة أذونات الموقع من إعدادات أندرويد");}
    /** Control failures stop/reject control actions. Unsynced evidence remains account-bound. */
    private void handle(Exception failure){
        error=message(failure);
        if(failure instanceof RouteApi.Failure){int status=((RouteApi.Failure)failure).status;
            if(TrackingFailurePolicy.authenticationRejected(status)||status==409){disable(false);error=status==409?"توقف التسجيل؛ راجع تعارض يوم العمل أو الجهاز. النقاط السابقة محفوظة للمراجعة":status==401?"توقف التسجيل؛ سجّل الدخول مجددًا للحساب نفسه لرفع النقاط المحفوظة":"توقف التسجيل؛ راجع الحساب وصلاحيات المندوب. النقاط السابقة محفوظة لحسابها";}
        }
    }
    /** Data rejection is a sync diagnostic, not a revoked collection permission. */
    private void handleSync(Exception failure){
        syncError=message(failure);
        if(!(failure instanceof RouteApi.Failure))return;
        int status=((RouteApi.Failure)failure).status;
        if(TrackingFailurePolicy.authenticationRejected(status)){handle(failure);return;}
        if(TrackingFailurePolicy.recheckDevice(status)){
            long expected=generation;String member=store.get("memberId");
            try{JSONObject current=api.call(null);verify(current,member);checkCurrent(expected,member);}
            catch(Exception conflict){
                if(conflict instanceof RouteApi.Failure){int conflictStatus=((RouteApi.Failure)conflict).status;
                    if(TrackingFailurePolicy.authenticationRejected(conflictStatus)){handle(conflict);return;}
                    if(conflictStatus==409){disable(false);error="توقف التسجيل؛ يوم العمل مرتبط بجهاز آخر. النقاط السابقة محفوظة للمراجعة";return;}
                }
                if(expected!=generation)return;
            }
        }
        // No delete/clear or automatic re-enrollment: exact queued records are retained.
        if(TrackingFailurePolicy.dataRejected(status))syncError="تعذر رفع بعض بيانات خط السير؛ النقاط محفوظة على الجهاز. "+message(failure);
    }
    private String message(Exception failure){String text=failure.getMessage();return text!=null&&text.matches(".*[\u0600-\u06ff].*")?text:"تعذر الاتصال بالخادم؛ النقاط محفوظة وستتم إعادة المحاولة";}
}

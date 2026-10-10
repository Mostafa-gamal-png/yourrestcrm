package org.yourrest.crm;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.UUID;

/** One trusted HTTPS origin. The raw interface is nonce-gated and never returns authentication material. */
public final class MainActivity extends Activity implements RouteTracker.Listener,NativeAppUpdater.Host {
    static volatile boolean resumed=false;
    private WebView web;
    private NativeSpeech speech;
    private NativeAppUpdater updater;
    private String pageNonce="";
    private ForegroundMapsHandoff mapsHandoff;
    private ValueCallback<Uri[]> files;
    private RouteTracker.Reply prepareReply;
    private boolean prepareContinuous,awaitingBackgroundSettings,requestingGeolocation,requestingTrackingPermissions;
    private final ArrayList<ForegroundGeolocation> pendingGeolocation=new ArrayList<>();
    private static final class ForegroundGeolocation {
        final String origin;final GeolocationPermissions.Callback callback;
        ForegroundGeolocation(String origin,GeolocationPermissions.Callback callback){this.origin=origin;this.callback=callback;}
    }
    private static final int PERMISSIONS=110,FILE_PICKER=111,BACKGROUND_LOCATION=112,GEOLOCATION=113;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        updater=NativeAppUpdater.get(this);updater.attach(this);
        speech=new NativeSpeech(this,new NativeSpeech.Host(){public String nonce(){return web!=null&&RouteRules.trusted(web.getUrl())?pageNonce:"";}public boolean foreground(){return resumed;}});
        FrameLayout container=new FrameLayout(this);web=new WebView(this);container.addView(web);setContentView(container);
        // Consume system insets outside the WebView so page controls do not sit behind Android system bars.
        container.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSafeBrowsingEnabled(true);settings.setGeolocationEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString()+" YourrestCRM-Android/1");
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.addJavascriptInterface(new Bridge(),"YourrestNativeChannel");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString();
                if(RouteRules.trusted(url))return false;
                if(MapsLauncher.canHandoff(view.getUrl(),request.isForMainFrame(),request.hasGesture(),resumed,pageNonce,url)){launchMaps(url);return true;}
                if(request.isForMainFrame()&&request.hasGesture())external(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,Bitmap icon){speech.invalidate();pageNonce="";mapsHandoff=null;if(!RouteRules.trusted(url)){view.stopLoading();return;}super.onPageStarted(view,url,icon);}
            @Override public void onPageFinished(WebView view,String url){
                if(RouteRules.trusted(url)&&RouteRules.trusted(view.getUrl())){pageNonce=UUID.randomUUID().toString();installBridge();CookieManager.getInstance().flush();}
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();String scheme=uri.getScheme();
                // Never allow arbitrary local or insecure resources. HTTPS tile/fonts/CDNs remain normal subresources.
                if("http".equals(scheme)||"file".equals(scheme))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                if(RouteRules.trusted(uri.toString())&&"/api/auth/logout".equals(uri.getPath())){runOnUiThread(()->speech.invalidate());RouteTracker.get(MainActivity.this).logout(null);}
                return super.shouldInterceptRequest(view,request);
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(!RouteRules.trusted(view.getUrl()))return false;
                if(files!=null)files.onReceiveValue(null);files=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/*","application/pdf","text/csv","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel"});
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                try{startActivityForResult(intent,FILE_PICKER);}catch(Exception failure){files.onReceiveValue(null);files=null;}
                return true;
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback){
                if(!RouteRules.trusted(origin)||!RouteRules.trusted(web.getUrl())){callback.invoke(origin,false,false);return;}
                requestForegroundGeolocation(origin,callback);
            }
        });
        web.setDownloadListener((url,userAgent,contentDisposition,mimeType,length)->{
            // Export links never forward the session cookie to another application.
            if(url.startsWith("https://"))new AlertDialog.Builder(this).setMessage("فتح رابط التنزيل في المتصفح؟ قد يطلب تسجيل الدخول.").setPositiveButton("فتح",(dialog,which)->external(Uri.parse(url))).setNegativeButton("إلغاء",null).show();
            else new AlertDialog.Builder(this).setMessage("لتنزيل الملف استخدم صفحة CRM في المتصفح.").setPositiveButton("حسنًا",null).show();
        });
        web.loadUrl(RouteRules.ORIGIN+"/");
    }
    private String external(Uri uri){
        if(MapsLauncher.destination(uri.toString())!=null)return launchMaps(uri.toString());
        String scheme=uri.getScheme();
        if(!"https".equals(scheme)&&!"tel".equals(scheme)&&!"geo".equals(scheme)&&!"mailto".equals(scheme))return "هذا النوع من الروابط غير مسموح";
        try{Intent intent=new Intent("tel".equals(scheme)?Intent.ACTION_DIAL:Intent.ACTION_VIEW,uri);intent.addCategory(Intent.CATEGORY_BROWSABLE);startActivity(intent);return null;}
        catch(android.content.ActivityNotFoundException unavailable){return "لا يوجد تطبيق خرائط أو متصفح لفتح الاتجاهات على الجهاز";}
        catch(Exception failure){return "تعذر فتح التطبيق الخارجي؛ حاول مرة أخرى";}
    }
    private String launchMaps(String url){
        String problem=MapsLauncher.launch(MapsLauncher.destination(url),(destination,packageName,browsable)->{
            Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse(destination));
            if(packageName!=null)intent.setPackage(packageName);
            if(browsable)intent.addCategory(Intent.CATEGORY_BROWSABLE);
            try{startActivity(intent);}catch(android.content.ActivityNotFoundException unavailable){throw new MapsLauncher.Unavailable();}
        });
        if(problem!=null)new AlertDialog.Builder(this).setTitle("تعذر فتح الاتجاهات").setMessage(problem).setPositiveButton("حسنًا",null).show();
        return problem;
    }
    private void installBridge(){
        String nonce=JSONObject.quote(pageNonce);
        JSONObject installed=updater.state();
        String script="(()=>{if(window!==window.top||location.origin!=="+JSONObject.quote(RouteRules.ORIGIN)+")return;const nonce="+nonce+";let seq=0;const pending=new Map();"
                +"window.__yourrestNativeComplete=(n,id,result,error)=>{if(n!==nonce)return;const entry=pending.get(id);if(!entry)return;pending.delete(id);clearTimeout(entry.timer);error?entry.reject(new Error(error)):entry.resolve(result);};"
                +"window.__yourrestNative={updateProtocol:1,installedVersionCode:"+installed.optLong("installedVersionCode",0)+",installedVersionName:"+JSONObject.quote(installed.optString("installedVersionName","unknown"))+",speechProtocol:1,speechSupported:"+speech.supported()+",request(method,payload={}){return new Promise((resolve,reject)=>{const id=String(++seq);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('انتهت مهلة الإجراء؛ حاول مرة أخرى'));},90000);pending.set(id,{resolve,reject,timer});YourrestNativeChannel.request(nonce,id,String(method),JSON.stringify(payload));});}};"
                +"window.dispatchEvent(new CustomEvent('yourrest:native-ready'));})();";
        web.evaluateJavascript(script,null);changed(RouteTracker.get(this).state());updater.resume();
    }
    private final class Bridge {
        @JavascriptInterface public void request(String nonce,String id,String method,String raw){
            if(raw==null||raw.length()>4096||id==null||id.length()>40)return;
            runOnUiThread(()->{
                if(pageNonce.isEmpty()||!pageNonce.equals(nonce)||!RouteRules.trusted(web.getUrl()))return;
                RouteTracker.Reply reply=(state,error)->respond(nonce,id,state,error);
                try{
                    JSONObject input=new JSONObject(raw);RouteTracker tracker=RouteTracker.get(MainActivity.this);
                    // Matching cancellation is allowed while Android's recognizer owns the foreground.
                    if("speechCancel".equals(method)){speech.cancel(input.optString("sessionId"),(result,error)->respond(nonce,id,result,error));return;}
                    if("logout".equals(method)||"refreshAccount".equals(method))speech.invalidate();
                    ForegroundMapsHandoff claimedHandoff=null;
                    ContinuousRouteTracker currentContinuous=ContinuousRouteTracker.get(MainActivity.this);
                    String member=input.optString("memberId");
                    JSONObject current=currentContinuous.state();
                    boolean handoffCurrent=mapsHandoff!=null&&currentContinuous.canResume()&&mapsHandoff.accepts(nonce,current.optString("memberId"),SystemClock.elapsedRealtime());
                    if("start".equals(method)&&handoffCurrent&&mapsHandoff.accepts(nonce,member,SystemClock.elapsedRealtime())&&RouteRules.identifier(input.optString("stopId"))){claimedHandoff=mapsHandoff;mapsHandoff=null;}
                    if(!resumed){
                        if("status".equals(method)&&handoffCurrent){reply.complete(tracker.state(),null);return;}
                        if(!"start".equals(method)||claimedHandoff==null){reply.complete(tracker.state(),"افتح التطبيق لمتابعة الإجراء ثم حاول مجددًا");return;}
                    }
                    switch(method){
                        case "updateStatus":reply.complete(updater.state(),null);break;
                        case "checkAppUpdate":updater.check();reply.complete(updater.state(),null);break;
                        case "downloadAppUpdate":updater.download();reply.complete(updater.state(),null);break;
                        case "installAppUpdate":updater.install();reply.complete(updater.state(),null);break;
                        case "speechStart":speech.start(input,(result,error)->respond(nonce,id,result,error));break;
                        case "prepare":prepare(reply,input.optBoolean("continuous",false));break;
                        case "enroll":tracker.enroll(input.optString("memberId"),reply);break;
                        case "refreshAccount":tracker.refreshAccount(input.optString("memberId"),reply);break;
                        case "start":if(claimedHandoff!=null)tracker.startAfterMaps(input.optString("memberId"),input.optString("stopId"),claimedHandoff,reply);else tracker.start(input.optString("memberId"),input.isNull("stopId")?null:input.optString("stopId"),reply);break;
                        case "status":reply.complete(tracker.state(),null);break;
                        case "flush":tracker.flush(reply);break;
                        case "stop":tracker.stop(reply);break;
                        case "logout":tracker.logout(reply);break;
                        case "openDirections":
                            if(!(input.opt("latitude") instanceof Number)||!(input.opt("longitude") instanceof Number))throw new IllegalArgumentException("لوكيشن العميل غير صالح");
                            MapsLauncher.Destination destination=MapsLauncher.coordinates(input.getDouble("latitude"),input.getDouble("longitude"));
                            String mapsProblem=launchMaps(destination==null?null:destination.https());
                            mapsHandoff=null;
                            ContinuousRouteTracker continuous=ContinuousRouteTracker.get(MainActivity.this);
                            if(mapsProblem==null&&destination!=null&&continuous.canResume()){String owner=continuous.state().optString("memberId");if(RouteRules.identifier(owner))mapsHandoff=new ForegroundMapsHandoff(nonce,owner,destination.latitude,destination.longitude,SystemClock.elapsedRealtime());}
                            reply.complete(tracker.state(),MapsLauncher.OPEN_FAILED.equals(mapsProblem)?"maps_launch_failed:"+mapsProblem:mapsProblem);
                            break;
                        case "directions":
                            try{
                                if(!(input.opt("latitude") instanceof Number)||!(input.opt("longitude") instanceof Number))throw new IllegalArgumentException("لوكيشن العميل غير صالح");
                                String url=tracker.directions(input.optString("memberId"),input.optString("stopId"),input.getDouble("latitude"),input.getDouble("longitude"));
                                String problem=launchMaps(url);
                                reply.complete(tracker.state(),MapsLauncher.OPEN_FAILED.equals(problem)?"maps_launch_failed:"+problem:problem);
                            }catch(IllegalArgumentException invalid){reply.complete(tracker.state(),invalid.getMessage());}
                            break;
                        default:reply.complete(tracker.state(),"إجراء غير معروف");
                    }
                }catch(Exception failure){reply.complete(RouteTracker.get(MainActivity.this).state(),"طلب غير صالح");}
            });
        }
    }
    private void respond(String nonce,String id,JSONObject state,String error){
        if(web==null||!nonce.equals(pageNonce)||!RouteRules.trusted(web.getUrl()))return;
        web.evaluateJavascript("window.__yourrestNativeComplete&&window.__yourrestNativeComplete("+JSONObject.quote(nonce)+","+JSONObject.quote(id)+","+state.toString()+","+(error==null?"null":JSONObject.quote(error))+")",null);
    }
    private void prepare(RouteTracker.Reply reply){prepare(reply,false);}
    private void prepare(RouteTracker.Reply reply,boolean continuous){
        if(prepareReply!=null){reply.complete(RouteTracker.get(this).state(),"راجع نافذة إذن الموقع المفتوحة");return;}
        prepareReply=reply;prepareContinuous=continuous;
        if(continuous&&!getSharedPreferences("native",0).getBoolean("continuousConsentV1",false)){
            new AlertDialog.Builder(this).setTitle("تسجيل الموقع في ساعات العمل")
                    .setMessage("بعد تفعيل التسجيل لحسابك، يجمع يورست موقع جهازك وخط السير والتوقفات من 6 صباحًا إلى 6 مساءً بتوقيت المملكة فقط، ما عدا يوم الجمعة، وعند قفل الشاشة أو عدم فتح التطبيق خلال هذه الفترة. يراها المشرف ومدير المبيعات حسب صلاحياتهم. يتوقف جمع الموقع خارج هذه الفترة ويُستأنف في يوم العمل التالي حسب سماح أندرويد، ويمكن استئنافه بعد إعادة تشغيل الجهاز. يظهر إشعار دائم من أندرويد، ويتطلب السماح بالموقع الدقيق طوال الوقت. تسجيل الخروج أو سحب الأذونات أو إيقاف التطبيق من أندرويد يوقف الجمع. بعد آخر تحقق ناجح من الحساب عبر الإنترنت، يمكن استئناف الجمع دون شبكة لمدة تصل إلى 7 أيام مع بقاء الأذونات والتفعيل. تُحفظ النقاط غير المرفوعة داخل التطبيق حتى يؤكد الخادم استلامها، ولا يحذفها تسجيل الخروج. عند امتلاء سعة الحفظ يتوقف قبول قراءات جديدة حتى تُرفع البيانات المحفوظة. لا يبدأ التسجيل قبل موافقتك وتفعيل حسابك.")
                    .setCancelable(false).setPositiveButton("موافق، إعداد تسجيل ساعات العمل",(dialog,which)->{getSharedPreferences("native",0).edit().putBoolean("continuousConsentV1",true).putBoolean("consent",true).apply();permissions();})
                    .setNegativeButton("ليس الآن",(dialog,which)->prepared("لم يبدأ التسجيل؛ يلزم الموافقة على تسجيل الموقع في ساعات العمل")).show();
        }else if(!continuous&&!getSharedPreferences("native",0).getBoolean("consent",false)){
            new AlertDialog.Builder(this).setTitle("تسجيل خط السير أثناء العمل")
                    .setMessage("عند بدء أول زيارة، يجمع يورست موقع جهازك حتى أثناء استخدام تطبيق آخر أو قفل الشاشة، لتسجيل التحرك والوصول والمغادرة وعرضها للمشرف ومدير المبيعات. يجمع الموقع من 6 صباحًا إلى 6 مساءً بتوقيت المملكة فقط، ما عدا يوم الجمعة، ويتوقف عند إنهاء يوم العمل أو تسجيل الخروج. يظهر إشعار أثناء التسجيل ويمكنك إنهاء اليوم منه. النقاط غير المرفوعة تحفظ داخل التطبيق وتُرفع عند الاتصال؛ لا يبدأ التسجيل قبل موافقتك.")
                    .setCancelable(false).setPositiveButton("موافق، إعداد الأذونات",(dialog,which)->{getSharedPreferences("native",0).edit().putBoolean("consent",true).apply();permissions();})
                    .setNegativeButton("ليس الآن",(dialog,which)->prepared("لم يبدأ تسجيل خط السير؛ يلزم الموافقة أولًا")).show();
        }else permissions();
    }
    private boolean foregroundLocationGranted(){return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
    /** Visit coordinates need foreground location only, not background enrollment or notifications. */
    private void requestForegroundGeolocation(String origin,GeolocationPermissions.Callback callback){
        if(foregroundLocationGranted()){callback.invoke(origin,true,false);return;}
        if(pendingGeolocation.size()>=8){callback.invoke(origin,false,false);return;}
        pendingGeolocation.add(new ForegroundGeolocation(origin,callback));
        if(requestingGeolocation||requestingTrackingPermissions)return;
        requestingGeolocation=true;
        try{requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.ACCESS_FINE_LOCATION},GEOLOCATION);}
        catch(RuntimeException denied){requestingGeolocation=false;completeForegroundGeolocation(false);}
    }
    private void completeForegroundGeolocation(boolean allowed){
        ArrayList<ForegroundGeolocation> pending=new ArrayList<>(pendingGeolocation);pendingGeolocation.clear();
        for(ForegroundGeolocation request:pending)request.callback.invoke(request.origin,allowed&&RouteRules.trusted(web==null?null:web.getUrl()),false);
    }
    private void permissions(){
        if(requestingGeolocation||requestingTrackingPermissions)return;
        ArrayList<String> required=new ArrayList<>();
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){required.add(Manifest.permission.ACCESS_COARSE_LOCATION);required.add(Manifest.permission.ACCESS_FINE_LOCATION);}
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)required.add(Manifest.permission.POST_NOTIFICATIONS);
        getSharedPreferences("native",0).edit().putBoolean("asked",true).apply();
        if(required.isEmpty())backgroundPermissions();else{requestingTrackingPermissions=true;try{requestPermissions(required.toArray(new String[0]),PERMISSIONS);}catch(RuntimeException denied){requestingTrackingPermissions=false;completeForegroundGeolocation(foregroundLocationGranted());prepared("تعذر عرض أذونات أندرويد؛ راجع إعدادات التطبيق ثم حاول مجددًا");}}
    }
    private void backgroundPermissions(){
        if(!prepareContinuous||ContinuousRouteTracker.backgroundGranted(this)){prepared(null);return;}
        getSharedPreferences("native",0).edit().putBoolean("backgroundAsked",true).apply();
        if(Build.VERSION.SDK_INT==29){requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION},BACKGROUND_LOCATION);return;}
        new AlertDialog.Builder(this).setTitle("السماح بالموقع طوال الوقت")
                .setMessage("في إعدادات يورست اختر الأذونات ← الموقع ← السماح طوال الوقت (Allow all the time)، مع تفعيل الموقع الدقيق. هذا ضروري لاستئناف التسجيل عند عدم فتح التطبيق وبعد إعادة تشغيل الجهاز.")
                .setCancelable(false).setPositiveButton("فتح إعدادات الموقع",(dialog,which)->{awaitingBackgroundSettings=true;try{startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));}catch(RuntimeException failure){awaitingBackgroundSettings=false;prepared("تعذر فتح الإعدادات؛ فعّل إذن الموقع طوال الوقت من إعدادات الجهاز");}})
                .setNegativeButton("ليس الآن",(dialog,which)->prepared("يلزم السماح بالموقع طوال الوقت لتفعيل التسجيل في ساعات العمل")).show();
    }
    private void prepared(String error){RouteTracker.Reply reply=prepareReply;prepareReply=null;prepareContinuous=false;if(reply!=null)reply.complete(RouteTracker.get(this).state(),error);changed(RouteTracker.get(this).state());}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){
        super.onRequestPermissionsResult(request,permissions,results);
        if(request==GEOLOCATION){requestingGeolocation=false;completeForegroundGeolocation(foregroundLocationGranted());if(prepareReply!=null)permissions();return;}
        if(request==BACKGROUND_LOCATION){prepared(ContinuousRouteTracker.backgroundGranted(this)?null:"يلزم السماح بالموقع طوال الوقت لتفعيل التسجيل في ساعات العمل");return;}
        if(request==PERMISSIONS){requestingTrackingPermissions=false;completeForegroundGeolocation(foregroundLocationGranted());boolean allowed=RouteTracker.get(this).permission();if(allowed)backgroundPermissions();else prepared("يلزم الموقع الدقيق وإذن الإشعارات لتسجيل خط السير");
            if(!allowed)new AlertDialog.Builder(this).setMessage("يمكن تفعيل الموقع الدقيق والإشعارات من إعدادات يورست، ثم بدء الزيارة مجددًا.").setPositiveButton("الإعدادات",(dialog,which)->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())))).setNegativeButton("إغلاق",null).show();}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(speech!=null&&speech.onResult(request,result,data))return;
        if(request==FILE_PICKER&&files!=null){ArrayList<Uri> selected=new ArrayList<>();
            if(result==RESULT_OK&&data!=null){if(data.getClipData()!=null){for(int i=0;i<Math.min(20,data.getClipData().getItemCount());i++){Uri uri=data.getClipData().getItemAt(i).getUri();if("content".equals(uri.getScheme()))selected.add(uri);}}
                else if(data.getData()!=null&&"content".equals(data.getData().getScheme()))selected.add(data.getData());}
            files.onReceiveValue(selected.isEmpty()?null:selected.toArray(new Uri[0]));files=null;
        }
    }
    @Override public void changed(JSONObject state){if(web!=null&&!pageNonce.isEmpty()&&RouteRules.trusted(web.getUrl()))web.evaluateJavascript("window.dispatchEvent(new CustomEvent('yourrest:native-state',{detail:"+state.toString()+"}))",null);}
    @Override public boolean foreground(){return resumed&&web!=null&&!pageNonce.isEmpty()&&RouteRules.trusted(web.getUrl());}
    @Override public void updateChanged(JSONObject state){if(web!=null&&!pageNonce.isEmpty()&&RouteRules.trusted(web.getUrl()))web.evaluateJavascript("window.dispatchEvent(new CustomEvent('yourrest:app-update',{detail:"+state.toString()+"}))",null);}
    @Override public void installPermission(){startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));}
    @Override public void confirmInstall(Intent intent){startActivity(intent);}
    @Override protected void onResume(){super.onResume();resumed=true;if(updater!=null){updater.attach(this);updater.resume();}ContinuousRouteTracker.get(this).resumeFromActivity();RouteTracker.get(this).addListener(this);RouteTracker.get(this).flush(null);if(awaitingBackgroundSettings){awaitingBackgroundSettings=false;prepared(ContinuousRouteTracker.backgroundGranted(this)&&RouteTracker.get(this).permission()?null:"لم يتم منح الموقع الدقيق طوال الوقت؛ فعّله من إعدادات التطبيق");}}
    @Override protected void onPause(){resumed=false;RouteTracker.get(this).removeListener(this);CookieManager.getInstance().flush();super.onPause();}
    @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(updater!=null)updater.detach(this);if(speech!=null)speech.invalidate();RouteTracker.get(this).removeListener(this);completeForegroundGeolocation(false);prepared("تم إغلاق نافذة التطبيق؛ افتحه ثم حاول مجددًا");if(files!=null)files.onReceiveValue(null);if(web!=null){pageNonce="";mapsHandoff=null;web.removeJavascriptInterface("YourrestNativeChannel");web.destroy();web=null;}super.onDestroy();}
}

package org.yourrest.crm;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
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
    private static final int PERMISSIONS=110,FILE_PICKER=111,BACKGROUND_LOCATION=112,GEOLOCATION=113,DESIGN_SAVE=114,CAMERA=115;
    /** 1.0.15 («no more white screen»): the WebView's frame, the main page's load as the watchdog sees it and the panel over a page that
     *  cannot be shown, the page the app opens (kept while an old engine or a lost WebView holds it back), whether the person chose to
     *  continue on an old engine, and when a renderer the system stopped was last recreated quietly. */
    private FrameLayout container;
    private final LoadWatch loadWatch=new LoadWatch();
    private LoadFailurePanel failurePanel;
    private final Handler watchdog=new Handler(Looper.getMainLooper());
    private final Runnable probeTick=this::probe;
    private String startUrl=RouteRules.ORIGIN+"/";
    private boolean engineAccepted;
    private long quietRecoveryAt=-1;
    /** 1.0.15: the photo the camera app is writing (its name kept across a recreated activity) and the camera-or-files question. */
    private File cameraPhoto;
    private AlertDialog sourceChoice;
    private static final String CAMERA_PHOTO="cameraPhoto";
    /** The one design file being fetched, opened or saved (null when none), its progress dialog, the question asked before opening one
     *  without a tap, the copy waiting for the save picker (kept across a recreated activity), and a finished fetch held until the app is
     *  in front again with the copy it holds. */
    private DesignFiles.Task designTask;
    private AlertDialog designProgress,designConfirm;
    private DesignFiles.Fetched designSave,designHeld;
    private Runnable designDelivery;
    private static final String SAVE_FOLDER="designSaveFolder",SAVE_NAME="designSaveName",SAVE_TYPE="designSaveType";
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        updater=NativeAppUpdater.get(this);updater.attach(this);
        DesignFiles.cleanup(getApplicationContext());
        // A save picker that was open when Android recreated the activity (dark mode, language, split screen, or the process ended) finds
        // its copy again; its answer arrives after this.
        if(saved!=null)designSave=DesignFiles.restore(getApplicationContext(),saved.getString(SAVE_FOLDER),saved.getString(SAVE_NAME),saved.getString(SAVE_TYPE));
        speech=new NativeSpeech(this,new NativeSpeech.Host(){public String nonce(){return web!=null&&RouteRules.trusted(web.getUrl())?pageNonce:"";}public boolean foreground(){return resumed;}});
        container=new FrameLayout(this);setContentView(container);
        // Consume system insets outside the WebView so page controls do not sit behind Android system bars.
        container.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
        failurePanel=new LoadFailurePanel(this,container,new LoadFailurePanel.Actions(){
            @Override public void retry(){retryLoad();}
            @Override public void continueAnyway(){engineAccepted=true;openStart();}
        });
        // 1.0.15: camera photos older than a day go; a photo the camera was writing when Android recreated the activity is found again.
        CameraPhotoProvider.cleanup(getApplicationContext());
        if(saved!=null&&CameraPhotoRules.validName(saved.getString(CAMERA_PHOTO)))cameraPhoto=new File(CameraPhotoProvider.root(getApplicationContext()),saved.getString(CAMERA_PHOTO));
        String requested=requestedCase(getIntent()),nearby=NearbyCustomers.requestedCustomer(getIntent()),complaint=ComplaintAlerts.requestedComplaint(getIntent());
        // 1.0.14: a tapped «شكوى تنتظرك» opens the page on that complaint («#complaint=<id>»).
        startUrl=RouteRules.ORIGIN+"/"+(requested!=null?"#service-case="+requested:complaint!=null?ComplaintAlertRules.complaintFragment(complaint):nearby!=null?NearbyRules.openFragment(nearby):"");
        getIntent().removeExtra(ServiceAlerts.EXTRA_CASE);getIntent().removeExtra(NearbyCustomers.EXTRA);getIntent().removeExtra(ComplaintAlerts.EXTRA);
        if(createWebView())openStart();
    }
    /** The WebView with its settings, clients, bridge and download listener, under the failure panel: made when the app opens and again
     *  after its renderer was lost (1.0.15). False, with the panel, when this device cannot make a WebView (no engine, or one disabled). */
    private boolean createWebView(){
        try{web=new WebView(this);}
        catch(RuntimeException unavailable){web=null;Throwable cause=unavailable.getCause()!=null?unavailable.getCause():unavailable;showFailure(LoadFailureRules.Failure.unavailable(cause.getClass().getSimpleName()));return false;}
        container.addView(web,0);
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
                // «عرض» of a design file: fetched natively with the session; the page stays where it is.
                if(request.isForMainFrame()&&DesignFileRules.fetchUrl(url)!=null&&RouteRules.trusted(view.getUrl())){openDesignFile(url,true,request.hasGesture());return true;}
                // 1.0.15: a page of the CRM is about to load in the main frame: the watchdog watches it from now (a page under a hard
                // failure's panel keeps the panel).
                if(request.isForMainFrame()&&view==web&&RouteRules.trusted(url)&&loadWatch.pageStarted(SystemClock.elapsedRealtime()))watch();
                if(RouteRules.trusted(url))return false;
                if(MapsLauncher.canHandoff(view.getUrl(),request.isForMainFrame(),request.hasGesture(),resumed,pageNonce,url)){launchMaps(url);return true;}
                if(request.isForMainFrame()&&request.hasGesture())external(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,Bitmap icon){speech.invalidate();pageNonce="";mapsHandoff=null;if(!RouteRules.trusted(url)){view.stopLoading();return;}super.onPageStarted(view,url,icon);
                // 1.0.15: a page of the CRM starts and the watchdog watches it; WebView's own error page after a failure keeps the panel.
                if(view==web&&loadWatch.pageStarted(SystemClock.elapsedRealtime())){if(failurePanel.kind()==LoadFailureRules.Kind.NOT_STARTED)failurePanel.hide();watch();}
            }
            @Override public void onPageFinished(WebView view,String url){
                if(view==web)loadWatch.pageFinished(SystemClock.elapsedRealtime());
                // A page under the failure panel (WebView's error page, a server error) gets no bridge and teaches nothing of the language.
                if(RouteRules.trusted(url)&&RouteRules.trusted(view.getUrl())&&!loadWatch.hardFailure()){pageNonce=UUID.randomUUID().toString();installBridge();CookieManager.getInstance().flush();rememberLanguage();if(AlertCheckJob.signedIn())AlertCheckJob.schedule(MainActivity.this);}
                if(view==web)watch();
            }
            // 1.0.15: the main page that failed is never left as a blank page; the panel says why (LoadFailureRules).
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){
                String url=request.getUrl().toString();
                if(view==web&&LoadFailureRules.mainFrameFailure(request.isForMainFrame(),url))failed(LoadFailureRules.Failure.web(error.getErrorCode(),error.getDescription(),url));
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){
                String url=request.getUrl().toString();
                if(view==web&&LoadFailureRules.mainFrameFailure(request.isForMainFrame(),url))failed(LoadFailureRules.Failure.http(response.getStatusCode(),response.getReasonPhrase(),online(),url));
            }
            // The handshake is refused as always (never allowed through); on the CRM's own page that is not up yet the panel names the
            // usual cause, the device's date and time.
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();
                if(view==web&&LoadFailureRules.sslCoversPage(error.getUrl(),loadWatch.up()))failed(LoadFailureRules.Failure.ssl(error.getPrimaryError(),certificateValidity(error),error.getUrl()));
            }
            // A renderer that crashed or that the system stopped never takes the app down: the WebView goes and is made again.
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){rendererGone(view,detail.didCrash());return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();String scheme=uri.getScheme();
                // Never allow arbitrary local or insecure resources. HTTPS tile/fonts/CDNs remain normal subresources.
                if("http".equals(scheme)||"file".equals(scheme))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                if(RouteRules.trusted(uri.toString())&&"/api/auth/logout".equals(uri.getPath())){runOnUiThread(()->speech.invalidate());ComplaintAlerts.get(MainActivity.this).logout();AlertCheckJob.cancel(MainActivity.this);RouteTracker.get(MainActivity.this).logout(null);}
                return super.shouldInterceptRequest(view,request);
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(!RouteRules.trusted(view.getUrl()))return false;
                if(files!=null)files.onReceiveValue(null);files=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                // The page's accept list; a type the picker cannot filter by (a drawing such as DWG or STEP) opens every file.
                String[] types=FileChooserRules.mimeTypes(params.getAcceptTypes());
                if(types!=null)intent.putExtra(Intent.EXTRA_MIME_TYPES,types);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                // 1.0.15: an input that takes a JPEG («صور القالب», a competitor's quotation, the design files) also offers the camera;
                // with capture it opens at once. The gallery keeps its multiple selection; the camera gives one photo.
                CameraPhotoRules.Offer camera=CameraPhotoRules.offer(params.getAcceptTypes(),params.isCaptureEnabled());
                if(camera==CameraPhotoRules.Offer.CAMERA)takePhoto(intent);
                else if(camera==CameraPhotoRules.Offer.CHOICE)chooseSource(intent);
                else openPicker(intent);
                return true;
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback){
                if(!RouteRules.trusted(origin)||!RouteRules.trusted(web.getUrl())){callback.invoke(origin,false,false);return;}
                requestForegroundGeolocation(origin,callback);
            }
        });
        web.setDownloadListener((url,userAgent,contentDisposition,mimeType,length)->{
            // «تنزيل» of a design file is fetched natively with the session and saved where the person picks.
            if(DesignFileRules.fetchUrl(url)!=null&&web!=null&&RouteRules.trusted(web.getUrl())){openDesignFile(url,false,false);return;}
            // Export links never forward the session cookie to another application.
            if(url.startsWith("https://"))new AlertDialog.Builder(this).setMessage("فتح رابط التنزيل في المتصفح؟ قد يطلب تسجيل الدخول.").setPositiveButton("فتح",(dialog,which)->external(Uri.parse(url))).setNegativeButton("إلغاء",null).show();
            else new AlertDialog.Builder(this).setMessage("لتنزيل الملف استخدم صفحة CRM في المتصفح.").setPositiveButton("حسنًا",null).show();
        });
        return true;
    }
    /** The language the person chose in the CRM page (its own localStorage «yr-language»), for the notices the app words itself. */
    private void rememberLanguage(){
        if(web==null||!RouteRules.trusted(web.getUrl()))return;
        if(loadWatch.hardFailure())return;
        web.evaluateJavascript("(()=>{try{return localStorage.getItem('yr-language')}catch(e){return null}})()",value->{
            String language=NearbyRules.pageLanguage(value);
            if(language!=null)getSharedPreferences("native",0).edit().putString("language",language).apply();
        });
    }
    /** A tapped notification names a request; only the app's own action and a plain identifier are accepted. */
    private String requestedCase(Intent intent){
        if(intent==null||!ServiceAlerts.OPEN.equals(intent.getAction()))return null;
        String id=intent.getStringExtra(ServiceAlerts.EXTRA_CASE);
        return RouteRules.identifier(id)?id:null;
    }
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);setIntent(intent);
        String id=requestedCase(intent);intent.removeExtra(ServiceAlerts.EXTRA_CASE);
        String nearby=NearbyCustomers.requestedCustomer(intent);intent.removeExtra(NearbyCustomers.EXTRA);
        String complaint=ComplaintAlerts.requestedComplaint(intent);intent.removeExtra(ComplaintAlerts.EXTRA);
        // A running page is told directly (it never replaces unsaved work); a page that is not ready loads with the request in its address.
        // 1.0.15: without a WebView (its renderer lost) one is made again; behind an old engine's panel the page waits for the panel's button.
        boolean ready=web!=null&&!pageNonce.isEmpty()&&RouteRules.trusted(web.getUrl());
        if(id!=null){
            if(ready)web.evaluateJavascript("window.dispatchEvent(new CustomEvent('yourrest:open-service-case',{detail:{id:"+JSONObject.quote(id)+"}}))",null);
            else openRequested(RouteRules.ORIGIN+"/?notification="+System.currentTimeMillis()+"#service-case="+id);
        }else if(complaint!=null){
            // «شكوى تنتظرك» (1.0.14): the page opens the complaint where the member meets complaints, the same way.
            if(ready)web.evaluateJavascript("window.dispatchEvent(new CustomEvent('yourrest:open-complaint',{detail:{id:"+JSONObject.quote(complaint)+"}}))",null);
            else openRequested(RouteRules.ORIGIN+"/?notification="+System.currentTimeMillis()+ComplaintAlertRules.complaintFragment(complaint));
        }else if(nearby!=null){
            // «تنبيه المصانع القريبة»: the page opens «خريطة المصانع» on the nearest customer it names, the same way.
            if(ready)web.evaluateJavascript("window.dispatchEvent(new CustomEvent('yourrest:open-nearby-customer',{detail:{id:"+JSONObject.quote(nearby)+"}}))",null);
            else openRequested(RouteRules.ORIGIN+"/?notification="+System.currentTimeMillis()+NearbyRules.openFragment(nearby));
        }
    }
    // ---- 1.0.15: the main page, its watchdog and the panel over a page that cannot be shown.
    /** Opens the page the app starts on (a notification's page included), unless the engine is older than the site is built for: then the
     *  panel says so at once and names the engine, and the page waits for «المتابعة رغم ذلك». */
    private void openStart(){
        if(!engineAccepted){
            LoadFailureRules.Facts facts=LoadFailurePanel.facts(this,web,null);
            if(LoadFailureRules.outdated(facts.chromium)){showFailure(LoadFailureRules.Failure.outdated(facts.chromium));return;}
        }
        loadMain(startUrl);
    }
    /** A notification's page while the CRM's page is not ready: loaded now (a lost WebView is made again), or kept for the panel's button
     *  while an old or missing engine holds the app back. */
    private void openRequested(String url){
        startUrl=url;
        LoadFailureRules.Kind kind=failurePanel.kind();
        if(kind==LoadFailureRules.Kind.OUTDATED||kind==LoadFailureRules.Kind.UNAVAILABLE)return;
        loadMain(url);
    }
    /** Every page the app loads itself goes through here: a new attempt for the watchdog, the panel away, the probe started. */
    private void loadMain(String url){
        if(web==null&&!createWebView())return;
        loadWatch.restart(SystemClock.elapsedRealtime());failurePanel.hide();
        web.loadUrl(url);watch();
    }
    /** «إعادة المحاولة»: the page that failed again (LoadFailureRules.retryUrl), with a new WebView after a lost renderer; for an old or
     *  missing engine, the check again. */
    private void retryLoad(){
        LoadFailureRules.Kind kind=failurePanel.kind();
        if(kind==LoadFailureRules.Kind.OUTDATED||kind==LoadFailureRules.Kind.UNAVAILABLE){failurePanel.hide();if(web!=null||createWebView())openStart();return;}
        LoadFailureRules.Failure failure=loadWatch.failure();
        loadMain(LoadFailureRules.retryUrl(failure!=null&&failure.url!=null?failure.url:startUrl));
    }
    /** A failure from one of WebView's callbacks: the panel shows the first hard one of the attempt, and the page under it gets no bridge. */
    private void failed(LoadFailureRules.Failure failure){
        if(!loadWatch.fail(failure,SystemClock.elapsedRealtime()))return;
        pageNonce="";mapsHandoff=null;watchdog.removeCallbacks(probeTick);
        showFailure(loadWatch.failure());
    }
    private void showFailure(LoadFailureRules.Failure failure){
        if(failure==null||isFinishing())return;
        boolean english=english();
        LoadFailureRules.Facts facts=LoadFailurePanel.facts(this,web,web==null?null:web.getUrl());
        String extra=failure.kind==LoadFailureRules.Kind.OUTDATED?LoadFailureRules.engineLine(facts.webViewPackage,facts.webViewVersion,facts.chromium,english):null;
        failurePanel.show(failure.kind,english,LoadFailureRules.title(failure.kind,english),LoadFailureRules.message(failure.kind,english),extra,LoadFailureRules.details(facts,failure),failure.kind==LoadFailureRules.Kind.OUTDATED);
    }
    /** The language the person chose in the CRM page (remembered by rememberLanguage), Arabic until a page told otherwise. */
    private boolean english(){return NearbyRules.english(getSharedPreferences("native",0).getString("language","ar"));}
    /** Asks the page every second, while the watchdog still watches and the app is in front, whether it shows anything
     *  (LoadFailureRules.PROBE). The next ask is set before this one is answered, so a page too broken to answer still meets the deadline. */
    private void watch(){watchdog.removeCallbacks(probeTick);if(web!=null&&resumed&&loadWatch.watching(SystemClock.elapsedRealtime()))watchdog.postDelayed(probeTick,LoadFailureRules.PROBE_INTERVAL_MS);}
    private void probe(){
        long now=SystemClock.elapsedRealtime();
        if(web==null||!resumed||!loadWatch.watching(now))return;
        watchdog.postDelayed(probeTick,LoadFailureRules.PROBE_INTERVAL_MS);
        decide(now,null);
        if(web==null||!RouteRules.trusted(web.getUrl()))return;
        final long attempt=loadWatch.attempt();
        web.evaluateJavascript(LoadFailureRules.PROBE,value->{if(web!=null&&loadWatch.attempt()==attempt)decide(SystemClock.elapsedRealtime(),LoadFailureRules.probe(value));});
    }
    private void decide(long now,LoadFailureRules.Probe answer){
        LoadFailureRules.Verdict verdict=loadWatch.probed(now,answer,resumed,web==null?null:web.getUrl());
        if(verdict==LoadFailureRules.Verdict.READY&&failurePanel.kind()==LoadFailureRules.Kind.NOT_STARTED)failurePanel.hide();
        else if(verdict==LoadFailureRules.Verdict.NOT_STARTED)showFailure(loadWatch.failure());
    }
    /** Whether Android has a network with internet: a server error while offline is worded as no connection (a service worker with nothing
     *  cached answers 503). */
    private boolean online(){
        try{
            ConnectivityManager connectivity=getSystemService(ConnectivityManager.class);
            Network network=connectivity==null?null:connectivity.getActiveNetwork();
            NetworkCapabilities capabilities=network==null?null:connectivity.getNetworkCapabilities(network);
            return capabilities!=null&&capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        }catch(RuntimeException unknown){return true;}
    }
    private static String certificateValidity(SslError error){
        SslCertificate certificate=error.getCertificate();
        return certificate==null?null:LoadFailureRules.validity(certificate.getValidNotBeforeDate(),certificate.getValidNotAfterDate());
    }
    /** The page's renderer is gone (it crashed, or the system stopped it for memory): that WebView cannot be used again, so it goes with
     *  what was waiting on it. A system stop is recovered quietly (a new WebView on the same page), a crash or a second stop within a minute
     *  shows the panel, whose «إعادة المحاولة» makes a new WebView. The app itself never crashes for it. */
    private void rendererGone(WebView view,boolean crashed){
        String page=null;
        try{page=view.getUrl();}catch(RuntimeException ignored){page=null;}
        if(view!=web){try{view.destroy();}catch(RuntimeException ignored){}return;}
        dropWebView();
        long now=SystemClock.elapsedRealtime();
        String target=LoadFailureRules.retryUrl(RouteRules.trusted(page)?page:startUrl);
        if(LoadFailureRules.quietRecovery(crashed,quietRecoveryAt<0?Long.MAX_VALUE:now-quietRecoveryAt)){quietRecoveryAt=now;loadMain(target);return;}
        loadWatch.restart(now);loadWatch.fail(LoadFailureRules.Failure.renderer(crashed,target),now);
        showFailure(loadWatch.failure());
    }
    private void dropWebView(){
        WebView gone=web;web=null;
        watchdog.removeCallbacks(probeTick);pageNonce="";mapsHandoff=null;
        if(speech!=null)speech.invalidate();
        if(files!=null){try{files.onReceiveValue(null);}catch(RuntimeException ignored){}files=null;}
        if(sourceChoice!=null){sourceChoice.dismiss();sourceChoice=null;}
        // A design file still being fetched would wait for a page that is gone: it stops (a copy waiting for the save picker is kept).
        if(designConfirm!=null){designConfirm.dismiss();designConfirm=null;}
        if(designTask!=null&&designSave==null){designTask.cancel();designFinished(designTask);}
        completeForegroundGeolocation(false);
        if(gone==null)return;
        container.removeView(gone);
        try{gone.removeJavascriptInterface("YourrestNativeChannel");gone.destroy();}catch(RuntimeException ignored){}
    }
    // ---- 1.0.15: the camera beside the file picker.
    /** Android's document picker for the page's file input (the gallery and the files, several at once where the input allows it). */
    private void openPicker(Intent picker){
        if(files==null)return;
        try{startActivityForResult(picker,FILE_PICKER);}catch(Exception failure){files.onReceiveValue(null);files=null;}
    }
    /** An input that takes a photo: the camera or the files, in one question. Backing out of it gives the page no file. */
    private void chooseSource(Intent picker){
        boolean english=english();
        if(sourceChoice!=null)sourceChoice.dismiss();
        sourceChoice=new AlertDialog.Builder(this).setTitle(CameraPhotoRules.chooserTitle(english))
                .setItems(new CharSequence[]{CameraPhotoRules.takePhoto(english),CameraPhotoRules.chooseFiles(english)},(dialog,which)->{sourceChoice=null;if(which==0)takePhoto(picker);else openPicker(picker);})
                .setOnCancelListener(dialog->{sourceChoice=null;if(files!=null){files.onReceiveValue(null);files=null;}}).show();
    }
    /** Android's camera app takes the photo (ACTION_IMAGE_CAPTURE) into a new empty file of the app's cache, reached through the app's own
     *  provider with a grant to write that one file. No CAMERA permission is declared, so the camera app needs none from this app. No
     *  camera app, or no file: the files instead, with a word. */
    private void takePhoto(Intent picker){
        if(files==null)return;
        boolean english=english();
        File photo=CameraPhotoProvider.create(getApplicationContext());
        if(photo==null){Toast.makeText(this,CameraPhotoRules.photoFailed(english),Toast.LENGTH_LONG).show();openPicker(picker);return;}
        Uri uri=CameraPhotoProvider.uri(photo);
        Intent capture=new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,uri).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_READ_URI_PERMISSION);
        capture.setClipData(ClipData.newRawUri("",uri));
        if(cameraPhoto!=null)CameraPhotoProvider.remove(cameraPhoto);
        cameraPhoto=photo;
        try{startActivityForResult(capture,CAMERA);}
        catch(RuntimeException unavailable){cameraPhoto=null;CameraPhotoProvider.remove(photo);Toast.makeText(this,CameraPhotoRules.noCamera(english),Toast.LENGTH_LONG).show();openPicker(picker);}
    }
    /** The camera's answer: its grant to the file is taken back first, then the photo goes to the page when the camera wrote one; otherwise
     *  the page gets nothing and the file goes. A page that is gone (the activity was recreated meanwhile) gets nothing either. */
    private void photoTaken(int result){
        File photo=cameraPhoto;cameraPhoto=null;
        ValueCallback<Uri[]> callback=files;files=null;
        if(photo==null){if(callback!=null)callback.onReceiveValue(null);return;}
        Uri uri=CameraPhotoProvider.uri(photo);
        try{revokeUriPermission(uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(RuntimeException ignored){}
        boolean taken=CameraPhotoRules.delivered(result,photo.length());
        if(taken&&callback!=null){callback.onReceiveValue(new Uri[]{uri});return;}
        CameraPhotoProvider.remove(photo);
        if(callback!=null)callback.onReceiveValue(null);
        if(!taken&&result==RESULT_OK)Toast.makeText(this,CameraPhotoRules.photoFailed(english()),Toast.LENGTH_LONG).show();
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
    /** A design-file link: fetched from the CRM with the WebView session (never handed to the browser or the DownloadManager), then
     *  opened in another app («عرض») or saved through the system picker («تنزيل»). One at a time. */
    private void openDesignFile(String url,boolean navigation,boolean gesture){
        String target=DesignFileRules.fetchUrl(url);
        if(target==null||web==null)return;
        if(designTask!=null){Toast.makeText(this,"يجري تنزيل ملف آخر؛ انتظر حتى يكتمل",Toast.LENGTH_SHORT).show();return;}
        boolean view=DesignFileRules.view(navigation,target);
        // Another app receives a file only after a tap: «عرض» reached without one (a script or a redirect) asks first, one question at a time.
        if(DesignFileRules.confirmView(view,gesture)){
            if(designConfirm!=null&&designConfirm.isShowing())return;
            designConfirm=new AlertDialog.Builder(this).setTitle("فتح ملف التصميم").setMessage("فتح الملف في تطبيق آخر على الجهاز؟")
                    .setPositiveButton("فتح",(dialog,which)->{designConfirm=null;if(web!=null&&RouteRules.trusted(web.getUrl()))startDesignFile(target,true);})
                    .setNegativeButton("إلغاء",(dialog,which)->designConfirm=null).show();
            return;
        }
        startDesignFile(target,view);
    }
    private void startDesignFile(String target,boolean view){
        if(designTask!=null){Toast.makeText(this,"يجري تنزيل ملف آخر؛ انتظر حتى يكتمل",Toast.LENGTH_SHORT).show();return;}
        final DesignFiles.Task task=new DesignFiles.Task(target,view);
        designTask=task;
        designProgress=new AlertDialog.Builder(this).setMessage("جارٍ تنزيل الملف…").setCancelable(false)
                .setNegativeButton("إلغاء",(dialog,which)->{task.cancel();designFinished(task);}).show();
        DesignFiles.fetch(getApplicationContext(),task,web.getSettings().getUserAgentString(),(fetched,error)->runOnUiThread(()->designFetched(task,fetched,error)));
    }
    private void designFetched(DesignFiles.Task task,DesignFiles.Fetched fetched,String error){
        if(task!=designTask||web==null){DesignFiles.discard(fetched);return;}
        if(designProgress!=null){designProgress.dismiss();designProgress=null;}
        // Another app is opened only while Yourrest is in front; a file that arrives meanwhile waits for the person to return.
        if(!MainActivity.resumed){designHeld=fetched;designDelivery=()->designFetched(task,fetched,error);return;}
        if(fetched==null){designFinished(task);designAlert("تعذّر تنزيل الملف",error==null?DesignFileRules.FAILED:error);return;}
        if(!task.view){saveDesignFile(task,fetched);return;}
        Intent open=new Intent(Intent.ACTION_VIEW).setDataAndType(DesignFiles.uri(fetched),fetched.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try{startActivity(open);designFinished(task);}
        catch(android.content.ActivityNotFoundException none){
            new AlertDialog.Builder(this).setTitle("لا يوجد تطبيق لفتح الملف").setMessage("لا يوجد على الجهاز تطبيق يفتح هذا النوع من الملفات. احفظ الملف ثم افتحه من تطبيق مناسب.").setCancelable(false)
                    .setPositiveButton("حفظ",(dialog,which)->saveDesignFile(task,fetched))
                    .setNegativeButton("إغلاق",(dialog,which)->{DesignFiles.discard(fetched);designFinished(task);}).show();
        }
        catch(RuntimeException failure){DesignFiles.discard(fetched);designFinished(task);designAlert("تعذّر فتح الملف","تعذّر فتح الملف؛ حاول مرة أخرى");}
    }
    /** Storage Access Framework: the person picks the place and name; no storage permission on any Android version. */
    private void saveDesignFile(DesignFiles.Task task,DesignFiles.Fetched fetched){
        if(task!=designTask){DesignFiles.discard(fetched);return;}
        Intent create=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(fetched.mime).putExtra(Intent.EXTRA_TITLE,fetched.name);
        designSave=fetched;
        try{startActivityForResult(create,DESIGN_SAVE);}
        catch(RuntimeException unavailable){designSave=null;DesignFiles.discard(fetched);designFinished(task);designAlert("تعذّر حفظ الملف","تعذّر فتح نافذة الحفظ على الجهاز");}
    }
    private void designSaved(int result,Intent data){
        DesignFiles.Fetched fetched=designSave;designSave=null;
        final DesignFiles.Task task=designTask;
        Uri target=result==RESULT_OK&&data!=null?data.getData():null;
        // Cancelling the picker saves nothing.
        if(target==null||!"content".equals(target.getScheme())){DesignFiles.discard(fetched);designFinished(task);return;}
        // The copy was lost while the picker was open: the empty document it created goes, and the person is told.
        if(fetched==null){designFinished(task);DesignFiles.abandon(getApplicationContext(),target,()->runOnUiThread(()->designAlert("تعذّر حفظ الملف",DesignFiles.SAVE_LOST)));return;}
        DesignFiles.save(getApplicationContext(),fetched,target,error->runOnUiThread(()->{
            designFinished(task);
            if(web==null)return;
            if(error==null)Toast.makeText(this,"تم حفظ الملف",Toast.LENGTH_SHORT).show();
            else designAlert("تعذّر حفظ الملف",error);
        }));
    }
    private void designFinished(DesignFiles.Task task){
        if(task!=designTask)return;
        designTask=null;designDelivery=null;
        // A fetched file still waiting for the person to come back is not opened any more: its copy goes now, not a day later.
        DesignFiles.discard(designHeld);designHeld=null;
        if(designProgress!=null){designProgress.dismiss();designProgress=null;}
    }
    private void designAlert(String title,String message){if(web!=null&&!isFinishing())new AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("حسنًا",null).show();}
    private void installBridge(){
        String nonce=JSONObject.quote(pageNonce);
        JSONObject installed=updater.state();
        String script="(()=>{if(window!==window.top||location.origin!=="+JSONObject.quote(RouteRules.ORIGIN)+")return;const nonce="+nonce+";let seq=0;const pending=new Map();"
                +"window.__yourrestNativeComplete=(n,id,result,error)=>{if(n!==nonce)return;const entry=pending.get(id);if(!entry)return;pending.delete(id);clearTimeout(entry.timer);error?entry.reject(new Error(error)):entry.resolve(result);};"
                +"window.__yourrestNative={updateProtocol:1,installedVersionCode:"+installed.optLong("installedVersionCode",0)+",installedVersionName:"+JSONObject.quote(installed.optString("installedVersionName","unknown"))+",speechProtocol:1,speechSupported:"+speech.supported()+",request(method,payload={}){return new Promise((resolve,reject)=>{const id=String(++seq);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('انتهت مهلة الإجراء؛ حاول مرة أخرى'));},90000);pending.set(id,{resolve,reject,timer});YourrestNativeChannel.request(nonce,id,String(method),JSON.stringify(payload));});}};"
                // A design file's «تنزيل» link (<a download>) is handed to the app on the tap itself, once per document.
                +"if(!window.__yourrestDesignFiles){window.__yourrestDesignFiles=true;document.addEventListener('click',event=>{"
                +"if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!(event.target instanceof Element))return;"
                +"const link=event.target.closest('a[download][href]');if(!link)return;let url;try{url=new URL(link.href);}catch(_){return;}"
                +"if(url.origin!=="+JSONObject.quote(RouteRules.ORIGIN)+"||url.pathname!=="+JSONObject.quote(DesignFileRules.PATH)+"||url.search.length<2||url.href.length>3000||!window.__yourrestNative)return;"
                +"event.preventDefault();window.__yourrestNative.request('designFile',{href:url.href}).catch(()=>{});},true);}"
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
                        case "designFile":
                            // «تنزيل» tapped in the page: fetched natively at once (progress, the CRM's error words, one request), instead of the
                            // WebView's own download, which drops a failed answer without a word.
                            if(DesignFileRules.fetchUrl(input.optString("href"))==null){reply.complete(tracker.state(),"رابط الملف غير صالح");break;}
                            openDesignFile(input.optString("href"),false,false);reply.complete(tracker.state(),null);break;
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
                        case "logout":ComplaintAlerts.get(MainActivity.this).logout();AlertCheckJob.cancel(MainActivity.this);tracker.logout(reply);break;
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
        if(request==DESIGN_SAVE){designSaved(result,data);return;}
        if(request==CAMERA){photoTaken(result);return;}
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
    @Override protected void onResume(){super.onResume();resumed=true;ServiceAlerts.poll(this,true);ComplaintAlerts.get(this).pollNow();AlertCheckJob.schedule(this);if(updater!=null){updater.attach(this);updater.resume();}ContinuousRouteTracker.get(this).resumeFromActivity();RouteTracker.get(this).addListener(this);RouteTracker.get(this).flush(null);if(awaitingBackgroundSettings){awaitingBackgroundSettings=false;prepared(ContinuousRouteTracker.backgroundGranted(this)&&RouteTracker.get(this).permission()?null:"لم يتم منح الموقع الدقيق طوال الوقت؛ فعّله من إعدادات التطبيق");}
        if(designDelivery!=null){Runnable delivery=designDelivery;designDelivery=null;designHeld=null;delivery.run();}
        watch();}
    @Override protected void onSaveInstanceState(Bundle out){
        super.onSaveInstanceState(out);
        if(designSave!=null){out.putString(SAVE_FOLDER,designSave.file.getParentFile().getName());out.putString(SAVE_NAME,designSave.file.getName());out.putString(SAVE_TYPE,designSave.mime);}
        if(cameraPhoto!=null)out.putString(CAMERA_PHOTO,cameraPhoto.getName());
    }
    @Override protected void onPause(){rememberLanguage();watchdog.removeCallbacks(probeTick);resumed=false;RouteTracker.get(this).removeListener(this);CookieManager.getInstance().flush();super.onPause();}
    @Override public void onBackPressed(){
        if(web!=null&&web.canGoBack()){
            // 1.0.15: back from a page under the panel goes to the page before it, watched afresh.
            if(failurePanel.showing()){loadWatch.restart(SystemClock.elapsedRealtime());failurePanel.hide();}
            web.goBack();watch();
        }else super.onBackPressed();
    }
    /** The save picker's copy is dropped only when the app is really closing; when Android recreates the activity the next one takes it
     *  back (onSaveInstanceState), and otherwise the day-old cleanup removes it. */
    @Override protected void onDestroy(){watchdog.removeCallbacksAndMessages(null);if(sourceChoice!=null){sourceChoice.dismiss();sourceChoice=null;}if(isFinishing()&&cameraPhoto!=null){CameraPhotoProvider.remove(cameraPhoto);cameraPhoto=null;}if(updater!=null)updater.detach(this);if(speech!=null)speech.invalidate();RouteTracker.get(this).removeListener(this);completeForegroundGeolocation(false);prepared("تم إغلاق نافذة التطبيق؛ افتحه ثم حاول مجددًا");if(files!=null)files.onReceiveValue(null);if(designTask!=null){designTask.cancel();designFinished(designTask);}if(designConfirm!=null){designConfirm.dismiss();designConfirm=null;}if(isFinishing())DesignFiles.discard(designSave);designSave=null;if(web!=null){pageNonce="";mapsHandoff=null;web.removeJavascriptInterface("YourrestNativeChannel");web.destroy();web=null;}super.onDestroy();}
}

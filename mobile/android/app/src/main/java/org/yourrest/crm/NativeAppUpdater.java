package org.yourrest.crm;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/** Only fixed-origin, newer, same-package/same-signature APKs can reach Android's confirmation UI.
 * No route database, cookies, session preferences or outbox are touched by this class. */
final class NativeAppUpdater {
    interface Host {boolean foreground();void updateChanged(JSONObject state);void installPermission();void confirmInstall(Intent intent);}
    static final String RESULT_ACTION="org.yourrest.crm.APP_UPDATE_RESULT";
    private static NativeAppUpdater instance;
    static synchronized NativeAppUpdater get(Context context){if(instance==null)instance=new NativeAppUpdater(context.getApplicationContext());return instance;}
    private final Context context;
    private final SharedPreferences prefs;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private WeakReference<Host> host=new WeakReference<>(null);
    private Manifest release;
    private String phase="idle",error="";
    private long downloaded;
    private boolean busy,permissionTrip;
    private static final class Manifest {
        final JSONObject json;final String version,url,sha256,certificate;final long code,size;
        Manifest(JSONObject json,String installedCert)throws Exception{
            AppUpdateRules.validate(json.getInt("schemaVersion"),json.getString("packageName"),json.getLong("versionCode"),json.getString("versionName"),json.getString("apkUrl"),json.getLong("sizeBytes"),json.getString("sha256"),json.getString("certificateSha256"),installedCert);
            this.json=json;version=json.getString("versionName");url=json.getString("apkUrl");sha256=json.getString("sha256");certificate=json.getString("certificateSha256");code=json.getLong("versionCode");size=json.getLong("sizeBytes");
        }
    }
    private NativeAppUpdater(Context context){
        this.context=context;prefs=context.getSharedPreferences("app_updates",Context.MODE_PRIVATE);
        try{String saved=prefs.getString("manifest","");if(!saved.isEmpty()&&saved.length()<=65536){release=new Manifest(new JSONObject(saved),installedCertificate());phase=apk().isFile()?"ready":"available";}}
        catch(Exception invalid){release=null;}
        phase=AppUpdateLifecycle.restore(prefs.getString("phase",""),release!=null,apk().isFile());
    }
    static long versionCode(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
    PackageInfo installed()throws Exception{return context.getPackageManager().getPackageInfo(context.getPackageName(),signatureFlags());}
    private static int signatureFlags(){return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
    private static String certificate(PackageInfo info)throws Exception{
        Signature[] signers=Build.VERSION.SDK_INT>=28?(info.signingInfo==null?null:info.signingInfo.getApkContentsSigners()):info.signatures;
        if(signers==null||signers.length!=1)throw new IllegalArgumentException("تعذر التحقق من توقيع التطبيق");
        return AppUpdateRules.hex(MessageDigest.getInstance("SHA-256").digest(signers[0].toByteArray()));
    }
    private String installedCertificate()throws Exception{return certificate(installed());}
    void attach(Host next){host=new WeakReference<>(next);}
    void detach(Host current){if(host.get()==current)host.clear();}
    private boolean foreground(){Host current=host.get();return current!=null&&current.foreground();}
    private File directory(){return new File(context.getFilesDir(),"app-updates");}
    private File apk(){return new File(directory(),"verified.apk");}
    JSONObject state(){
        JSONObject state=new JSONObject();
        try{
            PackageInfo info=installed();long installedCode=versionCode(info);
            if(release!=null&&AppUpdateLifecycle.installed(installedCode,release.code)){phase="upToDate";error="";prefs.edit().remove("sessionId").putString("phase",phase).apply();}
            state.put("updateProtocol",1).put("phase",phase).put("installedVersionCode",installedCode).put("installedVersionName",info.versionName)
                .put("downloadedBytes",downloaded).put("totalBytes",release==null?0:release.size)
                .put("progress",release==null?0:Math.min(100,(int)(downloaded*100/release.size)));
            if(!error.isEmpty())state.put("error",error);
            if(release!=null){state.put("availableVersionCode",release.code).put("availableVersionName",release.version);JSONObject notes=release.json.optJSONObject("releaseNotes");if(notes!=null)state.put("releaseNotes",notes);}
        }catch(Exception unavailable){try{state.put("phase","error").put("error","تعذر قراءة الإصدار المثبت؛ أعد فتح التطبيق");}catch(Exception ignored){ }}
        return state;
    }
    private void emit(){JSONObject state=state();Host current=host.get();if(current!=null)current.updateChanged(state);}
    private void status(String next){phase=next;error="";prefs.edit().putString("phase",phase).apply();emit();}
    private void fail(String message){busy=false;phase="error";error=message;prefs.edit().putString("phase",phase).apply();emit();}
    private void rejectedForeground(){fail("افتح التطبيق لمتابعة التحديث");}
    void check(){
        if(!foreground()){rejectedForeground();return;}if(busy||"installing".equals(phase))return;
        busy=true;status("checking");
        worker.execute(()->{
            try{Manifest found=fetchManifest();main.post(()->{busy=false;release=found;downloaded=0;prefs.edit().putString("manifest",found.json.toString()).apply();status("available");});}
            catch(Exception failure){main.post(()->fail("تعذر التحقق من التحديث. اتصل بالشبكة ثم أعد المحاولة"));}
        });
    }
    private HttpsURLConnection connect(String url)throws Exception{
        HttpsURLConnection connection=(HttpsURLConnection)new URL(url).openConnection();
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept-Encoding","identity");connection.setRequestProperty("Cache-Control","no-cache");
        connection.setRequestProperty("Accept",url.equals(AppUpdateRules.MANIFEST_URL)?"application/json":"application/vnd.android.package-archive");
        // Session cookies are deliberately neither read nor forwarded for this public immutable release.
        return connection;
    }
    private Manifest fetchManifest()throws Exception{
        HttpsURLConnection connection=connect(AppUpdateRules.MANIFEST_URL);
        try{
            if(connection.getResponseCode()!=200)throw new java.io.IOException("Update manifest unavailable");
            long length=connection.getContentLengthLong();if(length>65536)throw new java.io.IOException("Manifest too large");
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                byte[] buffer=new byte[4096];int read;long deadline=System.nanoTime()+30_000_000_000L;
                while((read=input.read(buffer))!=-1){if(bytes.size()+read>65536||System.nanoTime()>deadline)throw new java.io.IOException("Invalid manifest response");bytes.write(buffer,0,read);}
                return new Manifest(new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8)),installedCertificate());
            }
        }finally{connection.disconnect();}
    }
    void download(){
        if(!foreground()){rejectedForeground();return;}if(busy||"installing".equals(phase))return;
        if(release==null){fail("تحقق من وجود تحديث أولًا");return;}
        final Manifest expected=release;
        try{if(expected.code<=versionCode(installed())){status("upToDate");return;}}catch(Exception failure){fail("تعذر قراءة الإصدار المثبت");return;}
        busy=true;downloaded=0;status("downloading");
        worker.execute(()->{
            File temporary=new File(directory(),"download.part");HttpsURLConnection connection=null;
            try{
                if(!directory().isDirectory()&&!directory().mkdirs())throw new java.io.IOException("Storage unavailable");
                if(directory().getUsableSpace()<expected.size+1024*1024)throw new java.io.IOException("Storage full");
                connection=connect(expected.url);if(connection.getResponseCode()!=200)throw new java.io.IOException("APK unavailable");
                long size=connection.getContentLengthLong();if(size!=-1&&size!=expected.size)throw new java.io.IOException("APK size mismatch");
                String hash;
                final int[] lastPercent={-1};
                try(InputStream input=connection.getInputStream();FileOutputStream output=new FileOutputStream(temporary)){
                    hash=AppUpdateRules.transfer(input,output,expected.size,bytes->{int percent=(int)(bytes*100/expected.size);if(percent!=lastPercent[0]){lastPercent[0]=percent;main.post(()->{downloaded=bytes;emit();});}});output.getFD().sync();
                }
                if(!expected.sha256.equals(hash))throw new java.io.IOException("APK hash mismatch");
                verifyArchive(temporary,expected);
                if(!temporary.renameTo(apk()))throw new java.io.IOException("Cannot save verified update");
                main.post(()->{busy=false;downloaded=expected.size;status("ready");});
            }catch(Exception failure){temporary.delete();main.post(()->fail("لم يكتمل تنزيل تحديث موثوق. تأكد من الشبكة والمساحة ثم أعد المحاولة"));}
            finally{if(connection!=null)connection.disconnect();}
        });
    }
    private void verifyArchive(File file,Manifest expected)throws Exception{
        if(!file.isFile()||file.length()!=expected.size)throw new java.io.IOException("APK size mismatch");
        try(InputStream input=new FileInputStream(file)){
            String hash=AppUpdateRules.transfer(input,new OutputStream(){@Override public void write(int value){ }@Override public void write(byte[] bytes,int offset,int length){ }},expected.size,null);
            if(!expected.sha256.equals(hash))throw new java.io.IOException("APK hash mismatch");
        }
        PackageInfo archive=context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),signatureFlags());
        PackageInfo current=installed();String currentCertificate=certificate(current);
        if(archive==null||!expected.certificate.equals(currentCertificate)||!AppUpdateRules.archiveMatches(archive.packageName,versionCode(archive),archive.versionName,certificate(archive),expected.code,expected.version,currentCertificate,versionCode(current)))throw new java.io.IOException("APK identity or signature mismatch");
    }
    void install(){
        if(!foreground()){rejectedForeground();return;}if(busy||"installing".equals(phase))return;
        if(release==null||!apk().isFile()){fail("نزّل التحديث أولًا");return;}
        try{if(release.code<=versionCode(installed())){status("upToDate");return;}}catch(Exception failure){fail("تعذر قراءة الإصدار المثبت");return;}
        if(!context.getPackageManager().canRequestPackageInstalls()){
            permissionTrip=true;status("permissionRequired");
            try{host.get().installPermission();}catch(RuntimeException unavailable){permissionTrip=false;fail("تعذر فتح إذن تثبيت تحديث يورست؛ حاول مجددًا");}
            return;
        }
        busy=true;final Manifest expected=release;
        worker.execute(()->{
            try{verifyArchive(apk(),expected);main.post(()->{busy=false;if(!foreground()){status("ready");return;}commit(expected);});}
            catch(Exception invalid){main.post(()->fail("ملف التحديث غير صالح؛ أعد تنزيل التحديث"));}
        });
    }
    private void commit(Manifest expected){
        // OS user confirmation is mandatory; no silent install or uninstall/data reset is attempted.
        busy=true;status("installing");
        worker.execute(()->{
            PackageInstaller installer=context.getPackageManager().getPackageInstaller();int sessionId=-1;
            try{
                int old=prefs.getInt("sessionId",-1);if(old>=0){try{installer.abandonSession(old);}catch(RuntimeException ignored){ }}
                PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(AppUpdateRules.PACKAGE);params.setSize(expected.size);
                if(Build.VERSION.SDK_INT>=31)params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
                sessionId=installer.createSession(params);if(!prefs.edit().putInt("sessionId",sessionId).commit())throw new java.io.IOException("Cannot preserve installer session");
                Intent callback=new Intent(context,AppUpdateInstallReceiver.class).setAction(RESULT_ACTION).putExtra("expectedSessionId",sessionId);
                // The OS must add status/confirmation extras. An explicit non-exported receiver and
                // the active owned session check constrain this required mutable PendingIntent.
                int flags=PendingIntent.FLAG_UPDATE_CURRENT;if(Build.VERSION.SDK_INT>=31)flags|=PendingIntent.FLAG_MUTABLE;
                PendingIntent pending=PendingIntent.getBroadcast(context,sessionId,callback,flags);
                try(PackageInstaller.Session session=installer.openSession(sessionId);InputStream input=new FileInputStream(apk());OutputStream output=session.openWrite("base.apk",0,expected.size)){
                    AppUpdateRules.transfer(input,output,expected.size,null);session.fsync(output);output.close();session.commit(pending.getIntentSender());
                }
                main.post(()->busy=false);
            }catch(Exception failure){if(sessionId>=0){try{installer.abandonSession(sessionId);}catch(RuntimeException ignored){ }}main.post(()->fail("تعذر فتح تثبيت التحديث؛ أعد المحاولة"));}
        });
    }
    void installResult(Intent intent){
        if(!RESULT_ACTION.equals(intent.getAction()))return;
        int expected=prefs.getInt("sessionId",-1);if(expected<0||expected!=intent.getIntExtra("expectedSessionId",-2))return;
        int result=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);
        if(result==PackageInstaller.STATUS_PENDING_USER_ACTION){
            Intent confirmation=Build.VERSION.SDK_INT>=33?intent.getParcelableExtra(Intent.EXTRA_INTENT,Intent.class):intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if(confirmation==null){fail("تعذر فتح تأكيد أندرويد");return;}
            if(foreground()){try{host.get().confirmInstall(confirmation);}catch(RuntimeException unavailable){fail("تعذر فتح تأكيد أندرويد؛ أعد المحاولة");}}
            else{try{context.getPackageManager().getPackageInstaller().abandonSession(expected);}catch(RuntimeException ignored){ }status("ready");}
            return;
        }
        prefs.edit().remove("sessionId").apply();
        long installedCode=-1;try{installedCode=versionCode(installed());}catch(Exception ignored){ }
        String outcome=AppUpdateLifecycle.result(result==PackageInstaller.STATUS_SUCCESS,result==PackageInstaller.STATUS_FAILURE_ABORTED,installedCode,release==null?0:release.code);
        if("upToDate".equals(outcome)){status(outcome);return;}
        if(result==PackageInstaller.STATUS_SUCCESS){
            // Success from a callback is not enough to claim the installed binary changed.
            status(outcome);main.postDelayed(this::resume,1500);return;
        }
        if("cancelled".equals(outcome)){status(outcome);return;}
        fail("لم يتم تثبيت التحديث. يمكنك إعادة المحاولة مع الاحتفاظ ببياناتك");
    }
    void resume(){
        emit();
        if(permissionTrip&&foreground()){permissionTrip=false;if(context.getPackageManager().canRequestPackageInstalls())install();else status("permissionRequired");return;}
        if("installing".equals(phase)&&!busy){
            int session=prefs.getInt("sessionId",-1);
            long installedCode=-1;try{installedCode=versionCode(installed());}catch(Exception ignored){ }
            String resumed=AppUpdateLifecycle.resumed(phase,installedCode,release==null?0:release.code,busy,session>=0&&context.getPackageManager().getPackageInstaller().getSessionInfo(session)!=null);
            if(!phase.equals(resumed))status(resumed);
        }
    }
}

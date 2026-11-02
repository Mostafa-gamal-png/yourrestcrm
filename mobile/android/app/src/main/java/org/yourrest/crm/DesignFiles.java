package org.yourrest.crm;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.webkit.CookieManager;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

/** Fetches a mold request's design file from the CRM's fixed origin with the WebView session, off the UI thread and one at a time,
 *  into the app's private cache, and copies it to a place the person picked. The session cookie is sent on this one request only: it
 *  never reaches JavaScript, another app, the system DownloadManager or a log. */
final class DesignFiles {
    /** A file in the private cache, ready to open or save. */
    static final class Fetched {
        final File file;final String name,mime;
        Fetched(File file,String name,String mime){this.file=file;this.name=name;this.mime=mime;}
    }
    /** One file being fetched; cancelling closes its connection. */
    static final class Task {
        final String url;final boolean view;
        final AtomicBoolean cancelled=new AtomicBoolean();
        private volatile HttpsURLConnection connection;
        Task(String url,boolean view){this.url=url;this.view=view;}
        void cancel(){
            cancelled.set(true);
            final HttpsURLConnection open=connection;
            // Closing a socket is network work: never on the UI thread.
            if(open!=null)new Thread(()->{try{open.disconnect();}catch(RuntimeException ignored){ }}).start();
        }
    }
    /** Called on the worker thread: the file, or the words to show (both null when cancelled). */
    interface Fetchedback {void done(Fetched fetched,String error);}
    interface Savedback {void done(String error);}
    static final String SAVE_FAILED="تعذّر حفظ الملف في المكان المختار؛ حاول مرة أخرى";
    static final String SAVE_LOST="لم يكتمل حفظ الملف لأن التطبيق أُغلق أثناء اختيار المكان؛ اضغط «تنزيل» مرة أخرى";
    private static final ExecutorService worker=Executors.newSingleThreadExecutor();

    static File root(Context context){return new File(context.getCacheDir(),"design-files");}
    static Uri uri(Fetched fetched){
        return new Uri.Builder().scheme("content").authority(DesignFileProvider.AUTHORITY).appendPath(fetched.file.getParentFile().getName()).appendPath(fetched.file.getName()).build();
    }
    static void fetch(Context app,Task task,String userAgent,Fetchedback callback){
        worker.execute(()->{
            File folder=null;Fetched fetched=null;String error;
            try{
                if(task.cancelled.get())throw DesignFileRules.Failure.cancelled();
                String cookie=CookieManager.getInstance().getCookie(RouteRules.ORIGIN);
                // Without a session the CRM would answer 401: say so without a request.
                if(cookie==null||cookie.trim().isEmpty())throw new DesignFileRules.Failure(DesignFileRules.errorMessage(401,null));
                String url=DesignFileRules.fetchUrl(task.url);
                if(url==null)throw new DesignFileRules.Failure(DesignFileRules.FAILED);
                HttpsURLConnection connection=(HttpsURLConnection)new URL(url).openConnection();
                task.connection=connection;
                try{
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(DesignFileRules.CONNECT_TIMEOUT_MS);connection.setReadTimeout(DesignFileRules.READ_TIMEOUT_MS);
                    connection.setRequestMethod("GET");
                    // Not text/html: a failure then comes back as the CRM's JSON, not its error page.
                    connection.setRequestProperty("Accept","*/*");
                    connection.setRequestProperty("Accept-Encoding","identity");connection.setRequestProperty("Cache-Control","no-store");
                    if(userAgent!=null&&!userAgent.isEmpty())connection.setRequestProperty("User-Agent",userAgent);
                    connection.setRequestProperty("Cookie",cookie);
                    if(task.cancelled.get())throw DesignFileRules.Failure.cancelled();
                    int status=connection.getResponseCode();
                    if(status!=200)throw new DesignFileRules.Failure(DesignFileRules.errorMessage(status,DesignFileRules.readBounded(connection.getErrorStream(),DesignFileRules.ERROR_MAX_BYTES)));
                    long declared=connection.getContentLengthLong();
                    if(!DesignFileRules.lengthAllowed(declared))throw new DesignFileRules.Failure(DesignFileRules.TOO_LARGE);
                    String name=DesignFileRules.fileName(connection.getHeaderField("Content-Disposition"));
                    String mime=DesignFileRules.mimeType(connection.getContentType());
                    folder=new File(root(app),UUID.randomUUID().toString());
                    if(!folder.mkdirs())throw new DesignFileRules.Failure(DesignFileRules.STORAGE);
                    File file=new File(folder,name);
                    long deadline=System.nanoTime()+DesignFileRules.TOTAL_MS*1_000_000L;
                    try(OutputStream output=create(file);InputStream input=connection.getInputStream()){
                        DesignFileRules.copy(input,output,declared,task.cancelled::get,deadline);
                    }
                    fetched=new Fetched(file,name,mime);error=null;
                }finally{task.connection=null;connection.disconnect();}
            }catch(DesignFileRules.Failure failure){
                remove(folder);error=failure.cancelled?null:failure.getMessage();
            }catch(IOException|RuntimeException failure){
                remove(folder);error=task.cancelled.get()?null:DesignFileRules.NETWORK;
            }
            if(fetched!=null&&task.cancelled.get()){remove(folder);fetched=null;}
            callback.done(fetched,error);
        });
    }
    /** Writes the fetched copy to the document the person picked with the system picker (truncating it), then drops the cached copy. */
    static void save(Context app,Fetched fetched,Uri target,Savedback callback){
        worker.execute(()->{
            String error=null;
            ContentResolver resolver=app.getContentResolver();
            // Read before writing: only a document this save created is removed after a failure, never a file the person overwrites.
            boolean created=DesignFileRules.createdBySave(size(resolver,target));
            try(InputStream input=new FileInputStream(fetched.file);OutputStream output=open(resolver,target)){
                DesignFileRules.copy(input,output,fetched.file.length(),null,0);
            }catch(Exception failed){
                error=SAVE_FAILED;
                // A half-written new document is not left behind in the chosen place.
                if(created)try{DocumentsContract.deleteDocument(resolver,target);}catch(Exception ignored){ }
            }
            remove(fetched.file.getParentFile());
            callback.done(error);
        });
    }
    /** The picker answered after the copy to write was lost (the activity was recreated or closed meanwhile): the empty document it
     *  created is removed, and the person is told. */
    static void abandon(Context app,Uri target,Runnable done){
        worker.execute(()->{
            ContentResolver resolver=app.getContentResolver();
            if(DesignFileRules.createdBySave(size(resolver,target)))try{DocumentsContract.deleteDocument(resolver,target);}catch(Exception ignored){ }
            done.run();
        });
    }
    /** The document's size as its provider reports it, or null when unknown. */
    private static Long size(ContentResolver resolver,Uri target){
        try(Cursor cursor=resolver.query(target,new String[]{OpenableColumns.SIZE},null,null,null)){
            if(cursor==null||!cursor.moveToFirst()||cursor.isNull(0))return null;
            return cursor.getLong(0);
        }catch(RuntimeException unknown){return null;}
    }
    /** "wt" (truncate), or "w" for a provider that refuses "wt". */
    private static OutputStream open(ContentResolver resolver,Uri target)throws IOException{
        IOException refused=new FileNotFoundException("no output");
        for(String mode:DesignFileRules.SAVE_MODES){
            try{OutputStream output=resolver.openOutputStream(target,mode);if(output!=null)return output;}
            catch(FileNotFoundException|IllegalArgumentException|UnsupportedOperationException unsupported){refused=new IOException(unsupported);}
        }
        throw refused;
    }
    /** The copy a save picker was opened for, found again after Android recreated the activity (only a file of the private cache). */
    static Fetched restore(Context app,String folder,String name,String mime){
        File file=DesignFileRules.servable(root(app),Arrays.asList(folder,name));
        return file==null?null:new Fetched(file,file.getName(),DesignFileRules.mimeType(mime));
    }
    /** The cache file; failing to create it is the phone's storage, not the network. */
    private static OutputStream create(File file)throws DesignFileRules.Failure{
        try{return new FileOutputStream(file);}catch(IOException|SecurityException full){throw new DesignFileRules.Failure(DesignFileRules.STORAGE);}
    }
    static void discard(Fetched fetched){if(fetched!=null)worker.execute(()->remove(fetched.file.getParentFile()));}
    /** Copies older than a day are removed when the app opens. */
    static void cleanup(Context app){
        worker.execute(()->{
            File[] entries=root(app).listFiles();
            if(entries==null)return;
            long now=System.currentTimeMillis();
            for(File entry:entries){
                if(!entry.isDirectory()){if(DesignFileRules.expired(entry.lastModified(),now))entry.delete();continue;}
                File[] files=entry.listFiles();
                boolean empty=true;
                if(files!=null)for(File file:files){if(DesignFileRules.expired(file.lastModified(),now)||file.isDirectory())remove(file);else empty=false;}
                if(empty&&(files!=null&&files.length>0||DesignFileRules.expired(entry.lastModified(),now)))entry.delete();
            }
        });
    }
    private static void remove(File file){
        if(file==null)return;
        File[] children=file.isDirectory()?file.listFiles():null;
        if(children!=null)for(File child:children)remove(child);
        file.delete();
    }
    private DesignFiles(){ }
}

package org.yourrest.crm;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.security.MessageDigest;

/** Executes the production update boundary and bounded downloader against hostile inputs. */
public final class AppUpdateCheck {
    private static int checks;
    private static final String HASH="a".repeat(64),CERT="b".repeat(64),VERSION="1.0.10";
    private static final String APK="https://crm.yourrest.org/downloads/yourrest-crm-android-v1.0.10-11.apk";
    private static void check(boolean yes,String label){checks++;if(!yes)throw new AssertionError(label);}
    interface Action {void run()throws Exception;}
    private static void rejects(Action action,String label)throws Exception{boolean rejected=false;try{action.run();}catch(Exception expected){rejected=true;}check(rejected,label);}
    public static void main(String[] args)throws Exception{
        AppUpdateRules.validate(1,"org.yourrest.crm",11,VERSION,APK,209653,HASH,CERT,CERT);
        check(AppUpdateRules.approvedApkUrl(APK,VERSION,11),"Valid immutable APK rejected");
        for(String url:new String[]{"http://crm.yourrest.org/downloads/yourrest-crm-android-v1.0.10-11.apk",APK+"?next=https://evil.invalid",APK+"#anything",APK.replace("crm.yourrest.org","crm.yourrest.org.evil.invalid"),APK.replace("crm.yourrest.org","crm.yourrest.org@evil.invalid"),APK.replace("crm.yourrest.org","evil@crm.yourrest.org"),APK.replace("https://","file://"),APK.replace("crm.yourrest.org","crm.yourrest.org:443"),APK.replace("/downloads/","/private/../downloads/"),APK.replace("/downloads/","/%64ownloads/"),APK.replace("-11.apk","-10.apk"),APK.replace("v1.0.10","v1.0.9"),"https://crm.yourrest.org/downloads/yourrest-crm-android.apk","javascript:alert(1)",""}){
            check(!AppUpdateRules.approvedApkUrl(url,VERSION,11),"Unapproved APK URL accepted: "+url);
        }
        for(String version:new String[]{null,"","1.0.10/../x","v1.0.10","1.0.10-beta","1.0.10?x","1.0.9999999"})check(!AppUpdateRules.approvedApkUrl(APK,version,11),"Unapproved version name");
        for(long size:new long[]{0,-1,Long.MAX_VALUE,AppUpdateRules.MAX_APK_BYTES+1})rejects(()->AppUpdateRules.validate(1,"org.yourrest.crm",11,VERSION,APK,size,HASH,CERT,CERT),"Unbounded size accepted");
        for(String hash:new String[]{"",null,"x".repeat(64),"a".repeat(63),"a".repeat(65)})rejects(()->AppUpdateRules.validate(1,"org.yourrest.crm",11,VERSION,APK,10,hash,CERT,CERT),"Invalid digest accepted");
        rejects(()->AppUpdateRules.validate(2,"org.yourrest.crm",11,VERSION,APK,10,HASH,CERT,CERT),"Unsupported schema accepted");
        rejects(()->AppUpdateRules.validate(1,"org.other.crm",11,VERSION,APK,10,HASH,CERT,CERT),"Other package accepted");
        rejects(()->AppUpdateRules.validate(1,"org.yourrest.crm",11,VERSION,APK,10,HASH,HASH,CERT),"Other manifest signer accepted");
        check(AppUpdateRules.archiveMatches("org.yourrest.crm",11,VERSION,CERT,11,VERSION,CERT,10),"Legitimate upgrade blocked");
        for(long installed:new long[]{11,12,100,Long.MAX_VALUE})check(!AppUpdateRules.archiveMatches("org.yourrest.crm",11,VERSION,CERT,11,VERSION,CERT,installed),"Equal version or downgrade accepted");
        check(!AppUpdateRules.archiveMatches("org.other.crm",11,VERSION,CERT,11,VERSION,CERT,10),"Wrong APK package accepted");
        check(!AppUpdateRules.archiveMatches("org.yourrest.crm",12,VERSION,CERT,11,VERSION,CERT,10),"Unannounced APK version accepted");
        check(!AppUpdateRules.archiveMatches("org.yourrest.crm",11,"1.0.11",CERT,11,VERSION,CERT,10),"Mismatched APK version name accepted");
        check(!AppUpdateRules.archiveMatches("org.yourrest.crm",11,VERSION,HASH,11,VERSION,CERT,10),"Wrong actual APK signer accepted");
        byte[] payload=new byte[131077];for(int n=0;n<payload.length;n++)payload[n]=(byte)(n*31);
        for(int chunk:new int[]{1,3,4096,16384,65536}){
            InputStream fragmented=new ByteArrayInputStream(payload){@Override public synchronized int read(byte[] bytes,int off,int len){return super.read(bytes,off,Math.min(chunk,len));}};
            ByteArrayOutputStream output=new ByteArrayOutputStream();long[] last={0};
            String hash=AppUpdateRules.transfer(fragmented,output,payload.length,bytes->{if(bytes<=last[0]||bytes>payload.length)throw new AssertionError("Progress not monotonic/bounded");last[0]=bytes;});
            check(Arrays.equals(payload,output.toByteArray()),"Interrupted chunks corrupt payload");
            check(hash.equals(AppUpdateRules.hex(MessageDigest.getInstance("SHA-256").digest(payload))),"Wrong verified download digest");
            check(last[0]==payload.length,"Completion before exact byte count");
        }
        rejects(()->AppUpdateRules.transfer(new ByteArrayInputStream(payload),new ByteArrayOutputStream(),payload.length-1,null),"Oversized response not rejected");
        rejects(()->AppUpdateRules.transfer(new ByteArrayInputStream(payload),new ByteArrayOutputStream(),payload.length+1,null),"Truncated response treated complete");
        rejects(()->AppUpdateRules.transfer(new ByteArrayInputStream(new byte[0]),new ByteArrayOutputStream(),1,null),"Empty response treated complete");
        InputStream lostNetwork=new InputStream(){int n;@Override public int read()throws IOException{if(n++>=512)throw new IOException("Network lost");return 7;}};
        rejects(()->AppUpdateRules.transfer(lostNetwork,new ByteArrayOutputStream(),2048,null),"Network loss treated as successful download");
        rejects(()->AppUpdateRules.transfer(new ByteArrayInputStream(payload),new java.io.OutputStream(){@Override public void write(int b)throws IOException{throw new IOException("Disk full");}},payload.length,null),"Disk full treated complete");
        Thread.currentThread().interrupt();try{rejects(()->AppUpdateRules.transfer(new ByteArrayInputStream(payload),new ByteArrayOutputStream(),payload.length,null),"Cancelled transfer treated complete");}finally{Thread.interrupted();}
        // A failed attempt never poisons the next complete retry.
        check(AppUpdateRules.transfer(new ByteArrayInputStream(payload),new ByteArrayOutputStream(),payload.length,null).equals(AppUpdateRules.hex(MessageDigest.getInstance("SHA-256").digest(payload))),"Retry corrupted by a failed attempt");
        check("ready".equals(AppUpdateLifecycle.restore("cancelled",true,true)),"Cancellation discards downloaded update on restart");
        check("ready".equals(AppUpdateLifecycle.restore("error",true,true)),"Retry after failure loses staged update");
        check("available".equals(AppUpdateLifecycle.restore("ready",true,false)),"Missing APK is reported as downloaded");
        check("idle".equals(AppUpdateLifecycle.restore("ready",false,true)),"Untrusted orphan APK can be offered for install");
        check("idle".equals(AppUpdateLifecycle.restore("installing",false,true)),"Invalid saved manifest blocks future update checks");
        check("installing".equals(AppUpdateLifecycle.restore("installing",true,true)),"Process restart loses pending OS session");
        for(long old:new long[]{-1,0,9,10}){
            check("installing".equals(AppUpdateLifecycle.result(true,false,old,11)),"Installer callback alone falsely confirms upgrade");
            check("cancelled".equals(AppUpdateLifecycle.result(false,true,old,11)),"User cancellation falsely confirms upgrade");
            check("cancelled".equals(AppUpdateLifecycle.resumed("installing",old,11,false,false)),"Interrupted/dead OS session becomes stuck");
            check("installing".equals(AppUpdateLifecycle.resumed("installing",old,11,false,true)),"Active OS confirmation is falsely cancelled");
            check("installing".equals(AppUpdateLifecycle.resumed("installing",old,11,true,false)),"Creating OS session races with resume");
        }
        check("upToDate".equals(AppUpdateLifecycle.result(true,false,11,11)),"Verified replacement not recognized");
        check("upToDate".equals(AppUpdateLifecycle.resumed("installing",11,11,false,false)),"New binary not recognized after restart");
        check(!AppUpdateLifecycle.installed(10,0),"Missing release target falsely confirms upgrade");
        System.out.println("Native update rules: "+checks+" checks passed (hostile release identity, downgrade/signature rejection, bounded download, corruption, network loss and retry). Physical Android installer lifecycle not exercised.");
    }
}

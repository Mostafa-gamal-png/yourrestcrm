package org.yourrest.crm;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.URI;
import java.security.MessageDigest;

/** Bounded, dependency-free update validation shared by the downloader and executable tests. */
final class AppUpdateRules {
    static final String PACKAGE="org.yourrest.crm";
    static final String MANIFEST_URL="https://crm.yourrest.org/api/app-update";
    static final long MAX_APK_BYTES=64L*1024*1024;
    static boolean validHash(String value){return value!=null&&value.matches("[0-9a-f]{64}");}
    static boolean approvedApkUrl(String url,String version,long code){
        if(version==null||!version.matches("[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}")||code<=0||code>Integer.MAX_VALUE)return false;
        try{URI uri=URI.create(url);return "https".equals(uri.getScheme())&&"crm.yourrest.org".equals(uri.getHost())
            &&uri.getPort()==-1&&uri.getRawUserInfo()==null&&uri.getRawQuery()==null&&uri.getRawFragment()==null
            &&("/downloads/yourrest-crm-android-v"+version+"-"+code+".apk").equals(uri.getRawPath());}
        catch(RuntimeException invalid){return false;}
    }
    static void validate(int schema,String packageName,long code,String version,String url,long size,String hash,String cert,String installedCert){
        if(schema!=1||!PACKAGE.equals(packageName)||!approvedApkUrl(url,version,code)||size<=0||size>MAX_APK_BYTES
            ||!validHash(hash)||!validHash(cert)||!cert.equals(installedCert))throw new IllegalArgumentException("بيانات التحديث أو توقيعه غير موثوقة");
    }
    static boolean archiveMatches(String packageName,long code,String version,String cert,long expectedCode,String expectedVersion,String expectedCert,long installedCode){
        return PACKAGE.equals(packageName)&&code>installedCode&&code==expectedCode&&expectedVersion.equals(version)&&validHash(cert)&&expectedCert.equals(cert);
    }
    interface Progress {void bytes(long bytes);}
    static String transfer(InputStream input,OutputStream output,long expected,Progress progress)throws Exception{
        if(expected<=0||expected>MAX_APK_BYTES)throw new IOException("حجم التحديث غير صالح");
        MessageDigest digest=MessageDigest.getInstance("SHA-256");long written=0,deadline=System.nanoTime()+180_000_000_000L;
        byte[] buffer=new byte[16384];int count;
        while((count=input.read(buffer))!=-1){
            if(Thread.currentThread().isInterrupted()||System.nanoTime()>deadline)throw new IOException("انتهت مهلة تنزيل التحديث؛ حاول مجددًا");
            if(count==0)continue;
            if(written+count>expected)throw new IOException("حجم ملف التحديث لا يطابق النسخة المعلنة");
            output.write(buffer,0,count);digest.update(buffer,0,count);written+=count;if(progress!=null)progress.bytes(written);
        }
        if(written!=expected)throw new IOException("التنزيل غير مكتمل؛ أعد المحاولة عند استقرار الشبكة");
        return hex(digest.digest());
    }
    static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte value:bytes)out.append(String.format(java.util.Locale.ROOT,"%02x",value&255));return out.toString();}
    private AppUpdateRules(){ }
}

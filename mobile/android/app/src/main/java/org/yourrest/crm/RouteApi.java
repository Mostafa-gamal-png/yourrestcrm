package org.yourrest.crm;

import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Fixed-origin transport. Cookie material never leaves native memory or reaches JavaScript. */
final class RouteApi {
    static final class Failure extends Exception {
        final int status;
        Failure(int status,String message){super(message);this.status=status;}
    }
    JSONObject call(JSONObject body) throws Exception {
        HttpsURLConnection connection=(HttpsURLConnection)new URL(RouteRules.ORIGIN+"/api/mobile-route").openConnection();
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(20000);
        connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Origin",RouteRules.ORIGIN);
        connection.setRequestProperty("Cache-Control","no-store");
        String cookie=CookieManager.getInstance().getCookie(RouteRules.ORIGIN);
        if(cookie!=null&&!cookie.trim().isEmpty())connection.setRequestProperty("Cookie",cookie);
        try{
            if(body!=null){connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");byte[] data=body.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(data.length);try(java.io.OutputStream output=connection.getOutputStream()){output.write(data);}}
            int status=connection.getResponseCode();
            InputStream stream=status>=200&&status<300?connection.getInputStream():connection.getErrorStream();
            ByteArrayOutputStream output=new ByteArrayOutputStream();
            if(stream!=null)try(InputStream input=stream){byte[] bytes=new byte[4096];int size;while((size=input.read(bytes))!=-1){if(output.size()+size>262144)throw new Failure(502,"استجابة غير صالحة من الخادم");output.write(bytes,0,size);}}
            JSONObject json;
            try{json=new JSONObject(output.toString(StandardCharsets.UTF_8.name()));}catch(Exception e){throw new Failure(status,"تعذر الاتصال بتقرير خط السير");}
            if(status<200||status>=300)throw new Failure(status,json.optString("error","تعذر مزامنة خط السير"));
            return json;
        }finally{connection.disconnect();}
    }
}

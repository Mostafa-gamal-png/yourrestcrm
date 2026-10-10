package org.yourrest.crm;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.RecognizerIntent;
import android.webkit.CookieManager;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import org.json.JSONObject;

/** Explicit external Android speech UI. No microphone permission, audio file, or text persistence. */
final class NativeSpeech {
    interface Host { String nonce(); boolean foreground(); }
    interface Reply { void complete(JSONObject result,String error); }
    private final Activity activity;private final Host host;private final Handler handler=new Handler(Looper.getMainLooper());
    private final SpeechSessionGate gate=new SpeechSessionGate();private Reply pending;private Runnable timeout;
    NativeSpeech(Activity activity,Host host){this.activity=activity;this.host=host;}
    boolean supported(){try{return intent("ar-SA").resolveActivity(activity.getPackageManager())!=null;}catch(RuntimeException unavailable){return false;}}
    private Intent intent(String language){return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE,language).putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1)
        .putExtra(RecognizerIntent.EXTRA_PROMPT,"ar-SA".equals(language)?"تحدث لإضافة النص؛ يمكنك مراجعته قبل الحفظ":"Speak to add text; review it before saving");}
    private String fingerprint(){
        // Authentication stays native and ephemeral. No cookie or hash is returned to JS or written to disk.
        try{String session=SpeechSessionGate.sessionCookie(CookieManager.getInstance().getCookie(RouteRules.ORIGIN));
            if(session.isEmpty())return "";
            byte[] digest=MessageDigest.getInstance("SHA-256").digest(session.getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder();for(byte b:digest)hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return hex.toString();
        }catch(Exception unavailable){return "";}
    }
    void start(JSONObject input,Reply reply){
        SpeechSessionGate.Session session;
        try{session=gate.begin(input.optString("sessionId"),host.nonce(),fingerprint(),input.optString("language"),SystemClock.elapsedRealtime(),host.foreground(),supported());}
        catch(RuntimeException rejected){reply.complete(result(input.optString("sessionId"),"",false),rejected.getMessage());return;}
        pending=reply;timeout=()->finish(session,"","speech_timeout",true,true);handler.postDelayed(timeout,SpeechSessionGate.TIMEOUT_MS);
        try{activity.startActivityForResult(intent(session.language),session.requestCode);}
        catch(ActivityNotFoundException unavailable){finish(session,"","speech_unsupported",false,false);}
        catch(SecurityException denied){finish(session,"","speech_permission",false,false);}
        catch(RuntimeException failed){finish(session,"","speech_failed",false,false);}
    }
    void cancel(String id,Reply reply){SpeechSessionGate.Session session=gate.active();if(session!=null&&session.id.equals(id))finish(session,"",null,true,true);reply.complete(result(id,"",true),null);}
    void invalidate(){SpeechSessionGate.Session session=gate.active();if(session!=null)finish(session,"","speech_session_changed",true,true);gate.invalidate();}
    boolean onResult(int request,int status,Intent data){
        if(request<4000||request>65000)return false;
        SpeechSessionGate.Session session=gate.forResult(request);if(session==null)return true;
        if(!gate.current(session,host.nonce(),fingerprint(),SystemClock.elapsedRealtime())){finish(session,"","speech_session_changed",true,false);return true;}
        if(status==Activity.RESULT_CANCELED){finish(session,"",null,true,false);return true;}
        if(status!=Activity.RESULT_OK){finish(session,"",status==RecognizerIntent.RESULT_NO_MATCH?"speech_no_match":status==RecognizerIntent.RESULT_NETWORK_ERROR?"speech_network":"speech_failed",false,false);return true;}
        try{ArrayList<String> candidates=data==null?null:data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);String text=SpeechSessionGate.transcript(candidates==null||candidates.isEmpty()?null:candidates.get(0));finish(session,text,null,false,false);}
        catch(RuntimeException invalid){finish(session,"","speech_too_long".equals(invalid.getMessage())?"speech_too_long":"speech_no_match",false,false);}return true;
    }
    private void finish(SpeechSessionGate.Session session,String text,String error,boolean cancelled,boolean closeActivity){
        if(gate.cancel(session.id)!=session)return;
        if(timeout!=null){handler.removeCallbacks(timeout);timeout=null;}Reply reply=pending;pending=null;
        if(closeActivity)try{activity.finishActivity(session.requestCode);}catch(RuntimeException ignored){ }
        if(reply!=null)reply.complete(result(session.id,text,cancelled),error);
    }
    private static JSONObject result(String id,String text,boolean cancelled){JSONObject value=new JSONObject();try{value.put("sessionId",id).put("text",text).put("cancelled",cancelled);}catch(Exception ignored){ }return value;}
}

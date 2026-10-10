package org.yourrest.crm;

/** Main-thread speech session ownership. Never reuses an activity request code in this lifetime. */
final class SpeechSessionGate {
    static final long TIMEOUT_MS=75000;
    static final int MAX_TEXT=5000;
    static final class Session {
        final String id,nonce,fingerprint,language;
        final int requestCode;final long generation,startedAt;
        Session(String id,String nonce,String fingerprint,String language,int requestCode,long generation,long startedAt){this.id=id;this.nonce=nonce;this.fingerprint=fingerprint;this.language=language;this.requestCode=requestCode;this.generation=generation;this.startedAt=startedAt;}
    }
    private Session active;private int nextRequestCode=4000;private long generation;
    Session active(){return active;}
    Session begin(String id,String nonce,String fingerprint,String language,long now,boolean foreground,boolean supported){
        if(!foreground)throw new IllegalStateException("speech_foreground");
        if(!supported)throw new IllegalStateException("speech_unsupported");
        if(active!=null)throw new IllegalStateException("speech_busy");
        if(id==null||!id.matches("[a-zA-Z0-9_-]{1,80}")||nonce==null||nonce.isEmpty())throw new IllegalArgumentException("speech_invalid");
        if(fingerprint==null||fingerprint.isEmpty())throw new IllegalStateException("speech_session_changed");
        if(!"ar-SA".equals(language)&&!"en-US".equals(language))throw new IllegalArgumentException("speech_language");
        if(nextRequestCode>65000)throw new IllegalStateException("speech_reload");
        active=new Session(id,nonce,fingerprint,language,nextRequestCode++,generation,now);return active;
    }
    boolean current(Session session,String nonce,String fingerprint,long now){return session!=null&&active==session&&session.generation==generation&&session.nonce.equals(nonce)&&session.fingerprint.equals(fingerprint)&&now>=session.startedAt&&now-session.startedAt<TIMEOUT_MS;}
    Session forResult(int requestCode){return active!=null&&active.requestCode==requestCode?active:null;}
    Session cancel(String id){if(active==null||!active.id.equals(id))return null;Session old=active;active=null;return old;}
    Session invalidate(){generation++;Session old=active;active=null;return old;}
    static String sessionCookie(String cookies){
        String session="";int count=0;
        if(cookies!=null)for(String part:cookies.split(";")){String cookie=part.trim();if(cookie.startsWith("__Host-yourrest_session=")){count++;session=cookie.substring("__Host-yourrest_session=".length());}}
        return count==1&&session.matches("[a-fA-F0-9]{64}")?session:"";
    }
    static String transcript(String value){
        if(value==null)throw new IllegalArgumentException("speech_no_match");
        if(value.length()>MAX_TEXT)throw new IllegalArgumentException("speech_too_long");
        String text=value.replaceAll("[\\p{Cntrl}&&[^\\n\\t]]","").trim();
        if(text.isEmpty())throw new IllegalArgumentException("speech_no_match");return text;
    }
}

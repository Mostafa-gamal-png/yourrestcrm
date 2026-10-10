package org.yourrest.crm;

/** Executes the real session/cookie/text gates; no microphone or Android UI simulation claim. */
public final class SpeechSessionCheck {
    static int checks;
    static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    static void rejected(String message,Runnable action){try{action.run();throw new AssertionError("Expected "+message);}catch(IllegalArgumentException|IllegalStateException expected){check(message.equals(expected.getMessage()),"Wrong rejection "+expected.getMessage());}}
    public static void main(String[] args){
        SpeechSessionGate gate=new SpeechSessionGate();
        rejected("speech_foreground",()->gate.begin("one","nonce","cookie","ar-SA",100,false,true));
        rejected("speech_unsupported",()->gate.begin("one","nonce","cookie","ar-SA",100,true,false));
        rejected("speech_session_changed",()->gate.begin("one","nonce","","ar-SA",100,true,true));
        rejected("speech_invalid",()->gate.begin("bad id!","nonce","cookie","ar-SA",100,true,true));
        rejected("speech_language",()->gate.begin("one","nonce","cookie","url:evil",100,true,true));
        check(gate.active()==null,"Rejected setup left active session");
        SpeechSessionGate.Session first=gate.begin("one","nonce","cookie","ar-SA",100,true,true);
        check(first.language.equals("ar-SA"),"Arabic locale lost");
        check(gate.current(first,"nonce","cookie",101),"Current session rejected");
        rejected("speech_busy",()->gate.begin("two","nonce","cookie","en-US",101,true,true));
        check(gate.active()==first,"Concurrent request replaces owner");
        check(gate.cancel("unrelated")==null&&gate.active()==first,"Wrong field cancelled active session");
        check(!gate.current(first,"other-page","cookie",101),"Navigation accepted stale text");
        check(!gate.current(first,"nonce","other-account",101),"Account switch accepted stale text");
        check(!gate.current(first,"nonce","cookie",99),"Monotonic rollback accepted");
        check(gate.current(first,"nonce","cookie",75099),"Premature timeout");
        check(!gate.current(first,"nonce","cookie",75100),"Timeout accepted text");
        check(gate.cancel("one")==first,"Cancel not acknowledged");
        check(!gate.current(first,"nonce","cookie",101),"Cancelled callback accepted");
        SpeechSessionGate.Session second=gate.begin("two","nonce","cookie","en-US",102,true,true);
        check(second.requestCode!=first.requestCode,"Request code reused; old Android result can cross fields");
        check(gate.forResult(first.requestCode)==null&&gate.forResult(second.requestCode)==second,"Old result consumes new session");
        check(gate.invalidate()==second,"Logout did not invalidate active session");
        check(!gate.current(second,"nonce","cookie",103),"Logout accepted late text");
        SpeechSessionGate.Session third=gate.begin("three","fresh","next-cookie","en-US",104,true,true);
        check(third.generation!=second.generation,"Account generation unchanged");
        check(gate.current(third,"fresh","next-cookie",105),"New account cannot dictate");
        check(SpeechSessionGate.transcript("  مصنع جيد\n  ").equals("مصنع جيد"),"Arabic transcript changed");
        check(SpeechSessionGate.transcript(" Hi\u0000 there ").equals("Hi there"),"Control characters retained");
        rejected("speech_no_match",()->SpeechSessionGate.transcript(null));
        rejected("speech_no_match",()->SpeechSessionGate.transcript(" \n\t"));
        rejected("speech_too_long",()->SpeechSessionGate.transcript("a".repeat(5001)));
        check(SpeechSessionGate.transcript("a".repeat(5000)).length()==5000,"Valid boundary rejected");
        String value="a".repeat(64),cookie="__Host-yourrest_session="+value;
        check(SpeechSessionGate.sessionCookie(cookie).equals(value),"Actual HttpOnly cookie name ignored");
        check(SpeechSessionGate.sessionCookie("other=x; "+cookie+"; challenge=abc").equals(value),"Unrelated cookies change identity");
        check(SpeechSessionGate.sessionCookie(cookie+"; "+cookie).isEmpty(),"Ambiguous duplicate cookie accepted");
        check(SpeechSessionGate.sessionCookie("yourrest_session="+value).isEmpty(),"Untrusted old cookie name accepted");
        check(SpeechSessionGate.sessionCookie(null).isEmpty(),"Missing cookie accepted");
        check(SpeechSessionGate.sessionCookie("__Host-yourrest_session=invalid").isEmpty(),"Malformed credential accepted");
        System.out.println("Speech session checks passed: "+checks);
    }
}

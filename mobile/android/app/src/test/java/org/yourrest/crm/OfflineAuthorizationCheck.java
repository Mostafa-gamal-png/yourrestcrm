package org.yourrest.crm;

import java.nio.file.Files;
import java.nio.file.Path;

/** Executes the production lease rules; integration guards do not claim real-device GPS testing. */
public final class OfflineAuthorizationCheck {
    private static int checks;
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    private static boolean lease(String owner,String scope,String role,String cachedOwner,String cachedScope,String cachedRole,long verified,long observed,long now) {
        return OfflineRouteAuthorization.valid(owner,scope,role,cachedOwner,cachedScope,cachedRole,verified,observed,now);
    }
    private static boolean valid(long verified,long observed,long now) {
        return lease("rep-1","western","rep","rep-1","western","rep",verified,observed,now);
    }
    public static void main(String[] args) throws Exception {
        long verified = RouteRules.millis("2026-10-05T03:00:00.000Z");
        long expires = verified + OfflineRouteAuthorization.LEASE_MS;
        check(valid(verified,verified,verified),"Successful enrollment starts local lease");
        check(valid(verified,verified,verified+86400000L),"Offline reboot/new Saudi day keeps remaining lease");
        check(valid(verified,verified,expires-1),"Last eligible lease millisecond");
        check(!valid(verified,verified,expires),"Lease must expire exactly at7days");
        check(!valid(verified,verified,expires+1),"Expired lease cannot collect");
        check(!valid(0,0,verified),"Never authorize first enrollment offline");
        check(!valid(verified,verified,verified-1),"Rollback before last server check cannot collect");
        check(!valid(verified,verified-1,verified),"Corrupt observed timestamp cannot collect");
        check(valid(verified,verified+120000,verified+60000),"Bounded clock adjustment uses high-water age");
        check(!valid(verified,verified+120001,verified+60000),"Large backward clock change cannot extend lease");
        check(!valid(verified,expires,expires-1),"Observed expiration cannot be undone by clock adjustment");
        for(String[] changed:new String[][]{{"rep-2","western","rep"},{"rep-1","eastern","rep"},{"rep-1","western","admin"},{"rep-1","western","supervisor"},{"","western","rep"},{"../owner","western","rep"},{"rep-1","","rep"}}) {
            check(!lease(changed[0],changed[1],changed[2],"rep-1","western","rep",verified,verified,verified+1),"Changed owner, scope or role blocked");
            check(!lease("rep-1","western","rep",changed[0],changed[1],changed[2],verified,verified,verified+1),"Forged cached owner, scope or role blocked");
        }
        check(!lease(null,"western","rep","rep-1","western","rep",verified,verified,verified),"Missing owner blocked");
        check(!lease("rep-1",null,"rep","rep-1","western","rep",verified,verified,verified),"Missing scope blocked");
        for(int status:new int[]{408,429,500,502,503,504,599})check(OfflineRouteAuthorization.transientStatus(status),"Transient status may use existing lease");
        for(int status:new int[]{0,200,301,302,400,401,403,404,409,410,499,600})check(!OfflineRouteAuthorization.transientStatus(status),"Explicit denial/conflict/malformed response cannot use lease");
        // Lease does not override working hours, Friday, consent, background grants or explicit stop.
        for(int bits=0;bits<64;bits++) {
            boolean permission = ContinuousPolicy.canResume((bits&1)!=0,(bits&2)!=0,(bits&4)!=0,(bits&8)!=0,(bits&16)!=0,(bits&32)!=0);
            check((permission&&valid(verified,verified,verified+1))==(bits==31),"All OS/consent/enrollment constraints survive offline mode");
        }
        for(String time:new String[]{"2026-10-05T02:59:59Z","2026-10-05T15:00:00Z","2026-10-09T06:00:00Z"})check(!(valid(verified,verified,RouteRules.millis(time))&&ContinuousPolicy.inWindow(RouteRules.millis(time))),"Lease cannot collect outside work window");
        check(OfflineRouteAuthorization.canResetEmptyOwner("rep-1","rep-2",0,0),"Acknowledged empty account can switch");
        for(int[] pending:new int[][]{{1,0},{0,1},{1,1},{100000,0},{0,1000},{-1,0},{0,-1}})
            check(!OfflineRouteAuthorization.canResetEmptyOwner("rep-1","rep-2",pending[0],pending[1]),"Any unknown or pending evidence blocks owner change");
        check(!OfflineRouteAuthorization.canResetEmptyOwner("","rep-2",0,0),"Unknown owner cannot be treated as authenticated old account");
        check(!OfflineRouteAuthorization.canResetEmptyOwner("rep-1","",0,0),"Unknown hydration identity cannot switch owner");
        check(!OfflineRouteAuthorization.canResetEmptyOwner("rep-1","rep-1",0,0),"Same-account refresh preserves context");
        Path source=Path.of(args.length>0?args[0]:"mobile/android/app/src/main/java/org/yourrest/crm");
        String tracker=Files.readString(source.resolve("ContinuousRouteTracker.java")),service=Files.readString(source.resolve("RouteLocationService.java"));
        String enroll=TripStartCheck.block(tracker,"void enroll("),authorize=TripStartCheck.block(tracker,"void authorizeService("),capture=TripStartCheck.block(tracker,"void onFix("),logout=TripStartCheck.block(tracker,"void logout("),disable=TripStartCheck.block(tracker,"private void disable("),sync=TripStartCheck.block(tracker,"private void flushInternal(int"),remember=TripStartCheck.block(tracker,"private void rememberAuthorization("),fallback=TripStartCheck.block(tracker,"private boolean offlineFallback("),refresh=TripStartCheck.block(tracker,"void refreshAccount(");
        check(enroll.indexOf("api.call(null)")<enroll.indexOf("rememberAuthorization(")&&!enroll.contains("offlineFallback("),"First enrollment cannot use cached or UI authority");
        check(authorize.contains("offlineFallback(failure)")&&authorize.contains("expected==generation&&collectionAuthorized()"),"Offline resume retains generation/lease guard");
        check(fallback.contains("java.io.IOException")&&fallback.contains("javax.net.ssl.SSLException")&&fallback.contains("transientStatus"),"Only transient network failures use offline lease");
        check(remember.indexOf("checkCurrent(expected,member)")<remember.indexOf("store.put(\"offlineAuthorization\"")&&remember.contains("verify(response,member)"),"Expired async account requests cannot renew authority");
        check(capture.indexOf("!collectionAuthorized()")<capture.indexOf("store.point("),"Every captured fix must satisfy bounded authorization");
        check(capture.contains("authorizationObservedAt"),"Observed clock rollback protection persists");
        check(logout.contains("disable(false)")&&logout.contains("store.put(\"loggedOut\",\"1\")")&&!logout.contains("store.clear("),"Logout halts and preserves evidence");
        check(disable.contains("forgetAuthorization()")&&!disable.contains("store.clear("),"Auth revocation invalidates lease without deletion");
        check(sync.contains("\"1\".equals(store.get(\"loggedOut\"))")&&sync.indexOf("verify(auth,owner)")<sync.indexOf("store.ack("),"Uploads require current account after logout/relogin");
        check(refresh.contains("Decision.WRONG_OWNER")&&refresh.contains("expected!=generation"),"Different account and stale refresh cannot activate old queue");
        check(service.contains("||!ContinuousRouteTracker.get(this).collectionAuthorized()){releaseLocations();"),"Provider releases when lease expires");
        check(TripStartCheck.block(service,"void registerContinuousLocations(").contains("!ContinuousRouteTracker.get(this).collectionAuthorized()"),"Subscription requires valid lease");
        String resetOwner=TripStartCheck.block(tracker,"private boolean resetEmptyOwnerForAccount(");
        check(resetOwner.contains("member.equals(response.optString(\"memberId\"))")&&resetOwner.contains("expected!=generation"),"Account reset requires current server identity");
        check(resetOwner.contains("canResetEmptyOwner(owner,member,points,gaps)")&&resetOwner.contains("store.resetEmptyContext()"),"Switch rechecks total evidence under store lock");
        check(enroll.indexOf("api.call(null)")<enroll.indexOf("resetEmptyOwnerForAccount(response,member,expected)"),"Offline/new unauthenticated account cannot clear context");
        check(refresh.contains("if(resetEmptyOwnerForAccount(response,member,expected)){error=\"\";syncError=\"\";finish(reply,null);return;}"),"New authenticated empty owner stays disabled until explicit enrollment");
        check(logout.contains("worker.execute")&&logout.contains("expected==generation")&&logout.contains("store.count()==0&&store.gapCount()==0")&&logout.contains("store.resetEmptyContext()"),"Logout clears only proven-empty metadata after in-flight worker settles");
        check(!sync.contains("\"buffer_expired\".equals(gap.optString"),"Historical gaps cannot be discarded without server acknowledgment");
        check(!enroll.contains("RouteLocationService.current!=null")&&enroll.contains("context.startForegroundService"),"Account reset cannot reuse a stale stopping service reference");
        check(enroll.contains("if(expected!=generation||!MainActivity.resumed)throw new IllegalStateException()"),"Late start after logout/background cannot enroll service");
        String authorized=TripStartCheck.block(service,"void continuousAuthorized(");
        check(authorized.contains("boolean wasRegistered=registered")&&authorized.contains("if(wasRegistered&&continuous&&registered)")&&authorized.contains("serviceReady()"),"Repeated authorized enrollment settles with existing provider subscription");
        check(capture.indexOf("store.point(")<capture.indexOf("error.startsWith(\"تعذر حفظ الموقع الجديد\")"),"Storage-failure warning clears only after successful durable capture");
        System.out.println("Native offline authorization: "+checks+" checks passed (production policy and integration guards; hardware lifecycle unverified)");
    }
}

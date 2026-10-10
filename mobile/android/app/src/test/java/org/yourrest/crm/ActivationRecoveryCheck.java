package org.yourrest.crm;

import java.nio.file.Files;
import java.nio.file.Path;

/** Production handoff, failure classification and native integration recovery guards. */
public final class ActivationRecoveryCheck {
    static int checks;
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    public static void main(String[] args)throws Exception{
        for(int status:new int[]{400,404,409,408,429,500,502,503,504}){
            check(!TrackingFailurePolicy.authenticationRejected(status),"Upload/network error revokes the account: "+status);
        }
        for(int status:new int[]{401,403})check(TrackingFailurePolicy.authenticationRejected(status),"Revoked identity or scope remains collecting");
        for(int status:new int[]{400,404,409})check(TrackingFailurePolicy.dataRejected(status),"Rejected evidence is no longer retained for review");
        check(TrackingFailurePolicy.recheckDevice(409)&&!TrackingFailurePolicy.recheckDevice(400),"A binding conflict must recheck actual account/device");
        ForegroundMapsHandoff handoff=new ForegroundMapsHandoff("navigation-nonce","rep-1",26.4,50.1,1000);
        check(handoff.accepts("navigation-nonce","rep-1",1000),"Fresh valid handoff rejected");
        check(handoff.accepts("navigation-nonce","rep-1",30999),"Valid expiry boundary rejected");
        check(!handoff.accepts("navigation-nonce","rep-1",31000),"Expired handoff accepted");
        check(!handoff.accepts("navigation-nonce","rep-1",999),"Clock rollback extends handoff");
        check(!handoff.accepts("other-navigation","rep-1",1100),"Foreign navigation can consume handoff");
        check(!handoff.accepts("navigation-nonce","rep-2",1100),"Different owner can consume handoff");
        check(handoff.matches(26.4,50.1,1100),"Authenticated same snapshot rejected");
        check(!handoff.matches(26.400001,50.1,1100)&&!handoff.matches(26.4,50.100001,1100),"Changed destination can consume handoff");
        check(!handoff.matches(Double.NaN,50.1,1100)&&!handoff.matches(26.4,50.1,31000),"Invalid or expired destination can bind");
        for(double[] point:new double[][]{{0,0},{91,50},{26,181},{Double.NaN,50},{26,Double.POSITIVE_INFINITY}})check(MapsLauncher.coordinates(point[0],point[1])==null,"Invalid coordinate factory launches intent");
        MapsLauncher.Destination target=MapsLauncher.coordinates(26.4,50.1);
        check(target!=null&&MapsLauncher.destination(target.https())!=null,"Coordinate factory cannot produce a canonical fixed destination");
        Path source=Path.of(args.length>0?args[0]:"mobile/android/app/src/main/java/org/yourrest/crm");
        String activity=Files.readString(source.resolve("MainActivity.java")),tracker=Files.readString(source.resolve("ContinuousRouteTracker.java"));
        String enroll=TripStartCheck.block(tracker,"void enroll("),authorize=TripStartCheck.block(tracker,"void authorizeService("),sync=TripStartCheck.block(tracker,"private void handleSync("),control=TripStartCheck.block(tracker,"private void handle(Exception"),bind=TripStartCheck.block(tracker,"private void bindInternal(");
        check(enroll.contains("api.call(null)")&&enroll.contains("recoverEmptyScopeForEnrollment(response,member);verify(response,member)")&&enroll.indexOf("api.call(null)")<enroll.indexOf("resetEmptyOwnerForAccount(response,member,expected)")&&!enroll.contains("flushInternal("),"Activation waits behind or bypasses authenticated backlog");
        check(authorize.contains("verify(response,store.get(\"memberId\"))")&&!authorize.contains("flushInternal("),"Service authorization requires backlog success");
        check(control.contains("disable(false)")&&!control.contains("disable(true)"),"Authentication rejection deletes private unsynced evidence");
        check(sync.contains("syncError=")&&sync.contains("TrackingFailurePolicy.authenticationRejected")&&!sync.contains("store.clear("),"Upload diagnostics lose authorization handling or evidence");
        check(!sync.contains("store.put(\"enabled\",\"0\")"),"Data-only rejection poisons reactivation");
        check(tracker.contains(".put(\"syncError\",syncError.isEmpty()?JSONObject.NULL:syncError)"),"Native state collapses control and outbox diagnostics");
        int open=activity.indexOf("case \"openDirections\":"),bound=activity.indexOf("case \"directions\":",open);
        String openCommand=activity.substring(open,bound);
        check(openCommand.contains("MapsLauncher.coordinates")&&!openCommand.contains("tracker.start(")&&!openCommand.contains("tracker.directions(")&&!openCommand.contains("prepare("),"Map opening requires background activation");
        check(openCommand.contains("continuous.canResume()")&&openCommand.contains("new ForegroundMapsHandoff(nonce,owner"),"Hidden-start token created without current enrolled permission");
        check(activity.contains("claimedHandoff=mapsHandoff;mapsHandoff=null;"),"Handoff can bind repeatedly");
        check(bind.contains("verify(response,member)")&&bind.contains("handoff.matches(snapshot.getDouble(\"latitude\"),snapshot.getDouble(\"longitude\"),SystemClock.elapsedRealtime())"),"Paused bind omits scope or exact snapshot check");
        check(bind.indexOf("handoff.matches(")<bind.indexOf("store.put(\"stopId\""),"Handoff persists before validating destination");
        String geo=TripStartCheck.block(activity,"onGeolocationPermissionsShowPrompt(");
        check(geo.contains("requestForegroundGeolocation(origin,callback)")&&!geo.contains("prepare("),"Visit foreground GPS is coupled to full tracking consent");
        check(activity.contains("if(request==GEOLOCATION){requestingGeolocation=false;completeForegroundGeolocation(foregroundLocationGranted())"),"Foreground permission callback never settles");
        check(activity.contains("if(request==PERMISSIONS){requestingTrackingPermissions=false;completeForegroundGeolocation(foregroundLocationGranted())"),"Concurrent tracking permission hides visit callback");
        check(activity.contains("completeForegroundGeolocation(false);prepared(\"تم إغلاق نافذة التطبيق"),"Destroyed native page leaves permission callbacks pending");
        for(String storeName:new String[]{"RouteStore.java","ContinuousRouteStore.java"}){
            String store=Files.readString(source.resolve(storeName));
            check(store.contains("ALTER TABLE gaps ADD COLUMN binding_known INTEGER NOT NULL DEFAULT 0")&&store.contains("ALTER TABLE points ADD COLUMN binding_known INTEGER NOT NULL DEFAULT 0"),"Unknown legacy evidence is relabeled during migration");
            if(storeName.equals("ContinuousRouteStore.java"))check(store.contains("SELECT date FROM points WHERE binding_known=0 UNION SELECT date FROM gaps WHERE binding_known=0")&&TripStartCheck.block(store,"synchronized boolean immutableBindings()").contains("ContinuousPolicy.uploadDateAllowed(c.getString(0))"),"Immutable capability drops eligible legacy evidence or blocks on quarantine");
            else check(store.contains("SELECT 1 FROM points WHERE binding_known=0 UNION SELECT 1 FROM gaps WHERE binding_known=0 LIMIT 1"),"Immutable capability omits legacy evidence");
            check(!TripStartCheck.block(store,"public void onUpgrade(").contains("DELETE"),"Version upgrade discards unsynced data");
        }
        System.out.println("Native activation recovery: "+checks+" checks passed (actual production policies and integration guards; device behavior unverified)");
    }
}

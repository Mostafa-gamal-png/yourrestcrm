package org.yourrest.crm;

import java.nio.file.Files;
import java.nio.file.Path;

/** Executes actual context policy plus the native evidence-preservation integration contract. */
public final class AccountRecoveryCheck {
    static int checks;
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    static AccountRecoveryPolicy.Decision decide(String oldScope,String scope,String oldRole,String role,int points,int gaps){return AccountRecoveryPolicy.decide("rep-1","rep-1",oldScope,scope,oldRole,role,points,gaps);}
    public static void main(String[] args)throws Exception{
        for(int points:new int[]{0,1,12000})for(int gaps:new int[]{0,1,192}){
            check(decide("west","west","rep","rep",points,gaps)==AccountRecoveryPolicy.Decision.UNCHANGED,"Unchanged context resets queued evidence");
            AccountRecoveryPolicy.Decision changed=points==0&&gaps==0?AccountRecoveryPolicy.Decision.RESET_EMPTY:AccountRecoveryPolicy.Decision.PRESERVE_BLOCKED;
            check(decide("west","east","rep","rep",points,gaps)==changed,"Scope change loses pending evidence");
            check(decide("east","west","rep","rep",points,gaps)==changed,"Reverse scope change loses pending evidence");
            check(decide("west","west","rep","supervisor",points,gaps)==changed,"Representative-to-manager transition loses evidence or deadlocks empty dispatch");
            check(decide("west","west","supervisor","rep",points,gaps)==changed,"Manager-to-representative transition loses evidence");
            check(AccountRecoveryPolicy.decide("rep-1","rep-2","west","east","rep","rep",points,gaps)==AccountRecoveryPolicy.Decision.WRONG_OWNER,"Another owner can inherit or reset prior evidence");
            check(OfflineRouteAuthorization.canResetEmptyOwner("rep-1","rep-2",points,gaps)==(points==0&&gaps==0),"Changing owner resets pending points or gaps instead of empty metadata only");
            check(!OfflineRouteAuthorization.canResetEmptyOwner("rep-1","rep-1",points,gaps),"Same-owner recovery unexpectedly resets its context");
        }
        Path source=Path.of(args.length>0?args[0]:"mobile/android/app/src/main/java/org/yourrest/crm");
        String legacy=Files.readString(source.resolve("RouteTracker.java")),continuous=Files.readString(source.resolve("ContinuousRouteTracker.java")),activity=Files.readString(source.resolve("MainActivity.java"));
        String failure=TripStartCheck.block(legacy,"private void handleFailure(");
        int rejected=failure.indexOf("if(status==401||status==403)"),end=failure.indexOf("else if(status==404)",rejected);
        String auth=failure.substring(rejected,end);
        check(auth.contains("halt()")&&!auth.contains("clearDay()"),"Legacy rejected authentication deletes unacknowledged evidence");
        String drain=TripStartCheck.block(legacy,"private void flushInternal(");
        check(drain.contains("member.equals(auth.optString(\"memberId\"))")&&drain.contains("day.optString(\"regionScope\").equals(auth.optString(\"regionScope\"))")&&drain.indexOf("JSONObject auth=api.call(null)")<drain.indexOf("OutboxDrain.run("),"Legacy evidence uploads before verifying the current owner and scope");
        String start=TripStartCheck.block(legacy,"void start(");
        int wrong=start.indexOf("if(previous!=null&&!memberId.equals"),next=start.indexOf("if(previous!=null){flushInternal",wrong);
        check(wrong>=0&&!start.substring(wrong,next).contains("clearDay()"),"Changing legacy owner clears data instead of rejecting");
        check(start.contains("store.count()>0||store.gapCount()>0||!store.get(\"endAt\").isEmpty()"),"Restart with gap-only backlog clears pending evidence");
        String migration=TripStartCheck.block(legacy,"void migrateForContinuous(");
        // A different owner may discard empty metadata, but must return before any
        // transfer. Nonempty evidence must still throw, for owner and scope changes.
        String ownerGuard="if(!memberId.equals(old.optString(\"memberId\")))";
        String scopeGuard="if(!regionScope.equals(old.optString(\"regionScope\")))";
        for(String marker:new String[]{ownerGuard,scopeGuard}){
            String guarded=TripStartCheck.block(migration,marker).trim();
            check(guarded.matches("(?s)^if\\s*\\(store\\.resetEmptyContext\\(\\)\\)\\s*return\\s+null\\s*;\\s*throw\\s+new\\s+RouteApi\\.Failure\\(403,.*\\);\\s*$"),"Changed owner/scope must return only after empty reset and reject pending evidence");
            int guardAt=migration.indexOf(marker),claimAt=migration.indexOf("target.put(\"memberId\",memberId)"),copyAt=migration.indexOf("target.point(");
            check(guardAt>=0&&claimAt>guardAt&&copyAt>claimAt,"Migration claims or copies evidence before checking old owner/scope");
        }
        String enroll=TripStartCheck.block(continuous,"void enroll(");
        check(enroll.indexOf("migrateForContinuous(")<enroll.indexOf("store.put(\"memberId\",member)"),"Failed legacy migration strands evidence behind a new current owner");
        String refresh=TripStartCheck.block(continuous,"void refreshAccount(");
        check(refresh.contains("api.call(null)")&&refresh.contains("member.equals(response.optString(\"memberId\"))"),"Scope recovery accepts a client-supplied role or region");
        check(refresh.contains("currentDay")&&refresh.contains("deviceId.equals(currentDay.optString(\"deviceId\"))"),"Scope recovery ignores an authenticated device conflict");
        check(refresh.contains("PRESERVE_BLOCKED")&&refresh.contains("disable(false)")&&refresh.contains("store.count()")&&refresh.contains("store.gapCount()")&&!refresh.contains("store.clear()"),"Permission change hides pending counts or removes queued evidence");
        for(String storeName:new String[]{"RouteStore.java","ContinuousRouteStore.java"}){
            String reset=TripStartCheck.block(Files.readString(source.resolve(storeName)),"synchronized boolean resetEmptyContext(");
            check(reset.contains("count()!=0||gapCount()!=0")&&!reset.contains("delete(\"points\"")&&!reset.contains("delete(\"gaps\""),"Empty-context recovery can remove queued observations");
            check(reset.stripLeading().startsWith("if(count()!=0||gapCount()!=0)return false;")&&reset.indexOf("return false;")<reset.indexOf(".delete("),"Empty-context recovery mutates metadata before checking both pending counts");
        }
        check(activity.contains("case \"refreshAccount\":tracker.refreshAccount(input.optString(\"memberId\"),reply)"),"Verified foreground context recovery is not available");
        check(continuous.contains(".put(\"regionScope\",optional(store.get(\"regionScope\")))")&&continuous.contains(".put(\"enrolledRole\",optional(store.get(\"memberRole\")))"),"Cold reload cannot identify persisted context");
        System.out.println("Native account recovery: "+checks+" checks passed (actual policy and evidence guards; phone transitions unverified)");
    }
}

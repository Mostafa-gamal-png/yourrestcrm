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
        // 1.0.16: a changed scope or role holds the queued evidence (under the scope it was captured with) and enrolls again; never a delete.
        String storeSource=Files.readString(source.resolve("ContinuousRouteStore.java")),hold=TripStartCheck.block(storeSource,"synchronized boolean holdForChangedAccount(");
        check(hold.indexOf("if(scope.isEmpty()||member.isEmpty())return false;")<hold.indexOf("beginTransaction()"),"Evidence of an unknown owner or scope is held");
        int copyPoints=hold.indexOf("INSERT OR IGNORE INTO held_points"),copyGaps=hold.indexOf("INSERT INTO held_gaps"),dropPoints=hold.indexOf("db.delete(\"points\""),success=hold.indexOf("setTransactionSuccessful()");
        check(hold.indexOf("beginTransaction()")<copyPoints&&copyPoints<dropPoints&&copyGaps<dropPoints&&dropPoints<success&&hold.contains("finally{db.endTransaction();}"),"Held evidence is not copied before the outbox is emptied, in one transaction");
        check(hold.contains("SELECT p.id,d.create_key,p.captured,p.date,p.body,p.binding_known FROM points p JOIN days d ON d.date=p.date")&&hold.contains("SELECT d.create_key,g.at,g.date,g.reason,g.stop_id,g.binding_known FROM gaps g JOIN days d ON d.date=g.date")&&hold.indexOf("for(String date:dates)key(date);")<copyPoints,"A held point or gap loses its id, capture time, date, payload, binding or the server day it belongs to");
        check(hold.contains("db.delete(\"meta\",\"key<>?\",new String[]{\"checkedExit\"})"),"Holding forgets the last handled system stop");
        String preserved=TripStartCheck.block(refresh,"if(decision==AccountRecoveryPolicy.Decision.PRESERVE_BLOCKED||decision==AccountRecoveryPolicy.Decision.RESET_EMPTY){");
        int disabledAt=preserved.indexOf("disable(false)"),heldAt=preserved.indexOf("store.holdForChangedAccount()"),enrollAt=preserved.indexOf("enroll(member,reply)");
        check(disabledAt>=0&&heldAt>disabledAt&&enrollAt>heldAt&&!preserved.contains("store.clear()")&&!preserved.contains("delete("),"A changed scope stops collection after holding, or enrolls before the evidence is held");
        check(preserved.contains("boolean resume=\"rep\".equals(response.optString(\"memberRole\"))&&consent()&&RouteTracker.get(context).permission()&&backgroundGranted(context)&&!\"1\".equals(store.get(\"userStopped\"))")&&preserved.indexOf("boolean resume")<disabledAt,"Enrollment resumes without consent, permissions or the representative role, after the user stopped the app, or depends on collection a background flush already disabled");
        String recover=TripStartCheck.block(continuous,"private void recoverEmptyScopeForEnrollment(");
        check(recover.indexOf("store.resetEmptyContext()")<recover.indexOf("holdForChangedAccount()")&&recover.contains("!member.equals(store.get(\"memberId\"))||!store.holdForChangedAccount()"),"Enrollment holds another owner's evidence or holds before trying the empty reset");
        String heldDrain=TripStartCheck.block(continuous,"private void drainHeld(");
        check(!heldDrain.contains("disable(")&&!heldDrain.contains("handle(")&&!heldDrain.contains("halt(")&&!heldDrain.contains("syncError")&&!heldDrain.contains("error="),"A held upload stops collection or reports an outbox failure");
        check(!heldDrain.contains(".delete(")&&heldDrain.contains("store.heldAck(batch,result.optJSONArray(\"acknowledgedIds\"))")&&heldDrain.contains("store.heldDeleteGap(gap.getLong(\"id\"))"),"Held evidence is deleted without a server acknowledgment");
        check(heldDrain.contains("TrackingFailurePolicy.heldRefused(failure.status)")&&heldDrain.contains("store.heldRefused(key,now)")&&heldDrain.contains("store.firstHeld(owner,now)")&&heldDrain.indexOf("if(failure.status==409){store.heldConflict(key,now);")<heldDrain.indexOf("TrackingFailurePolicy.heldRefused("),"A refused held group is retried at once, a conflict waits a day at once, or another owner's group is uploaded");
        check(heldDrain.contains(".put(\"held\",true)")&&TripStartCheck.block(continuous,"private JSONObject ensureHeldDay(").contains(".put(\"held\",true)")&&TripStartCheck.block(continuous,"private JSONObject ensureHeldDay(").contains("scope.equals(result.optString(\"regionScope\"))"),"A held upload is not marked held or accepts a day of another scope");
        String flush=TripStartCheck.block(continuous,"private void flushInternal(int maxOperations)");
        check(flush.contains("}finally{drainHeld(owner,expected,HELD_OPERATIONS);}"),"Held evidence waits behind an outbox date that cannot upload");
        String ensure=TripStartCheck.block(continuous,"private JSONObject ensureDay(");
        check(ensure.contains("synchronized(store){store.day(day);store.unholdInto(owner,store.get(\"regionScope\"),date,day.optString(\"id\"));}"),"A held group of the day the outbox gets back does not return before new points reach that day");
        check(TripStartCheck.block(continuous,"private JSONObject ensureHeldDay(").contains(".put(\"startedAt\",RouteRules.iso(span[0])).put(\"endedAt\",RouteRules.iso(span[1]+1000))"),"A held day claims more than its own evidence");
        check(flush.indexOf("drainHeld(owner,expected,HELD_OPERATIONS)")>flush.indexOf("for(int operations=0;")&&flush.indexOf("verify(auth,owner)")<flush.indexOf("drainHeld("),"Held evidence uploads before the account is verified or ahead of the outbox");
        check(TrackingFailurePolicy.heldRefused(400)&&TrackingFailurePolicy.heldRefused(403)&&TrackingFailurePolicy.heldRefused(425)&&!TrackingFailurePolicy.heldRefused(409)&&!TrackingFailurePolicy.heldRefused(401)&&!TrackingFailurePolicy.heldRefused(429)&&!TrackingFailurePolicy.heldRefused(408)&&!TrackingFailurePolicy.heldRefused(500)&&!TrackingFailurePolicy.heldRefused(200),"A held refusal waits on a lost session, a busy server or a server error");
        check(continuous.contains(".put(\"heldCount\",store.heldCount())")&&continuous.contains(".put(\"heldNotice\",optional(heldNotice()))"),"The page cannot see held evidence");
        System.out.println("Native account recovery: "+checks+" checks passed (actual policy and evidence guards; phone transitions unverified)");
    }
}

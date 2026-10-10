package org.yourrest.crm;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Regression guards for the authenticated bind, bridge completion and small sync pass. */
public final class TripStartCheck {
    static int checks;
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    static String block(String source,String marker){
        int begin=source.indexOf(marker);if(begin<0)throw new AssertionError("Missing method: "+marker);
        begin=source.indexOf('{',begin);int depth=1,end=begin+1;
        for(;end<source.length()&&depth>0;end++){char c=source.charAt(end);if(c=='{')depth++;else if(c=='}')depth--;}
        if(depth!=0)throw new AssertionError("Unbalanced source block");return source.substring(begin+1,end-1);
    }
    static final class QueuedRoute implements OutboxDrain.Source {
        final List<Long> points=new ArrayList<>(),gaps=new ArrayList<>(),sent=new ArrayList<>();
        int mutations;long observed=-1;boolean offline;
        public long earliestGapTime(){return gaps.isEmpty()?Long.MAX_VALUE:gaps.get(0);}
        public boolean uploadPointsThrough(long cutoff)throws Exception{
            List<Long> batch=new ArrayList<>();for(long time:points){if(time>cutoff||batch.size()==50)break;batch.add(time);}if(batch.isEmpty())return false;
            if(offline)throw new Exception("offline");mutations++;
            for(long time:batch){check(time>=observed,"Capture order changed");observed=time;sent.add(time);}points.removeAll(batch);return true;
        }
        public boolean uploadEarliestGap()throws Exception{
            if(gaps.isEmpty())return false;if(offline)throw new Exception("offline");mutations++;
            long time=gaps.remove(0);check(time>=observed,"Gap order changed");observed=time;sent.add(time);return true;
        }
    }
    public static void main(String[] args)throws Exception{
        Path source=Path.of(args.length>0?args[0]:"mobile/android/app/src/main/java/org/yourrest/crm");
        String tracker=Files.readString(source.resolve("ContinuousRouteTracker.java")),activity=Files.readString(source.resolve("MainActivity.java"));
        String bind=block(tracker,"private void bindInternal("),verify=block(tracker,"private void verify("),sync=block(tracker,"private void scheduleSync("),flush=block(tracker,"void flush("),drain=block(tracker,"private void flushInternal(int");
        check(!bind.contains("flushInternal("),"Binding drains unrelated location backlog");
        check(bind.contains("api.call(null);verify(response,member)"),"Binding skips authenticated server verification");
        check(bind.contains("!member.equals(store.get(\"memberId\"))")&&bind.contains("!canResume()"),"Binding skips enrollment/member checks");
        check(bind.contains("!stop.equals(active.optString(\"id\"))")&&bind.contains("!member.equals(active.optString(\"memberId\"))")&&bind.contains("!active.isNull(\"closedAt\")"),"Binding skips current stop verification");
        check(verify.contains("regionScope")&&verify.contains("memberRole")&&verify.contains("deviceId"),"Server verification omits authorization scope");
        check(bind.indexOf("expected!=generation")>bind.indexOf("verify(response,member)")&&bind.indexOf("expected!=generation")<bind.indexOf("store.put(\"stopId\""),"Binding changes state after cancellation");
        check(bind.contains("synchronized(store){store.put(\"stopId\""),"Customer binding is not atomic");
        check(!bind.contains("store.point(")&&!bind.contains("store.ack(")&&!bind.contains("store.clear("),"Binding mutates immutable queued observations");
        check(sync.contains("compareAndSet(false,true)")&&sync.contains("flushInternal(1)")&&sync.contains("syncQueued.set(false)"),"Scheduled sync loses coalescing or small pass");
        check(flush.contains("flushInternal(1);finish(reply,null)"),"App resume blocks behind a full outbox drain");
        check(tracker.contains("private void flushInternal()throws Exception{flushInternal(1);}"),"Explicit flush is no longer bounded");
        check(drain.contains("operations<maxOperations")&&drain.contains("store.firstDate()")&&drain.contains("store.firstGap(date)")&&drain.contains("store.batch(date,gap==null?Long.MAX_VALUE:gap.getLong(\"at\"))"),"Bounded sync skips chronological queue");
        check(drain.contains("store.ack(batch,result.optJSONArray(\"acknowledgedIds\"))")&&drain.contains("verifyDay(result,day)")&&drain.contains("checkCurrent(expected,owner)"),"Sync removes unacknowledged or unauthorized points");
        check(tracker.contains("Executors.newSingleThreadExecutor"),"Mutation worker no longer serialized");
        for(String mode:new String[]{"ContinuousRoute","Route"}){
            String store=Files.readString(source.resolve(mode+"Store.java")),state=Files.readString(source.resolve(mode+"Tracker.java"));
            check(block(store,"synchronized int gapCount()").contains("SELECT count(*) FROM gaps"),"Pending gap count substitutes point count: "+mode);
            String countMethod=mode.equals("ContinuousRoute")?"pendingGapCount":"gapCount";
            check(block(state,"JSONObject state()").contains(".put(\"pendingGapCount\",store."+countMethod+"())"),"Bridge omits durable pending gap count: "+mode);
        }
        String continuousStore=Files.readString(source.resolve("ContinuousRouteStore.java"));
        String firstDate=block(continuousStore,"synchronized String firstDate()"),firstGap=block(continuousStore,"synchronized JSONObject firstGap("),batch=block(continuousStore,"synchronized JSONArray batch("),notice=block(tracker,"private String quarantineNotice()");
        check(firstDate.contains("while(c.moveToNext())")&&firstDate.contains("ContinuousPolicy.uploadDateAllowed(date)")&&!firstDate.contains("LIMIT 1"),"A quarantined Friday date blocks Saturday selection");
        check(firstGap.contains("if(!ContinuousPolicy.uploadDateAllowed(date))return null")&&batch.contains("if(!ContinuousPolicy.uploadDateAllowed(date))return batch"),"Quarantined Friday points or gaps can enter an upload batch");
        check(!firstDate.contains("delete")&&!firstGap.contains("delete")&&!batch.contains("delete"),"Quarantine selection deletes original observations");
        check(block(continuousStore,"synchronized int count()").contains("SELECT count(*) FROM points")&&block(continuousStore,"synchronized int gapCount()").contains("SELECT count(*) FROM gaps"),"Quarantine removes evidence from account/capacity totals");
        check(block(continuousStore,"private int uploadableCount(").contains("ContinuousPolicy.uploadDateAllowed(c.getString(0))"),"Pending counts include blocked Friday evidence");
        check(block(tracker,"void tick()").contains("store.firstDate()!=null"),"Friday-only outbox causes endless paused-window upload retries");
        check(tracker.contains(".put(\"quarantineNotice\",optional(quarantineNotice()))")&&!notice.contains("syncError=")&&!notice.contains("error=")&&!notice.contains("disable(")&&!notice.contains("halt("),"Informational quarantine poisons tracking or synchronization readiness");
        String hidden=block(activity,"if(!resumed)");
        check(hidden.contains("reply.complete(")&&hidden.contains("return;")&&hidden.contains("claimedHandoff==null")&&hidden.contains("\"status\".equals(method)&&handoffCurrent"),"Hidden bridge lacks reply or narrow handoff guard");
        int guard=activity.indexOf("if(pageNonce.isEmpty()"),reply=activity.indexOf("RouteTracker.Reply reply=",guard),hiddenAt=activity.indexOf("if(!resumed)",reply);
        check(guard>=0&&guard<reply&&reply<hiddenAt&&activity.substring(guard,reply).contains("RouteRules.trusted(web.getUrl())"),"Hidden reply bypasses nonce or origin verification");
        for(String method:new String[]{"prepare","enroll","start","status","flush","stop","logout","directions","openDirections","refreshAccount"})check(activity.indexOf("case \""+method+"\"",hiddenAt)>hiddenAt,"Trusted method does not share hidden reply guard: "+method);
        // Exercise the actual audited drain scheduler with a backlog. A single pass must
        // yield, preserve retry data and eventually deliver all samples in capture order.
        QueuedRoute queue=new QueuedRoute();for(long i=1;i<=121;i++)queue.points.add(i);queue.gaps.add(60L);
        OutboxDrain.run(queue,1);check(queue.mutations==1&&queue.points.size()==71&&queue.gaps.size()==1,"One background pass drains beyond one operation");
        queue.offline=true;try{OutboxDrain.run(queue,1);throw new AssertionError("Expected offline retry");}catch(Exception expected){check(queue.points.size()==71&&queue.gaps.size()==1&&queue.mutations==1,"Offline pass loses queued work");}
        queue.offline=false;int passes=0;while(!queue.points.isEmpty()||!queue.gaps.isEmpty()){int before=queue.mutations;OutboxDrain.run(queue,1);check(queue.mutations-before==1,"Retry executes more than one queued mutation");check(++passes<20,"Bounded passes fail to finish backlog");}
        check(queue.sent.size()==122&&queue.sent.get(0)==1L&&queue.sent.get(queue.sent.size()-1)==121L,"Repeated bounded passes lose capture data");
        check(queue.sent.indexOf(60L)<queue.sent.indexOf(61L),"Bounded passes move a gap beyond later fixes");
        int before=queue.mutations;OutboxDrain.run(queue,1);check(queue.mutations==before,"Empty pass repeats acknowledged work");
        QueuedRoute onlyGaps=new QueuedRoute();onlyGaps.gaps.add(10L);onlyGaps.gaps.add(20L);
        check(onlyGaps.points.isEmpty()&&onlyGaps.gaps.size()==2,"A points-only count hides durable pending gaps");
        OutboxDrain.run(onlyGaps,1);check(onlyGaps.mutations==1&&onlyGaps.gaps.size()==1&&onlyGaps.sent.equals(List.of(10L)),"One bounded pass must expose leftover gaps");
        onlyGaps.offline=true;try{OutboxDrain.run(onlyGaps,1);throw new AssertionError("Expected offline gap retry");}catch(Exception expected){check(onlyGaps.gaps.size()==1&&onlyGaps.mutations==1,"Offline gap pass loses pending evidence");}
        onlyGaps.offline=false;OutboxDrain.run(onlyGaps,1);check(onlyGaps.points.isEmpty()&&onlyGaps.gaps.isEmpty()&&onlyGaps.sent.equals(List.of(10L,20L)),"Pending gap count cannot settle to zero after acknowledgment");
        System.out.println("Native trip-start regression: "+checks+" checks passed (source guards and actual outbox scheduler, simulated transport)");
    }
}

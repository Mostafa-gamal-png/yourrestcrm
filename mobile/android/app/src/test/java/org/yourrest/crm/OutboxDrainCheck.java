package org.yourrest.crm;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class OutboxDrainCheck {
    static int checks;
    static void check(boolean value){checks++;if(!value)throw new AssertionError("Outbox check "+checks);}
    static final class FakeServerAndStore implements OutboxDrain.Source {
        final List<Long> points=new ArrayList<>(),gaps=new ArrayList<>();final List<String> sent=new ArrayList<>();
        long serverTime=-1;boolean failNext;
        public long earliestGapTime(){return gaps.isEmpty()?Long.MAX_VALUE:gaps.get(0);}
        public boolean uploadPointsThrough(long cutoff)throws Exception{
            List<Long> batch=new ArrayList<>();for(long time:points){if(time>cutoff||batch.size()==50)break;batch.add(time);}if(batch.isEmpty())return false;
            if(failNext){failNext=false;throw new Exception("offline");}
            for(long time:batch){check(time>=serverTime);serverTime=time;sent.add("p"+time);}points.removeAll(batch);return true;
        }
        public boolean uploadEarliestGap()throws Exception{
            if(gaps.isEmpty())return false;if(failNext){failNext=false;throw new Exception("offline");}
            long time=gaps.get(0);check(time>=serverTime);serverTime=time;sent.add("g"+time);gaps.remove(0);return true;
        }
    }
    public static void main(String[] args)throws Exception{
        FakeServerAndStore a=new FakeServerAndStore();a.points.addAll(Arrays.asList(1L,3L,5L,7L));a.gaps.addAll(Arrays.asList(2L,5L,6L));
        OutboxDrain.run(a,20);check(a.sent.equals(Arrays.asList("p1","g2","p3","p5","g5","g6","p7")));check(a.points.isEmpty()&&a.gaps.isEmpty());
        FakeServerAndStore b=new FakeServerAndStore();for(long i=1;i<=120;i++)b.points.add(i);b.gaps.add(80L);
        OutboxDrain.run(b,1);check(b.points.size()==70&&b.gaps.size()==1);check(b.serverTime==50);
        b.failNext=true;try{OutboxDrain.run(b,20);throw new AssertionError("Expected network failure");}catch(Exception expected){check(b.points.size()==70&&b.gaps.size()==1);}
        OutboxDrain.run(b,20);check(b.points.isEmpty()&&b.gaps.isEmpty());check(b.sent.indexOf("g80")<b.sent.indexOf("p81"));
        FakeServerAndStore c=new FakeServerAndStore();c.gaps.addAll(Arrays.asList(10L,20L));OutboxDrain.run(c,20);check(c.sent.equals(Arrays.asList("g10","g20")));
        System.out.println("Native outbox ordering: "+checks+" checks passed (actual scheduler, simulated transport)");
    }
}

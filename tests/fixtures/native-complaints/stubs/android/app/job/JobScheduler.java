package android.app.job;
import java.util.HashMap;
import java.util.Map;
/** Stand-in: the scheduled jobs by id; it can be made to refuse. */
public class JobScheduler {
    public final Map<Integer, JobInfo> pending = new HashMap<>();
    public int scheduled, cancelled; public boolean refuse;
    public synchronized JobInfo getPendingJob(int id) { return pending.get(id); }
    public synchronized int schedule(JobInfo job) { if (refuse) throw new IllegalStateException("quota"); scheduled++; pending.put(job.id, job); return 1; }
    public synchronized void cancel(int id) { cancelled++; pending.remove(id); }
}

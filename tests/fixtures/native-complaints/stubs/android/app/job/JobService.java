package android.app.job;
/** Stand-in: a job service is a context; the checks read which jobs finished. */
public abstract class JobService extends android.content.Context {
    public final java.util.List<JobParameters> finished = new java.util.concurrent.CopyOnWriteArrayList<>();
    public abstract boolean onStartJob(JobParameters parameters);
    public abstract boolean onStopJob(JobParameters parameters);
    public final void jobFinished(JobParameters parameters, boolean reschedule) { finished.add(parameters); }
}

package org.yourrest.crm;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.webkit.CookieManager;
import java.util.concurrent.atomic.AtomicInteger;

/** The background alert check (AlertJobRules says the rules): a periodic, persisted JobScheduler job with a network constraint (the
 *  platform's own scheduler; the app carries no WorkManager, and none was added), so Android batches it under Doze and app-standby limits.
 *  It never opens GPS, asks no permission and starts no service: inside the work window it asks the complaint feed and the
 *  customer-service-request feed once each (each at most every ten minutes) and ends. It cancels itself when the phone holds no session;
 *  signing out cancels it; opening the app or loading a CRM page schedules it again. Uses only permissions the app already declares
 *  (RECEIVE_BOOT_COMPLETED for a persisted job, ACCESS_NETWORK_STATE for the network constraint). */
public final class AlertCheckJob extends JobService {
    private volatile JobParameters active;

    static void schedule(Context context) {
        try {
            JobScheduler jobs = context.getSystemService(JobScheduler.class);
            if (jobs == null || jobs.getPendingJob(AlertJobRules.JOB_ID) != null) return;
            jobs.schedule(new JobInfo.Builder(AlertJobRules.JOB_ID, new ComponentName(context, AlertCheckJob.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(AlertJobRules.PERIOD_MS)
                    .setPersisted(true)
                    .build());
        } catch (RuntimeException refused) {
            // A scheduler that refuses (job quota, a restricted profile) leaves the alerts to the app and the tracking service, as before.
        }
    }
    static void cancel(Context context) {
        try { JobScheduler jobs = context.getSystemService(JobScheduler.class); if (jobs != null) jobs.cancel(AlertJobRules.JOB_ID); }
        catch (RuntimeException ignored) { /* nothing scheduled */ }
    }
    static boolean signedIn() {
        try { return AlertJobRules.signedIn(CookieManager.getInstance().getCookie(RouteRules.ORIGIN)); }
        catch (RuntimeException unavailable) { return false; }
    }

    @Override public boolean onStartJob(JobParameters parameters) {
        if (!signedIn()) { cancel(this); return false; }
        if (!AlertJobRules.shouldPoll(System.currentTimeMillis())) return false;
        active = parameters;
        AtomicInteger left = new AtomicInteger(2);
        Runnable done = () -> { if (left.decrementAndGet() == 0 && active == parameters) { active = null; jobFinished(parameters, false); } };
        ServiceAlerts.pollInBackground(this, done);
        ComplaintAlerts.get(this).pollInBackground(done);
        return true;
    }
    @Override public boolean onStopJob(JobParameters parameters) {
        // Each feed request is bounded by its own timeouts; a stopped check waits for the next period.
        if (active == parameters) active = null;
        return false;
    }
}

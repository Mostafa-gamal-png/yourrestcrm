package org.yourrest.crm;

/** The main page's load, one attempt at a time (1.0.15): when it started and finished, whether it came up, and the failure the panel
 *  shows. Pure and used on the UI thread only: MainActivity feeds it WebView's callbacks and the probe's answers, LoadWatchCheck runs it
 *  on the JVM with a clock of its own. The probe is asked only while the app is in front (MainActivity stops asking in onPause). */
final class LoadWatch {
    private long attempt, startedAt = -1, finishedAt = -1, failedAt = -1;
    private boolean up;
    private LoadFailureRules.Failure failure;
    private LoadFailureRules.Probe lastProbe = LoadFailureRules.Probe.WAIT;

    /** The app loads a page itself (the first page, a notification's page, «إعادة المحاولة», the way back): a new attempt, whatever
     *  happened before. */
    void restart(long now) {
        attempt++; startedAt = now; finishedAt = -1; failedAt = -1; up = false; failure = null; lastProbe = LoadFailureRules.Probe.WAIT;
    }
    /** WebView started a main-frame page of the CRM. A new attempt, unless a hard failure holds the panel: WebView commits its own error
     *  page after a failed load, and that must not take the panel away. A soft failure (the page did not come up) gives way to the new
     *  page. Returns whether a new attempt began. */
    boolean pageStarted(long now) {
        if (hardFailure()) return false;
        restart(now);
        return true;
    }
    /** The first onPageFinished of the attempt counts. */
    void pageFinished(long now) { if (startedAt >= 0 && finishedAt < 0) finishedAt = now; }

    /** A failure of this attempt from one of WebView's callbacks. The first hard failure stays (WebView's own error after a cancelled
     *  handshake does not replace the security failure); a hard failure replaces a soft one; a soft one only when nothing is recorded. A
     *  page that had come up is no longer up. Returns whether the panel should show it. */
    boolean fail(LoadFailureRules.Failure next, long now) {
        if (next == null) return false;
        if (failure != null && (failure.hard() || !next.hard())) return false;
        if (startedAt < 0) startedAt = now;
        failure = next; failedAt = now; up = false;
        return true;
    }
    /** The probe's answer at «now» (null: no new answer, the last one stands): READY when the page shows something (a soft failure is
     *  then forgotten), NOT_STARTED once, when the watchdog says the page did not come up (recorded as the soft failure on url), otherwise
     *  WAIT. Nothing changes under a hard failure or once the page is up. */
    LoadFailureRules.Verdict probed(long now, LoadFailureRules.Probe probe, boolean foreground, String url) {
        if (probe != null) lastProbe = probe;
        if (startedAt < 0 || up || hardFailure()) return LoadFailureRules.Verdict.WAIT;
        LoadFailureRules.Verdict verdict = LoadFailureRules.watchdog(now - startedAt, finishedAt < 0 ? -1 : now - finishedAt, lastProbe, foreground);
        if (verdict == LoadFailureRules.Verdict.READY) { up = true; failure = null; failedAt = -1; return verdict; }
        if (verdict == LoadFailureRules.Verdict.NOT_STARTED) {
            if (failure != null) return LoadFailureRules.Verdict.WAIT;
            failure = LoadFailureRules.Failure.notStarted(lastProbe, now - startedAt, url); failedAt = now;
        }
        return verdict;
    }
    /** Whether the page should still be asked: until it is up; after «the page did not come up» for LATE_WATCH_MS more (it may appear
     *  after all, and the panel then goes); never under a hard failure. */
    boolean watching(long now) {
        if (startedAt < 0 || up) return false;
        if (failure == null) return true;
        return !failure.hard() && now - failedAt < LoadFailureRules.LATE_WATCH_MS;
    }
    boolean up() { return up; }
    LoadFailureRules.Failure failure() { return failure; }
    boolean hardFailure() { return failure != null && failure.hard(); }
    LoadFailureRules.Probe lastProbe() { return lastProbe; }
    /** Which attempt an answer belongs to: an answer of an earlier attempt is dropped. */
    long attempt() { return attempt; }
}

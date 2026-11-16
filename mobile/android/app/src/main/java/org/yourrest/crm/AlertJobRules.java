package org.yourrest.crm;

/** Pure rules of the background alert check (the owner, 2026-11-16, item 3 of the GSCO list, after GSCO's Android 1.4.9): «فحص في الخلفية
 *  كل 15 دقيقة، من 06:00 لـ 18:00 بتوقيت السعودية، ما عدا الجمعة، حتى لو تسجيل خط السير مقفول». Every fifteen minutes (the shortest period
 *  Android's job scheduler allows), even with the route tracking off, so managers, supervisors and customer service get the complaint and
 *  the customer-service-request alerts with the app closed. It runs only while the phone holds a session of the CRM, and asks the server only
 *  inside the work window (ContinuousPolicy: 06:00 to 18:00 Riyadh, not Friday); each feed keeps its own ten-minute cadence, so a check right
 *  after the app or the tracking service asked costs nothing. No Android types, so the JVM check runs exactly this. */
final class AlertJobRules {
    static final int JOB_ID = 4501;
    static final long PERIOD_MS = 15L * 60 * 1000;
    /** Signed in: the phone holds the CRM's session cookie (the feeds' own 401 then clears what a stale one left). */
    static boolean signedIn(String cookie) { return cookie != null && !cookie.trim().isEmpty(); }
    /** Ask the server only inside the work window (Saudi time, not Friday); outside it the check ends at once. */
    static boolean shouldPoll(long now) { return ContinuousPolicy.inWindow(now); }
    private AlertJobRules() { }
}

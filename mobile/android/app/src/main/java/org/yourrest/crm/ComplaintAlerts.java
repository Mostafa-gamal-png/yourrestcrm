package org.yourrest.crm;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** «شكوى تنتظرك» on the phone (the owner, 2026-11-16, item 3 of the GSCO list; ComplaintAlertRules says the rules): the customer complaints
 *  that wait for the signed-in member (the review by the customer-service manager, the correction and the closure by the registrar, the
 *  assignment by the sales manager, the delegation by the supervisor, the contact and the resolution by the holder). Asked when the app
 *  opens, every ten minutes from the route tracking service, and from the background check (AlertCheckJob) every fifteen minutes inside the
 *  working window even with route tracking off. One notification per complaint, high importance first, in Arabic or English as the person
 *  chose in the CRM page; renewed when its step starts again, taken away when the holder opens it or it no longer waits for them. A tap
 *  opens the complaint. Keeps only complaint ids and stamps, per account; never the texts. */
final class ComplaintAlerts {
    interface Fetcher { JSONObject fetch() throws Exception; }
    static final String OPEN = "org.yourrest.crm.OPEN_COMPLAINT", EXTRA = "complaintId", CHANNEL = "complaints", PREFS = "complaint-alerts";
    private static ComplaintAlerts instance;
    static synchronized ComplaintAlerts get(Context context) { if (instance == null) instance = new ComplaintAlerts(context.getApplicationContext(), new ComplaintAlertApi()); return instance; }

    private final Context context;
    private final Fetcher fetcher;
    private final NotificationManager notifications;
    private final SharedPreferences prefs;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> { Thread thread = new Thread(task, "YourrestComplaintAlerts"); thread.setDaemon(true); return thread; });
    private final AtomicBoolean polling = new AtomicBoolean();
    /** Bumped by a sign-out: a request that started before it never applies its answer afterwards. */
    private final AtomicInteger generation = new AtomicInteger();

    ComplaintAlerts(Context context, Fetcher fetcher) {
        this.context = context; this.fetcher = fetcher;
        notifications = context.getSystemService(NotificationManager.class);
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Opening or returning to the app asks (at most once a minute). */
    void pollNow() { poll(true, null); }
    /** The tracking service's heartbeat: inside the working window, every ten minutes. */
    void pollIfDue() { poll(false, null); }
    /** The background check (AlertCheckJob), with the same cadence; `done` runs once the answer (or nothing) has been applied. */
    void pollInBackground(Runnable done) { poll(false, done); }
    /** Whether a request is under way (for the checks). */
    boolean busy() { return polling.get(); }

    private void poll(boolean opening, Runnable done) {
        long now = System.currentTimeMillis();
        if (!ComplaintAlertRules.shouldPoll(now, lastPollAt(), ContinuousPolicy.inWindow(now), opening) || !polling.compareAndSet(false, true)) { if (done != null) done.run(); return; }
        prefs.edit().putString("lastPollAt", Long.toString(now)).apply();
        final int started = generation.get();
        try {
            worker.execute(() -> {
                try {
                    ComplaintAlertRules.Feed feed = ComplaintAlertFeed.parse(fetcher.fetch());
                    synchronized (this) { if (started == generation.get()) apply(feed); }
                } catch (ServiceAlertApi.Failure denied) {
                    synchronized (this) {
                        if (started != generation.get()) return;
                        // 401/403: no session or no access; what is shown belongs to a session that no longer applies.
                        if (denied.status == 401 || denied.status == 403) clearAll();
                        // 404: the complaints are hidden from this account; the notices go, what was shown is remembered.
                        else if (denied.status == 404) cancelShown();
                    }
                } catch (Exception ignored) {
                    // Offline, a server fault or a feed the app cannot read: keep what is shown, try again at the next cadence.
                } finally { polling.set(false); if (done != null) done.run(); }
            });
        } catch (RuntimeException refused) { polling.set(false); if (done != null) done.run(); }
    }
    private long lastPollAt() { try { return Long.parseLong(prefs.getString("lastPollAt", "0")); } catch (NumberFormatException damaged) { return 0; } }

    /** Applies a feed: another account's notices go first, then what left or was opened, then the new ones, high importance first. */
    private void apply(ComplaintAlertRules.Feed feed) {
        String owner = prefs.getString("member", "");
        if (!owner.isEmpty() && !owner.equals(feed.memberId)) cancelShown();
        Map<String, String> remembered = owner.equals(feed.memberId) ? load() : new LinkedHashMap<>();
        ComplaintAlertRules.Decision decision = ComplaintAlertRules.decide(remembered, feed.alerts);
        for (String id : decision.cancel) notifications.cancel(ComplaintAlertRules.tag(id), ComplaintAlertRules.NOTIFICATION_ID);
        save(feed.memberId, decision.remembered);
        // In front of the person the page shows the complaints and their count: announcing them again is noise (as the service-request alerts).
        if (!decision.notify.isEmpty() && !MainActivity.resumed && allowed()) {
            boolean english = english();
            ensureChannel(english);
            List<String> order = new ArrayList<>(decision.remembered.keySet());
            for (ComplaintAlertRules.Alert alert : decision.notify) show(alert, english, order.indexOf(alert.id));
        }
        summary(english());
    }
    private boolean allowed() {
        if (!notifications.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationChannel channel = notifications.getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    private boolean english() { return NearbyRules.english(context.getSharedPreferences("native", Context.MODE_PRIVATE).getString("language", "ar")); }
    private void ensureChannel(boolean english) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, ComplaintAlertRules.channelName(english), NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(ComplaintAlertRules.channelDescription(english));
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        notifications.createNotificationChannel(channel);
    }
    private PendingIntent opener(String id) {
        Intent open = new Intent(context, MainActivity.class).setAction(OPEN).putExtra(EXTRA, id).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, (CHANNEL + id).hashCode() & 0x7fffffff, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private void show(ComplaintAlertRules.Alert alert, boolean english, int position) {
        if (ComplaintAlertRules.complaintFragment(alert.id) == null) return;
        String text = ComplaintAlertRules.message(alert, english);
        // The lock screen shows only a generic title; the customer and the step appear after unlocking.
        Notification lockScreen = new Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_service_request).setContentTitle(ComplaintAlertRules.publicTitle(english)).build();
        Notification notice = new Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_service_request).setContentTitle(ComplaintAlertRules.title(english)).setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(opener(alert.id)).setAutoCancel(true).setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(lockScreen)
                .setGroup(ComplaintAlertRules.GROUP).setSortKey(ComplaintAlertRules.sortKey(alert, position)).build();
        notifications.cancel(ComplaintAlertRules.tag(alert.id), ComplaintAlertRules.NOTIFICATION_ID);
        notifications.notify(ComplaintAlertRules.tag(alert.id), ComplaintAlertRules.NOTIFICATION_ID, notice);
    }
    /** Two complaint notices or more are bundled under one summary (the count); fewer take it away. */
    private void summary(boolean english) {
        int shown = 0;
        try { for (StatusBarNotification active : notifications.getActiveNotifications()) if (active.getId() == ComplaintAlertRules.NOTIFICATION_ID && active.getTag() != null && active.getTag().startsWith("yourrest-complaint:")) shown++; }
        catch (RuntimeException unreadable) { return; }
        if (shown < 2 || !allowed()) { notifications.cancel(ComplaintAlertRules.GROUP, ComplaintAlertRules.SUMMARY_ID); return; }
        ensureChannel(english);
        Notification lockScreen = new Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_service_request).setContentTitle(ComplaintAlertRules.publicTitle(english)).build();
        notifications.notify(ComplaintAlertRules.GROUP, ComplaintAlertRules.SUMMARY_ID, new Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_service_request)
                .setContentTitle(ComplaintAlertRules.summaryTitle(english)).setContentText(ComplaintAlertRules.summaryText(shown, english)).setGroup(ComplaintAlertRules.GROUP).setGroupSummary(true)
                .setOnlyAlertOnce(true).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(lockScreen).build());
    }
    private void cancelShown() {
        for (Map.Entry<String, String> entry : load().entrySet()) if (ComplaintAlertRules.shown(entry.getValue())) notifications.cancel(ComplaintAlertRules.tag(entry.getKey()), ComplaintAlertRules.NOTIFICATION_ID);
        notifications.cancel(ComplaintAlertRules.GROUP, ComplaintAlertRules.SUMMARY_ID);
    }
    private void clearAll() { cancelShown(); prefs.edit().remove("member").remove("remembered").apply(); }
    /** Signing out: nothing of the previous account stays visible, and a request already under way never applies its answer. */
    void logout() { generation.incrementAndGet(); synchronized (this) { clearAll(); } }
    /** The account the last feed was read for, or empty (none since signing out, or a refused session). */
    String member() { return prefs.getString("member", ""); }
    private Map<String, String> load() {
        Map<String, String> out = new LinkedHashMap<>();
        try {
            JSONObject saved = new JSONObject(prefs.getString("remembered", "{}"));
            for (Iterator<String> keys = saved.keys(); keys.hasNext(); ) { String key = keys.next(); if (RouteRules.identifier(key)) out.put(key, saved.optString(key, "")); }
        } catch (Exception damaged) { out.clear(); }
        return out;
    }
    private void save(String member, Map<String, String> remembered) {
        try {
            JSONObject stored = new JSONObject();
            for (Map.Entry<String, String> entry : remembered.entrySet()) stored.put(entry.getKey(), entry.getValue());
            prefs.edit().putString("member", member).putString("remembered", stored.toString()).apply();
        } catch (Exception invalid) { /* nothing is saved; the next feed decides again */ }
    }
    /** The complaint a tapped notification names; null for any other intent. */
    static String requestedComplaint(Intent intent) {
        if (intent == null || !OPEN.equals(intent.getAction())) return null;
        String id = intent.getStringExtra(EXTRA);
        return RouteRules.identifier(id) ? id : null;
    }
}

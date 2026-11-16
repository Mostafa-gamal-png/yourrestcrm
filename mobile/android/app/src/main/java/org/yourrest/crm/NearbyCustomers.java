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
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** «تنبيه المصانع القريبة» on the phone (NearbyRules says the rules). It rides on the representative's consented route tracking: it reads
 *  the fixes the tracking already receives and starts no GPS, asks no permission and writes no CRM record. The list comes from the
 *  server (NearbyApi) every five minutes while fixes arrive, and again just before a notification; a list that is old, about another
 *  account or region, or refused (401, 403, 404) is not used. Who was told today is kept per member on the phone (ids and days only). */
final class NearbyCustomers {
    static final String OPEN = "org.yourrest.crm.OPEN_NEARBY_CUSTOMER", EXTRA = "nearbyCustomerId";
    static final String CHANNEL = "nearby-customers", TAG = "yourrest-nearby:";
    private static NearbyCustomers instance;
    static synchronized NearbyCustomers get(Context context) { if (instance == null) instance = new NearbyCustomers(context.getApplicationContext()); return instance; }

    private final Context context;
    private final NotificationManager notifications;
    private final SharedPreferences prefs;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> { Thread thread = new Thread(task, "YourrestNearby"); thread.setDaemon(true); return thread; });
    private final NearbyApi api = new NearbyApi();
    private NearbyRules rules = new NearbyRules();
    private List<NearbyRules.Target> targets = Collections.emptyList();
    private String member = "", scope = "";
    private long generation, expiresElapsed, receivedElapsed, nextRequestElapsed, lastRequestElapsed;
    private boolean fetching;
    private Location latest;
    private final LinkedHashSet<String> pending = new LinkedHashSet<>();

    private NearbyCustomers(Context context) {
        this.context = context;
        notifications = context.getSystemService(NotificationManager.class);
        prefs = context.getSharedPreferences("nearby-customers", Context.MODE_PRIVATE);
        // A new process needs a fresh answer of the server before anything is shown as current.
        cancelNotifications();
    }

    /** A notification names one customer id; only the app's own action and a plain identifier are accepted. */
    static String requestedCustomer(Intent intent) {
        if (intent == null || !OPEN.equals(intent.getAction())) return null;
        String id = intent.getStringExtra(EXTRA);
        return RouteRules.identifier(id) ? id : null;
    }

    /** A fix the route tracking has just accepted and stored for this enrolled representative. Never throws to the tracker. */
    synchronized void onFix(Location location, String owner, String regionScope) {
        try {
            if (!switchTo(owner, regionScope) || !allowed()) return;
            long now = System.currentTimeMillis(), elapsed = SystemClock.elapsedRealtime(), capturedElapsed = location.getElapsedRealtimeNanos() / 1_000_000;
            if (mock(location) || !location.hasAccuracy()
                    || !NearbyRules.fresh(location.getLatitude(), location.getLongitude(), location.getAccuracy(), location.getTime(), now, capturedElapsed, elapsed)) return;
            if (latest != null && capturedElapsed <= latest.getElapsedRealtimeNanos() / 1_000_000) return;
            latest = new Location(location);
            if (!catalogFresh(elapsed)) dropCatalog();
            List<NearbyRules.Target> found = rules.fixAll(targets, location.getLatitude(), location.getLongitude(), location.getAccuracy(), location.getTime(), now, capturedElapsed, elapsed);
            for (NearbyRules.Target target : found) pending.add(target.id);
            // The server is asked again just before a notification, unless its list came in the last minute.
            if (!pending.isEmpty() && catalogFresh(elapsed) && elapsed - receivedElapsed < NearbyRules.RECHECK_MS) { notifyPending(); return; }
            request(!pending.isEmpty(), elapsed);
        } catch (RuntimeException ignored) { /* a fault here never stops the route tracking */ }
    }
    /** A request to the server is under way (the JVM checks wait on it). */
    synchronized boolean busy() { return fetching; }
    /** Logout, an account or a permission change: forget the list and this member, and take the shown notices away. */
    synchronized void clear() {
        generation++; member = ""; scope = ""; targets = Collections.emptyList(); latest = null; pending.clear();
        expiresElapsed = 0; receivedElapsed = 0; nextRequestElapsed = 0; lastRequestElapsed = 0; fetching = false; rules = new NearbyRules();
        cancelNotifications();
    }
    /** The tracking paused (18:00, Friday) or stopped: no list and no evidence until fixes come again; who was told today is kept. */
    synchronized void suspend() {
        generation++; targets = Collections.emptyList(); latest = null; pending.clear();
        expiresElapsed = 0; receivedElapsed = 0; nextRequestElapsed = 0; fetching = false; rules.resetEvidence();
    }

    private boolean switchTo(String owner, String regionScope) {
        if (!RouteRules.identifier(owner) || regionScope == null || regionScope.isEmpty()) { if (!member.isEmpty()) clear(); return false; }
        if (owner.equals(member) && regionScope.equals(scope)) return true;
        // Another member or other regions: a new list and new evidence. Who was told today is read back as this member saved it (a
        // region change keeps it; another member on the same phone has a record of their own, or none).
        clear();
        member = owner; scope = regionScope;
        try {
            JSONObject record = new JSONObject(prefs.getString(key(owner), "{}")), saved = record.optJSONObject("notices");
            Map<String, String> seen = new HashMap<>();
            if (saved != null) for (Iterator<String> keys = saved.keys(); keys.hasNext(); ) { String id = keys.next(); seen.put(id, saved.optString(id)); }
            rules.restore(seen, record.optLong("last", 0));
        } catch (Exception damaged) { rules.restore(Collections.emptyMap(), 0); }
        return true;
    }
    private boolean allowed() {
        return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                && (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
    }
    @SuppressWarnings("deprecation")
    private static boolean mock(Location location) { return Build.VERSION.SDK_INT >= 31 ? location.isMock() : location.isFromMockProvider(); }
    private boolean catalogFresh(long elapsed) { return NearbyRules.leaseFresh(expiresElapsed, receivedElapsed, elapsed); }
    private void dropCatalog() { targets = Collections.emptyList(); expiresElapsed = 0; receivedElapsed = 0; rules.resetEvidence(); }

    private void request(boolean recheck, long elapsed) {
        if (member.isEmpty() || fetching || !NearbyRules.requestDue(elapsed, nextRequestElapsed, lastRequestElapsed, recheck)) return;
        fetching = true; lastRequestElapsed = elapsed;
        final long expected = generation, requested = elapsed;
        final String owner = member, region = scope;
        worker.execute(() -> {
            JSONObject answer = null; int status = 0;
            try { answer = api.fetch(); status = 200; }
            catch (NearbyApi.Failure failure) { status = failure.status; }
            catch (Exception offline) { status = 0; }
            synchronized (NearbyCustomers.this) {
                if (expected != generation || !owner.equals(member)) return;
                fetching = false;
                if (answer != null) {
                    try { accept(answer, owner, region, requested); }
                    catch (Exception invalid) { status = 0; answer = null; }
                }
                nextRequestElapsed = NearbyRules.nextRequest(requested, answer != null ? 200 : status);
                if (answer != null) { try { notifyPending(); } catch (RuntimeException ignored) { /* the system refused the notice */ } return; }
                // No usable answer: nothing is told on an old list; a refusal also takes the shown notices away.
                pending.clear(); dropCatalog();
                if (NearbyRules.stops(status)) cancelNotifications();
            }
        });
    }
    private void accept(JSONObject json, String owner, String region, long requested) throws Exception {
        long server = RouteRules.millis(json.getString("serverTime")), expires = RouteRules.millis(json.getString("expiresAt"));
        if (!NearbyRules.validCatalog(json.getInt("schemaVersion"), json.getString("memberId"), json.getString("memberRole"), json.getString("regionScope"), owner, region, server, expires))
            throw new IllegalArgumentException("Another account, region or time");
        JSONArray rows = json.getJSONArray("customers");
        if (rows.length() > NearbyRules.MAX_TARGETS) throw new IllegalArgumentException("Too many");
        List<NearbyRules.Target> parsed = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            NearbyRules.Target target = NearbyRules.target(row.opt("id"), row.opt("name"), row.opt("latitude"), row.opt("longitude"), row.isNull("daysSinceVisit") ? null : row.opt("daysSinceVisit"));
            if (!ids.add(target.id)) throw new IllegalArgumentException("Duplicate customer");
            parsed.add(target);
        }
        // A customer that moved on the map starts its evidence again.
        for (NearbyRules.Target prior : targets) for (NearbyRules.Target current : parsed)
            if (prior.id.equals(current.id) && (prior.latitude != current.latitude || prior.longitude != current.longitude)) rules.resetEvidence();
        targets = parsed; rules.retain(targets);
        receivedElapsed = requested; expiresElapsed = requested + (expires - server);
    }
    /** Tells of the customers confirmed at the latest fix that the fresh list still names, still within 1 km and not told today, in one
     *  notification. Their «told today» is saved first: if it cannot be saved nothing is shown, so a crash never repeats a notice. */
    private void notifyPending() {
        long now = System.currentTimeMillis(), elapsed = SystemClock.elapsedRealtime();
        List<NearbyRules.Target> found = new ArrayList<>();
        final Location at = latest;
        if (at != null && catalogFresh(elapsed)
                && NearbyRules.fresh(at.getLatitude(), at.getLongitude(), at.getAccuracy(), at.getTime(), now, at.getElapsedRealtimeNanos() / 1_000_000, elapsed))
            for (NearbyRules.Target target : targets)
                if (pending.contains(target.id) && rules.confirmed(target.id, at.getTime()) && rules.canNotify(target.id, now)
                        && NearbyRules.inside(NearbyRules.distance(at.getLatitude(), at.getLongitude(), target.latitude, target.longitude))) found.add(target);
        pending.clear();
        if (found.isEmpty() || !allowed() || !notifications.areNotificationsEnabled()) return;
        boolean english = NearbyRules.english(context.getSharedPreferences("native", Context.MODE_PRIVATE).getString("language", "ar"));
        NotificationChannel channel = new NotificationChannel(CHANNEL, NearbyRules.channelName(english), NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription(NearbyRules.channelDescription(english));
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        notifications.createNotificationChannel(channel);
        NotificationChannel current = notifications.getNotificationChannel(CHANNEL);
        if (current == null || current.getImportance() == NotificationManager.IMPORTANCE_NONE) return;
        found.sort((a, b) -> { int order = Double.compare(NearbyRules.distance(at.getLatitude(), at.getLongitude(), a.latitude, a.longitude), NearbyRules.distance(at.getLatitude(), at.getLongitude(), b.latitude, b.longitude)); return order != 0 ? order : a.id.compareTo(b.id); });
        List<Double> metres = new ArrayList<>();
        for (NearbyRules.Target target : found) metres.add(NearbyRules.distance(at.getLatitude(), at.getLongitude(), target.latitude, target.longitude));
        for (NearbyRules.Target target : found) rules.notified(target.id, now);
        if (!save(now)) return;
        NearbyRules.Target nearest = found.get(0);
        Intent open = new Intent(context, MainActivity.class).setAction(OPEN).putExtra(EXTRA, nearest.id)
                .setData(Uri.parse("yourrest://nearby/" + nearest.id + "/" + now)).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent target = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification lockScreen = new Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_location).setContentTitle(NearbyRules.publicTitle(english)).build();
        String message = NearbyRules.message(found, metres, english);
        Notification notice = new Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_location)
                .setContentTitle(NearbyRules.title(found.size(), english)).setContentText(NearbyRules.summary(found, metres, english))
                .setStyle(new Notification.BigTextStyle().bigText(message)).setContentIntent(target).setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(lockScreen)
                .setTimeoutAfter(Math.min(NearbyRules.NOTICE_TIMEOUT_MS, Math.max(1, ContinuousPolicy.windowEnd(now) - now))).build();
        // Each notification keeps its own tag: a later one never removes an earlier one not read yet.
        notifications.notify(TAG + now, 1, notice);
    }
    /** This member's «told today» (ids and days only, no name or place), written before the notice shows; other members' records go
     *  after two days, and at most 64 are kept. */
    private boolean save(long now) {
        try {
            JSONObject record = new JSONObject().put("notices", new JSONObject(rules.notices())).put("last", rules.lastNotice());
            SharedPreferences.Editor edit = prefs.edit();
            String mine = key(member);
            int kept = 0;
            for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
                if (entry.getKey().equals(mine)) continue;
                if (!entry.getKey().startsWith("limits:")) { edit.remove(entry.getKey()); continue; }
                try { JSONObject prior = new JSONObject(String.valueOf(entry.getValue())); if (now - prior.optLong("last", 0) > 172_800_000L || ++kept > 63) edit.remove(entry.getKey()); }
                catch (Exception damaged) { edit.remove(entry.getKey()); }
            }
            edit.putString(mine, record.toString());
            return edit.commit();
        } catch (Exception storageFailure) { return false; }
    }
    private static String key(String owner) {
        try {
            byte[] bytes = java.security.MessageDigest.getInstance("SHA-256").digest(owner.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder value = new StringBuilder("limits:");
            for (byte b : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            return value.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private void cancelNotifications() {
        try { for (StatusBarNotification notice : notifications.getActiveNotifications()) if (notice.getTag() != null && notice.getTag().startsWith(TAG)) notifications.cancel(notice.getTag(), notice.getId()); }
        catch (RuntimeException ignored) { /* nothing shown, or the system refused the list */ }
    }
}

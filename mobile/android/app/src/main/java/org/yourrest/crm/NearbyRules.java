package org.yourrest.crm;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Pure rules of «تنبيه المصانع القريبة» (the owner, 2026-11-16, item 7 of the GSCO comparison list; GSCO's grouped nearby-project
 *  reminder of its Android 1.4.8 with the owner's numbers). The server lists the customers the representative is responsible for that
 *  have not been visited for 60 days or more and have a saved location (GET /api/nearby-customers); the app tells of those within 1 km of
 *  a live fix of the route tracking (06:00–18:00 Riyadh, not Friday): confirmed by two fixes at least 15 seconds apart, every customer
 *  inside at the same fix in one notification (the nearest first), the same customer at most once a Riyadh day, 30 seconds at least
 *  between two notifications. Only the server's fresh list and real fixes count; nothing here starts GPS, asks a permission or writes a
 *  CRM record. */
final class NearbyRules {
    static final double RADIUS_METRES = 1000, MAX_ACCURACY = 75;
    static final long DEBOUNCE_MS = 15_000, MAX_PAIR_GAP_MS = 90_000, MAX_FIX_AGE_MS = 60_000, GLOBAL_COOLDOWN_MS = 30_000;
    /** The list is valid ten minutes at most and asked again every five; just before a notification it is asked again unless it came
     *  in the last minute; never two requests within fifteen seconds; a failed request is tried again after a minute. */
    static final long MAX_CATALOG_MS = 600_000, REFRESH_MS = 300_000, RECHECK_MS = 60_000, MIN_REQUEST_GAP_MS = 15_000, FAILURE_RETRY_MS = 60_000;
    /** A notification is about being near now: it goes by itself after ten minutes, or at 18:00 if sooner (as GSCO's). */
    static final long NOTICE_TIMEOUT_MS = 600_000;
    static final int MAX_TARGETS = 2000, MAX_NAME = 200, MAX_DAYS = 100_000;
    static final String PATH = "/api/nearby-customers";

    /** One customer of the server's list. daysSinceVisit: whole days since the latest visit; -1: never visited. */
    static final class Target {
        final String id, name;
        final double latitude, longitude;
        final int daysSinceVisit;
        Target(String id, String name, double latitude, double longitude, int daysSinceVisit) {
            String clean = name == null ? "" : name.replaceAll("[\\s\\p{Cntrl}]+", " ").trim();
            if (!RouteRules.identifier(id) || clean.isEmpty() || clean.length() > MAX_NAME || !RouteRules.validCoordinates(latitude, longitude)
                    || daysSinceVisit < -1 || daysSinceVisit > MAX_DAYS) throw new IllegalArgumentException("Invalid customer");
            this.id = id; this.name = clean; this.latitude = latitude; this.longitude = longitude; this.daysSinceVisit = daysSinceVisit;
        }
    }
    /** A row of the answer as JSON gives it: strings, numbers, and null for «never visited». Anything else refuses the row (and the
     *  caller the whole list: a list the app cannot read whole is not used). */
    static Target target(Object id, Object name, Object latitude, Object longitude, Object days) {
        if (!(id instanceof String) || !(name instanceof String) || !(latitude instanceof Number) || !(longitude instanceof Number)) throw new IllegalArgumentException("Invalid customer");
        int since = -1;
        if (days != null) {
            if (!(days instanceof Number)) throw new IllegalArgumentException("Invalid days");
            double value = ((Number) days).doubleValue();
            if (!Double.isFinite(value) || value != Math.rint(value) || value < 0 || value > MAX_DAYS) throw new IllegalArgumentException("Invalid days");
            since = (int) value;
        }
        return new Target((String) id, (String) name, ((Number) latitude).doubleValue(), ((Number) longitude).doubleValue(), since);
    }

    static double distance(double a, double b, double c, double d) {
        double x = Math.toRadians(c - a), y = Math.toRadians(d - b);
        double h = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(Math.toRadians(a)) * Math.cos(Math.toRadians(c)) * Math.sin(y / 2) * Math.sin(y / 2);
        return 6_371_000 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
    }
    /** Within 1 km: the distance of the fix itself (a fix less precise than 75 m is not used at all). */
    static boolean inside(double metres) { return Double.isFinite(metres) && metres >= 0 && metres <= RADIUS_METRES; }
    /** A live fix of the tracking hours: precise enough, not older than a minute by both clocks, inside the window, the same Riyadh day. */
    static boolean fresh(double latitude, double longitude, float accuracy, long captured, long now, long elapsed, long nowElapsed) {
        return RouteRules.validCoordinates(latitude, longitude) && Float.isFinite(accuracy) && accuracy > 0 && accuracy <= MAX_ACCURACY
                && captured > 0 && captured <= now && now - captured <= MAX_FIX_AGE_MS && elapsed > 0 && elapsed <= nowElapsed && nowElapsed - elapsed <= MAX_FIX_AGE_MS
                && ContinuousPolicy.inWindow(now) && ContinuousPolicy.inWindow(captured) && ContinuousPolicy.date(now).equals(ContinuousPolicy.date(captured));
    }
    /** The answer is about the representative the phone records the route for, in the same regions, and valid for ten minutes at most. */
    static boolean validCatalog(int schema, String member, String role, String scope, String expectedMember, String expectedScope, long serverAt, long expiresAt) {
        return schema == 1 && RouteRules.identifier(expectedMember) && expectedMember.equals(member) && "rep".equals(role)
                && expectedScope != null && !expectedScope.isEmpty() && expectedScope.equals(scope)
                && serverAt > 0 && expiresAt > serverAt && expiresAt - serverAt <= MAX_CATALOG_MS;
    }
    /** The list, received at receivedElapsed (the request's start), still holds at nowElapsed. */
    static boolean leaseFresh(long expiresElapsed, long receivedElapsed, long nowElapsed) {
        return receivedElapsed > 0 && nowElapsed >= receivedElapsed && nowElapsed < expiresElapsed;
    }
    /** The session ended (401), the account may not have the list (403) or «العملاء» is hidden from it (404): nothing is told. */
    static boolean stops(int status) { return status == 401 || status == 403 || status == 404; }
    /** When to ask the server next, after an answer (status 200) or a failure (any other status; 0 for no answer at all). */
    static long nextRequest(long requestedElapsed, int status) { return requestedElapsed + (status == 200 || stops(status) ? REFRESH_MS : FAILURE_RETRY_MS); }
    /** Due: the time has come, or a notification waits for a fresh list and the last request is fifteen seconds old. */
    static boolean requestDue(long nowElapsed, long nextElapsed, long lastRequestElapsed, boolean recheck) {
        return nowElapsed >= nextElapsed || recheck && (lastRequestElapsed == 0 || nowElapsed - lastRequestElapsed >= MIN_REQUEST_GAP_MS);
    }

    private static final class Entry { long first, last; boolean inside; }
    private final Map<String, Entry> entries = new HashMap<>();
    /** Customer id -> the Riyadh day it was told on; only today's entries are kept. */
    private final Map<String, String> notified = new HashMap<>();
    private long lastNotice, lastCaptured, lastElapsed;

    /** The customers newly confirmed inside at this fix and not told today, the nearest first. Calling this tells nobody. */
    List<Target> fixAll(Collection<Target> targets, double latitude, double longitude, float accuracy, long captured, long now, long elapsed, long nowElapsed) {
        if (!fresh(latitude, longitude, accuracy, captured, now, elapsed, nowElapsed) || captured <= lastCaptured || elapsed <= lastElapsed) return Collections.emptyList();
        lastCaptured = captured; lastElapsed = elapsed;
        final Map<Target, Double> eligible = new HashMap<>();
        for (Target target : targets) {
            double metres = distance(latitude, longitude, target.latitude, target.longitude);
            Entry entry = entries.get(target.id);
            if (entry == null) { entry = new Entry(); entries.put(target.id, entry); }
            // A long silence or a new day starts the evidence again: two fixes far apart are not two fixes in a row.
            if (entry.last > 0 && (captured - entry.last > MAX_PAIR_GAP_MS || !ContinuousPolicy.date(captured).equals(ContinuousPolicy.date(entry.last)))) { entry.first = 0; entry.inside = false; }
            entry.last = captured;
            if (!inside(metres)) { entry.first = 0; entry.inside = false; continue; }
            if (entry.first == 0) entry.first = captured;
            if (captured - entry.first >= DEBOUNCE_MS) { entry.inside = true; if (canNotify(target.id, now)) eligible.put(target, metres); }
        }
        List<Target> ordered = new ArrayList<>(eligible.keySet());
        ordered.sort((a, b) -> { int byDistance = Double.compare(eligible.get(a), eligible.get(b)); return byDistance != 0 ? byDistance : a.id.compareTo(b.id); });
        return ordered;
    }
    /** Inside and confirmed at exactly this fix (the latest one this object read). */
    boolean confirmed(String id, long captured) {
        Entry entry = entries.get(id);
        return entry != null && entry.inside && entry.first > 0 && entry.last == captured && captured - entry.first >= DEBOUNCE_MS;
    }
    /** In the tracking hours, not told today, and 30 seconds since the last notification (a clock set back does not hold it). */
    boolean canNotify(String id, long now) {
        return ContinuousPolicy.inWindow(now) && !ContinuousPolicy.date(now).equals(notified.get(id))
                && (lastNotice == 0 || now < lastNotice || now - lastNotice >= GLOBAL_COOLDOWN_MS);
    }
    /** Remembers a notification (the caller saves this before showing it, so a crash never repeats one); older days are forgotten. */
    void notified(String id, long now) {
        String day = ContinuousPolicy.date(now);
        notified.values().removeIf(value -> !day.equals(value));
        notified.put(id, day);
        lastNotice = now;
    }
    /** What a previous process of this member remembered: ids with a valid day; the last notification time. */
    void restore(Map<String, String> seen, long last) {
        notified.clear();
        for (Map.Entry<String, String> entry : seen.entrySet()) {
            if (notified.size() >= MAX_TARGETS) break;
            if (RouteRules.identifier(entry.getKey()) && entry.getValue() != null && entry.getValue().matches("\\d{4}-\\d{2}-\\d{2}")) notified.put(entry.getKey(), entry.getValue());
        }
        lastNotice = Math.max(0, last);
    }
    Map<String, String> notices() { return new HashMap<>(notified); }
    long lastNotice() { return lastNotice; }
    /** Drops the evidence of customers that left the list. */
    void retain(Collection<Target> targets) { java.util.Set<String> ids = new java.util.HashSet<>(); for (Target target : targets) ids.add(target.id); entries.keySet().retainAll(ids); }
    /** A pause, a new list or a lost fix: the next entry has to be confirmed again; who was told today is kept. */
    void resetEvidence() { entries.clear(); lastCaptured = 0; lastElapsed = 0; }

    // ---- The words. Arabic (the app's default) or English, as the person chose in the CRM page (localStorage «yr-language»).
    /** The page's language as evaluateJavascript returns localStorage.getItem('yr-language'): "en" for English, "ar" for anything
     *  else the page shows in Arabic (nothing saved included); null when the page could not be read (keep what was known). */
    static String pageLanguage(String evaluated) {
        if (evaluated == null) return null;
        String value = evaluated.trim();
        if (value.equals("\"en\"")) return "en";
        if (value.equals("null") || value.equals("\"ar\"") || value.startsWith("\"")) return "ar";
        return null;
    }
    static boolean english(String language) { return "en".equals(language); }
    static String title(int count, boolean english) {
        if (count < 1) throw new IllegalArgumentException("No customer");
        if (english) return count == 1 ? "A factory near you needs a visit" : count + " factories near you need a visit";
        if (count == 1) return "مصنع قريب منك بحاجة إلى زيارة";
        if (count == 2) return "مصنعان قريبان منك بحاجة إلى زيارة";
        int rest = count % 100;
        if (rest >= 3 && rest <= 10) return count + " مصانع قريبة منك بحاجة إلى زيارة";
        if (rest >= 11) return count + " مصنعًا قريبًا منك بحاجة إلى زيارة";
        return count + " مصنع قريب منك بحاجة إلى زيارة";
    }
    static String metres(double metres, boolean english) {
        if (!Double.isFinite(metres)) throw new IllegalArgumentException("Invalid distance");
        long rounded = Math.max(0L, Math.round(metres));
        return english ? rounded + " m away" : "على بعد " + rounded + " م";
    }
    /** «آخر زيارة قبل 75 يومًا» / "last visit 75 days ago"; -1: «لم تُسجَّل له زيارة» / "no visit recorded". */
    static String lastVisit(int days, boolean english) {
        if (days < 0) return english ? "no visit recorded" : "لم تُسجَّل له زيارة";
        if (english) return "last visit " + days + (days == 1 ? " day" : " days") + " ago";
        return "آخر زيارة قبل " + arabicDays(days);
    }
    static String arabicDays(int days) {
        if (days == 1) return "يوم واحد";
        if (days == 2) return "يومين";
        int rest = days % 100;
        if (rest >= 3 && rest <= 10) return days + " أيام";
        if (rest >= 11) return days + " يومًا";
        return days + " يوم";
    }
    static String line(Target target, double metres, boolean english) {
        return target.name + " — " + metres(metres, english) + " · " + lastVisit(target.daysSinceVisit, english);
    }
    /** The expanded text: one customer as one line; several as a list, the nearest first. */
    static String message(List<Target> targets, List<Double> metres, boolean english) {
        if (targets == null || metres == null || targets.isEmpty() || targets.size() != metres.size()) throw new IllegalArgumentException("Invalid group");
        if (targets.size() == 1) return line(targets.get(0), metres.get(0), english);
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < targets.size(); i++) { if (i > 0) text.append('\n'); text.append("• ").append(line(targets.get(i), metres.get(i), english)); }
        return text.toString();
    }
    /** The one line the notification shows folded: the customer, or the nearest of several. */
    static String summary(List<Target> targets, List<Double> metres, boolean english) {
        if (targets == null || metres == null || targets.isEmpty() || targets.size() != metres.size()) throw new IllegalArgumentException("Invalid group");
        if (targets.size() == 1) return line(targets.get(0), metres.get(0), english);
        return (english ? "Nearest: " : "الأقرب: ") + targets.get(0).name + " — " + metres(metres.get(0), english);
    }
    /** The lock screen shows this only; the names appear after unlocking. */
    static String publicTitle(boolean english) { return english ? "Yourrest: nearby factories need a visit" : "يورست: مصانع قريبة بحاجة إلى زيارة"; }
    static String channelName(boolean english) { return english ? "Nearby factories" : "المصانع القريبة"; }
    static String channelDescription(boolean english) {
        return english ? "A notice when you come within 1 km of a factory you are responsible for that has had no visit for 60 days or more, during the location recording hours"
                : "تنبيه عند اقترابك لمسافة كيلومتر من مصنع مسؤول عنه لم تُسجَّل له زيارة منذ 60 يومًا أو أكثر، في ساعات تسجيل الموقع";
    }
    /** The page opened by a tap: «خريطة المصانع» on the nearest customer (the page checks the id against its own data). */
    static String openFragment(String id) { return RouteRules.identifier(id) ? "#nearby=" + id : null; }

    NearbyRules() { }
}

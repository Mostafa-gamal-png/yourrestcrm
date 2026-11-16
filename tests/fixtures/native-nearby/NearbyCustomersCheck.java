package org.yourrest.crm;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.location.Location;
import android.os.SystemClock;
import java.util.Locale;

/** The real NearbyCustomers (mobile/android) run against Android stand-ins (tests/fixtures/native-nearby/stubs) with a clock and a server
 *  the check moves and answers by hand: the list asked once and again before a notification, one grouped notification with its words in
 *  Arabic and English, once a Riyadh day across a restart and the next morning, a customer the fresh list dropped, another account's or
 *  region's list, an empty list, no network, a revoked session (401), a refused account (403) and a hidden screen (404), a muted channel,
 *  notices switched off, a refused permission, a mock, imprecise or late fix, the hours, a failed save, logout, a pause and another member
 *  on the phone. Not an Android device test: no GPS, notification shade or real server. */
public final class NearbyCustomersCheck {
    private static int checks;
    private static void check(boolean value, String what) { checks++; if (!value) throw new AssertionError("Check " + checks + " failed: " + what); }
    private static final double LAT = 24.7136, LON = 46.6753;
    private static double north(double metres) { return LAT + Math.toDegrees(metres / 6_371_000.0); }
    /** Tuesday 2026-10-06 10:00 in Riyadh, and the elapsed clock at that moment. */
    private static final long T0 = RouteRules.millis("2026-10-06T07:00:00.000Z"), E0 = 1_000_000;
    private static long wall = T0, elapsed = E0;
    private static Context context;
    private static NearbyCustomers nearby;

    private static void at(long wallMs, long elapsedMs) { wall = wallMs; elapsed = elapsedMs; System.now = wallMs; SystemClock.now = elapsedMs; }
    private static void advance(long ms) { at(wall + ms, elapsed + ms); }
    private static Location fix(double latitude) { return new Location(latitude, LON, 10, wall, elapsed); }
    /** One fix of the route tracking now, then wait for the request it may have started to finish. */
    private static void now(double latitude, String owner, String scope) throws Exception { nearby.onFix(fix(latitude), owner, scope); settle(); }
    /** Fifteen seconds later, one fix. */
    private static void step(double latitude, String owner, String scope) throws Exception { advance(15_000); now(latitude, owner, scope); }
    private static void step(Location location, String owner, String scope) throws Exception { nearby.onFix(location, owner, scope); settle(); }
    private static void settle() throws Exception { for (int i = 0; i < 1000 && nearby.busy(); i++) Thread.sleep(5); if (nearby.busy()) throw new AssertionError("a request did not finish within five seconds"); }
    /** A new «process»: the singleton goes; the preference stores and the notification manager stay. */
    private static void restart() throws Exception {
        java.lang.reflect.Field field = NearbyCustomers.class.getDeclaredField("instance"); field.setAccessible(true); field.set(null, null);
        nearby = NearbyCustomers.get(context);
    }
    private static String row(String id, String name, double latitude, Integer days) {
        return "{\"id\":\"" + id + "\",\"name\":\"" + name + "\",\"latitude\":" + latitude + ",\"longitude\":" + LON + ",\"daysSinceVisit\":" + (days == null ? "null" : days) + "}";
    }
    private static String catalog(String member, String scope, String... rows) {
        return "{\"schemaVersion\":1,\"memberId\":\"" + member + "\",\"memberRole\":\"rep\",\"regionScope\":\"" + scope + "\",\"serverTime\":\"2026-10-06T07:00:00.000Z\""
                + ",\"expiresAt\":\"2026-10-06T07:10:00.000Z\",\"refreshAfterSeconds\":300,\"customers\":[" + String.join(",", rows) + "]}";
    }
    private static NotificationManager manager() { return context.manager; }
    private static int posted() { return manager().posted.size(); }
    private static Notification last() { return manager().posted.get(manager().posted.size() - 1); }
    private static boolean arabic(String text) { return text != null && text.matches("(?s).*[\\u0600-\\u06ff].*"); }
    private static String saved(String member) throws Exception { return Context.stores.get("nearby-customers").getString(savedKey(member), ""); }
    /** The record key NearbyCustomers uses for a member: "limits:" and the SHA-256 of the id. */
    private static String savedKey(String member) throws Exception {
        byte[] bytes = java.security.MessageDigest.getInstance("SHA-256").digest(member.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder value = new StringBuilder("limits:");
        for (byte one : bytes) value.append(String.format(Locale.ROOT, "%02x", one & 255));
        return value.toString();
    }

    public static void main(String[] args) throws Exception {
        at(T0, E0);
        context = new Context();
        nearby = NearbyCustomers.get(context);
        // The phone stands at P. A is 300 m north (75 days), B 800 m (never visited), C 1500 m (61 days), E 3000 m (90 days).
        String a = row("cust-a", "مصنع الأمل", north(300), 75), b = row("cust-b", "مصنع النور", north(800), null), c = row("cust-c", "مصنع الجزيرة", north(1500), 61), e = row("cust-e", "مصنع الشرق", north(3000), 90);
        NearbyApi.current = catalog("rep-a", "eastern", a, b, c, e);

        // ---- 1. The list, the confirmation and one grouped notification.
        now(LAT, "rep-a", "eastern");
        check(NearbyApi.calls == 1 && posted() == 0, "the first fix asks for the list and tells nothing");
        step(LAT, "rep-a", "eastern");
        check(posted() == 0, "the first fix with the list starts the evidence");
        step(LAT, "rep-a", "eastern");
        check(NearbyApi.calls == 1, "a list of thirty seconds is not asked again"); check(posted() == 1, "A and B, within 1 km, in one notification; C at 1500 m is not");
        Notification notice = last();
        check(notice.title.equals("مصنعان قريبان منك بحاجة إلى زيارة"), "the Arabic title for two: " + notice.title);
        check(notice.big.equals("• مصنع الأمل — على بعد 300 م · آخر زيارة قبل 75 يومًا\n• مصنع النور — على بعد 800 م · لم تُسجَّل له زيارة"), "both lines, the nearest first: " + notice.big);
        check(notice.text.equals("الأقرب: مصنع الأمل — على بعد 300 م"), "the folded line names the nearest: " + notice.text);
        check(notice.channel.equals(NearbyCustomers.CHANNEL) && manager().channels.get(NearbyCustomers.CHANNEL).name.toString().equals("المصانع القريبة"), "its own channel, named in Arabic");
        check(manager().channels.get(NearbyCustomers.CHANNEL).importance == NotificationManager.IMPORTANCE_DEFAULT && arabic(manager().channels.get(NearbyCustomers.CHANNEL).description), "default importance, described");
        check(notice.visibility == Notification.VISIBILITY_PRIVATE && notice.publicVersion != null && notice.publicVersion.title.equals("يورست: مصانع قريبة بحاجة إلى زيارة") && notice.publicVersion.big == null && notice.publicVersion.text == null, "the lock screen shows a generic title only");
        check(notice.autoCancel && Notification.CATEGORY_REMINDER.equals(notice.category) && notice.timeoutAfter == 600_000, "a reminder that goes away by itself after ten minutes");
        check(NearbyCustomers.OPEN.equals(notice.intent.intent.action) && "cust-a".equals(notice.intent.intent.extras.get(NearbyCustomers.EXTRA)) && notice.intent.intent.target == MainActivity.class, "a tap opens the app on the nearest customer");
        check("cust-a".equals(NearbyCustomers.requestedCustomer(notice.intent.intent)) && (notice.intent.flags & android.app.PendingIntent.FLAG_IMMUTABLE) != 0, "the activity reads the id back; an immutable pending intent");
        check(manager().postedTags.get(0).startsWith(NearbyCustomers.TAG), "tagged as a nearby notice");
        String record = saved("rep-a");
        check(record.contains("\"cust-a\":\"2026-10-06\"") && record.contains("\"cust-b\":\"2026-10-06\"") && !record.contains("مصنع") && !record.contains("24.7"), "who was told is saved: ids and the day only, no name or place");
        for (int i = 0; i < 6; i++) step(LAT, "rep-a", "eastern");
        check(posted() == 1 && NearbyApi.calls == 1, "staying there: the same customers are not told twice a day");

        // ---- 2. Near C: confirmed, the list is older than a minute, so it is asked again just before; then C alone.
        step(north(1500), "rep-a", "eastern"); check(posted() == 1, "C needs a second fix");
        step(north(1500), "rep-a", "eastern");
        check(NearbyApi.calls == 2, "the list is asked again just before the notification"); check(posted() == 2, "C is told");
        check(last().title.equals("مصنع قريب منك بحاجة إلى زيارة") && last().text.equals("مصنع الجزيرة — على بعد 0 م · آخر زيارة قبل 61 يومًا") && last().big.equals(last().text), "one customer: its own line, " + last().text);
        check("cust-c".equals(last().intent.intent.extras.get(NearbyCustomers.EXTRA)), "the tap names C");
        // ---- 3. E is confirmed, but the fresh list no longer names it (visited meanwhile, or given to another): nothing.
        NearbyApi.current = catalog("rep-a", "eastern", a, b, c);
        advance(45_000); now(north(3000), "rep-a", "eastern"); step(north(3000), "rep-a", "eastern");
        check(NearbyApi.calls == 3 && posted() == 2, "a customer the fresh list dropped is not told");
        step(north(3000), "rep-a", "eastern"); check(posted() == 2 && NearbyApi.calls == 3, "and stays untold, with no new request");

        // ---- 4. A restart the same day: the shown notices go (a new process needs a fresh answer); nothing is repeated.
        check(manager().active.size() == 2, "two notices are shown");
        restart();
        check(manager().active.isEmpty(), "a new process takes the shown notices away");
        NearbyApi.current = catalog("rep-a", "eastern", a, b, c, e);
        advance(30_000); now(LAT, "rep-a", "eastern"); step(LAT, "rep-a", "eastern"); step(LAT, "rep-a", "eastern");
        check(NearbyApi.calls == 4 && posted() == 2, "after a restart the same day, A and B are confirmed but not told again");

        // ---- 5. The next working morning (06:00:10 Riyadh): a new Riyadh day; the old list expired and is asked again.
        at(RouteRules.millis("2026-10-07T03:00:10.000Z"), elapsed + 60_000_000L);
        now(LAT, "rep-a", "eastern"); check(NearbyApi.calls == 5, "an expired list is asked again");
        step(LAT, "rep-a", "eastern"); step(LAT, "rep-a", "eastern");
        check(posted() == 3 && last().title.equals("مصنعان قريبان منك بحاجة إلى زيارة"), "the next day A and B are told again");
        record = saved("rep-a");
        check(record.contains("\"cust-a\":\"2026-10-07\"") && !record.contains("2026-10-06"), "yesterday's ids are forgotten");

        // ---- 6. A muted channel: nothing shown and nothing remembered; switched on again, the next confirmation is told.
        manager().channels.get(NearbyCustomers.CHANNEL).importance = NotificationManager.IMPORTANCE_NONE;
        step(north(1500), "rep-a", "eastern"); step(north(1500), "rep-a", "eastern");
        check(NearbyApi.calls == 6 && posted() == 3 && !saved("rep-a").contains("cust-c"), "a muted channel: nothing shown or remembered");
        manager().channels.get(NearbyCustomers.CHANNEL).importance = NotificationManager.IMPORTANCE_DEFAULT;
        step(north(1500), "rep-a", "eastern");
        check(posted() == 4 && last().text.startsWith("مصنع الجزيرة"), "switched on again, C is told");

        // ---- 7. Notices off, the permission refused, mock, imprecise and late fixes, and the evening: nothing.
        String f = row("cust-f", "مصنع الوادي", north(6000), 100), g = row("cust-g", "مصنع الساحل", north(9000), 200);
        NearbyApi.current = catalog("rep-a", "eastern", a, b, c, e, f, g);
        advance(285_000); now(north(6000), "rep-a", "eastern"); check(NearbyApi.calls == 7, "the list is asked every five minutes");
        manager().enabled = false;
        step(north(6000), "rep-a", "eastern"); step(north(6000), "rep-a", "eastern");
        check(posted() == 4, "notices switched off: nothing"); manager().enabled = true;
        Context.postNotifications = false;
        step(north(6000), "rep-a", "eastern"); check(posted() == 4, "the notification permission refused: nothing"); Context.postNotifications = true;
        step(north(6000), "rep-a", "eastern");
        check(NearbyApi.calls == 8 && posted() == 5 && last().text.equals("مصنع الوادي — على بعد 0 م · آخر زيارة قبل 100 يوم"), "F was kept for when notices are back: " + last().text);
        for (int i = 0; i < 2; i++) { advance(15_000); Location mock = fix(north(9000)); mock.mock = true; step(mock, "rep-a", "eastern"); }
        check(posted() == 5, "a mock location tells nothing");
        for (int i = 0; i < 2; i++) { advance(15_000); step(new Location(north(9000), LON, 76, wall, elapsed), "rep-a", "eastern"); }
        check(posted() == 5, "fixes less precise than 75 m tell nothing");
        advance(15_000); step(new Location(north(9000), LON, 10, wall - 61_000, elapsed - 61_000), "rep-a", "eastern");
        check(posted() == 5, "a fix older than a minute tells nothing");
        step(north(9000), "rep-a", "eastern"); step(north(9000), "rep-a", "eastern");
        check(posted() == 6 && last().text.startsWith("مصنع الساحل"), "real fixes afterwards tell G");
        at(RouteRules.millis("2026-10-07T15:00:05.000Z"), elapsed + 43_000_000L);
        now(LAT, "rep-a", "eastern"); step(LAT, "rep-a", "eastern"); step(LAT, "rep-a", "eastern");
        check(posted() == 6, "after 18:00 nothing is told");

        // ---- 8. A failed save shows nothing (and the day's mark stays: a crash or a retry never tells twice).
        at(RouteRules.millis("2026-10-08T05:00:00.000Z"), elapsed + 50_000_000L);
        NearbyApi.current = catalog("rep-a", "eastern", a, b);
        Context.stores.get("nearby-customers").failCommit = true;
        now(LAT, "rep-a", "eastern"); step(LAT, "rep-a", "eastern"); step(LAT, "rep-a", "eastern");
        check(posted() == 6 && !saved("rep-a").contains("2026-10-08"), "the save failed: nothing shown");
        Context.stores.get("nearby-customers").failCommit = false;

        // ---- 9. Another member signs in on the same phone, in English: rep-a's notices go; rep-b starts with nothing remembered.
        check(!manager().active.isEmpty(), "rep-a's notices are shown");
        Context.stores.computeIfAbsent("native", key -> new android.content.SharedPreferences()).edit().putString("language", "en").commit();
        NearbyApi.current = catalog("rep-b", "central", row("cust-l", "Al Amal Blocks", north(120), 75), row("cust-m", "Noor Factory", north(310), null));
        step(LAT, "rep-b", "central");
        check(manager().active.isEmpty(), "another member: the shown notices of the first go");
        step(LAT, "rep-b", "central"); step(LAT, "rep-b", "central");
        check(posted() == 7, "rep-b is told");
        notice = last();
        check(notice.title.equals("2 factories near you need a visit"), "English title: " + notice.title);
        check(notice.big.equals("• Al Amal Blocks — 120 m away · last visit 75 days ago\n• Noor Factory — 310 m away · no visit recorded"), "English lines: " + notice.big);
        check(notice.text.equals("Nearest: Al Amal Blocks — 120 m away") && notice.publicVersion.title.equals("Yourrest: nearby factories need a visit"), "English folded line and lock screen");
        check(manager().channels.get(NearbyCustomers.CHANNEL).name.toString().equals("Nearby factories") && !arabic(manager().channels.get(NearbyCustomers.CHANNEL).description), "the channel in English too");
        for (String text : new String[]{notice.title, notice.text, notice.big, notice.publicVersion.title}) check(!arabic(text), "no Arabic in English: " + text);
        check(saved("rep-b").contains("cust-l") && !saved("rep-b").contains("cust-a"), "each member keeps their own record");
        Context.stores.get("native").edit().putString("language", "ar").commit();

        // ---- 10. A list about another account or another region, and an empty list: nothing.
        String n = row("cust-n", "مصنع جديد", north(6000), 70);
        NearbyApi.current = catalog("rep-a", "central", n);
        int before = NearbyApi.calls;
        advance(270_000); now(north(6000), "rep-b", "central"); step(north(6000), "rep-b", "central"); step(north(6000), "rep-b", "central");
        check(NearbyApi.calls == before + 1 && posted() == 7, "another account's list: asked, not used");
        NearbyApi.current = catalog("rep-b", "eastern", n);
        advance(60_000); now(north(6000), "rep-b", "central"); step(north(6000), "rep-b", "central"); step(north(6000), "rep-b", "central");
        check(NearbyApi.calls == before + 2 && posted() == 7, "another region's list: asked again a minute later, not used");
        NearbyApi.current = catalog("rep-b", "central");
        advance(60_000); now(LAT, "rep-b", "central"); for (int i = 0; i < 4; i++) step(LAT, "rep-b", "central");
        check(posted() == 7, "an empty list tells nothing");
        // ---- 11. No network: nothing; asked again a minute later.
        NearbyApi.current = null;
        int asked = NearbyApi.calls;
        advance(240_000); now(north(6000), "rep-b", "central"); check(NearbyApi.calls == asked + 1, "the list is asked when due");
        step(north(6000), "rep-b", "central"); check(NearbyApi.calls == asked + 1 && posted() == 7, "no network: nothing, and no new request within the minute");
        NearbyApi.current = catalog("rep-b", "central", n);
        advance(45_000); now(north(6000), "rep-b", "central"); check(NearbyApi.calls == asked + 2, "asked again a minute after the failure");
        step(north(6000), "rep-b", "central"); step(north(6000), "rep-b", "central");
        check(posted() == 8 && last().title.equals("مصنع قريب منك بحاجة إلى زيارة"), "then told, in Arabic again");

        // ---- 12. The session revoked (401), the account refused (403), «العملاء» hidden (404): the list and the shown notices go, and
        //          nothing is asked for five minutes.
        for (int status : new int[]{401, 403, 404}) {
            if (status == 401) check(!manager().active.isEmpty(), "a notice is shown before the refusal");
            NearbyApi.answers.add(status);
            asked = NearbyApi.calls;
            advance(300_000); now(north(9000), "rep-b", "central");
            check(NearbyApi.calls == asked + 1 && manager().active.isEmpty(), status + ": the shown notices are taken away");
            for (int i = 0; i < 8; i++) step(north(9000), "rep-b", "central");
            check(NearbyApi.calls == asked + 1 && posted() == 8, status + ": nothing told and nothing asked for five minutes");
        }

        // ---- 13. Logout (the tracker's disable): the shown notices go and the member is forgotten.
        NearbyApi.current = catalog("rep-b", "central", row("cust-q", "مصنع القمة", north(9000), 65));
        advance(180_000); now(north(9000), "rep-b", "central"); step(north(9000), "rep-b", "central"); step(north(9000), "rep-b", "central");
        check(posted() == 9 && !manager().active.isEmpty(), "told again once the server answers");
        nearby.clear();
        check(manager().active.isEmpty(), "logout takes the notices away");
        asked = NearbyApi.calls;
        advance(15_000);
        nearby.onFix(fix(north(9000)), "", "central"); nearby.onFix(fix(north(9000)), "../x", "central"); nearby.onFix(fix(north(9000)), "rep-b", ""); settle();
        check(NearbyApi.calls == asked, "no member, a malformed id or no region: nothing is asked");
        // ---- 14. The tracking paused (suspend): no list and no evidence; the next fixes start again.
        NearbyApi.current = catalog("rep-b", "central", row("cust-r", "مصنع الربوة", north(12000), 80));
        step(north(12000), "rep-b", "central"); step(north(12000), "rep-b", "central");
        nearby.suspend();
        step(north(12000), "rep-b", "central"); step(north(12000), "rep-b", "central");
        check(posted() == 9, "after a pause the list and the evidence start again");
        step(north(12000), "rep-b", "central");
        check(posted() == 10 && last().text.startsWith("مصنع الربوة"), "then the customer is told");

        java.lang.System.out.println(String.format(Locale.ROOT, "Nearby customer notices (the real NearbyCustomers on Android stand-ins): %d checks passed (no Android device, GPS or notification shade)", checks));
        java.lang.System.exit(0);
    }
}

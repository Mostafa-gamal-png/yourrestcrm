package org.yourrest.crm;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Real JVM checks of «تنبيه المصانع القريبة» (NearbyRules): the 1 km edge, the confirmation, the grouping, once a Riyadh day, the
 *  cooldown, the list's identity and lease, the requests, and the words in Arabic and English. Not an Android GPS or notification test. */
public final class NearbyRulesCheck {
    private static int checks;
    /** Tuesday 2026-10-06 10:00 in Riyadh. */
    private static final long NOW = RouteRules.millis("2026-10-06T07:00:00.000Z"), ELAPSED = 1_000_000;
    private static final NearbyRules.Target A = new NearbyRules.Target("cust-a", "مصنع الأمل", 24.7136, 46.6753, 75);
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError("Check " + checks + " failed"); }
    private static void invalid(Runnable action) { boolean refused = false; try { action.run(); } catch (IllegalArgumentException expected) { refused = true; } check(refused); }
    /** A latitude exactly this many metres north of A (distance() uses the same sphere). */
    private static double north(double metres) { return A.latitude + Math.toDegrees(metres / 6_371_000.0); }
    private static List<NearbyRules.Target> at(NearbyRules rules, List<NearbyRules.Target> targets, long delta, double latitude, double longitude) {
        return rules.fixAll(targets, latitude, longitude, 10, NOW + delta, NOW + delta, ELAPSED + delta, ELAPSED + delta);
    }
    private static List<NearbyRules.Target> metresFromA(NearbyRules rules, long delta, double metres) { return at(rules, Collections.singletonList(A), delta, north(metres), A.longitude); }
    private static boolean arabic(String text) { return text.matches("(?s).*[\\u0600-\\u06ff].*"); }

    public static void main(String[] args) {
        // The owner's numbers and GSCO's timings.
        check(NearbyRules.RADIUS_METRES == 1000); check(NearbyRules.MAX_ACCURACY == 75); check(NearbyRules.DEBOUNCE_MS == 15_000);
        check(NearbyRules.GLOBAL_COOLDOWN_MS == 30_000); check(NearbyRules.MAX_PAIR_GAP_MS == 90_000); check(NearbyRules.MAX_FIX_AGE_MS == 60_000);
        check(NearbyRules.MAX_CATALOG_MS == 600_000); check(NearbyRules.REFRESH_MS == 300_000); check(NearbyRules.RECHECK_MS == 60_000);
        check(NearbyRules.MIN_REQUEST_GAP_MS == 15_000); check(NearbyRules.FAILURE_RETRY_MS == 60_000); check(NearbyRules.MAX_TARGETS == 2000);
        check(NearbyRules.PATH.equals("/api/nearby-customers"));

        // Haversine distance, and the 1 km edge: 999 m and exactly 1000 m are inside, 1001 m is not.
        for (double metres : new double[]{0.5, 300, 999, 1000, 1001, 5000}) check(Math.abs(NearbyRules.distance(north(metres), A.longitude, A.latitude, A.longitude) - metres) < 0.01);
        check(NearbyRules.distance(24, 46, 24, 46) == 0); check(NearbyRules.distance(0, 0, 0, 1) > 111_000 && NearbyRules.distance(0, 0, 0, 1) < 112_000);
        check(Double.isFinite(NearbyRules.distance(-90, -180, 90, 180)));
        check(NearbyRules.inside(999)); check(NearbyRules.inside(1000)); check(!NearbyRules.inside(1001)); check(!NearbyRules.inside(1000.01));
        check(!NearbyRules.inside(Double.NaN)); check(!NearbyRules.inside(-1)); check(!NearbyRules.inside(Double.POSITIVE_INFINITY));
        NearbyRules rules = new NearbyRules();
        check(metresFromA(rules, 0, 999).isEmpty()); check(metresFromA(rules, 15_000, 999).equals(Collections.singletonList(A)));
        rules = new NearbyRules();
        check(metresFromA(rules, 0, 1001).isEmpty()); check(metresFromA(rules, 15_000, 1001).isEmpty()); check(metresFromA(rules, 30_000, 1001).isEmpty()); check(!rules.confirmed(A.id, NOW + 30_000));
        // The fix's own distance decides; the accuracy is a condition of the fix (75 m at most), never added to the distance.
        rules = new NearbyRules();
        check(rules.fixAll(Collections.singletonList(A), north(990), A.longitude, 75, NOW, NOW, ELAPSED, ELAPSED).isEmpty());
        check(rules.fixAll(Collections.singletonList(A), north(990), A.longitude, 75, NOW + 15_000, NOW + 15_000, ELAPSED + 15_000, ELAPSED + 15_000).equals(Collections.singletonList(A)));
        rules = new NearbyRules();
        check(rules.fixAll(Collections.singletonList(A), north(100), A.longitude, 76, NOW, NOW, ELAPSED, ELAPSED).isEmpty());
        check(rules.fixAll(Collections.singletonList(A), north(100), A.longitude, 76, NOW + 15_000, NOW + 15_000, ELAPSED + 15_000, ELAPSED + 15_000).isEmpty());

        // Confirmation: two fixes inside at least 15 s apart; an outside fix, a long gap or a stale fix starts again.
        rules = new NearbyRules();
        check(metresFromA(rules, 0, 200).isEmpty()); check(metresFromA(rules, 14_999, 200).isEmpty()); check(metresFromA(rules, 15_000, 200).equals(Collections.singletonList(A)));
        check(rules.confirmed(A.id, NOW + 15_000)); check(!rules.confirmed(A.id, NOW + 15_001)); check(!rules.confirmed("other", NOW + 15_000));
        rules = new NearbyRules();
        check(metresFromA(rules, 0, 200).isEmpty()); check(metresFromA(rules, 10_000, 1500).isEmpty()); check(metresFromA(rules, 20_000, 200).isEmpty()); check(metresFromA(rules, 35_000, 200).equals(Collections.singletonList(A)));
        rules = new NearbyRules();
        check(metresFromA(rules, 0, 200).isEmpty()); check(metresFromA(rules, 90_001, 200).isEmpty()); check(metresFromA(rules, 105_001, 200).equals(Collections.singletonList(A)));
        rules = new NearbyRules();
        check(metresFromA(rules, 0, 200).isEmpty()); check(metresFromA(rules, 0, 200).isEmpty()); check(metresFromA(rules, -1, 200).isEmpty()); check(metresFromA(rules, 15_000, 200).equals(Collections.singletonList(A)));
        rules = new NearbyRules(); check(metresFromA(rules, 0, 200).isEmpty()); rules.resetEvidence(); check(metresFromA(rules, 15_000, 200).isEmpty()); check(metresFromA(rules, 30_000, 200).equals(Collections.singletonList(A)));
        rules = new NearbyRules(); check(metresFromA(rules, 0, 200).isEmpty()); rules.retain(Collections.emptyList()); check(metresFromA(rules, 15_000, 200).isEmpty()); check(metresFromA(rules, 30_000, 200).equals(Collections.singletonList(A)));

        // An empty list: nothing, whatever the fixes.
        rules = new NearbyRules();
        for (int i = 0; i < 10; i++) check(at(rules, Collections.emptyList(), i * 15_000L, A.latitude, A.longitude).isEmpty());

        // Grouping: every customer confirmed inside at the same fix, the nearest first; one beyond 1 km is left out.
        NearbyRules.Target near = new NearbyRules.Target("cust-n", "مصنع النور", north(300), A.longitude, 61);
        NearbyRules.Target edge = new NearbyRules.Target("cust-e", "مصنع الحافة", north(999), A.longitude, -1);
        NearbyRules.Target far = new NearbyRules.Target("cust-f", "مصنع بعيد", north(1001), A.longitude, 120);
        List<NearbyRules.Target> list = Arrays.asList(far, edge, near);
        rules = new NearbyRules();
        check(at(rules, list, 0, A.latitude, A.longitude).isEmpty());
        check(at(rules, list, 15_000, A.latitude, A.longitude).equals(Arrays.asList(near, edge)));
        // Two at the same distance: ordered by id, so the order never changes between runs.
        NearbyRules.Target twinB = new NearbyRules.Target("cust-b", "ب", A.latitude, A.longitude + 0.001, 70), twinC = new NearbyRules.Target("cust-c", "ج", A.latitude, A.longitude - 0.001, 70);
        rules = new NearbyRules(); check(at(rules, Arrays.asList(twinC, twinB), 0, A.latitude, A.longitude).isEmpty());
        check(at(rules, Arrays.asList(twinC, twinB), 15_000, A.latitude, A.longitude).equals(Arrays.asList(twinB, twinC)));

        // Once a Riyadh day, and 30 s between two notifications.
        rules = new NearbyRules();
        check(at(rules, list, 0, A.latitude, A.longitude).isEmpty()); check(at(rules, list, 15_000, A.latitude, A.longitude).size() == 2);
        rules.notified(near.id, NOW + 15_000); rules.notified(edge.id, NOW + 15_000);
        for (int i = 2; i < 40; i++) check(at(rules, list, i * 15_000L, A.latitude, A.longitude).isEmpty());
        check(!rules.canNotify(near.id, NOW + 6 * 3_600_000L)); // 16:00 the same day
        check(rules.notices().equals(Map.of(near.id, "2026-10-06", edge.id, "2026-10-06")));
        NearbyRules.Target other = new NearbyRules.Target("cust-o", "مصنع آخر", north(100), A.longitude, 90);
        check(!rules.canNotify(other.id, NOW + 15_000 + 29_999)); check(rules.canNotify(other.id, NOW + 15_000 + 30_000));
        // A clock set back does not hold the next notification forever (each customer still once a day).
        check(rules.canNotify(other.id, NOW)); check(!rules.canNotify(near.id, NOW));
        // Riyadh day: 17:59:59 is still the same day; 06:00 the next working day is a new one (a fix of yesterday never pairs with today's).
        long lastMinute = RouteRules.millis("2026-10-06T14:59:59.000Z"), nextMorning = RouteRules.millis("2026-10-07T03:00:00.000Z");
        check(ContinuousPolicy.date(lastMinute).equals("2026-10-06")); check(ContinuousPolicy.date(nextMorning).equals("2026-10-07"));
        check(ContinuousPolicy.date(RouteRules.millis("2026-10-06T20:59:59.999Z")).equals("2026-10-06")); check(ContinuousPolicy.date(RouteRules.millis("2026-10-06T21:00:00.000Z")).equals("2026-10-07"));
        check(!rules.canNotify(near.id, lastMinute)); check(rules.canNotify(near.id, nextMorning));
        check(!rules.canNotify(near.id, RouteRules.millis("2026-10-06T15:00:00.000Z"))); // 18:00: outside the hours
        NearbyRules overnight = new NearbyRules();
        check(overnight.fixAll(list, A.latitude, A.longitude, 10, lastMinute - 5_000, lastMinute - 5_000, ELAPSED, ELAPSED).isEmpty());
        check(overnight.fixAll(list, A.latitude, A.longitude, 10, nextMorning + 5_000, nextMorning + 5_000, ELAPSED + 50_000_000L, ELAPSED + 50_000_000L).isEmpty());
        check(overnight.fixAll(list, A.latitude, A.longitude, 10, nextMorning + 20_000, nextMorning + 20_000, ELAPSED + 50_015_000L, ELAPSED + 50_015_000L).size() == 2);
        // The next day's notice forgets yesterday's ids.
        rules.notified(near.id, nextMorning + 20_000); check(rules.notices().equals(Map.of(near.id, "2026-10-07")));
        // A restart reads back who was told today: nothing is repeated; another day is not today.
        NearbyRules restarted = new NearbyRules();
        Map<String, String> saved = new HashMap<>(); saved.put(near.id, "2026-10-06"); saved.put("../x", "2026-10-06"); saved.put("cust-bad", "today"); saved.put(edge.id, null);
        restarted.restore(saved, NOW + 15_000);
        check(restarted.notices().equals(Map.of(near.id, "2026-10-06"))); check(restarted.lastNotice() == NOW + 15_000);
        check(!restarted.canNotify(near.id, NOW + 120_000)); check(restarted.canNotify(edge.id, NOW + 120_000)); check(restarted.canNotify(near.id, nextMorning));
        restarted.restore(Collections.emptyMap(), -5); check(restarted.lastNotice() == 0 && restarted.canNotify(near.id, NOW));
        check(!new NearbyRules().canNotify(near.id, RouteRules.millis("2026-10-09T07:00:00.000Z"))); // Friday

        // Live fixes only: accuracy, age, the tracking hours and the same day by both clocks.
        check(NearbyRules.fresh(24, 46, 10, NOW, NOW, ELAPSED, ELAPSED)); check(NearbyRules.fresh(24, 46, 75, NOW, NOW, ELAPSED, ELAPSED));
        for (float accuracy : new float[]{0, -1, 75.5f, 76, Float.NaN, Float.POSITIVE_INFINITY}) check(!NearbyRules.fresh(24, 46, accuracy, NOW, NOW, ELAPSED, ELAPSED));
        check(!NearbyRules.fresh(24, 46, 10, NOW - 60_001, NOW, ELAPSED - 60_001, ELAPSED)); check(!NearbyRules.fresh(24, 46, 10, NOW + 1, NOW, ELAPSED, ELAPSED));
        check(!NearbyRules.fresh(24, 46, 10, NOW, NOW, ELAPSED + 1, ELAPSED)); check(!NearbyRules.fresh(24, 46, 10, NOW, NOW, 0, ELAPSED)); check(!NearbyRules.fresh(0, 0, 10, NOW, NOW, ELAPSED, ELAPSED));
        for (String outside : new String[]{"2026-10-09T07:00:00Z", "2026-10-06T02:59:59Z", "2026-10-06T15:00:00Z"}) { long t = RouteRules.millis(outside); check(!NearbyRules.fresh(24, 46, 10, t, t, ELAPSED, ELAPSED)); }

        // The server's rows: strings, numbers, null for never visited; anything else refuses the row.
        NearbyRules.Target parsed = NearbyRules.target("cust-1", "  مصنع\n  الأمل\t ", 24.5, 46.5, 61.0);
        check(parsed.id.equals("cust-1") && parsed.name.equals("مصنع الأمل") && parsed.daysSinceVisit == 61);
        check(NearbyRules.target("cust-1", "x", 24, 46, null).daysSinceVisit == -1); check(NearbyRules.target("cust-1", "x", 24, 46, 0).daysSinceVisit == 0);
        invalid(() -> NearbyRules.target("../x", "x", 24, 46, 60)); invalid(() -> NearbyRules.target("a&b", "x", 24, 46, 60)); invalid(() -> NearbyRules.target(7, "x", 24, 46, 60));
        invalid(() -> NearbyRules.target("c", "   ", 24, 46, 60)); invalid(() -> NearbyRules.target("c", null, 24, 46, 60)); invalid(() -> NearbyRules.target("c", "x".repeat(201), 24, 46, 60));
        invalid(() -> NearbyRules.target("c", "x", 0, 0, 60)); invalid(() -> NearbyRules.target("c", "x", 91, 46, 60)); invalid(() -> NearbyRules.target("c", "x", "24", 46, 60)); invalid(() -> NearbyRules.target("c", "x", Double.NaN, 46, 60));
        invalid(() -> NearbyRules.target("c", "x", 24, 46, 60.5)); invalid(() -> NearbyRules.target("c", "x", 24, 46, -2)); invalid(() -> NearbyRules.target("c", "x", 24, 46, "60")); invalid(() -> NearbyRules.target("c", "x", 24, 46, Double.POSITIVE_INFINITY));
        check(NearbyRules.target("c", "x".repeat(200), 24, 46, 60).name.length() == 200);

        // The list's identity and lease: the enrolled representative, the same regions, ten minutes at most.
        check(NearbyRules.validCatalog(1, "rep-a", "rep", "eastern", "rep-a", "eastern", NOW, NOW + 600_000));
        check(!NearbyRules.validCatalog(2, "rep-a", "rep", "eastern", "rep-a", "eastern", NOW, NOW + 600_000));
        check(!NearbyRules.validCatalog(1, "rep-b", "rep", "eastern", "rep-a", "eastern", NOW, NOW + 600_000));
        check(!NearbyRules.validCatalog(1, "rep-a", "supervisor", "eastern", "rep-a", "eastern", NOW, NOW + 600_000));
        check(!NearbyRules.validCatalog(1, "rep-a", "rep", "western", "rep-a", "eastern", NOW, NOW + 600_000));
        check(!NearbyRules.validCatalog(1, "rep-a", "rep", "", "rep-a", "", NOW, NOW + 600_000));
        check(!NearbyRules.validCatalog(1, "rep-a", "rep", "eastern", "rep-a", "eastern", NOW, NOW + 600_001));
        check(!NearbyRules.validCatalog(1, "rep-a", "rep", "eastern", "rep-a", "eastern", NOW, NOW));
        check(!NearbyRules.validCatalog(1, "rep-a", "rep", "eastern", "rep-a", "eastern", 0, 600_000));
        check(!NearbyRules.validCatalog(1, "", "rep", "eastern", "", "eastern", NOW, NOW + 600_000));
        check(NearbyRules.leaseFresh(ELAPSED + 600_000, ELAPSED, ELAPSED + 599_999)); check(!NearbyRules.leaseFresh(ELAPSED + 600_000, ELAPSED, ELAPSED + 600_000));
        check(!NearbyRules.leaseFresh(ELAPSED + 600_000, ELAPSED, ELAPSED - 1)); check(!NearbyRules.leaseFresh(0, 0, 1));

        // A revoked session or account, a hidden screen: stop; anything else: try again in a minute.
        for (int status : new int[]{401, 403, 404}) { check(NearbyRules.stops(status)); check(NearbyRules.nextRequest(ELAPSED, status) == ELAPSED + 300_000); }
        for (int status : new int[]{0, 409, 429, 500, 502, 503}) { check(!NearbyRules.stops(status)); check(NearbyRules.nextRequest(ELAPSED, status) == ELAPSED + 60_000); }
        check(NearbyRules.nextRequest(ELAPSED, 200) == ELAPSED + 300_000);
        check(NearbyRules.requestDue(ELAPSED, ELAPSED, ELAPSED - 1, false)); check(!NearbyRules.requestDue(ELAPSED, ELAPSED + 1, ELAPSED - 1, false));
        check(NearbyRules.requestDue(ELAPSED, ELAPSED + 100_000, ELAPSED - 15_000, true)); check(!NearbyRules.requestDue(ELAPSED, ELAPSED + 100_000, ELAPSED - 14_999, true));
        check(NearbyRules.requestDue(ELAPSED, ELAPSED + 100_000, 0, true));

        // The words: Arabic.
        check(NearbyRules.title(1, false).equals("مصنع قريب منك بحاجة إلى زيارة"));
        check(NearbyRules.title(2, false).equals("مصنعان قريبان منك بحاجة إلى زيارة"));
        check(NearbyRules.title(3, false).equals("3 مصانع قريبة منك بحاجة إلى زيارة")); check(NearbyRules.title(10, false).equals("10 مصانع قريبة منك بحاجة إلى زيارة"));
        check(NearbyRules.title(11, false).equals("11 مصنعًا قريبًا منك بحاجة إلى زيارة")); check(NearbyRules.title(99, false).equals("99 مصنعًا قريبًا منك بحاجة إلى زيارة"));
        check(NearbyRules.title(100, false).equals("100 مصنع قريب منك بحاجة إلى زيارة")); check(NearbyRules.title(102, false).equals("102 مصنع قريب منك بحاجة إلى زيارة"));
        check(NearbyRules.title(103, false).equals("103 مصانع قريبة منك بحاجة إلى زيارة")); check(NearbyRules.title(111, false).equals("111 مصنعًا قريبًا منك بحاجة إلى زيارة"));
        invalid(() -> NearbyRules.title(0, false));
        check(NearbyRules.lastVisit(-1, false).equals("لم تُسجَّل له زيارة")); check(NearbyRules.lastVisit(60, false).equals("آخر زيارة قبل 60 يومًا"));
        check(NearbyRules.lastVisit(75, false).equals("آخر زيارة قبل 75 يومًا")); check(NearbyRules.lastVisit(100, false).equals("آخر زيارة قبل 100 يوم"));
        check(NearbyRules.lastVisit(103, false).equals("آخر زيارة قبل 103 أيام")); check(NearbyRules.lastVisit(111, false).equals("آخر زيارة قبل 111 يومًا"));
        check(NearbyRules.lastVisit(1, false).equals("آخر زيارة قبل يوم واحد")); check(NearbyRules.lastVisit(2, false).equals("آخر زيارة قبل يومين"));
        check(NearbyRules.metres(420.4, false).equals("على بعد 420 م")); check(NearbyRules.metres(419.5, false).equals("على بعد 420 م")); check(NearbyRules.metres(-3, false).equals("على بعد 0 م"));
        invalid(() -> NearbyRules.metres(Double.NaN, false));
        check(NearbyRules.message(Collections.singletonList(A), Collections.singletonList(420.4), false).equals("مصنع الأمل — على بعد 420 م · آخر زيارة قبل 75 يومًا"));
        check(NearbyRules.message(Arrays.asList(near, edge), Arrays.asList(300.2, 998.6), false).equals("• مصنع النور — على بعد 300 م · آخر زيارة قبل 61 يومًا\n• مصنع الحافة — على بعد 999 م · لم تُسجَّل له زيارة"));
        check(NearbyRules.summary(Arrays.asList(near, edge), Arrays.asList(300.2, 998.6), false).equals("الأقرب: مصنع النور — على بعد 300 م"));
        check(NearbyRules.summary(Collections.singletonList(A), Collections.singletonList(5.0), false).equals("مصنع الأمل — على بعد 5 م · آخر زيارة قبل 75 يومًا"));
        invalid(() -> NearbyRules.message(Collections.emptyList(), Collections.emptyList(), false)); invalid(() -> NearbyRules.message(Arrays.asList(near, edge), Collections.singletonList(1.0), false));
        invalid(() -> NearbyRules.summary(null, null, false));
        check(NearbyRules.publicTitle(false).equals("يورست: مصانع قريبة بحاجة إلى زيارة")); check(NearbyRules.channelName(false).equals("المصانع القريبة"));
        check(NearbyRules.channelDescription(false).contains("كيلومتر") && NearbyRules.channelDescription(false).contains("60 يومًا"));
        // English: the same, with no Arabic but the customers' own names.
        check(NearbyRules.title(1, true).equals("A factory near you needs a visit")); check(NearbyRules.title(2, true).equals("2 factories near you need a visit")); check(NearbyRules.title(12, true).equals("12 factories near you need a visit"));
        check(NearbyRules.lastVisit(-1, true).equals("no visit recorded")); check(NearbyRules.lastVisit(75, true).equals("last visit 75 days ago")); check(NearbyRules.lastVisit(1, true).equals("last visit 1 day ago"));
        check(NearbyRules.metres(420.4, true).equals("420 m away"));
        NearbyRules.Target latin = new NearbyRules.Target("cust-l", "Al Amal Blocks", A.latitude, A.longitude, 75), latin2 = new NearbyRules.Target("cust-m", "Noor Factory", A.latitude, A.longitude, -1);
        check(NearbyRules.message(Arrays.asList(latin, latin2), Arrays.asList(120.0, 310.6), true).equals("• Al Amal Blocks — 120 m away · last visit 75 days ago\n• Noor Factory — 311 m away · no visit recorded"));
        check(NearbyRules.summary(Arrays.asList(latin, latin2), Arrays.asList(120.0, 310.6), true).equals("Nearest: Al Amal Blocks — 120 m away"));
        check(NearbyRules.publicTitle(true).equals("Yourrest: nearby factories need a visit")); check(NearbyRules.channelName(true).equals("Nearby factories"));
        for (String english : new String[]{NearbyRules.title(1, true), NearbyRules.title(5, true), NearbyRules.lastVisit(-1, true), NearbyRules.lastVisit(80, true), NearbyRules.metres(1, true), NearbyRules.publicTitle(true), NearbyRules.channelName(true), NearbyRules.channelDescription(true),
                NearbyRules.message(Arrays.asList(latin, latin2), Arrays.asList(1.0, 2.0), true), NearbyRules.summary(Arrays.asList(latin, latin2), Arrays.asList(1.0, 2.0), true)}) check(!arabic(english));
        for (String words : new String[]{NearbyRules.title(1, false), NearbyRules.title(4, false), NearbyRules.lastVisit(-1, false), NearbyRules.publicTitle(false), NearbyRules.channelName(false), NearbyRules.channelDescription(false)}) check(arabic(words));
        // The page's language, as evaluateJavascript returns localStorage.getItem('yr-language').
        check("en".equals(NearbyRules.pageLanguage("\"en\""))); check("ar".equals(NearbyRules.pageLanguage("\"ar\""))); check("ar".equals(NearbyRules.pageLanguage("null")));
        check("ar".equals(NearbyRules.pageLanguage(" \"fr\" "))); check(NearbyRules.pageLanguage(null) == null); check(NearbyRules.pageLanguage("{}") == null); check(NearbyRules.pageLanguage("") == null);
        check(NearbyRules.english("en")); check(!NearbyRules.english("ar")); check(!NearbyRules.english(null)); check(!NearbyRules.english("EN"));
        // The tap opens «خريطة المصانع» on the nearest customer; only a plain identifier travels.
        check(NearbyRules.openFragment("cust-a").equals("#nearby=cust-a")); check(NearbyRules.openFragment("a&b") == null); check(NearbyRules.openFragment("../x") == null); check(NearbyRules.openFragment(null) == null);

        java.lang.System.out.println("Nearby customer rules: " + checks + " checks passed (no Android notification/GPS hardware verification)");
    }
}

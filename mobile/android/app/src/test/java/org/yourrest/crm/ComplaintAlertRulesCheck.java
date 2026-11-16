package org.yourrest.crm;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** «شكوى تنتظرك» and the background alert check (the owner, 2026-11-16, item 3 of the GSCO list): the pure rules on a JVM, exactly as the
 *  app runs them (ComplaintAlertRules, AlertJobRules, with the production ContinuousPolicy and RouteRules): when the app may ask, the
 *  fifteen-minute period and the work window (06:00 to 18:00 Riyadh, not Friday) at its edges, which rows notify and which go, the order by
 *  importance, the words in Arabic and English, the deep link. Not an Android device test. */
public final class ComplaintAlertRulesCheck {
    private static int checks;
    private static void check(boolean value, String what) { checks++; if (!value) throw new AssertionError("Check " + checks + " failed: " + what); }
    private static final ZoneId RIYADH = ZoneId.of("Asia/Riyadh");
    private static long riyadh(int year, int month, int day, int hour, int minute) { return ZonedDateTime.of(year, month, day, hour, minute, 0, 0, RIYADH).toInstant().toEpochMilli(); }
    private static ComplaintAlertRules.Alert alert(String id, boolean high, String step, boolean seen, String since) { return new ComplaintAlertRules.Alert(id, "مصنع " + id, "جودة المنتج أو القالب", "Product or mold quality", high, step, seen, since); }
    private static List<String> ids(List<ComplaintAlertRules.Alert> alerts) { List<String> out = new ArrayList<>(); for (ComplaintAlertRules.Alert alert : alerts) out.add(alert.id); return out; }
    private static boolean arabic(String text) { return text.matches("(?s).*[\\u0600-\\u06ff].*"); }

    public static void main(String[] args) {
        // ---- The work window of the background check: 06:00 to 18:00 Riyadh, never Friday (2026-11-16 is a Monday, 2026-11-20 a Friday).
        check(!AlertJobRules.shouldPoll(riyadh(2026, 11, 16, 5, 59)), "05:59 Riyadh: outside");
        check(AlertJobRules.shouldPoll(riyadh(2026, 11, 16, 6, 0)), "06:00 Riyadh: inside (inclusive)");
        check(AlertJobRules.shouldPoll(riyadh(2026, 11, 16, 12, 30)), "noon: inside");
        check(AlertJobRules.shouldPoll(riyadh(2026, 11, 16, 17, 59)), "17:59: inside");
        check(!AlertJobRules.shouldPoll(riyadh(2026, 11, 16, 18, 0)), "18:00: outside (exclusive)");
        check(!AlertJobRules.shouldPoll(riyadh(2026, 11, 16, 23, 0)), "night: outside");
        check(!AlertJobRules.shouldPoll(riyadh(2026, 11, 20, 10, 0)), "Friday 10:00: outside");
        check(!AlertJobRules.shouldPoll(riyadh(2026, 11, 20, 6, 0)), "Friday 06:00: outside");
        check(AlertJobRules.shouldPoll(riyadh(2026, 11, 21, 6, 0)), "Saturday 06:00: inside");
        check(AlertJobRules.shouldPoll(riyadh(2026, 11, 19, 17, 59)), "Thursday 17:59: inside");
        // The window is Riyadh's whatever the phone's own zone: 03:00 UTC is 06:00 Riyadh.
        check(AlertJobRules.shouldPoll(java.time.Instant.parse("2026-11-16T03:00:00Z").toEpochMilli()) && !AlertJobRules.shouldPoll(java.time.Instant.parse("2026-11-16T02:59:59Z").toEpochMilli()), "the window is Saudi time, not the phone's zone");
        // Fifteen minutes, the shortest period Android's job scheduler allows; one job id.
        check(AlertJobRules.PERIOD_MS == 15L * 60 * 1000, "the check runs every 15 minutes");
        check(AlertJobRules.JOB_ID > 0 && AlertJobRules.JOB_ID != ServiceAlertPolicy.SUMMARY_ID, "its own job id");
        check(!AlertJobRules.signedIn(null) && !AlertJobRules.signedIn("") && !AlertJobRules.signedIn("   ") && AlertJobRules.signedIn("__Host-yourrest_session=abc"), "signed in only with a session cookie");

        // ---- When the app asks: opening after a minute; the background every ten minutes, inside the window only.
        long now = riyadh(2026, 11, 16, 10, 0);
        check(ComplaintAlertRules.shouldPoll(now, 0, true, false) && ComplaintAlertRules.shouldPoll(now, 0, false, true), "first ask at once (background in the window, or opening)");
        check(!ComplaintAlertRules.shouldPoll(now, 0, false, false), "the background never asks outside the window");
        check(!ComplaintAlertRules.shouldPoll(now, now - 599_999, true, false) && ComplaintAlertRules.shouldPoll(now, now - 600_000, true, false), "ten minutes between background asks (edge)");
        check(!ComplaintAlertRules.shouldPoll(now, now - 59_999, false, true) && ComplaintAlertRules.shouldPoll(now, now - 60_000, false, true), "opening asks again after a minute (edge), even outside the window");
        check(ComplaintAlertRules.shouldPoll(now, now + 3_600_000, true, false), "a clock that went backwards asks again");
        check(ComplaintAlertRules.INTERVAL_MS < AlertJobRules.PERIOD_MS, "a 15-minute check always finds the 10-minute cadence due");

        // ---- Which rows notify, which go; high importance first.
        List<ComplaintAlertRules.Alert> feed = Arrays.asList(alert("c-normal", false, "review", false, "2026-11-16T05:00:00.000Z"), alert("c-high", true, "assign", false, "2026-11-16T06:00:00.000Z"), alert("c-opened", false, "contact", true, "2026-11-16T04:00:00.000Z"), alert("c-high2", true, "close", false, "2026-11-16T03:00:00.000Z"));
        ComplaintAlertRules.Decision first = ComplaintAlertRules.decide(new LinkedHashMap<>(), feed);
        check(ids(first.notify).equals(Arrays.asList("c-high", "c-high2", "c-normal")), "high importance first, the feed's order kept within each; an opened complaint is not announced: " + ids(first.notify));
        check(first.cancel.isEmpty(), "nothing to take away the first time");
        check(new ArrayList<>(first.remembered.keySet()).equals(Arrays.asList("c-high", "c-high2", "c-normal", "c-opened")), "every row remembered, opened or not, in the order shown");
        ComplaintAlertRules.Decision again = ComplaintAlertRules.decide(first.remembered, feed);
        check(again.notify.isEmpty() && again.cancel.isEmpty(), "the same feed again: nothing new, nothing removed");
        // The holder opens c-normal? It is a review (no opening); c-high's step starts again (reassigned): a new since notifies again.
        List<ComplaintAlertRules.Alert> later = Arrays.asList(alert("c-normal", false, "review", false, "2026-11-16T05:00:00.000Z"), alert("c-high", true, "contact", false, "2026-11-16T08:00:00.000Z"), alert("c-opened", false, "contact", true, "2026-11-16T04:00:00.000Z"));
        ComplaintAlertRules.Decision moved = ComplaintAlertRules.decide(again.remembered, later);
        check(ids(moved.notify).equals(Arrays.asList("c-high")), "a new step of the same complaint notifies again");
        check(moved.cancel.equals(Arrays.asList("c-high2")), "a complaint that no longer waits for the member is taken away");
        // Opened by its holder after it was shown: taken away, still remembered so it never returns for the same step.
        Map<String, String> shown = new LinkedHashMap<>(moved.remembered);
        ComplaintAlertRules.Decision opened = ComplaintAlertRules.decide(shown, Arrays.asList(alert("c-high", true, "contact", true, "2026-11-16T08:00:00.000Z")));
        check(ids(opened.notify).isEmpty() && opened.cancel.equals(Arrays.asList("c-high", "c-normal")) && opened.remembered.get("c-high").equals("~2026-11-16T08:00:00.000Z"), "opened: taken away once and remembered as opened; the shown one that left goes, the opened one that left is not cancelled again: " + opened.cancel);
        check(first.remembered.get("c-opened").equals("~2026-11-16T04:00:00.000Z") && !ComplaintAlertRules.shown(first.remembered.get("c-opened")) && ComplaintAlertRules.shown(first.remembered.get("c-high")), "an opened row is remembered as opened, a shown one as shown");
        check(ComplaintAlertRules.decide(Map.of("c-x", "~2026-11-16T04:00:00.000Z"), Arrays.asList(alert("c-x", false, "contact", false, "2026-11-16T04:00:00.000Z"))).notify.isEmpty(), "the same step opened before is never announced again");
        check(ids(ComplaintAlertRules.decide(Map.of("c-x", "~2026-11-16T04:00:00.000Z"), Arrays.asList(alert("c-x", false, "contact", false, "2026-11-16T09:00:00.000Z"))).notify).equals(Arrays.asList("c-x")), "but a new step of it is");
        check(ComplaintAlertRules.decide(opened.remembered, Arrays.asList(alert("c-high", true, "contact", true, "2026-11-16T08:00:00.000Z"))).cancel.isEmpty(), "an opened complaint already taken away is not cancelled twice");
        check(ComplaintAlertRules.decide(new LinkedHashMap<>(), new ArrayList<>()).notify.isEmpty(), "an empty feed: nothing");
        check(ComplaintAlertRules.sortKey(alert("x", true, "review", false, "s"), 3).compareTo(ComplaintAlertRules.sortKey(alert("y", false, "review", false, "s"), 0)) < 0, "inside the group a high complaint sorts before a normal one");
        check(ComplaintAlertRules.sortKey(alert("x", false, "review", false, "s"), 2).compareTo(ComplaintAlertRules.sortKey(alert("y", false, "review", false, "s"), 10)) < 0, "and the feed's order within the same importance");

        // ---- The steps the feed may name, and the words.
        for (String step : new String[]{"review", "fix", "assign", "delegate", "contact", "resolve", "close"}) {
            check(ComplaintAlertRules.stepKnown(step), step + " is a step");
            check(arabic(ComplaintAlertRules.stepText(step, false)) && !arabic(ComplaintAlertRules.stepText(step, true)), step + ": Arabic and English words");
        }
        check(!ComplaintAlertRules.stepKnown("approve") && !ComplaintAlertRules.stepKnown("") && !ComplaintAlertRules.stepKnown(null), "nothing else is a step");
        check(ComplaintAlertRules.severityKnown("high") && ComplaintAlertRules.severityKnown("normal") && !ComplaintAlertRules.severityKnown("urgent"), "two importances");
        check(ComplaintAlertRules.stepText("review", false).equals("بانتظار مراجعتك") && ComplaintAlertRules.stepText("assign", false).equals("بانتظار تكليفك") && ComplaintAlertRules.stepText("delegate", false).equals("بانتظار تفويضك")
                && ComplaintAlertRules.stepText("contact", false).equals("بانتظار تواصلك مع العميل") && ComplaintAlertRules.stepText("resolve", false).equals("بانتظار تسجيل الحل") && ComplaintAlertRules.stepText("close", false).equals("بانتظار تأكيد الإغلاق")
                && ComplaintAlertRules.stepText("fix", false).equals("مطلوب تعديلك"), "the steps as the complaints page names them");
        check(ComplaintAlertRules.message(alert("c1", true, "review", false, "s"), false).equals("أهمية عالية · مصنع c1 · جودة المنتج أو القالب — بانتظار مراجعتك"), "a high complaint: «أهمية عالية ·» first");
        check(ComplaintAlertRules.message(alert("c1", false, "contact", false, "s"), false).equals("مصنع c1 · جودة المنتج أو القالب — بانتظار تواصلك مع العميل"), "a normal one without it");
        check(ComplaintAlertRules.message(alert("c1", true, "review", false, "s"), true).equals("High importance · مصنع c1 · Product or mold quality — Waiting for your review"), "in English: the words English, the customer's name as written");
        check(ComplaintAlertRules.message(new ComplaintAlertRules.Alert("c2", "  ", "", "", false, "close", false, "s"), false).equals("عميل — بانتظار تأكيد الإغلاق") && ComplaintAlertRules.message(new ComplaintAlertRules.Alert("c2", "", "", "", false, "close", false, "s"), true).equals("Customer — Waiting for you to confirm the closure"), "no name, no category: a plain word");
        String longName = "م".repeat(400);
        check(ComplaintAlertRules.message(new ComplaintAlertRules.Alert("c3", longName, "x", "x", false, "fix", false, "s"), false).length() < 260 && ComplaintAlertRules.message(new ComplaintAlertRules.Alert("c3", longName, "x", "x", false, "fix", false, "s"), false).contains("…"), "a long name is cut");
        check(ComplaintAlertRules.title(false).equals("شكوى تنتظرك") && ComplaintAlertRules.title(true).equals("A complaint is waiting for you"), "the title");
        check(ComplaintAlertRules.publicTitle(false).equals("يورست: شكوى تنتظرك") && !ComplaintAlertRules.publicTitle(false).contains("مصنع") && ComplaintAlertRules.publicTitle(true).startsWith("Yourrest"), "the lock screen names neither customer nor category");
        check(ComplaintAlertRules.channelName(false).equals("شكاوى العملاء") && ComplaintAlertRules.channelName(true).equals("Customer complaints") && arabic(ComplaintAlertRules.channelDescription(false)) && !arabic(ComplaintAlertRules.channelDescription(true)), "the channel in both languages");
        check(ComplaintAlertRules.summaryText(3, false).equals("عدد الشكاوى التي تنتظرك: 3") && ComplaintAlertRules.summaryText(3, true).equals("Complaints waiting for you: 3") && !arabic(ComplaintAlertRules.summaryTitle(true)), "the summary of several");
        // ---- The deep link and the tags.
        check("#complaint=cmp-1".equals(ComplaintAlertRules.complaintFragment("cmp-1")) && ComplaintAlertRules.complaintFragment("a&b") == null && ComplaintAlertRules.complaintFragment("../x") == null && ComplaintAlertRules.complaintFragment(null) == null && ComplaintAlertRules.complaintFragment("") == null, "a tap opens #complaint=<id>, a plain identifier only");
        check(ComplaintAlertRules.tag("cmp-1").equals("yourrest-complaint:cmp-1") && ComplaintAlertRules.NOTIFICATION_ID != ComplaintAlertRules.SUMMARY_ID && ComplaintAlertRules.NOTIFICATION_ID != ServiceAlertPolicy.SUMMARY_ID, "one tag per complaint, its own ids");
        check(ComplaintAlertRules.PATH.equals("/api/complaints/alerts") && ComplaintAlertRules.MAX_ALERTS == 20, "the feed and its limit");
        java.lang.System.out.println("Complaint alert rules: " + checks + " checks passed (no Android notification or scheduler hardware verification)");
    }
}

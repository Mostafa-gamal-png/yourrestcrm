package org.yourrest.crm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

/** The real ComplaintAlerts, ComplaintAlertFeed and AlertCheckJob (mobile/android) run against Android stand-ins
 *  (tests/fixtures/native-complaints/stubs) with a clock and a server the check moves and answers by hand: the strict feed, one notification
 *  per complaint with high importance first, the words in Arabic and English, the group and its summary, the lock screen, a tap's intent, the
 *  same feed again, an opened complaint, a renewed step, the app in front of the person, a muted channel, notices switched off, a refused
 *  permission, 404, 401, another member, signing out with a request under way; and the background check: scheduled every fifteen minutes,
 *  persisted, with a network constraint, once; inside the window it asks both feeds and finishes; outside the window, on a Friday or without
 *  a session it does not ask. Not an Android device test: no notification shade, Doze, JobScheduler or real server. */
public final class ComplaintAlertsCheck {
    private static int checks;
    private static void check(boolean value, String what) { checks++; if (!value) throw new AssertionError("Check " + checks + " failed: " + what); }
    private static final ZoneId RIYADH = ZoneId.of("Asia/Riyadh");
    private static long riyadh(int year, int month, int day, int hour, int minute) { return ZonedDateTime.of(year, month, day, hour, minute, 0, 0, RIYADH).toInstant().toEpochMilli(); }
    private static final AtomicInteger asked = new AtomicInteger();
    private static volatile String answer = "";
    private static volatile int status = 200;
    private static volatile CountDownLatch hold;
    private static ComplaintAlerts alerts;
    private static Context context;

    private static String row(String id, String severity, String step, boolean seen, String since) {
        return "{\"id\":\"" + id + "\",\"customerName\":\"مصنع " + id + "\",\"category\":\"product_quality\",\"categoryAr\":\"جودة المنتج أو القالب\",\"categoryEn\":\"Product or mold quality\",\"severity\":\"" + severity + "\",\"awaiting\":\"" + step + "\",\"seen\":" + seen + ",\"since\":\"" + since + "\"}";
    }
    private static String feed(String member, int count, String... rows) { return "{\"schemaVersion\":1,\"memberId\":\"" + member + "\",\"generatedAt\":\"2026-11-16T07:00:00.000Z\",\"count\":" + count + ",\"alerts\":[" + String.join(",", rows) + "]}"; }
    private static void settle() throws Exception { for (int i = 0; i < 1000 && alerts.busy(); i++) Thread.sleep(5); if (alerts.busy()) throw new AssertionError("a request did not finish within five seconds"); }
    private static NotificationManager manager() { return Context.manager; }
    private static int posted() { return manager().posted.size(); }
    private static boolean active(String id) { return manager().active.containsKey(ComplaintAlertRules.tag(id) + "#" + ComplaintAlertRules.NOTIFICATION_ID); }
    private static boolean summary() { return manager().active.containsKey(ComplaintAlertRules.GROUP + "#" + ComplaintAlertRules.SUMMARY_ID); }
    private static boolean arabic(String text) { return text != null && text.matches("(?s).*[\\u0600-\\u06ff].*"); }
    private static void at(long when) { System.now = when; }
    /** Ten minutes and one second later: the background cadence is due again. */
    private static void later() { System.now += 601_000; }
    private static List<String> postedSince(int from) { return new ArrayList<>(manager().postedTags.subList(from, manager().postedTags.size())); }

    public static void main(String[] args) throws Exception {
        // ---- The feed, read strictly: anything malformed rejects the whole of it.
        String good = feed("cs-lead", 2, row("c-1", "normal", "review", false, "2026-11-16T05:00:00.000Z"), row("c-2", "high", "assign", false, "2026-11-16T06:00:00.000Z"));
        ComplaintAlertRules.Feed parsed = ComplaintAlertFeed.parse(new JSONObject(good));
        check(parsed.memberId.equals("cs-lead") && parsed.count == 2 && parsed.alerts.size() == 2 && parsed.alerts.get(1).high && !parsed.alerts.get(0).high && parsed.alerts.get(0).categoryEn.equals("Product or mold quality"), "a good feed reads");
        String[] bad = {
            good.replace("\"schemaVersion\":1", "\"schemaVersion\":2"), good.replace("\"memberId\":\"cs-lead\"", "\"memberId\":\"a b\""), good.replace("\"count\":2", "\"count\":1"), good.replace("\"count\":2", "\"count\":-1"),
            good.replace("\"awaiting\":\"review\"", "\"awaiting\":\"approve\""), good.replace("\"severity\":\"high\"", "\"severity\":\"urgent\""), good.replace("\"seen\":false", "\"seen\":\"no\""), good.replace("\"since\":\"2026-11-16T05:00:00.000Z\"", "\"since\":\"soon\""),
            good.replace("\"id\":\"c-2\"", "\"id\":\"c-1\""), good.replace("\"id\":\"c-1\"", "\"id\":\"../x\""), good.replace(",\"categoryEn\":\"Product or mold quality\"", "")
        };
        for (String one : bad) { boolean refused = false; try { ComplaintAlertFeed.parse(new JSONObject(one)); } catch (IllegalArgumentException expected) { refused = true; } check(refused, "refused: " + one.substring(0, Math.min(90, one.length()))); }
        StringBuilder many = new StringBuilder(); for (int i = 0; i < 21; i++) many.append(i == 0 ? "" : ",").append(row("m" + i, "normal", "close", false, "2026-11-16T05:00:00.000Z"));
        boolean tooMany = false; try { ComplaintAlertFeed.parse(new JSONObject(feed("cs", 21, many.toString()))); } catch (IllegalArgumentException expected) { tooMany = true; } check(tooMany, "more than 20 rows: refused");

        // ---- The glue: a Monday at 10:00 Riyadh, the app in the background, the person chose Arabic.
        context = new Context();
        at(riyadh(2026, 11, 16, 10, 0));
        alerts = new ComplaintAlerts(context, () -> { asked.incrementAndGet(); CountDownLatch gate = hold; if (gate != null) gate.await(5, TimeUnit.SECONDS); if (status != 200) throw new ServiceAlertApi.Failure(status, "refused"); return new JSONObject(answer); });
        answer = feed("cs-lead", 3, row("c-1", "normal", "review", false, "2026-11-16T05:00:00.000Z"), row("c-2", "high", "assign", false, "2026-11-16T06:00:00.000Z"), row("c-3", "high", "close", false, "2026-11-16T04:00:00.000Z"));
        alerts.pollNow(); settle();
        check(asked.get() == 1 && alerts.member().equals("cs-lead"), "opening the app asks once and remembers the account");
        check(postedSince(0).subList(0, 3).equals(List.of("yourrest-complaint:c-2", "yourrest-complaint:c-3", "yourrest-complaint:c-1")), "one notification per complaint, high importance first: " + manager().postedTags);
        Notification high = manager().posted.get(0), normal = manager().posted.get(2);
        check(high.title.equals("شكوى تنتظرك") && high.text.equals("أهمية عالية · مصنع c-2 · جودة المنتج أو القالب — بانتظار تكليفك") && high.big.equals(high.text), "the words of a high complaint in Arabic");
        check(normal.text.equals("مصنع c-1 · جودة المنتج أو القالب — بانتظار مراجعتك"), "a normal one: no prefix");
        check(high.group.equals(ComplaintAlertRules.GROUP) && high.sortKey.compareTo(normal.sortKey) < 0 && manager().posted.get(1).sortKey.compareTo(normal.sortKey) < 0, "grouped, high importance sorting first: " + high.sortKey + " " + normal.sortKey);
        check(high.publicVersion != null && high.publicVersion.title.equals("يورست: شكوى تنتظرك") && high.publicVersion.text == null && high.visibility == Notification.VISIBILITY_PRIVATE, "the lock screen shows a generic title only");
        check(high.intent != null && ComplaintAlerts.OPEN.equals(high.intent.intent.action) && "c-2".equals(high.intent.intent.extras.get(ComplaintAlerts.EXTRA)) && (high.intent.flags & android.app.PendingIntent.FLAG_IMMUTABLE) != 0 && high.autoCancel, "a tap opens that complaint (immutable intent, the app's own action)");
        check(summary() && manager().active.get(ComplaintAlertRules.GROUP + "#" + ComplaintAlertRules.SUMMARY_ID).text.equals("عدد الشكاوى التي تنتظرك: 3") && manager().active.get(ComplaintAlertRules.GROUP + "#" + ComplaintAlertRules.SUMMARY_ID).groupSummary, "three notices bundled under a summary with their count");
        NotificationChannel channel = manager().getNotificationChannel(ComplaintAlerts.CHANNEL);
        check(channel != null && channel.importance == NotificationManager.IMPORTANCE_HIGH && channel.name.toString().equals("شكاوى العملاء") && arabic(channel.description), "the channel «شكاوى العملاء», high importance");
        // The same feed ten minutes later from the background: nothing new.
        int before = posted(); later(); alerts.pollIfDue(); settle();
        check(asked.get() == 2 && posted() == before + 1 && manager().postedTags.get(posted() - 1).equals(ComplaintAlertRules.GROUP), "the same feed again: no complaint posted again (only the summary refreshed)");
        // Within ten minutes the background does not ask.
        alerts.pollIfDue(); settle(); check(asked.get() == 2, "the background never asks twice within ten minutes");
        // The holder opened c-2 (seen), c-3 left the feed (closed), c-1's step started again (returned for correction).
        later(); before = posted();
        answer = feed("cs-lead", 2, row("c-1", "normal", "fix", false, "2026-11-16T08:00:00.000Z"), row("c-2", "high", "contact", true, "2026-11-16T06:00:00.000Z"));
        alerts.pollIfDue(); settle();
        check(!active("c-2") && !active("c-3") && active("c-1") && postedSince(before).get(0).equals("yourrest-complaint:c-1"), "opened and finished complaints go; a renewed step notifies again");
        check(!summary(), "one notice left: no summary");
        // English, as the person chose in the CRM page.
        context.getSharedPreferences("native", Context.MODE_PRIVATE).edit().putString("language", "en").apply();
        later(); before = posted();
        answer = feed("cs-lead", 2, row("c-1", "normal", "fix", false, "2026-11-16T08:00:00.000Z"), row("c-4", "high", "resolve", false, "2026-11-16T09:00:00.000Z"));
        alerts.pollIfDue(); settle();
        Notification english = manager().posted.get(before);
        check(english.title.equals("A complaint is waiting for you") && english.text.equals("High importance · مصنع c-4 · Product or mold quality — Waiting for you to record the resolution") && !arabic(english.publicVersion.title), "in English: the words English, the customer's name as written");
        check(manager().getNotificationChannel(ComplaintAlerts.CHANNEL).name.toString().equals("Customer complaints"), "the channel's name follows the language");
        context.getSharedPreferences("native", Context.MODE_PRIVATE).edit().putString("language", "ar").apply();
        // In front of the person: nothing announced, but remembered, so it is not announced later either.
        MainActivity.resumed = true; before = posted();
        answer = feed("cs-lead", 3, row("c-1", "normal", "fix", false, "2026-11-16T08:00:00.000Z"), row("c-4", "high", "resolve", false, "2026-11-16T09:00:00.000Z"), row("c-5", "normal", "review", false, "2026-11-16T09:30:00.000Z"));
        System.now += 61_000; alerts.pollNow(); settle();
        check(postedSince(before).stream().noneMatch(tag -> tag.startsWith("yourrest-complaint:")), "the app in front of the person: no notification");
        MainActivity.resumed = false; later(); before = posted(); alerts.pollIfDue(); settle();
        check(postedSince(before).stream().noneMatch(tag -> tag.equals("yourrest-complaint:c-5")), "and not later from the background");
        // A muted channel, notices switched off, the permission refused: nothing is posted.
        answer = feed("cs-lead", 1, row("c-6", "normal", "review", false, "2026-11-16T09:40:00.000Z"));
        manager().getNotificationChannel(ComplaintAlerts.CHANNEL).importance = NotificationManager.IMPORTANCE_NONE; later(); before = posted(); alerts.pollIfDue(); settle();
        check(postedSince(before).isEmpty(), "a muted channel: nothing");
        manager().getNotificationChannel(ComplaintAlerts.CHANNEL).importance = NotificationManager.IMPORTANCE_HIGH;
        answer = feed("cs-lead", 1, row("c-7", "normal", "review", false, "2026-11-16T09:41:00.000Z"));
        manager().enabled = false; later(); before = posted(); alerts.pollIfDue(); settle();
        check(postedSince(before).isEmpty(), "notices switched off: nothing");
        manager().enabled = true; Context.postNotifications = false;
        answer = feed("cs-lead", 1, row("c-8", "normal", "review", false, "2026-11-16T09:42:00.000Z"));
        later(); before = posted(); alerts.pollIfDue(); settle();
        check(postedSince(before).isEmpty(), "the notification permission refused (Android 13+): nothing");
        Context.postNotifications = true;
        answer = feed("cs-lead", 2, row("c-9", "normal", "review", false, "2026-11-16T09:43:00.000Z"), row("c-10", "high", "assign", false, "2026-11-16T09:44:00.000Z"));
        later(); alerts.pollIfDue(); settle();
        check(active("c-9") && active("c-10") && summary(), "notices back: shown with their summary");
        // 404: the complaints are hidden from the account: the notices go, the account stays.
        status = 404; later(); alerts.pollIfDue(); settle();
        check(!active("c-9") && !active("c-10") && !summary() && alerts.member().equals("cs-lead"), "404: the notices go, the account is kept");
        // Another member signs in on the same phone: the earlier member's notices go, nothing of theirs is remembered.
        status = 200; answer = feed("cs-lead", 1, row("c-11", "normal", "review", false, "2026-11-16T09:50:00.000Z"));
        later(); alerts.pollIfDue(); settle(); check(active("c-11"), "back to normal");
        answer = feed("rep-2", 1, row("c-12", "normal", "contact", false, "2026-11-16T09:55:00.000Z"));
        later(); alerts.pollIfDue(); settle();
        check(!active("c-11") && active("c-12") && alerts.member().equals("rep-2"), "another account: the first one's notices go");
        // 401: the session ended: everything goes and nothing is remembered.
        status = 401; later(); alerts.pollIfDue(); settle();
        check(!active("c-12") && alerts.member().isEmpty(), "401: everything goes, no account remembered");
        // Signing out while a request is under way: its answer is never applied afterwards.
        status = 200; answer = feed("rep-2", 1, row("c-13", "normal", "contact", false, "2026-11-16T10:00:00.000Z"));
        hold = new CountDownLatch(1); later(); alerts.pollIfDue(); for (int i = 0; i < 200 && asked.get() == 0; i++) Thread.sleep(1);
        alerts.logout(); hold.countDown(); settle(); hold = null;
        check(!active("c-13") && alerts.member().isEmpty(), "an answer that arrives after signing out is not applied");
        // Outside the window the background never asks; opening the app still does.
        int count = asked.get(); at(riyadh(2026, 11, 16, 18, 0) + 60_000); alerts.pollIfDue(); settle();
        check(asked.get() == count, "18:01 Riyadh: the background does not ask");
        at(riyadh(2026, 11, 20, 10, 0)); alerts.pollIfDue(); settle();
        check(asked.get() == count, "Friday: the background does not ask");
        alerts.pollNow(); settle(); check(asked.get() == count + 1, "opening the app asks whatever the hour");
        // The tap: only the app's own action and a plain identifier.
        Intent tap = new Intent(context, MainActivity.class).setAction(ComplaintAlerts.OPEN).putExtra(ComplaintAlerts.EXTRA, "c-1");
        check("c-1".equals(ComplaintAlerts.requestedComplaint(tap)) && ComplaintAlerts.requestedComplaint(new Intent(context, MainActivity.class).setAction("other").putExtra(ComplaintAlerts.EXTRA, "c-1")) == null
                && ComplaintAlerts.requestedComplaint(new Intent(context, MainActivity.class).setAction(ComplaintAlerts.OPEN).putExtra(ComplaintAlerts.EXTRA, "a/b")) == null && ComplaintAlerts.requestedComplaint(null) == null, "a tapped notification is read only with the app's own action and a plain id");

        // ---- The background check.
        java.lang.reflect.Field field = ComplaintAlerts.class.getDeclaredField("instance"); field.setAccessible(true); field.set(null, alerts);
        AlertCheckJob.schedule(context);
        JobInfo job = Context.jobs.getPendingJob(AlertJobRules.JOB_ID);
        check(job != null && job.period == 15L * 60 * 1000 && job.persisted && job.network == JobInfo.NETWORK_TYPE_ANY && job.service.target == AlertCheckJob.class, "scheduled every fifteen minutes, persisted, with a network constraint");
        AlertCheckJob.schedule(context); check(Context.jobs.scheduled == 1, "scheduled once: a pending job is not replaced");
        Context.jobs.refuse = true; AlertCheckJob.cancel(context); AlertCheckJob.schedule(context); check(Context.jobs.getPendingJob(AlertJobRules.JOB_ID) == null, "a scheduler that refuses does not throw");
        Context.jobs.refuse = false; AlertCheckJob.schedule(context);
        AlertCheckJob service = new AlertCheckJob(); JobParameters parameters = new JobParameters();
        // No session: the check cancels itself.
        CookieManager.cookie = null; at(riyadh(2026, 11, 17, 9, 0));
        check(!service.onStartJob(parameters) && Context.jobs.getPendingJob(AlertJobRules.JOB_ID) == null, "without a session the check cancels itself");
        AlertCheckJob.schedule(context); CookieManager.cookie = "__Host-yourrest_session=x";
        // Outside the window (Tuesday 05:30, Friday noon): nothing is asked, the job stays.
        count = asked.get(); int service0 = ServiceAlerts.background;
        at(riyadh(2026, 11, 17, 5, 30)); check(!service.onStartJob(parameters) && asked.get() == count && ServiceAlerts.background == service0 && Context.jobs.getPendingJob(AlertJobRules.JOB_ID) != null, "05:30: nothing asked, still scheduled");
        at(riyadh(2026, 11, 20, 12, 0)); check(!service.onStartJob(parameters) && asked.get() == count, "Friday noon: nothing asked");
        // Inside the window, with route tracking off (the check needs no tracking): both feeds asked, then the job finishes once.
        at(riyadh(2026, 11, 17, 10, 0)); answer = feed("rep-2", 1, row("c-14", "high", "contact", false, "2026-11-17T06:00:00.000Z"));
        check(service.onStartJob(parameters), "inside the window the check works in the background");
        settle(); for (int i = 0; i < 200 && service.finished.isEmpty(); i++) Thread.sleep(5);
        check(asked.get() == count + 1 && ServiceAlerts.background == service0 + 1 && service.finished.size() == 1 && active("c-14"), "it asked the complaint and the service-request feeds, notified, and finished once");
        // Fifteen minutes later the ten-minute cadence is due again; five minutes later it is not (the feed is not asked).
        at(riyadh(2026, 11, 17, 10, 5)); service.finished.clear(); check(service.onStartJob(parameters), "a check five minutes later still runs"); settle();
        for (int i = 0; i < 200 && service.finished.isEmpty(); i++) Thread.sleep(5);
        check(asked.get() == count + 1 && service.finished.size() == 1, "within ten minutes it does not ask the server again, and still finishes");
        at(riyadh(2026, 11, 17, 10, 15)); service.finished.clear(); service.onStartJob(parameters); settle(); for (int i = 0; i < 200 && service.finished.isEmpty(); i++) Thread.sleep(5);
        check(asked.get() == count + 2, "fifteen minutes later it asks again");
        check(!service.onStopJob(parameters), "a stopped check waits for its next period");
        AlertCheckJob.cancel(context); check(Context.jobs.getPendingJob(AlertJobRules.JOB_ID) == null, "signing out cancels it");
        java.lang.System.out.println("Complaint alerts glue: " + checks + " checks passed (Android stand-ins; no device, notification shade, Doze or JobScheduler)");
    }
}

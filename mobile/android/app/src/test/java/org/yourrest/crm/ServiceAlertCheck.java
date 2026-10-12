package org.yourrest.crm;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Executes the actual notification policy plus the native integration contract for customer-service requests. */
public final class ServiceAlertCheck {
    static int checks;
    static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    static ServiceAlertPolicy.Alert alert(String id, String awaiting, String since, boolean seen) { return new ServiceAlertPolicy.Alert(id, "مصنع " + id, "قالب جديد", awaiting, since, seen); }
    static List<String> ids(List<ServiceAlertPolicy.Alert> alerts) { List<String> result = new ArrayList<>(); for (ServiceAlertPolicy.Alert alert : alerts) result.add(alert.id); return result; }
    static String block(String source, String start) {
        int from = source.indexOf(start);
        check(from >= 0, "Missing source block: " + start);
        int depth = 0, open = source.indexOf('{', from);
        for (int index = open; index < source.length(); index++) {
            if (source.charAt(index) == '{') depth++;
            if (source.charAt(index) == '}' && --depth == 0) return source.substring(from, index + 1);
        }
        throw new AssertionError("Unbalanced block: " + start);
    }
    public static void main(String[] args) throws Exception {
        final long minute = 60_000L, day = 24 * 3600 * 1000L, now = 1_800_000_000_000L;

        // ---- when the server is asked
        check(!ServiceAlertPolicy.shouldPoll(now, now - 599_999, true, false), "A background poll is not due before ten minutes");
        check(ServiceAlertPolicy.shouldPoll(now, now - 600_000, true, false), "A background poll is due at ten minutes");
        check(!ServiceAlertPolicy.shouldPoll(now, now - 3 * 3600 * 1000L, false, false), "No background poll outside the working window, however long ago");
        check(ServiceAlertPolicy.shouldPoll(now, 0, true, false), "The first background poll in a window is due at once");
        check(ServiceAlertPolicy.shouldPoll(now, now + 5 * minute, true, false), "A clock that moved back asks rather than waiting for a time that never comes");
        check(!ServiceAlertPolicy.shouldPoll(now, now - 59_999, true, true) && ServiceAlertPolicy.shouldPoll(now, now - 60_000, true, true), "Opening the app asks at most once a minute");
        check(ServiceAlertPolicy.shouldPoll(now, now - 2 * minute, false, true), "Opening asks even outside the window, so the person is current when they look");
        check(ServiceAlertPolicy.INTERVAL_MS == 600_000L && ServiceAlertPolicy.RESUME_GAP_MS == 60_000L, "The cadence is the decided ten minutes and one minute");

        // ---- which answers are acted on
        check(ServiceAlertPolicy.valid(alert("case-1", "first_contact", "2026-10-12T05:30:00.000Z", false)), "A well-formed alert is accepted");
        for (String awaiting : new String[] {"first_contact", "assign", "delegate", "approve"}) check(ServiceAlertPolicy.title(awaiting) != null && ServiceAlertPolicy.valid(alert("c", awaiting, "2026-10-12T05:30:00.000Z", false)), "Known stage " + awaiting);
        for (String awaiting : new String[] {"", "none", "ASSIGN", "assign ", null}) check(ServiceAlertPolicy.title(awaiting) == null && !ServiceAlertPolicy.valid(alert("c", awaiting, "2026-10-12T05:30:00.000Z", false)), "Unknown stage is ignored: " + awaiting);
        for (String id : new String[] {"", " ", "a b", "a/b", "a\"b", "a'b", "<x>", "a;b", "x".repeat(201), null}) check(!ServiceAlertPolicy.valid(alert(id, "assign", "2026-10-12T05:30:00.000Z", false)), "Unsafe case id is ignored: " + id);
        for (String since : new String[] {"", "yesterday", "<script>", "2026-10-12 05:30", "1".repeat(41), null}) check(!ServiceAlertPolicy.valid(alert("c", "assign", since, false)), "Malformed start is ignored: " + since);
        check(!ServiceAlertPolicy.valid(new ServiceAlertPolicy.Alert("c", " ", "n", "assign", "2026-10-12T05:30:00.000Z", false)) && !ServiceAlertPolicy.valid(new ServiceAlertPolicy.Alert("c", "x".repeat(201), "n", "assign", "2026-10-12T05:30:00.000Z", false)) && !ServiceAlertPolicy.valid(new ServiceAlertPolicy.Alert("c", "ok", "n".repeat(201), "assign", "2026-10-12T05:30:00.000Z", false)) && !ServiceAlertPolicy.valid(null), "Empty, oversized or missing text is ignored");

        // ---- which requests are news
        String t1 = "2026-10-12T05:30:00.000Z", t2 = "2026-10-12T09:00:00.000Z";
        Map<String, Long> remembered = new LinkedHashMap<>();
        List<ServiceAlertPolicy.Alert> served = Arrays.asList(alert("a", "first_contact", t1, false), alert("b", "first_contact", t1, true), alert("c", "assign", t1, false), alert("a", "first_contact", t1, false), alert("bad id", "assign", t1, false), alert("d", "weird", t1, false));
        check(ids(ServiceAlertPolicy.news(served, remembered)).equals(Arrays.asList("a", "c")), "Opened, duplicate and invalid requests are not news; order is kept");
        remembered.put(alert("a", "first_contact", t1, false).key(), now - minute);
        check(ids(ServiceAlertPolicy.news(served, remembered)).equals(Arrays.asList("c")), "An announced request is not news again");
        check(ids(ServiceAlertPolicy.news(Arrays.asList(alert("a", "first_contact", t2, false)), remembered)).equals(Arrays.asList("a")), "The same request with a new start (re-assigned) is news again");
        check(ServiceAlertPolicy.news(new ArrayList<>(), remembered).isEmpty(), "Nothing waiting, nothing to announce");

        // ---- what is remembered
        Map<String, Long> before = new LinkedHashMap<>();
        before.put("old@x", now - 31 * day); before.put("fresh@x", now - 2 * day);
        Map<String, Long> after = ServiceAlertPolicy.remember(before, Arrays.asList(alert("n", "assign", t1, false)), now);
        check(!after.containsKey("old@x") && after.containsKey("fresh@x") && after.get(alert("n", "assign", t1, false).key()) == now, "Old entries are forgotten after thirty days, new ones recorded with the time");
        check(before.size() == 2 && before.containsKey("old@x"), "The input map is not modified");
        Map<String, Long> many = new LinkedHashMap<>();
        for (int index = 0; index < ServiceAlertPolicy.MAX_REMEMBERED + 50; index++) many.put("k" + index + "@x", now - 1000L * (ServiceAlertPolicy.MAX_REMEMBERED + 50 - index));
        Map<String, Long> capped = ServiceAlertPolicy.remember(many, new ArrayList<>(), now);
        check(capped.size() == ServiceAlertPolicy.MAX_REMEMBERED && !capped.containsKey("k0@x") && capped.containsKey("k" + (ServiceAlertPolicy.MAX_REMEMBERED + 49) + "@x"), "The list is capped, keeping the newest");
        check(ServiceAlertPolicy.remember(new LinkedHashMap<>(), new ArrayList<>(), now).isEmpty(), "Remembering nothing leaves nothing");

        // ---- how a notification reads
        check(ServiceAlertPolicy.notices(new ArrayList<>()).isEmpty(), "No news, no notification");
        List<ServiceAlertPolicy.Notice> single = ServiceAlertPolicy.notices(Arrays.asList(alert("case-1", "first_contact", t1, false)));
        check(single.size() == 1 && single.get(0).title.equals("طلب جديد من خدمة العملاء") && single.get(0).text.equals("مصنع case-1 — قالب جديد") && "case-1".equals(single.get(0).caseId), "One request: its title, the customer and the need, and the request to open");
        check(!single.get(0).publicTitle.contains("مصنع") && !single.get(0).publicTitle.contains("case-1") && !single.get(0).publicTitle.contains("قالب"), "The lock-screen title carries neither customer nor need");
        check(ServiceAlertPolicy.notices(Arrays.asList(alert("c", "assign", t1, false))).get(0).title.equals("طلب بانتظار تكليفك") && ServiceAlertPolicy.notices(Arrays.asList(alert("c", "delegate", t1, false))).get(0).title.equals("طلب بانتظار تفويضك") && ServiceAlertPolicy.notices(Arrays.asList(alert("c", "approve", t1, false))).get(0).title.equals("طلب بانتظار اعتمادك"), "Each stage is worded for what the person must do");
        check(ServiceAlertPolicy.notices(Arrays.asList(new ServiceAlertPolicy.Alert("c", "مصنع", "", "assign", t1, false))).get(0).text.equals("مصنع"), "Without a need only the customer shows");
        check(ServiceAlertPolicy.notices(Arrays.asList(new ServiceAlertPolicy.Alert("c", "م", "ي".repeat(200), "assign", t1, false))).get(0).text.length() <= 160, "The text is bounded");
        List<ServiceAlertPolicy.Notice> three = ServiceAlertPolicy.notices(Arrays.asList(alert("c-1", "assign", t1, false), alert("c-2", "assign", t1, false), alert("c-3", "assign", t1, false)));
        Set<Integer> notificationIds = new HashSet<>();
        for (ServiceAlertPolicy.Notice notice : three) notificationIds.add(notice.id);
        check(three.size() == 3 && notificationIds.size() == 3 && notificationIds.stream().allMatch(id -> id >= 0 && id != ServiceAlertPolicy.SUMMARY_ID), "Up to three are announced one by one, each with its own notification");
        check(ServiceAlertPolicy.notices(Arrays.asList(alert("c-1", "assign", t1, false))).get(0).id == ServiceAlertPolicy.notices(Arrays.asList(alert("c-1", "assign", t2, false))).get(0).id, "The same request replaces its earlier notification instead of stacking");
        List<ServiceAlertPolicy.Notice> burst = ServiceAlertPolicy.notices(Arrays.asList(alert("c-1", "assign", t1, false), alert("c-2", "assign", t1, false), alert("c-3", "assign", t1, false), alert("c-4", "assign", t1, false), alert("c-5", "assign", t1, false)));
        check(burst.size() == 1 && burst.get(0).id == ServiceAlertPolicy.SUMMARY_ID && burst.get(0).caseId == null && burst.get(0).text.startsWith("5 ") && !burst.get(0).text.contains("مصنع"), "A burst becomes one summary that opens the app and names no customer");

        // ---- the native integration the policy depends on (source guards, as the other checks do)
        Path source = Path.of(args.length > 0 ? args[0] : "mobile/android/app/src/main/java/org/yourrest/crm");
        String activity = Files.readString(source.resolve("MainActivity.java")), service = Files.readString(source.resolve("RouteLocationService.java"));
        String api = Files.readString(source.resolve("ServiceAlertApi.java")), alerts = Files.readString(source.resolve("ServiceAlerts.java")), store = Files.readString(source.resolve("ServiceAlertStore.java"));
        String manifest = Files.readString(source.resolve("../../../../AndroidManifest.xml")), gradle = Files.readString(source.resolve("../../../../../../build.gradle"));
        String requested = block(activity, "private String requestedCase(");
        check(requested.contains("ServiceAlerts.OPEN.equals(intent.getAction())") && requested.contains("RouteRules.identifier(id)"), "A tapped notification is accepted only with the app's own action and a plain identifier");
        String newIntent = block(activity, "protected void onNewIntent(");
        check(newIntent.contains("RouteRules.trusted(web.getUrl())") && newIntent.contains("yourrest:open-service-case") && newIntent.contains("JSONObject.quote(id)") && newIntent.contains("#service-case="), "A running trusted page is told with a quoted identifier; otherwise the page loads with the request in its address");
        check(activity.contains("\"#service-case=\"+requested") && activity.contains("getIntent().removeExtra(ServiceAlerts.EXTRA_CASE)"), "A cold start from a notification opens the request and forgets it");
        check(block(activity, "protected void onResume(").contains("ServiceAlerts.poll(this,true)"), "Opening or returning to the app asks the server");
        check(block(service, "private final Runnable heartbeat").contains("ServiceAlerts.poll(RouteLocationService.this,false)"), "The tracking service asks on its own heartbeat, inside the working window");
        check(api.contains("RouteRules.ORIGIN + PATH") && api.contains("PATH = \"/api/service-queue/alerts\"") && api.contains("setInstanceFollowRedirects(false)") && api.contains("setRequestMethod(\"GET\")"), "The request goes to the fixed origin and path, without redirects");
        check(api.indexOf("throw new Failure(401") < api.indexOf("openConnection()") && api.contains("65536"), "Without a session no request is made, and the answer is bounded");
        check(!api.contains("setDoOutput") && !api.contains("evaluateJavascript") && !api.contains("Log."), "The session cookie is only sent, never exposed or logged");
        String poll = block(alerts, "static void poll(");
        check(poll.contains("worker.execute(") && poll.indexOf("store.lastPollAt(now)") < poll.indexOf("worker.execute(") && poll.contains("running.compareAndSet(false, true)"), "Polling never blocks the caller, is recorded before the network call and never overlaps itself");
        String run = block(alerts, "private static void run(");
        check(run.contains("MainActivity.resumed") && run.contains("areNotificationsEnabled()") && run.indexOf("ServiceAlertPolicy.news(") < run.indexOf("show(app"), "Nothing is announced to someone already looking at the app or without notification permission");
        check(run.contains("RouteRules.identifier(member)") && run.contains("store.remembered(member)") && run.contains("store.save(member"), "What was announced is remembered per member");
        check(store.contains("if (!member.equals(preferences.getString(\"member\", \"\"))) return result;"), "Another member on the same phone starts with nothing remembered");
        String show = block(alerts, "private static void show(");
        check(show.contains("IMPORTANCE_HIGH") && show.contains("VISIBILITY_PRIVATE") && show.contains("setPublicVersion(lockScreen)") && show.contains("FLAG_IMMUTABLE") && show.contains("setAutoCancel(true)") && show.contains("notice.publicTitle"), "A high-importance channel, private on the lock screen, with an immutable pending intent");
        check(!alerts.contains("customerPhone") && !alerts.contains("location") && !alerts.contains("registration"), "Nothing but the customer name and the short need can reach a notification");
        check(manifest.contains("android:launchMode=\"singleTop\"") && manifest.contains("android.permission.POST_NOTIFICATIONS") && !manifest.contains("android.permission.USE_FULL_SCREEN_INTENT"), "The activity is reused by a tapped notification; the notification permission is declared; nothing intrusive is requested");
        check(gradle.contains("versionCode 12") && gradle.contains("versionName '1.0.11'"), "The build that announces requests is the newer version, so installed apps accept it as an update");
        System.out.println("Native service alerts: " + checks + " checks passed (actual policy and integration guards; no device notification verification)");
    }
}

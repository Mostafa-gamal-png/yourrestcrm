package org.yourrest.crm;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/** «No more white screen» (1.0.15; the owner, 2026-11-19, a Huawei tablet without Google services): the pure rules exactly as the app runs
 *  them (LoadFailureRules, LoadWatch, with the production RouteRules): which callback covers the page with which words, the engine's
 *  Chromium version from a WebView's user agent and package (Google's and Huawei's), the watchdog's deadlines at their edges, an attempt
 *  from start to panel and back, the facts for support; then source guards on how MainActivity and LoadFailurePanel use them. With
 *  «--print-probe» it prints the probe the page is asked (tests/webview-load-android.mjs runs it in JavaScript). Not a device test. */
public final class LoadFailureRulesCheck {
    private static int checks;
    private static void check(boolean value, String what) { checks++; if (!value) throw new AssertionError("Check " + checks + " failed: " + what); }
    private static final String O = RouteRules.ORIGIN;
    private static final String GOOGLE_UA = "Mozilla/5.0 (Linux; Android 13; SM-X200 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Safari/537.36 YourrestCRM-Android/1";
    private static final String HUAWEI_UA = "Mozilla/5.0 (Linux; Android 10; BAH3-W09; HMSCore 6.13.0.302) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 HuaweiBrowser/14.0.4.300 Mobile Safari/537.36 YourrestCRM-Android/1";
    private static final Pattern ARABIC = Pattern.compile("[\\u0600-\\u06ff]");
    static String block(String source, String marker) {
        int begin = source.indexOf(marker); if (begin < 0) throw new AssertionError("Missing: " + marker);
        begin = source.indexOf('{', begin); int depth = 1, end = begin + 1;
        for (; end < source.length() && depth > 0; end++) { char c = source.charAt(end); if (c == '{') depth++; else if (c == '}') depth--; }
        if (depth != 0) throw new AssertionError("Unbalanced block: " + marker);
        return source.substring(begin + 1, end - 1);
    }
    private static int count(String text, String part) { int n = 0; for (int at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) n++; return n; }

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && "--print-probe".equals(args[0])) { java.lang.System.out.print(args.length > 1 ? LoadFailureRules.probeFor(args[1]) : LoadFailureRules.PROBE); return; }

        // ---- 1. The minimum engine and the deadlines.
        check(LoadFailureRules.MIN_CHROMIUM == 111, "the site is built for Chromium 111 (Vite 8's baseline-widely-available, vinext's cssTarget, Tailwind CSS 4)");
        check(LoadFailureRules.READY_GRACE_MS == 20000 && LoadFailureRules.LOAD_DEADLINE_MS == 60000 && LoadFailureRules.PROBE_INTERVAL_MS == 1000, "20 s after the page finished, 60 s after it started, asked every second");
        check(LoadFailureRules.LATE_WATCH_MS == 120000 && LoadFailureRules.QUIET_RECOVERY_MS == 60000, "two more minutes of watching; one quiet recovery a minute");

        // ---- 2. The engine's Chromium version.
        check(LoadFailureRules.chromiumMajor(GOOGLE_UA, "114.0.5735.196") == 114, "Google's WebView: from the user agent");
        check(LoadFailureRules.chromiumMajor(HUAWEI_UA, "12.0.0.300") == 99, "Huawei's WebView: Chrome/99 in the user agent, its own package numbering ignored");
        check(LoadFailureRules.chromiumMajor(HUAWEI_UA, "14.0.4.300") == 99, "HuaweiBrowser/14.0.4.300 in the user agent is not Chromium");
        check(LoadFailureRules.chromiumMajor(null, "114.0.5735.196") == 114, "without a user agent, Google's and AOSP's package version is Chromium's");
        check(LoadFailureRules.chromiumMajor(null, " 120.0.6099.230 ") == 120, "the version name trimmed");
        check(LoadFailureRules.chromiumMajor(null, "12.0.0.300") == -1, "Huawei's package version alone tells nothing: unknown (the watchdog decides)");
        check(LoadFailureRules.chromiumMajor(null, "36.0.0.0") == -1 && LoadFailureRules.chromiumMajor(null, "37.0.0.0") == 37, "below the first updatable WebView (37) a version is not Chromium's");
        check(LoadFailureRules.chromiumMajor(null, "114.0.5735") == -1 && LoadFailureRules.chromiumMajor(null, "114.0.5735.196-beta") == -1 && LoadFailureRules.chromiumMajor(null, "12345.0.0.0") == -1, "only a four-part numeric version");
        check(LoadFailureRules.chromiumMajor("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko)", "12.1.2.300") == -1, "a user agent without Chrome/ and Huawei's version: unknown");
        check(LoadFailureRules.chromiumMajor(null, null) == -1 && LoadFailureRules.chromiumMajor("", "") == -1, "nothing known: unknown");
        check(LoadFailureRules.chromiumMajor("Chrome/abc.1", null) == -1 && LoadFailureRules.chromiumMajor("Chrome/0.0.0.0", "110.0.1.1") == 110, "a token without a number, or 0, falls back to the package");
        check(LoadFailureRules.chromiumMajor("Chrome/112.0.0.0 Chrome/90.0.0.0", null) == 112, "the first Chrome/ token");
        check(LoadFailureRules.chromiumMajor("Mozilla/5.0 (iPad) CriOS/114.0.5735.124", null) == -1, "CriOS is not Chrome/");
        check(LoadFailureRules.chromiumMajor(GOOGLE_UA, "90.0.0.0") == 114, "the user agent names the engine actually loaded, before the package");
        check(LoadFailureRules.outdated(99) && LoadFailureRules.outdated(110) && !LoadFailureRules.outdated(111) && !LoadFailureRules.outdated(140), "110 is old, 111 is not");
        check(!LoadFailureRules.outdated(-1) && !LoadFailureRules.outdated(0), "an unknown version is never called old");

        // ---- 3. Which callback covers the page.
        check(LoadFailureRules.mainFrameFailure(true, O + "/") && LoadFailureRules.mainFrameFailure(true, O + "/?notification=1#service-case=abc"), "the CRM's main frame");
        check(!LoadFailureRules.mainFrameFailure(false, O + "/api/crm") && !LoadFailureRules.mainFrameFailure(true, "https://tile.openstreetmap.org/1/1/1.png"), "a resource or another site never covers the page");
        check(!LoadFailureRules.mainFrameFailure(true, "http://crm.yourrest.org/") && !LoadFailureRules.mainFrameFailure(true, "https://crm.yourrest.org.evil.example/") && !LoadFailureRules.mainFrameFailure(true, null), "only the trusted HTTPS origin");
        check(LoadFailureRules.sslCoversPage(O + "/", false) && !LoadFailureRules.sslCoversPage(O + "/api/crm", true), "a security failure covers the CRM's page only while it is not up");
        check(!LoadFailureRules.sslCoversPage("https://cdn.example/x.js", false) && !LoadFailureRules.sslCoversPage(null, false), "another host's certificate never covers the page");
        check(!LoadFailureRules.quietRecovery(true, Long.MAX_VALUE) && LoadFailureRules.quietRecovery(false, Long.MAX_VALUE), "a crash always shows the panel; a system stop the first time is quiet");
        check(!LoadFailureRules.quietRecovery(false, 59999) && LoadFailureRules.quietRecovery(false, 60000), "a second system stop within a minute shows the panel");

        // ---- 4. The failures and their technical line.
        LoadFailureRules.Failure dns = LoadFailureRules.Failure.web(-2, "net::ERR_NAME_NOT_RESOLVED", O + "/");
        check(dns.kind == LoadFailureRules.Kind.CONNECTION && dns.hard() && dns.error.equals("ERROR_HOST_LOOKUP (-2) net::ERR_NAME_NOT_RESOLVED") && dns.url.equals(O + "/"), "no name: no connection, its code and words");
        check(LoadFailureRules.Failure.web(-6, null, O + "/").error.equals("ERROR_CONNECT (-6)") && LoadFailureRules.Failure.web(-8, "", O + "/").kind == LoadFailureRules.Kind.CONNECTION, "a refused connection or a timeout: no connection, no description");
        check(LoadFailureRules.Failure.web(-11, "net::ERR_SSL_PROTOCOL_ERROR", O + "/").kind == LoadFailureRules.Kind.SECURITY, "a failed handshake is a security failure");
        check(LoadFailureRules.Failure.web(-1, "line one\nline\ttwo ", O + "/").error.equals("ERROR_UNKNOWN (-1) line one line two"), "a description is one line without control characters");
        String longWords = LoadFailureRules.Failure.web(-7, "x".repeat(500), O + "/").error;
        check(longWords.endsWith("…") && longWords.length() == "ERROR_IO (-7) ".length() + 161, "a long description is cut at 160 characters");
        check(LoadFailureRules.Failure.http(404, "Not Found", true, O + "/x") == null && LoadFailureRules.Failure.http(499, "", true, O + "/") == null && LoadFailureRules.Failure.http(200, "OK", true, O + "/") == null, "the site's own 4xx pages are left to the site");
        LoadFailureRules.Failure server = LoadFailureRules.Failure.http(502, "Bad Gateway", true, O + "/");
        check(server.kind == LoadFailureRules.Kind.SERVER && server.error.equals("HTTP 502 Bad Gateway"), "a server error, online");
        LoadFailureRules.Failure offline503 = LoadFailureRules.Failure.http(503, null, false, O + "/");
        check(offline503.kind == LoadFailureRules.Kind.CONNECTION && offline503.error.equals("HTTP 503; offline"), "a 503 while offline (a service worker with nothing cached) is worded as no connection");
        check(LoadFailureRules.Failure.http(500, "", true, O + "/").error.equals("HTTP 500"), "500 is a server error");
        LoadFailureRules.Failure clock = LoadFailureRules.Failure.ssl(4, LoadFailureRules.validity(Date.from(Instant.parse("2026-10-01T00:00:00Z")), Date.from(Instant.parse("2026-12-30T23:59:59Z"))), O + "/");
        check(clock.kind == LoadFailureRules.Kind.SECURITY && clock.error.equals("SSL_DATE_INVALID (4); certificate valid 2026-10-01 to 2026-12-30"), "a wrong clock: the primary error and the certificate's days");
        check(LoadFailureRules.Failure.ssl(3, null, O + "/").error.equals("SSL_UNTRUSTED (3)") && LoadFailureRules.Failure.ssl(9, "", O + "/").error.equals("SSL_ERROR (9)"), "without dates, or an unknown primary error");
        check(LoadFailureRules.Failure.renderer(true, O + "/").error.equals("renderer crashed") && LoadFailureRules.Failure.renderer(false, O + "/").error.equals("renderer stopped by the system"), "the renderer");
        check(LoadFailureRules.Failure.notStarted(LoadFailureRules.Probe.BLANK, 22500, O + "/").error.equals("the page stayed blank for 22 s") && !LoadFailureRules.Failure.notStarted(LoadFailureRules.Probe.BLANK, 1, O + "/").hard(), "the page did not come up: soft");
        check(LoadFailureRules.Failure.outdated(99).error.equals("Chromium 99 is older than 111") && LoadFailureRules.Failure.outdated(99).url == null, "an old engine");
        check(LoadFailureRules.Failure.unavailable("MissingWebViewPackageException").error.equals("WebView could not start: MissingWebViewPackageException") && LoadFailureRules.Failure.unavailable(null).error.equals("WebView could not start"), "no engine");
        LoadFailureRules.Failure[] everyKind = {dns, clock, server, LoadFailureRules.Failure.renderer(true, O), LoadFailureRules.Failure.notStarted(LoadFailureRules.Probe.WAIT, 0, O), LoadFailureRules.Failure.outdated(90), LoadFailureRules.Failure.unavailable("x")};
        for (int i = 0; i < everyKind.length; i++) check(everyKind[i].kind == LoadFailureRules.Kind.values()[i] && everyKind[i].hard() == (everyKind[i].kind != LoadFailureRules.Kind.NOT_STARTED), "every kind but NOT_STARTED holds the panel: " + LoadFailureRules.Kind.values()[i]);
        String[] webNames = {"ERROR_UNKNOWN", "ERROR_HOST_LOOKUP", "ERROR_UNSUPPORTED_AUTH_SCHEME", "ERROR_AUTHENTICATION", "ERROR_PROXY_AUTHENTICATION", "ERROR_CONNECT", "ERROR_IO", "ERROR_TIMEOUT", "ERROR_REDIRECT_LOOP", "ERROR_UNSUPPORTED_SCHEME", "ERROR_FAILED_SSL_HANDSHAKE", "ERROR_BAD_URL", "ERROR_FILE", "ERROR_FILE_NOT_FOUND", "ERROR_TOO_MANY_REQUESTS", "ERROR_UNSAFE_RESOURCE"};
        for (int i = 0; i < webNames.length; i++) check(LoadFailureRules.webErrorName(-1 - i).equals(webNames[i]), "WebViewClient's code " + (-1 - i));
        check(LoadFailureRules.webErrorName(-99).equals("ERROR") && LoadFailureRules.webErrorName(0).equals("ERROR"), "an unknown code");
        String[] sslNames = {"SSL_NOTYETVALID", "SSL_EXPIRED", "SSL_IDMISMATCH", "SSL_UNTRUSTED", "SSL_DATE_INVALID", "SSL_INVALID"};
        for (int i = 0; i < sslNames.length; i++) check(LoadFailureRules.sslErrorName(i).equals(sslNames[i]), "SslError's primary error " + i);

        // ---- 5. The probe and the watchdog.
        check(LoadFailureRules.probe("\"up\"") == LoadFailureRules.Probe.UP && LoadFailureRules.probe(" \"up\" ") == LoadFailureRules.Probe.UP, "up");
        check(LoadFailureRules.probe("\"blank\"") == LoadFailureRules.Probe.BLANK && LoadFailureRules.probe("\"wait\"") == LoadFailureRules.Probe.WAIT && LoadFailureRules.probe("\"elsewhere\"") == LoadFailureRules.Probe.ELSEWHERE, "blank, wait and elsewhere");
        for (String other : new String[]{null, "null", "\"error\"", "\"UP\"", "up", "", "{}", "\"up\"x"}) check(LoadFailureRules.probe(other) == LoadFailureRules.Probe.UNKNOWN, "anything else is unknown: " + other);
        String probe = LoadFailureRules.PROBE;
        check(probe.startsWith("(function(){try{if(location.origin!=='https://crm.yourrest.org')return 'elsewhere';") && probe.endsWith("}catch(e){return 'error';}})()"), "the probe answers only for a document of the CRM (not WebView's error page or a blank page still shown), in its own function, never throwing");
        check(probe.equals(LoadFailureRules.probeFor(O)) && LoadFailureRules.probeFor("http://127.0.0.1:43210").contains("location.origin!=='http://127.0.0.1:43210'"), "one probe, its origin given by the checks");
        for (String bad : new String[]{null, "", "javascript:alert(1)", "https://crm.yourrest.org/", "https://x'+alert(1)+'", "https://crm.yourrest.org:123456", "ftp://crm.yourrest.org"}) {
            boolean refused;
            try { LoadFailureRules.probeFor(bad); refused = false; } catch (IllegalArgumentException expected) { refused = true; }
            check(refused, "no other origin goes into the probe: " + bad);
        }
        check(!probe.contains("=>") && !Pattern.compile("\\b(let|const|class|async|await)\\b").matcher(probe).find() && !probe.contains("`") && !probe.contains("?.") && !probe.contains("??") && !probe.contains("..."), "ES5 only: an old engine runs it too");
        check(probe.contains("innerText") && probe.contains("getBoundingClientRect") && probe.contains("readyState==='loading'"), "text, a picture or control with a size, the parsing document");
        check(!probe.contains("localStorage") && !probe.contains("cookie") && !probe.contains("fetch") && !probe.contains("XMLHttpRequest") && !probe.contains("value"), "the probe reads no stored data, no field and sends nothing");
        check(LoadFailureRules.watchdog(0, -1, LoadFailureRules.Probe.UP, false) == LoadFailureRules.Verdict.READY, "up is ready at once, in front or not");
        check(LoadFailureRules.watchdog(10_000_000, 10_000_000, LoadFailureRules.Probe.BLANK, false) == LoadFailureRules.Verdict.WAIT, "nothing is decided while the app is not in front");
        check(LoadFailureRules.watchdog(25000, 19999, LoadFailureRules.Probe.BLANK, true) == LoadFailureRules.Verdict.WAIT && LoadFailureRules.watchdog(25000, 20000, LoadFailureRules.Probe.BLANK, true) == LoadFailureRules.Verdict.NOT_STARTED, "20 s after the page finished, to the millisecond");
        check(LoadFailureRules.watchdog(59999, -1, LoadFailureRules.Probe.BLANK, true) == LoadFailureRules.Verdict.WAIT && LoadFailureRules.watchdog(60000, -1, LoadFailureRules.Probe.WAIT, true) == LoadFailureRules.Verdict.NOT_STARTED, "60 s after a start that never finished");
        check(LoadFailureRules.watchdog(60000, 1000, LoadFailureRules.Probe.UNKNOWN, true) == LoadFailureRules.Verdict.NOT_STARTED, "the deadline from the start holds even when the page finished late");
        check(LoadFailureRules.watchdog(20000, 20000, LoadFailureRules.Probe.UNKNOWN, true) == LoadFailureRules.Verdict.NOT_STARTED, "a page that cannot answer the probe is not up");
        check(LoadFailureRules.watchdog(60000, -1, LoadFailureRules.Probe.ELSEWHERE, true) == LoadFailureRules.Verdict.NOT_STARTED && LoadFailureRules.watchdog(59999, -1, LoadFailureRules.Probe.ELSEWHERE, true) == LoadFailureRules.Verdict.WAIT, "a document that never becomes the CRM's is not up");

        // ---- 6. One attempt from start to panel and back (LoadWatch).
        LoadWatch watch = new LoadWatch();
        check(!watch.watching(0) && watch.probed(0, LoadFailureRules.Probe.UP, true, O + "/") == LoadFailureRules.Verdict.WAIT && !watch.up(), "before any load nothing is watched or decided");
        watch.restart(1000);
        long first = watch.attempt();
        check(watch.watching(1000) && watch.probed(1500, LoadFailureRules.Probe.WAIT, true, O + "/") == LoadFailureRules.Verdict.WAIT, "a load is watched");
        check(watch.probed(1600, LoadFailureRules.Probe.ELSEWHERE, true, O + "/") == LoadFailureRules.Verdict.WAIT && !watch.up(), "the error page still shown while the next page loads is never this page up");
        watch.pageFinished(3000); watch.pageFinished(9000);
        check(watch.probed(22999, LoadFailureRules.Probe.BLANK, true, O + "/") == LoadFailureRules.Verdict.WAIT, "19.999 s after the first finish: still waiting (a later finish does not move it)");
        check(watch.probed(23000, null, true, O + "/?notification=5#service-case=x") == LoadFailureRules.Verdict.NOT_STARTED && watch.failure().kind == LoadFailureRules.Kind.NOT_STARTED, "20 s: the page did not come up, once (the last answer stands without a new one)");
        check(watch.failure().url.equals(O + "/?notification=5#service-case=x") && !watch.hardFailure() && watch.watching(23000), "soft: watched on");
        check(watch.probed(24000, LoadFailureRules.Probe.BLANK, true, O + "/") == LoadFailureRules.Verdict.WAIT, "not said twice");
        check(watch.probed(30000, LoadFailureRules.Probe.UP, true, O + "/") == LoadFailureRules.Verdict.READY && watch.up() && watch.failure() == null && !watch.watching(30000), "the page appears after all: the soft panel goes and the watch stops");
        check(watch.probed(31000, LoadFailureRules.Probe.BLANK, true, O + "/") == LoadFailureRules.Verdict.WAIT, "a page that is up is not judged again");
        watch.restart(40000);
        check(watch.attempt() == first + 1 && !watch.up() && watch.failure() == null && watch.lastProbe() == LoadFailureRules.Probe.WAIT, "a new attempt forgets everything");
        watch.pageFinished(41000);
        watch.probed(61000, LoadFailureRules.Probe.BLANK, true, O + "/");
        check(watch.failure() != null && watch.watching(61000 + LoadFailureRules.LATE_WATCH_MS - 1) && !watch.watching(61000 + LoadFailureRules.LATE_WATCH_MS), "after the soft panel the page is watched two more minutes, then no more");
        check(watch.pageStarted(70000) && watch.failure() == null, "a new page of the CRM starting takes the soft panel away");
        check(watch.fail(LoadFailureRules.Failure.http(503, "", true, O + "/"), 70500) && watch.failure().kind == LoadFailureRules.Kind.SERVER && watch.hardFailure(), "a server error is hard");
        check(!watch.pageStarted(70600) && watch.failure().kind == LoadFailureRules.Kind.SERVER, "WebView's own error page starting does not take the panel away");
        check(!watch.fail(LoadFailureRules.Failure.web(-2, "", O + "/"), 70700) && watch.failure().kind == LoadFailureRules.Kind.SERVER, "the first hard failure stays");
        check(!watch.watching(70800) && watch.probed(200000, LoadFailureRules.Probe.UP, true, O + "/") == LoadFailureRules.Verdict.WAIT && !watch.up(), "an error page's text never counts as the page up: nothing is asked or decided under a hard failure");
        check(!watch.fail(null, 1), "nothing to record");
        watch.restart(80000);
        check(watch.fail(LoadFailureRules.Failure.ssl(4, null, O + "/"), 80100) && !watch.fail(LoadFailureRules.Failure.web(-11, "net::ERR_FAILED", O + "/"), 80200) && watch.failure().error.startsWith("SSL_DATE_INVALID"), "a cancelled handshake's later error does not replace the security failure");
        watch.restart(90000); watch.pageFinished(91000);
        watch.probed(111000, LoadFailureRules.Probe.BLANK, true, O + "/");
        check(watch.fail(LoadFailureRules.Failure.renderer(true, O + "/"), 111500) && watch.failure().kind == LoadFailureRules.Kind.RENDERER, "a hard failure replaces the soft one");
        watch.restart(120000);
        check(watch.fail(LoadFailureRules.Failure.web(-2, "", O + "/"), 120100) && !watch.fail(LoadFailureRules.Failure.notStarted(LoadFailureRules.Probe.BLANK, 1, O + "/"), 120200), "a soft failure never replaces a hard one");
        watch.restart(130000);
        check(watch.probed(500000, LoadFailureRules.Probe.BLANK, false, O + "/") == LoadFailureRules.Verdict.WAIT && watch.failure() == null, "in the background nothing is decided, however long");
        check(watch.probed(500001, null, true, O + "/") == LoadFailureRules.Verdict.NOT_STARTED, "back in front, the deadline long past: the panel at once");
        watch.restart(600000);
        check(watch.probed(600500, LoadFailureRules.Probe.UP, true, O + "/") == LoadFailureRules.Verdict.READY && watch.fail(LoadFailureRules.Failure.web(-2, "", O + "/"), 601000) && !watch.up(), "a main-frame failure after the page was up covers it");
        LoadWatch fresh = new LoadWatch();
        check(fresh.fail(LoadFailureRules.Failure.renderer(true, O + "/"), 5) && fresh.hardFailure(), "a failure without a load before it is recorded too");

        // ---- 7. What «إعادة المحاولة» loads.
        check(LoadFailureRules.retryUrl(O + "/?notification=1#service-case=abc").equals(O + "/?notification=1#service-case=abc"), "the page that failed, its notification fragment included");
        check(LoadFailureRules.retryUrl(O + "/api/exports/customers.xlsx").equals(O + "/") && LoadFailureRules.retryUrl(O + "/api").equals(O + "/"), "a failed API address: the first page");
        check(LoadFailureRules.retryUrl(O + "/apiary").equals(O + "/apiary") && LoadFailureRules.retryUrl(O).equals(O), "a page whose name starts with api is a page");
        check(LoadFailureRules.retryUrl(null).equals(O + "/") && LoadFailureRules.retryUrl("https://evil.example/").equals(O + "/") && LoadFailureRules.retryUrl("http://crm.yourrest.org/").equals(O + "/"), "anything else: the first page");

        // ---- 8. The words.
        check(LoadFailureRules.message(LoadFailureRules.Kind.CONNECTION, false).equals("تعذّر الاتصال بالنظام. تأكد من الاتصال بالإنترنت ثم أعد المحاولة."), "no connection, the owner's words");
        check(LoadFailureRules.message(LoadFailureRules.Kind.SECURITY, false).equals("تعذّر التحقق من أمان الاتصال. تأكد أن تاريخ الجهاز ووقته مضبوطان تلقائيًا، ثم أعد المحاولة."), "security, the owner's words");
        check(LoadFailureRules.message(LoadFailureRules.Kind.SERVER, false).equals("النظام لا يستجيب الآن. أعد المحاولة بعد قليل."), "server, the owner's words");
        check(LoadFailureRules.message(LoadFailureRules.Kind.OUTDATED, false).equals("محرك عرض الصفحات (WebView) على هذا الجهاز قديم. حدّثه من متجر التطبيقات (AppGallery أو Google Play) ثم أعد فتح التطبيق."), "old engine, the owner's words");
        for (LoadFailureRules.Kind kind : LoadFailureRules.Kind.values()) {
            String ar = LoadFailureRules.title(kind, false) + " " + LoadFailureRules.message(kind, false), en = LoadFailureRules.title(kind, true) + " " + LoadFailureRules.message(kind, true);
            check(ARABIC.matcher(ar).find() && !ARABIC.matcher(en).find() && !en.isEmpty(), "Arabic and English words: " + kind);
            check(ar.replaceAll("WebView|AppGallery|Google Play", "").chars().noneMatch(c -> (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')), "the Arabic names only WebView and the two stores in Latin letters: " + kind);
        }
        check(LoadFailureRules.message(LoadFailureRules.Kind.NOT_STARTED, false).contains("WebView") && LoadFailureRules.message(LoadFailureRules.Kind.NOT_STARTED, true).contains("AppGallery or Google Play"), "a page that did not come up points at the engine too");
        check(!LoadFailureRules.title(LoadFailureRules.Kind.OUTDATED, false).equals(LoadFailureRules.title(LoadFailureRules.Kind.CONNECTION, false)) && LoadFailureRules.title(LoadFailureRules.Kind.SERVER, false).equals("تعذّر فتح النظام"), "titles");
        check(LoadFailureRules.engineLine("com.huawei.webview", "12.0.0.300", 99, false).equals("المحرك المثبّت: com.huawei.webview 12.0.0.300 (Chromium 99)، والمطلوب Chromium 111 أو أحدث."), "the engine named, in Arabic");
        check(LoadFailureRules.engineLine("com.google.android.webview", "110.0.5481.153", 110, true).equals("Installed engine: com.google.android.webview 110.0.5481.153 (Chromium 110); Chromium 111 or newer is needed."), "and in English");
        check(LoadFailureRules.engineLine(null, "", -1, true).equals("Installed engine: unknown unknown (Chromium ?); Chromium 111 or newer is needed."), "nothing known");
        check(LoadFailureRules.retry(false).equals("إعادة المحاولة") && LoadFailureRules.retry(true).equals("Try again"), "«إعادة المحاولة»");
        check(LoadFailureRules.continueAnyway(false).equals("المتابعة رغم ذلك") && LoadFailureRules.detailsHeading(false).equals("معلومات للدعم الفني") && LoadFailureRules.detailsHeading(true).equals("Details for technical support"), "the other words");

        // ---- 9. The facts for one screenshot.
        LoadFailureRules.Facts facts = new LoadFailureRules.Facts();
        facts.webViewPackage = "com.huawei.webview"; facts.webViewVersion = "12.0.0.300"; facts.chromium = 99; facts.androidRelease = "10"; facts.sdk = 29;
        facts.manufacturer = "HUAWEI"; facts.model = "BAH3-W09"; facts.appVersion = "1.0.15"; facts.appCode = 16; facts.page = O + "/";
        facts.deviceTime = LoadFailureRules.deviceTime(Instant.parse("2026-11-19T12:02:11Z").toEpochMilli(), ZoneId.of("Asia/Riyadh"));
        String details = LoadFailureRules.details(facts, LoadFailureRules.Failure.web(-2, "net::ERR_NAME_NOT_RESOLVED", O + "/?notification=7#service-case=secret"));
        check(details.equals("WebView: com.huawei.webview 12.0.0.300 (Chromium 99)\nAndroid 10 (API 29) · HUAWEI BAH3-W09\nApp: 1.0.15 (16)\nError: ERROR_HOST_LOOKUP (-2) net::ERR_NAME_NOT_RESOLVED\nPage: https://crm.yourrest.org/\nDevice time: 2026-11-19 15:02:11 +03:00"), "the engine, Android, the device, the app, the error, the page and the clock:\n" + details);
        check(!details.contains("secret") && !details.contains("notification"), "a notification's identifier is not in a screenshot");
        LoadFailureRules.Facts unknown = new LoadFailureRules.Facts();
        String bare = LoadFailureRules.details(unknown, null);
        check(bare.equals("WebView: unknown unknown (Chromium unknown)\nAndroid unknown (API 0) · unknown unknown\nApp: unknown (0)\nDevice time: unknown"), "nothing known, no failure:\n" + bare);
        unknown.model = "M".repeat(200); unknown.page = O + "/login";
        check(LoadFailureRules.details(unknown, LoadFailureRules.Failure.outdated(90)).contains("Error: Chromium 90 is older than 111\nPage: https://crm.yourrest.org/login\n") && LoadFailureRules.details(unknown, null).contains("…"), "a failure without a page lists the page known; a long model is cut");
        check(LoadFailureRules.pageForDetails(O + "/mold-sign?token=abc#x").equals(O + "/mold-sign") && LoadFailureRules.pageForDetails(O).equals(O + "/") && LoadFailureRules.pageForDetails("https://evil.example/") == null && LoadFailureRules.pageForDetails(null) == null, "the page without its query or fragment, the CRM's only");
        check(LoadFailureRules.deviceTime(0, ZoneOffset.UTC).equals("1970-01-01 00:00:00 +00:00"), "a device whose clock was reset shows it");
        check(LoadFailureRules.validity(null, new Date()) == null && LoadFailureRules.validity(new Date(), null) == null, "validity needs both days");
        check(LoadFailureRules.clip("a\u0000b\u001fc", 10).equals("a b c") && LoadFailureRules.clip("  ok  ", 10).equals("ok"), "control characters become spaces");

        // ---- 10. Source guards: how the activity and the panel use the rules (WebView's callbacks cannot run on the JVM).
        Path source = Path.of(args.length > 0 ? args[0] : "mobile/android/app/src/main/java/org/yourrest/crm");
        String activity = Files.readString(source.resolve("MainActivity.java")), panel = Files.readString(source.resolve("LoadFailurePanel.java"));
        try (Stream<Path> all = Files.list(source)) {
            for (Path file : (Iterable<Path>) all::iterator) {
                String text = Files.readString(file);
                check(!text.contains(".proceed(") && !text.contains("handler.proceed"), "no TLS failure is ever allowed through: " + file.getFileName());
            }
        }
        String ssl = block(activity, "public void onReceivedSslError(");
        check(ssl.startsWith("handler.cancel();") && ssl.contains("LoadFailureRules.sslCoversPage(error.getUrl(),loadWatch.up())") && ssl.contains("failed(LoadFailureRules.Failure.ssl(error.getPrimaryError(),certificateValidity(error),error.getUrl()))"), "a TLS failure is refused first, then the panel for the CRM's page");
        String error = block(activity, "public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error)");
        check(error.contains("LoadFailureRules.mainFrameFailure(request.isForMainFrame(),url)") && error.contains("failed(LoadFailureRules.Failure.web(error.getErrorCode(),error.getDescription(),url))"), "a main-frame error shows the panel");
        String http = block(activity, "public void onReceivedHttpError(");
        check(http.contains("LoadFailureRules.mainFrameFailure(request.isForMainFrame(),url)") && http.contains("failed(LoadFailureRules.Failure.http(response.getStatusCode(),response.getReasonPhrase(),online(),url))"), "a main-frame server error shows the panel");
        String gone = block(activity, "public boolean onRenderProcessGone(");
        check(gone.equals("rendererGone(view,detail.didCrash());return true;"), "a lost renderer is handled and never crashes the app");
        String renderer = block(activity, "private void rendererGone(");
        check(renderer.indexOf("dropWebView();") < renderer.indexOf("LoadFailureRules.quietRecovery(") && renderer.contains("loadMain(target)") && renderer.contains("showFailure(loadWatch.failure())"), "the WebView goes, then a quiet recovery or the panel");
        String drop = block(activity, "private void dropWebView(");
        check(drop.contains("web=null") && drop.contains("pageNonce=\"\"") && drop.contains("files.onReceiveValue(null)") && drop.contains("completeForegroundGeolocation(false)") && drop.contains("container.removeView(gone)") && drop.contains("gone.destroy()") && drop.contains("removeJavascriptInterface(\"YourrestNativeChannel\")"), "a dropped WebView takes its bridge, its waiting callbacks and itself away");
        check(drop.contains("if(designTask!=null&&designSave==null){designTask.cancel();designFinished(designTask);}"), "a design file still being fetched for the lost page stops, so the next one is not refused as «another file»");
        String failed = block(activity, "private void failed(");
        check(failed.contains("if(!loadWatch.fail(failure,SystemClock.elapsedRealtime()))return;") && failed.contains("pageNonce=\"\"") && failed.contains("showFailure(loadWatch.failure())"), "a failure drops the bridge and shows the panel");
        String show = block(activity, "private void showFailure(");
        check(show.contains("failurePanel.show(failure.kind,english,LoadFailureRules.title(failure.kind,english),LoadFailureRules.message(failure.kind,english),extra,LoadFailureRules.details(facts,failure),failure.kind==LoadFailureRules.Kind.OUTDATED)") && show.contains("LoadFailureRules.engineLine("), "the panel: title, message, the engine for an old one, details, continue only for an old engine");
        check(block(activity, "private boolean english(").contains("NearbyRules.english(getSharedPreferences(\"native\",0).getString(\"language\",\"ar\"))"), "in the language the person chose in the CRM page, Arabic by default");
        String finished = block(activity, "public void onPageFinished(");
        check(finished.contains("&&!loadWatch.hardFailure()){pageNonce=UUID.randomUUID().toString();installBridge();") && finished.contains("loadWatch.pageFinished("), "no bridge on a page under the panel; the finish is recorded");
        check(block(activity, "private void rememberLanguage(").contains("if(loadWatch.hardFailure())return;"), "an error page does not reset the language");
        String navigation = block(activity, "public boolean shouldOverrideUrlLoading(");
        int hook = navigation.indexOf("if(request.isForMainFrame()&&view==web&&RouteRules.trusted(url)&&loadWatch.pageStarted(SystemClock.elapsedRealtime()))watch();");
        check(hook > navigation.indexOf("openDesignFile(url,true,request.hasGesture());return true;}") && hook < navigation.indexOf("if(RouteRules.trusted(url))return false;"), "a CRM page the page navigates to is watched from the start of its navigation (after the design files' interception, before it loads)");
        String started = block(activity, "public void onPageStarted(");
        check(started.indexOf("if(!RouteRules.trusted(url)){view.stopLoading();return;}") < started.indexOf("loadWatch.pageStarted("), "only a trusted page starts an attempt");
        String create = block(activity, "public void onCreate(");
        check(create.contains("if(createWebView())openStart();") && !create.contains("web.loadUrl(") && create.contains("startUrl=RouteRules.ORIGIN+\"/\"+("), "the first page goes through the engine check");
        String webview = block(activity, "private boolean createWebView(");
        check(webview.trim().startsWith("try{web=new WebView(this);}") && webview.contains("catch(RuntimeException unavailable)") && webview.contains("LoadFailureRules.Failure.unavailable(") && webview.contains("container.addView(web,0)"), "a device without a working WebView gets the panel, not a crash; the WebView stays under the panel");
        String start = block(activity, "private void openStart(");
        check(start.indexOf("LoadFailureRules.outdated(facts.chromium)") < start.indexOf("loadMain(startUrl)") && start.contains("if(!engineAccepted)") && start.contains("showFailure(LoadFailureRules.Failure.outdated(facts.chromium));return;"), "an old engine is told at once, before any load");
        check(activity.contains("public void continueAnyway(){engineAccepted=true;openStart();}") && activity.contains("public void retry(){retryLoad();}"), "the panel's two buttons");
        check(count(activity, "web.loadUrl(") == 1 && block(activity, "private void loadMain(").contains("loadWatch.restart(SystemClock.elapsedRealtime());failurePanel.hide();") && block(activity, "private void loadMain(").contains("web.loadUrl(url);watch();"), "every page the app loads itself is watched");
        String newIntent = block(activity, "protected void onNewIntent(");
        check(count(newIntent, "openRequested(") == 3 && newIntent.contains("boolean ready=web!=null&&!pageNonce.isEmpty()&&RouteRules.trusted(web.getUrl());"), "a notification's page while the CRM is not ready goes through the same door");
        String retry = block(activity, "private void retryLoad(");
        check(retry.contains("LoadFailureRules.retryUrl(") && retry.contains("openStart()"), "«إعادة المحاولة» loads the failed page again, or checks the engine again");
        String tick = block(activity, "private void probe(");
        check(tick.indexOf("watchdog.postDelayed(probeTick,LoadFailureRules.PROBE_INTERVAL_MS)") < tick.indexOf("web.evaluateJavascript(LoadFailureRules.PROBE,") && tick.contains("loadWatch.attempt()==attempt"), "the next ask is set before this one is answered; an earlier attempt's answer is dropped");
        check(block(activity, "private void decide(").contains("loadWatch.probed(now,answer,resumed,"), "decided only in front");
        check(block(activity, "protected void onPause(").startsWith("rememberLanguage();watchdog.removeCallbacks(probeTick);") && block(activity, "protected void onResume(").trim().endsWith("watch();"), "not asked in the background; asked again on return");
        check(block(activity, "protected void onDestroy(").contains("watchdog.removeCallbacksAndMessages(null)"), "nothing is asked after the activity is gone");
        check(!activity.contains("if(!resumed){") || activity.indexOf("if(!resumed)") > activity.indexOf("RouteTracker.Reply reply="), "the bridge's hidden-page guard is still the first of its kind (TripStartCheck)");
        check(panel.contains("LoadFailureRules.retry(english)") && panel.contains("actions.retry()") && panel.contains("LoadFailureRules.continueAnyway(english)") && panel.contains("if (offerContinue)"), "the panel's buttons");
        check(panel.contains("facts.setTextIsSelectable(true)") && panel.contains("facts.setTextDirection(View.TEXT_DIRECTION_LTR)") && panel.contains("scroll.setLayoutDirection(english ? View.LAYOUT_DIRECTION_LTR : View.LAYOUT_DIRECTION_RTL)"), "the details can be copied and read left to right; the panel follows the language");
        check(panel.contains("IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS") && panel.contains("scroll.setClickable(true)") && panel.contains("announceForAccessibility("), "the page under it is hidden from accessibility and gets no touch; the reason is announced");
        check(!panel.contains("loadUrl") && !panel.contains("loadData") && !panel.contains("evaluateJavascript") && !panel.contains("new WebView"), "the panel is a native view, not a page");
        check(panel.contains("WebView.getCurrentWebViewPackage()") && panel.contains("LoadFailureRules.chromiumMajor(userAgent(context, web), facts.webViewVersion)") && panel.contains("Build.MANUFACTURER") && panel.contains("Build.MODEL") && panel.contains("Build.VERSION.RELEASE"), "the facts come from the provider, the user agent and the device");
        for (String text : new String[]{activity, panel, Files.readString(source.resolve("LoadFailureRules.java")), Files.readString(source.resolve("LoadWatch.java"))})
            check(!text.contains("Log.") && !text.contains("printStackTrace") && !text.contains("System.out"), "nothing is logged");
        Matcher minimum = Pattern.compile("MIN_CHROMIUM = (\\d+);").matcher(Files.readString(source.resolve("LoadFailureRules.java")));
        check(minimum.find() && minimum.group(1).equals("111"), "one place for the minimum");
        java.lang.System.out.println("Load failure rules: " + checks + " checks passed (no WebView, network, TLS or renderer verified on a device)");
    }
}

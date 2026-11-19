package org.yourrest.crm;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** When the CRM's main page cannot be shown (1.0.15; the owner, 2026-11-19: a Huawei tablet without Google services showed only a white
 *  screen): which failure it is, whether it covers the page, the words of the panel in Arabic or English, and the facts it lists so one
 *  screenshot is enough to diagnose it. Pure (no Android class), checked on the JVM by LoadFailureRulesCheck. */
final class LoadFailureRules {
    /** The oldest Chromium the site is built for. The page's JavaScript is built by vinext on Vite 8 with no build.target of its own, so
     *  Vite's default 'baseline-widely-available' applies: chrome111, edge111, firefox114, safari16.4 (vite/dist/node/chunks/logger.js,
     *  ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET); vinext sets the CSS target to chrome111 too (its build.cssTarget), and the styles are
     *  Tailwind CSS 4.2, whose colours are oklch() and color-mix() (Chrome 111). Below it the page is not expected to work. */
    static final int MIN_CHROMIUM = 111;
    /** The owner's watchdog: after the page finished loading, it may stay blank this long before the panel says it did not come up. */
    static final long READY_GRACE_MS = 20000;
    /** A load that never finishes and stays blank gets the panel this long after it started (a slow network keeps loading underneath). */
    static final long LOAD_DEADLINE_MS = 60000;
    /** How often the page is asked whether it shows anything while it is not up yet. */
    static final long PROBE_INTERVAL_MS = 1000;
    /** After «the page did not come up», the page is still watched this long: if it appears after all, the panel goes by itself. */
    static final long LATE_WATCH_MS = 120000;
    /** A renderer the system killed to free memory (not a crash) is recreated quietly, at most once in this period; again sooner shows
     *  the panel. */
    static final long QUIET_RECOVERY_MS = 60000;
    /** WebViewClient.ERROR_FAILED_SSL_HANDSHAKE: a failed handshake is a security failure, worded as one (the device's clock). */
    static final int ERROR_FAILED_SSL_HANDSHAKE = -11;

    enum Kind { CONNECTION, SECURITY, SERVER, RENDERER, NOT_STARTED, OUTDATED, UNAVAILABLE }
    /** What the page answered to PROBE: something shows (UP), the document is there but nothing shows (BLANK), the document is still
     *  being parsed (WAIT), the document is not the CRM's (ELSEWHERE: WebView's own error page or a blank one, still shown while the next
     *  page loads), or no usable answer (UNKNOWN: a page that cannot run even the probe, or no answer yet). Only UP is up. */
    enum Probe { UP, BLANK, WAIT, ELSEWHERE, UNKNOWN }
    enum Verdict { READY, WAIT, NOT_STARTED }

    /** One failure of the main page: its kind, the technical line the panel shows and the page it happened on. */
    static final class Failure {
        final Kind kind;
        final String error;
        final String url;
        private Failure(Kind kind, String error, String url) { this.kind = kind; this.error = error; this.url = url; }
        /** A hard failure holds the panel until the person retries; a soft one (the page did not come up) goes if the page appears. */
        boolean hard() { return kind != Kind.NOT_STARTED; }

        /** WebViewClient.onReceivedError of the main frame: no connection, the name not found, a timeout... (a failed TLS handshake is a
         *  security failure). */
        static Failure web(int code, CharSequence description, String url) {
            String text = clip(description == null ? "" : description.toString(), 160);
            return new Failure(code == ERROR_FAILED_SSL_HANDSHAKE ? Kind.SECURITY : Kind.CONNECTION,
                    webErrorName(code) + " (" + code + ")" + (text.isEmpty() ? "" : " " + text), url);
        }
        /** onReceivedSslError of the main page: the primary error, and the certificate's validity when known (a wrong clock shows here). */
        static Failure ssl(int primary, String validity, String url) {
            String valid = validity == null || validity.isEmpty() ? "" : "; certificate valid " + validity;
            return new Failure(Kind.SECURITY, sslErrorName(primary) + " (" + primary + ")" + valid, url);
        }
        /** onReceivedHttpError of the main frame: only a server error (5xx) covers the page; offline it is worded as no connection (a service
         *  worker with nothing cached answers 503). Null for anything else: the site's own pages answer 404 and the like themselves. */
        static Failure http(int status, String reason, boolean online, String url) {
            if (status < 500) return null;
            String text = clip(reason == null ? "" : reason, 80);
            return new Failure(online ? Kind.SERVER : Kind.CONNECTION, "HTTP " + status + (text.isEmpty() ? "" : " " + text) + (online ? "" : "; offline"), url);
        }
        static Failure renderer(boolean crashed, String url) {
            return new Failure(Kind.RENDERER, crashed ? "renderer crashed" : "renderer stopped by the system", url);
        }
        static Failure notStarted(Probe probe, long waitedMs, String url) {
            return new Failure(Kind.NOT_STARTED, "the page stayed " + probe.name().toLowerCase(Locale.ROOT) + " for " + Math.max(0, waitedMs / 1000) + " s", url);
        }
        static Failure outdated(int chromium) {
            return new Failure(Kind.OUTDATED, "Chromium " + chromium + " is older than " + MIN_CHROMIUM, null);
        }
        static Failure unavailable(String problem) {
            return new Failure(Kind.UNAVAILABLE, "WebView could not start" + (problem == null || problem.isEmpty() ? "" : ": " + clip(problem, 120)), null);
        }
    }

    /** A main-frame callback covers the page only for the CRM's own address (navigation elsewhere never loads in the app). */
    static boolean mainFrameFailure(boolean mainFrame, String url) { return mainFrame && RouteRules.trusted(url); }
    /** onReceivedSslError comes for every resource: the panel only for the CRM's own address while its page is not up (a later failing
     *  resource of a page already shown is cancelled as before, without covering the page). The handshake is never allowed. */
    static boolean sslCoversPage(String url, boolean pageUp) { return RouteRules.trusted(url) && !pageUp; }
    /** A renderer the system stopped for memory (not a crash) is recreated without a word, unless that happened in the last minute. */
    static boolean quietRecovery(boolean crashed, long sinceLastQuiet) { return !crashed && sinceLastQuiet >= QUIET_RECOVERY_MS; }

    // ---- The engine's version.
    private static final Pattern UA_CHROME = Pattern.compile("(?:^|[^A-Za-z])Chrome/(\\d{1,4})\\.");
    private static final Pattern CHROMIUM_VERSION = Pattern.compile("(\\d{1,4})\\.\\d{1,6}\\.\\d{1,6}\\.\\d{1,6}");
    /** The Chromium major version of the WebView, or -1 when it cannot be told. The user agent names the engine actually loaded
     *  («Chrome/99.0.4844.88», Huawei's WebView too); the provider's own version name is Chromium's only for Google's and AOSP's WebView
     *  («114.0.5735.196»): Huawei numbers its package itself («12.0.0.300»), so a first part under 37 (the first updatable WebView) is
     *  not read as Chromium. Unknown means the watchdog decides. */
    static int chromiumMajor(String userAgent, String providerVersion) {
        if (userAgent != null) {
            Matcher match = UA_CHROME.matcher(userAgent);
            if (match.find()) { int major = Integer.parseInt(match.group(1)); if (major > 0) return major; }
        }
        if (providerVersion != null) {
            Matcher match = CHROMIUM_VERSION.matcher(providerVersion.trim());
            if (match.matches()) { int major = Integer.parseInt(match.group(1)); if (major >= 37) return major; }
        }
        return -1;
    }
    static boolean outdated(int chromium) { return chromium > 0 && chromium < MIN_CHROMIUM; }

    // ---- Whether the page came up.
    /** Asked of the page with evaluateJavascript (ES5 only, so an old engine runs it too; reads nothing of the person's data): «elsewhere»
     *  for a document that is not the CRM's (WebView's error page, a blank page shown while the next one loads: evaluateJavascript runs in
     *  the document shown, which is not yet the one being loaded); «up» once the body shows text, or a picture or control with a size;
     *  «blank» when the body is there and shows nothing (the site's offline shell before its script draws it, or a page whose script
     *  cannot run); «wait» while the document is still being parsed. */
    private static final Pattern PROBE_ORIGIN = Pattern.compile("https?://[A-Za-z0-9.-]{1,253}(:\\d{1,5})?");
    static final String PROBE = probeFor(RouteRules.ORIGIN);
    /** The probe for one origin: the app's is RouteRules.ORIGIN; the checks run it on their own test origins. */
    static String probeFor(String origin) {
        if (origin == null || !PROBE_ORIGIN.matcher(origin).matches()) throw new IllegalArgumentException("origin");
        return "(function(){try{if(location.origin!=='" + origin + "')return 'elsewhere';var d=document,b=d.body;if(!b)return d.readyState==='loading'?'wait':'blank';"
                + "if((b.innerText||'').replace(/\\s+/g,'').length>0)return 'up';"
                + "var m=b.querySelectorAll('img,svg,canvas,video,input,button,select,textarea,iframe');"
                + "for(var i=0;i<m.length&&i<200;i++){var r=m[i].getBoundingClientRect();if(r.width>0&&r.height>0)return 'up';}"
                + "return d.readyState==='loading'?'wait':'blank';}catch(e){return 'error';}})()";
    }
    /** The answer of evaluateJavascript (JSON: «"up"»), or null. */
    static Probe probe(String evaluated) {
        if (evaluated == null) return Probe.UNKNOWN;
        switch (evaluated.trim()) {
            case "\"up\"": return Probe.UP;
            case "\"blank\"": return Probe.BLANK;
            case "\"wait\"": return Probe.WAIT;
            case "\"elsewhere\"": return Probe.ELSEWHERE;
            default: return Probe.UNKNOWN;
        }
    }
    /** The watchdog. Up is ready at once. Nothing is decided while the app is not in front (a hidden page may be throttled). Otherwise the
     *  page did not come up when it stayed without content READY_GRACE_MS after it finished loading, or LOAD_DEADLINE_MS after it started
     *  without finishing. sinceFinished is negative while the page has not finished. */
    static Verdict watchdog(long sinceStart, long sinceFinished, Probe probe, boolean foreground) {
        if (probe == Probe.UP) return Verdict.READY;
        if (!foreground) return Verdict.WAIT;
        if (sinceFinished >= READY_GRACE_MS) return Verdict.NOT_STARTED;
        if (sinceStart >= LOAD_DEADLINE_MS) return Verdict.NOT_STARTED;
        return Verdict.WAIT;
    }

    /** What «إعادة المحاولة» loads: the page that failed, with its address as it was (a notification's fragment included), or the CRM's
     *  first page for a failed API address (an export's error) or anything else. */
    static String retryUrl(String failedUrl) {
        if (!RouteRules.trusted(failedUrl)) return RouteRules.ORIGIN + "/";
        try {
            String path = java.net.URI.create(failedUrl).getRawPath();
            if (path != null && (path.equals("/api") || path.startsWith("/api/"))) return RouteRules.ORIGIN + "/";
        } catch (RuntimeException invalid) { return RouteRules.ORIGIN + "/"; }
        return failedUrl;
    }

    // ---- The words: Arabic (the app's default) or English, as the person chose in the CRM page.
    static String title(Kind kind, boolean english) {
        if (kind == Kind.OUTDATED) return english ? "The page engine needs an update" : "يلزم تحديث محرك عرض الصفحات";
        if (kind == Kind.UNAVAILABLE) return english ? "The page engine is not available" : "محرك عرض الصفحات غير متاح";
        return english ? "The system could not be opened" : "تعذّر فتح النظام";
    }
    static String message(Kind kind, boolean english) {
        switch (kind) {
            case CONNECTION: return english ? "Could not connect to the system. Check the internet connection, then try again."
                    : "تعذّر الاتصال بالنظام. تأكد من الاتصال بالإنترنت ثم أعد المحاولة.";
            case SECURITY: return english ? "The security of the connection could not be verified. Make sure the device's date and time are set automatically, then try again."
                    : "تعذّر التحقق من أمان الاتصال. تأكد أن تاريخ الجهاز ووقته مضبوطان تلقائيًا، ثم أعد المحاولة.";
            case SERVER: return english ? "The system is not responding right now. Try again in a little while."
                    : "النظام لا يستجيب الآن. أعد المحاولة بعد قليل.";
            case RENDERER: return english ? "The page engine on this device stopped unexpectedly. Try again."
                    : "توقف محرك عرض الصفحات على هذا الجهاز فجأة. أعد المحاولة.";
            case NOT_STARTED: return english ? "The system page did not appear on this device. Try again; if it happens again, update the page engine (WebView) from the app store (AppGallery or Google Play)."
                    : "لم تظهر صفحة النظام على هذا الجهاز. أعد المحاولة، وإن تكرر ذلك فحدّث محرك عرض الصفحات (WebView) من متجر التطبيقات (AppGallery أو Google Play).";
            case OUTDATED: return english ? "The page engine (WebView) on this device is out of date. Update it from the app store (AppGallery or Google Play), then reopen the app."
                    : "محرك عرض الصفحات (WebView) على هذا الجهاز قديم. حدّثه من متجر التطبيقات (AppGallery أو Google Play) ثم أعد فتح التطبيق.";
            default: return english ? "This device has no working page engine (WebView). Install or enable it from the app store (AppGallery or Google Play) or from the apps settings, then reopen the app."
                    : "لا يوجد على هذا الجهاز محرك عرض صفحات (WebView) يعمل. ثبّته أو فعّله من متجر التطبيقات (AppGallery أو Google Play) أو من إعدادات التطبيقات، ثم أعد فتح التطبيق.";
        }
    }
    /** The second line of the old-engine panel: the package found, its version and its Chromium, and the one needed. */
    static String engineLine(String packageName, String version, int chromium, boolean english) {
        String engine = (blankToUnknown(packageName) + " " + blankToUnknown(version)).trim() + " (Chromium " + (chromium > 0 ? String.valueOf(chromium) : "?") + ")";
        return english ? "Installed engine: " + engine + "; Chromium " + MIN_CHROMIUM + " or newer is needed."
                : "المحرك المثبّت: " + engine + "، والمطلوب Chromium " + MIN_CHROMIUM + " أو أحدث.";
    }
    static String retry(boolean english) { return english ? "Try again" : "إعادة المحاولة"; }
    static String continueAnyway(boolean english) { return english ? "Continue anyway" : "المتابعة رغم ذلك"; }
    static String detailsHeading(boolean english) { return english ? "Details for technical support" : "معلومات للدعم الفني"; }

    // ---- The facts for support (technical English, the same in both languages).
    /** What the panel lists under its message. */
    static final class Facts {
        String webViewPackage, webViewVersion, androidRelease, manufacturer, model, appVersion, page, deviceTime;
        int chromium = -1, sdk;
        long appCode;
    }
    static String details(Facts facts, Failure failure) {
        StringBuilder out = new StringBuilder();
        out.append("WebView: ").append(blankToUnknown(facts.webViewPackage)).append(' ').append(blankToUnknown(facts.webViewVersion))
                .append(" (Chromium ").append(facts.chromium > 0 ? String.valueOf(facts.chromium) : "unknown").append(")\n");
        out.append("Android ").append(blankToUnknown(facts.androidRelease)).append(" (API ").append(facts.sdk).append(") · ")
                .append(clip((blankToUnknown(facts.manufacturer) + " " + blankToUnknown(facts.model)).trim(), 80)).append('\n');
        out.append("App: ").append(blankToUnknown(facts.appVersion)).append(" (").append(facts.appCode).append(")\n");
        if (failure != null) out.append("Error: ").append(failure.error).append('\n');
        String page = pageForDetails(failure != null && failure.url != null ? failure.url : facts.page);
        if (page != null) out.append("Page: ").append(page).append('\n');
        out.append("Device time: ").append(blankToUnknown(facts.deviceTime));
        return out.toString();
    }
    /** The page without its query or fragment (a notification's identifier stays out of a screenshot); the CRM's own address only. */
    static String pageForDetails(String url) {
        if (!RouteRules.trusted(url)) return null;
        try {
            String path = java.net.URI.create(url).getRawPath();
            return RouteRules.ORIGIN + (path == null || path.isEmpty() ? "/" : clip(path, 120));
        } catch (RuntimeException invalid) { return null; }
    }
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss xxx", Locale.ROOT);
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT);
    /** The device's clock as it reads now, with its offset: a wrong date is the usual cause of a security failure. */
    static String deviceTime(long millis, ZoneId zone) { return TIME.format(Instant.ofEpochMilli(millis).atZone(zone)); }
    /** A certificate's validity in UTC days («2026-10-01 to 2026-12-30»), or null without both dates. */
    static String validity(Date notBefore, Date notAfter) {
        if (notBefore == null || notAfter == null) return null;
        return DAY.format(notBefore.toInstant().atOffset(ZoneOffset.UTC)) + " to " + DAY.format(notAfter.toInstant().atOffset(ZoneOffset.UTC));
    }
    /** android.net.http.SslError's primary errors. */
    static String sslErrorName(int primary) {
        switch (primary) {
            case 0: return "SSL_NOTYETVALID";
            case 1: return "SSL_EXPIRED";
            case 2: return "SSL_IDMISMATCH";
            case 3: return "SSL_UNTRUSTED";
            case 4: return "SSL_DATE_INVALID";
            case 5: return "SSL_INVALID";
            default: return "SSL_ERROR";
        }
    }
    /** WebViewClient's ERROR_ codes. */
    static String webErrorName(int code) {
        switch (code) {
            case -1: return "ERROR_UNKNOWN";
            case -2: return "ERROR_HOST_LOOKUP";
            case -3: return "ERROR_UNSUPPORTED_AUTH_SCHEME";
            case -4: return "ERROR_AUTHENTICATION";
            case -5: return "ERROR_PROXY_AUTHENTICATION";
            case -6: return "ERROR_CONNECT";
            case -7: return "ERROR_IO";
            case -8: return "ERROR_TIMEOUT";
            case -9: return "ERROR_REDIRECT_LOOP";
            case -10: return "ERROR_UNSUPPORTED_SCHEME";
            case -11: return "ERROR_FAILED_SSL_HANDSHAKE";
            case -12: return "ERROR_BAD_URL";
            case -13: return "ERROR_FILE";
            case -14: return "ERROR_FILE_NOT_FOUND";
            case -15: return "ERROR_TOO_MANY_REQUESTS";
            case -16: return "ERROR_UNSAFE_RESOURCE";
            default: return "ERROR";
        }
    }
    private static String blankToUnknown(String value) { return value == null || value.trim().isEmpty() ? "unknown" : clip(value.trim(), 80); }
    /** One line, without control characters, at most max characters. */
    static String clip(String value, int max) {
        String line = value.replaceAll("[\\p{Cntrl}\\u2028\\u2029]+", " ").trim();
        return line.length() <= max ? line : line.substring(0, max) + "…";
    }
    private LoadFailureRules() { }
}

package org.yourrest.crm;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** «شكوى تنتظرك» (the owner, 2026-11-16, item 3 of the GSCO list, after GSCO's Android 1.4.9): pure rules for the phone notifications of
 *  the customer complaints that wait for the signed-in member (GET /api/complaints/alerts, lib/complaint-alerts.ts): when the app may ask,
 *  which rows become a notification and which notifications go, their order (high importance first) and their words in Arabic or English,
 *  as the person chose in the CRM page. One notification per complaint, renewed when its step starts again (a new `since`), taken away once
 *  the holder opens the complaint (`seen`) or it no longer waits for the member. No Android types, so the JVM check runs exactly this. */
final class ComplaintAlertRules {
    static final String PATH = "/api/complaints/alerts";
    /** In the background the server is asked at most every ten minutes, inside the working window only; opening the app asks after a minute. */
    static final long INTERVAL_MS = 600_000L, RESUME_GAP_MS = 60_000L;
    static final int MAX_ALERTS = 20, NAME_MAX = 200, CATEGORY_MAX = 80, MAX_BODY_BYTES = 65536, MAX_REMEMBERED = 200;
    static final String[] STEPS = {"review", "fix", "assign", "delegate", "contact", "resolve", "close"};
    static boolean stepKnown(String value) { for (String step : STEPS) if (step.equals(value)) return true; return false; }
    static boolean severityKnown(String value) { return "normal".equals(value) || "high".equals(value); }

    static final class Alert {
        final String id, customerName, categoryAr, categoryEn, awaiting, since;
        final boolean high, seen;
        Alert(String id, String customerName, String categoryAr, String categoryEn, boolean high, String awaiting, boolean seen, String since) {
            this.id = id; this.customerName = customerName; this.categoryAr = categoryAr; this.categoryEn = categoryEn; this.high = high; this.awaiting = awaiting; this.seen = seen; this.since = since;
        }
    }
    static final class Feed {
        final String memberId; final int count; final List<Alert> alerts;
        Feed(String memberId, int count, List<Alert> alerts) { this.memberId = memberId; this.count = count; this.alerts = alerts; }
    }
    /** What to show (in the order to post them), what to take away, and what to remember (complaint id to the `since` already shown). */
    static final class Decision {
        final List<Alert> notify; final List<String> cancel; final Map<String, String> remembered;
        Decision(List<Alert> notify, List<String> cancel, Map<String, String> remembered) { this.notify = notify; this.cancel = cancel; this.remembered = remembered; }
    }

    /** Opening or returning to the app asks after a minute; the background (the tracking service, the alert check) every ten minutes inside
     *  the window only. A clock that went backwards asks again. */
    static boolean shouldPoll(long now, long lastPollAt, boolean windowOpen, boolean opening) {
        long elapsed = lastPollAt <= 0 || lastPollAt > now ? Long.MAX_VALUE : now - lastPollAt;
        return opening ? elapsed >= RESUME_GAP_MS : windowOpen && elapsed >= INTERVAL_MS;
    }

    /** What is remembered of a row its holder had already opened: its `since` behind this mark, so it is never shown nor taken away again. */
    static final String OPENED = "~";
    /** A row notifies when its id is new or its `since` changed and the holder has not opened it; an opened row, or one that left the feed,
     *  takes its notification down once. Every current row is remembered (an opened one with OPENED before its `since`), so the same step
     *  never notifies twice. The rows come high importance first (the server's order); within the same importance the feed's order is kept. */
    static Decision decide(Map<String, String> remembered, List<Alert> current) {
        Map<String, String> next = new LinkedHashMap<>(); List<Alert> notify = new ArrayList<>(); List<String> cancel = new ArrayList<>();
        List<Alert> ordered = new ArrayList<>(current);
        // A stable sort: high importance first, whatever order the rows came in.
        ordered.sort((a, b) -> Boolean.compare(b.high, a.high));
        for (Alert alert : ordered) {
            if (next.containsKey(alert.id) || next.size() >= MAX_REMEMBERED) continue;
            String before = remembered.get(alert.id);
            boolean shown = before != null && !before.startsWith(OPENED);
            if (alert.seen) { next.put(alert.id, OPENED + alert.since); if (shown) cancel.add(alert.id); continue; }
            next.put(alert.id, alert.since);
            if (before == null || !before.equals(alert.since) && !before.equals(OPENED + alert.since)) notify.add(alert);
        }
        for (Map.Entry<String, String> entry : remembered.entrySet()) if (!next.containsKey(entry.getKey()) && entry.getValue() != null && !entry.getValue().startsWith(OPENED)) cancel.add(entry.getKey());
        return new Decision(Collections.unmodifiableList(notify), Collections.unmodifiableList(cancel), Collections.unmodifiableMap(next));
    }
    /** Whether a remembered row has a notification on the phone (it was shown and not opened since). */
    static boolean shown(String remembered) { return remembered != null && !remembered.startsWith(OPENED); }

    /** The order the shade keeps inside the group: high importance first, then the feed's order (a sort key compares as text). */
    static String sortKey(Alert alert, int position) { return (alert.high ? "a" : "b") + String.format(Locale.ROOT, "%03d", Math.max(0, Math.min(999, position))); }

    // ---- The words, Arabic (the app's default) or English.
    static String channelName(boolean english) { return english ? "Customer complaints" : "شكاوى العملاء"; }
    static String channelDescription(boolean english) {
        return english ? "A notice of a customer complaint waiting for your action: review, correction, assignment, delegation, contacting the customer and the resolution, or confirming the closure"
                : "تنبيه بشكوى عميل تنتظر إجراءك: المراجعة أو التعديل أو التكليف أو التفويض أو التواصل مع العميل والحل أو تأكيد الإغلاق";
    }
    static String title(boolean english) { return english ? "A complaint is waiting for you" : "شكوى تنتظرك"; }
    static String publicTitle(boolean english) { return english ? "Yourrest: a complaint is waiting for you" : "يورست: شكوى تنتظرك"; }
    static String summaryTitle(boolean english) { return english ? "Complaints waiting for you" : "شكاوى تنتظرك"; }
    static String summaryText(int count, boolean english) { return (english ? "Complaints waiting for you: " : "عدد الشكاوى التي تنتظرك: ") + count; }
    /** The step in Modern Standard Arabic (or English), as the complaints page names it. */
    static String stepText(String awaiting, boolean english) {
        switch (awaiting) {
            case "review": return english ? "Waiting for your review" : "بانتظار مراجعتك";
            case "fix": return english ? "Needs your correction" : "مطلوب تعديلك";
            case "assign": return english ? "Waiting for your assignment" : "بانتظار تكليفك";
            case "delegate": return english ? "Waiting for your delegation" : "بانتظار تفويضك";
            case "contact": return english ? "Waiting for your contact with the customer" : "بانتظار تواصلك مع العميل";
            case "resolve": return english ? "Waiting for you to record the resolution" : "بانتظار تسجيل الحل";
            default: return english ? "Waiting for you to confirm the closure" : "بانتظار تأكيد الإغلاق";
        }
    }
    static String clip(String value, int max) { String text = value == null ? "" : value.replaceAll("\\s+", " ").trim(); return text.length() > max ? text.substring(0, max - 1).trim() + "…" : text; }
    /** «أهمية عالية · <customer> · <category> — <step>»; the prefix only for a complaint of high importance. */
    static String message(Alert alert, boolean english) {
        StringBuilder out = new StringBuilder();
        if (alert.high) out.append(english ? "High importance" : "أهمية عالية").append(" · ");
        String name = clip(alert.customerName, NAME_MAX); out.append(name.isEmpty() ? (english ? "Customer" : "عميل") : name);
        String category = clip(english ? alert.categoryEn : alert.categoryAr, CATEGORY_MAX); if (!category.isEmpty()) out.append(" · ").append(category);
        return out.append(" — ").append(stepText(alert.awaiting, english)).toString();
    }
    /** The address a tap opens on a cold start: the page with this complaint open. */
    static String complaintFragment(String id) { return RouteRules.identifier(id) ? "#complaint=" + id : null; }
    /** The notification of one complaint: a tag and the same id, so a renewed step replaces it and a gone one is taken away. */
    static String tag(String id) { return "yourrest-complaint:" + id; }
    static final int NOTIFICATION_ID = 4343, SUMMARY_ID = 4344;
    static final String GROUP = "yourrest-complaints";

    private ComplaintAlertRules() { }
}

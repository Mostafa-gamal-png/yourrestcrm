package org.yourrest.crm;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Pure rules for customer-service request notifications: when to ask the server, which requests are news, how to word them. */
final class ServiceAlertPolicy {
    /** In the background the server is asked once every ten minutes, inside the working window only. */
    static final long INTERVAL_MS = 600_000L;
    /** Opening or returning to the app asks again only after a minute, so quick switches do not hammer the server. */
    static final long RESUME_GAP_MS = 60_000L;
    static final long RETENTION_MS = 30L * 24 * 3600 * 1000;
    static final int MAX_REMEMBERED = 300, INDIVIDUAL_LIMIT = 3, SUMMARY_ID = 4242;
    static final String FIRST_CONTACT = "first_contact", ASSIGN = "assign", DELEGATE = "delegate", APPROVE = "approve";

    /** One request that waits for this member, exactly as the server describes it. */
    static final class Alert {
        final String id, customerName, need, awaiting, since;
        final boolean seen;
        Alert(String id, String customerName, String need, String awaiting, String since, boolean seen) {
            this.id = id; this.customerName = customerName; this.need = need; this.awaiting = awaiting; this.since = since; this.seen = seen;
        }
        /** A new start (a re-assignment, a return to the same person) is a new alert. */
        String key() { return id + "@" + since; }
    }

    /** What the phone shows: a full text for the unlocked screen and a generic title for the lock screen. */
    static final class Notice {
        final int id;
        final String title, text, publicTitle, caseId;
        Notice(int id, String title, String text, String publicTitle, String caseId) {
            this.id = id; this.title = title; this.text = text; this.publicTitle = publicTitle; this.caseId = caseId;
        }
    }

    static boolean shouldPoll(long now, long lastPollAt, boolean windowOpen, boolean opening) {
        long elapsed = lastPollAt <= 0 || lastPollAt > now ? Long.MAX_VALUE : now - lastPollAt;
        return opening ? elapsed >= RESUME_GAP_MS : windowOpen && elapsed >= INTERVAL_MS;
    }

    static String title(String awaiting) {
        if (FIRST_CONTACT.equals(awaiting)) return "طلب جديد من خدمة العملاء";
        if (ASSIGN.equals(awaiting)) return "طلب بانتظار تكليفك";
        if (DELEGATE.equals(awaiting)) return "طلب بانتظار تفويضك";
        if (APPROVE.equals(awaiting)) return "طلب بانتظار اعتمادك";
        return null;
    }

    /** An alert the app may act on; anything else the server sends is ignored, never shown. */
    static boolean valid(Alert alert) {
        return alert != null && RouteRules.identifier(alert.id) && title(alert.awaiting) != null
                && alert.customerName != null && !alert.customerName.trim().isEmpty() && alert.customerName.length() <= 200
                && alert.need != null && alert.need.length() <= 200
                && alert.since != null && alert.since.matches("[0-9TZ:.+-]{10,40}");
    }

    /** Requests nobody has opened and the phone has not announced yet, oldest answer first, each once. */
    static List<Alert> news(List<Alert> alerts, Map<String, Long> remembered) {
        List<Alert> result = new ArrayList<>();
        Set<String> seenKeys = new HashSet<>();
        for (Alert alert : alerts) {
            if (!valid(alert) || alert.seen || remembered.containsKey(alert.key()) || !seenKeys.add(alert.key())) continue;
            result.add(alert);
        }
        return result;
    }

    /** Records what was announced (or already in front of the person), forgetting old entries and capping the list. */
    static Map<String, Long> remember(Map<String, Long> remembered, List<Alert> announced, long now) {
        List<Map.Entry<String, Long>> entries = new ArrayList<>();
        for (Map.Entry<String, Long> entry : remembered.entrySet()) if (entry.getValue() != null && now - entry.getValue() < RETENTION_MS) entries.add(entry);
        Map<String, Long> merged = new LinkedHashMap<>();
        for (Map.Entry<String, Long> entry : entries) merged.put(entry.getKey(), entry.getValue());
        for (Alert alert : announced) merged.put(alert.key(), now);
        List<Map.Entry<String, Long>> ordered = new ArrayList<>(merged.entrySet());
        ordered.sort((a, b) -> Long.compare(a.getValue(), b.getValue()));
        Map<String, Long> result = new LinkedHashMap<>();
        for (int index = Math.max(0, ordered.size() - MAX_REMEMBERED); index < ordered.size(); index++) result.put(ordered.get(index).getKey(), ordered.get(index).getValue());
        return result;
    }

    static String text(Alert alert) {
        String text = alert.need.trim().isEmpty() ? alert.customerName.trim() : alert.customerName.trim() + " — " + alert.need.trim();
        return text.length() > 160 ? text.substring(0, 159) + "…" : text;
    }

    /** A few requests are announced one by one; a burst becomes a single summary so the shade is never flooded. */
    static List<Notice> notices(List<Alert> news) {
        List<Notice> result = new ArrayList<>();
        if (news.isEmpty()) return result;
        if (news.size() > INDIVIDUAL_LIMIT) {
            result.add(new Notice(SUMMARY_ID, "طلبات جديدة من خدمة العملاء", news.size() + " طلبات بانتظار إجرائك", "يورست: طلبات من خدمة العملاء", null));
            return result;
        }
        for (Alert alert : news) result.add(new Notice(alert.id.hashCode() & 0x7fffffff, title(alert.awaiting), text(alert), "يورست: طلب من خدمة العملاء", alert.id));
        return result;
    }

    private ServiceAlertPolicy() { }
}

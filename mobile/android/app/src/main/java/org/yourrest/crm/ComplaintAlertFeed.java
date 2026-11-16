package org.yourrest.crm;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** The complaint-alert feed (GET /api/complaints/alerts) read strictly: unknown keys are ignored, anything malformed rejects the whole
 *  feed so the app changes nothing. Kept apart from ComplaintAlertRules so the rules stay free of org.json. */
final class ComplaintAlertFeed {
    private static String text(JSONObject row, String key, int max) throws Exception {
        Object raw = row.get(key);
        if (!(raw instanceof String)) throw new IllegalArgumentException("Invalid " + key);
        String value = ((String) raw).trim();
        if (value.length() > max) throw new IllegalArgumentException("Oversized " + key);
        return value;
    }
    static ComplaintAlertRules.Feed parse(JSONObject json) {
        try {
            Object version = json.get("schemaVersion");
            if (!(version instanceof Number) || ((Number) version).intValue() != 1 || ((Number) version).doubleValue() != 1) throw new IllegalArgumentException("Unsupported feed");
            String member = text(json, "memberId", ComplaintAlertRules.NAME_MAX);
            if (!RouteRules.identifier(member)) throw new IllegalArgumentException("Invalid member");
            Object rawCount = json.get("count");
            if (!(rawCount instanceof Number) || ((Number) rawCount).doubleValue() != ((Number) rawCount).intValue() || ((Number) rawCount).intValue() < 0) throw new IllegalArgumentException("Invalid count");
            JSONArray rows = json.getJSONArray("alerts");
            if (rows.length() > ComplaintAlertRules.MAX_ALERTS) throw new IllegalArgumentException("Too many alerts");
            List<ComplaintAlertRules.Alert> alerts = new ArrayList<>(); Set<String> ids = new HashSet<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                String id = text(row, "id", ComplaintAlertRules.NAME_MAX);
                if (!RouteRules.identifier(id) || !ids.add(id)) throw new IllegalArgumentException("Invalid alert id");
                String awaiting = text(row, "awaiting", 32);
                if (!ComplaintAlertRules.stepKnown(awaiting)) throw new IllegalArgumentException("Unknown step");
                String severity = text(row, "severity", 16);
                if (!ComplaintAlertRules.severityKnown(severity)) throw new IllegalArgumentException("Unknown importance");
                String since = text(row, "since", 64);
                if (RouteRules.millis(since) <= 0) throw new IllegalArgumentException("Invalid since");
                Object seen = row.get("seen");
                if (!(seen instanceof Boolean)) throw new IllegalArgumentException("Invalid seen");
                alerts.add(new ComplaintAlertRules.Alert(id, text(row, "customerName", ComplaintAlertRules.NAME_MAX), text(row, "categoryAr", ComplaintAlertRules.CATEGORY_MAX), text(row, "categoryEn", ComplaintAlertRules.CATEGORY_MAX), "high".equals(severity), awaiting, (Boolean) seen, since));
            }
            int count = ((Number) rawCount).intValue();
            if (count < alerts.size()) throw new IllegalArgumentException("Count below rows");
            return new ComplaintAlertRules.Feed(member, count, Collections.unmodifiableList(alerts));
        } catch (IllegalArgumentException invalid) { throw invalid; }
        catch (Exception invalid) { throw new IllegalArgumentException("Invalid complaint feed", invalid); }
    }
    private ComplaintAlertFeed() { }
}

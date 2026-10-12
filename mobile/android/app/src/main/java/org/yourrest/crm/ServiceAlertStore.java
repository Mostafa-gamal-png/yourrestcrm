package org.yourrest.crm;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/** What this phone has already announced, per signed-in member, so a request is never announced twice. */
final class ServiceAlertStore {
    private final SharedPreferences preferences;
    ServiceAlertStore(Context context) { preferences = context.getSharedPreferences("service-alerts", Context.MODE_PRIVATE); }
    long lastPollAt() { return preferences.getLong("lastPollAt", 0); }
    void lastPollAt(long at) { preferences.edit().putLong("lastPollAt", at).apply(); }
    /** Another member signing in on the same phone starts with nothing remembered. */
    Map<String, Long> remembered(String member) {
        Map<String, Long> result = new LinkedHashMap<>();
        if (!member.equals(preferences.getString("member", ""))) return result;
        try {
            JSONObject stored = new JSONObject(preferences.getString("remembered", "{}"));
            for (Iterator<String> keys = stored.keys(); keys.hasNext(); ) { String key = keys.next(); result.put(key, stored.optLong(key, 0)); }
        } catch (Exception damaged) { result.clear(); }
        return result;
    }
    void save(String member, Map<String, Long> remembered) {
        JSONObject stored = new JSONObject();
        try { for (Map.Entry<String, Long> entry : remembered.entrySet()) stored.put(entry.getKey(), entry.getValue()); } catch (Exception invalid) { return; }
        preferences.edit().putString("member", member).putString("remembered", stored.toString()).apply();
    }
}

package android.content;
import java.util.HashMap;
import java.util.Map;
/** Stand-in: an in-memory store that outlives a «process» (the checks drop the singleton, not the store); commit can be made to fail. */
public class SharedPreferences {
    final Map<String, Object> values = new HashMap<>();
    public boolean failCommit;
    public String getString(String key, String fallback) { Object value = values.get(key); return value instanceof String ? (String) value : fallback; }
    public Map<String, ?> getAll() { return new HashMap<>(values); }
    public Editor edit() { return new Editor(); }
    public final class Editor {
        private final Map<String, Object> pending = new HashMap<>();
        public Editor remove(String key) { pending.put(key, null); return this; }
        public Editor putString(String key, String value) { pending.put(key, value); return this; }
        public boolean commit() { if (failCommit) return false; for (Map.Entry<String, Object> entry : pending.entrySet()) if (entry.getValue() == null) values.remove(entry.getKey()); else values.put(entry.getKey(), entry.getValue()); return true; }
        public void apply() { commit(); }
    }
}

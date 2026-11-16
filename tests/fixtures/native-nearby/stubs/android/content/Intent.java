package android.content;
import java.util.HashMap;
import java.util.Map;
public class Intent {
    public static final int FLAG_ACTIVITY_SINGLE_TOP = 0x20000000, FLAG_ACTIVITY_CLEAR_TOP = 0x04000000;
    public final Class<?> target; public String action; public android.net.Uri data; public int flags; public final Map<String, String> extras = new HashMap<>();
    public Intent(Context context, Class<?> target) { this.target = target; }
    public Intent setAction(String action) { this.action = action; return this; }
    public String getAction() { return action; }
    public Intent putExtra(String key, String value) { extras.put(key, value); return this; }
    public String getStringExtra(String key) { return extras.get(key); }
    public Intent setData(android.net.Uri data) { this.data = data; return this; }
    public Intent addFlags(int flags) { this.flags |= flags; return this; }
}

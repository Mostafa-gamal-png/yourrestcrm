package android.content;
import java.util.HashMap;
import java.util.Map;
/** Stand-in: the permissions the checks grant or refuse, the notification manager and the named preference stores. */
public class Context {
    public static final int MODE_PRIVATE = 0;
    public static boolean fineLocation = true, postNotifications = true;
    public static final Map<String, SharedPreferences> stores = new HashMap<>();
    public final android.app.NotificationManager manager = new android.app.NotificationManager();
    public Context getApplicationContext() { return this; }
    public <T> T getSystemService(Class<T> type) { return type.cast(manager); }
    public SharedPreferences getSharedPreferences(String name, int mode) { return stores.computeIfAbsent(name, key -> new SharedPreferences()); }
    public int checkSelfPermission(String permission) { return ("android.permission.POST_NOTIFICATIONS".equals(permission) ? postNotifications : fineLocation) ? 0 : -1; }
}

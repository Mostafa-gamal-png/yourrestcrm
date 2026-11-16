package android.content;
import java.util.HashMap;
import java.util.Map;
/** Stand-in: the permission the checks grant or refuse, the notification manager, the job scheduler and the named preference stores
 *  (shared by every context, as one app's are). */
public class Context {
    public static final int MODE_PRIVATE = 0;
    public static boolean postNotifications = true;
    public static final Map<String, SharedPreferences> stores = new HashMap<>();
    public static final android.app.NotificationManager manager = new android.app.NotificationManager();
    public static final android.app.job.JobScheduler jobs = new android.app.job.JobScheduler();
    public Context getApplicationContext() { return this; }
    public <T> T getSystemService(Class<T> type) { return type == android.app.job.JobScheduler.class ? type.cast(jobs) : type.cast(manager); }
    public SharedPreferences getSharedPreferences(String name, int mode) { synchronized (stores) { return stores.computeIfAbsent(name, key -> new SharedPreferences()); } }
    public int checkSelfPermission(String permission) { return postNotifications ? 0 : -1; }
}

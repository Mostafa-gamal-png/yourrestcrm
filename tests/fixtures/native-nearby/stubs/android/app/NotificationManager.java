package android.app;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
/** Stand-in: channels as Android keeps them (a channel created again keeps the importance the person chose), what is shown, what was
 *  posted and what was cancelled. */
public class NotificationManager {
    public static final int IMPORTANCE_NONE = 0, IMPORTANCE_DEFAULT = 3;
    public boolean enabled = true;
    public final Map<String, NotificationChannel> channels = new HashMap<>();
    public final Map<String, Notification> active = new LinkedHashMap<>();
    public final List<Notification> posted = new ArrayList<>();
    public final List<String> postedTags = new ArrayList<>(), cancelled = new ArrayList<>();
    public synchronized void createNotificationChannel(NotificationChannel channel) {
        NotificationChannel prior = channels.get(channel.id);
        if (prior == null) channels.put(channel.id, channel); else { prior.name = channel.name; prior.description = channel.description; }
    }
    public synchronized NotificationChannel getNotificationChannel(String id) { return channels.get(id); }
    public synchronized boolean areNotificationsEnabled() { return enabled; }
    public synchronized void notify(String tag, int id, Notification notice) { posted.add(notice); postedTags.add(tag); active.put(tag + "#" + id, notice); }
    public synchronized void cancel(String tag, int id) { cancelled.add(tag); active.remove(tag + "#" + id); }
    public synchronized android.service.notification.StatusBarNotification[] getActiveNotifications() {
        List<android.service.notification.StatusBarNotification> list = new ArrayList<>();
        for (String key : active.keySet()) { int at = key.lastIndexOf('#'); list.add(new android.service.notification.StatusBarNotification(key.substring(0, at), Integer.parseInt(key.substring(at + 1)))); }
        return list.toArray(new android.service.notification.StatusBarNotification[0]);
    }
}

package android.app;
public class NotificationChannel {
    public final String id; public CharSequence name; public String description = ""; public int importance, lockscreen;
    public NotificationChannel(String id, CharSequence name, int importance) { this.id = id; this.name = name; this.importance = importance; }
    public void setDescription(String description) { this.description = description; }
    public void setLockscreenVisibility(int visibility) { lockscreen = visibility; }
    public int getImportance() { return importance; }
}

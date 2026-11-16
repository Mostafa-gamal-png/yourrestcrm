package android.service.notification;
public class StatusBarNotification { final String tag; final int id; public StatusBarNotification(String tag, int id) { this.tag = tag; this.id = id; } public String getTag() { return tag; } public int getId() { return id; } }

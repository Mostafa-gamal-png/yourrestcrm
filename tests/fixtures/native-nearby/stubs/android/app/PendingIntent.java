package android.app;
public class PendingIntent {
    public static final int FLAG_UPDATE_CURRENT = 0x08000000, FLAG_IMMUTABLE = 0x04000000;
    public final android.content.Intent intent; public final int flags;
    private PendingIntent(android.content.Intent intent, int flags) { this.intent = intent; this.flags = flags; }
    public static PendingIntent getActivity(android.content.Context context, int code, android.content.Intent intent, int flags) { return new PendingIntent(intent, flags); }
}

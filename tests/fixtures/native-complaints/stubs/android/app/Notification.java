package android.app;
/** Stand-in: what a built notification carries, for the checks to read (with the group and the sort key the complaint notices use). */
public class Notification {
    public static final int VISIBILITY_PRIVATE = 0; public static final String CATEGORY_MESSAGE = "msg";
    public String channel, title, text, big, category, group, sortKey; public int visibility = -9; public boolean autoCancel, onlyAlertOnce, groupSummary; public Notification publicVersion; public PendingIntent intent;
    public abstract static class Style { }
    public static class BigTextStyle extends Style { String text; public BigTextStyle bigText(CharSequence value) { text = String.valueOf(value); return this; } }
    public static class Builder {
        private final Notification built = new Notification();
        public Builder(android.content.Context context, String channel) { built.channel = channel; }
        public Builder setSmallIcon(int icon) { return this; }
        public Builder setContentTitle(CharSequence value) { built.title = String.valueOf(value); return this; }
        public Builder setContentText(CharSequence value) { built.text = String.valueOf(value); return this; }
        public Builder setStyle(Style style) { if (style instanceof BigTextStyle) built.big = ((BigTextStyle) style).text; return this; }
        public Builder setContentIntent(PendingIntent intent) { built.intent = intent; return this; }
        public Builder setAutoCancel(boolean value) { built.autoCancel = value; return this; }
        public Builder setOnlyAlertOnce(boolean value) { built.onlyAlertOnce = value; return this; }
        public Builder setCategory(String value) { built.category = value; return this; }
        public Builder setVisibility(int value) { built.visibility = value; return this; }
        public Builder setPublicVersion(Notification value) { built.publicVersion = value; return this; }
        public Builder setGroup(String value) { built.group = value; return this; }
        public Builder setSortKey(String value) { built.sortKey = value; return this; }
        public Builder setGroupSummary(boolean value) { built.groupSummary = value; return this; }
        public Notification build() { return built; }
    }
}

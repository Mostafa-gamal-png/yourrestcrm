package android.app.job;
/** Stand-in: what a scheduled job asks for, for the checks to read. */
public class JobInfo {
    public static final int NETWORK_TYPE_ANY = 1;
    public int id, network; public long period; public boolean persisted; public android.content.ComponentName service;
    public int getId() { return id; }
    public static class Builder {
        private final JobInfo built = new JobInfo();
        public Builder(int id, android.content.ComponentName service) { built.id = id; built.service = service; }
        public Builder setRequiredNetworkType(int value) { built.network = value; return this; }
        public Builder setPeriodic(long value) { built.period = value; return this; }
        public Builder setPersisted(boolean value) { built.persisted = value; return this; }
        public JobInfo build() { return built; }
    }
}

package android.os;
/** Stand-in: the elapsed clock the checks move by hand. */
public final class SystemClock { public static long now = 1_000_000; public static long elapsedRealtime() { return now; } }

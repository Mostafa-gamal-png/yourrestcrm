package android.location;
/** Stand-in: a fix with its wall time, its elapsed time and whether a mock provider gave it. */
public class Location {
    final double latitude, longitude; final float accuracy; final long time, elapsedMs; public boolean mock, accuracyKnown = true;
    public Location(double latitude, double longitude, float accuracy, long time, long elapsedMs) { this.latitude = latitude; this.longitude = longitude; this.accuracy = accuracy; this.time = time; this.elapsedMs = elapsedMs; }
    public Location(Location other) { this(other.latitude, other.longitude, other.accuracy, other.time, other.elapsedMs); mock = other.mock; accuracyKnown = other.accuracyKnown; }
    public double getLatitude() { return latitude; } public double getLongitude() { return longitude; } public float getAccuracy() { return accuracy; }
    public boolean hasAccuracy() { return accuracyKnown; } public long getTime() { return time; } public long getElapsedRealtimeNanos() { return elapsedMs * 1_000_000L; }
    public boolean isMock() { return mock; } public boolean isFromMockProvider() { return mock; }
}

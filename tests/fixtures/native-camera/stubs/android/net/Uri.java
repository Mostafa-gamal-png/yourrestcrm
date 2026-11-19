package android.net;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
/** Stand-in: a hierarchical URI as Android's Uri.Builder makes it and getPathSegments() reads it back (segments already decoded, so a
 *  segment may hold what an encoded path would carry: «..», a slash). */
public final class Uri {
    private final String scheme, authority;
    private final List<String> segments;
    private Uri(String scheme, String authority, List<String> segments) { this.scheme = scheme; this.authority = authority; this.segments = Collections.unmodifiableList(new ArrayList<>(segments)); }
    public static Uri of(String scheme, String authority, String... segments) { List<String> list = new ArrayList<>(); Collections.addAll(list, segments); return new Uri(scheme, authority, list); }
    public String getScheme() { return scheme; }
    public String getAuthority() { return authority; }
    public List<String> getPathSegments() { return segments; }
    @Override public String toString() { StringBuilder out = new StringBuilder(scheme + "://" + authority); for (String segment : segments) out.append('/').append(segment); return out.toString(); }
    public static final class Builder {
        private String scheme, authority;
        private final List<String> segments = new ArrayList<>();
        public Builder scheme(String value) { scheme = value; return this; }
        public Builder authority(String value) { authority = value; return this; }
        public Builder appendPath(String value) { segments.add(value); return this; }
        public Uri build() { return new Uri(scheme, authority, segments); }
    }
}

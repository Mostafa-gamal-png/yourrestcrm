package android.content;
import java.io.File;
/** Stand-in: an application context whose cache folder the check chooses (a temporary folder). */
public class Context {
    private final File cache;
    public Context(File cache) { this.cache = cache; }
    public File getCacheDir() { return cache; }
}

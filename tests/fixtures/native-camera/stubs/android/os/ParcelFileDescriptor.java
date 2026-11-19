package android.os;
import java.io.File;
import java.io.FileNotFoundException;
/** Stand-in: Android's mode constants and parseMode as the platform defines them; open() records the file and the mode instead of handing a
 *  descriptor over, and refuses a file that does not exist unless the mode creates it (as the platform does). */
public final class ParcelFileDescriptor {
    public static final int MODE_READ_ONLY = 0x10000000, MODE_WRITE_ONLY = 0x20000000, MODE_READ_WRITE = 0x30000000;
    public static final int MODE_CREATE = 0x08000000, MODE_TRUNCATE = 0x04000000, MODE_APPEND = 0x02000000;
    public final File file;
    public final int mode;
    private ParcelFileDescriptor(File file, int mode) { this.file = file; this.mode = mode; }
    public static ParcelFileDescriptor open(File file, int mode) throws FileNotFoundException {
        if (!file.exists() && (mode & MODE_CREATE) == 0) throw new FileNotFoundException(file.getName());
        return new ParcelFileDescriptor(file, mode);
    }
    public static int parseMode(String mode) {
        switch (mode) {
            case "r": return MODE_READ_ONLY;
            case "w": case "wt": return MODE_WRITE_ONLY | MODE_CREATE | MODE_TRUNCATE;
            case "wa": return MODE_WRITE_ONLY | MODE_CREATE | MODE_APPEND;
            case "rw": return MODE_READ_WRITE | MODE_CREATE;
            case "rwt": return MODE_READ_WRITE | MODE_CREATE | MODE_TRUNCATE;
            default: throw new IllegalArgumentException("Bad mode: " + mode);
        }
    }
}

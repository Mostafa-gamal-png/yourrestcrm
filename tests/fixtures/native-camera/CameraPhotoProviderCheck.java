package org.yourrest.crm;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Stream;

/** The real CameraPhotoProvider (mobile/android, 1.0.15) on Android stand-ins (tests/fixtures/native-camera/stubs), its cache folder a
 *  temporary one: a new photo's empty file and its content URI, the camera app opening it to write (w, wt, rw, rwt) and the page reading it
 *  (r), the name and size and type the page reads, every other mode, authority, scheme, path and name refused, a link out of the folder
 *  refused, no insert, update or delete, and the cleanup at start (a day old, a name of another shape, a stray folder, a date far ahead).
 *  Not a device test: no camera app, grant or WebView upload. */
public final class CameraPhotoProviderCheck {
    private static int checks;
    private static void check(boolean value, String what) { checks++; if (!value) throw new AssertionError("Check " + checks + " failed: " + what); }
    private interface Opening { ParcelFileDescriptor open() throws Exception; }
    private static boolean refused(Opening opening) {
        try { opening.open(); return false; } catch (FileNotFoundException expected) { return true; } catch (Exception other) { throw new AssertionError("unexpected " + other); }
    }
    private static boolean unsupported(Runnable write) { try { write.run(); return false; } catch (UnsupportedOperationException expected) { return true; } }
    private static final String AUTHORITY = "org.yourrest.crm.camera";

    public static void main(String[] args) throws Exception {
        Path cache = Files.createTempDirectory("yourrest-camera-cache"), outside = Files.createTempDirectory("yourrest-camera-outside");
        try {
            run(cache, outside);
        } finally {
            for (Path folder : new Path[]{cache, outside}) try (Stream<Path> walk = Files.walk(folder)) { walk.sorted((a, b) -> b.compareTo(a)).forEach(path -> path.toFile().delete()); }
        }
        java.lang.System.out.println("Camera photo provider: " + checks + " checks passed (the real provider on Android stand-ins; no camera app, grant or upload verified)");
    }

    private static void run(Path cache, Path outside) throws Exception {
        CameraPhotoProvider detached = new CameraPhotoProvider();
        check(refused(() -> detached.openFile(Uri.of("content", AUTHORITY, "photo", "photo-20261119-120211-1a2b3c4d.jpg"), "r")) && detached.query(Uri.of("content", AUTHORITY, "photo", "x"), null, null, null, null) == null, "a provider without its context serves nothing");

        Context context = new Context(cache.toFile());
        CameraPhotoProvider provider = new CameraPhotoProvider();
        provider.attachInfo(context);
        check(CameraPhotoProvider.root(context).equals(cache.resolve("camera-photos").toFile()), "the folder is cache/camera-photos");

        // ---- A new photo: an empty file, its content URI.
        File photo = CameraPhotoProvider.create(context), second = CameraPhotoProvider.create(context);
        check(photo != null && photo.isFile() && photo.length() == 0 && CameraPhotoRules.validName(photo.getName()) && photo.getParentFile().equals(CameraPhotoProvider.root(context)), "an empty file with a name of the app's shape, in the folder");
        check(second != null && !second.equals(photo), "every photo its own file");
        Uri uri = CameraPhotoProvider.uri(photo);
        check(uri.toString().equals("content://org.yourrest.crm.camera/photo/" + photo.getName()), "its content URI: " + uri);

        // ---- The camera app writes it; the page reads it.
        for (String mode : new String[]{"w", "wt", "rw", "rwt"}) {
            ParcelFileDescriptor opened = provider.openFile(uri, mode);
            check(opened.file.equals(photo) && opened.mode == ParcelFileDescriptor.parseMode(mode) && (opened.mode & ParcelFileDescriptor.MODE_WRITE_ONLY) != 0, "the camera app opens it to write: " + mode);
        }
        byte[] jpeg = new byte[4096]; jpeg[0] = (byte) 0xff; jpeg[1] = (byte) 0xd8; jpeg[4094] = (byte) 0xff; jpeg[4095] = (byte) 0xd9;
        try (FileOutputStream out = new FileOutputStream(provider.openFile(uri, "w").file)) { out.write(jpeg); }
        ParcelFileDescriptor reading = provider.openFile(uri, "r");
        check(reading.file.equals(photo) && reading.mode == ParcelFileDescriptor.MODE_READ_ONLY && Arrays.equals(Files.readAllBytes(reading.file.toPath()), jpeg), "the page reads what the camera wrote, read only");
        Cursor named = provider.query(uri, null, null, null, null);
        check(Arrays.equals(named.getColumnNames(), new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}) && named.row()[0].equals(photo.getName()) && named.row()[1].equals(4096L), "its name and size, as the page asks");
        check(Arrays.equals(provider.query(uri, new String[]{OpenableColumns.SIZE}, null, null, null).row(), new Object[]{4096L}) && provider.query(uri, new String[]{"_data", "secret"}, null, null, null).getColumnNames().length == 0, "only the columns asked for, and never a path (_data)");
        check("image/jpeg".equals(provider.getType(uri)), "a JPEG");

        // ---- Everything else refused.
        for (String mode : new String[]{"wa", "rwa", "a", "", "R", "x"}) check(refused(() -> provider.openFile(uri, mode)), "mode refused: " + mode);
        check(refused(() -> provider.openFile(uri, null)), "no mode refused");
        String name = photo.getName();
        Uri[] others = {
                Uri.of("content", "org.yourrest.crm.designfiles", "photo", name), Uri.of("file", AUTHORITY, "photo", name), Uri.of("content", AUTHORITY, "design-files", name),
                Uri.of("content", AUTHORITY, name), Uri.of("content", AUTHORITY, "photo", name, "x"), Uri.of("content", AUTHORITY, "photo", "../" + name),
                Uri.of("content", AUTHORITY, "photo", "../camera-photos/" + name), Uri.of("content", AUTHORITY, "photo", "x.jpg"), Uri.of("content", AUTHORITY, "photo"),
                Uri.of("content", AUTHORITY, "photo", CameraPhotoRules.newName(0, "abcdef01"))};
        for (Uri other : others) {
            check(refused(() -> provider.openFile(other, "r")) && refused(() -> provider.openFile(other, "w")), "not served: " + other);
            check(provider.query(other, null, null, null, null) == null && provider.getType(other) == null, "not described: " + other);
        }
        check(refused(() -> provider.openFile(null, "r")) && provider.getType(null) == null, "no URI");
        String linked = CameraPhotoRules.newName(1_000_000_000_000L, "0badc0de");
        Path secret = Files.write(outside.resolve("secret.jpg"), new byte[]{1, 2, 3});
        Files.createSymbolicLink(CameraPhotoProvider.root(context).toPath().resolve(linked), secret);
        Uri link = Uri.of("content", AUTHORITY, "photo", linked);
        check(refused(() -> provider.openFile(link, "r")) && refused(() -> provider.openFile(link, "w")) && provider.query(link, null, null, null, null) == null, "a link with a photo's name that leads out of the folder is refused");
        check(unsupported(() -> provider.insert(uri, new ContentValues())) && unsupported(() -> provider.update(uri, new ContentValues(), null, null)) && unsupported(() -> provider.delete(uri, null, null)), "no insert, update or delete");
        check(photo.isFile() && photo.length() == 4096, "the photo is untouched by the refusals");

        // ---- The cleanup at start.
        File root = CameraPhotoProvider.root(context);
        long now = System.currentTimeMillis(), day = CameraPhotoRules.KEEP_MS;
        File old = new File(root, CameraPhotoRules.newName(now - 2 * day, "0000000a")), fresh = new File(root, CameraPhotoRules.newName(now, "0000000b")), ahead = new File(root, CameraPhotoRules.newName(now, "0000000c"));
        for (File file : new File[]{old, fresh, ahead}) Files.write(file.toPath(), new byte[]{9});
        check(old.setLastModified(now - day - 60_000) && ahead.setLastModified(now + 3 * day), "dates set");
        File stray = new File(root, "notes.txt"), folder = new File(root, "nested");
        Path outsideFolder = Files.createDirectory(outside.resolve("folder")), outsideFile = Files.write(outsideFolder.resolve("keep.jpg"), new byte[]{7});
        Files.createSymbolicLink(root.toPath().resolve(CameraPhotoRules.newName(now, "0000000d")), outsideFolder);
        Files.write(stray.toPath(), new byte[]{1});
        check(folder.mkdir() && new File(folder, "inside.jpg").createNewFile(), "a stray folder with a file in it");
        CameraPhotoProvider.cleanup(context);
        Set<String> left = new HashSet<>(Arrays.asList(root.list()));
        check(!old.exists() && !ahead.exists() && !stray.exists() && !folder.exists(), "a day old, dated far ahead, another name, a stray folder: gone");
        check(fresh.isFile() && photo.isFile() && second.isFile() && left.equals(new HashSet<>(Arrays.asList(fresh.getName(), photo.getName(), second.getName()))), "fresh photos stay: " + left);
        check(Files.exists(secret) && Files.exists(outsideFile) && !Files.exists(root.toPath().resolve(linked), java.nio.file.LinkOption.NOFOLLOW_LINKS), "the cleanup removes a link (to a file or a folder), never what it leads to");
        CameraPhotoProvider.remove(null);
        CameraPhotoProvider.remove(photo);
        check(!photo.exists() && refused(() -> provider.openFile(uri, "r")), "a removed photo is no longer served");
        CameraPhotoProvider.cleanup(new Context(cache.resolve("no-such-folder").toFile()));
        check(true, "the cleanup of a folder that does not exist does nothing");
        File blocked = Files.write(cache.resolve("blocked"), new byte[]{0}).toFile();
        check(CameraPhotoProvider.create(new Context(blocked)) == null, "a cache that cannot hold the folder: no photo file (the activity falls back to the files)");
    }
}

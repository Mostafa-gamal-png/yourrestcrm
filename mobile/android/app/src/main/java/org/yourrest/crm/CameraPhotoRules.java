package org.yourrest.crm;

import java.io.File;
import java.io.IOException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** The camera beside the file picker (1.0.15; the owner, 2026-11-19, for «صور القالب»): which inputs offer it, the one file a photo is
 *  written to and how the app's own provider serves it, and the words. Pure (no Android class), checked on the JVM by CameraPhotoRulesCheck.
 *  No CAMERA permission: Android's camera app takes the photo (ACTION_IMAGE_CAPTURE) and writes it into a file of the app's private cache
 *  through a content URI granted for that one file. */
final class CameraPhotoRules {
    /** Literal in AndroidManifest.xml as well: tools/build-oss.py links the manifest as written (no placeholders). */
    static final String AUTHORITY = "org.yourrest.crm.camera";
    /** cache/camera-photos: the only folder the provider serves. */
    static final String FOLDER = "camera-photos";
    /** content://org.yourrest.crm.camera/photo/<name>: the only path. */
    static final String SEGMENT = "photo";
    static final String MIME = "image/jpeg";
    /** A photo stays in the cache a day (the page may read it again when the form is saved later), then the next start removes it. */
    static final long KEEP_MS = 24L * 60 * 60 * 1000;
    /** Activity.RESULT_OK. */
    static final int RESULT_OK = -1;
    private static final Pattern NAME = Pattern.compile("photo-\\d{8}-\\d{6}-[0-9a-f]{8}\\.jpg");
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss", Locale.ROOT);

    enum Offer { NONE, CHOICE, CAMERA }
    /** Whether the input's file chooser also offers the camera, from its accept list as WebView hands it over (entries one by one or still
     *  joined by commas) and its capture attribute. The camera writes a JPEG, so it is offered only where a JPEG is taken: an input that
     *  names no type (any file), any type, image/*, image/jpeg, or the extension jpg or jpeg (the competitor quotation's
     *  «.pdf,.jpg,.jpeg,.png,.webp», the design files', «صور القالب»'s image/*). Never for the Excel imports, a PDF-only or PNG-only input.
     *  With capture the camera opens at once; otherwise the person chooses the camera or the files. */
    static Offer offer(String[] accept, boolean capture) {
        boolean named = false, jpeg = false;
        if (accept != null) for (String entry : accept) {
            if (entry == null) continue;
            for (String part : entry.split(",")) {
                String token = part.trim().toLowerCase(Locale.ROOT);
                if (token.isEmpty()) continue;
                named = true;
                if (takesJpeg(token)) jpeg = true;
            }
        }
        if (named && !jpeg) return Offer.NONE;
        return capture ? Offer.CAMERA : Offer.CHOICE;
    }
    private static boolean takesJpeg(String token) {
        switch (token) {
            case "*": case "*/*": case "image/*": case "image/jpeg": case "image/jpg": case "image/pjpeg":
            case ".jpg": case ".jpeg": case "jpg": case "jpeg": return true;
            default: return false;
        }
    }

    /** A new photo's file name: the moment in UTC and eight random hexadecimal digits («photo-20261119-153012-1a2b3c4d.jpg»); the page
     *  receives it as the file's name. */
    static String newName(long millis, String randomHex) {
        if (randomHex == null || !randomHex.matches("[0-9a-f]{8}")) throw new IllegalArgumentException("random");
        return "photo-" + STAMP.format(Instant.ofEpochMilli(millis).atOffset(ZoneOffset.UTC)) + "-" + randomHex + ".jpg";
    }
    static boolean validName(String name) { return name != null && NAME.matcher(name).matches(); }
    /** The file a content URI's path names (its segments), only «photo/<a name this app makes>» directly inside root, and only when it
     *  exists as a file; anything else (another folder, «..», an encoded slash, a name of another shape) is null. */
    static File servable(File root, List<String> segments) {
        if (root == null || segments == null || segments.size() != 2 || !SEGMENT.equals(segments.get(0)) || !validName(segments.get(1))) return null;
        File file = new File(root, segments.get(1));
        try {
            if (!file.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())) return null;
        } catch (IOException unreadable) { return null; }
        return file.isFile() ? file : null;
    }
    /** The modes the provider opens a photo in: reading (the page uploading it) or writing (the camera app, which may truncate or read
     *  back what it writes). Null for anything else (append, a made-up mode). */
    static String mode(String mode) {
        if (mode == null) return null;
        switch (mode) {
            case "r": case "w": case "wt": case "rw": case "rwt": return mode;
            default: return null;
        }
    }
    static boolean readOnly(String mode) { return "r".equals(mode); }
    /** The camera's answer: a photo only when it says OK and the file holds bytes; a cancelled camera or an empty file is no photo. */
    static boolean delivered(int resultCode, long length) { return resultCode == RESULT_OK && length > 0; }
    /** A file the next start removes: older than a day, or dated in the future by more than a day (a clock that was wrong). */
    static boolean expired(long lastModified, long now) { return now - lastModified > KEEP_MS || lastModified - now > KEEP_MS; }

    // ---- The words: Arabic (the app's default) or English, as the person chose in the CRM page.
    static String chooserTitle(boolean english) { return english ? "Add a photo or a file" : "إضافة صورة أو ملف"; }
    static String takePhoto(boolean english) { return english ? "Take a photo with the camera" : "التقاط صورة بالكاميرا"; }
    static String chooseFiles(boolean english) { return english ? "Choose from files or the gallery" : "اختيار من الملفات أو المعرض"; }
    static String noCamera(boolean english) {
        return english ? "There is no camera app on this device; choose the photo from your files." : "لا يوجد تطبيق كاميرا على هذا الجهاز؛ اختر الصورة من الملفات.";
    }
    static String photoFailed(boolean english) {
        return english ? "The photo could not be saved; try again or choose it from the gallery." : "تعذّر حفظ الصورة الملتقطة؛ أعد المحاولة أو اخترها من المعرض.";
    }
    private CameraPhotoRules() { }
}

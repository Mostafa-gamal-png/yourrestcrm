package org.yourrest.crm;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/** The camera beside the file picker (1.0.15; the owner, 2026-11-19, for «صور القالب»): CameraPhotoRules exactly as the app runs them
 *  (which inputs offer the camera, the photo's name and the one path the provider serves, the modes, the camera's answer, the cleanup, the
 *  words), then source guards on MainActivity, the provider and the manifest (no CAMERA permission). The provider itself runs on Android
 *  stand-ins in tests/fixtures/native-camera. No camera or phone is involved. */
public final class CameraPhotoRulesCheck {
    private static int checks;
    private static void check(boolean value, String what) { checks++; if (!value) throw new AssertionError("Check " + checks + " failed: " + what); }
    private static CameraPhotoRules.Offer offer(boolean capture, String... accept) { return CameraPhotoRules.offer(accept, capture); }
    private static final Pattern ARABIC = Pattern.compile("[\\u0600-\\u06ff]");

    public static void main(String[] args) throws Exception {
        // ---- 1. Which inputs offer the camera (the site's real inputs first).
        check(offer(false, "image/*") == CameraPhotoRules.Offer.CHOICE, "«صور القالب» (image/*, several): the camera or the files");
        check(offer(false, ".pdf,.jpg,.jpeg,.png,.webp") == CameraPhotoRules.Offer.CHOICE && offer(false, ".pdf", ".jpg", ".jpeg", ".png", ".webp") == CameraPhotoRules.Offer.CHOICE, "a competitor's quotation (joined or separate entries)");
        String design = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.dwg,.dxf,.step,.stp,.igs,.iges,.stl,.sldprt,.sldasm,.slddrw,.nc1,.dstv,.ai,.eps,.cdr,.psd,.svg,.zip,.rar,.7z";
        check(offer(false, design) == CameraPhotoRules.Offer.CHOICE && offer(false, ".pdf,.png,.jpg,.jpeg,.webp,.gif") == CameraPhotoRules.Offer.CHOICE, "the design files and a quotation's or PO's file take a photo too");
        check(offer(false, ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") == CameraPhotoRules.Offer.NONE, "the ERP and record imports: no camera");
        check(offer(false, ".xls,.xlsx,.htm,.html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html") == CameraPhotoRules.Offer.NONE, "the collections import: no camera");
        for (String only : new String[]{"application/pdf", ".pdf", "image/png", ".png", ".webp", "image/webp", "video/*", "text/csv", "image/gif"})
            check(offer(false, only) == CameraPhotoRules.Offer.NONE && offer(true, only) == CameraPhotoRules.Offer.NONE, "an input that does not take a JPEG never gets one, even with capture: " + only);
        for (String jpeg : new String[]{"image/jpeg", "IMAGE/JPEG", " image/jpg ", "image/pjpeg", ".JPG", ".jpeg", "jpg", "jpeg", "*/*", "*"})
            check(offer(false, jpeg) == CameraPhotoRules.Offer.CHOICE && offer(true, jpeg) == CameraPhotoRules.Offer.CAMERA, "an input that takes a JPEG: " + jpeg);
        check(offer(false) == CameraPhotoRules.Offer.CHOICE && CameraPhotoRules.offer(null, false) == CameraPhotoRules.Offer.CHOICE && offer(false, "") == CameraPhotoRules.Offer.CHOICE && offer(false, " , ", null) == CameraPhotoRules.Offer.CHOICE, "an input that names no type takes any file, a photo too");
        check(offer(true, "image/*") == CameraPhotoRules.Offer.CAMERA && CameraPhotoRules.offer(null, true) == CameraPhotoRules.Offer.CAMERA, "capture opens the camera at once");
        check(offer(false, "image/png,image/jpeg") == CameraPhotoRules.Offer.CHOICE && offer(false, "video/*", "image/*") == CameraPhotoRules.Offer.CHOICE, "one entry that takes a JPEG is enough");

        // ---- 2. The photo's name and the one path the provider serves.
        long moment = Instant.parse("2026-11-19T12:02:11Z").toEpochMilli();
        String name = CameraPhotoRules.newName(moment, "1a2b3c4d");
        check(name.equals("photo-20261119-120211-1a2b3c4d.jpg") && CameraPhotoRules.validName(name), "the moment in UTC and eight random hexadecimal digits");
        for (String bad : new String[]{"", "1A2B3C4D", "1a2b3c4", "1a2b3c4d5", "../../x", null}) {
            boolean refused;
            try { CameraPhotoRules.newName(moment, bad); refused = false; } catch (IllegalArgumentException expected) { refused = true; }
            check(refused, "a name is made only from eight lowercase hexadecimal digits: " + bad);
        }
        for (String bad : new String[]{null, "", "photo-20261119-120211-1a2b3c4d.jpeg", "photo-20261119-120211-1A2B3C4D.jpg", "../photo-20261119-120211-1a2b3c4d.jpg",
                "photo-20261119-120211-1a2b3c4d.jpg/", "photo-2026111-120211-1a2b3c4d.jpg", "x-photo-20261119-120211-1a2b3c4d.jpg", "photo-20261119-120211-1a2b3c4d.jpg.png", "design.pdf"})
            check(!CameraPhotoRules.validName(bad), "no other name: " + bad);
        Path root = Files.createTempDirectory("camera-root"), outside = Files.createTempDirectory("camera-outside");
        try {
            File photo = root.resolve(name).toFile();
            check(CameraPhotoRules.servable(root.toFile(), List.of("photo", name)) == null, "a photo that does not exist is not served");
            Files.write(photo.toPath(), new byte[]{(byte) 0xff, (byte) 0xd8});
            check(photo.equals(CameraPhotoRules.servable(root.toFile(), List.of("photo", name))), "photo/<name> is the file in the folder");
            check(CameraPhotoRules.servable(root.toFile(), List.of("design-files", name)) == null && CameraPhotoRules.servable(root.toFile(), List.of(name)) == null
                    && CameraPhotoRules.servable(root.toFile(), List.of("photo", name, "x")) == null && CameraPhotoRules.servable(root.toFile(), List.of("photo", "..", name)) == null, "only that one path shape");
            check(CameraPhotoRules.servable(root.toFile(), Arrays.asList("photo", "../" + name)) == null && CameraPhotoRules.servable(root.toFile(), Arrays.asList("photo", "%2e%2e%2f" + name)) == null && CameraPhotoRules.servable(root.toFile(), Arrays.asList("photo", null)) == null, "no climbing out, encoded or not");
            check(CameraPhotoRules.servable(null, List.of("photo", name)) == null && CameraPhotoRules.servable(root.toFile(), null) == null, "nothing without a folder or a path");
            String folderName = CameraPhotoRules.newName(moment, "00000000");
            Files.createDirectory(root.resolve(folderName));
            check(CameraPhotoRules.servable(root.toFile(), List.of("photo", folderName)) == null, "a folder with a photo's name is not served");
            String linked = CameraPhotoRules.newName(moment, "ffffffff");
            Path secret = Files.write(outside.resolve("secret.jpg"), new byte[]{1});
            Files.createSymbolicLink(root.resolve(linked), secret);
            check(CameraPhotoRules.servable(root.toFile(), List.of("photo", linked)) == null, "a link with a photo's name that leads out of the folder is not served");
        } finally {
            try (Stream<Path> walk = Files.walk(root)) { walk.sorted((a, b) -> b.compareTo(a)).forEach(p -> p.toFile().delete()); }
            try (Stream<Path> walk = Files.walk(outside)) { walk.sorted((a, b) -> b.compareTo(a)).forEach(p -> p.toFile().delete()); }
        }

        // ---- 3. Modes, the camera's answer, the cleanup.
        for (String mode : new String[]{"r", "w", "wt", "rw", "rwt"}) check(mode.equals(CameraPhotoRules.mode(mode)), "opened as " + mode);
        for (String mode : new String[]{"wa", "rwa", "a", "", "R", "W", "rwx", " r", null}) check(CameraPhotoRules.mode(mode) == null, "refused: " + mode);
        check(CameraPhotoRules.readOnly("r") && !CameraPhotoRules.readOnly("w") && !CameraPhotoRules.readOnly("rw") && !CameraPhotoRules.readOnly(null), "only r reads only");
        check(CameraPhotoRules.delivered(-1, 1) && CameraPhotoRules.delivered(CameraPhotoRules.RESULT_OK, 4_000_000), "the camera said OK and wrote bytes: a photo");
        check(!CameraPhotoRules.delivered(-1, 0) && !CameraPhotoRules.delivered(0, 2_000_000) && !CameraPhotoRules.delivered(1, 10), "cancelled, or OK with an empty file: no photo");
        long now = moment, day = CameraPhotoRules.KEEP_MS;
        check(day == 86_400_000L && !CameraPhotoRules.expired(now - day, now) && CameraPhotoRules.expired(now - day - 1, now), "kept a day, to the millisecond");
        check(!CameraPhotoRules.expired(now + day, now) && CameraPhotoRules.expired(now + day + 1, now), "a file dated more than a day ahead (a clock that was wrong) goes too");

        // ---- 4. The constants and the words.
        check(CameraPhotoRules.AUTHORITY.equals("org.yourrest.crm.camera") && CameraPhotoRules.FOLDER.equals("camera-photos") && CameraPhotoRules.SEGMENT.equals("photo") && CameraPhotoRules.MIME.equals("image/jpeg"), "the authority, the folder, the path and the type");
        for (boolean english : new boolean[]{false, true}) {
            for (String words : new String[]{CameraPhotoRules.chooserTitle(english), CameraPhotoRules.takePhoto(english), CameraPhotoRules.chooseFiles(english), CameraPhotoRules.noCamera(english), CameraPhotoRules.photoFailed(english)})
                check(!words.isEmpty() && ARABIC.matcher(words).find() != english, (english ? "English" : "Arabic") + " words: " + words);
        }
        check(CameraPhotoRules.takePhoto(false).equals("التقاط صورة بالكاميرا") && CameraPhotoRules.chooseFiles(false).equals("اختيار من الملفات أو المعرض"), "the two choices");

        // ---- 5. Source guards: the activity, the provider and the manifest.
        Path source = Path.of(args.length > 0 ? args[0] : "mobile/android/app/src/main/java/org/yourrest/crm");
        String activity = Files.readString(source.resolve("MainActivity.java")), provider = Files.readString(source.resolve("CameraPhotoProvider.java"));
        String chooser = LoadFailureRulesCheck.block(activity, "public boolean onShowFileChooser(");
        check(chooser.indexOf("CameraPhotoRules.offer(params.getAcceptTypes(),params.isCaptureEnabled())") > chooser.indexOf("intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,"), "the camera is decided from the input after the picker is ready");
        check(chooser.contains("if(camera==CameraPhotoRules.Offer.CAMERA)takePhoto(intent);") && chooser.contains("else if(camera==CameraPhotoRules.Offer.CHOICE)chooseSource(intent);") && chooser.contains("else openPicker(intent);"), "capture: the camera; a photo input: the question; anything else: the picker as before");
        String choice = LoadFailureRulesCheck.block(activity, "private void chooseSource(");
        check(choice.contains("if(which==0)takePhoto(picker);else openPicker(picker);") && choice.contains("setOnCancelListener(dialog->{sourceChoice=null;if(files!=null){files.onReceiveValue(null);files=null;}})"), "the question: the camera or the files; backing out gives the page no file");
        String take = LoadFailureRulesCheck.block(activity, "private void takePhoto(");
        check(take.contains("new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,uri)") && take.contains("Intent.FLAG_GRANT_WRITE_URI_PERMISSION") && take.contains("capture.setClipData(ClipData.newRawUri(\"\",uri))"), "Android's camera app, writing into the one URI it is granted");
        check(take.contains("File photo=CameraPhotoProvider.create(getApplicationContext())") && take.contains("Uri uri=CameraPhotoProvider.uri(photo)") && take.contains("startActivityForResult(capture,CAMERA)"), "a new file of the app's cache, through its own provider");
        check(take.contains("catch(RuntimeException unavailable){cameraPhoto=null;CameraPhotoProvider.remove(photo);") && take.contains("CameraPhotoRules.noCamera(english)") && take.indexOf("openPicker(picker)") > 0, "no camera app: the files, with a word");
        String taken = LoadFailureRulesCheck.block(activity, "private void photoTaken(");
        int revoke = taken.indexOf("revokeUriPermission(uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_READ_URI_PERMISSION)"), handed = taken.indexOf("callback.onReceiveValue(new Uri[]{uri})");
        check(revoke >= 0 && handed > revoke && taken.contains("CameraPhotoRules.delivered(result,photo.length())"), "the camera's grant is taken back before the photo goes to the page, and only a photo with bytes goes");
        check(taken.contains("CameraPhotoProvider.remove(photo);") && taken.contains("if(callback!=null)callback.onReceiveValue(null);"), "no photo: the file goes and the page is answered");
        check(LoadFailureRulesCheck.block(activity, "protected void onActivityResult(").contains("if(request==CAMERA){photoTaken(result);return;}"), "the camera's answer is handled");
        check(LoadFailureRulesCheck.block(activity, "protected void onSaveInstanceState(").contains("if(cameraPhoto!=null)out.putString(CAMERA_PHOTO,cameraPhoto.getName());")
                && LoadFailureRulesCheck.block(activity, "public void onCreate(").contains("if(saved!=null&&CameraPhotoRules.validName(saved.getString(CAMERA_PHOTO)))cameraPhoto=new File(CameraPhotoProvider.root(getApplicationContext()),saved.getString(CAMERA_PHOTO));"), "a photo being taken when Android recreated the activity is found again (and removed, its page being gone)");
        check(LoadFailureRulesCheck.block(activity, "public void onCreate(").contains("CameraPhotoProvider.cleanup(getApplicationContext());") && LoadFailureRulesCheck.block(activity, "protected void onDestroy(").contains("if(isFinishing()&&cameraPhoto!=null){CameraPhotoProvider.remove(cameraPhoto);cameraPhoto=null;}"), "old photos go at start; a pending one when the app closes");
        check(LoadFailureRulesCheck.block(activity, "private void openPicker(").contains("try{startActivityForResult(picker,FILE_PICKER);}catch(Exception failure){files.onReceiveValue(null);files=null;}"), "the document picker as before");
        check(!activity.contains("resolveActivity(") && !activity.contains("queryIntentActivities("), "no package query (none is declared in the manifest): the camera is started and a missing one caught");
        check(provider.contains("CameraPhotoRules.servable(root(context), uri.getPathSegments())") && provider.contains("String allowed = CameraPhotoRules.mode(mode);") && provider.contains("CameraPhotoRules.readOnly(allowed) ? ParcelFileDescriptor.MODE_READ_ONLY : ParcelFileDescriptor.parseMode(allowed)"), "the provider asks the rules for the file and the mode");
        java.util.regex.Matcher designAuthority = Pattern.compile("AUTHORITY=\"([^\"]+)\"").matcher(Files.readString(source.resolve("DesignFileProvider.java")));
        check(designAuthority.find() && !designAuthority.group(1).equals(CameraPhotoRules.AUTHORITY), "an authority of its own, beside the design files' read-only one");
        check(provider.contains("CameraPhotoRules.AUTHORITY.equals(uri.getAuthority())") && provider.contains("\"content\".equals(uri.getScheme())"), "its own content URIs only");
        for (String write : new String[]{"public Uri insert(", "public int delete(", "public int update("}) check(LoadFailureRulesCheck.block(provider, write).contains("UnsupportedOperationException"), "no " + write);
        check(provider.contains("new File(context.getCacheDir(), CameraPhotoRules.FOLDER)") && provider.contains("new SecureRandom()"), "the private cache folder; an unguessable name");
        Path manifestPath = source.resolve("../../../../AndroidManifest.xml");
        String manifestText = Files.readString(manifestPath);
        org.w3c.dom.Document manifest = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(manifestPath.toFile());
        NodeList providers = manifest.getElementsByTagName("provider");
        Element camera = null;
        for (int i = 0; i < providers.getLength(); i++) if (".CameraPhotoProvider".equals(((Element) providers.item(i)).getAttribute("android:name"))) camera = (Element) providers.item(i);
        check(camera != null && CameraPhotoRules.AUTHORITY.equals(camera.getAttribute("android:authorities")) && !camera.getAttribute("android:authorities").contains("${"), "the manifest names the provider with the same literal authority (no placeholder: tools/build-oss.py)");
        check(camera != null && "false".equals(camera.getAttribute("android:exported")) && "true".equals(camera.getAttribute("android:grantUriPermissions")) && camera.getParentNode().getNodeName().equals("application"), "not exported; reached only through a granted URI");
        Set<String> permissions = new TreeSet<>();
        NodeList uses = manifest.getElementsByTagName("uses-permission");
        for (int i = 0; i < uses.getLength(); i++) permissions.add(((Element) uses.item(i)).getAttribute("android:name"));
        check(permissions.equals(new TreeSet<>(Arrays.asList("android.permission.INTERNET", "android.permission.ACCESS_NETWORK_STATE", "android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION",
                "android.permission.ACCESS_BACKGROUND_LOCATION", "android.permission.RECEIVE_BOOT_COMPLETED", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_LOCATION",
                "android.permission.POST_NOTIFICATIONS", "android.permission.REQUEST_INSTALL_PACKAGES"))), "no permission added: " + permissions);
        check(!manifestText.contains("android.permission.CAMERA") && !manifestText.contains("android.hardware.camera") && !manifestText.contains("STORAGE"), "no CAMERA permission (declaring it would make ACTION_IMAGE_CAPTURE need a runtime grant), no storage permission");
        try (Stream<Path> all = Files.list(source)) {
            for (Path file : (Iterable<Path>) all::iterator) check(!Files.readString(file).contains("permission.CAMERA"), "no source asks for the camera permission: " + file.getFileName());
        }
        java.lang.System.out.println("Camera photo rules: " + checks + " checks passed (no camera app, picker or phone verified)");
    }
}

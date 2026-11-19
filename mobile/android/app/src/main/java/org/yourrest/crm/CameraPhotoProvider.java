package org.yourrest.crm;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Locale;

/** The one file a camera photo is written to (1.0.15): cache/camera-photos/photo-<moment>-<random>.jpg, served as
 *  content://org.yourrest.crm.camera/photo/<name>. There is no AndroidX FileProvider in this app, so this is a minimal provider of its own:
 *  not exported, so another app reaches a photo only through the one URI it was handed with a grant (the camera app, to write it); the
 *  app's own WebView reads it to upload it. Only files the app made in that folder, only reading and writing (no append), never insert,
 *  update or delete. The decisions are CameraPhotoRules'; CameraPhotoProviderCheck runs this class on Android stand-ins. */
public final class CameraPhotoProvider extends ContentProvider {
    private static final String[] COLUMNS = {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
    private static final SecureRandom RANDOM = new SecureRandom();

    static File root(Context context) { return new File(context.getCacheDir(), CameraPhotoRules.FOLDER); }
    /** An empty file for the next photo, or null when the cache cannot be written. The camera app writes into it. */
    static File create(Context context) {
        File folder = root(context);
        if (!folder.isDirectory() && !folder.mkdirs()) return null;
        for (int attempt = 0; attempt < 3; attempt++) {
            File file = new File(folder, CameraPhotoRules.newName(System.currentTimeMillis(), String.format(Locale.ROOT, "%08x", RANDOM.nextInt())));
            try { if (file.createNewFile()) return file; } catch (IOException unwritable) { return null; }
        }
        return null;
    }
    static Uri uri(File file) {
        return new Uri.Builder().scheme("content").authority(CameraPhotoRules.AUTHORITY).appendPath(CameraPhotoRules.SEGMENT).appendPath(file.getName()).build();
    }
    /** Removes the photos older than a day, and any entry of another shape (a folder, a link, another name), when the app starts. */
    static void cleanup(Context context) {
        File[] entries = root(context).listFiles();
        if (entries == null) return;
        long now = System.currentTimeMillis();
        for (File entry : entries) {
            if (Files.isSymbolicLink(entry.toPath()) || !entry.isFile() || !CameraPhotoRules.validName(entry.getName()) || CameraPhotoRules.expired(entry.lastModified(), now)) remove(entry);
        }
    }
    /** Removes a photo, or a stray folder with what is inside it; a link is removed itself, never what it leads to. */
    static void remove(File file) {
        if (file == null) return;
        if (!Files.isSymbolicLink(file.toPath()) && file.isDirectory()) { File[] inside = file.listFiles(); if (inside != null) for (File child : inside) remove(child); }
        file.delete();
    }

    @Override public boolean onCreate() { return true; }
    private File file(Uri uri) {
        Context context = getContext();
        if (context == null || uri == null || !"content".equals(uri.getScheme()) || !CameraPhotoRules.AUTHORITY.equals(uri.getAuthority())) return null;
        return CameraPhotoRules.servable(root(context), uri.getPathSegments());
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        String allowed = CameraPhotoRules.mode(mode);
        if (allowed == null) throw new FileNotFoundException("mode");
        File file = file(uri);
        if (file == null) throw new FileNotFoundException("not available");
        return ParcelFileDescriptor.open(file, CameraPhotoRules.readOnly(allowed) ? ParcelFileDescriptor.MODE_READ_ONLY : ParcelFileDescriptor.parseMode(allowed));
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file = file(uri);
        if (file == null) return null;
        ArrayList<String> columns = new ArrayList<>();
        ArrayList<Object> values = new ArrayList<>();
        for (String column : projection == null ? COLUMNS : projection) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) { columns.add(column); values.add(file.getName()); }
            else if (OpenableColumns.SIZE.equals(column)) { columns.add(column); values.add(file.length()); }
        }
        MatrixCursor cursor = new MatrixCursor(columns.toArray(new String[0]), 1);
        cursor.addRow(values.toArray());
        return cursor;
    }
    @Override public String getType(Uri uri) { return file(uri) == null ? null : CameraPhotoRules.MIME; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("camera photos only"); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { throw new UnsupportedOperationException("camera photos only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { throw new UnsupportedOperationException("camera photos only"); }
}

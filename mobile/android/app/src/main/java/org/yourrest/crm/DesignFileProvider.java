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
import java.util.ArrayList;

/** Read-only access, granted per file, to a design file the app fetched into its private cache (cache/design-files) so that another app
 *  can show it. Not exported: an app reads only the one URI it was handed with FLAG_GRANT_READ_URI_PERMISSION. Paths outside that
 *  folder, other folders and writes are refused. */
public final class DesignFileProvider extends ContentProvider {
    /** Literal in AndroidManifest.xml as well: the standalone build links the manifest as written (no placeholders). */
    static final String AUTHORITY="org.yourrest.crm.designfiles";
    private static final String[] COLUMNS={OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE};
    @Override public boolean onCreate(){return true;}
    private File file(Uri uri){
        Context context=getContext();
        if(context==null||uri==null||!"content".equals(uri.getScheme())||!AUTHORITY.equals(uri.getAuthority()))return null;
        return DesignFileRules.servable(DesignFiles.root(context),uri.getPathSegments());
    }
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
        if(!DesignFileRules.readOnly(mode))throw new FileNotFoundException("read only");
        File file=file(uri);
        if(file==null)throw new FileNotFoundException("not available");
        return ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] selectionArgs,String sortOrder){
        File file=file(uri);
        if(file==null)return null;
        ArrayList<String> columns=new ArrayList<>();ArrayList<Object> values=new ArrayList<>();
        for(String column:projection==null?COLUMNS:projection){
            if(OpenableColumns.DISPLAY_NAME.equals(column)){columns.add(column);values.add(file.getName());}
            else if(OpenableColumns.SIZE.equals(column)){columns.add(column);values.add(file.length());}
        }
        MatrixCursor cursor=new MatrixCursor(columns.toArray(new String[0]),1);
        cursor.addRow(values.toArray());
        return cursor;
    }
    @Override public String getType(Uri uri){File file=file(uri);return file==null?null:DesignFileRules.typeForName(file.getName());}
    @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException("read only");}
    @Override public int delete(Uri uri,String selection,String[] selectionArgs){throw new UnsupportedOperationException("read only");}
    @Override public int update(Uri uri,ContentValues values,String selection,String[] selectionArgs){throw new UnsupportedOperationException("read only");}
}

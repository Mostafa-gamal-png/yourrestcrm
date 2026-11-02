package org.yourrest.crm;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** What Android's document picker may offer for a page's file input, from the input's accept list (pure, checked on the JVM).
 *  A blank list keeps the picker the app always opened (images, PDF, CSV and Excel). MIME types are kept and known extensions map to
 *  their MIME type. One entry the picker cannot filter by (a drawing such as .dwg, .step or .nc1, or the any-type wildcard) opens every file: the page
 *  and the server check the extension, size and content anyway. */
final class FileChooserRules {
    /** The list every input used before 1.0.12, still used when the page names no types. */
    private static final String[] DEFAULT_TYPES={"image/*","application/pdf","text/csv","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel"};
    private static final Pattern MIME=Pattern.compile("[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/(\\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,126})");
    private static final Map<String,String[]> EXTENSIONS=new HashMap<>();
    static {
        EXTENSIONS.put("pdf",new String[]{"application/pdf"});
        EXTENSIONS.put("png",new String[]{"image/png"});
        EXTENSIONS.put("jpg",new String[]{"image/jpeg"});
        EXTENSIONS.put("jpeg",new String[]{"image/jpeg"});
        EXTENSIONS.put("webp",new String[]{"image/webp"});
        EXTENSIONS.put("gif",new String[]{"image/gif"});
        EXTENSIONS.put("svg",new String[]{"image/svg+xml"});
        // Older Android versions name a CSV file text/comma-separated-values.
        EXTENSIONS.put("csv",new String[]{"text/csv","text/comma-separated-values"});
        EXTENSIONS.put("xlsx",new String[]{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
        EXTENSIONS.put("xls",new String[]{"application/vnd.ms-excel"});
        EXTENSIONS.put("docx",new String[]{"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
        EXTENSIONS.put("doc",new String[]{"application/msword"});
        EXTENSIONS.put("txt",new String[]{"text/plain"});
        EXTENSIONS.put("zip",new String[]{"application/zip"});
    }
    static String[] defaultTypes(){return DEFAULT_TYPES.clone();}
    /** The MIME types to pass as EXTRA_MIME_TYPES, or null to open every file (type any, without EXTRA_MIME_TYPES). */
    static String[] mimeTypes(String[] accept){
        LinkedHashSet<String> types=new LinkedHashSet<>();boolean named=false;
        if(accept!=null)for(String entry:accept){
            if(entry==null)continue;
            // WebView may hand over the attribute's entries one by one or still joined by commas.
            for(String part:entry.split(",")){
                String token=part.trim().toLowerCase(Locale.ROOT);
                if(token.isEmpty())continue;
                named=true;
                String[] mapped=map(token);
                if(mapped==null)return null;
                for(String type:mapped)types.add(type);
            }
        }
        return named?types.toArray(new String[0]):defaultTypes();
    }
    private static String[] map(String token){
        if(token.indexOf('/')>=0){
            if(!MIME.matcher(token).matches())return null;
            return new String[]{token};
        }
        String extension=token.startsWith(".")?token.substring(1):token;
        String[] known=EXTENSIONS.get(extension);
        return known==null?null:known.clone();
    }
    private FileChooserRules(){ }
}

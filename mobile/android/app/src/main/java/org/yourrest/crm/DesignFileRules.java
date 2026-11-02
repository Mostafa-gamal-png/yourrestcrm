package org.yourrest.crm;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Pure rules for opening and saving a mold request's design file inside the app (checked on the JVM by DesignFileCheck).
 *  Only the CRM's own design-file link is fetched natively, with the WebView session; every other URL keeps the WebView's behaviour. */
final class DesignFileRules {
    static final String PATH="/api/mold-requests/design-file";
    /** The CRM serves up to 25 MiB a file; a little headroom, never more. */
    static final long MAX_BYTES=26L*1024*1024;
    /** The CRM waits up to 120 seconds for production before it answers. */
    static final int CONNECT_TIMEOUT_MS=15_000,READ_TIMEOUT_MS=130_000;
    /** The CRM keeps a download's place for ten minutes at most. */
    static final long TOTAL_MS=10*60_000L;
    static final long CACHE_MS=24*3600_000L;
    static final int NAME_MAX_BYTES=180,ERROR_MAX_BYTES=65536;
    static final String FALLBACK_NAME="design-file";
    static final String SESSION_ENDED="انتهت جلسة الدخول؛ سجّل الدخول مرة أخرى";
    static final String FAILED="تعذّر تنزيل الملف؛ حاول مرة أخرى";
    static final String NETWORK="تعذّر تنزيل الملف؛ تحقق من الاتصال";
    static final String TOO_LARGE="الملف أكبر من الحجم المسموح (25 ميجابايت)؛ لا يمكن تنزيله في التطبيق";
    static final String INCOMPLETE="لم يكتمل تنزيل الملف؛ تحقق من الاتصال ثم حاول مرة أخرى";
    static final String TIMEOUT="انتهت مهلة تنزيل الملف؛ حاول مرة أخرى";
    static final String STORAGE="تعذّر حفظ الملف على الجهاز؛ تحقق من المساحة المتاحة";
    private static final Pattern FOLDER=Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    /** The only types the CRM serves a design file as (portable/mold-rules.mjs moldDesignContentType); anything else is plain bytes. */
    static final List<String> SERVED_TYPES=Collections.unmodifiableList(Arrays.asList("application/pdf","image/png","image/jpeg","image/gif","image/webp"));
    /** "wt" first: from Android 10 "w" does not truncate, so overwriting a longer file would keep its tail. "w" only for a provider that
     *  refuses "wt" (a cloud provider that takes the whole stream). */
    static final List<String> SAVE_MODES=Collections.unmodifiableList(Arrays.asList("wt","w"));

    /** A failure the person is told about in words; a cancelled transfer has no words. */
    static final class Failure extends Exception {
        final boolean cancelled;
        Failure(String message){super(message);cancelled=false;}
        private Failure(){super("cancelled");cancelled=true;}
        static Failure cancelled(){return new Failure();}
    }
    interface Cancel {boolean cancelled();}

    /** The fixed-origin URL fetched for a design-file link (the trusted origin, exactly the design-file path, its query kept), or null
     *  for every other URL, which then keeps the WebView's own handling. */
    static String fetchUrl(String url){
        if(url==null||url.length()>4096||!RouteRules.trusted(url))return null;
        try{
            URI uri=URI.create(url);
            String query=uri.getRawQuery();
            if(!PATH.equals(uri.getRawPath())||query==null||query.isEmpty())return null;
            return RouteRules.ORIGIN+PATH+"?"+query;
        }catch(RuntimeException invalid){return null;}
    }
    /** The «عرض» link asks the CRM for inline=1, as the server reads it (the first inline parameter). */
    static boolean inline(String url){
        try{
            String query=URI.create(url).getRawQuery();
            if(query==null)return false;
            for(String pair:query.split("&")){
                int equals=pair.indexOf('=');
                String name=URLDecoder.decode(equals<0?pair:pair.substring(0,equals),"UTF-8");
                if(!"inline".equals(name))continue;
                return equals>=0&&"1".equals(URLDecoder.decode(pair.substring(equals+1),"UTF-8"));
            }
            return false;
        }catch(Exception invalid){return false;}
    }
    /** «عرض» (inline=1, or a main-frame navigation to the link) opens the file in another app; «تنزيل» saves it where the person picks. */
    static boolean view(boolean navigation,String url){return navigation||inline(url);}
    /** Another app receives a file only after a tap: «عرض» without one (a script or redirect navigation, a download that asks to open)
     *  asks first. «تنزيل» needs no question: the system save picker is the person's own choice. */
    static boolean confirmView(boolean view,boolean gesture){return view&&!gesture;}
    /** After a failed write, the document is removed only when this save created it (empty when the picker returned it, as a new document
     *  is); a file the person chose to overwrite, or one whose size is unknown, is never deleted. */
    static boolean createdBySave(Long sizeBefore){return sizeBefore!=null&&sizeBefore==0L;}

    /** A Content-Length the cap allows (-1 when the server did not say). */
    static boolean lengthAllowed(long declared){return declared<=MAX_BYTES;}
    /** Copies the answer, refusing more than MAX_BYTES or a body that differs from its declared length. A failure to write is the
     *  phone's storage, a failure to read is the network. */
    static long copy(InputStream input,OutputStream output,long declared,Cancel cancel,long deadlineNanos)throws IOException,Failure{
        if(!lengthAllowed(declared))throw new Failure(TOO_LARGE);
        byte[] buffer=new byte[65536];long total=0;int count;
        while(true){
            if(cancel!=null&&cancel.cancelled())throw Failure.cancelled();
            if(deadlineNanos!=0&&System.nanoTime()-deadlineNanos>0)throw new Failure(TIMEOUT);
            count=input.read(buffer);
            if(count<0)break;
            if(count==0)continue;
            if(total+count>MAX_BYTES)throw new Failure(TOO_LARGE);
            if(declared>=0&&total+count>declared)throw new Failure(INCOMPLETE);
            try{output.write(buffer,0,count);}catch(IOException full){throw new Failure(STORAGE);}
            total+=count;
        }
        if(cancel!=null&&cancel.cancelled())throw Failure.cancelled();
        if(declared>=0&&total!=declared)throw new Failure(INCOMPLETE);
        return total;
    }
    /** A bounded read of an error answer (null when there is none or it is too long to be the CRM's short JSON). */
    static String readBounded(InputStream input,int limit){
        if(input==null)return null;
        try(InputStream stream=input;ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            byte[] buffer=new byte[4096];int count;
            while((count=stream.read(buffer))!=-1){if(bytes.size()+count>limit)return null;bytes.write(buffer,0,count);}
            return new String(bytes.toByteArray(),StandardCharsets.UTF_8);
        }catch(IOException failed){return null;}
    }
    /** What the person reads when the CRM did not send the file: 401 is always the ended session; otherwise the CRM's own Arabic
     *  {"error": "..."}, else a general message. */
    static String errorMessage(int status,String body){
        if(status==401)return SESSION_ENDED;
        String server=oneLine(jsonError(body),300);
        return server==null?FAILED:server;
    }
    /** The "error" string of a JSON object, or null (not JSON, not an object, no such string). */
    static String jsonError(String body){
        if(body==null)return null;
        try{
            Json json=new Json(body);json.space();
            if(json.next()!='{')return null;
            json.space();if(json.peek()=='}')return null;
            while(true){
                json.space();String key=json.string();json.space();
                if(json.next()!=':')return null;
                json.space();
                if(json.peek()=='"'){String value=json.string();if("error".equals(key))return value;}
                else json.skip();
                json.space();char separator=json.next();
                if(separator=='}')return null;
                if(separator!=',')return null;
            }
        }catch(RuntimeException malformed){return null;}
    }
    private static final class Json {
        final String text;int at;
        Json(String text){this.text=text;}
        char peek(){return text.charAt(at);}
        char next(){return text.charAt(at++);}
        void space(){while(at<text.length()&&" \t\r\n".indexOf(text.charAt(at))>=0)at++;}
        String string(){
            if(next()!='"')throw new IllegalArgumentException();
            StringBuilder out=new StringBuilder();
            while(true){
                char c=next();
                if(c=='"')return out.toString();
                if(c<0x20)throw new IllegalArgumentException();
                if(c!='\\'){out.append(c);continue;}
                char escaped=next();
                switch(escaped){
                    case '"':case '\\':case '/':out.append(escaped);break;
                    case 'b':out.append('\b');break;case 'f':out.append('\f');break;case 'n':out.append('\n');break;case 'r':out.append('\r');break;case 't':out.append('\t');break;
                    case 'u':out.append((char)Integer.parseInt(text.substring(at,at+4),16));at+=4;break;
                    default:throw new IllegalArgumentException();
                }
            }
        }
        void skip(){
            char c=peek();
            if(c=='"'){string();return;}
            if(c=='{'||c=='['){
                int depth=0;
                do{c=peek();if(c=='"'){string();continue;}at++;if(c=='{'||c=='[')depth++;else if(c=='}'||c==']')depth--;}while(depth>0);
                return;
            }
            int start=at;
            while(at<text.length()&&",}] \t\r\n".indexOf(text.charAt(at))<0)at++;
            if(at==start)throw new IllegalArgumentException();
        }
    }
    /** Text from the server shown on one line: no control or direction characters, single spaces, bounded. Null when nothing is left. */
    static String oneLine(String text,int max){
        if(text==null)return null;
        StringBuilder out=new StringBuilder();int kept=0;
        for(int i=0;i<text.length()&&kept<max;){
            int cp=text.codePointAt(i);i+=Character.charCount(cp);
            if(hidden(cp))continue;
            if(Character.isWhitespace(cp)||cp=='\u00A0'){if(out.length()>0&&out.charAt(out.length()-1)!=' '){out.append(' ');kept++;}continue;}
            out.appendCodePoint(cp);kept++;
        }
        String result=out.toString().trim();
        return result.isEmpty()?null:result;
    }
    /** Control characters, direction marks and overrides, and halves of a UTF-16 pair left alone. */
    private static boolean hidden(int cp){
        return cp<0x20&&cp!='\t'&&cp!='\n'&&cp!='\r'||cp>=0x7F&&cp<=0x9F||cp==0x061C||cp==0x200E||cp==0x200F||cp>=0x202A&&cp<=0x202E||cp>=0x2066&&cp<=0x2069
            ||cp>=Character.MIN_SURROGATE&&cp<=Character.MAX_SURROGATE||cp==0xFEFF;
    }

    /** The answer's MIME type (parameters dropped) when it is one the CRM serves, else application/octet-stream: what reaches another app
     *  («عرض») or the save picker is never the answer's own choice (an APK, HTML or script type). */
    static String mimeType(String contentType){
        if(contentType==null)return "application/octet-stream";
        int semicolon=contentType.indexOf(';');
        String type=(semicolon<0?contentType:contentType.substring(0,semicolon)).trim().toLowerCase(Locale.ROOT);
        return SERVED_TYPES.contains(type)?type:"application/octet-stream";
    }
    /** The type a cached file is reported as to another app: the few the CRM shows inline, else plain bytes. */
    static String typeForName(String name){
        String lower=name==null?"":name.toLowerCase(Locale.ROOT);
        if(lower.endsWith(".pdf"))return "application/pdf";
        if(lower.endsWith(".png"))return "image/png";
        if(lower.endsWith(".jpg")||lower.endsWith(".jpeg"))return "image/jpeg";
        if(lower.endsWith(".gif"))return "image/gif";
        if(lower.endsWith(".webp"))return "image/webp";
        return "application/octet-stream";
    }

    /** The file's name from Content-Disposition: filename* (RFC 5987/6266, UTF-8 or ISO-8859-1) first, else filename; made safe, else
     *  "design-file". */
    static String fileName(String header){
        String extended=null,plain=null;
        if(header!=null)for(String[] parameter:parameters(header)){
            if("filename*".equals(parameter[0])&&extended==null)extended=extended(parameter[1]);
            else if("filename".equals(parameter[0])&&plain==null)plain=parameter[1];
        }
        String name=sanitize(extended);
        if(name.isEmpty())name=sanitize(plain);
        return name.isEmpty()?FALLBACK_NAME:name;
    }
    /** The parameters after the disposition type, as lowercase name and value (a quoted string unquoted). */
    static List<String[]> parameters(String header){
        List<String[]> out=new ArrayList<>();
        int at=header.indexOf(';');
        while(at>=0&&at<header.length()){
            at++;
            int equals=header.indexOf('=',at),semicolon=header.indexOf(';',at);
            if(equals<0||semicolon>=0&&semicolon<equals){at=semicolon;continue;}
            String name=header.substring(at,equals).trim().toLowerCase(Locale.ROOT);
            at=equals+1;
            while(at<header.length()&&header.charAt(at)==' ')at++;
            StringBuilder value=new StringBuilder();
            if(at<header.length()&&header.charAt(at)=='"'){
                at++;
                while(at<header.length()&&header.charAt(at)!='"'){
                    char c=header.charAt(at++);
                    if(c=='\\'&&at<header.length())c=header.charAt(at++);
                    value.append(c);
                }
                at=header.indexOf(';',at);
            }else{
                int end=header.indexOf(';',at);
                value.append((end<0?header.substring(at):header.substring(at,end)).trim());
                at=end;
            }
            out.add(new String[]{name,value.toString()});
        }
        return out;
    }
    /** charset'language'percent-encoded (RFC 5987), strictly: an unknown charset, a broken escape or broken UTF-8 gives null. */
    static String extended(String value){
        if(value==null)return null;
        int first=value.indexOf('\''),second=first<0?-1:value.indexOf('\'',first+1);
        if(second<0)return null;
        String charset=value.substring(0,first).trim().toUpperCase(Locale.ROOT);
        Charset decoder;
        if("UTF-8".equals(charset))decoder=StandardCharsets.UTF_8;
        else if("ISO-8859-1".equals(charset))decoder=StandardCharsets.ISO_8859_1;
        else return null;
        String encoded=value.substring(second+1).trim();
        ByteBuffer bytes=ByteBuffer.allocate(encoded.length());
        for(int i=0;i<encoded.length();i++){
            char c=encoded.charAt(i);
            if(c=='%'){
                if(i+2>=encoded.length())return null;
                int high=Character.digit(encoded.charAt(i+1),16),low=Character.digit(encoded.charAt(i+2),16);
                if(high<0||low<0)return null;
                bytes.put((byte)(high*16+low));i+=2;
            }else if(c>0x20&&c<0x7F)bytes.put((byte)c);
            else return null;
        }
        bytes.flip();
        try{return decoder.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(bytes).toString();}
        catch(CharacterCodingException broken){return null;}
    }
    /** A name safe for a file in the app's cache and for the save picker: no path separators or characters other file systems refuse,
     *  no control or direction characters, no leading dots, single spaces, at most NAME_MAX_BYTES of UTF-8 with the extension kept.
     *  '' when nothing is left. */
    static String sanitize(String raw){
        // A cut can uncover a shorter extension; a second pass then trims before it. Repeat until nothing changes (at most a few).
        String name=pass(raw);
        for(int round=0;round<8;round++){String again=pass(name);if(again.equals(name))break;name=again;}
        return name;
    }
    private static String pass(String raw){
        if(raw==null)return "";
        StringBuilder out=new StringBuilder();
        for(int i=0;i<raw.length();){
            int cp=raw.codePointAt(i);i+=Character.charCount(cp);
            if(cp<0x20||hidden(cp))continue;
            if(cp=='/'||cp=='\\'||":*?\"<>|".indexOf(cp)>=0){out.append('_');continue;}
            if(Character.isWhitespace(cp)||Character.isSpaceChar(cp)){if(out.length()>0&&out.charAt(out.length()-1)!=' ')out.append(' ');continue;}
            out.appendCodePoint(cp);
        }
        String name=trimEnds(out.toString());
        if(name.isEmpty())return "";
        int dot=name.lastIndexOf('.');
        String extension=dot>0&&name.length()-dot<=16&&name.indexOf(' ',dot)<0?name.substring(dot):"";
        String base=extension.isEmpty()?name:name.substring(0,dot);
        int room=NAME_MAX_BYTES-utf8(extension);
        while(utf8(base)>room&&!base.isEmpty())base=base.substring(0,base.offsetByCodePoints(base.length(),-1));
        base=trimEnds(base);
        if(base.isEmpty())base=FALLBACK_NAME;
        return base+extension;
    }
    private static String trimEnds(String text){
        int start=0,end=text.length();
        while(start<end&&(text.charAt(start)=='.'||text.charAt(start)==' '))start++;
        while(end>start&&(text.charAt(end-1)=='.'||text.charAt(end-1)==' '))end--;
        return text.substring(start,end);
    }
    private static int utf8(String text){return text.getBytes(StandardCharsets.UTF_8).length;}

    /** The read-only content provider serves only root/<random folder>/<safe name>, never a path that leaves the folder. */
    static File servable(File root,List<String> segments){
        if(root==null||segments==null||segments.size()!=2)return null;
        String folder=segments.get(0),name=segments.get(1);
        if(folder==null||!FOLDER.matcher(folder).matches()||name==null||name.isEmpty()||!name.equals(sanitize(name)))return null;
        try{
            File base=root.getCanonicalFile(),file=new File(new File(base,folder),name).getCanonicalFile();
            File parent=file.getParentFile();
            if(parent==null||!base.equals(parent.getParentFile())||!folder.equals(parent.getName())||!name.equals(file.getName()))return null;
            return file.isFile()?file:null;
        }catch(IOException|SecurityException unreadable){return null;}
    }
    static boolean folderName(String name){return name!=null&&FOLDER.matcher(name).matches();}
    /** Only reading is offered to another app. */
    static boolean readOnly(String mode){return "r".equals(mode);}
    /** A cached copy older than a day (or dated a day ahead after a clock change) is removed when the app opens. */
    static boolean expired(long modified,long now){return now-modified>=CACHE_MS||modified-now>=CACHE_MS;}
    private DesignFileRules(){ }
}

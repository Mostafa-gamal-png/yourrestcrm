package org.yourrest.crm;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/** Executes the design-file rules of 1.0.12 (which links are fetched natively, the inline flag, Content-Disposition names, the size cap,
 *  error wording, the provider's path guard) plus source and manifest guards. No phone, network, viewer app or save picker is run. */
public final class DesignFileCheck {
    static int checks;
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    interface Action {void run()throws Exception;}
    static Exception thrown(Action action){try{action.run();return null;}catch(Exception failure){return failure;}}
    static final String LINK=RouteRules.ORIGIN+DesignFileRules.PATH;
    /** What the CRM's moldContentDisposition puts in filename* (encodeURIComponent, plus ' ( ) * escaped). */
    static String serverEncoded(String name){
        StringBuilder out=new StringBuilder();
        for(byte b:name.getBytes(StandardCharsets.UTF_8)){
            int c=b&255;
            if(c<128&&(Character.isLetterOrDigit(c)||"-_.!~".indexOf(c)>=0))out.append((char)c);
            else out.append('%').append(String.format("%02X",c));
        }
        return out.toString();
    }
    static String name(String header){return DesignFileRules.fileName(header);}
    static boolean safe(String name){
        if(name.isEmpty()||name.startsWith(".")||name.startsWith(" ")||name.endsWith(" ")||name.endsWith(".")||name.contains("  "))return false;
        if(name.getBytes(StandardCharsets.UTF_8).length>DesignFileRules.NAME_MAX_BYTES)return false;
        for(int i=0;i<name.length();i++){char c=name.charAt(i);if(c<0x20||c=='/'||c=='\\'||c==0x7F||c>=0x80&&c<=0x9F||c>=0x202A&&c<=0x202E||c>=0x2066&&c<=0x2069||c==0x200E||c==0x200F)return false;
            if(Character.isHighSurrogate(c)&&(i+1>=name.length()||!Character.isLowSurrogate(name.charAt(i+1))))return false;
            if(Character.isLowSurrogate(c)&&(i==0||!Character.isHighSurrogate(name.charAt(i-1))))return false;}
        return true;
    }
    static InputStream chunked(byte[] bytes,int chunk){return new ByteArrayInputStream(bytes){@Override public synchronized int read(byte[] b,int off,int len){return super.read(b,off,Math.min(chunk,len));}};}
    static InputStream zeros(long size){return new InputStream(){long left=size;@Override public int read(){return left-->0?0:-1;}@Override public int read(byte[] b,int off,int len){if(left<=0)return -1;int n=(int)Math.min(len,left);Arrays.fill(b,off,off+n,(byte)0);left-=n;return n;}};}
    static final OutputStream SINK=new OutputStream(){@Override public void write(int b){ }@Override public void write(byte[] b,int off,int len){ }};
    static String failure(Action action){Exception e=thrown(action);return e instanceof DesignFileRules.Failure&&!((DesignFileRules.Failure)e).cancelled?e.getMessage():null;}

    public static void main(String[] args)throws Exception{
        // ---- 1. which links are fetched natively: the trusted origin and exactly the design-file path, the query kept
        String query="id=mold-1&file=f_2";
        check((LINK+"?"+query).equals(DesignFileRules.fetchUrl(LINK+"?"+query)),"The design-file link is fetched as it is");
        check((LINK+"?"+query+"&inline=1").equals(DesignFileRules.fetchUrl(LINK+"?"+query+"&inline=1")),"The «عرض» link keeps inline=1");
        check((LINK+"?order=12&file=34").equals(DesignFileRules.fetchUrl(LINK+"?order=12&file=34")),"The sales manager's order link");
        check((LINK+"?"+query).equals(DesignFileRules.fetchUrl("https://crm.yourrest.org:443"+DesignFileRules.PATH+"?"+query)),"The default port is the same origin");
        check((LINK+"?"+query).equals(DesignFileRules.fetchUrl(LINK+"?"+query+"#top")),"A fragment is never sent");
        check((LINK+"?id=a%20b&file=x%2Fy").equals(DesignFileRules.fetchUrl(LINK+"?id=a%20b&file=x%2Fy")),"The query is kept exactly as encoded");
        String[] refused={null,"",LINK,LINK+"?",
            "http://crm.yourrest.org"+DesignFileRules.PATH+"?"+query,"https://crm.yourrest.org.evil.example"+DesignFileRules.PATH+"?"+query,"https://evil.example"+DesignFileRules.PATH+"?"+query,
            "https://crm.yourrest.org@evil.example"+DesignFileRules.PATH+"?"+query,"https://user:pass@crm.yourrest.org"+DesignFileRules.PATH+"?"+query,"https://crm.yourrest.org:444"+DesignFileRules.PATH+"?"+query,
            "https://sub.crm.yourrest.org"+DesignFileRules.PATH+"?"+query,
            RouteRules.ORIGIN+"/api/mold-requests/design-files?"+query,RouteRules.ORIGIN+"/api/mold-requests/design-file/?"+query,RouteRules.ORIGIN+"/api/mold-requests/design-file/x?"+query,
            RouteRules.ORIGIN+"/API/mold-requests/design-file?"+query,RouteRules.ORIGIN+"/api/mold-requests/%64esign-file?"+query,RouteRules.ORIGIN+"/api/mold-requests/./design-file?"+query,
            RouteRules.ORIGIN+"/x/../api/mold-requests/design-file?"+query,RouteRules.ORIGIN+"//api/mold-requests/design-file?"+query,RouteRules.ORIGIN+"/api/mold-requests?"+query,
            RouteRules.ORIGIN+"/api/export?"+query,RouteRules.ORIGIN+"/?"+query,
            "javascript:alert(1)","file:///data/data/org.yourrest.crm/cache/design-files/x","content://org.yourrest.crm.designfiles/x/y","data:text/html,x","intent://x#Intent;end",
            "blob:https://crm.yourrest.org/123",LINK+"?"+"x".repeat(4100),LINK+"?a b"};
        for(String url:refused)check(DesignFileRules.fetchUrl(url)==null,"Not a design-file link: "+url);

        // ---- 2. «عرض» or «تنزيل»
        check(DesignFileRules.inline(LINK+"?"+query+"&inline=1"),"inline=1 last");
        check(DesignFileRules.inline(LINK+"?inline=1&"+query),"inline=1 first");
        check(DesignFileRules.inline(LINK+"?%69nline=%31&"+query),"Encoded inline=1, as the server decodes it");
        for(String q:new String[]{query,query+"&inline=0",query+"&inline=0&inline=1",query+"&inline=",query+"&inline",query+"&xinline=1",query+"&inline=1x",query+"&inline=%zz","inline=%"})
            check(!DesignFileRules.inline(LINK+"?"+q),"Not inline (the first inline parameter decides): "+q);
        check(!DesignFileRules.inline(null)&&!DesignFileRules.inline(LINK),"No query, no inline");
        check(DesignFileRules.view(true,LINK+"?"+query),"A main-frame navigation to the link is «عرض»");
        check(DesignFileRules.view(false,LINK+"?"+query+"&inline=1"),"A download of an inline link is «عرض»");
        check(!DesignFileRules.view(false,LINK+"?"+query),"The download link is «تنزيل»");
        // Another app receives a file only after a tap; the save picker is itself the person's choice.
        check(!DesignFileRules.confirmView(true,true),"«عرض» tapped opens without a question");
        check(DesignFileRules.confirmView(true,false),"«عرض» without a tap (a script, a redirect, a download that asks to open) asks first");
        check(!DesignFileRules.confirmView(false,false)&&!DesignFileRules.confirmView(false,true),"«تنزيل» needs no question: the save picker is the choice");

        // ---- 3. the file's name from Content-Disposition
        String arabic="قالب علبة ٢٥٠ مل.pdf";
        check(arabic.equals(name("inline; filename*=UTF-8''"+serverEncoded(arabic))),"The CRM's own Arabic name (filename*, UTF-8)");
        check(arabic.equals(name("attachment; filename*=UTF-8''"+serverEncoded(arabic))),"The same name on a download");
        check("drawing (v2) it's.dwg".equals(name("attachment; filename*=UTF-8''"+serverEncoded("drawing (v2) it's.dwg"))),"Escaped ' ( ) in filename*");
        check("drawing v2.dwg".equals(name("attachment; filename*=UTF-8''drawing%20v2.dwg")),"Percent-encoded space");
        check("plain.pdf".equals(name("attachment; filename=\"plain.pdf\"")),"Quoted filename");
        check("plain.pdf".equals(name("attachment; filename=plain.pdf")),"Token filename");
        check("plain.pdf".equals(name("attachment;filename=plain.pdf;size=10")),"Token filename before another parameter");
        check("x.pdf".equals(name("attachment; FILENAME=\"x.pdf\"")),"Parameter names in any case");
        check("ر.pdf".equals(name("attachment; filename=\"fallback.pdf\"; filename*=UTF-8''%D8%B1.pdf")),"filename* wins over filename");
        check("ر.pdf".equals(name("attachment; filename*=UTF-8''%D8%B1.pdf; filename=\"fallback.pdf\"")),"filename* wins in either order");
        check("ر.pdf".equals(name("attachment; filename*=utf-8'ar'%D8%B1.pdf")),"Charset in any case, with a language tag");
        check("£ rates.pdf".equals(name("attachment; filename*=iso-8859-1'en'%A3%20rates.pdf")),"ISO-8859-1 filename*");
        check("ok.pdf".equals(name("attachment; filename*=UTF-8''%E0%A4%A.pdf; filename=\"ok.pdf\"")),"A broken escape falls back to filename");
        check("ok.pdf".equals(name("attachment; filename*=UTF-8''%FF%FE.pdf; filename=\"ok.pdf\"")),"Broken UTF-8 falls back to filename");
        check("ok.pdf".equals(name("attachment; filename*=KOI8-R''abc.pdf; filename=\"ok.pdf\"")),"An unknown charset falls back to filename");
        check("ok.pdf".equals(name("attachment; filename*=UTF-8''a b.pdf; filename=\"ok.pdf\"")),"A raw space in filename* is malformed");
        check("ok.pdf".equals(name("attachment; filename*=UTF-8''%2E%2E; filename=\"ok.pdf\"")),"filename* that leaves nothing falls back to filename");
        check("a;b.pdf".equals(name("attachment; filename=\"a;b.pdf\"; filename*=bad")),"A semicolon inside quotes");
        check("a_b.pdf".equals(name("attachment; filename=\"a\\\"b.pdf\"")),"An escaped quote is not kept as a quote");
        check("%D8%B1.pdf".equals(name("attachment; filename=\"%D8%B1.pdf\"")),"A plain filename is not percent-decoded (RFC 6266)");
        // path tricks
        for(String header:new String[]{"attachment; filename=\"../../etc/passwd\"","attachment; filename*=UTF-8''..%2F..%2Fsecret.pdf","attachment; filename=\"..\\\\..\\\\x.pdf\"",
                "attachment; filename=\"/data/data/org.yourrest.crm/shared_prefs/native.xml\"","attachment; filename*=UTF-8''%2Fetc%2Fpasswd"}){
            String result=name(header);
            check(safe(result)&&!result.contains("/")&&!result.contains("\\")&&!result.startsWith("."),"A path is never a path: "+header+" -> "+result);
        }
        check("_.._secret.pdf".equals(name("attachment; filename*=UTF-8''..%2F..%2Fsecret.pdf")),"Separators become _ and leading dots go");
        check("htaccess".equals(name("attachment; filename=\".htaccess\"")),"No hidden file");
        check("a_b_c_d_e_f.pdf".equals(name("attachment; filename=\"a:b*c?d<e>f.pdf\"")),"Characters other file systems refuse become _");
        // control and direction characters
        check("ab.pdf".equals(name("attachment; filename*=UTF-8''a%00b%0D%0A.pdf")),"NUL, CR and LF are removed");
        check("fdp.exe".equals(name("attachment; filename*=UTF-8''%E2%80%AEfdp.exe")),"A right-to-left override is removed");
        check("ab.pdf".equals(name("attachment; filename*=UTF-8''a%E2%80%8F%E2%81%A6b%C2%85.pdf")),"Direction marks, isolates and C1 controls are removed");
        check("a b.pdf".equals(name("attachment; filename*=UTF-8''a%20%20%09%20b.pdf")),"Spaces collapse, a tab is removed");
        check("ab.pdf".equals(name("attachment; filename*=UTF-8''a%09b.pdf"))&&"ab.pdf".equals(DesignFileRules.sanitize("a\nb.pdf")),"A tab or line break is removed, not turned into a space");
        check("😀.png".equals(name("attachment; filename*=UTF-8''"+serverEncoded("😀.png"))),"A character outside the BMP is kept whole");
        check("a.pdf".equals(DesignFileRules.sanitize("a\uD800.pdf"))&&"a.pdf".equals(DesignFileRules.sanitize("\uDC00a.pdf")),"A lone surrogate is removed");
        // empty
        for(String header:new String[]{null,"","attachment","inline;","attachment; filename=\"\"","attachment; filename=\"...\"","attachment; filename=\"   \"","attachment; filename*=UTF-8''",
                "attachment; filename*=UTF-8''%00%01","attachment; filename","attachment; =x.pdf","attachment; filename=\"\u202E\""})
            check(DesignFileRules.FALLBACK_NAME.equals(name(header)),"Nothing usable falls back to design-file: "+header);
        // length, extension kept
        String longArabic="ق".repeat(300)+".pdf",longAscii="x".repeat(300)+".dwg",noExtension="ب".repeat(400);
        String cutArabic=name("attachment; filename*=UTF-8''"+serverEncoded(longArabic)),cutAscii=name("attachment; filename="+longAscii),cut=DesignFileRules.sanitize(noExtension);
        check(safe(cutArabic)&&cutArabic.endsWith(".pdf")&&cutArabic.startsWith("ققق"),"A long Arabic name is cut to the byte limit, keeping .pdf");
        check(safe(cutAscii)&&cutAscii.endsWith(".dwg")&&cutAscii.length()==DesignFileRules.NAME_MAX_BYTES,"A long name is cut to the limit, keeping .dwg");
        check(safe(cut)&&cut.getBytes(StandardCharsets.UTF_8).length==DesignFileRules.NAME_MAX_BYTES,"A long name without extension is cut on a character boundary");
        check(("😀".repeat(43)+".step").equals(DesignFileRules.sanitize("😀".repeat(100)+".step")),"A cut never splits a surrogate pair");
        check("x.pdf".equals(DesignFileRules.sanitize("x . .pdf"))&&"pdf".equals(DesignFileRules.sanitize(" . .pdf")),"Dots and spaces before the extension and at the start go");
        String edge="x".repeat(170)+" ."+"c".repeat(100),edgeOnce=DesignFileRules.sanitize(edge);
        check(edgeOnce.equals(DesignFileRules.sanitize(edgeOnce))&&safe(edgeOnce),"A cut that uncovers a short extension is already final");
        // properties hold for anything (fixed seed)
        Random random=new Random(1012);
        String alphabet="aZ09 ._-/\\:*?\"<>|\u0000\u0001\u001F\u007F\u0085\u00A0\u200E\u200F\u202A\u202E\u2066\u2069\u061C\uFEFFقالبٌ٢😀\t\r\n%'";
        int[] letters=alphabet.codePoints().toArray(),points=Arrays.copyOf(letters,letters.length+2);
        points[letters.length]=0xD800;points[letters.length+1]=0xDC00;
        boolean stable=true,clean=true;
        for(int round=0;round<20000;round++){
            StringBuilder raw=new StringBuilder();int length=random.nextInt(round%50==0?400:24);
            for(int i=0;i<length;i++)raw.appendCodePoint(points[random.nextInt(points.length)]);
            String once=DesignFileRules.sanitize(raw.toString());
            if(!once.isEmpty()&&!safe(once))clean=false;
            if(!once.equals(DesignFileRules.sanitize(once)))stable=false;
            String header=DesignFileRules.fileName("attachment; filename*=UTF-8''"+serverEncoded(raw.toString()));
            if(!safe(header))clean=false;
        }
        check(clean,"20,000 random names: never a separator, control, direction mark, leading dot, lone surrogate or more than the byte limit");
        check(stable,"20,000 random names: a safe name stays the same when made safe again (the provider relies on this)");

        // ---- 4. the size cap
        check(DesignFileRules.MAX_BYTES==26L*1024*1024,"The hard cap is 26 MiB");
        check(DesignFileRules.lengthAllowed(-1)&&DesignFileRules.lengthAllowed(0)&&DesignFileRules.lengthAllowed(DesignFileRules.MAX_BYTES),"An unknown, empty or capped length is allowed");
        check(!DesignFileRules.lengthAllowed(DesignFileRules.MAX_BYTES+1)&&!DesignFileRules.lengthAllowed(Long.MAX_VALUE),"A declared length over the cap is refused");
        byte[] payload=new byte[300_001];for(int i=0;i<payload.length;i++)payload[i]=(byte)(i*7);
        for(int chunk:new int[]{1,7,4096,65536,1<<20}){
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            long copied=DesignFileRules.copy(chunked(payload,chunk),out,payload.length,null,0);
            check(copied==payload.length&&Arrays.equals(payload,out.toByteArray()),"Every byte arrives in order (chunks of "+chunk+")");
        }
        ByteArrayOutputStream unknown=new ByteArrayOutputStream();
        check(DesignFileRules.copy(new ByteArrayInputStream(payload),unknown,-1,null,0)==payload.length&&Arrays.equals(payload,unknown.toByteArray()),"An answer without Content-Length is read whole");
        check(DesignFileRules.copy(new ByteArrayInputStream(new byte[0]),new ByteArrayOutputStream(),0,null,0)==0,"An empty file is an empty file");
        InputStream untouched=new InputStream(){@Override public int read()throws IOException{throw new IOException("read before the length was checked");}};
        check(DesignFileRules.TOO_LARGE.equals(failure(()->DesignFileRules.copy(untouched,SINK,DesignFileRules.MAX_BYTES+1,null,0))),"A declared length over the cap is refused before reading");
        check(DesignFileRules.TOO_LARGE.equals(failure(()->DesignFileRules.copy(zeros(DesignFileRules.MAX_BYTES+1),SINK,-1,null,0))),"An undeclared body over the cap is refused while reading");
        check(DesignFileRules.copy(zeros(DesignFileRules.MAX_BYTES),SINK,-1,null,0)==DesignFileRules.MAX_BYTES,"Exactly the cap is allowed");
        check(DesignFileRules.copy(zeros(DesignFileRules.MAX_BYTES),SINK,DesignFileRules.MAX_BYTES,null,0)==DesignFileRules.MAX_BYTES,"Exactly the cap, declared, is allowed");
        check(DesignFileRules.INCOMPLETE.equals(failure(()->DesignFileRules.copy(new ByteArrayInputStream(new byte[11]),SINK,10,null,0))),"More than declared is refused");
        check(DesignFileRules.INCOMPLETE.equals(failure(()->DesignFileRules.copy(new ByteArrayInputStream(new byte[9]),SINK,10,null,0))),"A cut-off answer is not a file");
        InputStream lost=new InputStream(){int n;@Override public int read()throws IOException{if(n++>100)throw new IOException("reset");return 1;}};
        Exception network=thrown(()->DesignFileRules.copy(lost,SINK,1000,null,0));
        check(network instanceof IOException&&!(network instanceof DesignFileRules.Failure),"A lost connection is a network failure");
        OutputStream full=new OutputStream(){@Override public void write(int b)throws IOException{throw new IOException("ENOSPC");}@Override public void write(byte[] b,int off,int len)throws IOException{throw new IOException("ENOSPC");}};
        check(DesignFileRules.STORAGE.equals(failure(()->DesignFileRules.copy(new ByteArrayInputStream(payload),full,payload.length,null,0))),"A full phone is a storage failure, not the network");
        Exception cancelled=thrown(()->DesignFileRules.copy(new ByteArrayInputStream(payload),SINK,payload.length,()->true,0));
        check(cancelled instanceof DesignFileRules.Failure&&((DesignFileRules.Failure)cancelled).cancelled,"Cancelling stops the transfer without words");
        int[] reads={0};
        Exception late=thrown(()->DesignFileRules.copy(chunked(payload,1000),SINK,payload.length,()->++reads[0]>3,0));
        check(late instanceof DesignFileRules.Failure&&((DesignFileRules.Failure)late).cancelled,"Cancelling during the transfer stops it");
        check(DesignFileRules.TIMEOUT.equals(failure(()->DesignFileRules.copy(new ByteArrayInputStream(payload),SINK,payload.length,null,System.nanoTime()-1))),"The overall deadline ends a slow transfer");
        check(DesignFileRules.READ_TIMEOUT_MS>120_000&&DesignFileRules.CONNECT_TIMEOUT_MS>0&&DesignFileRules.TOTAL_MS>=DesignFileRules.READ_TIMEOUT_MS,"Timeouts allow production's 120 seconds");

        // ---- 5. what the person reads when the CRM did not send the file
        check(DesignFileRules.SESSION_ENDED.equals(DesignFileRules.errorMessage(401,null))&&DesignFileRules.SESSION_ENDED.equals(DesignFileRules.errorMessage(401,"{\"error\":\"سجّل الدخول للوصول إلى التطبيق.\"}")),"401 is always the ended session");
        check("انتهت جلسة الدخول؛ سجّل الدخول مرة أخرى".equals(DesignFileRules.SESSION_ENDED),"The session wording");
        check("الملف غير متاح".equals(DesignFileRules.errorMessage(404,"{\"error\":\"الملف غير متاح\"}")),"The CRM's Arabic error");
        check("تنزيل الملفات مشغول مؤقتًا. أعد المحاولة بعد لحظات.".equals(DesignFileRules.errorMessage(429," {\n \"error\" : \"تنزيل الملفات مشغول مؤقتًا. أعد المحاولة بعد لحظات.\" } ")),"Whitespace around JSON");
        check("a\"b\\c/م".equals(DesignFileRules.errorMessage(403,"{\"error\":\"a\\\"b\\\\c\\/\\u0645\"}")),"JSON escapes are decoded");
        check("خطأ".equals(DesignFileRules.errorMessage(502,"{\"code\":1,\"ok\":false,\"n\":null,\"details\":{\"x\":[1,{\"y\":\"}\"}],\"z\":\"{\"},\"error\":\"خطأ\"}")),"Other fields before the error are skipped");
        check("خطأ في الإنتاج".equals(DesignFileRules.errorMessage(502,"{\"error\":\"خطأ\\nفي\\t\\u202Eالإنتاج\"}")),"Server text is shown on one line without direction overrides");
        check(DesignFileRules.errorMessage(500,"{\"error\":\""+"خ".repeat(1000)+"\"}").length()==300,"Server text is bounded");
        for(String body:new String[]{null,"","<!doctype html><title>تعذّر فتح الملف</title>","not json","{\"message\":\"x\"}","{\"error\":5}","{\"error\":null}","{\"error\":\"\"}","{\"error\":\"  \\n \"}",
                "{\"error\":\"unterminated","[\"error\",\"x\"]","{\"error\" \"x\"}","{\"error\":\"bad \\x escape\"}","{\"error\":\"\\u12\"}","{\"a\":tru","{}","{\"a\":1 \"error\":\"x\"}"})
            check(DesignFileRules.FAILED.equals(DesignFileRules.errorMessage(500,body)),"Without a usable JSON error, the general message: "+body);
        check("تعذّر تنزيل الملف؛ تحقق من الاتصال".equals(DesignFileRules.NETWORK),"The network wording");
        check(DesignFileRules.readBounded(null,10)==null,"No error body");
        check("{\"error\":\"م\"}".equals(DesignFileRules.readBounded(new ByteArrayInputStream("{\"error\":\"م\"}".getBytes(StandardCharsets.UTF_8)),64)),"An error body is read as UTF-8");
        check(DesignFileRules.readBounded(zeros(70_000),DesignFileRules.ERROR_MAX_BYTES)==null,"An error body is bounded");
        check(DesignFileRules.readBounded(new InputStream(){@Override public int read()throws IOException{throw new IOException("reset");}},64)==null,"A broken error body is no body");

        // ---- 6. types
        check("application/pdf".equals(DesignFileRules.mimeType("application/pdf"))&&"image/png".equals(DesignFileRules.mimeType("image/png; charset=binary"))&&"image/jpeg".equals(DesignFileRules.mimeType(" IMAGE/JPEG ")),"The answer's type, without parameters");
        for(String odd:new String[]{null,"","text","a/b/c","text/html<script>","*/*","image/*","/png"})check("application/octet-stream".equals(DesignFileRules.mimeType(odd)),"A missing or odd type is plain bytes: "+odd);
        // Only the types the CRM serves (moldDesignContentType: PDF and its four image types) reach another app or the save picker: a
        // well-formed APK type would otherwise hand an unpinned package to the system installer under Yourrest's install permission.
        check("image/gif".equals(DesignFileRules.mimeType("image/gif"))&&"image/webp".equals(DesignFileRules.mimeType("image/webp; q=1")),"The CRM's GIF and WEBP types");
        for(String dangerous:new String[]{"application/vnd.android.package-archive","APPLICATION/VND.ANDROID.PACKAGE-ARCHIVE; charset=binary","text/html","text/html; charset=utf-8",
                "application/xhtml+xml","image/svg+xml","text/javascript","application/javascript","application/x-msdownload","application/java-archive","application/zip",
                "application/x-shockwave-flash","text/plain","text/vcard","application/vnd.ms-excel","image/jpg","image/x-icon","image/heic","application/pdfx","application/pdf+zip","image/pngx"})
            check("application/octet-stream".equals(DesignFileRules.mimeType(dangerous)),"A type the CRM never serves is plain bytes: "+dangerous);
        check(new TreeSet<>(DesignFileRules.SERVED_TYPES).equals(new TreeSet<>(Arrays.asList("application/pdf","image/png","image/jpeg","image/gif","image/webp"))),"Exactly PDF and four image types");
        for(String served:DesignFileRules.SERVED_TYPES)check(served.equals(DesignFileRules.mimeType(served))&&served.equals(DesignFileRules.mimeType(served.toUpperCase()+"; x=1")),"A served type is kept: "+served);
        check(!DesignFileRules.SERVED_TYPES.contains("application/vnd.android.package-archive"),"Never the package installer's type");
        check("application/pdf".equals(DesignFileRules.typeForName("x.PDF"))&&"image/jpeg".equals(DesignFileRules.typeForName("x.jpeg"))&&"application/octet-stream".equals(DesignFileRules.typeForName("x.dwg"))&&"application/octet-stream".equals(DesignFileRules.typeForName(null)),"The provider's type by name");

        // ---- 7. the provider serves root/<random folder>/<safe name> only
        Path root=Files.createTempDirectory("design-files-check");
        // Android's file system names are UTF-8; a JVM started without a UTF-8 locale cannot create the Arabic name, so it stores an
        // ASCII one (the Arabic name itself is exercised above).
        String stored=java.nio.charset.Charset.forName(System.getProperty("sun.jnu.encoding","UTF-8")).newEncoder().canEncode(arabic)?arabic:"mold-250ml.pdf";
        try{
            String folder="0f8fad5b-d9cb-469f-a165-70867728950e",other="7c9e6679-7425-40de-944b-e07fc1f90ae7";
            Path dir=Files.createDirectories(root.resolve(folder));Files.createDirectories(root.resolve(other));
            Path pdf=Files.write(dir.resolve(stored),new byte[]{1,2,3});
            File served=DesignFileRules.servable(root.toFile(),Arrays.asList(folder,stored));
            check(served!=null&&served.toPath().equals(pdf.toRealPath()),"A fetched file is served");
            Files.write(root.resolve("secret.txt"),new byte[]{9});
            Path outside=Files.createTempDirectory("design-files-outside");
            try{
                Files.write(outside.resolve("token.txt"),new byte[]{9});
                List<List<String>> refusedPaths=Arrays.asList(null,Collections.emptyList(),Collections.singletonList(folder),Arrays.asList(folder,stored,"x"),
                    Arrays.asList("..",stored),Arrays.asList(folder,".."),Arrays.asList(folder,"."),Arrays.asList(folder,"../secret.txt"),Arrays.asList(folder,"../../etc/passwd"),
                    Arrays.asList(folder,"..\\secret.txt"),Arrays.asList(folder,"/etc/passwd"),Arrays.asList(folder,""),Arrays.asList(folder,null),Arrays.asList(null,stored),
                    Arrays.asList(folder.toUpperCase(),stored),Arrays.asList("design",stored),Arrays.asList(".",stored),Arrays.asList(other,stored),Arrays.asList(folder,"missing.pdf"),
                    Arrays.asList(folder,".hidden"),Arrays.asList(folder,stored+"\u0000"),Arrays.asList(folder,stored+"/"),Arrays.asList(folder,"a\u202Eb.pdf"));
                for(List<String> segments:refusedPaths)check(DesignFileRules.servable(root.toFile(),segments)==null,"Not served: "+segments);
                Files.createDirectories(dir.resolve("inner"));
                check(DesignFileRules.servable(root.toFile(),Arrays.asList(folder,"inner"))==null,"A folder is not a file");
                boolean links=true;
                try{Files.createSymbolicLink(dir.resolve("link.txt"),outside.resolve("token.txt"));}catch(UnsupportedOperationException|IOException noLinks){links=false;}
                if(links){
                    check(DesignFileRules.servable(root.toFile(),Arrays.asList(folder,"link.txt"))==null,"A link that leaves the folder is not followed");
                    String linkedFolder="1b4e28ba-2fa1-11d2-883f-0016d3cca427";
                    Files.createSymbolicLink(root.resolve(linkedFolder),outside);
                    check(DesignFileRules.servable(root.toFile(),Arrays.asList(linkedFolder,"token.txt"))==null,"A linked folder that leaves the cache is not followed");
                    // Same folder and file names, but the folder really lives outside the cache.
                    String twin="9b2f6c1e-3d4a-4f5b-8c7d-0e1f2a3b4c5d";
                    Files.write(Files.createDirectories(outside.resolve(twin)).resolve("same.pdf"),new byte[]{7});
                    Files.createSymbolicLink(root.resolve(twin),outside.resolve(twin));
                    check(DesignFileRules.servable(root.toFile(),Arrays.asList(twin,"same.pdf"))==null,"A folder that resolves outside the cache is refused even with matching names");
                    String alias="5d41402a-bc4b-4a76-b971-9d911017c592";
                    Files.createSymbolicLink(root.resolve(alias),root.resolve(folder));
                    check(DesignFileRules.servable(root.toFile(),Arrays.asList(alias,stored))==null,"A folder that is another folder's alias is refused");
                    Files.createSymbolicLink(dir.resolve("sibling.pdf"),dir.resolve(stored));
                    check(DesignFileRules.servable(root.toFile(),Arrays.asList(folder,"sibling.pdf"))==null,"A file that is another file's alias is refused");
                }else check(true,"Symbolic links unavailable here (counted, not exercised)");
            }finally{try(java.util.stream.Stream<Path> walk=Files.walk(outside)){walk.sorted(Collections.reverseOrder()).forEach(p->p.toFile().delete());}}
            check(DesignFileRules.servable(null,Arrays.asList(folder,stored))==null,"No root, nothing served");
        }finally{try(java.util.stream.Stream<Path> walk=Files.walk(root)){walk.sorted(Collections.reverseOrder()).forEach(p->p.toFile().delete());}}
        check(DesignFileRules.readOnly("r"),"Reading is offered");
        for(String mode:new String[]{"w","wt","wa","rw","rwt","",null,"R"," r"})check(!DesignFileRules.readOnly(mode),"No writing: "+mode);
        // The save picker's document: truncated on write ("w" alone keeps an overwritten file's tail from Android 10), removed after a
        // failure only when this save created it.
        check(DesignFileRules.SAVE_MODES.equals(Arrays.asList("wt","w")),"\"wt\" first, \"w\" only as the fallback");
        for(String mode:DesignFileRules.SAVE_MODES)check(!DesignFileRules.readOnly(mode),"A save mode writes: "+mode);
        check(DesignFileRules.createdBySave(0L),"An empty document (new from the picker) is this save's own");
        for(Long size:new Long[]{null,1L,5L*1024*1024,-1L})check(!DesignFileRules.createdBySave(size),"Never deleted: a file the person overwrites, or one of unknown size: "+size);
        check(DesignFileRules.folderName("0f8fad5b-d9cb-469f-a165-70867728950e")&&!DesignFileRules.folderName("../x")&&!DesignFileRules.folderName(null),"Folder names are random UUIDs");
        long now=1_800_000_000_000L,day=24*3600_000L;
        check(!DesignFileRules.expired(now-day+1,now)&&DesignFileRules.expired(now-day,now)&&DesignFileRules.expired(now-30*day,now),"Copies older than a day are removed");
        check(!DesignFileRules.expired(now+60_000,now)&&DesignFileRules.expired(now+day,now),"A copy dated a day ahead (clock change) is removed too");

        // ---- 8. source and manifest guards
        Path source=Path.of(args.length>0?args[0]:"mobile/android/app/src/main/java/org/yourrest/crm");
        String activity=Files.readString(source.resolve("MainActivity.java")),files=Files.readString(source.resolve("DesignFiles.java")),provider=Files.readString(source.resolve("DesignFileProvider.java"));
        String navigation=TripStartCheck.block(activity,"public boolean shouldOverrideUrlLoading(");
        int intercept=navigation.indexOf("if(request.isForMainFrame()&&DesignFileRules.fetchUrl(url)!=null&&RouteRules.trusted(view.getUrl())){openDesignFile(url,true,request.hasGesture());return true;}"),trusted=navigation.indexOf("if(RouteRules.trusted(url))return false;");
        check(intercept>=0&&trusted>intercept,"«عرض» is taken before trusted pages load in the WebView, so the page stays; WebView's gesture flag goes with it");
        String downloads=TripStartCheck.block(activity,"web.setDownloadListener(");
        int take=downloads.indexOf("if(DesignFileRules.fetchUrl(url)!=null&&web!=null&&RouteRules.trusted(web.getUrl())){openDesignFile(url,false,false);return;}"),browser=downloads.indexOf("فتح رابط التنزيل في المتصفح؟");
        check(take>=0&&browser>take,"«تنزيل» of a design file is taken before the browser dialog, which stays for every other download");
        check(downloads.contains("لتنزيل الملف استخدم صفحة CRM في المتصفح."),"Other downloads keep today's behaviour");
        String open=TripStartCheck.block(activity,"private void openDesignFile("),start=TripStartCheck.block(activity,"private void startDesignFile(");
        check(start.contains("if(designTask!=null)")&&start.contains("DesignFiles.fetch(getApplicationContext(),task,web.getSettings().getUserAgentString()"),"One at a time, with the app's user agent");
        int ask=open.indexOf("if(DesignFileRules.confirmView(view,gesture)){"),direct=open.lastIndexOf("startDesignFile(target,view);");
        check(open.contains("boolean view=DesignFileRules.view(navigation,target);")&&ask>=0&&direct>ask&&open.indexOf("return;",ask)<direct,"«عرض» without a tap asks before anything is fetched or opened");
        check(open.contains("\"فتح\",(dialog,which)->{designConfirm=null;if(web!=null&&RouteRules.trusted(web.getUrl()))startDesignFile(target,true);}")&&open.contains("if(designConfirm!=null&&designConfirm.isShowing())return;"),"Only the person's «فتح» starts it; one question at a time");
        Matcher starts=Pattern.compile("startDesignFile\\(").matcher(activity);int startCalls=0;while(starts.find())startCalls++;
        check(startCalls==3,"startDesignFile is reached only from openDesignFile (directly or through the question): "+startCalls);
        Matcher opens=Pattern.compile("(?<!void )openDesignFile\\(([^;]*)\\);").matcher(activity);Set<String> openCalls=new TreeSet<>();while(opens.find())openCalls.add(opens.group(1));
        check(openCalls.equals(new TreeSet<>(Arrays.asList("url,true,request.hasGesture()","url,false,false","input.optString(\"href\"),false,false"))),"Only a navigation passes a gesture, and only WebView's own flag: "+openCalls);
        String fetched=TripStartCheck.block(activity,"private void designFetched(");
        check(fetched.contains("Intent.ACTION_VIEW")&&fetched.contains("DesignFiles.uri(fetched)")&&fetched.contains("fetched.mime")&&fetched.contains("Intent.FLAG_GRANT_READ_URI_PERMISSION"),"«عرض»: a content URI with the answer's type and a read grant");
        check(fetched.contains("ActivityNotFoundException")&&fetched.contains("\"حفظ\"")&&fetched.contains("saveDesignFile(task,fetched)"),"No app to open it: say so and offer «حفظ»");
        check(fetched.contains("if(!MainActivity.resumed){designHeld=fetched;designDelivery="),"Another app is opened only while Yourrest is in front");
        String finished=TripStartCheck.block(activity,"private void designFinished(");
        check(finished.contains("if(task!=designTask)return;")&&finished.contains("DesignFiles.discard(designHeld);designHeld=null;"),"A held file that will not be opened is removed at once; a stale finish never ends a newer transfer");
        check(TripStartCheck.block(activity,"protected void onResume(").contains("designDelivery=null;designHeld=null;delivery.run();"),"A delivered file is not removed under the viewer");
        String save=TripStartCheck.block(activity,"private void saveDesignFile(");
        check(save.contains("Intent.ACTION_CREATE_DOCUMENT")&&save.contains("Intent.EXTRA_TITLE,fetched.name")&&save.contains("setType(fetched.mime)")&&save.contains("startActivityForResult(create,DESIGN_SAVE)"),"«تنزيل»: the system save picker with the name and type");
        String saved=TripStartCheck.block(activity,"private void designSaved(");
        check(saved.contains("result==RESULT_OK")&&saved.contains("DesignFiles.discard(fetched)")&&saved.contains("\"تم حفظ الملف\""),"Cancelling saves nothing; a saved file is confirmed");
        int pickerCancelled=saved.indexOf("if(target==null||!\"content\".equals(target.getScheme()))"),lostCopy=saved.indexOf("if(fetched==null){designFinished(task);DesignFiles.abandon(getApplicationContext(),target,");
        check(pickerCancelled>=0&&lostCopy>pickerCancelled&&saved.contains("DesignFiles.SAVE_LOST"),"A picker answer whose copy was lost removes the empty document and tells the person");
        // The copy waiting for the picker survives a recreated activity (uiMode, locale, split screen, process death).
        check(TripStartCheck.block(activity,"protected void onSaveInstanceState(").contains("if(designSave!=null){out.putString(SAVE_FOLDER,designSave.file.getParentFile().getName());out.putString(SAVE_NAME,designSave.file.getName());out.putString(SAVE_TYPE,designSave.mime);}"),"The pending save is kept in the saved state");
        check(TripStartCheck.block(activity,"public void onCreate(").contains("if(saved!=null)designSave=DesignFiles.restore(getApplicationContext(),saved.getString(SAVE_FOLDER),saved.getString(SAVE_NAME),saved.getString(SAVE_TYPE));"),"A recreated activity takes the pending save back");
        String restore=TripStartCheck.block(files,"static Fetched restore(");
        check(restore.contains("DesignFileRules.servable(root(app),Arrays.asList(folder,name))")&&restore.contains("DesignFileRules.mimeType(mime)"),"Only a file of the private cache comes back, with a served type");
        String destroy=TripStartCheck.block(activity,"protected void onDestroy(");
        check(destroy.contains("if(isFinishing())DesignFiles.discard(designSave);designSave=null;")&&!destroy.replace("if(isFinishing())DesignFiles.discard(designSave);","").contains("DesignFiles.discard(designSave)"),"The pending save's copy is dropped only when the app really closes");
        String saving=TripStartCheck.block(files,"static void save(");
        int sized=saving.indexOf("boolean created=DesignFileRules.createdBySave(size(resolver,target));"),opened=saving.indexOf("OutputStream output=open(resolver,target)");
        check(sized>=0&&opened>sized,"Whether this save created the document is read before writing");
        check(saving.contains("if(created)try{DocumentsContract.deleteDocument(resolver,target);}")&&!saving.replace("if(created)try{DocumentsContract.deleteDocument","").contains("deleteDocument"),"Only a document this save created is removed after a failure");
        check(!files.contains("openOutputStream(target,\"w\")")&&TripStartCheck.block(files,"private static OutputStream open(").contains("for(String mode:DesignFileRules.SAVE_MODES)"),"The document is opened \"wt\" (truncating), \"w\" only as the fallback");
        check(TripStartCheck.block(files,"static void abandon(").contains("if(DesignFileRules.createdBySave(size(resolver,target)))"),"A lost save removes only an empty document");
        // «تنزيل» tapped in a loaded page reaches the app at once: WebView's own download drops a failed answer without a word.
        String bridge=TripStartCheck.block(activity,"private void installBridge(");
        check(bridge.contains("document.addEventListener('click',")&&bridge.contains("closest('a[download][href]')")&&bridge.contains("url.pathname!==\"+JSONObject.quote(DesignFileRules.PATH)+\"")
            &&bridge.contains("url.origin!==\"+JSONObject.quote(RouteRules.ORIGIN)+\"")&&bridge.contains("event.preventDefault();window.__yourrestNative.request('designFile',{href:url.href})")&&bridge.contains("if(!window.__yourrestDesignFiles){window.__yourrestDesignFiles=true;"),
            "The injected page script hands a design file's «تنزيل» tap to the app, once per document, and nothing else");
        check(bridge.indexOf("event.preventDefault()")>bridge.indexOf("||!window.__yourrestNative)return;"),"Without the bridge the link keeps WebView's download (the listener fallback)");
        String request=TripStartCheck.block(activity,"public void request(String nonce,String id,String method,String raw)");
        check(request.contains("case \"designFile\":")&&request.contains("if(DesignFileRules.fetchUrl(input.optString(\"href\"))==null)")&&request.indexOf("case \"designFile\":")>request.indexOf("if(pageNonce.isEmpty()||!pageNonce.equals(nonce)||!RouteRules.trusted(web.getUrl()))return;"),
            "The bridge takes only a design-file link, behind the page nonce and the trusted page");
        check(TripStartCheck.block(activity,"protected void onActivityResult(").contains("if(request==DESIGN_SAVE){designSaved(result,data);return;}"),"The save picker's answer is handled");
        check(TripStartCheck.block(activity,"public void onCreate(").contains("DesignFiles.cleanup(getApplicationContext())"),"Old copies are removed when the app starts");
        check(TripStartCheck.block(activity,"protected void onDestroy(").contains("designTask.cancel()"),"Closing the app stops a transfer");
        String fetch=TripStartCheck.block(files,"static void fetch(");
        check(fetch.contains("worker.execute(")&&files.contains("Executors.newSingleThreadExecutor()"),"Off the UI thread, one at a time");
        check(fetch.contains("CookieManager.getInstance().getCookie(RouteRules.ORIGIN)")&&fetch.contains("setRequestProperty(\"Cookie\",cookie)"),"The WebView session for the origin, as RouteApi does");
        check(fetch.contains("DesignFileRules.fetchUrl(task.url)")&&fetch.contains("(HttpsURLConnection)new URL(url).openConnection()"),"Only the fixed-origin link, over HTTPS");
        check(fetch.contains("setInstanceFollowRedirects(false)"),"No redirect is followed with the session");
        check(fetch.contains("setReadTimeout(DesignFileRules.READ_TIMEOUT_MS)")&&fetch.contains("setConnectTimeout(DesignFileRules.CONNECT_TIMEOUT_MS)"),"Timeouts set");
        check(fetch.contains("setRequestProperty(\"User-Agent\",userAgent)"),"The app's user agent");
        check(fetch.indexOf("DesignFileRules.lengthAllowed(declared)")>=0&&fetch.indexOf("DesignFileRules.lengthAllowed(declared)")<fetch.indexOf("getInputStream()")&&fetch.contains("DesignFileRules.copy(input,output,declared"),"The cap is checked on Content-Length and while reading");
        check(fetch.contains("if(status!=200)")&&fetch.contains("DesignFileRules.errorMessage(status,"),"Only 200 is a file; other answers are worded");
        check(fetch.contains("DesignFileRules.NETWORK")&&fetch.contains("remove(folder)"),"A network failure is worded and leaves no partial file");
        for(String text:new String[]{activity,files,provider}){
            check(!text.contains("Log.")&&!text.contains("printStackTrace")&&!text.contains("System.out"),"Nothing is logged");
            check(!text.contains("android.app.DownloadManager")&&!text.contains("DOWNLOAD_SERVICE")&&!text.contains("DownloadManager.Request"),"The system DownloadManager never gets the session");
        }
        int cookieUses=0;
        for(String line:files.split("\n")){String code=line.trim();if(code.startsWith("//")||code.startsWith("/*")||code.startsWith("*"))continue;Matcher uses=Pattern.compile("\\bcookie\\b").matcher(code);while(uses.find())cookieUses++;}
        check(cookieUses==4&&!files.contains("putExtra")&&!files.contains("evaluateJavascript"),"The cookie is read, checked and sent on the request only: never put in an intent or the page");
        check(provider.contains("DesignFileRules.servable(DesignFiles.root(context),uri.getPathSegments())")&&provider.contains("DesignFileRules.readOnly(mode)")&&provider.contains("MODE_READ_ONLY"),"The provider serves only the cache folder, read only");
        check(provider.contains("public Uri insert(")&&TripStartCheck.block(provider,"public Uri insert(").contains("UnsupportedOperationException")&&TripStartCheck.block(provider,"public int delete(").contains("UnsupportedOperationException"),"The provider cannot be written");
        Matcher authority=Pattern.compile("AUTHORITY=\"([^\"]+)\"").matcher(provider);
        check(authority.find()&&"org.yourrest.crm.designfiles".equals(authority.group(1)),"The provider's authority");
        check(files.contains("new File(context.getCacheDir(),\"design-files\")"),"The private cache folder");

        Path manifestPath=source.resolve("../../../../AndroidManifest.xml");
        org.w3c.dom.Document manifest=DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(manifestPath.toFile());
        NodeList providers=manifest.getElementsByTagName("provider");
        check(providers.getLength()==1,"One provider, well-formed manifest");
        Element declared=(Element)providers.item(0);
        String auth=declared.getAttribute("android:authorities");
        check(".DesignFileProvider".equals(declared.getAttribute("android:name"))&&authority.group(1).equals(auth),"The manifest names the provider with the same literal authority");
        check(!auth.contains("${"),"No manifest placeholder: tools/build-oss.py links the manifest as written");
        check("false".equals(declared.getAttribute("android:exported"))&&"true".equals(declared.getAttribute("android:grantUriPermissions")),"Not exported; per-URI grants only");
        check(declared.getParentNode().getNodeName().equals("application"),"Declared inside <application>");
        Set<String> permissions=new TreeSet<>();NodeList uses2=manifest.getElementsByTagName("uses-permission");
        for(int i=0;i<uses2.getLength();i++)permissions.add(((Element)uses2.item(i)).getAttribute("android:name"));
        check(permissions.equals(new TreeSet<>(Arrays.asList("android.permission.INTERNET","android.permission.ACCESS_NETWORK_STATE","android.permission.ACCESS_COARSE_LOCATION","android.permission.ACCESS_FINE_LOCATION",
            "android.permission.ACCESS_BACKGROUND_LOCATION","android.permission.RECEIVE_BOOT_COMPLETED","android.permission.FOREGROUND_SERVICE","android.permission.FOREGROUND_SERVICE_LOCATION",
            "android.permission.POST_NOTIFICATIONS","android.permission.REQUEST_INSTALL_PACKAGES"))),"No new Android permission (no storage permission at all)");
        // The release that brought design files (1.0.12, versionCode 13) or a later one: the guard follows the feature, not one release.
        String gradle=Files.readString(source.resolve("../../../../../../build.gradle"));
        Matcher code=Pattern.compile("versionCode (\\d+)").matcher(gradle),version=Pattern.compile("versionName '1\\.0\\.(\\d+)'").matcher(gradle);
        check(code.find()&&Integer.parseInt(code.group(1))>=13&&version.find()&&Integer.parseInt(version.group(1))>=12&&gradle.contains("minSdk 26"),"1.0.12 (versionCode 13) or later, minSdk 26");
        String readme=Files.readString(source.resolve("../../../../../../../README.md"));
        check(readme.startsWith("# Yourrest CRM Android 1.0."+version.group(1)+" (versionCode "+code.group(1)+")\n")&&readme.contains("## Design files in 1.0.12"),"README names the built release and describes design files");
        // Every type the app passes on is one the CRM itself serves (portable/mold-rules.mjs), when that file is beside the app.
        Path rules=source.resolve("../../../../../../../../../portable/mold-rules.mjs");
        if(Files.isRegularFile(rules)){String served=Files.readString(rules);for(String type:DesignFileRules.SERVED_TYPES)check(served.contains("'"+type+"'"),"The CRM serves "+type);}
        else check(true,"portable/mold-rules.mjs not beside this source (counted, not compared)");
        System.out.println("Native design files: "+checks+" checks passed (actual link, name, size, error and path-guard rules; source and manifest guards; no phone, network, viewer or save picker verification)");
    }
}

package org.yourrest.crm;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

/** Executes the file picker's accept-list rules (1.0.12) plus source guards on how MainActivity uses them. No device picker is run. */
public final class FileChooserCheck {
    static int checks;
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    static final String[] DEFAULT={"image/*","application/pdf","text/csv","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel"};
    static final String XLSX="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    static boolean same(String[] actual,String... expected){return actual!=null&&Arrays.equals(actual,expected);}
    public static void main(String[] args)throws Exception{
        // ---- an input that names no types keeps the picker every input had before 1.0.12
        check(same(FileChooserRules.mimeTypes(null),DEFAULT),"No accept list keeps the old default");
        check(same(FileChooserRules.mimeTypes(new String[0]),DEFAULT),"An empty accept list keeps the old default");
        check(same(FileChooserRules.mimeTypes(new String[]{""}),DEFAULT),"WebView's single empty entry keeps the old default");
        check(same(FileChooserRules.mimeTypes(new String[]{" ","",null}),DEFAULT),"Blank and null entries keep the old default");
        check(same(FileChooserRules.mimeTypes(new String[]{" , ,"}),DEFAULT),"Only separators keeps the old default");
        String[] first=FileChooserRules.mimeTypes(null);first[0]="evil/*";
        check(same(FileChooserRules.mimeTypes(null),DEFAULT),"The default list cannot be changed through a returned array");

        // ---- MIME types are kept (lower case, trimmed)
        check(same(FileChooserRules.mimeTypes(new String[]{"image/*"}),"image/*"),"An image input offers images only");
        check(same(FileChooserRules.mimeTypes(new String[]{" IMAGE/PNG "}),"image/png"),"A MIME type is normalised");
        check(same(FileChooserRules.mimeTypes(new String[]{"application/pdf","image/*"}),"application/pdf","image/*"),"Several MIME types keep their order");
        check(same(FileChooserRules.mimeTypes(new String[]{"application/pdf","application/pdf"}),"application/pdf"),"Duplicates are dropped");
        check(same(FileChooserRules.mimeTypes(new String[]{"image/svg+xml"}),"image/svg+xml"),"A MIME type with + is kept");
        check(same(FileChooserRules.mimeTypes(new String[]{"video/*,audio/*"}),"video/*","audio/*"),"Wildcard subtypes are kept");

        // ---- known extensions map to MIME types
        check(same(FileChooserRules.mimeTypes(new String[]{".pdf"}),"application/pdf"),"pdf");
        check(same(FileChooserRules.mimeTypes(new String[]{"pdf"}),"application/pdf"),"A bare extension is understood");
        check(same(FileChooserRules.mimeTypes(new String[]{".PNG"}),"image/png"),"png (any case)");
        check(same(FileChooserRules.mimeTypes(new String[]{".jpg",".jpeg"}),"image/jpeg"),"jpg and jpeg are one type");
        check(same(FileChooserRules.mimeTypes(new String[]{".webp"}),"image/webp"),"webp");
        check(same(FileChooserRules.mimeTypes(new String[]{".gif"}),"image/gif"),"gif");
        check(same(FileChooserRules.mimeTypes(new String[]{".svg"}),"image/svg+xml"),"svg");
        check(same(FileChooserRules.mimeTypes(new String[]{".zip"}),"application/zip"),"zip");
        check(same(FileChooserRules.mimeTypes(new String[]{".xlsx"}),XLSX),"xlsx");
        check(same(FileChooserRules.mimeTypes(new String[]{".xls"}),"application/vnd.ms-excel"),"xls");
        check(same(FileChooserRules.mimeTypes(new String[]{".csv"}),"text/csv","text/comma-separated-values"),"csv under both names Android uses");
        // The site's real inputs
        check(same(FileChooserRules.mimeTypes(new String[]{".pdf,.jpg,.jpeg,.png,.webp"}),"application/pdf","image/jpeg","image/png","image/webp"),"Competitor quotation (one joined entry)");
        check(same(FileChooserRules.mimeTypes(new String[]{".pdf",".jpg",".jpeg",".png",".webp"}),"application/pdf","image/jpeg","image/png","image/webp"),"Competitor quotation (separate entries)");
        check(same(FileChooserRules.mimeTypes(new String[]{".xlsx",XLSX}),XLSX),"ERP workbook");

        // ---- one entry the picker cannot filter by opens every file
        String design="pdf png jpg jpeg webp gif dwg dxf step stp igs iges stl sldprt sldasm slddrw nc1 dstv ai eps cdr psd svg zip rar 7z";
        StringBuilder accept=new StringBuilder();for(String extension:design.split(" "))accept.append(accept.length()==0?"":",").append('.').append(extension);
        check(FileChooserRules.mimeTypes(new String[]{accept.toString()})==null,"The design-file input opens every file (joined)");
        check(FileChooserRules.mimeTypes(accept.toString().split(","))==null,"The design-file input opens every file (separate)");
        for(String extension:"dwg dxf step stp igs iges stl sldprt sldasm slddrw nc1 dstv ai eps cdr psd rar 7z".split(" "))
            check(FileChooserRules.mimeTypes(new String[]{"."+extension})==null,"A drawing or archive opens every file: "+extension);
        check(FileChooserRules.mimeTypes(new String[]{".pdf",".step"})==null,"One unknown extension among known ones opens every file");
        check(FileChooserRules.mimeTypes(new String[]{"image/*",".nc1"})==null,"A MIME type with an unknown extension opens every file");
        check(FileChooserRules.mimeTypes(new String[]{"*/*"})==null,"Any type opens every file");
        check(FileChooserRules.mimeTypes(new String[]{"*"})==null,"A lone star opens every file");
        for(String odd:new String[]{"*/png","a/b/c","image/","/png","text/plain;charset=utf-8","image/ png","x".repeat(130)+"/y","..pdf","."})
            check(FileChooserRules.mimeTypes(new String[]{odd})==null,"An entry Android cannot filter by opens every file: "+odd);

        // ---- source guards: MainActivity uses the rules and keeps the trusted-page check and multiple selection
        Path source=Path.of(args.length>0?args[0]:"mobile/android/app/src/main/java/org/yourrest/crm");
        String activity=Files.readString(source.resolve("MainActivity.java"));
        String chooser=TripStartCheck.block(activity,"public boolean onShowFileChooser(");
        check(chooser.indexOf("if(!RouteRules.trusted(view.getUrl()))return false;")==chooser.indexOf("if(")&&chooser.contains("RouteRules.trusted(view.getUrl())"),"Only the trusted page can open the picker, checked first");
        check(chooser.contains("FileChooserRules.mimeTypes(params.getAcceptTypes())"),"The picker follows the page's accept list");
        check(chooser.contains("if(types!=null)intent.putExtra(Intent.EXTRA_MIME_TYPES,types)")&&chooser.contains(".setType(\"*/*\")"),"No EXTRA_MIME_TYPES when every file is allowed");
        check(!chooser.contains("new String[]{\"image/*\""),"The fixed list is no longer forced on every input");
        check(chooser.contains("Intent.ACTION_OPEN_DOCUMENT")&&chooser.contains("Intent.CATEGORY_OPENABLE"),"Still the system document picker (no storage permission)");
        check(chooser.contains("intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE)"),"Multiple selection as before");
        String result=TripStartCheck.block(activity,"protected void onActivityResult(");
        check(result.contains("Math.min(20,data.getClipData().getItemCount())")&&result.contains("\"content\".equals(uri.getScheme())"),"Chosen files: at most 20, content URIs only, as before");
        System.out.println("Native file chooser: "+checks+" checks passed (accept-list rules and source guards; no device picker verification)");
    }
}

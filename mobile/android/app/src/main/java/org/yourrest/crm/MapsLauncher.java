package org.yourrest.crm;

import java.net.URI;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;

/** Narrow Maps destination parser and launch fallback shared with executable JVM checks. */
final class MapsLauncher {
    static final String MAPS_PACKAGE="com.google.android.apps.maps";
    static final String OPEN_FAILED="تعذر فتح خرائط Google أو المتصفح؛ تأكد من تفعيل أحدهما ثم حاول مجددًا";
    static final class Unavailable extends Exception { }
    interface Transport { void open(String uri,String packageName,boolean browsable)throws Unavailable; }
    static final class Destination {
        final double latitude,longitude;
        private Destination(double latitude,double longitude){this.latitude=latitude;this.longitude=longitude;}
        String navigation(){return "google.navigation:q="+Double.toString(latitude)+","+Double.toString(longitude)+"&mode=d";}
        String https(){return "https://www.google.com/maps/dir/?api=1&destination="+Double.toString(latitude)+"%2C"+Double.toString(longitude)+"&travelmode=driving&dir_action=navigate";}
    }
    static Destination coordinates(double latitude,double longitude){return RouteRules.validCoordinates(latitude,longitude)?new Destination(latitude,longitude):null;}
    static Destination destination(String url){
        try{
            URI uri=URI.create(url);
            if(!"https".equals(uri.getScheme())||!"www.google.com".equals(uri.getHost())||!"/maps/dir/".equals(uri.getRawPath())||uri.getRawUserInfo()!=null||uri.getRawFragment()!=null||(uri.getPort()!=-1&&uri.getPort()!=443)||uri.getRawQuery()==null)return null;
            Map<String,String> query=new HashMap<>();
            for(String item:uri.getRawQuery().split("&",-1)){
                int split=item.indexOf('=');if(split<=0)return null;
                String key=URLDecoder.decode(item.substring(0,split),"UTF-8"),value=URLDecoder.decode(item.substring(split+1),"UTF-8");
                if(query.put(key,value)!=null)return null;
            }
            if(query.size()!=4||!"1".equals(query.get("api"))||!"driving".equals(query.get("travelmode"))||!"navigate".equals(query.get("dir_action")))return null;
            String coordinates=query.get("destination");if(coordinates==null)return null;String[] pair=coordinates.split(",",-1);
            if(pair.length!=2)return null;
            for(String coordinate:pair)if(!coordinate.matches("-?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?"))return null;
            double latitude=Double.parseDouble(pair[0]),longitude=Double.parseDouble(pair[1]);
            return coordinates(latitude,longitude);
        }catch(Exception invalid){return null;}
    }
    /** A trusted main frame's current injected nonce survives async WebView gesture loss. */
    static boolean canHandoff(String currentPage,boolean mainFrame,boolean gesture,boolean resumed,String nonce,String target){
        return mainFrame&&resumed&&RouteRules.trusted(currentPage)&&(gesture||(nonce!=null&&!nonce.isEmpty()))&&destination(target)!=null;
    }
    static String launch(Destination target,Transport transport){
        if(target==null)return "لوكيشن الاتجاهات غير صالح";
        try{transport.open(target.navigation(),MAPS_PACKAGE,false);return null;}
        catch(Unavailable|SecurityException unavailable){ }
        catch(RuntimeException failure){ }
        try{transport.open(target.https(),null,true);return null;}
        catch(Unavailable|SecurityException unavailable){return OPEN_FAILED;}
        catch(RuntimeException failure){return OPEN_FAILED;}
    }
    private MapsLauncher(){ }
}

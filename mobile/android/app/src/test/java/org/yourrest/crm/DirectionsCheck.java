package org.yourrest.crm;

import java.net.URI;
import java.util.Locale;

/** The exact policy used by RouteTracker.directions, without requiring a phone or WebView. */
public final class DirectionsCheck {
    private static int checks;
    private static final String MEMBER="rep-1",STOP="journey-rep-1-ff7695d4-d9f6-4d40-9b17-a14dc53ca871";
    private static void check(boolean value){checks++;if(!value)throw new AssertionError("Directions check "+checks);}
    private static String url(boolean tracking,String member,String boundMember,String stop,String boundStop,double lat,double lng,double boundLat,double boundLng){return RouteRules.directionsUrl(tracking,member,boundMember,stop,boundStop,lat,lng,boundLat,boundLng);}
    private static void rejects(boolean tracking,String member,String boundMember,String stop,String boundStop,double lat,double lng,double boundLat,double boundLng){
        try{url(tracking,member,boundMember,stop,boundStop,lat,lng,boundLat,boundLng);throw new AssertionError("Expected directions denial");}
        catch(IllegalArgumentException expected){check(expected.getMessage()!=null&&!expected.getMessage().isEmpty());}
    }
    public static void main(String[] args){
        String actual=url(true,MEMBER,MEMBER,STOP,STOP,26.437341,50.034499,26.437341,50.034499);
        check(actual.equals("https://www.google.com/maps/dir/?api=1&destination=26.437341%2C50.034499&travelmode=driving&dir_action=navigate"));
        URI uri=URI.create(actual);check("https".equals(uri.getScheme()));check("www.google.com".equals(uri.getHost()));check("/maps/dir/".equals(uri.getPath()));check(uri.getUserInfo()==null&&uri.getFragment()==null);
        rejects(false,MEMBER,MEMBER,STOP,STOP,26,50,26,50);
        rejects(true,"rep-other",MEMBER,STOP,STOP,26,50,26,50);
        rejects(true,MEMBER,MEMBER,"journey-other",STOP,26,50,26,50);
        rejects(true,MEMBER,"",STOP,STOP,26,50,26,50);
        rejects(true,MEMBER,MEMBER,STOP,"",26,50,26,50);
        rejects(true,null,MEMBER,STOP,STOP,26,50,26,50);
        rejects(true,MEMBER,MEMBER,null,STOP,26,50,26,50);
        rejects(true,"https://evil.example",MEMBER,STOP,STOP,26,50,26,50);
        rejects(true,MEMBER,MEMBER,STOP,STOP,27,50,26,50);
        rejects(true,MEMBER,MEMBER,STOP,STOP,26,51,26,50);
        rejects(true,MEMBER,MEMBER,STOP,STOP,Double.NaN,50,26,50);
        rejects(true,MEMBER,MEMBER,STOP,STOP,26,Double.POSITIVE_INFINITY,26,50);
        rejects(true,MEMBER,MEMBER,STOP,STOP,26,50,Double.NaN,50);
        rejects(true,MEMBER,MEMBER,STOP,STOP,26,50,26,Double.NEGATIVE_INFINITY);
        rejects(true,MEMBER,MEMBER,STOP,STOP,91,50,91,50);
        rejects(true,MEMBER,MEMBER,STOP,STOP,-91,50,-91,50);
        rejects(true,MEMBER,MEMBER,STOP,STOP,26,181,26,181);
        rejects(true,MEMBER,MEMBER,STOP,STOP,26,-181,26,-181);
        rejects(true,MEMBER,MEMBER,STOP,STOP,0,0,0,0);
        check(url(true,MEMBER,MEMBER,STOP,STOP,0,50,0,50).contains("destination=0.0%2C50.0"));
        check(url(true,MEMBER,MEMBER,STOP,STOP,-90,-180,-90,-180).contains("destination=-90.0%2C-180.0"));
        Locale previous=Locale.getDefault();try{Locale.setDefault(Locale.FRANCE);check(url(true,MEMBER,MEMBER,STOP,STOP,26.5,50.5,26.5,50.5).contains("destination=26.5%2C50.5"));}finally{Locale.setDefault(previous);}
        System.out.println("Native directions: "+checks+" checks passed (actual binding/URL policy, no device launch verification)");
    }
}

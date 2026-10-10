package org.yourrest.crm;

import java.net.URI;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.UUID;

/** Pure rules shared by the native boundary and its JVM checks. */
final class RouteRules {
    static final String ORIGIN = "https://crm.yourrest.org";
    private static final DateTimeFormatter ISO = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
    static boolean trusted(String url) {
        try {
            URI u = URI.create(url);
            return "https".equals(u.getScheme()) && "crm.yourrest.org".equals(u.getHost())
                    && u.getRawUserInfo() == null && (u.getPort() == -1 || u.getPort() == 443);
        } catch (RuntimeException e) { return false; }
    }
    static boolean uuid(String value) {
        try { return value != null && UUID.fromString(value).toString().equalsIgnoreCase(value); }
        catch (RuntimeException e) { return false; }
    }
    static boolean identifier(String value) { return value != null && value.matches("[a-zA-Z0-9_-]{1,200}"); }
    static boolean validCoordinates(double latitude,double longitude){
        return Double.isFinite(latitude)&&Double.isFinite(longitude)&&latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180&&(latitude!=0||longitude!=0);
    }
    /** Only the active native binding's authenticated destination can leave the WebView asynchronously. */
    static String directionsUrl(boolean tracking,String memberId,String boundMemberId,String stopId,String boundStopId,double latitude,double longitude,double boundLatitude,double boundLongitude){
        if(!tracking||!identifier(memberId)||!identifier(stopId)||!memberId.equals(boundMemberId)||!stopId.equals(boundStopId))throw new IllegalArgumentException("ابدأ التوجه إلى هذا العميل أولًا، ثم افتح الاتجاهات");
        if(!validCoordinates(latitude,longitude)||!validCoordinates(boundLatitude,boundLongitude)||latitude!=boundLatitude||longitude!=boundLongitude)throw new IllegalArgumentException("لوكيشن الاتجاهات لا يطابق العميل الجاري التوجه إليه");
        return "https://www.google.com/maps/dir/?api=1&destination="+Double.toString(latitude)+"%2C"+Double.toString(longitude)+"&travelmode=driving&dir_action=navigate";
    }
    static boolean validFix(double latitude, double longitude, float accuracy, long at, long now, long lastAt) {
        return Double.isFinite(latitude) && Double.isFinite(longitude) && Float.isFinite(accuracy)
                && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
                && (latitude != 0 || longitude != 0) && accuracy > 0 && accuracy <= 10000 && at > lastAt && at <= now && at >= now - 60000;
    }
    static String date(long millis) { return Instant.ofEpochMilli(millis).atZone(ZoneId.of("Asia/Riyadh")).toLocalDate().toString(); }
    static String iso(long millis) { return ISO.format(Instant.ofEpochMilli(millis)); }
    /** A completed persisted day needs no new end mutation; an unacknowledged exact end remains immutable. */
    static String endTimeForRestart(boolean alreadyEnded,String pendingEndAt,long now,long expiry){
        if(pendingEndAt!=null&&!pendingEndAt.isEmpty())return pendingEndAt;
        return alreadyEnded?"":iso(Math.min(now,expiry));
    }
    static long millis(String value) { try { return Instant.parse(value).toEpochMilli(); } catch (RuntimeException e) { return 0; } }
    private RouteRules() { }
}

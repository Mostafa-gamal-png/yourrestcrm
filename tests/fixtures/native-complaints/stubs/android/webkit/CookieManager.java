package android.webkit;
/** Stand-in: the WebView's cookie jar, holding the CRM session the checks set or clear. */
public class CookieManager {
    public static String cookie;
    private static final CookieManager INSTANCE = new CookieManager();
    public static CookieManager getInstance() { return INSTANCE; }
    public String getCookie(String url) { return cookie; }
}

package org.yourrest.crm;

import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Fixed-origin read of the representative's nearby-customer list (GET /api/nearby-customers): no redirects, no other address, a
 *  bounded answer. The session cookie never leaves native memory. */
class NearbyApi {
    static final int MAX_BYTES = 2 * 1024 * 1024;
    static final class Failure extends Exception {
        final int status;
        Failure(int status, String message) { super(message); this.status = status; }
    }
    JSONObject fetch() throws Exception {
        String cookie = CookieManager.getInstance().getCookie(RouteRules.ORIGIN);
        if (cookie == null || cookie.trim().isEmpty()) throw new Failure(401, "لا توجد جلسة");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(RouteRules.ORIGIN + NearbyRules.PATH).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(15000);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Cache-Control", "no-store");
        connection.setRequestProperty("Cookie", cookie);
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new Failure(status, "تعذّر قراءة قائمة المصانع القريبة");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] bytes = new byte[8192]; int size;
                while ((size = input.read(bytes)) != -1) { if (output.size() + size > MAX_BYTES) throw new Failure(502, "استجابة غير صالحة من الخادم"); output.write(bytes, 0, size); }
            }
            return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        } finally { connection.disconnect(); }
    }
}

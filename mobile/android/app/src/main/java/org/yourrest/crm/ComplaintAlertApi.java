package org.yourrest.crm;

import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Fixed-origin read of the complaints that wait for the signed-in member (GET /api/complaints/alerts): no redirects, no other address,
 *  a bounded answer. The session cookie never leaves native memory. */
final class ComplaintAlertApi implements ComplaintAlerts.Fetcher {
    @Override public JSONObject fetch() throws Exception {
        String cookie = CookieManager.getInstance().getCookie(RouteRules.ORIGIN);
        if (cookie == null || cookie.trim().isEmpty()) throw new ServiceAlertApi.Failure(401, "لا توجد جلسة");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(RouteRules.ORIGIN + ComplaintAlertRules.PATH).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Cache-Control", "no-store");
        connection.setRequestProperty("Cookie", cookie);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new ServiceAlertApi.Failure(status, "تعذرت قراءة الشكاوى");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] bytes = new byte[4096]; int size;
                while ((size = input.read(bytes)) != -1) { if (output.size() + size > ComplaintAlertRules.MAX_BODY_BYTES) throw new ServiceAlertApi.Failure(502, "استجابة غير صالحة من الخادم"); output.write(bytes, 0, size); }
            }
            return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        } finally { connection.disconnect(); }
    }
}

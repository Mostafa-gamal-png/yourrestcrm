package org.yourrest.crm;

import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Fixed-origin read of the signed-in member's waiting customer-service requests. The session cookie never leaves native memory. */
final class ServiceAlertApi {
    static final String PATH = "/api/service-queue/alerts";
    static final class Failure extends Exception {
        final int status;
        Failure(int status, String message) { super(message); this.status = status; }
    }
    JSONObject fetch() throws Exception {
        String cookie = CookieManager.getInstance().getCookie(RouteRules.ORIGIN);
        if (cookie == null || cookie.trim().isEmpty()) throw new Failure(401, "لا توجد جلسة");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(RouteRules.ORIGIN + PATH).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Cache-Control", "no-store");
        connection.setRequestProperty("Cookie", cookie);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new Failure(status, "تعذر قراءة طلبات خدمة العملاء");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] bytes = new byte[4096]; int size;
                while ((size = input.read(bytes)) != -1) { if (output.size() + size > 65536) throw new Failure(502, "استجابة غير صالحة من الخادم"); output.write(bytes, 0, size); }
            }
            return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        } finally { connection.disconnect(); }
    }
}

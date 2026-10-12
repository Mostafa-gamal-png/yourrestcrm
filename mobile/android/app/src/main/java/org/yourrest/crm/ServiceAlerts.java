package org.yourrest.crm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Asks the server which customer-service requests wait for the signed-in member and announces the new ones. */
final class ServiceAlerts {
    static final String OPEN = "org.yourrest.crm.OPEN_SERVICE_CASE", EXTRA_CASE = "serviceCaseId", CHANNEL = "service-requests";
    private static final AtomicBoolean running = new AtomicBoolean();
    private static final ExecutorService worker = Executors.newSingleThreadExecutor(task -> { Thread thread = new Thread(task, "YourrestServiceAlerts"); thread.setDaemon(true); return thread; });

    /** Cheap to call often: the policy decides whether a request to the server is due. Never blocks the caller. */
    static void poll(Context context, boolean opening) {
        Context app = context.getApplicationContext();
        long now = System.currentTimeMillis();
        ServiceAlertStore store = new ServiceAlertStore(app);
        if (!ServiceAlertPolicy.shouldPoll(now, store.lastPollAt(), ContinuousPolicy.inWindow(now), opening)) return;
        if (!running.compareAndSet(false, true)) return;
        store.lastPollAt(now);
        worker.execute(() -> {
            try { run(app, store, now); }
            catch (Exception silent) { /* offline, signed out or not allowed: the next poll tries again */ }
            finally { running.set(false); }
        });
    }

    private static void run(Context app, ServiceAlertStore store, long now) throws Exception {
        JSONObject answer = new ServiceAlertApi().fetch();
        String member = answer.optString("memberId");
        if (!RouteRules.identifier(member)) return;
        Map<String, Long> remembered = store.remembered(member);
        List<ServiceAlertPolicy.Alert> news = ServiceAlertPolicy.news(parse(answer.optJSONArray("alerts")), remembered);
        // A request in front of someone who is looking at the app is already on their screen; announcing it again is noise.
        if (!news.isEmpty() && !MainActivity.resumed) {
            if (!app.getSystemService(NotificationManager.class).areNotificationsEnabled()) return;
            show(app, ServiceAlertPolicy.notices(news));
        }
        store.save(member, ServiceAlertPolicy.remember(remembered, news, now));
    }

    private static List<ServiceAlertPolicy.Alert> parse(JSONArray array) {
        List<ServiceAlertPolicy.Alert> result = new ArrayList<>();
        if (array == null) return result;
        for (int index = 0; index < Math.min(array.length(), 50); index++) {
            JSONObject item = array.optJSONObject(index);
            if (item == null) continue;
            result.add(new ServiceAlertPolicy.Alert(item.optString("id"), item.optString("customerName"), item.optString("need"), item.optString("awaiting"), item.optString("since"), item.optBoolean("seen", true)));
        }
        return result;
    }

    private static void show(Context app, List<ServiceAlertPolicy.Notice> notices) {
        NotificationManager manager = app.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "طلبات خدمة العملاء", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("تنبيه عند إحالة طلب من خدمة العملاء إليك أو عند انتظاره إجراءك");
        manager.createNotificationChannel(channel);
        for (ServiceAlertPolicy.Notice notice : notices) {
            Intent open = new Intent(app, MainActivity.class).setAction(OPEN).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            if (notice.caseId != null) open.putExtra(EXTRA_CASE, notice.caseId);
            PendingIntent target = PendingIntent.getActivity(app, notice.id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            // The lock screen shows only a generic title; the customer and the need appear after unlocking.
            Notification lockScreen = new Notification.Builder(app, CHANNEL).setSmallIcon(org.yourrest.crm.R.drawable.ic_service_request).setContentTitle(notice.publicTitle).build();
            manager.notify(notice.id, new Notification.Builder(app, CHANNEL).setSmallIcon(org.yourrest.crm.R.drawable.ic_service_request)
                    .setContentTitle(notice.title).setContentText(notice.text).setContentIntent(target).setAutoCancel(true)
                    .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(lockScreen).build());
        }
    }

    private ServiceAlerts() { }
}

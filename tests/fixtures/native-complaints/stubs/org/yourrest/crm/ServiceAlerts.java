package org.yourrest.crm;
import android.content.Context;
/** Stand-in for the service-request alerts the background check also asks: counts the asks and finishes them at once. */
final class ServiceAlerts {
    static int background;
    static void pollInBackground(Context context, Runnable done) { background++; done.run(); }
}

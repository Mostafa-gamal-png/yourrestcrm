package org.yourrest.crm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

/** One ordinary inexact boundary alarm; never an exact-alarm permission or restart loop. */
final class RouteWindowSchedule {
    static final String BOUNDARY="org.yourrest.crm.WORK_WINDOW_BOUNDARY";
    private static PendingIntent pending(Context context){
        return PendingIntent.getBroadcast(context,42,new Intent(context,RouteResumeReceiver.class).setAction(BOUNDARY),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static void schedule(Context context,long now){
        context.getSystemService(AlarmManager.class).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,ContinuousPolicy.nextBoundary(now),pending(context));
    }
    static void cancel(Context context){context.getSystemService(AlarmManager.class).cancel(pending(context));}
    private RouteWindowSchedule() { }
}

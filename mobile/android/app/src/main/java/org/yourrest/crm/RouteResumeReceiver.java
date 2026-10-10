package org.yourrest.crm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Ordinary boundaries only wake an existing service; no foreground-start restriction bypass. */
public final class RouteResumeReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        if(intent==null)return;String action=intent.getAction();
        boolean restart=Intent.ACTION_BOOT_COMPLETED.equals(action)||Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);
        boolean boundary=RouteWindowSchedule.BOUNDARY.equals(action)||Intent.ACTION_TIME_CHANGED.equals(action)||Intent.ACTION_TIMEZONE_CHANGED.equals(action);
        if(!restart&&!boundary)return;
        ContinuousRouteTracker tracker=ContinuousRouteTracker.get(context);
        RouteLocationService active=RouteLocationService.current;
        if(active!=null){if(Intent.ACTION_TIME_CHANGED.equals(action)||Intent.ACTION_TIMEZONE_CHANGED.equals(action))active.clockChanged();else active.refreshWindow();return;}
        if(!tracker.canResume()){RouteWindowSchedule.cancel(context);return;}
        RouteWindowSchedule.schedule(context,System.currentTimeMillis());
        // Time/boundary alarms never silently start an otherwise stopped app/service.
        if(!restart)return;
        try{context.startForegroundService(new Intent(context,RouteLocationService.class).setAction(RouteLocationService.CONTINUOUS));}
        catch(RuntimeException denied){tracker.backgroundStartDenied();}
    }
}

package org.yourrest.crm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

public final class RouteLocationService extends Service implements LocationListener {
    static final String START="org.yourrest.crm.START", END="org.yourrest.crm.END", CONTINUOUS="org.yourrest.crm.CONTINUOUS";
    static volatile RouteLocationService current;
    private static final String CHANNEL="route-location";
    private static final int NOTIFICATION=41;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private LocationManager locations;
    private boolean registered;
    private boolean continuous,foreground;
    private long authorizedWindowStart,scheduledAt;
    private final Runnable boundary=new Runnable(){public void run(){scheduledAt=0;refreshWindow();}};
    private final Runnable heartbeat=new Runnable(){public void run(){refreshWindow();if(continuous)ContinuousRouteTracker.get(RouteLocationService.this).tick();else RouteTracker.get(RouteLocationService.this).tick();ServiceAlerts.poll(RouteLocationService.this,false);handler.postDelayed(this,30000);}};
    @Override public void onCreate(){super.onCreate();current=this;locations=(LocationManager)getSystemService(LOCATION_SERVICE);
        NotificationChannel channel=new NotificationChannel(CHANNEL,"تسجيل موقع يورست",NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("إشعار ظاهر لخدمة تسجيل الموقع من 6 صباحًا إلى 6 مساءً بتوقيت المملكة، ما عدا الجمعة؛ جمع الموقع يتوقف خارج هذه الفترة");channel.setShowBadge(false);getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&END.equals(intent.getAction())&&ContinuousRouteTracker.get(this).enabled()){ContinuousRouteTracker.get(this).internalStop(null);return START_STICKY;}
        boolean requestedContinuous=intent==null?ContinuousRouteTracker.get(this).enabled():CONTINUOUS.equals(intent.getAction());
        if(registered&&continuous!=requestedContinuous)releaseLocations();
        continuous=requestedContinuous;
        if(intent!=null&&END.equals(intent.getAction())){RouteTracker.get(this).stop(null);if(!ContinuousRouteTracker.get(this).enabled())stopSelf();return START_NOT_STICKY;}
        try{
            if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);else startForeground(NOTIFICATION,notification());
            foreground=true;handler.removeCallbacks(heartbeat);handler.postDelayed(heartbeat,30000);scheduleBoundary();
            if(continuous){
                if(!ContinuousRouteTracker.get(this).canResume()){stopSelf();return START_NOT_STICKY;}
                if(!ContinuousPolicy.inWindow(System.currentTimeMillis()))releaseLocations();
                ContinuousRouteTracker.get(this).authorizeService();return START_STICKY;
            }
            if(!RouteTracker.get(this).permission())throw new SecurityException("permission");
            refreshWindow();
        }catch(Exception failure){if(continuous)ContinuousRouteTracker.get(this).startupFailed();else RouteTracker.get(this).startupFailed();stopSelf();}
        return START_NOT_STICKY;
    }
    boolean continuousMode(){return continuous;}
    void clockChanged(){scheduledAt=0;refreshWindow();}
    /** Refresh actual provider subscriptions on callbacks, timers and system clock changes. */
    void refreshWindow(){
        long now=System.currentTimeMillis();scheduleBoundary();
        if(continuous&&!ContinuousRouteTracker.get(this).canResume()){releaseLocations();stopSelf();return;}
        if(!continuous&&!RouteTracker.get(this).permission()){releaseLocations();stopSelf();return;}
        if(!ContinuousPolicy.inWindow(now)){
            releaseLocations();authorizedWindowStart=0;
            if(continuous)ContinuousRouteTracker.get(this).windowPaused();else RouteTracker.get(this).windowPaused();
            updateNotification();return;
        }
        if(continuous){
            if(!ContinuousRouteTracker.get(this).canResume()){releaseLocations();stopSelf();return;}
            if(authorizedWindowStart!=ContinuousPolicy.windowStart(now)||!ContinuousRouteTracker.get(this).collectionAuthorized()){releaseLocations();ContinuousRouteTracker.get(this).authorizeService();return;}
            registerContinuousLocations();
        }else registerLegacyLocations();
    }
    /** A current server check or unexpired prior authorization is required after each overnight pause. */
    void continuousAuthorized(){boolean wasRegistered=registered;authorizedWindowStart=ContinuousPolicy.windowStart(System.currentTimeMillis());refreshWindow();
        // A repeated authenticated start may reuse provider subscriptions; settle its reply too.
        if(wasRegistered&&continuous&&registered)ContinuousRouteTracker.get(this).serviceReady();
    }
    private void scheduleBoundary(){
        long now=System.currentTimeMillis(),next=ContinuousPolicy.nextBoundary(now);
        if(next==scheduledAt)return;
        scheduledAt=next;handler.removeCallbacks(boundary);handler.postDelayed(boundary,Math.max(1,next-now));RouteWindowSchedule.schedule(this,now);
    }
    private void releaseLocations(){if(locations!=null)locations.removeUpdates(this);registered=false;}
    private void registerLegacyLocations(){
        if(!ContinuousPolicy.inWindow(System.currentTimeMillis())){releaseLocations();return;}
        try{
            if(!RouteTracker.get(this).permission())throw new SecurityException("permission");
            if(!registered){
                boolean provider=false;
                if(locations.getAllProviders().contains(LocationManager.GPS_PROVIDER)){locations.requestLocationUpdates(LocationManager.GPS_PROVIDER,15000,0,this,Looper.getMainLooper());provider|=locations.isProviderEnabled(LocationManager.GPS_PROVIDER);}
                if(locations.getAllProviders().contains(LocationManager.NETWORK_PROVIDER)){locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,15000,10,this,Looper.getMainLooper());provider|=locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER);}
                if(!provider)throw new IllegalStateException("Location disabled");registered=true;
                RouteTracker.get(this).serviceReady();
            }
        }catch(RuntimeException denied){releaseLocations();RouteTracker.get(this).startupFailed();stopSelf();}
    }
    void registerContinuousLocations(){
        if(!continuous||!ContinuousRouteTracker.get(this).collectionAuthorized()||!ContinuousPolicy.inWindow(System.currentTimeMillis())){releaseLocations();return;}
        try{
            boolean provider=false,enabled=false;
            if(!registered){
                if(locations.getAllProviders().contains(LocationManager.GPS_PROVIDER)){locations.requestLocationUpdates(LocationManager.GPS_PROVIDER,15000,0,this,Looper.getMainLooper());provider=true;enabled|=locations.isProviderEnabled(LocationManager.GPS_PROVIDER);}
                if(locations.getAllProviders().contains(LocationManager.NETWORK_PROVIDER)){locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,15000,0,this,Looper.getMainLooper());provider=true;enabled|=locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER);}
                if(!provider)throw new IllegalStateException("No location provider");registered=true;
                ContinuousRouteTracker.get(this).serviceReady();
            }else enabled=locations.isProviderEnabled(LocationManager.GPS_PROVIDER)||locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            if(!enabled)ContinuousRouteTracker.get(this).providerUnavailable();
        }catch(RuntimeException denied){releaseLocations();ContinuousRouteTracker.get(this).startupFailed();stopSelf();}
    }
    private Notification notification(){
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        org.json.JSONObject state=RouteTracker.get(this).state();int queued=state.optInt("pendingCount");
        boolean openWindow=ContinuousPolicy.inWindow(System.currentTimeMillis());
        String text=!openWindow?"جمع الموقع متوقف • يستأنف 6 صباحًا في يوم العمل التالي ما عدا الجمعة":continuous?(registered?"جارٍ تسجيل الموقع من 6 صباحًا إلى 6 مساءً بتوقيت المملكة، ما عدا الجمعة":"جارٍ التحقق من الحساب لاستئناف التسجيل في ساعات العمل"):(queued>0?"جارٍ تسجيل موقع العمل • "+queued+" نقطة بانتظار الرفع":"جارٍ تسجيل موقع العمل وإرساله لتقرير المشرف");
        if(openWindow&&!state.isNull("error"))text=state.optString("error");
        Notification.Builder builder=new Notification.Builder(this,CHANNEL).setSmallIcon(org.yourrest.crm.R.drawable.ic_location).setContentTitle(continuous?"يورست • تسجيل الموقع 6 صباحًا–6 مساءً عدا الجمعة":"يورست • تسجيل خط السير")
                .setContentText(text).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_SERVICE)
                .setVisibility(Notification.VISIBILITY_PRIVATE);
        if(!continuous){PendingIntent end=PendingIntent.getService(this,1,new Intent(this,RouteLocationService.class).setAction(END),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);builder.addAction(new Notification.Action.Builder(null,"إنهاء يوم العمل",end).build());}
        return builder.build();
    }
    void updateNotification(){if(foreground)getSystemService(NotificationManager.class).notify(NOTIFICATION,notification());}
    @Override public void onLocationChanged(Location location){if(!ContinuousPolicy.canCapture(location.getTime(),System.currentTimeMillis())){refreshWindow();return;}if(continuous)ContinuousRouteTracker.get(this).onFix(location);else RouteTracker.get(this).onFix(location);}
    @Override public void onProviderDisabled(String provider){if(!ContinuousPolicy.inWindow(System.currentTimeMillis())){refreshWindow();return;}if(continuous)ContinuousRouteTracker.get(this).providerUnavailable();else RouteTracker.get(this).providerUnavailable();}
    @Override public void onProviderEnabled(String provider){ }
    @Override public void onStatusChanged(String provider,int status,Bundle extras){ }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){handler.removeCallbacks(heartbeat);handler.removeCallbacks(boundary);releaseLocations();foreground=false;current=null;stopForeground(STOP_FOREGROUND_REMOVE);if(continuous){ContinuousRouteTracker.get(this).serviceDestroyed();if(ContinuousRouteTracker.get(this).canResume())RouteWindowSchedule.schedule(this,System.currentTimeMillis());else RouteWindowSchedule.cancel(this);}else{RouteTracker.get(this).serviceDestroyed();RouteWindowSchedule.cancel(this);}super.onDestroy();}
}

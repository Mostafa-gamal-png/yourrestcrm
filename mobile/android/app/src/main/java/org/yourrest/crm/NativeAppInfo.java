package org.yourrest.crm;

import android.Manifest;
import android.content.Context;
import android.location.LocationManager;
import android.os.Build;
import android.content.pm.PackageManager;
import org.json.JSONArray;
import org.json.JSONObject;

/** Package metadata reports the actually installed APK rather than a copied version string. */
final class NativeAppInfo {
    static void add(Context context,JSONObject state){
        String version="unknown";long versionCode=0;
        try{android.content.pm.PackageInfo info=context.getPackageManager().getPackageInfo(context.getPackageName(),0);String actual=info.versionName;versionCode=NativeAppUpdater.versionCode(info);if(actual!=null&&!actual.isEmpty())version=actual;}
        catch(PackageManager.NameNotFoundException unavailable){ }
        try{LocationManager locations=(LocationManager)context.getSystemService(Context.LOCATION_SERVICE);
            boolean locationEnabled=locations!=null&&(Build.VERSION.SDK_INT>=28?locations.isLocationEnabled():locations.isProviderEnabled(LocationManager.GPS_PROVIDER)||locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
            state.put("appVersion",version).put("installedVersionName",version).put("installedVersionCode",versionCode).put("updateProtocol",1).put("mapsLaunchSupported",true).put("foregroundDirectionsSupported",true).put("accountRecoverySupported",true)
                .put("fridayExclusionSupported",true).put("workWeekSupported",true)
                .put("workingDays",new JSONArray().put(0).put(1).put(2).put(3).put(4).put(6)).put("workingHoursTimeZone","Asia/Riyadh")
                .put("fineLocationPermission",context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED?"granted":"denied")
                .put("notificationPermission",Build.VERSION.SDK_INT<33||context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED?"granted":"denied")
                .put("locationServicesEnabled",locationEnabled).put("continuousConsent",context.getSharedPreferences("native",0).getBoolean("continuousConsentV1",false));}catch(Exception ignored){ }
    }
    private NativeAppInfo(){ }
}

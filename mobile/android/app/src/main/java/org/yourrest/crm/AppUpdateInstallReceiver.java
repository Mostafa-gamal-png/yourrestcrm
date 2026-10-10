package org.yourrest.crm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Non-exported, explicit PackageInstaller result target; survives installer-driven Activity teardown. */
public final class AppUpdateInstallReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){NativeAppUpdater.get(context).installResult(intent);}
}

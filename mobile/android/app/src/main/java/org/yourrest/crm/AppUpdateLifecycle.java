package org.yourrest.crm;

/** An installer callback never substitutes for the version Android actually reports installed. */
final class AppUpdateLifecycle {
    static boolean installed(long current,long target){return target>0&&current>=target;}
    static String restore(String prior,boolean release,boolean file){
        if(release&&"installing".equals(prior))return "installing";
        return release?(file?"ready":"available"):"idle";
    }
    static String resumed(String phase,long current,long target,boolean busy,boolean activeSession){
        if(installed(current,target))return "upToDate";
        if("installing".equals(phase)&&!busy&&!activeSession)return "cancelled";
        return phase;
    }
    static String result(boolean success,boolean aborted,long current,long target){
        if(installed(current,target))return "upToDate";
        return success?"installing":aborted?"cancelled":"error";
    }
    private AppUpdateLifecycle(){ }
}

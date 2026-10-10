package org.yourrest.crm;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Executes the production parser, handoff guard and launcher with simulated OS responses. */
public final class MapsLaunchCheck {
    static int checks;
    static final String VALID="https://www.google.com/maps/dir/?api=1&destination=26.437341%2C50.034499&travelmode=driving&dir_action=navigate";
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    static final class Call {
        final String uri,packageName;final boolean browsable;
        Call(String uri,String packageName,boolean browsable){this.uri=uri;this.packageName=packageName;this.browsable=browsable;}
    }
    static final class FakeOs implements MapsLauncher.Transport {
        final List<Call> calls=new ArrayList<>();int mapsFailure,httpsFailure;
        public void open(String uri,String packageName,boolean browsable)throws MapsLauncher.Unavailable{
            calls.add(new Call(uri,packageName,browsable));int failure=packageName==null?httpsFailure:mapsFailure;
            if(failure==1)throw new MapsLauncher.Unavailable();if(failure==2)throw new SecurityException("simulated OS deny");if(failure==3)throw new IllegalStateException("simulated OS failure");
        }
    }
    static boolean allowed(String page,boolean mainFrame,boolean gesture,boolean resumed,String nonce,String target){return MapsLauncher.canHandoff(page,mainFrame,gesture,resumed,nonce,target);}
    public static void main(String[] args)throws Exception{
        MapsLauncher.Destination target=MapsLauncher.destination(VALID);check(target!=null,"Valid fixed Maps directions rejected");
        check(target.latitude==26.437341&&target.longitude==50.034499,"Coordinates changed");
        check(target.https().equals(VALID),"HTTPS fallback is not canonical fixed destination");
        FakeOs installed=new FakeOs();check(MapsLauncher.launch(target,installed)==null&&installed.calls.size()==1,"Installed Maps should launch without browser");
        Call direct=installed.calls.get(0);check(direct.uri.equals("google.navigation:q=26.437341,50.034499&mode=d"),"Explicit navigation URI changed");
        check(MapsLauncher.MAPS_PACKAGE.equals(direct.packageName)&&!direct.browsable,"Explicit Maps launch must be pinned and not browsable");
        for(int failure:new int[]{1,2,3}){
            FakeOs fallback=new FakeOs();fallback.mapsFailure=failure;check(MapsLauncher.launch(target,fallback)==null,"Missing/denied Maps should use HTTPS fallback");
            check(fallback.calls.size()==2,"Maps failure should attempt exactly one HTTPS fallback");
            Call web=fallback.calls.get(1);check(web.packageName==null&&web.browsable&&web.uri.equals(VALID),"Fallback accepts arbitrary app or destination");
        }
        for(int mapsFailure:new int[]{1,2,3})for(int httpsFailure:new int[]{1,2,3}){
            FakeOs missing=new FakeOs();missing.mapsFailure=mapsFailure;missing.httpsFailure=httpsFailure;
            check(MapsLauncher.OPEN_FAILED.equals(MapsLauncher.launch(target,missing)),"Both launches failing must return actionable error");
            check(missing.calls.size()==2,"Both-launch failure repeats requests");
        }
        FakeOs invalid=new FakeOs();check(MapsLauncher.launch(null,invalid)!=null&&invalid.calls.isEmpty(),"Invalid destination must never launch an intent");
        String[] invalidUrls={null,"","javascript:alert(1)","intent://www.google.com/maps/dir/#Intent;scheme=https;end","google.navigation:q=26,50","geo:26,50","http://www.google.com/maps/dir/?api=1&destination=26,50&travelmode=driving&dir_action=navigate",VALID.replace("www.google.com","google.com"),VALID.replace("www.google.com","www.google.com.evil.example"),VALID.replace("www.google.com","user@www.google.com"),VALID.replace("www.google.com","www.google.com:444"),VALID+"#Intent",VALID.replace("/maps/dir/","/maps/dir"),VALID.replace("/maps/dir/","/maps/%64ir/"),VALID.replace("api=1","api=2"),VALID+"&api=1",VALID+"&url=https%3A%2F%2Fevil.example",VALID.replace("&travelmode=driving",""),VALID.replace("travelmode=driving","travelmode=walking"),VALID.replace("dir_action=navigate","dir_action=preview"),VALID.replace("destination=26.437341%2C50.034499","destination=NaN%2C50"),VALID.replace("destination=26.437341%2C50.034499","destination=26%2CInfinity"),VALID.replace("destination=26.437341%2C50.034499","destination=91%2C50"),VALID.replace("destination=26.437341%2C50.034499","destination=26%2C181"),VALID.replace("destination=26.437341%2C50.034499","destination=0%2C0"),VALID.replace("destination=26.437341%2C50.034499","destination=26%2C50%2C60"),VALID.replace("destination=26.437341%2C50.034499","destination=26%2C50%26mode%3Dx"),VALID.replace("destination=26.437341%2C50.034499","destination=%2526%252C50"),VALID.replace("destination=26.437341%2C50.034499","destination=0x1p1%2C50"),VALID.replace("destination=26.437341%2C50.034499","destination=26%2C50%0A")};
        for(String url:invalidUrls){check(MapsLauncher.destination(url)==null,"Invalid Maps URL accepted: "+url);check(!allowed(RouteRules.ORIGIN+"/customers",true,false,true,"current-page-nonce",url),"Invalid URL bypasses handoff parser");}
        for(String pair:new String[]{"0%2C50","-90%2C-180","90%2C180","1e-7%2C50"})check(MapsLauncher.destination(VALID.replace("26.437341%2C50.034499",pair))!=null,"Valid coordinate boundary rejected");
        check(allowed(RouteRules.ORIGIN+"/customers",true,false,true,"current-page-nonce",VALID),"Async Maps handoff needs current trusted nonce rather than unreliable gesture");
        check(allowed(RouteRules.ORIGIN+"/customers",true,true,true,"",VALID),"Genuine trusted Maps gesture rejected");
        check(!allowed(RouteRules.ORIGIN,true,false,true,"",VALID),"No gesture/nonce should block async handoff");
        check(!allowed(RouteRules.ORIGIN,true,false,true,null,VALID),"Absent nonce should block async handoff");
        check(!allowed(RouteRules.ORIGIN,false,true,true,"nonce",VALID),"Subframe handoff allowed");
        check(!allowed(RouteRules.ORIGIN,true,true,false,"nonce",VALID),"Background handoff allowed");
        for(String page:new String[]{null,"https://evil.example",RouteRules.ORIGIN+".evil.example","http://crm.yourrest.org","https://evil@crm.yourrest.org"})check(!allowed(page,true,true,true,"nonce",VALID),"Foreign page can trigger pinned Maps handoff");
        Path source=Path.of(args.length>0?args[0]:"mobile/android/app/src/main/java/org/yourrest/crm");String activity=Files.readString(source.resolve("MainActivity.java"));
        String navigation=TripStartCheck.block(activity,"shouldOverrideUrlLoading(");
        check(navigation.contains("MapsLauncher.canHandoff(view.getUrl(),request.isForMainFrame(),request.hasGesture(),resumed,pageNonce,url)"),"WebView does not use current frame/origin/nonce guard");
        check(navigation.contains("request.isForMainFrame()&&request.hasGesture())external"),"General external navigation loses gesture requirement");
        check(!activity.contains("resolveActivity("),"Package visibility can suppress an installed Maps handler");
        String launcher=TripStartCheck.block(activity,"private String launchMaps(");
        check(launcher.contains("if(packageName!=null)intent.setPackage(packageName)")&&launcher.contains("if(browsable)intent.addCategory(Intent.CATEGORY_BROWSABLE)"),"Android adapter loses explicit package/category plan");
        check(launcher.contains("ActivityNotFoundException")&&launcher.contains("new MapsLauncher.Unavailable()"),"Missing Maps activity bypasses fallback");
        check(launcher.contains("new AlertDialog.Builder")&&launcher.contains("setMessage(problem)"),"Native URL handoff failures are silent");
        int preflight=activity.indexOf("String url=tracker.directions("),launch=activity.indexOf("String problem=launchMaps(url)",preflight),marker=activity.indexOf("maps_launch_failed:",launch);
        check(preflight>=0&&launch>preflight&&marker>launch&&activity.substring(launch,marker).contains("MapsLauncher.OPEN_FAILED.equals(problem)"),"Maps fallback marker bypasses authenticated binding preflight");
        check(activity.indexOf("catch(IllegalArgumentException invalid)",marker)>marker,"Invalid binding/coordinates must return the original authorization error");
        for(String tracker:new String[]{"ContinuousRouteTracker.java","RouteTracker.java"})check(Files.readString(source.resolve(tracker)).contains("NativeAppInfo.add(context,"),"Native state omits Maps version capability");
        String appInfo=Files.readString(source.resolve("NativeAppInfo.java"));check(appInfo.contains("getPackageInfo(context.getPackageName(),0)")&&appInfo.contains("info.versionName")&&appInfo.contains(".put(\"mapsLaunchSupported\",true)"),"App version does not report actual installed package");
        System.out.println("Native Maps launch: "+checks+" checks passed (actual parser/launcher, simulated OS; no device Maps launch verification)");
    }
}

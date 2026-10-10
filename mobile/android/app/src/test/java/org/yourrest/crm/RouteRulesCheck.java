package org.yourrest.crm;

/** Runnable without Android/emulator. Covers boundary rules, not device GPS behavior. */
public final class RouteRulesCheck {
    private static int checks;
    private static void check(boolean value){checks++;if(!value)throw new AssertionError("Check "+checks+" failed");}
    public static void main(String[] args){
        check(RouteRules.trusted("https://crm.yourrest.org/"));
        check(RouteRules.trusted("https://crm.yourrest.org:443/api/mobile-route"));
        check(!RouteRules.trusted("http://crm.yourrest.org/"));
        check(!RouteRules.trusted("https://crm.yourrest.org.evil.example/"));
        check(!RouteRules.trusted("https://crm.yourrest.org@evil.example/"));
        check(!RouteRules.trusted("https://user:pass@crm.yourrest.org/"));
        check(!RouteRules.trusted("https://crm.yourrest.org:444/"));
        check(!RouteRules.trusted("file:///data/private"));
        check(!RouteRules.trusted("javascript:alert(1)"));
        check(!RouteRules.trusted(null));
        check(RouteRules.uuid("ff7695d4-d9f6-4d40-9b17-a14dc53ca871"));
        check(!RouteRules.uuid("1-2-3-4-5"));
        check(RouteRules.identifier("journey-rep-ff7695d4-d9f6-4d40-9b17-a14dc53ca871"));
        check(!RouteRules.identifier("../another-account"));
        check(!RouteRules.identifier("user\nadmin"));
        check(!RouteRules.identifier("a".repeat(201)));
        long now=RouteRules.millis("2026-09-30T12:00:00Z");
        check(RouteRules.validFix(26.43,50.03,12,now,now,now-1));
        check(!RouteRules.validFix(26.43,50.03,12,now,now,now));
        check(!RouteRules.validFix(26.43,50.03,12,now-60001,now,0));
        check(!RouteRules.validFix(26.43,50.03,12,now+5001,now,0));
        check(!RouteRules.validFix(Double.NaN,50.03,12,now,now,0));
        check(!RouteRules.validFix(91,50.03,12,now,now,0));
        check(!RouteRules.validFix(26.43,-181,12,now,now,0));
        check(!RouteRules.validFix(0,0,12,now,now,0));
        check(!RouteRules.validFix(26.43,50.03,Float.NaN,now,now,0));
        check(!RouteRules.validFix(26.43,50.03,10001,now,now,0));
        check(!RouteRules.validFix(26.43,50.03,0,now,now,0));
        check("2026-09-30".equals(RouteRules.date(RouteRules.millis("2026-09-30T20:59:59Z"))));
        check("2026-10-01".equals(RouteRules.date(RouteRules.millis("2026-09-30T21:00:00Z"))));
        check(RouteRules.millis(RouteRules.iso(now))==now);
        check(RouteRules.millis("invalid")==0);
        long expiry=RouteRules.millis("2026-09-30T21:00:00Z");
        String exactEnd="2026-09-30T14:25:31.123Z";
        // Successful End workday -> reopening the same afternoon needs no second end mutation.
        check(RouteRules.endTimeForRestart(true,"",now,expiry).isEmpty());
        // A completed persisted day also clears cleanly on the following day.
        check(RouteRules.endTimeForRestart(true,"",expiry+3600000,expiry).isEmpty());
        // An open expired day closes exactly at its boundary, then the new day may begin.
        check(RouteRules.endTimeForRestart(false,"",expiry+3600000,expiry).equals(RouteRules.iso(expiry)));
        check(RouteRules.endTimeForRestart(false,"",now,expiry).equals(RouteRules.iso(now)));
        // Offline End retries preserve the original requested time before and after expiry.
        check(RouteRules.endTimeForRestart(false,exactEnd,now,expiry).equals(exactEnd));
        check(RouteRules.endTimeForRestart(false,exactEnd,expiry+3600000,expiry).equals(exactEnd));
        System.out.println("Native route rules: "+checks+" checks passed (no device GPS verification)");
    }
}

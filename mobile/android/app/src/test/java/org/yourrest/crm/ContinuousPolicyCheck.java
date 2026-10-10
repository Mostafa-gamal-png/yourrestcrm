package org.yourrest.crm;

/** Pure policy verification. Does not claim to exercise Android lifecycle or hardware GPS. */
public final class ContinuousPolicyCheck {
    private static int checks;
    private static void check(boolean value) {
        checks++;
        if (!value) throw new AssertionError("Check " + checks + " failed");
    }
    private static long at(String value) { return RouteRules.millis(value); }

    public static void main(String[] args) {
        // Every grant is independently necessary, and a user/OS stop blocks resume.
        // The caller must map the applicable platform permissions to these booleans.
        for (int bits = 0; bits < 64; bits++) {
            boolean enrolled = (bits & 1) != 0;
            boolean consented = (bits & 2) != 0;
            boolean precise = (bits & 4) != 0;
            boolean background = (bits & 8) != 0;
            boolean notifications = (bits & 16) != 0;
            boolean userStopped = (bits & 32) != 0;
            check(ContinuousPolicy.canResume(enrolled, consented, precise, background,
                    notifications, userStopped) == (bits == 31));
        }

        long midnight = at("2026-09-30T21:00:00.000Z");
        check(ContinuousPolicy.date(midnight - 1).equals("2026-09-30"));
        check(ContinuousPolicy.date(midnight).equals("2026-10-01"));
        check(ContinuousPolicy.dayStart(midnight) == midnight);
        check(ContinuousPolicy.dayEnd(midnight - 1) == midnight);
        check(ContinuousPolicy.dayEnd(midnight) == at("2026-10-01T21:00:00.000Z"));
        check(ContinuousPolicy.dayStart(midnight - 1) == at("2026-09-29T21:00:00.000Z"));
        check(ContinuousPolicy.date(at("2027-12-31T21:00:00.000Z")).equals("2028-01-01"));
        check(ContinuousPolicy.dayEnd(at("2028-02-28T22:00:00.000Z"))
                == at("2028-02-29T21:00:00.000Z"));
        check(ContinuousPolicy.dayEnd(at("2027-02-28T12:00:00.000Z"))
                == at("2027-02-28T21:00:00.000Z"));
        check(ContinuousPolicy.canCreateCurrentDay(null, "2026-10-01"));
        check(!ContinuousPolicy.canCreateCurrentDay("2026-09-30", "2026-10-01"));
        check(ContinuousPolicy.canCreateCurrentDay("2026-10-01", "2026-10-01"));
        check(ContinuousPolicy.canCreateCurrentDay("2026-10-02", "2026-10-01"));
        check(!ContinuousPolicy.canCreateCurrentDay("2026-12-31", "2027-01-01"));
        check(ContinuousPolicy.canCreateCurrentDay("2027-01-01", "2026-12-31"));
        check(!ContinuousPolicy.canCreateCurrentDay("2028-02-29", "2028-03-01"));
        check(ContinuousPolicy.startTime(midnight, midnight - 86400000, 0) == midnight);
        check(ContinuousPolicy.startTime(midnight, midnight + 1000, 0) == midnight + 1000);
        check(ContinuousPolicy.startTime(midnight, midnight + 1000, midnight + 2000) == midnight + 2000);
        check(ContinuousPolicy.startTime(midnight, midnight + 2000, midnight + 1000) == midnight + 2000);
        check(ContinuousPolicy.startTime(midnight, midnight, midnight) == midnight);
        check(ContinuousPolicy.startTime(midnight, midnight - 86400000, midnight - 1) == midnight);
        check(ContinuousPolicy.startTime(midnight, midnight + 1, midnight + 1) == midnight + 1);
        // Exact end is the next interval's first eligible instant, without adding an invented gap.
        long ended = midnight + 7200000;
        check(ContinuousPolicy.startTime(midnight, midnight + 3600000, ended) == ended);
        for (long sample : new long[] { midnight - 1, midnight, midnight + 1,
                at("2028-02-29T12:30:12.345Z"), at("2027-12-31T23:59:59.999Z") }) {
            check(ContinuousPolicy.dayStart(sample) <= sample);
            check(sample < ContinuousPolicy.dayEnd(sample));
            check(ContinuousPolicy.date(sample).equals(ContinuousPolicy.date(ContinuousPolicy.dayStart(sample))));
            check(!ContinuousPolicy.date(sample).equals(ContinuousPolicy.date(ContinuousPolicy.dayEnd(sample))));
        }

        String stop = "stop-a_9";
        long selected = midnight - 60000;
        check(stop.equals(ContinuousPolicy.stopIdAt(stop, selected, selected)));
        check(stop.equals(ContinuousPolicy.stopIdAt(stop, selected, midnight - 1)));
        check(ContinuousPolicy.stopIdAt(stop, selected, midnight) == null);
        check(ContinuousPolicy.stopIdAt(stop, selected, midnight + 86400000) == null);
        check(ContinuousPolicy.stopIdAt(stop, selected, selected - 1) == null);
        check(ContinuousPolicy.stopIdAt(stop, 0, midnight) == null);
        check(ContinuousPolicy.stopIdAt(stop, -1, midnight) == null);
        check(ContinuousPolicy.stopIdAt(null, selected, selected) == null);
        check(ContinuousPolicy.stopIdAt("", selected, selected) == null);
        check(ContinuousPolicy.stopIdAt("../other-user", selected, selected) == null);
        check(stop.equals(ContinuousPolicy.stopIdAt(stop, midnight, midnight + 1)));

        long now = midnight + 300000;
        check(ContinuousPolicy.validFix(26.43, 50.03, 12, now, now, now - 1));
        check(!ContinuousPolicy.validFix(26.43, 50.03, 12, now + 1, now, now - 1));
        check(!ContinuousPolicy.validFix(26.43, 50.03, 12, now, now, now));
        check(!ContinuousPolicy.validFix(26.43, 50.03, 12, now - 1, now, now));
        check(ContinuousPolicy.validFix(26.43, 50.03, 12, now - 60000, now, now - 60001));
        check(!ContinuousPolicy.validFix(26.43, 50.03, 12, now - 60001, now, now - 60002));
        check(!ContinuousPolicy.validFix(Double.NaN, 50.03, 12, now, now, now - 1));
        check(!ContinuousPolicy.validFix(26.43, Double.POSITIVE_INFINITY, 12, now, now, now - 1));
        check(!ContinuousPolicy.validFix(90.001, 50.03, 12, now, now, now - 1));
        check(!ContinuousPolicy.validFix(26.43, -180.001, 12, now, now, now - 1));
        check(!ContinuousPolicy.validFix(0, 0, 12, now, now, now - 1));
        check(!ContinuousPolicy.validFix(26.43, 50.03, Float.NaN, now, now, now - 1));
        check(!ContinuousPolicy.validFix(26.43, 50.03, Float.POSITIVE_INFINITY, now, now, now - 1));
        check(!ContinuousPolicy.validFix(26.43, 50.03, 0, now, now, now - 1));
        check(!ContinuousPolicy.validFix(26.43, 50.03, -1, now, now, now - 1));
        check(!ContinuousPolicy.validFix(26.43, 50.03, 10001, now, now, now - 1));
        check(ContinuousPolicy.validFix(26.43, 50.03, 10000, now, now, now - 1));
        // A real callback is accepted before durable queue delay; upload time is irrelevant here.
        check(ContinuousPolicy.validFix(26.43, 50.03, 12, now, now + 500, now - 1));
        long start=at("2026-10-01T03:00:00.000Z"), end=at("2026-10-01T15:00:00.000Z");
        check(!ContinuousPolicy.inWindow(start-1));
        check(ContinuousPolicy.inWindow(start));
        check(ContinuousPolicy.inWindow(start+1));
        check(ContinuousPolicy.inWindow(end-1));
        check(!ContinuousPolicy.inWindow(end));
        check(!ContinuousPolicy.inWindow(end+1));
        check(!ContinuousPolicy.inWindow(midnight));
        check(ContinuousPolicy.windowStart(start)==start);
        check(ContinuousPolicy.windowEnd(start)==end);
        check(ContinuousPolicy.nextBoundary(start-1)==start);
        check(ContinuousPolicy.nextBoundary(start)==end);
        check(ContinuousPolicy.nextBoundary(end-1)==end);
        long saturdayStart=at("2026-10-03T03:00:00.000Z");
        check(ContinuousPolicy.nextBoundary(end)==saturdayStart);
        check(ContinuousPolicy.nextStart(start-1)==start);
        check(ContinuousPolicy.nextStart(start)==saturdayStart);
        check(ContinuousPolicy.nextStart(end)==saturdayStart);
        check(ContinuousPolicy.canCapture(start,start));
        check(!ContinuousPolicy.canCapture(start-1,start));
        check(ContinuousPolicy.canCapture(end-1,end-1));
        check(!ContinuousPolicy.canCapture(end,end));
        check(!ContinuousPolicy.canCapture(end-1,end));
        check(!ContinuousPolicy.canCapture(start,start-1));
        // Friday is excluded in Saudi time, including UTC Thursday after 21:00.
        for(String friday:new String[]{"2026-10-01T21:00:00.000Z","2026-10-02T02:59:59.999Z",
                "2026-10-02T03:00:00.000Z","2026-10-02T09:00:00.000Z",
                "2026-10-02T14:59:59.999Z","2026-10-02T15:00:00.000Z","2026-10-02T20:59:59.999Z"}){
            long instant=at(friday);
            check(!ContinuousPolicy.inWindow(instant));
            check(!ContinuousPolicy.canCapture(instant,instant));
            check(ContinuousPolicy.nextBoundary(instant)==saturdayStart);
            check(ContinuousPolicy.nextStart(instant)==saturdayStart);
        }
        check(!ContinuousPolicy.canCapture(at("2026-10-02T09:00:00.000Z"),saturdayStart));
        check(!ContinuousPolicy.canCapture(end-1,at("2026-10-02T09:00:00.000Z")));
        check(ContinuousPolicy.nextBoundary(saturdayStart-1)==saturdayStart);
        check(ContinuousPolicy.nextBoundary(saturdayStart)==at("2026-10-03T15:00:00.000Z"));
        check(ContinuousPolicy.nextStart(saturdayStart)==at("2026-10-04T03:00:00.000Z"));
        // Upload uses the original capture date; Friday receipt cannot reject Thursday evidence.
        check(ContinuousPolicy.uploadDateAllowed("2026-10-01"));
        check(!ContinuousPolicy.uploadDateAllowed("2026-10-02"));
        check(ContinuousPolicy.uploadDateAllowed("2026-10-03"));
        check(!ContinuousPolicy.uploadDateAllowed(null));
        check(!ContinuousPolicy.uploadDateAllowed("2026-02-30"));
        check(!ContinuousPolicy.uploadDateAllowed("2026-10-2"));
        java.util.List<String> capturedDates=java.util.Arrays.asList("2026-10-01","2026-10-02","2026-10-03");
        check(capturedDates.stream().filter(ContinuousPolicy::uploadDateAllowed).collect(java.util.stream.Collectors.toList())
                .equals(java.util.Arrays.asList("2026-10-01","2026-10-03")));
        check(capturedDates.size()==3 && capturedDates.get(1).equals("2026-10-02"));
        check(java.util.Arrays.asList("2026-10-02","2026-10-03").stream().filter(ContinuousPolicy::uploadDateAllowed).findFirst().orElse("").equals("2026-10-03"));
        check(java.util.Arrays.asList("2026-10-02").stream().noneMatch(ContinuousPolicy::uploadDateAllowed));
        check(ContinuousPolicy.nextBoundary(at("2027-12-31T20:59:59.999Z"))==at("2028-01-01T03:00:00.000Z"));
        check(ContinuousPolicy.nextBoundary(at("2028-02-29T15:00:00.000Z"))==at("2028-03-01T03:00:00.000Z"));
        java.util.TimeZone priorZone=java.util.TimeZone.getDefault();
        try{for(String deviceZone:new String[]{"UTC","America/Los_Angeles","Pacific/Auckland","Asia/Riyadh"}){
            java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone(deviceZone));
            check(ContinuousPolicy.inWindow(start));check(!ContinuousPolicy.inWindow(end));
            check(ContinuousPolicy.windowStart(end)==start);check(ContinuousPolicy.windowEnd(start)==end);
            check(ContinuousPolicy.nextBoundary(end)==saturdayStart);
            check(!ContinuousPolicy.inWindow(at("2026-10-02T09:00:00.000Z")));
            check(ContinuousPolicy.nextBoundary(at("2026-10-02T02:00:00.000Z"))==saturdayStart);
        }}finally{java.util.TimeZone.setDefault(priorZone);}
        // A full Thursday–Wednesday week covers all six permitted days and the excluded Friday.
        for(int day=0;day<7;day++)for(int minute=0;minute<24*60;minute++){
            long instant=midnight+day*86400000L+minute*60000L;
            check(ContinuousPolicy.inWindow(instant)==(day!=1&&minute>=360&&minute<1080));
            check(ContinuousPolicy.nextBoundary(instant)>instant);
            check(ContinuousPolicy.canCapture(instant,instant)==ContinuousPolicy.inWindow(instant));
        }
        System.out.println("Native continuous policy: " + checks + " checks passed (no device GPS verification)");
    }
}

package org.yourrest.crm;

import java.time.Instant;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/** Pure Saudi working-hours rules; no permission prompts or automatic opt-in. */
final class ContinuousPolicy {
    private static final ZoneId RIYADH = ZoneId.of("Asia/Riyadh");

    /** Stored enrollment never overrides the user's stop, consent, or current OS grants. */
    static boolean canResume(boolean enrolled, boolean consented, boolean precise,
                             boolean background, boolean notifications, boolean userStopped) {
        return enrolled && consented && precise && background && notifications && !userStopped;
    }

    static String date(long epochMs) {
        return Instant.ofEpochMilli(epochMs).atZone(RIYADH).toLocalDate().toString();
    }

    /** Inclusive beginning of the captured sample's Saudi calendar day. */
    static long dayStart(long epochMs) {
        return Instant.ofEpochMilli(epochMs).atZone(RIYADH).toLocalDate()
                .atStartOfDay(RIYADH).toInstant().toEpochMilli();
    }

    /** Exclusive boundary: a fix exactly at this instant belongs to the next day. */
    static long dayEnd(long epochMs) {
        return Instant.ofEpochMilli(epochMs).atZone(RIYADH).toLocalDate().plusDays(1)
                .atStartOfDay(RIYADH).toInstant().toEpochMilli();
    }

    /** Collection is permitted from 06:00 inclusive to 18:00 exclusive, except Friday. */
    static boolean inWindow(long epochMs) {
        ZonedDateTime local = Instant.ofEpochMilli(epochMs).atZone(RIYADH);
        return local.getDayOfWeek() != DayOfWeek.FRIDAY
                && local.getHour() >= 6 && local.getHour() < 18;
    }

    static long windowStart(long epochMs) {
        return Instant.ofEpochMilli(epochMs).atZone(RIYADH).toLocalDate()
                .atTime(6, 0).atZone(RIYADH).toInstant().toEpochMilli();
    }

    static long windowEnd(long epochMs) {
        return Instant.ofEpochMilli(epochMs).atZone(RIYADH).toLocalDate()
                .atTime(18, 0).atZone(RIYADH).toInstant().toEpochMilli();
    }

    /** Always future: midnight and phone timezone settings never open collection. */
    static long nextBoundary(long epochMs) {
        return inWindow(epochMs) ? windowEnd(epochMs) : nextStart(epochMs);
    }

    static long nextStart(long epochMs) {
        LocalDate candidate = Instant.ofEpochMilli(epochMs).atZone(RIYADH).toLocalDate();
        if (epochMs >= windowStart(epochMs)) candidate = candidate.plusDays(1);
        while (candidate.getDayOfWeek() == DayOfWeek.FRIDAY) candidate = candidate.plusDays(1);
        return candidate.atTime(6, 0).atZone(RIYADH).toInstant().toEpochMilli();
    }

    /** Captured date, never upload time: pre-upgrade Friday rows remain locally quarantined. */
    static boolean uploadDateAllowed(String capturedDate) {
        try {
            LocalDate date = LocalDate.parse(capturedDate);
            return date.toString().equals(capturedDate) && date.getDayOfWeek() != DayOfWeek.FRIDAY;
        } catch (RuntimeException invalidDate) { return false; }
    }

    /** No cached/provider callback can insert a sample outside the permitted capture window. */
    static boolean canCapture(long capturedAt, long callbackAt) {
        return inWindow(capturedAt) && inWindow(callbackAt);
    }

    /** Dates are canonical yyyy-MM-dd strings; drain earlier captured dates before opening today. */
    static boolean canCreateCurrentDay(String earliestQueuedDate, String today) {
        return earliestQueuedDate == null || earliestQueuedDate.compareTo(today) >= 0;
    }

    /** Never reopen an interval before enrollment or before the previous interval ended. */
    static long startTime(long windowStart, long enrolledServerAt, long priorEndedAt) {
        return Math.max(windowStart, Math.max(enrolledServerAt, priorEndedAt));
    }

    /** A previous day's selected visit must never acquire a later day's background points. */
    static String stopIdAt(String stopId, long selectedAt, long capturedAt) {
        if (!RouteRules.identifier(stopId) || selectedAt <= 0 || capturedAt < selectedAt
                || !date(selectedAt).equals(date(capturedAt))) return null;
        return stopId;
    }

    /** Reuse the audited fix boundary; queued upload time must not replace callback time. */
    static boolean validFix(double latitude, double longitude, float accuracy,
                            long capturedAt, long callbackAt, long lastCapturedAt) {
        return RouteRules.validFix(latitude, longitude, accuracy,
                capturedAt, callbackAt, lastCapturedAt);
    }

    private ContinuousPolicy() { }
}

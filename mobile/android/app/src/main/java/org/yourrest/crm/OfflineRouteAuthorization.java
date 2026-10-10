package org.yourrest.crm;

/** A bounded local collection lease. It is not a credential and never authorizes server uploads. */
final class OfflineRouteAuthorization {
    static final long LEASE_MS = 7L * 24 * 60 * 60 * 1000;
    static final long CLOCK_TOLERANCE_MS = 60000;

    static boolean valid(String owner, String scope, String role, String savedOwner,
                         String savedScope, String savedRole, long verifiedAt,
                         long observedAt, long now) {
        if (!RouteRules.identifier(owner) || scope == null || scope.isEmpty()
                || !"rep".equals(role) || !owner.equals(savedOwner)
                || !scope.equals(savedScope) || !role.equals(savedRole)
                || verifiedAt <= 0 || observedAt < verifiedAt || now <= 0) return false;
        // A reboot never extends the lease; a backward clock cannot reset its age.
        if (now < verifiedAt || now < observedAt - CLOCK_TOLERANCE_MS) return false;
        long age = Math.max(now, observedAt) - verifiedAt;
        return age >= 0 && age < LEASE_MS;
    }

    static boolean transientStatus(int status) {
        return status == 408 || status == 429 || status >= 500 && status <= 599;
    }

    /** A foreign pending point or gap, including Friday quarantine, must keep its original owner. */
    static boolean canResetEmptyOwner(String owner,String authenticatedOwner,int points,int gaps) {
        return RouteRules.identifier(owner) && RouteRules.identifier(authenticatedOwner)
                && !owner.equals(authenticatedOwner) && points == 0 && gaps == 0;
    }

    private OfflineRouteAuthorization() { }
}

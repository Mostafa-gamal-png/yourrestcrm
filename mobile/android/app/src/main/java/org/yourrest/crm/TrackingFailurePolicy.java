package org.yourrest.crm;

/** Separates revoked identity/scope from retryable or rejected immutable upload evidence. */
final class TrackingFailurePolicy {
    static boolean authenticationRejected(int status){return status==401||status==403;}
    static boolean recheckDevice(int status){return status==409;}
    static boolean dataRejected(int status){return status==400||status==404||status==409;}
    private TrackingFailurePolicy(){ }
}

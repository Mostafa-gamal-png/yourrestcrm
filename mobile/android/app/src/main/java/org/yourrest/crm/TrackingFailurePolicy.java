package org.yourrest.crm;

/** Separates revoked identity/scope from retryable or rejected immutable upload evidence. */
final class TrackingFailurePolicy {
    static boolean authenticationRejected(int status){return status==401||status==403;}
    static boolean recheckDevice(int status){return status==409;}
    static boolean dataRejected(int status){return status==400||status==404||status==409;}
    /** Held evidence of an earlier scope (1.0.16): a definite refusal waits a day; a lost session, a timeout or a busy server is asked again. */
    static boolean heldRefused(int status){return status>=400&&status<500&&status!=401&&status!=408&&status!=429;}
    private TrackingFailurePolicy(){ }
}

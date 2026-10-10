package org.yourrest.crm;

/** One foreground Maps tap may complete its already-enrolled stop bind while Maps is visible. */
final class ForegroundMapsHandoff {
    private final String nonce,memberId;
    private final double latitude,longitude;
    private final long expiresAt;
    ForegroundMapsHandoff(String nonce,String memberId,double latitude,double longitude,long elapsedNow){
        if(nonce==null||nonce.isEmpty()||!RouteRules.identifier(memberId)||!RouteRules.validCoordinates(latitude,longitude))throw new IllegalArgumentException("Invalid Maps handoff");
        this.nonce=nonce;this.memberId=memberId;this.latitude=latitude;this.longitude=longitude;this.expiresAt=elapsedNow+30000;
    }
    boolean accepts(String nonce,String memberId,long elapsedNow){return this.nonce.equals(nonce)&&this.memberId.equals(memberId)&&elapsedNow>=expiresAt-30000&&elapsedNow<expiresAt;}
    boolean matches(double latitude,double longitude,long elapsedNow){return this.latitude==latitude&&this.longitude==longitude&&elapsedNow>=expiresAt-30000&&elapsedNow<expiresAt;}
}

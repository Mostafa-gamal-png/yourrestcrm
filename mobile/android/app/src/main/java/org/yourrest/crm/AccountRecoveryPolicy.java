package org.yourrest.crm;

/** Changed server-authorized context can replace metadata only after all evidence is acknowledged. */
final class AccountRecoveryPolicy {
    enum Decision { UNCHANGED, RESET_EMPTY, PRESERVE_BLOCKED, WRONG_OWNER }
    static Decision decide(String owner,String authenticatedOwner,String oldScope,String scope,String oldRole,String role,int points,int gaps){
        if(owner==null||!owner.equals(authenticatedOwner))return Decision.WRONG_OWNER;
        if(oldScope.equals(scope)&&oldRole.equals(role))return Decision.UNCHANGED;
        return points==0&&gaps==0?Decision.RESET_EMPTY:Decision.PRESERVE_BLOCKED;
    }
    private AccountRecoveryPolicy(){ }
}

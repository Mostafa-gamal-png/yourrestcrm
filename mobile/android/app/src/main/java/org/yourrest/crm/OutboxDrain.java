package org.yourrest.crm;

/** Orders durable gaps before later fixes, including retries and capped foreground passes. */
final class OutboxDrain {
    interface Source {
        long earliestGapTime() throws Exception;
        boolean uploadPointsThrough(long cutoff) throws Exception;
        boolean uploadEarliestGap() throws Exception;
    }
    static void run(Source source,int maxOperations)throws Exception{
        for(int operation=0;operation<maxOperations;operation++){
            long cutoff=source.earliestGapTime();
            if(source.uploadPointsThrough(cutoff))continue;
            if(cutoff!=Long.MAX_VALUE&&source.uploadEarliestGap())continue;
            break;
        }
    }
    private OutboxDrain(){ }
}

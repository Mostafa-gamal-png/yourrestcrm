package org.yourrest.crm;
import java.util.ArrayDeque;
import java.util.Deque;
import org.json.JSONObject;
/** Stand-in for the HTTPS read: the server's current list (a JSON text, or null for no network), and one-off answers queued before it
 *  (an HTTP status, or a JSON text). Every request is counted. */
class NearbyApi {
    static final class Failure extends Exception { final int status; Failure(int status, String message) { super(message); this.status = status; } }
    static final Deque<Object> answers = new ArrayDeque<>();
    static volatile String current;
    static int calls;
    JSONObject fetch() throws Exception {
        Object next;
        synchronized (NearbyApi.class) { calls++; next = answers.poll(); if (next == null) next = current; }
        if (next == null) throw new java.io.IOException("offline");
        if (next instanceof Integer) throw new Failure((Integer) next, "refused");
        return new JSONObject((String) next);
    }
}

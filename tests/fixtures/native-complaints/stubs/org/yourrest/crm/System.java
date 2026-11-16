package org.yourrest.crm;
/** Stand-in for java.lang.System inside the package under check: the wall clock the checks move by hand. */
final class System { static long now; static long currentTimeMillis() { return now; } }

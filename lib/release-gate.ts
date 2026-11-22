/** When the rules of 2026-11-22 (the port of GSCO 2.13.85: the plan's targets and follow-ups, «أخرى» named in 3 to 200 characters) apply
 * from, for the requests the device kept in its outbox before this release was installed (an offline entry carries the moment it was
 * recorded: lib/offline-server.ts offlineCapture). The later of the release day and this server's start: a restart by the host only widens
 * the window for such entries. A live request never carries an offline moment, so it always meets the new rules. */
export const RULES_RELEASED='2026-11-22T00:00:00.000Z';
const serverStarted=new Date().toISOString();
export const rulesSince=()=>Date.parse(serverStarted)>Date.parse(RULES_RELEASED)?serverStarted:RULES_RELEASED;
/** An entry kept on the device before the update: its device moment is earlier than rulesSince(). */
export const queuedBeforeRelease=(capturedAt:string|null|undefined)=>!!capturedAt&&Date.parse(capturedAt)<Date.parse(rulesSince());

// A stand-in of the Android app 1.0.16's continuous route tracker (mobile/android/.../ContinuousRouteTracker.java and ContinuousRouteStore.java)
// for tests that drive the BUILT server over HTTP. It sends exactly what the app sends to /api/mobile-route (the same bodies, the same order,
// the same checks of the answers) and takes the same decisions when the account changes (AccountRecoveryPolicy: same owner, a changed scope
// or tracking role holds what was not uploaded under the scope it was captured with, and the tracker enrolls the new scope at once for a
// representative), when the session is refused (collection stops, the evidence stays), and when another account signs in on the phone
// (the evidence never changes owner). The Java code is the reference: a change there is mirrored here (the methods carry the Java names).
// What it does not play: Android's life cycle, GPS, the foreground service, the device's storage. Made-up places only.

const RIYADH_MS = 3 * 3600_000;
/** The tracking day of an instant, in Riyadh (ContinuousPolicy.date). */
export const riyadhDate = ms => new Date(ms + RIYADH_MS).toISOString().slice(0, 10);
/** 06:00 Riyadh of a day (ContinuousPolicy.windowStart for a working day). */
export const windowStart = date => Date.parse(date + 'T06:00:00.000+03:00');
export const windowEnd = date => Date.parse(date + 'T18:00:00.000+03:00');
export const inWindow = ms => { const date = riyadhDate(ms), weekday = new Date(date + 'T12:00:00Z').getUTCDay(); return weekday !== 5 && ms >= windowStart(date) && ms < windowEnd(date); };
const iso = ms => new Date(ms).toISOString();

export class Failure extends Error { constructor(status, message) { super(message); this.status = status; } }
const authenticationRejected = status => status === 401 || status === 403;
const heldRefused = status => status >= 400 && status < 500 && ![401, 408, 409, 429].includes(status);

export class PhoneStandIn {
  /** `send(method, body, cookie)` answers {status, json}; `clock()` is the phone's time (the tests shift it with the server's). */
  constructor({send, clock, deviceId = crypto.randomUUID()}) {
    this.send = send; this.clock = clock; this.deviceId = deviceId; this.cookie = '';
    this.meta = {}; this.days = new Map(); this.points = []; this.gaps = []; this.held = []; this.heldDays = new Map();
    this.error = ''; this.syncError = ''; this.heldError = ''; this.tracking = false; this.log = [];
  }
  // ---- the session the web view holds
  signIn(cookie) { this.cookie = cookie; }
  async api(body) {
    const answer = await this.send(body ? 'POST' : 'GET', body, this.cookie);
    this.log.push((body ? body.action + (body.held ? ' held' : '') : 'status') + ' ' + answer.status);
    let json; try { json = answer.json(); } catch { throw new Failure(answer.status, 'تعذر الاتصال بتقرير خط السير'); }
    if (answer.status < 200 || answer.status >= 300) throw new Failure(answer.status, json.error || 'تعذر مزامنة خط السير');
    return json;
  }
  // ---- the store (ContinuousRouteStore), what matters of it here
  key(date) { if (!this.days.has(date)) this.days.set(date, {key: crypto.randomUUID(), day: null}); return this.days.get(date).key; }
  firstDate() { const dates = [...this.points.map(p => p.date), ...this.gaps.map(g => g.date)].sort(); return dates[0] || null; }
  count() { return this.points.length; }
  gapCount() { return this.gaps.length; }
  /** holdForChangedAccount: every queued point and gap moves, unchanged, under its date's create key, the scope and the owner it was
   * captured with; the outbox days and the enrollment are forgotten. */
  holdForChangedAccount() {
    const owner = this.meta.memberId, scope = this.meta.regionScope;
    if (!owner || !scope) return false;
    for (const date of new Set([...this.points.map(p => p.date), ...this.gaps.map(g => g.date)])) {
      const entry = this.days.get(date) || {key: crypto.randomUUID(), day: null};
      let group = this.held.find(item => item.key === entry.key);
      if (!group) { group = {key: entry.key, member: owner, scope, date, day: entry.day, points: [], gaps: [], refusedUntil: 0, conflicts: 0}; this.held.push(group); }
      group.points.push(...this.points.filter(p => p.date === date)); group.gaps.push(...this.gaps.filter(g => g.date === date));
    }
    this.points = []; this.gaps = []; this.days.clear(); this.meta = {};
    return true;
  }
  resetEmptyContext() { if (this.count() || this.gapCount()) return false; this.days.clear(); this.meta = {}; return true; }
  heldCount() { return this.held.filter(g => uploadDate(g.date)).reduce((n, g) => n + g.points.length, 0); }
  heldGapCount() { return this.held.filter(g => uploadDate(g.date)).reduce((n, g) => n + g.gaps.length, 0); }
  firstHeld(owner, now) { return this.held.filter(g => g.member === owner && uploadDate(g.date) && g.refusedUntil <= now && (g.points.length || g.gaps.length)).sort((a, b) => a.date.localeCompare(b.date))[0] || null; }
  /** unholdInto: a held group of this owner and scope whose day is the one the server hands back returns to the outbox. */
  unholdInto(owner, scope, date, dayId) {
    const group = this.held.find(g => g.member === owner && g.scope === scope && g.date === date && (g.day?.id === dayId || 'mobile-' + owner + '-' + g.key === dayId));
    if (!group) return;
    this.days.set(date, {key: group.key, day: group.day});
    this.points.push(...group.points); this.gaps.push(...group.gaps);
    this.held = this.held.filter(g => g !== group);
  }
  // ---- the tracker
  /** A real location callback (onFix): kept only while collecting, inside the window, after enrollment. */
  capture(at, latitude, longitude, accuracy = 12) {
    if (!this.enabled() || !inWindow(at) || at < Number(this.meta.enrolledAt || 0)) return false;
    this.points.push({id: crypto.randomUUID(), capturedAt: iso(at), at, date: riyadhDate(at), latitude, longitude, accuracy, stopId: null});
    return true;
  }
  /** A gap the service records (a permission taken away, GPS lost). */
  gap(reason, at) { if (!this.meta.memberId) return; this.gaps.push({id: crypto.randomUUID(), reason, at, date: riyadhDate(at)}); }
  enabled() { return this.meta.enabled === '1' && this.meta.loggedOut !== '1'; }
  verify(response, member) {
    if (member !== response.memberId || response.memberRole !== 'rep') throw new Failure(403, 'الحساب الحالي لا يطابق مندوب التسجيل');
    if (this.meta.regionScope && this.meta.regionScope !== response.regionScope) throw new Failure(403, 'تغير نطاق صلاحية المندوب');
    const day = response.day;
    if (day && (day.memberId !== member || day.deviceId !== this.deviceId)) throw new Failure(409, 'التسجيل مرتبط بجهاز آخر');
  }
  resetEmptyOwnerForAccount(response, member) {
    if (member !== response.memberId) throw new Failure(403, 'الحساب الحالي لا يطابق مراجعة بيانات الجهاز');
    const owner = this.meta.memberId;
    if (!owner) { if (this.count() || this.gapCount()) throw new Failure(403, 'خط سير محفوظ بدون هوية مكتملة'); return false; }
    if (owner === member) return false;
    if (this.count() || this.gapCount()) throw new Failure(403, 'النقاط المحفوظة تخص حسابًا سابقًا؛ سجّل الدخول بحسابها لرفعها قبل تغيير الحساب');
    this.disable(); if (!this.resetEmptyContext()) throw new Failure(403, 'ظهرت نقاط جديدة'); return true;
  }
  /** AccountRecoveryPolicy.decide for the same owner. */
  decide(response) {
    const oldRole = this.meta.memberRole || 'rep', oldScope = this.meta.regionScope;
    if (oldScope === response.regionScope && oldRole === response.memberRole) return 'UNCHANGED';
    return this.count() || this.gapCount() ? 'PRESERVE_BLOCKED' : 'RESET_EMPTY';
  }
  disable() { this.meta.enabled = '0'; this.tracking = false; }
  /** The page's «refreshAccount» (app/journey-tracker.tsx reconcileAccount): asked when the account the page signed in with differs from
   * the phone's enrollment. `granted` is the phone's own state: consent, the location permission all the time, not stopped by the user. */
  async refreshAccount(member, {granted = true} = {}) {
    try {
      const response = await this.api(null);
      if (member !== response.memberId) throw new Failure(403, 'الحساب الحالي لا يطابق مراجعة أذونات خط السير');
      if (response.day && response.day.deviceId !== this.deviceId) throw new Failure(409, 'التتبع الحالي مرتبط بجهاز آخر؛ راجع الإدارة');
      if (this.resetEmptyOwnerForAccount(response, member)) { this.error = ''; return this.status(); }
      const decision = this.decide(response);
      if (decision === 'PRESERVE_BLOCKED' || decision === 'RESET_EMPTY') {
        const resume = response.memberRole === 'rep' && granted && this.meta.userStopped !== '1';
        this.disable();
        if (decision === 'PRESERVE_BLOCKED') { if (!this.holdForChangedAccount()) throw new Failure(403, 'تعذر حفظ النقاط السابقة على الجهاز بمنطقتها'); }
        else if (!this.resetEmptyContext()) throw new Error('ظهرت نقاط جديدة قبل مراجعة الأذونات');
        this.error = ''; this.syncError = '';
        if (resume) return await this.enroll(member, {granted});
        return this.status();
      }
      this.meta.memberRole = response.memberRole; this.meta.loggedOut = '0'; this.error = '';
      return this.status();
    } catch (failure) { this.handle(failure); throw failure; }
  }
  recoverEmptyScopeForEnrollment(response, member) {
    if (member !== response.memberId || response.memberRole !== 'rep') return;
    const scope = this.meta.regionScope; if (!scope || scope === response.regionScope) return;
    this.disable();
    if (this.resetEmptyContext()) return;
    if (member !== this.meta.memberId || !this.holdForChangedAccount()) throw new Failure(403, 'تغيرت منطقة الحساب؛ محفوظ ' + this.count() + ' نقطة');
  }
  /** The page's «enroll» (the representative's «تفعيل التتبع», or the phone itself after a changed account). */
  async enroll(member, {granted = true} = {}) {
    if (!granted) throw new Error('يلزم الموافقة على تسجيل الموقع');
    try {
      const response = await this.api(null);
      this.resetEmptyOwnerForAccount(response, member);
      this.recoverEmptyScopeForEnrollment(response, member); this.verify(response, member);
      if (!this.meta.enrolledAt) { Object.assign(this.meta, {memberId: member, regionScope: response.regionScope, enrolledAt: String(this.clock()), enrolledServerAt: response.serverTime}); }
      this.meta.memberRole = response.memberRole;
      if (response.day && response.day.endedAt === null) this.adoptDay(member, response.day);
      await this.ensureCurrentWhenReady();
      Object.assign(this.meta, {loggedOut: '0', userStopped: '0', enabled: '1'}); this.error = ''; this.tracking = inWindow(this.clock());
      return this.status();
    } catch (failure) { this.handle(failure); throw failure; }
  }
  /** A phone enrolled days before the test began (enrolledAt and the server's time of its enrollment). */
  enrolledSince(ms) { this.meta.enrolledAt = String(ms); this.meta.enrolledServerAt = iso(ms); }
  adoptDay(owner, day) { this.unholdInto(owner, this.meta.regionScope, day.date, day.id); const entry = this.days.get(day.date) || {key: this.key(day.date), day: null}; entry.day = day; this.days.set(day.date, entry); }
  async ensureDay(date) {
    const entry = this.days.get(date);
    if (entry?.day) return entry.day;
    const first = Math.max(windowStart(date), Date.parse(this.meta.enrolledServerAt || 0) || 0);
    const owner = this.meta.memberId;
    const response = await this.api({action: 'begin', createKey: this.key(date), deviceId: this.deviceId, continuous: true, regionScope: this.meta.regionScope, date, startedAt: iso(first)});
    this.verify(response, owner);
    const day = response.day;
    if (!day) throw new Failure(0, 'no day for ' + date);
    if (day.date !== date) throw new Failure(409, 'تاريخ التسجيل غير مطابق');
    this.adoptDay(owner, day); return day;
  }
  async ensureCurrentWhenReady() { const now = this.clock(); if (!inWindow(now)) return; const today = riyadhDate(now), queued = this.firstDate(); if (queued === null || queued >= today) await this.ensureDay(today); }
  request(action, day) { return {action, dayId: day.id, deviceId: this.deviceId}; }
  verifyDay(response, sent) { const day = response.day; if (!day || day.id !== sent.id || day.date !== sent.date) throw new Failure(409, 'استجابة التسجيل لا تطابق اليوم المطلوب'); }
  /** One sync pass (flushInternal): the outbox oldest date first, then held evidence of an earlier scope, a few requests each. */
  async flushInternal(maxOperations = 1) {
    if (!this.meta.memberId || this.meta.loggedOut === '1') return;
    const owner = this.meta.memberId;
    const auth = await this.api(null); this.verify(auth, owner);
    try {
      for (let operation = 0; operation < maxOperations; operation++) {
        const date = this.firstDate(); if (date === null) break;
        const day = await this.ensureDay(date);
        const gap = this.gaps.filter(g => g.date === date).sort((a, b) => a.at - b.at)[0] || null;
        const batch = this.points.filter(p => p.date === date && (!gap || p.at < gap.at)).sort((a, b) => a.at - b.at).slice(0, 50);
        if (batch.length) {
          const result = await this.api({...this.request('samples', day), points: batch.map(({id, capturedAt, latitude, longitude, accuracy, stopId}) => ({id, capturedAt, latitude, longitude, accuracy, stopId}))});
          this.verify(result, owner); this.verifyDay(result, day);
          const acknowledged = new Set(result.acknowledgedIds || []), before = this.points.length;
          this.points = this.points.filter(p => !acknowledged.has(p.id)); this.days.get(date).day = result.day;
          if (before === this.points.length) throw new Error('لم يؤكد الخادم حفظ النقاط');
        } else if (gap) {
          const result = await this.api({...this.request('gap', day), reason: gap.reason, at: iso(gap.at)});
          this.verify(result, owner); this.verifyDay(result, day); this.days.get(date).day = result.day; this.gaps = this.gaps.filter(g => g !== gap);
        } else break;
      }
      if (this.enabled()) await this.ensureCurrentWhenReady();
    } catch (outbox) {
      const unreachable = !(outbox instanceof Failure) || authenticationRejected(outbox.status);
      if (!unreachable) await this.drainHeld(owner, 3);
      throw outbox;
    }
    await this.drainHeld(owner, 3);
  }
  async drainHeld(owner, operations) {
    for (let operation = 0; operation < operations; operation++) {
      const now = this.clock(), group = this.firstHeld(owner, now);
      if (!group) { this.held = this.held.filter(g => g.points.length || g.gaps.length); if (!this.heldCount() && !this.heldGapCount()) this.heldError = ''; return; }
      try {
        const day = await this.ensureHeldDay(group, owner);
        if (!day) { group.refusedUntil = now + 24 * 3600_000; this.heldError = 'لم يقبل الخادم يوم ' + group.date; continue; }
        const gap = group.gaps.slice().sort((a, b) => a.at - b.at)[0] || null;
        const batch = group.points.filter(p => !gap || p.at < gap.at).sort((a, b) => a.at - b.at).slice(0, 50);
        if (batch.length) {
          const result = await this.api({...this.request('samples', day), held: true, points: batch.map(({id, capturedAt, latitude, longitude, accuracy}) => ({id, capturedAt, latitude, longitude, accuracy, stopId: null}))});
          this.verifyHeld(result, owner, day);
          const acknowledged = new Set(result.acknowledgedIds || []), before = group.points.length;
          group.points = group.points.filter(p => !acknowledged.has(p.id)); group.day = result.day;
          if (before === group.points.length) throw new Error('لم يؤكد الخادم حفظ نقاط المنطقة السابقة');
        } else if (gap) {
          const result = await this.api({...this.request('gap', day), held: true, reason: gap.reason, at: iso(gap.at), stopId: null});
          this.verifyHeld(result, owner, day); group.day = result.day; group.gaps = group.gaps.filter(g => g !== gap);
        }
        this.heldError = '';
      } catch (failure) {
        if (failure instanceof Failure && failure.status === 409) { group.conflicts++; if (group.conflicts >= 3) { group.refusedUntil = now + 24 * 3600_000; group.conflicts = 0; } this.heldError = failure.message; return; }
        if (failure instanceof Failure && heldRefused(failure.status)) { group.refusedUntil = now + 24 * 3600_000; this.heldError = 'لم يقبل الخادم نقاط ' + group.date + ': ' + failure.message; continue; }
        this.heldError = failure.message; return;
      }
    }
  }
  async ensureHeldDay(group, owner) {
    if (group.day) return group.day;
    const times = [...group.points.map(p => p.at), ...group.gaps.map(g => g.at)];
    if (!times.length) return null;
    const response = await this.api({action: 'begin', held: true, createKey: group.key, deviceId: this.deviceId, continuous: true, regionScope: group.scope, date: group.date, startedAt: iso(Math.min(...times)), endedAt: iso(Math.max(...times) + 1000)});
    if (owner !== response.memberId) throw new Failure(403, 'الحساب الحالي لا يطابق صاحب نقاط المنطقة السابقة');
    const day = response.day; if (!day) return null;
    if (day.date !== group.date || day.regionScope !== group.scope || day.memberId !== owner || day.deviceId !== this.deviceId) throw new Failure(409, 'يوم المنطقة السابقة على الخادم لا يطابق النقاط المحفوظة');
    group.day = day; return day;
  }
  verifyHeld(response, owner, sent) { if (owner !== response.memberId) throw new Failure(403, 'الحساب الحالي لا يطابق صاحب نقاط المنطقة السابقة'); this.verifyDay(response, sent); }
  /** handle / handleSync: a refused session or account stops collection (enabled = 0), never deletes evidence. */
  handle(failure) {
    this.error = failure.message;
    if (failure instanceof Failure && (authenticationRejected(failure.status) || failure.status === 409)) this.disable();
  }
  /** The service's periodic sync and the page's «flush»: passes until nothing moves or a pass fails. */
  async sync(passes = 40) {
    for (let pass = 0; pass < passes; pass++) {
      const before = JSON.stringify([this.count(), this.gapCount(), this.heldCount(), this.heldGapCount()]);
      try { await this.flushInternal(1); this.syncError = ''; }
      catch (failure) { this.syncError = failure.message; if (failure instanceof Failure && authenticationRejected(failure.status)) this.handle(failure); return failure; }
      if (JSON.stringify([this.count(), this.gapCount(), this.heldCount(), this.heldGapCount()]) === before) return null;
    }
    return null;
  }
  logout() { this.meta.loggedOut = '1'; this.disable(); if (!this.count() && !this.gapCount()) this.resetEmptyContext(); }
  /** What the page does when it opens signed in as `me` (app/journey-tracker.tsx, the effect that reads the phone's status): another
   * account's enrollment is signed out of the phone; a changed scope or tracking role of this account asks «refreshAccount»; a phone that
   * holds this representative's enrollment, collecting or stopped by an ended session or a sign-out, is enrolled again without a tap (a
   * refusal then leaves it to the representative's «تفعيل التتبع»). Anything else waits for that button. */
  async openPage(me) {
    const field = me.role === 'rep' || me.role === 'marketing', role = field ? 'rep' : me.role, scope = me.regionScope || 'all';
    let state = this.status();
    if (state.memberId && state.memberId !== me.id) { this.logout(); state = this.status(); }
    const changed = state.memberId === me.id && (!!state.regionScope && state.regionScope !== scope || !!state.enrolledRole && state.enrolledRole !== role || state.enrolled && !field);
    if (changed) { await this.refreshAccount(me.id); state = this.status(); }
    if (field && state.memberId === me.id) { const resuming = !state.enrolled; try { await this.enroll(me.id); } catch (failure) { if (!resuming) throw failure; } }
    return this.status();
  }
  /** `enrolled` is the app's own word for collecting being switched on (ContinuousRouteTracker.state: enrolled = enabled()). */
  status() { return {enrolled: this.enabled(), enabled: this.enabled(), memberId: this.meta.memberId || null, regionScope: this.meta.regionScope || null, enrolledRole: this.meta.memberRole || null, pendingCount: this.count(), pendingGapCount: this.gapCount(), heldCount: this.heldCount(), heldGapCount: this.heldGapCount(), error: this.error, syncError: this.syncError, heldError: this.heldError}; }
  /** The device report the page sends (POST /api/device-status) from this state. */
  report() {
    const enabled = this.enabled(), now = this.clock();
    return {platform: 'android-app', deviceClass: 'android', gate: enabled ? 'ok' : 'setup', missing: enabled ? [] : ['enrollment'], appVersion: '1.0.16', tracking: enabled && inWindow(now), windowActive: inWindow(now), enrolled: !!this.meta.memberId,
      consent: true, foreground: 'granted', fineLocation: 'granted', notifications: 'granted', background: 'granted', locationServices: true, lastFixAt: '', accuracy: null,
      pendingCount: this.count(), pendingGapCount: this.gapCount(), quarantinedCount: 0, error: this.error.slice(0, 400), syncError: this.syncError.slice(0, 400)};
  }
}
const uploadDate = date => new Date(date + 'T12:00:00Z').getUTCDay() !== 5;

// Emulates the Android app's JavaScript bridge inside Chromium, so browser tests can exercise what a representative
// really sees: the app reports consent, permissions and enrolment through window.__yourrestNative, and the web
// code (tracker, gate, status report) runs unchanged. It mirrors the contract in MainActivity.installBridge and the
// state of ContinuousRouteTracker.state(); it never claims a device, GPS or OS behaviour.
//
//   await installNativeBridge(page | context, {memberId: 'rep1', regionScope: 'western'})   // a set-up phone
//   await installNativeBridge(page, {})                                                      // a freshly installed app
//   const phone = nativeControl(page); await phone.set({backgroundPermission: 'denied'});   // the user changes settings
export const NATIVE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 YourrestCRM-Android/1';

/**
 * @param {{memberId?: string, regionScope?: string, appVersion?: string, state?: object, grant?: object, latencyMs?: number, lateBridgeMs?: number, noBridge?: boolean, userAgent?: string}} options
 *  memberId: the phone is already set up for this account (consent, every permission, enrolled).
 *  state: fields merged over the initial state. grant: what the person accepts when the app asks
 *  ({consent, fine, notifications, background}, all true by default). lateBridgeMs: the bridge appears after a delay.
 *  noBridge: the page runs inside the app's user agent but the bridge never appears.
 */
export function nativeBridgeSource(options = {}) {
  const config = {regionScope: 'all', appVersion: '1.0.10', latencyMs: 0, lateBridgeMs: 0, noBridge: false, userAgent: NATIVE_USER_AGENT, state: {}, ...options, grant: {consent: true, fine: true, notifications: true, background: true, ...(options.grant || {})}};
  return `(() => {
  const config = ${JSON.stringify(config)};
  try { Object.defineProperty(Navigator.prototype, 'userAgent', {get: () => config.userAgent, configurable: true}); } catch {}
  if (window !== window.top) return;
  const clone = value => JSON.parse(JSON.stringify(value));
  const riyadh = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'});
  const windowOpen = () => { const p = Object.fromEntries(riyadh.formatToParts(new Date()).map(part => [part.type, part.value])); return new Date(p.year + '-' + p.month + '-' + p.day + 'T00:00:00Z').getUTCDay() !== 5 && Number(p.hour) >= 6 && Number(p.hour) < 18; };
  const state = {tracking: false, permission: 'denied', pendingCount: 0, pendingGapCount: 0, quarantinedCount: 0, quarantinedGapCount: 0, lastFixAt: null, accuracy: null, error: null, syncError: null, quarantineNotice: null, dayId: null, date: null,
    memberId: null, regionScope: null, enrolledRole: null, stopId: null, workHoursSupported: true, trackingWindowActive: false, trackingWindowStart: '06:00', trackingWindowEnd: '18:00', trackingTimeZone: 'Asia/Riyadh', nextTrackingWindowAt: null,
    directionsSupported: true, continuousSupported: true, enrolled: false, backgroundPermission: 'prompt', appVersion: config.appVersion, installedVersionName: config.appVersion, installedVersionCode: 11, mapsLaunchSupported: true,
    foregroundDirectionsSupported: true, accountRecoverySupported: true, fridayExclusionSupported: true, workWeekSupported: true, fineLocationPermission: 'denied', notificationPermission: 'denied', locationServicesEnabled: true, continuousConsent: false, immutableBindingSupported: true};
  if (config.memberId) Object.assign(state, {enrolled: true, memberId: config.memberId, enrolledRole: 'rep', regionScope: config.regionScope, continuousConsent: true, fineLocationPermission: 'granted', notificationPermission: 'granted', backgroundPermission: 'granted'});
  Object.assign(state, config.state);
  const derive = () => {
    state.permission = state.fineLocationPermission === 'granted' && state.notificationPermission === 'granted' ? 'granted' : 'denied';
    state.trackingWindowActive = windowOpen();
    state.tracking = state.enrolled && state.trackingWindowActive && state.permission === 'granted' && state.backgroundPermission === 'granted' && state.locationServicesEnabled !== false;
  };
  const mock = {config, state, grant: config.grant, calls: [], failures: new Map(),
    snapshot() { derive(); return clone(state); },
    changed() { derive(); window.dispatchEvent(new CustomEvent('yourrest:native-state', {detail: clone(state)})); },
    set(patch) { Object.assign(state, patch); mock.changed(); return clone(state); },
    failNext(method, message) { mock.failures.set(method, message); }};
  window.__nativeMock = mock;
  const handlers = {
    status() {},
    prepare(payload) {
      if (payload.continuous && !state.continuousConsent) { if (!mock.grant.consent) throw new Error('لم يبدأ التسجيل؛ يلزم الموافقة على تسجيل الموقع في ساعات العمل'); state.continuousConsent = true; }
      if (state.fineLocationPermission !== 'granted') state.fineLocationPermission = mock.grant.fine ? 'granted' : 'denied';
      if (state.notificationPermission !== 'granted') state.notificationPermission = mock.grant.notifications ? 'granted' : 'denied';
      derive();
      if (state.permission !== 'granted') { mock.changed(); throw new Error('يلزم الموقع الدقيق وإذن الإشعارات لتسجيل خط السير'); }
      if (payload.continuous && state.backgroundPermission !== 'granted') {
        state.backgroundPermission = mock.grant.background ? 'granted' : 'denied';
        if (!mock.grant.background) { mock.changed(); throw new Error('يلزم السماح بالموقع طوال الوقت لتفعيل التسجيل في ساعات العمل'); }
      }
      mock.changed();
    },
    enroll(payload) {
      if (state.permission !== 'granted' || state.backgroundPermission !== 'granted') throw new Error('يلزم الموقع الدقيق وإذن الإشعارات لتسجيل خط السير');
      Object.assign(state, {enrolled: true, memberId: payload.memberId, enrolledRole: 'rep', regionScope: config.regionScope});
      mock.changed();
    },
    start(payload) { state.stopId = payload.stopId || null; if (payload.memberId) state.memberId = payload.memberId; mock.changed(); },
    stop() { state.stopId = null; mock.changed(); },
    logout() { Object.assign(state, {enrolled: false, memberId: null, enrolledRole: null, regionScope: null, stopId: null}); mock.changed(); },
    refreshAccount(payload) { state.memberId = payload.memberId || state.memberId; state.regionScope = config.regionScope; mock.changed(); }
  };
  const bridge = {
    speechProtocol: 0, speechSupported: false,
    async request(method, payload = {}) {
      mock.calls.push({method, payload: clone(payload), at: Date.now(), userActivation: navigator.userActivation ? navigator.userActivation.isActive : null});
      if (config.latencyMs) await new Promise(resolve => setTimeout(resolve, config.latencyMs)); else await Promise.resolve();
      if (mock.failures.has(method)) { const message = mock.failures.get(method); mock.failures.delete(method); throw new Error(message); }
      const handler = handlers[method];
      if (handler) handler(payload);
      derive();
      return clone(state);
    }
  };
  const announce = () => { window.__yourrestNative = bridge; window.dispatchEvent(new CustomEvent('yourrest:native-ready')); };
  if (config.noBridge) return;
  if (config.lateBridgeMs) setTimeout(announce, config.lateBridgeMs); else window.__yourrestNative = bridge;
})();`;
}

/** Install on a Page or BrowserContext before navigating. */
export async function installNativeBridge(target, options = {}) { await target.addInitScript({content: nativeBridgeSource(options)}); }

/** Drive the emulated phone from the test, as the person would from Android's settings. */
export function nativeControl(page) {
  return {
    state: () => page.evaluate(() => window.__nativeMock.snapshot()),
    set: patch => page.evaluate(value => window.__nativeMock.set(value), patch),
    grant: grant => page.evaluate(value => Object.assign(window.__nativeMock.grant, value), grant),
    calls: () => page.evaluate(() => window.__nativeMock.calls.slice()),
    clearCalls: () => page.evaluate(() => { window.__nativeMock.calls.length = 0; }),
    failNext: (method, message) => page.evaluate(([name, text]) => window.__nativeMock.failNext(name, text), [method, message])
  };
}

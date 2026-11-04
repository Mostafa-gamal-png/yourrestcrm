// Test helper, loaded with `node --import` into a built app the tests boot: the server's clock reads
// TEST_CLOCK_OFFSET_MS ahead of (or behind) the real one, so a test can run inside working hours at any time of day.
// It moves Date only (Date.now, new Date(), Date()); timers and the event loop keep real time. Never used in production.
const offset = Number(process.env.TEST_CLOCK_OFFSET_MS || 0);
if (Number.isFinite(offset) && offset !== 0) {
  const Real = Date;
  function Shifted(...args) {
    if (!new.target) return new Real(Real.now() + offset).toString();
    return args.length ? new Real(...args) : new Real(Real.now() + offset);
  }
  Shifted.prototype = Real.prototype;
  Shifted.now = () => Real.now() + offset;
  Shifted.parse = Real.parse;
  Shifted.UTC = Real.UTC;
  globalThis.Date = Shifted;
}

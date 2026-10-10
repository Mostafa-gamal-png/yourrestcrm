/* Document-lifetime PWA prompt bridge. No account data or persistent storage. */
(function () {
  'use strict';
  if (window.__yourrestInstall) return;
  var pending = null;
  var busy = false;
  var installed = false;
  var subscribers = new Set();
  function snapshot() { return { available: !!pending, busy: busy, installed: installed }; }
  function notify() { subscribers.forEach(function (listener) { listener(snapshot()); }); }
  window.__yourrestInstall = {
    snapshot: snapshot,
    subscribe: function (listener) {
      subscribers.add(listener);
      return function () { subscribers.delete(listener); };
    },
    request: async function () {
      if (installed) return 'installed';
      if (busy) return 'busy';
      if (!pending) return 'unavailable';
      var prompt = pending;
      pending = null; // A browser prompt can only be used once.
      busy = true;
      notify();
      try {
        // Invoke inside the button gesture, before any asynchronous work.
        await prompt.prompt();
        var choice = await prompt.userChoice;
        return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
      } catch (_) {
        return 'error';
      } finally {
        busy = false;
        notify();
      }
    }
  };
  window.addEventListener('beforeinstallprompt', function (event) {
    if (typeof event.prompt !== 'function') return;
    event.preventDefault();
    pending = event;
    notify();
  });
  window.addEventListener('appinstalled', function () {
    installed = true;
    pending = null;
    notify();
  });
}());

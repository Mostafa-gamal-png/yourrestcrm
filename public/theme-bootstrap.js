/* Apply the cosmetic preference before CSS paints, including the offline shell. */
(function () {
  'use strict';
  try {
    var dark = localStorage.getItem('yr-theme') === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#101b18' : '#166344');
  } catch (_) { /* Restricted storage does not prevent login or offline startup. */ }
}());

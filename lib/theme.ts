export type Theme = 'light' | 'dark';

/** A cosmetic preference only. Storage restrictions must never block the CRM. */
export function readTheme(): Theme {
  try {
    return localStorage.getItem('yr-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  }
}

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101b18' : '#166344');
}

export function saveTheme(theme: Theme) {
  applyTheme(theme);
  try { localStorage.setItem('yr-theme', theme); } catch { /* Keep the in-session choice. */ }
}

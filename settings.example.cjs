// Template only: contains no secrets and is NOT read by the application.
//
// On the hosting account, `node setup.cjs` creates the real `settings.cjs` next to `app.cjs` on first run,
// generates a fresh random YR_AUTH_SECRET, and creates the private data folders. Use this file as a
// reference for every supported key, or to prepare settings by hand.
//
// Rules enforced at startup (see portable/config.cjs):
//  - Real settings.cjs must be a private file (chmod 600) outside public_html and outside the release folder.
//  - Data paths must be absolute, outside public_html and the application folder, and private (folders 700, files 600).
//  - Never commit the real settings.cjs, the database, uploaded files or backups. Never put them in public_html.
module.exports = {
  // Exact HTTPS origin of the site, with no path, port 443 implied, no credentials.
  YR_APP_ORIGIN: 'https://crm.yourrest.org',

  // At least 64 hex characters (32 random bytes). Generate with:
  //   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
  // The placeholder below intentionally fails validation. Changing the secret invalidates every active sign-in.
  YR_AUTH_SECRET: 'REPLACE_WITH_64_OR_MORE_HEX_CHARACTERS',

  // SQLite database file and private object (attachment) folder. Keep them outside the release so updates never touch data.
  YR_DATABASE_PATH: '/home/ACCOUNT/yourrest-crm-data/database.sqlite',
  YR_OBJECTS_PATH: '/home/ACCOUNT/yourrest-crm-data/objects',

  // Sign-in codes are sent through the host's sendmail. The sender must be an @yourrest.org address
  // whose domain matches (or is a parent of) the site's host name.
  YR_MAIL_TRANSPORT: 'sendmail',
  YR_MAIL_FROM: 'noreply@yourrest.org',
  YR_SENDMAIL_PATH: '/usr/sbin/sendmail'

  // Optional: key for the National Address (short address) lookup. Leave unset to disable the lookup.
  // YR_NATIONAL_ADDRESS_API_KEY: '',
};

// Local demo of the BUILT release (run `pnpm build` first): `pnpm demo`.
// Starts the app on a throwaway SQLite database with synthetic accounts and customers, behind a
// self-signed HTTPS front on crm.yourrest.org:<port>. Nothing here touches production or sends real mail:
// sign-in codes are printed to this terminal. Press Ctrl+C to stop; all demo data is deleted.
import {readFile} from 'node:fs/promises';
import {bootBuiltApp} from './lib/built-app.mjs';

const port = Number(process.env.DEMO_PORT || 8443);
const accounts = [
  {id: 'admin', role: 'admin', name: 'مدير النظام'},
  {id: 'manager', role: 'manager', name: 'مدير مبيعات'},
  {id: 'supervisor', role: 'supervisor', sup: 'manager', name: 'مشرف مبيعات'},
  {id: 'rep.east', role: 'rep', sup: 'supervisor', region: 'eastern', name: 'مندوب الشرقية'},
  {id: 'rep.west', role: 'rep', sup: 'manager', region: 'western', name: 'مندوب الغربية'},
  {id: 'service', role: 'customer_service_manager', sup: 'manager', name: 'خدمة العملاء'}
];
// 'owner' is the mandatory all-region system administrator.
const app = await bootBuiltApp({members: [{id: 'owner', role: 'admin', name: 'المالك'}, ...accounts]}, {tls: true, tlsPort: port});
const admin = app.as(await app.login('owner'));
const customers = [['مصنع الشرق للبلوك', 'الشرقية', 'rep.east'], ['مصنع النور للخرسانة', 'الشرقية', 'rep.east'], ['مصنع الغرب للقوالب', 'الغربية', 'rep.west']];
for (const [index, [name, region, rep]] of customers.entries()) {
  const created = await admin('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name, region, city: region === 'الشرقية' ? 'الدمام' : 'جدة', code: 'DEMO-' + (index + 1), branch: 'الرئيسي', assignedTo: rep, phone: '05012345' + (60 + index), contact: 'م. أحمد', customerType: 'مصنع', customerStatus: 'نشط'}}});
  if (created.status !== 200) throw Error('Demo customer failed: ' + created.text);
}
console.log(`
Yourrest CRM demo is running (synthetic data only).

  Address : ${app.origin}
  Accounts: ${['owner', ...accounts.map(a => a.id)].map(id => id.toLowerCase() + '@yourrest.org').join('  ')}

The address uses a self-signed certificate and the production host name. Use either:
  - Chrome: chrome --user-data-dir=/tmp/yr-demo --ignore-certificate-errors --host-resolver-rules="MAP crm.yourrest.org 127.0.0.1" ${app.origin}
  - or add "127.0.0.1 crm.yourrest.org" to your hosts file while testing (remove it afterwards) and accept the certificate warning.
Sign-in codes appear below when you request one. Press Ctrl+C to stop and delete the demo data.
`);
// Skip the sign-in the script itself performed to seed the demo data.
let shown = (await readFile(app.mailFile, 'utf8')).trim().split('\n').filter(Boolean).length;
const timer = setInterval(async () => {
  try {
    const mails = (await readFile(app.mailFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    for (const mail of mails.slice(shown)) {
      const text = Buffer.from(mail.message.split('\r\n\r\n')[1].replaceAll('\r\n', ''), 'base64').toString('utf8');
      console.log(`[code] ${mail.to}: ${text.match(/\b\d{6}\b/)?.[0]}`);
    }
    shown = mails.length;
  } catch { /* no mail yet */ }
}, 700);
const stop = async () => { clearInterval(timer); await app.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

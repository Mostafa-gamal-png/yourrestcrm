// Sales month filter and date validation over real HTTP against the BUILT release (run `pnpm build` first).
// Covers leap day, month/year edges, legacy years and invalid or future dates. Synthetic isolated fixtures only.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const app = await bootBuiltApp({members: [{id: 'owner', role: 'admin'}, {id: 'rep1', role: 'rep', region: 'eastern'}]});
try {
  const admin = app.as(await app.login('owner'));
  const customer = await admin('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name: 'عميل', region: 'الشرقية', city: 'x', code: 'D-1', branch: 'الرئيسي', assignedTo: 'rep1', phone: '0501234567', contact: 'م', customerType: 'مصنع', customerStatus: 'نشط'}}});
  check(customer.status, 200, customer.text);
  const sale = (date, reference) => admin('/api/sales', {method: 'POST', body: {action: 'save', createKey: crypto.randomUUID(), data: {customerId: customer.json().id, repId: 'rep1', date, reference, items: [{product: 'قوالب البلوك المتحركة', description: '', quantity: 1, unitPrice: 100}], discount: 0, notes: ''}}});
  const dates = ['2024-02-29', '2024-03-01', '2025-12-31', '2026-01-01', '2026-01-31', '2026-02-28', '2026-03-01', '2026-04-30', '2026-05-01'];
  for (const [index, date] of dates.entries()) check((await sale(date, 'R' + index)).status, 200, 'create sale dated ' + date);
  const datesIn = async month => { const response = await admin('/api/sales?month=' + month); check(response.status, 200, month); return response.json().sales.map(item => item.date).sort(); };
  check(await datesIn('2024-02'), ['2024-02-29'], 'leap day belongs to February only');
  check(await datesIn('2024-03'), ['2024-03-01']);
  check(await datesIn('2025-12'), ['2025-12-31'], 'last day of a legacy year');
  check(await datesIn('2026-01'), ['2026-01-01', '2026-01-31'], 'first and last day of a month');
  check(await datesIn('2026-02'), ['2026-02-28'], 'non-leap February ends on the 28th');
  check(await datesIn('2026-03'), ['2026-03-01']);
  check(await datesIn('2026-04'), ['2026-04-30'], 'thirty-day month');
  check(await datesIn('2026-05'), ['2026-05-01']);
  check(await datesIn('2023-06'), [], 'a month without sales is empty, not an error');
  for (const month of ['2026-13', '2026-00', '26-1', 'abc']) check((await admin('/api/sales?month=' + month)).status, 400, 'invalid month ' + month);
  check((await sale('2026-02-30', 'bad-day')).status, 400, 'impossible calendar date is rejected');
  check((await sale('2025-02-29', 'bad-leap')).status, 400, 'leap day in a non-leap year is rejected');
  check((await sale('2099-01-01', 'future')).status, 400, 'future sale date is rejected');
  check((await sale('2024-02-29', 'R0')).status >= 400, true, 'duplicate invoice reference for the same customer is rejected');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true, productionDataUsed: false}));
} finally {
  await app.stop();
}

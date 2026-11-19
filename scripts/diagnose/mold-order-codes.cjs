'use strict';
// Read-only (2026-11-19, the owner: «تمام اعمل كده وابعتلهم»): the products application asked why two of the CRM's mold requests reach it
// without the customer's ERP code (its order numbers 112 and 108). It fills the code from the CRM's customer list (route `customers`)
// by the Yourrest number, when that customer has an ERP code. For each order number this finds the CRM's request whose production status
// carries it and says, as yes/no, counts and times only: whether the request names a CRM customer and an ERP code, whether that customer
// still exists with a Yourrest number and an ERP code now, whether it is in the list the CRM sends (a number and a name), when its record
// last changed, and when the list was last sent. It prints no name, no code, no number of a customer. Nothing is written.
//   node mold-order-codes.cjs                                          on the hosting account
//   MOLD_DIAG_APP=<app folder> MOLD_DIAG_DATABASE=<file> node ...      on a copy (tests)
// No YR_* variable is ever used or set: the settings check refuses any YR_* value beside settings.cjs.
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

const ORDERS = [112, 108];
const parse = text => { try { return JSON.parse(text || 'null'); } catch { return null; } };
const filled = value => typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;

function report(db) {
  const lastSync = db.prepare("SELECT detail, created_at AS at FROM crm_audit WHERE record_id='mold-customers' AND action='mold-customers:sync' ORDER BY created_at DESC LIMIT 1").get();
  const syncDetail = parse(lastSync?.detail) || {};
  const rows = db.prepare('SELECT id, customer_id, data, remote, created_at, cancelled_at FROM crm_mold_requests WHERE remote IS NOT NULL').all();
  const orders = ORDERS.map(orderNo => {
    const matches = rows.filter(row => Number(parse(row.remote)?.orderNo) === orderNo);
    return {orderNo, crmRequests: matches.length, requests: matches.map(row => {
      const data = parse(row.data) || {}, asked = data.customer || {};
      const record = row.customer_id ? db.prepare("SELECT id, data, updated_at FROM crm_records WHERE id=? AND kind='customer'").get(row.customer_id) : undefined;
      const customer = parse(record?.data) || {};
      const number = record ? db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(record.id)?.number : undefined;
      const code = typeof customer.code === 'string' ? customer.code.trim() : '';
      return {
        requestedDay: String(data.requestedAt || row.created_at || '').slice(0, 10),
        cancelled: !!row.cancelled_at,
        requestNamesCrmCustomer: !!row.customer_id,
        requestCarriesYourrestNumber: filled(asked.crmNumber),
        requestCarriesErpCode: filled(asked.erpCode),
        customerStillInCrm: !!record,
        customerHasYourrestNumber: number !== undefined && number !== null,
        requestNumberMatchesCustomer: number !== undefined && number !== null && Number(asked.crmNumber) === Number(number),
        customerHasErpCodeNow: code.length > 0,
        customerErpCodeSendable: code.length > 0 && code.length <= 50,
        customerInSentList: !!record && number !== undefined && number !== null && filled(customer.name),
        customerChangedAt: record?.updated_at || null,
        changedAfterLastSend: !!(record?.updated_at && lastSync?.at && record.updated_at > lastSync.at)
      };
    })};
  });
  const verdict = orders.map(order => `ORDER ${order.orderNo}: ${order.crmRequests} CRM REQUEST(S)` + order.requests.map(r =>
    `; REQUEST ${r.requestedDay}${r.cancelled ? ' CANCELLED' : ''}: NAMES CRM CUSTOMER ${r.requestNamesCrmCustomer ? 'YES' : 'NO'}, CARRIES NUMBER ${r.requestCarriesYourrestNumber ? 'YES' : 'NO'}, CARRIES ERP CODE ${r.requestCarriesErpCode ? 'YES' : 'NO'}; CUSTOMER IN CRM ${r.customerStillInCrm ? 'YES' : 'NO'}, HAS NUMBER ${r.customerHasYourrestNumber ? 'YES' : 'NO'}${r.customerHasYourrestNumber ? ' (SAME AS REQUEST ' + (r.requestNumberMatchesCustomer ? 'YES' : 'NO') + ')' : ''}, HAS ERP CODE NOW ${r.customerHasErpCodeNow ? 'YES' : 'NO'}, IN SENT LIST ${r.customerInSentList ? 'YES' : 'NO'}, CHANGED ${r.customerChangedAt || '-'}${r.changedAfterLastSend ? ' (AFTER LAST SEND)' : ''}`).join('')).join('\n')
    + `\nLAST CUSTOMER LIST SENT: ${lastSync?.at || 'never'} (${syncDetail.count ?? '?'} customers, ${syncDetail.mode || '?'})`;
  return {mode: 'mold-order-codes', readOnly: true, lastCustomerListSent: lastSync ? {at: lastSync.at, count: syncDetail.count ?? null, mode: syncDetail.mode ?? null, received: syncDetail.received ?? null, updated: syncDetail.updated ?? null} : null, orders, verdict};
}

function run() {
  const home = process.env.HOME || '/home/youriedx', app = process.env.MOLD_DIAG_APP || path.join(home, 'yourrest-crm');
  const database = process.env.MOLD_DIAG_DATABASE || require(path.join(app, 'release', 'operations', 'config.cjs')).loadSettings(app).YR_DATABASE_PATH;
  const db = new DatabaseSync(database, {readOnly: true});
  try { return report(db); } finally { db.close(); }
}

if (require.main === module) {
  try { const result = run(); console.log(JSON.stringify(result, null, 2)); console.log(result.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run, report};

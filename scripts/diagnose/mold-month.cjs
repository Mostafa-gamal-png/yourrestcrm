'use strict';
// Read-only (2026-11-19): a sales manager says filtering «طلبات القوالب» for the current month shows fewer requests than expected.
// The page filters the list the reader already holds (lib/mold-filters.ts, by requestedAt in Riyadh), and a sales manager's list
// is their team's requests within their regions (canReadMoldRequest in lib/mold-requests.ts). For each active sales manager this
// counts the CRM's requests of the current and the previous Riyadh month: how many the list holds, and why the others are not in it
// (whoever asked is in no sales manager's team or in another's; the customer is outside the manager's regions or no longer in the
// CRM), and how many of those the manager approves («طلبات بانتظار اعتمادي» only). It also counts the requests whose requestedAt
// falls in another month than their creation. It prints member ids (random, first 8 characters), roles and counts only: no names,
// no customers, no codes. Nothing is written.
//   node mold-month.cjs                                                  on the hosting account
//   MOLD_DIAG_APP=<app folder> MOLD_DIAG_DATABASE=<file> MOLD_DIAG_NOW=<ISO time> node mold-month.cjs    on a copy (tests)
// No YR_* variable is ever used or set: the settings check refuses any YR_* value beside settings.cjs.
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

const SALES_TEAM_ROLES = ['supervisor', 'rep', 'marketing'];
const REGION_IDS = ['central', 'eastern', 'western', 'northern', 'southern', 'unassigned'];
const REGION_NAMES = {central: 'الوسطى', eastern: 'الشرقية', western: 'الغربية', northern: 'الشمالية', southern: 'الجنوبية', unassigned: 'المنطقة غير محددة'};

const riyadhDay = iso => {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(time));
};
const scopeOf = member => member.region_scope || 'all';
const scopeRegions = scope => scope === 'all' ? [] : String(scope).split(',').map(part => part.trim()).filter(part => REGION_IDS.includes(part));
const customerRegion = value => {
  const label = String(value || '').trim().replace(/^المنطقة\s+/, '');
  return REGION_IDS.find(id => id === label || REGION_NAMES[id] === label) || 'unassigned';
};
const canAccess = (member, region) => scopeOf(member) === 'all' || scopeRegions(scopeOf(member)).includes(customerRegion(region));
const overlap = (a, b) => a === 'all' || b === 'all' || scopeRegions(a).some(id => scopeRegions(b).includes(id));

/** As moldTeamManagerId: the first sales manager up the «المشرف» chain through supervisors, representatives and marketing officers. */
function teamManager(memberId, byId) {
  let member = byId.get(memberId);
  if (!member) return '';
  if (member.role === 'manager') return member.id;
  const seen = new Set();
  while (member && SALES_TEAM_ROLES.includes(member.role) && !seen.has(member.id)) {
    seen.add(member.id);
    const next = member.supervisor_id ? byId.get(member.supervisor_id) : undefined;
    if (next && next.role === 'manager') return next.id;
    member = next;
  }
  return '';
}

/** As moldRequestInRegion: reader true reads the customer from the CRM's customers (a customer no longer there is outside). */
function inRegion(row, member, customers, byId, reader) {
  if (scopeOf(member) === 'all') return true;
  if (!row.customer_id) { const requester = byId.get(row.member_id); return !!requester && overlap(scopeOf(member), scopeOf(requester)); }
  if (!customers.has(row.customer_id)) return !reader;
  return canAccess(member, customers.get(row.customer_id));
}

function report({rows, members, customers, now}) {
  const byId = new Map(members.map(member => [member.id, member]));
  const today = riyadhDay(now), month = today.slice(0, 7);
  const [year, number] = month.split('-').map(Number);
  const previous = number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
  const requests = rows.map(row => {
    let data = {};
    try { data = JSON.parse(row.data) || {}; } catch { data = {}; }
    return {...row, requestedDay: riyadhDay(data.requestedAt), createdDay: riyadhDay(row.created_at)};
  });
  const shift = requests.filter(row => row.requestedDay && row.createdDay && row.requestedDay.slice(0, 7) !== row.createdDay.slice(0, 7)).length;
  const roleOf = id => byId.get(id)?.role || (id ? 'not_a_member' : 'nobody');
  const months = [month, previous].map(which => {
    const inMonth = requests.filter(row => row.requestedDay.slice(0, 7) === which);
    const managers = members.filter(member => member.role === 'manager' && member.active === 1).map(manager => {
      const counts = {visible: 0, hidden: 0, hiddenApprovedByHim: 0, reasons: {}};
      for (const row of inMonth) {
        const owner = teamManager(row.member_id, byId), region = inRegion(row, manager, customers, byId, true);
        if (owner === manager.id && region) { counts.visible++; continue; }
        counts.hidden++;
        const reason = owner === manager.id ? (row.customer_id && !customers.has(row.customer_id) ? 'customer_not_in_crm' : 'customer_outside_his_regions')
          : owner ? 'requester_in_another_managers_team' : 'requester_in_no_managers_team:' + roleOf(row.member_id);
        counts.reasons[reason] = (counts.reasons[reason] || 0) + 1;
        const approving = (() => { const other = owner ? byId.get(owner) : undefined; return other && other.active === 1 && inRegion(row, other, customers, byId, false) ? owner : ''; })();
        if (region && (approving === manager.id || approving === '')) counts.hiddenApprovedByHim++;
      }
      return {manager: manager.id.slice(0, 8), regions: scopeOf(manager), ...counts};
    });
    return {month: which, requests: inMonth.length, cancelled: inMonth.filter(row => row.cancelled_at).length, byRequesterRole: inMonth.reduce((tally, row) => { const role = roleOf(row.member_id); tally[role] = (tally[role] || 0) + 1; return tally; }, {}), managers};
  });
  const verdict = months.map(item => `${item.month}: ${item.requests} REQUESTS (${item.cancelled} CANCELLED); ` + item.managers.map(m => `MANAGER ${m.manager} SEES ${m.visible}, NOT ${m.hidden} [${Object.entries(m.reasons).map(([k, v]) => k + ' ' + v).join(', ') || '-'}], OF THEM HE APPROVES ${m.hiddenApprovedByHim}`).join('; ')).join('\n') + `\nREQUESTED IN ANOTHER MONTH THAN CREATED: ${shift}`;
  return {mode: 'mold-month', readOnly: true, today, total: requests.length, requestedMonthDiffersFromCreated: shift, months, verdict};
}

function run() {
  const home = process.env.HOME || '/home/youriedx', app = process.env.MOLD_DIAG_APP || path.join(home, 'yourrest-crm');
  const database = process.env.MOLD_DIAG_DATABASE || require(path.join(app, 'release', 'operations', 'config.cjs')).loadSettings(app).YR_DATABASE_PATH;
  const db = new DatabaseSync(database, {readOnly: true});
  try {
    const rows = db.prepare('SELECT id, member_id, customer_id, data, cancelled_at, created_at FROM crm_mold_requests').all();
    const members = db.prepare('SELECT id, role, supervisor_id, region_scope, active FROM crm_members').all();
    const customers = new Map(db.prepare("SELECT id, json_extract(data, '$.region') AS region FROM crm_records WHERE kind = 'customer'").all().map(row => [row.id, row.region]));
    return report({rows, members, customers, now: process.env.MOLD_DIAG_NOW || new Date().toISOString()});
  } finally { db.close(); }
}

if (require.main === module) {
  try { const result = run(); console.log(JSON.stringify(result, null, 2)); console.log(result.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run, report, teamManager};

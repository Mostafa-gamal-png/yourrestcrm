// A MADE-UP initial data file (the shape of migration/initial.json) for the tests of first installation and upgrade.
// Every value is invented here: people «مالك تجريبي», «مدير تجريبي», «مندوب تجريبي», customers «عميل تجريبي 1..n»,
// phones 0500000001.., e-mails at example.com (the owner's at yourrest.org, which the installer requires of the owner).
// Nothing is read from or derived from real data. The real initial data is not in the repository (the owner, 2026-11-16).
// The snapshot is built on the schema of the migrations it is given, so its columns are exactly those tables' columns.
// A .js file (not .mjs): the default gate runs every tests/**/*.mjs as a test, and this is a helper.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

/** The tables an initial data file carries (portable/initialize.mjs accepts these and no other). */
export const SEED_TABLES = ['crm_members', 'crm_settings', 'crm_records', 'crm_visit_numbers', 'crm_visit_files', 'crm_sales', 'crm_performance_targets', 'crm_target_sets', 'crm_kpi_assessments', 'crm_service_cases', 'crm_audit'];
export const MADE_UP_OWNER_EMAIL = 'owner@yourrest.org';
const STAMP = '2026-01-01T00:00:00.000Z';
const pad = (n, width) => String(n).padStart(width, '0');

/**
 * @param {string} migrations folder of the release's numbered .sql migrations
 * @param {{customers?: number}} [options]
 * @returns {{snapshot: object, counts: Record<string, number>}}
 */
export function madeUpSnapshot(migrations, {customers = 6} = {}) {
  if (!Number.isInteger(customers) || customers < 1 || customers > 99) throw Error('customers must be 1..99');
  const db = new DatabaseSync(':memory:');
  try {
    for (const file of fs.readdirSync(migrations).filter(name => /^\d+.*\.sql$/.test(name)).sort()) db.exec(fs.readFileSync(path.join(migrations, file), 'utf8'));
    const member = db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,?,1,0,?,?)');
    member.run('owner', 'opaque-owner', MADE_UP_OWNER_EMAIL, 'مالك تجريبي', 'admin', 'الرئيسي', null, STAMP, 'all');
    member.run('made-up-manager', null, 'manager@example.com', 'مدير تجريبي', 'manager', 'الرئيسي', null, STAMP, 'all');
    member.run('made-up-rep', null, 'rep@example.com', 'مندوب تجريبي', 'rep', 'الرئيسي', 'made-up-manager', STAMP, 'central');
    db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').run('company', 'opaque-owner');
    const record = db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    for (let i = 1; i <= customers; i++) {
      record.run('made-up-customer-' + i, 'customer', null, 'made-up-rep', 'الرئيسي', JSON.stringify({
        name: 'عميل تجريبي ' + i, code: 'TEST-' + pad(i, 4), city: 'مدينة تجريبية', region: 'central', address: 'عنوان تجريبي ' + i,
        contact: 'جهة اتصال تجريبية', phone: '05' + pad(i, 8), email: 'customer' + i + '@example.com', contact2: '', phone2: '', email2: '',
        customerType: '', customerStatus: '', machineCount: 1, machineTypes: '', supplier: '', category: '', notes: 'بيانات اختبار مختلقة',
        branch: 'الرئيسي', assignedTo: 'made-up-rep'
      }), STAMP, STAMP);
    }
    record.run('made-up-factory-1', 'factory', 'made-up-customer-1', 'made-up-rep', 'الرئيسي', JSON.stringify({
      name: 'ماكينة تجريبية', recordType: 'machine', quantity: 1, machineBrand: 'شركة تجريبية', machineModel: 'نموذج 1', machineType: 'unknown', boardDimensions: '', notes: ''
    }), STAMP, STAMP);
    record.run('made-up-visit-1', 'activity', 'made-up-customer-1', 'made-up-rep', 'الرئيسي', JSON.stringify({
      type: 'visit', date: '2026-01-01', summary: 'زيارة تجريبية', result: '', outcome: '', nextAction: '', nextDate: '', notes: '', performedBy: 'made-up-rep', visitNumber: 1
    }), STAMP, STAMP);
    db.prepare('INSERT INTO crm_visit_numbers(number,record_id) VALUES(?,?)').run(1, 'made-up-visit-1');
    db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').run('made-up-audit-1', 'made-up-customer-1', 'owner', 'استيراد', 'بيانات اختبار مختلقة', STAMP);
    const tables = {}, counts = {};
    for (const table of SEED_TABLES) {
      const columns = db.prepare('PRAGMA table_info("' + table + '")').all().map(row => row.name);
      if (!columns.length) throw Error('The migrations have no table ' + table);
      const rows = db.prepare('SELECT * FROM "' + table + '"').all().map(row => ({...row}));
      tables[table] = {columns, rows};
      counts[table] = rows.length;
    }
    return {snapshot: {format: 'yourrest-namecheap-export-v1', about: 'Made-up test data (tests/fixtures/made-up-seed.js); no real record.', tables}, counts};
  } finally {
    db.close();
  }
}

/** Writes the snapshot and its SHA-256 the way an administrator places them by hand (migration/initial.json and initial.sha256). */
export function writeSeed(snapshot, seedFile, checksumFile) {
  const text = JSON.stringify(snapshot);
  fs.mkdirSync(path.dirname(seedFile), {recursive: true, mode: 0o700});
  fs.writeFileSync(seedFile, text, {mode: 0o600});
  fs.writeFileSync(checksumFile, createHash('sha256').update(text).digest('hex') + '\n', {mode: 0o600});
}

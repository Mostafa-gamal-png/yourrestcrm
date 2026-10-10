#!/usr/bin/env python3
"""Exercise native v1-to-v2 outbox SQL against real SQLite; no Android device claim."""
import json
from pathlib import Path
import re
import sqlite3

checks = 0

def check(value, label):
    global checks
    checks += 1
    if not value:
        raise AssertionError(label)

def block(source, marker):
    start = source.index('{', source.index(marker)) + 1
    depth, end = 1, start
    while depth:
        if source[end] == '{': depth += 1
        elif source[end] == '}': depth -= 1
        end += 1
    return source[start:end-1]

source_root = Path(__file__).resolve().parents[1] / 'app/src/main/java/org/yourrest/crm'
for mode in ['Route', 'ContinuousRoute']:
    source = (source_root / (mode + 'Store.java')).read_text()
    continuous = mode == 'ContinuousRoute'
    con = sqlite3.connect(':memory:')
    ddl = re.findall(r'db\.execSQL\("((?:\\.|[^"\\])*)"\)', block(source, 'public void onCreate('))
    for statement in ddl:
        sql = json.loads('"' + statement + '"')
        # Reconstruct the previous schema fixture by removing only the new columns.
        sql = re.sub(r',\s*stop_id TEXT', '', sql)
        sql = re.sub(r',\s*binding_known INTEGER NOT NULL DEFAULT 0', '', sql)
        con.execute(sql)
    good = json.dumps({'id': 'old-point', 'stopId': 'customer-A', 'capturedAt': '2026-10-01T07:00:00.000Z'}, separators=(',', ':'))
    unknown = json.dumps({'id': 'older-unknown-point', 'capturedAt': '2026-10-01T06:50:00.000Z'}, separators=(',', ':'))
    con.execute('INSERT INTO meta VALUES (?,?)', ('memberId', 'rep-A'))
    con.execute('INSERT INTO meta VALUES (?,?)', ('stopId', 'customer-A'))
    if continuous:
        con.execute('INSERT INTO days VALUES (?,?,?)', ('2026-10-01', 'stable-create-key', '{"id":"stable-day"}'))
        con.execute('INSERT INTO points VALUES (?,?,?,?)', ('old-point', 1, '2026-10-01', good))
        con.execute('INSERT INTO points VALUES (?,?,?,?)', ('older-unknown-point', 2, '2026-10-01', unknown))
        con.execute('INSERT INTO gaps(at,date,reason) VALUES (?,?,?)', (3, '2026-10-01', 'service_stopped'))
    else:
        con.execute('INSERT INTO points VALUES (?,?,?)', ('old-point', 1, good))
        con.execute('INSERT INTO points VALUES (?,?,?)', ('older-unknown-point', 2, unknown))
        con.execute('INSERT INTO gaps(reason,at) VALUES (?,?)', ('service_stopped', '2026-10-01T07:05:00.000Z'))
    old_columns = {table: [row[1] for row in con.execute('PRAGMA table_info(' + table + ')')] for table in ['meta', 'points', 'gaps'] + (['days'] if continuous else [])}
    snapshots = {table: con.execute('SELECT * FROM ' + table + ' ORDER BY rowid').fetchall() for table in old_columns}
    migrations = re.findall(r'db\.execSQL\("((?:\\.|[^"\\])*)"\)', block(source, 'public void onUpgrade('))
    check(len(migrations) == 4, mode + ' upgrade does not have exact additive columns/known-point classification')
    for statement in migrations:
        sql = json.loads('"' + statement + '"')
        check(not sql.startswith('DELETE') and 'DROP ' not in sql, 'Destructive migration')
        con.execute(sql)
    for table, columns in old_columns.items():
        check(con.execute('SELECT ' + ','.join(columns) + ' FROM ' + table + ' ORDER BY rowid').fetchall() == snapshots[table], mode + ' loses old IDs, times, account metadata or exact payload')
    check(con.execute('SELECT binding_known FROM points WHERE id=?', ('old-point',)).fetchone() == (1,), 'Existing explicit stopId not recognized')
    check(con.execute('SELECT binding_known FROM points WHERE id=?', ('older-unknown-point',)).fetchone() == (0,), 'Unknown point fabricated as explicit binding')
    check(con.execute('SELECT stop_id,binding_known FROM gaps WHERE id=1').fetchone() == (None, 0), 'Legacy gap assigned to current customer')
    capability_sql = 'SELECT 1 FROM points WHERE binding_known=0 UNION SELECT 1 FROM gaps WHERE binding_known=0 LIMIT 1'
    check(con.execute(capability_sql).fetchone() is not None, 'Unknown outbox must retain preselection barrier')
    if continuous:
        for at, stop in [(4, 'customer-A'), (5, None), (6, 'customer-B')]:
            con.execute('INSERT INTO gaps(at,date,reason,stop_id,binding_known) VALUES (?,?,?,?,1)', (at, '2026-10-01', 'gps_unavailable', stop))
    else:
        for at, stop in [('2026-10-01T07:06:00.000Z', 'customer-A'), ('2026-10-01T07:07:00.000Z', None), ('2026-10-01T07:08:00.000Z', 'customer-B')]:
            con.execute('INSERT INTO gaps(reason,at,stop_id,binding_known) VALUES (?,?,?,1)', ('gps_unavailable', at, stop))
    con.execute('UPDATE meta SET value=? WHERE key=?', ('customer-C', 'stopId'))
    check(con.execute('SELECT stop_id,binding_known FROM gaps WHERE id>1 ORDER BY id').fetchall() == [('customer-A', 1), (None, 1), ('customer-B', 1)], 'Changing customer relabels queued gap or explicit unbound interval')
    con.execute('DELETE FROM gaps WHERE id=1')
    check(con.execute(capability_sql).fetchone() is not None, 'Pending unknown point ignored after gap acknowledgment')
    con.execute('DELETE FROM points WHERE id=?', ('older-unknown-point',))
    check(con.execute(capability_sql).fetchone() is None, 'Fully bound outbox cannot become safe after actual acknowledgment')
    check(con.execute('SELECT body FROM points WHERE id=?', ('old-point',)).fetchone() == (good,), 'Surviving point payload changed')
    con.close()
print(f'Native SQLite upgrade: {checks} checks passed (real SQLite, no Android device migration verification)')

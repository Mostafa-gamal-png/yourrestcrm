// The read-only proposal of the street data's regions (scripts/diagnose/street-regions.cjs, «بيانات شوارع محلية» 2026-11-19) on a synthetic
// database: the customers' map points read as the map reads them (numbers, or coordinates in the location text, never a city name; none
// outside the Kingdom), the drawn work areas' boxes, the 0.05° tiles that touch forming one group, each group's box grown by one tile, the
// suggestion within the import tool's limits and the share of the points it covers, and the lines the build tool takes. It prints counts and
// boxes on the 0.05° grid only (no name, no code, no customer id, no point), and the database is unchanged. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {parseRegion} from '../scripts/streets/build-street-data.mjs';

const root = process.cwd(), require = createRequire(import.meta.url);
const {run, report, coordinates} = require(path.join(root, 'scripts/diagnose/street-regions.cjs'));
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-diagnose-street-regions-'));
process.on('exit', () => fs.rmSync(folder, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const SECRET = 'PRIVATE-FACTORY-0551234567';

eq([coordinates(26.43, 50.1, ''), coordinates(null, null, '26.43، 50.1'), coordinates(null, null, 'https://maps.google.com/?q=26.43,50.1'), coordinates(null, null, 'الدمام'), coordinates(0, 0, '')], [[26.43, 50.1], [26.43, 50.1], [26.43, 50.1], null, null], 'as the map reads a point: numbers, a pair, a link with q=; never a city name or 0,0');

const file = path.join(folder, 'database.sqlite'), db = new DatabaseSync(file);
db.exec("CREATE TABLE crm_records(id TEXT, kind TEXT, data TEXT); CREATE TABLE crm_work_areas(member_id TEXT, polygon TEXT)");
const customer = (id, data) => db.prepare('INSERT INTO crm_records VALUES (?,?,?)').run(id, 'customer', JSON.stringify({name: SECRET, code: SECRET, ...data}));
// Dammam: three points in two touching tiles; Jubail: one point; Riyadh: one point given as text; two without a point; one abroad.
customer('d1', {latitude: 26.4312, longitude: 50.1023, region: 'الشرقية'});
customer('d2', {latitude: 26.4388, longitude: 50.1061, region: 'المنطقة الشرقية'});
customer('d3', {location: '26.4521, 50.1083', region: 'eastern'});
customer('j1', {latitude: 27.0047, longitude: 49.6612, region: 'الشرقية'});
customer('r1', {location: 'https://www.google.com/maps/@24.7136,46.6753,15z', region: 'الوسطى'});
customer('n1', {region: 'الوسطى', city: 'الرياض'});
customer('n2', {location: 'شارع الملك فهد', region: 'الوسطى'});
customer('x1', {latitude: 30.05, longitude: 31.24, region: 'الغربية'});
db.prepare("INSERT INTO crm_records VALUES ('a1','activity','{}')").run();
// A drawn area in Jeddah, where no customer has a point yet.
db.prepare('INSERT INTO crm_work_areas VALUES (?,?)').run('rep1', JSON.stringify({type: 'Polygon', coordinates: [[[39.17, 21.52], [39.19, 21.52], [39.19, 21.54], [39.17, 21.54], [39.17, 21.52]]]}));
db.prepare('INSERT INTO crm_work_areas VALUES (?,?)').run('rep2', 'not json');
db.close();
const before = createHash('sha256').update(fs.readFileSync(file)).digest('hex');

process.env.STREET_DIAG_DATABASE = file;
const result = run();
eq([result.readOnly, result.customers, result.withPoint, result.withoutPoint, result.outsideKingdom, result.cellsWithPoints, result.drawnAreas, result.tileDegrees], [true, 8, 5, 2, 1, 4, 1, 0.05], 'eight customers: five with a point in four cells (two share one), two without, one outside the Kingdom; one drawn area (a damaged one is skipped)');
eq(result.bySalesRegion, {eastern: 4, central: 1}, 'by sales region');
eq(result.regions.map(r => [r.id, r.points, r.tiles, r.south, r.west, r.north, r.east, r.cells, r.fits]), [
  ['eastern-1', 3, 2, 26.35, 50.05, 26.55, 50.2, 300, true],
  ['central-1', 1, 1, 24.65, 46.6, 24.8, 46.75, 225, true],
  ['eastern-2', 1, 1, 26.95, 49.6, 27.1, 49.75, 225, true],
  ['drawn-1', 0, 1, 21.45, 39.1, 21.6, 39.25, 225, true],
], 'tiles that touch form one group; each box grown by one tile on the 0.05° grid, most points first (then from the south); the drawn area has its own');
eq([result.suggested, result.buildArgs[0], result.requestRegions.length], [{regions: 4, cells: 975, pointsCovered: 5, share: 100}, '--region eastern-1:26.35,50.05,26.55,50.20', 4], 'the suggestion and the build tool\'s lines');
for (const line of result.buildArgs) parseRegion(line.replace('--region ', ''));
checks++;
ok(result.verdict.startsWith('STREET REGIONS: 5 CUSTOMERS WITH A MAP POINT (2 WITHOUT, 1 OUTSIDE THE KINGDOM) IN 4 CELLS'), 'one line for the log (the deploy\'s annotation picks STREET up)');
const printed = JSON.stringify(result);
eq([printed.includes(SECRET), printed.includes('d1'), printed.includes('rep1'), printed.includes('26.4312'), printed.includes('50.1023')], [false, false, false, false, false], 'no name, code, id or point is printed');
eq(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), before, 'the database is unchanged');
// The limits: past 40 000 cells or 30 regions, the rest are listed and not suggested.
const many = report({customers: Array.from({length: 40}, (_, i) => ({latitude: 17 + i * 0.35, longitude: 42 + (i % 7) * 1.7, location: '', region: 'الجنوبية'})), areas: []});
eq([many.regions.length, many.suggested.regions, many.regions.filter(r => !r.fits).length], [40, 30, 10], 'thirty regions at most');
function ok(value, message) { assert.ok(value, message); checks++; }
console.log(JSON.stringify({ok: true, checks}));

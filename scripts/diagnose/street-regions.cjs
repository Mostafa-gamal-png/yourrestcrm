'use strict';
// Read-only (2026-11-19, «بيانات شوارع محلية», the port of GSCO 2.13.82): which regions the street data file should cover. Only the live
// database knows where Yourrest's customers are, so this runs on the hosting account (deploy.yml, mode diagnose) and proposes the regions
// for scripts/streets/build-street-data.mjs: the customers' map points (as the map reads them: latitude and longitude, or coordinates in the
// location text) and the drawn work areas' boxes are put on a grid of 0.05° tiles (about 5.5 km); tiles that touch form a group; each group's
// box, grown by one tile on every side, is a proposed region on the 0.01° grid (boxes that would overlap are joined into one: the
// build and import tools refuse overlapping regions). It prints counts and those boxes only: no name, no code, no
// customer id and no point finer than a 0.05° tile (the run's log on GitHub is public for a public repository). The regions are sorted by
// the points they hold, and the first ones that fit the import tool's limits (portable/import-street-data.mjs: 30 regions, 40 000 cells, a
// region of 20 000 cells at most) are the suggestion, with the share of the points they cover. Nothing is written.
//   node street-regions.cjs                                                     on the hosting account
//   STREET_DIAG_APP=<app folder> STREET_DIAG_DATABASE=<file> node street-regions.cjs    on a copy (tests)
// No YR_* variable is ever used or set: the settings check refuses any YR_* value beside settings.cjs.
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

const REGION_IDS = ['central', 'eastern', 'western', 'northern', 'southern', 'unassigned'];
const REGION_NAMES = {central: 'الوسطى', eastern: 'الشرقية', western: 'الغربية', northern: 'الشمالية', southern: 'الجنوبية', unassigned: 'المنطقة غير محددة'};
const SAUDI = {south: 16, west: 34.4, north: 32.3, east: 55.7};
/** A tile is 0.05° (5 cells of 0.01°); a region is its group's tiles grown by one tile. The import tool's limits. */
const TILE = 5, CELLS_PER_DEGREE = 100, MAX_REGIONS = 30, MAX_FILE_CELLS = 40000, MAX_REGION_CELLS = 20000;

const customerRegion = value => {
  const label = String(value || '').trim().replace(/^المنطقة\s+/, '');
  return REGION_IDS.find(id => id === label || REGION_NAMES[id] === label) || 'unassigned';
};
/** As lib/customer-location.ts customerCoordinates: numbers first, else an explicit pair in the location text (never a city name). */
function coordinates(latitude, longitude, location) {
  const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (typeof latitude === 'number' && typeof longitude === 'number' && valid(latitude, longitude)) return [latitude, longitude];
  const raw = String(location || '').trim().replace(/،/g, ',');
  const pair = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/) || raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || raw.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i);
  if (!pair) return null;
  const lat = Number(pair[1]), lng = Number(pair[2]);
  return valid(lat, lng) ? [lat, lng] : null;
}
const inSaudi = ([lat, lng]) => lat >= SAUDI.south && lat <= SAUDI.north && lng >= SAUDI.west && lng <= SAUDI.east;
const tileOf = ([lat, lng]) => [Math.floor(lat * CELLS_PER_DEGREE / TILE), Math.floor(lng * CELLS_PER_DEGREE / TILE)];
const degrees = cells => Number((cells / CELLS_PER_DEGREE).toFixed(2));

function report({customers, areas}) {
  const counts = {customers: customers.length, withPoint: 0, withoutPoint: 0, outsideKingdom: 0}, bySalesRegion = {}, cells = new Set();
  const tiles = new Map(), add = (tile, weight, region) => {
    const key = tile.join(':'), entry = tiles.get(key) || {tile, points: 0, areas: 0, regions: {}};
    if (region) { entry.points += weight; entry.regions[region] = (entry.regions[region] || 0) + 1; } else entry.areas += weight;
    tiles.set(key, entry);
  };
  for (const row of customers) {
    const point = coordinates(row.latitude, row.longitude, row.location);
    if (!point) { counts.withoutPoint++; continue; }
    if (!inSaudi(point)) { counts.outsideKingdom++; continue; }
    counts.withPoint++;
    const region = customerRegion(row.region);
    bySalesRegion[region] = (bySalesRegion[region] || 0) + 1;
    cells.add(Math.floor(point[0] * CELLS_PER_DEGREE) + ':' + Math.floor(point[1] * CELLS_PER_DEGREE));
    add(tileOf(point), 1, region);
  }
  let drawnAreas = 0;
  for (const area of areas) {
    let ring;
    try { ring = JSON.parse(area.polygon).coordinates[0].map(([lng, lat]) => [lat, lng]); } catch { continue; }
    if (!Array.isArray(ring) || !ring.length || !ring.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && inSaudi(p))) continue;
    drawnAreas++;
    const [s, w] = tileOf([Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1]))]), [n, e] = tileOf([Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))]);
    for (let y = s; y <= n; y++) for (let x = w; x <= e; x++) add([y, x], 1, '');
  }
  // Tiles that touch (8 neighbours) form a group.
  const parent = new Map([...tiles.keys()].map(key => [key, key])), find = key => { while (parent.get(key) !== key) { parent.set(key, parent.get(parent.get(key))); key = parent.get(key); } return key; };
  for (const {tile: [y, x]} of tiles.values()) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const other = (y + dy) + ':' + (x + dx);
    if (tiles.has(other)) { const a = find(y + ':' + x), b = find(other); if (a !== b) parent.set(a, b); }
  }
  const groups = new Map();
  for (const [key, entry] of tiles) { const root = find(key); groups.set(root, [...(groups.get(root) || []), entry]); }
  const boxes = [...groups.values()].map(members => {
    const ys = members.map(m => m.tile[0]), xs = members.map(m => m.tile[1]), tally = {};
    for (const m of members) for (const [region, n] of Object.entries(m.regions)) tally[region] = (tally[region] || 0) + n;
    return {box: {south: (Math.min(...ys) - 1) * TILE, west: (Math.min(...xs) - 1) * TILE, north: (Math.max(...ys) + 2) * TILE, east: (Math.max(...xs) + 2) * TILE},
      points: members.reduce((n, m) => n + m.points, 0), drawnAreaTiles: members.reduce((n, m) => n + m.areas, 0), tiles: members.length, tally};
  });
  // Two groups one empty tile apart (or one inside the other's box) would get overlapping boxes, which the build and import tools refuse
  // (review 2026-11-19): such boxes are joined into one, again until no two overlap.
  const overlap = (a, b) => a.south < b.north && b.south < a.north && a.west < b.east && b.west < a.east;
  for (let joined = true; joined;) {
    joined = false;
    outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (!overlap(a.box, b.box)) continue;
      const tally = {...a.tally};
      for (const [region, n] of Object.entries(b.tally)) tally[region] = (tally[region] || 0) + n;
      boxes[i] = {box: {south: Math.min(a.box.south, b.box.south), west: Math.min(a.box.west, b.box.west), north: Math.max(a.box.north, b.box.north), east: Math.max(a.box.east, b.box.east)},
        points: a.points + b.points, drawnAreaTiles: a.drawnAreaTiles + b.drawnAreaTiles, tiles: a.tiles + b.tiles, tally};
      boxes.splice(j, 1);joined = true;break outer;
    }
  }
  const regions = boxes.map(({box, points, drawnAreaTiles, tiles, tally}) => {
    const main = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'drawn';
    return {salesRegion: main, points, drawnAreaTiles, tiles,
      south: degrees(box.south), west: degrees(box.west), north: degrees(box.north), east: degrees(box.east), cells: (box.north - box.south) * (box.east - box.west)};
  }).sort((a, b) => b.points - a.points || b.drawnAreaTiles - a.drawnAreaTiles || a.south - b.south || a.west - b.west);
  const numbered = {}, suggested = [];
  let total = 0, covered = 0;
  for (const region of regions) {
    numbered[region.salesRegion] = (numbered[region.salesRegion] || 0) + 1;
    region.id = region.salesRegion + '-' + numbered[region.salesRegion];
    region.fits = region.cells <= MAX_REGION_CELLS && suggested.length < MAX_REGIONS && total + region.cells <= MAX_FILE_CELLS;
    if (region.fits) { suggested.push(region); total += region.cells; covered += region.points; }
  }
  const buildArgs = suggested.map(r => `--region ${r.id}:${r.south.toFixed(2)},${r.west.toFixed(2)},${r.north.toFixed(2)},${r.east.toFixed(2)}`);
  const share = counts.withPoint ? Math.round(covered / counts.withPoint * 1000) / 10 : 0;
  const verdict = `STREET REGIONS: ${counts.withPoint} CUSTOMERS WITH A MAP POINT (${counts.withoutPoint} WITHOUT, ${counts.outsideKingdom} OUTSIDE THE KINGDOM) IN ${cells.size} CELLS OF 0.01°; ${drawnAreas} DRAWN AREAS; ${regions.length} GROUPS; SUGGESTED ${suggested.length} REGIONS, ${total} CELLS, COVERING ${share}% OF THE POINTS`;
  return {mode: 'street-regions', readOnly: true, ...counts, bySalesRegion, cellsWithPoints: cells.size, drawnAreas, tileDegrees: TILE / CELLS_PER_DEGREE,
    regions, suggested: {regions: suggested.length, cells: total, pointsCovered: covered, share}, buildArgs, requestRegions: suggested.map(r => ({id: r.id, south: r.south, west: r.west, north: r.north, east: r.east})), verdict};
}

function run() {
  const home = process.env.HOME || '/home/youriedx', app = process.env.STREET_DIAG_APP || path.join(home, 'yourrest-crm');
  const database = process.env.STREET_DIAG_DATABASE || require(path.join(app, 'release', 'operations', 'config.cjs')).loadSettings(app).YR_DATABASE_PATH;
  const db = new DatabaseSync(database, {readOnly: true});
  try {
    const customers = db.prepare("SELECT json_extract(data, '$.latitude') AS latitude, json_extract(data, '$.longitude') AS longitude, json_extract(data, '$.location') AS location, json_extract(data, '$.region') AS region FROM crm_records WHERE kind = 'customer'").all();
    const hasAreas = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_work_areas'").get();
    const areas = hasAreas ? db.prepare('SELECT polygon FROM crm_work_areas').all() : [];
    return report({customers, areas});
  } finally { db.close(); }
}

if (require.main === module) {
  try { const result = run(); console.log(JSON.stringify(result, null, 2)); console.log(result.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run, report, coordinates};

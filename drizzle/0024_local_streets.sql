-- «بيانات شوارع محلية» (the owner, 2026-11-19: the port of GSCO 2.13.82, its migration 0051_local_streets): the streets of the regions
-- where Yourrest has customers, imported once from an OpenStreetMap extract (portable/import-street-data.mjs) so the map's «شارع بلا عملاء»
-- does not wait for the public Overpass services, which answered 502 or nothing on 2026-11-19. One row per 0.01° cell (about 1.1 km), named
-- exactly as the server names an Overpass box ("south,west,north,east" with two decimals, lib/work-area-streets.ts cellKey) and holding the
-- streets in the same compact form as crm_osm_street_cache; a cell with no street is stored empty so the region counts as covered. `region`
-- and `dataset` say which import wrote the row. Rows never expire and nothing but the import tool writes or removes them. A table of its own
-- (not a column of the cache): the cache's rows are replaced and cleaned by the server; these are not. Additive only: no existing table or
-- row changes.
-- Down: drizzle/rollback/0024_local_streets.down.sql (docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md, section 9-أك).
CREATE TABLE crm_osm_street_local (
 bbox_key TEXT PRIMARY KEY NOT NULL,
 cell_lat INTEGER NOT NULL,
 cell_lng INTEGER NOT NULL,
 south REAL NOT NULL,
 west REAL NOT NULL,
 north REAL NOT NULL,
 east REAL NOT NULL,
 ways TEXT NOT NULL,
 way_count INTEGER NOT NULL CHECK(way_count>=0),
 region TEXT NOT NULL,
 dataset TEXT NOT NULL,
 imported_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX crm_osm_street_local_cell ON crm_osm_street_local(cell_lat,cell_lng);

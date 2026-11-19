-- «خريطة المصانع»: the representatives' work areas and the streets with no customer (the owner, 2026-11-19: the port of GSCO 2.13.81
-- «خريطة المشاريع», its migration 0050_work_areas). crm_work_areas holds the area the sales manager drew for a field member (a representative
-- or a marketing officer, lib/roles.ts): one row per member, a GeoJSON Polygon of 3 to 200 corners and at most 40 km² (lib/work-area-geometry.ts
-- checks the shape before it is stored), who drew it and when, `version` raised by every save (a save that names another version is
-- refused) and `mutation_id`, the request that wrote it (a retry saves nothing twice). Without a row the area is 500 m around the member's
-- customers (worked out on every read, never stored). crm_osm_street_cache keeps OpenStreetMap's answer for a 0.01° box (Overpass, server
-- side, 30 days; boxes nobody asked for in 90 days are removed by the server). lib/work-areas-server.ts says the rules. Additive only: no
-- existing table or row changes.
-- Down: drizzle/rollback/0023_work_areas.down.sql (docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md, section 9-أك).
CREATE TABLE crm_work_areas (
 member_id TEXT PRIMARY KEY NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 polygon TEXT NOT NULL,
 vertices INTEGER NOT NULL CHECK(vertices BETWEEN 3 AND 200),
 area_m2 REAL NOT NULL CHECK(area_m2>0 AND area_m2<=40000000),
 updated_by TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 updated_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 mutation_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE crm_osm_street_cache (
 bbox_key TEXT PRIMARY KEY NOT NULL,
 south REAL NOT NULL,
 west REAL NOT NULL,
 north REAL NOT NULL,
 east REAL NOT NULL,
 ways TEXT NOT NULL,
 way_count INTEGER NOT NULL CHECK(way_count>=0),
 fetched_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX crm_osm_street_cache_fetched ON crm_osm_street_cache(fetched_at);

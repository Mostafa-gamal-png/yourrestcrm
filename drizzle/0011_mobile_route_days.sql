CREATE TABLE crm_mobile_route_days (
 id TEXT PRIMARY KEY NOT NULL,
 member_id TEXT NOT NULL REFERENCES crm_members(id),
 device_id TEXT NOT NULL,
 date TEXT NOT NULL,
 region_scope TEXT NOT NULL,
 started_at TEXT NOT NULL,
 ended_at TEXT,
 last_point_at TEXT,
 data TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 mutation_id TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX crm_mobile_route_one_open ON crm_mobile_route_days(member_id) WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE INDEX crm_mobile_route_day ON crm_mobile_route_days(date,member_id,started_at);
--> statement-breakpoint
CREATE TABLE crm_mobile_route_points (
 day_id TEXT NOT NULL REFERENCES crm_mobile_route_days(id) ON DELETE CASCADE,
 point_id TEXT NOT NULL,
 captured_at TEXT NOT NULL,
 received_at TEXT NOT NULL,
 latitude REAL NOT NULL,
 longitude REAL NOT NULL,
 accuracy REAL NOT NULL,
 stop_id TEXT REFERENCES crm_journey_stops(id) ON DELETE SET NULL,
 PRIMARY KEY(day_id,point_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX crm_mobile_route_point_time ON crm_mobile_route_points(day_id,captured_at);

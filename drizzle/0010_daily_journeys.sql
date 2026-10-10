CREATE TABLE crm_journey_stops (
 id TEXT PRIMARY KEY NOT NULL,
 member_id TEXT NOT NULL REFERENCES crm_members(id),
 date TEXT NOT NULL,
 customer_id TEXT NOT NULL REFERENCES crm_records(id),
 region_scope TEXT NOT NULL,
 snapshot TEXT NOT NULL,
 selected_at TEXT NOT NULL,
 closed_at TEXT,
 state TEXT NOT NULL CHECK(state IN ('en_route','onsite','completed','interrupted')),
 data TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 mutation_id TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX crm_journey_one_open ON crm_journey_stops(member_id) WHERE closed_at IS NULL;
--> statement-breakpoint
CREATE INDEX crm_journey_day ON crm_journey_stops(date,member_id,selected_at);
--> statement-breakpoint
CREATE TABLE crm_journey_points (
 stop_id TEXT NOT NULL REFERENCES crm_journey_stops(id) ON DELETE CASCADE,
 point_id TEXT NOT NULL,
 captured_at TEXT NOT NULL,
 received_at TEXT NOT NULL,
 latitude REAL NOT NULL,
 longitude REAL NOT NULL,
 accuracy REAL NOT NULL,
 PRIMARY KEY(stop_id,point_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX crm_journey_point_time ON crm_journey_points(stop_id,captured_at);
--> statement-breakpoint
CREATE TABLE crm_journey_links (
 stop_id TEXT NOT NULL REFERENCES crm_journey_stops(id) ON DELETE CASCADE,
 activity_id TEXT NOT NULL UNIQUE REFERENCES crm_records(id) ON DELETE CASCADE,
 PRIMARY KEY(stop_id,activity_id)
);

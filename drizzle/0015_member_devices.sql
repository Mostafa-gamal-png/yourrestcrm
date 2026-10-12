CREATE TABLE crm_member_devices (
 member_id TEXT NOT NULL REFERENCES crm_members(id) ON DELETE CASCADE,
 platform TEXT NOT NULL CHECK(platform IN ('android-app','browser')),
 app_version TEXT,
 reported_at TEXT NOT NULL,
 data TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(member_id,platform)
);
--> statement-breakpoint
CREATE INDEX crm_member_devices_reported ON crm_member_devices(reported_at);

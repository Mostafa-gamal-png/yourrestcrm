-- «خطة الغد» and «خطط المناديب» (the owner, 2026-11-19: the port of GSCO 2.13.83 with the owner's decisions). A representative or a
-- marketing officer (lib/roles.ts isFieldRole) prepares the plan of a day: one row of crm_daily_plans per member and day, and its stops in
-- crm_daily_plan_stops (a visit, a call or a WhatsApp contact on a customer, in order, each with an optional time and note). The plan is sent
-- to the supervisor before 22:00 Riyadh of the day before; sent later it is kept and marked late (`late`, decided by the first send,
-- `first_sent_at`, which is the device's clock for a plan sent from the device's outbox, within bounds: `first_sent_source`). A supervisor, the
-- sales manager or the administrator approves it, approves it with edits (a stop they add is `supervisor_state` 'added', one they change
-- 'edited', one of the member's they take out 'removed' and kept; the member can no longer change or delete any of them) or returns it with
-- a reason. `version` is raised by every write and a write that names another version is refused. crm_daily_plan_notes holds one note per
-- reviewer on a member's day (with a plan or without). lib/daily-plans.ts says the rules. Additive only: no existing table or row changes.
-- Down: drizzle/rollback/0022_daily_plans.down.sql (docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md, section 9-أي).
CREATE TABLE crm_daily_plans (
 id TEXT PRIMARY KEY NOT NULL,
 member_id TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
 status TEXT NOT NULL CHECK(status IN ('draft','sent','approved','approved_edited','returned')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 first_sent_at TEXT,
 first_sent_source TEXT CHECK(first_sent_source IS NULL OR first_sent_source IN ('server','device')),
 late INTEGER NOT NULL DEFAULT 0 CHECK(late IN (0,1)),
 sent_at TEXT,
 received_at TEXT,
 reviewed_by TEXT REFERENCES crm_members(id) ON DELETE RESTRICT,
 reviewed_at TEXT,
 return_reason TEXT NOT NULL DEFAULT '',
 mutation_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(member_id,date)
);
--> statement-breakpoint
CREATE INDEX crm_daily_plans_date_status ON crm_daily_plans(date,status);
--> statement-breakpoint
CREATE TABLE crm_daily_plan_stops (
 id TEXT PRIMARY KEY NOT NULL,
 plan_id TEXT NOT NULL REFERENCES crm_daily_plans(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position>=1),
 customer_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('visit','call','whatsapp')),
 planned_time TEXT NOT NULL DEFAULT '' CHECK(planned_time='' OR planned_time GLOB '[0-2][0-9]:[0-5][0-9]'),
 note TEXT NOT NULL DEFAULT '',
 added_by TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 supervisor_state TEXT NOT NULL DEFAULT '' CHECK(supervisor_state IN ('','added','edited','removed')),
 edited_by TEXT REFERENCES crm_members(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX crm_daily_plan_stops_plan ON crm_daily_plan_stops(plan_id,position);
--> statement-breakpoint
CREATE TABLE crm_daily_plan_notes (
 member_id TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
 reviewer_id TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 note TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 mutation_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(member_id,date,reviewer_id)
);

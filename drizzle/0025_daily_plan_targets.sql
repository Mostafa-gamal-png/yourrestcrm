-- «المستهدف في يوم الخطة» of «خطة الغد» (the owner, 2026-11-22: the port of GSCO 2.13.85, its migration 0053_daily_plan_targets): what a
-- representative or a marketing officer means to achieve on the plan's day, two whole numbers from 0 to 50: the new sales opportunities they
-- will record (`target_opportunities`; GSCO's new projects, which Yourrest has no counterpart of) and the new customers they will add by hand
-- (`target_customers`). Required to send a plan (lib/daily-plan-followups.ts); empty (NULL) for a plan made before this release or a draft
-- not finished. A reviewer may change them when approving with edits: `targets_edited` is then 1 and the member's own values are kept in
-- `rep_target_*` (set back to them: 0 and NULL again). One row per plan, deleted with its plan. A table of its own, not columns of
-- crm_daily_plans: that table and every other one stay exactly as they were, so the release before reads and writes plans as it did, and the
-- down migration drops this table alone. Additive only: no existing table or row changes.
-- Down: drizzle/rollback/0025_daily_plan_targets.down.sql (docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md, section 9-أن).
CREATE TABLE crm_daily_plan_targets (
 plan_id TEXT PRIMARY KEY NOT NULL REFERENCES crm_daily_plans(id) ON DELETE CASCADE,
 target_opportunities INTEGER CHECK(target_opportunities IS NULL OR (typeof(target_opportunities)='integer' AND target_opportunities BETWEEN 0 AND 50)),
 target_customers INTEGER CHECK(target_customers IS NULL OR (typeof(target_customers)='integer' AND target_customers BETWEEN 0 AND 50)),
 rep_target_opportunities INTEGER CHECK(rep_target_opportunities IS NULL OR (typeof(rep_target_opportunities)='integer' AND rep_target_opportunities BETWEEN 0 AND 50)),
 rep_target_customers INTEGER CHECK(rep_target_customers IS NULL OR (typeof(rep_target_customers)='integer' AND rep_target_customers BETWEEN 0 AND 50)),
 targets_edited INTEGER NOT NULL DEFAULT 0 CHECK(targets_edited IN (0,1)),
 updated_at TEXT NOT NULL
);

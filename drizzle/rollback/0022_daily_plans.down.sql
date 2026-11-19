-- The down migration of drizzle/0022_daily_plans.sql («خطة الغد» / «خطط المناديب»). It is NOT a migration: it lives outside drizzle/'s top
-- level, so neither the startup upgrade (portable/initialize.mjs reads drizzle/<number>*.sql only) nor the release manifest ever runs it.
-- Run it by hand only to go back to the release before 0022 while keeping every other row written since (docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md,
-- section 9-أي): the application stopped, after a backup. It drops the three plan tables (every plan, stop and plan note is lost), removes the
-- plans' own audit rows (actions 'daily-plan:…', read by nothing else; left behind they would fill the previous release's list of recent
-- changes), and takes 0022 out of the migration ledger, so the previous release (22 migrations) recognizes the database again. No other
-- table or row changes. One transaction: a failure changes nothing. Starting the release with 0022 again re-creates the empty tables.
BEGIN IMMEDIATE;
DROP TABLE IF EXISTS crm_daily_plan_notes;
DROP TABLE IF EXISTS crm_daily_plan_stops;
DROP TABLE IF EXISTS crm_daily_plans;
DELETE FROM crm_audit WHERE action LIKE 'daily-plan:%';
DELETE FROM yr_schema_migrations WHERE name='0022_daily_plans.sql';
COMMIT;

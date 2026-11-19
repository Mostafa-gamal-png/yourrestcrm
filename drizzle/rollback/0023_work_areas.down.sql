-- The down migration of drizzle/0023_work_areas.sql (the representatives' work areas and the street cache). It is NOT a migration: it lives
-- outside drizzle/'s top level, so neither the startup upgrade (portable/initialize.mjs reads drizzle/<number>*.sql only) nor the release
-- manifest ever runs it. Run it by hand, after drizzle/rollback/0024_local_streets.down.sql, only to go back to the release before 0023
-- (23 migrations, up to 0022_daily_plans.sql) while keeping every other row written since (docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md, section
-- 9-أك): the application stopped, after a backup. It refuses, changing nothing, while 0024 is still recorded (the guard below fails its
-- CHECK inside the transaction). It drops crm_work_areas (every drawn area is lost) and crm_osm_street_cache (OpenStreetMap's answers, asked
-- again when needed), removes the work areas' own audit rows (actions 'work-area:…', read by nothing else; left behind they would fill the
-- previous release's list of recent changes), and takes 0023 out of the migration ledger, so the previous release recognizes the database
-- again. No other table or row changes. One transaction: a failure changes nothing.
BEGIN IMMEDIATE;
CREATE TEMP TABLE yr_down_0023_guard(local_streets_still_recorded INTEGER NOT NULL CHECK(local_streets_still_recorded=0));
INSERT INTO yr_down_0023_guard SELECT COUNT(*) FROM yr_schema_migrations WHERE name='0024_local_streets.sql';
DROP TABLE yr_down_0023_guard;
DROP TABLE IF EXISTS crm_work_areas;
DROP TABLE IF EXISTS crm_osm_street_cache;
DELETE FROM crm_audit WHERE action LIKE 'work-area:%';
DELETE FROM yr_schema_migrations WHERE name='0023_work_areas.sql';
COMMIT;

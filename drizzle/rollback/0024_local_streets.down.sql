-- The down migration of drizzle/0024_local_streets.sql («بيانات شوارع محلية»). It is NOT a migration: it lives outside drizzle/'s top level,
-- so neither the startup upgrade (portable/initialize.mjs reads drizzle/<number>*.sql only) nor the release manifest ever runs it. Run it by
-- hand only to go back to the release before 0024 while keeping every other row written since (docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md,
-- section 9-أك): the application stopped, after a backup. It drops crm_osm_street_local (the imported streets are lost; the import tool
-- writes them again from the same file) and takes 0024 out of the migration ledger. No other table or row changes. One transaction: a
-- failure changes nothing. Starting the release with 0024 again re-creates the empty table.
BEGIN IMMEDIATE;
DROP TABLE IF EXISTS crm_osm_street_local;
DELETE FROM yr_schema_migrations WHERE name='0024_local_streets.sql';
COMMIT;

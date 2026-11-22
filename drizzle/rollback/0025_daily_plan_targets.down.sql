-- The down migration of drizzle/0025_daily_plan_targets.sql («المستهدف في يوم الخطة»). It is NOT a migration: it lives outside drizzle/'s
-- top level, so neither the startup upgrade (portable/initialize.mjs reads drizzle/<number>*.sql only) nor the release manifest ever runs
-- it. Run it by hand only to go back to the release before 0025 while keeping every other row written since (docs/OPERATIONS-DEVELOPMENT-
-- GUIDE-AR.md, section 9-أن): the application stopped, after a backup. It drops crm_daily_plan_targets (every plan's targets are lost; the
-- plans, their stops and notes stay as they are and the release before reads them as it always did) and takes 0025 out of the migration
-- ledger. The follow-up dates moved by «إضافة إلى خطة الغد» and «ترحيل إلى تاريخ…» stay moved, and their audit lines («ترحيل موعد
-- المتابعة») stay as the records' history. No other table or row changes. One transaction: a failure changes nothing. Starting the release
-- with 0025 again re-creates the empty table.
BEGIN IMMEDIATE;
DROP TABLE IF EXISTS crm_daily_plan_targets;
DELETE FROM yr_schema_migrations WHERE name='0025_daily_plan_targets.sql';
COMMIT;

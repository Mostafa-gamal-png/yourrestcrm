-- Customer service in the sales process (the owner, 2026-11-16, item 5 of the GSCO list, after GSCO 2.13.78 migration 0049). In Yourrest
-- the opportunity customer service registers is a crm_service_cases row, so the lead source and the routing at approval are columns of it:
-- `lead_group` ('service': customer service brought it in; 'system': the system filled it in from the record it was started from),
-- `lead_source` (the source in words), `lead_ref_kind`/`lead_ref_id` (that record: a lost opportunity, a dormant customer, a support
-- request, a missed visit, a complaint), `lead_note` (the words of «أخرى»), `route` ('sales': passed to the sales manager; 'service':
-- customer service keeps it), `routed_by`, `routed_at`. Every case registered before keeps NULL in all of them («غير محدد»; an approved one
-- reads as passed to sales) and an empty note. crm_service_role_tasks keeps the role customer service recorded when an opportunity it took
-- part in was won or lost («تسجيل دور خدمة العملاء»): one row per case once recorded; the waiting tasks are worked out from the cases.
-- No existing row changes.
ALTER TABLE crm_service_cases ADD COLUMN lead_group TEXT CHECK(lead_group IS NULL OR lead_group IN ('service','system'));
--> statement-breakpoint
ALTER TABLE crm_service_cases ADD COLUMN lead_source TEXT;
--> statement-breakpoint
ALTER TABLE crm_service_cases ADD COLUMN lead_ref_kind TEXT CHECK(lead_ref_kind IS NULL OR lead_ref_kind IN ('opportunity','customer','support','missed_visit','complaint'));
--> statement-breakpoint
ALTER TABLE crm_service_cases ADD COLUMN lead_ref_id TEXT;
--> statement-breakpoint
ALTER TABLE crm_service_cases ADD COLUMN lead_note TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE crm_service_cases ADD COLUMN route TEXT CHECK(route IS NULL OR route IN ('sales','service'));
--> statement-breakpoint
ALTER TABLE crm_service_cases ADD COLUMN routed_by TEXT REFERENCES crm_members(id);
--> statement-breakpoint
ALTER TABLE crm_service_cases ADD COLUMN routed_at TEXT;
--> statement-breakpoint
CREATE INDEX crm_service_cases_lead_ref ON crm_service_cases(lead_ref_kind,lead_ref_id);
--> statement-breakpoint
-- The opportunities customer service keeps: every achievement reads them first to leave out their sales, so the probe is an index.
CREATE INDEX crm_service_cases_held ON crm_service_cases(customer_id) WHERE route='service';
--> statement-breakpoint
CREATE TABLE crm_service_role_tasks (
 case_id TEXT PRIMARY KEY NOT NULL REFERENCES crm_service_cases(id) ON DELETE RESTRICT,
 outcome TEXT NOT NULL CHECK(outcome IN ('won','lost')),
 member_id TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 basis TEXT NOT NULL CHECK(basis IN ('owner','registrar','support')),
 closed_at TEXT NOT NULL,
 roles TEXT NOT NULL CHECK(json_valid(roles) AND json_type(roles)='array'),
 note TEXT NOT NULL,
 done_by TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 done_at TEXT NOT NULL,
 mutation_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX crm_service_role_tasks_member ON crm_service_role_tasks(member_id,done_at);

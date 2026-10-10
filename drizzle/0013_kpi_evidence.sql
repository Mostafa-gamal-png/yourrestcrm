CREATE TABLE crm_kpi_evidence (
 member_id TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 month TEXT NOT NULL,
 input TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 mutation_id TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 sales_revision INTEGER NOT NULL,
 scope_key TEXT NOT NULL,
 cutoff TEXT NOT NULL,
 PRIMARY KEY(member_id,month)
);
--> statement-breakpoint
CREATE INDEX crm_kpi_evidence_month ON crm_kpi_evidence(month);
--> statement-breakpoint
CREATE TABLE crm_kpi_evidence_state (
 id TEXT PRIMARY KEY NOT NULL CHECK(id='company'),
 revision INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO crm_kpi_evidence_state(id,revision) VALUES('company',0);
--> statement-breakpoint
-- Customer identity and territory changes invalidate prior history attestations.
CREATE TRIGGER crm_kpi_customer_insert AFTER INSERT ON crm_records
WHEN NEW.kind='customer' AND trim(COALESCE(json_extract(NEW.data,'$.code'),''))<>'' BEGIN
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
END;
--> statement-breakpoint
CREATE TRIGGER crm_kpi_customer_delete AFTER DELETE ON crm_records
WHEN OLD.kind='customer' AND trim(COALESCE(json_extract(OLD.data,'$.code'),''))<>'' BEGIN
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
END;
--> statement-breakpoint
CREATE TRIGGER crm_kpi_customer_identity_update AFTER UPDATE ON crm_records
WHEN (OLD.kind='customer' OR NEW.kind='customer') AND (
 OLD.kind IS NOT NEW.kind
 OR json_extract(OLD.data,'$.code') IS NOT json_extract(NEW.data,'$.code')
 OR json_extract(OLD.data,'$.region') IS NOT json_extract(NEW.data,'$.region')
) BEGIN
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
END;
--> statement-breakpoint
-- A confirmed quotation list must be reviewed again when issued evidence changes.
CREATE TRIGGER crm_kpi_issued_quote_insert AFTER INSERT ON crm_records
WHEN (NEW.kind='quote' AND json_extract(NEW.data,'$.status') IN ('sent','accepted','rejected'))
 OR (NEW.kind='activity' AND (json_extract(NEW.data,'$.type')='quote' OR json_extract(NEW.data,'$.salesStage')='quoted')) BEGIN
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
END;
--> statement-breakpoint
CREATE TRIGGER crm_kpi_issued_quote_delete AFTER DELETE ON crm_records
WHEN (OLD.kind='quote' AND json_extract(OLD.data,'$.status') IN ('sent','accepted','rejected'))
 OR (OLD.kind='activity' AND (json_extract(OLD.data,'$.type')='quote' OR json_extract(OLD.data,'$.salesStage')='quoted')) BEGIN
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
END;
--> statement-breakpoint
CREATE TRIGGER crm_kpi_issued_quote_update AFTER UPDATE ON crm_records
WHEN (
 (OLD.kind='quote' AND json_extract(OLD.data,'$.status') IN ('sent','accepted','rejected'))
 OR (NEW.kind='quote' AND json_extract(NEW.data,'$.status') IN ('sent','accepted','rejected'))
 OR (OLD.kind='activity' AND (json_extract(OLD.data,'$.type')='quote' OR json_extract(OLD.data,'$.salesStage')='quoted'))
 OR (NEW.kind='activity' AND (json_extract(NEW.data,'$.type')='quote' OR json_extract(NEW.data,'$.salesStage')='quoted'))
) AND (
 OLD.kind IS NOT NEW.kind OR OLD.parent_id IS NOT NEW.parent_id
 OR json_extract(OLD.data,'$.date') IS NOT json_extract(NEW.data,'$.date')
 OR json_extract(OLD.data,'$.status') IS NOT json_extract(NEW.data,'$.status')
 OR json_extract(OLD.data,'$.type') IS NOT json_extract(NEW.data,'$.type')
 OR json_extract(OLD.data,'$.salesStage') IS NOT json_extract(NEW.data,'$.salesStage')
 OR json_extract(OLD.data,'$.performedBy') IS NOT json_extract(NEW.data,'$.performedBy')
 OR json_extract(OLD.data,'$.responsibleId') IS NOT json_extract(NEW.data,'$.responsibleId')
 OR json_extract(OLD.data,'$.recordedByEmail') IS NOT json_extract(NEW.data,'$.recordedByEmail')
) BEGIN
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
END;

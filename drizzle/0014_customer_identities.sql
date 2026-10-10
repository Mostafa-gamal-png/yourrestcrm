-- CRM numbers identify individual factories. ERP references remain unchanged.
CREATE TABLE crm_customer_numbers (
 number INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id TEXT NOT NULL UNIQUE REFERENCES crm_records(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE crm_customer_code_aliases (
 customer_id TEXT NOT NULL REFERENCES crm_records(id) ON DELETE CASCADE,
 source_code TEXT NOT NULL,
 PRIMARY KEY(customer_id,source_code)
);
--> statement-breakpoint
CREATE TABLE crm_customer_identity_state (
 id TEXT PRIMARY KEY NOT NULL CHECK(id='company'),
 revision INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO crm_customer_identity_state(id,revision) VALUES('company',0);
--> statement-breakpoint
CREATE TABLE crm_customer_code_mappings (
 code_key TEXT PRIMARY KEY NOT NULL,
 customer_id TEXT NOT NULL REFERENCES crm_records(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO crm_customer_numbers(customer_id) SELECT id FROM crm_records WHERE kind='customer' ORDER BY created_at,id;
--> statement-breakpoint
INSERT INTO crm_customer_code_aliases(customer_id,source_code) SELECT id,CAST(json_extract(data,'$.code') AS TEXT) FROM crm_records WHERE kind='customer' AND length(trim(COALESCE(json_extract(data,'$.code'),'')))>0;
--> statement-breakpoint
CREATE TRIGGER crm_customer_identity_insert AFTER INSERT ON crm_records WHEN NEW.kind='customer' BEGIN
 INSERT INTO crm_customer_numbers(customer_id) VALUES(NEW.id);
 INSERT OR IGNORE INTO crm_customer_code_aliases(customer_id,source_code) SELECT NEW.id,CAST(json_extract(NEW.data,'$.code') AS TEXT) WHERE length(trim(COALESCE(json_extract(NEW.data,'$.code'),'')))>0;
 UPDATE crm_customer_identity_state SET revision=revision+1 WHERE id='company';
END;
--> statement-breakpoint
CREATE TRIGGER crm_customer_identity_update AFTER UPDATE OF data ON crm_records WHEN NEW.kind='customer' AND json_extract(OLD.data,'$.code') IS NOT json_extract(NEW.data,'$.code') BEGIN
 INSERT OR IGNORE INTO crm_customer_code_aliases(customer_id,source_code) SELECT OLD.id,CAST(json_extract(OLD.data,'$.code') AS TEXT) WHERE length(trim(COALESCE(json_extract(OLD.data,'$.code'),'')))>0;
 INSERT OR IGNORE INTO crm_customer_code_aliases(customer_id,source_code) SELECT NEW.id,CAST(json_extract(NEW.data,'$.code') AS TEXT) WHERE length(trim(COALESCE(json_extract(NEW.data,'$.code'),'')))>0;
 UPDATE crm_customer_identity_state SET revision=revision+1 WHERE id='company';
END;
--> statement-breakpoint
CREATE TRIGGER crm_customer_identity_delete AFTER DELETE ON crm_records WHEN OLD.kind='customer' BEGIN
 UPDATE crm_customer_identity_state SET revision=revision+1 WHERE id='company';
END;
--> statement-breakpoint
-- A cleared current code still has historical aliases. The older KPI trigger
-- covers non-empty current codes; this covers deletion of retained aliases.
CREATE TRIGGER crm_customer_retained_alias_delete BEFORE DELETE ON crm_records
WHEN OLD.kind='customer' AND trim(COALESCE(json_extract(OLD.data,'$.code'),''))='' AND EXISTS(SELECT 1 FROM crm_customer_code_aliases WHERE customer_id=OLD.id) BEGIN
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
END;
--> statement-breakpoint
CREATE TRIGGER crm_customer_mapping_insert AFTER INSERT ON crm_customer_code_mappings BEGIN
 UPDATE crm_customer_identity_state SET revision=revision+1 WHERE id='company';
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
 UPDATE crm_kpi_evidence_state SET revision=revision+1 WHERE id='company';
END;
--> statement-breakpoint
CREATE TRIGGER crm_customer_mapping_update AFTER UPDATE ON crm_customer_code_mappings BEGIN
 UPDATE crm_customer_identity_state SET revision=revision+1 WHERE id='company';
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
 UPDATE crm_kpi_evidence_state SET revision=revision+1 WHERE id='company';
END;
--> statement-breakpoint
CREATE TRIGGER crm_customer_mapping_delete AFTER DELETE ON crm_customer_code_mappings BEGIN
 UPDATE crm_customer_identity_state SET revision=revision+1 WHERE id='company';
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
 UPDATE crm_kpi_evidence_state SET revision=revision+1 WHERE id='company';
END;

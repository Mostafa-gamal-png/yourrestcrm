CREATE TABLE crm_erp_import_state (
 id TEXT PRIMARY KEY NOT NULL CHECK(id='yourrest-industries'),
 revision INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO crm_erp_import_state(id,revision) VALUES('yourrest-industries',0);
--> statement-breakpoint
CREATE TABLE crm_erp_employee_mappings (
 employee_id TEXT PRIMARY KEY NOT NULL,
 rep_id TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE crm_erp_category_mappings (
 category TEXT PRIMARY KEY NOT NULL,
 product TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE crm_erp_imports (
 id TEXT PRIMARY KEY NOT NULL,
 actor_id TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 fingerprint TEXT NOT NULL,
 file_name TEXT NOT NULL,
 result TEXT NOT NULL,
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE crm_erp_sales (
 id TEXT PRIMARY KEY NOT NULL,
 document_key TEXT NOT NULL UNIQUE,
 content_hash TEXT NOT NULL,
 mapped_hash TEXT NOT NULL,
 reference TEXT NOT NULL,
 document_type TEXT NOT NULL CHECK(document_type IN ('sale','return')),
 date TEXT NOT NULL,
 employee_id TEXT NOT NULL,
 rep_id TEXT NOT NULL REFERENCES crm_members(id) ON DELETE RESTRICT,
 branch TEXT NOT NULL,
 region_scope TEXT NOT NULL,
 customer_code TEXT NOT NULL,
 customer_name TEXT NOT NULL,
 data TEXT NOT NULL,
 total_cents INTEGER NOT NULL,
 import_id TEXT NOT NULL REFERENCES crm_erp_imports(id) ON DELETE RESTRICT,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX crm_erp_sales_rep_date ON crm_erp_sales(rep_id,date);
--> statement-breakpoint
CREATE INDEX crm_erp_sales_date ON crm_erp_sales(date);
--> statement-breakpoint
-- A manual write between ERP preview and commit invalidates that preview too.
CREATE TRIGGER crm_erp_manual_sale_insert AFTER INSERT ON crm_sales BEGIN
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
END;
--> statement-breakpoint
CREATE TRIGGER crm_erp_manual_sale_update AFTER UPDATE ON crm_sales BEGIN
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
END;
--> statement-breakpoint
CREATE TRIGGER crm_erp_manual_sale_delete AFTER DELETE ON crm_sales BEGIN
 UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries';
END;

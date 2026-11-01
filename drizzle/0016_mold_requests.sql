-- Mold manufacturing requests the CRM sends to the production application (yourrest-products), contract version 1
-- (docs/MOLD-REQUESTS-CONTRACT-AR.md). The CRM owns the request; production owns its status, kept here only as the last answer
-- received. No foreign key: a request outlives a customer or member change, and no existing delete is held back by it.
CREATE TABLE crm_mold_requests (
 id TEXT PRIMARY KEY NOT NULL,
 member_id TEXT NOT NULL,
 customer_id TEXT NOT NULL,
 legacy_order_no INTEGER UNIQUE,
 data TEXT NOT NULL,
 accepted TEXT,
 cancelled_at TEXT,
 cancel_reason TEXT NOT NULL DEFAULT '',
 outbox TEXT CHECK(outbox IN ('send','cancel')),
 attempts INTEGER NOT NULL DEFAULT 0,
 first_failed_at TEXT,
 next_attempt_at TEXT,
 last_attempt_at TEXT,
 last_error TEXT,
 remote TEXT,
 remote_at TEXT,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 mutation_id TEXT
);
--> statement-breakpoint
CREATE INDEX crm_mold_requests_member ON crm_mold_requests(member_id);
--> statement-breakpoint
CREATE INDEX crm_mold_requests_customer ON crm_mold_requests(customer_id);
--> statement-breakpoint
CREATE INDEX crm_mold_requests_outbox ON crm_mold_requests(outbox,next_attempt_at);

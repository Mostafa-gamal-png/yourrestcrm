-- Design files the CRM attaches to a mold request (the contract's addition «ملفات التصميم», 2026-11-02, docs/MOLD-REQUESTS-CONTRACT-AR.md).
-- The bytes live in the private object store (YR_OBJECTS_PATH) under object_key; the row is the CRM's record of the file and of its
-- sending to production (design-files, design-file-delete), tried again on the §6 timetable like the request itself. id is the
-- file's crmFileId, never given to another file. A deleted file keeps its row (deleted_at) without its bytes (object_key NULL).
CREATE TABLE crm_mold_design_files (
 id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL REFERENCES crm_mold_requests(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL,
 name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('pdf','image','other')),
 content_type TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size>=0),
 sha256 TEXT NOT NULL,
 object_key TEXT,
 created_at TEXT NOT NULL,
 deleted_at TEXT,
 outbox TEXT CHECK(outbox IN ('send','delete')),
 attempts INTEGER NOT NULL DEFAULT 0,
 first_failed_at TEXT,
 next_attempt_at TEXT,
 last_attempt_at TEXT,
 last_error TEXT,
 remote_file_id TEXT,
 sent_at TEXT,
 version INTEGER NOT NULL DEFAULT 1,
 mutation_id TEXT
);
--> statement-breakpoint
CREATE INDEX crm_mold_design_files_request ON crm_mold_design_files(request_id);
--> statement-breakpoint
CREATE INDEX crm_mold_design_files_outbox ON crm_mold_design_files(outbox,next_attempt_at);

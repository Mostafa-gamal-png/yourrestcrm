-- The supervisor's notes on a member's work (the owner, 2026-11-09, from GSCO: «كارت ملاحظات المشرف على شغلك يظهر للمندوب حتى يضغط
-- قرأت، والمشرف يرى وقت القراءة»). On «تقرير يوم المندوب» the administrator, a sales manager or a supervisor writes «النتيجة» and
-- «الإجراء المطلوب» on one visit or contact of a member of their team (crm_daily_entry_reviews, one row per activity: a crm_records
-- activity id) and on the member's whole day (crm_daily_report_reviews, one row per member and day). Each save raises version; the
-- member's «قرأت» is a crm_audit row whose id names the review and its version (review-read:entry:<activity>:<version>,
-- review-read:day:<member>:<date>:<version>), so an edited note is unread again. No other table changes.
CREATE TABLE crm_daily_entry_reviews (
 activity_id TEXT PRIMARY KEY NOT NULL,
 member_id TEXT NOT NULL,
 date TEXT NOT NULL,
 result TEXT NOT NULL,
 action TEXT NOT NULL,
 reviewed_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 mutation_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX crm_daily_entry_reviews_member_date ON crm_daily_entry_reviews(member_id,date);
--> statement-breakpoint
CREATE INDEX crm_daily_entry_reviews_member_updated ON crm_daily_entry_reviews(member_id,updated_at);
--> statement-breakpoint
CREATE TABLE crm_daily_report_reviews (
 member_id TEXT NOT NULL,
 date TEXT NOT NULL,
 result TEXT NOT NULL,
 action TEXT NOT NULL,
 reviewed_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 mutation_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(member_id,date)
);
--> statement-breakpoint
CREATE INDEX crm_daily_report_reviews_member_updated ON crm_daily_report_reviews(member_id,updated_at);

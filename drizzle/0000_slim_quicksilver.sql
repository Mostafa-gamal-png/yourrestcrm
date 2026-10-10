CREATE TABLE `crm_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `crm_audit_record` ON `crm_audit` (`record_id`);--> statement-breakpoint
CREATE TABLE `crm_members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`branch` text NOT NULL,
	`supervisor_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`target` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_members_email` ON `crm_members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `crm_members_user` ON `crm_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `crm_records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text,
	`assigned_to` text NOT NULL,
	`branch` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `crm_records_kind` ON `crm_records` (`kind`);--> statement-breakpoint
CREATE INDEX `crm_records_parent` ON `crm_records` (`parent_id`);--> statement-breakpoint
CREATE INDEX `crm_records_assigned` ON `crm_records` (`assigned_to`);--> statement-breakpoint
CREATE TABLE `crm_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL
);

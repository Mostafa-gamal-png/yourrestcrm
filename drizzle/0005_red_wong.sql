CREATE TABLE `crm_target_sets` (
	`kind` text NOT NULL,
	`scope_id` text NOT NULL,
	`month` text NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`mutation_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_target_sets_scope_month` ON `crm_target_sets` (`kind`,`scope_id`,`month`);--> statement-breakpoint
CREATE INDEX `crm_target_sets_month` ON `crm_target_sets` (`month`);
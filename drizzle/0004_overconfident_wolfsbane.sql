CREATE TABLE `crm_performance_targets` (
	`member_id` text NOT NULL,
	`month` text NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`mutation_id` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_targets_member_month` ON `crm_performance_targets` (`member_id`,`month`);--> statement-breakpoint
CREATE TABLE `crm_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`rep_id` text NOT NULL,
	`branch` text NOT NULL,
	`date` text NOT NULL,
	`reference` text NOT NULL,
	`reference_key` text NOT NULL,
	`data` text NOT NULL,
	`total_cents` integer NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`void_reason` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`mutation_id` text NOT NULL,
	`create_fingerprint` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `crm_records`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rep_id`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_sales_customer_reference` ON `crm_sales` (`customer_id`,`reference_key`);--> statement-breakpoint
CREATE INDEX `crm_sales_rep_date` ON `crm_sales` (`rep_id`,`date`);--> statement-breakpoint
CREATE INDEX `crm_sales_date` ON `crm_sales` (`date`);
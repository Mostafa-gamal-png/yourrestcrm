CREATE TABLE `crm_visit_files` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `crm_visit_files_customer` ON `crm_visit_files` (`customer_id`);
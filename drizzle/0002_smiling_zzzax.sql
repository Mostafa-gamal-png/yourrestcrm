CREATE TABLE `crm_visit_numbers` (
	`number` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_visit_numbers_record_id_unique` ON `crm_visit_numbers` (`record_id`);
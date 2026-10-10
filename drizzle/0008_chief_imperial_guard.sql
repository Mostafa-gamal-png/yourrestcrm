CREATE TABLE `crm_service_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`status` text NOT NULL,
	`creator_id` text NOT NULL,
	`service_manager_id` text,
	`sales_manager_id` text,
	`assigned_to` text,
	`supervisor_id` text,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`mutation_id` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `crm_records`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`creator_id`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`service_manager_id`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sales_manager_id`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assigned_to`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supervisor_id`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `crm_service_customer` ON `crm_service_cases` (`customer_id`);--> statement-breakpoint
CREATE INDEX `crm_service_creator` ON `crm_service_cases` (`creator_id`);--> statement-breakpoint
CREATE INDEX `crm_service_status` ON `crm_service_cases` (`status`);
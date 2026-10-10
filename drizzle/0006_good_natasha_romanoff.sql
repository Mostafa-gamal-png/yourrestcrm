CREATE TABLE `crm_kpi_assessments` (
	`member_id` text NOT NULL,
	`month` text NOT NULL,
	`input` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`mutation_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_kpi_member_month` ON `crm_kpi_assessments` (`member_id`,`month`);--> statement-breakpoint
CREATE INDEX `crm_kpi_month` ON `crm_kpi_assessments` (`month`);
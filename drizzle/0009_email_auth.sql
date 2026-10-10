ALTER TABLE crm_members ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TRIGGER crm_member_revoke_auth AFTER UPDATE OF email,active,role,branch,supervisor_id,region_scope,user_id ON crm_members
WHEN OLD.email IS NOT NEW.email OR OLD.active IS NOT NEW.active OR OLD.role IS NOT NEW.role OR OLD.branch IS NOT NEW.branch OR OLD.supervisor_id IS NOT NEW.supervisor_id OR OLD.region_scope IS NOT NEW.region_scope OR OLD.user_id IS NOT NEW.user_id
BEGIN
 UPDATE crm_members SET auth_version=OLD.auth_version+1 WHERE id=NEW.id;
END;
--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`user_id` text,
	`user_version` integer,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ready` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`attempt_id` text,
	`consumed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_challenges_subject_idx` ON `auth_challenges` (`subject_hash`);--> statement-breakpoint
CREATE INDEX `auth_challenges_expiry_idx` ON `auth_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`event` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_events_date_idx` ON `auth_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_version` integer NOT NULL,
	`email` text NOT NULL,
	`challenge_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `crm_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_challenge_idx` ON `auth_sessions` (`challenge_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_idx` ON `auth_sessions` (`expires_at`);
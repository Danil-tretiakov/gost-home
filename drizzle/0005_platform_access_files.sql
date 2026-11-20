CREATE TABLE `notification_reads` (
	`user_email` text NOT NULL,
	`key` text NOT NULL,
	`read_at` text NOT NULL,
	PRIMARY KEY(`user_email`, `key`)
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`display_name` text NOT NULL,
	`member_name` text,
	`role` text NOT NULL,
	`finance` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`first_seen_at` text,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_email_uq` ON `team_members` (`email`);--> statement-breakpoint
ALTER TABLE `ai_assets` ADD `storage_key` text;--> statement-breakpoint
ALTER TABLE `ai_assets` ADD `mime` text;--> statement-breakpoint
ALTER TABLE `ai_assets` ADD `size` integer;--> statement-breakpoint
ALTER TABLE `ai_assets` ADD `file_name` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `responsible` text;
CREATE TABLE `ai_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`job_id` text,
	`expires_at` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `ai_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_assets_project_idx` ON `ai_assets` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`endpoint` text NOT NULL,
	`params` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`request_id` text,
	`status_url` text,
	`result_url` text,
	`error` text,
	`cost` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `ai_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_jobs_idem_uq` ON `ai_generation_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ai_jobs_project_idx` ON `ai_generation_jobs` (`project_id`);--> statement-breakpoint
CREATE TABLE `ai_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text,
	`title` text NOT NULL,
	`brief` text DEFAULT '' NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`motion_prompt` text DEFAULT '' NOT NULL,
	`approved_asset_id` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `edit_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`number` integer NOT NULL,
	`drive_url` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `edit_versions_number_uq` ON `edit_versions` (`content_id`,`number`);--> statement-breakpoint
CREATE TABLE `feedback_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`version_id` text,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `edit_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_content_idx` ON `feedback_comments` (`content_id`,`at`);--> statement-breakpoint
CREATE TABLE `instagram_media` (
	`media_id` text PRIMARY KEY NOT NULL,
	`permalink` text,
	`caption` text,
	`media_type` text,
	`media_product_type` text,
	`timestamp` text NOT NULL,
	`like_count` integer,
	`comments_count` integer,
	`content_id` text,
	`matched_at` text,
	`matched_by` text,
	`ignored` integer DEFAULT 0 NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instagram_media_content_uq` ON `instagram_media` (`content_id`);--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`provider` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`account_id` text,
	`account_name` text,
	`token_cipher` text,
	`token_expires_at` text,
	`last_sync_at` text,
	`last_error` text,
	`oauth_state` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payable_units` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`basis` text NOT NULL,
	`basis_key` text NOT NULL,
	`content_id` text,
	`shoot_date` text,
	`period` text NOT NULL,
	`rate_rule_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'THB' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`voided_at` text,
	`void_reason` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rate_rule_id`) REFERENCES `rate_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payable_units_basis_uq` ON `payable_units` (`member`,`basis`,`basis_key`);--> statement-breakpoint
CREATE INDEX `payable_units_period_idx` ON `payable_units` (`period`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'THB' NOT NULL,
	`paid_at` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`voided_at` text,
	`void_reason` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_member_idx` ON `payments` (`member`,`paid_at`);--> statement-breakpoint
CREATE TABLE `rate_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`model` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'THB' NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_rules_member_idx` ON `rate_rules` (`member`);--> statement-breakpoint
ALTER TABLE `status_events` ADD `version_id` text;
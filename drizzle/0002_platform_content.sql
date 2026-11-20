CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	`before` text,
	`after` text
);
--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity`,`entity_id`,`at`);--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`primary_member` text NOT NULL,
	`shoot_id` text,
	`places` text DEFAULT '' NOT NULL,
	`planned_publish_date` text,
	`published_at` text,
	`production_status` text NOT NULL,
	`drive_url` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`shoot_id`) REFERENCES `shoots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_items_planned_idx` ON `content_items` (`planned_publish_date`);--> statement-breakpoint
CREATE INDEX `content_items_status_idx` ON `content_items` (`production_status`);--> statement-breakpoint
CREATE INDEX `content_items_shoot_idx` ON `content_items` (`shoot_id`);--> statement-breakpoint
CREATE TABLE `content_participants` (
	`content_id` text NOT NULL,
	`member` text NOT NULL,
	PRIMARY KEY(`content_id`, `member`),
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `status_events_content_idx` ON `status_events` (`content_id`,`at`);
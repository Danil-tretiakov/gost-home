CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`assignee` text,
	`due_date` text,
	`due_time` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`shoot_id` text,
	`content_id` text,
	`completed_at` text,
	`archived_at` text,
	`archived_by` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`shoot_id`) REFERENCES `shoots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_shoot_idx` ON `tasks` (`shoot_id`);--> statement-breakpoint
CREATE INDEX `tasks_content_idx` ON `tasks` (`content_id`);
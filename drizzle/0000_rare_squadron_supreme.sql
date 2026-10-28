CREATE TABLE `shoots` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`time` text NOT NULL,
	`duration` integer NOT NULL,
	`format` text NOT NULL,
	`status` text NOT NULL,
	`project` text NOT NULL,
	`location` text NOT NULL,
	`participants` text NOT NULL,
	`notes` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);

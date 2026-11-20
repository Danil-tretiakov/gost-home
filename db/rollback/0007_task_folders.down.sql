-- Rollback for 0007_task_folders. Removes ONLY what 0007 added. Export a full backup first.
-- Tasks keep everything except their folder; folders and the folder assignment are lost.
-- Then remove the 0007 entry from drizzle/meta/_journal.json and the d1_migrations row named 0007_task_folders.sql.
ALTER TABLE `tasks` DROP COLUMN `folder_id`;
DROP TABLE IF EXISTS `task_folders`;

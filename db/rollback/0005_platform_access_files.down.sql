-- Rollback for 0005_platform_access_files. Removes ONLY what 0005 added. Export a full backup first.
-- R2 objects referenced by ai_assets.storage_key are NOT deleted by this script.
-- Then remove the 0005 entry from drizzle/meta/_journal.json and the d1_migrations row named 0005_platform_access_files.
DROP INDEX IF EXISTS `team_members_email_uq`;
DROP TABLE IF EXISTS `team_members`;
DROP TABLE IF EXISTS `notification_reads`;
ALTER TABLE `ai_assets` DROP COLUMN `storage_key`;
ALTER TABLE `ai_assets` DROP COLUMN `mime`;
ALTER TABLE `ai_assets` DROP COLUMN `size`;
ALTER TABLE `ai_assets` DROP COLUMN `file_name`;
ALTER TABLE `content_items` DROP COLUMN `responsible`;

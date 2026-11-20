-- Rollback for 0003_platform_finance_ai. Removes ONLY objects added by that migration; shoots and 0002 data stay.
-- Kept outside drizzle/ so the Sites migration runner never picks it up. Export data first if it must be kept.
-- Then remove the 0003 entry from drizzle/meta/_journal.json and the d1_migrations row named 0003_platform_finance_ai.
DROP TABLE IF EXISTS `integration_connections`;
DROP TABLE IF EXISTS `instagram_media`;
DROP TABLE IF EXISTS `ai_generation_jobs`;
DROP TABLE IF EXISTS `ai_assets`;
DROP TABLE IF EXISTS `ai_projects`;
DROP TABLE IF EXISTS `payments`;
DROP TABLE IF EXISTS `payable_units`;
DROP TABLE IF EXISTS `rate_rules`;
DROP TABLE IF EXISTS `feedback_comments`;
DROP TABLE IF EXISTS `edit_versions`;
-- SQLite 3.35+ (D1) supports DROP COLUMN:
ALTER TABLE `status_events` DROP COLUMN `version_id`;

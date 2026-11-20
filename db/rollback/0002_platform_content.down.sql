-- Rollback for 0002_platform_content. Removes ONLY the tables added by that migration.
-- The legacy `shoots` table and its rows are not touched.
-- Kept outside drizzle/ so the Sites migration runner never picks it up.
-- Run manually (wrangler d1 execute ... --file) after exporting content_items if any data must be kept,
-- then remove the 0002 entry from drizzle/meta/_journal.json and the d1_migrations row named 0002_platform_content.
DROP TABLE IF EXISTS `status_events`;
DROP TABLE IF EXISTS `content_participants`;
DROP TABLE IF EXISTS `content_items`;
DROP TABLE IF EXISTS `audit_events`;
DROP TABLE IF EXISTS `app_settings`;

-- Rollback for 0004_platform_tasks. Removes ONLY the tasks table; shoots, content and finance stay.
-- Kept outside drizzle/ so the Sites migration runner never picks it up. Export a full backup first if tasks must be kept.
-- Then remove the 0004 entry from drizzle/meta/_journal.json and the d1_migrations row named 0004_platform_tasks.
DROP INDEX IF EXISTS `tasks_content_idx`;
DROP INDEX IF EXISTS `tasks_shoot_idx`;
DROP INDEX IF EXISTS `tasks_status_idx`;
DROP TABLE IF EXISTS `tasks`;

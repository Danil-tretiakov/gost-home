-- Rollback for 0006_owner_login. Removes ONLY what 0006 added (own password sign-in for Cloudflare hosting).
-- After this the owner password stored on the site is gone; sign-in falls back to the OWNER_PASSWORD secret, if set.
-- Then remove the 0006 entry from drizzle/meta/_journal.json and the d1_migrations row named 0006_owner_login.sql.
DROP TABLE IF EXISTS `auth_attempts`;
DROP TABLE IF EXISTS `auth_credentials`;

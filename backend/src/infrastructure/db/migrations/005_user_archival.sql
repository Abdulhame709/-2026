ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DROP INDEX IF EXISTS ux_users_username;
CREATE UNIQUE INDEX ux_users_username ON users (lower(username)) WHERE deleted_at IS NULL;

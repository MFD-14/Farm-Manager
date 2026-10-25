-- Account management: owners add and manage people, everyone can change their
-- own email and password.
--   active                accounts are deactivated, never deleted: task events
--                         reference the people who did the work
--   token_version         bumped on password change / reset / deactivation so
--                         every earlier sign-in on every phone stops working
--   must_change_password  set when the owner hands out a generated password
ALTER TABLE users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));

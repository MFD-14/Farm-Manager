-- Self sign-up: a person creates their own account from the sign-in screen and
-- can't sign in until an owner approves it under People.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_approval boolean NOT NULL DEFAULT false;

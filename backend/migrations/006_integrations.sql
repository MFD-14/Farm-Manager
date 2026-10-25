-- WhatsApp reminders and Claude photo checking, configured in the app.
-- Credentials live in farm_settings key 'integrations' (server-side only; the
-- API never returns them), with environment variables as defaults.

-- Per-person WhatsApp reminders switch.
ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_opt_in boolean NOT NULL DEFAULT true;

-- Outbound delivery detail for the owner's activity view.
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS to_phone text;
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS error text;

-- Claude usage per photo check, for the monthly cost view and spending cap.
ALTER TABLE vim_jobs ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE vim_jobs ADD COLUMN IF NOT EXISTS input_tokens integer;
ALTER TABLE vim_jobs ADD COLUMN IF NOT EXISTS output_tokens integer;
ALTER TABLE vim_jobs ADD COLUMN IF NOT EXISTS cost_usd numeric(10,5);
ALTER TABLE vim_jobs ADD COLUMN IF NOT EXISTS last_error text;

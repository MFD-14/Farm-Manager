-- WFM-OPS-SPEC v1.0 Section 6.1 schema.
-- All tables carry id uuid pk, created_at, updated_at unless noted.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Users, roles, devices ────────────────────────────────────────────────────
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name        text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner','caretaker','admin')),
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  platform      text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at  timestamptz,
  last_seen_event_uuid uuid,
  clock_skew_ms bigint DEFAULT 0,   -- measured at sync handshake (spec 5.4)
  push_token    text,
  revoked       boolean NOT NULL DEFAULT false
);

-- ── Reference layer ──────────────────────────────────────────────────────────
CREATE TABLE assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('pump','borehole','tank','pool','drip_block','sprayer',
                                            'generator','coop','kraal','fence_section','vehicle','tool')),
  parent_id   uuid REFERENCES assets(id),
  meters      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- e.g. {"pump_run_hours": 132.4}
  criticality text NOT NULL DEFAULT 'P2' CHECK (criticality IN ('P0','P1','P2')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  supplier_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('block','bed','paddock','house','store','zone')),
  geom        jsonb,                       -- GeoJSON polygon; geography optional without PostGIS
  parent_id   uuid REFERENCES locations(id),
  plant_count int,
  crop        text,
  irrigated   boolean NOT NULL DEFAULT false,
  rainfed_capable boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE herds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  species     text NOT NULL,
  head_count  int NOT NULL DEFAULT 0,      -- maintained by fold from events
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE animals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag         text UNIQUE NOT NULL,
  herd_id     uuid REFERENCES herds(id),
  sex         text,
  birth_date  date,
  status      text NOT NULL DEFAULT 'active',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  species       text NOT NULL DEFAULT 'poultry',
  name          text NOT NULL,
  house_location_id uuid REFERENCES locations(id),
  placed_on     date,
  placed_count  int,
  current_count int,                        -- maintained by fold
  stage         text NOT NULL DEFAULT 'planned',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  unit           text NOT NULL,
  category       text NOT NULL CHECK (category IN ('feed','chemical','vaccine','fuel','spare','seed')),
  on_hand        numeric NOT NULL DEFAULT 0,   -- projection from inventory_moves
  reorder_point  numeric,
  reorder_qty    numeric,
  withdrawal_days int,
  phi_days       int,
  irac_group     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_moves (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id           uuid NOT NULL REFERENCES inventory_items(id),
  qty               numeric NOT NULL,
  direction         text NOT NULL CHECK (direction IN ('in','out','adjust')),
  source_event_uuid uuid,
  unit_cost         numeric,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inventory_moves_source_uniq
  ON inventory_moves(item_id, source_event_uuid) WHERE source_event_uuid IS NOT NULL;

-- ── Task engine ──────────────────────────────────────────────────────────────
CREATE TABLE task_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL,
  title              text NOT NULL,
  title_local        text,
  domain             text NOT NULL CHECK (domain IN ('W','C','K','P','A','F')),
  subject_type       text NOT NULL DEFAULT 'none' CHECK (subject_type IN ('asset','location','batch','herd','none')),
  default_subject_id uuid,
  priority           text NOT NULL CHECK (priority IN ('P0','P1','P2','P3')),
  est_minutes        int NOT NULL DEFAULT 1,
  instructions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  checklist          jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_policy    jsonb NOT NULL DEFAULT '{"classes":["E0"]}'::jsonb,
  schedule           jsonb,               -- null for trigger-only templates
  guards             jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalation_profile text,
  active             boolean NOT NULL DEFAULT true,
  version            int NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE TABLE task_instances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      uuid NOT NULL REFERENCES task_templates(id),
  template_code    text NOT NULL,
  template_version int NOT NULL,
  period_key       text NOT NULL,
  subject_type     text NOT NULL DEFAULT 'none',
  subject_id       uuid,
  assignee_id      uuid REFERENCES users(id),
  title            text NOT NULL,
  priority         text NOT NULL,
  est_minutes      int NOT NULL DEFAULT 1,
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  release_at       timestamptz,
  due_at           timestamptz,
  grace_until      timestamptz,
  expires_at       timestamptz,
  state            text NOT NULL DEFAULT 'scheduled',
  missed_count     int NOT NULL DEFAULT 0,
  deferral_count   int NOT NULL DEFAULT 0,
  rejection_count  int NOT NULL DEFAULT 0,
  blocked_by       uuid,                  -- same-asset collision link (spec 3.6)
  evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification     jsonb,
  escalation_state jsonb NOT NULL DEFAULT '{}'::jsonb,   -- rungs already fired
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- Release idempotency (spec 3.1): unique per template + period + subject
CREATE UNIQUE INDEX task_instances_release_uniq
  ON task_instances(template_id, period_key, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX task_instances_state_idx ON task_instances(state);
CREATE INDEX task_instances_due_idx ON task_instances(due_at);

CREATE TABLE task_events (
  event_uuid  uuid PRIMARY KEY,
  seq         bigint GENERATED ALWAYS AS IDENTITY,   -- total order for deterministic replay
  instance_id uuid,                        -- null allows farm-level events
  actor_type  text NOT NULL CHECK (actor_type IN ('caretaker','owner','system','vim','whatsapp')),
  actor_id    uuid,
  type        text NOT NULL CHECK (type IN (
    'released','seen','started','field_recorded','media_attached',
    'done_reported','skip_requested','problem_flagged',
    'auto_verified','review_required','verified_closed',
    'rejected_reopened','missed','expired','cancelled','superseded',
    'corrected','deferred','reassigned','escalated',
    'skip_approved','skip_denied','unblocked','rolled','retake_requested')),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  device_time timestamptz,
  server_time timestamptz NOT NULL DEFAULT clock_timestamp(),
  device_id   uuid
);
CREATE INDEX task_events_instance_idx ON task_events(instance_id, server_time);
CREATE INDEX task_events_type_idx ON task_events(type, server_time);

-- Append-only enforcement (spec 6.1): no UPDATE, no DELETE on task_events
CREATE OR REPLACE FUNCTION forbid_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'task_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER task_events_no_update BEFORE UPDATE OR DELETE ON task_events
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

CREATE TABLE readings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric            text NOT NULL,
  value             numeric NOT NULL,
  unit              text,
  subject_type      text,
  subject_id        uuid,
  taken_at          timestamptz NOT NULL,
  source_event_uuid uuid,
  device_id         uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX readings_metric_idx ON readings(metric, taken_at);
CREATE UNIQUE INDEX readings_source_uniq
  ON readings(metric, source_event_uuid) WHERE source_event_uuid IS NOT NULL;

CREATE TABLE rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text UNIQUE NOT NULL,
  source        text NOT NULL CHECK (source IN ('reading','task_event','forecast','vim_verdict','inventory','clock')),
  condition     jsonb NOT NULL,
  action        jsonb NOT NULL,
  cooldown_h    int NOT NULL DEFAULT 0,
  arm_condition jsonb,
  two_stage     jsonb,
  active        boolean NOT NULL DEFAULT true,
  last_fired_at timestamptz,
  stage2_fired_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE escalation_profiles (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text UNIQUE NOT NULL,
  rungs jsonb NOT NULL
);

CREATE TABLE daily_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date     date UNIQUE NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  instance_ids  uuid[] NOT NULL DEFAULT '{}',
  capacity_note jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ── Evidence and verification ────────────────────────────────────────────────
CREATE TABLE media_objects (
  media_uuid  uuid PRIMARY KEY,
  instance_id uuid,
  event_uuid  uuid,
  kind        text NOT NULL CHECK (kind IN ('photo','video','audio')),
  status      text NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload','uploading','stored','failed')),
  storage_key text,
  bytes       bigint,
  received_bytes bigint NOT NULL DEFAULT 0,
  sha256      text,
  phash       text,
  exif        jsonb NOT NULL DEFAULT '{}'::jsonb,
  gps         jsonb,
  captured_at timestamptz,
  device_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vim_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_uuid  uuid NOT NULL REFERENCES media_objects(media_uuid),
  instance_id uuid,
  profile     text NOT NULL,
  context     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vim_jobs_status_idx ON vim_jobs(status, created_at);

CREATE TABLE vim_verdicts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_uuid    uuid NOT NULL,
  instance_id   uuid,
  verdict       text NOT NULL CHECK (verdict IN ('pass','fail','unusable','uncertain')),
  confidence    numeric NOT NULL,
  extracted     jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_version text NOT NULL,
  decided_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Channels ─────────────────────────────────────────────────────────────────
CREATE TABLE wa_contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users(id),
  wa_phone          text UNIQUE NOT NULL,
  window_open_until timestamptz,
  allow_listed      boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wa_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction           text NOT NULL CHECK (direction IN ('in','out')),
  wa_message_id       text UNIQUE,
  contact_id          uuid REFERENCES wa_contacts(id),
  template_name       text,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'received',
  related_instance_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel      text NOT NULL CHECK (channel IN ('push','whatsapp','sms','digest','call_prompt')),
  rung         text,
  instance_id  uuid,
  recipient    text,
  body         jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

-- ── Owner settings (absence mode, spec 4.2) ─────────────────────────────────
CREATE TABLE farm_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Meter accumulators for S3 schedules (projection over readings)
CREATE TABLE meter_accumulators (
  meter        text PRIMARY KEY,
  total        numeric NOT NULL DEFAULT 0,
  last_service_at_total numeric NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

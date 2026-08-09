-- Indexes surfaced by the 90-day stress run: template_code lookups (rules,
-- last-values, floating schedules), dark-farm max(server_time) by actor, and
-- per-subject readings scans (batch mortality, block irrigation).
CREATE INDEX IF NOT EXISTS task_instances_template_code_idx
  ON task_instances(template_code, updated_at DESC);
CREATE INDEX IF NOT EXISTS task_events_actor_time_idx
  ON task_events(actor_type, server_time DESC);
CREATE INDEX IF NOT EXISTS readings_subject_idx
  ON readings(subject_id, metric, taken_at) WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_log_rung_idx
  ON notifications_log(rung, sent_at DESC);

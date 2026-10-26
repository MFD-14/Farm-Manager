// Sync surface (spec 6.2): one round trip both directions.
import { Router } from "express";
import { tx, q } from "../db/pool.js";
import { auth } from "../middleware/auth.js";
import { foldEvent } from "../engine/fold.js";
import { evaluateRules } from "../engine/rules.js";
import { farmDateStr } from "../util/time.js";

export const syncRouter = Router();

// Who may append what through sync. The actor is always derived from the
// account, never taken from the phone: a caretaker's phone can report work but
// can't accept it, and nobody can forge system events.
const FIELD_EVENTS = new Set(["seen", "started", "field_recorded", "media_attached", "done_reported",
  "skip_requested", "problem_flagged"]);
const CONSOLE_EVENTS = new Set([...FIELD_EVENTS, "verified_closed", "rejected_reopened", "skip_approved",
  "skip_denied", "unblocked", "cancelled", "reassigned", "corrected", "deferred"]);
const roleActor = (role) => (role === "owner" || role === "admin" ? "owner" : role === "manager" ? "manager" : "caretaker");

// POST /api/sync/events  — idempotent on event_uuid; duplicates are success.
syncRouter.post("/events", auth(), async (req, res) => {
  const { device_id, device_now, events = [] } = req.body || {};
  if (!Array.isArray(events)) return res.status(400).json({ error: "events must be an array" });

  const accepted = [];
  const duplicates = [];
  const rejected = [];

  // Clock skew sample at handshake (spec 5.4).
  if (device_id && device_now) {
    const skewMs = Date.now() - new Date(device_now).getTime();
    await q(`UPDATE devices SET clock_skew_ms = $2, last_sync_at = now() WHERE id = $1`, [device_id, skewMs]);
  }

  const allowed = ["owner", "admin", "manager"].includes(req.user.role) ? CONSOLE_EVENTS : FIELD_EVENTS;
  for (const e of events) {
    if (!e.event_uuid) {
      rejected.push({ event_uuid: null, reason: "missing event_uuid" });
      continue;
    }
    if (!allowed.has(e.type)) {
      rejected.push({ event_uuid: e.event_uuid, reason: `not allowed: ${e.type}` });
      continue;
    }
    try {
      const result = await tx((c) =>
        foldEvent(c, {
          ...e,
          actor_type: roleActor(req.user.role),
          actor_id: req.user.id,
          device_id: device_id || req.user.deviceId,
        }));
      if (result.status === "accepted") accepted.push(e.event_uuid);
      else if (result.status === "duplicate") duplicates.push(e.event_uuid);
      else rejected.push({ event_uuid: e.event_uuid, reason: result.reason });
    } catch (err) {
      rejected.push({ event_uuid: e.event_uuid, reason: err.message });
    }
  }

  // Event-sourced rules react promptly to caretaker data (T3, T4, T8).
  if (accepted.length) {
    try { await tx((c) => evaluateRules(c)); } catch { /* sweep also runs on cron */ }
  }

  // server_events since cursor: instance changes the phone should mirror.
  const cursor = req.query.cursor || req.body?.cursor || null;
  const serverEvents = await q(
    `SELECT event_uuid, instance_id, actor_type, type, payload, server_time
     FROM task_events
     WHERE actor_type IN ('system','vim','owner','manager') AND ($1::timestamptz IS NULL OR server_time > $1)
     ORDER BY server_time LIMIT 500`,
    [cursor]);

  res.json({
    accepted, duplicates, rejected,
    server_events: serverEvents.rows,
    cursor: serverEvents.rows.at(-1)?.server_time || cursor || new Date().toISOString(),
  });
});

// GET /api/sync/notes — farm notes: observations not tied to a task, sent
// through the outbox as farm-level field_recorded events with their media.
syncRouter.get("/notes", auth(), async (req, res) => {
  const r = await q(
    `SELECT e.event_uuid, e.payload->>'note' AS note, e.device_time, e.server_time, u.name AS by,
       COALESCE((SELECT json_agg(json_build_object('media_uuid', m.media_uuid, 'kind', m.kind, 'status', m.status))
                 FROM media_objects m WHERE m.media_uuid::text IN (SELECT jsonb_array_elements_text(e.payload->'media'))), '[]') AS media
     FROM task_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.instance_id IS NULL AND e.type = 'field_recorded' AND e.payload ? 'note'
     ORDER BY e.server_time DESC LIMIT 100`);
  res.json({ notes: r.rows });
});

// GET /api/sync/bundle — the whole next-day pack in one cacheable response (R20).
syncRouter.get("/bundle", auth(), async (req, res) => {
  const dateStr = req.query.date || farmDateStr();
  const plan = await q(`SELECT * FROM daily_plans WHERE plan_date = $1`, [dateStr]);
  const planRow = plan.rows[0] || null;
  const instances = planRow
    ? (await q(
        `SELECT ti.*, tt.instructions, tt.checklist, tt.evidence_policy AS template_evidence_policy
         FROM task_instances ti JOIN task_templates tt ON tt.id = ti.template_id
         WHERE ti.id = ANY($1)
         ORDER BY array_position($1, ti.id)`, [planRow.instance_ids])).rows
    : [];
  // Open items outside today's plan (blocked, needs_review) still belong on the phone.
  const openExtra = await q(
    `SELECT ti.*, tt.instructions, tt.checklist, tt.evidence_policy AS template_evidence_policy
     FROM task_instances ti JOIN task_templates tt ON tt.id = ti.template_id
     WHERE ti.state IN ('released','acknowledged','in_progress','blocked','skip_pending','needs_review','done_reported')
       AND (($1::uuid[]) IS NULL OR NOT (ti.id = ANY($1)))`,
    [planRow?.instance_ids || null]);

  const templates = await q(`SELECT * FROM task_templates WHERE active`);
  const reference = {
    assets: (await q(`SELECT id, code, name, kind, criticality FROM assets WHERE status = 'active'`)).rows,
    locations: (await q(`SELECT id, code, name, kind, crop, plant_count, status FROM locations`)).rows,
    batches: (await q(`SELECT id, name, placed_on, current_count, stage FROM batches`)).rows,
    inventory: (await q(`SELECT id, name, unit, category, on_hand, reorder_point FROM inventory_items`)).rows,
  };

  // Herdwatch pattern (R18/R26): active withholding windows are a first-class
  // derived obligation, pushed to the phone so the caretaker sees them offline.
  const windowsRow = await q(`SELECT value FROM farm_settings WHERE key = 'active_windows'`);
  const activeWindows = (windowsRow.rows[0]?.value || [])
    .filter((w) => new Date(w.until) > new Date());
  const withSubjects = [];
  for (const w of activeWindows) {
    const loc = w.subject_id
      ? await q(`SELECT name FROM locations WHERE id = $1
                 UNION SELECT name FROM herds WHERE id = $1`, [w.subject_id])
      : { rows: [] };
    withSubjects.push({
      ...w,
      subject_name: loc.rows[0]?.name || "farm",
      days_remaining: Math.max(0, Math.ceil((new Date(w.until) - Date.now()) / 86_400_000)),
    });
  }

  // AgriWebb pattern: last recorded values per template, so capture screens can
  // show "last: 62" beside each field and speed repeat entries.
  const lastValues = await q(
    `SELECT DISTINCT ON (template_code) template_code,
            evidence_summary->'fields' AS fields, closed_at
     FROM task_instances
     WHERE state IN ('verified_closed','done_reported','needs_review')
       AND evidence_summary->'fields' IS NOT NULL AND evidence_summary->'fields' <> '{}'::jsonb
     ORDER BY template_code, COALESCE(closed_at, updated_at) DESC`);

  res.json({
    date: dateStr,
    plan: planRow ? { ...planRow, instances } : null,
    open_instances: openExtra.rows,
    templates_delta: templates.rows,
    reference_delta: reference,
    active_windows: withSubjects,
    last_values: Object.fromEntries(lastValues.rows.map((r) => [r.template_code, { fields: r.fields, at: r.closed_at }])),
    cursor: new Date().toISOString(),
  });
});

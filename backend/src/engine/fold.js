// The fold (spec 0, 6.1): task_events is the system of record; task_instances,
// readings, inventory_moves, meter accumulators and batch counts are projections
// updated deterministically from events. rebuildProjections replays the log.

import { applyTransition, isTerminal } from "./stateMachine.js";
import { validateEvidence } from "./evidence.js";
import { routeAfterDoneReported } from "./verification.js";
import { instantiateChainsForAnchor } from "./chains.js";
import { farmDateStr } from "../util/time.js";

// Derived reading expressions used by the seed taxonomy.
function deriveValue(expr, fields) {
  const f = (k) => Number(fields[k]);
  switch (expr) {
    case "fresh_damage_plants / plants_inspected * 100": {
      const insp = f("plants_inspected");
      return insp > 0 ? (f("fresh_damage_plants") / insp) * 100 : null;
    }
    case "cash_on_hand - recorded_sales":
      return f("cash_on_hand") - f("recorded_sales");
    case "median_scores": {
      // "A12=2.5,B03=3.0" -> median of values
      const vals = String(fields.scores || "")
        .split(",").map((s) => Number(s.split("=")[1])).filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b);
      if (!vals.length) return null;
      const mid = Math.floor(vals.length / 2);
      return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    }
    default:
      return null;
  }
}

async function projectReadings(c, event, instance, policy) {
  const specs = policy?.readings;
  if (!specs?.length) return;
  const fields = { ...(instance.evidence_summary?.fields || {}), ...(event.payload?.fields || {}) };
  for (const spec of specs) {
    let value = null;
    if (spec.from) {
      value = Number(fields[spec.from]);
      if (spec.transform === "trays_to_eggs") value = value * 30 + Number(fields.singles || 0);
    } else if (spec.derive) {
      value = deriveValue(spec.derive, fields);
    }
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    await c.query(
      `INSERT INTO readings (metric, value, unit, subject_type, subject_id, taken_at, source_event_uuid, device_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (metric, source_event_uuid) WHERE source_event_uuid IS NOT NULL DO NOTHING`,
      [spec.metric, value, spec.unit || null, instance.subject_type, instance.subject_id,
       event.device_time || event.server_time || new Date(), event.event_uuid, event.device_id || null]);
  }
  // Meter accumulators (S3): pump run hours etc.
  for (const m of policy?.meters || []) {
    const v = Number(fields[m.from]);
    if (Number.isNaN(v) || v <= 0) continue;
    await c.query(
      `INSERT INTO meter_accumulators (meter, total) VALUES ($1, $2)
       ON CONFLICT (meter) DO UPDATE SET total = meter_accumulators.total + $2, updated_at = now()`,
      [m.meter, v]);
  }
}

async function projectInventory(c, event, instance, policy) {
  const out = policy?.inventory_out;
  if (!out) return;
  const fields = { ...(instance.evidence_summary?.fields || {}), ...(event.payload?.fields || {}) };
  const product = fields[out.item_from];
  const qty = Number(fields[out.qty_from]);
  if (!product || Number.isNaN(qty) || qty <= 0) return;
  const item = await c.query(`SELECT id, phi_days, withdrawal_days FROM inventory_items WHERE lower(name) = lower($1)`, [product]);
  if (!item.rows.length) return;
  await c.query(
    `INSERT INTO inventory_moves (item_id, qty, direction, source_event_uuid)
     VALUES ($1,$2,'out',$3)
     ON CONFLICT (item_id, source_event_uuid) WHERE source_event_uuid IS NOT NULL DO NOTHING`,
    [item.rows[0].id, qty, event.event_uuid]);
  await c.query(`UPDATE inventory_items SET on_hand = on_hand - $2, updated_at = now() WHERE id = $1`, [item.rows[0].id, qty]);

  // PHI / withdrawal windows become guard state (spec 3.4, Herdwatch pattern R26)
  const row = item.rows[0];
  const windows = [];
  const base = new Date(event.device_time || event.server_time || Date.now());
  if (row.phi_days) windows.push({ type: "phi", days: row.phi_days });
  if (row.withdrawal_days) windows.push({ type: "withdrawal", days: row.withdrawal_days });
  for (const w of windows) {
    const until = new Date(base.getTime() + w.days * 86_400_000).toISOString();
    await c.query(
      `INSERT INTO farm_settings (key, value)
       VALUES ('active_windows', jsonb_build_array(jsonb_build_object(
          'type', $1::text, 'subject_type', $2::text, 'subject_id', $3::uuid,
          'product', $4::text, 'until', $5::text, 'source_event', $6::uuid)))
       ON CONFLICT (key) DO UPDATE SET
         value = (
           SELECT COALESCE(jsonb_agg(w), '[]'::jsonb) FROM (
             SELECT w FROM jsonb_array_elements(farm_settings.value) AS w
             WHERE (w->>'until')::timestamptz > now() AND w->>'source_event' <> $6::text
           ) keep
         ) || EXCLUDED.value,
         updated_at = now()`,
      [w.type, instance.subject_type, instance.subject_id, product, until, event.event_uuid]);
  }
}

async function maybeMortalityBatchUpdate(c, event, instance) {
  if (instance.template_code !== "P-05") return;
  const deaths = Number(event.payload?.fields?.mortality);
  if (Number.isNaN(deaths) || deaths <= 0) return;
  if (instance.subject_type === "batch" && instance.subject_id) {
    await c.query(
      `UPDATE batches SET current_count = GREATEST(0, COALESCE(current_count,0) - $2), updated_at = now() WHERE id = $1`,
      [instance.subject_id, deaths]);
  }
}

// Fold a single event inside an open transaction. Returns
// {status: 'accepted'|'duplicate'|'rejected', reason?}
export async function foldEvent(c, event, { skipSideEffects = false, replay = false } = {}) {
  // Idempotency on event_uuid (spec 6.2): duplicates are success. Replay mode
  // re-applies an event already in the log, so it skips the check and the insert.
  if (!replay) {
    const dup = await c.query(`SELECT 1 FROM task_events WHERE event_uuid = $1`, [event.event_uuid]);
    if (dup.rows.length) return { status: "duplicate" };
  }

  if (!event.type) return { status: "rejected", reason: "missing type" };

  let instance = null;
  if (event.instance_id) {
    const r = await c.query(`SELECT * FROM task_instances WHERE id = $1 FOR UPDATE`, [event.instance_id]);
    if (!r.rows.length) return { status: "rejected", reason: "unknown instance" };
    instance = r.rows[0];
  }

  // State transition legality. Illegal transitions are folded as no-ops on state but
  // still logged? Spec: semantic conflicts are folded, never bounced. We accept the
  // event into the log and skip the state change when illegal (e.g. done after expiry),
  // recording the conflict in the payload for audit.
  let nextState = instance?.state;
  let conflict = null;
  let policy = {};
  if (instance) {
    const t = applyTransition(instance, event.type);
    if (t.ok) nextState = t.next;
    else conflict = t.reason;
    policy = instance.params?.evidence_policy_resolved
      || (await c.query(`SELECT evidence_policy FROM task_templates WHERE id = $1`, [instance.template_id])).rows[0]?.evidence_policy
      || {};
  }

  // Agworld pattern (spec R27): chemical application completions carry the
  // weather at application time as part of the forensic record. Enriched into
  // the immutable event payload at accept time so replay reproduces it.
  if (instance && event.type === "done_reported" && !conflict
      && (policy.vim_profile === "spray_scene" || policy.inventory_out)
      && !event.payload?.weather_at_application) {
    const fc = await c.query(`SELECT value FROM farm_settings WHERE key = 'forecast'`);
    // Farm-local date: the forecast is keyed by farm days, not UTC days.
    const dateStr = farmDateStr(event.device_time ? new Date(event.device_time) : new Date());
    const day = fc.rows[0]?.value?.daily?.find((x) => x.date === dateStr);
    const rain = await c.query(
      `SELECT COALESCE(SUM(value),0) AS s FROM readings
       WHERE metric = 'rain_mm' AND taken_at >= now() - interval '24 hours'`);
    event = {
      ...event,
      payload: {
        ...(event.payload || {}),
        weather_at_application: {
          tmax: day?.tmax ?? null, tmin: day?.tmin ?? null,
          rain_forecast_mm: day?.rain_mm ?? null, rain_prob_pct: day?.prob_pct ?? null,
          rain_observed_24h_mm: Number(rain.rows[0].s),
          stamped_at: new Date().toISOString(),
        },
      },
    };
  }

  if (!replay) {
    await c.query(
      `INSERT INTO task_events (event_uuid, instance_id, actor_type, actor_id, type, payload, device_time, server_time, device_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, clock_timestamp()), $9)`,
      [event.event_uuid, event.instance_id || null, event.actor_type || "system", event.actor_id || null,
       event.type, { ...(event.payload || {}), ...(conflict ? { _fold_conflict: conflict } : {}) },
       event.device_time || null, event.server_time || null, event.device_id || null]);
  }

  if (!instance || conflict) return { status: "accepted", conflict };

  // Evidence summary maintenance
  const summary = instance.evidence_summary || {};
  summary.fields = summary.fields || {};
  if (event.type === "field_recorded" || event.type === "done_reported") {
    Object.assign(summary.fields, event.payload?.fields || {});
  }
  if (event.payload?.weather_at_application) {
    summary.weather = event.payload.weather_at_application;
  }
  if (event.type === "media_attached") {
    const kind = event.payload?.kind || "photo";
    const key = kind === "photo" ? "photo_count" : kind === "video" ? "video_count" : "voice_count";
    summary[key] = (summary[key] || 0) + 1;
    summary.media = [...(summary.media || []), { media_uuid: event.payload?.media_uuid, kind }];
  }

  const patch = { state: nextState, evidence_summary: summary };

  if (event.type === "missed") patch.missed_count = instance.missed_count + 1;
  if (event.type === "deferred") patch.deferral_count = instance.deferral_count + 1;
  if (event.type === "rejected_reopened") {
    patch.rejection_count = instance.rejection_count + 1;
    if (event.payload?.new_due_at) patch.due_at = event.payload.new_due_at;
  }
  if (event.type === "reassigned" && event.payload?.assignee_id) patch.assignee_id = event.payload.assignee_id;
  if (isTerminal(nextState) && !instance.closed_at) patch.closed_at = event.device_time || new Date();
  if (["auto_verified", "verified_closed"].includes(event.type)) {
    patch.verification = event.payload?.verification || { method: event.actor_type === "owner" ? "owner" : "auto", verdict: "pass" };
  }

  const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 2}`).join(", ");
  await c.query(
    `UPDATE task_instances SET ${sets}, updated_at = now() WHERE id = $1`,
    [instance.id, ...Object.values(patch).map((v) => (typeof v === "object" && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v))]);

  const updated = { ...instance, ...patch, evidence_summary: summary };

  // Projections
  if (["field_recorded", "done_reported"].includes(event.type)) {
    await projectReadings(c, event, updated, policy);
    await maybeMortalityBatchUpdate(c, event, updated);
  }
  if (event.type === "done_reported") {
    await projectInventory(c, event, updated, policy);
  }

  if (skipSideEffects) return { status: "accepted", instance: updated };

  // Verification routing at done_reported (spec 3.2, 5.4, 5.5)
  if (event.type === "done_reported") {
    const check = validateEvidence(policy, summary);
    await routeAfterDoneReported(c, updated, policy, check, event);
  }

  // Anchor chains: a completed anchor task instantiates its chain (spec 3.3 S4)
  if (event.type === "done_reported" && policy.anchor_emit) {
    await instantiateChainsForAnchor(c, policy.anchor_emit, updated, event);
  }

  return { status: "accepted", instance: updated };
}

// Rebuild all projections by replaying the event log (spec 6.1 fold discipline).
export async function rebuildProjections(c) {
  await c.query(`UPDATE task_instances SET
      state = 'scheduled', missed_count = 0, deferral_count = 0, rejection_count = 0,
      evidence_summary = '{}', verification = NULL, closed_at = NULL, escalation_state = '{}'`);
  await c.query(`DELETE FROM readings WHERE source_event_uuid IS NOT NULL`);
  await c.query(`DELETE FROM inventory_moves WHERE source_event_uuid IS NOT NULL`);
  await c.query(`UPDATE meter_accumulators SET total = last_service_at_total`);
  // Replay through the same handlers with side effects off. The log itself is
  // never touched: replay mode re-applies each event's state change and
  // projections in seq order without delete or re-insert.
  const { rows: events } = await c.query(`SELECT * FROM task_events ORDER BY seq`);
  for (const e of events) {
    await foldEvent(c, e, { skipSideEffects: true, replay: true });
  }
  return events.length;
}

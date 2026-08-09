// Rule engine (spec 3.4): rules watch the event stream and readings, and release
// templates with parameters. Triggers instantiate tasks, they do not merely notify.
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { foldEvent } from "./fold.js";
import { waterBalance } from "./physics.js";
import { notify } from "../workers/notifier.js";
import { farmDateStr, addDays, farmTime } from "../util/time.js";

async function releaseTemplateNow(c, code, { params = {}, priorityOverride = null, assigneeRole = null, subjectId = null } = {}) {
  const t = await c.query(`SELECT * FROM task_templates WHERE code = $1 AND active ORDER BY version DESC LIMIT 1`, [code]);
  if (!t.rows.length) return null;
  const tpl = t.rows[0];
  const user = await c.query(
    `SELECT id FROM users WHERE role = $1 ORDER BY created_at LIMIT 1`,
    [assigneeRole || tpl.evidence_policy?.assignee_role || "caretaker"]);
  const dateStr = farmDateStr();
  const periodKey = `${dateStr}:trigger:${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const due = new Date(now.getTime() + (tpl.priority === "P0" ? 30 : 4 * 60) * 60_000);
  const r = await c.query(
    `INSERT INTO task_instances
       (template_id, template_code, template_version, period_key, subject_type, subject_id, assignee_id,
        title, priority, est_minutes, params, release_at, due_at, grace_until, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'scheduled') RETURNING id`,
    [tpl.id, tpl.code, tpl.version, periodKey, tpl.subject_type, subjectId || tpl.default_subject_id,
     user.rows[0]?.id || null, tpl.title, priorityOverride || tpl.priority, tpl.est_minutes,
     JSON.stringify(params), now, due, new Date(due.getTime() + 60 * 60_000)]);
  await foldEvent(c, {
    event_uuid: randomUUID(), instance_id: r.rows[0].id, actor_type: "system",
    type: "released", payload: { trigger: true, params },
  });
  return r.rows[0].id;
}

async function storedVolumePct(c) {
  const wp = (await c.query(`SELECT value FROM farm_settings WHERE key = 'water_params'`)).rows[0]?.value || {};
  const tankUsable = Number(wp.tank_usable || config.tankUsable);
  const poolVolume = Number(wp.pool_volume || config.poolVolume);
  const latest = async (metric) => {
    const r = await c.query(`SELECT value FROM readings WHERE metric = $1 ORDER BY taken_at DESC LIMIT 1`, [metric]);
    return r.rows.length ? Number(r.rows[0].value) : null;
  };
  const tankPct = await latest("tank_level_pct");
  const poolPct = await latest("pool_level_pct");
  if (tankPct === null && poolPct === null) return null;
  const stored = ((tankPct ?? 0) / 100) * tankUsable + ((poolPct ?? 0) / 100) * poolVolume;
  return (stored / (tankUsable + poolVolume)) * 100;
}

// Individual condition evaluators. Each returns null (no fire) or a params object.
const CONDITIONS = {
  async stored_volume_pct_below(c, cond) {
    const pct = await storedVolumePct(c);
    if (pct === null) return null;
    return pct < cond.value ? { stored_pct: Math.round(pct * 10) / 10 } : null;
  },
  async rain_24h_at_least(c, cond) {
    // Gauge first: an observed reading wins over any forecast (spec T2).
    const r = await c.query(
      `SELECT COALESCE(SUM(value),0) AS s FROM readings WHERE metric = 'rain_mm' AND taken_at >= now() - interval '24 hours'`);
    const mm = Number(r.rows[0].s);
    if (mm >= cond.value) return { rain_mm: mm, source: "gauge" };
    // Forecast covers the window the gauge cannot: tomorrow. Acting ahead of
    // confident heavy rain saves the water before it falls.
    const { forecastFor } = await import("../workers/forecast.js");
    const { farmDateStr, addDays } = await import("../util/time.js");
    const tomorrow = await forecastFor(c, addDays(farmDateStr(), 1));
    const minProb = cond.forecast_min_prob ?? 60;
    if (tomorrow && tomorrow.rain_mm >= cond.value && tomorrow.prob_pct >= minProb) {
      return { rain_mm: tomorrow.rain_mm, prob_pct: tomorrow.prob_pct, source: "forecast", for_date: tomorrow.date };
    }
    return null;
  },
  async faw_threshold(c, cond) {
    const r = await c.query(
      `SELECT ti.id, ti.subject_id, ti.evidence_summary FROM task_instances ti
       WHERE ti.template_code = 'C-04' AND ti.state IN ('done_reported','needs_review','verified_closed')
         AND ti.updated_at >= now() - interval '24 hours'
       ORDER BY ti.updated_at DESC LIMIT 1`);
    if (!r.rows.length) return null;
    const f = r.rows[0].evidence_summary?.fields || {};
    const inspected = Number(f.plants_inspected);
    const damaged = Number(f.fresh_damage_plants);
    if (!inspected) return null;
    const ratio = damaged / inspected;
    const threshold = f.crop_stage === "seedling" ? cond.seedling : cond.whorl;
    return ratio >= threshold
      ? { damage_ratio: Math.round(ratio * 100) / 100, stage: f.crop_stage, subject_id: r.rows[0].subject_id }
      : null;
  },
  async poultry_mortality(c, cond) {
    const { rows: batches } = await c.query(`SELECT id, name, current_count FROM batches WHERE current_count > 0`);
    for (const b of batches) {
      const day = await c.query(
        `SELECT COALESCE(SUM(value),0) AS s FROM readings
         WHERE metric = 'mortality' AND subject_id = $1 AND taken_at >= now() - interval '24 hours'`, [b.id]);
      const dayDeaths = Number(day.rows[0].s);
      if (dayDeaths / b.current_count * 100 >= cond.day_pct) {
        return { batch_id: b.id, batch: b.name, deaths: dayDeaths, mode: "single_day" };
      }
      const runs = await c.query(
        `SELECT date_trunc('day', taken_at) AS d, SUM(value) AS s FROM readings
         WHERE metric = 'mortality' AND subject_id = $1 AND taken_at >= now() - interval '3 days'
         GROUP BY 1 ORDER BY 1`, [b.id]);
      if (runs.rows.length >= cond.run_days &&
          runs.rows.every((r2) => Number(r2.s) / b.current_count * 100 > cond.run_pct)) {
        return { batch_id: b.id, batch: b.name, mode: "persistent" };
      }
    }
    return null;
  },
  async pump_tank_deficit(c, cond) {
    const wb = await waterBalance(c, { windowHours: 24 });
    if (!wb || wb.pumpHours < cond.min_pump_hours) return null;
    // Tank rise below expected_ratio of pump_hours * lph after allowing for draw.
    const impliedAdded = wb.tankDeltaL + wb.irrigationL;
    const expected = wb.pumpHours * cond.lph;
    return impliedAdded < cond.expected_ratio * expected
      ? { pump_hours: wb.pumpHours, implied_added_l: Math.round(impliedAdded), expected_l: Math.round(expected) }
      : null;
  },
  async harvest_shortfall(c, cond) {
    const { rows } = await c.query(
      `SELECT date_trunc('day', taken_at) AS d, SUM(value) AS s FROM readings
       WHERE metric = 'bundle_count' AND taken_at >= now() - interval '9 days' GROUP BY 1 ORDER BY 1 DESC`);
    if (rows.length < cond.consecutive_days + 3) return null;
    const recent = rows.slice(0, cond.consecutive_days).map((r) => Number(r.s));
    const trailing = rows.slice(cond.consecutive_days).map((r) => Number(r.s));
    const mean = trailing.reduce((a, b) => a + b, 0) / trailing.length;
    if (!mean) return null;
    return recent.every((v) => v < cond.pct_of_trailing7 * mean)
      ? { recent, trailing_mean: Math.round(mean * 10) / 10 }
      : null;
  },
  async bcs_regression(c, cond) {
    const { rows } = await c.query(
      `SELECT value, taken_at FROM readings WHERE metric = 'bcs_median' ORDER BY taken_at DESC LIMIT 2`);
    if (rows.length >= 2 && Number(rows[1].value) - Number(rows[0].value) >= cond.drop) {
      return { previous: Number(rows[1].value), current: Number(rows[0].value) };
    }
    return null;
  },
  async below_reorder_point(c) {
    const { rows } = await c.query(
      `SELECT id, name, on_hand, reorder_point, reorder_qty, unit FROM inventory_items
       WHERE reorder_point IS NOT NULL AND on_hand < reorder_point`);
    return rows.length ? { items: rows } : null;
  },
  async dark_farm_hours(c, cond) {
    const r = await c.query(
      `SELECT MAX(server_time) AS last FROM task_events WHERE actor_type IN ('caretaker','whatsapp')`);
    const last = r.rows[0].last;
    if (!last) return null;
    const hours = (Date.now() - new Date(last).getTime()) / 3_600_000;
    return hours >= cond.value ? { dark_hours: Math.round(hours), last_event_at: last } : null;
  },
};

async function applyAction(c, rule, action, fireParams, now = new Date()) {
  const fired = { rule: rule.name, actions: [] };

  if (action.release) {
    const id = await releaseTemplateNow(c, action.release, {
      params: fireParams,
      priorityOverride: action.priority || null,
      assigneeRole: action.assignee_role || null,
      subjectId: fireParams?.subject_id || fireParams?.batch_id || null,
    });
    fired.actions.push({ released: action.release, instance_id: id });
  }
  if (action.suppress) {
    // Immediate suppression for today: expire released instances of the codes.
    for (const code of action.suppress) {
      const { rows } = await c.query(
        `SELECT id FROM task_instances WHERE template_code = $1 AND state IN ('released','acknowledged','scheduled')`, [code]);
      for (const r of rows) {
        await foldEvent(c, {
          event_uuid: randomUUID(), instance_id: r.id, actor_type: "system",
          type: "expired", payload: { reason: `suppressed by ${rule.name}` },
        });
      }
      fired.actions.push({ suppressed: code, count: rows.length });
    }
  }
  if (action.suppress_next_day) {
    const tomorrow = addDays(farmDateStr(now), 1);
    const entries = action.suppress_next_day.map((template) => ({ template, date: tomorrow, rule: rule.name }));
    await c.query(
      `INSERT INTO farm_settings (key, value) VALUES ('suppressions', $1)
       ON CONFLICT (key) DO UPDATE SET value = (
         SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) FROM (
           SELECT s FROM jsonb_array_elements(farm_settings.value) AS s WHERE (s->>'date') >= $2
         ) keep
       ) || EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(entries), farmDateStr(now)]);
    fired.actions.push({ suppress_next_day: action.suppress_next_day, date: tomorrow });
  }
  if (action.expire_released) {
    const { rows } = await c.query(
      `SELECT id FROM task_instances WHERE template_code = $1 AND state IN ('released','acknowledged')`,
      [action.expire_released.template]);
    for (const r of rows) {
      await foldEvent(c, {
        event_uuid: randomUUID(), instance_id: r.id, actor_type: "system",
        type: "expired", payload: { reason: action.expire_released.reason },
      });
    }
    fired.actions.push({ expired: action.expire_released.template, count: rows.length });
  }
  for (const n of action.notify || []) {
    await notify(c, {
      channel: n.channel, to: n.to, rung: `rule:${rule.name}`,
      body: { rule: rule.name, template: n.template, params: fireParams },
    });
    fired.actions.push({ notified: n.to, channel: n.channel });
  }
  return fired;
}

// Evaluate all active rules. Called by the scheduler every few minutes and after
// relevant folds. Returns list of firings.
export async function evaluateRules(c, { now = new Date() } = {}) {
  const { rows: rules } = await c.query(`SELECT * FROM rules WHERE active`);
  const firings = [];
  for (const rule of rules) {
    const evaluator = CONDITIONS[rule.condition?.kind];
    if (!evaluator) continue;

    const inCooldown = rule.last_fired_at &&
      (now - new Date(rule.last_fired_at)) / 3_600_000 < rule.cooldown_h;

    let fireParams = null;
    if (!inCooldown) {
      fireParams = await evaluator(c, rule.condition);
      if (fireParams) {
        const fired = await applyAction(c, rule, rule.action, fireParams, now);
        await c.query(`UPDATE rules SET last_fired_at = $2, updated_at = now() WHERE id = $1`, [rule.id, now]);
        firings.push(fired);
      }
    }

    // Two-stage persistence (spec R17): second condition escalates even in cooldown.
    if (rule.two_stage && rule.last_fired_at) {
      const alreadyStage2 = rule.stage2_fired_at &&
        new Date(rule.stage2_fired_at) > new Date(rule.last_fired_at);
      if (!alreadyStage2) {
        const s2 = CONDITIONS[rule.two_stage.condition?.kind];
        if (s2) {
          const p2 = await s2(c, rule.two_stage.condition);
          if (p2) {
            const fired = await applyAction(c, rule, rule.two_stage.action, p2, now);
            fired.stage = 2;
            await c.query(`UPDATE rules SET stage2_fired_at = $2, updated_at = now() WHERE id = $1`, [rule.id, now]);
            firings.push(fired);
          }
        }
      }
    }
  }
  return firings;
}

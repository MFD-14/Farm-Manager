// Owner CRUD for templates and rules (versioned), digest, KPIs, devices,
// absence mode (spec 6.2, 4.2).
import { Router } from "express";
import { q, tx } from "../db/pool.js";
import { auth, requireRole, sign } from "../middleware/auth.js";
import { buildDigest } from "../engine/digest.js";
import { computeKpis } from "../engine/kpis.js";
import { runRelease } from "../engine/release.js";
import { farmDateStr } from "../util/time.js";

export const templatesRouter = Router();
export const rulesRouter = Router();
export const ownerRouter = Router();
export const devicesRouter = Router();

templatesRouter.get("/", auth(), async (req, res) => {
  const r = await q(`SELECT * FROM task_templates WHERE active ORDER BY code`);
  res.json({ templates: r.rows });
});

templatesRouter.post("/", auth(), requireRole("owner", "admin"), async (req, res) => {
  const t = req.body || {};
  if (!t.code || !t.title || !t.domain || !t.priority) {
    return res.status(400).json({ error: "code, title, domain, priority required" });
  }
  const r = await q(
    `INSERT INTO task_templates (code, title, domain, subject_type, priority, est_minutes,
       instructions, checklist, evidence_policy, schedule, guards, escalation_profile, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1) RETURNING *`,
    [t.code, t.title, t.domain, t.subject_type || "none", t.priority, t.est_minutes || 1,
     JSON.stringify(t.instructions || []), JSON.stringify(t.checklist || []),
     JSON.stringify(t.evidence_policy || { classes: ["E0"] }),
     t.schedule ? JSON.stringify(t.schedule) : null,
     JSON.stringify(t.guards || []), t.escalation_profile || t.priority]);
  res.status(201).json({ template: r.rows[0] });
});

// Templates are versioned (spec 3.1): an update inserts a new version row.
templatesRouter.post("/:id", auth(), requireRole("owner", "admin"), async (req, res) => {
  const cur = await q(`SELECT * FROM task_templates WHERE id = $1`, [req.params.id]);
  if (!cur.rows.length) return res.status(404).json({ error: "not found" });
  const old = cur.rows[0];
  const t = { ...old, ...req.body };
  const r = await tx(async (c) => {
    await c.query(`UPDATE task_templates SET active = false, updated_at = now() WHERE id = $1`, [old.id]);
    return c.query(
      `INSERT INTO task_templates (code, title, title_local, domain, subject_type, default_subject_id,
         priority, est_minutes, instructions, checklist, evidence_policy, schedule, guards,
         escalation_profile, version, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true) RETURNING *`,
      [t.code, t.title, t.title_local || null, t.domain, t.subject_type, t.default_subject_id,
       t.priority, t.est_minutes, JSON.stringify(t.instructions || []), JSON.stringify(t.checklist || []),
       JSON.stringify(t.evidence_policy), t.schedule ? JSON.stringify(t.schedule) : null,
       JSON.stringify(t.guards || []), t.escalation_profile, old.version + 1]);
  });
  res.json({ template: r.rows[0] });
});

rulesRouter.get("/", auth(), async (req, res) => {
  const r = await q(`SELECT * FROM rules ORDER BY name`);
  res.json({ rules: r.rows });
});

rulesRouter.post("/:id/toggle", auth(), requireRole("owner", "admin"), async (req, res) => {
  const r = await q(`UPDATE rules SET active = NOT active, updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json({ rule: r.rows[0] });
});

ownerRouter.get("/digest", auth(), requireRole("owner", "admin", "manager"), async (req, res) => {
  const digest = await tx((c) => buildDigest(c, req.query.date || farmDateStr()));
  res.json(digest);
});

// Rainfall history for the rain screen: daily totals, today, season-to-date.
// The Zimbabwe rain year runs October to September, so the season accumulator
// resets on 1 October.
ownerRouter.get("/rain", auth(), async (req, res) => {
  const days = Math.min(90, parseInt(req.query.days || "14", 10) || 14);
  const daily = await q(
    `SELECT to_char(date_trunc('day', taken_at AT TIME ZONE 'Africa/Harare'), 'YYYY-MM-DD') AS d,
            SUM(value) AS mm
     FROM readings WHERE metric = 'rain_mm'
       AND taken_at >= now() - ($1 || ' days')::interval
     GROUP BY 1 ORDER BY 1`, [days]);

  const now = new Date();
  const seasonStartYear = now.getUTCMonth() + 1 >= 10 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const seasonStart = `${seasonStartYear}-10-01`;
  const season = await q(
    `SELECT COALESCE(SUM(value),0) AS mm, COUNT(DISTINCT date_trunc('day', taken_at)) FILTER (WHERE value > 0) AS rain_days
     FROM readings WHERE metric = 'rain_mm' AND taken_at >= $1::date`, [seasonStart]);
  const last = await q(
    `SELECT value, taken_at FROM readings WHERE metric = 'rain_mm' ORDER BY taken_at DESC LIMIT 1`);
  const today = await q(
    `SELECT COALESCE(SUM(value),0) AS mm FROM readings
     WHERE metric = 'rain_mm' AND date_trunc('day', taken_at AT TIME ZONE 'Africa/Harare') =
           date_trunc('day', now() AT TIME ZONE 'Africa/Harare')`);
  const wettest = await q(
    `SELECT to_char(date_trunc('day', taken_at AT TIME ZONE 'Africa/Harare'), 'YYYY-MM-DD') AS d, SUM(value) AS mm
     FROM readings WHERE metric = 'rain_mm' AND taken_at >= $1::date
     GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [seasonStart]);

  // Weekly totals (last 12 ISO weeks) and monthly totals (last 12 months) for
  // the week/month views of the rain page.
  const weekly = await q(
    `SELECT to_char(date_trunc('week', taken_at AT TIME ZONE 'Africa/Harare'), 'YYYY-MM-DD') AS wk,
            SUM(value) AS mm,
            COUNT(DISTINCT date_trunc('day', taken_at)) FILTER (WHERE value > 0) AS rain_days
     FROM readings WHERE metric = 'rain_mm'
       AND taken_at >= date_trunc('week', now() AT TIME ZONE 'Africa/Harare') - interval '11 weeks'
     GROUP BY 1 ORDER BY 1`);
  const monthly = await q(
    `SELECT to_char(date_trunc('month', taken_at AT TIME ZONE 'Africa/Harare'), 'YYYY-MM') AS m,
            SUM(value) AS mm,
            COUNT(DISTINCT date_trunc('day', taken_at)) FILTER (WHERE value > 0) AS rain_days
     FROM readings WHERE metric = 'rain_mm'
       AND taken_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Harare') - interval '11 months'
     GROUP BY 1 ORDER BY 1`);

  // Season-vs-season comparison: cumulative curves for the current and previous
  // rain years, as day-of-season points (0 = 1 October).
  const seasonCurve = async (startYear) => {
    const start = `${startYear}-10-01`;
    const end = `${startYear + 1}-10-01`;
    const rows = await q(
      `SELECT to_char(date_trunc('day', taken_at AT TIME ZONE 'Africa/Harare'), 'YYYY-MM-DD') AS d,
              SUM(value) AS mm
       FROM readings WHERE metric = 'rain_mm' AND taken_at >= $1::date AND taken_at < $2::date
       GROUP BY 1 ORDER BY 1`, [start, end]);
    let cum = 0;
    const startMs = new Date(start + "T00:00:00Z").getTime();
    const points = rows.rows.map((r) => {
      cum += Number(r.mm);
      return {
        d: Math.round((new Date(r.d + "T00:00:00Z").getTime() - startMs) / 86_400_000),
        mm: Math.round(cum * 10) / 10,
      };
    });
    return {
      label: `${startYear}/${String(startYear + 1).slice(2)}`,
      start, points, total_mm: Math.round(cum * 10) / 10,
    };
  };
  const currentCurve = { ...(await seasonCurve(seasonStartYear)), current: true };
  const previousCurve = await seasonCurve(seasonStartYear - 1);
  const seasons = [currentCurve];
  if (previousCurve.points.length) seasons.push(previousCurve);

  const forecastRow = await q(`SELECT value FROM farm_settings WHERE key = 'forecast'`);
  const forecast = forecastRow.rows[0]?.value || null;

  res.json({
    today_mm: Number(today.rows[0].mm),
    last_reading: last.rows[0] ? { mm: Number(last.rows[0].value), at: last.rows[0].taken_at } : null,
    days: daily.rows.map((r) => ({ date: r.d, mm: Number(r.mm) })),
    weeks: weekly.rows.map((r) => ({ week_start: r.wk, mm: Number(r.mm), rain_days: Number(r.rain_days) })),
    months: monthly.rows.map((r) => ({ month: r.m, mm: Number(r.mm), rain_days: Number(r.rain_days) })),
    seasons,
    forecast,
    season: {
      start: seasonStart,
      total_mm: Number(season.rows[0].mm),
      rain_days: Number(season.rows[0].rain_days),
      wettest_day: wettest.rows[0] ? { date: wettest.rows[0].d, mm: Number(wettest.rows[0].mm) } : null,
    },
  });
});

// Farm profile: land, livestock, flocks and the water system in one response,
// with the derived figures an owner reasons from (buffer autonomy, cropped area).
ownerRouter.get("/farm", auth(), async (req, res) => {
  const blocks = (await q(
    `SELECT code, name, kind, crop, plant_count, hectares, soil, status, irrigated
     FROM locations WHERE hectares IS NOT NULL ORDER BY hectares DESC`)).rows
    .map((b) => ({ ...b, hectares: Number(b.hectares) }));
  const herds = (await q(
    `SELECT name, species, breed, head_count, location, notes FROM herds ORDER BY head_count DESC`)).rows;
  const flocks = (await q(
    `SELECT b.name, b.purpose, b.stage, b.placed_on, b.placed_count, b.current_count, l.name AS house
     FROM batches b LEFT JOIN locations l ON l.id = b.house_location_id
     WHERE b.stage <> 'closed' ORDER BY b.placed_on`)).rows
    .map((f) => ({
      ...f,
      age_days: f.placed_on ? Math.floor((Date.now() - new Date(f.placed_on).getTime()) / 86_400_000) : null,
    }));
  const water = (await q(`SELECT value FROM farm_settings WHERE key = 'water_params'`)).rows[0]?.value || {};
  const tank = (await q(
    `SELECT value, taken_at FROM readings WHERE metric = 'tank_level_pct' ORDER BY taken_at DESC LIMIT 1`)).rows[0];
  const pool = (await q(
    `SELECT value, taken_at FROM readings WHERE metric = 'pool_level_pct' ORDER BY taken_at DESC LIMIT 1`)).rows[0];

  const buffer = Number(water.pool_volume || 0) + Number(water.tank_usable || 0);
  const stored = tank || pool
    ? (Number(tank?.value ?? 0) / 100) * Number(water.tank_usable || 0)
      + (Number(pool?.value ?? 0) / 100) * Number(water.pool_volume || 0)
    : null;
  const demand = Number(water.peak_crop_demand_l_per_day || 0) + Number(water.stock_water_l_per_day || 0);
  const mapped = blocks.reduce((a, b) => a + b.hectares, 0);
  const cropped = blocks.filter((b) => ["active", "planted"].includes(b.status))
    .reduce((a, b) => a + b.hectares, 0);

  res.json({
    farm: {
      name: "Woodlands Farm", subdivision: "Subdivision 3",
      location: "Kwekwe, Midlands Province, Zimbabwe",
      total_ha: 119.2, mapped_ha: Math.round(mapped * 10) / 10,
      cropped_ha: Math.round(cropped * 10) / 10,
      coordinates: { lat: Number(process.env.FARM_LAT || -18.9281), lng: Number(process.env.FARM_LNG || 29.8149) },
    },
    blocks,
    livestock: {
      herds,
      flocks,
      totals: {
        cattle: herds.filter((h) => h.species === "cattle").reduce((a, h) => a + h.head_count, 0),
        goats: herds.filter((h) => h.species === "goats").reduce((a, h) => a + h.head_count, 0),
        pigs: herds.filter((h) => h.species === "pigs").reduce((a, h) => a + h.head_count, 0),
        poultry: flocks.reduce((a, f) => a + Number(f.current_count || 0), 0),
      },
    },
    water: {
      ...water,
      buffer_l: buffer,
      stored_l: stored === null ? null : Math.round(stored),
      stored_pct: stored === null || !buffer ? null : Math.round((stored / buffer) * 1000) / 10,
      // Days the stored buffer covers peak demand if the borehole stops (spec 3.5).
      autonomy_days: stored === null || !demand ? null : Math.round((stored / demand) * 10) / 10,
      full_buffer_autonomy_days: demand ? Math.round((buffer / demand) * 10) / 10 : null,
      pumping_headroom_pct: water.daily_pump_capacity_l && demand
        ? Math.round((1 - demand / water.daily_pump_capacity_l) * 100) : null,
      last_tank_reading: tank ? { pct: Number(tank.value), at: tank.taken_at } : null,
      last_pool_reading: pool ? { pct: Number(pool.value), at: pool.taken_at } : null,
    },
  });
});

ownerRouter.get("/kpis", auth(), requireRole("owner", "admin", "manager"), async (req, res) => {
  const days = Math.min(365, parseInt(req.query.period || "7", 10) || 7);
  const kpis = await tx((c) => computeKpis(c, { days }));
  res.json(kpis);
});

// Scaling plan (July 2026 to June 2027): milestones with progress computed
// from farm data, project steps (Phase 0 tank, reticulation), kale and
// poultry plans.
ownerRouter.get("/plan", auth(), requireRole("owner", "admin", "manager"), async (req, res) => {
  const { planStatus } = await import("../engine/plans.js");
  res.json(await tx((c) => planStatus(c)));
});

// Mark a milestone by hand ("done", "blocked", or "auto" to go back to the
// computed status), with an optional note.
ownerRouter.post("/plan/:key", auth(), requireRole("owner", "admin", "manager"), async (req, res) => {
  const { status, note } = req.body || {};
  if (!["done", "blocked", "auto"].includes(status)) return res.status(400).json({ error: "status must be done, blocked or auto" });
  const plan = (await q(`SELECT value FROM farm_settings WHERE key = 'scaling_plan'`)).rows[0]?.value;
  const m = plan?.milestones?.find((x) => x.key === req.params.key);
  if (!m) return res.status(404).json({ error: "no such milestone" });
  m.status = status;
  m.note = note ? String(note).slice(0, 300) : m.note || null;
  m.marked_by = req.user.id;
  m.marked_at = new Date().toISOString();
  await q(`UPDATE farm_settings SET value = $1, updated_at = now() WHERE key = 'scaling_plan'`, [JSON.stringify(plan)]);
  const { planStatus } = await import("../engine/plans.js");
  res.json(await tx((c) => planStatus(c)));
});

// Release an owner-released task now (project steps, chick placement, planting
// with the rains). Only templates without a recurring schedule.
ownerRouter.post("/release-task", auth(), requireRole("owner", "admin", "manager"), async (req, res) => {
  const { template_code, title, note } = req.body || {};
  const tpl = (await q(`SELECT code, schedule, active FROM task_templates WHERE code = $1 ORDER BY version DESC LIMIT 1`,
    [template_code])).rows[0];
  if (!tpl) return res.status(404).json({ error: "unknown task" });
  if (tpl.schedule) return res.status(400).json({ error: "That task runs on its own schedule" });
  if (!tpl.active) return res.status(400).json({ error: "That task is switched off" });
  const { releaseTemplateNow } = await import("../engine/rules.js");
  const id = await tx((c) => releaseTemplateNow(c, template_code, {
    title: title ? String(title).slice(0, 200) : null,
    params: note ? { owner_note: String(note).slice(0, 500) } : {},
    dueAt: new Date(Date.now() + 24 * 3_600_000),
  }));
  res.status(201).json({ id });
});

ownerRouter.post("/absence", auth(), requireRole("owner"), async (req, res) => {
  const { active, from, until, deputy_contact } = req.body || {};
  await q(
    `INSERT INTO farm_settings (key, value) VALUES ('absence_mode', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ active: !!active, from, until, deputy_contact })]);
  res.json({ ok: true });
});

ownerRouter.post("/release-now", auth(), requireRole("owner", "admin"), async (req, res) => {
  const result = await tx((c) => runRelease(c, req.body?.date || farmDateStr()));
  res.json(result);
});

ownerRouter.post("/forecast/refresh", auth(), requireRole("owner", "admin"), async (req, res) => {
  const { fetchForecast } = await import("../workers/forecast.js");
  const result = await tx((c) => fetchForecast(c));
  res.status(result.ok ? 200 : 502).json(result);
});

// Phase 2 water-balance ledger (spec 3.5): per-block deficit, MAD threshold,
// trailing ledger rows and today's plan basis.
ownerRouter.get("/water", auth(), async (req, res) => {
  const { getWbConfig, computeLedger, waterBalancePlan } = await import("../engine/waterBalance.js");
  const result = await tx(async (c) => {
    const cfg = await getWbConfig(c);
    const dateStr = req.query.date || farmDateStr();
    const blocks = [];
    for (const code of Object.keys(cfg.blocks)) {
      const ledger = await computeLedger(c, code, dateStr, { days: 14 });
      if (ledger) blocks.push(ledger);
    }
    const plan = cfg.enabled ? await waterBalancePlan(c, dateStr) : [];
    return { enabled: cfg.enabled, date: dateStr, blocks, plan };
  });
  res.json(result);
});

ownerRouter.post("/water/config", auth(), requireRole("owner", "admin"), async (req, res) => {
  const { getWbConfig } = await import("../engine/waterBalance.js");
  const current = await tx((c) => getWbConfig(c));
  const next = {
    ...current,
    ...(req.body?.enabled !== undefined ? { enabled: !!req.body.enabled } : {}),
    blocks: { ...current.blocks, ...(req.body?.blocks || {}) },
  };
  await q(
    `INSERT INTO farm_settings (key, value) VALUES ('water_balance', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)]);
  res.json(next);
});

// Devices (spec 6.2, 6.3): register, restore, revoke.
devicesRouter.post("/register", auth(), async (req, res) => {
  const { platform = "android", push_token = null } = req.body || {};
  const r = await q(
    `INSERT INTO devices (user_id, platform, push_token) VALUES ($1,$2,$3) RETURNING id`,
    [req.user.id, platform, push_token]);
  const user = await q(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
  res.json({ device_id: r.rows[0].id, token: sign(user.rows[0], r.rows[0].id) });
});

devicesRouter.post("/:id/restore", auth(), async (req, res) => {
  // Full state bundle for a replacement phone (R23): open instances, 30 days of
  // history, templates, reference data.
  const open = await q(
    `SELECT ti.*, tt.instructions, tt.checklist FROM task_instances ti
     JOIN task_templates tt ON tt.id = ti.template_id
     WHERE ti.state NOT IN ('verified_closed','skipped','expired','cancelled','superseded')`);
  const history = await q(
    `SELECT * FROM task_instances WHERE closed_at >= now() - interval '30 days'`);
  const templates = await q(`SELECT * FROM task_templates WHERE active`);
  const reference = {
    assets: (await q(`SELECT * FROM assets WHERE status = 'active'`)).rows,
    locations: (await q(`SELECT * FROM locations`)).rows,
    batches: (await q(`SELECT * FROM batches`)).rows,
    inventory: (await q(`SELECT * FROM inventory_items`)).rows,
  };
  await q(`UPDATE devices SET last_sync_at = now() WHERE id = $1`, [req.params.id]);
  res.json({ open_instances: open.rows, history: history.rows, templates: templates.rows, reference });
});

devicesRouter.post("/:id/revoke", auth(), requireRole("owner", "admin"), async (req, res) => {
  await q(`UPDATE devices SET revoked = true WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

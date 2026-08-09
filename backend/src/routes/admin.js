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

ownerRouter.get("/digest", auth(), async (req, res) => {
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

  res.json({
    today_mm: Number(today.rows[0].mm),
    last_reading: last.rows[0] ? { mm: Number(last.rows[0].value), at: last.rows[0].taken_at } : null,
    days: daily.rows.map((r) => ({ date: r.d, mm: Number(r.mm) })),
    season: {
      start: seasonStart,
      total_mm: Number(season.rows[0].mm),
      rain_days: Number(season.rows[0].rain_days),
      wettest_day: wettest.rows[0] ? { date: wettest.rows[0].d, mm: Number(wettest.rows[0].mm) } : null,
    },
  });
});

ownerRouter.get("/kpis", auth(), async (req, res) => {
  const days = Math.min(365, parseInt(req.query.period || "7", 10) || 7);
  const kpis = await tx((c) => computeKpis(c, { days }));
  res.json(kpis);
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

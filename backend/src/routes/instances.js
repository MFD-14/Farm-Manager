// Plan, instance detail and owner decisions (spec 6.2).
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { q, tx } from "../db/pool.js";
import { auth, requireRole } from "../middleware/auth.js";
import { foldEvent } from "../engine/fold.js";
import { farmDateStr, farmTime, addDays } from "../util/time.js";

export const planRouter = Router();
export const instancesRouter = Router();

planRouter.get("/today", auth(), async (req, res) => {
  const dateStr = req.query.date || farmDateStr();
  const plan = await q(`SELECT * FROM daily_plans WHERE plan_date = $1`, [dateStr]);
  if (!plan.rows.length) return res.json({ date: dateStr, plan: null, instances: [] });
  const instances = await q(
    `SELECT * FROM task_instances WHERE id = ANY($1) ORDER BY array_position($1, id)`,
    [plan.rows[0].instance_ids]);
  const view = req.user.role === "owner"
    ? instances.rows
    : instances.rows.filter((i) => !i.assignee_id || i.assignee_id === req.user.id);
  res.json({ date: dateStr, plan: plan.rows[0], instances: view });
});

instancesRouter.get("/:id", auth(), async (req, res) => {
  const inst = await q(`SELECT * FROM task_instances WHERE id = $1`, [req.params.id]);
  if (!inst.rows.length) return res.status(404).json({ error: "not found" });
  const events = await q(
    `SELECT * FROM task_events WHERE instance_id = $1 ORDER BY server_time`, [req.params.id]);
  const media = await q(`SELECT * FROM media_objects WHERE instance_id = $1`, [req.params.id]);
  const verdicts = await q(`SELECT * FROM vim_verdicts WHERE instance_id = $1 ORDER BY decided_at`, [req.params.id]);
  res.json({ instance: inst.rows[0], events: events.rows, media: media.rows, verdicts: verdicts.rows });
});

// Owner decisions append the matching event (spec 6.2).
const DECISION_EVENTS = {
  verify: "verified_closed",
  reject: "rejected_reopened",
  approve_skip: "skip_approved",
  deny_skip: "skip_denied",
  cancel: "cancelled",
  reassign: "reassigned",
  unblock: "unblocked",
};

instancesRouter.post("/:id/decision", auth(), requireRole("owner", "admin"), async (req, res) => {
  const { action, note, assignee_id } = req.body || {};
  const type = DECISION_EVENTS[action];
  if (!type) return res.status(400).json({ error: `unknown action ${action}` });
  const payload = { note: note || null };
  if (type === "rejected_reopened") payload.new_due_at = farmTime(addDays(farmDateStr(), 1), "12:00");
  if (type === "reassigned") payload.assignee_id = assignee_id;
  if (type === "verified_closed") payload.verification = { method: "owner", verdict: "pass", note: note || null };
  try {
    const result = await tx((c) =>
      foldEvent(c, {
        event_uuid: randomUUID(), instance_id: req.params.id,
        actor_type: "owner", actor_id: req.user.id, type, payload,
      }));
    if (result.status === "rejected") return res.status(400).json({ error: result.reason });
    if (result.conflict) return res.status(409).json({ error: result.conflict });
    res.json({ ok: true, state: result.instance?.state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner decision queue: everything waiting on a human (spec 3.6 assignment rule 2).
instancesRouter.get("/", auth(), async (req, res) => {
  const state = req.query.state;
  if (state === "decisions") {
    const r = await q(
      `SELECT * FROM task_instances WHERE state IN ('needs_review','skip_pending','blocked')
       ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, updated_at`);
    return res.json({ instances: r.rows });
  }
  const r = await q(
    `SELECT * FROM task_instances WHERE ($1::text IS NULL OR state = $1)
     ORDER BY due_at DESC NULLS LAST LIMIT 200`, [state || null]);
  res.json({ instances: r.rows });
});

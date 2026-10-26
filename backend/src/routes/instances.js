// Plan, instance detail and owner decisions (spec 6.2).
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { q, tx } from "../db/pool.js";
import { auth, requireRole } from "../middleware/auth.js";
import { foldEvent } from "../engine/fold.js";
import { farmDateStr, farmTime, addDays } from "../util/time.js";
import { readyToAccept } from "../engine/verification.js";
import { sendSentBack } from "../workers/whatsappSender.js";

// Owners and task managers run the acceptance queue and see every task.
export const CONSOLE_ROLES = ["owner", "admin", "manager"];
const actorType = (role) => (role === "manager" ? "manager" : "owner");

export const planRouter = Router();
export const instancesRouter = Router();

planRouter.get("/today", auth(), async (req, res) => {
  const dateStr = req.query.date || farmDateStr();
  const plan = await q(`SELECT * FROM daily_plans WHERE plan_date = $1`, [dateStr]);
  if (!plan.rows.length) return res.json({ date: dateStr, plan: null, instances: [] });
  const instances = await q(
    `SELECT * FROM task_instances WHERE id = ANY($1) ORDER BY array_position($1, id)`,
    [plan.rows[0].instance_ids]);
  const view = CONSOLE_ROLES.includes(req.user.role)
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

// Decisions append the matching event (spec 6.2). "accept" closes a task as
// verified; "send_back" reopens it with a reason the caretaker is told on
// WhatsApp. Owners and task managers decide; the event records which.
const DECISION_EVENTS = {
  accept: "verified_closed",
  verify: "verified_closed",
  send_back: "rejected_reopened",
  reject: "rejected_reopened",
  approve_skip: "skip_approved",
  deny_skip: "skip_denied",
  cancel: "cancelled",
  reassign: "reassigned",
  unblock: "unblocked",
};

async function decide(c, { instanceId, action, note, assigneeId, user, eventUuid }) {
  const type = DECISION_EVENTS[action];
  if (!type) return { status: "rejected", reason: `unknown action ${action}` };
  if (type === "rejected_reopened" && !String(note || "").trim()) {
    return { status: "rejected", reason: "Say why it is being sent back" };
  }
  const payload = { note: note || null, decided_by_role: user.role };
  if (type === "rejected_reopened") payload.new_due_at = farmTime(addDays(farmDateStr(), 1), "12:00");
  if (type === "reassigned") payload.assignee_id = assigneeId;
  if (type === "verified_closed") payload.verification = { method: "accepted", by: user.id, role: user.role, note: note || null };
  const result = await foldEvent(c, {
    event_uuid: eventUuid || randomUUID(), instance_id: instanceId,
    actor_type: actorType(user.role), actor_id: user.id, type, payload,
  });
  if (result.status === "accepted" && type === "rejected_reopened" && result.instance) {
    await sendSentBack(c, { instance: result.instance, reason: String(note).trim() }).catch(() => {});
  }
  return result;
}

instancesRouter.post("/:id/decision", auth(), requireRole(...CONSOLE_ROLES), async (req, res) => {
  const { action, note, assignee_id, event_uuid } = req.body || {};
  try {
    const result = await tx((c) => decide(c, {
      instanceId: req.params.id, action, note, assigneeId: assignee_id, user: req.user, eventUuid: event_uuid,
    }));
    if (result.status === "duplicate") return res.json({ ok: true, duplicate: true });
    if (result.status === "rejected") return res.status(400).json({ error: result.reason });
    if (result.conflict) return res.status(409).json({ error: result.conflict });
    res.json({ ok: true, state: result.instance?.state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept several tasks at once: only ones whose sole reason for waiting is the
// acceptance step; anything flagged (missing readings, timing, physics) is left
// for a one-by-one look.
instancesRouter.post("/accept", auth(), requireRole(...CONSOLE_ROLES), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200) : [];
  const accepted = [];
  const skipped = [];
  for (const id of ids) {
    await tx(async (c) => {
      const inst = (await c.query(`SELECT state FROM task_instances WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      const flags = (await c.query(
        `SELECT payload->'flags' AS flags FROM task_events WHERE instance_id = $1 AND type = 'review_required'
         ORDER BY server_time DESC LIMIT 1`, [id])).rows[0]?.flags;
      const vim = (await c.query(`SELECT verdict FROM vim_verdicts WHERE instance_id = $1`, [id])).rows;
      if (!readyToAccept(inst?.state, flags, vim)) { skipped.push(id); return; }
      const r = await decide(c, { instanceId: id, action: "accept", note: req.body?.note || null, user: req.user });
      (r.status === "accepted" ? accepted : skipped).push(id);
    });
  }
  res.json({ accepted, skipped });
});

// Decision queue: everything waiting on a human (spec 3.6 assignment rule 2),
// with what's needed to decide on a phone without opening each task.
instancesRouter.get("/", auth(), async (req, res) => {
  const state = req.query.state;
  if (state === "decisions") {
    if (!CONSOLE_ROLES.includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
    const r = await q(
      `SELECT ti.*,
         (SELECT payload->'flags' FROM task_events e WHERE e.instance_id = ti.id AND e.type = 'review_required'
            ORDER BY server_time DESC LIMIT 1) AS review_flags,
         (SELECT json_build_object('at', e.device_time, 'by', u.name, 'via', e.actor_type)
            FROM task_events e LEFT JOIN users u ON u.id = e.actor_id
            WHERE e.instance_id = ti.id AND e.type = 'done_reported' ORDER BY server_time DESC LIMIT 1) AS reported,
         COALESCE((SELECT json_agg(json_build_object('media_uuid', m.media_uuid, 'kind', m.kind, 'status', m.status)
                     ORDER BY m.created_at)
                   FROM media_objects m WHERE m.instance_id = ti.id), '[]') AS media,
         COALESCE((SELECT json_agg(json_build_object('verdict', v.verdict, 'confidence', v.confidence,
                     'note', v.extracted->>'reason', 'model', v.model_version))
                   FROM vim_verdicts v WHERE v.instance_id = ti.id), '[]') AS vim
       FROM task_instances ti WHERE ti.state IN ('needs_review','skip_pending','blocked')
       ORDER BY CASE ti.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, ti.updated_at`);
    return res.json({
      instances: r.rows.map((i) => ({ ...i, ready_to_accept: readyToAccept(i.state, i.review_flags, i.vim) })),
    });
  }
  const r = await q(
    `SELECT * FROM task_instances WHERE ($1::text IS NULL OR state = $1)
     ORDER BY due_at DESC NULLS LAST LIMIT 200`, [state || null]);
  res.json({ instances: r.rows });
});

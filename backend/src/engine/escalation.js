// Escalation engine (spec 4.2, 4.3). Timers run server-side off the event log;
// this sweep runs every few minutes. Rungs already fired are recorded on the
// instance's escalation_state so each fires exactly once.
import { randomUUID } from "node:crypto";
import { foldEvent } from "./fold.js";
import { notify, notifyCollapsedOverdue } from "../workers/notifier.js";
import { sendTaskButtons } from "../workers/whatsappSender.js";

async function absenceMode(c) {
  const r = await c.query(`SELECT value FROM farm_settings WHERE key = 'absence_mode'`);
  const v = r.rows[0]?.value || { active: false };
  if (!v.active) return { active: false };
  const now = new Date();
  if (v.from && new Date(v.from) > now) return { active: false };
  if (v.until && new Date(v.until) < now) return { active: false };
  return v;
}

async function fireRung(c, instance, rung, absence) {
  const marker = instance.escalation_state || {};
  if (marker[rung.key]) return false;

  // Anti-nag quieting (spec 4.3): after 14 consecutive on-time closes of the same
  // template, the pre-due nudge is off. Applies only to pre_due.
  if (rung.key === "pre_due") {
    const { rows } = await c.query(
      `SELECT state, missed_count FROM task_instances
       WHERE template_id = $1 AND id <> $2 ORDER BY due_at DESC LIMIT 14`,
      [instance.template_id, instance.id]);
    if (rows.length === 14 && rows.every((r) => r.state === "verified_closed" && r.missed_count === 0)) {
      return false;
    }
  }

  let targets = rung.to || ["caretaker"];
  if (absence.active) {
    // Rungs that would reach the owner go to the deputy if configured; P0 always
    // reaches the owner regardless (spec 4.2).
    if (targets.includes("owner") && absence.deputy_contact && instance.priority !== "P0") {
      targets = ["deputy"];
    }
  }

  for (const to of targets) {
    for (const channel of rung.channels || []) {
      if (channel === "local") continue; // mirrored client-side from the cached plan
      if (channel === "whatsapp" && rung.buttons && to === "caretaker") {
        const u = await c.query(`SELECT phone FROM users WHERE role = 'caretaker' ORDER BY created_at LIMIT 1`);
        if (u.rows[0]?.phone) await sendTaskButtons(c, { toPhone: u.rows[0].phone, instance });
        await c.query(
          `INSERT INTO notifications_log (channel, rung, instance_id, recipient, body)
           VALUES ('whatsapp', $1, $2, $3, $4)`,
          [rung.key, instance.id, u.rows[0]?.phone || "caretaker", { buttons: true }]);
      } else {
        await notify(c, {
          channel, to: to === "deputy" ? "owner" : to, rung: rung.key, instanceId: instance.id,
          body: { task: `${instance.template_code} ${instance.title}`, due_at: instance.due_at, deputy: to === "deputy" },
        });
      }
    }
  }

  await foldEvent(c, {
    event_uuid: randomUUID(), instance_id: instance.id, actor_type: "system",
    type: "escalated", payload: { rung: rung.key, to: targets },
  });
  await c.query(
    `UPDATE task_instances SET escalation_state = escalation_state || $2, updated_at = now() WHERE id = $1`,
    [instance.id, JSON.stringify({ [rung.key]: new Date().toISOString() })]);
  return true;
}

export async function runEscalationSweep(c, { now = new Date() } = {}) {
  const absence = await absenceMode(c);
  const profiles = {};
  for (const p of (await c.query(`SELECT name, rungs FROM escalation_profiles`)).rows) profiles[p.name] = p.rungs;

  const { rows: open } = await c.query(
    `SELECT ti.*, tt.escalation_profile AS tpl_profile FROM task_instances ti
     JOIN task_templates tt ON tt.id = ti.template_id
     WHERE ti.state IN ('released','acknowledged','in_progress')`);

  const fired = [];
  const overdueForCollapse = [];

  for (const inst of open) {
    const prof = profiles[inst.tpl_profile || inst.priority] || profiles[inst.priority];
    if (!prof) continue;
    const due = inst.due_at ? new Date(inst.due_at) : null;
    const grace = inst.grace_until ? new Date(inst.grace_until) : null;

    // Expiry (R5: stale instructions die) has priority over escalation.
    if (inst.expires_at && new Date(inst.expires_at) <= now) {
      await foldEvent(c, {
        event_uuid: randomUUID(), instance_id: inst.id, actor_type: "system",
        type: "expired", payload: { reason: "expires_at passed" },
      });
      continue;
    }

    // Pre-due nudge (P1: 60 min before due).
    if (prof.pre_due_min && due && now >= new Date(due.getTime() - prof.pre_due_min * 60_000) && now < due) {
      if (await fireRung(c, inst, { key: "pre_due", channels: ["push"], to: ["caretaker"] }, absence)) {
        fired.push({ id: inst.id, rung: "pre_due" });
      }
    }

    for (const rung of prof.overdue || []) {
      let rungTime = null;
      if (rung.after_min && due) rungTime = new Date(due.getTime() + rung.after_min * 60_000);
      else if (rung.at_grace_end && grace) rungTime = grace;
      if (!rungTime || now < rungTime) continue;

      if (rung.mark_missed) {
        await foldEvent(c, {
          event_uuid: randomUUID(), instance_id: inst.id, actor_type: "system",
          type: "missed", payload: { rung: rung.key },
        });
        fired.push({ id: inst.id, rung: rung.key, missed: true });
        // Missed twice consecutively: named owner exception (spec 4.2); P1 alerts now.
        if (inst.missed_count + 1 >= 2) {
          await notify(c, {
            channel: inst.priority === "P1" || inst.priority === "P0" ? "whatsapp" : "digest",
            to: "owner", rung: "second_miss", instanceId: inst.id,
            body: { task: `${inst.template_code} ${inst.title}`, missed_count: inst.missed_count + 1 },
          });
        }
        break; // instance left the open set
      }

      if (rung.channels?.includes("whatsapp") && rung.to?.includes("caretaker")) {
        overdueForCollapse.push({ inst, rung });
      } else if (await fireRung(c, inst, rung, absence)) {
        fired.push({ id: inst.id, rung: rung.key });
      }
    }
  }

  // Reminder collapse (spec 4.3): one WhatsApp listing all overdue, not one each.
  const fresh = [];
  for (const { inst, rung } of overdueForCollapse) {
    if (!(inst.escalation_state || {})[rung.key]) fresh.push({ inst, rung });
  }
  if (fresh.length) {
    await notifyCollapsedOverdue(c, {
      to: "caretaker",
      instances: fresh.map(({ inst }) => inst),
      rung: fresh[0].rung.key,
    });
    for (const { inst, rung } of fresh) {
      await foldEvent(c, {
        event_uuid: randomUUID(), instance_id: inst.id, actor_type: "system",
        type: "escalated", payload: { rung: rung.key, collapsed: true },
      });
      await c.query(
        `UPDATE task_instances SET escalation_state = escalation_state || $2, updated_at = now() WHERE id = $1`,
        [inst.id, JSON.stringify({ [rung.key]: now.toISOString() })]);
      fired.push({ id: inst.id, rung: rung.key, collapsed: true });
    }
  }

  // Absence-mode auto-approvals (spec 4.2): skip_pending > 48h with valid reason
  // auto-approves; needs_review > 72h auto-closes flagged for post-absence audit.
  if (absence.active) {
    const { rows: skips } = await c.query(
      `SELECT ti.id, ev.payload FROM task_instances ti
       JOIN LATERAL (SELECT payload FROM task_events e WHERE e.instance_id = ti.id AND e.type = 'skip_requested'
                     ORDER BY server_time DESC LIMIT 1) ev ON true
       WHERE ti.state = 'skip_pending' AND ti.updated_at < $1`,
      [new Date(now - 48 * 3_600_000)]);
    const validReasons = new Set(["no water", "no input in stock", "rain", "sick", "other"]);
    for (const s of skips) {
      if (!validReasons.has(s.payload?.reason_code)) continue;
      await foldEvent(c, {
        event_uuid: randomUUID(), instance_id: s.id, actor_type: "system",
        type: "skip_approved", payload: { auto: true, flagged_for_review: true, reason: "absence_auto_approve" },
      });
      fired.push({ id: s.id, rung: "absence_auto_skip" });
    }
    const { rows: reviews } = await c.query(
      `SELECT id FROM task_instances WHERE state = 'needs_review' AND updated_at < $1`,
      [new Date(now - 72 * 3_600_000)]);
    for (const r of reviews) {
      await foldEvent(c, {
        event_uuid: randomUUID(), instance_id: r.id, actor_type: "system",
        type: "verified_closed",
        payload: { verification: { method: "deferred_owner_audit", verdict: "pass", flagged: true } },
      });
      fired.push({ id: r.id, rung: "absence_auto_close" });
    }
  }

  return fired;
}

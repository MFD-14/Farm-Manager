// Release engine (spec 3.6): at 04:45 farm time, materialise the day. Evaluates
// S1-S5 schedules, applies guards and suppressions, writes a DailyPlan ordered
// by priority then time. Idempotent on (template_id, period_key, subject_id).
import { randomUUID } from "node:crypto";
import { calendarOccurrences, meterDue, irrigationPlan } from "./schedules.js";
import { evaluateGuards } from "./guards.js";
import { e0AuditUpgrade } from "./evidence.js";
import { farmTime, addDays } from "../util/time.js";
import { foldEvent } from "./fold.js";

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

async function caretakerId(c) {
  const r = await c.query(`SELECT id FROM users WHERE role = 'caretaker' ORDER BY created_at LIMIT 1`);
  return r.rows[0]?.id || null;
}
async function ownerId(c) {
  const r = await c.query(`SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1`);
  return r.rows[0]?.id || null;
}

function graceFor(profileRungs, dateStr, dueAt) {
  const g = profileRungs?.grace;
  if (profileRungs?.grace_min) return new Date(dueAt.getTime() + profileRungs.grace_min * 60_000);
  if (g === "due_day_20:00" || g === "end_of_day") return farmTime(dateStr, g === "end_of_day" ? "23:59" : "20:00");
  return farmTime(dateStr, "20:00");
}

async function createInstance(c, tpl, dateStr, timeStr, {
  subjectType, subjectId, params = {}, periodSuffix = "", assignee, title,
}) {
  const releaseAt = farmTime(dateStr, "04:45");
  const dueAt = farmTime(dateStr, timeStr);
  const prof = await c.query(`SELECT rungs FROM escalation_profiles WHERE name = $1`, [tpl.escalation_profile || tpl.priority]);
  const graceUntil = graceFor(prof.rows[0]?.rungs, dateStr, dueAt);
  const periodKey = `${dateStr}${(tpl.schedule?.at?.length || 0) > 1 ? ":" + timeStr : ""}${periodSuffix}`;

  const instanceId = randomUUID();
  const policy = e0AuditUpgrade(tpl.evidence_policy, instanceId);

  const r = await c.query(
    `INSERT INTO task_instances
       (id, template_id, template_code, template_version, period_key, subject_type, subject_id, assignee_id,
        title, priority, est_minutes, params, release_at, due_at, grace_until, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'scheduled')
     ON CONFLICT (template_id, period_key, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [instanceId, tpl.id, tpl.code, tpl.version, periodKey,
     subjectType ?? tpl.subject_type, subjectId ?? tpl.default_subject_id, assignee,
     title || tpl.title, tpl.priority, tpl.est_minutes,
     JSON.stringify({ ...params, evidence_policy_resolved: policy }),
     releaseAt, dueAt, graceUntil]);
  return { id: r.rows[0].id, inserted: r.rows[0].inserted };
}

async function releaseInstance(c, instanceId, payload = {}) {
  await foldEvent(c, {
    event_uuid: randomUUID(), instance_id: instanceId, actor_type: "system",
    type: "released", payload,
  });
}

// Roll missed instances into today's plan (spec 4.2 "missed once": top of next
// plan with a yesterday badge; deferral/starvation guard per 3.6).
async function rollMissed(c, dateStr, planIds) {
  const { rows } = await c.query(
    `SELECT id, priority, missed_count, template_code FROM task_instances WHERE state = 'missed' ORDER BY due_at`);
  const owner = await ownerId(c);
  for (const m of rows) {
    if (m.missed_count >= 3 && ["P2", "P3"].includes(m.priority)) {
      // Third miss escalates to the owner queue as a decision (spec 4.2).
      await foldEvent(c, {
        event_uuid: randomUUID(), instance_id: m.id, actor_type: "system",
        type: "escalated", payload: { to: "owner_queue", reason: "third_miss", owner_id: owner },
      });
      continue;
    }
    await foldEvent(c, {
      event_uuid: randomUUID(), instance_id: m.id, actor_type: "system",
      type: "rolled", payload: { into: dateStr, badge: "yesterday" },
    });
    await c.query(
      `UPDATE task_instances SET due_at = $2, grace_until = $3, updated_at = now() WHERE id = $1`,
      [m.id, farmTime(dateStr, "12:00"), farmTime(dateStr, "20:00")]);
    planIds.push(m.id);
  }
}

// Release chain members whose date has arrived (created 'scheduled' by chains.js).
async function releaseDueChainMembers(c, dateStr, planIds, suppressedCodes) {
  const endOfDay = farmTime(dateStr, "23:59");
  const { rows } = await c.query(
    `SELECT id, template_code FROM task_instances WHERE state = 'scheduled' AND release_at <= $1`, [endOfDay]);
  for (const r of rows) {
    if (suppressedCodes.has(r.template_code)) continue;
    await releaseInstance(c, r.id);
    planIds.push(r.id);
  }
}

export async function runRelease(c, dateStr, { now = new Date() } = {}) {
  const caretaker = await caretakerId(c);
  const owner = await ownerId(c);
  const planIds = [];
  const exceptions = [];

  // Suppressions from rules (e.g. T2 rain wrote suppress_next_day)
  const s = await c.query(`SELECT value FROM farm_settings WHERE key = 'suppressions'`);
  const suppressions = (s.rows[0]?.value || []).filter((x) => x.date === dateStr);
  const suppressedCodes = new Set(suppressions.map((x) => x.template));

  const { rows: templates } = await c.query(
    `SELECT * FROM task_templates WHERE active AND schedule IS NOT NULL`);

  for (const tpl of templates) {
    if (suppressedCodes.has(tpl.code)) continue;
    const sched = tpl.schedule;
    const assignee = tpl.evidence_policy?.assignee_role === "owner" ? owner
      : sched.assignee === "system" ? null : caretaker;

    if (sched.type === "calendar") {
      let lastClosedDate = null;
      if (sched.fixed === false) {
        const lc = await c.query(
          `SELECT closed_at FROM task_instances WHERE template_id = $1 AND state = 'verified_closed'
           ORDER BY closed_at DESC LIMIT 1`, [tpl.id]);
        lastClosedDate = lc.rows[0]?.closed_at?.toISOString().slice(0, 10) || null;
        // A floating task released but not yet closed must not re-release daily.
        const open = await c.query(
          `SELECT 1 FROM task_instances WHERE template_id = $1
           AND state NOT IN ('verified_closed','skipped','expired','cancelled','superseded') LIMIT 1`, [tpl.id]);
        if (open.rows.length) continue;
      }
      const times = calendarOccurrences(sched, dateStr, { lastClosedDate });
      for (const timeStr of times) {
        // Batch-scoped dailies (per_active_batch): one instance per qualifying batch.
        if (sched.per_active_batch) {
          const { rows: batches } = await c.query(
            `SELECT id, name, placed_on FROM batches WHERE stage NOT IN ('closed') AND placed_on IS NOT NULL`);
          for (const b of batches) {
            const age = Math.floor((new Date(dateStr) - new Date(b.placed_on)) / 86_400_000);
            if (sched.batch_age_max_days && age > sched.batch_age_max_days) continue;
            if (sched.batch_age_min_days && age < sched.batch_age_min_days) continue;
            const { id, inserted } = await createInstance(c, tpl, dateStr, timeStr, {
              subjectType: "batch", subjectId: b.id, assignee,
              title: `${tpl.title} (${b.name})`, periodSuffix: "",
            });
            if (inserted) await releaseInstance(c, id);
            planIds.push(id);
          }
          continue;
        }
        // Rotating subjects (A-03 fence sections)
        let subjectId = tpl.default_subject_id;
        let subjectType = tpl.subject_type;
        if (sched.rotate_subjects?.length) {
          const week = Math.floor(new Date(dateStr).getTime() / (7 * 86_400_000));
          const code = sched.rotate_subjects[week % sched.rotate_subjects.length];
          const a = await c.query(`SELECT id FROM assets WHERE code = $1`, [code]);
          subjectId = a.rows[0]?.id || null;
          subjectType = "asset";
        }
        const guardBlocks = await evaluateGuards(c, tpl, { subjectId });
        const { id, inserted } = await createInstance(c, tpl, dateStr, timeStr, { subjectType, subjectId, assignee });
        if (!inserted) { planIds.push(id); continue; }
        if (guardBlocks.length) {
          await foldEvent(c, {
            event_uuid: randomUUID(), instance_id: id, actor_type: "system",
            type: "released", payload: {},
          });
          await foldEvent(c, {
            event_uuid: randomUUID(), instance_id: id, actor_type: "system",
            type: "problem_flagged", payload: { guard_blocks: guardBlocks, auto: true },
          });
          exceptions.push({ kind: "guard_blocked", template: tpl.code, blocks: guardBlocks });
        } else {
          await releaseInstance(c, id);
        }
        planIds.push(id);
      }
    }

    if (sched.type === "meter") {
      const acc = await c.query(`SELECT * FROM meter_accumulators WHERE meter = $1`, [sched.meter]);
      const total = Number(acc.rows[0]?.total || 0);
      const lastService = Number(acc.rows[0]?.last_service_at_total || 0);
      if (meterDue(sched, total, lastService)) {
        const open = await c.query(
          `SELECT 1 FROM task_instances WHERE template_id = $1
           AND state NOT IN ('verified_closed','skipped','expired','cancelled','superseded') LIMIT 1`, [tpl.id]);
        if (!open.rows.length) {
          const { id, inserted } = await createInstance(c, tpl, dateStr, "09:00", {
            assignee: caretaker, periodSuffix: `:meter:${Math.floor(total / sched.every)}`,
            params: { meter_total: total },
          });
          if (inserted) await releaseInstance(c, id);
          planIds.push(id);
        }
      }
    }

    if (sched.type === "rolling" && sched.compute === "irrigation_planner") {
      const shifts = await irrigationPlan(c, dateStr);
      for (const shift of shifts) {
        const guardBlocks = await evaluateGuards(c, tpl, { subjectId: shift.block_id });
        const { id, inserted } = await createInstance(c, tpl, dateStr, shift.start, {
          subjectType: "location", subjectId: shift.block_id, assignee,
          title: `Irrigation shift: ${shift.block_name}`,
          periodSuffix: `:${shift.block_code}`,
          params: { block: shift.block_code, minutes: shift.minutes, litres: shift.litres, start: shift.start },
        });
        if (!inserted) { planIds.push(id); continue; }
        // Rain-suppressed shifts die rather than rot (spec R5/T2): expire at end of day.
        await c.query(`UPDATE task_instances SET expires_at = $2 WHERE id = $1`, [id, farmTime(dateStr, "21:00")]);
        if (!guardBlocks.length) await releaseInstance(c, id, { shift });
        planIds.push(id);
      }
    }
  }

  await releaseDueChainMembers(c, dateStr, planIds, suppressedCodes);
  await rollMissed(c, dateStr, planIds);

  // Keep any other open instance due today on the plan (rolled yesterday-tasks on a
  // regeneration, trigger-released tasks): the plan is the caretaker's whole day.
  const { rows: openToday } = await c.query(
    `SELECT id FROM task_instances
     WHERE state IN ('released','acknowledged','in_progress','blocked','skip_pending','done_reported','needs_review')
       AND due_at BETWEEN $1 AND $2 AND NOT (id = ANY($3::uuid[]))`,
    [farmTime(dateStr, "00:00"), farmTime(dateStr, "23:59"), planIds.length ? planIds : ["00000000-0000-0000-0000-000000000000"]]);
  for (const r of openToday) planIds.push(r.id);

  // Capacity check (spec 3.6): interaction minutes and P1 overload flag.
  const { rows: planRows } = planIds.length
    ? await c.query(
        `SELECT id, priority, est_minutes, due_at FROM task_instances WHERE id = ANY($1)
         ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, due_at`,
        [planIds])
    : { rows: [] };
  const totalMinutes = planRows.reduce((a, r) => a + r.est_minutes, 0);
  const p1Minutes = planRows.filter((r) => ["P0", "P1"].includes(r.priority)).reduce((a, r) => a + r.est_minutes, 0);
  const capacityNote = { total_minutes: totalMinutes, p1_minutes: p1Minutes, exceptions };
  if (p1Minutes > 120) {
    capacityNote.overload = true;
    exceptions.push({ kind: "capacity", detail: "today cannot fit: choose", p1_minutes: p1Minutes });
  }

  const orderedIds = planRows.map((r) => r.id);
  await c.query(
    `INSERT INTO daily_plans (plan_date, instance_ids, capacity_note)
     VALUES ($1,$2,$3)
     ON CONFLICT (plan_date) DO UPDATE SET instance_ids = EXCLUDED.instance_ids,
       capacity_note = EXCLUDED.capacity_note, generated_at = now()`,
    [dateStr, orderedIds, capacityNote]);

  return { planIds: orderedIds, capacityNote };
}

// P2/P3 deferral when the day is over capacity (spec 3.6): defer up to 2/7 days.
export async function deferOverflow(c, dateStr) {
  const { rows } = await c.query(
    `SELECT id, priority, deferral_count FROM task_instances
     WHERE state IN ('released','acknowledged') AND priority IN ('P2','P3')
       AND due_at::date = $1 AND deferral_count < CASE priority WHEN 'P2' THEN 2 ELSE 7 END`,
    [dateStr]);
  for (const r of rows) {
    const next = addDays(dateStr, 1);
    await foldEvent(c, {
      event_uuid: randomUUID(), instance_id: r.id, actor_type: "system",
      type: "deferred", payload: { to: next },
    });
    await c.query(`UPDATE task_instances SET due_at = $2, grace_until = $3 WHERE id = $1`,
      [r.id, farmTime(next, "17:00"), farmTime(next, "20:00")]);
  }
  return rows.length;
}

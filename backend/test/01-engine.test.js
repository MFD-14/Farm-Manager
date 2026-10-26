import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prepareDb, resetDynamic, appendEvent, getInstance, instancesByCode, tx, q, pool } from "./helpers.js";
import { applyTransition } from "../src/engine/stateMachine.js";
import { validateEvidence } from "../src/engine/evidence.js";
import { calendarOccurrences } from "../src/engine/schedules.js";
import { runRelease } from "../src/engine/release.js";
import { evaluateRules } from "../src/engine/rules.js";
import { runEscalationSweep } from "../src/engine/escalation.js";
import { rebuildProjections } from "../src/engine/fold.js";
import { buildDigest } from "../src/engine/digest.js";
import { computeKpis } from "../src/engine/kpis.js";
import { farmDateStr, farmTime, addDays } from "../src/util/time.js";

const TODAY = "2026-08-03"; // a Monday: weekly MO templates release

before(async () => { await prepareDb(); });
beforeEach(async () => { await resetDynamic(); });

// ── State machine (spec 3.2) ─────────────────────────────────────────────────
test("state machine: legal and illegal transitions", () => {
  const inst = (state) => ({ state });
  assert.equal(applyTransition(inst("scheduled"), "released").next, "released");
  assert.equal(applyTransition(inst("released"), "done_reported").next, "done_reported");
  assert.equal(applyTransition(inst("done_reported"), "auto_verified").next, "verified_closed");
  assert.equal(applyTransition(inst("done_reported"), "review_required").next, "needs_review");
  assert.equal(applyTransition(inst("needs_review"), "rejected_reopened").next, "released");
  assert.equal(applyTransition(inst("skip_pending"), "skip_approved").next, "skipped");
  assert.equal(applyTransition(inst("missed"), "rolled").next, "released");
  assert.equal(applyTransition(inst("verified_closed"), "corrected").next, "verified_closed");
  // Illegal
  assert.equal(applyTransition(inst("scheduled"), "done_reported").ok, false);
  assert.equal(applyTransition(inst("verified_closed"), "done_reported").ok, false);
  assert.equal(applyTransition(inst("expired"), "cancelled").ok, false);
});

// ── Evidence policy (spec 5.1) ───────────────────────────────────────────────
test("evidence: E1 fields and E2 photo minimums enforced", () => {
  const policy = { classes: ["E1", "E2"], photo_min: 1,
    fields: [{ key: "level_pct", type: "number", min: 0, max: 100 }] };
  assert.equal(validateEvidence(policy, { fields: {}, photo_count: 0 }).ok, false);
  assert.equal(validateEvidence(policy, { fields: { level_pct: 62 }, photo_count: 0 }).ok, false);
  assert.equal(validateEvidence(policy, { fields: { level_pct: 62 }, photo_count: 1 }).ok, true);
  assert.equal(validateEvidence(policy, { fields: { level_pct: 162 }, photo_count: 1 }).ok, false);
});

test("evidence: any_of accepts photo or voice (W-E3)", () => {
  const policy = { classes: ["E2", "E5"], any_of: ["E2", "E5"] };
  assert.equal(validateEvidence(policy, {}).ok, false);
  assert.equal(validateEvidence(policy, { voice_count: 1 }).ok, true);
  assert.equal(validateEvidence(policy, { photo_count: 1 }).ok, true);
});

// ── Schedules (spec 3.3) ─────────────────────────────────────────────────────
test("S1 calendar occurrences: daily, weekly, seasonal override", () => {
  const daily = { type: "calendar", freq: "daily", at: ["06:00", "17:00"], fixed: true };
  assert.deepEqual(calendarOccurrences(daily, "2026-08-03"), ["06:00", "17:00"]);

  const weekly = { type: "calendar", freq: "weekly", byday: ["MO"], at: ["06:30"], fixed: true };
  assert.deepEqual(calendarOccurrences(weekly, "2026-08-03"), ["06:30"]); // Monday
  assert.deepEqual(calendarOccurrences(weekly, "2026-08-04"), []);

  // K-04 seasonal switch: weekly in rains (Nov-Apr), fortnightly dry (May-Oct)
  const dip = { type: "calendar", freq: "weekly", byday: ["WE"], at: ["08:00"], fixed: true,
    season_overrides: [
      { months: [11, 12, 1, 2, 3, 4], freq: "weekly" },
      { months: [5, 6, 7, 8, 9, 10], freq: "fortnightly" },
    ] };
  // In August (dry): fortnightly parity — exactly one of two consecutive Wednesdays fires
  const w1 = calendarOccurrences(dip, "2026-08-05");
  const w2 = calendarOccurrences(dip, "2026-08-12");
  assert.equal(w1.length + w2.length, 1);
  // In December (rains): every Wednesday fires
  assert.equal(calendarOccurrences(dip, "2026-12-02").length, 1);
  assert.equal(calendarOccurrences(dip, "2026-12-09").length, 1);
});

test("S2 floating: releases from last close plus interval", () => {
  const floating = { type: "calendar", freq: "weekly", byday: ["MO"], at: ["08:00"], fixed: false, interval_days: 7 };
  assert.equal(calendarOccurrences(floating, "2026-08-10", { lastClosedDate: "2026-08-05" }).length, 0);
  assert.equal(calendarOccurrences(floating, "2026-08-12", { lastClosedDate: "2026-08-05" }).length, 1);
});

// ── Release engine (spec 3.6) ────────────────────────────────────────────────
test("release: idempotent, ordered by priority, W-01 twice daily", async () => {
  const r1 = await tx((c) => runRelease(c, TODAY));
  const r2 = await tx((c) => runRelease(c, TODAY));
  assert.equal(r1.planIds.length, r2.planIds.length, "second run creates nothing new");

  const w01 = await instancesByCode("W-01");
  assert.equal(w01.length, 2, "W-01 releases 06:00 and 17:00");
  assert.ok(w01.every((i) => i.state === "released"));

  const plan = (await q(`SELECT * FROM daily_plans WHERE plan_date = $1`, [TODAY])).rows[0];
  assert.ok(plan.instance_ids.length >= 10, `plan has ${plan.instance_ids.length} instances`);
  // No maize is grown (land use Oct 2026): the maize FAW scout is switched off.
  assert.equal((await instancesByCode("C-04")).length, 0);
});

test("release: irrigation planner emits W-03 shifts from real stand", async () => {
  await tx((c) => runRelease(c, TODAY));
  const shifts = await instancesByCode("W-03");
  assert.equal(shifts.length, 2, "kale block + tomato/onion block");
  const kale = shifts.find((s) => s.params.block === "BLK-A");
  // 10,000 plants at 1.2 L/plant = 12,000 L; 36 min at 2 L/h emitters (spec 3.5)
  assert.equal(kale.params.litres, 12000);
  assert.equal(kale.params.minutes, 36);
  assert.ok(shifts.every((s) => s.expires_at), "shifts carry expiry (R5)");
});

// ── Fast path: done -> auto_verified for E1-only task ────────────────────────
test("fold: W-02 done_reported with fields auto-verifies (sampled_none) and accumulates meter", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [w02] = await instancesByCode("W-02");
  const r = await appendEvent(w02.id, "done_reported", {
    fields: { start_time: "06:10", stop_time: "12:20", run_hours: 6.2 },
  });
  assert.equal(r.status, "accepted");
  const after = await getInstance(w02.id);
  assert.equal(after.state, "verified_closed");
  assert.equal(after.verification.method, "sampled_none");
  const acc = (await q(`SELECT * FROM meter_accumulators WHERE meter = 'pump_run_hours'`)).rows[0];
  assert.equal(Number(acc.total), 6.2);
  const reading = (await q(`SELECT * FROM readings WHERE metric = 'pump_hours'`)).rows;
  assert.equal(reading.length, 1);
});

test("fold: duplicate event_uuid is a duplicate, not an error", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [w02] = await instancesByCode("W-02");
  const uuid = "11111111-1111-4111-8111-111111111111";
  const r1 = await appendEvent(w02.id, "done_reported", { fields: { start_time: "a", stop_time: "b", run_hours: 1 } }, { event_uuid: uuid });
  const r2 = await appendEvent(w02.id, "done_reported", { fields: { start_time: "a", stop_time: "b", run_hours: 1 } }, { event_uuid: uuid });
  assert.equal(r1.status, "accepted");
  assert.equal(r2.status, "duplicate");
});

test("fold: evidence-short done routes to needs_review, owner verifies", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [w01] = (await instancesByCode("W-01"));
  // W-01 needs level_pct + photo; report done with nothing
  await appendEvent(w01.id, "done_reported", { fields: {} });
  let after = await getInstance(w01.id);
  assert.equal(after.state, "needs_review");
  const ownerUser = (await q(`SELECT * FROM users WHERE role = 'owner'`)).rows[0];
  await appendEvent(w01.id, "verified_closed", { verification: { method: "owner", verdict: "pass" } },
    { actor_type: "owner", actor: ownerUser });
  after = await getInstance(w01.id);
  assert.equal(after.state, "verified_closed");
});

test("fold: photo evidence waits for acceptance, then an owner accepts W-01", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [w01] = await instancesByCode("W-01");
  const mediaUuid = "22222222-2222-4222-8222-222222222222";
  await q(
    `INSERT INTO media_objects (media_uuid, instance_id, kind, status, storage_key, bytes)
     VALUES ($1,$2,'photo','stored','missing.jpg', 150000)`, [mediaUuid, w01.id]);
  await appendEvent(w01.id, "field_recorded", { fields: { level_pct: 62, pool_pct: 70 } });
  await appendEvent(w01.id, "media_attached", { media_uuid: mediaUuid, kind: "photo" });
  await appendEvent(w01.id, "done_reported", {});
  let after = await getInstance(w01.id);
  assert.equal(after.state, "needs_review", "photos are not machine-checked; waits for a person");
  const flags = (await q(`SELECT payload FROM task_events WHERE instance_id = $1 AND type = 'review_required'`, [w01.id])).rows[0].payload.flags;
  assert.deepEqual(flags, [{ kind: "awaiting_acceptance", media: 1 }]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM vim_jobs WHERE instance_id = $1`, [w01.id])).rows[0].n, 0);
  const ownerUser = (await q(`SELECT * FROM users WHERE role = 'owner'`)).rows[0];
  await appendEvent(w01.id, "verified_closed", { verification: { method: "accepted" } }, { actor_type: "owner", actor: ownerUser });
  after = await getInstance(w01.id);
  assert.equal(after.state, "verified_closed");
  // Readings projected
  const tank = (await q(`SELECT value FROM readings WHERE metric = 'tank_level_pct'`)).rows;
  assert.equal(Number(tank[0].value), 62);
});

test("skip flow: skip_pending then owner approves", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [k01] = await instancesByCode("K-01");
  await appendEvent(k01.id, "skip_requested", { reason_code: "rain", note: "kraal flooded" });
  assert.equal((await getInstance(k01.id)).state, "skip_pending");
  const ownerUser = (await q(`SELECT * FROM users WHERE role = 'owner'`)).rows[0];
  await appendEvent(k01.id, "skip_approved", {}, { actor_type: "owner", actor: ownerUser });
  assert.equal((await getInstance(k01.id)).state, "skipped");
});

// ── Rules (spec 3.4) ─────────────────────────────────────────────────────────
test("T1 low water: releases W-E1, suppresses W-03, respects cooldown; T1 stage 2", async () => {
  await tx((c) => runRelease(c, TODAY));
  // Tank at 20%, pool at 10% -> stored = 0.2*80000 + 0.1*45000 = 20500 / 125000 = 16.4%
  await q(`INSERT INTO readings (metric, value, taken_at) VALUES ('tank_level_pct', 20, now()), ('pool_level_pct', 10, now())`);
  const firings = await tx((c) => evaluateRules(c));
  const t1 = firings.find((f) => f.rule === "T1 Low water");
  assert.ok(t1, "T1 fired");
  assert.equal((await instancesByCode("W-E1")).length, 1);
  // W-03 suppressed (expired)
  const w03 = await instancesByCode("W-03");
  assert.ok(w03.every((s) => s.state === "expired"), "irrigation shifts suppressed");
  // Cooldown: second evaluation does not double-release
  await tx((c) => evaluateRules(c));
  assert.equal((await instancesByCode("W-E1")).length, 1);
  // Stage 2: below 15%
  await q(`INSERT INTO readings (metric, value, taken_at) VALUES ('tank_level_pct', 10, now()), ('pool_level_pct', 5, now())`);
  const f2 = await tx((c) => evaluateRules(c));
  assert.ok(f2.some((f) => f.stage === 2), "two-stage escalation fired");
});

test("T3 FAW: scout above whorl threshold releases C-E1 spray", async () => {
  // The rule stays ready for when maize is planted again and C-04 switched on.
  await q(`UPDATE task_templates SET active = true WHERE code = 'C-04'`);
  await tx((c) => runRelease(c, TODAY));
  await q(`UPDATE task_templates SET active = false WHERE code = 'C-04'`);
  const [c04] = await instancesByCode("C-04");
  await appendEvent(c04.id, "done_reported", {
    fields: { plants_inspected: 100, fresh_damage_plants: 25, crop_stage: "whorl" },
  });
  const firings = await tx((c) => evaluateRules(c));
  assert.ok(firings.some((f) => f.rule === "T3 Fall armyworm action threshold"));
  const ce1 = await instancesByCode("C-E1");
  assert.equal(ce1.length, 1);
  assert.equal(ce1[0].state, "released");
});

test("T4 mortality: 2 deaths in a 150-bird batch exceeds 1% and releases P-E2", async () => {
  // Place a batch via P-08 anchor
  await tx((c) => runRelease(c, TODAY));
  const p08tpl = (await q(`SELECT * FROM task_templates WHERE code = 'P-08'`)).rows[0];
  const caretakerUser = (await q(`SELECT * FROM users WHERE role = 'caretaker'`)).rows[0];
  const inst = await q(
    `INSERT INTO task_instances (template_id, template_code, template_version, period_key, subject_type, assignee_id, title, priority, est_minutes, state, release_at, due_at, grace_until)
     VALUES ($1,'P-08',1,'manual','batch',$2,'Chick placement','P1',2,'released', now(), now() + interval '4 hours', now() + interval '7 hours') RETURNING id`,
    [p08tpl.id, caretakerUser.id]);
  await appendEvent(inst.rows[0].id, "done_reported", { fields: { count_placed: 150, source: "Hatchery", house: "HOUSE-2" } });
  const batch = (await q(`SELECT * FROM batches`)).rows[0];
  assert.ok(batch, "batch created by anchor");
  assert.equal(batch.current_count, 150);
  // Chain instantiated: vaccinations at D7..D119 plus weekly weights
  const chain = (await q(`SELECT * FROM task_instances WHERE subject_id = $1 AND template_code = 'P-E1'`, [batch.id])).rows;
  assert.equal(chain.length, 6, "six vaccination steps");
  // Mortality reading: 2 deaths today (1.33% > 1%)
  await q(`INSERT INTO readings (metric, value, subject_id, taken_at) VALUES ('mortality', 2, $1, now())`, [batch.id]);
  const firings = await tx((c) => evaluateRules(c));
  assert.ok(firings.some((f) => f.rule === "T4 Poultry mortality"));
  assert.equal((await instancesByCode("P-E2")).length, 1);
});

test("T8 reorder: consuming stock below reorder point releases owner F-E1", async () => {
  await q(`UPDATE inventory_items SET on_hand = 5 WHERE name = 'Layers mash'`);
  const firings = await tx((c) => evaluateRules(c));
  assert.ok(firings.some((f) => f.rule === "T8 Input reorder"));
  const fe1 = await instancesByCode("F-E1");
  assert.equal(fe1.length, 1);
  const ownerUser = (await q(`SELECT id FROM users WHERE role = 'owner'`)).rows[0];
  assert.equal(fe1[0].assignee_id, ownerUser.id, "purchase task assigned to owner");
});

// ── Guards (spec 3.4) ────────────────────────────────────────────────────────
test("guard: spray consumes inventory and PHI window blocks harvest release", async () => {
  await tx((c) => runRelease(c, TODAY));
  // Force-release C-E1 and complete it with a PHI product
  const { rows: [tpl] } = await q(`SELECT * FROM task_templates WHERE code = 'C-E1'`);
  const caretakerUser = (await q(`SELECT * FROM users WHERE role = 'caretaker'`)).rows[0];
  const blkC = (await q(`SELECT id FROM locations WHERE code = 'BLK-C'`)).rows[0];
  const inst = await q(
    `INSERT INTO task_instances (template_id, template_code, template_version, period_key, subject_type, subject_id, assignee_id, title, priority, est_minutes, state, release_at, due_at, grace_until)
     VALUES ($1,'C-E1',1,'manual','location',$2,$3,'FAW spray','P1',1,'released', now(), now() + interval '4 hours', now() + interval '7 hours') RETURNING id`,
    [tpl.id, blkC.id, caretakerUser.id]);
  const before = Number((await q(`SELECT on_hand FROM inventory_items WHERE name = 'Emamectin benzoate'`)).rows[0].on_hand);
  await appendEvent(inst.rows[0].id, "done_reported", {
    fields: { product: "Emamectin benzoate", batch_number: "EB-1", rate: 0.5, block: "BLK-C" },
  });
  const after = Number((await q(`SELECT on_hand FROM inventory_items WHERE name = 'Emamectin benzoate'`)).rows[0].on_hand);
  assert.equal(before - after, 0.5, "inventory decremented");
  const windows = (await q(`SELECT value FROM farm_settings WHERE key = 'active_windows'`)).rows[0].value;
  assert.ok(windows.some((w) => w.type === "phi" && w.subject_id === blkC.id), "PHI window recorded");

  // C-11 harvest release on BLK-C is now guard-blocked
  const { evaluateGuards } = await import("../src/engine/guards.js");
  const c11 = (await q(`SELECT * FROM task_templates WHERE code = 'C-11'`)).rows[0];
  const blocks = await tx((c) => evaluateGuards(c, c11, { subjectId: blkC.id }));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].guard, "phi");
});

// ── Escalation (spec 4.2) ────────────────────────────────────────────────────
test("escalation: P1 overdue nudges then missed at grace end, rolls next day", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [k01] = await instancesByCode("K-01"); // due 07:00, grace 20:00
  // At 10:00: overdue1 (+2h) fired, collapsed WhatsApp
  let fired = await tx((c) => runEscalationSweep(c, { now: farmTime(TODAY, "10:00") }));
  assert.ok(fired.some((f) => f.id === k01.id && f.rung === "overdue1"));
  // At 14:00: overdue2 to owner
  fired = await tx((c) => runEscalationSweep(c, { now: farmTime(TODAY, "14:00") }));
  assert.ok(fired.some((f) => f.id === k01.id && f.rung === "overdue2"));
  // Same sweep again: no double-fire
  fired = await tx((c) => runEscalationSweep(c, { now: farmTime(TODAY, "14:05") }));
  assert.ok(!fired.some((f) => f.id === k01.id && f.rung === "overdue2"));
  // At 20:01: missed
  fired = await tx((c) => runEscalationSweep(c, { now: farmTime(TODAY, "20:01") }));
  assert.ok(fired.some((f) => f.id === k01.id && f.missed));
  let inst = await getInstance(k01.id);
  assert.equal(inst.state, "missed");
  assert.equal(inst.missed_count, 1);
  // Next day's release rolls it: badge yesterday, back to released
  const tomorrow = addDays(TODAY, 1);
  await tx((c) => runRelease(c, tomorrow));
  inst = await getInstance(k01.id);
  assert.equal(inst.state, "released");
  const rolledEvent = (await q(
    `SELECT * FROM task_events WHERE instance_id = $1 AND type = 'rolled'`, [k01.id])).rows;
  assert.equal(rolledEvent.length, 1);
});

test("escalation: rain-suppressed shift expires instead of escalating", async () => {
  await tx((c) => runRelease(c, TODAY));
  const shifts = await instancesByCode("W-03");
  const fired = await tx((c) => runEscalationSweep(c, { now: farmTime(TODAY, "21:30") }));
  for (const s of shifts) {
    assert.equal((await getInstance(s.id)).state, "expired", "shift expired at 21:00 expiry");
  }
});

// ── Digest and KPIs ──────────────────────────────────────────────────────────
test("digest: exceptions-first summary computes", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [w02] = await instancesByCode("W-02");
  await appendEvent(w02.id, "done_reported", { fields: { start_time: "06:00", stop_time: "10:00", run_hours: 4 } });
  const digest = await tx((c) => buildDigest(c, TODAY));
  assert.ok(digest.completion.total > 0);
  assert.equal(digest.completion.verified, 1);
  assert.ok(Array.isArray(digest.exceptions));
  const kpis = await tx((c) => computeKpis(c, { days: 7 }));
  assert.ok(kpis.overall_completion_pct !== undefined);
});

// ── Rebuild (spec 6.1) ───────────────────────────────────────────────────────
test("rebuild_projections: replaying the log reproduces state", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [w02] = await instancesByCode("W-02");
  await appendEvent(w02.id, "done_reported", { fields: { start_time: "06:10", stop_time: "12:20", run_hours: 6.2 } });
  const beforeState = (await getInstance(w02.id)).state;
  const beforeReadings = (await q(`SELECT count(*) FROM readings WHERE source_event_uuid IS NOT NULL`)).rows[0].count;
  await tx((c) => rebuildProjections(c));
  assert.equal((await getInstance(w02.id)).state, beforeState);
  const afterReadings = (await q(`SELECT count(*) FROM readings WHERE source_event_uuid IS NOT NULL`)).rows[0].count;
  assert.equal(afterReadings, beforeReadings);
});

test("append-only: task_events rejects UPDATE and DELETE", async () => {
  await tx((c) => runRelease(c, TODAY));
  await assert.rejects(q(`UPDATE task_events SET type = 'seen'`), /append-only/);
  await assert.rejects(q(`DELETE FROM task_events`), /append-only/);
});

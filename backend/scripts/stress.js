// Stress test: drives the system at hostile scale and reports timings.
//   1. 90 days of releases (plans, chains, escalation sweeps)
//   2. 10,000 caretaker events through the sync fold
//   3. Sync API round-trip latency under batch load
//   4. Rule evaluation over a large readings table
//   5. Digest + KPI queries at volume
//   6. Full rebuild_projections replay
// Run: node scripts/stress.js   (uses the dev database; destructive)
import { randomUUID } from "node:crypto";
import { pool, tx, q } from "../src/db/pool.js";
import { runRelease } from "../src/engine/release.js";
import { runEscalationSweep } from "../src/engine/escalation.js";
import { evaluateRules } from "../src/engine/rules.js";
import { foldEvent, rebuildProjections } from "../src/engine/fold.js";
import { buildDigest } from "../src/engine/digest.js";
import { computeKpis } from "../src/engine/kpis.js";
import { addDays, farmTime } from "../src/util/time.js";

const t0 = (label) => ({ label, start: process.hrtime.bigint() });
const done = (t, extra = "") => {
  const ms = Number(process.hrtime.bigint() - t.start) / 1e6;
  console.log(`${t.label.padEnd(46)} ${ms.toFixed(0).padStart(8)} ms ${extra}`);
  return ms;
};

const START = "2026-05-01";
const DAYS = 90;

async function reset() {
  await q(`ALTER TABLE task_events DISABLE TRIGGER task_events_no_update`);
  await q(`TRUNCATE task_events, task_instances, readings, daily_plans, media_objects,
           vim_jobs, vim_verdicts, notifications_log, wa_messages, inventory_moves, batches CASCADE`);
  await q(`ALTER TABLE task_events ENABLE TRIGGER task_events_no_update`);
  await q(`UPDATE rules SET last_fired_at = NULL, stage2_fired_at = NULL`);
  await q(`DELETE FROM farm_settings WHERE key IN ('suppressions','active_windows','forecast')`);
  await q(`DELETE FROM meter_accumulators`);
}

async function main() {
  await reset();
  const caretaker = (await q(`SELECT id FROM users WHERE role = 'caretaker' LIMIT 1`)).rows[0];

  // ── 1. 90 days of release + escalation ────────────────────────────────────
  let t = t0(`release engine x ${DAYS} days`);
  let totalReleased = 0;
  for (let i = 0; i < DAYS; i++) {
    const d = addDays(START, i);
    const r = await tx((c) => runRelease(c, d));
    totalReleased += r.planIds.length;
    await tx((c) => runEscalationSweep(c, { now: farmTime(d, "21:00") }));
  }
  const relMs = done(t, `(${totalReleased} instances, ${(totalReleased / DAYS).toFixed(1)}/day)`);

  // ── 2. 10,000 events through the fold ─────────────────────────────────────
  const { rows: open } = await q(
    `SELECT id, template_code FROM task_instances WHERE state = 'released' LIMIT 400`);
  t = t0(`fold x 10,000 events`);
  let folded = 0;
  for (let round = 0; round < 25 && folded < 10_000; round++) {
    for (const inst of open) {
      if (folded >= 10_000) break;
      await tx((c) => foldEvent(c, {
        event_uuid: randomUUID(), instance_id: inst.id, actor_type: "caretaker",
        actor_id: caretaker.id, type: "field_recorded",
        payload: { fields: { level_pct: 50 + (folded % 40), pool_pct: 60, run_hours: 1, bundle_count: 45 + (folded % 20), rain_mm: folded % 7 === 0 ? 4 : 0 } },
        device_time: new Date(),
      }));
      folded++;
    }
  }
  const foldMs = done(t, `(${(folded / ((Number(process.hrtime.bigint() - t.start) / 1e9))).toFixed(0)} events/s)`);

  // ── 3. Sync API latency under batch load ──────────────────────────────────
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "caretaker@woodlands.farm", password: "woodlands" }),
  }).then((r) => r.json());
  t = t0(`sync API x 20 batches of 100 events`);
  const latencies = [];
  for (let b = 0; b < 20; b++) {
    const events = open.slice(0, 100).map((inst) => ({
      event_uuid: randomUUID(), instance_id: inst.id, type: "field_recorded",
      payload: { fields: { level_pct: 42 } }, device_time: new Date().toISOString(),
    }));
    const s = process.hrtime.bigint();
    const resp = await fetch(`${base}/api/sync/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
      body: JSON.stringify({ events }),
    });
    await resp.json();
    latencies.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  latencies.sort((a, b) => a - b);
  done(t, `(p50 ${latencies[10].toFixed(0)}ms, p95 ${latencies[18].toFixed(0)}ms per 100-event batch)`);

  t = t0(`bundle fetch x 10`);
  for (let i = 0; i < 10; i++) {
    await fetch(`${base}/api/sync/bundle`, { headers: { Authorization: `Bearer ${login.token}` } }).then((r) => r.json());
  }
  done(t);
  server.close();

  // ── 4. Rule evaluation over large readings table ──────────────────────────
  const readingCount = (await q(`SELECT count(*) FROM readings`)).rows[0].count;
  t = t0(`rule evaluation x 50 sweeps (${readingCount} readings)`);
  for (let i = 0; i < 50; i++) await tx((c) => evaluateRules(c));
  done(t);

  // ── 5. Digest + KPIs at volume ────────────────────────────────────────────
  t = t0(`digest x 20`);
  for (let i = 0; i < 20; i++) await tx((c) => buildDigest(c, addDays(START, DAYS - 1)));
  done(t);
  t = t0(`KPIs (90-day window) x 20`);
  for (let i = 0; i < 20; i++) await tx((c) => computeKpis(c, { days: 90 }));
  done(t);

  // ── 6. Full replay ────────────────────────────────────────────────────────
  const eventCount = (await q(`SELECT count(*) FROM task_events`)).rows[0].count;
  t = t0(`rebuild_projections (${eventCount} events)`);
  const replayed = await tx((c) => rebuildProjections(c));
  done(t, `(${replayed} events)`);

  console.log("\nrow counts:",
    JSON.stringify(Object.fromEntries(await Promise.all(
      ["task_instances", "task_events", "readings", "notifications_log"].map(async (tbl) =>
        [tbl, Number((await q(`SELECT count(*) FROM ${tbl}`)).rows[0].count)])))));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

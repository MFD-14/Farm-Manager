// Features adopted from the top farm platforms' nuances:
//   Agworld  — weather stamped onto chemical applications at completion (R27)
//   Herdwatch — active withholding windows as a first-class derived list (R18/R26)
//   AgriWebb — last recorded values pushed to capture screens
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepareDb, resetDynamic, appendEvent, tx, q } from "./helpers.js";
import { runRelease } from "../src/engine/release.js";
import { rebuildProjections } from "../src/engine/fold.js";
import { buildDigest } from "../src/engine/digest.js";
import { createApp } from "../src/app.js";
import { farmDateStr, addDays } from "../src/util/time.js";

const TODAY = farmDateStr();
let server, base, careToken;

async function makeSprayInstance() {
  const tpl = (await q(`SELECT * FROM task_templates WHERE code = 'C-E1'`)).rows[0];
  const care = (await q(`SELECT id FROM users WHERE role = 'caretaker'`)).rows[0];
  const blk = (await q(`SELECT id FROM locations WHERE code = 'BLK-C'`)).rows[0];
  const r = await q(
    `INSERT INTO task_instances (template_id, template_code, template_version, period_key, subject_type,
       subject_id, assignee_id, title, priority, est_minutes, state, release_at, due_at, grace_until)
     VALUES ($1,'C-E1',1,$2,'location',$3,$4,'FAW spray','P1',1,'scheduled', now(), now() + interval '4 hours', now() + interval '7 hours')
     RETURNING id`, [tpl.id, `stress-${randomUUID().slice(0, 8)}`, blk.id, care.id]);
  // Release through the log so replay reproduces the full lifecycle.
  await appendEvent(r.rows[0].id, "released", {}, { actor_type: "system" });
  return r.rows[0].id;
}

before(async () => {
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "caretaker@woodlands.farm", password: "woodlands" }),
  }).then((r) => r.json());
  careToken = login.token;
});
beforeEach(async () => { await resetDynamic(); await q(`DELETE FROM farm_settings WHERE key = 'forecast'`); });
after(() => server?.close());

test("Agworld: spray completion stamps weather into the immutable event and survives replay", async () => {
  await q(
    `INSERT INTO farm_settings (key, value) VALUES ('forecast', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ provider: "open-meteo", fetched_at: new Date().toISOString(),
      daily: [{ date: TODAY, rain_mm: 3, prob_pct: 40, tmax: 29, tmin: 14, et0_mm: 4.4 }] })]);
  await q(`INSERT INTO readings (metric, value, taken_at) VALUES ('rain_mm', 2, now() - interval '3 hours')`);

  const id = await makeSprayInstance();
  await appendEvent(id, "done_reported", {
    fields: { product: "Chlorantraniliprole", batch_number: "CT-9", rate: 0.3, block: "BLK-C" },
  });

  const ev = (await q(
    `SELECT payload FROM task_events WHERE instance_id = $1 AND type = 'done_reported'`, [id])).rows[0];
  const w = ev.payload.weather_at_application;
  assert.ok(w, "weather stamped into the event payload");
  assert.equal(w.tmax, 29);
  assert.equal(w.rain_observed_24h_mm, 2);
  const inst = (await q(`SELECT evidence_summary FROM task_instances WHERE id = $1`, [id])).rows[0];
  assert.equal(inst.evidence_summary.weather.tmax, 29, "surfaced in the evidence summary");

  // Replay: the stamp lives in the log, so rebuild reproduces it identically.
  await tx((c) => rebuildProjections(c));
  const after2 = (await q(`SELECT evidence_summary FROM task_instances WHERE id = $1`, [id])).rows[0];
  assert.equal(after2.evidence_summary.weather.tmax, 29);
});

test("Herdwatch: active PHI window appears in digest and sync bundle with countdown", async () => {
  const id = await makeSprayInstance();
  await appendEvent(id, "done_reported", {
    fields: { product: "Emamectin benzoate", batch_number: "EB-2", rate: 0.5, block: "BLK-C" },
  });
  const digest = await tx((c) => buildDigest(c, TODAY));
  assert.equal(digest.withholdings.length, 1);
  assert.equal(digest.withholdings[0].type, "phi");
  assert.ok(digest.withholdings[0].days_remaining >= 6, "7-day PHI counts down");

  const bundle = await fetch(`${base}/api/sync/bundle`, {
    headers: { Authorization: `Bearer ${careToken}` } }).then((r) => r.json());
  assert.equal(bundle.active_windows.length, 1);
  const blkC = (await q(`SELECT name FROM locations WHERE code = 'BLK-C'`)).rows[0];
  assert.equal(bundle.active_windows[0].subject_name, blkC.name);
});

test("AgriWebb: bundle carries last recorded values per template", async () => {
  await tx((c) => runRelease(c, TODAY));
  const w02 = (await q(`SELECT id FROM task_instances WHERE template_code = 'W-02' LIMIT 1`)).rows[0];
  await appendEvent(w02.id, "done_reported", { fields: { start_time: "06:10", stop_time: "11:40", run_hours: 5.5 } });
  const bundle = await fetch(`${base}/api/sync/bundle`, {
    headers: { Authorization: `Bearer ${careToken}` } }).then((r) => r.json());
  assert.equal(bundle.last_values["W-02"].fields.run_hours, 5.5);
  assert.ok(bundle.last_values["W-02"].at, "timestamped");
});

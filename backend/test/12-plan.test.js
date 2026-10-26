import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prepareDb, resetDynamic, tx, q, instancesByCode, getInstance, appendEvent } from "./helpers.js";
import { createApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import { releasePlannedTasks, rotationHint, planStatus } from "../src/engine/plans.js";
import { releaseTemplateNow } from "../src/engine/rules.js";

let server, base, owner, care;
const api = async (path, { method = "GET", token, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const login = async (email, password) => (await api("/api/auth/login", { method: "POST", body: { email, password } })).json.token;

before(async () => {
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  owner = await login("owner@woodlands.farm", "woodlands");
  care = await login("caretaker@woodlands.farm", "woodlands");
});
after(() => server?.close());
beforeEach(async () => { await resetDynamic(); await seed({ withUsers: false }); });

test("fall armyworm: the next spray is told the last group, and repeating it is flagged", async () => {
  const hint = await tx((c) => rotationHint(c));
  assert.equal(hint.last_product, "Emamectin benzoate", "from the farm's spray history");
  assert.equal(hint.last_irac_group, "6");
  assert.ok(hint.use_instead.every((o) => o.irac_group !== "6"));

  const id = await tx((c) => releaseTemplateNow(c, "C-E1", {}));
  const inst = await getInstance(id);
  assert.equal(inst.params.rotation.last_irac_group, "6", "carried on the task for the phone");

  // Same group again: done, but flagged for the owner.
  await appendEvent(id, "done_reported", { fields: { product: "Emamectin benzoate", batch_number: "EB-3", rate: 0.5, block: "BLK-C" } });
  const flags = (await q(`SELECT payload FROM task_events WHERE instance_id = $1 AND type = 'review_required'`, [id])).rows
    .flatMap((r) => r.payload.flags);
  assert.ok(flags.some((f) => f.kind === "rotation_breach" && f.irac_group === "6"));

  // A rotated product is not flagged, and becomes the new "last".
  const id2 = await tx((c) => releaseTemplateNow(c, "C-E1", {}));
  await appendEvent(id2, "done_reported", { fields: { product: "Chlorantraniliprole", batch_number: "CT-1", rate: 0.3, block: "BLK-C" } });
  const flags2 = (await q(`SELECT payload FROM task_events WHERE instance_id = $1 AND type = 'review_required'`, [id2])).rows
    .flatMap((r) => r.payload.flags);
  assert.ok(!flags2.some((f) => f.kind === "rotation_breach"));
  assert.equal((await tx((c) => rotationHint(c))).last_irac_group, "28");
});

test("poultry plan: chicks ordered three weeks ahead, placement released on the day, each once", async () => {
  const order = await tx((c) => releasePlannedTasks(c, "2026-10-14"));
  assert.deepEqual(order.map((r) => r.step), ["order"]);
  const p09 = await instancesByCode("P-09");
  assert.equal(p09.length, 1);
  assert.match(p09[0].title, /Order 150 day-old Black Australorp chicks \(batch 1 of 6, placing 2026-11-03\)/);
  assert.deepEqual(await tx((c) => releasePlannedTasks(c, "2026-10-20")), [], "not twice");

  const place = await tx((c) => releasePlannedTasks(c, "2026-11-03"));
  assert.deepEqual(place.map((r) => r.step), ["place"]);
  const [p08] = await instancesByCode("P-08");
  assert.equal(p08.params.purpose, "layers");

  // Reporting the placement creates the batch as layers, with its label.
  await appendEvent(p08.id, "done_reported", { fields: { count_placed: 148, source: "Hatchery", house: "HOUSE-2" } });
  const batch = (await q(`SELECT * FROM batches WHERE placed_count = 148`)).rows[0];
  assert.equal(batch.purpose, "layers");
  assert.match(batch.name, /Black Australorp layers \(batch 1 of 6/);
});

test("Phase 0: measuring the usable tank volume replaces the estimate and completes the milestone", async () => {
  let plan = await tx((c) => planStatus(c, { today: "2026-10-26" }));
  const phase0 = () => plan.milestones.find((m) => m.key === "phase0_tank");
  assert.notEqual(phase0().status, "done");
  assert.equal(plan.projects.phase0_tank.length, 4);

  const id = await tx((c) => releaseTemplateNow(c, "A-P4", {}));
  await appendEvent(id, "field_recorded", { fields: { usable_litres: 96500, method: "metered fill" } });
  const wp = (await q(`SELECT value FROM farm_settings WHERE key = 'water_params'`)).rows[0].value;
  assert.equal(Number(wp.tank_usable), 96500);
  assert.equal(wp.tank_usable_measured, true);

  plan = await tx((c) => planStatus(c, { today: "2026-10-26" }));
  assert.equal(phase0().status, "done");
  assert.match(phase0().detail, /96,500 L/);
  // A restart's seed keeps the measured figure.
  await seed({ withUsers: false });
  assert.equal(Number((await q(`SELECT value FROM farm_settings WHERE key = 'water_params'`)).rows[0].value.tank_usable), 96500);
});

test("plan API: progress from farm data, manual marks, releasing a project step; caretakers can't", async () => {
  await q(`INSERT INTO readings (metric, value, taken_at) VALUES ('bundle_count', 50, now()), ('bundle_count', 66, now() - interval '1 day')`);
  const r = await api("/api/owner/plan", { token: owner });
  assert.equal(r.status, 200);
  const kale = r.json.milestones.find((m) => m.key === "kale_10k");
  assert.match(kale.detail, /58 bundles a day/);
  assert.equal(Math.round(kale.progress * 100), Math.round((58 / 330) * 100));
  assert.equal(r.json.poultry.target_layers, 1000);
  assert.equal(r.json.kale.price_usd_per_bundle, 1);

  const marked = await api("/api/owner/plan/reticulation", { method: "POST", token: owner, body: { status: "blocked", note: "pipe on order" } });
  assert.equal(marked.json.milestones.find((m) => m.key === "reticulation").status, "blocked");

  const rel = await api("/api/owner/release-task", { method: "POST", token: owner, body: { template_code: "A-P5" } });
  assert.equal(rel.status, 201);
  assert.equal((await getInstance(rel.json.id)).template_code, "A-P5");
  assert.equal((await api("/api/owner/release-task", { method: "POST", token: owner, body: { template_code: "W-01" } })).status, 400,
    "scheduled tasks can't be released by hand");

  assert.equal((await api("/api/owner/plan", { token: care })).status, 403);
});

test("KPIs report acceptance instead of machine checks", async () => {
  const k = await api("/api/owner/kpis?period=7", { token: owner });
  assert.equal(k.status, 200);
  assert.ok("accepted_first_time_pct" in k.json && "median_hours_to_accept" in k.json && "waiting_for_acceptance" in k.json);
  assert.ok(!("auto_verification_pct" in k.json) && !("vim_agreement_pct" in k.json));
  assert.equal(k.json.kale_target_bundles_per_day, 330);
});

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prepareDb, resetDynamic, tx, q, instancesByCode } from "./helpers.js";
import { computeLedger, waterBalancePlan, getWbConfig } from "../src/engine/waterBalance.js";
import { runRelease } from "../src/engine/release.js";
import { farmDateStr } from "../src/util/time.js";

const TODAY = farmDateStr();

async function setWbEnabled(enabled) {
  await q(
    `UPDATE farm_settings SET value = jsonb_set(value, '{enabled}', $1::jsonb) WHERE key = 'water_balance'`,
    [JSON.stringify(enabled)]);
}

const insertReading = (metric, value, daysAgo, subjectId = null) =>
  q(`INSERT INTO readings (metric, value, taken_at, subject_id)
     VALUES ($1, $2, now() - ($3 || ' days')::interval, $4)`,
    [metric, value, daysAgo, subjectId]);

before(async () => { await prepareDb(); });
beforeEach(async () => {
  await resetDynamic();
  await setWbEnabled(false);
});

test("ledger: deficit accumulates ETc, rain resets it, clamps at TAW", async () => {
  // Big rain 10 days ago zeroes the ledger; then nine days of ET0 5.0 mm.
  await insertReading("rain_mm", 100, 10);
  for (let i = 9; i >= 1; i--) await insertReading("et0_mm", 5.0, i);
  const ledger = await tx((c) => computeLedger(c, "BLK-A", TODAY));
  assert.equal(ledger.deficit_mm, 45, "9 days x Kc 1.0 x 5.0 mm after the rain reset");
  const rainRow = ledger.rows.find((r) => r.rain_mm === 100);
  assert.equal(rainRow.deficit_mm, 0, "heavy rain clamps deficit to zero");
  assert.equal(ledger.mad_mm, 27, "MAD = 0.45 x 60");
  // Every row before the injected readings ran on climate normals, flagged as such
  assert.ok(ledger.rows.some((r) => r.et0_source === "normal"));
  assert.ok(ledger.rows.slice(-3).every((r) => r.et0_source === "reading"));
});

test("ledger: applied irrigation credits the block in mm", async () => {
  await insertReading("rain_mm", 100, 6);
  for (let i = 5; i >= 1; i--) await insertReading("et0_mm", 6.0, i);
  const blk = (await q(`SELECT id FROM locations WHERE code = 'BLK-A'`)).rows[0];
  // 13,500 L on 2,700 m2 = 5 mm applied three days ago
  await insertReading("irrigation_litres", 13500, 3, blk.id);
  const ledger = await tx((c) => computeLedger(c, "BLK-A", TODAY));
  assert.equal(ledger.deficit_mm, 25, "5x6 ETc minus 5 mm irrigation");
});

test("planner: below MAD emits no shift, above MAD emits capped refill shift", async () => {
  await setWbEnabled(true);
  // Fresh rain yesterday: projected deficit today ~ Kc x ET0 only -> no shifts.
  await insertReading("rain_mm", 100, 1);
  await insertReading("et0_mm", 5.0, 0);
  let plan = await tx((c) => waterBalancePlan(c, TODAY));
  assert.equal(plan.length, 0, "wet profile: nothing to replace");

  // Dry out: rain 10 days ago, nine days of ET0 5.0 -> deficit 45, projected 50.
  await q(`DELETE FROM readings`);
  await insertReading("rain_mm", 100, 10);
  for (let i = 9; i >= 1; i--) await insertReading("et0_mm", 5.0, i);
  await insertReading("et0_mm", 5.0, 0);
  plan = await tx((c) => waterBalancePlan(c, TODAY));
  const kale = plan.find((s) => s.block_code === "BLK-A");
  assert.ok(kale, "kale block crosses MAD");
  assert.equal(kale.basis.method, "water_balance");
  assert.equal(kale.basis.deficit_mm, 50);
  // 50mm at 7.4x0.9=6.66mm/h wants 450 min; capped at 180, replacing ~20mm
  assert.equal(kale.minutes, 180);
  assert.ok(Math.abs(kale.basis.replacing_mm - 20) < 0.1);
  assert.equal(kale.litres, Math.round(kale.basis.replacing_mm * 2700));
});

test("release: Phase 2 enabled produces W-03 with water-balance basis; disabled uses tank budget", async () => {
  // Disabled: tank-budget shifts (12,000 L kale from the stand)
  await tx((c) => runRelease(c, TODAY));
  let shifts = await instancesByCode("W-03");
  const kaleP1 = shifts.find((s) => s.params.block === "BLK-A");
  assert.equal(kaleP1.params.litres, 12000);
  assert.equal(kaleP1.params.basis, undefined);

  // Enabled with a dry ledger: new day releases from the checkbook
  await resetDynamic();
  await setWbEnabled(true);
  await insertReading("rain_mm", 100, 10);
  for (let i = 9; i >= 0; i--) await insertReading("et0_mm", 5.0, i);
  await tx((c) => runRelease(c, TODAY));
  shifts = await instancesByCode("W-03");
  const kaleP2 = shifts.find((s) => s.params.block === "BLK-A");
  assert.ok(kaleP2, "water-balance shift released");
  assert.equal(kaleP2.params.basis.method, "water_balance");
  assert.equal(kaleP2.params.minutes, 180);
});

test("owner water endpoint returns ledger, plan and config state", async () => {
  await setWbEnabled(true);
  await insertReading("rain_mm", 100, 10);
  for (let i = 9; i >= 0; i--) await insertReading("et0_mm", 5.0, i);
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  try {
    const login = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@woodlands.farm", password: "woodlands" }),
    }).then((r) => r.json());
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/owner/water`, {
      headers: { Authorization: `Bearer ${login.token}` } }).then((x) => x.json());
    assert.equal(r.enabled, true);
    assert.equal(r.blocks.length, 2);
    const kale = r.blocks.find((b) => b.block === "BLK-A");
    assert.equal(kale.deficit_mm, 45);
    assert.equal(kale.rows.length, 14);
    assert.ok(r.plan.some((s) => s.block_code === "BLK-A"));
  } finally {
    server.close();
  }
});

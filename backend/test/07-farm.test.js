// The app carries the real Woodlands Farm: block layout summing to the title
// area, the actual herds and flocks, and the measured water system.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prepareDb, resetDynamic, tx, q, instancesByCode } from "./helpers.js";
import { seed } from "../src/db/seed.js";
import { runRelease } from "../src/engine/release.js";
import { createApp } from "../src/app.js";

let server, base, token;

before(async () => {
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "caretaker@woodlands.farm", password: "woodlands" }),
  }).then((r) => r.json())).token;
});
// resetDynamic truncates batches, so re-seed to restore the farm's flocks.
beforeEach(async () => { await resetDynamic(); await seed({ withUsers: false }); });
after(() => server?.close());

const farm = () => fetch(`${base}/api/owner/farm`, { headers: { Authorization: `Bearer ${token}` } })
  .then((r) => r.json());

test("land use: 2 ha homestead garden in use, the rest to clear, 5 ha lost to mining", async () => {
  const f = await farm();
  assert.equal(f.farm.total_ha, 119.2);
  assert.equal(f.farm.mapped_ha, 119.2, "every hectare is accounted for");
  assert.deepEqual(f.blocks.map((b) => [b.code, b.hectares, b.status]), [
    ["UNCLEARED", 112.2, "to clear"],
    ["MINING", 5, "lost"],
    ["HOMESTEAD", 2, "active"],
  ]);
  assert.equal(f.farm.cropped_ha, 2, "only the homestead garden is cropped");
});

test("homestead beds feed the irrigation planner; maize and sorghum tasks are on", async () => {
  const irrigated = (await q(`SELECT code FROM locations WHERE kind = 'block' AND irrigated ORDER BY code`)).rows;
  assert.deepEqual(irrigated.map((r) => r.code), ["BLK-A", "BLK-B"], "drip beds; maize and sorghum are rain-fed");
  const maize = (await q(`SELECT name, crop FROM locations WHERE code = 'BLK-C'`)).rows[0];
  assert.match(maize.name, /maize and sorghum/);
  const on = (await q(`SELECT code, active FROM task_templates WHERE code IN ('C-04', 'C-09') ORDER BY code`)).rows;
  assert.deepEqual(on.map((r) => r.active), [true, true]);
  // An owner switching one off survives the next restart's seed.
  await q(`UPDATE task_templates SET active = false WHERE code = 'C-04'`);
  await seed({ withUsers: false });
  assert.equal((await q(`SELECT active FROM task_templates WHERE code = 'C-04'`)).rows[0].active, false);
  await q(`UPDATE task_templates SET active = true WHERE code = 'C-04'`);
});

test("livestock: cattle herd split, goats, pigs and both poultry flocks", async () => {
  const f = await farm();
  assert.deepEqual(f.livestock.totals, { cattle: 30, goats: 35, pigs: 8, poultry: 350 });
  const cattle = f.livestock.herds.find((h) => h.species === "cattle");
  assert.equal(cattle.breed, "Nguni and Sanga");
  assert.match(cattle.notes, /body condition score around 2\.5/);
  const layers = f.livestock.flocks.find((x) => x.purpose === "layers");
  assert.equal(layers.current_count, 250);
  assert.equal(layers.house, "Poultry House A");
});

test("water system: borehole, pool and tank figures with derived autonomy", async () => {
  const f = await farm();
  assert.equal(f.water.borehole_lph, 6000);
  assert.equal(f.water.daily_pump_capacity_l, 36000);
  assert.equal(f.water.pool_volume, 45000);
  assert.deepEqual(f.water.tank_usable_range, [80000, 125000]);
  assert.equal(f.water.tank_usable_measured, false);
  assert.equal(f.water.buffer_l, 125000);
  // Spec 3.5: ~20,500 L/day peak crop demand against 36,000 pumpable, ~40% headroom
  assert.equal(f.water.pumping_headroom_pct, 39);

  await q(`INSERT INTO readings (metric, value, taken_at) VALUES
           ('tank_level_pct', 50, now()), ('pool_level_pct', 100, now())`);
  const g = await farm();
  assert.equal(g.water.stored_l, 85000, "half tank (40,000) + full pool (45,000)");
  assert.equal(g.water.autonomy_days, 3.9, "85,000 L over 22,000 L/day");
});

test("re-seeding never overwrites a measured tank volume", async () => {
  await q(`UPDATE farm_settings SET value = value || '{"tank_usable": 112000, "tank_usable_measured": true}'
           WHERE key = 'water_params'`);
  await seed({ withUsers: false });
  const f = await farm();
  assert.equal(f.water.tank_usable, 112000);
  assert.equal(f.water.tank_usable_measured, true);
});

test("egg collection releases for the laying flock only, not broilers", async () => {
  await tx((c) => runRelease(c, "2026-10-24"));
  const eggs = await instancesByCode("P-04");
  assert.ok(eggs.length >= 1, "layers past point of lay get P-04");
  assert.ok(eggs.every((i) => i.title.includes("Australorp")), "no egg task for the broiler batch");
  // Feed and mortality dailies cover both flocks
  const feed = await instancesByCode("P-01");
  assert.equal(feed.length, 2);
});

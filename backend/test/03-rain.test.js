import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepareDb, resetDynamic, appendEvent, getInstance, instancesByCode, tx, q } from "./helpers.js";
import { createApp } from "../src/app.js";
import { runRelease } from "../src/engine/release.js";
import { evaluateRules } from "../src/engine/rules.js";
import { farmDateStr, farmTime, addDays } from "../src/util/time.js";

const TODAY = "2026-08-03";
let server, base, ownerToken;

before(async () => {
  await prepareDb();
  const app = createApp();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@woodlands.farm", password: "woodlands" }),
  }).then((r) => r.json());
  ownerToken = login.token;
});
beforeEach(async () => { await resetDynamic(); });
after(() => server?.close());

test("W-08 rain gauge releases daily and projects the rain_mm reading", async () => {
  await tx((c) => runRelease(c, TODAY));
  const gauges = await instancesByCode("W-08");
  assert.equal(gauges.length, 1, "one gauge reading per day");
  assert.equal(gauges[0].state, "released");

  await appendEvent(gauges[0].id, "done_reported", { fields: { rain_mm: 22 } });
  const after = await getInstance(gauges[0].id);
  assert.equal(after.state, "verified_closed", "E1-only task closes via sampled_none");
  const readings = (await q(`SELECT * FROM readings WHERE metric = 'rain_mm'`)).rows;
  assert.equal(readings.length, 1);
  assert.equal(Number(readings[0].value), 22);
});

test("zero rainfall is a valid required entry", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [g] = await instancesByCode("W-08");
  await appendEvent(g.id, "done_reported", { fields: { rain_mm: 0 } });
  assert.equal((await getInstance(g.id)).state, "verified_closed");
  const readings = (await q(`SELECT value FROM readings WHERE metric = 'rain_mm'`)).rows;
  assert.equal(Number(readings[0].value), 0);
});

test("gauge reading at 15mm+ fires T2: irrigation suppressed tomorrow, shifts expired", async () => {
  await tx((c) => runRelease(c, TODAY));
  const shiftsBefore = await instancesByCode("W-03");
  assert.ok(shiftsBefore.length >= 2);
  const [g] = await instancesByCode("W-08");
  await appendEvent(g.id, "done_reported", { fields: { rain_mm: 18 } });
  const firings = await tx((c) => evaluateRules(c, { now: farmTime(TODAY, "12:00") }));
  assert.ok(firings.some((f) => f.rule === "T2 Rain suppression"), "T2 fired from the gauge");
  // Released shifts expired with reason rain
  for (const s of shiftsBefore) {
    const after = await getInstance(s.id);
    assert.equal(after.state, "expired");
  }
  // Tomorrow's W-03 suppressed at release
  const tomorrow = addDays(TODAY, 1);
  await tx((c) => runRelease(c, tomorrow));
  const shiftsTomorrow = (await instancesByCode("W-03")).filter((s) => s.period_key.startsWith(tomorrow));
  assert.equal(shiftsTomorrow.length, 0, "no shifts released the day after heavy rain");
  // Field-access check task released instead
  assert.ok((await instancesByCode("W-ACCESS")).length >= 1);
});

test("GET /api/owner/rain returns today, daily series and season accumulation", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [g] = await instancesByCode("W-08");
  await appendEvent(g.id, "done_reported", { fields: { rain_mm: 12.5 } });
  // Backdated series
  await q(`INSERT INTO readings (metric, value, taken_at) VALUES
     ('rain_mm', 8, now() - interval '1 day'),
     ('rain_mm', 0, now() - interval '2 days'),
     ('rain_mm', 31, now() - interval '3 days')`);
  const r = await fetch(base + "/api/owner/rain?days=14", {
    headers: { Authorization: `Bearer ${ownerToken}` } }).then((x) => x.json());
  assert.equal(r.today_mm, 12.5);
  assert.ok(r.days.length >= 3);
  assert.equal(r.season.total_mm, 51.5);
  assert.equal(r.season.rain_days, 3, "zero-rain day not counted as a rain day");
  assert.equal(r.season.wettest_day.mm, 31);
  assert.ok(r.season.start.endsWith("-10-01"));
});

test("rain endpoint aggregates weekly and monthly totals", async () => {
  await q(`INSERT INTO readings (metric, value, taken_at) VALUES
     ('rain_mm', 10, now()),
     ('rain_mm', 5, now() - interval '1 day'),
     ('rain_mm', 20, now() - interval '35 days'),
     ('rain_mm', 7, now() - interval '65 days')`);
  const r = await fetch(base + "/api/owner/rain", {
    headers: { Authorization: `Bearer ${ownerToken}` } }).then((x) => x.json());
  assert.ok(Array.isArray(r.weeks) && r.weeks.length >= 2, "weekly series present");
  assert.ok(Array.isArray(r.months) && r.months.length >= 3, "monthly series present");
  const monthSum = r.months.reduce((a, m) => a + m.mm, 0);
  assert.equal(monthSum, 42, "monthly totals cover all readings");
  const thisMonth = r.months.at(-1);
  assert.equal(thisMonth.mm, 15);
  assert.equal(thisMonth.rain_days, 2);
});

test("rain endpoint returns cumulative season-vs-season curves", async () => {
  // Current season (2025/26 at the frozen test horizon) and previous season.
  await q(`INSERT INTO readings (metric, value, taken_at) VALUES
     ('rain_mm', 10, now()),
     ('rain_mm', 25, now() - interval '30 days'),
     ('rain_mm', 40, now() - interval '1 year'),
     ('rain_mm', 20, now() - interval '1 year' + interval '10 days')`);
  const r = await fetch(base + "/api/owner/rain", {
    headers: { Authorization: `Bearer ${ownerToken}` } }).then((x) => x.json());
  assert.equal(r.seasons.length, 2, "current and previous season present");
  const cur = r.seasons.find((s) => s.current);
  const prev = r.seasons.find((s) => !s.current);
  assert.equal(cur.total_mm, 35);
  assert.equal(prev.total_mm, 60);
  // Cumulative and monotonic
  const cums = cur.points.map((p) => p.mm);
  assert.deepEqual(cums, [...cums].sort((a, b) => a - b));
  assert.equal(cums.at(-1), 35);
  // Day-of-season indexes are in range and ordered
  const ds = cur.points.map((p) => p.d);
  assert.ok(ds.every((d) => d >= 0 && d <= 366));
  assert.deepEqual(ds, [...ds].sort((a, b) => a - b));
  // Labels look like 2025/26
  assert.match(cur.label, /^\d{4}\/\d{2}$/);
});

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
